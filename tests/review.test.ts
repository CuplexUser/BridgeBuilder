import { describe, expect, it } from 'vitest';
import { Design } from '../src/design';
import { money } from '../src/editor';
import { efficiency, IDLE_LOAD } from '../src/efficiency';
import { LEVELS } from '../src/levels';
import { MATERIALS } from '../src/physics/materials';
import { TestRun } from '../src/physics/world';
import { bestKnown, costReview, ghosts, nextHint } from '../src/review';
import { SOLUTIONS } from '../src/solutions';

function drive(d: Design, level = LEVELS[0]): TestRun {
  const run = new TestRun(d, level);
  for (let i = 0; i < 60 * 40 && run.status === 'running'; i++) run.step();
  return run;
}

describe("engineer's review", () => {
  it('knows a best design for every built-in level, no dearer than the hand-made one', () => {
    for (const level of LEVELS) {
      const best = bestKnown(level);
      expect(best, `level ${level.id}`).not.toBeNull();
      const made = SOLUTIONS[level.id]?.(level);
      expect(best!.cost(), `level ${level.id}`).toBeLessThanOrEqual(made?.cost() ?? Infinity);
    }
  });

  it('turns every member of each best design into a ghost the design itself covers', () => {
    for (const level of LEVELS) {
      const best = bestKnown(level)!;
      const all = ghosts(best);
      for (const [a, b, mat] of all) expect(best.covers(a, b, mat), `level ${level.id}: ${mat} ${a} ${b}`).toBe(true);
      // Every member is in some ghost: straight ghosts add up to the straight members, and each main cable run is one ghost.
      const straight = best.members.reduce((t, m, i) => t + (m.mat === 'main' ? 0 : best.length(i)), 0);
      const traced = all.reduce((t, [a, b, mat]) => t + (mat === 'main' || MATERIALS[mat].cell ? 0 : Math.hypot(b[0] - a[0], b[1] - a[1])), 0);
      expect(traced, `level ${level.id}`).toBeCloseTo(straight, 3);
      expect(all.filter(([, , mat]) => mat === 'main')).toHaveLength(new Set(best.members.flatMap((m) => (m.mat === 'main' ? [m.part] : []))).size);
      // And each block is a ghost, an arch ring one for the whole ring.
      expect(all.filter(([, , mat]) => MATERIALS[mat].cell)).toHaveLength(best.cells.filter((c) => c.mat !== 'arch').length + new Set(best.cells.flatMap((c) => (c.mat === 'arch' ? [c.part] : []))).size);
      expect(nextHint(all, best, [])).toBe(-1);
    }
  });

  it('lays a deck in one ghost per straight run, before the rest', () => {
    const all = ghosts(SOLUTIONS[1](LEVELS[0]));
    expect(all[0]).toEqual([[0, 0], [4, 0], 'road']);
    expect(all.slice(1).every(([, , mat]) => mat === 'wood')).toBe(true);
  });

  it('hints the next member the design is missing, skipping ones already shown', () => {
    const level = LEVELS[0];
    const all = ghosts(SOLUTIONS[1](level));
    const d = new Design(level);
    expect(nextHint(all, d, [])).toBe(0);
    expect(nextHint(all, d, [0])).toBe(1);
    d.add([0, 0], [2, 0], 'road').add([2, 0], [4, 0], 'road');
    expect(nextHint(all, d, [])).toBe(1);
  });

  it('says how a cost compares with the best known design', () => {
    expect(costReview(1140, 1000, money)).toBe('14% above the best known design ($1,000).');
    expect(costReview(1004, 1000, money)).toBe('Within 1% of the best known design ($1,000).');
    expect(costReview(900, 1000, money)).toBe('10% under the best known design ($1,000). Remarkable.');
  });
});

describe('efficiency', () => {
  it('finds a member that carries nothing, and leaves the deck alone', () => {
    const level = { ...LEVELS[0], materials: ['road', 'wood', 'steel'] as const } as (typeof LEVELS)[0];
    const d = SOLUTIONS[1](level);
    // A spare wood brace from the deck up to a joint nothing else holds.
    d.add([2, 0], [3, 1.5], 'wood');
    const run = drive(d, level);
    expect(run.status).toBe('success');
    const e = efficiency(level, d, run.peakPull, run.peakPush);
    const spare = d.findMember(d.findNode(2, 0), d.findNode(3, 1.5));
    expect(e.idle).toContain(spare);
    expect(e.idle.every((i) => !['road', 'heavy'].includes(d.members[i].mat))).toBe(true);
    expect(e.idleCost).toBe(Math.round(d.length(spare) * 90));
    expect(run.peakPull[spare]).toBeLessThanOrEqual(IDLE_LOAD);
  });

  it('suggests wood for lightly loaded steel, where the level offers wood', () => {
    const level = { ...LEVELS[0], materials: ['road', 'wood', 'steel'] } as (typeof LEVELS)[0];
    const d = new Design(level);
    d.add([0, 0], [2, 0], 'road').add([2, 0], [4, 0], 'road');
    d.add([0, -2], [2, 0], 'steel').add([4, -2], [2, 0], 'steel');
    const run = drive(d, level);
    expect(run.status).toBe('success');
    const e = efficiency(level, d, run.peakPull, run.peakPush);
    const steel = d.members.flatMap((m, i) => (m.mat === 'steel' ? [i] : []));
    expect(e.toWood.toSorted()).toEqual(steel);
    expect(e.woodParts).toBe(2);
    expect(e.woodSaving).toBe(Math.round(steel.reduce((t, i) => t + d.length(i) * (240 - 90), 0)));
    expect(efficiency({ ...level, materials: ['road', 'steel'] }, d, run.peakPull, run.peakPush).toWood).toEqual([]);
  });
});
