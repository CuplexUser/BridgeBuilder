import { describe, expect, it } from 'vitest';
import { chapterOf } from '../src/chapters';
import { difficulty, levels, results } from '../src/levels.res';
import { applyDifficulty, DEFAULT_DIFFICULTY, deriveNumbers, normalize, rate, recheck } from '../tools/tune/difficulty';
import type { LevelResource, LevelResult } from '../tools/tune/types';

describe('difficulty', () => {
  it('reproduces every tuned level’s numbers from the stored results', () => {
    for (const [id, r] of Object.entries(results)) {
      if (!r.reference.design) continue;
      const got = deriveNumbers(difficulty, chapterOf(Number(id)).id - 1, Number(id), r.reference.cost, r.seed);
      expect({ id, ...got }).toEqual({ id, money: levels[id].money, target: levels[id].target });
    }
  });

  it("lets a level replace its chapter's slack, field by field", () => {
    const hand = null;
    const base = deriveNumbers(DEFAULT_DIFFICULTY, 0, 1, 10_000, hand);
    const own = deriveNumbers({ ...DEFAULT_DIFFICULTY, levels: { 1: { target: 1.5 } } }, 0, 1, 10_000, hand);
    expect(base).toEqual({ target: 13_000, money: 20_000 });
    expect(own).toEqual({ target: 15_000, money: 20_000 });
  });

  it('puts room into words', () => {
    expect(rate('target', 0.3)).toEqual({ step: 1, word: 'Fair' });
    expect(rate('target', 0.35)).toEqual({ step: 0, word: 'Easy' });
    expect(rate('money', 0.1)).toEqual({ step: 3, word: 'Tight' });
  });

  it('never sets a target below the best design or the working hand-made one', () => {
    const tight = { ...DEFAULT_DIFFICULTY, chapters: [{ target: 1, money: 1 }] };
    const n = deriveNumbers(tight, 0, 1, 10_100, { cost: 12_100, peak: 0.5, parts: 9, crossed: true, reason: '' });
    expect(n.target).toBe(12_250);
    expect(n.money).toBe(Math.max(13_250, Math.ceil((12_100 * 1.35) / 500) * 500));
  });

  it('clamps out-of-range settings and drops empty level entries', () => {
    const n = normalize({ chapters: [{ target: 0.5, money: 9 }], seedSlack: Number.NaN, levels: { 4: { target: 1, money: 9 }, 5: {} } });
    expect(n).toEqual({ chapters: [{ target: 1, money: 4 }], seedSlack: 1.35, levels: { 4: { target: 1, money: 4 } } });
  });

  it('flags a shortcut once a bigger budget covers it, and clears it again', () => {
    const r = {
      id: 9,
      money: 10_000,
      checkedMoney: 10_000,
      bonus: { kind: 'stress', max: 0.5 },
      bonusSearched: true,
      bonusDesign: null,
      room: null,
      requires: [],
      shortcuts: [{ name: 'pricey', ok: true, result: { cost: 12_000, peak: 0.8, parts: 5, crossed: true, reason: '', valid: true } }],
    } as unknown as LevelResult;
    expect(recheck(r, 11_000, 8000)).toEqual([]);
    expect(recheck(r, 12_500, 8000)).toEqual(['shortcut "pricey" crosses for $12,000']);
  });

  it('re-derives numbers for the game and the results alike', () => {
    const res = structuredClone({ format: 1, difficulty, levels, results }) as LevelResource;
    const info = Object.fromEntries(Object.keys(results).map((id) => [id, { chapter: chapterOf(Number(id)).id - 1 }]));
    expect(applyDifficulty(res, difficulty, info)).toEqual([]);
    const easier = { ...difficulty, chapters: difficulty.chapters.map((c) => ({ target: c.target, money: c.money + 0.5 })) };
    // Some budgets rest on the hand-made design's floor instead, so not every level moves.
    const changed = applyDifficulty(res, easier, info);
    expect(changed.length).toBeGreaterThan(Object.keys(results).length / 2);
    for (const id of changed) expect(res.levels[id].money).toBeGreaterThan(levels[id].money);
    for (const [id, l] of Object.entries(res.levels)) expect(l.money).toBe(res.results[id].money);
  });
});
