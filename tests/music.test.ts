import { describe, expect, it } from 'vitest';
import { MOODS } from '../src/music';
import { THEMES } from '../src/render/themes';

describe('music', () => {
  it('gives every scene a mood of its own', () => {
    expect(THEMES.map((th) => th.id).filter((id) => !MOODS[id])).toEqual([]);
  });

  it('keeps every mood in a playable key', () => {
    const bad = Object.entries(MOODS).filter(([, m]) => m.root < 40 || m.root > 60 || m.bpm < 50 || m.bpm > 120 || !m.chords.length);
    expect(bad).toEqual([]);
  });
});
