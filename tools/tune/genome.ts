import { Design, q, type GridPt } from '../../src/design';
import type { LevelDef } from '../../src/levels';
import { BLOCK, MATERIALS, type MaterialId } from '../../src/physics/materials';
import { defaultSag, layMain } from '../../src/maincable';
import { blockSpot, pointAllowed, topY } from '../../src/rules';
import { ringRise } from '../../src/masonry';
import { blockArch, blockTower, hangDeck, pylon, towerPosts } from '../../src/solutions';

/**
 * A structure grammar for one level: each gene picks one option, and build() turns the gene
 * values into a design. Genes cover the building blocks every hand-made reference uses:
 * deck spans, trusses over or under them, struts and posts from low anchors, trestles up
 * from deep piers, hangers from high anchors, and sagging main cables between them. On levels
 * with concrete anchors, braced towers on pairs of pier bolts and backstays from mast and tower
 * tops down to blocks on the banks, carrying the side spans on hangers. Where a main cable is
 * on offer, concrete pylons on pier pairs 4 m apart, main cables between their peaks and the
 * mast tops at a chosen sag, and main cable backstays to one or two blocks a side. Where
 * concrete blocks and block arches are on offer, towers of blocks on the rocks, arches from
 * tower to tower at a chosen rise, and posts up from both to the deck.
 */
export interface Grammar {
  genes: Gene[];
  build(g: number[]): Design;
}

export interface Gene {
  name: string;
  /** Labels of the options; the gene value indexes into this. */
  options: string[];
  /** The option the search's structured starting designs use, in place of their usual pick. */
  prefer?: number;
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
  const decks = (['road', 'heavy', 'track'] as MaterialId[]).filter(offered);
  // A bonus search can ban every beam material; genes still need one option, and build() then skips beams.
  const beamOpts: string[] = beams.length ? beams : ['none'];
  // Supports may also be rams on drawbridge levels: a post that lifts the leaf.
  const supportMats: MaterialId[] = [...beams, ...(offered('ram') ? (['ram'] as MaterialId[]) : [])];

  // Candidate places to break the deck into spans: interior anchors, to the meter, so a post
  // from a pier bolt can stand straight under the joint where two spans meet.
  const breaks = [...new Set(level.anchors.map(([x]) => Math.round(x)).filter((x) => x > 1 && x < W - 1))].sort((a, b) => a - b);
  // Towers a player could raise on two bolts 2 m apart in the gap, at the same height, where steel and anchors are on offer.
  const towerSpots = offered('steel') && level.blocks ? towerCandidates(level) : [];
  // Tops that tip freely: masts, and towers when built. Backstays hold them.
  const freeTops: GridPt[] = [...(level.masts ?? []).map(([x, , top]): GridPt => [x, top]), ...towerSpots.map((t) => t.top)].sort((a, b) => a[0] - b[0]);
  const high = [...level.anchors, ...freeTops].filter(([x, y]) => y > deckY(Math.min(W, Math.max(0, x))) + 1).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const low = level.anchors.filter(([x, y]) => y < deckY(Math.min(W, Math.max(0, x))) - 0.5);
  const cablesOk = offered('cable');

  const genes: Gene[] = [];
  const add = (name: string, options: string[], prefer?: number) => genes.push({ name, options, prefer }) - 1;
  // On a drawbridge, a support within a ram's reach of the channel most likely lifts the leaf.
  // The search starts it as a single ram post, since a wood or steel one pins the leaf down, and
  // with the deck unbroken above it, so the leaf runs whole from its hinge over the ram.
  const ramReach = MATERIALS.ram.maxLen;
  const lifts = (x: number) => !!level.ship && offered('ram') && (level.channels ?? []).some(([a, b]) => x >= a - ramReach && x <= b + ramReach);
  const breakGenes = breaks.map((x) => add(`break at ${x}`, ['no', 'yes'], lifts(x) ? 0 : undefined));
  // Spans are only known once the breaks are chosen, so every possible span slot gets genes:
  // at most breaks + 1 spans, indexed left to right.
  const spanGenes = Array.from({ length: breaks.length + 1 }, (_, i) => ({
    deck: add(`span ${i} deck`, decks),
    kind: add(`span ${i} truss`, [...TRUSS_KINDS]),
    mats: ROLES.map((r) => add(`span ${i} ${r}`, beamOpts)),
  }));
  const supportGenes = low.map(([x, y]) => ({
    at: [x, y] as GridPt,
    shape: add(`support ${x},${y}`, ['none', 'post', 'pair', 'fan', 'trestle'], lifts(x) ? 1 : undefined),
    mat: add(`support ${x},${y} material`, supportMats.length ? supportMats : ['none'], lifts(x) ? supportMats.indexOf('ram') : undefined),
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

  const towerGenes = towerSpots.map(({ a, b, top }) => ({ a, b, top, gene: add(`tower on ${a}–${b}`, ['no', 'yes'], 1) }));
  // Backstays from the outermost free tops: up to two blocks each, at whole meters back, and side span hangers off the first.
  const reach = level.blocks && cablesOk ? Math.floor(level.blocks.reach) : 0;
  const backOpts = ['none', ...Array.from({ length: reach }, (_, i) => `${i + 1} m back`)];
  const sides = freeTops.length && reach ? [...new Map([[freeTops[0], -1], [freeTops[freeTops.length - 1], 1]] as [GridPt, number][]).entries()] : [];
  const stayGenes = sides.map(([top, side]) => ({
    top,
    side,
    first: add(`backstay ${top} block`, backOpts, Math.min(reach, 4)),
    second: add(`backstay ${top} second block`, backOpts),
    hang: add(`side span under ${top} hangs from its backstay`, ['no', 'yes'], 1),
  }));

  // Long spans: pylons of chosen height, main cables between their peaks, and main cable backstays.
  const mainOk = offered('main') && !!level.blocks;
  const pylonSpots = mainOk && offered('concrete') ? pylonCandidates(level) : [];
  const pylonGenes = pylonSpots.map((p) => ({ ...p, gene: add(`pylon on ${p.a}`, ['none', ...p.heights.map((h) => `${h} m`)], Math.ceil(p.heights.length / 2)) }));
  const fixedTops: GridPt[] = mainOk ? (level.masts ?? []).map(([x, , top]): GridPt => [x, top]) : [];
  // Every place a peak may stand, left to right: a main span may join each to the next.
  const slots = [...fixedTops.map((t) => t[0]), ...pylonSpots.map((p) => p.a[0] + 2)].sort((a, b) => a - b);
  const spanSagGenes = slots.slice(0, -1).map((_, i) => add(`main span ${i} sag`, ['none', ...MAIN_SAGS.map((r) => `1/${r} of the span`)], 2));
  const backs = level.blocks ? Array.from({ length: Math.floor(level.blocks.reach / 2) }, (_, i) => 2 * (i + 1)) : [];
  const ends = slots.length ? [-1, 1] : [];
  const mainStayGenes = ends.map((side) => ({
    side,
    first: add(`main backstay ${side < 0 ? 'left' : 'right'} block`, ['none', ...backs.map((b) => `${b} m back`)], backs.length),
    second: add(`main backstay ${side < 0 ? 'left' : 'right'} second block`, ['none', ...backs.map((b) => `${b} m back`)]),
    sag: add(`main backstay ${side < 0 ? 'left' : 'right'} sag`, ['natural', 'deeper', 'deepest']),
    hang: add(`deck hangs from the ${side < 0 ? 'left' : 'right'} main backstay`, ['no', 'yes'], slots.length === 1 ? 1 : 0),
  }));
  const mainHangGene = mainOk ? add('main span hangers', ['every joint', 'every other joint']) : -1;

  // Blocks and arches: a tower on each rock, an arch from each rock's tower to the next one's.
  const rocks = (level.rocks ?? []).toSorted((a, b) => a[0] - b[0]);
  const brick = offered('masonry');
  const archOk = offered('arch');
  const stackGenes = brick
    ? rocks.map((r) => {
        // Rows that leave at least a meter clear under the deck.
        const under = Math.min(deckY(Math.max(0, Math.min(W, r[0]))), deckY(Math.max(0, Math.min(W, r[1]))));
        const most = Math.max(0, Math.min(10, Math.floor(under - r[2] - 1)));
        return add(`blocks on rock ${r[0]}–${r[1]}`, ['none', ...Array.from({ length: most }, (_, k) => `${k + 1} rows`)], Math.min(most, 2));
      })
    : [];
  const archGenes = archOk ? rocks.slice(0, -1).map((r, i) => add(`arch from rock ${r[0]} to ${rocks[i + 1][0]}`, ['none', ...ARCH_RISES.map((f) => `${f} of a natural rise`)], 1)) : [];
  const postGene = (archOk || brick) && beams.length ? add('posts on the arches and towers', beams) : -1;

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
      if (shape === 0 || !supportMats.length) continue;
      const mat = supportMats[g[s.mat]] ?? supportMats[0];
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
    // Pylons, main spans between the peaks, and main backstays from the outermost.
    const peaks: GridPt[] = [...fixedTops];
    for (const p of pylonGenes) {
      const h = g[p.gene];
      if (h === 0) continue;
      const top = p.a[1] + p.heights[h - 1];
      pylon(d, p.a[0], p.a[1], top, 4, 'concrete');
      peaks.push([p.a[0] + 2, top]);
    }
    peaks.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < peaks.length - 1; i++) {
      const [a, b] = [peaks[i], peaks[i + 1]];
      const slot = slots.indexOf(a[0]);
      // A span over a missing pylon takes the gene of its left slot.
      const r = g[spanSagGenes[slot]];
      if (!r) continue;
      try {
        hangDeck(d, level, layMain(d, a, b, Math.abs(b[0] - a[0]) / MAIN_SAGS[r - 1]), g[mainHangGene] + 1);
      } catch {
        // A run that can't be laid is just left out.
      }
    }
    for (const s of mainStayGenes) {
      if (!peaks.length) break;
      const peak = s.side < 0 ? peaks[0] : peaks[peaks.length - 1];
      for (const k of new Set([g[s.first], g[s.second]])) {
        if (!k) continue;
        const end: GridPt = [s.side < 0 ? -backs[k - 1] : W + backs[k - 1], s.side < 0 ? 0 : right];
        if (!blockSpot(level, end[0], end[1])) continue;
        const [a, b] = s.side < 0 ? [end, peak] : [peak, end];
        const sag = defaultSag(a, b) * [1, 1.5, 2][g[s.sag]];
        try {
          d.ensureBlock(end[0], end[1]);
          const pts = layMain(d, a, b, sag);
          if (g[s.hang] === 1 && k === g[s.first]) hangDeck(d, level, pts);
        } catch {
          // Left out.
        }
      }
    }
    // Block towers, arches between them, and posts up to the deck.
    if (stackGenes.length || archGenes.length) {
      const tops = rocks.map((r, i) => (stackGenes.length ? blockTower(d, level, r, g[stackGenes[i]]) : r[2]));
      const post = beams[g[postGene]] ?? beams[0];
      archGenes.forEach((gene, i) => {
        const f = g[gene];
        if (!f || !post) return;
        const a: GridPt = [rocks[i][1], tops[i]];
        const b: GridPt = [rocks[i + 1][0], tops[i + 1]];
        blockArch(d, level, a, b, post, Math.max(0.5, Math.round(ringRise(d, a, b) * ARCH_RISES[f - 1] * 10) / 10));
      });
      if (post) rocks.forEach((r, i) => towerPosts(d, r, tops[i], post));
    }
    d.pruneNodes();
    // Towers, then the backstays holding up free tops.
    for (const t of towerGenes) if (g[t.gene] === 1) tower(d, t.a, t.b, t.top);
    for (const s of stayGenes) {
      const first = g[s.first];
      const second = g[s.second];
      if (first > 0) backstay(d, level, s.top, s.side, first, g[s.hang] === 1 ? joints : []);
      if (second > 0 && second !== first) backstay(d, level, s.top, s.side, second, []);
    }
    return d;
  }

  return { genes, build };
}

/** Pairs of bolts 2 m apart at the same height inside the gap, and where a braced tower on them would top out. */
function towerCandidates(level: LevelDef): { a: GridPt; b: GridPt; top: GridPt }[] {
  const out: { a: GridPt; b: GridPt; top: GridPt }[] = [];
  for (const a of level.anchors) {
    const b = level.anchors.find(([x, y]) => Math.abs(x - a[0] - 2) < 1e-6 && Math.abs(y - a[1]) < 1e-6);
    if (!b || a[0] <= 0 || b[0] >= level.width) continue;
    const top: GridPt = [a[0] + 1, a[1] + TOWER_HEIGHT];
    if (pointAllowed(level, top[0], top[1])) out.push({ a, b, top });
  }
  return out;
}

const TOWER_HEIGHT = 7;

/** Block arch rises, as shares of the natural rise (a quarter span, or as high as the deck allows). */
const ARCH_RISES = [1, 0.8, 0.6];

/** Main span sags, as fractions of the span: 1/12 to 1/5. */
const MAIN_SAGS = [12, 10, 8, 6, 5];

/** Pairs of bolts 4 m apart at the same height inside the gap, where a concrete pylon could stand, and heights it might rise to. */
function pylonCandidates(level: LevelDef): { a: GridPt; heights: number[] }[] {
  const out: { a: GridPt; heights: number[] }[] = [];
  const ceiling = topY(level);
  for (const a of level.anchors) {
    const b = level.anchors.find(([x, y]) => Math.abs(x - a[0] - 4) < 1e-6 && Math.abs(y - a[1]) < 1e-6);
    if (!b || a[0] <= 0 || b[0] >= level.width) continue;
    const heights = [8, 10, 12, 14, 16, 18, 20].filter((h) => a[1] + h <= ceiling);
    if (heights.length) out.push({ a, heights });
  }
  return out;
}

/** A braced steel tower on bolts a and b, 2 m apart: legs to a cross beam 3 m up, crossed diagonals, and two struts to the top. */
function tower(d: Design, a: GridPt, b: GridPt, top: GridPt): void {
  const a3: GridPt = [a[0], a[1] + 3];
  const b3: GridPt = [b[0], b[1] + 3];
  d.add(a, a3, 'steel').add(b, b3, 'steel').add(a3, b3, 'steel').add(a, b3, 'steel').add(b, a3, 'steel');
  d.add(a3, top, 'steel').add(b3, top, 'steel');
}

/**
 * A backstay from a free top straight down to a concrete anchor `back` meters behind the bank
 * on `side` (-1 left, 1 right). It takes a joint above each given deck joint it passes at least
 * 1 m over, with a hanger down to it, and more joints wherever a piece would be too long for a
 * cable, kept clear of the road over the bank.
 */
function backstay(d: Design, level: LevelDef, top: GridPt, side: number, back: number, deck: GridPt[]): void {
  const edge = side < 0 ? 0 : level.width;
  const end: GridPt = [edge + side * back, side < 0 ? 0 : (level.rightY ?? 0)];
  if (!blockSpot(level, end[0], end[1])) return;
  const yAt = (x: number) => top[1] + ((end[1] - top[1]) * (x - top[0])) / (end[0] - top[0]);
  const between = (x: number) => (x - top[0]) * side > 1e-6 && (x - end[0]) * side < -1e-6;
  const bolted = ([x, y]: GridPt) => d.nodes[d.findNode(x, y)]?.anchor;
  const hung = deck.filter((j) => between(j[0]) && (j[0] - edge) * side < 0 && !bolted(j) && yAt(j[0]) - j[1] >= 1 && yAt(j[0]) - j[1] <= MATERIALS.cable.maxLen);
  const xs = [top[0], ...hung.map(([x]) => x).sort((p, r) => (p - r) * side), end[0]];
  // Split any piece too long for one cable, keeping joints over the bank high enough to clear the road.
  const clearX = top[0] + ((end[0] - top[0]) * (top[1] - end[1] - BLOCK.clearance)) / (top[1] - end[1] || 1);
  for (let i = 0; i < xs.length - 1 && xs.length < 20; i++) {
    const len = Math.hypot(xs[i + 1] - xs[i], yAt(xs[i + 1]) - yAt(xs[i]));
    if (len <= MATERIALS.cable.maxLen - 0.2) continue;
    let mid = (xs[i] + xs[i + 1]) / 2;
    if (!pointAllowed(level, mid, yAt(mid))) mid = clearX;
    if (!between(mid) || Math.abs(mid - xs[i]) < 0.5) return;
    xs.splice(i + 1, 0, mid);
    i--;
  }
  const pts = xs.map((x, i): GridPt => (i === xs.length - 1 ? end : [q(x), q(yAt(x))]));
  if (pts.slice(1, -1).some(([x, y]) => !pointAllowed(level, x, y))) return;
  d.ensureBlock(end[0], end[1]);
  for (let i = 0; i < pts.length - 1; i++) d.add(pts[i], pts[i + 1], 'cable');
  for (const [x, y] of hung) d.add([q(x), q(yAt(x))], [x, y], 'cable');
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
    const left = free.toReversed().find(([x]) => x < at[0]);
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
  // A hanger down to a bolt holds nothing up.
  const bolted = (j: GridPt) => d.nodes[d.findNode(j[0], j[1])]?.anchor;
  for (const [node, group] of hangs) for (const j of group) if (node[1] - j[1] >= 1 && !bolted(j)) d.add(node, j, 'cable');
}
