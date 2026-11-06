import type { Pulse, RichHaptics } from './platform';

/** Shortest gap between creak buzzes, ms: a groaning bridge hums rather than rattles. */
const CREAK_GAP = 160;
/** Creaks come faster as a member nears its breaking point. */
const STRAINED_GAP = 90;
/** A creak right after a snap would blur it. */
const AFTER_SNAP = 120;
/** Several members snapping in one frame are one hard pulse. */
const SNAP_GAP = 70;
/** How long a hard pulse lasts on the phone, ms. */
const SNAP_MS = 60;

/**
 * The rumble plays in finite segments, each refreshed well before it ends, so that if the game
 * stalls or dies the buzzing stops by itself. Nothing here ever repeats on its own.
 */
const SEGMENT_MS = 400;
const REFRESH_MS = 250;
/** Shortest gap between segments when only the strength changed, ms: restarting a motor faster than this ticks. */
const CHANGE_GAP = 100;
/** The busiest member's stress where the rumble starts. */
const RUMBLE_FROM = 0.3;
/** The rumble's strength in a few steps, so that small wobbles in stress send nothing. */
const RUMBLE_STEPS = 5;
/** Weakest and strongest rumble, 0 to 255. It tops out low so that a snap still stands out. */
const RUMBLE_MIN = 45;
const RUMBLE_MAX = 140;
/** How fast the felt load eases off once the stress has passed, per second. */
const RELEASE = 1.5;
/** How much harder a creak's spike is than the rumble around it, and how long it lasts. */
const SPIKE = 80;
const SPIKE_MS = 30;

/** A quake's segment is drawn in steps this long, ms. */
const QUAKE_STEP_MS = 50;
/** Strongest quake, 0 to 255: harder than any load, softer than a snap. */
const QUAKE_MAX = 200;
/** How long after its last report a quake still holds the rumble back, ms. */
const QUAKE_HOLD = 100;

const STEP_MS = 40;
/** The phone's own thud is long: 300 ms on a Galaxy S22. The rumble waits, or it would cut the thud short. */
const THUD_MS = 300;
/** Shortest gap between ticks, ms: a fast drag across the grid stays a purr. */
const TICK_GAP = 25;
/** The bridge going down: one hard hit that dies away. */
const COLLAPSE: [number[], number[]] = [
  [90, 130, 180, 250],
  [255, 210, 140, 70],
];

/** What may interrupt what. A lower rank waits for a higher one to finish. */
const enum Rank {
  None,
  /** Footfalls and arch joints cracking: they cut into the rumble and it picks up again after. */
  Knock,
  Snap,
  Collapse,
}

/**
 * Haptics synced to stress: a light buzz as members creak, a hard pulse when one snaps, and a
 * long one when the bridge goes down. Pulses are rationed here, so the game can report every
 * creak and break as it happens.
 *
 * On a phone with amplitude control, `rich` adds what plain pulses can't do: a rumble that follows
 * the load, the quake's shaking, footfalls, cracking arches and a tick as a drag snaps to the grid.
 * The phone plays one thing at a time, and a new effect replaces the last, so this also decides
 * what plays: collapse over snap, snap over quake, quake over footfalls and thuds, all over the rumble.
 */
export class HapticFeel {
  /** Set once the phone has said what it can do. Stays null where it can only pulse. */
  rich: RichHaptics | null = null;
  private on = true;
  private lastLight = -Infinity;
  private lastHeavy = -Infinity;
  private lastTick = -Infinity;
  /** What is playing that outranks the rumble, and until when. */
  private rank = Rank.None;
  private busyUntil = 0;
  private quakeUntil = 0;
  private quakeAngle = 0;
  private quakeAt = 0;
  /** The load as felt, which eases off after the stress has passed. */
  private felt = 0;
  private feltAt = 0;
  /** The strength step of the segment playing, 0 for none, -1 when something else cut it off. */
  private level = -1;
  private sentAt = -Infinity;
  private spike = false;

  constructor(
    private pulse: (p: Pulse) => void,
    private now: () => number = () => performance.now(),
  ) {}

  get enabled(): boolean {
    return this.on;
  }

  set enabled(on: boolean) {
    if (!on) this.stop();
    this.on = on;
  }

  /** Whether an effect of this rank may play now; if so, it holds the phone for `ms`. */
  private claim(rank: Rank, ms: number, t: number): boolean {
    if (t < this.busyUntil && rank < this.rank) return false;
    this.rank = rank;
    this.busyUntil = t + ms;
    this.level = -1;
    this.sentAt = -Infinity;
    return true;
  }

  /** A member creaks under load; `stress` is its stress ratio (0.7 and up). */
  creak(stress: number): void {
    const t = this.now();
    if (!this.on || t - this.lastLight < (stress >= 0.95 ? STRAINED_GAP : CREAK_GAP) || t - this.lastHeavy < AFTER_SNAP) return;
    this.lastLight = t;
    // A separate pulse would cut the rumble, so a creak is a spike in its next segment instead.
    if (this.rich) this.spike = true;
    else this.pulse('light');
  }

  /** A member snaps, or an anchor tears out of the bank. */
  snap(): void {
    const t = this.now();
    if (!this.on || t - this.lastHeavy < SNAP_GAP) return;
    if (this.rich && !this.claim(Rank.Snap, SNAP_MS + AFTER_SNAP, t)) return;
    this.lastHeavy = t;
    this.pulse('heavy');
  }

  /** A three-star result. */
  celebrate(): void {
    if (!this.on) return;
    const t = this.now();
    this.lastHeavy = t;
    if (this.rich) this.claim(Rank.Snap, SNAP_MS, t);
    this.pulse('heavy');
  }

  /** The run failed: the bridge is down. */
  collapse(): void {
    if (!this.on) return;
    const t = this.now();
    this.lastHeavy = t;
    if (!this.rich) {
      this.pulse('long');
      return;
    }
    this.claim(Rank.Collapse, COLLAPSE[0].reduce((a, b) => a + b), t);
    this.rich.wave(...COLLAPSE);
  }

  /** The bridge's busiest member right now, as a stress ratio; reported once a frame during a run. */
  load(stress: number): void {
    if (!this.on || !this.rich) return;
    const t = this.now();
    this.felt = Math.max(Math.min(1, stress), this.felt - ((t - this.feltAt) / 1000) * RELEASE);
    this.feltAt = t;
    if (t < this.busyUntil || t < this.quakeUntil) return;
    const level = Math.min(RUMBLE_STEPS, Math.ceil(((this.felt - RUMBLE_FROM) / (1 - RUMBLE_FROM)) * RUMBLE_STEPS));
    if (level <= 0) {
      if (this.level > 0) this.rich.stop();
      this.level = 0;
      this.spike = false;
      return;
    }
    const since = t - this.sentAt;
    if (!this.spike && since < REFRESH_MS && (level === this.level || since < CHANGE_GAP)) return;
    const amp = Math.round(RUMBLE_MIN + ((RUMBLE_MAX - RUMBLE_MIN) * (level - 1)) / (RUMBLE_STEPS - 1));
    if (this.spike) this.rich.wave([SPIKE_MS, SEGMENT_MS - SPIKE_MS], [Math.min(255, amp + SPIKE), amp]);
    else this.rich.wave([SEGMENT_MS], [amp]);
    this.level = level;
    this.sentAt = t;
    this.spike = false;
  }

  /** The ground shaking, reported once a frame: `strength` is 0 to 1, `freq` its shakes a second. */
  quake(strength: number, freq: number): void {
    if (!this.on || !this.rich) return;
    const t = this.now();
    const dt = Math.min(100, t - this.quakeAt);
    this.quakeAt = t;
    this.quakeAngle += (2 * Math.PI * freq * dt) / 1000;
    if (strength <= 0) return;
    this.quakeUntil = t + QUAKE_HOLD;
    if (t < this.busyUntil || t - this.sentAt < REFRESH_MS) return;
    const steps = Math.round(SEGMENT_MS / QUAKE_STEP_MS);
    // Each shake is felt as it swings one way and again as it swings back, so a rising sweep is felt quickening.
    const amps = Array.from({ length: steps }, (_, i) => {
      const angle = this.quakeAngle + (2 * Math.PI * freq * i * QUAKE_STEP_MS) / 1000;
      return Math.round(QUAKE_MAX * strength * (0.25 + 0.75 * Math.abs(Math.sin(angle))));
    });
    this.rich.wave(new Array<number>(steps).fill(QUAKE_STEP_MS), amps);
    this.level = -1;
    this.sentAt = t;
  }

  /** Marchers land in step; `strength` is 0 to 1. */
  footfall(strength: number): void {
    if (!this.on || !this.rich) return;
    const t = this.now();
    if (t < this.quakeUntil || !this.claim(Rank.Knock, STEP_MS, t)) return;
    this.rich.wave([STEP_MS], [Math.round(90 + 80 * strength)]);
  }

  /** An arch joint cracks open. */
  thud(): void {
    if (!this.on || !this.rich) return;
    const t = this.now();
    if (t < this.quakeUntil || !this.claim(Rank.Knock, THUD_MS, t)) return;
    this.rich.thud();
  }

  /** A drag snaps to the next point on the grid. */
  tick(): void {
    if (!this.on || !this.rich) return;
    const t = this.now();
    if (t - this.lastTick < TICK_GAP) return;
    this.lastTick = t;
    this.rich.tick();
  }

  /** Silences everything: on pause, on leaving a run, and when vibration is switched off. */
  stop(): void {
    this.rich?.stop();
    this.rank = Rank.None;
    this.busyUntil = 0;
    this.quakeUntil = 0;
    this.felt = 0;
    this.level = -1;
    this.sentAt = -Infinity;
    this.spike = false;
  }
}
