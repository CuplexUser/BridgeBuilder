import type { Design } from './design';
import { money } from './editor';
import type { BonusGoal, LevelDef } from './levels';
import { MATERIALS } from './physics/materials';

export interface LevelScore {
  /** Dollars spent on the bridge. */
  spent: number;
  base: number;
  /** Bonus for money left in the budget. */
  savingsBonus: number;
  safetyBonus: number;
  /** Points for meeting the level's bonus goal. */
  goalBonus: number;
  total: number;
  /** The three main stars: crossing, cost and safety. */
  stars: number;
  underTarget: boolean;
  safe: boolean;
  /** The level's bonus goal was met: the fourth star. */
  bonus: boolean;
}

export const BASE_SCORE = 500;
/** Savings bonus for a bridge that cost nothing; scales down linearly to 0 at the full budget. */
export const SAVINGS_MAX = 1000;
export const SAFETY_MAX = 400;
export const GOAL_SCORE = 250;
export const SAFE_STRESS = 0.75;

/** Whether a design that crossed with the given peak stress meets a bonus goal. */
export function bonusMet(goal: BonusGoal, design: Design, peakStress: number): boolean {
  switch (goal.kind) {
    case 'cost':
      return design.cost() <= goal.max;
    case 'stress':
      return peakStress < goal.max;
    case 'parts':
      return design.parts() <= goal.max;
    case 'without':
      return design.members.every((m) => m.mat !== goal.mat);
  }
}

/** The goal as players read it, e.g. "No steel" or "Peak stress below 50%". */
export function bonusLabel(goal: BonusGoal): string {
  switch (goal.kind) {
    case 'cost':
      return `Build for ${money(goal.max)} or less`;
    case 'stress':
      return `Peak stress below ${Math.round(goal.max * 100)}%`;
    case 'parts':
      return `${goal.max} parts or fewer`;
    case 'without':
      return `No ${MATERIALS[goal.mat].name.toLowerCase()}`;
  }
}

export function scoreLevel(level: LevelDef, design: Design, peakStress: number): LevelScore {
  const spent = design.cost();
  const savingsBonus = Math.round(SAVINGS_MAX * Math.max(0, Math.min(1, 1 - spent / level.money)));
  const safetyBonus = Math.round(SAFETY_MAX * Math.max(0, Math.min(1, 1 - peakStress)));
  const underTarget = spent <= level.target;
  const safe = peakStress < SAFE_STRESS;
  const bonus = bonusMet(level.bonus, design, peakStress);
  const goalBonus = bonus ? GOAL_SCORE : 0;
  return {
    spent,
    base: BASE_SCORE,
    savingsBonus,
    safetyBonus,
    goalBonus,
    total: BASE_SCORE + savingsBonus + safetyBonus + goalBonus,
    stars: 1 + (underTarget ? 1 : 0) + (safe ? 1 : 0),
    underTarget,
    safe,
    bonus,
  };
}
