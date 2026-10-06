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

/** A design reduced to its members, independent of node order, so equal designs share a cache entry. */
export function canonical(d: Design): string {
  const parts = d.members.map((m) => {
    const a = d.nodes[m.a];
    const b = d.nodes[m.b];
    const [p, q] = a.x < b.x || (a.x === b.x && a.y < b.y) ? [a, b] : [b, a];
    return `${m.mat}:${p.x},${p.y}:${q.x},${q.y}`;
  });
  parts.sort();
  return parts.join(' ');
}

/** The parts of a level that change how a design behaves. */
export function levelKey(l: LevelDef): string {
  const { width, rightY, anchors, piers, waterY, towers, overhangs, channels, vehicle, materials } = l;
  return JSON.stringify({ width, rightY, anchors, piers, waterY, towers, overhangs, channels, vehicle, materials });
}

/** The outcome of a run that never finished: it counts as a design that didn't cross. */
export function failed(reason: string): Outcome {
  return { valid: true, crossed: false, reason, peak: 1, cost: 0, parts: 0, progress: 0, broken: false };
}
