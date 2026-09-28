import type { Design } from './design';
import { totalBudget, type LevelDef } from './levels';

export interface LevelScore {
  used: number;
  unused: number;
  base: number;
  partsBonus: number;
  safetyBonus: number;
  total: number;
  stars: number;
  underPar: boolean;
  safe: boolean;
}

export const BASE_SCORE = 500;
export const PART_BONUS = 100;
export const SAFETY_MAX = 400;
export const SAFE_STRESS = 0.75;

export function scoreLevel(level: LevelDef, design: Design, peakStress: number): LevelScore {
  const used = design.parts();
  const budget = totalBudget(level);
  const unused = Math.max(0, budget - used);
  const partsBonus = unused * PART_BONUS;
  const safetyBonus = Math.round(SAFETY_MAX * Math.max(0, Math.min(1, 1 - peakStress)));
  const underPar = used <= level.par;
  const safe = peakStress < SAFE_STRESS;
  return {
    used,
    unused,
    base: BASE_SCORE,
    partsBonus,
    safetyBonus,
    total: BASE_SCORE + partsBonus + safetyBonus,
    stars: 1 + (underPar ? 1 : 0) + (safe ? 1 : 0),
    underPar,
    safe,
  };
}
