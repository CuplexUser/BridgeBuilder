export type MaterialId = 'road' | 'heavy' | 'wood' | 'steel' | 'cable' | 'main' | 'concrete' | 'ram';

export interface Material {
  id: MaterialId;
  name: string;
  /** Label for narrow toolbars. */
  short: string;
  /** Cost per meter of member, in dollars. */
  price: number;
  /** Longest member the player may place, in meters. */
  maxLen: number;
  /** Mass per meter of member, kg/m. */
  density: number;
  /** Axial stiffness E·A, in newtons per unit strain. */
  EA: number;
  /** Axial force (N) at which the member snaps when pulled. */
  tension: number;
  /** Axial force (N) at which a short member crushes when pushed. */
  compression: number;
  /** Members longer than this buckle earlier (Euler-style 1/L² falloff). */
  buckleRef: number;
  /**
   * Deck bending stiffness: the sideways spring, in N/m, at a joint between two consecutive
   * deck pieces. It spreads a wheel load onto neighboring joints. 0 means a plain hinge.
   */
  bend: number;
  /** Most sideways force one deck joint's bending carries before it yields like a hinge, N. */
  bendLimit: number;
  /** Heaviest vehicle a deck carries, in tonnes. A heavier one crushes the pieces under its wheels. */
  rating: number;
  /** Vehicles drive on it. */
  drivable: boolean;
  /** One drag lays a whole run of pieces. */
  runs: boolean;
  /** Carries no load when pushed: it simply goes slack. */
  tensionOnly: boolean;
  /**
   * Laid in one drag as a sagging chain, a piece every 2 m along a parabola, whose sag the
   * player sets afterward. Drawn as one smooth curve.
   */
  curved?: boolean;
  /** How much longer it gets when a drawbridge opens, as a share of its built length. 0 for fixed members. */
  stroke: number;
}

export const MATERIALS: Record<MaterialId, Material> = {
  road: {
    id: 'road',
    name: 'Road',
    price: 180,
    short: 'Road',
    maxLen: 2.25,
    density: 50,
    EA: 1e7,
    tension: 50000,
    compression: 50000,
    buckleRef: 3,
    bend: 0,
    bendLimit: 0,
    rating: 30,
    drivable: true,
    runs: true,
    tensionOnly: false,
    stroke: 0,
  },
  heavy: {
    id: 'heavy',
    name: 'Heavy deck',
    price: 380,
    short: 'Heavy',
    maxLen: 2.25,
    density: 70,
    EA: 2.2e7,
    tension: 110000,
    compression: 110000,
    buckleRef: 3.4,
    bend: 1e6,
    bendLimit: 2000,
    rating: 60,
    drivable: true,
    runs: true,
    tensionOnly: false,
    stroke: 0,
  },
  wood: {
    id: 'wood',
    name: 'Wood',
    price: 90,
    short: 'Wood',
    maxLen: 3.2,
    density: 22,
    EA: 1.6e6,
    tension: 26000,
    compression: 22000,
    buckleRef: 2.9,
    bend: 0,
    bendLimit: 0,
    rating: 0,
    drivable: false,
    runs: false,
    tensionOnly: false,
    stroke: 0,
  },
  steel: {
    id: 'steel',
    name: 'Steel',
    price: 240,
    short: 'Steel',
    maxLen: 4.25,
    density: 45,
    EA: 5e6,
    tension: 80000,
    compression: 64000,
    buckleRef: 4.3,
    bend: 0,
    bendLimit: 0,
    rating: 0,
    drivable: false,
    runs: false,
    tensionOnly: false,
    stroke: 0,
  },
  cable: {
    id: 'cable',
    name: 'Cable',
    price: 140,
    short: 'Cable',
    maxLen: 10,
    density: 6,
    EA: 6e6,
    tension: 70000,
    compression: Infinity,
    buckleRef: 1,
    bend: 0,
    bendLimit: 0,
    rating: 0,
    drivable: false,
    runs: false,
    tensionOnly: true,
    stroke: 0,
  },
  // A long span's main cable: three times a cable's strength, laid as a curve from saddle to
  // saddle or down to a concrete anchor. Hangers of plain cable drop from its joints to the deck.
  main: {
    id: 'main',
    name: 'Main cable',
    price: 300,
    short: 'Main',
    // One piece of a run: room for a deep sag between joints 2 m apart.
    maxLen: 3.2,
    density: 20,
    EA: 2e7,
    tension: 220000,
    compression: Infinity,
    buckleRef: 1,
    bend: 0,
    bendLimit: 0,
    rating: 0,
    drivable: false,
    runs: false,
    tensionOnly: true,
    curved: true,
    stroke: 0,
  },
  // Pylons for long spans: crushes only under five times what steel takes and barely buckles,
  // but it is heavy and cracks under a modest pull, so it carries load straight down its length.
  concrete: {
    id: 'concrete',
    name: 'Concrete',
    price: 160,
    short: 'Concr.',
    maxLen: 4.25,
    density: 150,
    EA: 2e7,
    tension: 20000,
    compression: 320000,
    buckleRef: 8,
    bend: 0,
    bendLimit: 0,
    rating: 0,
    drivable: false,
    runs: false,
    tensionOnly: false,
    stroke: 0,
  },
  ram: {
    id: 'ram',
    name: 'Ram',
    price: 420,
    short: 'Ram',
    maxLen: 4.25,
    density: 60,
    EA: 8e6,
    tension: 90000,
    compression: 80000,
    buckleRef: 4.3,
    bend: 0,
    bendLimit: 0,
    rating: 0,
    drivable: false,
    runs: false,
    tensionOnly: false,
    // Extends by 75% to open a drawbridge. Standing square under the leaf, that raises it about
    // 75°; based under the hinge instead, it runs out of reach and breaks something.
    stroke: 0.75,
  },
};

export const MATERIAL_ORDER: MaterialId[] = ['road', 'heavy', 'wood', 'steel', 'cable', 'ram', 'main', 'concrete'];

/** Effective compressive capacity for a member of the given rest length. */
export function compressionLimit(m: Material, len: number): number {
  if (m.tensionOnly) return Infinity;
  const f = m.buckleRef / Math.max(len, 1e-6);
  return m.compression * Math.min(1, f * f);
}

/**
 * A mast stands on a hinge at its foot, so its top bolt tips freely: it carries a load straight
 * down its length but nothing sideways. Cables pulling its top one way need backstays pulling
 * the other, down to concrete anchors.
 */
export const MAST = {
  /** Mass carried at its top, kg. */
  mass: 800,
  /** Axial stiffness E·A, N: far stiffer than any member, so it barely shortens. */
  EA: 1e9,
};

/**
 * A concrete anchor: a gravity block the player sets into the bank behind the gap. It holds
 * by its own weight, by friction on the soil and by the soil packed against it, so a steep
 * pull lifts it out and a flat one slides it. Past either it tears loose and drags.
 */
export const BLOCK = {
  /** What one block costs, in dollars. */
  price: 1500,
  /** Mass, kg: its weight is what holds it down. */
  mass: 5000,
  /** Friction between the block and the soil under it while it holds. */
  friction: 0.6,
  /** Friction once it has torn loose and slides, lower than while it held. */
  sliding: 0.3,
  /** Sideways pull the soil packed against it takes on top of friction, N. */
  bearing: 10000,
  /** Width and depth of the block, m: it sits in a pit with its top, the bolt, flush with the ground. */
  width: 1.4,
  depth: 1,
  /** Joints above an anchor strip must be at least this high over the bank, m, to keep the road clear. */
  clearance: 3.5,
};

export type BlockDef = typeof BLOCK;

/**
 * A level's concrete anchor: the standard 5 t block, or a heavier one where a long span's main
 * cable pulls far harder. A heavier block is bigger in every direction, so the soil packed
 * against its face holds more too, and it costs in proportion to its weight.
 */
export function blockOf(level: { blocks?: { tonnes?: number } }): BlockDef {
  const k = (level.blocks?.tonnes ?? BLOCK.mass / 1000) / (BLOCK.mass / 1000);
  if (k === 1) return BLOCK;
  const s = Math.cbrt(k);
  return {
    ...BLOCK,
    price: Math.round((BLOCK.price * k) / 100) * 100,
    mass: BLOCK.mass * k,
    bearing: BLOCK.bearing * s * s,
    width: BLOCK.width * s,
    depth: BLOCK.depth * s,
  };
}
