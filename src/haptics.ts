import type { Pulse } from './platform';

/** Shortest gap between creak buzzes, ms: a groaning bridge hums rather than rattles. */
const CREAK_GAP = 160;
/** Creaks come faster as a member nears its breaking point. */
const STRAINED_GAP = 90;
/** A creak right after a snap would blur it. */
const AFTER_SNAP = 120;
/** Several members snapping in one frame are one hard pulse. */
const SNAP_GAP = 70;

/**
 * Haptics synced to stress: a light buzz as members creak, a hard pulse when one snaps, and a
 * long one when the bridge goes down. Pulses are rationed here, so the game can report every
 * creak and break as it happens.
 */
export class HapticFeel {
  enabled = true;
  private lastLight = -Infinity;
  private lastHeavy = -Infinity;

  constructor(
    private pulse: (p: Pulse) => void,
    private now: () => number = () => performance.now(),
  ) {}

  /** A member creaks under load; `stress` is its stress ratio (0.7 and up). */
  creak(stress: number): void {
    const t = this.now();
    if (!this.enabled || t - this.lastLight < (stress >= 0.95 ? STRAINED_GAP : CREAK_GAP) || t - this.lastHeavy < AFTER_SNAP) return;
    this.lastLight = t;
    this.pulse('light');
  }

  /** A member snaps, or an anchor tears out of the bank. */
  snap(): void {
    const t = this.now();
    if (!this.enabled || t - this.lastHeavy < SNAP_GAP) return;
    this.lastHeavy = t;
    this.pulse('heavy');
  }

  /** A three-star result. */
  celebrate(): void {
    if (!this.enabled) return;
    this.lastHeavy = this.now();
    this.pulse('heavy');
  }

  /** The run failed: the bridge is down. */
  collapse(): void {
    if (!this.enabled) return;
    this.lastHeavy = this.now();
    this.pulse('long');
  }
}
