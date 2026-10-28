import { describe, expect, it } from 'vitest';
import { CHAPTERS, sceneOf, sceneVariant } from '../src/chapters';
import { bridgeOf, compose, LOOP, MOODS, VARIANTS } from '../src/music';
import { THEMES } from '../src/render/themes';

const hook = (lead: ReturnType<typeof compose>['lead'], from = 0, to = LOOP) => JSON.stringify(lead.slice(from, to).map((n) => n?.deg ?? '-'));

describe('music', () => {
  it('gives every scene a mood of its own', () => {
    expect(THEMES.map((th) => th.id).filter((id) => !MOODS[id])).toEqual([]);
  });

  it('keeps every mood in a playable key, at a tempo with some go', () => {
    const bad = Object.entries(MOODS).filter(
      ([, m]) =>
        m.root < 40 ||
        m.root > 60 ||
        m.bpm < 100 ||
        m.bpm > 140 ||
        m.chords.length !== 4 ||
        bridgeOf(m).length !== 4 ||
        [...m.chords, ...bridgeOf(m)].some((d) => d < 0 || d > 6) ||
        (m.swing ?? 0) < 0 ||
        (m.swing ?? 0) > 0.3,
    );
    expect(bad).toEqual([]);
  });

  it('gives every scene a B section on chords of its own', () => {
    for (const m of Object.values(MOODS)) expect(bridgeOf(m)).not.toEqual(m.chords);
  });

  it('writes each tune a hook that comes back the same every time', () => {
    for (const m of Object.values(MOODS)) {
      for (let v = 0; v < VARIANTS; v++) {
        const tune = compose(m, v);
        expect(compose(m, v)).toEqual(tune);
        expect(tune.lead).toHaveLength(LOOP);
        const notes = tune.lead.filter((n) => n !== undefined);
        // Each section's phrase plays twice, and twice more as its first bar with an ending.
        expect(notes.length).toBeGreaterThanOrEqual(24);
        // Every note ends before the next begins, and before the loop comes round.
        for (const n of notes) expect(tune.lead.slice(n.step + 1, n.step + n.len).every((x) => x === undefined) && n.step + n.len <= LOOP).toBe(true);
      }
    }
  });

  it('answers the A section with a different phrase in B', () => {
    for (const m of Object.values(MOODS)) {
      const { lead } = compose(m);
      expect(hook(lead, LOOP / 2)).not.toEqual(hook(lead, 0, LOOP / 2));
    }
  });

  it('gives the scenes different tunes', () => {
    const hooks = new Set(Object.values(MOODS).map((m) => hook(compose(m).lead)));
    expect(hooks.size).toBeGreaterThan(Object.keys(MOODS).length / 2);
  });

  it('gives each scene several tunes', () => {
    for (const m of Object.values(MOODS)) {
      const hooks = new Set(Array.from({ length: VARIANTS }, (_, v) => hook(compose(m, v).lead)));
      expect(hooks.size).toBe(VARIANTS);
    }
  });

  it('lets a chapter of one scene play more than one tune', () => {
    for (const c of CHAPTERS) {
      const byScene = new Map<number, Set<number>>();
      for (const id of c.levels) byScene.set(sceneOf(id), (byScene.get(sceneOf(id)) ?? new Set()).add(sceneVariant(id) % VARIANTS));
      for (const [scene, variants] of byScene) {
        const levels = c.levels.filter((id) => sceneOf(id) === scene).length;
        expect(variants.size).toBe(Math.min(levels, VARIANTS));
      }
    }
  });
});
