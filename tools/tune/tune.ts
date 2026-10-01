/**
 * Level tuner: `npm run tune -- [options]`
 *
 *   --levels 7,30        tune only these level ids (default: all)
 *   --effort <preset>    quick | normal | thorough | max (default: normal)
 *   --time <minutes>     pick the most thorough preset expected to finish in time
 *   --estimate           print the time each preset is expected to take, then stop
 *   --fresh              re-tune levels even when their inputs haven't changed
 *
 * Levels whose last result failed a check are always tuned again. The tuner page
 * (`npm run tuner`) picks these options visually and runs this script for you.
 *
 * For each level it searches for the cheapest robust design (genetic search over the
 * level's structure grammar, then local polishing, plus the hand-made reference as a
 * seed), tries the level's tunable geometry until its intent holds, derives budget,
 * target and bonus goal from the difficulty settings, and saves it all to src/levels.res,
 * with readable copies under tools/tune/results. Finished levels are saved right away, so
 * an interrupted run picks up where it stopped.
 */
import { chapterOf, levelCode } from '../../src/chapters';
import { Design } from '../../src/design';
import { applyTuning, BASE_LEVELS, type BonusGoal, type LevelBase, type LevelDef, type Tuned } from '../../src/levels';
import { MATERIALS, type MaterialId } from '../../src/physics/materials';
import { bonusMet, SAFE_STRESS } from '../../src/scoring';
import { deriveNumbers, PEAK_CAP } from './difficulty';
import { DEFAULT_EFFORT, EFFORTS, type Effort } from './efforts';
import { bonusText, pct, usd, writeReadable } from './exports';
import { levelFingerprint } from './fingerprint';
import { grammarFor } from './genome';
import { handSeed, INTENTS, paramCombos, type Intent, type Params, type Shape } from './intents';
import { readResource, writeResource } from './levelres.mjs';
import { Pool } from './pool';
import { Progress, clock } from './progress';
import { calmest, cheapest, DOWNGRADE, evolve, fewest, polish, room, UPGRADE, type Found, type Objective } from './search';
import type { LevelResult, Summary } from './types';

// ───────────────────────────── CLI ─────────────────────────────

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const wanted = arg('levels')?.split(',').map(Number);
const levels = BASE_LEVELS.filter((l) => !wanted || wanted.includes(l.id));
const resource = readResource();
const state = resource.results;
const difficulty = resource.difficulty;
/** Run from the tuner page: status goes to it as messages, and it can ask the run to stop. */
const ipc = typeof process.send === 'function';
// The message channel mustn't keep the tuner alive once its work is done.
process.channel?.unref();
// A level is done when its last result worked and its inputs haven't changed since.
const todo = levels.filter((l) => flag('fresh') || !state[l.id]?.ok || state[l.id].fingerprint !== levelFingerprint(l.id));

const pool = new Pool();
const progress = new Progress();

let effortName = arg('effort') ?? DEFAULT_EFFORT;
if (!EFFORTS[effortName]) throw new Error(`Unknown effort "${effortName}". Use ${Object.keys(EFFORTS).join(', ')}.`);

if (flag('estimate') || arg('time')) {
  const rate = await calibrate();
  const est = (name: string) => todo.reduce((s, l) => s + plannedUnits(l, EFFORTS[name]), 0) / rate;
  console.log(`${todo.length} level(s) to tune, ${pool.size} workers, about ${rate.toFixed(0)} simulations/s.`);
  if (ipc) process.send!({ type: 'estimate', estimate: { levels: todo.length, rate, efforts: Object.fromEntries(Object.keys(EFFORTS).map((n) => [n, est(n)])) } });
  // Searches stop early and repeat designs come from the cache, so planned work is an upper bound.
  for (const name of Object.keys(EFFORTS)) console.log(`  ${name.padEnd(9)} up to ${clock(est(name))}, likely about ${clock(est(name) * 0.4)}`);
  if (flag('estimate')) {
    await pool.close();
    process.exit(0);
  }
  const budget = Number(arg('time')) * 60;
  const fits = Object.keys(EFFORTS).filter((n) => est(n) * 0.4 <= budget);
  effortName = fits.at(-1) ?? 'quick';
  console.log(`Using "${effortName}" to fit ${arg('time')} minutes.`);
}
const effort = EFFORTS[effortName];
pool.onResult = () => progress.tick();

function interrupt(): void {
  progress.log('Interrupted: finished levels are saved; run again to continue.');
  writeOutputs();
  process.exit(130);
}
process.on('SIGINT', interrupt);
process.on('message', (m) => {
  if (m === 'stop') interrupt();
});

if (!todo.length) console.log('Every selected level is already tuned for its current inputs. Use --fresh to tune again.');
for (const l of todo) progress.plan(plannedUnits(l, effort));
const t0 = Date.now();
for (const [i, base] of todo.entries()) {
  progress.log(`Level ${base.id} (${levelCode(base.id)}) "${base.name}", ${i + 1} of ${todo.length}, effort ${effortName}`);
  const started = Date.now();
  try {
    const r = await tuneLevel(base, INTENTS[base.id] ?? {});
    r.seconds = Math.round((Date.now() - started) / 1000);
    state[base.id] = r;
    progress.log(`  ${r.ok ? 'OK' : 'CHECK'}: reference ${usd(r.reference.cost)} at ${pct(r.reference.peak)} (${r.reference.from}); target ${usd(r.target)}, budget ${usd(r.money)}, bonus ${bonusText(r.bonus)}${[...r.notes, ...(r.warnings ?? [])].map((n) => `; ${n}`).join('')}`);
  } catch (e) {
    progress.log(`  FAILED: ${(e as Error).stack ?? e}`);
  }
  writeOutputs();
  pool.clearCache();
}
progress.close();
console.log(`Done in ${clock((Date.now() - t0) / 1000)}: ${pool.runs} simulations, ${pool.hits} cache hits, ${pool.crashes} crashed or hung runs.`);
await pool.close();

// ───────────────────────────── Tuning ─────────────────────────────

/** Simulations a level is expected to need at an effort level, for progress and estimates. */
function plannedUnits(base: LevelBase, e: Effort): number {
  const intent = INTENTS[base.id] ?? {};
  const ga = e.population * (e.generations + 1);
  const side = ga * e.side;
  const genes = 30;
  return ga * e.restarts + 2 * 150 * 8 + (intent.requires?.length ?? 0) * side + 2 * side + (intent.minRoom ? genes * 3 : 0);
}

/** Measures how many simulations per second this machine manages, on every level's hand-made design. */
async function calibrate(): Promise<number> {
  const runs = BASE_LEVELS.flatMap((b) => {
    const level = applyTuning(b, resource.levels[b.id]);
    const seed = handSeed(level);
    return seed ? [{ level, seed }] : [];
  });
  // Warm up: starting a worker compiles the game code, which shouldn't count.
  await Promise.all(runs.slice(0, pool.size).map((r) => pool.run(r.level, r.seed, 1)));
  const t = Date.now();
  // Two run lengths so the cache can't answer the second round.
  await Promise.all(runs.flatMap((r) => [pool.run(r.level, r.seed, 30), pool.run(r.level, r.seed, 29)]));
  return (runs.length * 2) / Math.max(0.1, (Date.now() - t) / 1000);
}

function summary(o: { cost: number; peak: number; parts: number; crossed: boolean; reason: string; valid: boolean; broken: boolean }): Summary {
  return { cost: o.cost, peak: Math.round(o.peak * 1000) / 1000, parts: o.parts, crossed: o.crossed, reason: o.reason, valid: o.valid, broken: o.broken };
}

async function tuneLevel(base: LevelBase, intent: Intent): Promise<LevelResult> {
  const current = resource.levels[base.id];
  const ch = chapterOf(base.id).id - 1;
  const combos = paramCombos(intent);
  let fallback: LevelResult | null = null;
  // A geometry that works but whose bonus nothing proved is kept unless a later one does better.
  let usable: LevelResult | null = null;
  for (const [ci, params] of combos.entries()) {
    if (ci > 0) progress.plan(plannedUnits(base, effort));
    const geometry = intent.shape?.(params) ?? {};
    const r = await tryGeometry(base, intent, current, ch, params, geometry);
    r.combosTried = ci + 1;
    if (r.ok && !r.warnings?.length) return r;
    if (r.ok) {
      usable ??= r;
      if (Object.keys(params).length) progress.log(`  geometry ${JSON.stringify(params)} works, but ${r.warnings!.join('; ')}; trying the rest`);
      continue;
    }
    if (!fallback || r.notes.length < fallback.notes.length) fallback = r;
    if (Object.keys(params).length) progress.log(`  geometry ${JSON.stringify(params)} rejected: ${r.notes.join('; ')}`);
  }
  if (usable) usable.combosTried = combos.length;
  return usable ?? fallback!;
}

async function tryGeometry(base: LevelBase, intent: Intent, current: Tuned, ch: number, params: Params, geometry: Shape): Promise<LevelResult> {
  const notes: string[] = [];
  // Search with a generous budget; the real one is derived from what the search finds.
  const searchMoney = Math.max(current.money * 2, 20000);
  const level = applyTuning(base, { ...current, money: searchMoney, geometry: { ...current.geometry, ...geometry } });
  const grammar = grammarFor(level, { deck: intent.deck?.(level) });
  const refObj = cheapest(searchMoney, PEAK_CAP);
  const tag = `level ${base.id}`;

  // Reference: several genetic searches, each polished, plus the polished hand-made design.
  const top: { found: Found | null; from: string } = { found: null, from: '' };
  let bestGenes: number[] | undefined;
  const consider = (f: Found, from: string) => {
    if (refObj.ok(f.outcome) && (!top.found || f.score < top.found.score)) {
      top.found = f;
      top.from = from;
    }
  };
  for (let r = 0; r < effort.restarts; r++) {
    progress.stage(`${tag} · reference search ${r + 1}/${effort.restarts}`, effort.population * (effort.generations + 1));
    const found = await evolve(pool, level, grammar, refObj, {
      population: effort.population,
      generations: effort.generations,
      patience: effort.patience,
      seed: 1000 * base.id + r,
      seeds: bestGenes ? [bestGenes] : [],
      log: (m) => progress.note(m.trim()),
    });
    if (refObj.ok(found.outcome) && (!bestGenes || found.score < (top.found?.score ?? Infinity))) bestGenes = found.genes;
    progress.stage(`${tag} · polishing search ${r + 1}`, 150 * 4);
    consider(await polish(pool, level, found, refObj, { rounds: effort.polishRounds, log: (m) => progress.note(m.trim()) }), `search ${r + 1}`);
  }
  const seedDesign = handSeed(level);
  let seed: Summary | null = null;
  if (seedDesign) {
    progress.stage(`${tag} · polishing the hand-made design`, 150 * 4);
    const o = await pool.run(level, seedDesign);
    seed = summary(o);
    if (o.valid) consider(await polish(pool, level, { design: seedDesign, outcome: o, score: refObj.score(o) }, refObj, { rounds: effort.polishRounds }), 'hand-made design, polished');
  }
  const ref = top.found;
  if (!ref) {
    return { ...emptyResult(base, params, geometry, current), notes: ['no design crosses with a safe margin'], seed };
  }

  // Numbers.
  const { money, target } = deriveNumbers(difficulty, ch, base.id, ref.outcome.cost, seed);
  const tuned = applyTuning(base, { money, target, bonus: current.bonus, geometry: { ...current.geometry, ...geometry } });

  // The level's idea must be needed: without each required material, nothing affordable crosses.
  const requires: LevelResult['requires'] = [];
  for (const mat of intent.requires ?? []) {
    const without: LevelDef = { ...tuned, materials: tuned.materials.filter((m) => m !== mat) };
    const obj = cheapest(money, 1);
    progress.stage(`${tag} · checking it needs ${mat}`, Math.round(effort.population * (effort.generations + 1) * effort.side));
    const f = await evolve(pool, without, grammarFor(without, { deck: intent.deck?.(without) }), obj, sideOptions(base.id, 7));
    const ok = !obj.ok(f.outcome);
    requires.push({ mat, best: summary(f.outcome), ok });
    if (!ok) notes.push(`crosses without ${mat} for ${usd(f.outcome.cost)}`);
  }
  const shortcuts: LevelResult['shortcuts'] = [];
  for (const s of intent.shortcuts ?? []) {
    let d: Design;
    try {
      d = s.build(tuned);
    } catch {
      continue;
    }
    const o = await pool.run(tuned, d);
    const ok = !o.crossed || o.cost > money || !o.valid;
    shortcuts.push({ name: s.name, result: summary(o), ok });
    if (!ok) notes.push(`shortcut "${s.name}" crosses for ${usd(o.cost)}`);
  }
  let roomResult: LevelResult['room'] = null;
  if (intent.minRoom && bestGenes) {
    progress.stage(`${tag} · measuring room`, 100);
    roomResult = await room(pool, tuned, grammar, bestGenes, cheapest(money, 1));
    if (roomResult.pass / roomResult.total < intent.minRoom) notes.push(`room ${roomResult.pass}/${roomResult.total} below ${pct(intent.minRoom)}`);
  }

  // Only a level that passes its checks is worth the bonus searches.
  const warnings: string[] = [];
  const bonus = notes.length ? { goal: null, proof: null } : await chooseBonus(base, intent, current, tuned, ref, money, seedDesign);
  if (!notes.length && !bonus.goal) warnings.push(`no design meets a bonus goal (kept ${bonusText(current.bonus)} unproven)`);
  return {
    id: base.id,
    fingerprint: levelFingerprint(base.id),
    effort: effortName,
    ok: notes.length === 0,
    notes,
    warnings,
    params,
    geometry,
    money,
    target,
    bonus: bonus.goal ?? current.bonus,
    checkedMoney: money,
    bonusSearched: notes.length === 0,
    reference: { ...summary(ref.outcome), design: ref.design.serialize(), from: top.from },
    bonusDesign: bonus.proof ? { ...summary(bonus.proof.outcome), design: bonus.proof.design.serialize() } : null,
    seed,
    room: roomResult,
    requires,
    shortcuts,
    combosTried: 0,
    seconds: 0,
  };
}

function sideOptions(id: number, salt: number) {
  return {
    population: Math.max(16, Math.round(effort.population * 0.75)),
    generations: Math.max(10, Math.round(effort.generations * effort.side)),
    patience: effort.patience,
    seed: 1000 * id + 100 + salt,
    log: (m: string) => progress.note(m.trim()),
  };
}

/**
 * Picks the bonus goal: the level's preferred kinds in order (by default its current kind
 * first), keeping the first one a design can meet within budget while the reference doesn't.
 */
async function chooseBonus(base: LevelBase, intent: Intent, current: Tuned, level: LevelDef, ref: Found, budget: number, seed: Design | null): Promise<{ goal: BonusGoal | null; proof: Found | null }> {
  const order = intent.bonus ?? [...new Set<BonusGoal['kind']>([current.bonus.kind, 'stress', 'without', 'parts'])];
  const grammar = grammarFor(level, { deck: intent.deck?.(level) });
  const tag = `level ${base.id}`;
  const units = Math.round(effort.population * (effort.generations + 1) * effort.side);
  const fromRef = (obj: Objective): Found => ({ design: ref.design, outcome: ref.outcome, score: obj.score(ref.outcome) });
  /** The reference with every `mat` member swapped for an offered neighbor that reaches, or null if one can't. */
  const recastRef = (without: LevelDef, mat: MaterialId): Design | null => {
    const d = Design.deserialize(ref.design.serialize());
    for (const [i, m] of d.members.entries()) {
      if (m.mat !== mat) continue;
      const to = [UPGRADE[mat], DOWNGRADE[mat]].find((t) => t && without.materials.includes(t) && d.length(i) <= MATERIALS[t].maxLen + 1e-9);
      if (!to) return null;
      m.mat = to;
    }
    return d;
  };
  for (const kind of order) {
    if (kind === 'stress') {
      progress.stage(`${tag} · bonus: lowest stress`, units);
      const obj = calmest(budget);
      let f = await evolve(pool, level, grammar, obj, sideOptions(base.id, 1));
      if (obj.ok(f.outcome)) f = await polish(pool, level, f, obj, { rounds: effort.polishRounds, upgrades: true });
      // Upgrading the reference member by member often calms it more than any grammar design.
      f = better(obj, f, await polish(pool, level, fromRef(obj), obj, { rounds: effort.polishRounds, upgrades: true }));
      if (!obj.ok(f.outcome)) continue;
      const max = Math.ceil((f.outcome.peak + 0.02) * 20) / 20;
      if (max < SAFE_STRESS && max <= ref.outcome.peak - 0.1) return { goal: { kind: 'stress', max }, proof: f };
    } else if (kind === 'without') {
      const used = [...new Set(ref.design.members.map((m) => m.mat))];
      const deckMats = level.materials.filter((m) => MATERIALS[m].drivable);
      const candidates = used.filter((m) => !(intent.requires ?? []).includes(m) && !(MATERIALS[m].drivable && deckMats.length < 2));
      // Keep the current material first, so a player's goal doesn't change needlessly.
      const keep = current.bonus.kind === 'without' ? current.bonus.mat : null;
      candidates.sort((a, b) => Number(b === keep) - Number(a === keep));
      for (const mat of candidates) {
        progress.stage(`${tag} · bonus: no ${mat}`, units);
        const without: LevelDef = { ...level, materials: level.materials.filter((m) => m !== mat) };
        const obj = cheapest(budget, 0.98);
        let f = await evolve(pool, without, grammarFor(without, { deck: intent.deck?.(without) }), obj, sideOptions(base.id, 2));
        if (obj.ok(f.outcome)) f = await polish(pool, without, f, obj, { rounds: effort.polishRounds });
        // The reference with the banned material swapped for its nearest offered neighbor, then repaired.
        const recast = recastRef(without, mat);
        if (recast) {
          const o = await pool.run(without, recast);
          f = better(obj, f, await polish(pool, without, { design: recast, outcome: o, score: obj.score(o) }, obj, { rounds: effort.polishRounds, upgrades: true }));
        }
        if (!obj.ok(f.outcome)) continue;
        return { goal: { kind: 'without', mat }, proof: f };
      }
    } else if (kind === 'parts') {
      progress.stage(`${tag} · bonus: fewest parts`, units);
      const obj = fewest(budget, 0.98);
      let f = await evolve(pool, level, grammar, obj, sideOptions(base.id, 3));
      if (obj.ok(f.outcome)) f = await polish(pool, level, f, obj, { rounds: effort.polishRounds });
      f = better(obj, f, await polish(pool, level, fromRef(obj), obj, { rounds: effort.polishRounds }));
      if (!obj.ok(f.outcome)) continue;
      if (f.outcome.parts <= ref.outcome.parts - 3) return { goal: { kind: 'parts', max: f.outcome.parts }, proof: f };
    }
  }
  // Nothing new: keep the current goal if the reference or the hand-made design meets it.
  for (const d of [ref.design, seed]) {
    if (!d) continue;
    const o = await pool.run(level, d);
    if (o.valid && o.crossed && !o.broken && o.cost <= budget && bonusMet(current.bonus, d, o.peak)) return { goal: current.bonus, proof: { design: d, outcome: o, score: 0 } };
  }
  // Last resort: match the best design's cost, a notch under the star target.
  const max = ceilTo(ref.outcome.cost * 1.02, 50);
  if (max < level.target) return { goal: { kind: 'cost', max }, proof: ref };
  return { goal: null, proof: null };
}

/** Whichever of two finds scores lower under the objective. */
function better(obj: Objective, a: Found, b: Found): Found {
  return obj.score(b.outcome) < obj.score(a.outcome) ? b : a;
}

function emptyResult(base: LevelBase, params: Params, geometry: Shape, current: Tuned): LevelResult {
  const none: Summary = { cost: 0, peak: 1, parts: 0, crossed: false, reason: '' };
  return {
    id: base.id,
    fingerprint: levelFingerprint(base.id),
    effort: effortName,
    ok: false,
    notes: [],
    params,
    geometry,
    money: current.money,
    target: current.target,
    bonus: current.bonus,
    reference: { ...none, design: '', from: '' },
    bonusDesign: null,
    seed: null,
    room: null,
    requires: [],
    shortcuts: [],
    combosTried: 0,
    seconds: 0,
  };
}

// ───────────────────────────── Output ─────────────────────────────

/** Saves the results so far into src/levels.res and refreshes the readable copies. */
function writeOutputs(): void {
  // Only results with a working reference replace the level's numbers.
  for (const base of BASE_LEVELS) {
    const r = state[base.id];
    if (!r?.reference.design) continue;
    resource.levels[base.id] = {
      money: r.money,
      target: r.target,
      bonus: r.bonus,
      ...(Object.keys(r.geometry).length ? { geometry: r.geometry } : {}),
      fingerprint: r.fingerprint,
    };
  }
  writeResource(resource);
  writeReadable(resource);
  if (ipc) process.send!({ type: 'saved' });
}

function ceilTo(v: number, step: number): number {
  return Math.ceil(v / step) * step;
}
