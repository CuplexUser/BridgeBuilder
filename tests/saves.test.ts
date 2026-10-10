import { describe, expect, it } from 'vitest';
import { Design, SAVE_VERSION } from '../src/design';
import { Editor, fitDesign } from '../src/editor';
import type { LevelDef } from '../src/levels';
import { designProblems } from '../src/rules';

const noop = { place() {}, remove() {}, invalid() {} };

const LEVEL: LevelDef = {
  id: 901,
  name: 'Saves',
  tip: '',
  width: 8,
  anchors: [
    [0, 0],
    [8, 0],
    [0, -2],
    [8, -2],
  ],
  piers: [],
  materials: ['road', 'wood', 'steel'],
  vehicle: 'car',
  waterY: -4,
  money: 20000,
  target: 10000,
  bonus: { kind: 'cost', max: 5000 },
};

/** A road over two wood trusses, with a steel strut split at the deck's middle. */
function truss(level = LEVEL): Design {
  const d = new Design(level);
  for (let x = 0; x < 8; x += 2) d.add([x, 0], [x + 2, 0], 'road');
  d.add([0, -2], [2, 0], 'wood').add([8, -2], [6, 0], 'wood');
  d.add([2, 0], [4, 2], 'wood').add([4, 2], [6, 0], 'wood');
  d.add([4, 0], [4, 2], 'steel');
  return d;
}

describe('saved design format', () => {
  it('writes its version, and reads designs saved before there was one', () => {
    const d = truss();
    expect(JSON.parse(d.serialize()).v).toBe(SAVE_VERSION);
    const old = JSON.stringify({ n: d.nodes, m: d.members });
    const back = Design.deserialize(old);
    expect(back.nodes).toEqual(d.nodes);
    expect(back.members).toEqual(d.members);
  });

  it('refuses what is not a design, and a save from a newer version', () => {
    expect(() => Design.deserialize('{"x":1}')).toThrow('Not a design');
    expect(() => Design.deserialize('{"n":[{"x":0,"y":0}],"m":[{"a":0,"b":5,"mat":"road"}]}')).toThrow('Bad member');
    expect(() => Design.deserialize(JSON.stringify({ v: SAVE_VERSION + 1, n: [], m: [] }))).toThrow('newer version');
  });

  it('leaves out members of a material the game no longer has', () => {
    const d = Design.deserialize('{"n":[{"x":0,"y":0,"anchor":true},{"x":2,"y":0}],"m":[{"a":0,"b":1,"mat":"road"},{"a":0,"b":1,"mat":"glass"}]}');
    expect(d.members).toEqual([{ a: 0, b: 1, mat: 'road' }]);
  });
});

describe('fitting a saved design to a changed level', () => {
  it('loads an unchanged design as it was', () => {
    const ed = new Editor(LEVEL, noop, truss().serialize());
    expect(ed.fitted).toBeNull();
    expect(ed.design.members).toHaveLength(truss().members.length);
  });

  it('takes off a material the level no longer offers, keeping the rest', () => {
    const level = { ...LEVEL, materials: ['road', 'wood'] } as LevelDef;
    const ed = new Editor(level, noop, truss().serialize());
    expect(ed.fitted).toEqual({ removed: 1, over: 0 });
    expect(ed.design.members.every((m) => m.mat !== 'steel')).toBe(true);
    expect(designProblems(level, ed.design)).toEqual([]);
  });

  it('takes a split beam off whole', () => {
    const d = truss();
    const strut = d.members.findIndex((m) => m.mat === 'steel');
    d.splitMember(strut, 4, 1);
    d.add([4, 1], [2, 0], 'wood');
    const { design, removed } = fitDesign({ ...LEVEL, materials: ['road', 'wood'] }, d);
    expect(removed).toBe(1);
    expect(design.members.some((m) => m.mat === 'steel')).toBe(false);
    // The brace to the strut's joint stays, hanging free.
    expect(design.findNode(4, 1)).toBeGreaterThanOrEqual(0);
  });

  it('keeps the earliest parts of a material over its new limit', () => {
    const level = { ...LEVEL, limits: { wood: 2 } };
    const { design, removed } = fitDesign(level, truss());
    expect(removed).toBe(2);
    expect(design.count('wood')).toBe(2);
    expect(design.findMember(design.findNode(0, -2), design.findNode(2, 0))).toBeGreaterThanOrEqual(0);
  });

  it('rebuilds on the bolts the level has now, without parts on bolts that are gone', () => {
    const level: LevelDef = { ...LEVEL, anchors: [[0, 0], [8, 0], [0, -2], [8, -1]] };
    const { design, removed } = fitDesign(level, truss());
    expect(removed).toBe(1);
    expect(design.findNode(8, -1)).toBeGreaterThanOrEqual(0);
    expect(design.findNode(8, -2)).toBe(-1);
    expect(designProblems(level, design)).toEqual([]);
  });

  it('takes off joints now out of bounds', () => {
    const level: LevelDef = { ...LEVEL, channels: [[3, 5, 3]] };
    const { design } = fitDesign(level, truss());
    expect(designProblems(level, design)).toEqual([]);
    expect(design.findNode(4, 2)).toBe(-1);
  });

  it('loads a design over a lowered budget, for trimming', () => {
    const level = { ...LEVEL, money: 2000 };
    const ed = new Editor(level, noop, truss().serialize());
    expect(ed.design.members).toHaveLength(truss().members.length);
    expect(ed.fitted?.over).toBe(truss().cost() - 2000);
    expect(ed.left()).toBeLessThan(0);
  });
});
