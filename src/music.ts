import { sfx, type Bed } from './audio';

/** What the music is doing, from the game's state: see Game.update. */
export type MusicState = 'menu' | 'build' | 'test' | 'result' | 'collapse' | 'pause';

/** Scales as semitones above the root. */
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MIXO = [0, 2, 4, 5, 7, 9, 10];
const HARMONIC = [0, 2, 3, 5, 7, 8, 11];

/** The darker scale tension music turns a scale to: its parallel minor, or for a minor one, the harmonic minor. */
const DARKER = new Map<number[], number[]>([
  [MAJOR, MINOR],
  [MIXO, DORIAN],
  [DORIAN, MINOR],
  [MINOR, HARMONIC],
]);

/** The hook's instrument. */
export type LeadVoice = 'square' | 'pluck' | 'bell' | 'reed' | 'brass';
/** The sustained chords' instrument. */
export type PadVoice = 'saw' | 'organ' | 'glass';
/** The drum groove. */
export type Kit = 'pop' | 'shuffle' | 'halftime' | 'march' | 'lofi';

/**
 * A scene's tune: the key (root as a MIDI note, around the octave below middle C), its scale,
 * the tempo, and four chords as scale degrees (0 is the root's chord), a bar each, then four
 * more for the B section. The hook and the groove are drawn from these, the same every time, so
 * each scene keeps a tune of its own; the instruments and the groove give it its own sound.
 */
export interface Mood {
  root: number;
  scale: number[];
  bpm: number;
  chords: number[];
  /** The B section's chords; by default the A section's turned halfway round. */
  bridge?: number[];
  lead?: LeadVoice;
  pad?: PadVoice;
  kit?: Kit;
  /** How late the offbeat 8ths fall, as a share of an 8th: 0 is straight, 0.3 a lazy shuffle. */
  swing?: number;
  /** Plays tense from the start, not only when the stakes rise. */
  tense?: boolean;
}

const MENU: Mood = { root: 48, scale: MAJOR, bpm: 122, chords: [0, 5, 3, 4], bridge: [3, 4, 5, 4] };

/** Each scene's mood, by theme id. A scene without one plays the menu's. */
export const MOODS: Record<string, Mood> = {
  river: { root: 50, scale: MAJOR, bpm: 118, chords: [0, 4, 5, 3], bridge: [3, 4, 0, 5] },
  canyon: { root: 52, scale: DORIAN, bpm: 112, chords: [0, 3, 6, 0], bridge: [3, 6, 4, 4], lead: 'pluck', kit: 'shuffle', swing: 0.22 },
  flood: { root: 45, scale: MINOR, bpm: 124, chords: [0, 5, 2, 6], bridge: [3, 4, 5, 6], lead: 'brass', kit: 'halftime' },
  coast: { root: 53, scale: MAJOR, bpm: 126, chords: [3, 4, 0, 5], bridge: [5, 4, 3, 4], lead: 'bell', pad: 'organ' },
  mountains: { root: 50, scale: MIXO, bpm: 110, chords: [0, 6, 3, 0], bridge: [3, 0, 6, 4], lead: 'bell', pad: 'glass', kit: 'halftime' },
  city: { root: 51, scale: MAJOR, bpm: 120, chords: [5, 3, 0, 4], bridge: [1, 4, 0, 5], lead: 'pluck', pad: 'organ', kit: 'lofi', swing: 0.2 },
  harbor: { root: 55, scale: MAJOR, bpm: 116, chords: [0, 3, 5, 4], bridge: [3, 4, 0, 4], lead: 'reed', pad: 'organ', kit: 'shuffle', swing: 0.15 },
  fjord: { root: 47, scale: MINOR, bpm: 112, chords: [0, 3, 5, 6], bridge: [5, 6, 3, 4], lead: 'bell', pad: 'glass', kit: 'halftime' },
  bay: { root: 45, scale: MAJOR, bpm: 128, chords: [0, 3, 4, 3], bridge: [5, 3, 4, 4] },
  gorge: { root: 49, scale: MINOR, bpm: 120, chords: [0, 6, 5, 6], bridge: [3, 4, 0, 4], lead: 'brass', pad: 'organ' },
  prairie: { root: 55, scale: MIXO, bpm: 132, chords: [0, 6, 3, 0], bridge: [4, 3, 6, 0], lead: 'pluck', kit: 'march' },
  storm: { root: 53, scale: MINOR, bpm: 130, chords: [0, 5, 3, 6], bridge: [5, 6, 4, 4], lead: 'brass', kit: 'halftime' },
  delta: { root: 46, scale: MAJOR, bpm: 114, chords: [0, 2, 3, 4], bridge: [5, 3, 1, 4], lead: 'reed', pad: 'organ', kit: 'shuffle', swing: 0.18 },
  estuary: { root: 52, scale: MAJOR, bpm: 118, chords: [3, 0, 4, 5], bridge: [1, 4, 5, 4], lead: 'bell', pad: 'glass', kit: 'lofi', swing: 0.12 },
  highland: { root: 45, scale: HARMONIC, bpm: 134, chords: [0, 5, 3, 4], bridge: [5, 6, 3, 4], lead: 'brass', pad: 'organ', kit: 'halftime', tense: true },
};

/** The B section's chords. */
export function bridgeOf(m: Mood): number[] {
  return m.bridge ?? [...m.chords.slice(2), ...m.chords.slice(0, 2)];
}

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

/** Peak stress past which a test run turns tense. */
const TENSE_STRESS = 0.85;

/**
 * 8th-note steps in a bar, and in the tune's loop: sixteen bars, an A section of the four chords
 * twice and a B section of the bridge chords twice.
 */
const BAR = 8;
const HALF = 8 * BAR;
export const LOOP = 2 * HALF;

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

/** A drum groove: the kick patterns a tune picks one of, where the clap falls, and hats on every 8th or only the offbeats. */
interface Groove {
  kicks: number[][];
  clap: number[];
  hats: 'all' | 'off';
}

/** Steps in a bar where each kit's drums fall once they are in full. */
const KITS: Record<Kit, Groove> = {
  pop: {
    kicks: [
      [0, 4],
      [0, 3, 4],
      [0, 4, 7],
      [0, 3, 6],
    ],
    clap: [2, 6],
    hats: 'off',
  },
  shuffle: {
    kicks: [
      [0, 4],
      [0, 3, 4],
      [0, 4, 7],
    ],
    clap: [2, 6],
    hats: 'all',
  },
  halftime: {
    kicks: [
      [0, 5],
      [0, 3],
      [0, 5, 7],
    ],
    clap: [4],
    hats: 'off',
  },
  march: { kicks: [[0, 2, 4, 6]], clap: [2, 6], hats: 'off' },
  lofi: {
    kicks: [
      [0, 5],
      [0, 3, 5],
      [0, 5, 7],
    ],
    clap: [2, 6],
    hats: 'all',
  },
};

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

/** How many tunes each scene has: its levels take turns with them. */
export const VARIANTS = 3;

/**
 * A mood's tune, one of its VARIANTS. The hook is a two-bar phrase, written against each bar's
 * chord so it follows the chords when it comes back, laid out A A′ A A″ over the A section's
 * eight bars: the phrase, its first bar with an ending that stays open on the fifth, the phrase
 * again, and its first bar coming home. The B section does the same with a phrase of its own
 * that starts higher, ending on the third and then open on the fifth to lead back to A.
 */
export function compose(m: Mood, variant = 0): Tune {
  const rnd = seeded(m.root * 7919 + m.bpm * 104729 + m.chords.reduce((a, c) => a * 8 + c, 1) + m.scale.join('').length + variant * 1000003);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  /** A phrase on the rhythm: a contour that moves by a step or two and lands on a chord tone on each beat. */
  const write = (rhythm: number[], from: number[]): Note[] => {
    const onsets = rhythm.flatMap((on, i) => (on ? [i] : []));
    let deg = pick(from);
    return onsets.map((step, k): Note => {
      if (k) deg = Math.max(0, Math.min(9, deg + pick([-2, -1, -1, 1, 1, 2])));
      if (step % 2 === 0) deg = snap(deg);
      return { step, deg, len: Math.min(3, (onsets[k + 1] ?? 16) - step) };
    });
  };
  const lead: (Note | undefined)[] = Array.from({ length: LOOP });
  const place = (notes: Note[], at: number) => {
    for (const n of notes) lead[at + n.step] = { ...n, step: at + n.step };
  };
  /** Lays out a section from its phrase: the phrase, its first bar ending on `open`, the phrase, its first bar ending on `close`. */
  const section = (phrase: Note[], at: number, open: number, close: number) => {
    const first = phrase.filter((n) => n.step < BAR);
    /** The phrase's second bar, its last note moved to `to` and held to the bar's end. */
    const ending = (to: number) =>
      phrase.filter((n) => n.step >= BAR).map((n, i, all) => (i === all.length - 1 ? { step: n.step, deg: to, len: 2 * BAR - n.step } : n));
    place(phrase, at);
    place([...first, ...ending(open)], at + 2 * BAR);
    place(phrase, at + 4 * BAR);
    place([...first, ...ending(close)], at + 6 * BAR);
  };
  const r = Math.floor(rnd() * RHYTHMS.length);
  section(write(RHYTHMS[r], [2, 4, 7]), 0, 4, 7);
  const bass = pick(BASSES);
  const kick = pick(KITS[m.kit ?? 'pop'].kicks);
  // B takes another of the rhythms, so it sounds like an answer rather than the same phrase again.
  const rb = (r + 1 + Math.floor(rnd() * (RHYTHMS.length - 1))) % RHYTHMS.length;
  section(write(RHYTHMS[rb], [4, 7, 9]), HALF, 2, 4);
  return { lead, bass, kick };
}

const LOOKAHEAD = 0.25;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** What the game tells the music besides the state: which of the scene's tunes to play, and whether the stakes are high. */
export interface MusicCue {
  variant?: number;
  tense?: boolean;
}

/**
 * Generative music in WebAudio: each scene's own hook over a bouncing bass, chord stabs and a
 * drum groove, in the scene's mood and on its own instruments, through a sixteen-bar A and B
 * form with a short intro. Building keeps the drums light, a test run drives them harder and
 * opens the filter as the bridge's stress climbs, and a collapse muffles it all under the rumble.
 * Tense play (a challenge, a hard scene, a bridge near breaking) darkens the scale, drives the
 * kick and hats and brings in a pedal tone that opens up with the stress. Every third time round
 * the hook rests for an arpeggio, so it doesn't wear. Notes are scheduled a little ahead of the
 * clock as the game's frames tick.
 */
export class Music {
  private bed: Bed | null = null;
  private filter: BiquadFilterNode | null = null;
  private level: GainNode | null = null;
  private echo: GainNode | null = null;
  private delay: DelayNode | null = null;
  private pedal: OscillatorNode | null = null;
  private pedalFilter: BiquadFilterNode | null = null;
  private pedalLevel: GainNode | null = null;
  private mood = MENU;
  private variant = 0;
  private tune = compose(MENU);
  private next: Mood = MENU;
  private nextVariant = 0;
  private state: MusicState = 'menu';
  private stress = 0;
  /** Whether the music is tense now, and whether it should be from the next bar. */
  private tense = false;
  private wantTense = false;
  /** The 8th-note step about to be scheduled, when it falls on the audio clock, and the times round the loop. */
  private step = 0;
  private at = 0;
  private pass = 0;

  /** Called every frame with what's on screen. `stress`: the run's peak so far, 0 to 1. */
  update(state: MusicState, sceneId: string | null, stress: number, cue: MusicCue = {}): void {
    const scene = state !== 'menu' && sceneId ? MOODS[sceneId] : undefined;
    this.next = scene ?? MENU;
    this.nextVariant = scene ? (cue.variant ?? 0) % VARIANTS : 0;
    this.wantTense = state !== 'menu' && (!!cue.tense || !!scene?.tense || (state === 'test' && stress > TENSE_STRESS));
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
    // The tension pedal: a low saw on the root, silent until the music turns tense, with a filter of its own.
    this.pedal = ctx.createOscillator();
    this.pedal.type = 'sawtooth';
    this.pedal.frequency.value = hz(this.mood.root - 12);
    this.pedalFilter = ctx.createBiquadFilter();
    this.pedalFilter.type = 'lowpass';
    this.pedalFilter.Q.value = 4;
    this.pedalLevel = ctx.createGain();
    this.pedalLevel.gain.value = 0;
    this.pedal.connect(this.pedalFilter).connect(this.pedalLevel).connect(this.level);
    this.pedal.start();
    this.bed = bed;
    this.shape();
    return bed;
  }

  /** Eases the filter and level toward the state's (and the stress's) shape, and the pedal toward the tension's. */
  private shape(): void {
    if (!this.bed || !this.filter || !this.level || !this.pedalFilter || !this.pedalLevel) return;
    const s = SHAPE[this.state];
    const t = this.bed.ctx.currentTime;
    const testing = this.state === 'test';
    const cutoff = testing ? s.cutoff + this.stress * 4000 : s.cutoff;
    const slow = this.state === 'collapse' ? 0.5 : 0.25;
    this.filter.frequency.setTargetAtTime(cutoff, t, slow);
    this.level.gain.setTargetAtTime(0.15 * s.level, t, slow);
    const pedal = this.tense && s.drums !== 'none';
    this.pedalFilter.frequency.setTargetAtTime(testing ? 160 + this.stress * 1600 : 280, t, slow);
    this.pedalLevel.gain.setTargetAtTime(pedal ? 0.1 + (testing ? this.stress * 0.08 : 0) : 0, t, 0.6);
  }

  /** The notes on one 8th-note step at time `t`. */
  private play(step: number, t: number): void {
    if (step % BAR === 0) {
      // A new scene's tune comes in on the next bar, and so does a change of tension.
      if (this.next !== this.mood || this.nextVariant !== this.variant) {
        this.mood = this.next;
        this.variant = this.nextVariant;
        this.tune = compose(this.mood, this.variant);
        this.step = step = 0;
        this.pass = 0;
        this.delay?.delayTime.setValueAtTime(45 / this.mood.bpm, t);
        this.pedal?.frequency.setValueAtTime(hz(this.mood.root - 12), t);
      }
      if (this.wantTense !== this.tense) {
        this.tense = this.wantTense;
        this.shape();
      }
    }
    const m = this.mood;
    const dt = 30 / m.bpm;
    const b = step % BAR;
    // Swing: the offbeats fall a little late.
    if (b % 2 === 1) t += (m.swing ?? 0) * dt;
    const bar = Math.floor(step / BAR);
    const chords = step < HALF ? m.chords : bridgeOf(m);
    const degree = chords[bar % chords.length];
    const chord = [0, 2, 4].map((i) => this.note(degree + i));
    const shape = SHAPE[this.state];
    const drums = shape.drums;

    if (b === 0) for (const n of chord) this.pad(hz(n + 12), t, dt * BAR);
    const bass = this.tune.bass[b];
    if (bass !== null && this.state !== 'pause') this.bass(hz(this.note(degree + bass) - 12), t, dt * 0.9);
    // Offbeat chord stabs push it along: every offbeat in full, two a bar while building.
    if (drums !== 'none' && b % 2 === 1 && (drums !== 'light' || b % 4 === 3)) for (const n of chord) this.stab(hz(n + 12), t);

    // A new tune opens on two bars without the hook, and every third time round it rests for an arpeggio.
    const intro = this.pass === 0 && step < 2 * BAR;
    const resting = this.pass % 3 === 2;
    const n = this.tune.lead[step];
    if (shape.lead && !resting && !intro) {
      if (n) this.lead(hz(this.leadNote(degree, n.deg)), t, dt * n.len);
    } else if (this.state !== 'collapse' && !intro) {
      this.pluck(hz(this.leadNote(degree, [0, 2, 4, 7][(step + Math.floor(step / 4)) % 4])), t);
    }

    if (drums === 'none') return;
    const kit = KITS[m.kit ?? 'pop'];
    const light = drums === 'light';
    const kicks = light ? (m.kit === 'halftime' ? [0] : [0, 4]) : this.tense ? [0, 2, 4, 6] : this.tune.kick;
    if (kicks.includes(b)) this.kick(t, light ? 0.4 : 0.6);
    if (kit.clap.includes(b)) this.clap(t, light ? 0.5 : 0.8);
    if (b % 2 === 1) this.hat(t, light ? 0.03 : 0.045);
    else if (kit.hats === 'all' && !light) this.hat(t, 0.025);
    if (drums === 'drive' || this.tense) this.hat(t + dt / 2, 0.02 + this.stress * 0.03);
    if (light) return;
    // A snare fill into the B section, and a roll over the last half bar back to the top.
    if (step >= HALF - 2 && step < HALF) this.clap(t + dt / 2, 0.6);
    if (step >= LOOP - BAR / 2) {
      this.clap(t + dt / 2, 0.35 + 0.1 * (b - BAR / 2));
      if (step >= LOOP - 2) this.clap(t + dt / 4, 0.3);
    }
  }

  /** The scale the music plays in now: the mood's own, or a darker one while tense. */
  private scale(): number[] {
    const s = this.mood.scale;
    return this.tense ? (DARKER.get(s) ?? s) : s;
  }

  /** A MIDI note: scale degree `d` of the mood's key, past the octave as needed. */
  private note(d: number): number {
    const s = this.scale();
    return this.mood.root + s[d % s.length] + 12 * Math.floor(d / s.length);
  }

  /** The hook's note, `deg` scale steps over the chord on `degree`, an octave up and kept below the top of the range. */
  private leadNote(degree: number, deg: number): number {
    let n = this.note(degree + deg) + 12;
    while (n > 81) n -= 12;
    return n;
  }

  private voice(type: OscillatorType, f: number, t: number, attack: number, hold: number, release: number, vol: number, into: AudioNode, detune = 0): OscillatorNode {
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
    return o;
  }

  /** Wobbles an oscillator's pitch by `cents` at 5.5 Hz, from `t` until `end`. */
  private vibrato(o: OscillatorNode, t: number, end: number, cents: number): void {
    const ctx = this.bed!.ctx;
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 5.5;
    depth.gain.value = cents;
    lfo.connect(depth).connect(o.detune);
    lfo.start(t);
    lfo.stop(end);
  }

  private pad(f: number, t: number, dur: number): void {
    const into = this.filter!;
    switch (this.mood.pad ?? 'saw') {
      case 'organ':
        // Drawbars: the note with its octave and twelfth.
        this.voice('sine', f, t, 0.05, Math.max(0, dur - 0.05), 0.3, 0.04, into);
        this.voice('sine', f * 2, t, 0.05, Math.max(0, dur - 0.05), 0.3, 0.018, into);
        this.voice('sine', f * 3, t, 0.05, Math.max(0, dur - 0.05), 0.2, 0.009, into);
        break;
      case 'glass':
        this.voice('triangle', f, t, 0.9, Math.max(0, dur - 0.9), 0.9, 0.035, into, -4);
        this.voice('sine', f * 2, t, 0.9, Math.max(0, dur - 0.9), 0.9, 0.018, into, 4);
        break;
      default:
        this.voice('sawtooth', f, t, 0.4, Math.max(0, dur - 0.4), 0.6, 0.022, into, -7);
        this.voice('triangle', f, t, 0.4, Math.max(0, dur - 0.4), 0.6, 0.045, into, 6);
    }
  }

  private bass(f: number, t: number, dur: number): void {
    this.voice('sine', f, t, 0.008, dur * 0.5, dur * 0.4, 0.45, this.filter!);
    this.voice('square', f, t, 0.008, 0.04, dur * 0.4, 0.05, this.filter!);
  }

  private stab(f: number, t: number): void {
    this.voice('triangle', f, t, 0.004, 0.03, 0.12, 0.035, this.filter!);
  }

  private lead(f: number, t: number, dur: number): void {
    const into = this.filter!;
    const echo = this.echo!;
    const hold = Math.max(0.02, dur * 0.8 - 0.05);
    switch (this.mood.lead ?? 'square') {
      case 'pluck':
        this.voice('triangle', f, t, 0.003, 0.02, Math.min(0.5, dur + 0.15), 0.13, into);
        this.voice('square', f, t, 0.003, 0, 0.08, 0.03, into);
        this.voice('triangle', f, t, 0.003, 0, 0.25, 0.05, echo);
        break;
      case 'bell':
        // A sine with inharmonic partials that die away first, the way a struck bar rings.
        this.voice('sine', f, t, 0.002, 0, 0.3 + dur, 0.12, into);
        this.voice('sine', f * 2.76, t, 0.002, 0, 0.18, 0.035, into);
        this.voice('sine', f * 5.4, t, 0.002, 0, 0.06, 0.015, into);
        this.voice('sine', f, t, 0.002, 0, 0.4, 0.04, echo);
        break;
      case 'reed': {
        const end = t + 0.03 + hold + 0.17;
        this.vibrato(this.voice('sawtooth', f, t, 0.03, hold, 0.1, 0.028, into), t, end, 12);
        this.vibrato(this.voice('triangle', f, t, 0.03, hold, 0.12, 0.07, into), t, end, 12);
        this.voice('triangle', f, t, 0.02, 0, dur * 0.5, 0.025, echo);
        break;
      }
      case 'brass':
        this.brass(f, t, hold);
        this.voice('sawtooth', f, t, 0.02, 0, dur * 0.5, 0.012, echo);
        break;
      default:
        this.voice('square', f, t, 0.006, hold, 0.09, 0.04, into, -5);
        this.voice('triangle', f, t, 0.006, hold, 0.12, 0.09, into, 5);
        this.voice('square', f, t, 0.006, 0, dur * 0.6, 0.025, echo);
    }
  }

  /** A brassy note: a saw whose own filter swells open as it speaks and settles back while held. */
  private brass(f: number, t: number, hold: number): void {
    const ctx = this.bed!.ctx;
    const o = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = f;
    lp.type = 'lowpass';
    lp.Q.value = 2;
    lp.frequency.setValueAtTime(f * 1.5, t);
    lp.frequency.exponentialRampToValueAtTime(f * 6, t + 0.06);
    lp.frequency.exponentialRampToValueAtTime(f * 3, t + 0.08 + hold);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.03);
    g.gain.setValueAtTime(0.06, t + 0.03 + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + hold + 0.12);
    o.connect(lp).connect(g).connect(this.filter!);
    o.start(t);
    o.stop(t + 0.03 + hold + 0.17);
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
