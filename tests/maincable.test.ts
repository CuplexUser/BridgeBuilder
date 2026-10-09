import { describe, expect, it } from 'vitest';
import { Design, type GridPt } from '../src/design';
import { Editor } from '../src/editor';
import type { LevelDef } from '../src/levels';
import { curveY, deckStations, defaultSag, layMain, mainPath, mainRuns, runSag } from '../src/maincable';
import { MATERIALS } from '../src/physics/materials';
import { TestRun } from '../src/physics/world';
import { designProblems } from '../src/rules';
import { roadRun } from '../src/solutions';

const noop = { place() {}, remove() {}, invalid() {} };

/** A 40 m gap with a pier pair near each bank and concrete anchors up to 8 m back. */
const LONG: LevelDef = {
  id: 901,
  name: 'Long',
  tip: '',
  width: 40,
  anchors: [
    [0, 0],
    [40, 0],
    [6, 0],
    [8, 0],
    [32, 0],
    [34, 0],
  ],
  piers: [
    [6, 0],
    [8, 0],
    [32, 0],
    [34, 0],
  ],
  blocks: { reach: 8, tonnes: 20 },
  ceiling: 14,
  materials: ['road', 'heavy', 'steel', 'cable', 'main'],
  money: 1e6,
  target: 0,
  vehicle: 'bus',
  waterY: -6,
  bonus: { kind: 'stress', max: 0.5 },
};

/** A braced steel tower on the piers at a and a + 2, its top at (a + 1, top). */
function tower(d: Design, a: number, top: number): void {
  const b = a + 2;
  const m = a + 1;
  let y = 0;
  for (; y + 3 <= top - 2; y += 3) {
    d.add([a, y], [a, y + 3], 'steel').add([b, y], [b, y + 3], 'steel').add([a, y + 3], [b, y + 3], 'steel').add([a, y], [b, y + 3], 'steel');
  }
  d.add([a, y], [m, top], 'steel').add([b, y], [m, top], 'steel');
}

/** The long gap with hinged masts near the banks, and low bolts for struts under the deck's ends. */
const MASTED: LevelDef = {
  ...LONG,
  anchors: [
    [0, 0],
    [40, 0],
    [0, -3],
    [40, -3],
  ],
  piers: [],
  masts: [
    [7, -6, 11],
    [33, -6, 11],
  ],
};

/** A suspension bridge on the masts: a main cable between them and down to a block behind each bank, a hanger to every deck joint. */
function suspension(mat: 'main' | 'cable'): Design {
  const d = new Design(MASTED);
  roadRun(d, [0, 0], [40, 0], 'heavy');
  d.add([0, -3], [2, 0], 'steel').add([40, -3], [38, 0], 'steel');
  const spans: [GridPt, GridPt][] = [
    [[7, 11], [33, 11]],
    [[-6, 0], [7, 11]],
    [[33, 11], [46, 0]],
  ];
  d.ensureBlock(-6, 0);
  d.ensureBlock(46, 0);
  for (const [a, b] of spans) {
    const deck = deckStations(d);
    const pts = mat === 'main' ? layMain(d, a, b) : mainPath(a, b, defaultSag(a, b), deck)!;
    if (mat === 'cable') for (let i = 0; i < pts.length - 1; i++) d.add(pts[i], pts[i + 1], 'cable');
    for (const [x, y] of pts.slice(1, -1)) if (deck.includes(x) && x > 0 && x < 40 && y > 1 && y <= 10) d.add([x, y], [x, 0], 'cable');
  }
  return d;
}

describe('main cable: laying', () => {
  it('hangs a joint on every even meter, on the parabola, and every piece fits', () => {
    const pts = mainPath([7, 12], [33, 12], 2.6)!;
    expect(pts[0]).toEqual([7, 12]);
    expect(pts.at(-1)).toEqual([33, 12]);
    expect(pts.slice(1, -1).map(([x]) => x)).toEqual([8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32]);
    expect(pts.find(([x]) => x === 20)![1]).toBeCloseTo(9.4, 6);
    for (const [x, y] of pts) expect(y).toBeCloseTo(curveY([7, 12], [33, 12], 2.6, x), 3);
    for (let i = 1; i < pts.length; i++) expect(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])).toBeLessThanOrEqual(MATERIALS.main.maxLen);
  });

  it('adds joints where a steep backstay would make a piece too long, and refuses a run with no span', () => {
    const pts = mainPath([-6, 0], [7, 12], defaultSag([-6, 0], [7, 12]))!;
    for (let i = 1; i < pts.length; i++) expect(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])).toBeLessThanOrEqual(MATERIALS.main.maxLen);
    expect(mainPath([4, 0], [5, 8], 1)).toBeNull();
  });

  it('sags a tenth of a level span, and only a little on a steep one', () => {
    expect(defaultSag([7, 12], [33, 12])).toBe(2.6);
    expect(defaultSag([-6, 0], [7, 12])).toBeLessThan(1);
  });

  it('lays a run in one drag as one part, priced by its length', () => {
    const ed = new Editor(LONG, noop);
    const d = ed.design;
    tower(d, 6, 12);
    tower(d, 32, 12);
    ed.setMaterial('main');
    expect(ed.beginAt(7, 12, 0.1, 0.1)).toBe('node');
    ed.aim(33, 12);
    expect(ed.drag!.reason).toBe('');
    const pts = ed.drag!.path;
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    expect(ed.drag!.cost).toBe(Math.round(len * MATERIALS.main.price));
    const parts = d.parts();
    ed.commit();
    expect(d.parts()).toBe(parts + 1);
    expect(mainRuns(d)).toHaveLength(1);
    expect(runSag(d, mainRuns(d)[0].chain)).toBeCloseTo(2.6, 3);
  });

  it('takes the whole run off with one piece, and undo puts it back', () => {
    const ed = new Editor(LONG, noop);
    tower(ed.design, 6, 12);
    tower(ed.design, 32, 12);
    ed.setMaterial('main');
    ed.beginAt(7, 12, 0.1, 0.1);
    ed.aim(33, 12);
    ed.commit();
    const n = ed.design.members.length;
    ed.removeMember(n - 3);
    expect(mainRuns(ed.design)).toHaveLength(0);
    ed.undo();
    expect(mainRuns(ed.design)).toHaveLength(1);
    expect(ed.design.members).toHaveLength(n);
  });
});

/** The long level with two towers, a heavy deck, a main cable at its natural sag and three hangers. */
function built(): Editor {
  const ed = new Editor(LONG, noop);
  tower(ed.design, 6, 11);
  tower(ed.design, 32, 11);
  roadRun(ed.design, [0, 0], [40, 0], 'heavy');
  layMain(ed.design, [7, 11], [33, 11]);
  for (const x of [12, 20, 28]) ed.design.add([x, curveY([7, 11], [33, 11], 2.6, x)], [x, 0], 'cable');
  ed.ages = ed.design.members.map(() => 10);
  return ed;
}

describe('main cable: sag handle', () => {
  it('sits between joints near mid-span and drags the curve deeper, hangers and all', () => {
    const ed = built();
    const [h] = ed.sagHandles();
    expect(h.x).toBe(21);
    expect(ed.design.findNode(h.x, h.y)).toBe(-1);
    expect(ed.beginAt(h.x, h.y, 0.3, 0.3)).toBe('sag');
    ed.aimSag(h.y - 2);
    expect(ed.sag!.reason).toBe('');
    ed.commit();
    const chain = mainRuns(ed.design)[0].chain;
    expect(runSag(ed.design, chain)).toBeCloseTo(4.6, 1);
    // The hanger at x = 20 still runs from the cable to the deck.
    const mid = ed.design.nodes.findIndex((n) => n.x === 20 && n.y > 1);
    expect(chain).toContain(mid);
    expect(ed.design.members.some((m) => m.mat === 'cable' && (m.a === mid || m.b === mid))).toBe(true);
    // A ghost hanger drawn at the old sag still counts as built.
    expect(ed.design.covers([20, curveY([7, 11], [33, 11], 2.6, 20)], [20, 0], 'cable')).toBe(true);
    expect(ed.design.covers([16, curveY([7, 11], [33, 11], 2.6, 16)], [16, 0], 'cable')).toBe(false);
    expect(designProblems(LONG, ed.design)).toEqual([]);
    ed.undo();
    expect(runSag(ed.design, mainRuns(ed.design)[0].chain)).toBeCloseTo(2.6, 3);
  });

  it('puts the cable back when let go too deep for its hangers', () => {
    const ed = built();
    const [h] = ed.sagHandles();
    const before = ed.design.serialize();
    ed.beginAt(h.x, h.y, 0.3, 0.3);
    ed.aimSag(0.5);
    expect(ed.sag!.valid).toBe(false);
    ed.commit();
    expect(ed.design.serialize()).toBe(before);
    // Too shallow to keep a hanger within reach is fine, but not lower than the deck.
    ed.beginAt(h.x, h.y, 0.3, 0.3);
    ed.aimSag(-3);
    expect(ed.sag!.valid).toBe(false);
    ed.cancel();
    expect(ed.design.serialize()).toBe(before);
  });

  it('keeps a run curved when a hanger that split one of its pieces comes off', () => {
    const ed = built();
    const n = ed.design.members.length;
    ed.setMaterial('cable');
    // Halfway along the piece between the joints at x = 16 and 18.
    const [p, r] = [16, 18].map((x) => ed.design.nodes.find((node) => node.x === x && node.y > 1)!);
    expect(ed.beginAt((p.x + r.x) / 2, (p.y + r.y) / 2, 0.01, 0.4)).toBe('split');
    ed.aim(16, 0);
    ed.commit();
    expect(ed.design.members.length).toBe(n + 2);
    ed.removeMember(ed.design.members.length - 1);
    expect(ed.design.members.length).toBe(n);
    expect(mainRuns(ed.design)[0].chain).toHaveLength(15);
  });
});

/** Drives a design over the masted level until it ends. */
function drive(d: Design): TestRun {
  const run = new TestRun(d, MASTED);
  for (let i = 0; i < 40 * 60 && run.status === 'running'; i++) run.step();
  return run;
}

describe('main cable: physics', () => {
  it('a main cable carries a bus that the same curve in plain cable cannot', () => {
    const main = suspension('main');
    expect(designProblems(MASTED, main)).toEqual([]);
    expect(drive(main).status).toBe('success');
    // Plain cable may not hang low over the bank, so this one isn't buildable anyway; it fails regardless.
    expect(drive(suspension('cable')).status).toBe('fail');
  });
});
