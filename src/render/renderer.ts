import type { AttachPick, Editor } from '../editor';
import type { Debris, DebrisField, Particles } from '../fx/particles';
import { PK } from '../fx/particles';
import { bankY, goalX, START_X, type LevelDef, type Overhang } from '../levels';
import { MATERIALS, type MaterialId } from '../physics/materials';
import { VEHICLES, type VehicleDef } from '../physics/vehicles';
import type { Link, TestRun } from '../physics/world';
import type { Camera } from './camera';
import { MATERIAL_CHALK, PAL, stressColor } from './palette';
import { drawBody, drawWheel } from './vehicles';

export interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  max: number;
  size: number;
}

export interface SceneView {
  level: LevelDef;
  editor: Editor | null;
  run: TestRun | null;
  /** 0 = pure blueprint, 1 = fully developed golden-hour scene. */
  develop: number;
  hoverNode: number;
  hoverMember: number;
  hoverAttach: AttachPick | null;
  showCursor: boolean;
  showHint: boolean;
  time: number;
  flash: number;
  wheelAngles: [number, number];
  floats: FloatText[];
}

const TAU = Math.PI * 2;
const MEMBER_WIDTH: Record<MaterialId, number> = { road: 0.3, heavy: 0.36, wood: 0.17, steel: 0.15, cable: 0.06 };

/** Deterministic 0..1 noise so scenery stays put between frames. */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** World-space outline of an overhang: a rock mass above one approach, with a ragged underside. */
function overhangPoly(o: Overhang, W: number): [number, number][] {
  const dir = o.side === 'left' ? 1 : -1;
  const edge = o.side === 'left' ? 0 : W;
  const back = edge - dir * 80;
  const tip = edge + dir * o.reach;
  return [
    [back, o.top + 6],
    [back, o.bottom],
    [edge - dir * 1.2, o.bottom],
    [edge - dir * 0.3, o.bottom - 0.25],
    [tip - dir * 0.2, o.bottom + 0.1],
    [tip, o.bottom + 0.6],
    [tip + dir * 0.25, o.bottom + 1.8],
    [tip - dir * 0.1, o.top - 1.5],
    [tip - dir * 0.6, o.top],
    [edge - dir * 0.5, o.top + 1.2],
    [edge - dir * 2, o.top + 6],
  ];
}

/** Paint order for a bridge link: cables, then truss, then deck. */
function drawLayer(l: Link): number {
  return l.tensionOnly ? 0 : l.drivable ? 2 : 1;
}

function easeOutBack(t: number): number {
  const c = 1.9;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  /** Pre-rendered full-screen layers: redrawing big gradients every frame is costly on mobile. */
  private skyLayer: HTMLCanvasElement = document.createElement('canvas');
  private vignetteLayer: HTMLCanvasElement = document.createElement('canvas');
  private hatch: CanvasPattern | null = null;
  private sunX = 0;
  private sunY = 0;
  w = 0;
  h = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private cam: Camera,
    private particles: Particles,
    private debris: DebrisField,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cam.resize(this.w, this.h);
    this.buildLayers(dpr);
  }

  private buildLayers(dpr: number): void {
    const { w, h } = this;
    this.sunX = w * 0.72;
    this.sunY = h * 0.4;
    const prep = (c: HTMLCanvasElement) => {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      const x = c.getContext('2d')!;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      return x;
    };
    const sx = prep(this.skyLayer);
    const g = sx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, PAL.skyTop);
    g.addColorStop(0.55, PAL.skyMid);
    g.addColorStop(1, PAL.skyLow);
    sx.fillStyle = g;
    sx.fillRect(0, 0, w, h);
    const glow = sx.createRadialGradient(this.sunX, this.sunY, 0, this.sunX, this.sunY, h * 0.45);
    glow.addColorStop(0, 'rgba(255,241,196,0.85)');
    glow.addColorStop(0.15, 'rgba(255,210,140,0.35)');
    glow.addColorStop(1, 'rgba(255,180,120,0)');
    sx.fillStyle = glow;
    sx.fillRect(0, 0, w, h);
    sx.fillStyle = PAL.sun;
    sx.beginPath();
    sx.arc(this.sunX, this.sunY, Math.max(18, h * 0.06), 0, TAU);
    sx.fill();

    const vx = prep(this.vignetteLayer);
    const v = vx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(10,5,30,0.45)');
    vx.fillStyle = v;
    vx.fillRect(0, 0, w, h);

    const tile = document.createElement('canvas');
    tile.width = tile.height = 10;
    const tx = tile.getContext('2d')!;
    tx.strokeStyle = 'rgba(233,243,255,0.13)';
    tx.lineWidth = 1;
    tx.beginPath();
    tx.moveTo(-1, 11);
    tx.lineTo(11, -1);
    tx.stroke();
    this.hatch = this.ctx.createPattern(tile, 'repeat');
  }

  draw(v: SceneView): void {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = PAL.paperDeep;
    ctx.fillRect(0, 0, this.w, this.h);

    // Background: blueprint, then the painted scene wiped in from the left.
    if (v.develop < 1) this.drawBlueprint(v);
    if (v.develop > 0) {
      ctx.save();
      if (v.develop < 1) {
        const edge = this.w * 1.3 * v.develop - this.h * 0.3;
        ctx.beginPath();
        ctx.moveTo(-10, -10);
        ctx.lineTo(edge + this.h * 0.3, -10);
        ctx.lineTo(edge, this.h + 10);
        ctx.lineTo(-10, this.h + 10);
        ctx.closePath();
        ctx.clip();
      }
      this.drawScene(v);
      ctx.restore();
      if (v.develop < 1) {
        const edge = this.w * 1.3 * v.develop - this.h * 0.3;
        ctx.beginPath();
        ctx.moveTo(edge + this.h * 0.3, -10);
        ctx.lineTo(edge, this.h + 10);
        ctx.strokeStyle = 'rgba(255,204,51,0.3)';
        ctx.lineWidth = 16;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,240,200,0.95)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }

    if (v.run) {
      if (v.develop > 0) this.drawReflection(v.run, v);
      this.drawRunMembers(v.run, v.time);
      this.drawDebris(this.debris.items);
      this.drawVehicleRun(v.run, v.wheelAngles);
      this.drawWaterFront(v);
    } else if (v.editor) {
      this.drawVehicleParked(v.level);
      if (v.showHint) this.drawHint(v);
      this.drawEditor(v, v.editor);
    }

    this.drawParticles();
    this.drawFloats(v.floats);

    if (v.develop > 0) {
      ctx.globalAlpha = v.develop;
      ctx.drawImage(this.vignetteLayer, 0, 0, this.w, this.h);
      ctx.globalAlpha = 1;
    }
    if (v.flash > 0) {
      ctx.fillStyle = `rgba(255,250,235,${Math.min(0.6, v.flash)})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    ctx.restore();
  }

  // ───────────────────────────── Blueprint ─────────────────────────────

  private drawBlueprint(v: SceneView): void {
    const { ctx, cam } = this;
    ctx.fillStyle = PAL.paper;
    ctx.fillRect(0, 0, this.w, this.h);

    const x0 = Math.floor(cam.wx(0));
    const x1 = Math.ceil(cam.wx(this.w));
    const y0 = Math.floor(cam.wy(this.h));
    const y1 = Math.ceil(cam.wy(0));
    const step = cam.scale < 9 ? 2 : 1;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0 - (x0 % step); x <= x1; x += step) {
      if (x % 4 === 0) continue;
      const sx = Math.round(cam.sx(x)) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, this.h);
    }
    for (let y = y0 - (y0 % step); y <= y1; y += step) {
      if (y % 4 === 0) continue;
      const sy = Math.round(cam.sy(y)) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(this.w, sy);
    }
    ctx.strokeStyle = PAL.gridMinor;
    ctx.stroke();
    ctx.beginPath();
    for (let x = x0 - (x0 % 4) - 4; x <= x1; x += 4) {
      const sx = Math.round(cam.sx(x)) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, this.h);
    }
    for (let y = y0 - (y0 % 4) - 4; y <= y1; y += 4) {
      const sy = Math.round(cam.sy(y)) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(this.w, sy);
    }
    ctx.strokeStyle = PAL.gridMajor;
    ctx.stroke();

    const L = v.level;
    const W = L.width;
    const deep = L.waterY - 30;

    // Water: faint fill and a wavy chalk line.
    const wy = cam.sy(L.waterY);
    ctx.fillStyle = 'rgba(108,198,255,0.07)';
    ctx.fillRect(cam.sx(0), wy, cam.sx(W) - cam.sx(0), this.h - wy);
    ctx.strokeStyle = PAL.chalkDim;
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = cam.sx(0); x <= cam.sx(W); x += 6) {
      const y = wy + Math.sin(x * 0.08 + v.time * 2) * 2.5;
      if (x === cam.sx(0)) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Banks and piers: chalk outline with hatching.
    const banks: [number, number][][] = [
      [[-80, 0], [0, 0], [0, deep], [-80, deep]],
      [[W, bankY(L)], [W + 80, bankY(L)], [W + 80, deep], [W, deep]],
    ];
    for (const [px, py] of L.piers) {
      banks.push([[px - 0.45, py], [px + 0.45, py], [px + 0.45, deep], [px - 0.45, deep]]);
    }
    for (const o of L.overhangs ?? []) banks.push(overhangPoly(o, W));
    for (const poly of banks) {
      ctx.beginPath();
      poly.forEach(([x, y], i) => (i ? ctx.lineTo(cam.sx(x), cam.sy(y)) : ctx.moveTo(cam.sx(x), cam.sy(y))));
      ctx.closePath();
      ctx.fillStyle = 'rgba(11,29,56,0.65)';
      ctx.fill();
      if (this.hatch) {
        ctx.fillStyle = this.hatch;
        ctx.fill();
      }
      ctx.strokeStyle = PAL.chalk;
      ctx.lineWidth = 2;
      ctx.beginPath();
      poly.forEach(([x, y], i) => (i ? ctx.lineTo(cam.sx(x), cam.sy(y)) : ctx.moveTo(cam.sx(x), cam.sy(y))));
      ctx.stroke();
    }

    for (const t of L.towers ?? []) this.tower(t[0], t[1], t[2], true);
    for (const [cx0, cx1, top] of L.channels ?? []) this.channelBlueprint(cx0, cx1, top, L.waterY);

    // Dimension line across the gap.
    const dimY = cam.sy((v.editor?.topY ?? 4) - 0.4);
    const ax = cam.sx(0);
    const bx = cam.sx(W);
    ctx.strokeStyle = PAL.cyan;
    ctx.fillStyle = PAL.cyan;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ax, dimY - 8);
    ctx.lineTo(ax, dimY + 8);
    ctx.moveTo(bx, dimY - 8);
    ctx.lineTo(bx, dimY + 8);
    ctx.moveTo(ax, dimY);
    ctx.lineTo(bx, dimY);
    ctx.stroke();
    for (const [x, dir] of [[ax, 1], [bx, -1]] as const) {
      ctx.beginPath();
      ctx.moveTo(x, dimY);
      ctx.lineTo(x + dir * 8, dimY - 3.5);
      ctx.lineTo(x + dir * 8, dimY + 3.5);
      ctx.fill();
    }
    const label = `${W.toFixed(1)} m`;
    ctx.font = '600 12px "JetBrains Mono", monospace';
    const tw = ctx.measureText(label).width + 12;
    ctx.fillStyle = PAL.paper;
    ctx.fillRect((ax + bx) / 2 - tw / 2, dimY - 9, tw, 18);
    ctx.fillStyle = PAL.cyan;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, (ax + bx) / 2, dimY + 1);

    // Goal marker.
    const gx = cam.sx(goalX(L));
    ctx.strokeStyle = PAL.chalkDim;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    const gy = bankY(L);
    ctx.moveTo(gx, cam.sy(gy));
    ctx.lineTo(gx, cam.sy(gy + 2.4));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = PAL.chalkDim;
    ctx.beginPath();
    ctx.moveTo(gx, cam.sy(gy + 2.4));
    ctx.lineTo(gx + 0.9 * cam.scale, cam.sy(gy + 2.1));
    ctx.lineTo(gx, cam.sy(gy + 1.8));
    ctx.fill();
  }

  // ───────────────────────────── Golden hour scene ─────────────────────────────

  private drawScene(v: SceneView): void {
    const { ctx, cam } = this;
    const L = v.level;
    const W = L.width;
    ctx.drawImage(this.skyLayer, 0, 0, this.w, this.h);
    const sunX = this.sunX;

    this.clouds(v.time);

    // Parallax ranges: hazy mountains, then two layers of hills.
    const horizon = cam.sy(L.waterY + 0.5);
    this.hills(horizon - 70, 0.06, 95, PAL.mountain, 0.0022, 7.7, true);
    this.hills(horizon - 30, 0.15, 60, PAL.hillFar, 0.004, 1.3);
    this.hills(horizon - 5, 0.3, 40, PAL.hillNear, 0.007, 4.1);

    // Water body.
    const wy = cam.sy(L.waterY);
    const wg = ctx.createLinearGradient(0, wy, 0, this.h);
    wg.addColorStop(0, PAL.waterTop);
    wg.addColorStop(1, PAL.waterDeep);
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.moveTo(0, this.h);
    for (let x = 0; x <= this.w + 12; x += 12) {
      ctx.lineTo(x, wy + Math.sin(x * 0.03 + v.time * 1.6) * 3 + Math.sin(x * 0.011 - v.time) * 2);
    }
    ctx.lineTo(this.w, this.h);
    ctx.fill();
    // Sun glints on the water.
    ctx.fillStyle = 'rgba(255,230,180,0.5)';
    for (let i = 0; i < 14; i++) {
      const gx = sunX + Math.sin(i * 7.3 + v.time * 0.7) * 50 * (1 + i * 0.15);
      const gy = wy + 8 + i * 7;
      if (gy > this.h) break;
      ctx.fillRect(gx - 12 + Math.sin(v.time * 3 + i) * 4, gy, 24 - i, 2);
    }

    // Banks: rock with a grass lip.
    const deep = L.waterY - 30;
    this.bank([[-80, 0], [0, 0], [0.15, -0.8], [-0.1, -2.2], [0.2, -3.5], [0, deep], [-80, deep]]);
    const rY = bankY(L);
    this.bank([[W, rY], [W + 80, rY], [W + 80, deep], [W, deep], [W - 0.2, rY - 3.5], [W + 0.1, rY - 2.2], [W - 0.15, rY - 0.8]]);
    const gs = Math.max(3, 0.28 * cam.scale);
    ctx.fillStyle = PAL.grass;
    ctx.fillRect(cam.sx(-80), cam.sy(0) - 1, cam.sx(0.1) - cam.sx(-80), gs);
    ctx.fillRect(cam.sx(W - 0.1), cam.sy(rY) - 1, cam.sx(W + 80) - cam.sx(W - 0.1), gs);
    ctx.fillStyle = PAL.grassDark;
    ctx.fillRect(cam.sx(-80), cam.sy(0) - 1 + gs, cam.sx(0.1) - cam.sx(-80), 2);
    ctx.fillRect(cam.sx(W - 0.1), cam.sy(rY) - 1 + gs, cam.sx(W + 80) - cam.sx(W - 0.1), 2);
    this.trees(-2.5, -45, 0, 1);
    this.trees(goalX(L) + 2, W + 45, rY, 2);
    this.tufts(-40, -0.3, 0);
    this.tufts(W + 0.3, W + 40, rY);

    for (const o of L.overhangs ?? []) this.overhang(o, W);

    // Piers.
    for (const [px, py] of L.piers) {
      const l = cam.sx(px - 0.45);
      const r = cam.sx(px + 0.45);
      const t = cam.sy(py);
      const g = ctx.createLinearGradient(l, 0, r, 0);
      g.addColorStop(0, PAL.concrete);
      g.addColorStop(1, PAL.concreteDark);
      ctx.fillStyle = g;
      ctx.fillRect(l, t, r - l, this.h - t);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(l, cam.sy(L.waterY) - 2, r - l, 6);
    }

    for (const t of L.towers ?? []) this.tower(t[0], t[1], t[2], false);
    for (const [x0, x1, top] of L.channels ?? []) this.channelScene(x0, x1, top, L.waterY, v.time);

    // Finish flag.
    const fx = cam.sx(goalX(L));
    const fy = cam.sy(rY);
    const pole = 2.6 * cam.scale;
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = Math.max(2, 0.07 * cam.scale);
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx, fy - pole);
    ctx.stroke();
    const fw = 1.1 * cam.scale;
    const fh = 0.7 * cam.scale;
    const cells = 4;
    for (let i = 0; i < cells; i++) {
      for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#222' : '#fff';
        const wave = Math.sin(v.time * 6 - i * 0.9) * 0.08 * cam.scale * (i / cells);
        ctx.fillRect(fx + (i * fw) / cells, fy - pole + (j * fh) / 2 + wave, fw / cells + 0.5, fh / 2 + 0.5);
      }
    }
  }

  private hills(base: number, parallax: number, amp: number, color: string, freq: number, seed: number, peaks = false): void {
    const { ctx, cam } = this;
    const off = cam.cx * cam.scale * parallax;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, this.h);
    for (let x = 0; x <= this.w + 16; x += 16) {
      const u = (x + off) * freq;
      let y = base - amp * (0.6 + 0.4 * Math.sin(u + seed)) - amp * 0.5 * Math.sin(u * 2.3 + seed * 2);
      // Mountains get sharper ridges from a folded sine.
      if (peaks) y -= amp * 0.35 * (1 - Math.abs(Math.sin(u * 3.1 + seed)));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(this.w, this.h);
    ctx.fill();
  }

  /** Soft drifting clouds, lit from the low sun. */
  private clouds(time: number): void {
    const { ctx, cam } = this;
    const span = this.w + 500;
    for (let i = 0; i < 6; i++) {
      const speed = 6 + hash(i) * 10;
      const x = ((((hash(i + 10) * span + time * speed - cam.cx * cam.scale * 0.04) % span) + span) % span) - 250;
      const y = this.h * (0.07 + 0.22 * hash(i + 20));
      const s = 0.6 + hash(i + 30) * 0.9;
      ctx.fillStyle = `rgba(255,214,190,${0.16 + 0.12 * hash(i + 40)})`;
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const cx = x + (k - 2) * 38 * s;
        const r = (22 + 18 * hash(i * 7 + k)) * s;
        ctx.moveTo(cx + r, y - r * 0.2);
        ctx.ellipse(cx, y - r * 0.2, r, r * 0.55, 0, 0, TAU);
      }
      ctx.fill();
    }
  }

  /** Silhouette trees along a bank, from x0 toward x1, rooted at height y. */
  private trees(x0: number, x1: number, y: number, seed: number): void {
    const { ctx, cam } = this;
    const dir = Math.sign(x1 - x0);
    const s = cam.scale;
    const sy = cam.sy(y);
    ctx.fillStyle = PAL.tree;
    ctx.beginPath();
    for (let i = 0, x = x0; (x1 - x) * dir > 0 && i < 40; i++) {
      const r = hash(seed * 100 + i);
      const h = 1.8 + r * 2.6;
      const sx = cam.sx(x);
      x += dir * (1.4 + hash(seed * 50 + i) * 2.6);
      if (sx < -80 || sx > this.w + 80) continue;
      ctx.rect(sx - 0.07 * s, sy - h * 0.35 * s, 0.14 * s, h * 0.35 * s);
      if (r < 0.55) {
        // Pine: stacked triangles.
        for (let k = 0; k < 3; k++) {
          const w = (0.95 - k * 0.22) * s * (0.7 + h * 0.12);
          const top = sy - (h * (0.45 + k * 0.2) + 0.9) * s;
          ctx.moveTo(sx, top);
          ctx.lineTo(sx + w, top + h * 0.42 * s);
          ctx.lineTo(sx - w, top + h * 0.42 * s);
          ctx.closePath();
        }
      } else {
        const rx = 0.75 * s * (0.8 + r * 0.4);
        ctx.moveTo(sx + rx, sy - h * 0.62 * s);
        ctx.ellipse(sx, sy - h * 0.62 * s, rx, h * 0.42 * s, 0, 0, TAU);
      }
    }
    ctx.fill();
  }

  /** Grass tufts along a bank top. */
  private tufts(x0: number, x1: number, y: number): void {
    const { ctx, cam } = this;
    ctx.strokeStyle = PAL.grassDark;
    ctx.lineWidth = Math.max(1, cam.scale * 0.035);
    ctx.beginPath();
    const sy = cam.sy(y) + 1;
    for (let i = 0, x = x0; x < x1 && i < 160; i++, x += 0.45 + hash(i + x0) * 0.6) {
      const sx = cam.sx(x);
      if (sx < -10 || sx > this.w + 10) continue;
      const h = (0.18 + hash(i * 3 + 1) * 0.22) * cam.scale;
      for (const lean of [-0.35, 0, 0.35]) {
        ctx.moveTo(sx + lean * 4, sy);
        ctx.lineTo(sx + lean * h * 0.8, sy - h * (1 - Math.abs(lean) * 0.4));
      }
    }
    ctx.stroke();
  }

  /** Rock overhang above an approach road, with strata lines and a sunlit rim. */
  private overhang(o: Overhang, W: number): void {
    const { ctx, cam } = this;
    const poly = overhangPoly(o, W);
    const path = new Path2D();
    poly.forEach(([x, y], i) => (i ? path.lineTo(cam.sx(x), cam.sy(y)) : path.moveTo(cam.sx(x), cam.sy(y))));
    path.closePath();
    const g = ctx.createLinearGradient(0, cam.sy(o.top), 0, cam.sy(o.bottom));
    g.addColorStop(0, PAL.rock);
    g.addColorStop(1, PAL.rockDark);
    ctx.fillStyle = g;
    ctx.fill(path);
    ctx.save();
    ctx.clip(path);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = Math.max(1, cam.scale * 0.05);
    ctx.beginPath();
    const x0 = o.side === 'left' ? -12 : W - 4;
    for (let y = o.bottom + 0.7; y < o.top + 6; y += 0.9) {
      for (let k = 0; k <= 16; k++) {
        const x = x0 + k;
        const py = cam.sy(y) + Math.sin(x * 1.7 + y * 3) * cam.scale * 0.08;
        if (k) ctx.lineTo(cam.sx(x), py);
        else ctx.moveTo(cam.sx(x), py);
      }
    }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,200,150,0.35)';
    ctx.lineWidth = Math.max(1.5, cam.scale * 0.06);
    ctx.beginPath();
    poly.slice(2, 7).forEach(([x, y], i) => (i ? ctx.lineTo(cam.sx(x), cam.sy(y)) : ctx.moveTo(cam.sx(x), cam.sy(y))));
    ctx.stroke();
  }

  /** A ship channel in the blueprint: a hatched keep-clear zone with its clearance height. */
  private channelBlueprint(x0: number, x1: number, top: number, waterY: number): void {
    const { ctx, cam } = this;
    const l = cam.sx(x0);
    const r = cam.sx(x1);
    const t = cam.sy(top);
    const b = cam.sy(waterY);
    ctx.save();
    ctx.beginPath();
    ctx.rect(l, t, r - l, b - t);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,90,78,0.08)';
    ctx.fillRect(l, t, r - l, b - t);
    ctx.strokeStyle = 'rgba(255,90,78,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = l - (b - t); x < r; x += 12) {
      ctx.moveTo(x, b);
      ctx.lineTo(x + (b - t), t);
    }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = PAL.invalid;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.strokeRect(l, t, r - l, b - t);
    ctx.setLineDash([]);
    // Near the water, where it can't hide under a deck laid along the top of the zone.
    this.label(`SHIP CHANNEL · KEEP CLEAR TO +${top} m`, (l + r) / 2, b - 16, PAL.invalid);
  }

  /** The channel in the painted scene: marker buoys and a moored sailboat whose mast shows the clearance. */
  private channelScene(x0: number, x1: number, top: number, waterY: number, time: number): void {
    const { ctx, cam } = this;
    const s = cam.scale;
    const bob = Math.sin(time * 1.6) * 0.06;
    for (const [x, color] of [
      [x0 + 0.3, '#d7263d'],
      [x1 - 0.3, '#2e9e4f'],
    ] as const) {
      const bx = cam.sx(x);
      const by = cam.sy(waterY + 0.1 + bob);
      ctx.fillStyle = color;
      ctx.fillRect(bx - 0.18 * s, by - 0.7 * s, 0.36 * s, 0.7 * s);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(bx - 0.18 * s, by - 0.45 * s, 0.36 * s, 0.1 * s);
    }
    // Sailboat: hull, mast up to the clearance line, and a sail.
    const cx = (x0 + x1) / 2 + Math.sin(time * 0.25) * ((x1 - x0) / 2 - 2.2);
    const hy = waterY + 0.05 + bob;
    const mastTop = top - 0.25;
    ctx.save();
    ctx.translate(cam.sx(cx), cam.sy(hy));
    ctx.rotate(Math.sin(time * 1.1) * 0.03);
    ctx.fillStyle = '#f2efe6';
    ctx.beginPath();
    ctx.moveTo(-1.6 * s, -0.5 * s);
    ctx.lineTo(1.8 * s, -0.5 * s);
    ctx.lineTo(1.2 * s, 0.15 * s);
    ctx.lineTo(-1.3 * s, 0.15 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2d5d8f';
    ctx.fillRect(-1.5 * s, -0.25 * s, 3.1 * s, 0.1 * s);
    ctx.strokeStyle = '#3b3e46';
    ctx.lineWidth = Math.max(1.5, 0.07 * s);
    ctx.beginPath();
    ctx.moveTo(0, -0.5 * s);
    ctx.lineTo(0, -(mastTop - hy) * s);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,250,240,0.92)';
    ctx.beginPath();
    ctx.moveTo(0.08 * s, -(mastTop - hy - 0.2) * s);
    ctx.lineTo(0.08 * s, -0.75 * s);
    ctx.lineTo(1.4 * s, -0.75 * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Lattice pylon: two legs with cross bracing and a cap. `chalk` draws the blueprint version. */
  private tower(x: number, base: number, top: number, chalk: boolean): void {
    const { ctx, cam } = this;
    const halfBase = 0.45;
    const halfTop = 0.22;
    const lx = (y: number, side: number) => x + side * (halfBase + ((halfTop - halfBase) * (y - base)) / (top - base));
    const lw = chalk ? 1.5 : Math.max(1.5, cam.scale * 0.07);
    ctx.lineCap = 'round';
    if (!chalk) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.beginPath();
      ctx.moveTo(cam.sx(lx(base, -1)), cam.sy(base));
      ctx.lineTo(cam.sx(lx(top, -1)), cam.sy(top));
      ctx.lineTo(cam.sx(lx(top, 1)), cam.sy(top));
      ctx.lineTo(cam.sx(lx(base, 1)), cam.sy(base));
      ctx.fill();
    }
    ctx.strokeStyle = chalk ? PAL.chalkDim : PAL.towerDark;
    ctx.lineWidth = lw;
    ctx.beginPath();
    // Cross bracing, one X per meter.
    for (let y = base; y < top - 0.5; y += 1) {
      const y2 = Math.min(top, y + 1);
      ctx.moveTo(cam.sx(lx(y, -1)), cam.sy(y));
      ctx.lineTo(cam.sx(lx(y2, 1)), cam.sy(y2));
      ctx.moveTo(cam.sx(lx(y, 1)), cam.sy(y));
      ctx.lineTo(cam.sx(lx(y2, -1)), cam.sy(y2));
    }
    ctx.stroke();
    ctx.strokeStyle = chalk ? PAL.chalk : PAL.tower;
    ctx.lineWidth = lw * 1.8;
    ctx.beginPath();
    for (const side of [-1, 1]) {
      ctx.moveTo(cam.sx(lx(base, side)), cam.sy(base));
      ctx.lineTo(cam.sx(lx(top, side)), cam.sy(top));
    }
    ctx.stroke();
    const capW = (halfTop + 0.18) * cam.scale;
    const capH = Math.max(3, 0.22 * cam.scale);
    if (chalk) {
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cam.sx(x) - capW, cam.sy(top) - capH * 0.3, capW * 2, capH);
    } else {
      ctx.fillStyle = PAL.towerDark;
      ctx.fillRect(cam.sx(x) - capW, cam.sy(top) - capH * 0.3, capW * 2, capH);
      ctx.fillStyle = PAL.tower;
      ctx.fillRect(cam.sx(x) - capW, cam.sy(top) - capH * 0.3, capW * 2, capH * 0.35);
    }
  }

  private bank(poly: [number, number][]): void {
    const { ctx, cam } = this;
    const g = ctx.createLinearGradient(0, cam.sy(0), 0, cam.sy(-8));
    g.addColorStop(0, PAL.rock);
    g.addColorStop(1, PAL.rockDark);
    ctx.fillStyle = g;
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(cam.sx(x), cam.sy(y)) : ctx.moveTo(cam.sx(x), cam.sy(y))));
    ctx.closePath();
    ctx.fill();
  }

  private drawWaterFront(v: SceneView): void {
    // A translucent front water layer so sinking things look submerged.
    const { ctx, cam } = this;
    const wy = cam.sy(v.level.waterY);
    ctx.fillStyle = 'rgba(40,110,150,0.55)';
    ctx.beginPath();
    ctx.moveTo(0, this.h);
    for (let x = 0; x <= this.w + 12; x += 12) {
      ctx.lineTo(x, wy + 2 + Math.sin(x * 0.035 - v.time * 1.9) * 2.5);
    }
    ctx.lineTo(this.w, this.h);
    ctx.fill();
    ctx.strokeStyle = 'rgba(207,239,255,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= this.w + 12; x += 12) {
      const y = wy + 2 + Math.sin(x * 0.035 - v.time * 1.9) * 2.5;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // ───────────────────────────── Members ─────────────────────────────

  /**
   * Paints one member in the golden-hour style. Coordinates are screen px; `sag` bows a slack
   * cable downward by that many px at its middle.
   */
  private memberPaint(ax: number, ay: number, bx: number, by: number, mat: MaterialId, stress: number | null, alpha = 1, sag = 0, time = 0): void {
    const { ctx, cam } = this;
    const w = Math.max(mat === 'cable' ? 1.5 : 2, MEMBER_WIDTH[mat] * cam.scale);
    const len = Math.hypot(bx - ax, by - ay) || 1;
    // Unit normal pointing up the screen, for offset details like flanges and deck edges.
    let nx = (by - ay) / len;
    let ny = -(bx - ax) / len;
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const line = (off: number) => {
      ctx.beginPath();
      ctx.moveTo(ax + nx * off, ay + ny * off);
      if (sag > 0) ctx.quadraticCurveTo((ax + bx) / 2 + nx * off, (ay + by) / 2 + ny * off + sag * 2, bx + nx * off, by + ny * off);
      else ctx.lineTo(bx + nx * off, by + ny * off);
    };
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    if (mat === 'road' || mat === 'heavy') {
      const heavy = mat === 'heavy';
      line(0);
      ctx.strokeStyle = '#1b1d22';
      ctx.lineWidth = w + 2;
      ctx.stroke();
      ctx.strokeStyle = heavy ? PAL.heavy : PAL.road;
      ctx.lineWidth = w;
      ctx.stroke();
      // Slab edge below, lit surface above.
      line(-w * 0.32);
      ctx.strokeStyle = heavy ? PAL.heavyEdge : '#2a2c32';
      ctx.lineWidth = Math.max(1, w * (heavy ? 0.3 : 0.2));
      ctx.stroke();
      line(w * 0.36);
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = Math.max(1, w * 0.14);
      ctx.stroke();
      if (w > 5) {
        // Dash phase follows screen x so the lane line runs on unbroken across joints.
        line(w * 0.05);
        ctx.setLineDash([w * 0.9, w * 0.9]);
        ctx.lineDashOffset = -Math.min(ax, bx);
        ctx.lineCap = 'butt';
        ctx.strokeStyle = PAL.roadLine;
        ctx.lineWidth = Math.max(1, w * 0.11);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        ctx.lineCap = 'round';
      }
    } else if (mat === 'wood') {
      line(0);
      ctx.strokeStyle = PAL.woodDark;
      ctx.lineWidth = w + 2;
      ctx.stroke();
      ctx.strokeStyle = PAL.wood;
      ctx.lineWidth = w;
      ctx.stroke();
      if (w > 4) {
        // Grain: two broken streaks along the length.
        ctx.lineCap = 'butt';
        ctx.strokeStyle = 'rgba(110,62,24,0.45)';
        ctx.lineWidth = Math.max(0.8, w * 0.1);
        for (const [off, dash] of [
          [0.22, 11],
          [-0.2, 7],
        ]) {
          line(w * off);
          ctx.setLineDash([dash, dash * 0.6]);
          ctx.lineDashOffset = ax * 0.37;
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        ctx.lineCap = 'round';
      }
      line(w * 0.1);
      ctx.strokeStyle = 'rgba(255,230,190,0.3)';
      ctx.lineWidth = Math.max(1, w * 0.2);
      ctx.stroke();
    } else if (mat === 'steel') {
      line(0);
      ctx.strokeStyle = PAL.steelDark;
      ctx.lineWidth = w + 2;
      ctx.stroke();
      ctx.strokeStyle = PAL.steel;
      ctx.lineWidth = w;
      ctx.stroke();
      // I-beam flanges.
      ctx.lineCap = 'butt';
      ctx.strokeStyle = PAL.steelDark;
      ctx.lineWidth = Math.max(0.8, w * 0.16);
      line(w * 0.34);
      ctx.stroke();
      line(-w * 0.34);
      ctx.stroke();
      ctx.lineCap = 'round';
      if (w > 4) {
        ctx.fillStyle = PAL.steelDark;
        for (const t of [0.14, 0.86]) {
          ctx.beginPath();
          ctx.arc(ax + (bx - ax) * t, ay + (by - ay) * t, Math.max(1, w * 0.14), 0, TAU);
          ctx.fill();
        }
      }
    } else {
      line(0);
      ctx.strokeStyle = PAL.cable;
      ctx.lineWidth = w + 1;
      ctx.stroke();
      // Braided highlight.
      ctx.setLineDash([2.5, 2]);
      ctx.strokeStyle = PAL.cableHi;
      ctx.lineWidth = Math.max(0.8, w * 0.45);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (stress !== null) {
      const s = Math.abs(stress);
      line(0);
      ctx.strokeStyle = stressColor(s, 0.35 + 0.6 * Math.min(1, s * 1.3));
      ctx.lineWidth = Math.max(1.5, w * (MATERIALS[mat].drivable ? 0.3 : mat === 'cable' ? 0.9 : 0.55));
      ctx.lineCap = 'butt';
      ctx.stroke();
      if (s > 0.75) {
        // Members near failure throb.
        const pulse = 0.75 + 0.25 * Math.sin(time * 18);
        ctx.strokeStyle = `rgba(255,59,59,${(s - 0.75) * 1.4 * pulse})`;
        ctx.lineWidth = w + 10 * (s - 0.5) * pulse;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private chalkMember(ax: number, ay: number, bx: number, by: number, mat: MaterialId, highlight: 'none' | 'hover' | 'delete'): void {
    const { ctx, cam } = this;
    const w = Math.max(mat === 'cable' ? 1.5 : 2.5, MEMBER_WIDTH[mat] * cam.scale * 0.8);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    if (highlight === 'delete') {
      ctx.strokeStyle = 'rgba(255,90,78,0.3)';
      ctx.lineWidth = w + 12;
      ctx.stroke();
      ctx.strokeStyle = PAL.invalid;
      ctx.lineWidth = w + 3;
      ctx.stroke();
      return;
    }
    ctx.globalAlpha = highlight === 'hover' ? 0.35 : 0.16;
    ctx.strokeStyle = MATERIAL_CHALK[mat];
    ctx.lineWidth = w + 7;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (mat === 'cable') ctx.setLineDash([6, 3]);
    ctx.lineWidth = w;
    ctx.stroke();
    ctx.setLineDash([]);
    if (MATERIALS[mat].drivable && w > 5) {
      ctx.setLineDash([w, w]);
      ctx.lineDashOffset = -Math.min(ax, bx);
      ctx.strokeStyle = PAL.paper;
      ctx.lineWidth = Math.max(1, w * (mat === 'heavy' ? 0.3 : 0.2));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    } else if (mat === 'steel') {
      ctx.strokeStyle = PAL.paper;
      ctx.lineWidth = Math.max(1, w * 0.35);
      ctx.stroke();
    }
  }

  private drawEditor(v: SceneView, ed: Editor): void {
    const { ctx, cam } = this;
    const { nodes, members } = ed.design;

    members.forEach((m, i) => {
      const a = nodes[m.a];
      const b = nodes[m.b];
      const age = ed.ages[i] ?? 10;
      if (age <= 0) return;
      const p = Math.min(1.08, easeOutBack(Math.min(1, age / 0.22)));
      const ax = cam.sx(a.x);
      const ay = cam.sy(a.y);
      const bx = ax + (cam.sx(b.x) - ax) * p;
      const by = ay + (cam.sy(b.y) - ay) * p;
      this.chalkMember(ax, ay, bx, by, m.mat, i === v.hoverMember ? 'delete' : 'none');
    });

    const drag = ed.drag;
    if (drag) {
      const f = { x: drag.sx, y: drag.sy };
      const fx = cam.sx(f.x);
      const fy = cam.sy(f.y);
      const maxR = MATERIALS[ed.mat].maxLen * cam.scale;
      ctx.strokeStyle = 'rgba(233,243,255,0.25)';
      ctx.setLineDash([3, 5]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(fx, fy, maxR, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      const tx = cam.sx(drag.tx);
      const ty = cam.sy(drag.ty);
      if (drag.tx !== f.x || drag.ty !== f.y) {
        const col = drag.valid ? MATERIAL_CHALK[ed.mat] : PAL.invalid;
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(2.5, MEMBER_WIDTH[ed.mat] * cam.scale * 0.8);
        ctx.globalAlpha = 0.55 + 0.25 * Math.sin(v.time * 10);
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = -v.time * 30;
        ctx.beginPath();
        drag.path.forEach(([x, y], i) => (i ? ctx.lineTo(cam.sx(x), cam.sy(y)) : ctx.moveTo(cam.sx(x), cam.sy(y))));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        ctx.globalAlpha = 1;
        // Joints a road run will create along the way.
        ctx.fillStyle = col;
        for (let i = 1; i < drag.path.length - 1; i++) {
          ctx.beginPath();
          ctx.arc(cam.sx(drag.path[i][0]), cam.sy(drag.path[i][1]), 4, 0, TAU);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(tx, ty, 9 + Math.sin(v.time * 8) * 2, 0, TAU);
        ctx.lineWidth = 2;
        ctx.stroke();
        const segs = drag.path.length - 1;
        const len = Math.hypot(drag.tx - f.x, drag.ty - f.y);
        const grade = MATERIALS[ed.mat].drivable && drag.tx !== f.x && drag.ty !== f.y ? ` · ${Math.round((Math.abs(drag.ty - f.y) / Math.abs(drag.tx - f.x)) * 100)}% grade` : '';
        const what = segs > 1 ? `${segs} × ${MATERIALS[ed.mat].name.toLowerCase()} · ${len.toFixed(1)} m` : `${len.toFixed(1)} m`;
        const reason = drag.valid ? '' : ` · ${drag.reason}`;
        this.label(what + grade + reason, (fx + tx) / 2, (fy + ty) / 2 - 16, drag.valid ? PAL.chalk : PAL.invalid);
        if (drag.toSplit >= 0) this.splitMark(tx, ty, col);
      }
    }

    // Where beams can take a new joint: near the drag target, or under a hovering mouse.
    const hintAround = drag ? { x: drag.tx, y: drag.ty } : v.hoverAttach;
    if (hintAround) {
      ctx.strokeStyle = PAL.chalkDim;
      ctx.lineWidth = 1.5;
      members.forEach((_, i) => {
        if (drag && i === drag.fromSplit) return;
        for (const [x, y] of ed.design.attachPoints(i)) {
          if (Math.hypot(x - hintAround.x, y - hintAround.y) > 2.2) continue;
          if (ed.design.findNode(x, y) >= 0) continue;
          ctx.beginPath();
          ctx.arc(cam.sx(x), cam.sy(y), 3.5, 0, TAU);
          ctx.stroke();
        }
      });
    }
    if (!drag && v.hoverAttach) this.splitMark(cam.sx(v.hoverAttach.x), cam.sy(v.hoverAttach.y), PAL.valid);
    if (drag && drag.fromSplit >= 0) this.splitMark(cam.sx(drag.sx), cam.sy(drag.sy), MATERIAL_CHALK[ed.mat]);

    // Nodes and anchors.
    nodes.forEach((n, i) => {
      const x = cam.sx(n.x);
      const y = cam.sy(n.y);
      const hover = i === v.hoverNode || (drag && drag.from === i);
      if (n.anchor) this.bolt(x, y, hover ? 1.25 : 1, v.time, !drag && v.showHint);
      else {
        const r = Math.max(3.5, 0.13 * cam.scale) * (hover ? 1.5 : 1);
        ctx.fillStyle = PAL.paper;
        ctx.strokeStyle = PAL.chalk;
        ctx.lineWidth = 2;
        ctx.beginPath();
        // Off-grid joints (on sloped decks or split beams) are diamonds.
        if (Number.isInteger(n.x) && Number.isInteger(n.y)) ctx.arc(x, y, r, 0, TAU);
        else {
          const d = r * 1.3;
          ctx.moveTo(x, y - d);
          ctx.lineTo(x + d, y);
          ctx.lineTo(x, y + d);
          ctx.lineTo(x - d, y);
          ctx.closePath();
        }
        ctx.fill();
        ctx.stroke();
      }
    });

    if (v.showCursor) {
      const x = cam.sx(ed.cursorX);
      const y = cam.sy(ed.cursorY);
      const s = 10 + Math.sin(v.time * 6) * 2;
      ctx.strokeStyle = PAL.valid;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.moveTo(x + dx * s, y + dy * s * 0.4);
        ctx.lineTo(x + dx * s, y + dy * s);
        ctx.lineTo(x + dx * s * 0.4, y + dy * s);
      }
      ctx.stroke();
    }
  }

  /** A small cross-hair marking where a beam will be split. */
  private splitMark(x: number, y: number, color: string): void {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, TAU);
    ctx.moveTo(x - 10, y);
    ctx.lineTo(x - 4, y);
    ctx.moveTo(x + 4, y);
    ctx.lineTo(x + 10, y);
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x, y - 4);
    ctx.moveTo(x, y + 4);
    ctx.lineTo(x, y + 10);
    ctx.stroke();
  }

  private drawHint(v: SceneView): void {
    const hint = v.level.hint;
    const ed = v.editor;
    if (!hint || !ed) return;
    const { ctx, cam } = this;
    const pulse = 0.25 + 0.15 * Math.sin(v.time * 4);
    let firstTodo = -1;
    hint.forEach(([a, b, mat], i) => {
      const ia = ed.design.findNode(a[0], a[1]);
      const ib = ed.design.findNode(b[0], b[1]);
      const done = ia >= 0 && ib >= 0 && ed.design.findMember(ia, ib) >= 0;
      if (done) return;
      const reachable = ia >= 0 || ib >= 0;
      if (firstTodo < 0 && reachable) firstTodo = i;
      ctx.strokeStyle = MATERIAL_CHALK[mat];
      ctx.globalAlpha = pulse;
      ctx.lineWidth = Math.max(2, MEMBER_WIDTH[mat] * cam.scale * 0.8);
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.moveTo(cam.sx(a[0]), cam.sy(a[1]));
      ctx.lineTo(cam.sx(b[0]), cam.sy(b[1]));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    });
    if (firstTodo >= 0 && !ed.drag) {
      let [a, b] = hint[firstTodo];
      if (ed.design.findNode(a[0], a[1]) < 0) [a, b] = [b, a];
      const t = (v.time * 0.8) % 1.4;
      const u = Math.min(1, t);
      const e = u * u * (3 - 2 * u);
      const x = cam.sx(a[0] + (b[0] - a[0]) * e);
      const y = cam.sy(a[1] + (b[1] - a[1]) * e);
      ctx.fillStyle = `rgba(255,255,255,${t > 1 ? 1.4 - t : 0.9})`;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = PAL.paper;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  private drawRunMembers(run: TestRun, time: number): void {
    const { ctx, cam } = this;
    const w = run.world;
    const sag = (l: Link) => {
      if (!l.tensionOnly) return 0;
      const len = Math.hypot(w.x[l.b] - w.x[l.a], w.y[l.b] - w.y[l.a]);
      return len < l.rest ? (Math.sqrt(l.rest * l.rest - len * len) / 2) * cam.scale * 0.5 : 0;
    };
    // Cables behind the truss, deck on top of everything.
    for (const pass of [0, 1, 2]) {
      for (const l of w.links) {
        if (!l.bridge || l.broken || drawLayer(l) !== pass) continue;
        this.memberPaint(cam.sx(w.x[l.a]), cam.sy(w.y[l.a]), cam.sx(w.x[l.b]), cam.sy(w.y[l.b]), l.mat!, l.stress, 1, sag(l), time);
      }
    }
    this.guardRails(run);

    // Joints: gusset plates sized by how many members meet there.
    const nodeCount = w.count - 4;
    const degree = new Uint8Array(nodeCount);
    for (const l of w.links) {
      if (!l.bridge || l.broken) continue;
      degree[l.a]++;
      degree[l.b]++;
    }
    for (let i = 0; i < nodeCount; i++) {
      const x = cam.sx(w.x[i]);
      const y = cam.sy(w.y[i]);
      if (w.im[i] === 0 && w.y[i] > run.level.waterY - 1) {
        this.bolt(x, y, 1, 0, false);
      } else if (degree[i]) {
        const r = Math.max(3, (0.09 + 0.025 * Math.min(degree[i], 6)) * cam.scale);
        ctx.fillStyle = '#2d3138';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#8d97a3';
        ctx.beginPath();
        ctx.arc(x, y, r * 0.78, 0, TAU);
        ctx.fill();
        if (r > 5) {
          ctx.fillStyle = '#2d3138';
          const bolts = Math.min(degree[i], 5);
          for (let k = 0; k < bolts; k++) {
            const a = (k / bolts) * TAU + 0.4;
            ctx.beginPath();
            ctx.arc(x + Math.cos(a) * r * 0.45, y + Math.sin(a) * r * 0.45, Math.max(0.8, r * 0.12), 0, TAU);
            ctx.fill();
          }
        }
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.22, 0, TAU);
        ctx.fill();
      }
    }
  }

  /** Low guard rail with posts about every meter along each intact deck piece. */
  private guardRails(run: TestRun): void {
    const { ctx, cam } = this;
    const w = run.world;
    if (cam.scale < 10) return;
    const railH = 0.55;
    ctx.strokeStyle = 'rgba(214,220,228,0.75)';
    ctx.lineWidth = Math.max(1, cam.scale * 0.035);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    for (const l of w.links) {
      if (!l.bridge || l.broken || !l.drivable) continue;
      const ax = w.x[l.a];
      const ay = w.y[l.a];
      const bx = w.x[l.b];
      const by = w.y[l.b];
      ctx.moveTo(cam.sx(ax), cam.sy(ay + railH));
      ctx.lineTo(cam.sx(bx), cam.sy(by + railH));
      const posts = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay)));
      for (let k = 0; k < posts; k++) {
        const t = (k + 0.5) / posts;
        const x = ax + (bx - ax) * t;
        const y = ay + (by - ay) * t;
        ctx.moveTo(cam.sx(x), cam.sy(y + 0.12));
        ctx.lineTo(cam.sx(x), cam.sy(y + railH));
      }
    }
    ctx.stroke();
  }

  /** Mirror image of the bridge on the river, rippled and faint. */
  private drawReflection(run: TestRun, v: SceneView): void {
    const { ctx, cam } = this;
    const w = run.world;
    const wy = run.level.waterY;
    const top = cam.sy(wy);
    if (top > this.h) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top + 3, this.w, this.h - top);
    ctx.clip();
    ctx.globalAlpha = 0.22 * v.develop;
    ctx.lineCap = 'round';
    const ripple = (sy: number) => Math.sin(sy * 0.12 + v.time * 2.2) * 2.5;
    for (const l of w.links) {
      if (!l.bridge || l.broken) continue;
      const ay = cam.sy(2 * wy - w.y[l.a]);
      const by = cam.sy(2 * wy - w.y[l.b]);
      ctx.strokeStyle = l.drivable ? '#15171c' : l.mat === 'wood' ? '#5a3a1c' : '#2a3542';
      ctx.lineWidth = Math.max(1, MEMBER_WIDTH[l.mat!] * cam.scale);
      ctx.beginPath();
      ctx.moveTo(cam.sx(w.x[l.a]) + ripple(ay), ay);
      ctx.lineTo(cam.sx(w.x[l.b]) + ripple(by), by);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawDebris(items: Debris[]): void {
    const { cam } = this;
    for (const d of items) {
      const c = Math.cos(d.ang) * d.len * 0.5;
      const s = Math.sin(d.ang) * d.len * 0.5;
      this.memberPaint(cam.sx(d.x - c), cam.sy(d.y - s), cam.sx(d.x + c), cam.sy(d.y + s), d.mat, null, Math.min(1, d.life));
    }
  }

  private bolt(x: number, y: number, scale: number, time: number, pulse: boolean): void {
    const { ctx, cam } = this;
    const r = Math.max(6, 0.3 * cam.scale) * scale;
    if (pulse) {
      const p = (time * 1.2) % 1;
      ctx.strokeStyle = `rgba(255,90,78,${1 - p})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r * (1 + p * 1.6), 0, TAU);
      ctx.stroke();
    }
    ctx.fillStyle = PAL.boltDark;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + Math.PI / 6;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r + 1.5;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.fill();
    ctx.fillStyle = PAL.bolt;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + Math.PI / 6;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.fill();
    ctx.fillStyle = PAL.boltDark;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.38, 0, TAU);
    ctx.fill();
  }

  // ───────────────────────────── Vehicles ─────────────────────────────

  private drawVehicleParked(level: LevelDef): void {
    const def = VEHICLES[level.vehicle];
    const r = def.wheelR;
    const top = r + def.height * 0.6;
    this.vehicle(def, START_X, r, START_X + def.wheelbase, r, START_X, top, START_X + def.wheelbase, top, [0, 0], true);
  }

  private drawVehicleRun(run: TestRun, angles: [number, number]): void {
    const w = run.world;
    const v = run.vehicle;
    this.vehicle(v.def, w.x[v.rearWheel], w.y[v.rearWheel], w.x[v.frontWheel], w.y[v.frontWheel], w.x[v.rearTop], w.y[v.rearTop], w.x[v.frontTop], w.y[v.frontTop], angles, false);
  }

  private vehicle(def: VehicleDef, rwx: number, rwy: number, fwx: number, fwy: number, rtx: number, rty: number, ftx: number, fty: number, angles: [number, number], chalk: boolean): void {
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
    drawBody(ctx, def, 1 / s, chalk);
    ctx.restore();

    const R = def.wheelR;
    const heavy = def.id === 'truck' || def.id === 'bus' || def.id === 'semi';
    this.wheel(rwx, rwy, R, angles[0], chalk, heavy);
    this.wheel(fwx, fwy, R, angles[1], chalk, heavy);
  }

  private wheel(x: number, y: number, r: number, angle: number, chalk: boolean, heavy = false): void {
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
    drawWheel(ctx, sx, sy, R, angle, heavy);
  }

  // ───────────────────────────── FX ─────────────────────────────

  private drawParticles(): void {
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

  private drawFloats(floats: FloatText[]): void {
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

  private label(text: string, x: number, y: number, color: string): void {
    const { ctx } = this;
    ctx.font = '600 12px "JetBrains Mono", monospace';
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = 'rgba(11,29,56,0.85)';
    ctx.fillRect(x - w / 2, y - 9, w, 18);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 1);
  }
}
