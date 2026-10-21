import { Design, type GridPt } from '../../src/design';
import { bankY, mudAt, type BonusGoal, type GeometryKey, type LevelDef } from '../../src/levels';
import { rings } from '../../src/masonry';
import { MATERIALS, type MaterialId } from '../../src/physics/materials';
import { crossesChannel } from '../../src/rules';
import { archBridge, blockArch, blockGirder, blockTower, deck, doubleBascule, doubleDeck, hang, liftOff, pileBridge, roadRun, SOLUTIONS, swingBridge, trussOver, warrenAbove, type TrussMats } from '../../src/solutions';

/** A level's geometry for one choice of its tunable parameters. */
export type Shape = Partial<Pick<LevelDef, GeometryKey>>;
export type Params = Record<string, number>;

/** Something a level can't be crossed without: a material, or the piles it lets you drive into its mud. */
export type Requirement = MaterialId | 'piles';

/** What a level is meant to teach, in terms the optimizer can check. */
export interface Intent {
  /** Deck waypoints, when the deck isn't a straight run from bank to bank. */
  deck?: (l: LevelDef) => GridPt[];
  /** Tunable geometry: candidate values per parameter, preferred first. */
  params?: Record<string, number[]>;
  shape?: (p: Params) => Shape;
  /** Materials the level is about, or its piles: the best design without each must fail or blow the budget. */
  requires?: Requirement[];
  /** Specific shortcuts that must fail or cost more than the budget. */
  shortcuts?: { name: string; build: (l: LevelDef) => Design }[];
  /** Least share of one-gene variations of the best design that must still cross. */
  minRoom?: number;
  /** Bonus kinds to try, best first. Defaults to the level's current kind, then stress, without, parts. */
  bonus?: BonusGoal['kind'][];
}

const STEELY: TrussMats = { chord: 'steel', web: 'steel', vert: 'steel', end: 'steel', endWeb: 'steel' };
const HEAVY: TrussMats = { chord: 'steel', web: 'wood', vert: 'wood', end: 'steel', endWeb: 'steel' };
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

/** An arch from shelf to shelf on a row of blocks across each, or none, and steel out to the road from its first joints where it reaches. */
function shelfArch(l: LevelDef, rows: number): Design {
  const d = new Design(l);
  roadRun(d, [0, 0], [l.width, 0]);
  const [a, b] = (l.rocks ?? []).toSorted((p, r) => p[0] - r[0]);
  for (const r of [a, b]) blockTower(d, l, r, rows);
  blockArch(d, l, [a[1], a[2] + rows], [b[0], b[2] + rows], 'steel');
  const { extra } = rings(d).at(-1)!;
  for (const [e, x] of [[extra[0], a[1]], [extra.at(-1)!, b[0]]] as const) {
    const n = d.nodes[e];
    if (Math.hypot(n.x - x, n.y) <= MATERIALS.steel.maxLen) d.add([n.x, n.y], [x, 0], 'steel');
  }
  return d;
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

/** The reference with its dampers taken out, or made of another material. */
function dampers(as: MaterialId | null) {
  return {
    name: as ? `${as} for the dampers` : 'no dampers',
    build: (l: LevelDef) => {
      const d = SOLUTIONS[l.id](l);
      if (as) for (const m of d.members) if (m.mat === 'damper') m.mat = as;
      d.members = d.members.filter((m) => m.mat !== 'damper');
      d.pruneNodes();
      return d;
    },
  };
}

/** A design without its stiffening truss: every member up to a joint 2 m over the deck. */
function unstiffen(d: Design): Design {
  d.members = d.members.filter((m) => d.nodes[m.a].y !== 2 && d.nodes[m.b].y !== 2);
  d.pruneNodes();
  return d;
}

/** Trusses from bolt to bolt on the hand-made design's deck, standing on the level's free bolts in the mud instead of on piles. */
const onBolts = {
  name: 'posts on the bolts in the mud',
  build: (l: LevelDef) => {
    const xs = l.anchors.filter(([x, y]) => mudAt(l, x, y)).map(([x]) => x).toSorted((a, b) => a - b);
    const deckMat = SOLUTIONS[l.id](l).members.find((m) => MATERIALS[m.mat].drivable)?.mat ?? 'road';
    return pileBridge(l, [0, ...xs, l.width], xs, deckMat);
  },
};

/**
 * The reference with steel braces fanned out from each pile to the deck joints either side:
 * stiff enough in calm water, but the flood's current and driftwood push on all that stands in
 * it.
 */
const fannedPiles = {
  name: 'braces fanned out from the piles, in the water',
  build: (l: LevelDef) => {
    const d = SOLUTIONS[l.id](l);
    for (const n of d.nodes.filter((p) => p.pile)) {
      for (const dx of [-2, 2]) if (d.findNode(n.x + dx, 0) >= 0 && !crossesChannel(l, n.x, n.y, n.x + dx, 0)) d.add([n.x, n.y], [n.x + dx, 0], 'steel');
    }
    return d;
  },
};

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

/** A heavy deck from bank to bank. */
function heavyDeck(l: LevelDef): Design {
  const d = new Design(l);
  roadRun(d, [0, 0], [l.width, 0], 'heavy');
  return d;
}

/** The lift bridge with one deck from bank to bank, so its span is tied to the approaches. */
function joinedLift(l: LevelDef, deckMat: MaterialId): Design {
  const d = new Design(l);
  trussOver(d, roadRun(d, [0, 0], [l.width, 0], deckMat), 2, HEAVY);
  d.add([0, -3], [2, 0], 'steel').add([l.width, -3], [l.width - 2, 0], 'steel');
  for (const [x, y] of l.anchors) if (x > l.lift![0] && x < l.lift![1]) d.add([x, y], [x, 0], 'ram');
  return d;
}

/** The lift bridge as bare deck on its rams, with nothing under the approaches. */
function bareLift(l: LevelDef, deckMat: MaterialId): Design {
  const d = new Design(l);
  const [a, b] = l.lift!;
  for (const [x0, x1] of [[0, a], [a, b], [b, l.width]]) roadRun(d, [x0, 0], [x1, 0], deckMat);
  for (const [x, y] of l.anchors) if (x > a && x < b) d.add([x, y], [x, 0], 'ram');
  return d;
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
  // Block arches, each a different way to carry the road.
  46: { requires: ['arch', 'masonry'] },
  // Nothing to stand on: an arch over the road from the bolts.
  47: { requires: ['arch'] },
  // Springings at different heights: the arch leans.
  48: { requires: ['arch'] },
  // Four blocks: against the walls, not out on the shelves, where the arch slides or cracks them.
  49: {
    requires: ['arch', 'masonry'],
    shortcuts: [
      { name: 'an arch on the bare shelves', build: (l) => shelfArch(l, 0) },
      { name: 'a row of blocks across each shelf', build: (l) => shelfArch(l, 1) },
    ],
  },
  // The channel rules out an arch under the middle span, and the ceiling one over the whole gorge.
  50: {
    requires: ['arch', 'masonry'],
    shortcuts: [
      {
        name: 'one arch over the road from bank to bank',
        build: (l) => {
          const d = new Design(l);
          roadRun(d, [0, 0], [l.width, 0], 'heavy');
          blockArch(d, l, [0, 0], [l.width, 0], 'cable');
          return d;
        },
      },
    ],
  },
  // Trains: track is the only deck they run on, so the checks are about what holds it up.
  51: { requires: ['steel'] },
  52: { requires: ['steel'] },
  53: { requires: ['steel'] },
  // On sliding bearings: a truss braced to the low bolts only one way, or not at all, rides off with the braking train.
  54: {
    requires: ['steel'],
    shortcuts: [
      {
        name: 'not braced to the low bolts',
        build: (l) => {
          const d = new Design(l);
          return trussOver(d, roadRun(d, [0, 0], [16, 0], 'track'), 3, STEELY);
        },
      },
      {
        name: 'braced one way only',
        build: (l) => {
          const d = new Design(l);
          trussOver(d, roadRun(d, [0, 0], [16, 0], 'track'), 3, STEELY);
          return d.add([0, -3], [2, 0], 'steel').add([16, -3], [14, 0], 'steel');
        },
      },
    ],
  },
  55: { requires: ['arch'] },
  // Dynamics: the reference without what calms it, or with steel in its place, must fail.
  56: { shortcuts: [noBlocks, dampers(null), dampers('steel')] },
  // A light deck in a gale flutters apart unless it's stiffened.
  57: { shortcuts: [{ name: 'no stiffening truss', build: (l) => unstiffen(SOLUTIONS[57](l)) }] },
  58: { shortcuts: [{ name: 'unbraced towers', build: (l) => SOLUTIONS[42](l) }] },
  // Steel can't reach the drowned rocks, so a stiff bridge has to stand on the piers alone, and
  // the low ceiling keeps a suspension bridge's cable shallow: dampers on the rocks calm it best.
  59: {
    shortcuts: [
      dampers(null),
      { name: 'a stiffening truss instead of dampers', build: (l) => warrenAbove(dampers(null).build(l), 6, 42, 2, 'steel') },
      ...[2, 3, 4].map((h) => ({
        name: `a ${h} m steel truss between the piers`,
        build: (l: LevelDef) => {
          const d = new Design(l);
          roadRun(d, [0, 0], [6, 0], 'heavy');
          roadRun(d, [42, 0], [48, 0], 'heavy');
          return trussOver(d, roadRun(d, [6, 0], [42, 0], 'heavy'), h, STEELY);
        },
      })),
    ],
  },
  60: { shortcuts: [dampers(null), dampers('steel')] },
  // Foundations: the deck stands on piles. Bolts on the mud sink under a truck, or a flood scours them out.
  61: { requires: ['piles'] },
  62: { requires: ['piles'], shortcuts: [onBolts] },
  63: { requires: ['piles'], shortcuts: [onBolts] },
  64: { requires: ['piles'] },
  // The flood bites what stands in the water: keep it slim.
  65: { requires: ['piles'], shortcuts: [onBolts, fannedPiles] },
  // The finale: each combines two lessons, and each of them is checked.
  66: { requires: ['piles'], shortcuts: [onBolts] },
  67: { requires: ['piles', 'heavy'], shortcuts: [onBolts, fannedPiles] },
  68: { shortcuts: [dampers(null), dampers('steel')] },
  69: {
    requires: ['arch', 'masonry'],
    shortcuts: [
      { name: 'the arch on the bare shelves', build: (l) => archBridge(l, 'heavy', [0, 0], [[0, 1]], 'steel') },
      { name: 'two rows of blocks under each springing', build: (l) => archBridge(l, 'heavy', [2, 2], [[0, 1]], 'steel') },
    ],
  },
  70: { requires: ['piles'] },
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
  // Modern works: without a tendon, or with one where the girder doesn't need it, the girder cracks.
  71: { requires: ['tendon'], shortcuts: [{ name: 'no tendon', build: (l) => blockGirder(deck(new Design(l), 0, l.width), l, 2, 'none') }] },
  72: {
    requires: ['tendon'],
    shortcuts: [
      { name: 'no tendon', build: (l) => blockGirder(heavyDeck(l), l, 2, 'none') },
      { name: 'a tendon low through both spans', build: (l) => blockGirder(heavyDeck(l), l, 2, 'low') },
    ],
  },
  // Two decks on posts alone, or on a web alone, don't make a truss deep enough.
  73: {
    shortcuts: [
      { name: 'decks on posts', build: (l) => doubleDeck(l, 'posts', false) },
      { name: 'a web between the decks, nothing over the road', build: (l) => doubleDeck(l, 'warren', false) },
    ],
  },
  // Leaves of wood bend too far to meet; nothing lifts without rams.
  74: { requires: ['ram'], shortcuts: [{ name: 'wooden leaves', build: (l) => doubleBascule(l, { chord: 'wood', web: 'wood', vert: 'wood' }) }] },
  // A span joined to its approaches can't rise.
  75: { requires: ['ram'], shortcuts: [{ name: 'one deck from bank to bank', build: (l) => joinedLift(l, 'road') }] },
  // Balanced on two bolts with nothing out wide, the open bridge tips and folds.
  76: { shortcuts: [{ name: 'posts only under the pivot', build: (l) => swingBridge(l, false) }] },
  // Track is stiff, but not enough to carry the train bare over the approaches.
  77: {
    requires: ['ram'],
    shortcuts: [
      { name: 'one deck from bank to bank', build: (l) => joinedLift(l, 'track') },
      { name: 'bare track on the rams', build: (l) => bareLift(l, 'track') },
    ],
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
