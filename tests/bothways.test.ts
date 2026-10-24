import { describe, expect, it } from 'vitest';
import { levelById } from '../src/chapters';
import { Design } from '../src/design';
import { goalX, type LevelDef } from '../src/levels';
import { convoyLayout } from '../src/physics/build';
import { TestRun, testSeconds } from '../src/physics/testrun';
import { blockGirder, deck, roadRun, SOLUTIONS, warrenAbove } from '../src/solutions';

function drive(d: Design, level: LevelDef, until = testSeconds(level)): TestRun {
  const run = new TestRun(d, level);
  while (run.status === 'running' && run.time < until) run.step();
  return run;
}

describe('oncoming traffic', () => {
  const level = levelById(78);

  it('waits on the right bank as far out as the rest wait on the left', () => {
    const places = convoyLayout(level);
    const ahead = places.filter((p) => p.dir > 0);
    const oncoming = places.filter((p) => p.dir < 0);
    expect(ahead.map((p) => p.def.id)).toEqual([level.vehicle, ...(level.convoy ?? [])]);
    expect(oncoming.map((p) => p.def.id)).toEqual([level.oncoming!.vehicle, ...(level.oncoming!.convoy ?? [])]);
    expect(new Set(oncoming.map((p) => p.lane)).size).toBe(1);
    expect(oncoming[0].lane).not.toBe(ahead[0].lane);
    expect(oncoming[0].x).toBeCloseTo(level.width - ahead[0].x, 6);
    // Each lane's lead vehicle first, the rest strung out behind it.
    for (let i = 1; i < oncoming.length; i++) expect(oncoming[i].x).toBeGreaterThan(oncoming[i - 1].x);
  });

  it('crosses to the left bank, while the rest cross to the right', () => {
    const run = drive(SOLUTIONS[78](level), level);
    expect(run.status).toBe('success');
    for (const v of run.vehicles) expect(v.dir * run.world.x[v.rearWheel]).toBeGreaterThan(v.dir * goalX(level, v.dir));
    expect(run.vehicles.some((v) => v.dir < 0)).toBe(true);
  });

  it('breaks a truss that carries one train, when two meet on it', () => {
    const d = new Design(level);
    roadRun(d, [0, 0], [level.width, 0], 'track');
    warrenAbove(d, 0, level.width, 2, 'steel');
    const one = { ...level, oncoming: undefined };
    expect(drive(d, one).status).toBe('success');
    expect(drive(d, level).status).not.toBe('success');
  });
});

describe('a balanced cantilever', () => {
  const level = levelById(81);
  const girder = (tendon: 'none' | 'draped') => blockGirder(deck(new Design(level), 0, level.width), level, 2, tendon);

  it('cracks open over the pier with no tendon, and holds with one draped over it', () => {
    expect(drive(girder('none'), level).status).not.toBe('success');
    expect(drive(girder('draped'), level).status).toBe('success');
  });
});
