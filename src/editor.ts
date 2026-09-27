import { Design, gridPath, segmentsOverlap, type GridPt } from './design';
import type { LevelDef } from './levels';
import { MATERIALS, type MaterialId } from './physics/materials';

export interface DragState {
  from: number;
  tx: number;
  ty: number;
  /** Grid points from the start node to the target; a road run spans several members. */
  path: GridPt[];
  valid: boolean;
  reason: string;
}

export interface EditorEvents {
  /** Fired once per member; a road run places `count` members in one go. */
  place(ax: number, ay: number, bx: number, by: number, mat: MaterialId, index: number, count: number): void;
  remove(ax: number, ay: number, bx: number, by: number, mat: MaterialId): void;
  invalid(reason: string, x: number, y: number): void;
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
        if (same) this.design = d;
      } catch {
        // Corrupt save: start fresh.
      }
    }
    this.ages = this.design.members.map(() => 10);
    this.cursorX = 0;
    this.cursorY = 0;
  }

  get topY(): number {
    return Math.max(4, ...this.level.anchors.map((a) => a[1] + 3));
  }

  remaining(mat: MaterialId): number {
    return this.level.budget[mat] - this.design.count(mat);
  }

  totalBudget(): number {
    const b = this.level.budget;
    return b.road + b.wood + b.steel;
  }

  tick(dt: number): void {
    for (let i = 0; i < this.ages.length; i++) this.ages[i] += dt;
  }

  setMaterial(mat: MaterialId): boolean {
    if (this.level.budget[mat] <= 0) return false;
    this.mat = mat;
    if (this.drag) this.aim(this.drag.tx, this.drag.ty);
    return true;
  }

  pointAllowed(x: number, y: number): boolean {
    if (this.design.findNode(x, y) >= 0) return true;
    if (x < 0 || x > this.level.width) return false;
    if (y > this.topY || y <= this.level.waterY + 0.5) return false;
    for (const [px, py] of this.level.piers) if (Math.abs(x - px) < 0.6 && y < py) return false;
    return true;
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

  begin(node: number): void {
    const n = this.design.nodes[node];
    this.drag = { from: node, tx: n.x, ty: n.y, path: [[n.x, n.y]], valid: false, reason: '' };
  }

  /** Road is laid in runs: one drag can span as many pieces as the budget allows. */
  private get runs(): boolean {
    return this.mat === 'road';
  }

  /** Snaps a raw world position to the best reachable grid point for the current drag. */
  aim(wx: number, wy: number): void {
    const drag = this.drag;
    if (!drag) return;
    const f = this.design.nodes[drag.from];
    const maxLen = MATERIALS[this.mat].maxLen;
    const pieces = this.runs ? Math.max(1, this.remaining(this.mat)) : 1;
    const reach = maxLen * pieces;
    const dx = wx - f.x;
    const dy = wy - f.y;
    const d = Math.hypot(dx, dy);
    let px = wx;
    let py = wy;
    if (d > reach) {
      px = f.x + (dx / d) * reach;
      py = f.y + (dy / d) * reach;
    }
    let bx = f.x;
    let by = f.y;
    let best = Infinity;
    for (let gx = Math.floor(px) - 1; gx <= Math.ceil(px) + 1; gx++) {
      for (let gy = Math.floor(py) - 1; gy <= Math.ceil(py) + 1; gy++) {
        const len = Math.hypot(gx - f.x, gy - f.y);
        if (len > reach + 1e-9 || len === 0) continue;
        const score = Math.hypot(gx - px, gy - py);
        if (score < best) {
          best = score;
          bx = gx;
          by = gy;
        }
      }
    }
    drag.tx = bx;
    drag.ty = by;
    const run = this.runs ? gridPath(f.x, f.y, bx, by, maxLen, pieces) : null;
    drag.path = run ?? [
      [f.x, f.y],
      [bx, by],
    ];
    drag.reason = this.problem(drag.path);
    drag.valid = drag.reason === '';
  }

  private problem(path: GridPt[]): string {
    const [sx, sy] = path[0];
    const [ex, ey] = path[path.length - 1];
    if (sx === ex && sy === ey) return 'Too short';
    const segs = path.length - 1;
    const left = this.remaining(this.mat);
    const name = MATERIALS[this.mat].name.toLowerCase();
    if (left <= 0) return `Out of ${name}`;
    if (segs > left) return `Only ${left} ${name} left`;
    const { nodes, members } = this.design;
    for (let i = 0; i < segs; i++) {
      const [ax, ay] = path[i];
      const [bx, by] = path[i + 1];
      if (Math.hypot(bx - ax, by - ay) > MATERIALS[this.mat].maxLen + 1e-9) return 'Too long';
      if (!this.pointAllowed(bx, by)) return 'Out of bounds';
      const ia = this.design.findNode(ax, ay);
      const ib = this.design.findNode(bx, by);
      if (ia >= 0 && ib >= 0 && this.design.findMember(ia, ib) >= 0) return 'Already joined';
      for (const m of members) {
        const c = nodes[m.a];
        const e = nodes[m.b];
        if (segmentsOverlap(ax, ay, bx, by, c.x, c.y, e.x, e.y)) return m.mat === 'road' ? 'Overlaps the road' : 'Overlaps a beam';
      }
    }
    return '';
  }

  /** Places the aimed member (or road run). Returns the end node index, or -1 if invalid. */
  commit(): number {
    const drag = this.drag;
    if (!drag) return -1;
    const f = this.design.nodes[drag.from];
    if (!drag.valid) {
      if (drag.tx !== f.x || drag.ty !== f.y) this.ev.invalid(drag.reason, drag.tx, drag.ty);
      this.drag = null;
      return -1;
    }
    this.snapshot();
    const path = drag.path;
    const count = path.length - 1;
    let from = drag.from;
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

  removeMember(i: number): void {
    if (i < 0) return;
    this.snapshot();
    const m = this.design.members[i];
    const a = this.design.nodes[m.a];
    const b = this.design.nodes[m.b];
    this.ev.remove(a.x, a.y, b.x, b.y, m.mat);
    this.ages.splice(i, 1);
    this.design.removeMember(i);
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
