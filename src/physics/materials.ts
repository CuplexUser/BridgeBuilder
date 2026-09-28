export type MaterialId = 'road' | 'heavy' | 'wood' | 'steel' | 'cable';

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
  /** Vehicles drive on it. */
  drivable: boolean;
  /** One drag lays a whole run of pieces. */
  runs: boolean;
  /** Carries no load when pushed: it simply goes slack. */
  tensionOnly: boolean;
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
    drivable: true,
    runs: true,
    tensionOnly: false,
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
    drivable: true,
    runs: true,
    tensionOnly: false,
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
    drivable: false,
    runs: false,
    tensionOnly: false,
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
    drivable: false,
    runs: false,
    tensionOnly: false,
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
    drivable: false,
    runs: false,
    tensionOnly: true,
  },
};

export const MATERIAL_ORDER: MaterialId[] = ['road', 'heavy', 'wood', 'steel', 'cable'];

/** Effective compressive capacity for a member of the given rest length. */
export function compressionLimit(m: Material, len: number): number {
  if (m.tensionOnly) return Infinity;
  const f = m.buckleRef / Math.max(len, 1e-6);
  return m.compression * Math.min(1, f * f);
}
