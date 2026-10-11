import { describe, expect, it } from 'vitest';
import { challengeBoard, chapterUnlocked, CHAPTERS, continueLevel, levelCode, levelUnlocked, nextInChapter, sceneOf, totals, type BestMap } from '../src/chapters';
import { LEVELS } from '../src/levels';
import { THEMES } from '../src/render/themes';
import { mapLayout, perRow } from '../src/ui/chaptermap';

const done = (ids: number[]): BestMap => Object.fromEntries(ids.map((id) => [id, { score: 1000, stars: 2 }]));

describe('chapters', () => {
  it('place every level in exactly one chapter', () => {
    const all = CHAPTERS.flatMap((c) => c.levels);
    expect(new Set(all)).toEqual(new Set(LEVELS.map((l) => l.id)));
    expect(all).toHaveLength(LEVELS.length);
  });

  it('hold seven levels each', () => {
    expect(CHAPTERS.map((c) => c.levels.length)).toEqual(CHAPTERS.map(() => 7));
  });

  it('teach each mechanic before any level uses it: every ghost comes before the rest of its topic', () => {
    const order = CHAPTERS.flatMap((c) => c.levels);
    const at = (id: number) => order.indexOf(id);
    // Each mechanic's ghost, and levels that build on it.
    const after: [number, number[]][] = [
      [13, [14, 15, 24, 16]],
      [31, [34, 35]],
      [36, [37, 38, 39, 40, 41]],
      [41, [42, 43, 44, 45, 56, 58, 59, 60, 68]],
      [46, [47, 48, 49, 50, 55, 69]],
      [51, [52, 53, 54, 55, 66]],
      [56, [57, 58, 59, 60, 68]],
      [61, [62, 63, 64, 65, 66, 67, 70]],
    ];
    for (const [ghost, uses] of after) for (const id of uses) expect(at(id), `${id} after ${ghost}`).toBeGreaterThan(at(ghost));
  });

  it('give every level a scene, and keep challenge boards clear of the five-level chapters', () => {
    for (const l of LEVELS) expect(THEMES[sceneOf(l.id)], `${l.id}`).toBeDefined();
    expect(sceneOf(61)).toBe(THEMES.findIndex((t) => t.id === 'delta'));
    for (const c of CHAPTERS) expect(challengeBoard(c.id)).toBeGreaterThan(13);
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
    expect(nextInChapter(CHAPTERS[0].levels.at(-1)!)).toBeNull();
  });

  it('open a chapter only when the previous one is finished', () => {
    const ch1 = CHAPTERS[0].levels;
    expect(chapterUnlocked(CHAPTERS[1], done(ch1.slice(0, -1)))).toBe(false);
    expect(chapterUnlocked(CHAPTERS[1], done(ch1))).toBe(true);
    expect(continueLevel(done(ch1))).toBe(CHAPTERS[1].levels[0]);
  });

  it('keep levels crossed before the chapters were regrouped open', () => {
    // Crossed back when 31 was the first level of its own chapter; it now sits mid-way through chapter 4.
    const best = done([...CHAPTERS[0].levels, 31]);
    expect(levelUnlocked(31, best)).toBe(true);
    expect(chapterUnlocked(CHAPTERS[3], best)).toBe(true);
    expect(levelUnlocked(CHAPTERS[3].levels[0], best)).toBe(true);
    expect(levelUnlocked(CHAPTERS[3].levels[1], best)).toBe(false);
  });

  it('sum career totals from best results', () => {
    expect(totals(done([1, 2]))).toEqual({ score: 2000, stars: 4, bonus: 0, crossed: 2 });
    expect(totals({ 1: { score: 1500, stars: 3, bonus: true } }).bonus).toBe(1);
  });
});

describe('chapter map', () => {
  for (const width of [340, 600, 930]) {
    it(`lays every level on one road at ${width} px, inside the width and clear of each other`, () => {
      const m = mapLayout(CHAPTERS, width);
      expect(m.nodes.map((n) => n.id)).toEqual(CHAPTERS.flatMap((c) => c.levels));
      expect(m.heads).toHaveLength(CHAPTERS.length);
      expect(m.legs).toHaveLength(m.nodes.length - 1);
      for (const n of m.nodes) {
        expect(n.x).toBeGreaterThan(0);
        expect(n.x).toBeLessThan(width);
      }
      for (const [i, a] of m.nodes.entries()) for (const b of m.nodes.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(55);
      // Each chapter's heading sits above its first level, and below the last level of the one before.
      for (const h of m.heads) {
        const ys = m.nodes.filter((n) => n.chapter === h.chapter).map((n) => n.y);
        const above = m.nodes.filter((n) => n.chapter < h.chapter).map((n) => n.y);
        expect(Math.min(...ys)).toBeGreaterThan(h.y);
        expect(Math.max(-Infinity, ...above)).toBeLessThan(h.y);
      }
    });
  }

  it('fits a chapter on one row on a wide screen, and snakes on a phone', () => {
    expect(perRow(930)).toBe(7);
    expect(perRow(340)).toBe(4);
    // A row starts on the side where the one above ended, so the road never crosses the map.
    const m = mapLayout(CHAPTERS, 340);
    const turns = m.nodes.slice(1).flatMap((b, i) => (b.y - m.nodes[i].y > 40 ? [Math.abs(b.x - m.nodes[i].x)] : []));
    expect(turns.length).toBeGreaterThan(CHAPTERS.length);
    expect(Math.max(...turns)).toBeLessThan(340 / 2);
  });
});
