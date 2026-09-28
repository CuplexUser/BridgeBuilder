import { describe, expect, it } from 'vitest';
import { Design, roadPath, segmentsOverlap } from '../src/design';
import { Editor } from '../src/editor';
import { LEVELS } from '../src/levels';

const noop = { place() {}, remove() {}, invalid() {} };

function editorFor(levelIdx: number): Editor {
  return new Editor(LEVELS[levelIdx], noop);
}

describe('roadPath', () => {
  it('splits a flat span into 2 m pieces', () => {
    expect(roadPath(0, 0, 6, 0, 2.25, 10)).toEqual([[0, 0], [2, 0], [4, 0], [6, 0]]);
  });

  it('keeps a flat run on the grid even when pieces differ in length', () => {
    const p = roadPath(0, 0, 5, 0, 2.25, 10)!;
    expect(p.length).toBe(4);
    for (const [x, y] of p) {
      expect(Number.isInteger(x)).toBe(true);
      expect(y).toBe(0);
    }
  });

  it('lays a slope as one even grade, with no steps', () => {
    const p = roadPath(0, 0, 10, 2, 2.25, 10)!;
    expect(p).toEqual([[0, 0], [2, 0.4], [4, 0.8], [6, 1.2], [8, 1.6], [10, 2]]);
    for (let i = 1; i < p.length; i++) {
      expect((p[i][1] - p[i - 1][1]) / (p[i][0] - p[i - 1][0])).toBeCloseTo(0.2, 9);
    }
  });

  it('keeps every joint on the line for awkward slopes', () => {
    const p = roadPath(0, 0, 12, -1, 2.25, 10)!;
    for (let i = 1; i < p.length; i++) {
      expect(Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])).toBeLessThanOrEqual(2.25);
      expect(p[i][1]).toBeCloseTo(-p[i][0] / 12, 3);
    }
  });

  it('gives up when the budget is too small', () => {
    expect(roadPath(0, 0, 8, 0, 2.25, 3)).toBeNull();
  });
});

describe('segmentsOverlap', () => {
  it('detects collinear overlap but not touching or crossing', () => {
    expect(segmentsOverlap(0, 0, 3, 0, 0, 0, 2, 0)).toBe(true);
    expect(segmentsOverlap(0, 0, 2, 0, 2, 0, 4, 0)).toBe(false);
    expect(segmentsOverlap(0, 0, 2, 2, 0, 2, 2, 0)).toBe(false);
  });
});

describe('Editor', () => {
  it('lays a whole road deck in one drag', () => {
    const ed = editorFor(0);
    ed.begin(ed.design.findNode(0, 0));
    ed.aim(4, 0);
    expect(ed.drag!.path.length).toBe(3);
    ed.commit();
    expect(ed.design.count('road')).toBe(2);
    expect(ed.design.findNode(2, 0)).toBeGreaterThanOrEqual(0);
  });

  it('undoes a road run as a single step', () => {
    const ed = editorFor(0);
    ed.begin(ed.design.findNode(0, 0));
    ed.aim(4, 0);
    ed.commit();
    ed.undo();
    expect(ed.design.members.length).toBe(0);
  });

  it('refuses a beam laid along the road', () => {
    const ed = editorFor(2);
    ed.begin(ed.design.findNode(0, 0));
    ed.aim(4, 0);
    ed.commit();
    ed.setMaterial('wood');
    ed.begin(ed.design.findNode(0, 0));
    ed.aim(3, 0);
    expect(ed.drag!.valid).toBe(false);
    expect(ed.drag!.reason).toBe('Overlaps the road');
    ed.aim(2, 2);
    expect(ed.drag!.valid).toBe(true);
  });

  it('refuses a road run longer than the remaining budget allows', () => {
    const ed = editorFor(0);
    ed.begin(ed.design.findNode(0, 0));
    ed.aim(4, 0);
    ed.commit();
    ed.begin(ed.design.findNode(4, 0));
    ed.aim(2, -1);
    expect(ed.drag!.valid).toBe(false);
  });

  it('snaps a beam to an off-grid road joint', () => {
    const ed = editorFor(4);
    ed.begin(ed.design.findNode(0, 0));
    ed.aim(10, 2);
    ed.commit();
    expect(ed.design.findNode(2, 0.4)).toBeGreaterThanOrEqual(0);
    ed.setMaterial('steel');
    ed.begin(ed.design.findNode(0, -2));
    ed.aim(1.9, 0.3);
    expect([ed.drag!.tx, ed.drag!.ty]).toEqual([2, 0.4]);
    expect(ed.drag!.valid).toBe(true);
  });

  it('splits a beam mid-span without spending budget, and undoes in one step', () => {
    const ed = editorFor(2);
    ed.begin(ed.design.findNode(0, 0));
    ed.aim(4, 0);
    ed.commit();
    ed.setMaterial('wood');
    ed.begin(ed.design.findNode(0, 0));
    ed.aim(2, 2);
    ed.commit();
    const woodBefore = ed.remaining('wood');
    // Start a new beam from the middle of the diagonal.
    expect(ed.beginAt(1, 1, 0.1, 0.3)).toBe('split');
    ed.aim(2, 0);
    expect(ed.drag!.valid).toBe(true);
    ed.commit();
    expect(ed.design.findNode(1, 1)).toBeGreaterThanOrEqual(0);
    expect(ed.remaining('wood')).toBe(woodBefore - 1);
    expect(ed.design.members.filter((m) => m.mat === 'wood').length).toBe(3);
    ed.undo();
    expect(ed.design.members.filter((m) => m.mat === 'wood').length).toBe(1);
    expect(ed.remaining('wood')).toBe(woodBefore);
  });

  it('ends a beam on a point along another beam', () => {
    const ed = editorFor(2);
    ed.begin(ed.design.findNode(0, 0));
    ed.aim(4, 0);
    ed.commit();
    ed.setMaterial('wood');
    ed.begin(ed.design.findNode(0, 0));
    ed.aim(2, 2);
    ed.commit();
    ed.begin(ed.design.findNode(2, 0));
    ed.aim(1.05, 0.95);
    expect(ed.drag!.toSplit).toBeGreaterThanOrEqual(0);
    ed.commit();
    expect(ed.design.count('wood')).toBe(2);
    expect(ed.design.members.length).toBe(5);
  });
});

function splitDiagonal() {
  const ed = editorFor(2);
  ed.begin(ed.design.findNode(0, 0));
  ed.aim(4, 0);
  ed.commit();
  ed.setMaterial('wood');
  ed.begin(ed.design.findNode(0, 0));
  ed.aim(2, 2);
  ed.commit();
  ed.beginAt(1, 1, 0.1, 0.3);
  ed.aim(2, 0);
  ed.commit();
  return ed;
}

describe('removing split beams', () => {
  it('removes every piece of a split beam and refunds the part', () => {
    const ed = splitDiagonal();
    const wood = ed.remaining('wood');
    const piece = ed.design.members.findIndex((m) => m.mat === 'wood' && m.part !== undefined);
    ed.removeMember(piece);
    expect(ed.design.members.filter((m) => m.part !== undefined)).toHaveLength(0);
    expect(ed.remaining('wood')).toBe(wood + 1);
    // The beam that hung off the split joint stays, with its joint.
    expect(ed.design.findNode(1, 1)).toBeGreaterThanOrEqual(0);
    ed.undo();
    expect(ed.remaining('wood')).toBe(wood);
  });

  it('finds a short beam by its body even though its joints are within tap range', () => {
    const ed = splitDiagonal();
    // The upper half of the split diagonal, (1,1)–(2,2), is only 1.4 m long.
    const i = ed.memberBodyAt(1.5, 1.4, 0.2);
    expect(i).toBeGreaterThanOrEqual(0);
    // Right on a joint there is no body to pick, so a tap there still starts a drag.
    expect(ed.memberBodyAt(1, 1, 0.2)).toBe(-1);
  });
});

describe('Design parts', () => {
  it('counts split pieces as one part', () => {
    const d = new Design().add([0, 0], [4, 0], 'steel');
    d.splitMember(0, 2, 0);
    d.splitMember(1, 3, 0);
    expect(d.members.length).toBe(3);
    expect(d.count('steel')).toBe(1);
    expect(d.parts()).toBe(1);
  });

  it('offers quarter points and grid crossings as attach points', () => {
    const d = new Design().add([0, 0], [4, 2], 'steel');
    const pts = d.attachPoints(0);
    expect(pts).toContainEqual([2, 1]);
    expect(pts).toContainEqual([1, 0.5]);
  });
});
