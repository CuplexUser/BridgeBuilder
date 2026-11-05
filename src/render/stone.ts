/**
 * How blocks and arch wedges are dressed: a patch over each cell's corners that its details are
 * laid out on, and what about each cell stays the same as it moves (where a wedge is cut into
 * stones, and which wedges are its neighbors along the ring). The painted scene and the
 * blueprint both use it.
 */
import { CHAPTERS } from '../chapters';
import type { Design } from '../design';
import { LEVELS } from '../levels';
import type { Pt2 } from './shapes';

/**
 * A cell's corners as a four-sided patch, ordered underside left, underside right, top right,
 * top left, so a point in it is (u along the underside, v up through the stone). A ring's end
 * wedge is a triangle: its springing stands in for both corners at that end.
 */
export type CellShape = 'quad' | 'first' | 'last';

export type Quad = [Pt2, Pt2, Pt2, Pt2];

export function quadOf(pts: Pt2[], shape: CellShape): Quad {
  if (shape === 'first') return [pts[0], pts[1], pts[2], pts[0]];
  if (shape === 'last') return [pts[0], pts[1], pts[1], pts[2]];
  return [pts[0], pts[1], pts[2], pts[3]];
}

/** The point at (u, v) in a four-sided patch; v past 0 or 1 reaches out beyond its sides. */
export function bilerp(q: Quad, u: number, v: number): Pt2 {
  const bx = q[0][0] + (q[1][0] - q[0][0]) * u;
  const by = q[0][1] + (q[1][1] - q[0][1]) * u;
  const tx = q[3][0] + (q[2][0] - q[3][0]) * u;
  const ty = q[3][1] + (q[2][1] - q[3][1]) * u;
  return [bx + (tx - bx) * v, by + (ty - by) * v];
}

/** How long the stones a wedge is cut into are, m, about. */
const STONE_LENGTH = 0.6;

/**
 * What doesn't change about a cell as it moves: its shape, where a wedge is cut into stones (as
 * u along its underside), and the wedges before and after it along its ring, or -1.
 */
export interface CellLook {
  shape: CellShape;
  cuts: number[];
  prev: number;
  next: number;
}

/** Each cell's look, from the design as built; null for a cell that isn't a block or a wedge. */
export function cellLooks(d: Design): (CellLook | null)[] {
  const { nodes, cells } = d;
  // Each ring's wedges, left to right.
  const mid = (k: number) => cells[k].n.reduce((s, i) => s + nodes[i].x, 0) / cells[k].n.length;
  const rings = new Map<number, number[]>();
  cells.forEach((c, k) => {
    if (c.mat === 'arch' && c.part !== undefined) rings.set(c.part, [...(rings.get(c.part) ?? []), k]);
  });
  const prev = new Map<number, number>();
  const next = new Map<number, number>();
  for (const ks of rings.values()) {
    const order = ks.toSorted((a, b) => mid(a) - mid(b));
    order.forEach((k, i) => {
      prev.set(k, order[i - 1] ?? -1);
      next.set(k, order[i + 1] ?? -1);
    });
  }
  return cells.map((c, k): CellLook | null => {
    if (c.mat !== 'arch') return c.n.length === 4 ? { shape: 'quad', cuts: [], prev: -1, next: -1 } : null;
    const p = c.n.map((i) => nodes[i]);
    const shape: CellShape = p.length === 4 ? 'quad' : Math.abs(p[2].x - p[1].x) < 1e-6 ? 'first' : 'last';
    const n = Math.max(1, Math.round(Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) / STONE_LENGTH));
    const cuts = Array.from({ length: n - 1 }, (_, i) => (i + 1) / n);
    return { shape, cuts, prev: prev.get(k) ?? -1, next: next.get(k) ?? -1 };
  });
}

/**
 * What a level's arch rings are built of, to look at: stone in the chapter that brings in arches,
 * where they are the old craft, and steel in the chapters after it. Levels in no chapter, made in
 * the workshop or shared, build in stone, as the blueprint draws every ring.
 */
export function archStyle(levelId: number): 'stone' | 'steel' {
  firstArch ??= CHAPTERS.findIndex((ch) => ch.levels.some((id) => LEVELS.find((l) => l.id === id)?.materials.includes('arch')));
  const at = CHAPTERS.findIndex((ch) => ch.levels.includes(levelId));
  return firstArch >= 0 && at > firstArch ? 'steel' : 'stone';
}

/** Where in the chapters arch rings first come in. */
let firstArch: number | undefined;
