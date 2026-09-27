import { describe, expect, it } from 'vitest';
import { gridPath, segmentsOverlap } from '../src/design';
import { Editor } from '../src/editor';
import { LEVELS } from '../src/levels';

const noop = { place() {}, remove() {}, invalid() {} };

function editorFor(levelIdx: number): Editor {
  return new Editor(LEVELS[levelIdx], noop);
}

describe('gridPath', () => {
  it('splits a flat span into 2 m pieces', () => {
    expect(gridPath(0, 0, 6, 0, 2.25, 10)).toEqual([[0, 0], [2, 0], [4, 0], [6, 0]]);
  });

  it('follows a slope with grid-aligned pieces that each fit', () => {
    const p = gridPath(0, 0, 10, 2, 2.25, 10)!;
    expect(p[0]).toEqual([0, 0]);
    expect(p[p.length - 1]).toEqual([10, 2]);
    for (let i = 1; i < p.length; i++) expect(Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])).toBeLessThanOrEqual(2.25);
  });

  it('gives up when the budget is too small', () => {
    expect(gridPath(0, 0, 8, 0, 2.25, 3)).toBeNull();
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
});
