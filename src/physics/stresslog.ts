import type { Phase, World } from './world';

/** Seconds between samples. */
export const SAMPLE_EVERY = 0.1;
/** Keep recording this long after a run fails, so the graph shows the collapse. */
const TAIL = 1.5;

/**
 * A test drive's stress over time, for the graph after the run: every bridge member's load
 * ratio at each sample, the busiest joint, when members broke, and the drawbridge phases.
 */
export class StressLog {
  /** Sample times, s. */
  t: number[] = [];
  /** Highest load ratio at each sample, members and joints alike. */
  peak: number[] = [];
  /** What carried that peak: a design member index, -2 - node for a joint, or -1 for nothing. */
  who: number[] = [];
  /** Per sample, each member's load ratio (absolute); NaN once it has broken. */
  members: Float32Array[] = [];
  breaks: { t: number; member: number }[] = [];
  phases: { t: number; phase: Phase }[] = [];
  private broken = new Set<number>();
  private next = 0;
  private stopAt = Infinity;

  constructor(readonly memberCount: number) {}

  /** Call every physics step; it samples on its own schedule. `ended` is the time the run finished, if it has. */
  record(time: number, world: World, phase: Phase, ended: number | null): void {
    if (ended !== null) this.stopAt = Math.min(this.stopAt, ended + TAIL);
    if (time > this.stopAt || time < this.next) return;
    this.next = time + SAMPLE_EVERY - 1e-9;
    if (this.phases.at(-1)?.phase !== phase) this.phases.push({ t: time, phase });
    const row = new Float32Array(this.memberCount);
    let peak = 0;
    let who = -1;
    for (const l of world.links) {
      if (!l.bridge || l.member < 0) continue;
      if (l.broken) {
        if (!this.broken.has(l.member)) {
          this.broken.add(l.member);
          this.breaks.push({ t: time, member: l.member });
          // It broke since the last sample, so it peaked at 100% in between.
          if (peak < 1) {
            peak = 1;
            who = l.member;
          }
        }
        row[l.member] = Number.NaN;
        continue;
      }
      const s = Math.abs(l.stress);
      row[l.member] = s;
      if (s > peak) {
        peak = s;
        who = l.member;
      }
    }
    for (const p of world.jointLinks.keys()) {
      if (!world.jointLinks[p]) continue;
      const j = Math.min(1, world.jointRatio(p));
      if (j > peak) {
        peak = j;
        who = -2 - p;
      }
    }
    this.t.push(time);
    this.peak.push(peak);
    this.who.push(who);
    this.members.push(row);
  }

  get length(): number {
    return this.t.length;
  }

  /** Index of the sample nearest a time. */
  sampleAt(time: number): number {
    const { t } = this;
    if (!t.length) return -1;
    let lo = 0;
    let hi = t.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (t[mid] < time) lo = mid + 1;
      else hi = mid;
    }
    return lo > 0 && time - t[lo - 1] < t[lo] - time ? lo - 1 : lo;
  }

  /** The sample where the whole run peaked. */
  peakSample(): number {
    let best = -1;
    this.peak.forEach((v, i) => {
      if (best < 0 || v > this.peak[best]) best = i;
    });
    return best;
  }

  /** One member's load ratio over the run. */
  series(member: number): number[] {
    return this.members.map((row) => row[member]);
  }

  /** A member's highest load ratio and when it happened. */
  memberPeak(member: number): { value: number; t: number } {
    let value = 0;
    let t = 0;
    this.members.forEach((row, i) => {
      if (row[member] > value) {
        value = row[member];
        t = this.t[i];
      }
    });
    return { value, t };
  }
}
