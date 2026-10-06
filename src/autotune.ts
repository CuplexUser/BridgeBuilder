import { PEAK_CAP } from '../tools/tune/difficulty';
import { grammarFor } from '../tools/tune/genome';
import type { Runner } from '../tools/tune/runner';
import { calmest, cheapest, evolve, fewest, polish, type Found, type Objective } from '../tools/tune/search';
import { Design } from './design';
import type { BonusGoal, LevelDef } from './levels';
import { MATERIALS } from './physics/materials';
import { LIMITS } from './maker';

/**
 * The level editor's quick tune: a few seconds of the level tuner's search (tools/tune), enough
 * to tell roughly what a custom level allows, then its budget, star target and bonus goal set
 * from that for the chosen difficulty. The bridges it finds stay hidden; only numbers come out.
 */

export type TuneDifficulty = 'easy' | 'medium' | 'hard';

/**
 * Slack over what the search found, by difficulty. The search is short, so what it finds is a
 * fair bridge rather than the best one, and even Hard leaves room to beat it.
 */
export const TUNE_DIFFICULTIES: Record<TuneDifficulty, { name: string; target: number; money: number; load: number; parts: number; cost: number }> = {
  // target, money: star target and budget as multiples of the cheapest bridge found.
  // load: added to the lowest peak load found, for a load-limit bonus.
  // parts: extra parts allowed over the fewest found. cost: a cost bonus over the cheapest found.
  easy: { name: 'Easy', target: 1.3, money: 2, load: 0.1, parts: 4, cost: 1.15 },
  medium: { name: 'Medium', target: 1.15, money: 1.6, load: 0.05, parts: 2, cost: 1.06 },
  hard: { name: 'Hard', target: 1.05, money: 1.35, load: 0.02, parts: 0, cost: 1.02 },
};

export const TUNE_SECONDS = 5;
/**
 * How long a tune may take in all when nothing holds after its usual time, if asked to keep
 * looking (an option in dev builds). Some levels, like a drawbridge with a convoy, drive slowly
 * enough that a few seconds is only a few dozen test drives.
 */
export const TUNE_MAX_SECONDS = 20;

/** A runner that can be told to skip runs that would start after a time (Date.now() milliseconds). */
export interface TimedRunner extends Runner {
  until: number;
}

/** What the quick tune found possible, and the numbers it set from that. */
export interface TuneResult {
  money: number;
  target: number;
  bonus: BonusGoal;
  /** The cheapest bridge found that crosses with a safe margin. */
  cost: number;
  /** The lowest peak load a bridge found within the budget reached, 0 to 1. */
  load: number;
  /**
   * The bridges behind the numbers, serialized: the cheapest, and one meeting the bonus goal
   * (null when the goal was kept unproven). Players never see them; the editor shows them in dev.
   */
  proof: { cheapest: string; bonus: string | null };
}

export interface TuneOptions {
  seconds?: number;
  /** The longest the tune may take when nothing holds in its usual time; by default, no longer. */
  maxSeconds?: number;
  /** The author's own bridge, serialized: a starting point, and the budget always covers it. */
  seed?: string;
  /** Seeds the search's random numbers. */
  random?: number;
}

/** The parts of a level that change which bridges work: everything but its words and numbers. */
export function tuneKey(l: LevelDef): string {
  const { id: _id, name: _name, tip: _tip, money: _money, target: _target, bonus: _bonus, theme: _theme, hint: _hint, hintSolves: _hs, ...rest } = l;
  return JSON.stringify(rest);
}

/**
 * Searches the level for a few seconds and sets its numbers. Null when nothing found crosses.
 * The time is split: half finding the cheapest bridge, then the lowest load, then the rest of
 * the bonus goal. Each step keeps what it has when its share runs out. When nothing holds by
 * the end of the first half, that search may go on, so the tune takes up to `maxSeconds` in
 * all, and the other two steps follow with their usual shares.
 */
export async function quickTune(runner: TimedRunner, level: LevelDef, difficulty: TuneDifficulty, opts: TuneOptions = {}): Promise<TuneResult | null> {
  // Nothing to drive on: no bridge can cross.
  if (!level.materials.some((m) => MATERIALS[m].drivable)) return null;
  const t0 = Date.now();
  const ms = (opts.seconds ?? TUNE_SECONDS) * 1000;
  // The first search may run to here, leaving the later steps their shares.
  const last = t0 + Math.max(ms, (opts.maxSeconds ?? 0) * 1000) - 0.5 * ms;
  // Shares of the time count from here; a longer first search moves it on.
  let origin = t0;
  const at = (share: number) => origin + share * ms;
  const phase = (end: number) => {
    runner.until = at(end);
    return at(end);
  };
  const random = opts.random ?? 1;
  const slack = TUNE_DIFFICULTIES[difficulty];
  const grammar = grammarFor(level);
  const search = { population: 24, generations: 1000, patience: 8 };

  // The cheapest bridge that crosses with a margin, from the search and from the author's own.
  // Once something holds, the search stops at its share of the time. Until then it goes on, up
  // to the longest time allowed, and the later steps count their shares from when it stops.
  const refObj = cheapest(Infinity, PEAK_CAP);
  runner.until = last;
  const author = found(refObj, await authorBridge(runner, level, opts.seed));
  const holds = (f: Found) => refObj.ok(f.outcome) || (!!author && refObj.ok(author.outcome));
  let ref = await evolve(runner, level, grammar, refObj, { ...search, seed: random, stopAt: last, enough: (f) => holds(f) && Date.now() >= at(0.38) });
  let genes = ref.genes;
  ref = better(refObj, ref, author);
  // A search that gave up without anything holding starts again from its best.
  for (let round = 1; !refObj.ok(ref.outcome) && Date.now() < last; round++) {
    const more = await evolve(runner, level, grammar, refObj, { ...search, patience: 20, seed: random + 10 * round, seeds: genes ? [genes] : [], stopAt: last, enough: holds });
    if (more.score < ref.score) [ref, genes] = [more, more.genes];
  }
  if (!refObj.ok(ref.outcome)) return null;
  origin = Math.max(t0, Date.now() - 0.38 * ms);
  let stop = phase(0.5);
  ref = await polish(runner, level, ref, refObj, { stopAt: stop });
  const { money, target } = tuneNumbers(difficulty, ref.outcome.cost, author?.outcome.crossed && !author.outcome.broken ? author.outcome.cost : null);

  // The lowest load within the budget: always worked out, as the load-limit bonus and for the author.
  stop = phase(0.8);
  const calmObj = calmest(money);
  let calm = await evolve(runner, level, grammar, calmObj, { ...search, seed: random + 1, seeds: genes ? [genes] : [], stopAt: at(0.65) });
  calm = better(calmObj, calm, found(calmObj, ref));
  calm = await polish(runner, level, calm, calmObj, { upgrades: true, stopAt: stop });
  const load = Math.min(ref.outcome.peak, calmObj.ok(calm.outcome) ? calm.outcome.peak : 1);

  // The bonus goal: the level's current kind if it can be met, else a load limit, fewest parts or cost.
  stop = phase(1);
  const kinds = [...new Set<BonusGoal['kind']>([level.bonus.kind, 'stress', 'parts', 'cost'])];
  let bonus: BonusGoal | null = null;
  let proof: Found | null = null;
  for (const kind of kinds) {
    if (kind === 'stress') {
      // A cap under the cheapest bridge's peak only comes from a calmer bridge that worked.
      const max = Math.ceil((load + slack.load) * 20 - 1e-9) / 20;
      if (max < ref.outcome.peak && max < 1) [bonus, proof] = [{ kind, max }, calm];
    } else if (kind === 'parts') {
      const obj = fewest(money, 0.98);
      const f = await polish(runner, level, found(obj, ref)!, obj, { upgrades: false, stopAt: stop });
      const max = f.outcome.parts + slack.parts;
      if (obj.ok(f.outcome) && max < ref.outcome.parts) [bonus, proof] = [{ kind, max }, f];
    } else if (kind === 'without' && level.bonus.kind === 'without' && level.materials.includes(level.bonus.mat)) {
      const mat = level.bonus.mat;
      const without: LevelDef = { ...level, materials: level.materials.filter((m) => m !== mat) };
      const obj = cheapest(money, 0.98);
      let f = await evolve(runner, without, grammarFor(without), obj, { ...search, seed: random + 2, stopAt: stop });
      f = await polish(runner, without, f, obj, { stopAt: stop });
      if (obj.ok(f.outcome)) [bonus, proof] = [{ kind, mat }, f];
    } else if (kind === 'cost') {
      const max = ceilTo(ref.outcome.cost * slack.cost, 50);
      if (max < target) [bonus, proof] = [{ kind, max }, ref];
    }
    if (bonus) break;
  }
  return {
    money,
    target,
    bonus: bonus ?? level.bonus,
    cost: ref.outcome.cost,
    load,
    proof: { cheapest: ref.design.serialize(), bonus: proof?.design.serialize() ?? null },
  };
}

/**
 * Budget and star target from the cheapest bridge found. The budget always covers the
 * author's own bridge, so a level never rules out the bridge it was tested with.
 */
export function tuneNumbers(difficulty: TuneDifficulty, best: number, author: number | null): { money: number; target: number } {
  const s = TUNE_DIFFICULTIES[difficulty];
  const target = ceilTo(best * s.target, 50);
  const money = Math.max(ceilTo(best * s.money, 100), ceilTo(target * 1.15, 100), author ? ceilTo(author, 100) : 0);
  return { money: Math.min(money, LIMITS.maxMoney), target: Math.min(target, LIMITS.maxMoney) };
}

/** The author's saved bridge, test driven, if there is one that still fits the level. */
async function authorBridge(runner: Runner, level: LevelDef, seed: string | undefined): Promise<Found | null> {
  if (!seed) return null;
  let design: Design;
  try {
    design = Design.deserialize(seed);
  } catch {
    return null;
  }
  const outcome = await runner.run(level, design);
  return outcome.valid ? { design, outcome, score: 0 } : null;
}

/** A find scored under another objective. */
function found(obj: Objective, f: Found | null): Found | null {
  return f ? { ...f, score: obj.score(f.outcome) } : null;
}

/** Whichever of two finds scores lower under the objective. */
function better(obj: Objective, a: Found, b: Found | null): Found {
  return b && obj.score(b.outcome) < obj.score(a.outcome) ? b : a;
}

function ceilTo(v: number, step: number): number {
  return Math.ceil(v / step - 1e-9) * step;
}
