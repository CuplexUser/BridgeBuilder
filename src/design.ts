import type { LevelDef } from './levels';
import { MATERIALS, type MaterialId } from './physics/materials';

export interface DNode {
  x: number;
  y: number;
  anchor: boolean;
}

export interface DMember {
  a: number;
  b: number;
  mat: MaterialId;
  /** Pieces split from one placed beam share a part id and count as one part. */
  part?: number;
}

export type GridPt = [number, number];

/** Joints closer than this are treated as the same point. */
const EPS = 1e-6;
/** Shortest piece a beam may be split into, in meters. */
export const MIN_PIECE = 0.25;

/** Rounds a coordinate to 0.1 mm so off-grid joints compare and serialize stably. */
export function q(v: number): number {
  return Math.round(v * 1e4) / 1e4 || 0;
}

/**
 * Splits a→b into the fewest pieces that each fit within maxLen. Every joint lies
 * exactly on the straight line, so a sloped run keeps one even grade. Joints land on
 * whole-meter x (or y, for steep runs) where that keeps pieces within limits, which gives
 * other beams convenient places to attach. Null if it needs more than maxSteps.
 */
export function roadPath(ax: number, ay: number, bx: number, by: number, maxLen: number, maxSteps: number): GridPt[] | null {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len === 0) return null;
  const n0 = Math.max(1, Math.ceil(len / maxLen - 1e-9));
  if (n0 > maxSteps) return null;
  const alongX = Math.abs(dx) >= Math.abs(dy);
  const fits = (pts: GridPt[]) => {
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (l < MIN_PIECE - 1e-9 || l > maxLen + 1e-9) return false;
    }
    return true;
  };
  for (let n = n0; n <= Math.min(maxSteps, n0 + 1); n++) {
    const pts: GridPt[] = [[ax, ay]];
    for (let i = 1; i < n; i++) {
      if (alongX) {
        const x = Math.round(ax + (dx * i) / n);
        pts.push([q(x), q(ay + (dy * (x - ax)) / dx)]);
      } else {
        const y = Math.round(ay + (dy * i) / n);
        pts.push([q(ax + (dx * (y - ay)) / dy), q(y)]);
      }
    }
    pts.push([bx, by]);
    if (fits(pts)) return pts;
  }
  // Evenly spaced fallback: always straight, always within limits.
  const pts: GridPt[] = [];
  for (let i = 0; i <= n0; i++) pts.push(i === 0 ? [ax, ay] : i === n0 ? [bx, by] : [q(ax + (dx * i) / n0), q(ay + (dy * i) / n0)]);
  return pts;
}

/** True when segments ab and cd are collinear and share more than a single point. */
export function segmentsOverlap(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const ux = bx - ax;
  const uy = by - ay;
  const L = Math.hypot(ux, uy);
  const c1 = (ux * (cy - ay) - uy * (cx - ax)) / L;
  const c2 = (ux * (dy - ay) - uy * (dx - ax)) / L;
  if (Math.abs(c1) > 1e-4 || Math.abs(c2) > 1e-4) return false;
  const L2 = L * L;
  const tc = ((cx - ax) * ux + (cy - ay) * uy) / L2;
  const td = ((dx - ax) * ux + (dy - ay) * uy) / L2;
  return Math.min(1, Math.max(tc, td)) - Math.max(0, Math.min(tc, td)) > 1e-4;
}

/**
 * True when segment ab passes through the open rectangle (x0, x1) × (y0, y1).
 * Touching an edge or corner doesn't count, so a deck can run along the top of a channel.
 */
export function segmentHitsRect(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number): boolean {
  const e = 1e-6;
  // Liang–Barsky clip against the slightly shrunk rectangle.
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const edges: [number, number][] = [
    [-dx, ax - (x0 + e)],
    [dx, x1 - e - ax],
    [-dy, ay - (y0 + e)],
    [dy, y1 - e - ay],
  ];
  for (const [p, dist] of edges) {
    if (p === 0) {
      if (dist < 0) return false;
    } else {
      const r = dist / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return false;
    }
  }
  return t1 - t0 > e;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** A bridge blueprint: nodes (usually on the grid) plus the members joining them. */
export class Design {
  nodes: DNode[] = [];
  members: DMember[] = [];

  constructor(level?: LevelDef) {
    if (level) for (const [x, y] of level.anchors) this.nodes.push({ x, y, anchor: true });
  }

  findNode(x: number, y: number): number {
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (Math.abs(n.x - x) < EPS && Math.abs(n.y - y) < EPS) return i;
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
    this.nodes.push({ x: q(x), y: q(y), anchor: false });
    return this.nodes.length - 1;
  }

  /** Parts placed, per material: a beam split into pieces still counts once. */
  count(mat: MaterialId): number {
    let c = 0;
    const parts = new Set<number>();
    for (const m of this.members) {
      if (m.mat !== mat) continue;
      if (m.part === undefined) c++;
      else if (!parts.has(m.part)) {
        parts.add(m.part);
        c++;
      }
    }
    return c;
  }

  /** Length of member i, in meters. */
  length(i: number): number {
    const m = this.members[i];
    const a = this.nodes[m.a];
    const b = this.nodes[m.b];
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  /** What the design costs to build. Splitting a beam doesn't change its length, so it is free. */
  cost(): number {
    let c = 0;
    for (let i = 0; i < this.members.length; i++) c += this.length(i) * MATERIALS[this.members[i].mat].price;
    return Math.round(c);
  }

  /** Total parts across all materials. */
  parts(): number {
    let c = 0;
    const parts = new Set<number>();
    for (const m of this.members) {
      if (m.part === undefined) c++;
      else if (!parts.has(m.part)) {
        parts.add(m.part);
        c++;
      }
    }
    return c;
  }

  /**
   * Points along member i where a new joint may go: the quarter points plus any whole-meter
   * grid points it passes through, keeping every piece at least MIN_PIECE long.
   */
  attachPoints(i: number): GridPt[] {
    const m = this.members[i];
    const a = this.nodes[m.a];
    const b = this.nodes[m.b];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const ts = [0.25, 0.5, 0.75];
    if (Number.isInteger(a.x) && Number.isInteger(a.y) && Number.isInteger(dx) && Number.isInteger(dy)) {
      const g = gcd(Math.abs(dx), Math.abs(dy));
      for (let k = 1; k < g; k++) ts.push(k / g);
    }
    const out: GridPt[] = [];
    for (const t of ts) {
      if (t * len < MIN_PIECE - 1e-9 || (1 - t) * len < MIN_PIECE - 1e-9) continue;
      const p: GridPt = [q(a.x + dx * t), q(a.y + dy * t)];
      if (!out.some(([x, y]) => Math.abs(x - p[0]) < EPS && Math.abs(y - p[1]) < EPS)) out.push(p);
    }
    return out;
  }

  /**
   * Splits member i at (x, y) into two pieces of the same part. The first piece stays at
   * index i and the second is appended, so other member indices are unchanged. Returns the new joint.
   */
  splitMember(i: number, x: number, y: number): number {
    const m = this.members[i];
    const mid = this.ensureNode(x, y);
    if (m.part === undefined) {
      let next = 0;
      for (const o of this.members) if (o.part !== undefined) next = Math.max(next, o.part + 1);
      m.part = next;
    }
    const b = m.b;
    m.b = mid;
    this.members.push({ a: mid, b, mat: m.mat, part: m.part });
    return mid;
  }

  /** True when members run the whole way from a to b along that straight line, in one piece or several. */
  covers(a: GridPt, b: GridPt): boolean {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy;
    if (L2 === 0) return false;
    const L = Math.sqrt(L2);
    const on = (n: DNode) => {
      const t = ((n.x - a[0]) * dx + (n.y - a[1]) * dy) / L2;
      return Math.abs((n.x - a[0]) * dy - (n.y - a[1]) * dx) / L < 1e-4 && t > -1e-6 && t < 1 + 1e-6;
    };
    let total = 0;
    for (const m of this.members) {
      const na = this.nodes[m.a];
      const nb = this.nodes[m.b];
      if (on(na) && on(nb)) total += Math.hypot(nb.x - na.x, nb.y - na.y);
    }
    return total >= L - 1e-4;
  }

  /** Member i and every other piece split from the same beam. */
  pieces(i: number): number[] {
    const part = this.members[i].part;
    if (part === undefined) return [i];
    const out: number[] = [];
    this.members.forEach((m, k) => m.part === part && out.push(k));
    return out;
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

  /** Convenience for tests and hints: add a member between two points. */
  add(a: [number, number], b: [number, number], mat: MaterialId): this {
    const ia = this.ensureNode(a[0], a[1]);
    const ib = this.ensureNode(b[0], b[1]);
    if (this.findMember(ia, ib) < 0) this.members.push({ a: ia, b: ib, mat });
    return this;
  }
}
