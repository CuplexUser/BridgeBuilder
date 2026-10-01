import { money } from './editor';
import type { LevelDef } from './levels';
import { MATERIALS, type MaterialId } from './physics/materials';
import { VEHICLES } from './physics/vehicles';
import { bonusLabel, SAFE_STRESS } from './scoring';
import type { Design } from './design';

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
  const defs = [l.vehicle, ...(l.convoy ?? [])].map((v) => VEHICLES[v]);
  const groups: { name: string; n: number }[] = [];
  for (const d of defs) {
    const last = groups.at(-1);
    if (last?.name === d.name) last.n++;
    else groups.push({ name: d.name, n: 1 });
  }
  const names = groups.map((g, i) => `${i ? g.name.toLowerCase() : g.name}${g.n > 1 ? ` ×${g.n}` : ''}`).join(' + ');
  return `${names} · ${Math.max(...defs.map((d) => d.tonnes))} t${l.ship ? ' · drawbridge' : ''}`;
}

export function levelBrief(l: LevelDef): Brief {
  const vehicles = [l.vehicle, ...(l.convoy ?? [])];
  const who = vehicles.length > 2 ? `all ${vehicles.length} vehicles` : vehicles.length === 2 ? 'both vehicles' : `the ${VEHICLES[l.vehicle].name.toLowerCase()}`;
  const goals: BriefGoal[] = [
    { mark: '★', text: `Get ${who} to the flag`, note: `${l.width} m across, on a budget of ${money(l.money)}.` },
    { mark: '★', text: `Build for ${money(l.target)} or less`, note: 'The tick on the budget meter.' },
    { mark: '★', text: `Peak stress below ${Math.round(SAFE_STRESS * 100)}%`, note: 'Measured on the test drive: no member or joint may work harder than that.' },
    { mark: '✦', text: bonusLabel(l.bonus), note: bonusNote(l) },
  ];
  return { traffic: `${traffic(l)} · ${l.width} m`, tip: l.tip, goals, rules: rules(l) };
}

/** What the bonus goal means in practice. */
function bonusNote(l: LevelDef): string {
  const g = l.bonus;
  switch (g.kind) {
    case 'cost':
      return 'Tighter than the star target. The budget meter shows what you have spent.';
    case 'stress':
      return 'Checked on the test drive. Stiffer, better-braced bridges stay calmer.';
    case 'parts':
      return 'The count shows next to the goal while you build. A beam split by a joint still counts once.';
    case 'without':
      return `Cross without a single ${MATERIALS[g.mat].name.toLowerCase()} part.`;
  }
}

function rules(l: LevelDef): string[] {
  const out: string[] = [];
  const defs = [l.vehicle, ...(l.convoy ?? [])].map((v) => VEHICLES[v]);
  if (l.ship) {
    out.push(`A tall ship with a ${l.ship.mast} m mast sails through first. Hinge the road and lift it on hydraulic rams: the bridge opens, the ship passes, it closes, then traffic goes.`);
  } else if (l.channels?.length) {
    const top = Math.max(...l.channels.map((c) => c[2]));
    out.push(`Keep the ship channel clear: nothing may be built in it, up to ${top >= 0 ? '+' : ''}${top} m.`);
  }
  if (l.convoy?.length) out.push(`A convoy: ${defs.length} vehicles cross nose to tail, so the bridge carries them all at once.`);
  if (l.anchorCost) out.push(`Toll bolts: building from any bolt off the road costs ${money(l.anchorCost)}, once per bolt.`);
  for (const [mat, max] of Object.entries(l.limits ?? {})) {
    out.push(`At most ${max} ${MATERIALS[mat as MaterialId].name.toLowerCase()} part${max === 1 ? '' : 's'}.`);
  }
  // A vehicle heavier than a deck's rating crushes it: say which deck to use.
  const heaviest = defs.reduce((a, b) => (b.tonnes > a.tonnes ? b : a));
  const decks = l.materials.filter((m) => MATERIALS[m].drivable);
  const weak = decks.filter((m) => MATERIALS[m].rating < heaviest.tonnes);
  const strong = decks.filter((m) => MATERIALS[m].rating >= heaviest.tonnes);
  if (weak.length && strong.length) {
    out.push(`The ${heaviest.name.toLowerCase()} weighs ${heaviest.tonnes} t: ${matNames(weak)} carries only ${MATERIALS[weak[0]].rating} t. Drive it on ${matNames(strong)}.`);
  }
  return out;
}

/** Material names for a sentence, e.g. "road or heavy deck". */
function matNames(ms: MaterialId[]): string {
  return ms.map((m) => MATERIALS[m].name.toLowerCase()).join(' or ');
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
