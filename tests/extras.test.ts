import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, challengeBoardKey, earnedBy, LEADERBOARDS, momentAchievement, progressScores, slug } from '../src/achievements';
import { CHAPTERS, FREE_CHAPTERS, inFullGame, type BestMap } from '../src/chapters';
import { HapticFeel } from '../src/haptics';
import { LEVELS } from '../src/levels';
import type { Pulse } from '../src/platform';
import { blankProgress, LocalStore, mergeLocalData, type KeyValue, type LocalData } from '../src/storage';

function memoryKv(): KeyValue {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

/** A HapticFeel on a clock the test sets, recording its pulses. */
function feel() {
  let t = 0;
  const pulses: Pulse[] = [];
  const h = new HapticFeel((p) => pulses.push(p), () => t);
  return { h, pulses, at: (ms: number) => (t = ms) };
}

describe('haptics', () => {
  it('rations creaks, faster as a member nears breaking', () => {
    const { h, pulses, at } = feel();
    at(1000);
    h.creak(0.8);
    at(1100);
    h.creak(0.8);
    expect(pulses).toEqual(['light']);
    at(1200);
    h.creak(0.8);
    at(1300);
    h.creak(0.97);
    expect(pulses).toEqual(['light', 'light', 'light']);
  });

  it('gives each snap a hard pulse, one per burst, and holds creaks back after it', () => {
    const { h, pulses, at } = feel();
    at(1000);
    h.snap();
    h.snap();
    at(1050);
    h.creak(0.9);
    at(1100);
    h.snap();
    h.collapse();
    expect(pulses).toEqual(['heavy', 'heavy', 'long']);
  });

  it('stays still when turned off', () => {
    const { h, pulses, at } = feel();
    h.enabled = false;
    at(5000);
    h.creak(1);
    h.snap();
    h.collapse();
    expect(pulses).toEqual([]);
  });
});

const crossedAll = (stars: number, bonus: boolean): BestMap => Object.fromEntries(LEVELS.map((l) => [l.id, { score: 1000, stars, ...(bonus ? { bonus } : {}) }]));

describe('achievements and leaderboards', () => {
  it('have unique keys that the Play Console can make from their names', () => {
    for (const list of [ACHIEVEMENTS, LEADERBOARDS]) {
      const keys = list.map((a) => a.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const k of keys) expect(k).toMatch(/^[a-z0-9_]+$/);
    }
    for (const a of ACHIEVEMENTS) expect(slug(a.name).replace(/^chapter_/, '')).toBe(a.key.replace(/^chapter_/, ''));
    expect(challengeBoardKey(CHAPTERS.find((c) => c.name === 'Modern Works')!)).toBe('challenge_modern_works');
  });

  it('follow from progress', () => {
    expect(earnedBy({})).toEqual([]);
    const first = CHAPTERS[0];
    const best: BestMap = Object.fromEntries(first.levels.map((id) => [id, { score: 900, stars: 2 }]));
    expect(earnedBy(best)).toEqual(['first_crossing', 'chapter_groundwork']);
    best[first.levels[0]] = { score: 1500, stars: 3, bonus: true };
    expect(earnedBy(best)).toEqual(['first_crossing', 'three_stars', 'above_and_beyond', 'chapter_groundwork']);
    const all = earnedBy(crossedAll(3, true));
    for (const k of ['chief_engineer', 'perfectionist', 'overachiever', ...CHAPTERS.map((c) => `chapter_${slug(c.name)}`)]) expect(all).toContain(k);
    expect(earnedBy(crossedAll(2, false))).not.toContain('perfectionist');
  });

  it('name every achievement they can earn', () => {
    const keys = ACHIEVEMENTS.map((a) => a.key);
    for (const k of earnedBy(crossedAll(3, true))) expect(keys).toContain(k);
    for (const m of ['collapse', 'challenge', 'flawless', 'playtest'] as const) expect(keys).toContain(momentAchievement(m));
    const boards = LEADERBOARDS.map((b) => b.key);
    for (const s of progressScores({})) expect(boards).toContain(s.key);
    for (const c of CHAPTERS) expect(boards).toContain(challengeBoardKey(c));
  });
});

describe('full game', () => {
  it('leaves the first chapters free and sells the rest', () => {
    expect(CHAPTERS.filter((c) => !inFullGame(c))).toEqual(CHAPTERS.slice(0, FREE_CHAPTERS));
    expect(CHAPTERS.slice(FREE_CHAPTERS).every(inFullGame)).toBe(true);
  });
});

const data = (d: Partial<LocalData>): LocalData => ({ profiles: [], progress: {}, highs: [], ...d });
const run = (name: string, score: number, chapter = 21) => ({ name, score, levels: 7, chapter, date: '2026-10-01' });

describe('cloud save merge', () => {
  it('matches profiles by name and keeps the better result on every level', () => {
    const here = data({
      profiles: [{ id: 'a', name: 'Ada', created: '2026-01-01' }],
      progress: { a: { best: { 1: { score: 900, stars: 2, design: 'mine' }, 2: { score: 500, stars: 1, bonus: true } }, unlocked: 3, designs: { 1: 'here' }, hints: { 2: [0] } } },
    });
    const there = data({
      profiles: [
        { id: 'x', name: 'ada', created: '2026-02-01' },
        { id: 'y', name: 'Brunel', created: '2026-02-01' },
      ],
      progress: {
        x: { best: { 1: { score: 1200, stars: 3, design: 'theirs' }, 2: { score: 400, stars: 2 }, 3: { score: 700, stars: 2 } }, unlocked: 5, designs: { 1: 'there', 3: 'only there' }, hints: { 2: [0, 4] } },
        y: { ...blankProgress(), best: { 1: { score: 100, stars: 1 } } },
      },
    });
    const m = mergeLocalData(here, there);
    expect(m.profiles.map((p) => p.id)).toEqual(['a', 'y']);
    const a = m.progress.a;
    expect(a.best[1]).toEqual({ score: 1200, stars: 3, design: 'theirs' });
    expect(a.best[2]).toEqual({ score: 500, stars: 2, bonus: true });
    expect(a.best[3]).toEqual({ score: 700, stars: 2 });
    expect(a.unlocked).toBe(5);
    expect(a.designs).toEqual({ 1: 'here', 3: 'only there' });
    expect(a.hints).toEqual({ 2: [0, 4] });
    expect(m.progress.y.best[1].score).toBe(100);
  });

  it('keeps the best challenge runs from both, once each', () => {
    const here = data({ highs: [run('Ada', 500), run('Ada', 300, 22)] });
    const there = data({ highs: [run('Ada', 500), run('Brunel', 800), ...Array.from({ length: 12 }, (_, i) => run(`P${i}`, 10 + i))] });
    const m = mergeLocalData(here, there);
    const board = m.highs.filter((h) => h.chapter === 21);
    expect(board).toHaveLength(10);
    expect(board.slice(0, 2).map((h) => h.score)).toEqual([800, 500]);
    expect(m.highs.filter((h) => h.chapter === 22)).toHaveLength(1);
  });

  it('merges a snapshot into a store and says whether anything changed', async () => {
    const phone = new LocalStore(memoryKv());
    const p = await phone.openProfile('Ada');
    await phone.saveProgress(p.id, { ...blankProgress(), best: { 1: { score: 900, stars: 2 } } });
    const cloud = new LocalStore(memoryKv());
    const q = await cloud.openProfile('Ada');
    await cloud.saveProgress(q.id, { ...blankProgress(), best: { 2: { score: 800, stars: 2 } } });
    expect(phone.mergeSnapshot(cloud.snapshot())).toBe(true);
    expect(phone.mergeSnapshot(cloud.snapshot())).toBe(false);
    expect(phone.mergeSnapshot('not json')).toBe(false);
    const merged = await phone.loadProgress(p.id);
    expect(Object.keys(merged.best)).toEqual(['1', '2']);
  });
});
