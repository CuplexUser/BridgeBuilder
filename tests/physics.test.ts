import { describe, expect, it } from 'vitest';
import { Design } from '../src/design';
import { budgetOf, LEVELS } from '../src/levels';
import { MATERIAL_ORDER, MATERIALS } from '../src/physics/materials';
import { TestRun, World } from '../src/physics/world';
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
      for (const mat of MATERIAL_ORDER) {
        expect(design.count(mat), `${mat} count`).toBeLessThanOrEqual(budgetOf(level, mat));
      }
      const run = drive(design, level.id - 1);
      const broken = run.world.links.filter((l) => l.bridge && l.broken).length;
      expect({ status: run.status, reason: run.reason, broken }).toEqual({ status: 'success', reason: '', broken: 0 });
      expect(run.peakStress).toBeLessThan(1);
      console.log(`level ${level.id}: ${design.parts()} parts, peak stress ${run.peakStress.toFixed(2)}, ${run.time.toFixed(1)}s`);
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

function pendulum(startY: number) {
  const w = new World(2, -100);
  const top = w.addParticle(0, 0, 0);
  const bob = w.addParticle(0, -2, 200);
  const cable = MATERIALS.cable;
  const l = w.addLink(top, bob, 2 / cable.EA, { bridge: true, mat: 'cable', tensionOnly: true, tensionLimit: cable.tension, compressionLimit: Infinity });
  w.y[bob] = w.py[bob] = startY;
  return { w, bob, l };
}

describe('cables', () => {
  it('holds a hanging load in tension', () => {
    const { w, bob, l } = pendulum(-2);
    for (let i = 0; i < 120; i++) w.step();
    expect(w.y[bob]).toBeCloseTo(-2, 1);
    expect(l.stress).toBeGreaterThan(0);
    expect(l.broken).toBe(false);
  });

  it('goes slack instead of pushing', () => {
    const { w, bob, l } = pendulum(-1);
    w.step();
    // Well inside its rest length the cable exerts nothing, so the load simply falls.
    expect(w.vy[bob]).toBeLessThan(0);
    expect(l.stress).toBe(0);
  });
});
