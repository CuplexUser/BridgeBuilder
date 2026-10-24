import { money } from './editor';
import { seatPiers, type LevelDef } from './levels';
import { blockOf, MATERIALS, type MaterialId } from './physics/materials';
import { VEHICLES, type VehicleId } from './physics/vehicles';
import { bonusLabel, SAFE_STRESS } from './scoring';
import type { Design } from './design';
import { fmt, t, tn } from './i18n';
import { levelTip, matInline, vehicleInline, vehicleName } from './i18n/data';

/** One line of a level's goals: a star (★) or the bonus star (✦). */
export interface BriefGoal {
  mark: '★' | '✦';
  text: string;
  /** A short explanation under the goal. */
  note?: string;
}

/** Everything a player should know before building: shown when a level opens, and on demand. */
export interface Brief {
  traffic: string;
  tip: string;
  goals: BriefGoal[];
  /** What makes this level different: drawbridges, convoys, tolls, limits, weight ratings. */
  rules: string[];
}

/**
 * Who crosses a level, e.g. "Semi truck · 40 t", "Compact car + school bus · 30 t" for a convoy,
 * or "Delivery van ×3 · 15 t". A drawbridge level says so.
 */
export function traffic(l: LevelDef): string {
  const ids = [l.vehicle, ...(l.convoy ?? [])];
  const groups: { id: VehicleId; n: number }[] = [];
  for (const id of ids) {
    const last = groups.at(-1);
    if (last?.id === id) last.n++;
    else groups.push({ id, n: 1 });
  }
  const names = groups.map((g, i) => `${i ? vehicleInline(g.id) : vehicleName(g.id)}${g.n > 1 ? ` ×${g.n}` : ''}`).join(' + ');
  return `${names} · ${Math.max(...ids.map((v) => VEHICLES[v].tonnes))} t${l.ship ? ` · ${t('traffic.drawbridge')}` : ''}`;
}

export function levelBrief(l: LevelDef): Brief {
  const vehicles = [l.vehicle, ...(l.convoy ?? [])];
  const cross =
    vehicles.length > 2 ? t('goal.crossAll', { n: vehicles.length }) : vehicles.length === 2 ? t('goal.crossBoth') : t('goal.crossOne', { name: vehicleInline(l.vehicle) });
  const goals: BriefGoal[] = [
    { mark: '★', text: cross, note: t('goal.crossNote', { width: l.width, money: money(l.money) }) },
    { mark: '★', text: t('goal.target', { money: money(l.target) }), note: t('goal.targetNote') },
    { mark: '★', text: t('goal.safe', { pct: fmt.pct(SAFE_STRESS) }), note: t('goal.safeNote') },
    { mark: '✦', text: bonusLabel(l.bonus), note: bonusNote(l) },
  ];
  return { traffic: `${traffic(l)} · ${l.width} m`, tip: levelTip(l), goals, rules: rules(l) };
}

/** What the bonus goal means in practice. */
function bonusNote(l: LevelDef): string {
  const g = l.bonus;
  switch (g.kind) {
    case 'cost':
      return t('bonusNote.cost');
    case 'stress':
      return t('bonusNote.stress');
    case 'parts':
      return t('bonusNote.parts');
    case 'without':
      return t('bonusNote.without', { mat: matInline(g.mat) });
  }
}

/** A length as players read it, e.g. "12 m". */
const meters = (v: number) => t('unit.m', { v });

function rules(l: LevelDef): string[] {
  const out: string[] = [];
  const defs = [l.vehicle, ...(l.convoy ?? [])].map((v) => VEHICLES[v]);
  if (l.swing) {
    out.push(`${t('rule.swing', { mast: l.ship?.mast ?? 0, pivot: l.swing.pivot })} ${t(l.ship?.after ? 'rule.swingAfter' : 'rule.swingThen')}`);
  } else if (l.ship?.after) {
    out.push(t('rule.shipAfter', { mast: l.ship.mast }));
  } else if (l.ship) {
    out.push(t('rule.ship', { mast: l.ship.mast }));
  } else if (l.channels?.length) {
    const top = Math.max(...l.channels.map((c) => c[2]));
    out.push(t('rule.channel', { top: `${top >= 0 ? '+' : ''}${fmt.dec(top)}` }));
  }
  if (l.lock !== undefined) out.push(t('rule.lock', { at: l.lock }));
  if (l.lift?.length) out.push(t('rule.lift', { where: fmt.list(l.lift.map(meters)) }));
  if (l.lower) {
    const low = [l.lower.vehicle, ...(l.lower.convoy ?? [])].map((v) => t('rule.lowerItem', { name: vehicleInline(v) }));
    out.push(t('rule.lower', { who: fmt.list(low), depth: -l.lower.y }));
  }
  if (seatPiers(l).length) out.push(t('rule.seat'));
  if (defs[0].rail) {
    out.push(defs.length > 1 ? tn('rule.trainWagons', defs.length - 1, { t: defs[0].tonnes, wt: defs[1].tonnes }) : t('rule.train', { t: defs[0].tonnes }));
    out.push(t('rule.track', { grade: fmt.pct(MATERIALS.track.maxGrade ?? 0), t: MATERIALS.track.rating }));
    if (l.brake) out.push(`${t('rule.brake', { at: l.brake.at })} ${t(l.sliding ? 'rule.brakeSliding' : 'rule.brakeTie')}`);
  } else if (l.march) {
    const squads = defs.filter((d) => d.marches).length;
    out.push(t('rule.march', { squads: tn('rule.squads', squads), pace: tn('rule.pace', l.march.pace) }));
  } else if (l.convoy?.length) out.push(t('rule.convoy', { n: defs.length }));
  if (l.sliding) out.push(t('rule.sliding'));
  if (l.wind) out.push(l.wind.flutter ? `${t('rule.wind', { period: l.wind.period })} ${t('rule.flutter')}` : t('rule.wind', { period: l.wind.period }));
  const lead = vehicleInline(l.vehicle);
  if (l.quake) {
    const q = l.quake;
    out.push(q.sweep ? t('rule.quakeSweep', { name: lead, at: q.at, dur: q.dur, from: q.freq, to: q.sweep }) : t('rule.quake', { name: lead, at: q.at, dur: q.dur }));
  }
  if (l.mud?.length) out.push(t('rule.mud'));
  if (l.piles) out.push(t('rule.piles', { money: money(l.piles.price) }));
  if (l.flood) out.push(t('rule.flood', { name: lead, at: l.flood.at, rise: l.flood.rise }));
  if (l.masts?.length) out.push(t('rule.masts'));
  if (l.blocks) out.push(t('rule.blocks', { reach: l.blocks.reach, t: blockOf(l).mass / 1000, money: money(blockOf(l).price) }));
  if (l.materials.includes('main')) out.push(t('rule.main'));
  if (l.materials.includes('masonry')) out.push(t('rule.masonry'));
  if (l.materials.includes('arch')) out.push(t('rule.arch'));
  if (l.rocks?.length) out.push(t('rule.rocks'));
  if (l.materials.includes('tendon')) out.push(t('rule.tendon'));
  if (l.materials.includes('damper')) out.push(t('rule.damper'));
  if (l.materials.includes('concrete')) out.push(t('rule.concrete'));
  if (l.anchorCost) out.push(t('rule.toll', { money: money(l.anchorCost) }));
  for (const [mat, max] of Object.entries(l.limits ?? {})) {
    out.push(tn('rule.limit', max, { mat: matInline(mat as MaterialId) }));
  }
  // A vehicle heavier than a deck's rating crushes it: say which deck to use.
  const ids = [l.vehicle, ...(l.convoy ?? [])];
  const heaviest = ids.reduce((a, b) => (VEHICLES[b].tonnes > VEHICLES[a].tonnes ? b : a));
  const tonnes = VEHICLES[heaviest].tonnes;
  const decks = l.materials.filter((m) => MATERIALS[m].drivable);
  const weak = decks.filter((m) => MATERIALS[m].rating < tonnes);
  const strong = decks.filter((m) => MATERIALS[m].rating >= tonnes);
  if (weak.length && strong.length) {
    out.push(t('rule.weight', { name: vehicleInline(heaviest), t: tonnes, weak: matNames(weak), rating: MATERIALS[weak[0]].rating, strong: matNames(strong) }));
  }
  return out;
}

/** Material names for a sentence, e.g. "road or heavy deck". */
function matNames(ms: MaterialId[]): string {
  return fmt.list(ms.map(matInline), 'disjunction');
}

/**
 * Whether the design meets the bonus goal right now, for the HUD. Stress goals can only be
 * judged on a test drive, so they are 'unknown' until then.
 */
export function bonusStatus(l: LevelDef, d: Design): 'met' | 'missed' | 'unknown' {
  const g = l.bonus;
  // An empty blueprint meets most goals trivially; say nothing until there's a bridge.
  if (!d.members.length) return 'unknown';
  switch (g.kind) {
    case 'cost':
      return d.cost() <= g.max ? 'met' : 'missed';
    case 'parts':
      return d.parts() <= g.max ? 'met' : 'missed';
    case 'without':
      return d.members.some((m) => m.mat === g.mat) ? 'missed' : 'met';
    case 'stress':
      return 'unknown';
  }
}
