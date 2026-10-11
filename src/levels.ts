import type { MaterialId } from './physics/materials';
import type { VehicleId } from './physics/vehicles';
import type { Flood, March, Quake, Wind } from './physics/world';
import { levels as tunedLevels } from './levels.res';

export type Pt = [number, number];

/** A slim steel pylon: [x, baseY, topY]. Decks may pass through it; its anchors are listed with the level's. */
export type Tower = [number, number, number];

/** A rock overhang above one approach road, from `bottom` up to `top`, reaching `reach` m over the gap. */
export interface Overhang {
  side: 'left' | 'right';
  bottom: number;
  top: number;
  reach: number;
}

/** An optional extra goal on top of the three stars. Meeting it earns the bonus star. */
export type BonusGoal =
  /** Build for this many dollars or less. */
  | { kind: 'cost'; max: number }
  /** Keep peak stress below this ratio. */
  | { kind: 'stress'; max: number }
  /** Use this many parts or fewer. A split beam counts once. */
  | { kind: 'parts'; max: number }
  /** Build without this material. */
  | { kind: 'without'; mat: MaterialId };

export interface LevelDef {
  id: number;
  name: string;
  tip: string;
  /** Gap between the two banks; the left bank top is at (0, 0). */
  width: number;
  /** Height of the right bank's top edge (defaults to 0, level with the left). */
  rightY?: number;
  anchors: Pt[];
  /**
   * Concrete piers rise from the water to these points. Most are topped by a bolt; one without
   * is a seat, where a deck rests and can lift off.
   */
  piers: Pt[];
  /** Materials offered on this level, in toolbar order. */
  materials: MaterialId[];
  /** Cash available for the whole bridge, in dollars. */
  money: number;
  /** Building for this much or less earns a star. */
  target: number;
  vehicle: VehicleId;
  waterY: number;
  towers?: Tower[];
  /**
   * Steel masts on a hinge at their foot: [x, baseY, topY], with a bolt on top that is not one of
   * the level's anchors, since it tips freely. It only pushes down, so backstays have to hold it.
   */
  masts?: Tower[];
  overhangs?: Overhang[];
  /**
   * Masses of rock rising from the riverbed: [x0, x1, top], such as a shelf at the foot of a
   * canyon wall or an island in the river. Nothing may be built inside one; concrete blocks bear
   * on its top and sides.
   */
  rocks?: [number, number, number][];
  /** Ship channels: [x0, x1, top]. Nothing may be built between x0 and x1 from the water up to `top`. */
  channels?: [number, number, number][];
  bonus: BonusGoal;
  /** Vehicles following the first one across, in order: a convoy. */
  convoy?: VehicleId[];
  /**
   * A second deck below the road, at height `y`, with traffic of its own crossing at the same time:
   * it comes out of a tunnel in each bank, with its own road ends there.
   */
  lower?: { y: number; vehicle: VehicleId; convoy?: VehicleId[] };
  /**
   * A tall ship sails through the first channel before traffic may go, with its mast up to
   * this height: the bridge has to open for it, on hydraulic rams, and close again. With `after`,
   * the ship waits for the traffic instead: it crosses first, then the bridge opens and the ship
   * passes.
   */
  ship?: { mast: number; after?: boolean };
  /**
   * A swing bridge: it opens by turning on the bolt at x = `pivot`, its road ends lifting off the
   * banks, so while it's open the whole bridge hangs from the pivot as a balanced cantilever.
   */
  swing?: { pivot: number };
  /**
   * A double-leaf drawbridge's center lock at x = `lock`: while the bridge is shut, the deck joints
   * either side of it, within a meter, are held level with each other, so the two leaves share the
   * load; it lets go as they open.
   */
  lock?: number;
  /**
   * A lift bridge's guide towers, at these x: whatever rests on a seat there runs in the tower's
   * rails, free to rise and fall but held from swaying along, so rams can lift a span straight up.
   */
  lift?: number[];
  /**
   * The train brakes hard on the bridge once its front reaches x = `at`, comes to a stop, waits
   * `hold` seconds and goes on: its wheels push the deck forward while it stops.
   */
  brake?: { at: number; hold?: number };
  /**
   * The two road ends rest on sliding bearings: they hold the bridge up and down but let it move
   * along its length, so a braking train's shove has to be braced down to the low bolts.
   */
  sliding?: boolean;
  /** Gusting wind that pushes on the bridge and lifts its deck. */
  wind?: Wind;
  /** An earthquake partway through the test. */
  quake?: Quake;
  /** Soldiers marching in step: the vehicles that march press on the deck with every step. */
  march?: March;
  /**
   * Soft riverbed: mud banks [x0, x1, top]. A bolt on mud sinks once it carries more than the
   * mud holds, and a flood washes it out.
   */
  mud?: [number, number, number][];
  /** Piles the player may drive into the mud, on whole meters along its top, at a price each: bolts that hold. */
  piles?: { price: number };
  /** A flood partway through the test: the river rises, pushes on what stands in it and scours the mud. */
  flood?: Flood;
  /** Most parts of a material a level allows, on top of the budget. A split beam counts once. */
  limits?: Partial<Record<MaterialId, number>>;
  /** Price of building from an anchor, charged once per anchor used; the two road ends are free. */
  anchorCost?: number;
  /**
   * Concrete anchors on offer: blocks the player sets into either bank, on whole meters from
   * 1 m to `reach` m back from the edge, at a price each. See BLOCK in materials.
   */
  blocks?: { reach: number; tonnes?: number };
  /** Highest a joint may go, m, where players raise their own tall towers. */
  ceiling?: number;
  /** Scene for the test drive, by theme id. Built-in levels use their chapter's; custom levels pick one. */
  theme?: string;
  /**
   * Ghost members drawn as a hint until the first test, for levels that introduce a mechanic.
   * A deck ghost may span a whole road run, and a ghost that ends partway along another shows
   * where that beam gets split.
   */
  hint?: [Pt, Pt, MaterialId][];
  /** The hint is a whole working bridge, not just a new mechanic: TEST pulses once it is built. */
  hintSolves?: boolean;
}

/** What the level optimizer (tools/tune) decides: the money, and any geometry it was allowed to adjust. */
export type Tuned = Pick<LevelDef, 'money' | 'target' | 'bonus'> & { geometry?: Partial<Pick<LevelDef, GeometryKey>> };

/** Level fields the optimizer may adjust when a level marks them as tunable. */
export type GeometryKey = 'width' | 'rightY' | 'anchors' | 'piers' | 'waterY' | 'towers' | 'overhangs' | 'channels' | 'hint';

/** A level as authored: everything but the numbers the optimizer tunes. */
export type LevelBase = Omit<LevelDef, 'money' | 'target' | 'bonus'>;

/** The optimizer's output, generated by `npm run tune` and packed into src/levels.res. */
export const TUNED: { levels: Record<string, Tuned & { fingerprint?: string }> } = { levels: tunedLevels };

/** A level with its tuned numbers and geometry applied. */
export function applyTuning(base: LevelBase, t: Tuned): LevelDef {
  return { ...base, ...t.geometry, money: t.money, target: t.target, bonus: t.bonus };
}

export const BASE_LEVELS: LevelBase[] = [
  {
    id: 1,
    name: 'First Crossing',
    tip: 'Drag from a red bolt to lay road. Brace it from below with wood.',
    width: 4,
    anchors: [[0, 0], [4, 0], [0, -2], [4, -2]],
    piers: [],
    materials: ['road', 'wood'],
    vehicle: 'car',
    waterY: -4,
    hint: [
      [[0, 0], [2, 0], 'road'],
      [[2, 0], [4, 0], 'road'],
      [[0, -2], [2, 0], 'wood'],
      [[4, -2], [2, 0], 'wood'],
    ],
    hintSolves: true,
  },
  {
    id: 2,
    name: 'Babbling Brook',
    tip: 'Triangles are rigid. Squares fold.',
    width: 6,
    anchors: [[0, 0], [6, 0], [0, -2], [6, -2]],
    piers: [],
    materials: ['road', 'wood'],
    vehicle: 'car',
    waterY: -4,
  },
  {
    id: 3,
    name: 'Over the Top',
    tip: 'No low anchors here: build your truss above the road.',
    width: 8,
    anchors: [[0, 0], [8, 0]],
    piers: [],
    materials: ['road', 'wood'],
    vehicle: 'car',
    waterY: -5,
  },
  {
    id: 4,
    name: 'Steel Delivery',
    tip: 'Steel is strong and long, but scarce. Spend it where stress runs red.',
    width: 10,
    anchors: [[0, 0], [10, 0], [0, -3], [10, -3]],
    piers: [],
    materials: ['road', 'wood', 'steel'],
    vehicle: 'van',
    waterY: -5,
  },
  {
    id: 5,
    name: 'Uphill Climb',
    tip: 'The far bank is higher. Drag one long road run and the pieces follow the slope.',
    width: 10,
    rightY: 2,
    anchors: [[0, 0], [10, 2], [0, -2], [10, 0]],
    piers: [],
    materials: ['road', 'wood', 'steel'],
    vehicle: 'van',
    waterY: -5,
  },
  {
    id: 6,
    name: 'Stepping Stone',
    tip: 'A pier in the middle halves the span.',
    width: 12,
    anchors: [[0, 0], [12, 0], [6, -3]],
    piers: [[6, -3]],
    materials: ['road', 'wood', 'steel'],
    vehicle: 'van',
    waterY: -6,
  },
  {
    id: 7,
    name: 'Heavy Haul',
    tip: 'A 22 t dump truck. Road carries up to 30 t, but the truss under it has to carry the rest.',
    width: 12,
    anchors: [[0, 0], [12, 0], [0, -2], [12, -2]],
    piers: [],
    materials: ['road', 'wood', 'steel'],
    vehicle: 'truck',
    waterY: -5,
  },
  {
    id: 8,
    name: 'Canyon Run',
    tip: 'Long compression members buckle. Keep them short.',
    width: 14,
    anchors: [[0, 0], [14, 0], [0, -3], [14, -3]],
    piers: [],
    materials: ['road', 'wood', 'steel'],
    vehicle: 'truck',
    waterY: -7,
  },
  {
    id: 9,
    name: 'Down the Gorge',
    tip: 'Downhill run. Steel is plentiful here: brace the low end well.',
    width: 12,
    rightY: -1,
    anchors: [[0, 0], [12, -1], [0, -3], [12, -3]],
    piers: [],
    materials: ['road', 'wood', 'steel'],
    vehicle: 'van',
    waterY: -7,
  },
  {
    id: 10,
    name: 'Twin Towers',
    tip: 'High anchors love steel in tension.',
    width: 14,
    anchors: [[0, 0], [14, 0], [0, 3], [14, 3]],
    piers: [],
    materials: ['road', 'wood', 'steel'],
    vehicle: 'truck',
    waterY: -6,
  },
  {
    id: 11,
    name: 'School Run',
    tip: 'Precious cargo. Keep it green.',
    width: 16,
    anchors: [[0, 0], [16, 0], [8, -3], [0, -2], [16, -2]],
    piers: [[8, -3]],
    materials: ['road', 'wood', 'steel'],
    vehicle: 'bus',
    waterY: -7,
  },
  {
    id: 12,
    name: 'The Grand Span',
    tip: 'Everything you have learned. Good luck, engineer.',
    width: 20,
    anchors: [[0, 0], [20, 0], [6, -3], [14, -3]],
    piers: [[6, -3], [14, -3]],
    materials: ['road', 'wood', 'steel'],
    vehicle: 'bus',
    waterY: -7,
  },
  {
    id: 13,
    name: 'Hanging On',
    tip: 'Cables only pull, never push, and they cost more than wood. Hang the middle; push the ends up from below.',
    width: 14,
    anchors: [[0, 0], [14, 0], [0, 6], [14, 6], [0, -2], [14, -2]],
    piers: [],
    towers: [[0, 0, 6], [14, 0, 6]],
    materials: ['road', 'wood', 'steel', 'cable'],
    vehicle: 'van',
    // Cables have to do the work: too few beams for a truss under the deck.
    limits: { wood: 6, steel: 2 },
    waterY: -6,
    hint: [
      [[0, 0], [14, 0], 'road'],
      [[0, 6], [6, 0], 'cable'],
      [[14, 6], [8, 0], 'cable'],
    ],
  },
  {
    id: 14,
    name: 'Stayed',
    tip: 'Long cables from one pylon get expensive. Hang a few joints and stiffen the deck between them.',
    width: 18,
    anchors: [[0, 0], [18, 0], [9, 7], [0, -2], [18, -2]],
    piers: [],
    towers: [[9, -7, 7]],
    materials: ['road', 'wood', 'steel', 'cable'],
    vehicle: 'van',
    // Cables have to do the work: too few beams for a truss under the deck.
    limits: { wood: 10, steel: 2, cable: 4 },
    waterY: -7,
  },
  {
    id: 15,
    name: 'Cliffhanger',
    tip: 'The middle is out of reach from the cliffs. Cables can meet in mid-air.',
    width: 16,
    anchors: [[0, 0], [16, 0], [1, 9], [15, 9]],
    piers: [],
    overhangs: [
      { side: 'left', bottom: 4, top: 13, reach: 1.2 },
      { side: 'right', bottom: 4, top: 13, reach: 1.2 },
    ],
    materials: ['road', 'wood', 'steel', 'cable'],
    vehicle: 'truck',
    // Cables have to do the work: too few beams for a truss under the deck.
    limits: { wood: 6, steel: 4 },
    waterY: -8,
  },
  {
    id: 16,
    name: 'Mid-span',
    tip: 'Drag from the middle of a beam to add a joint there. Split pieces cost nothing extra.',
    width: 16,
    anchors: [[0, 0], [16, 0], [0, -3], [16, -3]],
    piers: [],
    materials: ['road', 'wood', 'steel', 'cable'],
    vehicle: 'van',
    waterY: -7,
    hint: [
      [[0, 0], [16, 0], 'road'],
      [[0, 0], [2, 2], 'steel'],
      [[2, 2], [6, 2], 'steel'],
      [[4, 0], [4, 2], 'wood'],
    ],
  },
  {
    id: 17,
    name: 'Big Rig',
    tip: 'Forty tonnes of trouble. Heavy deck carries what road cannot.',
    width: 20,
    anchors: [[0, 0], [20, 0], [10, -4], [0, -3], [20, -3]],
    piers: [[10, -4]],
    materials: ['road', 'heavy', 'wood', 'steel', 'cable'],
    vehicle: 'semi',
    waterY: -7,
  },
  {
    id: 18,
    name: 'Valley Drop',
    tip: 'One tall pylon, one short one. Cables pull from above; struts push from below.',
    width: 24,
    rightY: -3,
    anchors: [[0, 0], [24, -3], [8, 7], [16, -5], [0, -3], [24, -6]],
    piers: [],
    towers: [[8, -9, 7], [16, -9, -5]],
    materials: ['road', 'heavy', 'wood', 'steel', 'cable'],
    vehicle: 'truck',
    // Cables have to do the work: too few beams for a truss under the deck.
    limits: { wood: 6, steel: 6 },
    waterY: -9,
  },
  {
    id: 19,
    name: 'Twin Pylons',
    tip: 'The pylon tops are out of cable reach. String a main cable between them, then drop hangers to the deck.',
    width: 28,
    anchors: [[0, 0], [28, 0], [6, 0], [22, 0], [6, 12], [22, 12], [0, -3], [28, -3]],
    piers: [],
    towers: [[6, -8, 12], [22, -8, 12]],
    materials: ['road', 'heavy', 'wood', 'steel', 'cable'],
    vehicle: 'bus',
    // Cables have to do the work: too few beams for a truss under the deck.
    limits: { wood: 12, steel: 6 },
    waterY: -8,
  },
  {
    id: 20,
    name: 'The Long Way',
    tip: 'Thirty-two meters and a school bus. Main cables need sag: a straight cable cannot carry a load.',
    width: 32,
    anchors: [[0, 0], [32, 0], [16, -4], [8, 11], [24, 11], [0, 4], [32, 4], [0, -3], [32, -3]],
    piers: [[16, -4]],
    towers: [[8, -9, 11], [24, -9, 11], [0, 0, 4], [32, 0, 4]],
    materials: ['road', 'heavy', 'wood', 'steel', 'cable'],
    vehicle: 'bus',
    // Cables have to do the work: too few beams for a truss under the deck.
    limits: { wood: 6, steel: 4 },
    waterY: -9,
  },
  {
    id: 21,
    name: 'Sawhorse',
    tip: 'A rock in the middle of the stream. Lean on it.',
    width: 8,
    anchors: [[0, 0], [8, 0], [4, -2]],
    piers: [[4, -2]],
    materials: ['road', 'wood'],
    vehicle: 'car',
    waterY: -5,
  },
  {
    id: 22,
    name: 'Two Piers',
    tip: 'Three short spans are easier than one long one.',
    width: 18,
    anchors: [[0, 0], [18, 0], [6, -2], [12, -2], [0, -2], [18, -2]],
    piers: [[6, -2], [12, -2]],
    materials: ['road', 'wood', 'steel'],
    vehicle: 'van',
    waterY: -6,
  },
  {
    id: 23,
    name: 'High Water',
    tip: 'The river is up. There is no room under the deck: build above it.',
    width: 14,
    anchors: [[0, 0], [14, 0]],
    piers: [],
    materials: ['road', 'wood', 'steel'],
    vehicle: 'van',
    waterY: -1.5,
  },
  {
    id: 24,
    name: 'Ferry Lane',
    tip: 'Ships need the channel. Ramp the road up and over, and let the pylons help.',
    width: 24,
    anchors: [[0, 0], [24, 0], [7, 10], [17, 10], [0, -2], [24, -2]],
    piers: [],
    towers: [[7, -2, 10], [17, -2, 10]],
    channels: [[8, 16, 1.5]],
    materials: ['road', 'wood', 'steel', 'cable'],
    vehicle: 'truck',
    waterY: -2,
    hint: [
      [[0, 0], [8, 2], 'road'],
      [[8, 2], [16, 2], 'road'],
      [[16, 2], [24, 0], 'road'],
    ],
  },
  {
    id: 25,
    name: 'Switchback',
    tip: 'A steep climb with a full load. The pier takes half the work.',
    width: 20,
    rightY: 4,
    anchors: [[0, 0], [20, 4], [10, -2], [0, -2], [20, 2]],
    piers: [[10, -2]],
    materials: ['road', 'heavy', 'wood', 'steel', 'cable'],
    vehicle: 'truck',
    waterY: -6,
  },
  {
    id: 26,
    name: 'Overpass',
    tip: 'Rock on one side, a pylon on the other. Meet in the middle.',
    width: 22,
    anchors: [[0, 0], [22, 0], [1, 8], [16, 8]],
    piers: [],
    towers: [[16, -8, 8]],
    overhangs: [{ side: 'left', bottom: 4, top: 12, reach: 1.2 }],
    materials: ['road', 'heavy', 'wood', 'steel', 'cable'],
    vehicle: 'truck',
    waterY: -8,
  },
  {
    id: 27,
    name: 'Gauntlet',
    tip: 'The piers sit deep. Build trestles up to the deck.',
    width: 26,
    anchors: [[0, 0], [26, 0], [9, -6], [17, -6], [0, -3], [26, -3]],
    piers: [[9, -6], [17, -6]],
    materials: ['road', 'heavy', 'wood', 'steel', 'cable'],
    vehicle: 'bus',
    waterY: -8,
  },
  {
    id: 28,
    name: 'Iron Horse',
    tip: 'Twenty-four meters, one pier, one semi truck.',
    width: 24,
    anchors: [[0, 0], [24, 0], [12, -4], [0, -3], [24, -3]],
    piers: [[12, -4]],
    materials: ['road', 'heavy', 'wood', 'steel', 'cable'],
    vehicle: 'semi',
    waterY: -7,
  },
  {
    id: 29,
    name: 'Sky Road',
    tip: 'Hang the middle from the pylons. Truss the ends.',
    width: 34,
    anchors: [[0, 0], [34, 0], [8, 0], [26, 0], [8, 12], [26, 12], [0, -3], [34, -3]],
    piers: [],
    towers: [[8, -8, 12], [26, -8, 12]],
    materials: ['road', 'heavy', 'wood', 'steel', 'cable'],
    vehicle: 'truck',
    // Cables have to do the work: too few beams for a truss under the deck.
    limits: { wood: 20, steel: 4 },
    waterY: -8,
  },
  {
    id: 30,
    name: 'Magnum Opus',
    tip: 'Thirty-six meters, forty tonnes and a ship channel. Everything you know.',
    width: 36,
    anchors: [[0, 0], [36, 0], [8, 0], [28, 0], [8, 14], [28, 14], [0, -3], [36, -3]],
    piers: [],
    towers: [[8, -8, 14], [28, -8, 14]],
    channels: [[9, 27, 0]],
    materials: ['road', 'heavy', 'wood', 'steel', 'cable'],
    vehicle: 'semi',
    waterY: -8,
  },
  {
    id: 31,
    name: 'Bascule',
    tip: 'Trace the ghost: a road hinged at the bank, a wood truss to stiffen it, and a ram on the pier to lift it for the ship.',
    width: 8,
    anchors: [[0, 0], [4, -3]],
    piers: [[4, -3]],
    channels: [[5, 8, 0]],
    ship: { mast: 3 },
    materials: ['road', 'wood', 'steel', 'ram'],
    vehicle: 'car',
    waterY: -5,
    hint: [
      [[0, 0], [8, 0], 'road'],
      [[4, -3], [4, 0], 'ram'],
      [[0, 0], [2, 2], 'wood'],
      [[2, 0], [2, 2], 'wood'],
      [[2, 2], [4, 2], 'wood'],
      [[4, 0], [4, 2], 'wood'],
      [[2, 2], [4, 0], 'wood'],
      [[4, 2], [6, 2], 'wood'],
      [[6, 0], [6, 2], 'wood'],
      [[6, 2], [4, 0], 'wood'],
      [[6, 2], [8, 0], 'wood'],
    ],
    hintSolves: true,
  },
  {
    id: 32,
    name: 'Convoy',
    tip: 'Three vans, nose to tail, all on the bridge at once. Steel is rationed.',
    width: 14,
    anchors: [[0, 0], [14, 0], [7, -3], [0, -2], [14, -2]],
    piers: [[7, -3]],
    materials: ['road', 'wood', 'steel'],
    vehicle: 'van',
    convoy: ['van', 'van'],
    limits: { steel: 6 },
    waterY: -5,
  },
  {
    id: 33,
    name: 'Toll Bridge',
    tip: 'Every bolt off the road costs $3,000 to build from. Choose your piers.',
    width: 20,
    anchors: [[0, 0], [20, 0], [6, -2], [10, -2], [14, -2], [0, -2], [20, -2]],
    piers: [[6, -2], [10, -2], [14, -2]],
    materials: ['road', 'wood', 'steel'],
    vehicle: 'truck',
    anchorCost: 3000,
    waterY: -5,
  },
  {
    id: 34,
    name: 'Harbor Gate',
    tip: 'A fixed span out to the pier, then a leaf that lifts for the ship.',
    width: 16,
    anchors: [[0, 0], [8, 0], [12, -3], [0, -3]],
    piers: [[8, 0], [12, -3]],
    channels: [[13, 16, 0]],
    ship: { mast: 3 },
    materials: ['road', 'wood', 'steel', 'ram'],
    vehicle: 'truck',
    waterY: -5,
  },
  {
    id: 35,
    name: 'Rush Hour',
    tip: 'The ship goes first, then a car, a van and a dump truck. One ram to lift it all.',
    width: 10,
    anchors: [[0, 0], [6, -4], [0, -3]],
    piers: [[6, -4]],
    channels: [[7, 10, 0]],
    ship: { mast: 4 },
    materials: ['road', 'heavy', 'wood', 'steel', 'ram'],
    vehicle: 'car',
    convoy: ['van', 'truck'],
    limits: { ram: 1 },
    waterY: -5,
  },
  {
    id: 36,
    name: 'Deadweight',
    tip: 'The masts only push down. Run a backstay from each mast top to a concrete anchor on the bank, or the main cable pulls them over.',
    width: 16,
    anchors: [[0, 0], [16, 0], [0, -2], [16, -2]],
    piers: [],
    masts: [[3, -5, 8], [13, -5, 8]],
    blocks: { reach: 6 },
    materials: ['road', 'wood', 'cable'],
    vehicle: 'car',
    // A wood truss could carry the car alone; this leaves enough for a strut or two.
    limits: { wood: 4 },
    waterY: -5,
    hint: [
      [[0, 0], [16, 0], 'road'],
      [[3, 8], [4, 6], 'cable'],
      [[4, 6], [6, 4], 'cable'],
      [[6, 4], [8, 3], 'cable'],
      [[8, 3], [10, 4], 'cable'],
      [[10, 4], [12, 6], 'cable'],
      [[12, 6], [13, 8], 'cable'],
      [[4, 6], [4, 0], 'cable'],
      [[6, 4], [6, 0], 'cable'],
      [[8, 3], [8, 0], 'cable'],
      [[10, 4], [10, 0], 'cable'],
      [[12, 6], [12, 0], 'cable'],
      [[3, 8], [2, 0], 'cable'],
      [[13, 8], [14, 0], 'cable'],
      [[3, 8], [0, 4], 'cable'],
      [[0, 4], [-3, 0], 'cable'],
      [[13, 8], [16, 4], 'cable'],
      [[16, 4], [19, 0], 'cable'],
    ],
    hintSolves: true,
  },
  {
    id: 37,
    name: 'Lift-Off',
    tip: 'Tall masts and little room behind them. A steep backstay pulls straight up, and a block only weighs so much.',
    width: 18,
    anchors: [[0, 0], [18, 0], [0, -2], [18, -2]],
    piers: [],
    masts: [[2, -5, 10], [16, -5, 10]],
    blocks: { reach: 4 },
    materials: ['road', 'wood', 'cable'],
    vehicle: 'truck',
    limits: { wood: 4 },
    waterY: -5,
  },
  {
    id: 38,
    name: 'Raise Your Own',
    tip: 'No masts this time. Brace a steel tower on each pair of piers, anchor it back, and hang a stiff heavy deck from it.',
    width: 24,
    anchors: [[0, 0], [24, 0], [2, 0], [4, 0], [20, 0], [22, 0]],
    piers: [[2, 0], [4, 0], [20, 0], [22, 0]],
    blocks: { reach: 6 },
    materials: ['road', 'heavy', 'wood', 'steel', 'cable'],
    vehicle: 'bus',
    limits: { wood: 6, steel: 14 },
    waterY: -6,
  },
  {
    id: 39,
    name: 'Side Spans',
    tip: 'The backstays can carry more than the masts: hang the side spans from them too.',
    width: 30,
    anchors: [[0, 0], [30, 0], [0, -3], [30, -3]],
    piers: [],
    masts: [[8, -6, 12], [22, -6, 12]],
    blocks: { reach: 8 },
    materials: ['road', 'heavy', 'wood', 'steel', 'cable'],
    vehicle: 'truck',
    limits: { wood: 4, steel: 4 },
    waterY: -6,
  },
  {
    id: 40,
    name: 'Anchorage',
    tip: 'Forty tonnes on a hung deck. One block per side will not hold it.',
    width: 36,
    anchors: [[0, 0], [36, 0], [0, -3], [36, -3]],
    piers: [],
    masts: [[8, -7, 12], [28, -7, 12]],
    blocks: { reach: 10 },
    materials: ['road', 'heavy', 'wood', 'steel', 'cable'],
    vehicle: 'semi',
    limits: { wood: 4, steel: 4 },
    waterY: -7,
  },
  {
    id: 41,
    name: 'Saddle',
    tip: 'Lay the main cable in one drag from mast to mast, then drag the ring on it to set the sag. Hang the deck from its joints, and anchor each mast back to the bank.',
    width: 40,
    anchors: [[0, 0], [40, 0]],
    piers: [],
    masts: [[4, -6, 10], [36, -6, 10]],
    blocks: { reach: 10, tonnes: 20 },
    materials: ['road', 'cable', 'main'],
    vehicle: 'truck',
    // Room for the hangers, but not for a main cable pieced together from plain cable as well.
    limits: { cable: 20 },
    waterY: -6,
    hint: [
      [[0, 0], [16, 0], 'road'],
      [[16, 0], [32, 0], 'road'],
      [[32, 0], [40, 0], 'road'],
      [[4, 10], [36, 10], 'main'],
      [[4, 10], [-8, 0], 'main'],
      [[36, 10], [48, 0], 'main'],
      [[4, 10], [4, 0], 'cable'],
      [[36, 10], [36, 0], 'cable'],
      [[6, 9.25], [6, 0], 'cable'],
      [[8, 8.6], [8, 0], 'cable'],
      [[10, 8.05], [10, 0], 'cable'],
      [[12, 7.6], [12, 0], 'cable'],
      [[14, 7.25], [14, 0], 'cable'],
      [[16, 7], [16, 0], 'cable'],
      [[18, 6.85], [18, 0], 'cable'],
      [[20, 6.8], [20, 0], 'cable'],
      [[22, 6.85], [22, 0], 'cable'],
      [[24, 7], [24, 0], 'cable'],
      [[26, 7.25], [26, 0], 'cable'],
      [[28, 7.6], [28, 0], 'cable'],
      [[30, 8.05], [30, 0], 'cable'],
      [[32, 8.6], [32, 0], 'cable'],
      [[34, 9.25], [34, 0], 'cable'],
      [[2, 8], [2, 0], 'cable'],
      [[38, 8], [38, 0], 'cable'],
    ],
    hintSolves: true,
  },
  {
    id: 42,
    name: 'Concrete Pylons',
    tip: 'Raise your own towers on the pier pairs. Concrete takes the crushing weight of a long span, but it cracks if pulled: brace it with steel.',
    width: 48,
    anchors: [[0, 0], [48, 0], [2, 0], [6, 0], [42, 0], [46, 0]],
    piers: [[2, 0], [6, 0], [42, 0], [46, 0]],
    blocks: { reach: 10, tonnes: 20 },
    ceiling: 16,
    materials: ['road', 'heavy', 'steel', 'cable', 'main', 'concrete'],
    vehicle: 'bus',
    waterY: -6,
  },
  {
    id: 43,
    name: 'One Tower',
    tip: 'A single tall tower in the middle carries both spans. Run the main cable from one bank over its peak to the other.',
    width: 56,
    anchors: [[0, 0], [56, 0], [0, -3], [56, -3], [26, 0], [30, 0]],
    piers: [[26, 0], [30, 0]],
    blocks: { reach: 10, tonnes: 20 },
    ceiling: 18,
    materials: ['road', 'heavy', 'steel', 'cable', 'main', 'concrete'],
    vehicle: 'truck',
    waterY: -6,
  },
  {
    id: 44,
    name: 'Uneven Banks',
    tip: 'The far bank stands six meters higher. Give each tower the height its side needs.',
    width: 52,
    rightY: 6,
    anchors: [[0, 0], [52, 6], [2, 0], [6, 0], [46, 6], [50, 6]],
    piers: [[2, 0], [6, 0], [46, 6], [50, 6]],
    blocks: { reach: 10, tonnes: 20 },
    ceiling: 22,
    materials: ['road', 'heavy', 'steel', 'cable', 'main', 'concrete'],
    vehicle: 'bus',
    waterY: -6,
  },
  {
    id: 45,
    name: 'Tall Ships',
    tip: 'Sixty-four meters, forty tonnes, and the ships need the channel clear. Lift the deck over it, and give each tower more than one anchor.',
    width: 64,
    anchors: [[0, 0], [64, 0], [2, 0], [6, 0], [58, 0], [62, 0]],
    piers: [[2, 0], [6, 0], [58, 0], [62, 0]],
    channels: [[20, 44, 3]],
    blocks: { reach: 12, tonnes: 20 },
    ceiling: 21,
    materials: ['road', 'heavy', 'steel', 'cable', 'main', 'concrete'],
    vehicle: 'semi',
    waterY: -6,
  },
  {
    id: 46,
    name: 'Keystone',
    tip: 'Stack blocks on each shelf, drag a block arch from tower to tower under the road, then stand wood posts on it to carry the road.',
    width: 16,
    anchors: [[0, 0], [16, 0]],
    piers: [],
    rocks: [[0, 2, -6], [14, 16, -6]],
    materials: ['road', 'wood', 'masonry', 'arch'],
    vehicle: 'van',
    // Posts for the arch, but not a truss.
    limits: { wood: 9 },
    waterY: -9,
    hint: [
      [[0, 0], [16, 0], 'road'],
      [[0, -6], [1, -5], 'masonry'],
      [[1, -6], [2, -5], 'masonry'],
      [[14, -6], [15, -5], 'masonry'],
      [[15, -6], [16, -5], 'masonry'],
      [[0, -5], [1, -4], 'masonry'],
      [[1, -5], [2, -4], 'masonry'],
      [[14, -5], [15, -4], 'masonry'],
      [[15, -5], [16, -4], 'masonry'],
      [[0, -4], [1, -3], 'masonry'],
      [[1, -4], [2, -3], 'masonry'],
      [[14, -4], [15, -3], 'masonry'],
      [[15, -4], [16, -3], 'masonry'],
      [[2, -3], [14, -3], 'arch'],
      [[0, -3], [0, 0], 'wood'],
      [[2, -3], [2, 0], 'wood'],
      [[4, -1.1667], [4, 0], 'wood'],
      [[6, -0.6667], [6, 0], 'wood'],
      [[8, -0.5], [8, 0], 'wood'],
      [[10, -0.6667], [10, 0], 'wood'],
      [[12, -1.1667], [12, 0], 'wood'],
      [[14, -3], [14, 0], 'wood'],
      [[16, -3], [16, 0], 'wood'],
    ],
    hintSolves: true,
  },
  {
    id: 47,
    name: 'Hanging Deck',
    tip: 'Deep water right up to both walls: nothing to stand an arch on. Spring it from the bank bolts instead, up over the road, and hang the deck from it on cables.',
    width: 20,
    anchors: [[0, 0], [20, 0]],
    piers: [],
    materials: ['road', 'cable', 'arch'],
    vehicle: 'truck',
    ceiling: 6,
    waterY: -9,
    hint: [[[0, 0], [20, 0], 'arch']],
  },
  {
    id: 48,
    name: 'High and Low',
    tip: 'The far shelf is higher than the near one. An arch can spring from both: it just leans.',
    width: 20,
    rightY: 3,
    anchors: [[0, 0], [20, 3]],
    piers: [],
    rocks: [[0, 2, -4], [18, 20, -1]],
    materials: ['road', 'wood', 'steel', 'masonry', 'arch'],
    vehicle: 'truck',
    limits: { wood: 14, steel: 14 },
    waterY: -7,
  },
  {
    id: 49,
    name: 'Short Supply',
    tip: 'Only four blocks, too few for towers. Out on a shelf they crack under the thrust: stack them against the walls, which push back, and spring a high arch from their tops.',
    width: 24,
    anchors: [[0, 0], [24, 0]],
    piers: [],
    rocks: [[0, 2, -7], [22, 24, -7]],
    materials: ['road', 'wood', 'steel', 'masonry', 'arch'],
    vehicle: 'truck',
    limits: { masonry: 4, wood: 12, steel: 12 },
    waterY: -10,
  },
  {
    id: 50,
    name: 'Grand Viaduct',
    tip: 'Forty-eight meters for a semi, and the channel must stay clear. Build the island piers up to the road, arch under it to the walls, and over the channel hang the deck from an arch above.',
    width: 48,
    anchors: [[0, 0], [48, 0]],
    piers: [],
    rocks: [[0, 2, -5], [15, 17, -5], [31, 33, -5], [46, 48, -5]],
    channels: [[17, 31, -1]],
    materials: ['road', 'heavy', 'steel', 'cable', 'masonry', 'arch'],
    vehicle: 'semi',
    // Room for an arch over the channel, but not for one over the whole gorge.
    ceiling: 5,
    limits: { steel: 30 },
    waterY: -7,
  },
  {
    id: 51,
    name: 'Branch Line',
    tip: 'Lay track across in one run, like road. Stand a truss over it, steel chords with wood between, and strut it down to the low bolts: the whole train is on the bridge at once.',
    width: 12,
    anchors: [[0, 0], [12, 0], [0, -3], [12, -3]],
    piers: [],
    materials: ['track', 'wood', 'steel'],
    vehicle: 'loco',
    convoy: ['wagon'],
    waterY: -6,
    hint: [
      [[0, 0], [12, 0], 'track'],
      [[0, 0], [2, 2], 'steel'],
      [[0, -3], [2, 0], 'steel'],
      [[2, 2], [4, 2], 'steel'],
      [[2, 2], [4, 0], 'steel'],
      [[4, 2], [6, 2], 'steel'],
      [[6, 2], [8, 2], 'steel'],
      [[8, 2], [10, 2], 'steel'],
      [[10, 2], [8, 0], 'steel'],
      [[10, 2], [12, 0], 'steel'],
      [[12, -3], [10, 0], 'steel'],
      [[2, 0], [2, 2], 'wood'],
      [[4, 0], [4, 2], 'wood'],
      [[4, 2], [6, 0], 'wood'],
      [[6, 0], [6, 2], 'wood'],
      [[8, 2], [6, 0], 'wood'],
      [[8, 0], [8, 2], 'wood'],
      [[10, 0], [10, 2], 'wood'],
    ],
    hintSolves: true,
  },
  {
    id: 52,
    name: 'Freight',
    tip: 'Four cars, a hundred and twenty tonnes, nose to tail. The pier in the middle can take half of it.',
    width: 24,
    anchors: [[0, 0], [24, 0], [0, -3], [24, -3], [12, -2]],
    piers: [[12, -2]],
    materials: ['track', 'wood', 'steel'],
    vehicle: 'loco',
    convoy: ['wagon', 'wagon', 'wagon'],
    waterY: -7,
  },
  {
    id: 53,
    name: 'Gentle Grade',
    tip: 'The far bank is higher. Track climbs no more than 3%, so lay one straight run and build down to the piers from it.',
    width: 30,
    rightY: 0.9,
    anchors: [[0, 0], [30, 0.9], [10, -2], [20, -2]],
    piers: [[10, -2], [20, -2]],
    materials: ['track', 'wood', 'steel'],
    vehicle: 'loco',
    convoy: ['wagon', 'wagon'],
    waterY: -6,
  },
  {
    id: 54,
    name: 'Signal Stop',
    tip: 'A red signal: the train brakes to a stop out on the span. The bridge rests on sliding bearings, so brace it down to the low bolts both ways, or it rides along.',
    width: 16,
    anchors: [[0, 0], [16, 0], [0, -3], [16, -3]],
    piers: [],
    materials: ['track', 'wood', 'steel', 'cable'],
    vehicle: 'loco',
    convoy: ['wagon', 'wagon'],
    brake: { at: 13, hold: 2 },
    // On sliding bearings, the braking shove has to go down to the low bolts.
    sliding: true,
    waterY: -7,
  },
  {
    id: 55,
    name: 'Viaduct',
    tip: 'Forty meters over the valley, on block arches from island to island, the way the old railways crossed.',
    width: 40,
    anchors: [[0, 0], [40, 0]],
    piers: [],
    rocks: [[0, 2, -6], [13, 15, -6], [25, 27, -6], [38, 40, -6]],
    materials: ['track', 'steel', 'masonry', 'arch'],
    vehicle: 'loco',
    convoy: ['wagon', 'wagon', 'wagon'],
    limits: { steel: 30 },
    waterY: -8,
  },
  {
    id: 56,
    name: 'Slow March',
    tip: 'Soldiers in step: every boot lands at once, a pace a second, and a suspension bridge swings in time with them. Brace the deck to the rocks with dampers: they give under the truck but fight the swing.',
    width: 40,
    anchors: [[0, 0], [40, 0], [16, -4], [24, -4]],
    piers: [],
    masts: [[4, -6, 10], [36, -6, 10]],
    rocks: [[15, 17, -4], [23, 25, -4]],
    blocks: { reach: 10, tonnes: 20 },
    materials: ['road', 'steel', 'cable', 'main', 'damper'],
    vehicle: 'truck',
    convoy: ['troop', 'troop', 'troop'],
    march: { pace: 1, force: 0.5 },
    waterY: -6,
    hint: [
      [[0, 0], [16, 0], 'road'],
      [[16, 0], [32, 0], 'road'],
      [[32, 0], [40, 0], 'road'],
      [[-8, 0], [4, 10], 'main'],
      [[4, 10], [36, 10], 'main'],
      [[36, 10], [48, 0], 'main'],
      [[2, 8], [2, 0], 'cable'],
      [[4, 10], [4, 0], 'cable'],
      [[6, 9.25], [6, 0], 'cable'],
      [[8, 8.6], [8, 0], 'cable'],
      [[10, 8.05], [10, 0], 'cable'],
      [[12, 7.6], [12, 0], 'cable'],
      [[14, 7.25], [14, 0], 'cable'],
      [[16, 7], [16, 0], 'cable'],
      [[18, 6.85], [18, 0], 'cable'],
      [[20, 6.8], [20, 0], 'cable'],
      [[22, 6.85], [22, 0], 'cable'],
      [[24, 7], [24, 0], 'cable'],
      [[26, 7.25], [26, 0], 'cable'],
      [[28, 7.6], [28, 0], 'cable'],
      [[30, 8.05], [30, 0], 'cable'],
      [[32, 8.6], [32, 0], 'cable'],
      [[34, 9.25], [34, 0], 'cable'],
      [[36, 10], [36, 0], 'cable'],
      [[38, 8], [38, 0], 'cable'],
      [[16, -4], [14, 0], 'damper'],
      [[16, -4], [18, 0], 'damper'],
      [[24, -4], [22, 0], 'damper'],
      [[24, -4], [26, 0], 'damper'],
    ],
    hintSolves: true,
  },
  {
    id: 57,
    name: 'Gale',
    tip: 'Gusts lift a light deck like a wing, and a deck that bounces catches each gust harder, until it flutters itself apart. Stiffen it with a truss along the deck.',
    width: 28,
    anchors: [[0, 0], [28, 0], [6, 0], [22, 0], [6, 12], [22, 12], [0, -3], [28, -3], [14, -5]],
    piers: [],
    towers: [[6, -8, 12], [22, -8, 12]],
    rocks: [[13, 15, -5]],
    // Heavy deck alone, resting on the pylons' bolts, carried the van across.
    materials: ['road', 'wood', 'steel', 'cable', 'damper'],
    vehicle: 'van',
    wind: { push: 300, lift: 900, period: 3, flutter: 300 },
    waterY: -8,
  },
  {
    id: 58,
    name: 'Aftershock',
    tip: 'An earthquake strikes as the bus reaches the middle, shaking faster and faster until it matches how the towers sway. Brace them to the deck and the banks.',
    width: 48,
    anchors: [[0, 0], [48, 0], [2, 0], [6, 0], [42, 0], [46, 0]],
    piers: [[2, 0], [6, 0], [42, 0], [46, 0]],
    blocks: { reach: 10, tonnes: 20 },
    ceiling: 16,
    materials: ['road', 'heavy', 'steel', 'cable', 'main', 'concrete', 'damper'],
    vehicle: 'bus',
    quake: { g: 0.25, freq: 0.5, sweep: 3, at: 24, dur: 8 },
    waterY: -6,
  },
  {
    id: 59,
    name: 'Parade',
    tip: 'Four squads march in step behind the bus, over a river in flood. Steel falls short of the drowned rocks and the towers must stay low: only dampers on the rocks calm the swing.',
    width: 48,
    // The rock bolts lie just beyond steel's reach of the lowest joint the flood allows, and
    // within a damper's: nothing stiff can stand on them.
    anchors: [[0, 0], [48, 0], [2, 0], [6, 0], [42, 0], [46, 0], [18, -4.4], [30, -4.4]],
    piers: [[2, 0], [6, 0], [42, 0], [46, 0]],
    rocks: [[17, 19, -4.4], [29, 31, -4.4]],
    blocks: { reach: 10, tonnes: 20 },
    // Low towers keep the main cable shallow, so the deck stays lively: a deep cable would
    // stiffen it enough to need no dampers.
    ceiling: 10,
    materials: ['road', 'heavy', 'steel', 'cable', 'main', 'concrete', 'damper'],
    vehicle: 'bus',
    convoy: ['troop', 'troop', 'troop', 'troop'],
    march: { pace: 1.25, force: 0.4 },
    waterY: -0.6,
  },
  {
    id: 60,
    name: 'Storm Parade',
    tip: 'The slow march again, in a gale: gusts lift the deck while the boots pound it. Only a bridge that is damped as well as held down gets everyone across.',
    width: 40,
    anchors: [[0, 0], [40, 0], [16, -4], [24, -4]],
    piers: [],
    masts: [[4, -6, 10], [36, -6, 10]],
    rocks: [[15, 17, -4], [23, 25, -4]],
    blocks: { reach: 10, tonnes: 20 },
    materials: ['road', 'steel', 'cable', 'main', 'damper'],
    vehicle: 'truck',
    convoy: ['troop', 'troop', 'troop'],
    march: { pace: 1, force: 0.4 },
    wind: { push: 130, lift: 400, period: 3, flutter: 100 },
    waterY: -6,
  },
  {
    id: 61,
    name: 'Mudflats',
    tip: 'Silt has filled the river up to just under the road, and mud holds no bolt. Drag a steel post onto the mud to drive a pile down to rock, and stand the middle on it.',
    width: 20,
    anchors: [
      [0, 0],
      [20, 0],
    ],
    piers: [],
    mud: [[5, 15, -1.5]],
    piles: { price: 1500 },
    materials: ['road', 'wood', 'steel'],
    vehicle: 'van',
    waterY: -6,
    // The pile first: a post dragged down onto the mud drives it.
    hint: [
      [[0, 0], [20, 0], 'road'],
      [[10, -1.5], [10, 0], 'steel'],
      [[0, 0], [2, 2], 'steel'],
      [[2, 2], [4, 2], 'steel'],
      [[2, 2], [4, 0], 'steel'],
      [[4, 2], [6, 2], 'steel'],
      [[6, 2], [8, 2], 'steel'],
      [[8, 2], [6, 0], 'steel'],
      [[8, 2], [10, 0], 'steel'],
      [[10, 0], [12, 2], 'steel'],
      [[12, 2], [14, 2], 'steel'],
      [[12, 2], [14, 0], 'steel'],
      [[14, 2], [16, 2], 'steel'],
      [[16, 2], [18, 2], 'steel'],
      [[18, 2], [16, 0], 'steel'],
      [[18, 2], [20, 0], 'steel'],
      [[2, 0], [2, 2], 'wood'],
      [[4, 0], [4, 2], 'wood'],
      [[4, 2], [6, 0], 'wood'],
      [[6, 0], [6, 2], 'wood'],
      [[8, 0], [8, 2], 'wood'],
      [[12, 0], [12, 2], 'wood'],
      [[14, 0], [14, 2], 'wood'],
      [[14, 2], [16, 0], 'wood'],
      [[16, 0], [16, 2], 'wood'],
      [[18, 0], [18, 2], 'wood'],
    ],
    hintSolves: true,
  },
  {
    id: 62,
    name: 'Soft Ground',
    tip: 'The bolts on the mud are free, but mud holds only 15 kN a bolt, and a truck sinks them. Piles cost money and stand on the rock below.',
    width: 24,
    anchors: [
      [0, 0],
      [24, 0],
      [8, -1],
      [16, -1],
    ],
    piers: [],
    // Mud close under the road, so a truss can't hang deep enough below the deck to share the truck with the bolts.
    mud: [[6, 18, -1]],
    piles: { price: 2000 },
    materials: ['road', 'wood', 'steel'],
    vehicle: 'truck',
    waterY: -6,
  },
  {
    id: 63,
    name: 'Flash Flood',
    tip: 'The river floods as the van drives on. Water over the mud scours out its bolts, and the current pushes on all that stands in it. Piles stay put.',
    width: 24,
    anchors: [
      [0, 0],
      [24, 0],
      [8, -3],
      [16, -3],
    ],
    piers: [],
    mud: [[6, 18, -3]],
    piles: { price: 2000 },
    materials: ['road', 'wood', 'steel'],
    vehicle: 'van',
    flood: { at: 4, rise: 5, current: 2000 },
    waterY: -7,
  },
  {
    id: 64,
    name: 'Long Flats',
    tip: 'Thirty-six meters over two mud flats, and a pile costs as much as seven meters of steel. Drive as few as the trusses need, where they do the most good.',
    width: 36,
    anchors: [
      [0, 0],
      [36, 0],
    ],
    piers: [],
    mud: [
      [6, 14, -2],
      [22, 30, -2],
    ],
    piles: { price: 1800 },
    materials: ['road', 'wood', 'steel'],
    vehicle: 'truck',
    waterY: -7,
  },
  {
    id: 65,
    name: 'Floodtide',
    tip: 'Forty meters for the school bus, two mud flats, and a flood on the way. Bolts on the mud wash out and only piles hold. Keep it slim in the water: the current pushes.',
    width: 40,
    anchors: [
      [0, 0],
      [40, 0],
      [12, -3],
      [28, -3],
    ],
    piers: [],
    mud: [
      [8, 18, -3],
      [22, 32, -3],
    ],
    piles: { price: 2500 },
    materials: ['road', 'heavy', 'wood', 'steel'],
    vehicle: 'bus',
    flood: { at: 8, rise: 5, current: 2000 },
    waterY: -7,
  },
  {
    id: 66,
    name: 'Washout Line',
    tip: 'A freight train over a silted river, with a flood on its heels. The bolts in the mud sink under the train and wash out in the flood: drive piles.',
    width: 30,
    anchors: [
      [0, 0],
      [30, 0],
      [10, -2],
      [20, -2],
    ],
    piers: [],
    mud: [[6, 24, -2]],
    piles: { price: 2000 },
    materials: ['track', 'wood', 'steel'],
    vehicle: 'loco',
    convoy: ['wagon', 'wagon'],
    flood: { at: 2, rise: 6, current: 2000 },
    waterY: -7,
  },
  {
    id: 67,
    name: 'Delta Haul',
    tip: 'A forty-tonne semi over a delta of mud, with the river rising behind it. Heavy deck for the load, and a pile under every support.',
    width: 40,
    anchors: [
      [0, 0],
      [40, 0],
      [10, -3],
      [30, -3],
    ],
    piers: [],
    mud: [[6, 34, -3]],
    piles: { price: 2500 },
    materials: ['road', 'heavy', 'wood', 'steel'],
    vehicle: 'semi',
    flood: { at: 4, rise: 6, current: 2000 },
    waterY: -8,
  },
  {
    id: 68,
    name: 'Marsh March',
    tip: 'The slow march again, over a marsh. Mud sinks under a stiff prop that takes the truck, but a damper carries almost no standing load: the free bolts hold it.',
    width: 40,
    anchors: [
      [0, 0],
      [40, 0],
      [16, -3],
      [24, -3],
    ],
    piers: [],
    masts: [
      [4, -6, 10],
      [36, -6, 10],
    ],
    mud: [[10, 30, -3]],
    blocks: { reach: 10, tonnes: 20 },
    materials: ['road', 'steel', 'cable', 'main', 'damper'],
    vehicle: 'truck',
    convoy: ['troop', 'troop', 'troop'],
    march: { pace: 1, force: 0.5 },
    waterY: -6,
  },
  {
    id: 69,
    name: 'Great Arch',
    tip: 'One arch for the semi, from shelves nine meters down. Sprung from the bare shelves it fails: build the springings up in blocks first.',
    width: 36,
    anchors: [
      [0, 0],
      [36, 0],
    ],
    piers: [],
    rocks: [
      [0, 2, -9],
      [34, 36, -9],
    ],
    materials: ['road', 'heavy', 'steel', 'masonry', 'arch'],
    vehicle: 'semi',
    waterY: -12,
  },
  {
    id: 70,
    name: 'Last Crossing',
    tip: 'Forty-eight meters for the semi over a delta in flood, with a ship channel to keep clear. Everything you have learned, at once.',
    width: 48,
    anchors: [
      [0, 0],
      [48, 0],
    ],
    piers: [],
    mud: [
      [4, 18, -3],
      [30, 44, -3],
    ],
    channels: [[18, 30, -1]],
    piles: { price: 2500 },
    materials: ['road', 'heavy', 'wood', 'steel'],
    vehicle: 'semi',
    flood: { at: 6, rise: 5, current: 2000 },
    waterY: -8,
  },
  // Modern works: prestressed girders, a double deck, and drawbridges that split, lift and swing.
  {
    id: 71,
    name: 'Tendon',
    tip: 'The ship channel leaves room for a girder only two blocks deep, and a beam of blocks cracks open underneath. Thread a tendon low through it: pulled tight, it keeps the joints shut.',
    width: 20,
    anchors: [
      [0, 0],
      [20, 0],
    ],
    piers: [],
    rocks: [
      [1, 3, -4],
      [17, 19, -4],
    ],
    channels: [[3, 17, -2]],
    // On sliding bearings, so only the girder itself can hold its ends together.
    sliding: true,
    materials: ['road', 'masonry', 'tendon'],
    vehicle: 'truck',
    waterY: -8,
    // Piers on the islands, the girder across, then the tendon along its underside.
    hint: [
      [[0, 0], [20, 0], 'road'],
      [[1, -4], [3, -2], 'masonry'],
      [[17, -4], [19, -2], 'masonry'],
      [[1, -2], [19, 0], 'masonry'],
      [[1, -2], [10, -2], 'tendon'],
      [[10, -2], [19, -2], 'tendon'],
    ],
    hintSolves: true,
  },
  {
    id: 72,
    name: 'Two Spans',
    tip: 'Over the middle pier the girder bends the other way, and its top cracks open instead. A tendon low in the spans only makes that worse: run it along the middle of the beam.',
    width: 30,
    anchors: [
      [0, 0],
      [30, 0],
    ],
    piers: [],
    rocks: [
      [1, 3, -4],
      [14, 16, -4],
      [27, 29, -4],
    ],
    channels: [
      [3, 14, -2],
      [16, 27, -2],
    ],
    sliding: true,
    materials: ['road', 'heavy', 'masonry', 'tendon'],
    vehicle: 'semi',
    waterY: -8,
  },
  {
    id: 73,
    name: 'Double Deck',
    tip: 'A train crosses on a lower deck while a truck crosses on top. Brace the two decks to each other and they become the chords of one deep truss.',
    width: 16,
    anchors: [
      [0, 0],
      [16, 0],
      [0, -4],
      [16, -4],
    ],
    piers: [],
    lower: { y: -4, vehicle: 'loco', convoy: ['wagon'] },
    materials: ['road', 'track', 'wood', 'steel'],
    vehicle: 'truck',
    waterY: -8,
  },
  {
    id: 74,
    name: 'Double Bascule',
    tip: 'Build a leaf from each bank to the lock in the middle, meeting at one joint there: the lock splits it in two and holds the tips level until the bridge opens. Lift each on a ram.',
    width: 18,
    anchors: [
      [0, 0],
      [18, 0],
      [4, -3],
      [14, -3],
    ],
    piers: [
      [4, -3],
      [14, -3],
    ],
    channels: [[5, 13, 0]],
    ship: { mast: 4 },
    lock: 9,
    materials: ['road', 'wood', 'steel', 'ram'],
    vehicle: 'truck',
    waterY: -6,
  },
  {
    id: 75,
    name: 'Lift Bridge',
    tip: 'Towers at the channel edges guide a span straight up and down. Lay it on its own from seat to seat and lift it on rams; the approaches stay where they are.',
    width: 20,
    anchors: [
      [0, 0],
      [20, 0],
      [0, -3],
      [20, -3],
      [8, -3],
      [12, -3],
    ],
    piers: [
      [6, 0],
      [14, 0],
      [8, -3],
      [12, -3],
    ],
    channels: [[8.5, 11.5, 0]],
    ship: { mast: 2 },
    lift: [6, 14],
    materials: ['road', 'wood', 'steel', 'ram'],
    vehicle: 'truck',
    waterY: -6,
  },
  {
    id: 76,
    name: 'Swing Bridge',
    tip: 'The whole bridge swings open on its pier. Its ends lift off the banks, so while it turns each half must hold itself up: a deep truss, braced out wide from both pivot bolts.',
    width: 20,
    anchors: [
      [0, 0],
      [20, 0],
      [9, -3],
      [11, -3],
    ],
    piers: [
      [9, -3],
      [11, -3],
    ],
    channels: [[12, 18, -1]],
    ship: { mast: 6 },
    swing: { pivot: 10 },
    materials: ['road', 'wood', 'steel'],
    vehicle: 'truck',
    waterY: -6,
  },
  {
    id: 77,
    name: 'Ship Waits',
    tip: 'This time the ship waits for a freight train. Once it is across, the span lifts in its towers for the ship: carry the train first, then rise clear.',
    width: 20,
    anchors: [
      [0, 0],
      [20, 0],
      [0, -3],
      [20, -3],
      [8, -3],
      [12, -3],
    ],
    piers: [
      [6, 0],
      [14, 0],
      [8, -3],
      [12, -3],
    ],
    channels: [[8.5, 11.5, 0]],
    ship: { mast: 2, after: true },
    lift: [6, 14],
    materials: ['track', 'wood', 'steel', 'ram'],
    vehicle: 'loco',
    convoy: ['wagon', 'wagon'],
    waterY: -6,
  },
];

/** Stand-in numbers for a level the tuner hasn't run on yet: playable, but with no real target. */
export const UNTUNED: Tuned = { money: 100000, target: 0, bonus: { kind: 'stress', max: 0.5 } };

export const LEVELS: LevelDef[] = BASE_LEVELS.map((b) => applyTuning(b, TUNED.levels[b.id] ?? UNTUNED));

export const START_X = -8;

/** Piers with no bolt on top: a deck built on or across one rests on the pier and can lift off it. */
export function seatPiers(level: LevelDef): Pt[] {
  const bolted = (x: number, y: number) => level.anchors.some((a) => Math.abs(a[0] - x) < 1e-6 && Math.abs(a[1] - y) < 1e-6);
  return level.piers.filter(([x, y]) => !bolted(x, y));
}

/** The mud bank whose top the point is on, if any. */
export function mudAt(level: LevelDef, x: number, y: number): [number, number, number] | undefined {
  return level.mud?.find(([x0, x1, top]) => x >= x0 - 1e-6 && x <= x1 + 1e-6 && Math.abs(y - top) < 1e-6);
}

export function bankY(level: LevelDef): number {
  return level.rightY ?? 0;
}

export function goalX(level: LevelDef): number {
  return level.width + 4;
}
