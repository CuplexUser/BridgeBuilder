import { MATERIAL_ORDER, type MaterialId } from './physics/materials';
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
  /** Pieces available per material; a missing material is unavailable. */
  budget: Partial<Record<MaterialId, number>>;
  /** Parts used at or under par earns a star. */
  par: number;
  vehicle: VehicleId;
  waterY: number;
  towers?: Tower[];
  overhangs?: Overhang[];
  /** Ghost members drawn as a hint (level 1 only). */
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
    budget: { road: 2, wood: 3 },
    par: 4,
    vehicle: 'car',
    waterY: -4,
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
    budget: { road: 3, wood: 5 },
    par: 7,
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
    budget: { road: 4, wood: 11 },
    par: 13,
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
    budget: { road: 5, wood: 13, steel: 3 },
    par: 19,
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
    budget: { road: 5, wood: 6, steel: 10 },
    par: 19,
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
    budget: { road: 6, wood: 10, steel: 5 },
    par: 19,
    vehicle: 'van',
    waterY: -6,
  },
  {
    id: 7,
    name: 'Heavy Haul',
    tip: 'Trucks are heavy. Heavy deck is stiffer and stronger than road, but it weighs more.',
    width: 12,
    anchors: [[0, 0], [12, 0], [0, -2], [12, -2]],
    piers: [],
    budget: { heavy: 6, wood: 12, steel: 9 },
    par: 23,
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
    budget: { road: 7, wood: 11, steel: 12 },
    par: 27,
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
    budget: { road: 6, wood: 4, steel: 16 },
    par: 23,
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
    budget: { road: 7, wood: 13, steel: 10 },
    par: 27,
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
    budget: { road: 8, wood: 14, steel: 10 },
    par: 29,
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
    budget: { road: 10, wood: 15, steel: 11 },
    par: 33,
    vehicle: 'bus',
    waterY: -7,
  },
  {
    id: 13,
    name: 'Hanging On',
    tip: 'Cables only pull, never push. Hang the deck from the towers.',
    width: 14,
    anchors: [[0, 0], [14, 0], [0, 6], [14, 6]],
    piers: [],
    towers: [[0, 0, 6], [14, 0, 6]],
    budget: { road: 7, wood: 2, cable: 6 },
    par: 13,
    vehicle: 'van',
    waterY: -6,
  },
  {
    id: 14,
    name: 'Stayed',
    tip: 'One tall pylon. Fan the cables out to carry both halves.',
    width: 18,
    anchors: [[0, 0], [18, 0], [9, 7], [0, -2], [18, -2]],
    piers: [],
    towers: [[9, -7, 7]],
    budget: { road: 9, wood: 3, cable: 8 },
    par: 17,
    vehicle: 'van',
    waterY: -7,
  },
  {
    id: 15,
    name: 'Cliffhanger',
    tip: 'Nothing below, rock above. Hang it from the cliffs.',
    width: 16,
    anchors: [[0, 0], [16, 0], [1, 4], [15, 4], [1, 7], [15, 7]],
    piers: [],
    overhangs: [
      { side: 'left', bottom: 4, top: 12, reach: 1.5 },
      { side: 'right', bottom: 4, top: 12, reach: 1.5 },
    ],
    budget: { road: 8, wood: 2, steel: 2, cable: 8 },
    par: 16,
    vehicle: 'truck',
    waterY: -8,
  },
  {
    id: 16,
    name: 'Mid-span',
    tip: 'Drag from the middle of a beam to add a joint there. Split pieces cost nothing extra.',
    width: 16,
    anchors: [[0, 0], [16, 0], [0, -3], [16, -3]],
    piers: [],
    budget: { road: 8, wood: 12, steel: 8 },
    par: 26,
    vehicle: 'van',
    waterY: -7,
  },
  {
    id: 17,
    name: 'Big Rig',
    tip: 'Forty tonnes of trouble. Heavy deck carries what road cannot.',
    width: 20,
    anchors: [[0, 0], [20, 0], [10, -4], [0, -3], [20, -3]],
    piers: [[10, -4]],
    budget: { heavy: 10, wood: 4, steel: 26 },
    par: 37,
    vehicle: 'semi',
    waterY: -7,
  },
  {
    id: 18,
    name: 'Valley Drop',
    tip: 'A long, even descent. Let the pylons take the strain.',
    width: 24,
    rightY: -3,
    anchors: [[0, 0], [24, -3], [8, 6], [16, 5], [0, -3], [24, -6]],
    piers: [],
    towers: [[8, -9, 6], [16, -9, 5]],
    budget: { road: 12, wood: 1, steel: 2, cable: 11 },
    par: 23,
    vehicle: 'truck',
    waterY: -9,
  },
  {
    id: 19,
    name: 'Twin Pylons',
    tip: 'A suspension bridge: a main cable between the towers, hangers down to the deck.',
    width: 28,
    anchors: [[0, 0], [28, 0], [6, 8], [22, 8], [0, -3], [28, -3]],
    piers: [],
    towers: [[6, -8, 8], [22, -8, 8]],
    budget: { heavy: 14, wood: 2, steel: 2, cable: 15 },
    par: 29,
    vehicle: 'bus',
    waterY: -8,
  },
  {
    id: 20,
    name: 'The Long Way',
    tip: 'Thirty-two meters, one semi, everything you have learned.',
    width: 32,
    anchors: [[0, 0], [32, 0], [16, -4], [8, 7], [24, 7], [0, -3], [32, -3]],
    piers: [[16, -4]],
    towers: [[8, -9, 7], [24, -9, 7]],
    budget: { heavy: 16, wood: 2, steel: 2, cable: 14 },
    par: 31,
    vehicle: 'semi',
    waterY: -9,
  },
];

export const START_X = -8;

export function budgetOf(level: LevelDef, mat: MaterialId): number {
  return level.budget[mat] ?? 0;
}

export function totalBudget(level: LevelDef): number {
  return MATERIAL_ORDER.reduce((s, m) => s + budgetOf(level, m), 0);
}

export function bankY(level: LevelDef): number {
  return level.rightY ?? 0;
}

export function goalX(level: LevelDef): number {
  return level.width + 4;
}
