import { Design, q, roadPath, type GridPt } from './design';
import { LEVELS, type LevelDef } from './levels';
import { MATERIALS, type MaterialId } from './physics/materials';

/** Road run from a to b, split exactly the way the editor's road tool splits it. */
export function roadRun(d: Design, a: GridPt, b: GridPt, mat: MaterialId = 'road'): GridPt[] {
  const path = roadPath(a[0], a[1], b[0], b[1], MATERIALS[mat].maxLen, 50)!;
  for (let i = 0; i < path.length - 1; i++) d.add(path[i], path[i + 1], mat);
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
const STEELY: TrussMats = { chord: 'steel', web: 'steel', vert: 'steel', end: 'steel', endWeb: 'steel' };
/** All steel except the wood diagonals beside the supports: stiff, for a low peak stress. */
const STIFF: TrussMats = { ...STEELY, endWeb: 'wood' };

/** Known-good designs, used by the physics tests to prove every level is solvable. */
export const SOLUTIONS: Record<number, (l: LevelDef) => Design> = {
  1: (l) => deck(new Design(l), 0, 4).add([0, -2], [2, 0], 'wood').add([4, -2], [2, 0], 'wood'),
  2: (l) =>
    deck(new Design(l), 0, 6).add([0, -2], [2, 0], 'wood').add([6, -2], [4, 0], 'wood').add([2, 0], [3, -1], 'wood').add([4, 0], [3, -1], 'wood'),
  3: (l) => prattAbove(deck(new Design(l), 0, 8), 0, 8, 2, WOOD),
  4: (l) => prattAbove(deck(new Design(l), 0, 10), 0, 10, 2, WOOD).add([0, -3], [2, 0], 'steel').add([10, -3], [8, 0], 'steel'),
  5: (l) => {
    const a: GridPt = [0, 0];
    const b: GridPt = [10, 2];
    const d = new Design(l);
    trussOver(d, roadRun(d, a, b), 2, WOOD);
    return d.add([0, -2], on(a, b, 2), 'steel').add([10, 0], on(a, b, 8), 'steel');
  },
  6: (l) => {
    const d = deck(new Design(l), 0, 12);
    prattAbove(d, 0, 6, 2, { ...WOOD, end: 'steel' });
    prattAbove(d, 6, 12, 2, { ...WOOD, end: 'steel' });
    return d.add([6, -3], [6, 0], 'steel');
  },
  // The truck is within road's rating, and the truss alone carries it.
  7: (l) => prattAbove(deck(new Design(l), 0, 12), 0, 12, 2, HEAVY),
  8: (l) => prattAbove(deck(new Design(l), 0, 14), 0, 14, 2, HEAVY),
  9: (l) => {
    const a: GridPt = [0, 0];
    const b: GridPt = [12, -1];
    const d = new Design(l);
    trussOver(d, roadRun(d, a, b), 2, { ...HEAVY, vert: 'steel' });
    return d.add([0, -3], on(a, b, 2), 'steel').add([12, -3], on(a, b, 10), 'steel');
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
  13: (l) => {
    const d = deck(new Design(l), 0, 14);
    hang(d, [0, 6], [[4, 0], [6, 0]]);
    hang(d, [14, 6], [[8, 0], [10, 0]]);
    return d.add([0, -2], [2, 0], 'wood').add([14, -2], [12, 0], 'wood');
  },
  14: (l) => {
    const d = deck(new Design(l), 0, 18);
    hang(d, [9, 7], [[4, 0], [8, 0], [10, 0], [14, 0]]);
    d.add([0, -2], [2, 0], 'wood').add([18, -2], [16, 0], 'wood');
    // King-post trusses under the two joints the cables can't spare.
    return kingPost(kingPost(d, 4, 8, -1, 'wood'), 10, 14, -1, 'wood');
  },
  15: (l) => {
    const d = deck(new Design(l), 0, 16);
    hang(d, [1, 9], [[2, 0], [4, 0]]);
    hang(d, [15, 9], [[12, 0], [14, 0]]);
    // Out of reach: a joint in mid-air, held from both cliffs.
    d.add([1, 9], [8, 5], 'cable').add([15, 9], [8, 5], 'cable');
    return hang(d, [8, 5], [[6, 0], [8, 0], [10, 0]]);
  },
  16: (l) => {
    const d = deck(new Design(l), 0, 16);
    // Three 4 m steel top chords, each split at its middle to take a vertical.
    const first = d.members.length;
    for (const x of [2, 6, 10]) d.add([x, 2], [x + 4, 2], 'steel');
    for (let i = 0; i < 3; i++) d.splitMember(first + i, 4 + 4 * i, 2);
    d.add([0, 0], [2, 2], 'steel').add([16, 0], [14, 2], 'steel');
    for (let x = 2; x <= 14; x += 2) d.add([x, 0], [x, 2], 'wood');
    for (let x = 2; x < 8; x += 2) d.add([x, 2], [x + 2, 0], x === 2 ? 'steel' : 'wood');
    for (let x = 10; x <= 14; x += 2) d.add([x, 2], [x - 2, 0], x === 14 ? 'steel' : 'wood');
    return d;
  },
  17: (l) => {
    const d = new Design(l);
    roadRun(d, [0, 0], [20, 0], 'heavy');
    trussOver(d, panels(0), 2, HEAVY);
    trussOver(d, panels(10), 2, HEAVY);
    return d.add([10, -4], [10, 0], 'steel');
  },
  18: (l) => {
    const a: GridPt = [0, 0];
    const b: GridPt = [24, -3];
    const p = (x: number) => on(a, b, x);
    const d = new Design(l);
    roadRun(d, a, b);
    // Left half hangs from the tall pylon; the right half stands on the short one.
    hang(d, [8, 7], [4, 6, 8, 10, 12].map(p));
    d.add([0, -3], p(2), 'steel').add([24, -6], p(22), 'steel');
    for (const x of [14, 16, 18]) d.add([16, -5], p(x), 'steel');
    return d.add(p(18), [20, -4], 'wood').add(p(22), [20, -4], 'wood').add([20, -4], p(20), 'wood');
  },
  19: (l) => {
    const d = new Design(l);
    roadRun(d, [0, 0], [28, 0], 'heavy');
    suspend(d, [[6, 12], [10, 7], [14, 5], [18, 7], [22, 12]]);
    hang(d, [10, 7], [[8, 0], [10, 0]]);
    hang(d, [14, 5], [[12, 0], [14, 0], [16, 0]]);
    hang(d, [18, 7], [[18, 0], [20, 0]]);
    // Side spans: a strut from the low bolt, then a king post up to the tower.
    d.add([0, -3], [2, 0], 'steel').add([28, -3], [26, 0], 'steel');
    return kingPost(kingPost(d, 2, 6, -2, 'wood', 'steel'), 22, 26, -2, 'wood', 'steel');
  },
  // Main span over the pier, plus a steel post onto the pier.
  20: (l) => longWay(l).add([16, -4], [16, 0], 'steel'),
  21: (l) => deck(new Design(l), 0, 8).add([4, -2], [2, 0], 'wood').add([4, -2], [6, 0], 'wood').add([4, -2], [4, 0], 'wood'),
  22: (l) => {
    const d = deck(new Design(l), 0, 18);
    for (const x of [6, 12]) d.add([x, -2], [x - 2, 0], 'wood').add([x, -2], [x, 0], 'steel').add([x, -2], [x + 2, 0], 'wood');
    return d.add([0, -2], [2, 0], 'wood').add([18, -2], [16, 0], 'wood');
  },
  23: (l) => prattAbove(deck(new Design(l), 0, 14), 0, 14, 2, HEAVY),
  24: (l) => {
    const d = new Design(l);
    // Up over the channel, across, and back down.
    const up = roadRun(d, [0, 0], [8, 2]);
    roadRun(d, [8, 2], [16, 2]);
    const down = roadRun(d, [16, 2], [24, 0]);
    hang(d, [7, 10], [up[2], up[3], [8, 2], [10, 2], [12, 2]]);
    hang(d, [17, 10], [[12, 2], [14, 2], [16, 2], down[1], down[2]]);
    // The first and last ramp joints are out of cable reach: strut them from the banks.
    return d.add([0, -2], up[1], 'steel').add([24, -2], down[3], 'steel');
  },
  25: (l) => {
    const d = new Design(l);
    const pts = roadRun(d, [0, 0], [20, 4]);
    trussOver(d, pts.slice(0, 6), 2, { ...HEAVY, endWeb: 'wood' });
    trussOver(d, pts.slice(5), 2, { ...HEAVY, endWeb: 'wood' });
    return d.add([10, -2], pts[5], 'steel');
  },
  26: (l) => {
    const d = deck(new Design(l), 0, 22);
    hang(d, [1, 8], [[2, 0], [4, 0], [6, 0]]);
    hang(d, [16, 8], [[12, 0], [14, 0], [16, 0], [18, 0], [20, 0]]);
    // The middle is out of reach of both: meet in mid-air.
    d.add([1, 8], [9, 5], 'cable').add([16, 8], [9, 5], 'cable');
    return hang(d, [9, 5], [[8, 0], [10, 0]]);
  },
  // Road is enough for the bus.
  27: (l) => gauntlet(l, { ...HEAVY, endWeb: 'wood' }),
  28: (l) => {
    const d = new Design(l);
    roadRun(d, [0, 0], [24, 0], 'heavy');
    trussOver(d, span(0, 12), 2, HEAVY);
    trussOver(d, span(12, 24), 2, HEAVY);
    return d.add([12, -4], [12, 0], 'steel').add([0, -3], [2, 0], 'steel').add([24, -3], [22, 0], 'steel');
  },
  29: (l) => skyRoad(l, WOOD).add([0, -3], [2, 0], 'steel').add([34, -3], [32, 0], 'steel'),
  30: (l) => {
    const d = new Design(l);
    // Three runs so every span's joints land on even meters.
    for (const [x0, x1] of [[0, 8], [8, 28], [28, 36]]) roadRun(d, [x0, 0], [x1, 0], 'heavy');
    // A deep sag keeps the main cable's pull down, so it holds the semi.
    mainCable(d, alongX(8, [14, 10, 8, 6, 4, 4, 4, 6, 8, 10, 14]));
    trussOver(d, span(0, 8), 2, STIFF);
    return trussOver(d, span(28, 36), 2, STIFF);
  },
};

/** Level 27: a road deck on a braced trestle up from each deep pier, with a truss over each span. */
function gauntlet(l: LevelDef, m: TrussMats): Design {
  const d = deck(new Design(l), 0, 26);
  for (const px of [9, 17]) {
    const [a, b] = [px - 1, px + 1];
    d.add([px, -6], [a, -3], 'steel').add([px, -6], [b, -3], 'steel').add([a, -3], [b, -3], 'wood');
    d.add([a, -3], [a, 0], 'steel').add([b, -3], [b, 0], 'steel').add([a, -3], [b, 0], 'steel');
  }
  trussOver(d, span(0, 8), 2, m);
  trussOver(d, span(10, 16), 2, m);
  return trussOver(d, span(18, 26), 2, m);
}

/** Level 29: the middle hangs from a main cable between the pylons, and each side span is a truss. */
function skyRoad(l: LevelDef, sides: TrussMats): Design {
  const d = new Design(l);
  roadRun(d, [0, 0], [34, 0], 'heavy');
  mainCable(d, alongX(8, [12, 9, 6, 5, 4, 4, 5, 6, 9, 12]));
  trussOver(d, span(0, 8), 2, sides);
  return trussOver(d, span(26, 34), 2, sides);
}

/** Level 20's cable work: a sagging main span and a backstay span on each side. */
function longWay(l: LevelDef): Design {
  const d = new Design(l);
  roadRun(d, [0, 0], [32, 0], 'heavy');
  mainCable(d, alongX(8, [11, 7, 5, 4, 4, 4, 5, 7, 11]), 16);
  mainCable(d, alongX(0, [4, 3, 4, 6, 11]));
  mainCable(d, alongX(32, [4, 3, 4, 6, 11], -2));
  // The joints under the pylons hang from both neighbours.
  d.add([6, 6], [8, 0], 'cable').add([10, 7], [8, 0], 'cable');
  return d.add([26, 6], [24, 0], 'cable').add([22, 7], [24, 0], 'cable');
}

/** Points from x0 every `step` meters, at the given heights. */
function alongX(x0: number, ys: number[], step = 2): GridPt[] {
  return ys.map((y, i): GridPt => [x0 + step * i, y]);
}

/** A main cable through pts, with a vertical hanger from each inner point down to the deck, except at x = skip. */
function mainCable(d: Design, pts: GridPt[], skip = -1): Design {
  suspend(d, pts);
  for (const [x, y] of pts.slice(1, -1)) if (x !== skip) d.add([x, y], [x, 0], 'cable');
  return d;
}

/** The design with every member of one material rebuilt in another. */
function recast(d: Design, from: MaterialId, to: MaterialId): Design {
  for (const m of d.members) if (m.mat === from) m.mat = to;
  return d;
}

/**
 * Designs that meet each level's bonus goal, where the reference design doesn't. The physics
 * tests drive these across too, so every bonus star is known to be reachable.
 */
export const BONUS_SOLUTIONS: Record<number, (l: LevelDef) => Design> = {
  4: (l) => prattAbove(deck(new Design(l), 0, 10), 0, 10, 2, HEAVY).add([0, -3], [2, 0], 'steel').add([10, -3], [8, 0], 'steel'),
  5: (l) => {
    const a: GridPt = [0, 0];
    const b: GridPt = [10, 2];
    const d = new Design(l);
    trussOver(d, roadRun(d, a, b), 2, WOOD);
    return d.add([0, -2], on(a, b, 2), 'wood').add([10, 0], on(a, b, 8), 'wood');
  },
  6: (l) => recast(SOLUTIONS[6](l), 'wood', 'steel'),
  // Steel webs and end struts keep the stress low.
  7: (l) => prattAbove(deck(new Design(l), 0, 12), 0, 12, 2, { ...STEELY, end: 'wood' }).add([0, -2], [2, 0], 'steel').add([12, -2], [10, 0], 'steel'),
  8: (l) => prattAbove(deck(new Design(l), 0, 14), 0, 14, 2, { ...STEELY, end: 'wood' }).add([0, -3], [2, 0], 'steel').add([14, -3], [12, 0], 'steel'),
  9: (l) => {
    const a: GridPt = [0, 0];
    const b: GridPt = [12, -1];
    const d = new Design(l);
    trussOver(d, roadRun(d, a, b), 2, HEAVY);
    return d.add([0, -3], on(a, b, 2), 'steel').add([12, -3], on(a, b, 10), 'steel');
  },
  10: (l) => recast(SOLUTIONS[10](l), 'wood', 'steel'),
  11: (l) => {
    const d = deck(new Design(l), 0, 16);
    prattAbove(d, 0, 8, 2, { chord: 'steel', web: 'wood', vert: 'wood', end: 'steel' });
    prattAbove(d, 8, 16, 2, { chord: 'steel', web: 'wood', vert: 'wood', end: 'steel' });
    d.add([8, -3], [8, 0], 'steel').add([8, -3], [6, 0], 'steel').add([8, -3], [10, 0], 'steel');
    return d.add([0, -2], [2, 0], 'steel').add([16, -2], [14, 0], 'steel');
  },
  12: (l) => recast(SOLUTIONS[12](l), 'wood', 'steel'),
  13: (l) => recast(SOLUTIONS[13](l), 'wood', 'steel'),
  14: (l) => hang(deck(new Design(l), 0, 18), [9, 7], [4, 6, 8, 10, 12, 14].map((x): GridPt => [x, 0])).add([0, -2], [2, 0], 'steel').add([18, -2], [16, 0], 'steel'),
  15: (l) => recast(SOLUTIONS[15](l), 'road', 'heavy'),
  17: (l) => recast(SOLUTIONS[17](l), 'wood', 'steel'),
  18: (l) => recast(SOLUTIONS[18](l), 'wood', 'steel'),
  19: (l) => recast(SOLUTIONS[19](l), 'wood', 'steel'),
  // A true suspension bridge: nothing stands on the pier.
  20: (l) => longWay(l),
  21: (l) => deck(new Design(l), 0, 8).add([4, -2], [2, 0], 'wood').add([4, -2], [6, 0], 'wood'),
  22: (l) => recast(SOLUTIONS[22](l), 'steel', 'wood'),
  23: (l) => prattAbove(deck(new Design(l), 0, 14), 0, 14, 2, STEELY),
  25: (l) => {
    const d = new Design(l);
    const pts = roadRun(d, [0, 0], [20, 4]);
    trussOver(d, pts.slice(0, 6), 2, { ...HEAVY, web: 'steel' });
    trussOver(d, pts.slice(5), 2, { ...HEAVY, web: 'steel' });
    return d.add([10, -2], pts[5], 'steel');
  },
  26: (l) => recast(SOLUTIONS[26](l), 'road', 'heavy'),
  27: (l) => gauntlet(l, STIFF),
  28: (l) => recast(SOLUTIONS[28](l), 'wood', 'steel'),
  // Steel chords and end posts on the side spans instead of bank struts.
  29: (l) => skyRoad(l, { ...HEAVY, endWeb: 'wood' }),
  30: (l) => recast(SOLUTIONS[30](l), 'wood', 'steel'),
};

/** Deck joints every 2 m from x0 to x1 on the flat. */
function span(x0: number, x1: number): GridPt[] {
  const pts: GridPt[] = [];
  for (let x = x0; x <= x1; x += 2) pts.push([x, 0]);
  return pts;
}

/** Five 2 m deck panels starting at x0. */
function panels(x0: number): GridPt[] {
  return [0, 2, 4, 6, 8, 10].map((k): GridPt => [x0 + k, 0]);
}

/** A cable chain through the given points: a main cable. */
export function suspend(d: Design, pts: GridPt[]): Design {
  for (let i = 0; i < pts.length - 1; i++) d.add(pts[i], pts[i + 1], 'cable');
  return d;
}

/** King-post truss under the deck joint midway between x0 and x1: two struts to a low joint and a post up. */
function kingPost(d: Design, x0: number, x1: number, depth: number, mat: MaterialId, post: MaterialId = mat): Design {
  const mid = (x0 + x1) / 2;
  return d.add([x0, 0], [mid, depth], mat).add([x1, 0], [mid, depth], mat).add([mid, depth], [mid, 0], post);
}

/** Cables from one anchor down to each of the given deck joints. */
export function hang(d: Design, from: GridPt, to: GridPt[]): Design {
  for (const p of to) d.add(from, p, 'cable');
  return d;
}

/** Deck joint at x on a straight road run from a to b. */
function on(a: GridPt, b: GridPt, x: number): GridPt {
  // Rounded like roadPath's joints, so a strut lands on the deck joint rather than beside it.
  return [x, q(a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]))];
}

export function solutionFor(id: number): Design | null {
  const level = LEVELS.find((l) => l.id === id);
  const f = SOLUTIONS[id];
  return level && f ? f(level) : null;
}
