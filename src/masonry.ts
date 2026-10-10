import { q, type Design, type DCell, type GridPt } from './design';
import type { LevelDef } from './levels';
import { curveY, mainPathIn } from './maincable';
import { MATERIALS, type MaterialId } from './physics/materials';
import { crossesChannel, MIN_JOINT_GAP, pointAllowed, topY } from './rules';

/** How thick an arch ring is, m: its top (the extrados) runs this far above its underside (the intrados). */
export const RING = 1;

/** The corners of a cell, counterclockwise. */
export function cellPoly(d: Design, c: DCell): GridPt[] {
  return c.n.map((i): GridPt => [d.nodes[i].x, d.nodes[i].y]);
}

/** Area of a polygon, m² (positive when counterclockwise). */
export function polyArea(p: GridPt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % p.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** Whether point p lies strictly inside convex polygon poly (counterclockwise), clear of its edges. */
function insideConvex(poly: GridPt[], p: GridPt, e = 1e-6): boolean {
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    if ((bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax) <= e * Math.hypot(bx - ax, by - ay)) return false;
  }
  return true;
}

/** Whether segment ab passes through the inside of convex polygon poly. Touching an edge or a corner doesn't count. */
export function segmentHitsPoly(a: GridPt, b: GridPt, poly: GridPt[]): boolean {
  // Liang–Barsky against each edge's half-plane, slightly shrunk.
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  for (let i = 0; i < poly.length; i++) {
    const [px, py] = poly[i];
    const [qx, qy] = poly[(i + 1) % poly.length];
    const ex = qx - px;
    const ey = qy - py;
    const len = Math.hypot(ex, ey) || 1;
    // Inside is to the left: cross(e, p - edge start) > 0.
    const num = (ex * (a[1] - py) - ey * (a[0] - px)) / len - 1e-6;
    const den = (ex * dy - ey * dx) / len;
    if (Math.abs(den) < 1e-12) {
      if (num < 0) return false;
      continue;
    }
    const t = -num / den;
    if (den > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return false;
  }
  return t1 - t0 > 1e-6;
}

/** Whether two convex polygons overlap with some area, not just along an edge or at a corner. */
export function polysOverlap(p: GridPt[], r: GridPt[]): boolean {
  // Separating axes: every edge normal of both.
  for (const poly of [p, r]) {
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % poly.length];
      const nx = by - ay;
      const ny = ax - bx;
      const len = Math.hypot(nx, ny) || 1;
      const span = (s: GridPt[]) => s.map(([x, y]) => (x * nx + y * ny) / len);
      const sp = span(p);
      const sr = span(r);
      if (Math.min(...sp) >= Math.max(...sr) - 1e-6 || Math.min(...sr) >= Math.max(...sp) - 1e-6) return false;
    }
  }
  return true;
}

/** The 1 m block whose lower left corner is (x, y). */
export function blockPoly(x: number, y: number): GridPt[] {
  return [
    [x, y],
    [x + 1, y],
    [x + 1, y + 1],
    [x, y + 1],
  ];
}

/** Whether (x, y) is solid rock: inside a bank, a pier, or under an overhang's top. */
export function inRock(level: LevelDef, x: number, y: number, e = 1e-6): boolean {
  const W = level.width;
  if (x < -e && y < -e) return true;
  if (x > W + e && y < (level.rightY ?? 0) - e) return true;
  for (const [px, py] of level.piers) if (Math.abs(x - px) < 0.45 - e && y < py - e) return true;
  for (const [mx, base] of level.masts ?? []) if (Math.abs(x - mx) < 0.45 - e && y < base - e) return true;
  for (const [x0, x1, top] of level.rocks ?? []) if (x > x0 + e && x < x1 - e && y < top - e) return true;
  return false;
}

/** Whether a cell's polygon would be in the way of the level: in rock, under water, above the top, or in a channel. */
function polyProblem(level: LevelDef, poly: GridPt[]): string {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  if (Math.max(...ys) > topY(level) + 1e-9) return 'Out of bounds';
  if (Math.min(...ys) < level.waterY + 0.5 - 1e-9) return 'Out of bounds';
  // Sample the inside: the middle and points near each corner.
  const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
  const probes: GridPt[] = [[cx, cy], ...poly.map(([x, y]): GridPt => [x + (cx - x) * 0.1, y + (cy - y) * 0.1])];
  if (probes.some(([x, y]) => inRock(level, x, y))) return 'Into the rock';
  for (let i = 0; i < poly.length; i++) {
    const [a, b] = [poly[i], poly[(i + 1) % poly.length]];
    if (crossesChannel(level, a[0], a[1], b[0], b[1])) return 'Keep the channel clear';
  }
  // Rock edges crossing the inside: a bank corner poking into it.
  const W = level.width;
  const rocks: [GridPt, GridPt][] = [
    [[-80, 0], [0, 0]],
    [[0, 0], [0, level.waterY - 30]],
    [[W, level.rightY ?? 0], [W + 80, level.rightY ?? 0]],
    [[W, level.rightY ?? 0], [W, level.waterY - 30]],
  ];
  for (const [px, py] of level.piers) rocks.push([[px - 0.45, py], [px + 0.45, py]], [[px - 0.45, py], [px - 0.45, level.waterY]], [[px + 0.45, py], [px + 0.45, level.waterY]]);
  for (const [x0, x1, top] of level.rocks ?? []) rocks.push([[x0, top], [x1, top]], [[x0, top], [x0, level.waterY - 30]], [[x1, top], [x1, level.waterY - 30]]);
  if (rocks.some(([a, b]) => segmentHitsPoly(a, b, poly))) return 'Into the rock';
  for (const [x0, x1, top] of level.channels ?? []) if (polysOverlap(poly, [[x0, level.waterY - 10], [x1, level.waterY - 10], [x1, top], [x0, top]])) return 'Keep the channel clear';
  return '';
}

/**
 * What stops a cell with these corners going into the design, or '': out of the level's
 * bounds, overlapping another cell, a member running through it, or a new corner crowding a joint.
 */
export function cellProblem(level: LevelDef, d: Design, poly: GridPt[], ignore: Set<number> = new Set()): string {
  const where = polyProblem(level, poly);
  if (where) return where;
  for (const [k, c] of d.cells.entries()) {
    if (!ignore.has(k) && polysOverlap(poly, cellPoly(d, c))) return 'Overlaps a block';
  }
  for (const m of d.members) {
    const a = d.nodes[m.a];
    const b = d.nodes[m.b];
    if (segmentHitsPoly([a.x, a.y], [b.x, b.y], poly)) return MATERIALS[m.mat].drivable ? 'On the road' : 'A beam runs through it';
  }
  for (const [x, y] of poly) {
    if (d.findNode(x, y) >= 0) continue;
    if (d.nodes.some((n) => Math.hypot(n.x - x, n.y - y) < MIN_JOINT_GAP)) return 'Too close to a joint';
  }
  return '';
}

/** The block cell at (x, y), the one whose lower left corner it is, or -1. */
export function blockAt(d: Design, x: number, y: number): number {
  return d.cells.findIndex((c) => c.mat === 'masonry' && d.nodes[c.n[0]].x === x && d.nodes[c.n[0]].y === y);
}

/** The cell under a point, or -1. */
export function cellUnder(d: Design, x: number, y: number): number {
  return d.cells.findIndex((c) => insideConvex(cellPoly(d, c), [x, y], -1e-9));
}

/** Adds a 1 m block with its lower left corner at (x, y). Returns its index. */
export function addBlock(d: Design, x: number, y: number, part = d.newPart()): number {
  const n = blockPoly(x, y).map(([px, py]) => d.ensureNode(px, py));
  d.cells.push({ n, mat: 'masonry', part });
  return d.cells.length - 1;
}

/** An arch ring's joints: along its underside from a to b, and along its top above each joint between. */
export interface RingPath {
  intra: GridPt[];
  extra: GridPt[];
}

/**
 * The ring of an arch from springing a to springing b, rising `rise` m above the chord at
 * mid-span: wedge blocks with a joint above each deck joint, as thick as RING, narrowing to the
 * springing at each end. Null when the ends are too close or too steep for a ring.
 */
export function ringPath(d: Design, a: GridPt, b: GridPt, rise: number): RingPath | null {
  const [p, r] = a[0] <= b[0] ? [a, b] : [b, a];
  if (r[0] - p[0] < 2 - 1e-9) return null;
  const intra = mainPathIn(d, p, r, -Math.abs(rise));
  if (!intra || intra.length < 3) return null;
  const extra = intra.slice(1, -1).map(([x, y]): GridPt => [x, q(y + RING)]);
  return { intra, extra };
}

/**
 * A natural rise for a ring from a to b: a quarter of its span, but low enough that its crown
 * stays half a meter under a deck already built over its middle.
 */
export function ringRise(d: Design, a: GridPt, b: GridPt): number {
  const span = Math.abs(b[0] - a[0]);
  const mid = (a[0] + b[0]) / 2;
  const chord = (a[1] + b[1]) / 2;
  let rise = span / 4;
  const deck = new Set(d.members.flatMap((m) => (MATERIALS[m.mat].drivable ? [m.a, m.b] : [])));
  let over = Infinity;
  for (const i of deck) {
    const n = d.nodes[i];
    if (Math.abs(n.x - mid) <= span / 4 && n.y > chord) over = Math.min(over, n.y);
  }
  if (over < Infinity) rise = Math.min(rise, over - chord - RING - 0.5);
  return Math.max(0.5, Math.round(rise * 10) / 10);
}

/** The cells of a ring, as polygons: a wedge at each end, four-sided blocks between. */
export function ringPolys(path: RingPath): GridPt[][] {
  const { intra, extra } = path;
  const k = intra.length - 1;
  if (k < 2) return [];
  const out: GridPt[][] = [];
  for (let i = 0; i < k; i++) {
    if (i === 0) out.push([intra[0], intra[1], extra[0]]);
    else if (i === k - 1) out.push([intra[k - 1], intra[k], extra[k - 2]]);
    else out.push([intra[i], intra[i + 1], extra[i], extra[i - 1]]);
  }
  return out;
}

/** What stops a ring going into the design along this path, or ''. */
export function ringProblem(level: LevelDef, d: Design, path: RingPath): string {
  for (const [x, y] of [...path.intra.slice(1, -1), ...path.extra]) {
    if (d.findNode(x, y) >= 0) continue;
    if (!pointAllowed(level, x, y)) return 'Out of bounds';
  }
  for (const poly of ringPolys(path)) {
    const why = cellProblem(level, d, poly);
    if (why) return why;
  }
  return '';
}

/** Lays an arch ring in the design as one part. Returns its cells' indices. */
export function layRing(d: Design, path: RingPath): number[] {
  const part = d.newPart();
  return ringPolys(path).map((poly) => {
    d.cells.push({ n: poly.map(([x, y]) => d.ensureNode(x, y)), mat: 'arch', part });
    return d.cells.length - 1;
  });
}

/** Every arch ring in the design: its part, and the joints along its underside and top, left to right. */
export function rings(d: Design): { part: number; intra: number[]; extra: number[] }[] {
  const parts = new Map<number, DCell[]>();
  for (const c of d.cells) if (c.mat === 'arch' && c.part !== undefined) parts.set(c.part, [...(parts.get(c.part) ?? []), c]);
  const mid = (c: DCell) => c.n.reduce((s, i) => s + d.nodes[i].x, 0) / c.n.length;
  return [...parts].map(([part, cells]) => {
    const sorted = cells.toSorted((u, v) => mid(u) - mid(v));
    const intra = [sorted[0].n[0], ...sorted.map((c) => c.n[1])];
    const extra = sorted.slice(0, -1).map((c) => c.n[2]);
    return { part, intra, extra };
  });
}

/** Moves a ring's top joints back to RING above its underside joints, after a change of rise. */
export function settleRing(d: Design, intra: number[], extra: number[]): void {
  extra.forEach((e, i) => (d.nodes[e].y = q(d.nodes[intra[i + 1]].y + RING)));
}

/** How high a ring's underside rises above its chord at x, given the rise at mid-span. */
export function ringY(a: GridPt, b: GridPt, rise: number, x: number): number {
  return curveY(a, b, -rise, x);
}

/** Every cell material, by which tool lays it. */
export function isCell(mat: MaterialId): boolean {
  return !!MATERIALS[mat].cell;
}

/** Whether the segment ab runs through any cell of the design. */
export function hitsCells(d: Design, a: GridPt, b: GridPt): boolean {
  return d.cells.some((c) => segmentHitsPoly(a, b, cellPoly(d, c)));
}
