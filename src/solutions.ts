import { Design, gridPath, type GridPt } from './design';
import { LEVELS, type LevelDef } from './levels';
import { MATERIALS, type MaterialId } from './physics/materials';

/** Road run from a to b, split exactly the way the editor's road tool splits it. */
export function roadRun(d: Design, a: GridPt, b: GridPt): GridPt[] {
  const path = gridPath(a[0], a[1], b[0], b[1], MATERIALS.road.maxLen, 50)!;
  for (let i = 0; i < path.length - 1; i++) d.add(path[i], path[i + 1], 'road');
  return path;
}

/** Flat road deck along y = 0. */
export function deck(d: Design, x0: number, x1: number): Design {
  roadRun(d, [x0, 0], [x1, 0]);
  return d;
}

export interface TrussMats {
  chord: MaterialId;
  web: MaterialId;
  vert: MaterialId;
  end?: MaterialId;
  /** Material for the two diagonals next to the supports, which carry the most shear. */
  endWeb?: MaterialId;
}

/** Pratt-style truss standing h meters above any deck polyline (flat or sloped). */
export function trussOver(d: Design, pts: GridPt[], h: number, m: TrussMats): Design {
  const n = pts.length - 1;
  const top = (i: number): GridPt => [pts[i][0], pts[i][1] + h];
  const mid = (pts[0][0] + pts[n][0]) / 2;
  d.add(pts[0], top(1), m.end ?? m.chord);
  d.add(top(n - 1), pts[n], m.end ?? m.chord);
  for (let i = 1; i < n; i++) d.add(pts[i], top(i), m.vert);
  for (let i = 1; i < n - 1; i++) {
    d.add(top(i), top(i + 1), m.chord);
    const mat = i === 1 || i === n - 2 ? (m.endWeb ?? m.web) : m.web;
    // Pratt diagonals lean toward mid-span; use the other diagonal if that one is too long.
    let [a, b]: GridPt[] = pts[i + 1][0] <= mid ? [top(i), pts[i + 1]] : pts[i][0] >= mid ? [top(i + 1), pts[i]] : [top(i), pts[i + 1]];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > MATERIALS[mat].maxLen) {
      [a, b] = a[0] < b[0] ? [top(i + 1), pts[i]] : [top(i), pts[i + 1]];
    }
    d.add(a, b, mat);
  }
  return d;
}

export function prattAbove(d: Design, x0: number, x1: number, h: number, m: TrussMats): Design {
  const pts: GridPt[] = [];
  for (let x = x0; x <= x1; x += 2) pts.push([x, 0]);
  return trussOver(d, pts, h, m);
}

const WOOD: TrussMats = { chord: 'wood', web: 'wood', vert: 'wood' };
const HEAVY: TrussMats = { chord: 'steel', web: 'wood', vert: 'wood', end: 'steel', endWeb: 'steel' };

/** Known-good designs, used by the physics tests to prove every level is solvable. */
export const SOLUTIONS: Record<number, (l: LevelDef) => Design> = {
  1: (l) => deck(new Design(l), 0, 4).add([0, -2], [2, 0], 'wood').add([4, -2], [2, 0], 'wood'),
  2: (l) =>
    deck(new Design(l), 0, 6).add([0, -2], [2, 0], 'wood').add([6, -2], [4, 0], 'wood').add([2, 0], [3, -1], 'wood').add([4, 0], [3, -1], 'wood'),
  3: (l) => prattAbove(deck(new Design(l), 0, 8), 0, 8, 2, WOOD),
  4: (l) => prattAbove(deck(new Design(l), 0, 10), 0, 10, 2, WOOD).add([0, -3], [2, 0], 'steel').add([10, -3], [8, 0], 'steel'),
  5: (l) => {
    const d = new Design(l);
    trussOver(d, roadRun(d, [0, 0], [10, 2]), 2, HEAVY);
    return d.add([0, -2], [2, 0], 'steel').add([10, 0], [8, 2], 'steel');
  },
  6: (l) => {
    const d = deck(new Design(l), 0, 12);
    prattAbove(d, 0, 6, 2, { ...WOOD, end: 'steel' });
    prattAbove(d, 6, 12, 2, { ...WOOD, end: 'steel' });
    return d.add([6, -3], [6, 0], 'steel');
  },
  7: (l) => prattAbove(deck(new Design(l), 0, 12), 0, 12, 2, HEAVY).add([0, -2], [2, 0], 'wood').add([12, -2], [10, 0], 'wood'),
  8: (l) => prattAbove(deck(new Design(l), 0, 14), 0, 14, 2, HEAVY).add([0, -3], [2, 0], 'steel').add([14, -3], [12, 0], 'steel'),
  9: (l) => {
    const d = new Design(l);
    trussOver(d, roadRun(d, [0, 0], [12, -1]), 2, { ...HEAVY, vert: 'steel' });
    return d.add([0, -3], [2, 0], 'steel').add([12, -3], [10, -1], 'steel');
  },
  10: (l) => {
    const d = deck(new Design(l), 0, 14);
    for (let x = 0; x < 14; x += 2) d.add([x, 3], [x + 2, 3], 'wood');
    for (let x = 2; x <= 12; x += 2) d.add([x, 0], [x, 3], x === 2 || x === 12 ? 'steel' : 'wood');
    for (let x = 0; x < 14; x += 2) {
      if (x < 7) d.add([x, 0], [x + 2, 3], 'steel');
      else d.add([x, 3], [x + 2, 0], 'steel');
    }
    return d;
  },
  11: (l) => {
    const d = deck(new Design(l), 0, 16);
    prattAbove(d, 0, 8, 2, { chord: 'steel', web: 'wood', vert: 'wood', end: 'steel' });
    prattAbove(d, 8, 16, 2, { chord: 'steel', web: 'wood', vert: 'wood', end: 'steel' });
    return d.add([8, -3], [8, 0], 'steel').add([0, -2], [2, 0], 'wood').add([16, -2], [14, 0], 'wood');
  },
  12: (l) => {
    const d = deck(new Design(l), 0, 20);
    prattAbove(d, 0, 6, 2, { ...WOOD, end: 'steel' });
    prattAbove(d, 6, 14, 2, { chord: 'steel', web: 'wood', vert: 'wood', end: 'steel' });
    prattAbove(d, 14, 20, 2, { ...WOOD, end: 'steel' });
    return d.add([6, -3], [6, 0], 'steel').add([14, -3], [14, 0], 'steel');
  },
};

export function solutionFor(id: number): Design | null {
  const level = LEVELS.find((l) => l.id === id);
  const f = SOLUTIONS[id];
  return level && f ? f(level) : null;
}
