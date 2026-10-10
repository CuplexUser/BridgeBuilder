import { Design, type GridPt } from './design';
import { fitDesign } from './editor';
import type { LevelDef } from './levels';
import { designs as TUNED_DESIGNS } from './levels.res';
import { mainRuns } from './maincable';
import { MATERIALS, type MaterialId } from './physics/materials';
import { SOLUTIONS } from './solutions';

/** One member of a design shown as a ghost to trace: from, to and material. A run counts as one. */
export type Ghost = [GridPt, GridPt, MaterialId];

const known = new Map<number, Design | null>();

/**
 * The cheapest design known for a built-in level: the optimizer's reference or the hand-made
 * one, whichever costs less. Null for levels with neither, such as custom levels.
 */
export function bestKnown(level: LevelDef): Design | null {
  if (known.has(level.id)) return known.get(level.id)!;
  const options: Design[] = [];
  const tuned = TUNED_DESIGNS[String(level.id)]?.reference;
  try {
    if (tuned) options.push(fitDesign(level, Design.deserialize(tuned)).design);
  } catch {
    // An unreadable reference just isn't an option.
  }
  try {
    const made = SOLUTIONS[level.id]?.(level);
    if (made) options.push(made);
  } catch {
    // Likewise a hand-made design that no longer builds.
  }
  const best = options.toSorted((a, b) => a.cost() - b.cost())[0] ?? null;
  known.set(level.id, best);
  return best;
}

/** How a cost compares with the best known design: "14% above the best known design ($8,204)" and so on. */
export function costReview(cost: number, best: number, money: (v: number) => string): string {
  const pct = Math.round(((cost - best) / best) * 100);
  if (cost < best) return `${pct === 0 ? 'Just' : `${-pct}%`} under the best known design (${money(best)}). Remarkable.`;
  if (pct === 0) return `Within 1% of the best known design (${money(best)}).`;
  return `${pct}% above the best known design (${money(best)}).`;
}

/**
 * A design as the members a player would place, in the order hints reveal them: each deck run
 * in one piece, left to right, then every other beam, cable or main cable run left to right.
 */
export function ghosts(d: Design): Ghost[] {
  const pt = (i: number): GridPt => [d.nodes[i].x, d.nodes[i].y];
  const done = new Set<number>();
  const deck: Ghost[] = [];
  const rest: Ghost[] = [];
  // Main cables, whole runs.
  for (const { part, chain } of mainRuns(d)) {
    d.members.forEach((m, i) => m.part === part && done.add(i));
    rest.push([pt(chain[0]), pt(chain[chain.length - 1]), 'main']);
  }
  // Split beams, end to end: the pieces of a part lie on one line.
  const parts = new Map<number, number[]>();
  d.members.forEach((m, i) => {
    if (m.part !== undefined && !done.has(i)) parts.set(m.part, [...(parts.get(m.part) ?? []), i]);
  });
  for (const members of parts.values()) {
    const ends = new Map<number, number>();
    for (const i of members) for (const n of [d.members[i].a, d.members[i].b]) ends.set(n, (ends.get(n) ?? 0) + 1);
    const [a, b] = [...ends].filter(([, k]) => k === 1).map(([n]) => n);
    for (const i of members) done.add(i);
    if (a !== undefined && b !== undefined) (MATERIALS[d.members[members[0]].mat].drivable ? deck : rest).push([pt(a), pt(b), d.members[members[0]].mat]);
  }
  // Deck pieces joined into straight runs of one material.
  const along = (i: number, n: number) => {
    const m = d.members[i];
    const o = d.nodes[m.a === n ? m.b : m.a];
    return Math.atan2(o.y - d.nodes[n].y, o.x - d.nodes[n].x);
  };
  d.members.forEach((m, i) => {
    if (done.has(i) || !MATERIALS[m.mat].drivable) return;
    done.add(i);
    let [a, b] = [m.a, m.b];
    // Grow the run past each joint where one more piece of the same deck carries straight on.
    for (const side of [0, 1]) {
      let at = side ? b : a;
      let from = i;
      for (;;) {
        const heading = along(from, at) + Math.PI;
        const next = d.members.findIndex((o, k) => !done.has(k) && o.mat === m.mat && (o.a === at || o.b === at) && Math.abs(Math.sin(along(k, at) - heading)) < 1e-3 && Math.cos(along(k, at) - heading) > 0);
        if (next < 0) break;
        done.add(next);
        at = d.members[next].a === at ? d.members[next].b : d.members[next].a;
        from = next;
      }
      if (side) b = at;
      else a = at;
    }
    const [p, q] = d.nodes[a].x <= d.nodes[b].x ? [a, b] : [b, a];
    deck.push([pt(p), pt(q), m.mat]);
  });
  d.members.forEach((m, i) => {
    if (!done.has(i)) rest.push([pt(m.a), pt(m.b), m.mat]);
  });
  const mid = (g: Ghost) => (g[0][0] + g[1][0]) / 2;
  return [...deck.toSorted((g, h) => mid(g) - mid(h)), ...rest.toSorted((g, h) => mid(g) - mid(h))];
}

/**
 * The next hint for a design in progress: the first ghost of the best known design that the
 * design doesn't have yet and that hasn't been shown already. Its index, or -1 when none is left.
 */
export function nextHint(all: Ghost[], d: Design, shown: number[]): number {
  return all.findIndex(([a, b, mat], i) => !shown.includes(i) && !d.covers(a, b, mat));
}
