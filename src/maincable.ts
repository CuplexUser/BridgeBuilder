import { q, type Design, type GridPt } from './design';
import { MATERIALS } from './physics/materials';

/** Least horizontal span of a main cable, m: a shorter one has no curve to speak of. */
export const MIN_MAIN_SPAN = 2;
/** Shallowest sag the handle allows, m. */
export const MIN_SAG = 0.2;
/** A joint lands every this many meters along x, on even meters, so hangers drop onto deck joints. */
const STATION = 2;

/** Height of a cable from a to b hanging `sag` below its chord at mid-span, at x. */
export function curveY(a: GridPt, b: GridPt, sag: number, x: number): number {
  const t = (x - a[0]) / (b[0] - a[0]);
  return a[1] + (b[1] - a[1]) * t - 4 * sag * t * (1 - t);
}

/**
 * The joints of a main cable from a to b on a parabola hanging `sag` m below the chord at
 * mid-span. They go straight above the given deck joints between the ends, so hangers drop
 * plumb onto them, with more spread evenly wherever deck joints are over 2.6 m apart; with no
 * deck below, on every even meter of x. More go between them wherever a steep stretch would
 * make a piece longer than the material allows. Null when the ends are less than
 * MIN_MAIN_SPAN apart across, or the run needs more than maxPieces pieces.
 */
export function mainPath(a: GridPt, b: GridPt, sag: number, deckXs: number[] = [], maxPieces = 60): GridPt[] | null {
  const dx = b[0] - a[0];
  if (Math.abs(dx) < MIN_MAIN_SPAN - 1e-9) return null;
  const dir = Math.sign(dx);
  // Kept a quarter meter clear of the ends so no piece is a sliver.
  const clear = (x: number) => dir * (x - a[0]) > 0.25 + 1e-9 && dir * (b[0] - x) > 0.25 + 1e-9;
  const under = [...new Set(deckXs.map(q))].filter(clear).toSorted((p, r) => dir * (p - r));
  const xs: number[] = [a[0]];
  if (under.length) {
    for (const x of [...under, b[0]]) {
      const gap = Math.abs(x - xs[xs.length - 1]);
      const n = Math.ceil(gap / 2.6 - 1e-9);
      const x0 = xs[xs.length - 1];
      for (let k = 1; k < n; k++) xs.push(x0 + ((x - x0) * k) / n);
      xs.push(x);
    }
    xs.pop();
  } else {
    const first = dir > 0 ? Math.ceil((a[0] + 0.25) / STATION) * STATION : Math.floor((a[0] - 0.25) / STATION) * STATION;
    for (let x = first; clear(x); x += dir * STATION) xs.push(x);
  }
  xs.push(b[0]);
  const at = (x: number): GridPt => [q(x), q(curveY(a, b, sag, x))];
  const maxLen = MATERIALS.main.maxLen;
  const out: GridPt[] = [at(xs[0])];
  for (let i = 1; i < xs.length; i++) {
    const [x0, x1] = [xs[i - 1], xs[i]];
    // Split a piece that is too long into equal steps along x.
    const len = Math.hypot(x1 - x0, curveY(a, b, sag, x1) - curveY(a, b, sag, x0));
    const n = Math.max(1, Math.ceil(len / (maxLen * 0.98)));
    for (let k = 1; k <= n; k++) out.push(at(x0 + ((x1 - x0) * k) / n));
  }
  out[out.length - 1] = [b[0], b[1]];
  out[0] = [a[0], a[1]];
  return out.length - 1 <= maxPieces ? out : null;
}

/** A natural sag: a tenth of the span for a level run, a slight droop for a steep backstay. */
export function defaultSag(a: GridPt, b: GridPt): number {
  const dx = Math.abs(b[0] - a[0]);
  const dy = Math.abs(b[1] - a[1]);
  const sag = dy <= 0.3 * dx ? dx / 10 : Math.hypot(dx, dy) / 25;
  return Math.max(MIN_SAG, Math.round(sag * 10) / 10);
}

/** The joints of the main cable laid as `part`, end to end, or null if it isn't one unbroken chain. */
export function runChain(d: Design, part: number): number[] | null {
  const links = d.members.filter((m) => m.part === part && MATERIALS[m.mat].curved);
  if (!links.length) return null;
  const next = new Map<number, number[]>();
  for (const m of links) {
    next.set(m.a, [...(next.get(m.a) ?? []), m.b]);
    next.set(m.b, [...(next.get(m.b) ?? []), m.a]);
  }
  const ends = [...next].filter(([, v]) => v.length === 1).map(([k]) => k);
  if (ends.length !== 2) return null;
  // From the left end, so a run reads the same however it was dragged.
  const start = d.nodes[ends[0]].x <= d.nodes[ends[1]].x ? ends[0] : ends[1];
  const chain = [start];
  for (let prev = -1, at = start; chain.length <= links.length; ) {
    const to = next.get(at)!.find((n) => n !== prev);
    if (to === undefined) break;
    chain.push(to);
    prev = at;
    at = to;
  }
  return chain.length === links.length + 1 ? chain : null;
}

/** Every main cable in the design: its part id and its joints end to end. */
export function mainRuns(d: Design): { part: number; chain: number[] }[] {
  const parts = new Set(d.members.flatMap((m) => (m.part !== undefined && MATERIALS[m.mat].curved ? [m.part] : [])));
  return [...parts].flatMap((part) => {
    const chain = runChain(d, part);
    return chain ? [{ part, chain }] : [];
  });
}

/** How far a run hangs below its chord at mid-span, read back from the joint nearest the middle. */
export function runSag(d: Design, chain: number[]): number {
  const a = d.nodes[chain[0]];
  const b = d.nodes[chain[chain.length - 1]];
  let best = 0;
  let sag = 0;
  for (const i of chain.slice(1, -1)) {
    const n = d.nodes[i];
    const t = (n.x - a.x) / (b.x - a.x);
    const w = 4 * t * (1 - t);
    if (w > best) {
      best = w;
      sag = (a.y + (b.y - a.y) * t - n.y) / w;
    }
  }
  return sag;
}

/**
 * Where a run's sag handle sits: on the curve near the middle, at the odd meter between two
 * joints, so it doesn't cover the joint a hanger starts from.
 */
export function sagHandle(d: Design, chain: number[]): GridPt {
  const a = d.nodes[chain[0]];
  const b = d.nodes[chain[chain.length - 1]];
  const mid = (a.x + b.x) / 2;
  let x = Math.floor(mid / 2) * 2 + 1;
  if (x <= Math.min(a.x, b.x) || x >= Math.max(a.x, b.x)) x = mid;
  return [x, curveY([a.x, a.y], [b.x, b.y], runSag(d, chain), x)];
}

/** Hangs a run's joints at a new sag, keeping each one's x, so whatever hangs from them stays attached. */
export function resag(d: Design, chain: number[], sag: number): void {
  const a = d.nodes[chain[0]];
  const b = d.nodes[chain[chain.length - 1]];
  const A: GridPt = [a.x, a.y];
  const B: GridPt = [b.x, b.y];
  for (const i of chain.slice(1, -1)) d.nodes[i].y = q(curveY(A, B, sag, d.nodes[i].x));
}

/** Where the deck has joints, along x: a main cable puts its own joints above them. */
export function deckStations(d: Design): number[] {
  const xs = new Set<number>();
  for (const m of d.members) {
    if (!MATERIALS[m.mat].drivable) continue;
    xs.add(d.nodes[m.a].x);
    xs.add(d.nodes[m.b].x);
  }
  return [...xs];
}

/** Main cable joints closer than this to a joint already built are moved off it. */
const CLEAR_OF_JOINTS = 0.5;

/**
 * A main cable's joints in a design: above the deck's joints, except where one would land on
 * a joint already built, such as the top of a tower leg; that one moves aside along the cable.
 */
export function mainPathIn(d: Design, a: GridPt, b: GridPt, sag: number): GridPt[] | null {
  let xs = deckStations(d);
  const crowded = (pts: GridPt[]) => pts.slice(1, -1).filter(([x, y]) => d.nodes.some((n) => Math.hypot(n.x - x, n.y - y) < CLEAR_OF_JOINTS));
  let pts = mainPath(a, b, sag, xs);
  for (let tries = 0; pts && tries < 6; tries++) {
    const bad = crowded(pts);
    if (!bad.length) return pts;
    // Each crowded joint's station steps half a meter aside, then the other way, then further.
    const step = [0.5, -0.5, 1, -1, 1.5, -1.5][tries];
    const moved = new Set(bad.map(([x]) => x));
    const shifted = xs.map((x) => (moved.has(x) ? x + step - (tries ? [0.5, -0.5, 1, -1, 1.5][tries - 1] : 0) : x));
    // Joints from the even spread between deck stations move by adding a station beside them.
    const extra = bad.filter(([x]) => !xs.includes(x)).map(([x]) => x + step);
    xs = [...shifted, ...extra];
    pts = mainPath(a, b, sag, xs);
  }
  return pts;
}

/** Lays a main cable from a to b in the design as one part, at the given sag or a natural one, its joints above the deck's. */
export function layMain(d: Design, a: GridPt, b: GridPt, sag = defaultSag(a, b)): GridPt[] {
  const pts = mainPathIn(d, a, b, sag);
  if (!pts) throw new Error(`No main cable from ${a} to ${b}`);
  const part = d.newPart();
  for (let i = 0; i < pts.length - 1; i++) {
    const ia = d.ensureNode(pts[i][0], pts[i][1]);
    const ib = d.ensureNode(pts[i + 1][0], pts[i + 1][1]);
    d.members.push({ a: ia, b: ib, mat: 'main', part });
  }
  return pts;
}
