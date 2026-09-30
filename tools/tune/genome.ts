import { Design, q, type GridPt } from '../../src/design';
import type { LevelDef } from '../../src/levels';
import { MATERIALS, type MaterialId } from '../../src/physics/materials';

/**
 * A structure grammar for one level: each gene picks one option, and build() turns the gene
 * values into a design. Genes cover the building blocks every hand-made reference uses:
 * deck spans, trusses over or under them, struts and posts from low anchors, trestles up
 * from deep piers, hangers from high anchors, and sagging main cables between them.
 */
export interface Grammar {
  genes: Gene[];
  build(g: number[]): Design;
}

export interface Gene {
  name: string;
  /** Labels of the options; the gene value indexes into this. */
  options: string[];
}

export interface GrammarOptions {
  /** Deck waypoints; the deck is a straight run between each pair. Defaults to bank to bank. */
  deck?: GridPt[];
}

const TRUSS_KINDS = ['none', 'above 2 m', 'above 3 m', 'below 2 m'] as const;
const ROLES = ['chord', 'web', 'vert', 'end', 'endWeb'] as const;
const SAGS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export function grammarFor(level: LevelDef, opts: GrammarOptions = {}): Grammar {
  const W = level.width;
  const right = level.rightY ?? 0;
  const waypoints: GridPt[] = opts.deck ?? [
    [0, 0],
    [W, right],
  ];
  const deckY = (x: number) => heightOn(waypoints, x);
  const offered = (m: MaterialId) => level.materials.includes(m);
  const beams = (['wood', 'steel'] as MaterialId[]).filter(offered);
  const decks = (['road', 'heavy'] as MaterialId[]).filter(offered);
  // A bonus search can ban every beam material; genes still need one option, and build() then skips beams.
  const beamOpts: string[] = beams.length ? beams : ['none'];

  // Candidate places to break the deck into spans: interior anchors, snapped to even meters.
  const breaks = [...new Set(level.anchors.map(([x]) => Math.round(x / 2) * 2).filter((x) => x > 1 && x < W - 1))].sort((a, b) => a - b);
  const high = level.anchors.filter(([x, y]) => y > deckY(Math.min(W, Math.max(0, x))) + 1).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const low = level.anchors.filter(([x, y]) => y < deckY(Math.min(W, Math.max(0, x))) - 0.5);
  const cablesOk = offered('cable');

  const genes: Gene[] = [];
  const add = (name: string, options: string[]) => genes.push({ name, options }) - 1;
  const breakGenes = breaks.map((x) => add(`break at ${x}`, ['no', 'yes']));
  // Spans are only known once the breaks are chosen, so every possible span slot gets genes:
  // at most breaks + 1 spans, indexed left to right.
  const spanGenes = Array.from({ length: breaks.length + 1 }, (_, i) => ({
    deck: add(`span ${i} deck`, decks),
    kind: add(`span ${i} truss`, [...TRUSS_KINDS]),
    mats: ROLES.map((r) => add(`span ${i} ${r}`, beamOpts)),
  }));
  const supportGenes = low.map(([x, y]) => ({
    at: [x, y] as GridPt,
    shape: add(`support ${x},${y}`, ['none', 'post', 'pair', 'fan', 'trestle']),
    mat: add(`support ${x},${y} material`, beamOpts),
  }));
  const hangGenes = cablesOk
    ? high.map(([x, y]) => ({ at: [x, y] as GridPt, bits: [] as { joint: number; gene: number }[] }))
    : [];
  const mainGenes = cablesOk
    ? high.slice(0, -1).flatMap((a, i) => {
        const b = high[i + 1];
        if (b[0] - a[0] < 4) return [];
        return [{ a, b, sag: add(`main cable ${a}–${b} sag`, ['none', ...SAGS.map((s) => `${s} m`)]), layout: add(`main cable ${a}–${b} hangers`, ['every joint', 'pairs']) }];
      })
    : [];

  // Deck joints of the straight bank-to-bank layout, used to size hanger genes.
  const probe = new Design(level);
  const probeJoints = layDeck(probe, waypoints, breaks, () => 'road');
  for (const h of hangGenes) {
    probeJoints.forEach(([x, y], j) => {
      if (probe.nodes[probe.findNode(x, y)].anchor) return;
      if (Math.hypot(x - h.at[0], y - h.at[1]) <= MATERIALS.cable.maxLen) h.bits.push({ joint: j, gene: add(`hang ${x},${y} from ${h.at}`, ['no', 'yes']) });
    });
  }

  function build(g: number[]): Design {
    const d = new Design(level);
    const cuts = breaks.filter((_, i) => g[breakGenes[i]] === 1);
    const stations = [0, ...cuts, W];
    // Deck, span by span.
    const spanOf = (x: number) => Math.max(0, stations.findIndex((s, i) => i > 0 && x <= s + 1e-9) - 1);
    const joints = layDeck(d, waypoints, cuts, (x) => decks[g[spanGenes[spanOf(x)].deck]] ?? decks[0]);
    const jointAt = (x: number) => joints.find(([jx]) => Math.abs(jx - x) < 1e-6);
    // Trusses over or under each span.
    for (let s = 0; s < stations.length - 1; s++) {
      const sg = spanGenes[s];
      const kind = TRUSS_KINDS[g[sg.kind]];
      if (kind === 'none' || !beams.length) continue;
      const pts = joints.filter(([x]) => x >= stations[s] - 1e-6 && x <= stations[s + 1] + 1e-6);
      if (pts.length < 3) continue;
      const [role0, role1, role2, role3, role4] = sg.mats.map((m) => beams[g[m]] ?? beams[0]);
      const m = { chord: role0, web: role1, vert: role2, end: role3, endWeb: role4 };
      const h = kind === 'above 2 m' ? 2 : kind === 'above 3 m' ? 3 : -2;
      truss(d, pts, h, m, level);
    }
    // Struts, posts and trestles from low anchors.
    for (const s of supportGenes) {
      const shape = g[s.shape];
      if (shape === 0 || !beams.length) continue;
      const mat = beams[g[s.mat]] ?? beams[0];
      support(d, s.at, joints, mat, shape);
    }
    // Hangers.
    for (const h of hangGenes) for (const b of h.bits) if (g[b.gene] === 1 && probeJoints[b.joint]) {
      const [x] = probeJoints[b.joint];
      const j = jointAt(x);
      if (j) d.add(h.at, j, 'cable');
    }
    // Main cables.
    for (const mc of mainGenes) {
      const sag = g[mc.sag];
      if (sag === 0) continue;
      mainCable(d, mc.a, mc.b, SAGS[sag - 1], g[mc.layout] === 1, joints);
    }
    return d;
  }

  return { genes, build };
}

/** Height of the deck polyline at x. */
export function heightOn(waypoints: GridPt[], x: number): number {
  for (let i = 0; i < waypoints.length - 1; i++) {
    const [ax, ay] = waypoints[i];
    const [bx, by] = waypoints[i + 1];
    if (x >= ax - 1e-9 && x <= bx + 1e-9) return q(ay + ((by - ay) * (x - ax)) / (bx - ax || 1));
  }
  return 0;
}

/** Lays the deck along the waypoints, breaking runs at the given x positions. Returns every deck joint, left to right. */
function layDeck(d: Design, waypoints: GridPt[], cuts: number[], matAt: (x: number) => MaterialId): GridPt[] {
  const yAt = (x: number) => heightOn(waypoints, x);
  const xs = [...new Set([...waypoints.map(([x]) => x), ...cuts])].sort((a, b) => a - b);
  const out: GridPt[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const a: GridPt = [xs[i], yAt(xs[i])];
    const b: GridPt = [xs[i + 1], yAt(xs[i + 1])];
    const mat = matAt((a[0] + b[0]) / 2);
    const path = d.runPath(a[0], a[1], b[0], b[1], MATERIALS[mat].maxLen, 50);
    if (!path) continue;
    for (let k = 0; k < path.length - 1; k++) d.add(path[k], path[k + 1], mat);
    for (const p of i === 0 ? path : path.slice(1)) out.push(p);
  }
  return out;
}

/** A Pratt truss h meters above (or below, for negative h) a deck polyline, tied into anchors at its chord ends. */
function truss(d: Design, pts: GridPt[], h: number, m: Record<(typeof ROLES)[number], MaterialId>, level: LevelDef): void {
  const n = pts.length - 1;
  const top = (i: number): GridPt => [pts[i][0], q(pts[i][1] + h)];
  const mid = (pts[0][0] + pts[n][0]) / 2;
  d.add(pts[0], top(1), m.end);
  d.add(top(n - 1), pts[n], m.end);
  for (let i = 1; i < n; i++) d.add(pts[i], top(i), m.vert);
  for (let i = 1; i < n - 1; i++) {
    d.add(top(i), top(i + 1), m.chord);
    const mat = i === 1 || i === n - 2 ? m.endWeb : m.web;
    let [a, b]: GridPt[] = pts[i + 1][0] <= mid ? [top(i), pts[i + 1]] : pts[i][0] >= mid ? [top(i + 1), pts[i]] : [top(i), pts[i + 1]];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > MATERIALS[mat].maxLen) [a, b] = a[0] < b[0] ? [top(i + 1), pts[i]] : [top(i), pts[i + 1]];
    d.add(a, b, mat);
  }
  // Anchors level with the chord at either end (high bank bolts) take the chord's pull.
  for (const [end, inner] of [
    [top(0), top(1)],
    [top(n), top(n - 1)],
  ] as const) {
    if (level.anchors.some(([x, y]) => Math.abs(x - end[0]) < 1e-6 && Math.abs(y - end[1]) < 1e-6)) d.add(end, inner, m.chord);
  }
}

/**
 * Members from a low anchor up to the deck. Shapes: 1 a post to the nearest joint in reach,
 * 2 a pair to the nearest joints either side, 3 a fan to all three, 4 a braced trestle for
 * piers too deep to reach the deck directly.
 */
function support(d: Design, at: GridPt, joints: GridPt[], mat: MaterialId, shape: number): void {
  const reach = MATERIALS[mat].maxLen;
  const free = joints.filter((p) => !d.nodes[d.findNode(p[0], p[1])]?.anchor);
  const dist = (p: GridPt) => Math.hypot(p[0] - at[0], p[1] - at[1]);
  if (shape === 4) {
    // Trestle: two legs up to a braced level halfway, then posts to the deck joints either side.
    const left = free.filter(([x]) => x < at[0]).at(-1);
    const rightJ = free.find(([x]) => x > at[0]);
    if (!left || !rightJ) return;
    const yMid = q((at[1] + Math.min(left[1], rightJ[1])) / 2);
    const a: GridPt = [left[0], yMid];
    const b: GridPt = [rightJ[0], yMid];
    d.add(at, a, 'steel').add(at, b, 'steel').add(a, b, mat);
    d.add(a, left, 'steel').add(b, rightJ, 'steel').add(a, rightJ, 'steel');
    return;
  }
  const inReach = free.filter((p) => dist(p) <= reach + 1e-9).sort((p, r) => dist(p) - dist(r));
  if (!inReach.length) return;
  const picks: GridPt[] = [inReach[0]];
  if (shape >= 2) {
    const other = inReach.find(([x]) => Math.sign(x - at[0]) !== Math.sign(inReach[0][0] - at[0]) && x !== inReach[0][0]) ?? inReach[1];
    if (other) picks.push(other);
  }
  if (shape >= 3) {
    const third = inReach.find((p) => !picks.includes(p));
    if (third) picks.push(third);
  }
  for (const p of picks) d.add(at, p, mat);
}

/** A main cable from a to b sagging by `sag`, with a node above each deck joint (or every other gap, in pairs) and hangers down. */
function mainCable(d: Design, a: GridPt, b: GridPt, sag: number, pairs: boolean, joints: GridPt[]): void {
  const inside = joints.filter(([x]) => x > a[0] + 1e-6 && x < b[0] - 1e-6);
  if (!inside.length) return;
  const yAt = (x: number) => {
    const t = (x - a[0]) / (b[0] - a[0]);
    return Math.round(a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t));
  };
  const nodes: GridPt[] = [a];
  const hangs: [GridPt, GridPt[]][] = [];
  if (pairs) {
    for (let i = 0; i < inside.length; i += 2) {
      const group = inside.slice(i, i + 2);
      const x = group.length === 2 ? (group[0][0] + group[1][0]) / 2 : group[0][0];
      const node: GridPt = [x, yAt(x)];
      nodes.push(node);
      hangs.push([node, group]);
    }
  } else {
    for (const j of inside) {
      const node: GridPt = [j[0], yAt(j[0])];
      nodes.push(node);
      hangs.push([node, [j]]);
    }
  }
  nodes.push(b);
  for (let i = 0; i < nodes.length - 1; i++) d.add(nodes[i], nodes[i + 1], 'cable');
  for (const [node, group] of hangs) for (const j of group) if (node[1] - j[1] >= 1) d.add(node, j, 'cable');
}
