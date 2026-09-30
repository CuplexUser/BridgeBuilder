import type { MaterialId } from './physics/materials';
import type { VehicleId } from './physics/vehicles';

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
  /** Concrete piers rise from the water to these anchor points. */
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
  overhangs?: Overhang[];
  /** Ship channels: [x0, x1, top]. Nothing may be built between x0 and x1 from the water up to `top`. */
  channels?: [number, number, number][];
  bonus: BonusGoal;
  /**
   * Ghost members drawn as a hint until the first test, for levels that introduce a mechanic.
   * A deck ghost may span a whole road run, and a ghost that ends partway along another shows
   * where that beam gets split.
   */
  hint?: [Pt, Pt, MaterialId][];
}

export const LEVELS: LevelDef[] = [
  {
    id: 1,
    name: 'First Crossing',
    tip: 'Drag from a red bolt to lay road. Brace it from below with wood.',
    width: 4,
    anchors: [[0, 0], [4, 0], [0, -2], [4, -2]],
    piers: [],
    materials: ['road', 'wood'],
    money: 2000,
    target: 1500,
    vehicle: 'car',
    waterY: -4,
    bonus: { kind: 'parts', max: 4 },
    hint: [
      [[0, 0], [2, 0], 'road'],
      [[2, 0], [4, 0], 'road'],
      [[0, -2], [2, 0], 'wood'],
      [[4, -2], [2, 0], 'wood'],
    ],
  },
  {
    id: 2,
    name: 'Babbling Brook',
    tip: 'Triangles are rigid. Squares fold.',
    width: 6,
    anchors: [[0, 0], [6, 0], [0, -2], [6, -2]],
    piers: [],
    materials: ['road', 'wood'],
    money: 3000,
    target: 2000,
    vehicle: 'car',
    waterY: -4,
    bonus: { kind: 'stress', max: 0.5 },
  },
  {
    id: 3,
    name: 'Over the Top',
    tip: 'No low anchors here: build your truss above the road.',
    width: 8,
    anchors: [[0, 0], [8, 0]],
    piers: [],
    materials: ['road', 'wood'],
    money: 5500,
    target: 3750,
    vehicle: 'car',
    waterY: -5,
    bonus: { kind: 'cost', max: 3400 },
  },
  {
    id: 4,
    name: 'Steel Delivery',
    tip: 'Steel is strong and long, but scarce. Spend it where stress runs red.',
    width: 10,
    anchors: [[0, 0], [10, 0], [0, -3], [10, -3]],
    piers: [],
    materials: ['road', 'wood', 'steel'],
    money: 10000,
    target: 6500,
    vehicle: 'van',
    waterY: -5,
    bonus: { kind: 'stress', max: 0.35 },
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
    money: 8500,
    target: 6000,
    vehicle: 'van',
    waterY: -5,
    bonus: { kind: 'cost', max: 5000 },
  },
  {
    id: 6,
    name: 'Stepping Stone',
    tip: 'A pier in the middle halves the span.',
    width: 12,
    anchors: [[0, 0], [12, 0], [6, -3]],
    piers: [[6, -3]],
    materials: ['road', 'wood', 'steel'],
    money: 10500,
    target: 7750,
    vehicle: 'van',
    waterY: -6,
    bonus: { kind: 'stress', max: 0.4 },
  },
  {
    id: 7,
    name: 'Heavy Haul',
    tip: 'Heavy deck is stronger than road and carries up to 60 t, but costs twice as much. Road carries 30 t.',
    width: 12,
    anchors: [[0, 0], [12, 0], [0, -2], [12, -2]],
    piers: [],
    materials: ['road', 'heavy', 'wood', 'steel'],
    money: 12000,
    target: 8750,
    vehicle: 'truck',
    waterY: -5,
    bonus: { kind: 'stress', max: 0.55 },
  },
  {
    id: 8,
    name: 'Canyon Run',
    tip: 'Long compression members buckle. Keep them short.',
    width: 14,
    anchors: [[0, 0], [14, 0], [0, -3], [14, -3]],
    piers: [],
    materials: ['road', 'heavy', 'wood', 'steel'],
    money: 14000,
    target: 10000,
    vehicle: 'truck',
    waterY: -7,
    bonus: { kind: 'stress', max: 0.6 },
  },
  {
    id: 9,
    name: 'Down the Gorge',
    tip: 'Downhill run. Steel is plentiful here: brace the low end well.',
    width: 12,
    rightY: -1,
    anchors: [[0, 0], [12, -1], [0, -3], [12, -3]],
    piers: [],
    materials: ['road', 'heavy', 'wood', 'steel'],
    money: 15500,
    target: 12000,
    vehicle: 'van',
    waterY: -7,
    bonus: { kind: 'cost', max: 10000 },
  },
  {
    id: 10,
    name: 'Twin Towers',
    tip: 'High anchors love steel in tension.',
    width: 14,
    anchors: [[0, 0], [14, 0], [0, 3], [14, 3]],
    piers: [],
    materials: ['road', 'heavy', 'wood', 'steel'],
    money: 17000,
    target: 13000,
    vehicle: 'truck',
    waterY: -6,
    bonus: { kind: 'without', mat: 'wood' },
  },
  {
    id: 11,
    name: 'School Run',
    tip: 'Precious cargo. Keep it green.',
    width: 16,
    anchors: [[0, 0], [16, 0], [8, -3], [0, -2], [16, -2]],
    piers: [[8, -3]],
    materials: ['road', 'heavy', 'wood', 'steel'],
    money: 15000,
    target: 11500,
    vehicle: 'bus',
    waterY: -7,
    bonus: { kind: 'stress', max: 0.65 },
  },
  {
    id: 12,
    name: 'The Grand Span',
    tip: 'Everything you have learned. Good luck, engineer.',
    width: 20,
    anchors: [[0, 0], [20, 0], [6, -3], [14, -3]],
    piers: [[6, -3], [14, -3]],
    materials: ['road', 'heavy', 'wood', 'steel'],
    money: 17500,
    target: 13500,
    vehicle: 'bus',
    waterY: -7,
    bonus: { kind: 'stress', max: 0.7 },
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
    money: 10000,
    target: 8000,
    vehicle: 'van',
    waterY: -6,
    bonus: { kind: 'stress', max: 0.3 },
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
    money: 12000,
    target: 9750,
    vehicle: 'van',
    waterY: -7,
    bonus: { kind: 'parts', max: 17 },
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
    materials: ['road', 'heavy', 'wood', 'steel', 'cable'],
    money: 16500,
    target: 13250,
    vehicle: 'truck',
    waterY: -8,
    bonus: { kind: 'stress', max: 0.4 },
  },
  {
    id: 16,
    name: 'Mid-span',
    tip: 'Drag from the middle of a beam to add a joint there. Split pieces cost nothing extra.',
    width: 16,
    anchors: [[0, 0], [16, 0], [0, -3], [16, -3]],
    piers: [],
    materials: ['road', 'wood', 'steel', 'cable'],
    money: 14000,
    target: 11500,
    vehicle: 'van',
    waterY: -7,
    bonus: { kind: 'parts', max: 26 },
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
    money: 23500,
    target: 20000,
    vehicle: 'semi',
    waterY: -7,
    bonus: { kind: 'without', mat: 'wood' },
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
    money: 19000,
    target: 16000,
    vehicle: 'truck',
    waterY: -9,
    bonus: { kind: 'stress', max: 0.4 },
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
    money: 29500,
    target: 25000,
    vehicle: 'bus',
    waterY: -8,
    bonus: { kind: 'without', mat: 'wood' },
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
    money: 39000,
    target: 33500,
    vehicle: 'bus',
    waterY: -9,
    bonus: { kind: 'without', mat: 'steel' },
  },
  {
    id: 21,
    name: 'Sawhorse',
    tip: 'A rock in the middle of the stream. Lean on it.',
    width: 8,
    anchors: [[0, 0], [8, 0], [4, -2]],
    piers: [[4, -2]],
    materials: ['road', 'wood'],
    money: 3500,
    target: 2250,
    vehicle: 'car',
    waterY: -5,
    bonus: { kind: 'cost', max: 2000 },
  },
  {
    id: 22,
    name: 'Two Piers',
    tip: 'Three short spans are easier than one long one.',
    width: 18,
    anchors: [[0, 0], [18, 0], [6, -2], [12, -2], [0, -2], [18, -2]],
    piers: [[6, -2], [12, -2]],
    materials: ['road', 'wood', 'steel'],
    money: 8500,
    target: 6250,
    vehicle: 'van',
    waterY: -6,
    bonus: { kind: 'without', mat: 'steel' },
  },
  {
    id: 23,
    name: 'High Water',
    tip: 'The river is up. There is no room under the deck: build above it.',
    width: 14,
    anchors: [[0, 0], [14, 0]],
    piers: [],
    materials: ['road', 'heavy', 'wood', 'steel'],
    money: 13000,
    target: 10000,
    vehicle: 'van',
    waterY: -1.5,
    bonus: { kind: 'without', mat: 'wood' },
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
    materials: ['road', 'heavy', 'wood', 'steel', 'cable'],
    money: 24000,
    target: 19250,
    vehicle: 'truck',
    waterY: -2,
    bonus: { kind: 'stress', max: 0.45 },
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
    money: 16500,
    target: 14000,
    vehicle: 'truck',
    waterY: -6,
    bonus: { kind: 'stress', max: 0.65 },
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
    money: 22000,
    target: 18250,
    vehicle: 'truck',
    waterY: -8,
    bonus: { kind: 'stress', max: 0.45 },
  },
  {
    id: 27,
    name: 'Gauntlet',
    tip: 'The piers sit deep. Build trestles up to the deck.',
    width: 26,
    anchors: [[0, 0], [26, 0], [9, -6], [17, -6], [0, -3], [26, -3]],
    piers: [[9, -6], [17, -6]],
    materials: ['road', 'heavy', 'wood', 'steel', 'cable'],
    money: 26500,
    target: 23000,
    vehicle: 'bus',
    waterY: -8,
    bonus: { kind: 'stress', max: 0.65 },
  },
  {
    id: 28,
    name: 'Iron Horse',
    tip: 'Twenty-four meters, one pier, one semi truck.',
    width: 24,
    anchors: [[0, 0], [24, 0], [12, -4], [0, -3], [24, -3]],
    piers: [[12, -4]],
    materials: ['road', 'heavy', 'wood', 'steel', 'cable'],
    money: 29500,
    target: 25250,
    vehicle: 'semi',
    waterY: -7,
    bonus: { kind: 'without', mat: 'wood' },
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
    money: 35000,
    target: 30250,
    vehicle: 'truck',
    waterY: -8,
    bonus: { kind: 'stress', max: 0.7 },
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
    money: 42500,
    target: 36750,
    vehicle: 'semi',
    waterY: -8,
    bonus: { kind: 'without', mat: 'wood' },
  },
];

export const START_X = -8;

export function bankY(level: LevelDef): number {
  return level.rightY ?? 0;
}

export function goalX(level: LevelDef): number {
  return level.width + 4;
}
