import type { Editor } from '../editor';
import type { Debris, DebrisField, Particles } from '../fx/particles';
import { PK } from '../fx/particles';
import { bankY, goalX, START_X, type LevelDef } from '../levels';
import { MATERIALS, type MaterialId } from '../physics/materials';
import { VEHICLES, type VehicleDef } from '../physics/vehicles';
import type { TestRun } from '../physics/world';
import type { Camera } from './camera';
import { MATERIAL_CHALK, PAL, stressColor } from './palette';

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
  showCursor: boolean;
  showHint: boolean;
  time: number;
  flash: number;
  wheelAngles: [number, number];
  floats: FloatText[];
}

const TAU = Math.PI * 2;
const MEMBER_WIDTH: Record<MaterialId, number> = { road: 0.3, wood: 0.17, steel: 0.15 };

function rr(p: Path2D, x: number, y: number, w: number, h: number, r: number): void {
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.lineTo(x + w, y + h - r);
  p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.lineTo(x, y + r);
  p.quadraticCurveTo(x, y, x + r, y);
  p.closePath();
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
      this.drawRunMembers(v.run);
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

    // Parallax hills.
    const horizon = cam.sy(L.waterY + 0.5);
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

  private hills(base: number, parallax: number, amp: number, color: string, freq: number, seed: number): void {
    const { ctx, cam } = this;
    const off = cam.cx * cam.scale * parallax;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, this.h);
    for (let x = 0; x <= this.w + 16; x += 16) {
      const u = (x + off) * freq;
      const y = base - amp * (0.6 + 0.4 * Math.sin(u + seed)) - amp * 0.5 * Math.sin(u * 2.3 + seed * 2);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(this.w, this.h);
    ctx.fill();
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

  private memberPaint(ax: number, ay: number, bx: number, by: number, mat: MaterialId, stress: number | null, alpha = 1): void {
    const { ctx, cam } = this;
    const w = Math.max(2, MEMBER_WIDTH[mat] * cam.scale);
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    if (mat === 'road') {
      ctx.strokeStyle = '#22242a';
      ctx.lineWidth = w + 2;
      ctx.stroke();
      ctx.strokeStyle = PAL.road;
      ctx.lineWidth = w;
      ctx.stroke();
      if (w > 5) {
        ctx.setLineDash([w * 0.9, w * 0.9]);
        ctx.strokeStyle = PAL.roadLine;
        ctx.lineWidth = Math.max(1, w * 0.12);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (mat === 'wood') {
      ctx.strokeStyle = PAL.woodDark;
      ctx.lineWidth = w + 2;
      ctx.stroke();
      ctx.strokeStyle = PAL.wood;
      ctx.lineWidth = w;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,230,190,0.35)';
      ctx.lineWidth = Math.max(1, w * 0.25);
      ctx.stroke();
    } else {
      ctx.strokeStyle = PAL.steelDark;
      ctx.lineWidth = w + 2;
      ctx.stroke();
      ctx.strokeStyle = PAL.steel;
      ctx.lineWidth = w;
      ctx.stroke();
      ctx.strokeStyle = PAL.steelDark;
      ctx.lineWidth = Math.max(1, w * 0.3);
      ctx.stroke();
    }
    if (stress !== null) {
      const s = Math.abs(stress);
      ctx.strokeStyle = stressColor(s, 0.35 + 0.6 * Math.min(1, s * 1.3));
      ctx.lineWidth = Math.max(1.5, w * (mat === 'road' ? 0.3 : 0.55));
      ctx.lineCap = 'butt';
      ctx.stroke();
      if (s > 0.75) {
        ctx.strokeStyle = `rgba(255,59,59,${(s - 0.75) * 1.4})`;
        ctx.lineWidth = w + 10 * (s - 0.5);
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private chalkMember(ax: number, ay: number, bx: number, by: number, mat: MaterialId, highlight: 'none' | 'hover' | 'delete'): void {
    const { ctx, cam } = this;
    const w = Math.max(2.5, MEMBER_WIDTH[mat] * cam.scale * 0.8);
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
    ctx.lineWidth = w;
    ctx.stroke();
    if (mat === 'road' && w > 5) {
      ctx.setLineDash([w, w]);
      ctx.strokeStyle = PAL.paper;
      ctx.lineWidth = Math.max(1, w * 0.2);
      ctx.stroke();
      ctx.setLineDash([]);
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
      const f = nodes[drag.from];
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
        this.label(segs > 1 ? `${segs} × ${MATERIALS[ed.mat].name.toLowerCase()} · ${len.toFixed(1)} m` : `${len.toFixed(1)} m`, (fx + tx) / 2, (fy + ty) / 2 - 16, drag.valid ? PAL.chalk : PAL.invalid);
      }
    }

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
        ctx.arc(x, y, r, 0, TAU);
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

  private drawRunMembers(run: TestRun): void {
    const { cam } = this;
    const w = run.world;
    // Road last so the deck sits on top of the truss.
    for (const pass of [0, 1]) {
      for (const l of w.links) {
        if (!l.bridge || l.broken) continue;
        if ((l.mat === 'road') !== (pass === 1)) continue;
        this.memberPaint(cam.sx(w.x[l.a]), cam.sy(w.y[l.a]), cam.sx(w.x[l.b]), cam.sy(w.y[l.b]), l.mat!, l.stress);
      }
    }
    const { ctx } = this;
    const nodeCount = run.world.count - 4;
    const used = new Uint8Array(nodeCount);
    for (const l of w.links) if (l.bridge && !l.broken) used[l.a] = used[l.b] = 1;
    for (let i = 0; i < nodeCount; i++) {
      const x = cam.sx(w.x[i]);
      const y = cam.sy(w.y[i]);
      if (w.im[i] === 0 && w.y[i] > run.level.waterY - 1) {
        this.bolt(x, y, 1, 0, false);
      } else if (used[i]) {
        const r = Math.max(3, 0.12 * cam.scale);
        ctx.fillStyle = '#2d3138';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#b8c2cc';
        ctx.beginPath();
        ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.45, 0, TAU);
        ctx.fill();
      }
    }
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
    const lw = 2 / s;
    const wb = def.wheelbase;
    const body = new Path2D();
    const win = new Path2D();
    let accent: Path2D | null = null;
    const R = def.wheelR;
    if (def.id === 'car') {
      rr(body, -0.75, -0.05, wb + 1.5, 0.55, 0.2);
      body.moveTo(0.05, 0.5);
      body.lineTo(0.45, 0.98);
      body.lineTo(wb - 0.35, 0.98);
      body.lineTo(wb + 0.1, 0.5);
      body.closePath();
      win.moveTo(0.3, 0.56);
      win.lineTo(0.58, 0.9);
      win.lineTo(wb * 0.5 - 0.05, 0.9);
      win.lineTo(wb * 0.5 - 0.05, 0.56);
      win.closePath();
      win.moveTo(wb * 0.5 + 0.05, 0.56);
      win.lineTo(wb * 0.5 + 0.05, 0.9);
      win.lineTo(wb - 0.42, 0.9);
      win.lineTo(wb - 0.12, 0.56);
      win.closePath();
    } else if (def.id === 'van') {
      body.moveTo(-0.65, -0.05);
      body.lineTo(wb + 0.85, -0.05);
      body.lineTo(wb + 0.85, 0.65);
      body.lineTo(wb + 0.35, 1.45);
      body.lineTo(-0.65, 1.45);
      body.closePath();
      win.moveTo(wb + 0.05, 0.75);
      win.lineTo(wb + 0.72, 0.75);
      win.lineTo(wb + 0.3, 1.32);
      win.lineTo(wb + 0.05, 1.32);
      win.closePath();
      accent = new Path2D();
      accent.rect(-0.65, 0.45, wb + 0.6, 0.18);
    } else if (def.id === 'truck') {
      rr(body, wb - 0.7, -0.05, 1.65, 1.6, 0.15);
      rr(body, -1.0, 0.1, wb - 0.35, 0.95, 0.06);
      win.moveTo(wb + 0.1, 0.85);
      win.lineTo(wb + 0.8, 0.85);
      win.lineTo(wb + 0.8, 1.4);
      win.lineTo(wb + 0.1, 1.4);
      win.closePath();
      accent = new Path2D();
      accent.moveTo(-0.9, 1.0);
      accent.quadraticCurveTo(0.4, 1.7, wb - 0.8, 1.0);
      accent.closePath();
    } else {
      rr(body, -1.05, -0.05, wb + 2.1, 1.95, 0.22);
      for (let x = -0.8; x < wb + 0.6; x += 0.62) win.rect(x, 1.0, 0.46, 0.55);
      win.rect(wb + 0.65, 0.8, 0.32, 0.8);
      accent = new Path2D();
      accent.rect(-1.05, 0.5, wb + 2.1, 0.12);
    }

    if (chalk) {
      ctx.strokeStyle = PAL.chalkDim;
      ctx.lineWidth = lw;
      ctx.setLineDash([4 / s, 3 / s]);
      ctx.stroke(body);
      ctx.stroke(win);
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.save();
      ctx.translate(0.06, -0.06);
      ctx.fill(body);
      ctx.restore();
      ctx.fillStyle = def.color;
      ctx.fill(body);
      if (accent) {
        ctx.fillStyle = def.trim;
        ctx.fill(accent);
      }
      ctx.fillStyle = '#9fd3f0';
      ctx.fill(win);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(-0.5, 0.35, wb + 1, 0.05);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = lw;
      ctx.stroke(body);
      // Headlight.
      ctx.fillStyle = '#fff6c8';
      const hx = def.id === 'car' ? wb + 0.68 : def.id === 'bus' ? wb + 0.98 : wb + 0.86;
      ctx.fillRect(hx - 0.1, 0.2, 0.1, 0.14);
    }
    ctx.restore();

    this.wheel(rwx, rwy, R, angles[0], chalk);
    this.wheel(fwx, fwy, R, angles[1], chalk);
  }

  private wheel(x: number, y: number, r: number, angle: number, chalk: boolean): void {
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
    ctx.fillStyle = '#1d1e22';
    ctx.beginPath();
    ctx.arc(sx, sy, R, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#c9ced6';
    ctx.beginPath();
    ctx.arc(sx, sy, R * 0.52, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#5c6068';
    ctx.lineWidth = Math.max(1, R * 0.12);
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = angle + (i * TAU) / 3;
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(a) * R * 0.5, sy + Math.sin(a) * R * 0.5);
    }
    ctx.stroke();
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
