import { segmentHitsRect, segmentsOverlap, type Design } from './design';
import type { LevelDef } from './levels';
import { MATERIALS, type MaterialId } from './physics/materials';

/** A new joint this close to an existing one is refused as too fiddly. */
export const MIN_JOINT_GAP = 0.2;

/** Highest point anyone may build to on a level. */
export function topY(level: LevelDef): number {
  const towers = (level.towers ?? []).map((t) => t[2] + 1.5);
  return Math.max(4, ...level.anchors.map((a) => a[1] + 3), ...towers);
}

/** Whether a new joint may go at (x, y): inside the level, above the water, and clear of piers, rock and channels. */
export function pointAllowed(level: LevelDef, x: number, y: number): boolean {
  if (x < -1e-9 || x > level.width + 1e-9) return false;
  if (y > topY(level) || y <= level.waterY + 0.5) return false;
  for (const [px, py] of level.piers) if (Math.abs(x - px) < 0.6 && y < py) return false;
  for (const o of level.overhangs ?? []) {
    const inside = o.side === 'left' ? x <= o.reach + 0.3 : x >= level.width - o.reach - 0.3;
    if (inside && y > o.bottom - 0.3) return false;
  }
  for (const [x0, x1, top] of level.channels ?? []) if (x > x0 && x < x1 && y < top) return false;
  return true;
}

/** True when the segment passes through one of the level's ship channels. */
export function crossesChannel(level: LevelDef, ax: number, ay: number, bx: number, by: number): boolean {
  return (level.channels ?? []).some(([x0, x1, top]) => segmentHitsRect(ax, ay, bx, by, x0, level.waterY - 10, x1, top));
}

/**
 * Everything that would stop a player from building this design in the editor, or that
 * the level forbids: an empty list means it is buildable. Checks the budget unless told not to.
 */
export function designProblems(level: LevelDef, d: Design, opts: { budget?: boolean } = {}): string[] {
  const out: string[] = [];
  const { nodes, members } = d;
  for (const [x, y] of level.anchors) if (d.findNode(x, y) < 0) out.push(`missing anchor ${x},${y}`);
  nodes.forEach((n, i) => {
    if (n.anchor) return;
    if (!pointAllowed(level, n.x, n.y)) out.push(`joint ${n.x},${n.y} out of bounds`);
    for (let j = 0; j < i; j++) {
      const o = nodes[j];
      if (Math.hypot(o.x - n.x, o.y - n.y) < MIN_JOINT_GAP) out.push(`joints ${o.x},${o.y} and ${n.x},${n.y} too close`);
    }
  });
  const seen = new Set<string>();
  members.forEach((m, i) => {
    const a = nodes[m.a];
    const b = nodes[m.b];
    const tag = `${m.mat} ${a.x},${a.y}-${b.x},${b.y}`;
    if (!level.materials.includes(m.mat)) out.push(`${tag}: material not offered`);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) out.push(`${tag}: zero length`);
    if (len > MATERIALS[m.mat].maxLen + 1e-9) out.push(`${tag}: too long`);
    const key = m.a < m.b ? `${m.a}-${m.b}` : `${m.b}-${m.a}`;
    if (seen.has(key)) out.push(`${tag}: duplicate`);
    seen.add(key);
    if (crossesChannel(level, a.x, a.y, b.x, b.y)) out.push(`${tag}: in the channel`);
    for (let j = 0; j < i; j++) {
      const o = members[j];
      if (o.part !== undefined && o.part === m.part) continue;
      const c = nodes[o.a];
      const e = nodes[o.b];
      if (segmentsOverlap(a.x, a.y, b.x, b.y, c.x, c.y, e.x, e.y)) out.push(`${tag}: overlaps another member`);
    }
  });
  for (const [mat, max] of Object.entries(level.limits ?? {}) as [MaterialId, number][]) {
    if (d.count(mat) > max) out.push(`${d.count(mat)} ${mat} parts, over the limit of ${max}`);
  }
  if (opts.budget !== false && d.cost() > level.money) out.push(`over budget: ${d.cost()} > ${level.money}`);
  return out;
}
