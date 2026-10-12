/** A swing bridge turning on its pier, seen in perspective: the projection every part draws it with. */
import type { LevelDef } from '../levels';
import type { TestRun } from '../physics/world';

/** How wide a swing bridge's road shows between its two side trusses as it turns end-on, m. */
export const SWING_ROAD = 2.8;

/** How far below the road a turning swing bridge is seen from, m: enough to see under its road. */
const SWING_EYE = 2;

/** Depth slices a turning swing bridge is painted in, far to near. */
export const SWING_SLICES = 8;

/**
 * A swing bridge turning on its pier, as the eye sees it: from a little below its road, and
 * from three and a half times its reach away, so the end swinging toward the eye grows and the
 * other shrinks.
 */
export interface Turn {
  pivot: number;
  /** How far it has turned, rad: 0 shut, π/2 end-on. */
  angle: number;
  eye: number;
  dist: number;
  /** Half the road's width as it shows: none while shut, all of it end-on. */
  half: number;
  /** The joints where the physics has them, before turning. */
  xs: Float64Array;
  ys: Float64Array;
}

export function turnOf(L: LevelDef, run: TestRun | null): Turn | null {
  const w = run?.world;
  if (!L.swing || !w || w.openness <= 0) return null;
  const pivot = L.swing.pivot;
  const xs = w.x.slice(0, w.bridgeCount);
  let reach = 4;
  for (const x of xs) reach = Math.max(reach, Math.abs(x - pivot));
  const angle = (w.openness * Math.PI) / 2;
  return { pivot, angle, eye: -SWING_EYE, dist: 3.5 * reach, half: (SWING_ROAD / 2) * Math.sin(angle), xs, ys: w.y.slice(0, w.bridgeCount) };
}

/**
 * Where a point of a turning swing bridge shows, on the plane of the shut bridge, and how far
 * it has come toward the eye: on the near truss for side 1, the far one for side -1.
 */
export function turnPoint(t: Turn, x: number, y: number, side: number): [number, number, number] {
  const d = x - t.pivot;
  const l = side * t.half;
  const c = Math.cos(t.angle);
  const s = Math.sin(t.angle);
  const z = d * s + l * c;
  const k = t.dist / (t.dist - z);
  return [t.pivot + (d * c - l * s) * k, t.eye + (y - t.eye) * k, z];
}
