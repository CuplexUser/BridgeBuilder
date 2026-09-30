import { describe, expect, it } from 'vitest';
import { Design, segmentHitsRect, type GridPt } from '../src/design';
import { Editor } from '../src/editor';
import { LEVELS } from '../src/levels';
import { MATERIALS } from '../src/physics/materials';
import { VEHICLES } from '../src/physics/vehicles';
import { TestRun, World } from '../src/physics/world';
import { bonusLabel, bonusMet } from '../src/scoring';
import { BONUS_SOLUTIONS, deck, hang, prattAbove, roadRun, SOLUTIONS, trussOver, type TrussMats } from '../src/solutions';

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
      for (const m of design.members) expect(level.materials).toContain(m.mat);
      expect(design.cost()).toBeLessThanOrEqual(level.target);
      const run = drive(design, level.id - 1);
      const broken = run.world.links.filter((l) => l.bridge && l.broken).length;
      expect({ status: run.status, reason: run.reason, broken }).toEqual({ status: 'success', reason: '', broken: 0 });
      expect(run.peakStress).toBeLessThan(1);
      console.log(`level ${level.id}: $${design.cost()} of $${level.money} (target $${level.target}), ${design.parts()} parts, peak stress ${run.peakStress.toFixed(2)}, ${run.time.toFixed(1)}s`);
    });
  }
});

describe('bonus goals are reachable', () => {
  for (const level of LEVELS) {
    it(`level ${level.id}: ${bonusLabel(level.bonus)}`, () => {
      const design = (BONUS_SOLUTIONS[level.id] ?? SOLUTIONS[level.id])(level);
      for (const m of design.members) expect(level.materials).toContain(m.mat);
      expect(design.cost()).toBeLessThanOrEqual(level.money);
      const run = drive(design, level.id - 1);
      expect(run.status).toBe('success');
      expect(run.world.links.some((l) => l.bridge && l.broken)).toBe(false);
      expect(bonusMet(level.bonus, design, run.peakStress)).toBe(true);
    });
  }

  it('16: the same truss built without splits has too many parts', () => {
    const d = prattAbove(deck(new Design(LEVELS[15]), 0, 16), 0, 16, 2, { chord: 'steel', web: 'wood', vert: 'wood', end: 'steel', endWeb: 'steel' });
    expect(d.cost()).toBe(SOLUTIONS[16](LEVELS[15]).cost());
    expect(bonusMet(LEVELS[15].bonus, d, 0)).toBe(false);
  });
});

describe('bonus designs obey the build rules', () => {
  for (const level of LEVELS.filter((l) => BONUS_SOLUTIONS[l.id])) {
    it(`level ${level.id} "${level.name}"`, () => {
      const design = BONUS_SOLUTIONS[level.id](level);
      const ed = new Editor(level, { place() {}, remove() {}, invalid() {} });
      for (const n of design.nodes) expect(ed.pointAllowed(n.x, n.y), `joint ${n.x},${n.y}`).toBe(true);
      for (const m of design.members) {
        const a = design.nodes[m.a];
        const b = design.nodes[m.b];
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(MATERIALS[m.mat].maxLen);
        for (const [x0, x1, top] of level.channels ?? []) expect(segmentHitsRect(a.x, a.y, b.x, b.y, x0, level.waterY - 10, x1, top)).toBe(false);
      }
    });
  }
});

describe('reference and bonus designs are fully connected', () => {
  for (const level of LEVELS) {
    it(`level ${level.id}: no joint hangs off a single member`, () => {
      for (const d of [SOLUTIONS[level.id](level), BONUS_SOLUTIONS[level.id]?.(level)]) {
        if (!d) continue;
        const degree = new Uint16Array(d.nodes.length);
        for (const m of d.members) {
          degree[m.a]++;
          degree[m.b]++;
        }
        const loose = d.nodes.filter((n, i) => !n.anchor && degree[i] < 2).map((n) => `${n.x},${n.y}`);
        expect(loose).toEqual([]);
      }
    });
  }
});

describe('reference designs obey the build rules', () => {
  for (const level of LEVELS) {
    it(`level ${level.id} "${level.name}"`, () => {
      const design = SOLUTIONS[level.id](level);
      const ed = new Editor(level, { place() {}, remove() {}, invalid() {} });
      for (const n of design.nodes) expect(ed.pointAllowed(n.x, n.y), `joint ${n.x},${n.y}`).toBe(true);
      for (const m of design.members) {
        const a = design.nodes[m.a];
        const b = design.nodes[m.b];
        for (const [x0, x1, top] of level.channels ?? []) expect(segmentHitsRect(a.x, a.y, b.x, b.y, x0, level.waterY - 10, x1, top)).toBe(false);
      }
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
const STEELY: TrussMats = { chord: 'steel', web: 'steel', vert: 'steel', end: 'steel', endWeb: 'steel' };
/** Deck joints every 2 m from x0 to x1 on the flat. */
const joints = (x0: number, x1: number): GridPt[] => Array.from({ length: (x1 - x0) / 2 + 1 }, (_, i): GridPt => [x0 + 2 * i, 0]);

describe('cable levels resist the obvious answer', () => {
  const reach = MATERIALS.cable.maxLen;

  it('13: hanging every joint costs more than the target, and cables alone fail', () => {
    const all = hang(hang(deck(new Design(L(13)), 0, 14), [0, 6], [[2, 0], [4, 0], [6, 0]]), [14, 6], [[8, 0], [10, 0], [12, 0]]);
    expect(all.cost()).toBeGreaterThan(L(13).target);
    const d = hang(hang(deck(new Design(L(13)), 0, 14), [0, 6], [[2, 0], [4, 0]]), [14, 6], [[10, 0], [12, 0]]);
    expect(drive(d, 12).status).toBe('fail');
  });

  it('14: hanging every joint from the pylon blows the budget', () => {
    const all = hang(deck(new Design(L(14)), 0, 18), [9, 7], [2, 4, 6, 8, 10, 12, 14, 16].map((x): [number, number] => [x, 0]));
    expect(all.cost()).toBeGreaterThan(L(14).money);
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

  it('19, 20, 29 and 30: no deck joint is within one cable of a pylon top', () => {
    for (const id of [19, 20, 29, 30]) {
      const level = L(id);
      for (const [tx, , top] of level.towers!.filter((t) => t[2] > 5)) {
        for (let x = 0; x <= level.width; x += 2) expect(Math.hypot(x - tx, top)).toBeGreaterThan(reach);
      }
    }
  });

  it('29: trusses alone drop the truck, and one deep enough to hold blows the budget', () => {
    const truss = (h: number) => {
      const d = new Design(L(29));
      roadRun(d, [0, 0], [34, 0], 'heavy');
      for (const [x0, x1] of [[0, 8], [26, 34]]) trussOver(d, joints(x0, x1), 2, STEELY);
      trussOver(d, joints(8, 26), h, STEELY);
      return d.add([0, -3], [2, 0], 'steel').add([34, -3], [32, 0], 'steel');
    };
    for (const h of [2, 3]) expect(drive(truss(h), 28).status).toBe('fail');
    // A second truss hanging under the middle span makes it deep enough, at a price.
    const deep = trussOver(truss(2), joints(8, 26), -2, STEELY);
    expect(deep.cost()).toBeGreaterThan(L(29).money);
  });

  it('30: trusses over the ship channel drop the semi', () => {
    for (const h of [2, 3]) {
      const d = new Design(L(30));
      for (const [x0, x1] of [[0, 8], [8, 28], [28, 36]]) {
        roadRun(d, [x0, 0], [x1, 0], 'heavy');
        trussOver(d, joints(x0, x1), x0 === 8 ? h : 2, STEELY);
      }
      d.add([0, -3], [2, 0], 'steel').add([36, -3], [34, 0], 'steel');
      expect(drive(d, 29).status).toBe('fail');
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

  it('27: trestles alone drop the bus', () => {
    const d = new Design(L(27));
    roadRun(d, [0, 0], [26, 0], 'heavy');
    for (const px of [9, 17]) {
      const [a, b] = [px - 1, px + 1];
      d.add([px, -6], [a, -3], 'steel').add([px, -6], [b, -3], 'steel').add([a, -3], [b, -3], 'steel');
      d.add([a, -3], [a, 0], 'steel').add([b, -3], [b, 0], 'steel').add([a, -3], [b, 0], 'steel');
    }
    d.add([0, -3], [2, 0], 'steel').add([26, -3], [24, 0], 'steel');
    expect(drive(d, 26).status).toBe('fail');
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
