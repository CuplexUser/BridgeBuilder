import { describe, expect, it } from 'vitest';
import { chapterUnlocked, CHAPTERS, continueLevel, levelCode, levelUnlocked, nextInChapter, totals, type BestMap } from '../src/chapters';
import { LEVELS } from '../src/levels';

const done = (ids: number[]): BestMap => Object.fromEntries(ids.map((id) => [id, { score: 1000, stars: 2 }]));

describe('chapters', () => {
  it('place every level in exactly one chapter', () => {
    const all = CHAPTERS.flatMap((c) => c.levels);
    expect(new Set(all)).toEqual(new Set(LEVELS.map((l) => l.id)));
    expect(all).toHaveLength(LEVELS.length);
  });

  it('get harder chapter by chapter', () => {
    CHAPTERS.forEach((c, i) => expect(c.difficulty).toBe(i + 1));
  });

  it('open the first level only, at the start', () => {
    expect(levelUnlocked(1, {})).toBe(true);
    expect(levelUnlocked(2, {})).toBe(false);
    expect(continueLevel({})).toBe(1);
    expect(levelCode(21)).toBe('1-3');
  });

  it('open levels one after another inside a chapter', () => {
    expect(levelUnlocked(2, done([1]))).toBe(true);
    expect(levelUnlocked(21, done([1]))).toBe(false);
    expect(nextInChapter(2)).toBe(21);
    expect(nextInChapter(4)).toBeNull();
  });

  it('open a chapter only when the previous one is finished', () => {
    const ch1 = CHAPTERS[0].levels;
    expect(chapterUnlocked(CHAPTERS[1], done(ch1.slice(0, -1)))).toBe(false);
    expect(chapterUnlocked(CHAPTERS[1], done(ch1))).toBe(true);
    expect(continueLevel(done(ch1))).toBe(CHAPTERS[1].levels[0]);
  });

  it('sum career totals from best results', () => {
    expect(totals(done([1, 2]))).toEqual({ score: 2000, stars: 4, crossed: 2 });
  });
});
