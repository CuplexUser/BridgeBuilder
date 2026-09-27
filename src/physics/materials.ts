export type MaterialId = 'road' | 'wood' | 'steel';

export interface Material {
  id: MaterialId;
  name: string;
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
}

export const MATERIALS: Record<MaterialId, Material> = {
  road: {
    id: 'road',
    name: 'Road',
    maxLen: 2.25,
    density: 50,
    EA: 1e7,
    tension: 50000,
    compression: 50000,
    buckleRef: 3,
  },
  wood: {
    id: 'wood',
    name: 'Wood',
    maxLen: 3.2,
    density: 22,
    EA: 1.6e6,
    tension: 26000,
    compression: 22000,
    buckleRef: 2.9,
  },
  steel: {
    id: 'steel',
    name: 'Steel',
    maxLen: 4.25,
    density: 45,
    EA: 5e6,
    tension: 80000,
    compression: 64000,
    buckleRef: 4.3,
  },
};

export const MATERIAL_ORDER: MaterialId[] = ['road', 'wood', 'steel'];

/** Effective compressive capacity for a member of the given rest length. */
export function compressionLimit(m: Material, len: number): number {
  const f = m.buckleRef / Math.max(len, 1e-6);
  return m.compression * Math.min(1, f * f);
}
