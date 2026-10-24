import { marchAccel, quakeAccel, windGust, type Flood, type March, type Quake, type Wind } from './hazards';
import { BLOCK, MATERIALS, type BlockDef, type MaterialId } from './materials';

/**
 * Bump whenever a change here, or in materials or vehicles, alters how a bridge behaves:
 * the tuned levels (npm run tune) record it and go stale when it moves.
 */
export const PHYSICS_VERSION = 3;
export const GRAVITY = -9.81;
export const STEP = 1 / 60;
const SUBSTEPS = 24;
/** Passes over the arch ring joints per substep: one is too soft for a long chain of blocks. */
const FACE_ITERATIONS = 4;
/** A ring joint whose corners part this far, m, has come apart for good. */
const FACE_APART = 0.4;
const AXIAL_DAMPING = 40; // 1/s, relative axial velocity bleed on bridge members
const AIR_DAMPING = 0.05;
export const JOINT_MASS = 6;
/** Friction between concrete blocks and the rock they bear on: static, and once sliding. */
const ROCK_FRICTION = 0.7;
const SLIDING_FRICTION = 0.55;
const STRESS_SMOOTHING = 0.3;
export const SETTLE_TIME = 0.8;
/**
 * A joint fails when the stress ratios of the members meeting there, apart from the two
 * busiest, add up to this. Load passing straight through is fine; a knot of busy members isn't.
 */
export const JOINT_LIMIT = 1.8;
/** Space between one vehicle's front and the next one's back in a convoy, m. */
export const CONVOY_GAP = 3.5;
/** What a bolt on mud carries before it starts to sink, N, how fast it sinks per share over, m/s, and how far it can, m. */
const MUD_HOLD = 15000;
const SINK_RATE = 0.4;
const MUD_DEPTH = 1.5;
/** A flood scours out a bolt on mud once it has stood this deep under water this long, m and s. */
const SCOUR_DEPTH = 0.5;
const SCOUR_TIME = 1.5;
/** Seconds a flood takes to rise. */
const FLOOD_TIME = 4;
/** How much of a bank wall opens above a lower deck's tunnel floor, m: room for a train to pass through. */
export const TUNNEL_HEIGHT = 3;
/** How fast a swing bridge's jacks lift its ends back onto the banks, m/s. */
const JACK_SPEED = 0.4;
/**
 * Slack in the contact broad phase, m: a segment is skipped only when its bounding box is this
 * much beyond a wheel's reach, far enough that rounding can't make the exact test touch it.
 */
const CONTACT_MARGIN = 1e-6;
/** Whether a segment's bounding box lies clearly more than r from (px, py), so it can't touch a wheel there. */
function beyond(px: number, py: number, r: number, ax: number, ay: number, bx: number, by: number): boolean {
  const reach = r + CONTACT_MARGIN;
  return (ax < bx ? ax : bx) - px > reach || px - (ax > bx ? ax : bx) > reach || (ay < by ? ay : by) - py > reach || py - (ay > by ? ay : by) > reach;
}

/** Driftwood a flood carries down: how many logs, their weight, kg, size, m, speed, m/s, and the gap between them, s. */
export const LOGS = 3;
const LOG_MASS = 600;
export const LOG_RADIUS = 0.35;
const LOG_SPEED = 4;
const LOG_GAP = 1.2;
/** How quickly the current brings a log back up to its speed, 1/s. */
const LOG_DRAG = 2;
/** Compliance of a coupler between rail vehicles: stiff, with a little give. */
export const COUPLER = 2e-7;
/** Wheel to wheel between two coupled rail vehicles, m: both overhangs and the buffers. */
export const RAIL_GAP = 2.4;
/** How hard a braking train slows, m/s². */
const BRAKE_DECEL = 5;
/** Drawbridge timeline, s: open, let the ship through, close, then traffic may go. */
export const OPEN_TIME = 3;
export const SHIP_TIME = 5;
export const CLOSE_TIME = 3;
/** Half the tall ship's beam, m: it sails through the bridge's plane, bow on, at the channel's middle. */
export const SHIP_HALF = 1.2;
/** How long a waiting ship gives the traffic to clear before the bridge opens, s. */
export const SHIP_WAIT = 0.5;
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
  /** Index into Design.cells for a link of a concrete block's frame, or -1. */
  cell: number;
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
  /** A tendon's pull as a strain of its built length, reached as the bridge takes its weight; 0 for everything else. */
  pre: number;
  /** A damper's resistance to its ends moving, N per m/s; 0 for everything else. */
  viscous: number;
  /** The damper's force this step so far, summed over substeps, N: tension positive. */
  damp: number;
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

/**
 * A mortared joint between two blocks of an arch ring, each block with its own corners on it:
 * the earlier block's a1 and a2, the later block's b1 and b2, built on the same two points.
 * Pressed together, the blocks push back and grip across it. The mortar holds each edge shut
 * until it's pulled harder than `bond`; then that edge cracks for good, and from there on the
 * blocks only press, so where the thrust leaves the ring the joint gapes on one edge and hinges
 * on the other, like real voussoirs.
 */
export interface Face {
  a1: number;
  a2: number;
  b1: number;
  b2: number;
  /** Which way the face's normal turns, from the earlier block into the later one. */
  sign: number;
  compliance: number;
  /** How far each edge of the joint stands open, m, as of the last step: 0 while pressed. */
  gap1: number;
  gap2: number;
  /** The blocks came apart: they no longer meet across this joint. */
  apart: boolean;
  /** Pull each edge's mortar holds, N. */
  bond: number;
  /** Each edge's mortar has cracked. */
  crack1: boolean;
  crack2: boolean;
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
  /** Road ends on sliding bearings: each held at its height, free to move along. */
  bearings: { p: number; y: number }[] = [];
  /**
   * A swing bridge's road ends: resting on the banks while it's shut, free while it swings, and
   * jacked back up to their height, gently, once it's shut again.
   */
  swingEnds: { p: number; y: number; seated: boolean }[] = [];
  /** A lift bridge's guide rails: joints held at their x, free to rise and fall. */
  guides: { p: number; x: number }[] = [];
  /** A double-leaf drawbridge's center lock: the two leaf tips it holds level while the bridge is shut. */
  lock: [number, number] | null = null;
  /** Members passing over a pier with no bolt: borne up there while they bear down, free once they lift. */
  rests: Rest[] = [];
  breaks: BreakEvent[] = [];
  /** Concrete anchors set into the banks. */
  blocks: Block[] = [];
  /** The size of every concrete anchor in this world. */
  block: BlockDef = BLOCK;
  /** Each concrete block's frame: its corner particles and its links, by index into Design.cells. */
  cells: { n: number[]; links: Link[] }[] = [];
  /** The mortared joints between blocks, which crack, open and hinge. */
  faces: Face[] = [];
  /** Block corners that bear on rock: the banks, their walls and pier tops push back but don't hold. */
  rock: number[] = [];
  /** Per rock corner, in step with `rock`: the links pulling on it, the face it last pressed on, and whether friction holds it. */
  private rockLinks: Link[][] = [];
  private rockNx: number[] = [];
  private rockNy: number[] = [];
  private rockStuck: boolean[] = [];
  /** How hard each rock corner pressed into its face last step, N. */
  private rockPress: number[] = [];
  /** Pier tops blocks may stand on: x, y. */
  rockPiers: [number, number][] = [];
  /** Rock masses blocks bear on: x0, x1, top. */
  rockMasses: [number, number, number][] = [];
  /** Hinged masts: the fixed joint at the foot and the bolt on top, which tips freely. */
  masts: { base: number; top: number }[] = [];
  /** Concrete anchors that tore loose, by index into blocks, for effects to pick up. */
  loosened: number[] = [];
  /** Soft bolts the flood just washed out, by particle, for effects to pick up. */
  washed: number[] = [];
  /** Left bank's x edge and the right bank's x edge and height, for blocks dragged over the ground. */
  banks = { width: 0, rightY: 0 };
  floorY: number;
  /** Scaled 0→1 at the start of a run so the bridge takes its own weight gently. */
  gravityScale = 1;
  /** Weight of the vehicle each particle belongs to, tonnes (0 for the bridge), checked against deck ratings. */
  tonnes: Float64Array;
  /**
   * Rail wheels: they run on track only, and push back on the deck under them as they drive or
   * brake, so a braking train loads the bridge along its length. Per wheel, the deck link it
   * last touched and where along it.
   */
  rail: Uint8Array;
  private touch: (Link | null)[] = [];
  private touchT: Float64Array;
  /** Rail wheels braking toward a stop. */
  braking = false;
  /** Seconds since the world began, counted in substeps. */
  time = 0;
  /** The level's weather and ground: see LevelDef.wind, quake and march. */
  wind: Wind | null = null;
  quake: Quake | null = null;
  /** When the quake began, s: it waits for the traffic to reach it. */
  quakeStart = Infinity;
  march: March | null = null;
  /** Particles that march in step: they press down harder and softer at the pace. */
  marchers: number[] = [];
  /** Bolts on mud: where they were built, how far they have sunk, the members they carry, and whether a flood washed them out. */
  soft: { p: number; y0: number; sunk: number; links: Link[]; out: boolean }[] = [];
  /** Driftwood a flood carries: each log's particle, and whether it's afloat in the river yet. */
  logs: { p: number; afloat: boolean }[] = [];
  /** The river's surface, m: the level's water, water0, until a flood raises it. */
  waterY = 0;
  water0 = 0;
  flood: Flood | null = null;
  /** When the flood began, s: it waits for the traffic to reach it. */
  floodStart = Infinity;
  /** How long each soft bolt has stood under the flood, s. */
  private scour: number[] = [];
  /** How quickly members bleed off their own stretching and squeezing, 1/s. */
  memberDamping = AXIAL_DAMPING;
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
    this.rail = new Uint8Array(capacity);
    this.touchT = new Float64Array(capacity);
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
      cell: -1,
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
      pre: 0,
      viscous: 0,
      damp: 0,
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
    for (const l of links) {
      if (l.stroke) l.rest = l.base * (1 + l.stroke * this.openness);
      // Tendons are pulled tight as gently as the bridge takes its own weight.
      else if (l.pre) l.rest = l.base * (1 - l.pre * this.gravityScale);
    }

    for (let s = 0; s < SUBSTEPS; s++) {
      // In the ground's frame, shaking ground pushes everything on it the other way.
      const [qx, qy] = this.quake ? quakeAccel(this.quake, this.time - this.quakeStart) : [0, 0];
      for (let i = 0; i < n; i++) {
        px[i] = x[i];
        py[i] = y[i];
        if (im[i] === 0) continue;
        vx[i] -= qx * h;
        vy[i] += (g - qy) * h;
      }
      if (this.march) {
        const a = marchAccel(this.march, this.time);
        for (const p of this.marchers) vy[p] -= a * h;
      }
      if (this.wind) this.blow(h);
      if (this.flood && this.time > this.floodStart) this.current(h);
      if (this.logs.length) this.drift(h);
      for (let i = 0; i < n; i++) {
        if (im[i] === 0) continue;
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
      for (let k = 0; this.faces.length && k < FACE_ITERATIONS; k++) this.solveFaces(h);
      this.solveContacts();
      if (this.logs.length) this.ram();
      this.solveSeats();
      for (const b of this.bearings) this.y[b.p] = b.y;
      for (const rail of this.guides) this.x[rail.p] = rail.x;
      if (this.swingEnds.length) this.restEnds(h);
      if (this.lock && this.openness === 0) this.holdLock();
      this.solveRock();
      this.solveBlocks();

      const invH = 1 / h;
      for (let i = 0; i < n; i++) {
        if (im[i] === 0) continue;
        vx[i] = (x[i] - px[i]) * invH * air;
        vy[i] = (y[i] - py[i]) * invH * air;
      }

      this.applyDrive(h);
      this.dampMembers(h);
      this.time += h;
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
    if (this.faces.length) this.updateFaces();
    this.updateBlocks();
    this.updateRock(dt);
    if (this.soft.length) this.updateSoft(dt);
    if (this.flood) this.rise();
  }

  /**
   * Bolts on mud sink while they carry more than the mud holds, faster the more they carry, until
   * they reach firmer ground; under a flood long enough, the river scours them out altogether.
   */
  private updateSoft(dt: number): void {
    const { x, y, py } = this;
    this.soft.forEach((s, k) => {
      if (s.out) return;
      const p = s.p;
      if (this.waterY > y[p] + SCOUR_DEPTH) {
        this.scour[k] = (this.scour[k] ?? 0) + dt;
        if (this.scour[k] > SCOUR_TIME) {
          s.out = true;
          this.im[p] = 1 / (JOINT_MASS * 20);
          this.washed.push(p);
          return;
        }
      }
      // What the members built on it press it down with, N.
      let press = 0;
      for (const l of s.links) {
        if (l.broken) continue;
        const q = l.a === p ? l.b : l.a;
        const len = Math.hypot(x[q] - x[p], y[q] - y[p]) || 1;
        const pull = MATERIALS[l.mat!].EA * l.strain;
        press -= (pull * (y[q] - y[p])) / len;
      }
      if (press <= MUD_HOLD || s.sunk >= MUD_DEPTH) return;
      const dy = Math.min(MUD_DEPTH - s.sunk, SINK_RATE * dt * (press / MUD_HOLD - 1));
      s.sunk += dy;
      y[p] -= dy;
      py[p] -= dy;
    });
  }

  /** The river rises after the flood starts, easing in over FLOOD_TIME. */
  /**
   * Driftwood: as the river rises, logs float down it one after another, carried at the
   * current's speed along the surface, and leave the far side.
   */
  private drift(h: number): void {
    const { x, y, vx, vy, im } = this;
    this.logs.forEach((log, k) => {
      const p = log.p;
      if (!log.afloat) {
        if (this.time < this.floodStart + k * LOG_GAP) return;
        log.afloat = true;
        x[p] = this.px[p] = LOG_RADIUS;
        y[p] = this.py[p] = this.waterY;
        vx[p] = LOG_SPEED;
        vy[p] = 0;
        im[p] = 1 / LOG_MASS;
      }
      if (im[p] === 0) return;
      vx[p] += (LOG_SPEED - vx[p]) * Math.min(1, LOG_DRAG * h);
      if (x[p] > this.banks.width + 2) im[p] = 0;
    });
  }

  /** Logs ram whatever stands in the river: every bridge member they meet, and they float on its surface. */
  private ram(): void {
    const { x, y, im } = this;
    for (const log of this.logs) {
      const p = log.p;
      if (!log.afloat || im[p] === 0) continue;
      for (const l of this.links) {
        if (!l.bridge || l.broken) continue;
        this.contactSegment(p, LOG_RADIUS, x[l.a], y[l.a], x[l.b], y[l.b], l.a, l.b, null);
      }
      y[p] = this.waterY;
    }
  }

  private rise(): void {
    const f = this.flood!;
    const u = Math.max(0, Math.min(1, (this.time - this.floodStart) / FLOOD_TIME));
    this.waterY = this.water0 + f.rise * u * u * (3 - 2 * u);
  }

  /** Flood water pushes downstream, left to right, on every member by how much of it is under water. */
  private current(h: number): void {
    const { x, y, vx, im } = this;
    const wy = this.waterY;
    const push = this.flood!.current * h;
    for (const l of this.links) {
      if (l.broken || !l.bridge) continue;
      const [a, b] = [l.a, l.b];
      const lo = Math.min(y[a], y[b]);
      if (lo >= wy) continue;
      const hi = Math.max(y[a], y[b]);
      const len = Math.hypot(x[b] - x[a], y[b] - y[a]);
      const wet = hi <= wy ? len : (len * (wy - lo)) / Math.max(hi - lo, 1e-6);
      const f = (push * wet) / 2;
      vx[a] += f * im[a];
      vx[b] += f * im[b];
    }
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
  /**
   * Block corners can't sink into rock: pushed back out of a bank top, a canyon wall, a rock mass
   * or a pier top. While friction holds (see updateRock) a corner can't slide along the face; once
   * the push along it beats friction, it slides, slowed by kinetic friction. Nothing holds a
   * corner down, so a block lifts away freely.
   */
  private solveRock(): void {
    const { x, y, px, py, im } = this;
    const W = this.banks.width;
    const rY = this.banks.rightY;
    this.rock.forEach((p, k) => {
      if (im[p] === 0) return;
      let nx = 0;
      let ny = 0;
      let depth = 0;
      if (x[p] < 0 && y[p] < 0) {
        if (-y[p] < -x[p]) [ny, depth] = [1, -y[p]];
        else [nx, depth] = [1, -x[p]];
      } else if (x[p] > W && y[p] < rY) {
        if (rY - y[p] < x[p] - W) [ny, depth] = [1, rY - y[p]];
        else [nx, depth] = [-1, x[p] - W];
      } else {
        for (const [x0, x1, top] of this.rockMasses) {
          if (x[p] <= x0 || x[p] >= x1 || y[p] >= top) continue;
          // Out through the nearest face: the top, or a side.
          const up = top - y[p];
          const left = x[p] - x0;
          const right = x1 - x[p];
          if (up <= left && up <= right) [ny, depth] = [1, up];
          else if (left < right) [nx, depth] = [-1, left];
          else [nx, depth] = [1, right];
          break;
        }
        if (!depth) {
          for (const [sx, sy] of this.rockPiers) {
            if (Math.abs(x[p] - sx) < 0.55 && y[p] < sy && sy - y[p] < 0.5) {
              [ny, depth] = [1, sy - y[p]];
              break;
            }
          }
        }
      }
      if (depth <= 0) return;
      this.rockNx[k] = nx;
      this.rockNy[k] = ny;
      x[p] += nx * depth;
      y[p] += ny * depth;
      // Along the face: held where it is while friction holds. Sliding, it is slowed once a step
      // by kinetic friction, as an impulse (see updateRock).
      if (!this.rockStuck[k]) return;
      const tx = -ny;
      const ty = nx;
      const slide = (x[p] - px[p]) * tx + (y[p] - py[p]) * ty;
      x[p] -= tx * slide;
      y[p] -= ty * slide;
    });
  }

  /**
   * Coulomb friction at every block corner on rock, once a step: the members' pull on it plus
   * its own weight, split into a push into the face and a push along it. Friction holds while
   * the push along is at most ROCK_FRICTION times the push in.
   */
  private updateRock(dt: number): void {
    const { x, y, vx, vy, im } = this;
    const g = -GRAVITY * this.gravityScale;
    this.rock.forEach((p, k) => {
      const nx = this.rockNx[k];
      const ny = this.rockNy[k];
      if (!nx && !ny) {
        this.rockStuck[k] = true;
        return;
      }
      let fx = 0;
      let fy = im[p] > 0 ? -g / im[p] : 0;
      for (const l of this.rockLinks[k]) {
        if (l.broken || !l.mat) continue;
        const o = l.a === p ? l.b : l.a;
        const dx = x[o] - x[p];
        const dy = y[o] - y[p];
        const len = Math.hypot(dx, dy) || 1;
        const f = MATERIALS[l.mat].EA * l.strain;
        fx += (f * dx) / len;
        fy += (f * dy) / len;
      }
      const press = -(fx * nx + fy * ny);
      const along = Math.abs(-fx * ny + fy * nx);
      this.rockPress[k] = Math.max(0, press);
      this.rockStuck[k] = press > 0 && along <= ROCK_FRICTION * press;
      if (!this.rockStuck[k] && press > 0) {
        // Sliding: kinetic friction takes back up to its impulse over the step from the slide.
        const vt = -vx[p] * ny + vy[p] * nx;
        const dv = Math.min(Math.abs(vt), SLIDING_FRICTION * press * dt * im[p]) * Math.sign(vt);
        vx[p] -= -ny * dv;
        vy[p] -= nx * dv;
      }
      // The face it pressed on is found afresh over the next step's substeps.
      this.rockNx[k] = this.rockNy[k] = 0;
    });
  }

  /** Sets which particles are block corners on rock, and indexes the links pulling on each. */
  setRock(rock: number[]): void {
    this.rock = rock;
    const at = new Map(rock.map((p, k) => [p, k]));
    this.rockLinks = rock.map(() => []);
    for (const l of this.links) {
      if (!l.bridge) continue;
      for (const p of [l.a, l.b]) {
        const k = at.get(p);
        if (k !== undefined) this.rockLinks[k].push(l);
      }
    }
    this.rockNx = rock.map(() => 0);
    this.rockNy = rock.map(() => 0);
    this.rockStuck = rock.map(() => true);
    this.rockPress = rock.map(() => 0);
  }

  private solveBlocks(): void {
    const { x, y, px } = this;
    for (const b of this.blocks) {
      if (!b.loose) continue;
      const p = b.p;
      const out = Math.min(1, Math.abs(x[p] - b.x0) / this.block.width);
      const g = this.groundAt(x[p]) + this.block.depth * out;
      const sink = g - y[p];
      if (sink <= 0) continue;
      y[p] = g;
      // Kinetic friction: the slide this substep shrinks by friction times how hard it pressed in.
      const slide = x[p] - px[p];
      const grip = this.block.sliding * sink;
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
    const { mass, friction, bearing } = this.block;
    const weight = mass * -GRAVITY;
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
      const hold = Math.max(0, friction * (weight - fy)) + bearing;
      const ratio = Math.max(lift, Math.abs(fx) / hold);
      b.util += (ratio - b.util) * STRESS_SMOOTHING;
      b.peak = Math.max(b.peak, b.util);
      if (b.util >= 1) {
        b.loose = true;
        this.im[p] = 1 / mass;
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
  /** Arch ring joints: push the blocks apart where they overlap, and stop pressed faces sliding. */
  private solveFaces(h: number): void {
    const { x, y } = this;
    const invH2 = 1 / (h * h);
    for (const f of this.faces) {
      if (f.apart) continue;
      // Blocks that have come apart don't meet across this joint again.
      if (Math.hypot(x[f.b1] - x[f.a1], y[f.b1] - y[f.a1]) > FACE_APART || Math.hypot(x[f.b2] - x[f.a2], y[f.b2] - y[f.a2]) > FACE_APART) {
        f.apart = true;
        continue;
      }
      // The joint's line, averaged over both blocks' faces, and its normal into the later block.
      let tx = x[f.a2] - x[f.a1] + x[f.b2] - x[f.b1];
      let ty = y[f.a2] - y[f.a1] + y[f.b2] - y[f.b1];
      const L = Math.hypot(tx, ty);
      if (L < 1e-9) continue;
      tx /= L;
      ty /= L;
      const nx = ty * f.sign;
      const ny = -tx * f.sign;
      const alpha = f.compliance * invH2;
      f.gap1 = this.press(f.a1, f.b1, nx, ny, tx, ty, alpha, !f.crack1);
      f.gap2 = this.press(f.a2, f.b2, nx, ny, tx, ty, alpha, !f.crack2);
    }
  }

  /** The center lock: the two leaf tips meet at the same height, sharing whatever either carries. */
  private holdLock(): void {
    const [p, q] = this.lock!;
    const { y, im } = this;
    const w = im[p] + im[q];
    if (w === 0) return;
    const dy = y[q] - y[p];
    y[p] += (dy * im[p]) / w;
    y[q] -= (dy * im[q]) / w;
  }

  /** A swing bridge's road ends bear on the banks only while it's shut, lifted back up there by jacks. */
  private restEnds(h: number): void {
    const y = this.y;
    for (const e of this.swingEnds) {
      if (this.openness > 0) {
        e.seated = false;
        continue;
      }
      if (e.seated) {
        if (y[e.p] < e.y) y[e.p] = e.y;
      } else if (y[e.p] < e.y) y[e.p] += Math.min(e.y - y[e.p], JACK_SPEED * h);
      else e.seated = true;
    }
  }

  /** Cracks the mortar of every ring joint edge pulled open harder than it holds. */
  private updateFaces(): void {
    const { x, y } = this;
    for (const f of this.faces) {
      if (f.apart || (f.crack1 && f.crack2)) continue;
      let tx = x[f.a2] - x[f.a1] + x[f.b2] - x[f.b1];
      let ty = y[f.a2] - y[f.a1] + y[f.b2] - y[f.b1];
      const L = Math.hypot(tx, ty);
      if (L < 1e-9) continue;
      tx /= L;
      ty /= L;
      const nx = ty * f.sign;
      const ny = -tx * f.sign;
      // A held edge stretched open this far is pulling with `bond` newtons.
      const limit = f.bond * f.compliance;
      if (!f.crack1 && (x[f.b1] - x[f.a1]) * nx + (y[f.b1] - y[f.a1]) * ny > limit) f.crack1 = true;
      if (!f.crack2 && (x[f.b2] - x[f.a2]) * nx + (y[f.b2] - y[f.a2]) * ny > limit) f.crack2 = true;
    }
  }

  /**
   * One edge of a ring joint: corner a of the earlier block against corner b of the later one,
   * held shut while its mortar is whole. Returns how far it stands open, 0 while pressed or held.
   */
  private press(a: number, b: number, nx: number, ny: number, tx: number, ty: number, alpha: number, bonded: boolean): number {
    const { x, y, im } = this;
    const w = im[a] + im[b];
    if (w === 0) return 0;
    const gap = (x[b] - x[a]) * nx + (y[b] - y[a]) * ny;
    if (gap > 0 && !bonded) return gap;
    const ln = -gap / (w + alpha);
    x[a] -= nx * ln * im[a];
    y[a] -= ny * ln * im[a];
    x[b] += nx * ln * im[b];
    y[b] += ny * ln * im[b];
    // Held or pressed together, the edge grips: a whole joint acts as one piece until it cracks.
    const slip = (x[b] - x[a]) * tx + (y[b] - y[a]) * ty;
    const lt = -slip / (w + alpha);
    x[a] -= tx * lt * im[a];
    y[a] -= ty * lt * im[a];
    x[b] += tx * lt * im[b];
    y[b] += ty * lt * im[b];
    return 0;
  }

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

  /** The unbroken road, gathered afresh for each contact pass. */
  private road: Link[] = [];

  private solveContacts(): void {
    const { x, y, radius, contact, cnx, cny } = this;
    const t = this.terrain;
    // The road, in its usual order. Most of it is nowhere near a given wheel: a segment whose
    // bounding box is clearly more than the wheel's radius away can't touch it, and is skipped
    // without changing anything.
    const road = this.road;
    road.length = 0;
    for (const l of this.links) if (!l.broken && l.drivable) road.push(l);
    for (let p = 0; p < this.count; p++) {
      const r = radius[p];
      if (r === 0) continue;
      contact[p] = 0;
      const rail = this.rail[p];
      if (rail) this.touch[p] = null;
      for (let k = 0; k < road.length; k++) {
        const l = road[k];
        // Trains run on track only.
        if (rail && !MATERIALS[l.mat!].rail) continue;
        if (beyond(x[p], y[p], r, x[l.a], y[l.a], x[l.b], y[l.b])) continue;
        this.contactSegment(p, r, x[l.a], y[l.a], x[l.b], y[l.b], l.a, l.b, l);
      }
      for (let k = 0; k < t.length; k += 4) {
        if (beyond(x[p], y[p], r, t[k], t[k + 1], t[k + 2], t[k + 3])) continue;
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
    if (link && this.rail[p]) {
      this.touch[p] = link;
      this.touchT[p] = t;
    }
    this.contact[p] = 1;
    this.cnx[p] += nx;
    this.cny[p] += ny;
  }

  private applyDrive(h: number): void {
    const { vx, vy, drive, accel, contact, cnx, cny, im } = this;
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
      if (this.braking && this.rail[p]) {
        const maxDv = BRAKE_DECEL * h;
        dv = Math.max(-maxDv, Math.min(maxDv, -vt));
      } else if (target !== 0) {
        // Driven toward its speed, rightward or (oncoming traffic) leftward.
        const maxDv = accel[p] * h;
        dv = Math.max(-maxDv, Math.min(maxDv, target - vt));
      } else {
        // Undriven contacts (body scraping) just get rough friction.
        dv = -vt * Math.min(1, 8 * h);
      }
      vx[p] += tx * dv;
      vy[p] += ty * dv;
      // A rail wheel pushes the deck the other way, shared between the ends of the piece under it.
      const l = this.rail[p] ? this.touch[p] : null;
      if (l && !l.broken && im[p] > 0) {
        const j = dv / im[p];
        const t = this.touchT[p];
        vx[l.a] -= tx * j * im[l.a] * (1 - t);
        vy[l.a] -= ty * j * im[l.a] * (1 - t);
        vx[l.b] -= tx * j * im[l.b] * t;
        vy[l.b] -= ty * j * im[l.b] * t;
      }
      cnx[p] = cny[p] = 0;
    }
  }

  /**
   * Wind from the left: gusts push on every member by how tall it stands across the wind, and
   * lift the deck by its length, pulsing at the gusts' period.
   */
  private blow(h: number): void {
    const { x, y, vx, vy, im } = this;
    const w = this.wind!;
    const gust = windGust(w, this.time);
    const push = w.push * (0.5 + 0.5 * gust) * h;
    const lift = w.lift * gust * h;
    const flutter = (w.flutter ?? 0) * gust * h;
    for (const l of this.links) {
      if (l.broken || !l.bridge) continue;
      const a = l.a;
      const b = l.b;
      const fx = (push * Math.abs(y[b] - y[a])) / 2;
      const fy = l.drivable ? ((lift + flutter * (vy[a] + vy[b]) * 0.5) * Math.abs(x[b] - x[a])) / 2 : 0;
      vx[a] += fx * im[a];
      vx[b] += fx * im[b];
      vy[a] += fy * im[a];
      vy[b] += fy * im[b];
    }
  }

  private dampMembers(h: number): void {
    const { x, y, vx, vy, im } = this;
    const f = Math.min(1, this.memberDamping * h);
    for (const l of this.links) {
      if (l.broken) continue;
      const a = l.a;
      const b = l.b;
      const w = im[a] + im[b];
      if (w === 0) continue;
      let nx = x[b] - x[a];
      let ny = y[b] - y[a];
      const len = Math.sqrt(nx * nx + ny * ny) || 1;
      if (l.tensionOnly && len < l.rest) continue;
      nx /= len;
      ny /= len;
      const rel = (vx[b] - vx[a]) * nx + (vy[b] - vy[a]) * ny;
      // A damper's own pull, as an impulse, but never more than stops its ends dead.
      const visc = l.viscous ? Math.min(l.viscous * h, 1 / w) * rel : 0;
      l.damp += visc / h;
      const c = (rel * f) / w + visc;
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
      let force = mat.EA * l.strain;
      if (l.viscous) {
        force += l.damp / SUBSTEPS;
        l.damp = 0;
      }
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
      // A block's frame is a solid, not members meeting at a joint.
      if (!l.bridge || l.cell >= 0) continue;
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
