/**
 * Level verifier: `npm run verify -- [options]`
 *
 *   --levels 7,30        verify only these level ids (default: all)
 *   --probes <n>         random designs per probe, on top of the stock ones (default: 24)
 *   --workers <n>        test drives at once (default: one per core but one)
 *
 * The tuner searches for each level's best design; this only checks a level's quality, in
 * minutes instead of hours. It never optimizes. It drives a fixed set of probe designs (the
 * tuner's structured starting designs, the stock answers a player tries first, plus random
 * ones from the same grammar) and the tuned designs, and reports for each level:
 *
 *   - that its tuning is current and the reference still crosses on target;
 *   - that no probe crosses within budget without what the level teaches (its required
 *     materials, or piles on mud), the check that catches a lesson the tuner's search missed;
 *   - whether a probe undercuts the reference, so the targets are too lenient;
 *   - whether each hazard (wind, quake, march, flood, brake stop) bites: how far it raises
 *     the reference's peak, and how many probes that hold in calm it breaks;
 *   - that the bonus goal asks for something the reference doesn't already do, and a ghost
 *     that solves its level does;
 *   - basic level data: tip length, mud, piles, test drive length;
 *
 * and for each chapter, whether its levels' tuned part counts fit the range its card shows.
 * Failing probe designs are saved under tools/verify/out for loading in the game. Exits with
 * 1 when any level fails.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHAPTERS, levelCode } from '../../src/chapters';
import { Design, type GridPt } from '../../src/design';
import { LEVELS, type LevelDef } from '../../src/levels';
import { testSeconds } from '../../src/physics/world';
import { blockSpot, pileSpots } from '../../src/rules';
import { layMain } from '../../src/maincable';
import { addBlock, layRing, ringPath, ringRise } from '../../src/masonry';
import { bonusMet } from '../../src/scoring';
import { MATERIALS } from '../../src/physics/materials';
import { PEAK_CAP } from '../tune/difficulty';
import { levelFingerprint } from '../tune/fingerprint';
import { grammarFor } from '../tune/genome';
import { INTENTS, type Requirement } from '../tune/intents';
import { readResource } from '../tune/levelres.mjs';
import { Pool } from '../tune/pool';
import { clock } from '../tune/progress';
import { rng, structuredStarts } from '../tune/search';
import type { Outcome } from '../tune/simulate';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const OUT = fileURLToPath(new URL('./out', import.meta.url));
/** Hazards a level can switch off, to see what each one adds. */
const HAZARDS = ['wind', 'quake', 'march', 'flood', 'brake'] as const;
type Hazard = (typeof HAZARDS)[number];
const HAZARD_NAMES: Record<Hazard, string> = { wind: 'wind', quake: 'quake', march: 'march', flood: 'flood', brake: 'brake stop' };
/** A hazard that raises the reference's peak by less than this, and breaks no probe that holds in calm, hardly matters. */
const BITE = 0.05;
/** A probe this much cheaper than the reference means the tuner missed a better design. */
const UNDERCUT = 0.97;
/** The editor's longest tip. */
const MAX_TIP = 200;
/** Longest test drive that still feels like a test, s. */
const LONG_DRIVE = 90;

interface Report {
  id: number;
  fails: string[];
  warns: string[];
  info: string[];
}

interface Probe {
  design: Design;
  label: string;
}

/** Probes paired with how each one's test drive went. */
function driven(ps: Probe[], os: Outcome[]): (Probe & { o: Outcome })[] {
  return ps.map((p, i) => ({ design: p.design, label: p.label, o: os[i] }));
}

const wanted = arg('levels')?.split(',').map(Number);
const probeCount = Number(arg('probes') ?? 24);
const levels = LEVELS.filter((l) => !wanted || wanted.includes(l.id));
const resource = readResource();
const pool = new Pool(arg('workers') ? Number(arg('workers')) : undefined);
const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
/** Crosses within budget, buildable, and nothing broke on the way. */
const passes = (l: LevelDef, o: Outcome) => o.valid && o.crossed && !o.broken && o.cost <= l.money;

rmSync(OUT, { recursive: true, force: true });
const t0 = Date.now();
console.log(`Verifying ${levels.length} level(s) on ${pool.size} workers, ${probeCount} random probes each on top of the stock ones.`);
const reports = await Promise.all(
  levels.map(async (l) => {
    const r = await verifyLevel(l).catch((e: Error): Report => ({ id: l.id, fails: [`crashed: ${e.stack ?? e}`], warns: [], info: [] }));
    print(l, r);
    return r;
  }),
);
const chapterNotes = checkChapters();
for (const n of chapterNotes) console.log(`WARN  ${n}`);
const failed = reports.filter((r) => r.fails.length).length;
const warned = reports.filter((r) => !r.fails.length && r.warns.length).length;
console.log(`\n${reports.length - failed - warned} ok, ${warned} with warnings, ${failed} failing, ${chapterNotes.length} chapter warning(s), in ${clock((Date.now() - t0) / 1000)} (${pool.runs} test drives).`);
await pool.close();
process.exit(failed ? 1 : 0);

async function verifyLevel(level: LevelDef): Promise<Report> {
  const rep: Report = { id: level.id, fails: [], warns: [], info: [] };
  const intent = INTENTS[level.id] ?? {};
  checkData(level, rep);

  // The tuning, and the reference it rests on.
  const tuned = resource.results[level.id];
  if (!tuned) {
    rep.fails.push('never tuned: run `npm run tune`');
    return rep;
  }
  if (tuned.fingerprint !== levelFingerprint(level.id)) rep.fails.push('tuned for older inputs: run `npm run tune`');
  if (!tuned.ok) rep.fails.push(...tuned.notes.map((n) => `tuning: ${n}`));
  rep.warns.push(...(tuned.warnings ?? []).map((n) => `tuning: ${n}`));
  // Checks that compare against the reference skip it when it no longer crosses; the probes still run.
  let ref = tuned.reference.design ? Design.deserialize(tuned.reference.design) : null;
  const refRun = ref ? await pool.run(level, ref) : null;
  if (!ref || !refRun || !passes(level, refRun) || refRun.peak >= 1) {
    rep.fails.push(`the reference no longer crosses${refRun?.reason ? ` (${refRun.reason})` : ''}`);
    ref = null;
  } else {
    if (ref.cost() > level.target) rep.fails.push(`the reference (${usd(ref.cost())}) costs more than the star target (${usd(level.target)})`);
    rep.info.push(`reference ${usd(ref.cost())} at ${pct(refRun.peak)}, ${ref.parts()} parts; target ${usd(level.target)} (${pct(level.target / ref.cost() - 1)} over), budget ${usd(level.money)}`);
    if (level.bonus.kind !== 'cost' && bonusMet(level.bonus, ref, refRun.peak)) rep.warns.push('the bonus goal is free: the reference already meets it');
  }

  // A ghost that is a whole bridge has to cross.
  if (level.hint && level.hintSolves) {
    try {
      const o = await pool.run(level, ghostDesign(level));
      if (!passes(level, o)) rep.fails.push(`the ghost doesn't solve the level (${o.reason || 'something broke'})`);
    } catch (e) {
      rep.fails.push((e as Error).message);
    }
  }

  // Probes on the level itself: a stock design that undercuts the reference.
  const probes = probeDesigns(level, intent.deck?.(level));
  const runs = await Promise.all(probes.map((p) => pool.run(level, p.design)));
  const crossing = driven(probes, runs).filter((p) => passes(level, p.o));
  // A reference needs a safety margin, so only probes that keep it can undercut one.
  const cheapest = crossing.filter((p) => p.o.peak <= PEAK_CAP).toSorted((a, b) => a.o.cost - b.o.cost)[0];
  rep.info.push(`probes: ${crossing.length} of ${probes.length} cross${cheapest ? `, cheapest with a safe margin ${usd(cheapest.o.cost)} (${cheapest.label})` : ''}`);
  if (ref && cheapest && cheapest.o.cost < ref.cost() * UNDERCUT) {
    rep.warns.push(`a probe undercuts the reference: ${usd(cheapest.o.cost)} against ${usd(ref.cost())} (${cheapest.label}); tune again`);
    save(level, 'undercut', cheapest.design);
  }

  // The lesson: nothing crosses within budget without it.
  const lessons = new Set<Requirement>([...(intent.requires ?? []), ...(level.piles ? (['piles'] as const) : [])]);
  for (const lesson of lessons) {
    const without: LevelDef = lesson === 'piles' ? { ...level, piles: undefined } : { ...level, materials: level.materials.filter((m) => m !== lesson) };
    const ps = probeDesigns(without, intent.deck?.(without));
    const os = await Promise.all(ps.map((p) => pool.run(without, p.design)));
    const ways = driven(ps, os).filter((p) => passes(without, p.o)).sort((a, b) => a.o.cost - b.o.cost);
    if (ways.length) {
      rep.fails.push(`crosses without ${lesson}: ${ways.length} probe(s), cheapest ${usd(ways[0].o.cost)} at ${pct(ways[0].o.peak)} (${ways[0].label})`);
      save(level, `without-${lesson}`, ways[0].design);
    }
  }

  // Each hazard should bite: raise the reference's peak, or break designs that hold without it,
  // among them the level's own shortcuts, which a hazard is often there to shut out.
  const shortcuts: Probe[] = [];
  for (const s of intent.shortcuts ?? []) {
    try {
      shortcuts.push({ design: s.build(level), label: `shortcut "${s.name}"` });
    } catch {
      // A shortcut that can't be built on this level shuts nothing out.
    }
  }
  const shortRuns = await Promise.all(shortcuts.map((p) => pool.run(level, p.design)));
  const tried = [...driven(probes, runs), ...driven(shortcuts, shortRuns)].filter((p) => p.o.valid && p.o.cost <= level.money);
  for (const h of HAZARDS) {
    if (!level[h] || !ref || !refRun) continue;
    const calm: LevelDef = { ...level, [h]: undefined };
    const calmRef = await pool.run(calm, ref);
    const calmRuns = await Promise.all(tried.map((p) => (passes(level, p.o) ? Promise.resolve(p.o) : pool.run(calm, p.design))));
    const holds = tried.filter((_, i) => passes(calm, calmRuns[i]));
    const broken = holds.filter((p) => !passes(level, p.o));
    const rise = refRun.peak - calmRef.peak;
    const name = HAZARD_NAMES[h];
    const calmText = passes(calm, calmRef) ? pct(calmRef.peak) : `a failed run (${calmRef.reason || 'something broke'})`;
    const what = `reference ${pct(refRun.peak)} against ${calmText} without it; of ${holds.length} probes and shortcuts that hold in calm, it breaks ${broken.length}${broken.length ? ` (${broken.slice(0, 2).map((p) => p.label).join(', ')})` : ''}`;
    if (rise >= BITE || broken.length) rep.info.push(`${name}: ${what}`);
    else if (holds.length) rep.warns.push(`the ${name} hardly matters: ${what}`);
    else rep.info.push(`${name}: can't tell whether it bites, since nothing tried holds even in calm (reference ${pct(refRun.peak)} against ${calmText} without it)`);
  }
  return rep;
}

/** Level data the editor and game rely on. */
function checkData(level: LevelDef, rep: Report): void {
  if (level.tip.length > MAX_TIP) rep.fails.push(`tip is ${level.tip.length} characters, over the editor's ${MAX_TIP}`);
  if (level.target > level.money) rep.fails.push(`star target ${usd(level.target)} is over the budget ${usd(level.money)}`);
  const seconds = testSeconds(level);
  if (seconds > LONG_DRIVE) rep.warns.push(`a test drive takes ${seconds} s`);
  for (const [x0, x1, top] of level.mud ?? []) {
    if (top > -1) rep.fails.push(`mud ${x0}–${x1} m comes within a meter of the road`);
    if (top <= level.waterY) rep.fails.push(`mud ${x0}–${x1} m is under water`);
  }
  if (level.piles && !level.mud?.length) rep.fails.push('offers piles but has no mud');
  if (level.piles && !pileSpots(level).length) rep.fails.push('offers piles but has nowhere to drive one');
}

/** The level's ghost as a design, built the way a player traces it with each tool. */
function ghostDesign(level: LevelDef): Design {
  const d = new Design(level);
  for (const [a, b, mat] of level.hint!) {
    const [p, r] = [a as GridPt, b as GridPt];
    if (MATERIALS[mat].cell === 'ring') {
      const path = ringPath(d, p, r, ringRise(d, p, r, level));
      if (!path) throw new Error(`the ghost's arch ${p}–${r} can't be laid`);
      layRing(d, path);
      continue;
    }
    if (MATERIALS[mat].cell === 'brush') {
      // A brush stroke paints the 1 m blocks across its corners.
      for (let x = Math.min(p[0], r[0]); x < Math.max(p[0], r[0]) - 1e-9; x++) for (let y = Math.min(p[1], r[1]); y < Math.max(p[1], r[1]) - 1e-9; y++) addBlock(d, x, y);
      continue;
    }
    // Dragging onto a bank's anchor strip or a mud spot sets a block or drives a pile there.
    for (const [x, y] of [p, r]) if (d.findNode(x, y) < 0 && blockSpot(level, x, y)) d.ensureBlock(x, y);
    if (mat === 'main') {
      layMain(d, p, r);
      continue;
    }
    const path = MATERIALS[mat].drivable ? d.runPath(p[0], p[1], r[0], r[1], MATERIALS[mat].maxLen, 50) : null;
    if (path) for (let i = 0; i < path.length - 1; i++) d.add(path[i], path[i + 1], mat);
    else d.add(p, r, mat);
  }
  return d;
}

/** The stock designs and a seeded handful of random ones from the level's grammar, each built once. */
function probeDesigns(level: LevelDef, deck?: GridPt[]): Probe[] {
  const g = grammarFor(level, { deck });
  const rand = rng(7919 * level.id + 17);
  const stock = structuredStarts(g).map((genes, i) => ({ genes, label: `stock design ${i + 1}` }));
  const random = Array.from({ length: probeCount }, (_, i) => ({ genes: g.genes.map((gene) => Math.floor(rand() * gene.options.length)), label: `random design ${i + 1}` }));
  const seen = new Set<string>();
  const out: Probe[] = [];
  for (const { genes, label } of [...stock, ...random]) {
    const key = genes.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ design: g.build(genes), label });
  }
  return out;
}

/** Each chapter's card says how many parts its levels take; the tuned references should fit. */
function checkChapters(): string[] {
  const notes: string[] = [];
  for (const c of CHAPTERS) {
    const m = /(\d+)–(\d+) parts/.exec(c.effort);
    if (!m) continue;
    const [lo, hi] = [Number(m[1]), Number(m[2])];
    const parts = c.levels.map((id) => resource.results[id]?.reference.parts ?? NaN).filter((p) => !Number.isNaN(p));
    if (!parts.length) continue;
    const [min, max] = [Math.min(...parts), Math.max(...parts)];
    if (min < lo || max > hi) notes.push(`chapter ${c.id} ${c.name} says ${lo}–${hi} parts, but its references take ${min}–${max}`);
  }
  return notes;
}

function save(level: LevelDef, what: string, d: Design): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${level.id}-${what}.json`, d.serialize());
}

function print(level: LevelDef, r: Report): void {
  const head = r.fails.length ? 'FAIL' : r.warns.length ? 'WARN' : 'ok  ';
  console.log(`${head}  ${levelCode(level.id).padEnd(5)} ${level.id} ${level.name}`);
  for (const n of r.fails) console.log(`        ✗ ${n}`);
  for (const n of r.warns) console.log(`        ! ${n}`);
  for (const n of r.info) console.log(`          ${n}`);
}
