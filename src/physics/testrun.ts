/** A test drive: the world built from a design, stepped until the traffic reaches the flag or the bridge fails. */
import { segmentHitsRect, type Design } from '../design';
import { goalX, type LevelDef } from '../levels';
import { buildWorld, convoyLayout, type VehicleHandle } from './build';
import { MATERIALS } from './materials';
import { deckLoad } from './vehicles';
import { t as msg } from '../i18n';
import { matInline, matName, vehicleInline } from '../i18n/data';
import { StressLog } from './stresslog';
import { CLOSE_TIME, OPEN_TIME, SETTLE_TIME, SHIP_HALF, SHIP_TIME, SHIP_WAIT, STEP, World } from './world';

/**
 * How long a test drive may run before it counts as stuck, s: 30, or longer for a convoy too slow
 * to get its last vehicle to the goal in that time, such as marching squads.
 */
export function testSeconds(level: LevelDef): number {
  const lay = convoyLayout(level);
  const speed = Math.min(...lay.map((c) => c.def.speed));
  // How far back the last vehicle waits, from its own lane's side.
  const tail = Math.min(...lay.map((c) => (c.dir > 0 ? c.x : level.width - c.x)));
  const waits = SETTLE_TIME + (level.ship ? OPEN_TIME + SHIP_TIME + CLOSE_TIME : 0) + (level.brake ? (level.brake.hold ?? 1.5) + 4 : 0);
  // A third more than a steady drive takes, for starting off, braking and climbing.
  return Math.max(30, Math.ceil(waits + ((goalX(level) - tail) / speed) * 4 / 3));
}

/**
 * Whether a marching squad has been thrown off its feet: off the deck altogether and falling
 * fast, or tipped steeply. Its soldiers break ranks and go into the river. A lively deck bounces
 * a squad's boots off it at every step without throwing anyone.
 */
export function squadThrown(w: World, v: VehicleHandle): boolean {
  const ang = Math.atan2(w.y[v.frontTop] - w.y[v.rearTop], w.x[v.frontTop] - w.x[v.rearTop]);
  if (Math.abs(ang) > 0.5) return true;
  if (w.contact[v.rearWheel] || w.contact[v.frontWheel]) return false;
  return (w.vy[v.rearWheel] + w.vy[v.frontWheel] + w.vy[v.rearTop] + w.vy[v.frontTop]) / 4 < -2.5;
}

/** Squads a crossing may lose and still count, though for one star only. */
export const SQUADS_SPARED = 1;

export type RunStatus = 'running' | 'success' | 'fail';
export type Phase = 'settle' | 'opening' | 'ship' | 'closing' | 'driving';
/** One test drive: steps the world and decides success or failure. */
/** Smoothstep: eases 0..1 in and out, clamped. */
export function smooth(u: number): number {
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
  /** Marching squads the deck threw off, which no longer count toward the crossing. */
  readonly lost = new Set<VehicleHandle>();
  phase: Phase = 'settle';
  /** Where the tall ship passes through, on drawbridge levels: the channel's middle. */
  shipX = 0;
  /** The ship's passage: below 0 it's still on its way, 0 to 1 it's passing through, above 1 it's gone. */
  shipProgress = -1;
  /** When traffic may start: straight away, or once a drawbridge has closed again. */
  readonly releaseAt: number;
  /** When the last vehicle got across, on a level where the ship waits for the traffic. */
  trafficAcross = Infinity;
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
    this.lastProgressX = Math.min(...this.vehicles.map((v) => this.progressOf(v)));
    this.log = new StressLog(design.members.length);
    this.peakPull = new Float32Array(design.members.length);
    this.peakPush = new Float32Array(design.members.length);
    this.releaseAt = level.ship && !level.ship.after ? SETTLE_TIME + OPEN_TIME + SHIP_TIME + CLOSE_TIME : 0;
    this.speeds = this.vehicles.flatMap((v) => v.wheels.map((p) => this.world.drive[p]));
    if (level.ship) {
      if (!level.ship.after) this.hold(true);
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
    const xs = this.vehicles.filter((v) => !this.lost.has(v)).map((v) => this.xOf(v));
    return (Math.min(...xs) + Math.max(...xs)) / 2;
  }

  private xOf(v: VehicleHandle): number {
    const w = this.world;
    return (w.x[v.rearWheel] + w.x[v.frontWheel]) / 2;
  }

  /** How far a vehicle has come from its own side: its x, or for oncoming traffic, its distance from the right bank. */
  private progressOf(v: VehicleHandle): number {
    return v.dir > 0 ? this.xOf(v) : this.level.width - this.xOf(v);
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
    for (const v of this.vehicles) {
      for (const p of v.wheels) {
        const speed = this.speeds[k++];
        w.drive[p] = on || this.lost.has(v) ? 0 : speed;
      }
    }
  }

  /** Opens and closes a drawbridge on its timeline and moves the ship through: first, or once the traffic is across. */
  private drawbridge(): void {
    const t = this.time;
    const w = this.world;
    const after = !!this.level.ship!.after;
    if (after && this.trafficAcross === Infinity) {
      this.phase = t < SETTLE_TIME ? 'settle' : 'driving';
      return;
    }
    const openAt = after ? this.trafficAcross + SHIP_WAIT : SETTLE_TIME;
    const shipAt = openAt + OPEN_TIME;
    const closeAt = shipAt + SHIP_TIME;
    w.openness = t < closeAt ? smooth((t - openAt) / OPEN_TIME) : 1 - smooth((t - closeAt) / CLOSE_TIME);
    this.phase = t < openAt ? (after ? 'driving' : 'settle') : t < shipAt ? 'opening' : t < closeAt ? 'ship' : after || t < this.releaseAt ? 'closing' : 'driving';
    this.shipProgress = (t - shipAt) / SHIP_TIME;
    // A swing bridge has turned aside, out of the ship's way.
    if (this.phase === 'ship' && this.status === 'running' && !this.level.swing) {
      const top = this.level.ship!.mast;
      const x = this.shipX;
      const hit = w.links.some((l) => l.bridge && !l.broken && segmentHitsRect(w.x[l.a], w.y[l.a], w.x[l.b], w.y[l.b], x - SHIP_HALF, this.level.waterY - 1, x + SHIP_HALF, top));
      if (hit) this.fail(msg('fail.ship'));
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
    let deckBroke: (typeof w.links)[number] | null = null;
    for (const l of w.links) {
      if (!l.bridge) continue;
      if (l.broken) {
        // A part that broke was loaded to its limit, whether or not the deck came down with it.
        this.peakStress = 1;
        if (l.drivable) deckBroke ??= l;
        continue;
      }
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

    // The bridge has to hold: once its deck gives way, the run is lost even if the traffic could
    // still scramble across. A part that breaks off without bringing the deck down is no collapse.
    if (deckBroke) {
      this.fail(msg('fail.deck', { mat: matInline(deckBroke.mat!) }));
      return;
    }
    for (const v of this.vehicles) {
      if (this.lost.has(v)) continue;
      if (v.def.marches && squadThrown(w, v)) {
        this.lose(v);
        if (this.lost.size > SQUADS_SPARED) {
          this.fail(msg('fail.squad'));
          return;
        }
        continue;
      }
      const lowest = Math.min(w.y[v.rearWheel], w.y[v.frontWheel], w.y[v.rearTop], w.y[v.frontTop]);
      if (lowest < w.waterY) {
        this.splashed = true;
        this.fail(msg('fail.swim'));
        return;
      }
      const upX = (w.x[v.frontTop] - w.x[v.rearTop]) * v.dir;
      const upY = w.y[v.frontTop] - w.y[v.rearTop];
      const bodyAboveWheels = (w.y[v.rearTop] + w.y[v.frontTop]) / 2 - (w.y[v.rearWheel] + w.y[v.frontWheel]) / 2;
      if (bodyAboveWheels < -0.1 || upX < -0.2 * Math.abs(upY)) {
        this.fail(msg('fail.flipped'));
        return;
      }
    }
    this.vehicles.forEach((v, i) => {
      if (this.lost.has(v)) this.done[i] = true;
      // Its hindmost wheel is past the goal on the far side.
      else if (Math.min(v.dir * w.x[v.rearWheel], v.dir * w.x[v.frontWheel]) > v.dir * goalX(this.level, v.dir)) this.done[i] = true;
    });
    if (this.done.every(Boolean)) {
      // Where the ship waits for the traffic, the run ends once it has sailed through too.
      if (!this.level.ship?.after || this.shipProgress > 1) this.status = 'success';
      else if (this.trafficAcross === Infinity) this.trafficAcross = this.time;
      return;
    }
    if (this.time < this.releaseAt) return;
    // Progress of the last vehicle still on its way.
    const x = Math.min(...this.vehicles.filter((_, i) => !this.done[i]).map((v) => this.progressOf(v)));
    if (x > this.lastProgressX + 0.3) {
      this.lastProgressX = x;
      this.lastProgressT = this.time;
    } else if (this.time - this.lastProgressT > 3.5) {
      this.fail(msg('fail.stuck'));
    }
  }

  /** A thrown squad's soldiers go into the river: it leaves the deck and the convoy. */
  private lose(v: VehicleHandle): void {
    const w = this.world;
    this.lost.add(v);
    const ps = [...v.wheels, v.rearTop, v.frontTop];
    for (const p of ps) {
      w.radius[p] = 0;
      w.drive[p] = 0;
    }
    w.marchers = w.marchers.filter((p) => !ps.includes(p));
  }

  /** Whether anything on the bridge broke: a member snapped or an anchor torn loose. */
  get collapsed(): boolean {
    return this.world.links.some((l) => l.bridge && l.broken) || this.world.blocks.some((b) => b.loose);
  }

  private fail(reason: string): void {
    this.status = 'fail';
    const crushed = this.world.links.find((l) => l.crushed && l.broken);
    if (crushed) {
      const def = this.vehicles.map((v) => v.def).find((d) => deckLoad(d) === crushed.crushedBy) ?? this.vehicle.def;
      const rating = MATERIALS[crushed.mat!].rating;
      reason = def.deckTonnes
        ? msg('fail.crushedSpread', { name: vehicleInline(def.id), t: def.deckTonnes, mat: matName(crushed.mat!), rating })
        : msg('fail.crushed', { name: vehicleInline(def.id), t: def.tonnes, mat: matName(crushed.mat!), rating });
    } else if (this.world.blocks.some((b) => b.loose)) {
      reason = msg('fail.anchor');
    }
    this.reason = reason;
  }
}
