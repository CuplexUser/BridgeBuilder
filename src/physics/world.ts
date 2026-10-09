import { segmentHitsRect, type Design } from '../design';
import { bankY, goalX, seatPiers, START_X, type LevelDef } from '../levels';
import { BLOCK, compressionLimit, MAST, MATERIALS, type MaterialId } from './materials';
import { StressLog } from './stresslog';
import { VEHICLES, type VehicleDef } from './vehicles';

/**
 * Bump whenever a change here, or in materials or vehicles, alters how a bridge behaves:
 * the tuned levels (npm run tune) record it and go stale when it moves.
 */
export const PHYSICS_VERSION = 3;

export const GRAVITY = -9.81;
export const STEP = 1 / 60;
const SUBSTEPS = 24;
const AXIAL_DAMPING = 40; // 1/s, relative axial velocity bleed on bridge members
const AIR_DAMPING = 0.05;
const JOINT_MASS = 6;
const STRESS_SMOOTHING = 0.3;
const SETTLE_TIME = 0.8;
/**
 * A joint fails when the stress ratios of the members meeting there, apart from the two
 * busiest, add up to this. Load passing straight through is fine; a knot of busy members isn't.
 */
export const JOINT_LIMIT = 1.8;
/** Space between one vehicle's front and the next one's back in a convoy, m. */
const CONVOY_GAP = 3.5;

/** Drawbridge timeline, s: open, let the ship through, close, then traffic may go. */
export const OPEN_TIME = 3;
export const SHIP_TIME = 5;
export const CLOSE_TIME = 3;
/** Half the tall ship's beam, m: it sails through the bridge's plane, bow on, at the channel's middle. */
export const SHIP_HALF = 1.2;
/** A seated joint this far above its pier, m, has lifted off and is no longer held. */
const SEAT_SLACK = 1e-3;
/** A member sunk this far below a seat, m, has gone under the pier top rather than onto it. */
const REST_DEPTH = 0.5;

export interface Link {
  a: number;
  b: number;
  rest: number;
  compliance: number;
  /** Bridge members come from the design; vehicle links hold the chassis together. */
  bridge: boolean;
  mat: MaterialId | null;
  /** Cables: pushes nothing, so the constraint only acts when stretched. */
  tensionOnly: boolean;
  /** Vehicles drive on it. */
  drivable: boolean;
  /** Index into Design.members, or -1. */
  member: number;
  broken: boolean;
  strain: number;
  /** Signed, smoothed load ratio: >0 tension, <0 compression, |s| ≥ 1 breaks. */
  stress: number;
  tensionLimit: number;
  compressionLimit: number;
  /** Seconds since placement, used by the renderer for the settle wobble. */
  age: number;
  /** Weight of the heaviest vehicle whose wheel touched this deck piece this step, tonnes. */
  pressTonnes: number;
  /** A vehicle over the deck's rating stood on it, so it is being crushed. */
  crushed: boolean;
  /** Weight of the vehicle that crushed it, tonnes. */
  crushedBy: number;
  /** Length as built; rams change `rest` from it as a drawbridge opens. */
  base: number;
  /** Share of its built length a ram extends by when the bridge is fully open. */
  stroke: number;
}

/** A joint resting on a pier top at (x, y). */
export interface Seat {
  p: number;
  x: number;
  y: number;
}

/** A member that crosses a pier top at (x, y) between its ends, and rests on it there. */
export interface Rest {
  link: Link;
  x: number;
  y: number;
}

/**
 * Bending stiffness across a deck joint: keeps joint b at its rest offset from the line a→c,
 * so a wheel load at one joint is shared with its neighbors. Yields past `limit` like a hinge.
 */

export interface Bend {
  a: number;
  b: number;
  c: number;
  /** Signed offset of b from the line a→c when built. */
  rest: number;
  compliance: number;
  /** Largest sideways force (N) the joint carries. */
  limit: number;
  /** The two deck pieces; the bend is gone once either breaks. */
  ab: Link;
  bc: Link;
}

/** A concrete anchor: bolted down while it holds, a heavy free mass dragging over the bank once it tears loose. */
export interface Block {
  /** Its joint: the bolt on top. */
  p: number;
  /** Where it was set, its bolt flush with the ground. */
  x0: number;
  ground: number;
  /** Signed, smoothed share of what it can hold, 0 to 1: it tears loose at 1. */
  util: number;
  /** Highest utilization so far. */
  peak: number;
  loose: boolean;
}

export interface BreakEvent {
  link: Link;
  x: number;
  y: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  vx: number;
  vy: number;
}

/**
 * Point masses joined by compliant distance constraints, solved with small-step
 * XPBD. The bridge and the vehicle live in the same particle arrays so load
 * flows both ways through wheel contacts.
 */
export class World {
  count = 0;
  x: Float64Array;
  y: Float64Array;
  px: Float64Array;
  py: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  im: Float64Array;
  radius: Float64Array;
  drive: Float64Array; // target speed for driven wheels (0 = free)
  accel: Float64Array;
  contact: Uint8Array;
  cnx: Float64Array;
  cny: Float64Array;
  links: Link[] = [];
  bends: Bend[] = [];
  /** Static segments (x1, y1, x2, y2) for the banks and piers. */
  terrain: number[] = [];
  /** Joints resting on a pier with no bolt: held there while they bear down, free once they lift. */
  seats: Seat[] = [];
  /** Members passing over a pier with no bolt: borne up there while they bear down, free once they lift. */
  rests: Rest[] = [];
  breaks: BreakEvent[] = [];
  /** Concrete anchors set into the banks. */
  blocks: Block[] = [];
  /** Hinged masts: the fixed joint at the foot and the bolt on top, which tips freely. */
  masts: { base: number; top: number }[] = [];
  /** Concrete anchors that tore loose, by index into blocks, for effects to pick up. */
  loosened: number[] = [];
  /** Left bank's x edge and the right bank's x edge and height, for blocks dragged over the ground. */
  banks = { width: 0, rightY: 0 };
  floorY: number;
  /** Scaled 0→1 at the start of a run so the bridge takes its own weight gently. */
  gravityScale = 1;
  /** Weight of the vehicle each particle belongs to, tonnes (0 for the bridge), checked against deck ratings. */
  tonnes: Float64Array;
  /** How far open a drawbridge is, 0 closed to 1 open; rams follow it. */
  openness = 0;
  /** Summed stress ratio of the members meeting at each joint. */
  jointLoad: Float64Array;
  /** Particles 0..bridgeCount-1 are the bridge's joints; vehicles come after. */
  bridgeCount = 0;
  /** Members meeting at each free joint (anchors are bolted down and never fail). */
  jointLinks: Link[][] = [];

  constructor(capacity: number, floorY: number) {
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.px = new Float64Array(capacity);
    this.py = new Float64Array(capacity);
    this.vx = new Float64Array(capacity);
    this.vy = new Float64Array(capacity);
    this.im = new Float64Array(capacity);
    this.radius = new Float64Array(capacity);
    this.drive = new Float64Array(capacity);
    this.accel = new Float64Array(capacity);
    this.contact = new Uint8Array(capacity);
    this.cnx = new Float64Array(capacity);
    this.cny = new Float64Array(capacity);
    this.tonnes = new Float64Array(capacity);
    this.jointLoad = new Float64Array(capacity);
    this.floorY = floorY;
  }

  addParticle(x: number, y: number, mass: number, radius = 0): number {
    const i = this.count++;
    this.x[i] = this.px[i] = x;
    this.y[i] = this.py[i] = y;
    this.im[i] = mass > 0 ? 1 / mass : 0;
    this.radius[i] = radius;
    return i;
  }

  addLink(a: number, b: number, compliance: number, opts: Partial<Link> = {}): Link {
    const rest = Math.hypot(this.x[b] - this.x[a], this.y[b] - this.y[a]);
    const l: Link = {
      a,
      b,
      rest,
      compliance,
      bridge: false,
      mat: null,
      tensionOnly: false,
      drivable: false,
      member: -1,
      broken: false,
      strain: 0,
      stress: 0,
      tensionLimit: Infinity,
      compressionLimit: Infinity,
      age: 0,
      pressTonnes: 0,
      crushed: false,
      crushedBy: 0,
      base: rest,
      stroke: 0,
      ...opts,
    };
    this.links.push(l);
    return l;
  }

  step(dt: number = STEP): void {
    const h = dt / SUBSTEPS;
    const n = this.count;
    const { x, y, px, py, vx, vy, im } = this;
    const links = this.links;
    const air = Math.max(0, 1 - AIR_DAMPING * h);
    const g = GRAVITY * this.gravityScale;
    for (const l of links) if (l.stroke) l.rest = l.base * (1 + l.stroke * this.openness);

    for (let s = 0; s < SUBSTEPS; s++) {
      for (let i = 0; i < n; i++) {
        px[i] = x[i];
        py[i] = y[i];
        if (im[i] === 0) continue;
        vy[i] += g * h;
        x[i] += vx[i] * h;
        y[i] += vy[i] * h;
      }

      const invH2 = 1 / (h * h);
      for (let k = 0; k < links.length; k++) {
        const l = links[k];
        if (l.broken) continue;
        const a = l.a;
        const b = l.b;
        const w = im[a] + im[b];
        if (w === 0) continue;
        const dx = x[b] - x[a];
        const dy = y[b] - y[a];
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-9) continue;
        const C = len - l.rest;
        if (C < 0 && l.tensionOnly) continue;
        const alpha = l.compliance * invH2;
        const dl = -C / (w + alpha);
        const nx = dx / len;
        const ny = dy / len;
        x[a] -= nx * dl * im[a];
        y[a] -= ny * dl * im[a];
        x[b] += nx * dl * im[b];
        y[b] += ny * dl * im[b];
      }

      this.solveBends(h);
      this.solveContacts();
      this.solveSeats();
      this.solveBlocks();

      const invH = 1 / h;
      for (let i = 0; i < n; i++) {
        if (im[i] === 0) continue;
        vx[i] = (x[i] - px[i]) * invH * air;
        vy[i] = (y[i] - py[i]) * invH * air;
      }

      this.applyDrive(h);
      this.dampMembers(h);
    }

    // Particles that fell far below the water are parked so they cost nothing.
    for (let i = 0; i < n; i++) {
      if (y[i] < this.floorY && im[i] !== 0) {
        y[i] = py[i] = this.floorY;
        vx[i] = vy[i] = 0;
        im[i] = 0;
      }
    }

    this.updateStress(dt);
    this.updateBlocks();
  }

  /** Height of the ground under x, or -Infinity over the gap: a block dragged off the edge falls in. */
  private groundAt(x: number): number {
    if (x <= 0) return 0;
    if (x >= this.banks.width) return this.banks.rightY;
    return -Infinity;
  }

  /**
   * A loose block can't sink into the bank, and drags along it against friction. Dragged out of
   * its pit, it rides up the pit's edge onto the ground.
   */
  private solveBlocks(): void {
    const { x, y, px } = this;
    for (const b of this.blocks) {
      if (!b.loose) continue;
      const p = b.p;
      const out = Math.min(1, Math.abs(x[p] - b.x0) / BLOCK.width);
      const g = this.groundAt(x[p]) + BLOCK.depth * out;
      const sink = g - y[p];
      if (sink <= 0) continue;
      y[p] = g;
      // Kinetic friction: the slide this substep shrinks by friction times how hard it pressed in.
      const slide = x[p] - px[p];
      const grip = BLOCK.sliding * sink;
      x[p] = Math.abs(slide) <= grip ? px[p] : x[p] - Math.sign(slide) * grip;
    }
  }

  /**
   * Adds up what the members pull on each concrete anchor. Its weight holds it down against
   * lift, and friction under it plus the soil packed against it hold it against a sideways
   * pull; lifting it also takes weight off the friction. Past either, it tears loose.
   */
  private updateBlocks(): void {
    if (!this.blocks.length) return;
    const { x, y } = this;
    const weight = BLOCK.mass * -GRAVITY;
    for (const [i, b] of this.blocks.entries()) {
      if (b.loose) continue;
      const p = b.p;
      let fx = 0;
      let fy = 0;
      for (const l of this.links) {
        if (!l.bridge || l.broken || (l.a !== p && l.b !== p)) continue;
        const o = l.a === p ? l.b : l.a;
        const dx = x[o] - x[p];
        const dy = y[o] - y[p];
        const len = Math.hypot(dx, dy) || 1;
        const f = MATERIALS[l.mat!].EA * l.strain;
        fx += (f * dx) / len;
        fy += (f * dy) / len;
      }
      const lift = fy / weight;
      const hold = Math.max(0, BLOCK.friction * (weight - fy)) + BLOCK.bearing;
      const ratio = Math.max(lift, Math.abs(fx) / hold);
      b.util += (ratio - b.util) * STRESS_SMOOTHING;
      b.peak = Math.max(b.peak, b.util);
      if (b.util >= 1) {
        b.loose = true;
        this.im[p] = 1 / BLOCK.mass;
        this.loosened.push(i);
      }
    }
  }

  private solveBends(h: number): void {
    const { x, y, im } = this;
    const h2 = h * h;
    for (const k of this.bends) {
      if (k.ab.broken || k.bc.broken) continue;
      const { a, b, c } = k;
      const ux = x[c] - x[a];
      const uy = y[c] - y[a];
      const L2 = ux * ux + uy * uy;
      if (L2 < 1e-12) continue;
      const L = Math.sqrt(L2);
      // Unit normal to a→c, and where b projects onto it.
      const nx = -uy / L;
      const ny = ux / L;
      const t = ((x[b] - x[a]) * ux + (y[b] - y[a]) * uy) / L2;
      const C = (x[b] - x[a]) * nx + (y[b] - y[a]) * ny - k.rest;
      const wa = im[a] * (1 - t) * (1 - t);
      const wc = im[c] * t * t;
      const w = im[b] + wa + wc;
      if (w === 0) continue;
      let dl = -C / (w + k.compliance / h2);
      // Past its limit the joint yields: it passes on at most `limit` newtons.
      const cap = k.limit * h2;
      if (dl > cap) dl = cap;
      else if (dl < -cap) dl = -cap;
      x[b] += nx * dl * im[b];
      y[b] += ny * dl * im[b];
      x[a] -= nx * dl * im[a] * (1 - t);
      y[a] -= ny * dl * im[a] * (1 - t);
      x[c] -= nx * dl * im[c] * t;
      y[c] -= ny * dl * im[c] * t;
    }
  }

  /**
   * A seated joint can't sink into its pier or slide off it, and a member crossing a seat can't
   * sink into it, though it may slide along it. Nothing holds either down.
   */
  private solveSeats(): void {
    const { x, y, im } = this;
    for (const s of this.seats) {
      if (y[s.p] > s.y + SEAT_SLACK) continue;
      if (y[s.p] < s.y) y[s.p] = s.y;
      x[s.p] = s.x;
    }
    for (const r of this.rests) {
      const { a, b, broken } = r.link;
      if (broken) continue;
      const dx = x[b] - x[a];
      if (Math.abs(dx) < 1e-9) continue;
      // Where along the member the seat sits, and how far below the seat the member is there.
      const t = (r.x - x[a]) / dx;
      if (t <= 0 || t >= 1) continue;
      const sink = r.y - (y[a] + (y[b] - y[a]) * t);
      if (sink <= 0 || sink > REST_DEPTH) continue;
      const wa = im[a] * (1 - t);
      const wb = im[b] * t;
      const w = wa * (1 - t) + wb * t;
      if (w === 0) continue;
      y[a] += (wa * sink) / w;
      y[b] += (wb * sink) / w;
    }
  }

  private solveContacts(): void {
    const { x, y, radius, contact, cnx, cny } = this;
    const links = this.links;
    const t = this.terrain;
    for (let p = 0; p < this.count; p++) {
      const r = radius[p];
      if (r === 0) continue;
      contact[p] = 0;
      for (let k = 0; k < links.length; k++) {
        const l = links[k];
        if (l.broken || !l.drivable) continue;
        this.contactSegment(p, r, x[l.a], y[l.a], x[l.b], y[l.b], l.a, l.b, l);
      }
      for (let k = 0; k < t.length; k += 4) {
        this.contactSegment(p, r, t[k], t[k + 1], t[k + 2], t[k + 3], -1, -1, null);
      }
      if (contact[p]) {
        const len = Math.hypot(cnx[p], cny[p]) || 1;
        cnx[p] /= len;
        cny[p] /= len;
      }
    }
  }

  private contactSegment(p: number, r: number, ax: number, ay: number, bx: number, by: number, ia: number, ib: number, link: Link | null): void {
    const { x, y, im } = this;
    const dx = bx - ax;
    const dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((x[p] - ax) * dx + (y[p] - ay) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t;
    const qy = ay + dy * t;
    let nx = x[p] - qx;
    let ny = y[p] - qy;
    const d = Math.sqrt(nx * nx + ny * ny);
    if (d >= r || d < 1e-9) return;
    nx /= d;
    ny /= d;
    const C = d - r;
    const wa = ia >= 0 ? im[ia] * (1 - t) * (1 - t) : 0;
    const wb = ib >= 0 ? im[ib] * t * t : 0;
    const w = im[p] + wa + wb;
    if (w === 0) return;
    const s = -C / w;
    x[p] += nx * s * im[p];
    y[p] += ny * s * im[p];
    if (ia >= 0) {
      x[ia] -= nx * s * im[ia] * (1 - t);
      y[ia] -= ny * s * im[ia] * (1 - t);
      x[ib] -= nx * s * im[ib] * t;
      y[ib] -= ny * s * im[ib] * t;
    }
    if (link && this.tonnes[p] > link.pressTonnes) link.pressTonnes = this.tonnes[p];
    this.contact[p] = 1;
    this.cnx[p] += nx;
    this.cny[p] += ny;
  }

  private applyDrive(h: number): void {
    const { vx, vy, drive, accel, contact, cnx, cny } = this;
    for (let p = 0; p < this.count; p++) {
      if (!contact[p]) {
        cnx[p] = cny[p] = 0;
        continue;
      }
      // Tangent pointing "forward" (rightwards) along the surface.
      const tx = cny[p];
      const ty = -cnx[p];
      const vt = vx[p] * tx + vy[p] * ty;
      const target = drive[p];
      let dv: number;
      if (target > 0) {
        const maxDv = accel[p] * h;
        dv = Math.max(-maxDv, Math.min(maxDv, target - vt));
      } else {
        // Undriven contacts (body scraping) just get rough friction.
        dv = -vt * Math.min(1, 8 * h);
      }
      vx[p] += tx * dv;
      vy[p] += ty * dv;
      cnx[p] = cny[p] = 0;
    }
  }

  private dampMembers(h: number): void {
    const { x, y, vx, vy, im } = this;
    const f = Math.min(1, AXIAL_DAMPING * h);
    for (const l of this.links) {
      if (l.broken) continue;
      const a = l.a;
      const b = l.b;
      const w = im[a] + im[b];
      if (w === 0) continue;
      let nx = x[b] - x[a];
      let ny = y[b] - y[a];
      const len = Math.hypot(nx, ny) || 1;
      if (l.tensionOnly && len < l.rest) continue;
      nx /= len;
      ny /= len;
      const rel = (vx[b] - vx[a]) * nx + (vy[b] - vy[a]) * ny;
      const c = (rel * f) / w;
      vx[a] += nx * c * im[a];
      vy[a] += ny * c * im[a];
      vx[b] -= nx * c * im[b];
      vy[b] -= ny * c * im[b];
    }
  }

  private updateStress(dt: number): void {
    const { x, y } = this;
    for (const l of this.links) {
      l.age += dt;
      if (l.broken || !l.bridge) continue;
      const len = Math.hypot(x[l.b] - x[l.a], y[l.b] - y[l.a]);
      l.strain = (len - l.rest) / l.rest;
      if (l.tensionOnly && l.strain < 0) l.strain = 0;
      const mat = MATERIALS[l.mat!];
      const force = mat.EA * l.strain;
      let ratio = force >= 0 ? force / l.tensionLimit : force / l.compressionLimit;
      // A vehicle over the deck's rating crushes each piece it stands on, within a few frames.
      if (l.pressTonnes > 0) {
        const over = l.pressTonnes / mat.rating;
        if (over > 1) {
          l.crushed = true;
          l.crushedBy = Math.max(l.crushedBy, l.pressTonnes);
          ratio = -Math.max(Math.abs(ratio), over);
        }
        l.pressTonnes = 0;
      }
      l.stress += (ratio - l.stress) * STRESS_SMOOTHING;
      if (Math.abs(l.stress) >= 1) this.breakLink(l);
    }
    this.updateJoints();
  }

  /** Adds up member stress at every free joint; an overloaded joint lets go of its busiest member. */
  private updateJoints(): void {
    const load = this.jointLoad;
    this.jointLinks.forEach((ls, p) => {
      let sum = 0;
      let first: Link | null = null;
      let s1 = 0;
      let s2 = 0;
      for (const l of ls) {
        if (l.broken) continue;
        const s = Math.abs(l.stress);
        sum += s;
        if (s > s1) {
          s2 = s1;
          s1 = s;
          first = l;
        } else if (s > s2) s2 = s;
      }
      // The two busiest members don't count: load passing straight through a joint, like a
      // chord, is a clean path. Every other busy member meeting there adds up.
      load[p] = sum - s1 - s2;
      if (first && load[p] >= JOINT_LIMIT) this.breakLink(first);
    });
  }

  /** Records which members meet at each free joint; call once the bridge is built. */
  indexJoints(anchor: (p: number) => boolean): void {
    this.jointLinks = [];
    for (const l of this.links) {
      if (!l.bridge) continue;
      for (const p of [l.a, l.b]) if (!anchor(p)) (this.jointLinks[p] ??= []).push(l);
    }
  }

  /** How close a joint is to failing, 0 to 1. */
  jointRatio(p: number): number {
    return this.jointLoad[p] / JOINT_LIMIT;
  }

  breakLink(l: Link): void {
    l.broken = true;
    const { x, y, vx, vy } = this;
    this.breaks.push({
      link: l,
      x: (x[l.a] + x[l.b]) / 2,
      y: (y[l.a] + y[l.b]) / 2,
      ax: x[l.a],
      ay: y[l.a],
      bx: x[l.b],
      by: y[l.b],
      vx: (vx[l.a] + vx[l.b]) / 2,
      vy: (vy[l.a] + vy[l.b]) / 2,
    });
  }
}

export interface VehicleHandle {
  def: VehicleDef;
  /** Particles that are wheels, rear to front. */
  wheels: number[];
  rearWheel: number;
  frontWheel: number;
  rearTop: number;
  frontTop: number;
  /** Extra wheels between the rear and front ones, rear to front. */
  midWheels: number[];
}

/** Builds the physical bridge from a design; world particle i === design node i. */
export function buildWorld(design: Design, level: LevelDef): { world: World; vehicles: VehicleHandle[] } {
  const defs = convoyLayout(level).map((c) => c.def);
  const { ends, extra, seats } = seatJoints(design, level);
  const joints = design.nodes.length + extra.length;
  const masts = level.masts ?? [];
  const world = new World(joints + masts.length + 6 * defs.length + 2, level.waterY - 8);
  const mass = new Float64Array(joints).fill(JOINT_MASS);
  design.members.forEach((m, i) => {
    const a = design.nodes[m.a];
    const b = design.nodes[m.b];
    const half = (Math.hypot(b.x - a.x, b.y - a.y) * MATERIALS[m.mat].density) / 2;
    mass[ends[i][0]] += half;
    mass[ends[i][1]] += half;
  });
  design.nodes.forEach((n, i) => world.addParticle(n.x, n.y, n.mast ? mass[i] + MAST.mass : n.anchor ? 0 : mass[i]));
  world.banks = { width: level.width, rightY: bankY(level) };
  design.nodes.forEach((n, p) => {
    if (n.block) world.blocks.push({ p, x0: n.x, ground: n.y, util: 0, peak: 0, loose: false });
  });
  extra.forEach((node, k) => world.addParticle(design.nodes[node].x, design.nodes[node].y, mass[design.nodes.length + k]));
  // Each mast's foot is a fixed hinge, joined to its top by one very stiff strut.
  for (const [x, base, top] of masts) {
    const foot = world.addParticle(x, base, 0);
    const head = design.findNode(x, top);
    world.addLink(foot, head, (top - base) / MAST.EA);
    world.masts.push({ base: foot, top: head });
  }
  world.bridgeCount = joints + masts.length;
  for (const p of seats) world.seats.push({ p, x: world.x[p], y: world.y[p] });
  design.members.forEach((m, i) => {
    const mat = MATERIALS[m.mat];
    const a = design.nodes[m.a];
    const b = design.nodes[m.b];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    world.addLink(ends[i][0], ends[i][1], len / mat.EA, {
      bridge: true,
      mat: m.mat,
      stroke: mat.stroke,
      tensionOnly: mat.tensionOnly,
      drivable: mat.drivable,
      member: i,
      tensionLimit: mat.tension,
      compressionLimit: compressionLimit(mat, len),
      age: 10,
    });
  });

  addSeatRests(world, level);
  addDeckBends(world);
  world.indexJoints((p) => p < design.nodes.length && design.nodes[p].anchor);

  const W = level.width;
  const deep = level.waterY - 8;
  const rY = bankY(level);
  world.terrain.push(-60, 0, 0, 0, 0, 0, 0, deep, W, deep, W, rY, W, rY, W + 60, rY);
  for (const [px, py] of level.piers) {
    world.terrain.push(px - 0.45, py, px + 0.45, py);
    world.terrain.push(px - 0.45, py, px - 0.45, deep, px + 0.45, py, px + 0.45, deep);
  }
  // Overhang undersides, in case a bouncing vehicle reaches them.
  for (const o of level.overhangs ?? []) {
    const edge = o.side === 'left' ? o.reach : W - o.reach;
    const back = o.side === 'left' ? -60 : W + 60;
    world.terrain.push(back, o.bottom, edge, o.bottom);
  }

  // A convoy keeps to its slowest vehicle's speed, so the gaps hold.
  const speed = Math.min(...defs.map((d) => d.speed));
  const vehicles = convoyLayout(level).map(({ def, x }) => addVehicle(world, def, x, speed));
  return { world, vehicles };
}

/** Where each vehicle waits at the start: its rear wheel's x, lead vehicle first. */
export function convoyLayout(level: LevelDef): { def: VehicleDef; x: number }[] {
  const out: { def: VehicleDef; x: number }[] = [];
  let x = START_X;
  for (const [i, id] of [level.vehicle, ...(level.convoy ?? [])].entries()) {
    const def = VEHICLES[id];
    if (i > 0) x -= CONVOY_GAP + def.wheelbase + def.wheelR;
    out.push({ def, x });
  }
  return out;
}

/** Most a deck may kink at a joint and still act as one continuous beam there, radians. */
const MAX_BEND_KINK = 0.6;

/**
 * Joints built on a seat, a pier with no bolt, rest on it and can lift off. Each part of the
 * bridge meeting there gets a joint of its own, so a drawbridge leaf lifts away from the span
 * beside it instead of dragging it along. Parts are the joints linked to one another without
 * passing through a bolt or a seat. Returns each member's end joints, the design node each
 * extra joint copies (they follow the design's own), and every seated joint.
 */
function seatJoints(design: Design, level: LevelDef): { ends: [number, number][]; extra: number[]; seats: number[] } {
  const { nodes, members } = design;
  const ends = members.map((m): [number, number] => [m.a, m.b]);
  const pads = seatPiers(level);
  const onSeat = nodes.map((n) => !n.anchor && pads.some(([x, y]) => Math.abs(x - n.x) < 1e-6 && Math.abs(y - n.y) < 1e-6));
  if (!onSeat.some(Boolean)) return { ends, extra: [], seats: [] };
  const root = nodes.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  const fixed = (i: number) => nodes[i].anchor || onSeat[i];
  for (const m of members) if (!fixed(m.a) && !fixed(m.b)) root[find(m.a)] = find(m.b);
  const extra: number[] = [];
  const seats: number[] = [];
  onSeat.forEach((seated, s) => {
    if (!seated) return;
    seats.push(s);
    const joint = new Map<string, number>();
    members.forEach((m, i) => {
      for (const end of [0, 1] as const) {
        if (ends[i][end] !== s) continue;
        const other = end === 0 ? m.b : m.a;
        const part = fixed(other) ? `member ${i}` : `part ${find(other)}`;
        let p = joint.get(part);
        if (p === undefined) {
          p = joint.size ? nodes.length + extra.push(s) - 1 : s;
          if (joint.size) seats.push(p);
          joint.set(part, p);
        }
        ends[i][end] = p;
      }
    });
  });
  return { ends, extra, seats };
}

/**
 * Members built straight across a seat rest on it there, just as a joint built on it would,
 * so a deck laid over a seat in long pieces is carried without needing a joint on top.
 */
function addSeatRests(world: World, level: LevelDef): void {
  const { x, y } = world;
  for (const [sx, sy] of seatPiers(level)) {
    for (const link of world.links) {
      const { a, b } = link;
      const lo = Math.min(x[a], x[b]);
      const hi = Math.max(x[a], x[b]);
      if (sx <= lo + 1e-6 || sx >= hi - 1e-6) continue;
      const at = y[a] + ((y[b] - y[a]) * (sx - x[a])) / (x[b] - x[a]);
      if (Math.abs(at - sy) < 1e-6) world.rests.push({ link, x: sx, y: sy });
    }
  }
}

/** Bending stiffness at every joint where two deck pieces continue one another. */
function addDeckBends(world: World): void {
  const deckAt: number[][] = Array.from({ length: world.bridgeCount }, () => []);
  world.links.forEach((l, i) => {
    if (!l.drivable) return;
    deckAt[l.a].push(i);
    deckAt[l.b].push(i);
  });
  const { x, y } = world;
  deckAt.forEach((ids, b) => {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const ab = world.links[ids[i]];
        const bc = world.links[ids[j]];
        const a = ab.a === b ? ab.b : ab.a;
        const c = bc.a === b ? bc.b : bc.a;
        const k1 = Math.atan2(y[b] - y[a], x[b] - x[a]);
        const k2 = Math.atan2(y[c] - y[b], x[c] - x[b]);
        let kink = Math.abs(k2 - k1);
        if (kink > Math.PI) kink = 2 * Math.PI - kink;
        if (kink > MAX_BEND_KINK) continue;
        // The softer of the two pieces sets the joint's stiffness and strength.
        const m1 = MATERIALS[ab.mat!];
        const m2 = MATERIALS[bc.mat!];
        const stiff = Math.min(m1.bend, m2.bend);
        const limit = Math.min(m1.bendLimit, m2.bendLimit);
        if (stiff <= 0 || limit <= 0) continue;
        const ux = x[c] - x[a];
        const uy = y[c] - y[a];
        const L = Math.hypot(ux, uy);
        const rest = ((x[b] - x[a]) * -uy + (y[b] - y[a]) * ux) / L;
        world.bends.push({ a, b, c, rest, compliance: 1 / stiff, limit, ab, bc });
      }
    }
  });
}

function addVehicle(world: World, def: VehicleDef, x0: number, speed: number): VehicleHandle {
  const r = def.wheelR;
  const axles = def.midAxles ?? [];
  // Wheels share 60% of the weight and the body the rest.
  const wheelMass = (def.mass * 0.6) / (2 + axles.length);
  const bodyMass = def.mass * 0.2;
  const topY = r + def.height * 0.6;
  const rearWheel = world.addParticle(x0, r, wheelMass, r);
  const frontWheel = world.addParticle(x0 + def.wheelbase, r, wheelMass, r);
  const rearTop = world.addParticle(x0, topY, bodyMass, 0.22);
  const frontTop = world.addParticle(x0 + def.wheelbase, topY, bodyMass, 0.22);
  const midWheels = axles.map((ax) => world.addParticle(x0 + ax, r, wheelMass, r));
  const wheels = [rearWheel, ...midWheels, frontWheel];
  for (const w of wheels) {
    world.drive[w] = speed;
    world.accel[w] = def.accel;
  }
  for (const p of [...wheels, rearTop, frontTop]) world.tonnes[p] = def.tonnes;
  const rigid = 1e-8;
  const spring = 4e-6 * (1500 / def.mass);
  world.addLink(rearWheel, frontWheel, rigid);
  world.addLink(rearTop, frontTop, rigid);
  world.addLink(rearWheel, rearTop, spring);
  world.addLink(frontWheel, frontTop, spring);
  world.addLink(rearWheel, frontTop, spring);
  world.addLink(frontWheel, rearTop, spring);
  // A middle axle rides on its own springs, so it takes a share of the load wherever the deck dips.
  for (const w of midWheels) for (const p of [rearWheel, frontWheel, rearTop, frontTop]) world.addLink(w, p, spring);
  return { def, wheels, rearWheel, frontWheel, rearTop, frontTop, midWheels };
}

export type RunStatus = 'running' | 'success' | 'fail';

export type Phase = 'settle' | 'opening' | 'ship' | 'closing' | 'driving';

/** One test drive: steps the world and decides success or failure. */
/** Smoothstep: eases 0..1 in and out, clamped. */
function smooth(u: number): number {
  const c = Math.max(0, Math.min(1, u));
  return c * c * (3 - 2 * c);
}

export class TestRun {
  world: World;
  vehicles: VehicleHandle[];
  level: LevelDef;
  time = 0;
  status: RunStatus = 'running';
  reason = '';
  peakStress = 0;
  splashed = false;
  phase: Phase = 'settle';
  /** Where the tall ship passes through, on drawbridge levels: the channel's middle. */
  shipX = 0;
  /** The ship's passage: below 0 it's still on its way, 0 to 1 it's passing through, above 1 it's gone. */
  shipProgress = -1;
  /** When traffic may start: straight away, or once a drawbridge has closed again. */
  readonly releaseAt: number;
  /** Stress over time, for the graph after the run. */
  readonly log: StressLog;
  /** When the run succeeded or failed, s. */
  private endedAt: number | null = null;
  private readonly speeds: number[];
  private done: boolean[];
  private lastProgressX: number;
  private lastProgressT = 0;

  constructor(design: Design, level: LevelDef) {
    this.level = level;
    const built = buildWorld(design, level);
    this.world = built.world;
    this.vehicles = built.vehicles;
    this.done = this.vehicles.map(() => false);
    // Progress is the tail's, so it starts where the last vehicle in line waits, not at the start line.
    this.lastProgressX = Math.min(...this.vehicles.map((v) => this.xOf(v)));
    this.log = new StressLog(design.members.length);
    this.releaseAt = level.ship ? SETTLE_TIME + OPEN_TIME + SHIP_TIME + CLOSE_TIME : 0;
    this.speeds = this.vehicles.flatMap((v) => v.wheels.map((p) => this.world.drive[p]));
    if (level.ship) {
      this.hold(true);
      const [x0, x1] = this.channel();
      this.shipX = (x0 + x1) / 2;
    }
  }

  /** The lead vehicle. */
  get vehicle(): VehicleHandle {
    return this.vehicles[0];
  }

  get vehicleX(): number {
    return this.xOf(this.vehicle);
  }

  /** Middle of the convoy, for the camera. */
  get convoyX(): number {
    const xs = this.vehicles.map((v) => this.xOf(v));
    return (Math.min(...xs) + Math.max(...xs)) / 2;
  }

  private xOf(v: VehicleHandle): number {
    const w = this.world;
    return (w.x[v.rearWheel] + w.x[v.frontWheel]) / 2;
  }

  /** The ship's channel: [x0, x1]. */
  private channel(): [number, number] {
    const c = this.level.channels?.[0];
    return c ? [c[0], c[1]] : [0, this.level.width];
  }

  /** Brakes every vehicle at the start line, or lets them go. */
  private hold(on: boolean): void {
    const w = this.world;
    let k = 0;
    for (const v of this.vehicles) for (const p of v.wheels) w.drive[p] = on ? 0 : this.speeds[k++];
  }

  /** Opens and closes a drawbridge on its timeline and moves the ship through. */
  private drawbridge(): void {
    const t = this.time;
    const w = this.world;
    const openAt = SETTLE_TIME;
    const shipAt = openAt + OPEN_TIME;
    const closeAt = shipAt + SHIP_TIME;
    w.openness = t < closeAt ? smooth((t - openAt) / OPEN_TIME) : 1 - smooth((t - closeAt) / CLOSE_TIME);
    this.phase = t < openAt ? 'settle' : t < shipAt ? 'opening' : t < closeAt ? 'ship' : t < this.releaseAt ? 'closing' : 'driving';
    this.shipProgress = (t - shipAt) / SHIP_TIME;
    if (this.phase === 'ship' && this.status === 'running') {
      const top = this.level.ship!.mast;
      const x = this.shipX;
      const hit = w.links.some((l) => l.bridge && !l.broken && segmentHitsRect(w.x[l.a], w.y[l.a], w.x[l.b], w.y[l.b], x - SHIP_HALF, this.level.waterY - 1, x + SHIP_HALF, top));
      if (hit) this.fail('The ship hit your bridge.');
    }
  }

  step(dt: number = STEP): void {
    const w = this.world;
    const ramp = Math.min(1, this.time / SETTLE_TIME);
    w.gravityScale = ramp * ramp * (3 - 2 * ramp);
    const wasHeld = this.time < this.releaseAt;
    if (this.level.ship) this.drawbridge();
    else this.phase = this.time < SETTLE_TIME ? 'settle' : 'driving';
    w.step(dt);
    this.time += dt;
    if (wasHeld && this.time >= this.releaseAt) {
      this.hold(false);
      this.lastProgressT = this.time;
    }
    for (const l of w.links) {
      if (l.bridge && !l.broken) this.peakStress = Math.max(this.peakStress, Math.abs(l.stress));
    }
    for (const p of w.jointLinks.keys()) if (w.jointLinks[p]) this.peakStress = Math.max(this.peakStress, Math.min(1, w.jointRatio(p)));
    for (const b of w.blocks) this.peakStress = Math.max(this.peakStress, Math.min(1, b.util));
    if (this.status !== 'running') this.endedAt ??= this.time;
    this.log.record(this.time, w, this.phase, this.endedAt);
    if (this.status !== 'running') return;

    for (const v of this.vehicles) {
      const lowest = Math.min(w.y[v.rearWheel], w.y[v.frontWheel], w.y[v.rearTop], w.y[v.frontTop]);
      if (lowest < this.level.waterY) {
        this.splashed = true;
        this.fail('Your cargo went for a swim.');
        return;
      }
      const upX = w.x[v.frontTop] - w.x[v.rearTop];
      const upY = w.y[v.frontTop] - w.y[v.rearTop];
      const bodyAboveWheels = (w.y[v.rearTop] + w.y[v.frontTop]) / 2 - (w.y[v.rearWheel] + w.y[v.frontWheel]) / 2;
      if (bodyAboveWheels < -0.1 || upX < -0.2 * Math.abs(upY)) {
        this.fail('The vehicle flipped over.');
        return;
      }
    }
    this.vehicles.forEach((v, i) => {
      if (Math.min(w.x[v.rearWheel], w.x[v.frontWheel]) > goalX(this.level)) this.done[i] = true;
    });
    if (this.done.every(Boolean)) {
      this.status = 'success';
      return;
    }
    if (this.time < this.releaseAt) return;
    // Progress of the last vehicle still on its way.
    const x = Math.min(...this.vehicles.filter((_, i) => !this.done[i]).map((v) => this.xOf(v)));
    if (x > this.lastProgressX + 0.3) {
      this.lastProgressX = x;
      this.lastProgressT = this.time;
    } else if (this.time - this.lastProgressT > 3.5) {
      this.fail('The vehicle got stuck.');
    }
  }

  private fail(reason: string): void {
    this.status = 'fail';
    const crushed = this.world.links.find((l) => l.crushed && l.broken);
    if (crushed) {
      const mat = MATERIALS[crushed.mat!];
      const def = this.vehicles.map((v) => v.def).find((d) => d.tonnes === crushed.crushedBy) ?? this.vehicle.def;
      reason = `The ${def.name.toLowerCase()} weighs ${def.tonnes} t. ${mat.name} carries only ${mat.rating} t.`;
    } else if (this.world.blocks.some((b) => b.loose)) {
      reason = 'A concrete anchor tore loose. Too steep a pull lifts it, too flat a pull slides it; or share it between two.';
    }
    this.reason = reason;
  }
}
