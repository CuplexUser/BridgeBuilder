import { segmentHitsRect, type Design } from '../design';
import { bankY, goalX, mudAt, seatPiers, START_X, type LevelDef } from '../levels';
import { BLOCK, blockOf, compressionLimit, MAST, MATERIALS, type BlockDef, type MaterialId } from './materials';
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
/** Friction between concrete blocks and the rock they bear on: static, and once sliding. */
const ROCK_FRICTION = 0.7;
const SLIDING_FRICTION = 0.55;
const STRESS_SMOOTHING = 0.3;
const SETTLE_TIME = 0.8;
/**
 * A joint fails when the stress ratios of the members meeting there, apart from the two
 * busiest, add up to this. Load passing straight through is fine; a knot of busy members isn't.
 */
export const JOINT_LIMIT = 1.8;
/** Space between one vehicle's front and the next one's back in a convoy, m. */
const CONVOY_GAP = 3.5;
/** What a bolt on mud carries before it starts to sink, N, how fast it sinks per share over, m/s, and how far it can, m. */
const MUD_HOLD = 15000;
const SINK_RATE = 0.4;
const MUD_DEPTH = 1.5;
/** A flood scours out a bolt on mud once it has stood this deep under water this long, m and s. */
const SCOUR_DEPTH = 0.5;
const SCOUR_TIME = 1.5;
/** Seconds a flood takes to rise. */
const FLOOD_TIME = 4;
/** Compliance of a coupler between rail vehicles: stiff, with a little give. */
const COUPLER = 2e-7;
/** Wheel to wheel between two coupled rail vehicles, m: both overhangs and the buffers. */
const RAIL_GAP = 2.4;
/** How hard a braking train slows, m/s². */
const BRAKE_DECEL = 5;

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
  /** The size of every concrete anchor in this world. */
  block: BlockDef = BLOCK;
  /** Each concrete block's frame: its corner particles and its links, by index into Design.cells. */
  cells: { n: number[]; links: Link[] }[] = [];
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
    for (const l of links) if (l.stroke) l.rest = l.base * (1 + l.stroke * this.openness);

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
      this.solveContacts();
      this.solveSeats();
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
      const rail = this.rail[p];
      if (rail) this.touch[p] = null;
      for (let k = 0; k < links.length; k++) {
        const l = links[k];
        if (l.broken || !l.drivable) continue;
        // Trains run on track only.
        if (rail && !MATERIALS[l.mat!].rail) continue;
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
      } else if (target > 0) {
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
    for (const l of this.links) {
      if (l.broken || !l.bridge) continue;
      const a = l.a;
      const b = l.b;
      const fx = (push * Math.abs(y[b] - y[a])) / 2;
      const fy = l.drivable ? (lift * Math.abs(x[b] - x[a])) / 2 : 0;
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
      const len = Math.hypot(nx, ny) || 1;
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
  // A block's weight sits on its corners.
  design.cells.forEach((c, k) => {
    const share = (design.cellArea(k) * MATERIALS[c.mat].density) / c.n.length;
    for (const i of c.n) mass[i] += share;
  });
  design.nodes.forEach((n, i) => world.addParticle(n.x, n.y, n.mast ? mass[i] + MAST.mass : n.anchor ? 0 : mass[i]));
  world.banks = { width: level.width, rightY: bankY(level) };
  world.block = blockOf(level);
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
      viscous: mat.viscous ?? 0,
      tensionOnly: mat.tensionOnly,
      drivable: mat.drivable,
      member: i,
      tensionLimit: mat.tension,
      compressionLimit: compressionLimit(mat, len),
      age: 10,
    });
  });

  addCells(world, design);
  world.setRock(world.rock);
  for (const [px, py] of level.piers) world.rockPiers.push([px, py]);
  world.rockMasses = (level.rocks ?? []).map(([x0, x1, top]): [number, number, number] => [x0, x1, top]);
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
  for (const [x0, x1, top] of level.rocks ?? []) world.terrain.push(x0, deep, x0, top, x0, top, x1, top, x1, top, x1, deep);
  // Overhang undersides, in case a bouncing vehicle reaches them.
  for (const o of level.overhangs ?? []) {
    const edge = o.side === 'left' ? o.reach : W - o.reach;
    const back = o.side === 'left' ? -60 : W + 60;
    world.terrain.push(back, o.bottom, edge, o.bottom);
  }

  // A convoy keeps to its slowest vehicle's speed, so the gaps hold.
  const speed = Math.min(...defs.map((d) => d.speed));
  const vehicles = convoyLayout(level).map(({ def, x }) => addVehicle(world, def, x, speed));
  // Couplers: each rail vehicle to the one ahead, at the buffers and at the axles.
  for (let i = 1; i < vehicles.length; i++) {
    const [ahead, behind] = [vehicles[i - 1], vehicles[i]];
    if (!ahead.def.rail || !behind.def.rail) continue;
    world.addLink(behind.frontTop, ahead.rearTop, COUPLER);
    world.addLink(behind.frontWheel, ahead.rearWheel, COUPLER);
  }
  world.waterY = world.water0 = level.waterY;
  world.flood = level.flood ?? null;
  // Bolts on mud, other than piles: the members built on each, so the mud feels what it carries.
  design.nodes.forEach((n, p) => {
    if (!n.anchor || n.pile || n.block || n.mast || !mudAt(level, n.x, n.y)) return;
    world.soft.push({ p, y0: n.y, sunk: 0, links: world.links.filter((l) => l.bridge && (l.a === p || l.b === p)), out: false });
  });
  world.wind = level.wind ?? null;
  world.quake = level.quake ?? null;
  if (level.march) {
    world.march = level.march;
    for (const v of vehicles) if (v.def.marches) world.marchers.push(...v.wheels, v.rearTop, v.frontTop);
  }
  return { world, vehicles };
}

export interface Flood {
  /** Where the lead vehicle is when the river starts to rise, m. */
  at: number;
  /** How far the river rises, m. */
  rise: number;
  /** Push of the current on members in the water, N per m under water. */
  current: number;
}

export interface Wind {
  /** Push on members across the wind at a gust's peak, N per m of their height. */
  push: number;
  /** Lift on the deck at a gust's peak, N per m of its length. */
  lift: number;
  /** Seconds from gust to gust. */
  period: number;
}

export interface Quake {
  /** Strongest shaking, as a share of gravity. */
  g: number;
  /** Shakes a second. */
  freq: number;
  /** Where the lead vehicle is when the shaking starts, m, and how long it lasts, s. */
  at: number;
  dur: number;
}

export interface March {
  /** Steps a second, every marcher in time. */
  pace: number;
  /** How much harder each step lands than standing, as a share of the marchers' weight. */
  force: number;
}

/** How hard the wind gusts at time t, 0 to 1: a smooth gust every period, never quite still. */
export function windGust(w: Wind, t: number): number {
  const s = Math.sin((Math.PI * t) / w.period);
  return 0.15 + 0.85 * s * s;
}

/** How strongly the ground shakes t seconds into a quake, 0 to 1: it builds quickly and dies away. */
function quakeEnvelope(q: Quake, t: number): number {
  const u = t / q.dur;
  if (u <= 0 || u >= 1) return 0;
  return Math.min(1, u * 6) * Math.min(1, (1 - u) * 3);
}

/** The ground's acceleration t seconds into a quake, m/s²: mostly sideways, a little up and down. */
export function quakeAccel(q: Quake, t: number): [number, number] {
  const env = quakeEnvelope(q, t);
  if (!env) return [0, 0];
  const w = 2 * Math.PI * q.freq * t;
  const a = q.g * -GRAVITY * env;
  return [a * Math.sin(w), 0.3 * a * Math.sin(1.37 * w + 0.6)];
}

/** How far the ground has moved sideways t seconds into a quake, m, for drawing it. */
export function quakeShift(q: Quake, t: number): number {
  const env = quakeEnvelope(q, t);
  if (!env) return 0;
  const w = 2 * Math.PI * q.freq;
  return (-q.g * -GRAVITY * env * Math.sin(w * t)) / (w * w);
}

/** Extra downward push on a marcher at time t, m/s²: each footfall lands together. */
export function marchAccel(m: March, t: number): number {
  return m.force * -GRAVITY * Math.sin(2 * Math.PI * m.pace * t);
}

/** Where each vehicle waits at the start: its rear wheel's x, lead vehicle first. */
export function convoyLayout(level: LevelDef): { def: VehicleDef; x: number }[] {
  const out: { def: VehicleDef; x: number }[] = [];
  let x = START_X;
  for (const [i, id] of [level.vehicle, ...(level.convoy ?? [])].entries()) {
    const def = VEHICLES[id];
    // Rail vehicles couple up close behind the one ahead.
    if (i > 0) x -= def.rail && out[i - 1].def.rail ? RAIL_GAP + def.wheelbase : CONVOY_GAP + def.wheelbase + def.wheelR;
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
 * Each concrete block as a stiff frame: links along its edges, shared with the block beside it,
 * and across its diagonals. Its corners that aren't bolted bear on rock.
 */
function addCells(world: World, design: Design): void {
  const edges = new Map<string, Link>();
  const rock = new Set<number>();
  design.cells.forEach((c, k) => {
    const mat = MATERIALS[c.mat];
    const links: Link[] = [];
    const link = (a: number, b: number) => {
      const key = a < b ? `${a} ${b}` : `${b} ${a}`;
      let l = edges.get(key);
      if (!l) {
        const len = Math.hypot(world.x[b] - world.x[a], world.y[b] - world.y[a]);
        l = world.addLink(a, b, len / mat.EA, { bridge: true, mat: c.mat, member: -1, cell: k, tensionLimit: mat.tension, compressionLimit: compressionLimit(mat, len), age: 10 });
        edges.set(key, l);
      }
      links.push(l);
    };
    const n = c.n;
    const sides = n.map((a, i) => (link(a, n[(i + 1) % n.length]), links[links.length - 1]));
    // A four-sided block keeps its corners square with angle constraints rather than diagonal
    // braces: a squeezed braced frame would push its own sides apart, which no solid block does.
    if (n.length === 4) {
      for (let i = 0; i < 4; i++) {
        const [a, b, cc] = [n[(i + 3) % 4], n[i], n[(i + 1) % 4]];
        const { x, y } = world;
        const ux = x[cc] - x[a];
        const uy = y[cc] - y[a];
        const L = Math.hypot(ux, uy);
        const rest = ((x[b] - x[a]) * -uy + (y[b] - y[a]) * ux) / L;
        world.bends.push({ a, b, c: cc, rest, compliance: 1 / mat.bend, limit: mat.bendLimit, ab: sides[(i + 3) % 4], bc: sides[i] });
      }
    }
    world.cells.push({ n: [...n], links });
    for (const i of n) if (!design.nodes[i].anchor) rock.add(i);
  });
  world.rock = [...rock];
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

/**
 * Bending stiffness at every joint where two pieces that bend continue one another: deck with
 * deck, and arch with arch.
 */
function addDeckBends(world: World): void {
  const deckAt: number[][] = Array.from({ length: world.bridgeCount }, () => []);
  world.links.forEach((l, i) => {
    if (!l.bridge || !l.mat || MATERIALS[l.mat].bend <= 0) return;
    deckAt[l.a].push(i);
    deckAt[l.b].push(i);
  });
  const { x, y } = world;
  deckAt.forEach((ids, b) => {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const ab = world.links[ids[i]];
        const bc = world.links[ids[j]];
        if (ab.drivable !== bc.drivable) continue;
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
  if (def.rail) for (const w of wheels) world.rail[w] = 1;
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
  /** The design as built: its main cables' runs shape how they are drawn. */
  readonly design: Design;
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
  /** Each design member's highest pull and push during the run, as load ratios (0–1). */
  readonly peakPull: Float32Array;
  readonly peakPush: Float32Array;
  /** When the run succeeded or failed, s. */
  private endedAt: number | null = null;
  /** A level's brake stop: not yet, braking, stopped and waiting since `heldAt`, or done. */
  brakeState: 'none' | 'braking' | 'held' | 'done' = 'none';
  private heldAt = 0;
  private readonly speeds: number[];
  private done: boolean[];
  private lastProgressX: number;
  private lastProgressT = 0;

  constructor(design: Design, level: LevelDef) {
    this.level = level;
    this.design = design;
    const built = buildWorld(design, level);
    this.world = built.world;
    this.vehicles = built.vehicles;
    this.done = this.vehicles.map(() => false);
    // Progress is the tail's, so it starts where the last vehicle in line waits, not at the start line.
    this.lastProgressX = Math.min(...this.vehicles.map((v) => this.xOf(v)));
    this.log = new StressLog(design.members.length);
    this.peakPull = new Float32Array(design.members.length);
    this.peakPush = new Float32Array(design.members.length);
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

  /**
   * On a level with a brake stop: the train brakes once its front reaches the mark, waits once
   * stopped, then goes on. Waiting isn't being stuck.
   */
  private brakeStop(): void {
    const b = this.level.brake;
    if (!b || this.status !== 'running') return;
    const w = this.world;
    const lead = this.vehicle;
    if (this.brakeState === 'none' && w.x[lead.frontWheel] >= b.at) {
      this.brakeState = 'braking';
      w.braking = true;
    }
    if (this.brakeState === 'braking') {
      this.lastProgressT = this.time;
      if (this.vehicles.every((v) => v.wheels.every((p) => Math.abs(w.vx[p]) < 0.05))) {
        this.brakeState = 'held';
        this.heldAt = this.time;
      }
    }
    if (this.brakeState === 'held') {
      this.lastProgressT = this.time;
      if (this.time - this.heldAt >= (b.hold ?? 1.5)) {
        this.brakeState = 'done';
        w.braking = false;
      }
    }
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
    this.brakeStop();
    const q = this.level.quake;
    if (q && w.quakeStart === Infinity && w.x[this.vehicle.frontWheel] >= q.at) w.quakeStart = w.time;
    const f = this.level.flood;
    if (f && w.floodStart === Infinity && w.x[this.vehicle.frontWheel] >= f.at) w.floodStart = w.time;
    for (const l of w.links) {
      if (!l.bridge || l.broken) continue;
      this.peakStress = Math.max(this.peakStress, Math.abs(l.stress));
      if (l.member < 0) continue;
      if (l.stress > this.peakPull[l.member]) this.peakPull[l.member] = l.stress;
      else if (-l.stress > this.peakPush[l.member]) this.peakPush[l.member] = -l.stress;
    }
    for (const p of w.jointLinks.keys()) if (w.jointLinks[p]) this.peakStress = Math.max(this.peakStress, Math.min(1, w.jointRatio(p)));
    for (const b of w.blocks) this.peakStress = Math.max(this.peakStress, Math.min(1, b.util));
    if (this.status !== 'running') this.endedAt ??= this.time;
    this.log.record(this.time, w, this.phase, this.endedAt);
    if (this.status !== 'running') return;

    for (const v of this.vehicles) {
      const lowest = Math.min(w.y[v.rearWheel], w.y[v.frontWheel], w.y[v.rearTop], w.y[v.frontTop]);
      if (lowest < w.waterY) {
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
