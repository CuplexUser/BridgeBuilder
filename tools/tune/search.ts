import { Design } from '../../src/design';
import type { LevelDef } from '../../src/levels';
import { MATERIALS, type MaterialId } from '../../src/physics/materials';
import type { Grammar } from './genome';
import type { Runner } from './runner';
import type { Outcome } from './simulate';

/** What a search minimizes. Designs that fail rank behind every one that works. */
export interface Objective {
  name: string;
  score(o: Outcome): number;
  /** Whether a design meets the hard requirements (crosses, within budget and stress cap). */
  ok(o: Outcome): boolean;
}

const INVALID = 1e12;
const FAILED = 1e10;
const WEAK = 1e8;

function penalty(o: Outcome, money: number, cap: number): number | null {
  if (!o.valid) return INVALID;
  if (!o.crossed) return FAILED + (1 - o.progress) * 1e9 + o.cost;
  // A member that broke on the way counts like a design over the stress cap.
  if (o.peak > cap || o.cost > money || o.broken) return WEAK + Math.max(0, o.peak - cap) * 1e7 + Math.max(0, o.cost - money) * 100 + (o.broken ? 1e6 : 0) + o.cost;
  return null;
}

/** Cheapest design that crosses within budget with peak stress at or below `cap`. */
export function cheapest(money: number, cap: number): Objective {
  return {
    name: `cheapest (peak ≤ ${cap})`,
    score: (o) => penalty(o, money, cap) ?? o.cost,
    ok: (o) => penalty(o, money, cap) === null,
  };
}

/** Lowest peak stress within budget; cost breaks ties. */
export function calmest(money: number): Objective {
  return {
    name: 'lowest peak stress',
    score: (o) => penalty(o, money, 1) ?? o.peak * 1e6 + o.cost,
    ok: (o) => penalty(o, money, 1) === null,
  };
}

/** Fewest parts within budget and stress cap; cost breaks ties. */
export function fewest(money: number, cap: number): Objective {
  return {
    name: 'fewest parts',
    score: (o) => penalty(o, money, cap) ?? o.parts * 1e6 + o.cost,
    ok: (o) => penalty(o, money, cap) === null,
  };
}

export interface Found {
  design: Design;
  outcome: Outcome;
  score: number;
  genes?: number[];
}

/** Small, fast, seedable random numbers, so a tuning run can be reproduced. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface EvolveOptions {
  population?: number;
  generations?: number;
  /** Stop after this many generations without improvement. */
  patience?: number;
  seed?: number;
  /** Starting genomes, e.g. a previous best, placed ahead of the random ones. */
  seeds?: number[][];
  /** Stop starting new generations at this time (Date.now() milliseconds). */
  stopAt?: number;
  /** Stop as soon as the best design found is good enough. */
  enough?: (best: Found) => boolean;
  log?: (msg: string) => void;
}

/**
 * Genetic search over a level's structure grammar: tournament selection, uniform crossover,
 * per-gene mutation and elitism. Returns the best design found.
 */
export async function evolve(pool: Runner, level: LevelDef, g: Grammar, obj: Objective, opts: EvolveOptions = {}): Promise<Found> {
  const size = opts.population ?? 48;
  const gens = opts.generations ?? 40;
  const patience = opts.patience ?? 10;
  const rand = rng(opts.seed ?? 1);
  const n = g.genes.length;
  const pick = (k: number) => Math.floor(rand() * k);
  const randomGenome = () => g.genes.map((gene) => pick(gene.options.length));

  // Structured starting points: spans broken at every anchor or none, trussed one way,
  // with every support, hanger and main cable used or none.
  const starts: number[][] = [...(opts.seeds ?? [])];
  for (const broken of [1, 0]) {
    for (const kind of [1, 2, 0, 3]) {
      for (const mat of [1, 0]) {
        for (const cables of [1, 0]) {
          starts.push(
            g.genes.map((gene) => {
              const k = gene.options.length;
              if (gene.prefer !== undefined) return gene.prefer;
              if (gene.name.startsWith('break')) return broken;
              if (gene.name.endsWith(' truss')) return Math.min(kind, k - 1);
              if (/ (chord|web|vert|end|endWeb)$/.test(gene.name) || gene.name.endsWith(' material')) return Math.min(mat, k - 1);
              if (gene.name.startsWith('support')) return Math.min(2, k - 1);
              if (gene.name.startsWith('hang ')) return cables;
              if (gene.name.endsWith(' sag')) return cables ? Math.min(8, k - 1) : 0;
              if (gene.name.endsWith(' deck')) return k - 1;
              return 0;
            }),
          );
        }
      }
    }
  }
  let pop = [...starts.slice(0, size), ...Array.from({ length: Math.max(0, size - starts.length) }, randomGenome)];

  const evalAll = async (genomes: number[][]): Promise<Found[]> =>
    Promise.all(
      genomes.map(async (genes) => {
        const design = g.build(genes);
        const outcome = await pool.run(level, design);
        return { design, outcome, score: obj.score(outcome), genes };
      }),
    );

  let scored = await evalAll(pop);
  let best = scored.reduce((a, b) => (b.score < a.score ? b : a));
  let stale = 0;
  for (let gen = 0; gen < gens && stale < patience && !late(opts.stopAt) && !opts.enough?.(best); gen++) {
    scored.sort((a, b) => a.score - b.score);
    const elite = scored.slice(0, Math.max(2, Math.floor(size / 12)));
    const tournament = () => {
      let w = scored[pick(scored.length)];
      for (let k = 0; k < 2; k++) {
        const c = scored[pick(scored.length)];
        if (c.score < w.score) w = c;
      }
      return w.genes!;
    };
    const next: number[][] = elite.map((e) => e.genes!);
    while (next.length < size) {
      const a = tournament();
      const b = tournament();
      const child = a.map((v, i) => (rand() < 0.5 ? v : b[i]));
      const rate = 1.5 / n;
      let mutated = false;
      for (let i = 0; i < n; i++) {
        if (rand() < rate) {
          child[i] = pick(g.genes[i].options.length);
          mutated = true;
        }
      }
      if (!mutated) {
        const i = pick(n);
        child[i] = pick(g.genes[i].options.length);
      }
      next.push(child);
    }
    pop = next;
    scored = await evalAll(pop);
    const top = scored.reduce((a, b) => (b.score < a.score ? b : a));
    if (top.score < best.score - 1e-9) {
      best = top;
      stale = 0;
    } else stale++;
    opts.log?.(`  gen ${gen + 1}: best ${describe(best)}`);
  }
  return best;
}

function late(stopAt: number | undefined): boolean {
  return stopAt !== undefined && Date.now() >= stopAt;
}

/** Short summary of a found design for logs. */
export function describe(f: Found): string {
  const o = f.outcome;
  if (!o.valid) return `invalid (${o.reason})`;
  if (!o.crossed) return `fails (${o.reason}, ${(o.progress * 100).toFixed(0)}% of the way)`;
  return `$${o.cost} peak ${(o.peak * 100).toFixed(0)}% ${o.parts} parts`;
}

/** Joints no member uses any more are dropped, and members left dangling from a lone joint go too. */
function tidy(d: Design): Design {
  for (;;) {
    const degree = new Uint16Array(d.nodes.length);
    for (const m of d.members) {
      degree[m.a]++;
      degree[m.b]++;
    }
    const loose = d.members.findIndex((m) => (!d.nodes[m.a].anchor && degree[m.a] < 2) || (!d.nodes[m.b].anchor && degree[m.b] < 2));
    if (loose < 0) break;
    d.members.splice(loose, 1);
  }
  d.pruneNodes();
  return d;
}

export const DOWNGRADE: Partial<Record<MaterialId, MaterialId>> = { steel: 'wood', heavy: 'road' };
export const UPGRADE: Partial<Record<MaterialId, MaterialId>> = { wood: 'steel', road: 'heavy' };

/**
 * Local search on a finished design: removes members and swaps materials one at a time,
 * keeping the best improvement each round, until nothing helps. Finds the savings a
 * grammar can't express, like dropping one strut or one diagonal.
 */
export async function polish(pool: Runner, level: LevelDef, start: Found, obj: Objective, opts: { rounds?: number; upgrades?: boolean; stopAt?: number; log?: (m: string) => void } = {}): Promise<Found> {
  let best = start;
  for (let round = 0; round < (opts.rounds ?? 60) && !late(opts.stopAt); round++) {
    const moves: Design[] = [];
    const base = best.design;
    base.members.forEach((m, i) => {
      if (!MATERIALS[m.mat].drivable) {
        const d = Design.deserialize(base.serialize());
        d.members.splice(i, 1);
        moves.push(tidy(d));
      }
      // Upgrades only win when they repair a design that fails; on a working one they just add cost.
      const swaps = [DOWNGRADE[m.mat], opts.upgrades === false ? undefined : UPGRADE[m.mat]];
      for (const to of swaps) {
        if (!to || !level.materials.includes(to) || base.length(i) > MATERIALS[to].maxLen + 1e-9) continue;
        const d = Design.deserialize(base.serialize());
        d.members[i].mat = to;
        moves.push(d);
      }
    });
    const tried = await Promise.all(
      moves.map(async (design) => {
        const outcome = await pool.run(level, design);
        return { design, outcome, score: obj.score(outcome) };
      }),
    );
    const top = tried.reduce<Found | null>((a, b) => (!a || b.score < a.score ? b : a), null);
    if (!top || top.score >= best.score - 1e-9) break;
    best = top;
    opts.log?.(`  polish ${round + 1}: ${describe(best)}`);
  }
  return best;
}

/**
 * How forgiving a design is: the share of its one-gene variations (each gene set to each
 * other option) that still meet the objective's requirements.
 */
export async function room(pool: Runner, level: LevelDef, g: Grammar, genes: number[], obj: Objective): Promise<{ pass: number; total: number }> {
  const variants: number[][] = [];
  g.genes.forEach((gene, i) => {
    for (let v = 0; v < gene.options.length; v++) if (v !== genes[i]) variants.push(genes.map((x, k) => (k === i ? v : x)));
  });
  const results = await Promise.all(variants.map((v) => pool.run(level, g.build(v))));
  return { pass: results.filter((o) => obj.ok(o)).length, total: results.length };
}
