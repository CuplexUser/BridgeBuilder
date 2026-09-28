import type { Design } from '../design';
import { bankY, goalX, START_X, type LevelDef } from '../levels';
import { compressionLimit, MATERIALS, type MaterialId } from './materials';
import { VEHICLES, type VehicleDef } from './vehicles';

export const GRAVITY = -9.81;
export const STEP = 1 / 60;
const SUBSTEPS = 24;
const AXIAL_DAMPING = 40; // 1/s, relative axial velocity bleed on bridge members
const AIR_DAMPING = 0.05;
const JOINT_MASS = 6;
const STRESS_SMOOTHING = 0.3;
const SETTLE_TIME = 0.8;

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
  /** Static segments (x1, y1, x2, y2) for the banks and piers. */
  terrain: number[] = [];
  breaks: BreakEvent[] = [];
  floorY: number;
  /** Scaled 0→1 at the start of a run so the bridge takes its own weight gently. */
  gravityScale = 1;

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

      this.solveContacts();

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
        this.contactSegment(p, r, x[l.a], y[l.a], x[l.b], y[l.b], l.a, l.b);
      }
      for (let k = 0; k < t.length; k += 4) {
        this.contactSegment(p, r, t[k], t[k + 1], t[k + 2], t[k + 3], -1, -1);
      }
      if (contact[p]) {
        const len = Math.hypot(cnx[p], cny[p]) || 1;
        cnx[p] /= len;
        cny[p] /= len;
      }
    }
  }

  private contactSegment(p: number, r: number, ax: number, ay: number, bx: number, by: number, ia: number, ib: number): void {
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
      const force = MATERIALS[l.mat!].EA * l.strain;
      const ratio = force >= 0 ? force / l.tensionLimit : force / l.compressionLimit;
      l.stress += (ratio - l.stress) * STRESS_SMOOTHING;
      if (Math.abs(l.stress) >= 1) this.breakLink(l);
    }
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
  rearWheel: number;
  frontWheel: number;
  rearTop: number;
  frontTop: number;
}

/** Builds the physical bridge from a design; world particle i === design node i. */
export function buildWorld(design: Design, level: LevelDef): { world: World; vehicle: VehicleHandle } {
  const world = new World(design.nodes.length + 8, level.waterY - 8);
  const mass = new Float64Array(design.nodes.length).fill(JOINT_MASS);
  for (const m of design.members) {
    const a = design.nodes[m.a];
    const b = design.nodes[m.b];
    const half = (Math.hypot(b.x - a.x, b.y - a.y) * MATERIALS[m.mat].density) / 2;
    mass[m.a] += half;
    mass[m.b] += half;
  }
  design.nodes.forEach((n, i) => world.addParticle(n.x, n.y, n.anchor ? 0 : mass[i]));
  design.members.forEach((m, i) => {
    const mat = MATERIALS[m.mat];
    const a = design.nodes[m.a];
    const b = design.nodes[m.b];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    world.addLink(m.a, m.b, len / mat.EA, {
      bridge: true,
      mat: m.mat,
      tensionOnly: mat.tensionOnly,
      drivable: mat.drivable,
      member: i,
      tensionLimit: mat.tension,
      compressionLimit: compressionLimit(mat, len),
      age: 10,
    });
  });

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

  const vehicle = addVehicle(world, VEHICLES[level.vehicle]);
  return { world, vehicle };
}

function addVehicle(world: World, def: VehicleDef): VehicleHandle {
  const x0 = START_X;
  const r = def.wheelR;
  const wheelMass = def.mass * 0.3;
  const bodyMass = def.mass * 0.2;
  const topY = r + def.height * 0.6;
  const rearWheel = world.addParticle(x0, r, wheelMass, r);
  const frontWheel = world.addParticle(x0 + def.wheelbase, r, wheelMass, r);
  const rearTop = world.addParticle(x0, topY, bodyMass, 0.22);
  const frontTop = world.addParticle(x0 + def.wheelbase, topY, bodyMass, 0.22);
  for (const w of [rearWheel, frontWheel]) {
    world.drive[w] = def.speed;
    world.accel[w] = def.accel;
  }
  const rigid = 1e-8;
  const spring = 4e-6 * (1500 / def.mass);
  world.addLink(rearWheel, frontWheel, rigid);
  world.addLink(rearTop, frontTop, rigid);
  world.addLink(rearWheel, rearTop, spring);
  world.addLink(frontWheel, frontTop, spring);
  world.addLink(rearWheel, frontTop, spring);
  world.addLink(frontWheel, rearTop, spring);
  return { def, rearWheel, frontWheel, rearTop, frontTop };
}

export type RunStatus = 'running' | 'success' | 'fail';

/** One test drive: steps the world and decides success or failure. */
export class TestRun {
  world: World;
  vehicle: VehicleHandle;
  level: LevelDef;
  time = 0;
  status: RunStatus = 'running';
  reason = '';
  peakStress = 0;
  splashed = false;
  private lastProgressX = START_X;
  private lastProgressT = 0;

  constructor(design: Design, level: LevelDef) {
    this.level = level;
    const built = buildWorld(design, level);
    this.world = built.world;
    this.vehicle = built.vehicle;
  }

  get vehicleX(): number {
    const w = this.world;
    return (w.x[this.vehicle.rearWheel] + w.x[this.vehicle.frontWheel]) / 2;
  }

  step(dt: number = STEP): void {
    const w = this.world;
    const ramp = Math.min(1, this.time / SETTLE_TIME);
    w.gravityScale = ramp * ramp * (3 - 2 * ramp);
    w.step(dt);
    this.time += dt;
    for (const l of w.links) {
      if (l.bridge && !l.broken) this.peakStress = Math.max(this.peakStress, Math.abs(l.stress));
    }
    if (this.status !== 'running') return;

    const v = this.vehicle;
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
    const x = this.vehicleX;
    if (x > this.lastProgressX + 0.3) {
      this.lastProgressX = x;
      this.lastProgressT = this.time;
    } else if (this.time - this.lastProgressT > 3.5) {
      this.fail('The vehicle got stuck.');
      return;
    }
    if (Math.min(w.x[v.rearWheel], w.x[v.frontWheel]) > goalX(this.level)) {
      this.status = 'success';
    }
  }

  private fail(reason: string): void {
    this.status = 'fail';
    this.reason = reason;
  }
}
