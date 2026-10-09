import { segmentHitsRect, segmentsOverlap, type Design } from './design';
import { bankY, type LevelDef } from './levels';
import { BLOCK, MATERIALS, type MaterialId } from './physics/materials';

/** A new joint this close to an existing one is refused as too fiddly. */
export const MIN_JOINT_GAP = 0.2;

/** Highest point anyone may build to on a level. */
export function topY(level: LevelDef): number {
  const towers = [...(level.towers ?? []), ...(level.masts ?? [])].map((t) => t[2] + 1.5);
  // Anchored levels leave room to raise a tower a cable's reach above the banks.
  const blocks = level.blocks ? [Math.max(0, bankY(level)) + MATERIALS.cable.maxLen] : [];
  return Math.max(4, ...level.anchors.map((a) => a[1] + 3), ...towers, ...blocks, level.ceiling ?? 0);
}

/** How far back from the gap's edge (x) the point lies over a bank: positive behind either bank. */
function behindBank(level: LevelDef, x: number): number {
  return x < 0 ? -x : x - level.width;
}

/** Height of the bank top under x, for x off the gap. */
function bankTop(level: LevelDef, x: number): number {
  return x < 0 ? 0 : bankY(level);
}

/** Whether a concrete anchor may be set at (x, y): on a bank's ground, whole meters from 1 m to the level's reach back. */
export function blockSpot(level: LevelDef, x: number, y: number): boolean {
  if (!level.blocks) return false;
  const back = behindBank(level, x);
  if (back < 1 - 1e-6 || back > level.blocks.reach + 1e-6 || Math.abs(back - Math.round(back)) > 1e-6) return false;
  return Math.abs(y - bankTop(level, x)) < 1e-6;
}

/** Every spot a concrete anchor may go on the level, left bank first. */
export function blockSpots(level: LevelDef): [number, number][] {
  const out: [number, number][] = [];
  const reach = Math.floor(level.blocks?.reach ?? 0);
  for (let k = reach; k >= 1; k--) out.push([-k, 0]);
  for (let k = 1; k <= reach; k++) out.push([level.width + k, bankY(level)]);
  return out;
}

/**
 * Whether (x, y) is a bolt that won't hold a cable: on a level with concrete anchors, the
 * bank and pier bolts are bearings for the deck, so backstays must go to concrete. Tower tops still hold cables.
 */
export function cableBolt(level: LevelDef, x: number, y: number): boolean {
  if (!level.blocks) return false;
  const at = (p: readonly number[]) => Math.abs(p[0] - x) < 1e-6 && Math.abs(p[1] - y) < 1e-6;
  return level.anchors.some(at) && !(level.towers ?? []).some((t) => at([t[0], t[2]]));
}

/**
 * Whether (x, y) is low over an anchor strip, under the road clearance but off the ground: a
 * place only a main cable's own joints may go, as it rises from its concrete anchor.
 */
export function lowOverStrip(level: LevelDef, x: number, y: number): boolean {
  if (!level.blocks || (x >= -1e-9 && x <= level.width + 1e-9)) return false;
  const back = behindBank(level, x);
  const ground = bankTop(level, x);
  return back <= level.blocks.reach + 1e-6 && y > ground + 0.05 && y < ground + BLOCK.clearance;
}

/** Whether a new joint may go at (x, y): inside the level, above the water, and clear of piers, rock and channels. */
export function pointAllowed(level: LevelDef, x: number, y: number): boolean {
  if (y > topY(level) || y <= level.waterY + 0.5) return false;
  if (x < -1e-9 || x > level.width + 1e-9) {
    // Over a bank that offers concrete anchors, high enough to keep the road clear.
    const back = behindBank(level, x);
    if (!level.blocks || back > level.blocks.reach + 1e-6 || y < bankTop(level, x) + BLOCK.clearance - 1e-9) return false;
    return !(level.overhangs ?? []).some((o) => (o.side === 'left') === x < 0 && y > o.bottom - 0.3);
  }
  for (const [px, py] of level.piers) if (Math.abs(x - px) < 0.6 && y < py) return false;
  // A mast's footing stands below its hinge, like a pier.
  for (const [mx, base] of level.masts ?? []) if (Math.abs(x - mx) < 0.6 && y < base) return false;
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
  for (const [x, , y] of level.masts ?? []) if (d.findNode(x, y) < 0) out.push(`missing mast top ${x},${y}`);
  nodes.forEach((n, i) => {
    if (n.block && !blockSpot(level, n.x, n.y)) out.push(`concrete anchor ${n.x},${n.y} not on an anchor spot`);
    if (n.anchor) return;
    const onlyMain = members.every((m) => (m.a !== i && m.b !== i) || MATERIALS[m.mat].curved);
    if (!pointAllowed(level, n.x, n.y) && !(onlyMain && lowOverStrip(level, n.x, n.y))) out.push(`joint ${n.x},${n.y} out of bounds`);
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
    if (MATERIALS[m.mat].tensionOnly && (cableBolt(level, a.x, a.y) || cableBolt(level, b.x, b.y))) out.push(`${tag}: on a bolt that holds no cables`);
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
