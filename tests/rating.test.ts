import { describe, expect, it } from 'vitest';
import { CHAPTERS, type BestMap, type ChapterDef } from '../src/chapters';
import { MAX_ASKS, RATE_FROM, shouldAsk } from '../src/rating';

/** A chapter finished with the given stars on every level. */
const finished = (c: ChapterDef, stars: number): BestMap => Object.fromEntries(c.levels.map((id) => [id, { score: 1000, stars }]));

describe('asking for a rating', () => {
  const first = CHAPTERS[RATE_FROM];

  it('waits until the last free chapter', () => {
    expect(RATE_FROM).toBe(2);
    for (const c of CHAPTERS.slice(0, RATE_FROM)) expect(shouldAsk(c, finished(c, 3), { asked: 0 })).toBe(false);
    expect(shouldAsk(first, finished(first, 2), { asked: 0 })).toBe(true);
    expect(shouldAsk(CHAPTERS.at(-1)!, finished(CHAPTERS.at(-1)!, 3), { asked: 0 })).toBe(true);
  });

  it('asks only when the chapter averages two stars a level', () => {
    const best = finished(first, 2);
    best[first.levels[0]] = { score: 1000, stars: 1 };
    expect(shouldAsk(first, best, { asked: 0 })).toBe(false);
    best[first.levels[1]] = { score: 1000, stars: 3 };
    expect(shouldAsk(first, best, { asked: 0 })).toBe(true);
  });

  it(`stops after ${MAX_ASKS} asks, or once the player has gone to rate`, () => {
    const best = finished(first, 3);
    expect(shouldAsk(first, best, { asked: MAX_ASKS - 1 })).toBe(true);
    expect(shouldAsk(first, best, { asked: MAX_ASKS })).toBe(false);
    expect(shouldAsk(first, best, { asked: 0, rated: true })).toBe(false);
  });
});
