import { money as usd } from './editor';
import { q as fine } from './design';
import { seatPiers, type BonusGoal, type LevelDef, type Overhang, type Pt, type Tower } from './levels';
import { MATERIAL_ORDER, MATERIALS, type MaterialId } from './physics/materials';
import { VEHICLES, type VehicleId } from './physics/vehicles';
import { THEMES } from './render/themes';
import { safeLocalStorage, type KeyValue } from './storage';

/**
 * The level editor's rules: editing a level in place, checking it can be played, and moving it
 * in and out as JSON. A custom level is an ordinary LevelDef, so the game plays it as it is.
 */

/** Custom levels get ids from here up, clear of the built-in ones. */
export const CUSTOM_ID_BASE = 1000;
export const LIMITS = { minWidth: 4, maxWidth: 64, maxHeight: 24, minWater: -14, maxWater: -1, maxConvoy: 4, maxMoney: 1_000_000 };
/** Tag on exported files, so an import can tell a level from any other JSON. */
const FORMAT = 'bridge-builder-level';

export type MakerTool = 'bolt' | 'pier' | 'pylon' | 'mast' | 'rock' | 'channel' | 'erase';
/** Most a level's concrete anchors may sit back from each bank, m. */
export const MAX_BLOCK_REACH = 12;

export function blankLevel(id: number): LevelDef {
  return {
    id,
    name: 'My level',
    tip: 'Build a bridge from bank to bank.',
    width: 12,
    anchors: [
      [0, 0],
      [12, 0],
      [0, -2],
      [12, -2],
    ],
    piers: [],
    materials: ['road', 'wood', 'steel'],
    money: 12000,
    target: 9000,
    vehicle: 'car',
    waterY: -5,
    bonus: { kind: 'stress', max: 0.5 },
  };
}

const same = (a: Pt, x: number, y: number) => Math.abs(a[0] - x) < 1e-6 && Math.abs(a[1] - y) < 1e-6;

/** Where the road meets the far bank. */
export function rightEnd(l: LevelDef): Pt {
  return [l.width, l.rightY ?? 0];
}

/**
 * The near road end always has a bolt. The far one usually does too, but a drawbridge leaves
 * it off so the leaf can lift, so it may be removed like any other.
 */
export function isFixedBolt(x: number, y: number): boolean {
  return same([0, 0], x, y);
}

function anchorIndex(l: LevelDef, x: number, y: number): number {
  return l.anchors.findIndex((a) => same(a, x, y));
}

/** Where a bolt may go: over the gap or on a bank wall, above the water, and not inside a pier. */
export function boltAllowed(l: LevelDef, x: number, y: number): string | null {
  if (x < 0 || x > l.width) return 'Bolts go between the banks';
  if (y < l.waterY) return 'Too low: that is under water';
  if (y > LIMITS.maxHeight) return 'Too high';
  if (x > 0 && x < l.width && y < 0 && l.piers.some(([px, py]) => Math.abs(px - x) < 0.6 && y < py)) return 'Inside a pier';
  return null;
}

/**
 * Adds or removes a bolt. Taking the bolt off a pier leaves the pier as a seat, and bolting a
 * seat makes it an ordinary pier again. Returns what happened, for the player.
 */
export function toggleBolt(l: LevelDef, x: number, y: number): { ok: boolean; msg: string } {
  if (isFixedBolt(x, y)) return { ok: false, msg: 'The near road end always has a bolt' };
  const i = anchorIndex(l, x, y);
  if (i >= 0) {
    const pier = l.piers.some((p) => same(p, x, y));
    removeBolt(l, i, pier);
    if (pier) return { ok: true, msg: 'Bolt removed: the pier is now a seat a deck rests on' };
    const far = same(rightEnd(l), x, y);
    return { ok: true, msg: far ? 'Far road end left free: a drawbridge leaf can lift there' : 'Bolt removed' };
  }
  const why = boltAllowed(l, x, y);
  if (why) return { ok: false, msg: why };
  l.anchors.push([x, y]);
  return { ok: true, msg: 'Bolt added' };
}

/** Removes a bolt, and the pylon it tops. The pier under it goes too, unless kept as a seat. */
function removeBolt(l: LevelDef, i: number, keepPier = false): void {
  const [x, y] = l.anchors[i];
  l.anchors.splice(i, 1);
  if (!keepPier) l.piers = l.piers.filter((p) => !same(p, x, y));
  if (l.towers) l.towers = l.towers.filter((t) => !same([t[0], t[2]], x, y));
}

/**
 * Stands a pier under a bolt in the gap, or takes it away. Anywhere else in the gap it stands
 * a seat: a pier with no bolt, where a deck rests and can lift off, as a drawbridge leaf
 * does when it opens.
 */
export function togglePier(l: LevelDef, x: number, y: number): { ok: boolean; msg: string } {
  const bolted = anchorIndex(l, x, y) >= 0;
  const i = l.piers.findIndex((p) => same(p, x, y));
  if (i >= 0) {
    l.piers.splice(i, 1);
    return { ok: true, msg: bolted ? 'Pier removed' : 'Seat removed' };
  }
  if (x <= 0 || x >= l.width) return { ok: false, msg: 'Piers stand in the gap, not on the banks' };
  if (!bolted) {
    const why = boltAllowed(l, x, y);
    if (why) return { ok: false, msg: why };
    if (l.towers?.some((t) => Math.abs(t[0] - x) < 1.5)) return { ok: false, msg: 'Too close to a pylon' };
  }
  if (l.piers.some(([px]) => Math.abs(px - x) < 1.5)) return { ok: false, msg: 'Too close to another pier' };
  l.piers.push([x, y]);
  return { ok: true, msg: bolted ? 'Pier added' : 'Seat added' };
}

/** Raises a pylon from the water to (x, y), bolted at the top, or removes the one topped there. */
export function togglePylon(l: LevelDef, x: number, y: number): { ok: boolean; msg: string } {
  const towers = (l.towers ??= []);
  const i = towers.findIndex((t) => same([t[0], t[2]], x, y));
  if (i >= 0) {
    towers.splice(i, 1);
    const a = anchorIndex(l, x, y);
    if (a >= 0) l.anchors.splice(a, 1);
    if (!towers.length) delete l.towers;
    return { ok: true, msg: 'Pylon removed' };
  }
  if (x < 0 || x > l.width) return { ok: false, msg: 'Pylons stand between the banks' };
  if (y < 2) return { ok: false, msg: 'Pylon tops go at least 2 m up' };
  if (y > LIMITS.maxHeight) return { ok: false, msg: 'Too high' };
  if (towers.some((t) => Math.abs(t[0] - x) < 1.5)) return { ok: false, msg: 'Too close to another pylon' };
  towers.push([x, l.waterY, y]);
  if (anchorIndex(l, x, y) < 0) l.anchors.push([x, y]);
  return { ok: true, msg: 'Pylon added' };
}

/** Raises a hinged mast from the water to a free top at (x, y), or removes the one topped there. */
export function toggleMast(l: LevelDef, x: number, y: number): { ok: boolean; msg: string } {
  const masts = (l.masts ??= []);
  const i = masts.findIndex((t) => same([t[0], t[2]], x, y));
  if (i >= 0) {
    masts.splice(i, 1);
    if (!masts.length) delete l.masts;
    return { ok: true, msg: 'Mast removed' };
  }
  const fail = (msg: string) => {
    if (!masts.length) delete l.masts;
    return { ok: false, msg };
  };
  if (x <= 0 || x >= l.width) return fail('Masts stand in the gap');
  if (y < 2) return fail('Mast tops go at least 2 m up');
  if (y > LIMITS.maxHeight) return fail('Too high');
  if (anchorIndex(l, x, y) >= 0) return fail('A bolt is already there');
  const near = [...masts, ...(l.towers ?? [])].some((t) => Math.abs(t[0] - x) < 1.5) || l.piers.some(([px]) => Math.abs(px - x) < 1.5);
  if (near) return fail('Too close to a pier, pylon or mast');
  masts.push([x, l.waterY, y]);
  return { ok: true, msg: l.blocks ? 'Mast added: it tips freely, so backstay it' : 'Mast added: offer concrete anchors in Settings so it can be backstayed' };
}

/**
 * Raises a rock 2 m wide from the riverbed with its top at (x, y), such as a shelf at a canyon
 * wall or an island, for concrete blocks to stand on; or removes the rock there.
 */
export function toggleRock(l: LevelDef, x: number, y: number): { ok: boolean; msg: string } {
  const rocks = (l.rocks ??= []);
  const i = rocks.findIndex(([a, b, top]) => x >= a && x <= b && y <= top && y > l.waterY - 1);
  if (i >= 0) {
    rocks.splice(i, 1);
    if (!rocks.length) delete l.rocks;
    return { ok: true, msg: 'Rock removed' };
  }
  const fail = (msg: string) => {
    if (!rocks.length) delete l.rocks;
    return { ok: false, msg };
  };
  if (x < 0 || x > l.width) return fail('Rocks rise in the gap');
  if (y <= l.waterY) return fail('Rock tops go above the water');
  if (y > Math.min(0, l.rightY ?? 0) - 1) return fail('Keep rock tops a meter under the road');
  const a = Math.max(0, x - 1);
  const b = Math.min(l.width, a + 2);
  if (b - a < 2) return fail('Too narrow here for a rock');
  const near = (px: number) => px > a - 0.6 && px < b + 0.6;
  if ([...l.piers.map((p) => p[0]), ...[...(l.towers ?? []), ...(l.masts ?? [])].map((t) => t[0])].some(near)) return fail('Too close to a pier, pylon or mast');
  if (rocks.some(([c, d]) => c < b && d > a)) return fail('Overlaps another rock');
  if (l.channels?.some(([c0, c1]) => c0 < b && c1 > a)) return fail('In the ship channel');
  rocks.push([a, b, y]);
  rocks.sort((p, q) => p[0] - q[0]);
  if (!l.materials.includes('masonry')) l.materials = MATERIAL_ORDER.filter((m) => m === 'masonry' || m === 'arch' || l.materials.includes(m));
  return { ok: true, msg: 'Rock added: concrete blocks and block arches stand on it' };
}

/** Mast height a new drawbridge's ship gets: 3 m over the channel, as on the built-in levels. */
const DEFAULT_MAST = 3;

/**
 * The open water around x: between the banks, and a meter clear of any pier or pylon, the
 * way the built-in channels sit. Null when x is on a pier or pylon.
 */
export function openWaterAt(l: LevelDef, x: number): [number, number] | null {
  let lo = 0;
  let hi = l.width;
  for (const px of [...l.piers.map((p) => p[0]), ...[...(l.towers ?? []), ...(l.masts ?? [])].map((t) => t[0])]) {
    if (Math.abs(px - x) < 1) return null;
    if (px < x) lo = Math.max(lo, px + 1);
    else hi = Math.min(hi, px - 1);
  }
  return [lo, hi];
}

/** Road height a channel tapped in fills up to: the lower road end, so the deck can run over it. */
export function deckTop(l: LevelDef): number {
  return Math.min(0, l.rightY ?? 0);
}

/**
 * The channel a drag from x0 to x1 marks: kept to the open water it starts in, so it can't
 * swallow a pier. A tap (x0 equal to x1) fills that whole stretch of open water.
 */
export function channelSpan(l: LevelDef, x0: number, x1: number): { ok: true; a: number; b: number } | { ok: false; msg: string } {
  const gap = openWaterAt(l, x0);
  if (!gap) return { ok: false, msg: 'Start the channel in open water, clear of piers' };
  const a = x0 === x1 ? gap[0] : Math.max(gap[0], Math.min(x0, x1));
  const b = x0 === x1 ? gap[1] : Math.min(gap[1], Math.max(x0, x1));
  if (b - a < 2) return { ok: false, msg: x0 === x1 ? 'Too little open water here for a channel' : 'Drag across at least 2 m for a channel' };
  return { ok: true, a, b };
}

/**
 * Marks a ship channel from x0 to x1, kept clear up to `top`, and replaces any channel it
 * overlaps. The first channel brings a tall ship and offers rams, making the level a
 * drawbridge; set the mast to 0 for a channel that only has to be kept clear.
 */
export function addChannel(l: LevelDef, x0: number, x1: number, top: number): { ok: boolean; msg: string } {
  const span = channelSpan(l, x0, x1);
  if (!span.ok) return span;
  const { a, b } = span;
  const t = Math.max(l.waterY + 1, Math.min(12, top));
  const first = !l.channels?.length;
  const kept = (l.channels ?? []).filter(([c0, c1]) => c1 <= a || c0 >= b);
  const added: [number, number, number] = [a, b, t];
  l.channels = [...kept, added].toSorted((p, q) => p[0] - q[0]);
  let msg = `Channel ${b - a} m wide, clear to ${t >= 0 ? '+' : ''}${t} m`;
  if (first && !l.ship) {
    l.ship = { mast: Math.min(20, Math.max(DEFAULT_MAST, Math.ceil(t) + DEFAULT_MAST)) };
    if (!l.materials.includes('ram')) l.materials = MATERIAL_ORDER.filter((m) => m === 'ram' || l.materials.includes(m));
    msg += ` · tall ship, ${l.ship.mast} m mast`;
  }
  return { ok: true, msg };
}

/** Removes the bolt, seat, pylon, mast, rock or channel at a point, in that order. */
export function eraseAt(l: LevelDef, x: number, y: number): { ok: boolean; msg: string } {
  const i = anchorIndex(l, x, y);
  if (i >= 0) {
    if (isFixedBolt(x, y)) return { ok: false, msg: 'The near road end always has a bolt' };
    const pylon = l.towers?.some((t) => same([t[0], t[2]], x, y));
    removeBolt(l, i);
    if (l.towers && !l.towers.length) delete l.towers;
    return { ok: true, msg: pylon ? 'Pylon removed' : 'Bolt removed' };
  }
  const seat = seatPiers(l).find(([px, py]) => Math.abs(px - x) < 0.6 && y <= py && y >= l.waterY);
  if (seat) {
    l.piers = l.piers.filter((p) => p !== seat);
    return { ok: true, msg: 'Seat removed' };
  }
  const t = l.towers?.findIndex((tw) => Math.abs(tw[0] - x) < 0.6 && y >= tw[1] && y <= tw[2]) ?? -1;
  if (t >= 0) {
    const [tx, , ty] = l.towers![t];
    return togglePylon(l, tx, ty);
  }
  const m = l.masts?.find((tw) => Math.abs(tw[0] - x) < 0.6 && y >= tw[1] && y <= tw[2]);
  if (m) return toggleMast(l, m[0], m[2]);
  if (l.rocks?.some(([a, b, top]) => x >= a && x <= b && y <= top)) return toggleRock(l, x, y);
  const c = l.channels?.findIndex(([c0, c1, top]) => x > c0 && x < c1 && y <= top + 0.5) ?? -1;
  if (c >= 0) {
    l.channels!.splice(c, 1);
    if (!l.channels!.length) {
      delete l.channels;
      delete l.ship;
    }
    return { ok: true, msg: 'Channel removed' };
  }
  return { ok: false, msg: 'Nothing to erase here' };
}

/**
 * Resizes the gap: the right bank moves with it, carrying its bolts (the road end and any on
 * its wall) at the same height relative to the road, and anything that no longer fits goes.
 * The water stays below both banks.
 */
export function setSize(l: LevelDef, width: number, rightY: number, waterY: number): void {
  const [oldW, oldR] = rightEnd(l);
  const W = clampInt(width, LIMITS.minWidth, LIMITS.maxWidth);
  const R = clampInt(rightY, -8, 8);
  const water = clampWater(waterY, R);
  const pylonTop = (x: number, y: number) => !!l.towers?.some((t) => same([t[0], t[2]], x, y));
  l.anchors = l.anchors.map(([x, y]): Pt => (Math.abs(x - oldW) < 1e-6 && !pylonTop(x, y) ? [W, y + R - oldR] : [x, y]));
  l.width = W;
  if (R) l.rightY = R;
  else delete l.rightY;
  l.waterY = water;
  l.anchors = dedupe(l.anchors.filter(([x, y]) => x >= 0 && x <= W && y >= water && y <= LIMITS.maxHeight));
  l.piers = l.piers.filter(([x, y]) => x > 0 && x < W && y > water);
  if (l.towers) {
    l.towers = l.towers.filter(([x, , top]) => x >= 0 && x <= W && top > water).map(([x, , top]): Tower => [x, water, top]);
    if (!l.towers.length) delete l.towers;
  }
  if (l.masts) {
    l.masts = l.masts.filter(([x, , top]) => x > 0 && x < W && top > water).map(([x, , top]): Tower => [x, water, top]);
    if (!l.masts.length) delete l.masts;
  }
  if (l.channels) {
    l.channels = l.channels.map(([a, b, t]): [number, number, number] => [a, Math.min(b, W), Math.max(t, water + 1)]).filter(([a, b]) => b - a >= 2);
    if (!l.channels.length) {
      delete l.channels;
      delete l.ship;
    }
  }
  if (l.overhangs) {
    l.overhangs = l.overhangs.filter((o) => o.reach < W / 2);
    if (!l.overhangs.length) delete l.overhangs;
  }
  if (l.rocks) {
    l.rocks = l.rocks.map(([a, b, t]): [number, number, number] => [a, Math.min(b, W), t]).filter(([a, b, t]) => b - a >= 1 && t > water);
    if (!l.rocks.length) delete l.rocks;
  }
}

/** What stops a level from being played, worst first. Empty when it can be played. */
export function makerIssues(l: LevelDef): string[] {
  const out: string[] = [];
  if (!l.materials.some((m) => MATERIALS[m].drivable)) out.push('Offer road or heavy deck, or nothing can be driven on.');
  if (l.target > l.money) out.push('The star target is more than the budget.');
  if (l.ship && !l.channels?.length) out.push('A drawbridge needs a ship channel for the ship.');
  if (l.ship && !l.materials.includes('ram')) out.push('Offer rams, or the drawbridge cannot open.');
  if (l.bonus.kind === 'without' && !l.materials.includes(l.bonus.mat)) out.push(`The bonus goal bans ${MATERIALS[l.bonus.mat].name.toLowerCase()}, which the level does not offer.`);
  if (l.bonus.kind === 'cost' && l.bonus.max > l.money) out.push('The bonus cost cap is more than the budget.');
  return out;
}

/**
 * What still lets a level be played but probably isn't what was meant. `found` is what a quick
 * tune of the level as it is now found possible: numbers set past it may not be reachable.
 */
export function makerWarnings(l: LevelDef, found?: { cost: number; load: number }): string[] {
  const out: string[] = [];
  if (found && l.money < found.cost) out.push(`The budget is under the cheapest bridge the tune found (${usd(found.cost)}), so the level may be impossible.`);
  else if (found && l.target < found.cost) out.push(`The star target is under the cheapest bridge the tune found (${usd(found.cost)}), so the star may be out of reach.`);
  if (found && l.bonus.kind === 'stress' && l.bonus.max < found.load) out.push(`The tune found no bridge with peak stress under ${Math.round(found.load * 100)}%, so the bonus may be out of reach.`);
  if (l.ship && l.channels?.length && spanLocked(l, l.channels[0])) {
    out.push('The deck over the ship channel is bolted at both ends, so it can’t lift. Tap one end’s bolt with the Bolt tool: on a pier, that makes a seat.');
  }
  if (!l.ship && l.materials.includes('ram')) out.push('Rams only move for a tall ship: set its mast height in Settings.');
  if (l.masts?.length && !l.blocks) out.push('Masts tip over unless they are backstayed: offer concrete anchors in Settings.');
  if (l.masts?.length && !l.materials.includes('cable')) out.push('Offer cable, or nothing can hold the masts up.');
  return out;
}

/**
 * Whether the nearest supports at road height on both sides of a channel are bolts. A leaf
 * hinges at one and has to lift off the other, which only a seat or a free road end allows.
 */
function spanLocked(l: LevelDef, [x0, x1, top]: [number, number, number]): boolean {
  const supports = [...l.anchors.map(([x, y]) => ({ x, y, bolt: true })), ...seatPiers(l).map(([x, y]) => ({ x, y, bolt: false }))].filter((s) => s.y >= top - 0.5);
  const nearest = (side: -1 | 1) =>
    supports.filter((s) => (side < 0 ? s.x <= x0 : s.x >= x1)).toSorted((a, b) => Math.abs(a.x - (side < 0 ? x0 : x1)) - Math.abs(b.x - (side < 0 ? x0 : x1)))[0];
  return !!nearest(-1)?.bolt && !!nearest(1)?.bolt;
}

// ───────────────────────────── Import and export ─────────────────────────────

/** A level as a JSON file: the LevelDef itself, tagged. The id is left out; each game assigns its own. */
export function exportLevel(l: LevelDef): string {
  const { id: _id, ...rest } = l;
  return JSON.stringify({ format: FORMAT, version: 1, level: rest }, null, 2);
}

/**
 * Reads a level from JSON: an exported file, or a bare LevelDef such as one copied from
 * src/levels.ts. Everything is checked and clamped, so a hand-edited file can't break the game.
 * Throws an Error with a readable message when the JSON isn't a level.
 */
export function parseLevel(json: string, id: number): LevelDef {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('That is not valid JSON.');
  }
  if (isObj(raw) && raw.format === FORMAT) raw = raw.level;
  if (!isObj(raw)) throw new Error('No level found in that JSON.');
  const r = raw;
  if (typeof r.width !== 'number' || !Array.isArray(r.anchors)) throw new Error('A level needs at least a width and anchors.');

  const width = clampInt(r.width, LIMITS.minWidth, LIMITS.maxWidth);
  // A tenth of a meter, as built-in levels may set it: 11-3's far bank sits at a 3% grade.
  const rightY = Math.round(Math.max(-8, Math.min(8, num(r.rightY, 0))) * 10) / 10;
  const waterY = clampWater(num(r.waterY, -5), rightY);
  const inGap = (x: number) => x >= 0 && x <= width;

  const given = list(r.anchors, pt).filter(([x, y]) => inGap(x) && y >= waterY && y <= LIMITS.maxHeight);
  const anchors = dedupe(given.some(([x, y]) => isFixedBolt(x, y)) ? given : [[0, 0], ...given]);
  const piers = list(r.piers, pt).filter(([x, y]) => x > 0 && x < width && y > waterY && y <= LIMITS.maxHeight);
  const towers = list(r.towers, (v): Tower | null => {
    if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    const [x, base, top] = v.map(round);
    return inGap(x) && top > base && top <= LIMITS.maxHeight ? [x, Math.max(base, waterY - 10), top] : null;
  });
  const masts = list(r.masts, (v): Tower | null => {
    if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    const [x, base, top] = v.map(round);
    return x > 0 && x < width && top > base && top <= LIMITS.maxHeight ? [x, Math.max(base, waterY - 10), top] : null;
  });
  const channels = list(r.channels, (v): [number, number, number] | null => {
    if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    const [a, b, top] = v.map(round);
    return a >= 0 && b <= width && b - a >= 1 ? [a, b, Math.max(top, waterY + 1)] : null;
  });
  const rocks = list(r.rocks, (v): [number, number, number] | null => {
    if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    const [a, b, top] = v.map(round);
    return a >= 0 && b <= width && b - a >= 1 && top > waterY && top <= LIMITS.maxHeight ? [a, b, top] : null;
  });
  const overhangs = list(r.overhangs, (v): Overhang | null => {
    if (!isObj(v) || (v.side !== 'left' && v.side !== 'right')) return null;
    const bottom = num(v.bottom, NaN);
    const top = num(v.top, NaN);
    const reach = num(v.reach, NaN);
    return Number.isFinite(bottom) && Number.isFinite(top) && Number.isFinite(reach) && top > bottom && reach > 0 && reach < width / 2 ? { side: v.side, bottom, top, reach } : null;
  });

  const offered = new Set(Array.isArray(r.materials) ? r.materials.filter(isMaterial) : []);
  const materials = MATERIAL_ORDER.filter((m) => offered.has(m));
  if (!materials.length) materials.push('road', 'wood');
  const vehicle: VehicleId = isVehicle(r.vehicle) ? r.vehicle : 'car';
  const convoy = (Array.isArray(r.convoy) ? r.convoy.filter(isVehicle) : []).slice(0, LIMITS.maxConvoy - 1);
  const money = clampInt(num(r.money, 10000), 100, LIMITS.maxMoney);
  const target = clampInt(num(r.target, Math.round(money * 0.75)), 0, money);

  const level: LevelDef = {
    id,
    name: str(r.name, 'Imported level', 40),
    tip: str(r.tip, '', 200),
    width,
    anchors,
    piers,
    materials,
    money,
    target,
    vehicle,
    waterY,
    bonus: parseBonus(r.bonus, materials),
  };
  if (rightY) level.rightY = rightY;
  if (towers.length) level.towers = towers;
  if (masts.length) level.masts = masts;
  if (isObj(r.blocks)) {
    const reach = clampInt(num(r.blocks.reach, 0), 0, MAX_BLOCK_REACH);
    const tonnes = clampInt(num(r.blocks.tonnes, 5), 5, 40);
    if (reach) level.blocks = tonnes === 5 ? { reach } : { reach, tonnes };
  }
  if (typeof r.ceiling === 'number') level.ceiling = clampInt(r.ceiling, 0, LIMITS.maxHeight);
  if (channels.length) level.channels = channels;
  if (overhangs.length) level.overhangs = overhangs;
  if (rocks.length) level.rocks = rocks;
  if (convoy.length) level.convoy = convoy;
  if (isObj(r.ship) && channels.length) level.ship = { mast: clampInt(num(r.ship.mast, 3), 1, 20) };
  // A train's brake stop, the weather and the ground: each kept when it reads as one.
  if (isObj(r.brake) && within(r.brake.at, 0, width)) level.brake = within(r.brake.hold, 0, 30) ? { at: r.brake.at, hold: r.brake.hold as number } : { at: r.brake.at };
  if (isObj(r.wind) && within(r.wind.push, 0, 1e5) && within(r.wind.lift, 0, 1e5) && within(r.wind.period, 0.2, 60)) level.wind = { push: r.wind.push, lift: r.wind.lift, period: r.wind.period };
  if (isObj(r.quake) && within(r.quake.g, 0, 2) && within(r.quake.freq, 0.1, 10) && within(r.quake.at, -60, width + 60) && within(r.quake.dur, 0.5, 60)) level.quake = { g: r.quake.g, freq: r.quake.freq, at: r.quake.at, dur: r.quake.dur };
  if (isObj(r.march) && within(r.march.pace, 0.1, 5) && within(r.march.force, 0, 1)) level.march = { pace: r.march.pace, force: r.march.force };
  const mud = list(r.mud, (v): [number, number, number] | null => {
    if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    const [a, b, top] = v.map(round);
    return a >= 0 && b <= width && b - a >= 1 && top > waterY && top <= 0 ? [a, b, top] : null;
  });
  if (mud.length) level.mud = mud;
  if (isObj(r.piles) && mud.length && within(r.piles.price, 0, 100000)) level.piles = { price: Math.round(r.piles.price) };
  if (isObj(r.flood) && within(r.flood.at, -60, width + 60) && within(r.flood.rise, 0, 20) && within(r.flood.current, 0, 1e5)) level.flood = { at: r.flood.at, rise: r.flood.rise, current: r.flood.current };
  if (isObj(r.limits)) {
    const limits: Partial<Record<MaterialId, number>> = {};
    for (const [m, n] of Object.entries(r.limits)) if (isMaterial(m) && materials.includes(m) && typeof n === 'number' && n >= 0) limits[m] = Math.floor(n);
    if (Object.keys(limits).length) level.limits = limits;
  }
  const hint = list(r.hint, (v): [Pt, Pt, MaterialId] | null => {
    if (!Array.isArray(v) || v.length !== 3 || !isMaterial(v[2]) || !materials.includes(v[2])) return null;
    const a = finePt(v[0]);
    const b = finePt(v[1]);
    return a && b ? [a, b, v[2]] : null;
  });
  if (hint.length) level.hint = hint;
  if (hint.length && r.hintSolves === true) level.hintSolves = true;
  const toll = clampInt(num(r.anchorCost, 0), 0, 100000);
  if (toll) level.anchorCost = toll;
  if (typeof r.theme === 'string' && THEMES.some((t) => t.id === r.theme)) level.theme = r.theme;
  return level;
}

function parseBonus(v: unknown, materials: MaterialId[]): BonusGoal {
  if (isObj(v)) {
    if ((v.kind === 'cost' || v.kind === 'parts') && typeof v.max === 'number' && v.max > 0) return { kind: v.kind, max: Math.round(v.max) };
    if (v.kind === 'stress' && typeof v.max === 'number' && v.max > 0 && v.max <= 1) return { kind: 'stress', max: Math.round(v.max * 100) / 100 };
    if (v.kind === 'without' && isMaterial(v.mat) && materials.includes(v.mat)) return { kind: 'without', mat: v.mat };
  }
  return { kind: 'stress', max: 0.5 };
}

// ───────────────────────────── Saved custom levels ─────────────────────────────

const STORE_KEY = 'bridgebuilder.custom';

/** Custom levels and the bridge last built on each, kept in this browser. */
export interface CustomSave {
  levels: LevelDef[];
  designs: Record<number, string>;
}

export function loadCustom(store: KeyValue | null = safeLocalStorage()): CustomSave {
  try {
    const raw = store?.getItem(STORE_KEY);
    if (!raw) return { levels: [], designs: {} };
    const o = JSON.parse(raw) as { levels?: unknown[]; designs?: Record<number, string> };
    const levels: LevelDef[] = [];
    for (const l of o.levels ?? []) {
      try {
        const id = isObj(l) && typeof l.id === 'number' && l.id >= CUSTOM_ID_BASE ? l.id : nextCustomId(levels);
        levels.push(parseLevel(JSON.stringify(l), id));
      } catch {
        // Skip a level that no longer reads.
      }
    }
    return { levels, designs: o.designs ?? {} };
  } catch {
    return { levels: [], designs: {} };
  }
}

export function saveCustom(save: CustomSave, store: KeyValue | null = safeLocalStorage()): boolean {
  try {
    store?.setItem(STORE_KEY, JSON.stringify(save));
    return !!store;
  } catch {
    return false;
  }
}

export function nextCustomId(levels: LevelDef[]): number {
  return Math.max(CUSTOM_ID_BASE - 1, ...levels.map((l) => l.id)) + 1;
}

export function isCustom(id: number): boolean {
  return id >= CUSTOM_ID_BASE;
}

// ───────────────────────────── Helpers ─────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isMaterial(v: unknown): v is MaterialId {
  return typeof v === 'string' && v in MATERIALS;
}

function isVehicle(v: unknown): v is VehicleId {
  return typeof v === 'string' && v in VEHICLES;
}

/** Whether v is a number from lo to hi. */
function within(v: unknown, lo: number, hi: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback: string, max: number): string {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback;
}

/** Water level to the half meter, at least a meter below both banks. */
function clampWater(v: number, rightY: number): number {
  const half = Math.round(Math.min(v, Math.min(0, rightY) - 1) * 2) / 2;
  return Math.max(LIMITS.minWater, Math.min(LIMITS.maxWater, half));
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/** Coordinates snap to a tenth of a meter. */
function round(v: number): number {
  return Math.round(v * 10) / 10;
}

function pt(v: unknown): Pt | null {
  return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [round(v[0]), round(v[1])] : null;
}

/** A point at a joint's full precision: a ghost member may end on a main cable's curve. */
function finePt(v: unknown): Pt | null {
  return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [fine(v[0]), fine(v[1])] : null;
}

function list<T>(v: unknown, read: (x: unknown) => T | null): T[] {
  return Array.isArray(v) ? v.map(read).filter((x): x is T => x !== null) : [];
}

function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) if (!out.some((q) => same(q, p[0], p[1]))) out.push(p);
  return out;
}
