import type { BonusGoal, Tuned } from '../../src/levels';
import type { MaterialId } from '../../src/physics/materials';
import type { Difficulty } from './difficulty';
import type { Params, Shape } from './intents';

/** One test drive, boiled down. */
export interface Summary {
  cost: number;
  peak: number;
  parts: number;
  crossed: boolean;
  reason: string;
  /** Older results lack these two. */
  valid?: boolean;
  broken?: boolean;
}

/** What tuning one level found and decided. */
export interface LevelResult {
  id: number;
  fingerprint: string;
  effort: string;
  ok: boolean;
  /** Why the level's geometry or numbers can't be trusted; empty when ok. */
  notes: string[];
  /** Smaller problems that don't reject a geometry, like a bonus goal nothing proved. */
  warnings?: string[];
  params: Params;
  geometry: Shape;
  money: number;
  target: number;
  bonus: BonusGoal;
  /** The budget the requires and shortcut checks ran against; `money` can change with the difficulty. */
  checkedMoney?: number;
  /** The bonus searches ran (they're skipped when a check already failed). */
  bonusSearched?: boolean;
  reference: Summary & { design: string; from: string };
  bonusDesign: (Summary & { design: string }) | null;
  seed: Summary | null;
  room: { pass: number; total: number } | null;
  requires: { mat: MaterialId; best: Summary | null; ok: boolean }[];
  shortcuts: { name: string; result: Summary; ok: boolean }[];
  combosTried: number;
  seconds: number;
}

/** The contents of src/levels.res. */
export interface LevelResource {
  format: number;
  difficulty: Difficulty;
  /** What the game plays: each level's numbers and tuned geometry, by id. */
  levels: Record<string, Tuned & { fingerprint?: string }>;
  /** The tuner's full findings by level id, kept so a run can resume and the difficulty can change without a new search. */
  results: Record<string, LevelResult>;
}
