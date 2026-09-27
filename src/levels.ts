import type { MaterialId } from './physics/materials';
import type { VehicleId } from './physics/vehicles';

export type Pt = [number, number];

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
  budget: Record<MaterialId, number>;
  /** Parts used at or under par earns a star. */
  par: number;
  vehicle: VehicleId;
  waterY: number;
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
    budget: { road: 2, wood: 3, steel: 0 },
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
    budget: { road: 3, wood: 6, steel: 0 },
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
    budget: { road: 4, wood: 12, steel: 0 },
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
    budget: { road: 5, wood: 14, steel: 4 },
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
    budget: { road: 5, wood: 8, steel: 10 },
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
    budget: { road: 6, wood: 12, steel: 6 },
    par: 19,
    vehicle: 'van',
    waterY: -6,
  },
  {
    id: 7,
    name: 'Heavy Haul',
    tip: 'Deeper trusses carry more weight.',
    width: 12,
    anchors: [[0, 0], [12, 0], [0, -2], [12, -2]],
    piers: [],
    budget: { road: 6, wood: 13, steel: 10 },
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
    budget: { road: 7, wood: 13, steel: 13 },
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
    budget: { road: 6, wood: 6, steel: 16 },
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
    budget: { road: 7, wood: 14, steel: 11 },
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
    budget: { road: 8, wood: 16, steel: 11 },
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
    budget: { road: 10, wood: 18, steel: 13 },
    par: 33,
    vehicle: 'bus',
    waterY: -7,
  },
];

export const START_X = -8;

export function bankY(level: LevelDef): number {
  return level.rightY ?? 0;
}

export function goalX(level: LevelDef): number {
  return level.width + 4;
}
