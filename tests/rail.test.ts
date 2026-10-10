import { describe, expect, it } from 'vitest';
import { Design, type GridPt } from '../src/design';
import { Editor } from '../src/editor';
import type { LevelDef } from '../src/levels';
import { TestRun } from '../src/physics/world';
import { designProblems } from '../src/rules';
import { roadRun, trussOver } from '../src/solutions';

const noop = { place() {}, remove() {}, invalid() {} };

const LINE: LevelDef = {
  id: 980,
  name: 'Line',
  tip: '',
  width: 12,
  anchors: [
    [0, 0],
    [12, 0],
    [0, -3],
    [12, -3],
  ],
  piers: [],
  materials: ['road', 'track', 'steel'],
  vehicle: 'loco',
  convoy: ['wagon'],
  waterY: -6,
  money: 1e6,
  target: 1e6,
  bonus: { kind: 'cost', max: 0 },
};

const STEEL = { chord: 'steel', web: 'steel', vert: 'steel', end: 'steel', endWeb: 'steel' } as const;

/** A deck of `mat` with a steel truss over it and struts down to the low bolts. */
function bridge(level: LevelDef, mat: 'track' | 'road' = 'track'): Design {
  const d = new Design(level);
  const run: GridPt[] = roadRun(d, [0, 0], [level.width, 0], mat);
  trussOver(d, run, 2, STEEL);
  return d.add([0, -3], [2, 0], 'steel').add([level.width, -3], [level.width - 2, 0], 'steel');
}

function drive(d: Design, level: LevelDef, seconds = 60): TestRun {
  const run = new TestRun(d, level);
  for (let i = 0; i < 60 * seconds && run.status === 'running'; i++) run.step();
  return run;
}

describe('track', () => {
  it('climbs 3% at most', () => {
    const ed = new Editor({ ...LINE, anchors: [...LINE.anchors, [6, 1]] }, noop);
    ed.setMaterial('track');
    ed.beginAt(0, 0, 0.1, 0.1);
    ed.aim(6, 1);
    expect(ed.drag!.reason).toBe('Too steep for a train: 3% at most');
    ed.aim(12, 0);
    expect(ed.drag!.reason).toBe('');
    // Road may climb that, and the rules flag steep track in a saved design too.
    ed.setMaterial('road');
    ed.aim(6, 1);
    expect(ed.drag!.reason).toBe('');
    const d = new Design(LINE).add([0, 0], [2, 0.5], 'track');
    expect(designProblems(LINE, d).some((p) => p.includes('too steep'))).toBe(true);
  });
});

describe('trains', () => {
  it('cross on track, coupled, and keep their spacing', () => {
    const run = new TestRun(bridge(LINE), LINE);
    const [loco, wagon] = run.vehicles;
    const w = run.world;
    const gap0 = w.x[loco.rearWheel] - w.x[wagon.frontWheel];
    let most = 0;
    for (let i = 0; i < 60 * 60 && run.status === 'running'; i++) {
      run.step();
      most = Math.max(most, Math.abs(w.x[loco.rearWheel] - w.x[wagon.frontWheel] - gap0));
    }
    expect(run.status).toBe('success');
    expect(most).toBeLessThan(0.3);
  });

  it('run on track only: a road deck lets them fall through', () => {
    const run = drive(bridge(LINE, 'road'), LINE, 20);
    expect(run.status).toBe('fail');
  });

  it('stop on the bridge at a brake stop, wait, and go on, shoving the deck as they stop', () => {
    const level: LevelDef = { ...LINE, brake: { at: 9, hold: 1 } };
    const states = new Set<string>();
    const run = new TestRun(bridge(level), level);
    let push = 0;
    for (let i = 0; i < 60 * 60 && run.status === 'running'; i++) {
      run.step();
      states.add(run.brakeState);
      for (const l of run.world.links) if (l.mat === 'track' && run.brakeState === 'braking') push = Math.max(push, Math.abs(l.stress));
    }
    expect(run.status).toBe('success');
    expect([...states]).toEqual(['none', 'braking', 'held', 'done']);
    // Without the stop, the deck never works as hard while the train is in the same place.
    const free = new TestRun(bridge(LINE), LINE);
    let freePush = 0;
    for (let i = 0; i < 60 * 60 && free.status === 'running'; i++) {
      free.step();
      const front = free.world.x[free.vehicle.frontWheel];
      if (front >= 9 && front <= 10.5) for (const l of free.world.links) if (l.mat === 'track') freePush = Math.max(freePush, Math.abs(l.stress));
    }
    expect(push).toBeGreaterThan(freePush);
  });
});
