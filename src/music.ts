import { sfx, type Bed } from './audio';

/** What the music is doing, from the game's state: see Game.update. */
export type MusicState = 'menu' | 'build' | 'test' | 'result' | 'collapse' | 'pause';

/** Scales as semitones above the root. */
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MIXO = [0, 2, 4, 5, 7, 9, 10];

/**
 * A scene's tune: the key (root as a MIDI note, around the octave below middle C), its scale,
 * the tempo, and four chords as scale degrees (0 is the root's chord), a bar each. The hook and
 * the groove are drawn from these, the same every time, so each scene keeps a tune of its own.
 */
export interface Mood {
  root: number;
  scale: number[];
  bpm: number;
  chords: number[];
}

const MENU: Mood = { root: 48, scale: MAJOR, bpm: 122, chords: [0, 5, 3, 4] };

/** Each scene's mood, by theme id. A scene without one plays the menu's. */
export const MOODS: Record<string, Mood> = {
  river: { root: 50, scale: MAJOR, bpm: 118, chords: [0, 4, 5, 3] },
  canyon: { root: 52, scale: DORIAN, bpm: 112, chords: [0, 3, 6, 0] },
  flood: { root: 45, scale: MINOR, bpm: 124, chords: [0, 5, 2, 6] },
  coast: { root: 53, scale: MAJOR, bpm: 126, chords: [3, 4, 0, 5] },
  mountains: { root: 50, scale: MIXO, bpm: 110, chords: [0, 6, 3, 0] },
  city: { root: 51, scale: MAJOR, bpm: 120, chords: [5, 3, 0, 4] },
  harbor: { root: 55, scale: MAJOR, bpm: 116, chords: [0, 3, 5, 4] },
  fjord: { root: 47, scale: MINOR, bpm: 112, chords: [0, 3, 5, 6] },
  bay: { root: 45, scale: MAJOR, bpm: 128, chords: [0, 3, 4, 3] },
  gorge: { root: 49, scale: MINOR, bpm: 120, chords: [0, 6, 5, 6] },
  prairie: { root: 55, scale: MIXO, bpm: 132, chords: [0, 6, 3, 0] },
  storm: { root: 53, scale: MINOR, bpm: 130, chords: [0, 5, 3, 6] },
  delta: { root: 46, scale: MAJOR, bpm: 114, chords: [0, 2, 3, 4] },
  estuary: { root: 52, scale: MAJOR, bpm: 118, chords: [3, 0, 4, 5] },
};

type Drums = 'none' | 'light' | 'full' | 'drive';

/** How each state sounds: the filter's opening (Hz), the level, the drums, and whether the hook plays. */
const SHAPE: Record<MusicState, { cutoff: number; level: number; drums: Drums; lead: boolean }> = {
  menu: { cutoff: 5200, level: 1, drums: 'full', lead: true },
  build: { cutoff: 3200, level: 0.75, drums: 'light', lead: true },
  test: { cutoff: 2600, level: 0.95, drums: 'drive', lead: true },
  result: { cutoff: 5200, level: 0.9, drums: 'full', lead: true },
  collapse: { cutoff: 260, level: 0.35, drums: 'none', lead: false },
  pause: { cutoff: 700, level: 0.5, drums: 'none', lead: false },
};

/** 8th-note steps in a bar, and in the tune's loop: eight bars, the four chords twice. */
const BAR = 8;
const LOOP = 8 * BAR;

/** Two-bar rhythms for the hook, a note starting at each 1: syncopated, so they stick. */
const RHYTHMS = [
  [1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 0],
  [1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0],
  [0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 0, 1, 0],
  [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
  [1, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 1, 0],
];
/** Bass lines over a bar, as scale steps above the chord's root (4 its fifth, 7 its octave); null rests. */
const BASSES: (number | null)[][] = [
  [0, null, null, 0, null, null, 0, 7],
  [0, null, 7, 0, null, 0, 7, 4],
  [0, 0, null, 0, null, 4, null, 7],
  [0, null, 4, null, 7, null, 4, null],
];
/** Where the kick falls in a bar once the drums are in full. */
const KICKS = [
  [0, 4],
  [0, 3, 4],
  [0, 4, 7],
  [0, 3, 6],
];

/** A note of the hook: its step in the loop, scale steps above the chord's root, and its length in steps. */
export interface Note {
  step: number;
  deg: number;
  len: number;
}

export interface Tune {
  /** The hook's note starting at each step of the loop, if any. */
  lead: (Note | undefined)[];
  bass: (number | null)[];
  kick: number[];
}

/** A repeatable random sequence (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The nearest chord tone (root, third, fifth, octave, tenth) to `deg` scale steps above the chord's root. */
const snap = (deg: number) => [0, 2, 4, 7, 9].reduce((a, b) => (Math.abs(b - deg) < Math.abs(a - deg) ? b : a));

/**
 * A mood's tune. The hook is a two-bar phrase, written against each bar's chord so it follows the
 * chords when it comes back, laid out A A′ A A″ over the eight bars: the phrase, its first bar
 * with an ending that stays open on the fifth, the phrase again, and its first bar coming home.
 */
export function compose(m: Mood): Tune {
  const rnd = seeded(m.root * 7919 + m.bpm * 104729 + m.chords.reduce((a, c) => a * 8 + c, 1) + m.scale.join('').length);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const rhythm = pick(RHYTHMS);
  const onsets = rhythm.flatMap((on, i) => (on ? [i] : []));
  // A contour that moves by a step or two and lands on a chord tone on each beat.
  let deg = pick([2, 4, 7]);
  const phrase = onsets.map((step, k): Note => {
    if (k) deg = Math.max(0, Math.min(9, deg + pick([-2, -1, -1, 1, 1, 2])));
    if (step % 2 === 0) deg = snap(deg);
    return { step, deg, len: Math.min(3, (onsets[k + 1] ?? 16) - step) };
  });
  const first = phrase.filter((n) => n.step < BAR);
  /** The phrase's second bar, its last note moved to `to` and held to the bar's end. */
  const ending = (to: number) =>
    phrase.filter((n) => n.step >= BAR).map((n, i, all) => (i === all.length - 1 ? { step: n.step, deg: to, len: 2 * BAR - n.step } : n));
  const lead: (Note | undefined)[] = Array.from({ length: LOOP });
  const place = (notes: Note[], at: number) => {
    for (const n of notes) lead[at + n.step] = { ...n, step: at + n.step };
  };
  place(phrase, 0);
  place([...first, ...ending(4)], 2 * BAR);
  place(phrase, 4 * BAR);
  place([...first, ...ending(7)], 6 * BAR);
  return { lead, bass: pick(BASSES), kick: pick(KICKS) };
}

const LOOKAHEAD = 0.25;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/**
 * Generative music in WebAudio: each scene's own hook over a bouncing bass, offbeat chord stabs
 * and a drum groove, in the scene's mood. Building keeps the drums light, a test run drives
 * them harder and opens the filter as the bridge's stress climbs, and a collapse muffles it all
 * under the rumble. Every fourth time round the hook rests for an arpeggio, so it doesn't wear.
 * Notes are scheduled a little ahead of the clock as the game's frames tick.
 */
export class Music {
  private bed: Bed | null = null;
  private filter: BiquadFilterNode | null = null;
  private level: GainNode | null = null;
  private echo: GainNode | null = null;
  private delay: DelayNode | null = null;
  private mood = MENU;
  private tune = compose(MENU);
  private next: Mood = MENU;
  private state: MusicState = 'menu';
  private stress = 0;
  /** The 8th-note step about to be scheduled, when it falls on the audio clock, and the times round the loop. */
  private step = 0;
  private at = 0;
  private pass = 0;

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
      // Keep the clock, so the music picks up on a fresh loop when it's turned up again.
      this.at = now + 0.1;
      this.step = 0;
      this.pass = 0;
      return;
    }
    if (this.at < now) this.at = now + 0.05;
    while (this.at < now + LOOKAHEAD) {
      this.play(this.step, this.at);
      this.at += 30 / this.mood.bpm;
      this.step = (this.step + 1) % LOOP;
      if (!this.step) this.pass++;
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
    // A dotted-8th echo that gives the lead some room.
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = 45 / this.mood.bpm;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.3;
    this.echo = ctx.createGain();
    this.echo.gain.value = 0.35;
    this.echo.connect(this.delay).connect(feedback).connect(this.delay);
    this.delay.connect(this.filter);
    this.bed = bed;
    this.shape();
    return bed;
  }

  /** Eases the filter and level toward the state's (and the stress's) shape. */
  private shape(): void {
    if (!this.bed || !this.filter || !this.level) return;
    const s = SHAPE[this.state];
    const t = this.bed.ctx.currentTime;
    const cutoff = this.state === 'test' ? s.cutoff + this.stress * 4000 : s.cutoff;
    const slow = this.state === 'collapse' ? 0.5 : 0.25;
    this.filter.frequency.setTargetAtTime(cutoff, t, slow);
    this.level.gain.setTargetAtTime(0.15 * s.level, t, slow);
  }

  /** The notes on one 8th-note step at time `t`. */
  private play(step: number, t: number): void {
    // A new scene's tune comes in on the next bar.
    if (step % BAR === 0 && this.next !== this.mood) {
      this.mood = this.next;
      this.tune = compose(this.mood);
      this.step = step = 0;
      this.pass = 0;
      this.delay?.delayTime.setValueAtTime(45 / this.mood.bpm, t);
    }
    const m = this.mood;
    const dt = 30 / m.bpm;
    const b = step % BAR;
    const degree = m.chords[Math.floor(step / BAR) % m.chords.length];
    const chord = [0, 2, 4].map((i) => this.note(degree + i));
    const shape = SHAPE[this.state];
    const drums = shape.drums;

    if (b === 0) for (const n of chord) this.pad(hz(n + 12), t, dt * BAR);
    const bass = this.tune.bass[b];
    if (bass !== null && this.state !== 'pause') this.bass(hz(this.note(degree + bass) - 12), t, dt * 0.9);
    // Offbeat chord stabs push it along: every offbeat in full, two a bar while building.
    if (drums !== 'none' && b % 2 === 1 && (drums !== 'light' || b % 4 === 3)) for (const n of chord) this.stab(hz(n + 12), t);

    const resting = this.pass % 4 === 3;
    const n = this.tune.lead[step];
    if (shape.lead && !resting) {
      if (n) this.lead(hz(this.leadNote(degree, n.deg)), t, dt * n.len);
    } else if (this.state !== 'collapse') {
      this.pluck(hz(this.leadNote(degree, [0, 2, 4, 7][(step + Math.floor(step / 4)) % 4])), t);
    }

    if (drums === 'none') return;
    const light = drums === 'light';
    if ((light ? [0, 4] : this.tune.kick).includes(b)) this.kick(t, light ? 0.4 : 0.6);
    if (b === 2 || b === 6) this.clap(t, light ? 0.5 : 0.8);
    if (b % 2 === 1) this.hat(t, light ? 0.03 : 0.045);
    if (drums === 'drive') this.hat(t + dt / 2, 0.02 + this.stress * 0.03);
    // A snare fill into the top of the loop.
    if (!light && step >= LOOP - 2) this.clap(t + dt / 2, 0.6);
  }

  /** A MIDI note: scale degree `d` of the mood's key, past the octave as needed. */
  private note(d: number): number {
    const s = this.mood.scale;
    return this.mood.root + s[d % s.length] + 12 * Math.floor(d / s.length);
  }

  /** The hook's note, `deg` scale steps over the chord on `degree`, an octave up and kept below the top of the range. */
  private leadNote(degree: number, deg: number): number {
    let n = this.note(degree + deg) + 12;
    while (n > 81) n -= 12;
    return n;
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
    this.voice('sawtooth', f, t, 0.4, Math.max(0, dur - 0.4), 0.6, 0.022, this.filter!, -7);
    this.voice('triangle', f, t, 0.4, Math.max(0, dur - 0.4), 0.6, 0.045, this.filter!, 6);
  }

  private bass(f: number, t: number, dur: number): void {
    this.voice('sine', f, t, 0.008, dur * 0.5, dur * 0.4, 0.45, this.filter!);
    this.voice('square', f, t, 0.008, 0.04, dur * 0.4, 0.05, this.filter!);
  }

  private stab(f: number, t: number): void {
    this.voice('triangle', f, t, 0.004, 0.03, 0.12, 0.035, this.filter!);
  }

  private lead(f: number, t: number, dur: number): void {
    const hold = Math.max(0.02, dur * 0.8 - 0.05);
    this.voice('square', f, t, 0.006, hold, 0.09, 0.04, this.filter!, -5);
    this.voice('triangle', f, t, 0.006, hold, 0.12, 0.09, this.filter!, 5);
    this.voice('square', f, t, 0.006, 0, dur * 0.6, 0.025, this.echo!);
  }

  private pluck(f: number, t: number): void {
    this.voice('triangle', f, t, 0.005, 0.02, 0.4, 0.12, this.filter!);
    this.voice('triangle', f, t, 0.005, 0, 0.3, 0.07, this.echo!);
  }

  private kick(t: number, vol: number): void {
    const ctx = this.bed!.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(this.level!);
    o.start(t);
    o.stop(t + 0.25);
  }

  /** A clap or snare: a band of noise with a short tone under it. */
  private clap(t: number, vol: number): void {
    const { ctx, noise } = this.bed!;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1700;
    f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(f).connect(g).connect(this.level!);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.18);
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.06);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(vol * 0.3, t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(og).connect(this.level!);
    o.start(t);
    o.stop(t + 0.1);
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
