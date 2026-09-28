import type { Design } from './design';
import type { LevelDef } from './levels';

export interface LevelScore {
  /** Dollars spent on the bridge. */
  spent: number;
  base: number;
  /** Bonus for money left in the budget. */
  savingsBonus: number;
  safetyBonus: number;
  total: number;
  stars: number;
  underTarget: boolean;
  safe: boolean;
}

export const BASE_SCORE = 500;
/** Savings bonus for a bridge that cost nothing; scales down linearly to 0 at the full budget. */
export const SAVINGS_MAX = 1000;
export const SAFETY_MAX = 400;
export const SAFE_STRESS = 0.75;

export function scoreLevel(level: LevelDef, design: Design, peakStress: number): LevelScore {
  const spent = design.cost();
  const savingsBonus = Math.round(SAVINGS_MAX * Math.max(0, Math.min(1, 1 - spent / level.money)));
  const safetyBonus = Math.round(SAFETY_MAX * Math.max(0, Math.min(1, 1 - peakStress)));
  const underTarget = spent <= level.target;
  const safe = peakStress < SAFE_STRESS;
  return {
    spent,
    base: BASE_SCORE,
    savingsBonus,
    safetyBonus,
    total: BASE_SCORE + savingsBonus + safetyBonus,
    stars: 1 + (underTarget ? 1 : 0) + (safe ? 1 : 0),
    underTarget,
    safe,
  };
}
