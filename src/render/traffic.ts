import { PK, type Particles } from '../fx/particles';
import { bankY, type LevelDef } from '../levels';
import type { VehicleDef } from '../physics/vehicles';
import { convoyLayout, type TestRun, type VehicleHandle } from '../physics/world';
import { PAL } from './palette';
import { hash, TAU } from './shapes';
import { ScenePart, type Stage } from './stage';
import { drawBody, drawRailWheel, drawSoldier, drawWheel, SQUAD_RANKS, squadRank } from './vehicles';

/**
 * A soldier who has broken ranks: where his boots are and how they move, how far into a fall he
 * is (0..1), which way he tumbles, and when and where he went into the river.
 */
interface Soldier {
  x: number;
  y: number;
  vx: number;
  vy: number;
  air: number;
  spin: number;
  swim: { t: number; x: number } | null;
}

/** Vehicles on the bridge: parked, driving, their lights at night, and a marching squad. */
export class Traffic extends ScenePart {
  constructor(stage: Stage, private particles: Particles) {
    super(stage);
  }

  /** Each squad's soldiers once it has broken ranks, and when it was last drawn (sim time). */
  private squads = new WeakMap<VehicleHandle, { last: number; broken: Soldier[] | null }>();

  /** Each vehicle's contact shadow strength, eased from frame to frame. */
  private shadows = new WeakMap<VehicleHandle, number>();

  drawVehicleParked(level: LevelDef): void {
    for (const { def, x, y } of convoyLayout(level)) {
      const r = y + def.wheelR;
      const top = r + def.height * 0.6;
      const mids = (def.midAxles ?? []).map((ax): [number, number] => [x + ax, r]);
      this.vehicle(def, x, r, x + def.wheelbase, r, x, top, x + def.wheelbase, top, mids, [0, 0], true);
    }
  }

  drawVehicleRun(run: TestRun, angles: [number, number][]): void {
    const w = run.world;
    const { ctx, cam } = this;
    // Couplers between rail vehicles, at buffer height.
    ctx.strokeStyle = '#1d1f24';
    ctx.lineWidth = Math.max(2, 0.14 * cam.scale);
    ctx.lineCap = 'butt';
    for (let i = 1; i < run.vehicles.length; i++) {
      const [a, b] = [run.vehicles[i - 1], run.vehicles[i]];
      if (!a.def.rail || !b.def.rail) continue;
      const up = (p: number) => w.y[p] + 0.35;
      ctx.beginPath();
      ctx.moveTo(cam.sx(w.x[b.frontWheel]), cam.sy(up(b.frontWheel)));
      ctx.lineTo(cam.sx(w.x[a.rearWheel]), cam.sy(up(a.rearWheel)));
      ctx.stroke();
    }
    run.vehicles.forEach((v, i) => {
      const mids = v.midWheels.map((p): [number, number] => [w.x[p], w.y[p]]);
      // The contact shadow is there only while wheels touch something, fading as they leave it.
      const touching = v.wheels.filter((p) => w.contact[p]).length / v.wheels.length;
      const was = this.shadows.get(v) ?? touching;
      const shadow = was + (touching - was) * 0.25;
      this.shadows.set(v, shadow);
      if (v.def.marches) return this.squad(run, v, (angles[i]?.[0] ?? 0) * 0.6, shadow);
      this.vehicle(v.def, w.x[v.rearWheel], w.y[v.rearWheel], w.x[v.frontWheel], w.y[v.frontWheel], w.x[v.rearTop], w.y[v.rearTop], w.x[v.frontTop], w.y[v.frontTop], mids, angles[i] ?? [0, 0], false, shadow);
    });
  }

  private vehicle(def: VehicleDef, rwx: number, rwy: number, fwx: number, fwy: number, rtx: number, rty: number, ftx: number, fty: number, mids: [number, number][], angles: [number, number], chalk: boolean, shadow = 1): void {
    const { ctx, cam } = this;
    const s = cam.scale;
    // Body frame from the chassis top points, dropped to the wheel-center line.
    const ang = Math.atan2(fty - rty, ftx - rtx);
    const drop = def.wheelR + def.height * 0.6 - def.wheelR;
    const ox = rtx + Math.sin(ang) * drop;
    const oy = rty - Math.cos(ang) * drop;

    ctx.save();
    ctx.translate(cam.sx(ox), cam.sy(oy));
    ctx.rotate(-ang);
    ctx.scale(s, -s);
    ctx.lineJoin = 'round';
    drawBody(ctx, def, 1 / s, chalk, angles[0] * 0.6, shadow);
    ctx.restore();
    // Marchers walk: there are no wheels to draw.
    if (def.marches) return;

    const R = def.wheelR;
    const heavy = def.id === 'truck' || def.id === 'bus' || def.id === 'semi';
    const rail = !!def.rail;
    this.wheel(rwx, rwy, R, angles[0], chalk, heavy, rail);
    for (const [mx, my] of mids) this.wheel(mx, my, R, angles[0], chalk, heavy, rail);
    this.wheel(fwx, fwy, R, angles[1], chalk, heavy, rail);
  }

  /**
   * A marching squad, soldier by soldier: each stands upright on the squad's line. Once the
   * squad drops or tips off an edge, its soldiers break ranks and go their own ways: those still
   * on a bank march on to its edge and step off, the rest fall flailing, and in the river each
   * comes up where he went in and treads water, drifting apart.
   */
  private squad(run: TestRun, v: VehicleHandle, stride: number, shadow: number): void {
    const { ctx, cam } = this;
    const w = run.world;
    const def = v.def;
    const t = w.time;
    // The same frame the squad's body would be drawn in, from its chassis top points.
    const ang = Math.atan2(w.y[v.frontTop] - w.y[v.rearTop], w.x[v.frontTop] - w.x[v.rearTop]);
    const drop = def.height * 0.6;
    const ox = w.x[v.rearTop] + Math.sin(ang) * drop;
    const oy = w.y[v.rearTop] - Math.cos(ang) * drop;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    let state = this.squads.get(v);
    if (!state) this.squads.set(v, (state = { last: t, broken: null }));
    const dt = Math.min(0.1, Math.max(0, t - state.last));
    state.last = t;
    // Marching boots leave the ground at every step, so a fall goes by how fast the squad
    // drops and how far it tips.
    const vx = (w.vx[v.rearWheel] + w.vx[v.frontWheel]) / 2;
    const vy = Math.min(w.vy[v.rearWheel], w.vy[v.frontWheel]);
    if (!state.broken && (vy < -2.5 || Math.abs(ang) > 0.5)) {
      state.broken = Array.from({ length: SQUAD_RANKS }, (_, k): Soldier => {
        const lx = squadRank(k);
        const ly = -def.wheelR;
        return { x: ox + lx * c - ly * s, y: oy + lx * s + ly * c, vx: vx * (0.8 + 0.4 * hash(k + 1)), vy: Math.min(0, vy) + 1.2 * hash(k + 7), air: 0, spin: (hash(k + 3) - 0.5) * 3, swim: null };
      });
    }
    const L = run.level;
    // Where a soldier who has broken ranks can stand: only on the banks.
    const ground = (x: number) => (x <= 0 ? 0 : x >= L.width ? bankY(L) : null);
    for (let k = 0; k < SQUAD_RANKS; k++) {
      let fx: number;
      let fy: number;
      let lean: number;
      let flail: number;
      let pace = stride;
      let shade = shadow;
      const sol = state.broken?.[k];
      if (!sol) {
        const lx = squadRank(k);
        const ly = -def.wheelR;
        fx = ox + lx * c - ly * s;
        fy = oy + lx * s + ly * c;
        lean = ang * 0.25;
        flail = 0;
      } else {
        if (!sol.swim) {
          const g = ground(sol.x);
          if (g !== null && sol.y <= g + 1e-3 && sol.vy <= 0) {
            // Still on the bank: march on toward the edge, upright.
            sol.y = g;
            sol.vy = 0;
            sol.vx = def.speed;
            sol.air = Math.max(0, sol.air - dt * 4);
          } else {
            sol.vy -= 9.8 * dt;
            sol.air = Math.min(1, sol.air + dt * 5);
          }
          sol.x += sol.vx * dt;
          sol.y += sol.vy * dt;
          if (sol.y < w.waterY) {
            sol.swim = { t, x: sol.x };
            const T = this.look;
            this.particles.burst(PK.Water, sol.x, w.waterY, 14, 4, 0.9, 0.09, [T.foam, '#ffffff', T.waterTop], 4);
          }
        }
        if (sol.swim) {
          // Treading water: head and shoulders up, bobbing, drifting from where he went in.
          const since = t - sol.swim.t;
          // Each squad's soldiers spread out into the river, each by his own amount.
          const reach = 1 + 3 * hash(k * 13 + v.rearWheel * 7);
          fx = sol.swim.x + reach * (1 - Math.exp(-since / 3)) + 0.15 * Math.sin(t * 0.7 + k);
          fy = w.waterY - 1.15 + 0.07 * Math.sin(t * 3 + k * 1.7);
          lean = 0.12 * Math.sin(t * 2 + k);
          flail = 1;
          pace = t * 6 + k * 1.3;
          shade = 0;
        } else {
          fx = sol.x;
          fy = sol.y;
          lean = sol.air * (sol.spin * 0.25 + 0.3 * Math.sin(t * 4 + k * 2.1));
          flail = sol.air;
          pace = sol.air > 0 ? t * 9 + k : stride;
          shade = sol.air > 0.5 ? 0 : 1;
        }
      }
      if (shade > 0.02) {
        ctx.fillStyle = `rgba(0,0,0,${(0.2 * shade).toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(cam.sx(fx), cam.sy(fy), 0.32 * cam.scale, 0.08 * cam.scale, 0, 0, TAU);
        ctx.fill();
      }
      ctx.save();
      ctx.translate(cam.sx(fx), cam.sy(fy));
      ctx.rotate(-lean);
      ctx.scale(cam.scale, -cam.scale);
      ctx.lineJoin = 'round';
      drawSoldier(ctx, def, 1 / cam.scale, pace, flail);
      ctx.restore();
    }
  }

  private wheel(x: number, y: number, r: number, angle: number, chalk: boolean, heavy = false, rail = false): void {
    const { ctx, cam } = this;
    const sx = cam.sx(x);
    const sy = cam.sy(y);
    const R = r * cam.scale;
    if (chalk) {
      ctx.strokeStyle = PAL.chalkDim;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, R, 0, TAU);
      ctx.stroke();
      return;
    }
    if (rail) drawRailWheel(ctx, sx, sy, R, angle);
    else drawWheel(ctx, sx, sy, R, angle, heavy);
  }

  /** Night: headlights and taillights on the vehicle, added as light. */
  drawLights(run: TestRun, v: VehicleHandle, develop: number): void {
    const { ctx, cam } = this;
    const w = run.world;
    const def = v.def;
    let dx = w.x[v.frontTop] - w.x[v.rearTop];
    let dy = w.y[v.frontTop] - w.y[v.rearTop];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // Up, square to the chassis.
    const ux = -dy;
    const uy = dx;
    const R = def.wheelR;
    const lift = def.height * 0.22 + R * 0.25;
    const hx = w.x[v.frontWheel] + dx * R * 1.35 + ux * lift;
    const hy = w.y[v.frontWheel] + dy * R * 1.35 + uy * lift;
    const tx = w.x[v.rearWheel] - dx * R * 1.3 + ux * lift * 1.2;
    const ty = w.y[v.rearWheel] - dy * R * 1.3 + uy * lift * 1.2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = develop;
    // The beam: a cone angled slightly down the road.
    const reach = 7;
    const ang = Math.atan2(dy, dx) - 0.07;
    const spread = 0.2;
    const sx = cam.sx(hx);
    const sy = cam.sy(hy);
    const far = (a: number): [number, number] => [cam.sx(hx + Math.cos(a) * reach), cam.sy(hy + Math.sin(a) * reach)];
    const [ax, ay] = far(ang + spread);
    const [bx, by] = far(ang - spread);
    const [cx, cy] = far(ang);
    const beam = ctx.createLinearGradient(sx, sy, cx, cy);
    beam.addColorStop(0, 'rgba(255,238,190,0.42)');
    beam.addColorStop(1, 'rgba(255,238,190,0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.closePath();
    ctx.fill();
    for (const [x, y, rgb, r] of [
      [sx, sy, '255,240,200', 0.7],
      [cam.sx(tx), cam.sy(ty), '255,40,30', 0.45],
    ] as const) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * cam.scale);
      g.addColorStop(0, `rgba(${rgb},0.95)`);
      g.addColorStop(0.25, `rgba(${rgb},0.35)`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - r * cam.scale, y - r * cam.scale, r * 2 * cam.scale, r * 2 * cam.scale);
    }
    ctx.restore();
  }
}
