import type { BonusGoal, LevelDef, Overhang, Pt, Tower } from './levels';
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
export const LIMITS = { minWidth: 4, maxWidth: 40, maxHeight: 24, minWater: -14, maxWater: -1, maxConvoy: 4, maxMoney: 1_000_000 };
/** Tag on exported files, so an import can tell a level from any other JSON. */
const FORMAT = 'bridge-builder-level';

export type MakerTool = 'bolt' | 'pier' | 'pylon' | 'channel' | 'erase';

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

/** Adds or removes a bolt. Returns what happened, for the player. */
export function toggleBolt(l: LevelDef, x: number, y: number): { ok: boolean; msg: string } {
  if (isFixedBolt(x, y)) return { ok: false, msg: 'The near road end always has a bolt' };
  const i = anchorIndex(l, x, y);
  if (i >= 0) {
    removeBolt(l, i);
    const far = same(rightEnd(l), x, y);
    return { ok: true, msg: far ? 'Far road end left free: a drawbridge leaf can rest there' : 'Bolt removed' };
  }
  const why = boltAllowed(l, x, y);
  if (why) return { ok: false, msg: why };
  l.anchors.push([x, y]);
  return { ok: true, msg: 'Bolt added' };
}

/** Removes a bolt, and the pier or pylon it tops. */
function removeBolt(l: LevelDef, i: number): void {
  const [x, y] = l.anchors[i];
  l.anchors.splice(i, 1);
  l.piers = l.piers.filter((p) => !same(p, x, y));
  if (l.towers) l.towers = l.towers.filter((t) => !same([t[0], t[2]], x, y));
}

/** Stands a pier under a bolt in the gap, or takes it away. */
export function togglePier(l: LevelDef, x: number, y: number): { ok: boolean; msg: string } {
  if (anchorIndex(l, x, y) < 0) return { ok: false, msg: 'Tap a bolt to stand a pier under it' };
  if (x <= 0 || x >= l.width) return { ok: false, msg: 'Piers stand in the gap, not on the banks' };
  const i = l.piers.findIndex((p) => same(p, x, y));
  if (i >= 0) {
    l.piers.splice(i, 1);
    return { ok: true, msg: 'Pier removed' };
  }
  if (l.piers.some(([px]) => Math.abs(px - x) < 1.5)) return { ok: false, msg: 'Too close to another pier' };
  l.piers.push([x, y]);
  return { ok: true, msg: 'Pier added' };
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

/** Marks a ship channel from x0 to x1, kept clear up to `top`. Replaces any channel it overlaps. */
export function addChannel(l: LevelDef, x0: number, x1: number, top: number): { ok: boolean; msg: string } {
  const a = Math.max(0, Math.min(x0, x1));
  const b = Math.min(l.width, Math.max(x0, x1));
  if (b - a < 2) return { ok: false, msg: 'Drag across at least 2 m for a channel' };
  const t = Math.max(l.waterY + 1, Math.min(12, top));
  const kept = (l.channels ?? []).filter(([c0, c1]) => c1 <= a || c0 >= b);
  const added: [number, number, number] = [a, b, t];
  l.channels = [...kept, added].toSorted((p, q) => p[0] - q[0]);
  return { ok: true, msg: `Channel ${b - a} m wide, clear to ${t >= 0 ? '+' : ''}${t} m` };
}

/** Removes the bolt, pylon or channel at a point, in that order. */
export function eraseAt(l: LevelDef, x: number, y: number): { ok: boolean; msg: string } {
  const i = anchorIndex(l, x, y);
  if (i >= 0) {
    if (isFixedBolt(x, y)) return { ok: false, msg: 'The near road end always has a bolt' };
    const pylon = l.towers?.some((t) => same([t[0], t[2]], x, y));
    removeBolt(l, i);
    if (l.towers && !l.towers.length) delete l.towers;
    return { ok: true, msg: pylon ? 'Pylon removed' : 'Bolt removed' };
  }
  const t = l.towers?.findIndex((tw) => Math.abs(tw[0] - x) < 0.6 && y >= tw[1] && y <= tw[2]) ?? -1;
  if (t >= 0) {
    const [tx, , ty] = l.towers![t];
    return togglePylon(l, tx, ty);
  }
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
 * Resizes the gap: the right road end moves with it, and anything that no longer fits goes.
 * The water stays below both banks.
 */
export function setSize(l: LevelDef, width: number, rightY: number, waterY: number): void {
  const oldEnd = rightEnd(l);
  const hadEnd = l.anchors.some((a) => same(a, oldEnd[0], oldEnd[1]));
  const W = clampInt(width, LIMITS.minWidth, LIMITS.maxWidth);
  const R = clampInt(rightY, -8, 8);
  const water = clampWater(waterY, R);
  l.anchors = l.anchors.filter((a) => !same(a, oldEnd[0], oldEnd[1]));
  l.width = W;
  if (R) l.rightY = R;
  else delete l.rightY;
  l.waterY = water;
  l.anchors = l.anchors.filter(([x, y]) => x >= 0 && x <= W && y >= water);
  if (hadEnd) l.anchors.push([W, R]);
  l.anchors = dedupe(l.anchors);
  l.piers = l.piers.filter(([x, y]) => x > 0 && x < W && l.anchors.some((a) => same(a, x, y)));
  if (l.towers) {
    l.towers = l.towers.filter(([x, , top]) => x >= 0 && x <= W && top > water).map(([x, , top]): Tower => [x, water, top]);
    if (!l.towers.length) delete l.towers;
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
  const rightY = clampInt(num(r.rightY, 0), -8, 8);
  const waterY = clampWater(num(r.waterY, -5), rightY);
  const inGap = (x: number) => x >= 0 && x <= width;

  const given = list(r.anchors, pt).filter(([x, y]) => inGap(x) && y >= waterY && y <= LIMITS.maxHeight);
  const anchors = dedupe(given.some(([x, y]) => isFixedBolt(x, y)) ? given : [[0, 0], ...given]);
  const piers = list(r.piers, pt).filter(([x, y]) => x > 0 && x < width && anchors.some((a) => same(a, x, y)));
  const towers = list(r.towers, (v): Tower | null => {
    if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    const [x, base, top] = v.map(round);
    return inGap(x) && top > base && top <= LIMITS.maxHeight ? [x, Math.max(base, waterY - 10), top] : null;
  });
  const channels = list(r.channels, (v): [number, number, number] | null => {
    if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    const [a, b, top] = v.map(round);
    return a >= 0 && b <= width && b - a >= 1 ? [a, b, Math.max(top, waterY + 1)] : null;
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
  if (channels.length) level.channels = channels;
  if (overhangs.length) level.overhangs = overhangs;
  if (convoy.length) level.convoy = convoy;
  if (isObj(r.ship) && channels.length) level.ship = { mast: clampInt(num(r.ship.mast, 3), 1, 20) };
  if (isObj(r.limits)) {
    const limits: Partial<Record<MaterialId, number>> = {};
    for (const [m, n] of Object.entries(r.limits)) if (isMaterial(m) && materials.includes(m) && typeof n === 'number' && n >= 0) limits[m] = Math.floor(n);
    if (Object.keys(limits).length) level.limits = limits;
  }
  const hint = list(r.hint, (v): [Pt, Pt, MaterialId] | null => {
    if (!Array.isArray(v) || v.length !== 3 || !isMaterial(v[2]) || !materials.includes(v[2])) return null;
    const a = pt(v[0]);
    const b = pt(v[1]);
    return a && b ? [a, b, v[2]] : null;
  });
  if (hint.length) level.hint = hint;
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

function list<T>(v: unknown, read: (x: unknown) => T | null): T[] {
  return Array.isArray(v) ? v.map(read).filter((x): x is T => x !== null) : [];
}

function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) if (!out.some((q) => same(q, p[0], p[1]))) out.push(p);
  return out;
}
