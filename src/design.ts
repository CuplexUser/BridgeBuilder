import type { LevelDef } from './levels';
import type { MaterialId } from './physics/materials';

export interface DNode {
  x: number;
  y: number;
  anchor: boolean;
}

export interface DMember {
  a: number;
  b: number;
  mat: MaterialId;
}

export type GridPt = [number, number];

/**
 * Splits a→b into the fewest grid-aligned steps that each fit within maxLen,
 * following the straight line as closely as the grid allows. Null if it needs more than maxSteps.
 */
export function gridPath(ax: number, ay: number, bx: number, by: number, maxLen: number, maxSteps: number): GridPt[] | null {
  const len = Math.hypot(bx - ax, by - ay);
  if (len === 0) return null;
  for (let n = Math.max(1, Math.ceil(len / maxLen - 1e-9)); n <= maxSteps; n++) {
    const pts: GridPt[] = [[ax, ay]];
    let ok = true;
    for (let i = 1; i <= n; i++) {
      const p: GridPt = [Math.round(ax + ((bx - ax) * i) / n) || 0, Math.round(ay + ((by - ay) * i) / n) || 0];
      const q = pts[pts.length - 1];
      const l = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (l === 0 || l > maxLen + 1e-9) {
        ok = false;
        break;
      }
      pts.push(p);
    }
    if (ok) return pts;
  }
  return null;
}

/** True when segments ab and cd are collinear and share more than a single point. */
export function segmentsOverlap(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const ux = bx - ax;
  const uy = by - ay;
  const c1 = ux * (cy - ay) - uy * (cx - ax);
  const c2 = ux * (dy - ay) - uy * (dx - ax);
  if (Math.abs(c1) > 1e-9 || Math.abs(c2) > 1e-9) return false;
  const L2 = ux * ux + uy * uy;
  const tc = ((cx - ax) * ux + (cy - ay) * uy) / L2;
  const td = ((dx - ax) * ux + (dy - ay) * uy) / L2;
  return Math.min(1, Math.max(tc, td)) - Math.max(0, Math.min(tc, td)) > 1e-6;
}

/** A bridge blueprint: grid-aligned nodes plus the members joining them. */
export class Design {
  nodes: DNode[] = [];
  members: DMember[] = [];

  constructor(level?: LevelDef) {
    if (level) for (const [x, y] of level.anchors) this.nodes.push({ x, y, anchor: true });
  }

  findNode(x: number, y: number): number {
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (n.x === x && n.y === y) return i;
    }
    return -1;
  }

  findMember(a: number, b: number): number {
    for (let i = 0; i < this.members.length; i++) {
      const m = this.members[i];
      if ((m.a === a && m.b === b) || (m.a === b && m.b === a)) return i;
    }
    return -1;
  }

  ensureNode(x: number, y: number): number {
    const i = this.findNode(x, y);
    if (i >= 0) return i;
    this.nodes.push({ x, y, anchor: false });
    return this.nodes.length - 1;
  }

  count(mat: MaterialId): number {
    let c = 0;
    for (const m of this.members) if (m.mat === mat) c++;
    return c;
  }

  removeMember(i: number): void {
    this.members.splice(i, 1);
    this.pruneNodes();
  }

  /** Drops free nodes that no member uses, remapping member indices. */
  pruneNodes(): void {
    const used = new Uint8Array(this.nodes.length);
    for (const m of this.members) used[m.a] = used[m.b] = 1;
    const remap = new Int32Array(this.nodes.length);
    const kept: DNode[] = [];
    for (let i = 0; i < this.nodes.length; i++) {
      if (this.nodes[i].anchor || used[i]) {
        remap[i] = kept.length;
        kept.push(this.nodes[i]);
      } else remap[i] = -1;
    }
    for (const m of this.members) {
      m.a = remap[m.a];
      m.b = remap[m.b];
    }
    this.nodes = kept;
  }

  serialize(): string {
    return JSON.stringify({ n: this.nodes, m: this.members });
  }

  static deserialize(s: string): Design {
    const d = new Design();
    const o = JSON.parse(s) as { n: DNode[]; m: DMember[] };
    d.nodes = o.n;
    d.members = o.m;
    return d;
  }

  /** Convenience for tests and hints: add a member between two grid points. */
  add(a: [number, number], b: [number, number], mat: MaterialId): this {
    const ia = this.ensureNode(a[0], a[1]);
    const ib = this.ensureNode(b[0], b[1]);
    if (this.findMember(ia, ib) < 0) this.members.push({ a: ia, b: ib, mat });
    return this;
  }
}
