import { money } from './editor';
import { seatPiers, type LevelDef } from './levels';
import { blockOf, MATERIALS, type MaterialId } from './physics/materials';
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
  if (seatPiers(l).length) out.push('A pier with no bolt is a seat: a deck laid on or across it rests there. It carries the deck but holds nothing down, so a leaf can lift off it.');
  if (defs[0].rail) {
    out.push(`A train: a ${defs[0].tonnes} t locomotive${defs.length > 1 ? ` and ${defs.length - 1} wagon${defs.length > 2 ? 's' : ''} of ${defs[1].tonnes} t, coupled` : ''}, all of it on the bridge at once. It runs on track only.`);
    out.push(`Track: lay it in runs like road, no steeper than ${Math.round((MATERIALS.track.maxGrade ?? 0) * 100)}%, since a train can't climb more. It carries ${MATERIALS.track.rating} t a vehicle.`);
    if (l.brake) out.push(`The train brakes to a stop on the bridge at ${l.brake.at} m, waits, and goes on: braking, its wheels shove the deck forward. Tie the deck back to the banks.`);
  } else if (l.march) {
    const squads = defs.filter((d) => d.marches).length;
    out.push(`${squads} squad${squads === 1 ? '' : 's'} of soldiers march across in step, ${l.march.pace} pace${l.march.pace === 1 ? '' : 's'} a second: every boot lands at once, and a bridge that swings at that pace swings harder with every step.`);
  } else if (l.convoy?.length) out.push(`A convoy: ${defs.length} vehicles cross nose to tail, so the bridge carries them all at once.`);
  if (l.wind) out.push(`A gale: gusts every ${l.wind.period} s push on everything tall and lift the deck. Hangers only pull, so a light deck lifts and slams back down.`);
  if (l.quake) out.push(`An earthquake strikes once the ${defs[0].name.toLowerCase()} reaches ${l.quake.at} m: the ground shakes side to side for ${l.quake.dur} s. Tall, heavy towers swing hardest.`);
  if (l.mud?.length) out.push('Mud banks: a bolt on mud sinks once it carries more than the mud holds, and the deck sinks with it.');
  if (l.piles) out.push(`Piles: drag a member onto a mud bank to drive a pile there for ${money(l.piles.price)}. It reaches rock, so it never sinks.`);
  if (l.flood) out.push(`A flood: once the ${defs[0].name.toLowerCase()} reaches ${l.flood.at} m the river rises ${l.flood.rise} m, pushing on everything in it and washing bolts out of the mud. Piles stay.`);
  if (l.masts?.length) out.push('The masts stand on hinges: they carry a load straight down but tip over if pulled sideways. Balance every cable on a mast top with a backstay pulling the other way.');
  if (l.blocks) {
    out.push(`Concrete anchors: drag a member onto the bank, up to ${l.blocks.reach} m back, to set a ${blockOf(l).mass / 1000} t block there for ${money(blockOf(l).price)}. Backstays need them: the bolts hold no cables here. A steep pull lifts a block out and a flat one slides it; past either it tears loose.`);
  }
  if (l.materials.includes('main')) {
    out.push('Main cable: drag it from peak to peak, or down to an anchor, and it hangs in a curve with a joint above each deck joint. Drag the ring on it up or down to set the sag: deeper pulls less on the anchors. It counts as one part.');
  }
  if (l.materials.includes('masonry')) {
    out.push('Concrete blocks: drag across the grid to paint them a square meter at a time, and drag from a block to erase. They are almost impossible to crush but crack apart when pulled, so stack them where they are pushed: on rock, against the canyon walls, under an arch.');
  }
  if (l.materials.includes('arch')) {
    out.push('Block arch: drag it from one springing to the other and it rises in a ring of wedge blocks, a joint under each deck joint. Drag the ring at its crown to set the rise: lower pushes harder on the ends. Its ends push outward, so they need rock or blocks behind them, or they slide.');
  }
  if (l.rocks?.length) out.push('Rock shelves and islands rise from the riverbed: blocks stand on them and push against them, but nothing is bolted there.');
  if (l.materials.includes('damper')) out.push('Damper: a soft spring that carries little, but pushes back hard on anything moving it quickly. It lets a slow load settle and fights a swing.');
  if (l.materials.includes('concrete')) out.push('Concrete crushes only under five times what steel takes, but it is heavy and cracks under a modest pull: stand it upright and brace it.');
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
