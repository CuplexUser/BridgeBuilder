import { describe, expect, it } from 'vitest';
import { levelById } from '../src/chapters';
import { Design } from '../src/design';
import type { LevelDef } from '../src/levels';
import { MATERIALS } from '../src/physics/materials';
import { TestRun, testSeconds } from '../src/physics/testrun';
import { designProblems } from '../src/rules';
import { blockGirder, deck, SOLUTIONS } from '../src/solutions';

function drive(d: Design, level: LevelDef, until = testSeconds(level)): TestRun {
  const run = new TestRun(d, level);
  while (run.status === 'running' && run.time < until) run.step();
  return run;
}

/** Got everyone across without breaking a thing. */
const clean = (run: TestRun) => run.status === 'success' && !run.world.links.some((l) => l.bridge && l.broken);

describe('prestressed concrete', () => {
  const level = levelById(71);
  const girder = (tendon: 'none' | 'low') => blockGirder(deck(new Design(level), 0, level.width), level, 2, tendon);

  it('threads a tendon straight through blocks', () => {
    expect(designProblems(level, girder('low'), { budget: false })).toEqual([]);
  });

  it('pulls the tendon tight to its prestress as the bridge takes its weight', () => {
    const run = new TestRun(girder('low'), level);
    while (run.time < 1) run.step();
    const tendons = run.world.links.filter((l) => l.mat === 'tendon');
    expect(tendons.length).toBe(2);
    for (const t of tendons) expect(t.stress * MATERIALS.tendon.tension).toBeGreaterThan(0.8 * MATERIALS.tendon.prestress!);
  });

  it('keeps a shallow girder from cracking open under a truck, where a plain one breaks', () => {
    expect(clean(drive(girder('none'), level))).toBe(false);
    expect(clean(drive(girder('low'), level))).toBe(true);
  });
});

describe('a double deck', () => {
  const level = levelById(73);

  it('sends the lower traffic out of a tunnel at its own height', () => {
    const run = new TestRun(SOLUTIONS[73](level), level);
    const [truck, loco, wagon] = run.vehicles;
    expect(truck.def.id).toBe('truck');
    expect(run.world.y[loco.rearWheel]).toBeCloseTo(level.lower!.y + loco.def.wheelR, 6);
    expect(run.world.y[wagon.rearWheel]).toBeCloseTo(level.lower!.y + wagon.def.wheelR, 6);
  });

  it('gets the truck and the train across together', () => {
    const run = drive(SOLUTIONS[73](level), level);
    expect(run.status).toBe('success');
    for (const v of run.vehicles) expect(run.world.x[v.rearWheel]).toBeGreaterThan(level.width);
  });
});

describe('moving bridges', () => {
  it('lock the leaves of a double bascule level while shut, and let them go to open', () => {
    const level = levelById(74);
    const run = new TestRun(SOLUTIONS[74](level), level);
    // The leaves meet at one joint on the lock line, split into a joint for each.
    const [p, q] = run.world.lock!;
    expect(run.world.x[p]).toBeCloseTo(level.lock!, 6);
    expect(run.world.x[q]).toBeCloseTo(level.lock!, 6);
    while (run.phase !== 'ship') run.step();
    // Open, each tip has swung up and back toward its own bank.
    const [left, right] = [p, q].map((k) => run.world.x[k]).toSorted((a, b) => a - b);
    expect(left).toBeLessThan(level.lock! - 1);
    expect(right).toBeGreaterThan(level.lock! + 1);
    while (run.status === 'running' && run.time < testSeconds(level)) run.step();
    expect(run.status).toBe('success');
    expect(Math.abs(run.world.y[p] - run.world.y[q])).toBeLessThan(0.05);
  });

  it('lift a span straight up the rails of its towers', () => {
    const level = levelById(75);
    const run = new TestRun(SOLUTIONS[75](level), level);
    const rails = run.world.guides;
    expect(rails.length).toBeGreaterThan(0);
    while (run.phase !== 'ship') run.step();
    const lifted = rails.filter((g) => run.world.y[g.p] > 1);
    expect(lifted.length).toBeGreaterThan(0);
    for (const g of rails) expect(run.world.x[g.p]).toBeCloseTo(g.x, 6);
  });

  it('hang a swing bridge from its pivot while it turns, then set its ends back on the banks', () => {
    const level = levelById(76);
    const run = new TestRun(SOLUTIONS[76](level), level);
    const ends = run.world.swingEnds;
    expect(ends).toHaveLength(2);
    while (run.phase !== 'ship') run.step();
    // Free of the banks, the ends hang lower than they rest.
    expect(ends.some((e) => run.world.y[e.p] < e.y - 0.01)).toBe(true);
    while (run.status === 'running' && run.time < testSeconds(level)) run.step();
    expect(run.status).toBe('success');
    for (const e of ends) expect(run.world.y[e.p]).toBeGreaterThan(e.y - 0.02);
  });

  it('make a waiting ship pass after the traffic, and only then count the run a success', () => {
    const level = levelById(77);
    const run = new TestRun(SOLUTIONS[77](level), level);
    let acrossFirst = false;
    while (run.status === 'running' && run.time < testSeconds(level)) {
      run.step();
      if (run.phase === 'opening' && run.trafficAcross < Infinity) acrossFirst = true;
    }
    expect(acrossFirst).toBe(true);
    expect(run.status).toBe('success');
    expect(run.shipProgress).toBeGreaterThan(1);
  });
});
