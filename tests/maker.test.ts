import { describe, expect, it } from 'vitest';
import { bonusStatus, levelBrief, traffic } from '../src/brief';
import { Design } from '../src/design';
import { LEVELS, seatPiers, type LevelDef } from '../src/levels';
import {
  addChannel,
  blankLevel,
  channelSpan,
  deckTop,
  CUSTOM_ID_BASE,
  eraseAt,
  exportLevel,
  loadCustom,
  makerIssues,
  makerWarnings,
  nextCustomId,
  openWaterAt,
  parseLevel,
  saveCustom,
  setSize,
  toggleBolt,
  togglePier,
  togglePylon,
} from '../src/maker';
import { designProblems } from '../src/rules';
import { roadRun, SOLUTIONS, trussOver } from '../src/solutions';
import type { KeyValue } from '../src/storage';
import { TestRun } from '../src/physics/world';

const WOOD = { chord: 'wood', web: 'wood', vert: 'wood' } as const;
const L = (id: number) => LEVELS.find((l) => l.id === id)!;

function drive(design: Design, level: LevelDef, seconds = 40): TestRun {
  const run = new TestRun(design, level);
  for (let i = 0; i < seconds * 60 && run.status === 'running'; i++) run.step();
  return run;
}

function memoryStore(): KeyValue {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

describe('level editor', () => {
  it('starts from a playable blank level', () => {
    expect(makerIssues(blankLevel(CUSTOM_ID_BASE))).toEqual([]);
  });

  it('exports and imports every built-in level unchanged', () => {
    for (const l of LEVELS) expect(parseLevel(exportLevel(l), l.id)).toEqual(l);
  });

  it('plays an imported level like the original', () => {
    const level = parseLevel(exportLevel(L(31)), CUSTOM_ID_BASE);
    const d = SOLUTIONS[31](level);
    expect(designProblems(level, d)).toEqual([]);
    expect(drive(d, level).status).toBe('success');
  });

  it('reads a bare LevelDef and clamps what is out of range', () => {
    const l = parseLevel(JSON.stringify({ width: 400, anchors: [[0, 0], [50, 0], [3, -100], [2, 'x']], materials: ['road', 'unobtanium'], vehicle: 'tank', money: -5 }), 1001);
    expect(l.width).toBe(40);
    expect(l.anchors).toEqual([[0, 0]]);
    expect(l.materials).toEqual(['road']);
    expect(l.vehicle).toBe('car');
    expect(l.money).toBe(100);
    expect(l.target).toBeLessThanOrEqual(l.money);
  });

  it('refuses JSON that is not a level', () => {
    expect(() => parseLevel('{nope', 1001)).toThrow('not valid JSON');
    expect(() => parseLevel('[1, 2]', 1001)).toThrow('No level');
    expect(() => parseLevel('{"name": "x"}', 1001)).toThrow('width and anchors');
  });

  it('adds and removes bolts, but keeps the near road end', () => {
    const l = blankLevel(1000);
    expect(toggleBolt(l, 4, 3).ok).toBe(true);
    expect(l.anchors).toContainEqual([4, 3]);
    expect(toggleBolt(l, 4, 3).ok).toBe(true);
    expect(l.anchors).not.toContainEqual([4, 3]);
    expect(toggleBolt(l, 0, 0).ok).toBe(false);
    expect(toggleBolt(l, 6, l.waterY - 0.5).ok).toBe(false);
    // The far end can be freed, for a drawbridge.
    expect(toggleBolt(l, 12, 0).ok).toBe(true);
    expect(l.anchors).not.toContainEqual([12, 0]);
  });

  it('stands piers under bolts and raises pylons with a bolt on top', () => {
    const l = blankLevel(1000);
    // Off a bolt the Pier tool stands a seat, and a second tap takes it away.
    expect(togglePier(l, 6, -2).msg).toBe('Seat added');
    expect(togglePier(l, 6, -2).msg).toBe('Seat removed');
    toggleBolt(l, 6, -2);
    expect(togglePier(l, 6, -2).msg).toBe('Pier added');
    expect(l.piers).toEqual([[6, -2]]);
    // Taking the bolt off leaves the pier as a seat; erasing the seat takes the pier.
    expect(toggleBolt(l, 6, -2).msg).toMatch(/now a seat/);
    expect(l.piers).toEqual([[6, -2]]);
    expect(seatPiers(l)).toEqual([[6, -2]]);
    expect(eraseAt(l, 6, -3).msg).toBe('Seat removed');
    expect(l.piers).toEqual([]);
    // Erasing a bolted pier's bolt takes the pier with it.
    toggleBolt(l, 6, -2);
    togglePier(l, 6, -2);
    eraseAt(l, 6, -2);
    expect(l.piers).toEqual([]);

    expect(togglePylon(l, 4, 8).ok).toBe(true);
    expect(l.towers).toEqual([[4, l.waterY, 8]]);
    expect(l.anchors).toContainEqual([4, 8]);
    expect(eraseAt(l, 4, 3).msg).toBe('Pylon removed');
    expect(l.towers).toBeUndefined();
    expect(l.anchors).not.toContainEqual([4, 8]);
  });

  it('marks channels and drops the ship with the last one', () => {
    const l = blankLevel(1000);
    expect(addChannel(l, 5, 6, 0).ok).toBe(false);
    expect(addChannel(l, 8, 4, 1).ok).toBe(true);
    expect(l.channels).toEqual([[4, 8, 1]]);
    l.materials = ['road', 'wood'];
    expect(makerIssues(l)).toContain('Offer rams, or the drawbridge cannot open.');
    eraseAt(l, 6, 0);
    expect(l.channels).toBeUndefined();
    expect(l.ship).toBeUndefined();
  });

  it('makes the first channel a drawbridge, with a ship and rams', () => {
    const l = blankLevel(1000);
    expect(l.ship).toBeUndefined();
    expect(addChannel(l, 4, 8, 0).ok).toBe(true);
    expect(l.ship).toEqual({ mast: 3 });
    expect(l.materials).toEqual(['road', 'wood', 'steel', 'ram']);
    expect(makerIssues(l)).toEqual([]);
    // A second channel leaves the ship alone, and a mast of 0 is kept.
    delete l.ship;
    addChannel(l, 9, 12, 0);
    expect(l.ship).toBeUndefined();
    expect(makerWarnings(l)[0]).toMatch(/Rams only move for a tall ship/);
  });

  it('keeps channels in open water: a tap fills it, a drag stops at piers', () => {
    const l = blankLevel(1000);
    toggleBolt(l, 4, -3);
    togglePier(l, 4, -3);
    toggleBolt(l, 9, -3);
    togglePier(l, 9, -3);
    expect(openWaterAt(l, 6)).toEqual([5, 8]);
    expect(openWaterAt(l, 4)).toBeNull();
    expect(channelSpan(l, 6, 6)).toEqual({ ok: true, a: 5, b: 8 });
    expect(channelSpan(l, 6, 12)).toEqual({ ok: true, a: 6, b: 8 });
    expect(channelSpan(l, 1, 12)).toEqual({ ok: true, a: 1, b: 3 });
    expect(channelSpan(l, 4, 7).ok).toBe(false);
    expect(addChannel(l, 11, 11, deckTop(l)).ok).toBe(true);
    expect(l.channels).toEqual([[10, 12, 0]]);
  });

  it('warns while bolts at both ends pin the deck over the channel', () => {
    const l = blankLevel(1000);
    addChannel(l, 6, 12, 0);
    expect(makerWarnings(l)[0]).toMatch(/bolted at both ends/);
    toggleBolt(l, 12, 0);
    expect(makerWarnings(l)).toEqual([]);
  });

  it('stands seats anywhere in the gap, and a seat lets a channel sit mid-span', () => {
    const l = blankLevel(1000);
    setSize(l, 18, 0, -5);
    expect(togglePier(l, 15, 0)).toEqual({ ok: true, msg: 'Seat added' });
    expect(togglePier(l, 16, 0).ok).toBe(false);
    expect(togglePier(l, 6, l.waterY - 1).ok).toBe(false);
    toggleBolt(l, 6, 0);
    togglePier(l, 6, 0);
    toggleBolt(l, 10, -3);
    togglePier(l, 10, -3);
    addChannel(l, 12, 12, deckTop(l));
    expect(l.channels).toEqual([[11, 14, 0]]);
    expect(makerWarnings(l)).toEqual([]);
    // Bolting the seat pins the leaf at both ends.
    toggleBolt(l, 15, 0);
    expect(makerWarnings(l)[0]).toMatch(/bolted at both ends/);
    // Seats survive export and import.
    toggleBolt(l, 15, 0);
    expect(parseLevel(exportLevel(l), l.id).piers).toEqual(l.piers);
  });

  it('lifts a leaf off a seat mid-span while the span beyond stays put', () => {
    const l = blankLevel(1000);
    setSize(l, 18, 0, -5);
    l.anchors = [[0, 0], [18, 0]];
    for (const [x, y] of [[6, 0], [10, -3]]) {
      toggleBolt(l, x, y);
      togglePier(l, x, y);
    }
    togglePier(l, 15, 0);
    addChannel(l, 12, 12, deckTop(l));
    l.money = 1_000_000;
    l.target = 0;
    const d = new Design(l);
    trussOver(d, roadRun(d, [0, 0], [6, 0]), 2, WOOD);
    trussOver(d, roadRun(d, [6, 0], [15, 0]), 2, WOOD);
    d.add([10, -3], [10, 0], 'ram');
    trussOver(d, roadRun(d, [15, 0], [18, 0]), 1, WOOD);
    expect(designProblems(l, d)).toEqual([]);
    const run = new TestRun(d, l);
    const w = run.world;
    // The leaf and the far span each get a joint on the seat.
    expect(w.seats).toHaveLength(2);
    const lift = w.seats.map(() => 0);
    for (let i = 0; i < 40 * 60 && run.status === 'running'; i++) {
      run.step();
      w.seats.forEach((s, k) => (lift[k] = Math.max(lift[k], w.y[s.p] - s.y)));
    }
    expect(run.status).toBe('success');
    expect(Math.max(...lift)).toBeGreaterThan(3);
    expect(Math.min(...lift)).toBeLessThan(0.01);
  });

  it('carries a deck laid over a seat with no joint on it', () => {
    // A leaf from the hinge at 6 to the free far road end at 17 lays joints at 8, 10, 12, 13, 15
    // and 17, passing over the seat at 16. Without the seat this leaf sags and drops the truck.
    const l = blankLevel(1000);
    setSize(l, 17, 0, -5);
    l.anchors = [[0, 0]];
    for (const [x, y] of [[6, 0], [10, -3]]) {
      toggleBolt(l, x, y);
      togglePier(l, x, y);
    }
    togglePier(l, 16, 0);
    addChannel(l, 13, 13, deckTop(l));
    expect(makerWarnings(l)).toEqual([]);
    l.money = 1_000_000;
    l.target = 0;
    const d = new Design(l);
    trussOver(d, roadRun(d, [0, 0], [6, 0]), 2, WOOD);
    const leaf = roadRun(d, [6, 0], [17, 0]);
    expect(leaf.map(([x]) => x)).not.toContain(16);
    trussOver(d, leaf, 2, { chord: 'steel', web: 'steel', vert: 'steel' });
    d.add([10, -3], [10, 0], 'ram');
    expect(designProblems(l, d)).toEqual([]);
    const run = new TestRun(d, l);
    const w = run.world;
    expect(w.seats).toHaveLength(0);
    expect(w.rests).toHaveLength(1);
    const { link, x: sx, y: sy } = w.rests[0];
    const deckAt = () => w.y[link.a] + ((w.y[link.b] - w.y[link.a]) * (sx - w.x[link.a])) / (w.x[link.b] - w.x[link.a]);
    // As it settles, before the ship comes, the deck comes down onto the seat and no further.
    while (run.phase === 'settle' || run.time === 0) run.step();
    expect(Math.abs(deckAt() - sy)).toBeLessThan(1e-3);
    let lift = 0;
    for (let i = 0; i < 40 * 60 && run.status === 'running'; i++) {
      run.step();
      lift = Math.max(lift, Math.min(w.y[link.a], w.y[link.b]) - sy);
    }
    expect(run.status).toBe('success');
    expect(lift).toBeGreaterThan(3);
  });

  it('plays a drawbridge made in the editor', () => {
    // Bascule, from a blank level: a pier for the ram, the far end freed, a channel tapped in.
    const l = blankLevel(1000);
    setSize(l, 8, 0, -5);
    l.anchors = l.anchors.filter(([x, y]) => !(x === 0 && y === -2) && !(x === 8 && y === -2));
    toggleBolt(l, 8, 0);
    toggleBolt(l, 4, -3);
    togglePier(l, 4, -3);
    expect(addChannel(l, 6, 6, deckTop(l)).ok).toBe(true);
    expect(l.channels).toEqual([[5, 8, 0]]);
    l.money = 100000;
    l.target = 0;
    expect(makerIssues(l)).toEqual([]);
    expect(makerWarnings(l)).toEqual([]);
    const d = SOLUTIONS[31](l);
    expect(designProblems(l, d)).toEqual([]);
    expect(drive(d, l).status).toBe('success');
  });

  it('resizes the gap and moves the far road end with it', () => {
    const l = blankLevel(1000);
    toggleBolt(l, 10, 2);
    setSize(l, 8, 2, -3);
    expect(l.width).toBe(8);
    expect(l.rightY).toBe(2);
    expect(l.anchors).toContainEqual([8, 2]);
    expect(l.anchors).not.toContainEqual([12, 0]);
    expect(l.anchors).not.toContainEqual([10, 2]);
    // The water stays at least a meter below both banks.
    expect(l.waterY).toBe(-3);
    setSize(l, 8, -4, -3);
    expect(l.waterY).toBe(-5);
  });

  it('keeps custom levels and designs in storage', () => {
    const store = memoryStore();
    const a = blankLevel(CUSTOM_ID_BASE);
    const b = { ...blankLevel(nextCustomId([a])), name: 'Second' };
    expect(b.id).toBe(CUSTOM_ID_BASE + 1);
    expect(saveCustom({ levels: [a, b], designs: { [b.id]: 'x' } }, store)).toBe(true);
    const back = loadCustom(store);
    expect(back.levels.map((l) => l.name)).toEqual(['My level', 'Second']);
    expect(back.designs[b.id]).toBe('x');
  });
});

describe('level briefing', () => {
  it('lists the drawbridge, convoy and limit on Rush Hour', () => {
    const b = levelBrief(L(35));
    expect(b.goals.map((g) => g.mark)).toEqual(['★', '★', '★', '✦']);
    expect(b.goals[0].text).toBe('Get all 3 vehicles to the flag');
    expect(b.rules.join(' ')).toMatch(/tall ship with a 4 m mast/);
    expect(b.rules.join(' ')).toMatch(/convoy/);
    expect(b.rules).toContain('At most 1 ram part.');
  });

  it('says which deck carries the semi', () => {
    expect(levelBrief(L(28)).rules.join(' ')).toMatch(/semi truck weighs 40 t: road carries only 30 t\. Drive it on heavy deck/);
  });

  it('names repeated convoy vehicles once', () => {
    expect(traffic(L(32))).toBe('Delivery van ×3 · 15 t');
  });

  it('judges the bonus goal live, except stress', () => {
    const l = { ...L(3), bonus: { kind: 'without', mat: 'steel' } as const };
    const d = new Design(l);
    expect(bonusStatus(l, d)).toBe('unknown');
    d.add([0, 0], [2, 0], 'road');
    expect(bonusStatus(l, d)).toBe('met');
    d.add([0, 0], [2, 2], 'steel');
    expect(bonusStatus(l, d)).toBe('missed');
    expect(bonusStatus({ ...l, bonus: { kind: 'stress', max: 0.5 } }, d)).toBe('unknown');
  });
});

describe('stress log', () => {
  it('records the run and finds the moment and member it peaked', () => {
    const level = L(3);
    const run = drive(SOLUTIONS[3](level), level);
    const log = run.log;
    expect(log.length).toBeGreaterThan(20);
    const top = log.peakSample();
    expect(log.peak[top]).toBeCloseTo(Math.max(...log.peak), 6);
    // The recorded peak agrees with the run's own, give or take the sampling.
    expect(log.peak[top]).toBeLessThanOrEqual(run.peakStress + 1e-9);
    expect(log.peak[top]).toBeGreaterThan(run.peakStress - 0.1);
    const who = log.who[top];
    const value = who >= 0 ? log.memberPeak(who).value : log.peak[top];
    expect(value).toBeCloseTo(log.peak[top], 6);
    expect(log.sampleAt(log.t[top])).toBe(top);
    expect(log.breaks).toEqual([]);
  });

  it('records breaks on a collapse', () => {
    const level = L(7);
    const d = new Design(level);
    for (let x = 0; x < 12; x += 2) d.add([x, 0], [x + 2, 0], 'road');
    const run = drive(d, level);
    expect(run.status).toBe('fail');
    expect(run.log.breaks.length).toBeGreaterThan(0);
    const b = run.log.breaks[0];
    expect(Number.isNaN(run.log.members.at(-1)![b.member])).toBe(true);
  });
});
