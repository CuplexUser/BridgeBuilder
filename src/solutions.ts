import { Design, q, type GridPt } from './design';
import type { LevelDef } from './levels';
import { deckStations, layMain } from './maincable';
import { MATERIALS, type MaterialId } from './physics/materials';

/** Road run from a to b, split exactly the way the editor's road tool splits it. */
export function roadRun(d: Design, a: GridPt, b: GridPt, mat: MaterialId = 'road'): GridPt[] {
  const path = d.runPath(a[0], a[1], b[0], b[1], MATERIALS[mat].maxLen, 50)!;
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

/**
 * Hand-made designs, one per level: the tuner (tools/tune) polishes them as a starting point,
 * and budgets always leave room for them, so the intended answer stays affordable.
 */
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
  // Built from the level's bolts, since the tuner may move the pylons and raise the deck.
  31: (l) => {
    const d = new Design(l);
    trussOver(d, roadRun(d, [0, 0], [8, 0]), 2, WOOD);
    return d.add([4, -3], [4, 0], 'ram');
  },
  32: (l) => {
    const d = new Design(l);
    trussOver(d, roadRun(d, [0, 0], [14, 0]), 2, { ...WOOD, end: 'steel', endWeb: 'steel' });
    return d.add([7, -3], [6, 0], 'steel').add([7, -3], [8, 0], 'steel');
  },
  33: (l) => {
    // Two trusses meeting on the middle pier: one toll instead of three.
    const d = new Design(l);
    const pts = roadRun(d, [0, 0], [20, 0]);
    trussOver(d, pts.slice(0, 6), 2, HEAVY);
    trussOver(d, pts.slice(5), 2, HEAVY);
    return d.add([10, -2], [10, 0], 'steel');
  },
  34: (l) => {
    const d = new Design(l);
    trussOver(d, roadRun(d, [0, 0], [8, 0]), 2, STEELY);
    trussOver(d, roadRun(d, [8, 0], [16, 0]), 2, STEELY);
    return d.add([12, -3], [12, 0], 'ram');
  },
  35: (l) => {
    const d = new Design(l);
    trussOver(d, roadRun(d, [0, 0], [10, 0]), 2, STEELY);
    return d.add([6, -4], [6, 0], 'ram');
  },
  // A main cable between the masts, each mast backstayed to one block per bank.
  36: (l) => {
    const d = deck(new Design(l), 0, 16);
    mainCable(d, [[3, 8], [4, 6], [6, 4], [8, 3], [10, 4], [12, 6], [13, 8]]);
    hang(d, [3, 8], [[2, 0]]);
    hang(d, [13, 8], [[14, 0]]);
    backstay(d, [[3, 8], [0, 4], [-3, 0]]);
    return backstay(d, [[13, 8], [16, 4], [19, 0]]);
  },
  // Only 4 m behind each bank: a backstay to the far end of the strip is as flat as it gets, and holds.
  37: (l) => liftOff(l, 4),
  // A braced steel tower on each pair of piers, a main cable between them, and two blocks per side.
  38: (l) => {
    const d = new Design(l);
    roadRun(d, [0, 0], [24, 0], 'heavy');
    for (const [a, b] of [[2, 4], [20, 22]]) {
      const m = (a + b) / 2;
      d.add([a, 0], [a, 3], 'steel').add([b, 0], [b, 3], 'steel').add([a, 3], [b, 3], 'steel');
      d.add([a, 0], [b, 3], 'steel').add([b, 0], [a, 3], 'steel');
      d.add([a, 3], [m, 7], 'steel').add([b, 3], [m, 7], 'steel');
    }
    mainCable(d, [[3, 7], [6, 4], [8, 2], [10, 1], [12, 1], [14, 1], [16, 2], [18, 4], [21, 7]]);
    backstay(d, [[3, 7], [-1, 0]]);
    backstay(d, [[3, 7], [0, 4], [-4, 0]]);
    backstay(d, [[21, 7], [25, 0]]);
    return backstay(d, [[21, 7], [24, 4], [28, 0]]);
  },
  // The middle of each side span hangs from the backstay.
  39: (l) => suspensionWithSideSpans(l, 8, 22, [12, 8, 6, 5, 5, 6, 8, 12], 16, false),
  // Forty tonnes: a second, flatter backstay to its own block shares each mast's pull, and steel
  // struts from the low bolts take the side spans' ends.
  40: (l) => suspensionWithSideSpans(l, 8, 28, [12, 9, 7, 5, 4, 4, 4, 5, 7, 9, 12], 20, true).add([0, -3], [2, 0], 'steel').add([36, -3], [34, 0], 'steel'),
  // Chapter 9: main cables over masts and then concrete towers, down to concrete anchors.
  41: (l) =>
    steelSuspension(l, {
      deck: [[0, 0], [16, 0], [32, 0], [40, 0]],
      deckMat: 'road',
      towers: [],
      hangers: [[[4, 10], [4, 0]], [[36, 10], [36, 0]]],
      cables: [[[4, 10], [36, 10]], [[-8, 0], [4, 10], undefined, true], [[36, 10], [48, 0], undefined, true]],
    }),
  42: (l) =>
    steelSuspension(l, {
      deck: [[0, 0], [2, 0], [6, 0], [42, 0], [46, 0], [48, 0]],
      deckMat: 'heavy',
      towers: [[2, 0, 13, 4], [42, 0, 13, 4]],
      legs: 'concrete',
      cables: [[[4, 13], [44, 13], 6], [[-9, 0], [4, 13]], [[44, 13], [57, 0]]],
    }),
  // Each half hangs from the cable down to its bank, shallow enough to stay off the ground at the anchor.
  43: (l) =>
    steelSuspension(l, {
      deck: [[0, 0], [26, 0], [30, 0], [56, 0]],
      deckMat: 'heavy',
      towers: [[26, 0, 16, 4]],
      legs: 'concrete',
      struts: [[[0, -3], [2, 0]], [[56, -3], [54, 0]]],
      cables: [[[-9, 0], [28, 16], 3.5, true], [[28, 16], [65, 0], 3.5, true]],
    }),
  44: (l) =>
    steelSuspension(l, {
      deck: [[0, 0], [2, 0], [6, 0], [46, 6], [50, 6], [52, 6]],
      deckMat: 'heavy',
      towers: [[2, 0, 14, 4], [46, 6, 20, 4]],
      legs: 'concrete',
      cables: [[[4, 14], [48, 20], 6], [[-9, 0], [4, 14]], [[48, 20], [61, 6]]],
    }),
  // Two anchors a side share forty tonnes' pull; the deck ramps up over the channel.
  45: (l) =>
    steelSuspension(l, {
      deck: [[0, 0], [2, 0], [6, 0], [20, 3], [44, 3], [58, 0], [62, 0], [64, 0]],
      deckMat: 'heavy',
      towers: [[2, 0, 18, 4], [58, 0, 18, 4]],
      legs: 'concrete',
      cables: [[[4, 18], [60, 18], 8], [[-12, 0], [4, 18]], [[-8, 0], [4, 18]], [[60, 18], [76, 0]], [[60, 18], [72, 0]]],
    }),
  30: (l) => {
    const d = new Design(l);
    const [a, b] = l.anchors.filter(([x, y]) => x > 0 && x < l.width && y >= 0 && y < 5).toSorted((p, r) => p[0] - r[0]);
    const [ta, tb] = l.anchors.filter(([, y]) => y >= 8).toSorted((p, r) => p[0] - r[0]);
    // Up the ramp to the pylon, across the channel, and down again.
    const up = roadRun(d, [0, 0], a, 'heavy');
    const mid = roadRun(d, a, b, 'heavy');
    const down = roadRun(d, b, [l.width, 0], 'heavy');
    // A deep sag keeps the main cable's pull down, so it holds the semi; a hanger at every joint.
    const sag = ta[1] - a[1] - 3;
    const cable = mid.slice(1, -1).map(([x]): GridPt => {
      const t = (x - a[0]) / (b[0] - a[0]);
      return [x, Math.round(ta[1] - sag * 4 * t * (1 - t))];
    });
    mainCable(d, [ta, ...cable, tb], -1, a[1]);
    // Steel trusses on the ramps, with struts from the low bolts under their ends.
    trussOver(d, up, 2, STEELY);
    trussOver(d, down, 2, STEELY);
    return d.add([0, -3], up[1], 'steel').add([l.width, -3], down.at(-2)!, 'steel');
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

/**
 * Level 37: a road deck hung between the masts, each backstayed with one cable to a block `back`
 * meters behind its bank (2 or 4), broken halfway so neither piece is longer than a cable.
 */
export function liftOff(l: LevelDef, back: 2 | 4): Design {
  const d = deck(new Design(l), 0, 18);
  mainCable(d, [[2, 10], [4, 7], [6, 5], [8, 4], [10, 4], [12, 5], [14, 7], [16, 10]]);
  hang(d, [2, 10], [[2, 0]]);
  hang(d, [16, 10], [[16, 0]]);
  const mid = back === 2 ? 0 : -1;
  backstay(d, [[2, 10], [mid, 5], [-back, 0]]);
  return backstay(d, [[16, 10], [18 - mid, 5], [18 + back, 0]]);
}

/**
 * Levels 39 and 40: a heavy deck hung from a main cable between masts at x = a and b, both 12 m
 * tall, sagging through the given heights every 2 m. Each mast's backstay runs at 45° down to a
 * block 4 m behind its bank, carrying the middle of the side span on a hanger; with `second`, a flatter second
 * backstay goes to a block 7 m back. The deck is laid in two runs, split at `split`, so that every
 * piece is 2 m long and a hanger every 2 m lands on a joint.
 */
function suspensionWithSideSpans(l: LevelDef, a: number, b: number, sag: number[], split: number, second: boolean): Design {
  const d = new Design(l);
  roadRun(d, [0, 0], [split, 0], 'heavy');
  roadRun(d, [split, 0], [l.width, 0], 'heavy');
  mainCable(d, alongX(a, sag));
  for (const [mx, side, edge] of [[a, -1, 0], [b, 1, l.width]] as const) {
    const top = 12;
    const at = (dx: number): GridPt => [mx + side * dx, top - dx];
    const back = top - Math.abs(edge - mx);
    backstay(d, [at(0), at(4), at(Math.abs(edge - mx)), [edge + side * back, 0]]);
    d.add(at(4), [mx + side * 4, 0], 'cable');
    // The deck joint under the mast hangs from the main cable's first point.
    d.add([mx - side * 2, sag[1]], [mx, 0], 'cable');
    if (second) backstay(d, [at(0), [mx + side * 5, top - 4], [edge + side * 2, top - 8], [edge + side * 7, 0]]);
  }
  return d;
}

/** Points from x0 every `step` meters, at the given heights. */
function alongX(x0: number, ys: number[], step = 2): GridPt[] {
  return ys.map((y, i): GridPt => [x0 + step * i, y]);
}

/** A main cable through pts, with a vertical hanger from each inner point down to a flat deck at deckY, except at x = skip. */
function mainCable(d: Design, pts: GridPt[], skip = -1, deckY = 0): Design {
  suspend(d, pts);
  for (const [x, y] of pts.slice(1, -1)) if (x !== skip) d.add([x, y], [x, deckY], 'cable');
  return d;
}

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

/**
 * A backstay: a cable chain from a mast top through the given points, ending at a concrete
 * anchor set into the bank at the last one.
 */
export function backstay(d: Design, pts: GridPt[]): Design {
  const [x, y] = pts[pts.length - 1];
  d.ensureBlock(x, y);
  return suspend(d, pts);
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

/**
 * A steel tower on the pier bolts at (a, y0) and (a + w, y0): two straight legs braced every
 * 3 m by a strut with a chevron down to each leg, and a peak `top` high where the main cable
 * rests, as near as one piece of steel from each leg reaches.
 */
export function steelTower(d: Design, a: number, y0: number, top: number, w = 6, legs: MaterialId = 'steel'): Design {
  const b = a + w;
  const m = a + w / 2;
  const reach = Math.sqrt(MATERIALS.steel.maxLen ** 2 - (w / 2) ** 2) - 0.01;
  let y = y0;
  for (; top - y > reach; y += 3) {
    d.add([a, y], [a, y + 3], legs).add([b, y], [b, y + 3], legs);
    d.add([a, y + 3], [m, y + 3], 'steel').add([m, y + 3], [b, y + 3], 'steel');
    d.add([a, y], [m, y + 3], 'steel').add([b, y], [m, y + 3], 'steel');
  }
  d.add([a, y], [m, top], legs).add([b, y], [m, top], legs);
  return y > y0 ? d.add([m, y], [m, top], 'steel') : d;
}

/** What a long-span suspension bridge is made of, for steelSuspension. */
export interface SuspensionPlan {
  /** Deck waypoints from bank to bank: a run of deck between each pair. */
  deck: GridPt[];
  deckMat: MaterialId;
  /** Towers: the left pier bolt's x, the height they stand on, their peak, and their width if not 6 m. */
  towers: [number, number, number, number?][];
  /** What the towers' legs are made of, if not steel. */
  legs?: MaterialId;
  /** Steel struts, say from low bolts up under the deck's ends. */
  struts?: [GridPt, GridPt][];
  /** Plain cable hangers besides those under the main cables, say straight down from a mast top. */
  hangers?: [GridPt, GridPt][];
  /**
   * Main cables: from, to, the sag if not the natural one, and whether hangers drop from it (by
   * default only from a cable across the gap). Ends behind a bank get a concrete anchor.
   */
  cables: [GridPt, GridPt, number?, boolean?][];
}

/**
 * Chapter 9: a deck, steel towers, main cables over their peaks down to concrete anchors, and
 * a hanger from each main cable joint to the deck joint below it wherever one fits.
 */
export function steelSuspension(l: LevelDef, plan: SuspensionPlan): Design {
  const d = new Design(l);
  for (let i = 0; i < plan.deck.length - 1; i++) roadRun(d, plan.deck[i], plan.deck[i + 1], plan.deckMat);
  for (const [a, y0, top, w = 6] of plan.towers) pylon(d, a, y0, top, w, plan.legs);
  for (const [a, b] of plan.struts ?? []) d.add(a, b, 'steel');
  for (const [a, b] of plan.hangers ?? []) d.add(a, b, 'cable');
  for (const [a, b, sag, hangs] of plan.cables) {
    for (const [x, y] of [a, b]) if (x < 0 || x > l.width) d.ensureBlock(x, y);
    const pts = layMain(d, a, b, sag);
    if (hangs ?? [a, b].every(([x]) => x >= 0 && x <= l.width)) hangDeck(d, l, pts);
  }
  return d;
}

/** A tower as steelTower builds it, with the deck joints between its legs hung from its lowest strut. */
export function pylon(d: Design, a: number, y0: number, top: number, w = 6, legs: MaterialId = 'steel'): Design {
  const joints = deckStations(d);
  steelTower(d, a, y0, top, w, legs);
  for (const x of joints) if (x > a && x < a + w) d.add([a + w / 2, y0 + 3], [x, y0], 'steel');
  return d;
}

/**
 * A plain cable hanger from each of a main cable's joints that sits plumb above a deck joint,
 * where it would be over 0.8 m long and fits in one cable, and the deck joint isn't a bolt.
 */
export function hangDeck(d: Design, l: LevelDef, pts: GridPt[], every = 1): Design {
  const decked = new Map<number, number>();
  d.nodes.forEach((n, i) => {
    if (d.members.some((m) => MATERIALS[m.mat].drivable && (m.a === i || m.b === i))) decked.set(n.x, n.y);
  });
  const bolted = (x: number, y: number) => l.anchors.some(([ax, ay]) => ax === x && ay === y);
  pts.slice(1, -1).forEach(([x, y], k) => {
    const below = decked.get(x);
    if (below === undefined || k % every !== 0) return;
    if (y - below > 0.8 && y - below <= MATERIALS.cable.maxLen && !bolted(x, below) && d.findMember(d.findNode(x, y), d.findNode(x, below)) < 0) d.add([x, y], [x, below], 'cable');
  });
  return d;
}
