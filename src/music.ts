import { sfx, type Bed } from './audio';

/** What the music is doing, from the game's state: see Game.update. */
export type MusicState = 'menu' | 'build' | 'test' | 'result' | 'collapse' | 'pause';

/** Scales as semitones above the root. */
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MIXO = [0, 2, 4, 5, 7, 9, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];

/**
 * A scene's music: the key (root as a MIDI note, around the octave below middle C), its scale,
 * the tempo, and the chords as scale degrees (0 is the root's chord), two bars each.
 */
export interface Mood {
  root: number;
  scale: number[];
  bpm: number;
  chords: number[];
}

const MENU: Mood = { root: 48, scale: LYDIAN, bpm: 84, chords: [0, 4, 5, 3] };

/** Each scene's mood, by theme id. A scene without one plays the menu's. */
export const MOODS: Record<string, Mood> = {
  river: { root: 50, scale: MAJOR, bpm: 80, chords: [0, 3, 5, 4] },
  canyon: { root: 52, scale: DORIAN, bpm: 72, chords: [0, 6, 3, 0] },
  flood: { root: 45, scale: MINOR, bpm: 76, chords: [0, 5, 2, 6] },
  coast: { root: 53, scale: MAJOR, bpm: 88, chords: [0, 4, 5, 3] },
  mountains: { root: 50, scale: DORIAN, bpm: 66, chords: [0, 3, 0, 6] },
  city: { root: 51, scale: MAJOR, bpm: 70, chords: [1, 4, 0, 5] },
  harbor: { root: 55, scale: MAJOR, bpm: 84, chords: [0, 3, 4, 0] },
  fjord: { root: 47, scale: MINOR, bpm: 64, chords: [0, 5, 3, 4] },
  bay: { root: 45, scale: MAJOR, bpm: 86, chords: [0, 5, 3, 4] },
  gorge: { root: 49, scale: MINOR, bpm: 70, chords: [0, 6, 5, 4] },
  prairie: { root: 55, scale: MIXO, bpm: 92, chords: [0, 6, 3, 0] },
  storm: { root: 53, scale: MINOR, bpm: 78, chords: [0, 5, 6, 4] },
  delta: { root: 46, scale: MAJOR, bpm: 76, chords: [0, 2, 3, 4] },
  estuary: { root: 52, scale: MAJOR, bpm: 74, chords: [0, 5, 3, 4] },
};

/** How each state sounds: the filter's opening (Hz), the level, and how busy the arpeggio is. */
const SHAPE: Record<MusicState, { cutoff: number; level: number; arp: number }> = {
  menu: { cutoff: 2400, level: 1, arp: 0.3 },
  build: { cutoff: 1800, level: 0.8, arp: 0.35 },
  test: { cutoff: 1300, level: 0.9, arp: 0.7 },
  result: { cutoff: 2400, level: 0.85, arp: 0.3 },
  collapse: { cutoff: 260, level: 0.35, arp: 0 },
  pause: { cutoff: 700, level: 0.5, arp: 0 },
};

const LOOKAHEAD = 0.25;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/**
 * Generative music in WebAudio: a pad holding each chord, a soft bass on the beats and a plucked
 * arpeggio over them, in the scene's mood. A test run adds a pulse, and the filter opens as the
 * bridge's stress climbs; a collapse muffles it all under the rumble. Notes are scheduled a
 * little ahead of the clock as the game's frames tick.
 */
export class Music {
  private bed: Bed | null = null;
  private filter: BiquadFilterNode | null = null;
  private level: GainNode | null = null;
  private echo: GainNode | null = null;
  private mood = MENU;
  private next: Mood = MENU;
  private state: MusicState = 'menu';
  private stress = 0;
  /** The 8th-note step about to be scheduled, and when it falls on the audio clock. */
  private step = 0;
  private at = 0;

  /** Called every frame with what's on screen. `stress`: the run's peak so far, 0 to 1. */
  update(state: MusicState, sceneId: string | null, stress: number): void {
    this.next = (state !== 'menu' && sceneId && MOODS[sceneId]) || MENU;
    if (state !== this.state || Math.abs(stress - this.stress) > 0.02) {
      this.state = state;
      this.stress = stress;
      this.shape();
    }
    const bed = this.bed ?? this.start();
    if (!bed) return;
    const now = bed.ctx.currentTime;
    if (!sfx.audible('music')) {
      // Keep the clock, so the music picks up on a fresh bar when it's turned up again.
      this.at = now + 0.1;
      this.step = 0;
      return;
    }
    if (this.at < now) this.at = now + 0.05;
    while (this.at < now + LOOKAHEAD) {
      this.play(this.step, this.at);
      this.at += 30 / this.mood.bpm;
      this.step = (this.step + 1) % (16 * this.mood.chords.length);
    }
  }

  private start(): Bed | null {
    const bed = sfx.bed('music');
    if (!bed) return null;
    const { ctx } = bed;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.7;
    this.level = ctx.createGain();
    this.level.gain.value = 0;
    this.filter.connect(this.level).connect(bed.out);
    // A dotted-8th echo that gives the plucks some room.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.45;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    this.echo = ctx.createGain();
    this.echo.gain.value = 0.3;
    this.echo.connect(delay).connect(feedback).connect(delay);
    delay.connect(this.filter);
    this.bed = bed;
    this.shape();
    return bed;
  }

  /** Eases the filter and level toward the state's (and the stress's) shape. */
  private shape(): void {
    if (!this.bed || !this.filter || !this.level) return;
    const s = SHAPE[this.state];
    const t = this.bed.ctx.currentTime;
    const cutoff = this.state === 'test' ? s.cutoff + this.stress * 3800 : s.cutoff;
    const slow = this.state === 'collapse' ? 0.5 : 0.25;
    this.filter.frequency.setTargetAtTime(cutoff, t, slow);
    this.level.gain.setTargetAtTime(0.16 * s.level, t, slow);
  }

  /** The notes on one 8th-note step at time `t`. */
  private play(step: number, t: number): void {
    // A new scene's mood comes in on its first chord.
    if (step % 16 === 0 && this.next !== this.mood) {
      this.mood = this.next;
      this.step = step = 0;
    }
    const m = this.mood;
    const beat = 60 / m.bpm;
    const degree = m.chords[Math.floor(step / 16) % m.chords.length];
    const chord = [0, 2, 4].map((i) => this.note(degree + i));
    const shape = SHAPE[this.state];
    if (step % 16 === 0) for (const n of chord) this.pad(hz(n + 12), t, beat * 8);
    if (step % 4 === 0 && this.state !== 'pause') this.bass(hz(chord[0] - 12), t, beat * (step % 8 === 0 ? 1.6 : 0.9));
    if (Math.random() < shape.arp) {
      // Climbs the chord, an octave or two up, and now and then reaches for the next scale tone.
      const k = (step + Math.floor(step / 8)) % 4;
      const n = k === 3 ? this.note(degree + 6) : chord[k];
      this.pluck(hz(n + (step % 8 < 4 ? 12 : 24)), t);
    }
    if (this.state === 'test') {
      if (step % 2 === 0) this.kick(t);
      else this.hat(t, 0.02 + this.stress * 0.03);
    }
  }

  /** A MIDI note: scale degree `d` of the mood's key, past the octave as needed. */
  private note(d: number): number {
    const s = this.mood.scale;
    return this.mood.root + s[d % s.length] + 12 * Math.floor(d / s.length);
  }

  private voice(type: OscillatorType, f: number, t: number, attack: number, hold: number, release: number, vol: number, into: AudioNode, detune = 0): void {
    const ctx = this.bed!.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    o.connect(g).connect(into);
    o.start(t);
    o.stop(t + attack + hold + release + 0.05);
  }

  private pad(f: number, t: number, dur: number): void {
    this.voice('sawtooth', f, t, 1.2, dur - 1.2, 1.6, 0.05, this.filter!, -7);
    this.voice('triangle', f, t, 1.2, dur - 1.2, 1.6, 0.09, this.filter!, 6);
  }

  private bass(f: number, t: number, dur: number): void {
    this.voice('sine', f, t, 0.02, dur * 0.6, dur * 0.5, 0.5, this.filter!);
    this.voice('triangle', f, t, 0.02, 0.05, dur * 0.4, 0.12, this.filter!);
  }

  private pluck(f: number, t: number): void {
    this.voice('triangle', f, t, 0.005, 0.02, 0.5, 0.22, this.filter!);
    this.voice('sine', f * 2, t, 0.005, 0, 0.18, 0.05, this.echo!);
    this.voice('triangle', f, t, 0.005, 0, 0.3, 0.12, this.echo!);
  }

  private kick(t: number): void {
    const ctx = this.bed!.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(this.level!);
    o.start(t);
    o.stop(t + 0.25);
  }

  private hat(t: number, vol: number): void {
    const { ctx, noise } = this.bed!;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 6, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f).connect(g).connect(this.level!);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.06);
  }
}

export const music = new Music();
