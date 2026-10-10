import { Design, segmentsOverlap, type DMember, type GridPt } from './design';
import type { LevelDef } from './levels';
import { bow, defaultSag, mainPathIn, mainRuns, MIN_MAIN_SPAN, MIN_SAG, resag, sagHandle } from './maincable';
import { blockOf, MATERIALS, type MaterialId } from './physics/materials';
import { blockSpot, pileSpots, cableBolt, crossesChannel, lowOverStrip, MIN_JOINT_GAP, pointAllowed, topY } from './rules';
import { addBlock, blockPoly, cellPoly, cellProblem, cellUnder, hitsCells, layRing, polyArea, ringPath, ringPolys, ringProblem, ringRise, rings, settleRing } from './masonry';

export interface DragState {
  /**
   * Start node index, or -1 when the drag starts from a point on a beam that will be split,
   * or from an empty concrete anchor spot that gets a block when the member is placed.
   */
  from: number;
  sx: number;
  sy: number;
  /** Member split at the start point, or -1. */
  fromSplit: number;
  tx: number;
  ty: number;
  /** Member split at the target point, or -1. */
  toSplit: number;
  /** Points from the start to the target; a road run spans several members. */
  path: GridPt[];
  /** What placing this would cost, in dollars. */
  cost: number;
  valid: boolean;
  reason: string;
}

/** A main cable's sag being dragged by its handle. */
export interface SagDrag {
  part: number;
  /** The run's joints, end to end. */
  chain: number[];
  /** Where the handle sits now. */
  x: number;
  y: number;
  /** The design before the drag, for undo, and the joints' heights to put back if it is let go invalid. */
  before: string;
  ys: number[];
  /** An arch ring's top joints, which follow its underside, and their heights before. Empty for a main cable. */
  extra: number[];
  eys: number[];
  valid: boolean;
  reason: string;
}

/** Concrete blocks being painted, or erased, under a finger or the mouse. */
export interface PaintStroke {
  mode: 'add' | 'erase';
  /** The design before the stroke, for undo. */
  before: string;
  changed: boolean;
  /** The last cell visited, by its lower left corner, so each is painted once a pass. */
  last: string;
}

/** A main cable's sag handle, or an arch's rise handle. */
export interface SagHandle {
  part: number;
  mat: MaterialId;
  chain: number[];
  /** An arch ring's top joints. */
  extra: number[];
  x: number;
  y: number;
}

export interface AttachPick {
  member: number;
  x: number;
  y: number;
}

export interface EditorEvents {
  /** Fired once per member; a road run places `count` members in one go. */
  place(ax: number, ay: number, bx: number, by: number, mat: MaterialId, index: number, count: number): void;
  remove(ax: number, ay: number, bx: number, by: number, mat: MaterialId): void;
  invalid(reason: string, x: number, y: number): void;
}

/** Existing joints and beam attach points win ties against bare grid points by this much. */
const JOINT_BONUS = 0.2;
/** Most pieces one deck run may lay. */
const MAX_RUN = 40;
/** Farthest a main cable reaches in one drag, m. */
const MAX_MAIN_REACH = 80;

/**
 * A saved design brought up to date with its level, which may have changed since it was
 * saved: rebuilt on the level's own bolts, without the parts that no longer fit. A part goes
 * when its material is no longer offered, a joint it uses is gone or now out of bounds, it
 * crosses a channel, it's a cable on a bolt that holds none, or it's over a material limit
 * (the latest placed go first). A split beam or main cable goes whole. Prices come from the
 * level; the budget isn't checked, so a design that now costs too much loads for trimming.
 */
export function fitDesign(level: LevelDef, saved: Design): { design: Design; removed: number } {
  const d = new Design(level);
  const before = saved.parts();
  // Bars first, so blocks are checked against the bars that stay.
  const bolt = (x: number, y: number) => d.findNode(x, y);
  const nodeOk = saved.nodes.map((n) => {
    if (n.block || n.pile) return blockSpot(level, n.x, n.y);
    if (n.anchor) return bolt(n.x, n.y) >= 0;
    return true;
  });
  const memberOk = (m: DMember) => {
    const [a, b] = [saved.nodes[m.a], saved.nodes[m.b]];
    const mat = MATERIALS[m.mat];
    if (!level.materials.includes(m.mat) || !nodeOk[m.a] || !nodeOk[m.b]) return false;
    // A main cable's own joints may hang low over an anchor strip.
    const free = (n: typeof a) => n.anchor || pointAllowed(level, n.x, n.y) || (!!mat.curved && lowOverStrip(level, n.x, n.y));
    if (!free(a) || !free(b)) return false;
    if (mat.tensionOnly && (cableBolt(level, a.x, a.y) || cableBolt(level, b.x, b.y))) return false;
    if (Math.hypot(b.x - a.x, b.y - a.y) > mat.maxLen + 1e-9) return false;
    return !crossesChannel(level, a.x, a.y, b.x, b.y);
  };
  // Whole parts: a beam or run with any piece that doesn't fit goes entirely.
  const badParts = new Set(saved.members.flatMap((m) => (m.part !== undefined && !memberOk(m) ? [m.part] : [])));
  let keep = saved.members.filter((m) => (m.part === undefined ? memberOk(m) : !badParts.has(m.part)));
  for (const [mat, max] of Object.entries(level.limits ?? {}) as [MaterialId, number][]) {
    const parts: (number | DMember)[] = [];
    for (const m of keep) if (m.mat === mat && !parts.includes(m.part ?? m)) parts.push(m.part ?? m);
    const extra = new Set(parts.slice(max));
    keep = keep.filter((m) => !extra.has(m.part ?? m));
  }
  // Rebuild on the level's own nodes: its bolts first, then the joints and blocks the design uses.
  const map = new Map<number, number>();
  const at = (i: number) => {
    let j = map.get(i);
    if (j === undefined) {
      const n = saved.nodes[i];
      j = n.block || n.pile ? d.ensureBlock(n.x, n.y) : n.anchor ? bolt(n.x, n.y) : d.ensureNode(n.x, n.y);
      map.set(i, j);
    }
    return j;
  };
  for (const m of keep) {
    const [a, b] = [at(m.a), at(m.b)];
    if (a !== b && d.findMember(a, b) < 0) d.members.push(m.part === undefined ? { a, b, mat: m.mat } : { a, b, mat: m.mat, part: m.part });
  }
  // Blocks that still fit the level, an arch ring whole or not at all.
  const cellOk = (c: (typeof saved.cells)[number]) => level.materials.includes(c.mat) && c.n.every((i) => nodeOk[i]);
  const badRings = new Set(saved.cells.flatMap((c) => (c.mat === 'arch' && !cellOk(c) && c.part !== undefined ? [c.part] : [])));
  for (const c of saved.cells) {
    if (!cellOk(c) || (c.part !== undefined && badRings.has(c.part))) continue;
    const poly = cellPoly(saved, c);
    if (cellProblem(level, d, poly)) {
      if (c.part !== undefined && c.mat === 'arch') badRings.add(c.part);
      continue;
    }
    d.cells.push(c.part === undefined ? { n: c.n.map(at), mat: c.mat } : { n: c.n.map(at), mat: c.mat, part: c.part });
  }
  // A ring found broken partway through is taken off whole.
  d.cells = d.cells.filter((c) => c.part === undefined || c.mat !== 'arch' || !badRings.has(c.part));
  d.healSplits();
  d.pruneNodes();
  d.priceAnchors(level);
  return { design: d, removed: Math.max(0, before - d.parts()) };
}

/** Formats dollars the way the whole UI shows them, e.g. $12,500. */
export function money(v: number): string {
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

/** Build-mode rules: snapping, budgets, validity and undo. */
export class Editor {
  design: Design;
  level: LevelDef;
  mat: MaterialId = 'road';
  drag: DragState | null = null;
  sag: SagDrag | null = null;
  paint: PaintStroke | null = null;
  cursorX = 0;
  cursorY = 0;
  /** Seconds since each member was placed, parallel to design.members. */
  ages: number[] = [];
  /** Goes up with every change to the design, so marks made on one version know when they're stale. */
  revision = 0;
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  /**
   * What happened to the saved design when it was loaded into a level that has changed since:
   * parts that no longer fit were removed, or it now costs more than the budget. Null when it loaded as saved.
   */
  readonly fitted: { removed: number; over: number } | null = null;

  constructor(level: LevelDef, private ev: EditorEvents, saved?: string) {
    this.level = level;
    this.design = new Design(level);
    if (saved) {
      try {
        const fit = fitDesign(level, Design.deserialize(saved));
        this.design = fit.design;
        const over = Math.max(0, fit.design.cost() - level.money);
        if (fit.removed || over) this.fitted = { removed: fit.removed, over };
      } catch {
        // Corrupt save: start fresh.
      }
    }
    this.ages = this.design.members.map(() => 10);
    this.cursorX = 0;
    this.cursorY = 0;
  }

  get topY(): number {
    return topY(this.level);
  }

  /** Money spent on the current design. */
  spent(): number {
    return this.design.cost();
  }

  /** Money left to spend. */
  left(): number {
    return this.level.money - this.spent();
  }

  tick(dt: number): void {
    for (let i = 0; i < this.ages.length; i++) this.ages[i] += dt;
  }

  setMaterial(mat: MaterialId): boolean {
    if (!this.level.materials.includes(mat)) return false;
    this.mat = mat;
    if (this.drag) this.aim(this.drag.tx, this.drag.ty);
    return true;
  }

  pointAllowed(x: number, y: number): boolean {
    return this.design.findNode(x, y) >= 0 || pointAllowed(this.level, x, y) || blockSpot(this.level, x, y);
  }

  /** The nearest empty concrete anchor or pile spot within radius, or null. */
  blockSpotAt(wx: number, wy: number, radius: number): [number, number] | null {
    const L = this.level;
    for (const [x, y] of pileSpots(L)) if (this.design.findNode(x, y) < 0 && Math.hypot(x - wx, y - wy) <= radius) return [x, y];
    if (!L.blocks) return null;
    const x = wx < L.width / 2 ? Math.round(wx) : L.width + Math.round(wx - L.width);
    const y = x < 0 ? 0 : (L.rightY ?? 0);
    if (!blockSpot(L, x, y) || this.design.findNode(x, y) >= 0 || Math.hypot(x - wx, y - wy) > radius) return null;
    return [x, y];
  }

  nodeAt(wx: number, wy: number, radius: number): number {
    let best = -1;
    let bd = radius;
    this.design.nodes.forEach((n, i) => {
      const d = Math.hypot(n.x - wx, n.y - wy);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  memberAt(wx: number, wy: number, radius: number): number {
    let best = -1;
    let bd = radius;
    const { nodes, members } = this.design;
    members.forEach((m, i) => {
      const a = nodes[m.a];
      const b = nodes[m.b];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / (dx * dx + dy * dy)));
      const d = Math.hypot(a.x + dx * t - wx, a.y + dy * t - wy);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  /**
   * Member whose middle half lies under the pointer. Short beams sit entirely inside their joints'
   * pick circles, so this is how a tap on one still reaches the beam rather than a joint.
   */
  memberBodyAt(wx: number, wy: number, radius: number): number {
    let best = -1;
    let bd = radius;
    const { nodes, members } = this.design;
    members.forEach((m, i) => {
      const a = nodes[m.a];
      const b = nodes[m.b];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = ((wx - a.x) * dx + (wy - a.y) * dy) / (dx * dx + dy * dy);
      if (t < 0.25 || t > 0.75) return;
      const d = Math.hypot(a.x + dx * t - wx, a.y + dy * t - wy);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  /** Nearest point where a beam could be split to take a new joint. */
  attachAt(wx: number, wy: number, radius: number, skip = -1): AttachPick | null {
    let best: AttachPick | null = null;
    let bd = radius;
    this.design.members.forEach((_, i) => {
      if (i === skip) return;
      for (const [x, y] of this.design.attachPoints(i)) {
        const d = Math.hypot(x - wx, y - wy);
        if (d < bd && this.design.findNode(x, y) < 0) {
          bd = d;
          best = { member: i, x, y };
        }
      }
    });
    return best;
  }

  begin(node: number): void {
    const n = this.design.nodes[node];
    this.drag = { from: node, sx: n.x, sy: n.y, fromSplit: -1, tx: n.x, ty: n.y, toSplit: -1, path: [[n.x, n.y]], cost: 0, valid: false, reason: '' };
  }

  /** Starts a drag from a point on a beam; the beam is split there when the member is placed. */
  beginSplit(p: AttachPick): void {
    this.drag = { from: -1, sx: p.x, sy: p.y, fromSplit: p.member, tx: p.x, ty: p.y, toSplit: -1, path: [[p.x, p.y]], cost: 0, valid: false, reason: '' };
  }

  /** Starts a drag from an empty concrete anchor spot; the block is set there when the member is placed. */
  beginBlock(x: number, y: number): void {
    this.drag = { from: -1, sx: x, sy: y, fromSplit: -1, tx: x, ty: y, toSplit: -1, path: [[x, y]], cost: 0, valid: false, reason: '' };
  }

  /** Starts a drag at a node, a main cable's sag handle, a beam attach point or an empty anchor spot. Returns what was picked. */
  beginAt(wx: number, wy: number, nodeRadius: number, attachRadius: number, handleRadius = nodeRadius): 'node' | 'sag' | 'split' | 'block' | null {
    const node = this.nodeAt(wx, wy, nodeRadius);
    const handle = this.sagHandleAt(wx, wy, handleRadius);
    const nodeDist = node >= 0 ? Math.hypot(this.design.nodes[node].x - wx, this.design.nodes[node].y - wy) : Infinity;
    if (handle && Math.hypot(handle.x - wx, handle.y - wy) < nodeDist) {
      this.beginSag(handle);
      return 'sag';
    }
    if (node >= 0) {
      this.begin(node);
      return 'node';
    }
    const p = this.attachAt(wx, wy, attachRadius);
    if (p) {
      this.beginSplit(p);
      return 'split';
    }
    const spot = this.blockSpotAt(wx, wy, nodeRadius);
    if (spot) {
      this.beginBlock(spot[0], spot[1]);
      return 'block';
    }
    // An arch may spring from any free grid point, such as the top of a rock shelf.
    if (MATERIALS[this.mat].cell === 'ring') {
      const [gx, gy] = [Math.round(wx), Math.round(wy)];
      if (Math.hypot(gx - wx, gy - wy) <= nodeRadius && pointAllowed(this.level, gx, gy) && !this.design.nodes.some((n) => Math.hypot(n.x - gx, n.y - gy) < MIN_JOINT_GAP)) {
        this.beginBlock(gx, gy);
        return 'block';
      }
    }
    return null;
  }

  /** Deck materials are laid in runs: one drag can span many pieces. */
  private get runs(): boolean {
    return MATERIALS[this.mat].runs;
  }

  /** Snaps a raw world position to the best reachable grid point, joint or beam attach point. */
  aim(wx: number, wy: number): void {
    const drag = this.drag;
    if (!drag) return;
    const fx = drag.sx;
    const fy = drag.sy;
    const maxLen = MATERIALS[this.mat].maxLen;
    const pieces = this.runs ? MAX_RUN : 1;
    const reach = MATERIALS[this.mat].curved ? MAX_MAIN_REACH : maxLen * pieces;
    const dx = wx - fx;
    const dy = wy - fy;
    const d = Math.hypot(dx, dy);
    let px = wx;
    let py = wy;
    if (d > reach) {
      px = fx + (dx / d) * reach;
      py = fy + (dy / d) * reach;
    }
    let bx = fx;
    let by = fy;
    let split = -1;
    let best = Infinity;
    const consider = (x: number, y: number, bonus: number, member: number) => {
      const len = Math.hypot(x - fx, y - fy);
      if (len > reach + 1e-9 || len < 1e-6) return;
      const score = Math.hypot(x - px, y - py) - bonus;
      if (score < best) {
        best = score;
        bx = x;
        by = y;
        split = member;
      }
    };
    for (let gx = Math.floor(px) - 1; gx <= Math.ceil(px) + 1; gx++) {
      for (let gy = Math.floor(py) - 1; gy <= Math.ceil(py) + 1; gy++) consider(gx, gy, 0, -1);
    }
    for (const n of this.design.nodes) {
      if (Math.abs(n.x - px) < 1.5 && Math.abs(n.y - py) < 1.5) consider(n.x, n.y, JOINT_BONUS, -1);
    }
    const spot = this.blockSpotAt(px, py, 1.5);
    if (spot) consider(spot[0], spot[1], JOINT_BONUS, -1);
    const near = this.attachAt(px, py, 1.5, drag.fromSplit);
    if (near) consider(near.x, near.y, JOINT_BONUS, near.member);
    drag.tx = bx;
    drag.ty = by;
    drag.toSplit = split;
    const curved = MATERIALS[this.mat].curved;
    const run = this.runs ? this.design.runPath(fx, fy, bx, by, maxLen, pieces) : curved ? mainPathIn(this.design, [fx, fy], [bx, by], defaultSag([fx, fy], [bx, by], this.mat)) : null;
    drag.path = run ?? [
      [fx, fy],
      [bx, by],
    ];
    let len = 0;
    for (let i = 1; i < drag.path.length; i++) len += Math.hypot(drag.path[i][0] - drag.path[i - 1][0], drag.path[i][1] - drag.path[i - 1][1]);
    // An arch ring is priced by its area, like any block.
    const ring = MATERIALS[this.mat].cell === 'ring' ? ringPath(this.design, [fx, fy], [bx, by], ringRise(this.design, [fx, fy], [bx, by])) : null;
    if (ring) drag.path = fx <= bx ? ring.intra : ring.intra.toReversed();
    const area = ring ? ringPolys(ring).reduce((a, poly) => a + Math.abs(polyArea(poly)), 0) : 0;
    drag.cost = Math.round(ring ? area * MATERIALS[this.mat].price : len * MATERIALS[this.mat].price) + this.newAnchorCost(drag);
    drag.reason = this.problem(drag);
    drag.valid = drag.reason === '';
  }

  /** What any paid anchor this drag starts using, or any concrete anchor it sets, would add to the bill. */
  private newAnchorCost(drag: DragState): number {
    const { nodes, members } = this.design;
    let c = 0;
    for (const i of new Set([drag.from, this.design.findNode(drag.tx, drag.ty)])) {
      if (i >= 0 && nodes[i].price && !members.some((m) => m.a === i || m.b === i)) c += nodes[i].price!;
    }
    const price = blockOf(this.level).price;
    if (this.newBlockAtStart(drag) && blockSpot(this.level, drag.sx, drag.sy)) c += price;
    if (this.design.findNode(drag.tx, drag.ty) < 0 && blockSpot(this.level, drag.tx, drag.ty)) c += price;
    return c;
  }

  /** The drag starts from an empty anchor spot. */
  private newBlockAtStart(drag: DragState): boolean {
    return drag.from < 0 && drag.fromSplit < 0;
  }

  /** Which bank's ground the point is on, at or behind the gap's edge where concrete anchors sit: -1 left, 1 right, 0 neither. */
  private groundSide(x: number, y: number): number {
    const L = this.level;
    if (x <= 1e-9 && Math.abs(y) < 1e-9) return -1;
    if (x >= L.width - 1e-9 && Math.abs(y - (L.rightY ?? 0)) < 1e-9) return 1;
    return 0;
  }

  /** Parts of the current material still allowed on this level, or null when there's no limit. */
  partsLeft(mat: MaterialId = this.mat): number | null {
    const max = this.level.limits?.[mat];
    return max === undefined ? null : Math.max(0, max - this.design.count(mat));
  }

  private problem(drag: DragState): string {
    const path = drag.path;
    const [sx, sy] = path[0];
    const [ex, ey] = path[path.length - 1];
    if (sx === ex && sy === ey) return 'Too short';
    const segs = path.length - 1;
    const mat = MATERIALS[this.mat];
    const left = this.left();
    if (drag.cost > left) return `Over budget by ${money(drag.cost - left)}`;
    const curved = !!mat.curved;
    if (curved && Math.abs(ex - sx) < MIN_MAIN_SPAN - 1e-9) return 'Needs 2 m of span';
    if (curved && segs === 1) return 'Too long';
    if (mat.cell === 'ring') {
      const ring = ringPath(this.design, [sx, sy], [ex, ey], ringRise(this.design, [sx, sy], [ex, ey]));
      if (!ring) return 'Too short';
      const partsLeft = this.partsLeft();
      if (partsLeft !== null && partsLeft < 1) return `Only ${this.level.limits![this.mat]} ${mat.name.toLowerCase()} parts on this level`;
      return ringProblem(this.level, this.design, ring);
    }
    // A run lays several parts; a single beam, or a main cable, is one.
    const newParts = this.runs ? path.length - 1 : 1;
    const partsLeft = this.partsLeft();
    if (partsLeft !== null && newParts > partsLeft) return `Only ${this.level.limits![this.mat]} ${mat.name.toLowerCase()} parts on this level`;
    const { nodes, members } = this.design;
    for (let i = 0; i < segs; i++) {
      const [ax, ay] = path[i];
      const [bx, by] = path[i + 1];
      const last = i === segs - 1;
      if (Math.hypot(bx - ax, by - ay) > mat.maxLen + 1e-9) return 'Too long';
      if (mat.maxGrade !== undefined && Math.abs(by - ay) > mat.maxGrade * Math.abs(bx - ax) + 1e-6) return `Too steep for a train: ${Math.round(mat.maxGrade * 100)}% at most`;
      // A main cable's own joints may hang low over an anchor strip as it rises from a block; nothing else may join them there.
      const low = lowOverStrip(this.level, bx, by);
      if (!(last && drag.toSplit >= 0) && !this.pointAllowed(bx, by) && !(curved && !last && low)) return 'Out of bounds';
      if (low && (i === 0 ? false : !curved || last)) return 'Out of bounds';
      if (i === 0 && lowOverStrip(this.level, ax, ay) && !curved) return 'Out of bounds';
      const ia = this.design.findNode(ax, ay);
      const ib = this.design.findNode(bx, by);
      if (ib < 0 && nodes.some((n) => Math.hypot(n.x - bx, n.y - by) < MIN_JOINT_GAP)) return 'Too close to a joint';
      if (curved && !last && ib >= 0) return 'Runs into a joint';
      if (ia >= 0 && ib >= 0 && this.design.findMember(ia, ib) >= 0) return 'Already joined';
      const ground = this.groundSide(ax, ay);
      if (ground && ground === this.groundSide(bx, by)) return 'Lies on the ground';
      for (const m of members) {
        const c = nodes[m.a];
        const e = nodes[m.b];
        if (segmentsOverlap(ax, ay, bx, by, c.x, c.y, e.x, e.y)) return MATERIALS[m.mat].drivable ? 'Overlaps the road' : 'Overlaps a beam';
      }
      if (crossesChannel(this.level, ax, ay, bx, by)) return 'Keep the channel clear';
      if (mat.tensionOnly && (cableBolt(this.level, ax, ay) || cableBolt(this.level, bx, by))) return 'Anchor cables in concrete';
      if (hitsCells(this.design, [ax, ay], [bx, by])) return 'Runs through a block';
    }
    return '';
  }

  /** Places the aimed member (or road run). Returns the end node index, or -1 if invalid. */
  commit(): number {
    if (this.sag) {
      this.commitSag();
      return -1;
    }
    const drag = this.drag;
    if (!drag) return -1;
    if (!drag.valid) {
      if (drag.tx !== drag.sx || drag.ty !== drag.sy) this.ev.invalid(drag.reason, drag.tx, drag.ty);
      this.drag = null;
      return -1;
    }
    this.snapshot();
    if (MATERIALS[this.mat].cell === 'ring') {
      const ring = ringPath(this.design, [drag.sx, drag.sy], [drag.tx, drag.ty], ringRise(this.design, [drag.sx, drag.sy], [drag.tx, drag.ty]))!;
      layRing(this.design, ring);
      this.ev.place(drag.sx, drag.sy, drag.tx, drag.ty, this.mat, 0, 1);
      this.drag = null;
      return -1;
    }
    // Splits keep existing member indices stable: the second piece is appended.
    const split = (member: number, x: number, y: number) => {
      const node = this.design.splitMember(member, x, y);
      this.ages.push(this.ages[member] ?? 10);
      return node;
    };
    let from = drag.fromSplit >= 0 ? split(drag.fromSplit, drag.sx, drag.sy) : drag.from >= 0 ? drag.from : this.design.ensureBlock(drag.sx, drag.sy);
    if (drag.toSplit >= 0) split(drag.toSplit, drag.tx, drag.ty);
    const path = drag.path;
    const count = path.length - 1;
    // A main cable's pieces are one part: it is placed, counted and removed whole.
    const part = MATERIALS[this.mat].curved ? this.design.newPart() : undefined;
    for (let i = 0; i < count; i++) {
      const [ax, ay] = path[i];
      const [bx, by] = path[i + 1];
      const to = blockSpot(this.level, bx, by) ? this.design.ensureBlock(bx, by) : this.design.ensureNode(bx, by);
      this.design.members.push(part === undefined ? { a: from, b: to, mat: this.mat } : { a: from, b: to, mat: this.mat, part });
      // Negative age delays the pop-in so a road run unrolls piece by piece.
      this.ages.push(-i * 0.07);
      this.ev.place(ax, ay, bx, by, this.mat, i, count);
      from = to;
    }
    this.drag = null;
    return from;
  }

  cancel(): void {
    this.drag = null;
    const s = this.sag;
    if (s) {
      s.chain.forEach((n, i) => (this.design.nodes[n].y = s.ys[i]));
      s.extra.forEach((n, i) => (this.design.nodes[n].y = s.eys[i]));
      this.sag = null;
    }
    this.endPaint();
  }

  /** Every main cable's sag handle, and every arch's rise handle. */
  sagHandles(): SagHandle[] {
    const handle = (part: number, mat: MaterialId, chain: number[], extra: number[]): SagHandle => {
      const [x, y] = sagHandle(this.design, chain);
      return { part, mat, chain, extra, x, y };
    };
    return [
      ...mainRuns(this.design)
        .filter(({ chain }) => chain.length > 2)
        .map(({ part, mat, chain }) => handle(part, mat, chain, [])),
      ...rings(this.design).map(({ part, intra, extra }) => handle(part, 'arch', intra, extra)),
    ];
  }

  /** The nearest sag handle within radius, or null. */
  sagHandleAt(wx: number, wy: number, radius: number): SagHandle | null {
    let best: SagHandle | null = null;
    let bd = radius;
    for (const h of this.sagHandles()) {
      const d = Math.hypot(h.x - wx, h.y - wy);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
  }

  /** Picks up a main cable by its sag handle. */
  beginSag(h: SagHandle): void {
    this.drag = null;
    const { nodes } = this.design;
    this.sag = { part: h.part, chain: h.chain, x: h.x, y: h.y, before: this.design.serialize(), ys: h.chain.map((n) => nodes[n].y), extra: h.extra, eys: h.extra.map((n) => nodes[n].y), valid: true, reason: '' };
  }

  /** Hangs the main cable being dragged so its handle comes as near height wy as it may. */
  aimSag(wy: number): void {
    const s = this.sag;
    if (!s) return;
    const { nodes } = this.design;
    const a = nodes[s.chain[0]];
    const b = nodes[s.chain[s.chain.length - 1]];
    const t = (s.x - a.x) / (b.x - a.x);
    const w = 4 * t * (1 - t);
    const chord = a.y + (b.y - a.y) * t;
    // Sag in tenths of a meter, so the handle steps like the grid does. An arch rises: its sag is negative.
    const dir = s.extra.length ? -1 : bow(this.design.members.find((m) => m.part === s.part)?.mat ?? 'main');
    const sag = dir * Math.max(MIN_SAG, Math.round(((dir * (chord - wy)) / w) * 10) / 10);
    resag(this.design, s.chain, sag);
    if (s.extra.length) settleRing(this.design, s.chain, s.extra);
    s.y = chord - w * sag;
    s.reason = this.sagProblem(s.chain, s.extra, s.part);
    s.valid = s.reason === '';
  }

  /** Moves the dragged sag handle up (positive) or down by dy meters. */
  nudgeSag(dy: number): void {
    if (this.sag) this.aimSag(this.sag.y + dy);
  }

  /** What is wrong with a main cable's joints where they hang now, or ''. */
  private sagProblem(chain: number[], extra: number[] = [], part = -1): string {
    const { nodes, members } = this.design;
    const moved = new Set([...chain.slice(1, -1), ...extra]);
    if (extra.length) {
      // An arch ring's blocks, against everything but each other.
      const own = new Set(this.design.cells.flatMap((c, k) => (c.part === part ? [k] : [])));
      for (const k of own) {
        const why = cellProblem(this.level, this.design, cellPoly(this.design, this.design.cells[k]), own);
        if (why && why !== 'Too close to a joint') return why;
      }
    }
    for (const i of moved) {
      const n = nodes[i];
      const onlyMain = members.every((m) => (m.a !== i && m.b !== i) || MATERIALS[m.mat].curved);
      if (!pointAllowed(this.level, n.x, n.y) && !(onlyMain && lowOverStrip(this.level, n.x, n.y))) return 'Out of bounds';
      if (nodes.some((o, j) => j !== i && Math.hypot(o.x - n.x, o.y - n.y) < MIN_JOINT_GAP)) return 'Too close to a joint';
    }
    for (const m of members) {
      if (!moved.has(m.a) && !moved.has(m.b)) continue;
      const [p, r] = [nodes[m.a], nodes[m.b]];
      if (Math.hypot(r.x - p.x, r.y - p.y) > MATERIALS[m.mat].maxLen + 1e-9) return MATERIALS[m.mat].curved ? (MATERIALS[m.mat].arch ? 'Too high' : 'Too deep') : 'A hanger would be too long';
      if (crossesChannel(this.level, p.x, p.y, r.x, r.y)) return 'Keep the channel clear';
      for (const o of members) {
        if (o === m || (o.part !== undefined && o.part === m.part)) continue;
        const [c, e] = [nodes[o.a], nodes[o.b]];
        if (segmentsOverlap(p.x, p.y, r.x, r.y, c.x, c.y, e.x, e.y)) return 'Overlaps a beam';
      }
    }
    const over = this.design.cost() - this.level.money;
    if (over > 0) return `Over budget by ${money(over)}`;
    return '';
  }

  /** Lets go of a sag handle: keeps the new sag if it is valid, or puts the cable back. */
  private commitSag(): void {
    const s = this.sag!;
    this.sag = null;
    const { nodes } = this.design;
    if (!s.valid) {
      s.chain.forEach((n, i) => (nodes[n].y = s.ys[i]));
      s.extra.forEach((n, i) => (nodes[n].y = s.eys[i]));
      this.ev.invalid(s.reason, s.x, s.y);
      return;
    }
    if (s.chain.every((n, i) => nodes[n].y === s.ys[i])) return;
    this.undoStack.push(s.before);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0;
    this.revision++;
  }

  /**
   * Removes a member. A piece of a split beam takes the whole beam with it, so the part is refunded.
   * A beam the removed one had split is joined back up where nothing else holds the joint.
   */
  removeMember(i: number): void {
    if (i < 0) return;
    this.snapshot();
    const { nodes, members } = this.design;
    // pieces() lists indices in ascending order; remove from the back so they stay valid.
    const pieces = this.design.pieces(i);
    const removed: Parameters<EditorEvents['remove']>[] = [];
    for (let j = pieces.length - 1; j >= 0; j--) {
      const k = pieces[j];
      const m = members[k];
      removed.push([nodes[m.a].x, nodes[m.a].y, nodes[m.b].x, nodes[m.b].y, m.mat]);
      this.ages.splice(k, 1);
      members.splice(k, 1);
    }
    this.design.pruneNodes();
    for (const k of this.design.healSplits()) this.ages.splice(k, 1);
    // Told only once the design has changed, so the budget shown includes the refund.
    for (const r of removed) this.ev.remove(...r);
  }

  clear(): void {
    if (this.design.members.length === 0 && this.design.cells.length === 0) return;
    this.snapshot();
    const { nodes, members } = this.design;
    this.design = new Design(this.level);
    this.ages = [];
    for (const m of members) this.ev.remove(nodes[m.a].x, nodes[m.a].y, nodes[m.b].x, nodes[m.b].y, m.mat);
  }

  /** The block or arch ring wedge under a point, or -1. */
  cellAt(wx: number, wy: number): number {
    return cellUnder(this.design, wx, wy);
  }

  /** Removes a block, or a whole arch ring with any of its wedges. */
  removeCell(k: number): void {
    const c = this.design.cells[k];
    if (!c) return;
    this.snapshot();
    this.dropCell(k);
  }

  private dropCell(k: number): void {
    const c = this.design.cells[k];
    const gone = c.mat === 'arch' && c.part !== undefined ? this.design.cells.filter((o) => o.part === c.part) : [c];
    const [x0, y0] = [this.design.nodes[c.n[0]].x, this.design.nodes[c.n[0]].y];
    const [x1, y1] = [this.design.nodes[c.n[2]].x, this.design.nodes[c.n[2]].y];
    this.design.cells = this.design.cells.filter((o) => !gone.includes(o));
    this.design.pruneNodes();
    this.ev.remove(x0, y0, x1, y1, c.mat);
  }

  /** What stops a 1 m block going in with its lower left corner at (x, y), or ''. */
  blockProblem(x: number, y: number): string {
    const why = cellProblem(this.level, this.design, blockPoly(x, y));
    if (why) return why;
    const price = MATERIALS[this.mat].price;
    if (price > this.left()) return `Over budget by ${money(price - this.left())}`;
    const left = this.partsLeft();
    if (left !== null && left < 1) return `Only ${this.level.limits![this.mat]} ${MATERIALS[this.mat].name.toLowerCase()} parts on this level`;
    return '';
  }

  /**
   * Starts painting concrete blocks at a point, a square meter at a time: on an empty square it
   * paints, on a block it erases. False if the brush isn't the material in hand.
   */
  beginPaint(wx: number, wy: number): boolean {
    if (MATERIALS[this.mat].cell !== 'brush') return false;
    this.drag = null;
    const on = this.cellAt(wx, wy);
    this.paint = { mode: on >= 0 && this.design.cells[on].mat === this.mat ? 'erase' : 'add', before: this.design.serialize(), changed: false, last: '' };
    this.paintAt(wx, wy, true);
    return true;
  }

  /** Paints or erases the square under a point. `first` reports why the first square couldn't be painted. */
  paintAt(wx: number, wy: number, first = false): void {
    const p = this.paint;
    if (!p) return;
    const [x, y] = [Math.floor(wx), Math.floor(wy)];
    const key = `${x} ${y}`;
    if (key === p.last) return;
    p.last = key;
    if (p.mode === 'erase') {
      const k = this.cellAt(x + 0.5, y + 0.5);
      if (k >= 0 && this.design.cells[k].mat === this.mat) {
        this.dropCell(k);
        p.changed = true;
      }
      return;
    }
    const why = this.blockProblem(x, y);
    if (why) {
      if (first || why.startsWith('Over budget')) this.ev.invalid(why, x + 0.5, y + 0.5);
      return;
    }
    addBlock(this.design, x, y);
    p.changed = true;
    this.ev.place(x, y, x + 1, y + 1, this.mat, 0, 1);
  }

  /** Ends a paint stroke: one undo step for all of it. */
  endPaint(): void {
    const p = this.paint;
    this.paint = null;
    if (!p?.changed) return;
    this.undoStack.push(p.before);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0;
    this.revision++;
  }

  undo(): boolean {
    const s = this.undoStack.pop();
    if (!s) return false;
    this.redoStack.push(this.design.serialize());
    this.restore(s);
    return true;
  }

  redo(): boolean {
    const s = this.redoStack.pop();
    if (!s) return false;
    this.undoStack.push(this.design.serialize());
    this.restore(s);
    return true;
  }

  private restore(s: string): void {
    this.drag = null;
    this.revision++;
    const before = this.design.members.length;
    this.design = Design.deserialize(s);
    // Prices aren't saved with the design: a block set after an undo costs what the level says.
    this.design.priceAnchors(this.level);
    const n = this.design.members.length;
    this.ages = this.design.members.map((_, i) => (i >= before ? 0 : 10));
    this.ages.length = n;
  }

  private snapshot(): void {
    this.revision++;
    this.undoStack.push(this.design.serialize());
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0;
  }
}
