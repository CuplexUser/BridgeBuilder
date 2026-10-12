/** Geometry, outlines and constants shared by the renderer's parts. */
import type { LevelDef, Overhang } from '../levels';
import type { MaterialId } from '../physics/materials';

export const TAU = Math.PI * 2;

/** How deep a pile reaches below the mud it stands in, as drawn, m. */
export const PILE_DEPTH = 6;

export const MEMBER_WIDTH: Record<MaterialId, number> = { road: 0.3, heavy: 0.36, wood: 0.17, steel: 0.15, cable: 0.06, main: 0.14, concrete: 0.34, masonry: 0.3, arch: 0.42, track: 0.36, ram: 0.2, damper: 0.16, tendon: 0.08 };

/** Piers, and the footing under each mast's hinge: concrete columns up from the riverbed. */
export function footings(L: LevelDef): [number, number][] {
  return [...L.piers, ...(L.masts ?? []).map(([x, base]): [number, number] => [x, base])];
}

/** Deterministic 0..1 noise so scenery stays put between frames. */
export function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** World-space outline of a rock mass from the riverbed: a ragged top and sides that widen into the bed. */
export function rockPoly(x0: number, x1: number, top: number, deep: number): [number, number][] {
  return [
    [x0 - 0.6, deep],
    [x0 - 0.15, top - 2.2],
    [x0, top - 0.6],
    [x0 + 0.1, top],
    [x1 - 0.1, top],
    [x1, top - 0.6],
    [x1 + 0.15, top - 2.2],
    [x1 + 0.6, deep],
  ];
}

/** World-space outline of a mud bank in the river: a low, slumped mound spreading wide into the bed. */
export function mudPoly(x0: number, x1: number, top: number, deep: number): [number, number][] {
  return [
    [x0 - 2.5, deep],
    [x0 - 1.2, top - 1.4],
    [x0 - 0.4, top - 0.35],
    [x0 + 0.3, top],
    [x1 - 0.3, top],
    [x1 + 0.4, top - 0.35],
    [x1 + 1.2, top - 1.4],
    [x1 + 2.5, deep],
  ];
}

/** World-space outline of an overhang: a rock mass above one approach, with a ragged underside. */
export function overhangPoly(o: Overhang, W: number): [number, number][] {
  const dir = o.side === 'left' ? 1 : -1;
  const edge = o.side === 'left' ? 0 : W;
  const back = edge - dir * 80;
  const tip = edge + dir * o.reach;
  return [
    [back, o.top + 6],
    [back, o.bottom],
    [edge - dir * 1.2, o.bottom],
    [edge - dir * 0.3, o.bottom - 0.25],
    [tip - dir * 0.2, o.bottom + 0.1],
    [tip, o.bottom + 0.6],
    [tip + dir * 0.25, o.bottom + 1.8],
    [tip - dir * 0.1, o.top - 1.5],
    [tip - dir * 0.6, o.top],
    [edge - dir * 0.5, o.top + 1.2],
    [edge - dir * 2, o.top + 6],
  ];
}

/** True when p lies on segment a→b strictly between its ends. */
export function inside(p: [number, number], a: [number, number], b: [number, number]): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) < 1e-6 && t > 1e-6 && t < 1 - 1e-6;
}

/** Bézier control points for the piece p1→p2 of a smooth curve through p0, p1, p2, p3 (Catmull–Rom). */
export function curveControls(p0: Pt2, p1: Pt2, p2: Pt2, p3: Pt2): Ctl {
  return [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
}

export type Pt2 = [number, number];

export type Ctl = [number, number, number, number];

/**
 * Control points for each piece of the curved runs among the given segments, keyed by
 * segment index. A piece's neighbors are the pieces of the same run that share its ends;
 * at a run's end the curve leaves along the piece itself.
 */
export function runControls(segs: { a: number; b: number; run: number }[], at: (p: number) => Pt2): Map<number, Ctl> {
  const byEnd = new Map<string, number[]>();
  segs.forEach((g, i) => {
    for (const p of [g.a, g.b]) byEnd.set(`${g.run}:${p}`, [...(byEnd.get(`${g.run}:${p}`) ?? []), i]);
  });
  const beyond = (i: number, p: number): Pt2 => {
    const g = segs[i];
    const j = byEnd.get(`${g.run}:${p}`)!.find((k) => k !== i);
    if (j === undefined) return at(p);
    return at(segs[j].a === p ? segs[j].b : segs[j].a);
  };
  const out = new Map<number, Ctl>();
  segs.forEach((g, i) => out.set(i, curveControls(beyond(i, g.a), at(g.a), at(g.b), beyond(i, g.b))));
  return out;
}
