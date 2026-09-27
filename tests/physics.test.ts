import { describe, expect, it } from 'vitest';
import { Design } from '../src/design';
import { LEVELS } from '../src/levels';
import { MATERIALS } from '../src/physics/materials';
import { TestRun } from '../src/physics/world';
import { deck, SOLUTIONS } from '../src/solutions';

function drive(design: Design, levelIdx: number, seconds = 25) {
  const run = new TestRun(design, LEVELS[levelIdx]);
  const steps = seconds * 60;
  for (let i = 0; i < steps && run.status === 'running'; i++) run.step();
  return run;
}

describe('reference solutions', () => {
  for (const level of LEVELS) {
    it(`level ${level.id} "${level.name}" is solvable within budget`, () => {
      const design = SOLUTIONS[level.id](level);
      for (const m of design.members) {
        const a = design.nodes[m.a];
        const b = design.nodes[m.b];
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(MATERIALS[m.mat].maxLen);
      }
      for (const mat of ['road', 'wood', 'steel'] as const) {
        expect(design.count(mat), `${mat} count`).toBeLessThanOrEqual(level.budget[mat]);
      }
      const run = drive(design, level.id - 1);
      const broken = run.world.links.filter((l) => l.bridge && l.broken).length;
      expect({ status: run.status, reason: run.reason, broken }).toEqual({ status: 'success', reason: '', broken: 0 });
      expect(run.peakStress).toBeLessThan(1);
      console.log(`level ${level.id}: ${design.members.length} parts, peak stress ${run.peakStress.toFixed(2)}, ${run.time.toFixed(1)}s`);
    });
  }
});

describe('failures', () => {
  it('a bare deck with no bracing collapses on level 1', () => {
    const run = drive(deck(new Design(LEVELS[0]), 0, 4), 0);
    expect(run.status).toBe('fail');
    expect(run.world.links.some((l) => l.broken)).toBe(true);
  });

  it('an empty level drops the car in the water', () => {
    const run = drive(new Design(LEVELS[0]), 0);
    expect(run.status).toBe('fail');
    expect(run.splashed).toBe(true);
  });

  it('a bare 8 m deck on level 3 fails', () => {
    const run = drive(deck(new Design(LEVELS[2]), 0, 8), 2);
    expect(run.status).toBe('fail');
  });
});

describe('stability', () => {
  it('a loaded truss stays bounded (no energy explosion)', () => {
    const level = LEVELS[3];
    const run = new TestRun(SOLUTIONS[4](level), level);
    let maxSpeed = 0;
    for (let i = 0; i < 600; i++) {
      run.step();
      const w = run.world;
      for (let p = 0; p < w.count; p++) maxSpeed = Math.max(maxSpeed, Math.hypot(w.vx[p], w.vy[p]));
    }
    expect(maxSpeed).toBeLessThan(15);
  });
});
