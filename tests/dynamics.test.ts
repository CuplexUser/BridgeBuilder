import { describe, expect, it } from 'vitest';
import { levelById } from '../src/chapters';
import { LEVELS } from '../src/levels';
import { MATERIALS } from '../src/physics/materials';
import { marchAccel, quakeAccel, testSeconds, TestRun, windGust, World } from '../src/physics/world';
import { SOLUTIONS } from '../src/solutions';

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

  it('lifts a deck the gale level ties down', () => {
    expect(galeRise(true)).toBeGreaterThan(galeRise(false));
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
