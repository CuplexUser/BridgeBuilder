import { describe, expect, it } from 'vitest';
import { Design, type GridPt } from '../src/design';
import { Editor, fitDesign } from '../src/editor';
import type { LevelDef } from '../src/levels';
import { addBlock, blockPoly, cellProblem, flatProblem, layRing, RING, ringPath, ringPolys, ringRise, rings, riseOf } from '../src/masonry';
import { buildWorld } from '../src/physics/build';
import { TestRun } from '../src/physics/testrun';
import { designProblems } from '../src/rules';
import { blockArch, roadRun } from '../src/solutions';

const noop = { place() {}, remove() {}, invalid() {} };

/** A 20 m gorge with a rock shelf at the foot of each wall, 5 m down. */
const SHELVES: LevelDef = {
  id: 970,
  name: 'Shelves',
  tip: '',
  width: 20,
  anchors: [
    [0, 0],
    [20, 0],
  ],
  rocks: [
    [0, 2, -5],
    [18, 20, -5],
  ],
  piers: [],
  materials: ['road', 'steel', 'masonry', 'arch'],
  vehicle: 'truck',
  waterY: -10,
  money: 1e6,
  target: 1e6,
  bonus: { kind: 'cost', max: 0 },
};

/** The same gorge with its shelves a meter deeper: room under the deck for an arch to rise a fifth of its span. */
const DEEP: LevelDef = { ...SHELVES, id: 971, name: 'Deep shelves', rocks: [
    [0, 2, -6],
    [18, 20, -6],
  ] };

/** The deck, abutment blocks `abut` high against each wall, an arch from shelf to shelf rising `rise`, and steel posts. */
function shelfArch(abut: number, rise = 3.6): Design {
  const d = new Design(DEEP);
  roadRun(d, [0, 0], [20, 0]);
  for (let k = 0; k < abut; k++) for (const x of [0, 19]) addBlock(d, x, -6 + k);
  blockArch(d, DEEP, [1, -6], [19, -6], 'steel', rise);
  return d;
}

function drive(d: Design, level = SHELVES): TestRun {
  const run = new TestRun(d, level);
  for (let i = 0; i < 60 * 40 && run.status === 'running'; i++) run.step();
  return run;
}

/** A bare ring on one block against each wall, with `tonnes` hung from its top a quarter of the way across, after five seconds. */
function pointLoad(tonnes: number) {
  const d = new Design(DEEP);
  for (const x of [0, 19]) addBlock(d, x, -6);
  blockArch(d, DEEP, [1, -5], [19, -5], 'steel', 3.6);
  const at = rings(d)[0].extra[2];
  const { world } = buildWorld(d, DEEP);
  world.im[at] = 1 / (1 / world.im[at] + tonnes * 1000);
  for (let i = 1; i <= 300; i++) {
    world.gravityScale = Math.min(1, i / 60);
    world.step();
  }
  return { world, drop: d.nodes[at].y - world.y[at] };
}

describe('arch rings', () => {
  it('rise in wedge blocks a ring thick, narrowing to each springing', () => {
    const d = new Design(SHELVES);
    const path = ringPath(d, [1, -5], [19, -5], 4)!;
    expect(path.intra[0]).toEqual([1, -5]);
    expect(path.intra.at(-1)).toEqual([19, -5]);
    path.extra.forEach(([x, y], i) => expect([x, y]).toEqual([path.intra[i + 1][0], path.intra[i + 1][1] + RING]));
    const polys = ringPolys(path);
    expect(polys).toHaveLength(path.intra.length - 1);
    expect(polys[0]).toHaveLength(3);
    expect(polys.at(-1)).toHaveLength(3);
    // The crown rises 4 m over the chord.
    const crown = path.intra.find(([x]) => x === 10)!;
    expect(crown[1]).toBeCloseTo(-1, 3);
  });

  it('keeps its natural crown half a meter under a deck already built', () => {
    const d = new Design(SHELVES);
    expect(ringRise(d, [1, -5], [19, -5])).toBe(4.5);
    roadRun(d, [0, 0], [20, 0]);
    expect(ringRise(d, [1, -5], [19, -5])).toBe(3.5);
  });

  it('is one part, laid in one drag, priced by its area, and comes off whole', () => {
    const ed = new Editor(SHELVES, noop);
    ed.setMaterial('arch');
    expect(ed.beginAt(1, -5, 0.1, 0.1)).toBe('block');
    ed.aim(19, -5);
    expect(ed.drag!.reason).toBe('');
    const cost = ed.drag!.cost;
    ed.commit();
    expect(rings(ed.design)).toHaveLength(1);
    expect(ed.design.parts()).toBe(1);
    expect(ed.spent()).toBe(cost);
    ed.removeCell(ed.design.cells.length - 1);
    expect(ed.design.cells).toEqual([]);
    expect(ed.spent()).toBe(0);
    ed.undo();
    expect(rings(ed.design)).toHaveLength(1);
  });

  it('takes a new rise from its crown handle, its top following its underside', () => {
    const ed = new Editor(DEEP, noop);
    ed.design = shelfArch(0, 4.5);
    const h = ed.sagHandles().find((x) => x.mat === 'arch')!;
    ed.beginSag(h);
    ed.aimSag(h.y - 0.5);
    ed.commit();
    const r = rings(ed.design)[0];
    r.extra.forEach((e, i) => expect(ed.design.nodes[e].y).toBeCloseTo(ed.design.nodes[r.intra[i + 1]].y + RING, 6));
    const crown = ed.design.nodes[r.intra.find((i) => ed.design.nodes[i].x === 10)!];
    expect(crown.y).toBeLessThan(-1.8);
  });

  it('must rise at least a fifth of its span', () => {
    const d = new Design(SHELVES);
    expect(flatProblem(ringPath(d, [1, -5], [19, -5], 3.6)!.intra)).toBe('');
    expect(flatProblem(ringPath(d, [1, -5], [19, -5], 3.5)!.intra)).toBe('Too flat: rise 3.6 m at least');
    // A leaning ring rises from the chord between its springings.
    expect(riseOf(ringPath(d, [1, -5], [19, -2], 4)!.intra)).toBeCloseTo(4, 1);
    // Laid straight from the path helpers, a flat ring is still caught.
    layRing(d, ringPath(d, [1, -5], [19, -5], 3)!);
    expect(designProblems(SHELVES, d)).toEqual(['arch ring 1,-5-19,-5: too flat: rise 3.6 m at least']);
  });

  it('is refused where the deck leaves no room to rise a fifth of the span, or dragged flatter', () => {
    const ed = new Editor(SHELVES, noop);
    roadRun(ed.design, [0, 0], [20, 0]);
    ed.setMaterial('arch');
    ed.beginAt(1, -5, 0.1, 0.1);
    ed.aim(19, -5);
    expect(ed.drag!.reason).toBe('Too flat: rise 3.6 m at least');
    ed.design = shelfArch(0, 4.5);
    const h = ed.sagHandles().find((x) => x.mat === 'arch')!;
    ed.beginSag(h);
    ed.aimSag(h.y - 1.5);
    ed.commit();
    const r = rings(ed.design)[0];
    expect(ed.design.nodes[r.intra.find((i) => ed.design.nodes[i].x === 10)!].y).toBeCloseTo(-1.5, 6);
  });

  it('keeps under each joint of a sloping deck at its own height', () => {
    const d = new Design({ ...DEEP, rightY: 3, anchors: [
        [0, 0],
        [20, 3],
      ] });
    roadRun(d, [0, 0], [20, 3]);
    // The ring's top stays half a meter under the deck where they come closest, just short of
    // mid-span. The lowest deck joint over the ring's middle, 0.9 m up, sits over its lower haunch.
    expect(ringRise(d, [1, -4], [19, -4])).toBe(3.9);
  });
});

describe('concrete blocks', () => {
  it('paint a square at a time, and erase from a block', () => {
    const ed = new Editor(SHELVES, noop);
    ed.setMaterial('masonry');
    expect(ed.beginPaint(0.5, -4.5)).toBe(true);
    ed.paintAt(0.5, -3.5);
    ed.paintAt(1.5, -3.5);
    ed.endPaint();
    expect(ed.design.cells).toHaveLength(3);
    expect(ed.design.parts()).toBe(3);
    expect(ed.spent()).toBe(3 * 120);
    ed.beginPaint(0.5, -3.5);
    ed.endPaint();
    expect(ed.design.cells).toHaveLength(2);
    // One stroke is one undo.
    ed.undo();
    expect(ed.design.cells).toHaveLength(3);
  });

  it('stay out of rock, water, each other and the members', () => {
    const d = new Design(SHELVES);
    expect(cellProblem(SHELVES, d, blockPoly(0, -6))).toBe('Into the rock');
    expect(cellProblem(SHELVES, d, blockPoly(5, -10))).toBe('Out of bounds');
    expect(cellProblem(SHELVES, d, blockPoly(0, -5))).toBe('');
    addBlock(d, 0, -5);
    expect(cellProblem(SHELVES, d, blockPoly(0, -5))).toBe('Overlaps a block');
    d.add([3, -3], [6, -1], 'steel');
    expect(cellProblem(SHELVES, d, blockPoly(4, -3))).toBe('A beam runs through it');
  });

  it('turn away a member through them, but take one from a corner', () => {
    const ed = new Editor(SHELVES, noop);
    addBlock(ed.design, 4, -3);
    ed.setMaterial('steel');
    ed.beginAt(4, -3, 0.1, 0.1);
    ed.aim(5, -2);
    expect(ed.drag!.reason).toBe('Runs through a block');
    ed.aim(4, -1);
    expect(ed.drag!.reason).toBe('');
  });

  it('save and load with the design, and come off a level that no longer offers them', () => {
    const d = shelfArch(1);
    const back = Design.deserialize(d.serialize());
    expect(back.cells).toEqual(d.cells);
    expect(back.cost()).toBe(d.cost());
    expect(designProblems(DEEP, back)).toEqual([]);
    const fit = fitDesign({ ...DEEP, materials: ['road', 'steel', 'arch'] }, back);
    expect(fit.design.cells.every((c) => c.mat === 'arch')).toBe(true);
    expect(fit.removed).toBe(2);
  });
});

describe('block physics', () => {
  it('a flat arch springing on a bare shelf slides off it; one block against the wall holds it', () => {
    const bare = shelfArch(0);
    const spring = bare.findNode(1, -6);
    const run = drive(bare, DEEP);
    expect(run.status).toBe('fail');
    expect(Math.abs(run.world.x[spring] - 1)).toBeGreaterThan(0.3);
    const held = drive(shelfArch(1), DEEP);
    expect(held.status).toBe('success');
    expect(held.peakStress).toBeLessThan(0.5);
  });

  it('a higher arch pushes out less, and stands even on the bare shelf', () => {
    const d = shelfArch(0, 4.5);
    const spring = d.findNode(1, -6);
    const run = drive(d, DEEP);
    expect(run.status).toBe('success');
    expect(Math.abs(run.world.x[spring] - 1)).toBeLessThan(0.2);
  });

  it('blocks pull apart where they are pulled hard enough', () => {
    // A beam of blocks hung from one bolt cracks at its root.
    const level: LevelDef = { ...SHELVES, anchors: [...SHELVES.anchors, [6, -2]] };
    const d = new Design(level);
    for (let x = 6; x < 12; x++) addBlock(d, x, -3);
    const run = drive(d, level);
    expect(run.world.links.some((l) => l.cell >= 0 && l.broken)).toBe(true);
  });

  it('a block on a bank top stays put under its own weight', () => {
    const d = new Design(SHELVES);
    addBlock(d, -3, 0);
    const corner = d.findNode(-3, 0);
    const run = new TestRun(d, SHELVES);
    for (let i = 0; i < 120; i++) run.step();
    expect(Math.abs(run.world.y[corner])).toBeLessThan(0.01);
    expect(Math.abs(run.world.x[corner] + 3)).toBeLessThan(0.01);
  });

  it('keeps its corners square', () => {
    const d = new Design(SHELVES);
    const pts: GridPt[] = [
      [0, -5],
      [1, -5],
      [1, -4],
      [0, -4],
    ];
    addBlock(d, 0, -5);
    addBlock(d, 0, -4);
    const run = new TestRun(d, SHELVES);
    for (let i = 0; i < 120; i++) run.step();
    const [a, b, c] = pts.map(([x, y]) => d.findNode(x, y));
    const w = run.world;
    const dot = (w.x[b] - w.x[a]) * (w.x[c] - w.x[b]) + (w.y[b] - w.y[a]) * (w.y[c] - w.y[b]);
    expect(Math.abs(dot)).toBeLessThan(1e-3);
  });
});

describe('arch ring joints', () => {
  it('give each block its own corners, joined by one mortared face per joint', () => {
    const d = shelfArch(1);
    const { world } = buildWorld(d, DEEP);
    const cells = d.cells.filter((c) => c.mat === 'arch').length;
    expect(world.faces).toHaveLength(cells - 1);
    for (const f of world.faces) {
      expect(new Set([f.a1, f.a2, f.b1, f.b2]).size).toBe(4);
      expect(world.x[f.a1]).toBeCloseTo(world.x[f.b1], 9);
    }
  });

  it('hold shut, so the ring carries a load as one piece, while the mortar holds', () => {
    const { world, drop } = pointLoad(10);
    expect(world.faces.some((f) => f.crack1 || f.crack2)).toBe(false);
    expect(drop).toBeLessThan(0.2);
  });

  it('crack under more than the mortar holds, and the ring folds on its hinges', () => {
    const { world, drop } = pointLoad(20);
    expect(world.faces.filter((f) => f.crack1 || f.crack2).length).toBeGreaterThanOrEqual(3);
    expect(drop).toBeGreaterThan(1);
  });
});

describe('a ring laid straight from the path helpers', () => {
  it('matches what the editor lays', () => {
    const d = new Design(SHELVES);
    layRing(d, ringPath(d, [1, -5], [19, -5], 3)!);
    const ed = new Editor(SHELVES, noop);
    ed.design = d;
    expect(ed.sagHandles()).toHaveLength(1);
  });
});
