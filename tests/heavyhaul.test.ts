import { describe, expect, it } from 'vitest';
import { PEAK_CAP } from '../tools/tune/difficulty';
import { INTENTS } from '../tools/tune/intents';
import { levelBrief } from '../src/brief';
import { CHAPTERS, levelById, sceneOf } from '../src/chapters';
import { Design } from '../src/design';
import type { LevelDef, Pt } from '../src/levels';
import { convoyLayout } from '../src/physics/build';
import type { MaterialId } from '../src/physics/materials';
import { TestRun, testSeconds } from '../src/physics/testrun';
import { deckLoad, VEHICLES, type VehicleId } from '../src/physics/vehicles';
import { THEMES } from '../src/render/themes';
import { designProblems } from '../src/rules';
import { prattAbove, roadRun, SOLUTIONS, type TrussMats } from '../src/solutions';

const STEEL: TrussMats = { chord: 'steel', web: 'steel', vert: 'steel', end: 'steel' };

/** A plain gap between two banks, with bolts below each road end and on any piers. */
function gap(width: number, vehicle: VehicleId, piers: Pt[] = []): LevelDef {
  return {
    id: 9001,
    name: 'Test gap',
    tip: '',
    width,
    anchors: [[0, 0], [width, 0], [0, -3], [width, -3], ...piers],
    piers,
    materials: ['road', 'heavy', 'wood', 'steel'],
    money: 1e7,
    target: 0,
    vehicle,
    waterY: -8,
    bonus: { kind: 'stress', max: 0.5 },
  };
}

function drive(level: LevelDef, build: (d: Design) => void): TestRun {
  const d = new Design(level);
  build(d);
  return driveDesign(d, level);
}

function driveDesign(d: Design, level: LevelDef): TestRun {
  const run = new TestRun(d, level);
  const until = testSeconds(level);
  while (run.status === 'running' && run.time < until) run.step();
  return run;
}

/** Two 8 m spans over a pier at the road, each with a steel Pratt truss 3 m deep. */
const twoSpans = (deck: MaterialId) => (d: Design) => {
  roadRun(d, [0, 0], [16, 0], deck);
  prattAbove(d, 0, 8, 3, STEEL);
  prattAbove(d, 8, 16, 3, STEEL);
};

/** One 16 m span with a steel Pratt truss 4 m deep. */
const single = (d: Design) => {
  roadRun(d, [0, 0], [16, 0], 'heavy');
  prattAbove(d, 0, 16, 4, STEEL);
};

describe('heavy transporter', () => {
  const def = VEHICLES.transporter;

  it('weighs 120 t but presses a deck piece with only part of it', () => {
    expect(def.tonnes).toBe(120);
    expect(deckLoad(def)).toBeLessThan(def.tonnes);
    expect(deckLoad(VEHICLES.semi)).toBe(VEHICLES.semi.tonnes);
  });

  it('waits with all its axles on the bank', () => {
    const [start] = convoyLayout(gap(16, 'transporter'));
    expect(start.x + def.wheelbase).toBeLessThan(0);
    // Shorter vehicles wait where they always have.
    expect(convoyLayout(gap(16, 'semi'))[0].x).toBe(convoyLayout(gap(16, 'car'))[0].x);
  });

  it('crushes road, and says why', () => {
    const run = drive(gap(16, 'transporter', [[8, 0]]), twoSpans('road'));
    expect(run.status).toBe('fail');
    expect(run.reason).toMatch(/presses 45 t on each piece of deck\. Road carries only 30 t/);
  });

  it('crosses heavy deck on short spans', () => {
    const level = gap(16, 'transporter', [[8, 0]]);
    const run = drive(level, twoSpans('heavy'));
    expect(run.status).toBe('success');
    expect(run.peakStress).toBeLessThan(0.92);
  });

  it('breaks a truss that carries a semi', () => {
    expect(drive(gap(16, 'semi'), single).status).toBe('success');
    expect(drive(gap(16, 'transporter'), single).status).toBe('fail');
  });

  it('holds on a single span with trusses over and under the deck', () => {
    const run = drive(gap(16, 'transporter'), (d) => {
      roadRun(d, [0, 0], [16, 0], 'heavy');
      prattAbove(d, 0, 16, 4, STEEL);
      for (let x = 2; x <= 14; x += 2) d.add([x, 0], [x, -3], 'steel');
      for (let x = 0; x < 16; x += 2) d.add([x, -3], [x + 2, -3], 'steel');
      for (let x = 0; x < 8; x += 2) d.add([x, 0], [x + 2, -3], 'steel');
      for (let x = 8; x < 16; x += 2) d.add([x, -3], [x + 2, 0], 'steel');
    });
    expect(run.status).toBe('success');
  });

  it('briefs players on its spread load', () => {
    expect(levelBrief(gap(16, 'transporter')).rules.join(' ')).toMatch(/heavy transporter weighs 120 t, spread over 9 axle lines so each presses 45 t on the deck: road carries only 30 t\. Drive it on heavy deck/);
  });
});

describe('Heavy Haul chapter', () => {
  const ids = [85, 86, 87, 88, 89, 90, 91];

  it('comes after the finale, in its own scene', () => {
    expect(CHAPTERS.at(-1)!.levels).toEqual(ids);
    for (const id of ids) expect(THEMES[sceneOf(id)].id).toBe('highland');
  });

  for (const id of ids) {
    it(`crosses ${id} with its hand-made design, under the reference's stress cap`, () => {
      const level = levelById(id);
      const run = driveDesign(SOLUTIONS[id](level), level);
      expect({ status: run.status, reason: run.reason }).toMatchObject({ status: 'success' });
      expect(run.peakStress).toBeLessThanOrEqual(PEAK_CAP);
    });
  }

  it('builds every hand-made design and shortcut within the editor rules', () => {
    for (const id of ids) {
      const level = levelById(id);
      const designs = [{ name: 'hand-made', d: SOLUTIONS[id](level) }, ...(INTENTS[id].shortcuts ?? []).map((s) => ({ name: s.name, d: s.build(level) }))];
      for (const { name, d } of designs) expect({ id, name, problems: designProblems(level, d, { budget: false }) }).toEqual({ id, name, problems: [] });
    }
  });

  it('shakes down unbraced posts that hold in calm', () => {
    const level = levelById(88);
    const unbraced = INTENTS[88].shortcuts![0].build(level);
    const calm = { ...level, quake: undefined };
    expect(driveDesign(INTENTS[88].shortcuts![0].build(calm), calm).status).toBe('success');
    expect(driveDesign(unbraced, level).status).toBe('fail');
  });

  it('shakes apart a shallow stiffening truss in the gale that holds in calm', () => {
    const level = levelById(89);
    const calm = { ...level, wind: undefined };
    const shallow = INTENTS[89].shortcuts!.find((s) => s.name.includes('2 m deep'))!;
    expect(driveDesign(shallow.build(calm), calm).status).toBe('success');
    expect(driveDesign(shallow.build(level), level).status).toBe('fail');
  });

  it('floods out a truss under the road that holds when dry', () => {
    const level = levelById(90);
    const dry = { ...level, flood: undefined };
    const under = INTENTS[90].shortcuts!.find((s) => s.name.includes('under the road'))!;
    expect(driveDesign(under.build(dry), dry).status).toBe('success');
    expect(driveDesign(under.build(level), level).status).toBe('fail');
  });
});
