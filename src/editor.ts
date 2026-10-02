import { Design, segmentsOverlap, type GridPt } from './design';
import type { LevelDef } from './levels';
import { MATERIALS, type MaterialId } from './physics/materials';
import { crossesChannel, MIN_JOINT_GAP, pointAllowed, topY } from './rules';

export interface DragState {
  /** Start node index, or -1 when the drag starts from a point on a beam that will be split. */
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
  cursorX = 0;
  cursorY = 0;
  /** Seconds since each member was placed, parallel to design.members. */
  ages: number[] = [];
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  constructor(level: LevelDef, private ev: EditorEvents, saved?: string) {
    this.level = level;
    this.design = new Design(level);
    if (saved) {
      try {
        const d = Design.deserialize(saved);
        const anchors = d.nodes.filter((n) => n.anchor);
        const same = anchors.length === level.anchors.length && level.anchors.every(([x, y]) => anchors.some((n) => n.x === x && n.y === y));
        // Prices, budgets and materials may have changed since the design was saved.
        const affordable = d.cost() <= level.money && d.members.every((m) => level.materials.includes(m.mat));
        if (same && affordable) {
          d.priceAnchors(level);
          this.design = d;
        }
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
    return this.design.findNode(x, y) >= 0 || pointAllowed(this.level, x, y);
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

  /** Starts a drag at a node, or failing that at a beam attach point. Returns what was picked. */
  beginAt(wx: number, wy: number, nodeRadius: number, attachRadius: number): 'node' | 'split' | null {
    const node = this.nodeAt(wx, wy, nodeRadius);
    if (node >= 0) {
      this.begin(node);
      return 'node';
    }
    const p = this.attachAt(wx, wy, attachRadius);
    if (p) {
      this.beginSplit(p);
      return 'split';
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
    const reach = maxLen * pieces;
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
    const near = this.attachAt(px, py, 1.5, drag.fromSplit);
    if (near) consider(near.x, near.y, JOINT_BONUS, near.member);
    drag.tx = bx;
    drag.ty = by;
    drag.toSplit = split;
    const run = this.runs ? this.design.runPath(fx, fy, bx, by, maxLen, pieces) : null;
    drag.path = run ?? [
      [fx, fy],
      [bx, by],
    ];
    let len = 0;
    for (let i = 1; i < drag.path.length; i++) len += Math.hypot(drag.path[i][0] - drag.path[i - 1][0], drag.path[i][1] - drag.path[i - 1][1]);
    drag.cost = Math.round(len * MATERIALS[this.mat].price) + this.newAnchorCost(drag);
    drag.reason = this.problem(drag);
    drag.valid = drag.reason === '';
  }

  /** What any paid anchor this drag starts using would add to the bill. */
  private newAnchorCost(drag: DragState): number {
    const { nodes, members } = this.design;
    let c = 0;
    for (const i of new Set([drag.from, this.design.findNode(drag.tx, drag.ty)])) {
      if (i >= 0 && nodes[i].price && !members.some((m) => m.a === i || m.b === i)) c += nodes[i].price!;
    }
    return c;
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
    // A run lays several parts; a single beam is one.
    const newParts = this.runs ? path.length - 1 : 1;
    const partsLeft = this.partsLeft();
    if (partsLeft !== null && newParts > partsLeft) return `Only ${this.level.limits![this.mat]} ${mat.name.toLowerCase()} parts on this level`;
    const { nodes, members } = this.design;
    for (let i = 0; i < segs; i++) {
      const [ax, ay] = path[i];
      const [bx, by] = path[i + 1];
      const last = i === segs - 1;
      if (Math.hypot(bx - ax, by - ay) > mat.maxLen + 1e-9) return 'Too long';
      if (!(last && drag.toSplit >= 0) && !this.pointAllowed(bx, by)) return 'Out of bounds';
      const ia = this.design.findNode(ax, ay);
      const ib = this.design.findNode(bx, by);
      if (ib < 0 && nodes.some((n) => Math.hypot(n.x - bx, n.y - by) < MIN_JOINT_GAP)) return 'Too close to a joint';
      if (ia >= 0 && ib >= 0 && this.design.findMember(ia, ib) >= 0) return 'Already joined';
      for (const m of members) {
        const c = nodes[m.a];
        const e = nodes[m.b];
        if (segmentsOverlap(ax, ay, bx, by, c.x, c.y, e.x, e.y)) return MATERIALS[m.mat].drivable ? 'Overlaps the road' : 'Overlaps a beam';
      }
      if (crossesChannel(this.level, ax, ay, bx, by)) return 'Keep the channel clear';
    }
    return '';
  }

  /** Places the aimed member (or road run). Returns the end node index, or -1 if invalid. */
  commit(): number {
    const drag = this.drag;
    if (!drag) return -1;
    if (!drag.valid) {
      if (drag.tx !== drag.sx || drag.ty !== drag.sy) this.ev.invalid(drag.reason, drag.tx, drag.ty);
      this.drag = null;
      return -1;
    }
    this.snapshot();
    // Splits keep existing member indices stable: the second piece is appended.
    const split = (member: number, x: number, y: number) => {
      const node = this.design.splitMember(member, x, y);
      this.ages.push(this.ages[member] ?? 10);
      return node;
    };
    let from = drag.fromSplit >= 0 ? split(drag.fromSplit, drag.sx, drag.sy) : drag.from;
    if (drag.toSplit >= 0) split(drag.toSplit, drag.tx, drag.ty);
    const path = drag.path;
    const count = path.length - 1;
    for (let i = 0; i < count; i++) {
      const [ax, ay] = path[i];
      const [bx, by] = path[i + 1];
      const to = this.design.ensureNode(bx, by);
      this.design.members.push({ a: from, b: to, mat: this.mat });
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
    for (let j = pieces.length - 1; j >= 0; j--) {
      const k = pieces[j];
      const m = members[k];
      this.ev.remove(nodes[m.a].x, nodes[m.a].y, nodes[m.b].x, nodes[m.b].y, m.mat);
      this.ages.splice(k, 1);
      members.splice(k, 1);
    }
    this.design.pruneNodes();
    for (const k of this.design.healSplits()) this.ages.splice(k, 1);
  }

  clear(): void {
    if (this.design.members.length === 0) return;
    this.snapshot();
    const { nodes } = this.design;
    for (const m of this.design.members) {
      this.ev.remove(nodes[m.a].x, nodes[m.a].y, nodes[m.b].x, nodes[m.b].y, m.mat);
    }
    this.design = new Design(this.level);
    this.ages = [];
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
    const before = this.design.members.length;
    this.design = Design.deserialize(s);
    const n = this.design.members.length;
    this.ages = this.design.members.map((_, i) => (i >= before ? 0 : 10));
    this.ages.length = n;
  }

  private snapshot(): void {
    this.undoStack.push(this.design.serialize());
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0;
  }
}
