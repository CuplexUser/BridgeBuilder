import { describe, expect, it } from 'vitest';
import { PEAK_CAP } from '../tools/tune/difficulty';
import { INTENTS } from '../tools/tune/intents';
import { levelBrief } from '../src/brief';
import { CHAPTERS, levelById, sceneOf } from '../src/chapters';
import { Design } from '../src/design';
import { efficiency } from '../src/efficiency';
import { Editor } from '../src/editor';
import type { LevelDef } from '../src/levels';
import { exportLevel, parseLevel } from '../src/maker';
import { MAKER_MATERIALS, MATERIAL_ORDER, MATERIALS } from '../src/physics/materials';
import { TestRun, testSeconds } from '../src/physics/testrun';
import { THEMES } from '../src/render/themes';
import { designProblems, pointAllowed } from '../src/rules';
import { balancedLeaf, roadRun, rollingDeck, SOLUTIONS, trussOver, winchLeaf, type TrussMats } from '../src/solutions';

const STEELY: TrussMats = { chord: 'steel', web: 'steel', vert: 'steel', end: 'steel', endWeb: 'steel' };
const IDS = [92, 93, 94, 95, 96, 97, 98];

function driveDesign(d: Design, level: LevelDef): TestRun {
  const run = new TestRun(d, level);
  const until = testSeconds(level);
  while (run.status === 'running' && run.time < until) run.step();
  return run;
}

const noop = { place() {}, remove() {}, invalid() {} };
const rules = (id: number) => levelBrief(levelById(id)).rules.join(' ');

describe('Counterbalance chapter', () => {
  it('comes last, in its canal port scene', () => {
    expect(CHAPTERS.at(-1)!.name).toBe('Counterbalance');
    expect(CHAPTERS.at(-1)!.levels).toEqual(IDS);
    for (const id of IDS) expect(THEMES[sceneOf(id)].id).toBe('canal');
  });

  for (const id of IDS) {
    it(`crosses ${id} with its hand-made design, under the reference's stress cap`, () => {
      const level = levelById(id);
      const run = driveDesign(SOLUTIONS[id](level), level);
      expect({ status: run.status, reason: run.reason }).toMatchObject({ status: 'success' });
      expect(run.peakStress).toBeLessThanOrEqual(PEAK_CAP);
    });
  }

  it('builds every hand-made design and shortcut within the editor rules', () => {
    for (const id of IDS) {
      const level = { ...levelById(id), money: 1e7 };
      const designs = [{ name: 'hand-made', d: SOLUTIONS[id](level) }, ...(INTENTS[id].shortcuts ?? []).map((s) => ({ name: s.name, d: s.build(level) }))];
      for (const { name, d } of designs) expect({ id, name, problems: designProblems(level, d, { budget: false }) }).toEqual({ id, name, problems: [] });
    }
  });

  for (const id of IDS) {
    for (const s of INTENTS[id].shortcuts ?? []) {
      it(`${id} doesn't cross on the shortcut "${s.name}"`, () => {
        const level = levelById(id);
        const run = driveDesign(s.build(level), level);
        expect(run.status === 'fail' || run.peakStress >= 1).toBe(true);
      });
    }
  }

  for (const id of [92, 94, 96]) {
    it(`${id}'s ghost is a whole working bridge, built in the real editor`, () => {
      const level = levelById(id);
      expect(level.hintSolves).toBe(true);
      const ed = new Editor(level, noop);
      for (const [a, b, mat] of level.hint!) {
        ed.setMaterial(mat);
        const from = ed.design.findNode(a[0], a[1]) >= 0 ? a : b;
        const to = from === a ? b : a;
        expect(ed.beginAt(from[0], from[1], 0.01, 0.01)).toBe('node');
        ed.aim(to[0], to[1]);
        expect(ed.drag!.reason).toBeFalsy();
        ed.commit();
      }
      const run = driveDesign(ed.design, level);
      expect({ status: run.status, reason: run.reason }).toMatchObject({ status: 'success' });
      expect(run.peakStress).toBeLessThan(1);
      // Tracing it earns the cost star, as it does on the earlier ghost levels.
      expect(ed.design.cost()).toBeLessThanOrEqual(level.target);
    });
  }

  it('keeps its English tips to what the level editor allows', () => {
    for (const id of IDS) expect(levelById(id).tip.length).toBeLessThanOrEqual(200);
  });

  it('wants the deck to reach the far bank, where there is no bolt at its end', () => {
    const level = { ...levelById(94), money: 1e7 };
    const stub = new Design(level);
    trussOver(stub, roadRun(stub, [0, 0], [8, 0]), 2, STEELY);
    stub.add([2, 7], [6, 2], 'winch');
    expect(designProblems(level, stub, { budget: false })).toContain('the deck stops short of the far bank');
    expect(designProblems(level, SOLUTIONS[94](level), { budget: false })).toEqual([]);
  });

  it('holds its balancing levels to one ram, so two can\'t share the leaf', () => {
    for (const id of [92, 93]) {
      const level = { ...levelById(id), money: 1e7 };
      const twin = balancedLeaf(level, 0).add([5, -2], [7, 0], 'ram');
      expect(designProblems(level, twin, { budget: false }).join(' ')).toMatch(/over the limit of 1/);
    }
  });

  it('briefs players on the new parts in place of rams', () => {
    expect(rules(92)).toMatch(/breaks past 30 kN/);
    expect(rules(92)).toMatch(/Ballast weighs 1\.6 t a meter/);
    expect(rules(94)).toMatch(/on winches/);
    expect(rules(94)).not.toMatch(/hydraulic/);
    expect(rules(95)).toMatch(/hoist it on winches/);
    expect(rules(96)).toMatch(/rolls it 7 m back along the rail/);
    expect(rules(98)).toMatch(/^Traffic goes first/);
  });
});

describe('ballast', () => {
  it('is dead weight the efficiency count leaves out', () => {
    expect(MATERIALS.ballast.deadWeight).toBe(true);
    const level = levelById(92);
    const d = SOLUTIONS[92](level);
    const idle = d.members.map(() => 0);
    const ballast = d.members.findIndex((m) => m.mat === 'ballast');
    expect(ballast).toBeGreaterThanOrEqual(0);
    expect(efficiency(level, d, idle, idle).idle).not.toContain(ballast);
  });

  it('takes the load off a small ram', () => {
    const level = levelById(93);
    const bare = driveDesign(balancedLeaf(level, 0, STEELY), level);
    const balanced = driveDesign(balancedLeaf(level, 2, STEELY), level);
    expect(bare.reason).toMatch(/ship/);
    expect(balanced.status).toBe('success');
  });

  it('rates every ram at the level drive, however long', () => {
    const level = levelById(92);
    const run = new TestRun(SOLUTIONS[92](level), level);
    const ram = run.world.links.find((l) => l.mat === 'ram')!;
    expect(ram.drive).toBe(30000);
    expect(ram.tensionLimit).toBe(MATERIALS.ram.tension);
    const steel = run.world.links.find((l) => l.mat === 'steel')!;
    expect(steel.drive).toBe(0);
  });

  it('holds traffic on a locked ram at full strength: the drive limit is for moving the bridge', () => {
    // With a post missing out on the span, the truck's weight goes through the ram once the leaf is shut.
    const level = levelById(93);
    const hand = SOLUTIONS[93](level);
    const d = new Design(level);
    for (const m of hand.members) {
      const [p, q] = [hand.nodes[m.a], hand.nodes[m.b]];
      if (p.x === 9 && q.x === 9) continue;
      d.add([p.x, p.y], [q.x, q.y], m.mat);
    }
    const run = new TestRun(d, level);
    const ram = run.world.links.find((l) => l.mat === 'ram')!;
    const until = testSeconds(level);
    let heaviest = 0;
    while (run.status === 'running' && run.time < until) {
      run.step();
      if (run.phase === 'driving' && !ram.broken) heaviest = Math.max(heaviest, Math.abs(ram.stress) * MATERIALS.ram.compression);
    }
    expect(heaviest).toBeGreaterThan(level.drive!);
    expect(ram.broken).toBe(false);
  });

  it('still breaks a ram that has to lift more than its drive', () => {
    const level = levelById(93);
    const run = driveDesign(balancedLeaf(level, 0, STEELY), level);
    expect(run.world.links.find((l) => l.mat === 'ram')!.broken).toBe(true);
    expect(run.status).toBe('fail');
  });
});

describe('winch', () => {
  it('winds in to lift the leaf, and gravity sets it back on its seat', () => {
    const level = levelById(94);
    const d = SOLUTIONS[94](level);
    const run = new TestRun(d, level);
    const tip = d.findNode(level.width, 0);
    let high = 0;
    while (run.status === 'running' && run.phase !== 'driving') {
      run.step();
      high = Math.max(high, run.world.y[tip]);
    }
    expect(high).toBeGreaterThan(5);
    expect(Math.abs(run.world.y[tip])).toBeLessThan(0.1);
    expect(run.status).toBe('running');
  });

  it('pulls only: slack on the way down it carries nothing', () => {
    expect(MATERIALS.winch.tensionOnly).toBe(true);
    expect(MATERIALS.winch.stroke).toBeLessThan(0);
  });

  it('close to the hinge pulls too flat to lift the leaf', () => {
    const level = levelById(94);
    expect(driveDesign(winchLeaf(level, [4, 2]), level).status).toBe('fail');
    expect(driveDesign(winchLeaf(level, [8, 2]), level).status).toBe('success');
  });
});

describe('rolling deck', () => {
  it('clears the channel, returns to where it started and reseats', () => {
    const level = levelById(96);
    const d = SOLUTIONS[96](level);
    const run = new TestRun(d, level);
    const nose = d.findNode(0, 0);
    const carriage = d.findNode(12, 0);
    let back = 0;
    // The jacks have the nose back up on its seat before the car gets there.
    while (run.status === 'running' && (run.phase !== 'driving' || run.convoyX < -4)) {
      run.step();
      back = Math.max(back, run.world.x[nose]);
    }
    expect(run.status).toBe('running');
    expect(back).toBeGreaterThanOrEqual(level.retract!.travel - 0.1);
    expect(run.world.x[carriage]).toBeCloseTo(12, 1);
    expect(run.world.x[nose]).toBeLessThan(0.1);
    expect(Math.abs(run.world.y[nose])).toBeLessThan(0.1);
  });

  it('tips over its roller on a short bare tail, and says why', () => {
    const level = levelById(96);
    const run = driveDesign(rollingDeck(level, 'road', STEELY, false), level);
    expect(run.status).toBe('fail');
    expect(run.reason).toMatch(/tipped over its roller/);
  });

  it('holds on a long bare tail where the bay has room for one', () => {
    const base = levelById(96);
    const level: LevelDef = { ...base, anchors: [[0, 0], [16, 0]], retract: { carriage: [16, 0], travel: 7, bay: 9 } };
    const d = new Design(level);
    trussOver(d, roadRun(d, [0, 0], [16, 0]), 2, STEELY);
    expect(driveDesign(d, level).status).toBe('success');
  });

  it('fails when the tail kinks up behind the roller, even with the carriage still down', () => {
    // A light truss stopping short of the tail: the span tips while the bare road behind it bends.
    const level = levelById(98);
    const d = new Design(level);
    trussOver(d, roadRun(d, [0, 0], [14, 0], 'heavy').slice(0, 6), 2, { ...STEELY, web: 'wood', vert: 'wood' });
    const run = driveDesign(d, level);
    expect(run.status).toBe('fail');
    expect(run.reason).toMatch(/tipped over its roller/);
  });

  it('builds only on or above the rail, and only as far back as the bay', () => {
    const level = levelById(97);
    const W = level.width;
    expect(pointAllowed(level, W + 2, 0)).toBe(true);
    expect(pointAllowed(level, W + 5, 2)).toBe(true);
    expect(pointAllowed(level, W + 6, 0)).toBe(false);
    expect(pointAllowed(level, W + 2, -1)).toBe(false);
  });

  it('has no rail or rollers on other levels', () => {
    const level = levelById(77);
    expect(new TestRun(SOLUTIONS[77](level), level).world.retract).toBeNull();
  });
});

describe('level editor', () => {
  it("doesn't offer the new parts yet", () => {
    expect(MATERIAL_ORDER).toContain('winch');
    expect(MATERIAL_ORDER).toContain('ballast');
    expect(MAKER_MATERIALS).not.toContain('winch');
    expect(MAKER_MATERIALS).not.toContain('ballast');
  });

  it('drops them from a level pasted in', () => {
    const l = levelById(92);
    const clean = parseLevel(exportLevel(l), 1000);
    expect(clean.materials).toEqual(['road', 'steel', 'ram']);
  });
});
