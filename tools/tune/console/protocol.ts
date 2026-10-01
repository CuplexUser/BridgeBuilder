/** What the tuner page and the dev server say to each other. */
import type { Difficulty } from '../difficulty.ts';
import { DEFAULT_EFFORT } from '../efforts.ts';

/** Options for one tuner run, as picked on the page. */
export interface RunOptions {
  /** Level ids, or null for every level. */
  levels: number[] | null;
  effort: string;
  /** Pick the most thorough effort expected to finish in this many minutes instead. */
  minutes: number | null;
  fresh: boolean;
  /** Only estimate how long each effort would take. */
  estimate: boolean;
}

/** The `npm run tune` arguments for a run. */
export function tuneArgs(o: RunOptions): string[] {
  const args: string[] = [];
  if (o.levels) args.push('--levels', o.levels.join(','));
  if (o.minutes) args.push('--time', String(o.minutes));
  else if (o.effort !== DEFAULT_EFFORT) args.push('--effort', o.effort);
  if (o.fresh) args.push('--fresh');
  if (o.estimate) args.push('--estimate');
  return args;
}

/** A running tuner's progress, as its Progress reports it. */
export interface Status {
  pct: number;
  label: string;
  detail: string;
  rate: number;
  elapsed: number;
  eta: number | null;
}

/** Seconds each effort is expected to take, at most, for the levels a run would tune. */
export interface Estimate {
  levels: number;
  rate: number;
  efforts: Record<string, number>;
}

export interface Job {
  running: boolean;
  args: string[];
  started: number;
  ended: number | null;
  /** Exit code once ended: 0 done, 130 stopped. */
  code: number | null;
  status: Status | null;
  estimate: Estimate | null;
}

/** Sent to the page over the event stream. */
export type TunerEvent = { type: 'job'; job: Job } | { type: 'status'; status: Status } | { type: 'log'; line: string } | { type: 'saved' } | { type: 'estimate'; estimate: Estimate };

/** One level, as the page lists it. */
export interface LevelRow {
  id: number;
  code: string;
  name: string;
  /** 0-based chapter index. */
  chapter: number;
  /** Has a tuning result at all. */
  tuned: boolean;
  /** Its inputs changed since it was tuned (or it never was). */
  stale: boolean;
  ok: boolean;
  notes: string[];
  warnings: string[];
  /** Cost and peak stress of the best design found. */
  best: { cost: number; peak: number } | null;
  /** Cost of the hand-made design, when it works. */
  hand: number | null;
  /** The hand-made design's run, for previewing numbers. */
  seed: { cost: number; peak: number; crossed: boolean } | null;
  money: number;
  target: number;
  bonus: string;
  effort: string;
  seconds: number;
}

export interface Info {
  chapters: { id: number; name: string }[];
  levels: LevelRow[];
  difficulty: Difficulty;
  defaults: Difficulty;
  efforts: string[];
  defaultEffort: string;
  job: Job | null;
  log: string[];
}
