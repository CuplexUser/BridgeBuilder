/**
 * How hard the tuned levels are. A level's star target and budget are the cost of the best
 * design the tuner found, times some slack. The slack lives in src/levels.res and is edited on
 * the tuner page (`npm run tuner`). Changing it re-derives every level's numbers from the stored
 * search results, with no new search.
 *
 * Nothing here imports the game, so the tuner page can preview changes in the browser.
 */
import type { LevelResource, LevelResult, Summary } from './types';

/** Peak stress the reference design may reach: a little margin below breaking. Changing it calls for a re-tune. */
export const PEAK_CAP = 0.92;

/** Slack over the best design's cost: bigger is easier. */
export interface Slack {
  /** Star target = best cost × this. */
  target: number;
  /** Budget = best cost × this. */
  money: number;
}

export interface Difficulty {
  /**
   * Slack by chapter, in order. The best cost is what a genetic search finds, which people
   * rarely match, so even the tight end leaves real room. Later chapters use the last entry.
   */
  chapters: Slack[];
  /** The hand-made design always fits the budget, with this much to spare. */
  seedSlack: number;
  /** Per-level slack by level id, in place of its chapter's. A missing field uses the chapter's. */
  levels: Record<string, Partial<Slack>>;
}

export const DEFAULT_DIFFICULTY: Difficulty = {
  chapters: [
    { target: 1.3, money: 2.0 },
    { target: 1.27, money: 1.9 },
    { target: 1.25, money: 1.8 },
    { target: 1.22, money: 1.7 },
    { target: 1.2, money: 1.6 },
    { target: 1.18, money: 1.55 },
    { target: 1.25, money: 1.75 },
  ],
  seedSlack: 1.35,
  levels: {},
};

/** Bounds the tuner page enforces, and that `normalize` clamps every slack to. */
export const LIMITS = { slack: [1, 4] } as const;

/**
 * Plain words for how much room a level leaves, by its room over the best design (slack − 1),
 * easiest first. The best design is a computer search's, which few players match, so even
 * "Very hard" can be beaten; it just takes a design close to the best one.
 */
export const RATINGS = {
  target: [
    [0.35, 'Easy'],
    [0.25, 'Fair'],
    [0.18, 'Hard'],
    [0, 'Very hard'],
  ],
  money: [
    [0.9, 'Generous'],
    [0.6, 'Comfortable'],
    [0.4, 'Snug'],
    [0, 'Tight'],
  ],
} as const satisfies Record<keyof Slack, readonly (readonly [number, string])[]>;

/** The rating for some room, as its index into RATINGS (0 = easiest) and its word. */
export function rate(kind: keyof Slack, room: number): { step: number; word: string } {
  const scale = RATINGS[kind];
  const step = scale.findIndex(([min]) => room >= min - 1e-9);
  const i = step < 0 ? scale.length - 1 : step;
  return { step: i, word: scale[i][1] };
}

/** The slack a level gets: its own where it has one, else its chapter's (0-based). */
export function slackFor(d: Difficulty, chapter: number, id: number): Slack {
  const c = d.chapters[Math.min(chapter, d.chapters.length - 1)];
  const own = d.levels[id] ?? {};
  return { target: own.target ?? c.target, money: own.money ?? c.money };
}

/** Star target and budget from the best design's cost and how the hand-made design did. */
export function deriveNumbers(d: Difficulty, chapter: number, id: number, best: number, hand: Summary | null): { money: number; target: number } {
  const s = slackFor(d, chapter, id);
  const handOk = !!hand?.crossed && hand.peak < 1;
  // The best design always earns the cost star, and so does the hand-made one when it works.
  const target = Math.max(ceilTo(best * s.target, 250), ceilTo(best, 250), handOk ? ceilTo(hand.cost, 250) : 0);
  let money = Math.max(roundTo(best * s.money, 500), target + 1000);
  if (handOk) money = Math.max(money, ceilTo(hand.cost * d.seedSlack, 500));
  return { money, target };
}

/**
 * The checks a tuned level fails under a new budget and target, worked out from what its
 * search stored, so no design is driven again. Shortcuts are exact. The "requires" checks
 * reuse the cheapest design found without the material under the old budget, so they are a
 * close estimate; the tests drive everything for real.
 */
export function recheck(r: LevelResult, money: number, target: number, minRoom?: number): string[] {
  const at = r.checkedMoney ?? r.money;
  const notes: string[] = [];
  for (const q of r.requires) {
    const b = q.best;
    if (!b) continue;
    // A pass that only the budget stopped becomes a fail once the budget covers it, and back.
    const passed = q.ok ? b.crossed && b.peak <= 1 && b.valid !== false && !b.broken && b.cost > at : true;
    if (passed && b.cost <= money) notes.push(`crosses without ${q.mat} for ${usd(b.cost)}`);
  }
  for (const s of r.shortcuts) {
    const o = s.result;
    const passed = s.ok ? o.crossed && o.valid !== false && o.cost > at : true;
    if (passed && o.cost <= money) notes.push(`shortcut "${s.name}" crosses for ${usd(o.cost)}`);
  }
  if (minRoom && r.room && r.room.pass / r.room.total < minRoom) notes.push(`room ${r.room.pass}/${r.room.total} below ${Math.round(minRoom * 100)}%`);
  if (r.bonusSearched === false) notes.push('bonus goal not searched yet');
  if (r.bonusDesign && r.bonusDesign.cost > money) notes.push(`bonus design costs ${usd(r.bonusDesign.cost)}, over the budget`);
  if (r.bonus.kind === 'cost' && r.bonus.max >= target) notes.push(`bonus cost goal ${usd(r.bonus.max)} is no harder than the star target`);
  return notes;
}

/** What each level needs from the game to apply a difficulty: its chapter (0-based) and minimum room. */
export type LevelInfo = Record<string, { chapter: number; minRoom?: number }>;

/**
 * Sets a new difficulty and re-derives every tuned level's numbers from its stored results.
 * Levels whose checks no longer hold are marked for re-tuning. Returns the ids whose numbers changed.
 */
export function applyDifficulty(res: LevelResource, d: Difficulty, info: LevelInfo): number[] {
  res.difficulty = normalize(d);
  const changed: number[] = [];
  for (const [id, r] of Object.entries(res.results)) {
    const level = info[id];
    if (!level || !r.reference.design || !res.levels[id]) continue;
    const { money, target } = deriveNumbers(res.difficulty, level.chapter, r.id, r.reference.cost, r.seed);
    if (money !== r.money || target !== r.target) changed.push(r.id);
    r.checkedMoney ??= r.money;
    r.money = money;
    r.target = target;
    r.notes = recheck(r, money, target, level.minRoom);
    r.ok = r.notes.length === 0;
    res.levels[id] = { ...res.levels[id], money, target };
  }
  return changed;
}

/** A difficulty with every number in bounds and empty per-level entries dropped. */
export function normalize(d: Difficulty): Difficulty {
  const chapters = (d.chapters?.length ? d.chapters : DEFAULT_DIFFICULTY.chapters).map((c, i) => {
    const def = DEFAULT_DIFFICULTY.chapters[Math.min(i, DEFAULT_DIFFICULTY.chapters.length - 1)];
    return { target: clamp(c.target, LIMITS.slack, def.target), money: clamp(c.money, LIMITS.slack, def.money) };
  });
  const levels: Difficulty['levels'] = {};
  for (const [id, m] of Object.entries(d.levels ?? {})) {
    const own: Partial<Slack> = {};
    for (const k of ['target', 'money'] as const) {
      if (m[k] === undefined || m[k] === null || !Number.isFinite(Number(m[k]))) continue;
      own[k] = clamp(m[k], LIMITS.slack, 1);
    }
    if (Object.keys(own).length) levels[id] = own;
  }
  return { chapters, seedSlack: clamp(d.seedSlack, LIMITS.slack, DEFAULT_DIFFICULTY.seedSlack), levels };
}

/** A number in bounds, to three decimals, or the fallback when it isn't a number. */
function clamp(v: unknown, [lo, hi]: readonly [number, number], fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 1000) / 1000)) : fallback;
}

function ceilTo(v: number, step: number): number {
  return Math.ceil(v / step) * step;
}
function roundTo(v: number, step: number): number {
  return Math.round(v / step) * step;
}
function usd(v: number): string {
  return `$${Math.round(v).toLocaleString('en-US')}`;
}
