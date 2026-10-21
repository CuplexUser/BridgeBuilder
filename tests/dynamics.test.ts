import { describe, expect, it } from 'vitest';
import { levelById } from '../src/chapters';
import { LEVELS } from '../src/levels';
import { MATERIALS } from '../src/physics/materials';
import { marchAccel, quakeAccel, windGust } from '../src/physics/hazards';
import { squadThrown, testSeconds, TestRun } from '../src/physics/testrun';
import { World } from '../src/physics/world';
import { hang, SOLUTIONS } from '../src/solutions';
import { INTENTS } from '../tools/tune/intents';

/** A damper's pull, N, one step after its free end starts moving away at `speed` m/s, gravity off. */
function pull(speed: number, viscous = MATERIALS.damper.viscous!): number {
  const w = new World(2, -100);
  w.gravityScale = 0;
  const top = w.addParticle(0, 0, 0);
  const b = w.addParticle(0, -2, 200);
  const l = w.addLink(top, b, 2 / MATERIALS.damper.EA, { bridge: true, mat: 'damper', viscous, tensionLimit: MATERIALS.damper.tension, compressionLimit: MATERIALS.damper.compression });
  w.vy[b] = -speed;
  w.step();
  return l.stress * MATERIALS.damper.tension;
}

function drive(id: number, change: (l: ReturnType<typeof levelById>) => ReturnType<typeof levelById> = (l) => l) {
  const level = change(levelById(id));
  const run = new TestRun(SOLUTIONS[id](levelById(id)), level);
  return { run, level };
}

/** How high the middle of the gale level's deck rises in its first four seconds, with or without the wind. */
function galeRise(wind: boolean): number {
  const { run } = drive(57, (l) => ({ ...l, wind: wind ? l.wind : undefined }));
  const mid = run.design.findNode(14, 0);
  let top = -Infinity;
  for (let i = 0; i < 4 * 60; i++) {
    run.step();
    top = Math.max(top, run.world.y[mid]);
  }
  return top;
}

describe('dampers', () => {
  it('push back on fast movement far harder than on slow', () => {
    expect(pull(1)).toBeGreaterThan(5 * pull(0.1));
    expect(pull(0.1)).toBeGreaterThan(0);
  });

  it('owe that to their damping, not their spring', () => {
    expect(pull(1, 0)).toBeLessThan(pull(1) / 5);
  });
});

describe('wind', () => {
  it('gusts once a period and is never quite still', () => {
    const w = { push: 300, lift: 900, period: 3 };
    const gusts = Array.from({ length: 301 }, (_, i) => windGust(w, i * 0.01));
    expect(Math.min(...gusts)).toBeCloseTo(0.15, 2);
    expect(Math.max(...gusts)).toBeCloseTo(1, 2);
    expect(windGust(w, 1.5)).toBeCloseTo(1, 5);
  });

  it('lifts the deck on the gale level', () => {
    expect(galeRise(true)).toBeGreaterThan(galeRise(false));
  });

  it('flutters a light deck apart, but not one stiffened by a truss', () => {
    const level = levelById(57);
    // Tied down to the rock, so the gusts alone don't lift it off.
    const bare = hang(INTENTS[57].shortcuts!.find((s) => s.name === 'no stiffening truss')!.build(level), [14, -5], [
      [12, 0],
      [16, 0],
    ]);
    const run = (d: typeof bare, flutter: number) => {
      const r = new TestRun(d, { ...level, wind: { ...level.wind!, flutter } });
      while (r.status === 'running' && r.time < testSeconds(level)) r.step();
      return r.status;
    };
    expect(run(bare, 0)).toBe('success');
    expect(run(bare, level.wind!.flutter!)).toBe('fail');
    expect(run(SOLUTIONS[57](level), level.wind!.flutter!)).toBe('success');
  });
});

describe('earthquakes', () => {
  const q = { g: 0.25, freq: 1.2, at: 24, dur: 8 };

  it('shake only for their duration, mostly sideways', () => {
    expect(quakeAccel(q, -0.1)).toEqual([0, 0]);
    expect(quakeAccel(q, 8.1)).toEqual([0, 0]);
    let side = 0;
    let up = 0;
    for (let t = 0; t < 8; t += 0.01) {
      const [ax, ay] = quakeAccel(q, t);
      side = Math.max(side, Math.abs(ax));
      up = Math.max(up, Math.abs(ay));
    }
    expect(side).toBeLessThanOrEqual(0.25 * 9.81 + 1e-6);
    expect(side).toBeGreaterThan(0.2 * 9.81);
    expect(up).toBeLessThan(side / 2);
  });

  it('can sweep from slow shaking to fast, to meet the sway of any bridge', () => {
    const sweep = { ...q, freq: 0.5, sweep: 3 };
    const turns = (t0: number, t1: number) => {
      let n = 0;
      for (let t = t0; t < t1; t += 0.005) if (Math.sign(quakeAccel(sweep, t)[0]) !== Math.sign(quakeAccel(sweep, t + 0.005)[0])) n++;
      return n;
    };
    expect(turns(6, 7.5)).toBeGreaterThan(2 * turns(0.5, 2));
  });

  it('start when the lead vehicle reaches their mark', () => {
    const { run, level } = drive(58);
    let startedAt = -1;
    for (let i = 0; i < 20 * 60 && run.status === 'running' && startedAt < 0; i++) {
      run.step();
      if (run.world.quakeStart < Infinity) startedAt = run.vehicleX;
    }
    expect(startedAt).toBeGreaterThan(level.quake!.at - 4);
    expect(startedAt).toBeLessThan(level.quake!.at + 1);
  });
});

describe('marching', () => {
  it('steps at the pace, pressing down and easing off', () => {
    const m = { pace: 1, force: 0.4 };
    expect(marchAccel(m, 0.25)).toBeCloseTo(0.4 * 9.81, 5);
    expect(marchAccel(m, 0.75)).toBeCloseTo(-0.4 * 9.81, 5);
    expect(marchAccel(m, 1.25)).toBeCloseTo(marchAccel(m, 0.25), 5);
  });

  it('presses only the squads, not the truck leading them', () => {
    const { run } = drive(56);
    const marchers = new Set(run.world.marchers);
    expect(run.vehicles.slice(1).every((v) => v.wheels.every((p) => marchers.has(p)))).toBe(true);
    expect(run.vehicle.wheels.some((p) => marchers.has(p))).toBe(false);
  });

  it('lets one thrown squad go into the river, and loses the run with a second', () => {
    /** Slow March's hand-made bridge, with the given squads flung up off the deck 10 s in. */
    const fling = (squads: number[]) => {
      const { run, level } = drive(56);
      const w = run.world;
      for (let i = 0; i < 600; i++) run.step();
      for (const k of squads) for (const p of [...run.vehicles[k].wheels, run.vehicles[k].rearTop, run.vehicles[k].frontTop]) w.vy[p] = 8;
      while (run.status === 'running' && run.time < testSeconds(level)) run.step();
      return run;
    };
    // The last squad in line, so the deck under the others marches on much as before.
    const one = fling([3]);
    expect(one.status).toBe('success');
    expect([...one.lost]).toEqual([one.vehicles[3]]);
    // It dropped away below the bridge, out of the way.
    expect(one.world.y[one.vehicles[3].rearWheel]).toBeLessThan(one.world.waterY);
    const two = fling([2, 3]);
    expect(two.status).toBe('fail');
    expect(two.reason).toBe('The deck threw a second squad off its feet.');
    expect(two.collapsed).toBe(false);
  });

  it('loses no squad when its boots bounce on a lively deck', () => {
    const { run, level } = drive(56);
    const w = run.world;
    const squads = run.vehicles.filter((v) => v.def.marches);
    let bounced = false;
    while (run.status === 'running' && run.time < testSeconds(level)) {
      run.step();
      // The hand-made bridge swings hard enough to whip a boot down faster than 2.5 m/s, and
      // still gets everyone across.
      if (squads.some((v) => Math.min(w.vy[v.rearWheel], w.vy[v.frontWheel]) < -2.5)) bounced = true;
      expect(squads.some((v) => squadThrown(w, v))).toBe(false);
    }
    expect(bounced).toBe(true);
    expect(run.status).toBe('success');
    expect(run.lost.size).toBe(0);
    // Off the deck and dropping fast.
    const thrown = drive(56).run;
    for (let i = 0; i < 600; i++) thrown.step();
    const v = thrown.vehicles[1];
    for (const p of [...v.wheels, v.rearTop, v.frontTop]) thrown.world.vy[p] = -3;
    for (const p of v.wheels) thrown.world.contact[p] = 0;
    expect(squadThrown(thrown.world, v)).toBe(true);
  });
});

describe('test drives', () => {
  it('last 30 s, or long enough for the slowest convoy to get its tail across', () => {
    const marches = LEVELS.filter((l) => l.convoy?.includes('troop'));
    expect(LEVELS.filter((l) => !marches.includes(l) && testSeconds(l) !== 30).map((l) => l.id)).toEqual([]);
    expect(Math.min(...marches.map(testSeconds))).toBeGreaterThan(30);
  });

  it('give the march levels time to finish', () => {
    const { run, level } = drive(56);
    while (run.status === 'running' && run.time < testSeconds(level)) run.step();
    expect(run.status).toBe('success');
    expect(run.time).toBeGreaterThan(30);
  });
});

describe('sliding bearings', () => {
  it('let the road ends ride along with a braking train, but hold them at their height', () => {
    const level = levelById(54);
    const loose = INTENTS[54].shortcuts!.find((s) => s.name === 'not braced to the low bolts')!.build(level);
    const run = new TestRun(loose, level);
    const end = loose.findNode(16, 0);
    let low = 0;
    while (run.status === 'running' && run.time < 8) {
      run.step();
      low = Math.max(low, Math.abs(run.world.y[end]));
    }
    expect(Math.abs(run.world.x[end] - 16)).toBeGreaterThan(0.5);
    expect(low).toBeLessThan(1e-6);
  });
});
