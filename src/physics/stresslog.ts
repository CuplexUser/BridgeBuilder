import type { Phase } from './testrun';
import type { World } from './world';

/** Seconds between samples. */
export const SAMPLE_EVERY = 0.1;
/** Keep recording this long after a run fails, so the graph shows the collapse. */
const TAIL = 1.5;

/** The bridge as it stood at one sample, so the graph can show it there instead of as it ended. */
export interface Pose {
  /** Every particle's position: the bridge, the traffic and whatever else moves. */
  x: Float32Array;
  y: Float32Array;
  /** Every link's stress, and whether it had broken. */
  stress: Float32Array;
  broken: Uint8Array;
  /** The load on each bridge joint. */
  joints: Float32Array;
  openness: number;
}

/** What a pose overwrites, kept at full precision while it's shown so the world comes back exactly. */
interface Held {
  x: Float64Array;
  y: Float64Array;
  stress: Float64Array;
  broken: Uint8Array;
  joints: Float64Array;
  openness: number;
}

/**
 * A test drive's stress over time, for the graph after the run: every bridge member's load
 * ratio at each sample, the busiest joint, when members broke, and the drawbridge phases.
 */
export class StressLog {
  /** Sample times, s. */
  t: number[] = [];
  /** Highest load ratio at each sample, members and joints alike. */
  peak: number[] = [];
  /** What carried that peak: a design member index, -2 - node for a joint, or -1 for nothing or a block. */
  who: number[] = [];
  /** Per sample, each member's load ratio (absolute); NaN once it has broken. */
  members: Float32Array[] = [];
  breaks: { t: number; member: number }[] = [];
  phases: { t: number; phase: Phase }[] = [];
  /** The bridge's pose at each sample, when asked for: the game shows it on the graph, headless runs don't need it. */
  poses: Pose[] | null = null;
  private held: Held | null = null;
  private broken = new Set<number>();
  /** Block links already logged as broken: one sample at 100% marks the crack. */
  private brokenCells = new Set<object>();
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
    // Concrete blocks count toward the peak, though the graph can't ring one: it isn't a member.
    for (const l of world.links) {
      if (!l.bridge || l.cell < 0) continue;
      const s = l.broken ? (this.brokenCells.has(l) ? 0 : 1) : Math.abs(l.stress);
      if (l.broken) this.brokenCells.add(l);
      if (s > peak) {
        peak = s;
        who = -1;
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
    if (this.poses) this.poses.push(poseOf(world));
  }

  /** Runs `draw` with the world as it stood at a sample, then puts it back as it was. */
  posed(world: World, sample: number, draw: () => void): void {
    const p = this.poses?.[sample];
    if (!p) return draw();
    const { links } = world;
    const n = p.x.length;
    const nl = Math.min(links.length, p.stress.length);
    const nj = p.joints.length;
    const h = (this.held ??= { x: new Float64Array(n), y: new Float64Array(n), stress: new Float64Array(nl), broken: new Uint8Array(nl), joints: new Float64Array(nj), openness: 0 });
    h.x.set(world.x.subarray(0, n));
    h.y.set(world.y.subarray(0, n));
    h.joints.set(world.jointLoad.subarray(0, nj));
    h.openness = world.openness;
    world.x.set(p.x);
    world.y.set(p.y);
    world.jointLoad.set(p.joints);
    world.openness = p.openness;
    for (let i = 0; i < nl; i++) {
      h.stress[i] = links[i].stress;
      h.broken[i] = links[i].broken ? 1 : 0;
      links[i].stress = p.stress[i];
      links[i].broken = p.broken[i] === 1;
    }
    try {
      draw();
    } finally {
      world.x.set(h.x);
      world.y.set(h.y);
      world.jointLoad.set(h.joints);
      world.openness = h.openness;
      for (let i = 0; i < nl; i++) {
        links[i].stress = h.stress[i];
        links[i].broken = h.broken[i] === 1;
      }
    }
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

function poseOf(world: World): Pose {
  const { links } = world;
  const stress = new Float32Array(links.length);
  const broken = new Uint8Array(links.length);
  links.forEach((l, i) => {
    stress[i] = l.stress;
    broken[i] = l.broken ? 1 : 0;
  });
  return {
    x: Float32Array.from(world.x.subarray(0, world.count)),
    y: Float32Array.from(world.y.subarray(0, world.count)),
    stress,
    broken,
    joints: Float32Array.from(world.jointLoad.subarray(0, world.bridgeCount)),
    openness: world.openness,
  };
}
