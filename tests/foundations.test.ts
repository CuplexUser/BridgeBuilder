import { describe, expect, it } from 'vitest';
import { levelById } from '../src/chapters';
import type { LevelDef } from '../src/levels';
import { TestRun, testSeconds } from '../src/physics/world';
import { pileSpot, pileSpots, pointAllowed } from '../src/rules';
import { pileBridge } from '../src/solutions';

function drive(d: ReturnType<typeof pileBridge>, level: LevelDef): TestRun {
  const run = new TestRun(d, level);
  while (run.status === 'running' && run.time < testSeconds(level)) run.step();
  return run;
}

/** Got everyone across without breaking a thing. */
const clean = (run: TestRun) => run.status === 'success' && !run.world.links.some((l) => l.bridge && l.broken);

/** How far the deepest bolt on mud sank, m. */
const sunk = (run: TestRun) => Math.max(...run.world.soft.map((s) => s.sunk));

/** Trusses standing on the level's own bolts in the mud. */
function onBolts(level: LevelDef): ReturnType<typeof pileBridge> {
  const xs = level.anchors.filter(([x, y]) => y < 0 && x > 0 && x < level.width).map(([x]) => x);
  return pileBridge(level, [0, ...xs, level.width], xs);
}

describe('mud', () => {
  const soft = levelById(62);

  it('lets nothing be built inside it, but takes piles on its top', () => {
    expect(pointAllowed(soft, 10, -2)).toBe(false);
    expect(pointAllowed(soft, 10, -1)).toBe(true);
    expect(pileSpot(soft, 10, -1)).toBe(true);
    // Not between whole meters, and not where the level already has a bolt.
    expect(pileSpot(soft, 10.5, -1)).toBe(false);
    expect(pileSpot(soft, 8, -1)).toBe(false);
    expect(pileSpots(soft).map(([x]) => x)).toEqual([6, 7, 9, 10, 11, 12, 13, 14, 15, 17, 18]);
  });

  it('sinks the bolts on it under a truck', () => {
    const run = drive(onBolts(soft), soft);
    expect(clean(run)).toBe(false);
    expect(sunk(run)).toBeGreaterThan(0.5);
  });

  it('holds a car on the same bolts, sinking them less', () => {
    const car = { ...soft, vehicle: 'car' } satisfies LevelDef;
    const run = drive(onBolts(car), car);
    expect(clean(run)).toBe(true);
    expect(sunk(run)).toBeLessThan(sunk(drive(onBolts(soft), soft)));
  });

  it('never sinks a pile', () => {
    const d = pileBridge(soft, [0, 12, 24], [12]);
    expect(d.nodes.filter((n) => n.pile).map((n) => [n.x, n.y])).toEqual([[12, -1]]);
    const run = drive(d, soft);
    expect(clean(run)).toBe(true);
    expect(run.world.soft.every((s) => s.sunk === 0)).toBe(true);
  });
});

describe('floods', () => {
  const flood = levelById(63);

  it('rise once the lead vehicle reaches their mark', () => {
    const run = new TestRun(onBolts(flood), flood);
    let risenAt = -1;
    while (run.status === 'running' && run.time < 10 && risenAt < 0) {
      run.step();
      if (run.world.waterY > flood.waterY + 0.01) risenAt = run.vehicleX;
    }
    expect(risenAt).toBeGreaterThan(flood.flood!.at - 4);
    expect(risenAt).toBeLessThan(flood.flood!.at + 2);
  });

  it('wash out the bolts on the mud, which hold in calm water', () => {
    const run = drive(onBolts(flood), flood);
    expect(clean(run)).toBe(false);
    expect(run.world.soft.every((s) => s.out)).toBe(true);
    const calm = { ...flood, flood: undefined };
    expect(clean(drive(onBolts(calm), calm))).toBe(true);
  });

  it('leave piles standing', () => {
    const run = drive(pileBridge(flood, [0, 10, 14, 24], [10, 14]), flood);
    expect(clean(run)).toBe(true);
    expect(run.world.waterY).toBeCloseTo(flood.waterY + flood.flood!.rise, 1);
  });
});
