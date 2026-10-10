import { Design, type GridPt } from '../../src/design';
import { bankY, type BonusGoal, type GeometryKey, type LevelDef } from '../../src/levels';
import { MATERIALS, type MaterialId } from '../../src/physics/materials';
import { deck, hang, liftOff, roadRun, SOLUTIONS, trussOver, type TrussMats } from '../../src/solutions';

/** A level's geometry for one choice of its tunable parameters. */
export type Shape = Partial<Pick<LevelDef, GeometryKey>>;
export type Params = Record<string, number>;

/** What a level is meant to teach, in terms the optimizer can check. */
export interface Intent {
  /** Deck waypoints, when the deck isn't a straight run from bank to bank. */
  deck?: (l: LevelDef) => GridPt[];
  /** Tunable geometry: candidate values per parameter, preferred first. */
  params?: Record<string, number[]>;
  shape?: (p: Params) => Shape;
  /** Materials the level is about: the best design without each must fail or blow the budget. */
  requires?: MaterialId[];
  /** Specific shortcuts that must fail or cost more than the budget. */
  shortcuts?: { name: string; build: (l: LevelDef) => Design }[];
  /** Least share of one-gene variations of the best design that must still cross. */
  minRoom?: number;
  /** Bonus kinds to try, best first. Defaults to the level's current kind, then stress, without, parts. */
  bonus?: BonusGoal['kind'][];
}

const STEELY: TrussMats = { chord: 'steel', web: 'steel', vert: 'steel', end: 'steel', endWeb: 'steel' };
const joints = (x0: number, x1: number, y = 0): GridPt[] => Array.from({ length: (x1 - x0) / 2 + 1 }, (_, i): GridPt => [x0 + 2 * i, y]);

/** Level 30's shape: pylons `side` meters in from each bank, the deck raised `clear` meters over the channel between them. */
function finale(p: Params): Shape {
  const W = 36;
  const [a, b] = [p.side, W - p.side];
  return {
    anchors: [[0, 0], [W, 0], [a, p.clear], [b, p.clear], [a, p.top], [b, p.top], [0, -3], [W, -3]],
    towers: [[a, -8, p.top], [b, -8, p.top]],
    channels: p.clear > 0 ? [[a + 1, b - 1, p.clear]] : [],
  };
}

/**
 * A design without some of its concrete anchors, and the cable chains that led only to them:
 * the shortcut a level with masts should rule out.
 */
function dropBlocks(d0: Design, drop: (x: number, y: number) => boolean): Design {
  const d = Design.deserialize(d0.serialize());
  const gone = new Set(d.nodes.flatMap((n, i) => (n.block && drop(n.x, n.y) ? [i] : [])));
  for (let before = -1; before !== d.members.length; ) {
    before = d.members.length;
    const degree = d.nodes.map(() => 0);
    for (const m of d.members) {
      degree[m.a]++;
      degree[m.b]++;
    }
    const loose = (i: number) => gone.has(i) || (!d.nodes[i].anchor && degree[i] === 1);
    d.members = d.members.filter((m) => !loose(m.a) && !loose(m.b));
  }
  d.pruneNodes();
  return d;
}

/** The reference with no concrete anchors at all: the masts or towers just tip over. */
const noBlocks = { name: 'no concrete anchors', build: (l: LevelDef) => dropBlocks(SOLUTIONS[l.id](l), () => true) };

/** The reference keeping only the block nearest each bank: the steepest pull. */
function nearestBlocks(l: LevelDef): Design {
  const d = SOLUTIONS[l.id](l);
  const xs = d.nodes.filter((n) => n.block).map((n) => n.x);
  const left = Math.max(...xs.filter((x) => x < 0));
  const right = Math.min(...xs.filter((x) => x > l.width));
  return dropBlocks(d, (x) => x !== left && x !== right);
}

/** The reference keeping one block per bank, the one farthest back. */
function farthestBlocks(l: LevelDef): Design {
  const d = SOLUTIONS[l.id](l);
  const xs = d.nodes.filter((n) => n.block).map((n) => n.x);
  const left = Math.min(...xs.filter((x) => x < 0));
  const right = Math.max(...xs.filter((x) => x > l.width));
  return dropBlocks(d, (x) => x !== left && x !== right);
}

/**
 * The reference with its concrete anchors swapped for the deck bolts on the banks: each mast
 * top stayed straight down to the nearer one, split where one cable would be too long. The
 * bolts hold no cables on these levels, so this must never get through.
 */
const toBolts = {
  name: 'backstays to the bank bolts',
  build: (l: LevelDef) => {
    const d = dropBlocks(SOLUTIONS[l.id](l), () => true);
    for (const [mx, , top] of l.masts ?? []) {
      const bolt: GridPt = mx < l.width / 2 ? [0, 0] : [l.width, bankY(l)];
      const n = Math.ceil(Math.hypot(bolt[0] - mx, bolt[1] - top) / MATERIALS.cable.maxLen);
      const pts = Array.from({ length: n + 1 }, (_, k): GridPt => [mx + ((bolt[0] - mx) * k) / n, top + ((bolt[1] - top) * k) / n]);
      for (let k = 0; k < n; k++) d.add(pts[k], pts[k + 1], 'cable');
    }
    return d;
  },
};

/** The reference with every main cable swapped for plain cable along the same curve. */
const thinCable = {
  name: 'plain cable for the main cable',
  build: (l: LevelDef) => {
    const d = SOLUTIONS[l.id](l);
    for (const m of d.members) if (m.mat === 'main') m.mat = 'cable';
    return d;
  },
};

/** Deck waypoints through every bolt on the banks and piers, left to right. */
const throughBolts = (l: LevelDef): GridPt[] => [...l.anchors].filter(([x]) => x >= 0 && x <= l.width).sort((p, r) => p[0] - r[0]);

/** Deck bolts on the pylons, as deck waypoints from bank to bank. */
function overPylons(l: LevelDef): GridPt[] {
  const bolts = l.anchors.filter(([x, y]) => x > 0 && x < l.width && y >= 0 && (l.towers ?? []).some((t) => t[0] === x && t[2] > y + 5));
  bolts.sort((p, q) => p[0] - q[0]);
  return [[0, 0], ...bolts, [l.width, l.rightY ?? 0]];
}

export const INTENTS: Record<number, Intent> = {
  7: { bonus: ['stress', 'without', 'parts'] },
  13: {
    requires: ['cable'],
    shortcuts: [
      { name: 'cables alone', build: (l) => hang(hang(deck(new Design(l), 0, 14), [0, 6], [[2, 0], [4, 0]]), [14, 6], [[10, 0], [12, 0]]) },
    ],
  },
  14: {
    requires: ['cable'],
    shortcuts: [
      {
        name: 'four cables and end struts',
        build: (l) => hang(deck(new Design(l), 0, 18), [9, 7], [[4, 0], [8, 0], [10, 0], [14, 0]]).add([0, -2], [2, 0], 'wood').add([18, -2], [16, 0], 'wood'),
      },
      { name: 'every joint hung from the pylon', build: (l) => hang(deck(new Design(l), 0, 18), [9, 7], joints(2, 16)) },
    ],
  },
  // Splitting pays through the parts goal: a split beam counts as one part.
  16: { bonus: ['parts'] },
  15: {
    requires: ['cable'],
    shortcuts: [{ name: 'reachable cables alone', build: (l) => hang(hang(deck(new Design(l), 0, 16), [1, 9], [[2, 0], [4, 0]]), [15, 9], [[12, 0], [14, 0]]) }],
  },
  18: {
    requires: ['cable'],
    shortcuts: [
      {
        name: 'cables from the tall pylon alone',
        build: (l) => {
          const d = new Design(l);
          hang(d, [8, 7], roadRun(d, [0, 0], [24, -3]).slice(1, 7));
          return d;
        },
      },
    ],
  },
  19: { requires: ['cable'] },
  20: {
    requires: ['cable'],
    shortcuts: [
      {
        name: 'bank posts and the pier',
        build: (l) => {
          const d = new Design(l);
          roadRun(d, [0, 0], [32, 0], 'heavy');
          hang(hang(d, [0, 4], [[2, 0], [4, 0], [6, 0]]), [32, 4], [[26, 0], [28, 0], [30, 0]]);
          return d.add([16, -4], [16, 0], 'steel');
        },
      },
    ],
  },
  24: {
    deck: () => [[0, 0], [8, 2], [16, 2], [24, 0]],
    requires: ['cable'],
  },
  26: { requires: ['cable'] },
  27: {
    shortcuts: [
      {
        name: 'trestles alone',
        build: (l) => {
          const d = new Design(l);
          roadRun(d, [0, 0], [26, 0], 'heavy');
          for (const px of [9, 17]) {
            const [a, b] = [px - 1, px + 1];
            d.add([px, -6], [a, -3], 'steel').add([px, -6], [b, -3], 'steel').add([a, -3], [b, -3], 'steel');
            d.add([a, -3], [a, 0], 'steel').add([b, -3], [b, 0], 'steel').add([a, -3], [b, 0], 'steel');
          }
          return d.add([0, -3], [2, 0], 'steel').add([26, -3], [24, 0], 'steel');
        },
      },
    ],
  },
  29: {
    requires: ['cable'],
    shortcuts: [2, 3].map((h) => ({
      name: `trusses ${h} m deep`,
      build: (l: LevelDef) => {
        const d = new Design(l);
        roadRun(d, [0, 0], [34, 0], 'heavy');
        for (const [x0, x1] of [[0, 8], [26, 34]]) trussOver(d, joints(x0, x1), 2, STEELY);
        trussOver(d, joints(8, 26), h, STEELY);
        return d.add([0, -3], [2, 0], 'steel').add([34, -3], [32, 0], 'steel');
      },
    })),
  },
  36: { requires: ['cable'], shortcuts: [noBlocks, toBolts] },
  // A steep backstay lifts its block out: one block per side, at the near end of the strip, fails.
  37: { requires: ['cable'], shortcuts: [noBlocks, toBolts, { name: 'one steep backstay per mast', build: (l) => liftOff(l, 2) }] },
  38: { requires: ['cable', 'steel'], shortcuts: [noBlocks] },
  39: { requires: ['cable'], shortcuts: [noBlocks, toBolts] },
  40: {
    requires: ['cable'],
    shortcuts: [noBlocks, toBolts, { name: 'one block per side, nearest', build: nearestBlocks }, { name: 'one block per side, farthest', build: farthestBlocks }],
  },
  41: { requires: ['main'], shortcuts: [noBlocks, thinCable] },
  42: { requires: ['main', 'concrete'], shortcuts: [noBlocks, thinCable] },
  43: { requires: ['main', 'concrete'], shortcuts: [noBlocks, thinCable] },
  44: { deck: throughBolts, requires: ['main', 'concrete'], shortcuts: [noBlocks, thinCable] },
  // Forty tonnes: one anchor a side, near or far, gives way.
  45: {
    deck: () => [[0, 0], [2, 0], [6, 0], [20, 3], [44, 3], [58, 0], [62, 0], [64, 0]],
    requires: ['main', 'concrete'],
    shortcuts: [noBlocks, thinCable, { name: 'one block per side, nearest', build: nearestBlocks }, { name: 'one block per side, farthest', build: farthestBlocks }],
  },
  // Block arches: each needs the arch, and the blocks it springs from.
  46: { requires: ['arch', 'masonry'] },
  47: { requires: ['arch', 'masonry'] },
  48: { requires: ['arch'] },
  49: { requires: ['arch', 'masonry'] },
  50: { requires: ['arch', 'masonry'] },
  // Trains: track is the only deck they run on, so the checks are about what holds it up.
  51: { requires: ['steel'] },
  52: { requires: ['steel'] },
  53: { requires: ['steel'] },
  54: { requires: ['steel'] },
  55: { requires: ['arch'] },
  30: {
    params: { clear: [2, 1.5, 1], side: [8, 10], top: [14, 16, 12] },
    shape: finale,
    deck: overPylons,
    requires: ['cable'],
    // Players should find more than one way across: at least a third of the one-step variations of the best design still cross.
    minRoom: 0.33,
    shortcuts: [2, 3].map((h) => ({
      name: `trusses ${h} m deep over the channel`,
      build: (l: LevelDef) => {
        const d = new Design(l);
        const pts = overPylons(l);
        for (let i = 0; i < pts.length - 1; i++) {
          const run = roadRun(d, pts[i], pts[i + 1], 'heavy');
          trussOver(d, run, i === 1 ? h : 2, STEELY);
        }
        return d;
      },
    })),
  },
};

/** The hand-made reference for a level, if it still fits the level's (possibly tuned) geometry. */
export function handSeed(l: LevelDef): Design | null {
  try {
    return SOLUTIONS[l.id]?.(l) ?? null;
  } catch {
    return null;
  }
}

/** Every combination of a level's tunable parameters, closest to the preferred values first. */
export function paramCombos(intent: Intent): Params[] {
  const space = intent.params ?? {};
  const names = Object.keys(space);
  let combos: { p: Params; dist: number }[] = [{ p: {}, dist: 0 }];
  for (const n of names) {
    combos = combos.flatMap((c) => space[n].map((v, i) => ({ p: { ...c.p, [n]: v }, dist: c.dist + i })));
  }
  return combos.sort((a, b) => a.dist - b.dist).map((c) => c.p);
}
