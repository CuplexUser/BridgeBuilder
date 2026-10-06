import { describe, expect, it } from 'vitest';
import { quickTune, tuneKey, tuneNumbers, type TimedRunner } from '../src/autotune';
import type { Design } from '../src/design';
import { levelById } from '../src/chapters';
import type { LevelDef } from '../src/levels';
import { blankLevel, CUSTOM_ID_BASE, makerWarnings } from '../src/maker';
import { SOLUTIONS } from '../src/solutions';
import { failed } from '../tools/tune/runner';
import { simulate } from '../tools/tune/simulate';

/** Test drives in this thread, skipping runs after `until` the way the browser's pool does. */
class LocalRunner implements TimedRunner {
  until = Infinity;
  async run(level: LevelDef, d: Design, seconds = 30) {
    const local = { cost: d.cost(), parts: d.parts() };
    if (Date.now() >= this.until) return { ...failed('out of time'), ...local };
    return { ...simulate(level, d.serialize(), seconds), ...local };
  }
}

/** A built-in level as a custom one: its geometry, with editor-default numbers. */
function asCustom(id: number): LevelDef {
  return { ...structuredClone(levelById(id)), id: CUSTOM_ID_BASE, money: 12000, target: 9000, bonus: { kind: 'stress', max: 0.5 } };
}

describe('quick tune', () => {
  it('leaves more room on easier difficulties, and the budget covers the author’s bridge', () => {
    const easy = tuneNumbers('easy', 10000, null);
    const medium = tuneNumbers('medium', 10000, null);
    const hard = tuneNumbers('hard', 10000, null);
    expect(easy.target).toBeGreaterThan(medium.target);
    expect(medium.target).toBeGreaterThan(hard.target);
    expect(easy.money).toBeGreaterThan(medium.money);
    expect(medium.money).toBeGreaterThan(hard.money);
    for (const n of [easy, medium, hard]) {
      expect(n.target).toBeGreaterThanOrEqual(10000);
      expect(n.money).toBeGreaterThan(n.target);
    }
    expect(tuneNumbers('hard', 10000, 30000).money).toBeGreaterThanOrEqual(30000);
  });

  it('sets numbers a bridge it found can meet, in about the time given', async () => {
    const level = asCustom(3);
    const t = Date.now();
    const r = await quickTune(new LocalRunner(), level, 'medium', { seconds: 1.5 });
    expect(Date.now() - t).toBeLessThan(4000);
    expect(r).not.toBeNull();
    expect(r!.target).toBeGreaterThanOrEqual(r!.cost);
    expect(r!.money).toBeGreaterThan(r!.target);
    expect(r!.load).toBeGreaterThan(0);
    expect(r!.load).toBeLessThan(1);
    expect(r!.bonus.kind !== 'stress' || r!.bonus.max >= r!.load).toBe(true);
  });

  it('starts from the author’s bridge and keeps it within budget', async () => {
    const level = asCustom(3);
    const own = SOLUTIONS[3](level);
    const r = await quickTune(new LocalRunner(), level, 'hard', { seconds: 1, seed: own.serialize() });
    expect(r).not.toBeNull();
    expect(r!.cost).toBeLessThanOrEqual(own.cost());
    expect(r!.money).toBeGreaterThanOrEqual(own.cost());
  });

  it('sets nothing when no bridge crosses', async () => {
    const level: LevelDef = { ...blankLevel(CUSTOM_ID_BASE), materials: ['wood', 'steel'] };
    expect(await quickTune(new LocalRunner(), level, 'medium', { seconds: 0.5 })).toBeNull();
  });

  it('keys a level by its shape, not its words or numbers', () => {
    const a = blankLevel(CUSTOM_ID_BASE);
    const b = { ...structuredClone(a), name: 'Other', money: 1, target: 1, bonus: { kind: 'parts', max: 3 } as const };
    expect(tuneKey(b)).toBe(tuneKey(a));
    expect(tuneKey({ ...a, width: 14 })).not.toBe(tuneKey(a));
  });

  it('warns when the numbers go past what the tune found', () => {
    const l = blankLevel(CUSTOM_ID_BASE);
    const found = { cost: 5000, load: 0.4 };
    l.money = 8000;
    l.target = 6000;
    l.bonus = { kind: 'stress', max: 0.45 };
    expect(makerWarnings(l, found)).toEqual([]);
    l.target = 4000;
    expect(makerWarnings(l, found)[0]).toMatch(/star target is under/);
    l.money = 4500;
    expect(makerWarnings(l, found)[0]).toMatch(/budget is under/);
    l.money = 8000;
    l.target = 6000;
    l.bonus = { kind: 'stress', max: 0.3 };
    expect(makerWarnings(l, found)[0]).toMatch(/no bridge with peak stress under 40%/);
  });
});
