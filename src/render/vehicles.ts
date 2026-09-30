import type { VehicleDef } from '../physics/vehicles';
import { PAL } from './palette';

/**
 * Vehicle bodies, drawn in the vehicle's own frame: meters, y up, the rear wheel center at
 * (0, 0) and the front wheel center at (wheelbase, 0). Wheels are drawn separately so they can spin.
 */

const TAU = Math.PI * 2;
const OUTLINE = 'rgba(0,0,0,0.55)';
const CHROME = '#c9d1db';

type Ctx = CanvasRenderingContext2D;
/** A silhouette behind glass: x, y, radius and optional color. */
type Head = [number, number, number, string?];

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mixes a hex color toward white (f > 0) or black (f < 0). */
export function shade(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = f < 0 ? 0 : 255;
  const k = Math.abs(f);
  return `rgb(${Math.round(r + (t - r) * k)},${Math.round(g + (t - g) * k)},${Math.round(b + (t - b) * k)})`;
}

function rrect(p: Path2D, x: number, y: number, w: number, h: number, r: number): Path2D {
  const q = Math.min(r, w / 2, h / 2);
  p.moveTo(x + q, y);
  p.lineTo(x + w - q, y);
  p.quadraticCurveTo(x + w, y, x + w, y + q);
  p.lineTo(x + w, y + h - q);
  p.quadraticCurveTo(x + w, y + h, x + w - q, y + h);
  p.lineTo(x + q, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - q);
  p.lineTo(x, y + q);
  p.quadraticCurveTo(x, y, x + q, y);
  p.closePath();
  return p;
}

function poly(pts: [number, number][]): Path2D {
  const p = new Path2D();
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
  return p;
}

/** Collects the paths of one body so the blueprint and painted versions share geometry. */
class Painter {
  /** Outlines the blueprint view traces. */
  readonly chalkPaths: Path2D[] = [];

  constructor(
    readonly ctx: Ctx,
    /** One screen pixel, in meters. */
    readonly px: number,
    readonly chalk: boolean,
  ) {}

  /** Body panel with a top-lit vertical gradient and an outline. */
  panel(p: Path2D, color: string, top: number, bottom: number, outline = true): void {
    this.chalkPaths.push(p);
    if (this.chalk) return;
    const { ctx } = this;
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, shade(color, 0.22));
    g.addColorStop(0.45, color);
    g.addColorStop(1, shade(color, -0.22));
    ctx.fillStyle = g;
    ctx.fill(p);
    if (outline) {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.6 * this.px;
      ctx.stroke(p);
    }
  }

  fill(p: Path2D, color: string, chalk = false): void {
    if (chalk) this.chalkPaths.push(p);
    if (this.chalk) return;
    this.ctx.fillStyle = color;
    this.ctx.fill(p);
  }

  /** Tinted glass with a diagonal reflection streak, and optionally someone sitting behind it. */
  glass(p: Path2D, top: number, bottom: number, who?: Head): void {
    this.chalkPaths.push(p);
    if (this.chalk) return;
    const { ctx } = this;
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, '#d9f1fb');
    g.addColorStop(1, '#5b8fb0');
    ctx.fillStyle = g;
    ctx.fill(p);
    ctx.save();
    ctx.clip(p);
    if (who) {
      ctx.globalAlpha = 0.75;
      this.head(...who);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    for (let x = -3; x < 8; x += 1.4) {
      ctx.moveTo(x, bottom - 0.2);
      ctx.lineTo(x + 0.18, bottom - 0.2);
      ctx.lineTo(x + 0.18 + (top - bottom + 0.4) * 0.6, top + 0.2);
      ctx.lineTo(x + (top - bottom + 0.4) * 0.6, top + 0.2);
    }
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1.2 * this.px;
    ctx.stroke(p);
  }

  /** A passenger or driver silhouette. */
  private head(x: number, y: number, r: number, color = '#2b2a38'): void {
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.moveTo(x - r * 1.5, y - r * 2.2);
    ctx.quadraticCurveTo(x, y - r * 0.4, x + r * 1.5, y - r * 2.2);
    ctx.fill();
  }

  line(x0: number, y0: number, x1: number, y1: number, color = 'rgba(0,0,0,0.4)', w = 1.3): void {
    if (this.chalk) return;
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = w * this.px;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  /** Dark wheel-well cut into the body behind a wheel. */
  arch(x: number, r: number): void {
    if (this.chalk) return;
    const { ctx } = this;
    ctx.fillStyle = '#121317';
    ctx.beginPath();
    ctx.arc(x, 0, r * 1.2, 0, Math.PI);
    ctx.fill();
  }

  /** Headlight with a soft forward beam. */
  headlight(x: number, y: number, h: number): void {
    if (this.chalk) return;
    const { ctx } = this;
    const beam = ctx.createLinearGradient(x, 0, x + 2.6, 0);
    beam.addColorStop(0, 'rgba(255,240,190,0.33)');
    beam.addColorStop(1, 'rgba(255,240,190,0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x + 2.6, y + h + 0.45);
    ctx.lineTo(x + 2.6, y - 0.5);
    ctx.lineTo(x, y);
    ctx.fill();
    ctx.fillStyle = '#fff8d6';
    ctx.fill(rrect(new Path2D(), x - 0.1, y, 0.12, h, 0.03));
  }

  lamp(x: number, y: number, w: number, h: number, color: string): void {
    if (this.chalk) return;
    this.ctx.fillStyle = color;
    this.ctx.fill(rrect(new Path2D(), x, y, w, h, 0.02));
  }

  handle(x: number, y: number): void {
    this.lamp(x, y, 0.16, 0.045, 'rgba(0,0,0,0.45)');
  }

  bumper(x: number, y: number, w: number, h: number): void {
    const p = rrect(new Path2D(), x, y, w, h, 0.05);
    this.fill(p, '#34373e', true);
    this.lamp(x + 0.02, y + h - 0.035, w - 0.04, 0.025, 'rgba(255,255,255,0.18)');
  }
}

function car(p: Painter, def: VehicleDef): void {
  const wb = def.wheelbase;
  const R = def.wheelR;
  const lower = new Path2D();
  lower.moveTo(-0.82, 0.02);
  lower.lineTo(-0.84, 0.42);
  lower.quadraticCurveTo(-0.8, 0.6, -0.55, 0.62);
  lower.lineTo(wb + 0.4, 0.64);
  lower.quadraticCurveTo(wb + 0.82, 0.6, wb + 0.86, 0.34);
  lower.lineTo(wb + 0.84, 0.04);
  lower.quadraticCurveTo(wb + 0.8, -0.1, wb + 0.66, -0.1);
  lower.lineTo(-0.7, -0.1);
  lower.closePath();
  const cabin = new Path2D();
  cabin.moveTo(-0.45, 0.6);
  cabin.quadraticCurveTo(-0.1, 0.66, 0.22, 1.0);
  cabin.quadraticCurveTo(0.3, 1.06, 0.45, 1.06);
  cabin.lineTo(wb - 0.55, 1.06);
  cabin.quadraticCurveTo(wb - 0.4, 1.06, wb - 0.3, 0.98);
  cabin.lineTo(wb + 0.25, 0.64);
  cabin.closePath();
  p.panel(cabin, def.color, 1.06, 0.6);
  p.panel(lower, def.color, 0.64, -0.1);
  p.arch(0, R);
  p.arch(wb, R);
  const rear = poly([
    [0.02, 0.68],
    [0.33, 0.98],
    [wb * 0.47, 0.98],
    [wb * 0.47, 0.68],
  ]);
  const front = poly([
    [wb * 0.53, 0.68],
    [wb * 0.53, 0.98],
    [wb - 0.42, 0.98],
    [wb + 0.08, 0.68],
  ]);
  p.glass(rear, 0.98, 0.68);
  p.glass(front, 0.98, 0.68, [wb * 0.72, 0.83, 0.09]);
  // Doors, handles, a trim line and the mirror.
  p.line(wb * 0.5, 0.0, wb * 0.5, 0.98);
  p.line(-0.02, 0.08, -0.02, 0.66);
  p.line(wb + 0.14, 0.1, wb + 0.14, 0.64);
  p.handle(wb * 0.3, 0.46);
  p.handle(wb * 0.7, 0.46);
  p.lamp(-0.8, 0.3, wb + 1.6, 0.04, def.trim);
  p.lamp(wb - 0.02, 0.66, 0.16, 0.1, shade(def.color, -0.35));
  p.bumper(wb + 0.6, -0.1, 0.3, 0.16);
  p.bumper(-0.92, -0.1, 0.3, 0.16);
  p.headlight(wb + 0.84, 0.3, 0.13);
  p.lamp(-0.86, 0.3, 0.08, 0.18, '#ff4a3d');
}

function van(p: Painter, def: VehicleDef): void {
  const wb = def.wheelbase;
  const R = def.wheelR;
  const body = new Path2D();
  body.moveTo(-0.72, -0.1);
  body.lineTo(-0.74, 1.4);
  body.quadraticCurveTo(-0.72, 1.52, -0.58, 1.52);
  body.lineTo(wb + 0.3, 1.52);
  body.quadraticCurveTo(wb + 0.42, 1.52, wb + 0.48, 1.42);
  body.lineTo(wb + 0.9, 0.78);
  body.quadraticCurveTo(wb + 0.98, 0.66, wb + 0.98, 0.5);
  body.lineTo(wb + 0.96, 0.0);
  body.quadraticCurveTo(wb + 0.94, -0.1, wb + 0.82, -0.1);
  body.closePath();
  p.panel(body, def.color, 1.52, -0.1);
  p.arch(0, R);
  p.arch(wb, R);
  // Livery stripe and a parcel logo.
  p.lamp(-0.74, 0.46, wb + 1.7, 0.16, def.trim);
  p.lamp(-0.74, 0.66, wb + 1.64, 0.035, def.trim);
  p.lamp(0.55, 0.86, 0.36, 0.3, def.trim);
  p.line(0.73, 0.86, 0.73, 1.16, 'rgba(255,255,255,0.9)', 1.2);
  p.line(0.55, 1.01, 0.91, 1.01, 'rgba(255,255,255,0.9)', 1.2);
  const wind = poly([
    [wb + 0.18, 0.86],
    [wb + 0.8, 0.86],
    [wb + 0.42, 1.42],
    [wb + 0.18, 1.42],
  ]);
  const side = rrect(new Path2D(), wb - 0.5, 0.86, 0.6, 0.54, 0.05);
  p.glass(side, 1.4, 0.86, [wb - 0.12, 1.06, 0.1]);
  p.glass(wind, 1.42, 0.86);
  // Sliding door and cab door seams.
  p.line(0.25, 0.02, 0.25, 1.45);
  p.line(1.55, 0.02, 1.55, 1.45);
  p.line(1.53, 1.4, 0.27, 1.4, 'rgba(0,0,0,0.25)');
  p.line(wb - 0.6, 0.05, wb - 0.6, 1.46);
  p.handle(1.3, 0.8);
  p.handle(wb - 0.4, 0.8);
  p.lamp(wb + 0.3, 0.9, 0.16, 0.12, shade(def.color, -0.4));
  p.bumper(wb + 0.72, -0.12, 0.34, 0.2);
  p.bumper(-0.84, -0.12, 0.3, 0.2);
  p.headlight(wb + 0.96, 0.32, 0.15);
  p.lamp(-0.78, 0.25, 0.08, 0.2, '#ff4a3d');
  p.lamp(-0.78, 0.18, 0.08, 0.06, '#ffae2b');
}

function dumpTruck(p: Painter, def: VehicleDef): void {
  const wb = def.wheelbase;
  const R = def.wheelR;
  // Chassis rail under everything.
  p.fill(rrect(new Path2D(), -1.1, -0.08, wb + 2.0, 0.26, 0.04), '#2b2d33', true);
  // Dump bed: a tapered steel tub with ribs, and the load heaped inside it.
  const bedL = -1.18;
  const bedR = wb - 0.95;
  const bed = poly([
    [bedL + 0.1, 0.22],
    [bedR, 0.22],
    [bedR + 0.12, 1.34],
    [bedL, 1.34],
  ]);
  const load = new Path2D();
  load.moveTo(bedL + 0.06, 1.3);
  load.quadraticCurveTo(bedL + 0.3, 1.62, (bedL + bedR) / 2 - 0.2, 1.8);
  load.quadraticCurveTo((bedL + bedR) / 2 + 0.5, 1.9, bedR + 0.06, 1.46);
  load.lineTo(bedR + 0.08, 1.3);
  load.closePath();
  p.fill(load, def.trim);
  if (!p.chalk) {
    // Rocks in the heap.
    const { ctx } = p;
    ctx.fillStyle = shade(def.trim, 0.25);
    for (let i = 0; i < 9; i++) {
      const x = bedL + 0.3 + i * ((bedR - bedL - 0.5) / 8);
      ctx.beginPath();
      ctx.arc(x, 1.36 + Math.sin(i * 2.3) * 0.08 + 0.18 * Math.sin((i / 8) * Math.PI), 0.06, 0, TAU);
      ctx.fill();
    }
  }
  p.panel(bed, def.color, 1.34, 0.22);
  for (let x = bedL + 0.45; x < bedR - 0.1; x += 0.52) p.line(x, 0.28, x + 0.05, 1.28, 'rgba(0,0,0,0.3)', 2);
  p.lamp(bedL - 0.02, 1.24, bedR - bedL + 0.16, 0.1, shade(def.color, -0.3));
  // Hydraulic ram between the chassis and the bed.
  p.line(bedR - 0.3, 0.18, bedR - 0.05, 0.62, CHROME, 3.5);
  // Cab.
  const cab = new Path2D();
  cab.moveTo(wb - 0.78, -0.02);
  cab.lineTo(wb - 0.78, 1.72);
  cab.quadraticCurveTo(wb - 0.76, 1.82, wb - 0.62, 1.82);
  cab.lineTo(wb + 0.72, 1.82);
  cab.quadraticCurveTo(wb + 0.86, 1.82, wb + 0.9, 1.66);
  cab.lineTo(wb + 0.98, 0.9);
  cab.lineTo(wb + 1.02, 0.0);
  cab.closePath();
  p.panel(cab, def.color, 1.82, -0.02);
  p.arch(0, R);
  p.arch(wb, R);
  const win = rrect(new Path2D(), wb + 0.12, 0.98, 0.72, 0.62, 0.06);
  p.glass(win, 1.6, 0.98, [wb + 0.42, 1.2, 0.11]);
  p.line(wb - 0.02, 0.1, wb - 0.02, 1.62);
  p.handle(wb + 0.1, 0.84);
  // Grille, beacon, exhaust stack and a mudflap.
  for (let y = 0.24; y < 0.72; y += 0.12) p.line(wb + 0.9, y, wb + 1.0, y, 'rgba(0,0,0,0.5)', 1.5);
  p.lamp(wb + 0.2, 1.82, 0.22, 0.12, '#ffae2b');
  p.fill(rrect(new Path2D(), wb - 0.96, 0.9, 0.1, 1.25, 0.03), '#3b3e45');
  p.lamp(wb - 0.98, 2.1, 0.14, 0.06, '#1b1c20');
  p.lamp(-0.62, -0.28, 0.06, 0.34, '#18191d');
  p.bumper(wb + 0.8, -0.12, 0.34, 0.2);
  p.headlight(wb + 1.02, 0.3, 0.16);
  p.lamp(-1.16, 0.26, 0.08, 0.2, '#ff4a3d');
}

function bus(p: Painter, def: VehicleDef): void {
  const wb = def.wheelbase;
  const R = def.wheelR;
  const body = rrect(new Path2D(), -1.1, -0.12, wb + 2.2, 2.08, 0.26);
  p.panel(body, def.color, 1.96, -0.12);
  p.arch(0, R);
  p.arch(wb, R);
  // Black rub rails, and the roof cap.
  for (const y of [0.42, 0.9]) p.lamp(-1.1, y, wb + 2.2, 0.07, def.trim);
  p.lamp(-1.0, 1.84, wb + 2.0, 0.06, shade(def.color, 0.35));
  // Passenger windows, with a few passengers.
  for (let i = 0, x = -0.86; x < wb - 0.3; x += 0.62, i++) {
    const w = rrect(new Path2D(), x, 1.08, 0.5, 0.58, 0.05);
    p.glass(w, 1.66, 1.08, i % 3 !== 1 ? [x + 0.25, 1.26, 0.08, i % 2 ? '#3b2a24' : '#2b2a38'] : undefined);
  }
  // Folding door with split glass, and the driver's windshield.
  const door = rrect(new Path2D(), wb + 0.14, 0.02, 0.5, 1.64, 0.04);
  p.fill(door, shade(def.color, -0.1), true);
  p.glass(rrect(new Path2D(), wb + 0.18, 0.95, 0.19, 0.66, 0.03), 1.61, 0.95);
  p.glass(rrect(new Path2D(), wb + 0.41, 0.95, 0.19, 0.66, 0.03), 1.61, 0.95);
  p.line(wb + 0.39, 0.06, wb + 0.39, 1.62, 'rgba(0,0,0,0.5)');
  const wind = poly([
    [wb + 0.72, 0.95],
    [wb + 1.08, 0.95],
    [wb + 1.08, 1.8],
    [wb + 0.78, 1.8],
  ]);
  p.glass(wind, 1.8, 0.95, [wb + 0.9, 1.2, 0.1]);
  // Stop arm, flashers, bumper and lights.
  if (!p.chalk) {
    const { ctx } = p;
    ctx.fillStyle = '#d7263d';
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + Math.PI / 8;
      const x = wb - 0.45 + Math.cos(a) * 0.15;
      const y = 0.7 + Math.sin(a) * 0.15;
      if (k) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.2 * p.px;
    ctx.stroke();
  }
  for (const x of [-1.02, wb + 0.92]) {
    p.lamp(x, 1.9, 0.12, 0.08, '#ff4a3d');
    p.lamp(x + (x < 0 ? 0.14 : -0.14), 1.9, 0.12, 0.08, '#ffae2b');
  }
  p.bumper(wb + 0.9, -0.14, 0.32, 0.2);
  p.bumper(-1.22, -0.14, 0.32, 0.2);
  p.headlight(wb + 1.1, 0.3, 0.16);
  p.lamp(-1.14, 0.3, 0.08, 0.22, '#ff4a3d');
}

function semi(p: Painter, def: VehicleDef): void {
  const wb = def.wheelbase;
  const R = def.wheelR;
  // Trailer box with ribs, a livery stripe and rear doors.
  const tL = -1.7;
  const tR = wb - 1.05;
  p.fill(rrect(new Path2D(), tL + 0.2, -0.05, tR - tL + 1.6, 0.2, 0.03), '#2b2d33', true);
  const box = rrect(new Path2D(), tL, 0.2, tR - tL, 2.3, 0.08);
  p.panel(box, def.trim, 2.5, 0.2);
  for (let x = tL + 0.55; x < tR - 0.2; x += 0.55) p.line(x, 0.26, x, 2.44, 'rgba(0,0,0,0.13)', 2);
  p.lamp(tL, 1.18, tR - tL, 0.26, def.color);
  p.lamp(tL, 1.5, tR - tL, 0.05, def.color);
  p.line(tL + 0.08, 0.28, tL + 0.08, 2.42, 'rgba(0,0,0,0.4)', 1.5);
  p.lamp(tL - 0.04, 0.3, 0.07, 0.22, '#ff4a3d');
  for (let x = tL + 0.3; x < tR; x += 0.9) p.lamp(x, 2.38, 0.1, 0.06, '#ffae2b');
  // Underride bar, landing leg and mudflap.
  p.lamp(tL + 0.1, -0.2, 0.08, 0.42, '#3b3e45');
  p.lamp(tL + 0.02, -0.22, 0.34, 0.08, '#3b3e45');
  p.lamp(tR - 0.3, -0.1, 0.08, 0.34, '#4a4d55');
  p.lamp(-0.66, -0.3, 0.06, 0.4, '#18191d');
  // Cab with sleeper fairing, long hood and chrome grille.
  const cab = new Path2D();
  cab.moveTo(wb - 0.95, 0.0);
  cab.lineTo(wb - 0.95, 2.1);
  cab.quadraticCurveTo(wb - 0.9, 2.5, wb - 0.4, 2.52);
  cab.lineTo(wb + 0.05, 2.46);
  cab.lineTo(wb + 0.3, 1.2);
  cab.lineTo(wb + 1.18, 1.1);
  cab.quadraticCurveTo(wb + 1.28, 1.06, wb + 1.3, 0.9);
  cab.lineTo(wb + 1.3, 0.05);
  cab.lineTo(wb + 1.24, -0.04);
  cab.closePath();
  p.panel(cab, def.color, 2.52, 0.0);
  p.arch(0, R);
  for (const ax of def.midAxles ?? []) p.arch(ax, R);
  p.arch(wb, R);
  const wind = poly([
    [wb - 0.3, 1.3],
    [wb + 0.22, 1.3],
    [wb + 0.04, 2.1],
    [wb - 0.3, 2.1],
  ]);
  p.glass(wind, 2.1, 1.3, [wb - 0.06, 1.55, 0.11]);
  p.line(wb - 0.4, 0.12, wb - 0.4, 2.2);
  p.line(wb + 0.32, 0.12, wb + 0.32, 1.14);
  p.handle(wb - 0.32, 1.1);
  p.lamp(wb - 0.95, 1.0, 2.25, 0.05, shade(def.color, 0.4));
  // Chrome grille, fuel tank and twin stacks.
  p.fill(rrect(new Path2D(), wb + 1.2, 0.2, 0.1, 0.8, 0.02), CHROME);
  for (let y = 0.28; y < 0.96; y += 0.1) p.line(wb + 1.2, y, wb + 1.3, y, 'rgba(0,0,0,0.35)', 1);
  p.fill(rrect(new Path2D(), wb - 0.86, 0.02, 0.62, 0.34, 0.16), CHROME, true);
  p.line(wb - 0.7, 0.06, wb - 0.7, 0.32, 'rgba(0,0,0,0.25)');
  p.line(wb - 0.4, 0.06, wb - 0.4, 0.32, 'rgba(0,0,0,0.25)');
  for (const dx of [0, 0.12]) p.fill(rrect(new Path2D(), wb - 1.1 + dx, 0.5, 0.08, 2.5, 0.03), CHROME);
  p.lamp(wb - 0.4, 2.52, 0.4, 0.06, '#ffae2b');
  p.bumper(wb + 1.1, -0.14, 0.3, 0.22);
  p.headlight(wb + 1.3, 0.34, 0.16);
}

const BODIES: Record<VehicleDef['id'], (p: Painter, def: VehicleDef) => void> = { car, van, truck: dumpTruck, bus, semi };

/** Draws a body in the current transform (vehicle frame, meters, y up). */
export function drawBody(ctx: Ctx, def: VehicleDef, px: number, chalk: boolean): void {
  const p = new Painter(ctx, px, chalk);
  if (!chalk) {
    // Soft contact shadow under the chassis.
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(def.wheelbase / 2, -def.wheelR * 0.95, def.wheelbase / 2 + 1.1, 0.12, 0, 0, TAU);
    ctx.fill();
  }
  BODIES[def.id](p, def);
  if (chalk) {
    ctx.strokeStyle = PAL.chalkDim;
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash([4 * px, 3 * px]);
    for (const path of p.chalkPaths) ctx.stroke(path);
    ctx.setLineDash([]);
  }
}

/** A tire with tread, sidewall and a spinning rim, in screen pixels. */
export function drawWheel(ctx: Ctx, x: number, y: number, R: number, angle: number, heavy: boolean): void {
  ctx.fillStyle = '#16171b';
  ctx.beginPath();
  ctx.arc(x, y, R, 0, TAU);
  ctx.fill();
  if (R > 7) {
    // Tread blocks around the rim of the tire.
    ctx.strokeStyle = '#2c2e34';
    ctx.lineWidth = Math.max(1, R * 0.08);
    ctx.beginPath();
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = angle + (i / n) * TAU;
      ctx.moveTo(x + Math.cos(a) * R * 0.86, y + Math.sin(a) * R * 0.86);
      ctx.lineTo(x + Math.cos(a) * R * 0.98, y + Math.sin(a) * R * 0.98);
    }
    ctx.stroke();
  }
  ctx.fillStyle = '#2a2c31';
  ctx.beginPath();
  ctx.arc(x, y, R * 0.8, 0, TAU);
  ctx.fill();
  const rim = ctx.createRadialGradient(x - R * 0.15, y - R * 0.15, R * 0.05, x, y, R * 0.58);
  rim.addColorStop(0, '#f1f4f8');
  rim.addColorStop(1, heavy ? '#8d949e' : '#a9b1bc');
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(x, y, R * 0.56, 0, TAU);
  ctx.fill();
  if (heavy) {
    // Steel disc wheel: a deep dish with round hand holes.
    ctx.fillStyle = '#5c626c';
    for (let i = 0; i < 6; i++) {
      const a = angle + (i / 6) * TAU;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * R * 0.36, y + Math.sin(a) * R * 0.36, R * 0.08, 0, TAU);
      ctx.fill();
    }
  } else {
    ctx.strokeStyle = '#6b717b';
    ctx.lineWidth = Math.max(1, R * 0.11);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = angle + (i * TAU) / 5;
      ctx.moveTo(x + Math.cos(a) * R * 0.16, y + Math.sin(a) * R * 0.16);
      ctx.lineTo(x + Math.cos(a) * R * 0.52, y + Math.sin(a) * R * 0.52);
    }
    ctx.stroke();
  }
  ctx.fillStyle = '#4a4f57';
  ctx.beginPath();
  ctx.arc(x, y, R * 0.17, 0, TAU);
  ctx.fill();
  // Lug nuts.
  ctx.fillStyle = '#d6dbe2';
  for (let i = 0; i < 5; i++) {
    const a = angle + (i / 5) * TAU + 0.6;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * R * 0.11, y + Math.sin(a) * R * 0.11, Math.max(0.6, R * 0.03), 0, TAU);
    ctx.fill();
  }
}
