/**
 * The tuner page's server side. The dev server loads it with `ssrLoadModule`, so it sees the
 * game's levels (and src/levels.res) through Vite's own plugins and picks up edits to them.
 */
import { CHAPTERS, chapterOf, levelCode } from '../../../src/chapters';
import { BASE_LEVELS } from '../../../src/levels';
import { applyDifficulty, DEFAULT_DIFFICULTY, type Difficulty, type LevelInfo } from '../difficulty';
import { DEFAULT_EFFORT, EFFORTS } from '../efforts';
import { bonusText, writeReadable } from '../exports';
import { levelFingerprint } from '../fingerprint';
import { INTENTS } from '../intents';
import { readResource, writeResource } from '../levelres.mjs';
import type { Info, LevelRow } from './protocol';

export function info(): Omit<Info, 'job' | 'log'> {
  const res = readResource();
  const levels = CHAPTERS.flatMap((c) =>
    c.levels.map((id): LevelRow => {
      const base = BASE_LEVELS.find((l) => l.id === id)!;
      const r = res.results[id];
      const tuned = res.levels[id];
      const handOk = !!r?.seed?.crossed && r.seed.peak < 1;
      return {
        id,
        code: levelCode(id),
        name: base.name,
        chapter: c.id - 1,
        tuned: !!r,
        stale: !r || r.fingerprint !== levelFingerprint(id),
        ok: !!r?.ok,
        notes: r?.notes ?? [],
        warnings: r?.warnings ?? [],
        best: r?.reference.design ? { cost: r.reference.cost, peak: r.reference.peak } : null,
        hand: handOk ? r.seed!.cost : null,
        seed: r?.seed ? { cost: r.seed.cost, peak: r.seed.peak, crossed: r.seed.crossed } : null,
        money: tuned?.money ?? 0,
        target: tuned?.target ?? 0,
        bonus: tuned ? bonusText(tuned.bonus) : '',
        effort: r?.effort ?? '',
        seconds: r?.seconds ?? 0,
      };
    }),
  );
  return {
    chapters: CHAPTERS.map((c) => ({ id: c.id, name: c.name })),
    levels,
    difficulty: res.difficulty,
    defaults: DEFAULT_DIFFICULTY,
    efforts: Object.keys(EFFORTS),
    defaultEffort: DEFAULT_EFFORT,
  };
}

/** Saves a new difficulty and re-derives every level's numbers from the stored results. */
export function saveDifficulty(d: Difficulty): { changed: number[] } {
  const res = readResource();
  const levels: LevelInfo = {};
  for (const b of BASE_LEVELS) levels[b.id] = { chapter: chapterOf(b.id).id - 1, minRoom: INTENTS[b.id]?.minRoom };
  const changed = applyDifficulty(res, d, levels);
  writeResource(res);
  writeReadable(res);
  return { changed };
}
