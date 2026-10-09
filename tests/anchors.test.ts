import { describe, expect, it } from 'vitest';
import { Design, type GridPt } from '../src/design';
import { Editor } from '../src/editor';
import type { LevelDef } from '../src/levels';
import { exportLevel, parseLevel, setSize, toggleMast } from '../src/maker';
import { BLOCK } from '../src/physics/materials';
import { TestRun, World } from '../src/physics/world';
import { blockSpot, blockSpots, cableBolt, designProblems, pointAllowed } from '../src/rules';
import { roadRun, suspend } from '../src/solutions';

const noop = { place() {}, remove() {}, invalid() {} };

/** A 20 m gap with a hinged mast near each bank and concrete anchors up to 8 m back. */
const MASTED: LevelDef = {
  id: 900,
  name: 'Masted',
  tip: '',
  width: 20,
  anchors: [
    [0, 0],
    [20, 0],
    [0, -3],
    [20, -3],
  ],
  piers: [],
  masts: [
    [4, -6, 9],
    [16, -6, 9],
  ],
  blocks: { reach: 8 },
  materials: ['road', 'wood', 'steel', 'cable'],
  money: 100000,
  target: 0,
  vehicle: 'car',
  waterY: -6,
  bonus: { kind: 'stress', max: 0.5 },
};

/** The same with the masts a meter nearer the banks, so a single cable reaches a block from a mast top. */
const NEAR: LevelDef = {
  ...MASTED,
  masts: [
    [3, -6, 8],
    [17, -6, 8],
  ],
};
/** A cable from the near mast top down to a block 3 m behind the left bank: 10 m. */
const STAY_COST = 10 * 140 + BLOCK.price;

/** A road deck hung from a main cable between the mast tops, backstayed to blocks `back` m behind each bank. */
function hungDeck(level: LevelDef, back: number | null): Design {
  const d = new Design(level);
  roadRun(d, [0, 0], [20, 0]);
  const main: GridPt[] = [[4, 9], [6, 6], [8, 4], [10, 3], [12, 4], [14, 6], [16, 9]];
  suspend(d, main);
  for (const [x, y] of main.slice(1, -1)) d.add([x, y], [x, 0], 'cable');
  d.add([4, 9], [4, 0], 'cable').add([16, 9], [16, 0], 'cable');
  d.add([0, -3], [2, 0], 'steel').add([20, -3], [18, 0], 'steel');
  if (back === null) return d;
  for (const [top, end] of [
    [[4, 9], [-back, 0]],
    [[16, 9], [20 + back, 0]],
  ] as [GridPt, GridPt][]) {
    d.ensureBlock(end[0], end[1]);
    // Straight down to the block, split where a single cable would be too long.
    const n = Math.ceil(Math.hypot(end[0] - top[0], end[1] - top[1]) / 9.5);
    const pts: GridPt[] = Array.from({ length: n + 1 }, (_, k) => [top[0] + ((end[0] - top[0]) * k) / n, top[1] + ((end[1] - top[1]) * k) / n]);
    suspend(d, pts);
  }
  return d;
}

function drive(d: Design, level: LevelDef, seconds = 30): TestRun {
  const run = new TestRun(d, level);
  for (let i = 0; i < seconds * 60 && run.status === 'running'; i++) run.step();
  return run;
}

/** A lone block at the origin pulled by one stiff link toward (dx, dy), with the far end's force held at `force` newtons. */
function pulled(dx: number, dy: number, force: number): World {
  const w = new World(4, -20);
  w.addParticle(-4, 0, 0);
  const far = w.addParticle(-4 + dx, dy, 0);
  w.blocks.push({ p: 0, x0: -4, ground: 0, util: 0, peak: 0, loose: false });
  // A steel-like member whose strain is set so it pulls with `force`.
  const link = w.addLink(0, far, 1e-9, { bridge: true, mat: 'steel' });
  link.rest = Math.hypot(dx, dy) / (1 + force / 5e6);
  return w;
}

describe('concrete anchors: rules', () => {
  it('lists a spot every meter back from 1 m to the reach, on both banks', () => {
    const spots = blockSpots(MASTED);
    expect(spots).toHaveLength(16);
    expect(spots).toContainEqual([-1, 0]);
    expect(spots).toContainEqual([-8, 0]);
    expect(spots).toContainEqual([28, 0]);
    expect(blockSpot(MASTED, 0, 0)).toBe(false);
    expect(blockSpot(MASTED, -9, 0)).toBe(false);
    expect(blockSpot(MASTED, -2.5, 0)).toBe(false);
    expect(blockSpot(MASTED, -2, 1)).toBe(false);
    expect(blockSpot({ ...MASTED, blocks: undefined }, -2, 0)).toBe(false);
  });

  it('allows joints over a bank only high enough to clear the road', () => {
    expect(pointAllowed(MASTED, -2, BLOCK.clearance)).toBe(true);
    expect(pointAllowed(MASTED, -2, 2)).toBe(false);
    expect(pointAllowed(MASTED, -9, 5)).toBe(false);
    expect(pointAllowed({ ...MASTED, blocks: undefined }, -2, 5)).toBe(false);
  });

  it('keeps joints out of a mast footing', () => {
    expect(pointAllowed(MASTED, 4, -7)).toBe(false);
    expect(pointAllowed(MASTED, 4, -5)).toBe(true);
  });

  it('lets no cable pull on a bolt where concrete anchors are offered', () => {
    expect(cableBolt(MASTED, 0, 0)).toBe(true);
    expect(cableBolt(MASTED, 20, -3)).toBe(true);
    expect(cableBolt(MASTED, 4, 9)).toBe(false);
    expect(cableBolt({ ...MASTED, blocks: undefined }, 0, 0)).toBe(false);
    const d = hungDeck(MASTED, null).add([4, 9], [2, 6], 'cable').add([2, 6], [0, 0], 'cable');
    expect(designProblems(MASTED, d).some((p) => p.includes('holds no cables'))).toBe(true);
    // Struts still bear on them.
    expect(designProblems(MASTED, hungDeck(MASTED, 4))).toEqual([]);
  });

  it('flags a block that is not on an anchor spot', () => {
    const d = hungDeck(MASTED, 4);
    expect(designProblems(MASTED, d)).toEqual([]);
    expect(designProblems({ ...MASTED, blocks: { reach: 2 } }, d).some((p) => p.includes('concrete anchor'))).toBe(true);
  });
});

describe('concrete anchors: design and editor', () => {
  it('charges for each block in use and drops one nothing uses', () => {
    const d = new Design(MASTED);
    const base = d.cost();
    d.ensureBlock(-3, 0);
    expect(d.cost()).toBe(base);
    d.add([4, 9], [-3, 0], 'cable');
    const withBlock = d.cost();
    d.members.pop();
    d.pruneNodes();
    expect(d.blocks()).toEqual([]);
    expect(d.findNode(4, 9)).toBeGreaterThanOrEqual(0);
    expect(withBlock - base).toBe(Math.round(Math.hypot(7, 9) * 140) + BLOCK.price);
  });

  it('sets a block where a drag ends on the bank, and prices it into the drag', () => {
    const ed = new Editor(NEAR, noop);
    ed.setMaterial('cable');
    expect(ed.beginAt(3, 8, 0.1, 0.1)).toBe('node');
    ed.aim(-3, 0);
    expect([ed.drag!.tx, ed.drag!.ty]).toEqual([-3, 0]);
    expect(ed.drag!.reason).toBe('');
    expect(ed.drag!.cost).toBe(STAY_COST);
    ed.commit();
    const i = ed.design.findNode(-3, 0);
    expect(ed.design.nodes[i]).toMatchObject({ anchor: true, block: true, price: BLOCK.price });
  });

  it('starts a drag from an empty anchor spot', () => {
    const ed = new Editor(NEAR, noop);
    ed.setMaterial('cable');
    expect(ed.beginAt(-3, 0, 0.3, 0.1)).toBe('block');
    ed.aim(3, 8);
    expect(ed.drag!.cost).toBe(STAY_COST);
    ed.commit();
    expect(ed.design.blocks()).toHaveLength(1);
  });

  it('removes the block with the last member on it, and undo brings it back', () => {
    const ed = new Editor(NEAR, noop);
    ed.setMaterial('cable');
    ed.beginAt(3, 8, 0.1, 0.1);
    ed.aim(-3, 0);
    ed.commit();
    const spent = ed.spent();
    expect(spent).toBe(STAY_COST);
    ed.removeMember(ed.design.members.length - 1);
    expect(ed.design.blocks()).toEqual([]);
    expect(ed.spent()).toBe(0);
    ed.undo();
    expect(ed.design.blocks()).toHaveLength(1);
    expect(ed.spent()).toBe(spent);
  });

  it('refuses a member lying along the ground, and joints low over the bank', () => {
    const ed = new Editor(MASTED, noop);
    ed.setMaterial('wood');
    ed.beginAt(0, 0, 0.1, 0.1);
    ed.aim(-2, 0);
    expect(ed.drag!.reason).toBe('Lies on the ground');
    ed.cancel();
    ed.setMaterial('cable');
    ed.beginAt(4, 9, 0.1, 0.1);
    ed.aim(-2, 2);
    expect(ed.drag!.reason).toBe('Out of bounds');
    ed.aim(-2, 4);
    expect(ed.drag!.reason).toBe('');
  });

  it('refuses a cable onto a bolt, but not a beam', () => {
    const ed = new Editor(MASTED, noop);
    ed.setMaterial('cable');
    ed.beginAt(0, 0, 0.1, 0.1);
    ed.aim(2, 6);
    expect(ed.drag!.reason).toBe('Anchor cables in concrete');
    ed.cancel();
    ed.setMaterial('wood');
    ed.beginAt(0, 0, 0.1, 0.1);
    ed.aim(2, 2);
    expect(ed.drag!.reason).toBe('');
  });

  it('drops a saved design that hangs a cable on a bolt', () => {
    const saved = hungDeck(MASTED, null).add([4, 9], [2, 6], 'cable').add([2, 6], [0, 0], 'cable').serialize();
    expect(new Editor(MASTED, noop, saved).design.members).toEqual([]);
    expect(new Editor({ ...MASTED, blocks: undefined }, noop, saved).design.members.length).toBeGreaterThan(0);
  });

  it('keeps a saved design with blocks, and drops it once the level no longer offers them', () => {
    const saved = hungDeck(MASTED, 4).serialize();
    expect(new Editor(MASTED, noop, saved).design.blocks()).toHaveLength(2);
    expect(new Editor({ ...MASTED, blocks: { reach: 2 } }, noop, saved).design.members).toEqual([]);
  });
});

describe('concrete anchors: physics', () => {
  it('holds a pull it can take, and tears loose past its weight', () => {
    const weight = BLOCK.mass * 9.81;
    const hold = pulled(0, 5, weight * 0.6);
    hold.step();
    expect(hold.blocks[0].loose).toBe(false);
    const lift = pulled(0, 5, weight * 1.4);
    for (let i = 0; i < 10; i++) lift.step();
    expect(lift.blocks[0].loose).toBe(true);
    expect(lift.loosened).toEqual([0]);
  });

  it('slides when pulled flat harder than friction and the soil can hold', () => {
    const cap = BLOCK.friction * BLOCK.mass * 9.81 + BLOCK.bearing;
    const ok = pulled(5, 0, cap * 0.8);
    for (let i = 0; i < 10; i++) ok.step();
    expect(ok.blocks[0].loose).toBe(false);
    const slide = pulled(5, 0, cap * 1.3);
    for (let i = 0; i < 10; i++) slide.step();
    expect(slide.blocks[0].loose).toBe(true);
  });

  it('a loose block drags over the bank rather than falling through it', () => {
    const w = pulled(5, 0, 2e5);
    for (let i = 0; i < 60; i++) w.step();
    expect(w.blocks[0].loose).toBe(true);
    expect(w.y[0]).toBeGreaterThanOrEqual(-1e-6);
    expect(w.x[0]).toBeGreaterThan(-4);
  });

  it('masts tip over without backstays and stand with them', () => {
    const bare = drive(hungDeck(MASTED, null), MASTED);
    expect(bare.status).toBe('fail');
    const run = drive(hungDeck(MASTED, 4), MASTED);
    expect(run.status).toBe('success');
    const top = run.world.masts[0].top;
    expect(Math.abs(run.world.x[top] - 4)).toBeLessThan(0.3);
    expect(run.world.blocks.every((b) => !b.loose)).toBe(true);
  });

  it('says so when a concrete anchor tore loose', () => {
    // A bus is far too much for one block per side.
    const level: LevelDef = { ...MASTED, vehicle: 'bus' };
    const run = drive(hungDeck(level, 4), level);
    expect(run.world.blocks.some((b) => b.loose)).toBe(true);
    expect(run.peakStress).toBe(1);
  });
});

describe('masts in the level editor', () => {
  it('raises a mast from the water and removes it again', () => {
    const l = structuredClone(MASTED);
    delete l.masts;
    expect(toggleMast(l, 6, 8).ok).toBe(true);
    expect(l.masts).toEqual([[6, -6, 8]]);
    expect(toggleMast(l, 7, 8).ok).toBe(false);
    expect(toggleMast(l, 6, 8).ok).toBe(true);
    expect(l.masts).toBeUndefined();
  });

  it('keeps masts and anchors through export, import and a resize', () => {
    const back = parseLevel(exportLevel(MASTED), MASTED.id);
    expect(back.masts).toEqual(MASTED.masts);
    expect(back.blocks).toEqual({ reach: 8 });
    const l = structuredClone(MASTED);
    setSize(l, 12, 0, -4);
    expect(l.masts).toEqual([[4, -4, 9]]);
  });
});
