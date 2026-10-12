import { PK, WHIP_LIFE, type Debris, type Particles, type Whip } from '../fx/particles';
import type { TestRun } from '../physics/testrun';
import type { Members } from './members';
import { PAL } from './palette';
import type { FloatText } from './renderer';
import { hash, MEMBER_WIDTH, TAU } from './shapes';
import { ScenePart, type Stage } from './stage';

/** Shades of broken concrete deck. */
const CHUNK_SHADES = ['#8d939c', '#6f757e', '#a4a9b1', '#5d6168'];

/** Effects over the scene: particles, floating text, wreckage and snapping cables. */
export class Effects extends ScenePart {
  constructor(stage: Stage, private members: Members, private particles: Particles) {
    super(stage);
  }

  drawParticles(): void {
    const { ctx, cam } = this;
    const p = this.particles;
    for (let i = 0; i < p.n; i++) {
      const k = p.kind[i];
      const t = p.life[i] / p.max[i];
      const x = cam.sx(p.x[i]);
      const y = cam.sy(p.y[i]);
      const size = p.size[i] * cam.scale;
      ctx.fillStyle = p.color[i];
      ctx.strokeStyle = p.color[i];
      if (k === PK.Dust || k === PK.Chalk) {
        ctx.globalAlpha = t * (k === PK.Chalk ? 0.9 : 0.5);
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, size * (1.6 - t * 0.6)), 0, TAU);
        ctx.fill();
      } else if (k === PK.Splinter || k === PK.Confetti) {
        ctx.globalAlpha = Math.min(1, t * 3);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.rot[i]);
        const sq = k === PK.Confetti ? Math.cos(p.rot[i] * 1.7) : 1;
        ctx.fillRect(-size / 2, (-size * 0.3 * sq) / 2, size, Math.max(1, size * 0.3 * Math.abs(sq)));
        ctx.restore();
      } else if (k === PK.Spark) {
        ctx.globalAlpha = t;
        ctx.lineWidth = Math.max(1, size);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - p.vx[i] * cam.scale * 0.03, y + p.vy[i] * cam.scale * 0.03);
        ctx.stroke();
      } else if (k === PK.Water) {
        ctx.globalAlpha = Math.min(1, t * 2);
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, size), 0, TAU);
        ctx.fill();
      } else if (k === PK.Ring) {
        ctx.globalAlpha = t * 0.8;
        ctx.lineWidth = Math.max(1, 3 * t);
        ctx.beginPath();
        ctx.arc(x, y, size * (1 - t) + 2, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawFloats(floats: FloatText[]): void {
    const { ctx, cam } = this;
    for (const f of floats) {
      const t = f.life / f.max;
      const pop = t > 0.85 ? 1 + (t - 0.85) * 3 : 1;
      ctx.globalAlpha = Math.min(1, t * 2.5);
      ctx.font = `800 ${Math.round(f.size * pop)}px "Space Grotesk", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const x = cam.sx(f.x);
      const y = cam.sy(f.y);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(8,16,32,0.8)';
      ctx.strokeText(f.text, x, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  drawDebris(items: Debris[]): void {
    const { ctx, cam } = this;
    for (const d of items) {
      if (d.kind === 'chunk') {
        // A lump of broken deck: an irregular polygon, tumbling.
        const r = d.len * cam.scale * 0.5;
        const x = cam.sx(d.x);
        const y = cam.sy(d.y);
        ctx.globalAlpha = Math.min(1, d.life);
        ctx.fillStyle = CHUNK_SHADES[Math.floor(d.seed * CHUNK_SHADES.length)];
        ctx.strokeStyle = '#3a3e45';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = d.ang + (k / 6) * TAU;
          const rr = r * (0.65 + 0.35 * hash(d.seed * 97 + k));
          if (k) ctx.lineTo(x + Math.cos(a) * rr, y - Math.sin(a) * rr);
          else ctx.moveTo(x + Math.cos(a) * rr, y - Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      const c = Math.cos(d.ang) * d.len * 0.5;
      const s = Math.sin(d.ang) * d.len * 0.5;
      this.members.memberPaint(cam.sx(d.x - c), cam.sy(d.y - s), cam.sx(d.x + c), cam.sy(d.y + s), d.mat, null, Math.min(1, d.life));
    }
  }

  /**
   * Snapped cables: each half recoils toward its joint with a traveling ripple, then hangs
   * limp and fades.
   */
  drawWhips(run: TestRun, whips: Whip[]): void {
    if (whips.length === 0) return;
    const { ctx, cam } = this;
    const w = run.world;
    const width = Math.max(2, MEMBER_WIDTH.cable * cam.scale * 1.4) + 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const wh of whips) {
      const t = wh.t;
      const u = Math.min(1, t / 0.35);
      // Most of the cable snaps back; what is left droops under gravity.
      const len = wh.len * (1 - 0.72 * (1 - (1 - u) * (1 - u)));
      const droop = Math.min(1, t / 0.9);
      let dx = wh.dx * (1 - droop);
      let dy = wh.dy * (1 - droop) - droop;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl;
      dy /= dl;
      const nx = -dy;
      const ny = dx;
      const amp = Math.min(0.8, wh.len * 0.16) * (1 - t / WHIP_LIFE);
      const ax = w.x[wh.node];
      const ay = w.y[wh.node];
      ctx.globalAlpha = Math.min(1, (WHIP_LIFE - t) * 3);
      ctx.beginPath();
      for (let k = 0; k <= 14; k++) {
        const sAlong = k / 14;
        const wave = amp * Math.sin(sAlong * Math.PI * 3 - t * 34) * sAlong;
        const x = ax + dx * len * sAlong + nx * wave;
        const y = ay + dy * len * sAlong + ny * wave;
        if (k) ctx.lineTo(cam.sx(x), cam.sy(y));
        else ctx.moveTo(cam.sx(x), cam.sy(y));
      }
      ctx.strokeStyle = PAL.cable;
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.setLineDash([2.5, 2]);
      ctx.strokeStyle = PAL.cableHi;
      ctx.lineWidth = Math.max(0.8, width * 0.4);
      ctx.stroke();
      ctx.setLineDash([]);
      if (t < 0.4) {
        // The recoil flashes as it lashes back.
        ctx.strokeStyle = `rgba(255,248,220,${0.85 * (1 - t / 0.4)})`;
        ctx.lineWidth = width + 3;
        ctx.stroke();
      }
      // The frayed end.
      const ex = cam.sx(ax + dx * len);
      const ey = cam.sy(ay + dy * len);
      ctx.strokeStyle = PAL.cableHi;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const f of [-0.6, 0, 0.6]) {
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex + (dx * 0.9 + nx * f * 0.5) * width * 2.5, ey - (dy * 0.9 + ny * f * 0.5) * width * 2.5);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
