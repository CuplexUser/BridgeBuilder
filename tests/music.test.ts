import { describe, expect, it } from 'vitest';
import { compose, MOODS } from '../src/music';
import { THEMES } from '../src/render/themes';

describe('music', () => {
  it('gives every scene a mood of its own', () => {
    expect(THEMES.map((th) => th.id).filter((id) => !MOODS[id])).toEqual([]);
  });

  it('keeps every mood in a playable key, at a tempo with some go', () => {
    const bad = Object.entries(MOODS).filter(([, m]) => m.root < 40 || m.root > 60 || m.bpm < 100 || m.bpm > 140 || m.chords.length !== 4);
    expect(bad).toEqual([]);
  });

  it('writes each scene a hook that comes back the same every time', () => {
    for (const m of Object.values(MOODS)) {
      const tune = compose(m);
      expect(compose(m)).toEqual(tune);
      const notes = tune.lead.filter((n) => n !== undefined);
      // The phrase plays twice, and twice more as its first bar with an ending.
      expect(notes.length).toBeGreaterThanOrEqual(12);
      // Every note ends before the next begins, and before the loop comes round.
      for (const n of notes) expect(tune.lead.slice(n.step + 1, n.step + n.len).every((x) => x === undefined) && n.step + n.len <= 64).toBe(true);
    }
  });

  it('gives the scenes different tunes', () => {
    const hooks = new Set(Object.values(MOODS).map((m) => JSON.stringify(compose(m).lead.map((n) => n?.deg ?? '-'))));
    expect(hooks.size).toBeGreaterThan(Object.keys(MOODS).length / 2);
  });
});
