import type { Design } from '../../src/design';
import type { LevelDef } from '../../src/levels';
import type { Outcome } from './simulate';

/**
 * Test drives designs: all the searches need. The tuner's worker-thread pool is one; the
 * level editor's quick tune in the browser has its own on Web Workers.
 */
export interface Runner {
  run(level: LevelDef, d: Design, seconds?: number): Promise<Outcome>;
}

/** A design reduced to its members, blocks and set anchors, independent of node order, so equal designs share a cache entry. */
export function canonical(d: Design): string {
  const pt = (i: number) => `${d.nodes[i].x},${d.nodes[i].y}`;
  const parts = d.members.map((m) => {
    const a = d.nodes[m.a];
    const b = d.nodes[m.b];
    const [p, q] = a.x < b.x || (a.x === b.x && a.y < b.y) ? [a, b] : [b, a];
    return `${m.mat}:${p.x},${p.y}:${q.x},${q.y}`;
  });
  for (const c of d.cells) parts.push(`${c.mat}#${c.n.map(pt).sort().join(':')}`);
  d.nodes.forEach((n, i) => {
    if (n.pile || n.block) parts.push(`${n.pile ? 'pile' : 'block'}@${pt(i)}`);
  });
  parts.sort();
  return parts.join(' ');
}

/** The parts of a level that can change how a design behaves: all of it but its words, numbers and looks. */
export function levelKey(l: LevelDef): string {
  const { id: _id, name: _name, tip: _tip, money: _money, target: _target, bonus: _bonus, theme: _theme, hint: _hint, hintSolves: _hintSolves, ...rest } = l;
  return JSON.stringify(rest);
}

/** The outcome of a run that never finished: it counts as a design that didn't cross. */
export function failed(reason: string): Outcome {
  return { valid: true, crossed: false, reason, peak: 1, cost: 0, parts: 0, progress: 0, broken: false };
}
