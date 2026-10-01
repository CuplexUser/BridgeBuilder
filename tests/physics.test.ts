import { describe, expect, it } from 'vitest';
import { Design, type GridPt } from '../src/design';
import { LEVELS } from '../src/levels';
import { MATERIALS } from '../src/physics/materials';
import { VEHICLES } from '../src/physics/vehicles';
import { TestRun, World } from '../src/physics/world';
import { deck, prattAbove, roadRun, SOLUTIONS, trussOver, type TrussMats } from '../src/solutions';
import { designs } from '../src/levels.res';

function drive(design: Design, levelIdx: number, seconds = 25) {
  const run = new TestRun(design, LEVELS[levelIdx]);
  const steps = seconds * 60;
  for (let i = 0; i < steps && run.status === 'running'; i++) run.step();
  return run;
}

describe('splitting', () => {
  it('16: the same truss built without splits has more parts', () => {
    const d = prattAbove(deck(new Design(LEVELS[15]), 0, 16), 0, 16, 2, { chord: 'steel', web: 'wood', vert: 'wood', end: 'steel', endWeb: 'steel' });
    expect(d.cost()).toBe(SOLUTIONS[16](LEVELS[15]).cost());
    expect(d.parts()).toBeGreaterThan(SOLUTIONS[16](LEVELS[15]).parts());
  });
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
const DESIGNS = designs as Record<string, { reference: string; bonus: string | null }>;
const STEELY: TrussMats = { chord: 'steel', web: 'steel', vert: 'steel', end: 'steel', endWeb: 'steel' };
/** Deck joints every 2 m from x0 to x1 on the flat. */
const joints = (x0: number, x1: number): GridPt[] => Array.from({ length: (x1 - x0) / 2 + 1 }, (_, i): GridPt => [x0 + 2 * i, 0]);

describe('cable levels resist the obvious answer', () => {
  const reach = MATERIALS.cable.maxLen;

  it('15: the middle joints are out of reach of both cliffs', () => {
    for (const x of [6, 8, 10]) expect(Math.min(Math.hypot(x - 1, 9), Math.hypot(x - 15, 9))).toBeGreaterThan(reach);
  });

  it('19, 20, 29 and 30: no deck joint is within one cable of a pylon top', () => {
    for (const id of [19, 20, 29, 30]) {
      const level = L(id);
      const ref = Design.deserialize(DESIGNS[id].reference);
      const deckJoints = new Set(ref.members.flatMap((m) => (MATERIALS[m.mat].drivable ? [m.a, m.b] : [])));
      for (const [tx, , top] of level.towers!.filter((t) => t[2] > 5)) {
        for (const j of deckJoints) expect(Math.hypot(ref.nodes[j].x - tx, ref.nodes[j].y - top)).toBeGreaterThan(reach);
      }
    }
  });
});

describe('deck bending', () => {
  it('stiffens heavy deck joints but leaves road as a hinge chain', () => {
    const d = new Design(L(7));
    roadRun(d, [0, 0], [6, 0], 'heavy');
    roadRun(d, [6, 0], [12, 0]);
    // Heavy–heavy joints at 2 and 4 m; the heavy–road joint at 6 m and road joints stay hinges.
    const at = new TestRun(d, L(7)).world.bends.map((b) => d.nodes[b.b].x);
    expect(at).toHaveLength(2);
    expect(new Set(at)).toEqual(new Set([2, 4]));
  });

  it('yields: a bare heavy deck cannot carry the truck across 12 m', () => {
    const d = new Design(L(7));
    roadRun(d, [0, 0], [12, 0], 'heavy');
    d.add([0, -2], [2, 0], 'steel').add([12, -2], [10, 0], 'steel');
    expect(drive(d, 6).status).toBe('fail');
  });

  it('carries a semi across a suspension bridge', () => {
    const level = { ...L(19), vehicle: 'semi' as const };
    const run = new TestRun(SOLUTIONS[19](level), level);
    for (let i = 0; i < 25 * 60 && run.status === 'running'; i++) run.step();
    expect(run.status).toBe('success');
    expect(run.peakStress).toBeLessThan(0.95);
  });
});

describe('deck ratings', () => {
  it('road crushes under the semi, even on a truss that could carry it', () => {
    const d = new Design(L(28));
    roadRun(d, [0, 0], [24, 0]);
    for (const x0 of [0, 12]) trussOver(d, joints(x0, x0 + 12), 2, { ...STEELY, vert: 'wood' });
    d.add([12, -4], [12, 0], 'steel');
    const run = drive(d, 27);
    expect(run.status).toBe('fail');
    expect(run.world.links.some((l) => l.crushed && l.broken && l.mat === 'road')).toBe(true);
    expect(run.reason).toBe('The semi truck weighs 40 t. Road carries only 30 t.');
  });

  it('only the semi needs heavy deck', () => {
    for (const v of Object.values(VEHICLES)) {
      expect(v.tonnes <= MATERIALS.road.rating, `${v.name}`).toBe(v.id !== 'semi');
      expect(v.tonnes).toBeLessThanOrEqual(MATERIALS.heavy.rating);
    }
  });

  it('no level can be crossed on a bare heavy deck with end struts', () => {
    for (const level of LEVELS.filter((l) => l.materials.includes('heavy'))) {
      const right = level.rightY ?? 0;
      const d = new Design(level);
      roadRun(d, [0, 0], [level.width, right], 'heavy');
      for (const [x, y] of level.anchors) {
        if (x === 0 && y < 0) d.add([x, y], [2, 0], 'steel');
        if (x === level.width && y < right) d.add([x, y], [x - 2, right], 'steel');
      }
      expect(drive(d, level.id - 1).status, `level ${level.id}`).toBe('fail');
    }
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
