import { describe, expect, it } from 'vitest';
import { Design } from '../src/design';
import { budgetOf, LEVELS } from '../src/levels';
import { MATERIAL_ORDER, MATERIALS } from '../src/physics/materials';
import { TestRun, World } from '../src/physics/world';
import { deck, hang, roadRun, SOLUTIONS } from '../src/solutions';

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

/** The obvious cable-everything answers must not work: each cable level needs an idea. */
const L = (id: number) => LEVELS[id - 1];

describe('cable levels resist the obvious answer', () => {
  const reach = MATERIALS.cable.maxLen;

  it('13: hanging every joint needs more cables than the budget, and cables alone fail', () => {
    expect(budgetOf(L(13), 'cable')).toBeLessThan(6);
    const d = hang(hang(deck(new Design(L(13)), 0, 14), [0, 6], [[2, 0], [4, 0]]), [14, 6], [[10, 0], [12, 0]]);
    expect(drive(d, 12).status).toBe('fail');
  });

  it('14: four cables plus end struts is not enough', () => {
    const d = hang(deck(new Design(L(14)), 0, 18), [9, 7], [[4, 0], [8, 0], [10, 0], [14, 0]]);
    d.add([0, -2], [2, 0], 'wood').add([18, -2], [16, 0], 'wood');
    expect(drive(d, 13).status).toBe('fail');
  });

  it('15: the middle joints are out of reach, and the reachable cables alone fail', () => {
    for (const x of [6, 8, 10]) expect(Math.min(Math.hypot(x - 1, 9), Math.hypot(x - 15, 9))).toBeGreaterThan(reach);
    const d = hang(hang(deck(new Design(L(15)), 0, 16), [1, 9], [[2, 0], [4, 0]]), [15, 9], [[12, 0], [14, 0]]);
    expect(drive(d, 14).status).toBe('fail');
  });

  it('18: cables from the tall pylon cannot carry the whole deck', () => {
    const d = new Design(L(18));
    const pts = roadRun(d, [0, 0], [24, -3]);
    hang(d, [8, 7], pts.slice(1, 7));
    expect(drive(d, 17).status).toBe('fail');
  });

  it('19 and 20: no deck joint is within one cable of a pylon top', () => {
    for (const id of [19, 20]) {
      const level = L(id);
      for (const [tx, , top] of level.towers!.filter((t) => t[2] > 5)) {
        for (let x = 0; x <= level.width; x += 2) expect(Math.hypot(x - tx, top)).toBeGreaterThan(reach);
      }
    }
  });

  it('20: bank posts and the pier alone drop the bus', () => {
    const d = new Design(L(20));
    roadRun(d, [0, 0], [32, 0], 'heavy');
    hang(hang(d, [0, 4], [[2, 0], [4, 0], [6, 0]]), [32, 4], [[26, 0], [28, 0], [30, 0]]);
    d.add([16, -4], [16, 0], 'steel');
    expect(drive(d, 19).status).toBe('fail');
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
