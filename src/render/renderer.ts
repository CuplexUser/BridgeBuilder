import type { AttachPick, Editor } from '../editor';
import type { GridPt } from '../design';
import type { Debris, DebrisField, Particles, Whip } from '../fx/particles';
import { PK, WHIP_LIFE } from '../fx/particles';
import { bankY, goalX, seatPiers, type LevelDef, type Overhang } from '../levels';
import { BLOCK, blockOf, MATERIALS, type BlockDef, type MaterialId } from '../physics/materials';
import type { VehicleDef } from '../physics/vehicles';
import { convoyLayout, SHIP_HALF, windGust, type Link, type TestRun, type VehicleHandle, type Wind } from '../physics/world';
import type { Camera } from './camera';
import { blockSpots, pileSpots } from '../rules';
import { defaultSag, mainPathIn } from '../maincable';
import { blockPoly, RING, ringPath, ringPolys, ringRise } from '../masonry';
import { MATERIAL_CHALK, PAL, stressColor } from './palette';
import { THEMES, type Land, type Theme } from './themes';
import { drawBody, drawRailWheel, drawWheel } from './vehicles';

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
  /** Wheel spin per vehicle: rear, front. */
  wheelAngles: [number, number][];
  floats: FloatText[];
  /** A member or joint picked on the stress graph, ringed on the bridge. */
  highlight?: { member: number; node: number; ghost?: [number, number, number, number] | null } | null;
  /** The level editor's cursor: the grid point, what the tool would do there, and a channel being dragged. */
  maker?: { x: number; y: number; label: string; ok: boolean; channel: [number, number, number] | null } | null;
  /** A magnifier for touch: the screen point to enlarge (x, y) and the finger hiding it (fx, fy). */
  loupe?: { x: number; y: number; fx: number; fy: number } | null;
  /** Members of the best known design revealed by the engineer's hints, drawn as ghosts to trace. */
  reviewHint?: [GridPt, GridPt, MaterialId][] | null;
  /** After a successful test: members that barely carried load, and steel that wood could replace. */
  marks?: { idle: number[]; wood: number[] } | null;
  /** The block or arch wedge under the mouse, marked for removal on a tap. */
  hoverCell?: number;
  /** The square the block brush would paint, by its lower left corner, and why it can't, if it can't. */
  brush?: { x: number; y: number; why: string } | null;
}

const TAU = Math.PI * 2;
/** How deep a pile reaches below the mud it stands in, as drawn, m. */
const PILE_DEPTH = 6;
/** Shades of broken concrete deck. */
const CHUNK_SHADES = ['#8d939c', '#6f757e', '#a4a9b1', '#5d6168'];
const MEMBER_WIDTH: Record<MaterialId, number> = { road: 0.3, heavy: 0.36, wood: 0.17, steel: 0.15, cable: 0.06, main: 0.14, concrete: 0.34, masonry: 0.3, arch: 0.42, track: 0.36, ram: 0.2, damper: 0.16 };

/** Piers, and the footing under each mast's hinge: concrete columns up from the riverbed. */
function footings(L: LevelDef): [number, number][] {
  return [...L.piers, ...(L.masts ?? []).map(([x, base]): [number, number] => [x, base])];
}

/** Deterministic 0..1 noise so scenery stays put between frames. */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** World-space outline of a rock mass from the riverbed: a ragged top and sides that widen into the bed. */
function rockPoly(x0: number, x1: number, top: number, deep: number): [number, number][] {
  return [
    [x0 - 0.6, deep],
    [x0 - 0.15, top - 2.2],
    [x0, top - 0.6],
    [x0 + 0.1, top],
    [x1 - 0.1, top],
    [x1, top - 0.6],
    [x1 + 0.15, top - 2.2],
    [x1 + 0.6, deep],
  ];
}

/** World-space outline of a mud bank in the river: a low, slumped mound spreading wide into the bed. */
function mudPoly(x0: number, x1: number, top: number, deep: number): [number, number][] {
  return [
    [x0 - 2.5, deep],
    [x0 - 1.2, top - 1.4],
    [x0 - 0.4, top - 0.35],
    [x0 + 0.3, top],
    [x1 - 0.3, top],
    [x1 + 0.4, top - 0.35],
    [x1 + 1.2, top - 1.4],
    [x1 + 2.5, deep],
  ];
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

/** Profile of one land layer. */
type Ridge = 'round' | 'peaks' | 'mesa' | 'dunes' | 'city';

/** Per land type: the shapes of the far, middle and near layers, and how tall each is. */
const LAND_LAYERS: Record<Land, [Ridge, Ridge, Ridge, number, number, number]> = {
  hills: ['peaks', 'round', 'round', 1, 1, 1],
  mesa: ['mesa', 'mesa', 'round', 1.1, 0.9, 0.55],
  flat: ['round', 'round', 'round', 0.45, 0.35, 0.3],
  dunes: ['round', 'round', 'dunes', 0.7, 0.5, 0.8],
  peaks: ['peaks', 'peaks', 'round', 1.7, 1.25, 0.9],
  city: ['city', 'city', 'city', 1.3, 1, 0.55],
};

/** Height of a land layer at u, in units of its amplitude. */
function ridge(shape: Ridge, u: number, seed: number): number {
  const round = 0.6 + 0.4 * Math.sin(u + seed) + 0.5 * Math.sin(u * 2.3 + seed * 2);
  switch (shape) {
    case 'peaks':
      // Sharper ridges from a folded sine.
      return round + 0.35 * (1 - Math.abs(Math.sin(u * 3.1 + seed)));
    case 'mesa': {
      // Flat tops and steep sides: a clipped, steepened wave.
      const w = Math.sin(u * 0.9 + seed) + 0.35 * Math.sin(u * 2.1 + seed * 3);
      return 0.25 + 1.05 * Math.min(1, Math.max(0, (w - 0.1) * 3)) + 0.03 * Math.sin(u * 9 + seed);
    }
    case 'dunes':
      return 0.45 + 0.35 * Math.sin(u * 0.7 + seed) + 0.12 * Math.sin(u * 1.9 + seed * 2);
    default:
      return round;
  }
}

/** True when p lies on segment a→b strictly between its ends. */
function inside(p: [number, number], a: [number, number], b: [number, number]): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) < 1e-6 && t > 1e-6 && t < 1 - 1e-6;
}

/** Paint order for a bridge link: cables, then truss, then deck. */
function drawLayer(l: Link): number {
  return l.tensionOnly ? 0 : l.drivable ? 2 : 1;
}

/** Bézier control points for the piece p1→p2 of a smooth curve through p0, p1, p2, p3 (Catmull–Rom). */
function curveControls(p0: Pt2, p1: Pt2, p2: Pt2, p3: Pt2): Ctl {
  return [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
}

type Pt2 = [number, number];
type Ctl = [number, number, number, number];

/** One member to paint in a batch, in screen space, with its unit normal pointing up the screen. */
interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  nx: number;
  ny: number;
  mat: MaterialId;
  stress: number;
  /** How far a slack cable droops at its middle, px. */
  sag: number;
  ctl?: Ctl;
}

function segOf(ax: number, ay: number, bx: number, by: number, mat: MaterialId, stress: number, sag: number, ctl?: Ctl): Seg {
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let nx = (by - ay) / len;
  let ny = -(bx - ax) / len;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  return { ax, ay, bx, by, nx, ny, mat, stress, sag, ctl };
}

/** Adds a full circle to a path as its own subpath. */
function disk(p: Path2D, x: number, y: number, r: number): void {
  p.moveTo(x + r, y);
  p.arc(x, y, r, 0, TAU);
}

/** Adds a member's line to a path, `off` px along its normal: straight, drooping, or along its curve. */
function segPath(p: Path2D, s: Seg, off: number): void {
  const ox = s.nx * off;
  const oy = s.ny * off;
  p.moveTo(s.ax + ox, s.ay + oy);
  if (s.ctl) p.bezierCurveTo(s.ctl[0] + ox, s.ctl[1] + oy, s.ctl[2] + ox, s.ctl[3] + oy, s.bx + ox, s.by + oy);
  else if (s.sag > 0) p.quadraticCurveTo((s.ax + s.bx) / 2 + ox, (s.ay + s.by) / 2 + oy + s.sag * 2, s.bx + ox, s.by + oy);
  else p.lineTo(s.bx + ox, s.by + oy);
}

/**
 * Control points for each piece of the curved runs among the given segments, keyed by
 * segment index. A piece's neighbors are the pieces of the same run that share its ends;
 * at a run's end the curve leaves along the piece itself.
 */
function runControls(segs: { a: number; b: number; run: number }[], at: (p: number) => Pt2): Map<number, Ctl> {
  const byEnd = new Map<string, number[]>();
  segs.forEach((g, i) => {
    for (const p of [g.a, g.b]) byEnd.set(`${g.run}:${p}`, [...(byEnd.get(`${g.run}:${p}`) ?? []), i]);
  });
  const beyond = (i: number, p: number): Pt2 => {
    const g = segs[i];
    const j = byEnd.get(`${g.run}:${p}`)!.find((k) => k !== i);
    if (j === undefined) return at(p);
    return at(segs[j].a === p ? segs[j].b : segs[j].a);
  };
  const out = new Map<number, Ctl>();
  segs.forEach((g, i) => out.set(i, curveControls(beyond(i, g.a), at(g.a), at(g.b), beyond(i, g.b))));
  return out;
}

/** Traces a smooth curve through screen points. */
function smoothPath(ctx: CanvasRenderingContext2D, pts: Pt2[]): void {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const c = curveControls(pts[Math.max(0, i - 1)], pts[i], pts[i + 1], pts[Math.min(pts.length - 1, i + 2)]);
    ctx.bezierCurveTo(c[0], c[1], c[2], c[3], pts[i + 1][0], pts[i + 1][1]);
  }
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
  /** At night the bridge and vehicle are drawn here first, then shaded down as one layer. */
  private shadeLayer: HTMLCanvasElement = document.createElement('canvas');
  private shadeCtx: CanvasRenderingContext2D | null = null;
  private hatch: CanvasPattern | null = null;
  private sunX = 0;
  private sunY = 0;
  private dpr = 1;
  private look: Theme = THEMES[0];
  /** Each vehicle's contact shadow strength, eased from frame to frame. */
  private shadows = new WeakMap<VehicleHandle, number>();
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
    this.dpr = dpr;
    this.buildLayers(dpr);
  }

  get theme(): Theme {
    return this.look;
  }

  /** Switches the painted scene's look; the cached sky is redrawn to match. */
  setTheme(t: Theme): void {
    if (t === this.look) return;
    this.look = t;
    if (this.w > 0) this.buildLayers(this.dpr);
  }

  private buildLayers(dpr: number): void {
    const { w, h } = this;
    const T = this.look;
    const prep = (c: HTMLCanvasElement) => {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      const x = c.getContext('2d')!;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      return x;
    };
    const sx = prep(this.skyLayer);
    const g = sx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, T.sky[0]);
    g.addColorStop(0.55, T.sky[1]);
    g.addColorStop(1, T.sky[2]);
    sx.fillStyle = g;
    sx.fillRect(0, 0, w, h);
    if (T.stars) {
      for (let i = 0; i < 170; i++) {
        sx.fillStyle = `rgba(255,255,255,${0.25 + hash(i + 1700) * 0.65})`;
        sx.beginPath();
        sx.arc(hash(i + 500) * w, hash(i + 900) ** 1.7 * h * 0.8, 0.4 + hash(i + 1300) * 1.1, 0, TAU);
        sx.fill();
      }
    }
    // Where the light glints on the water comes from, even with the sun hidden behind cloud.
    this.sunX = w * (T.sun?.x ?? 0.6);
    this.sunY = h * (T.sun?.y ?? 0.3);
    if (T.sun) {
      const glow = sx.createRadialGradient(this.sunX, this.sunY, 0, this.sunX, this.sunY, h * T.sun.r * 7.5);
      glow.addColorStop(0, `rgba(${T.sun.glow},0.85)`);
      glow.addColorStop(0.15, `rgba(${T.sun.glow},0.35)`);
      glow.addColorStop(1, `rgba(${T.sun.glow},0)`);
      sx.fillStyle = glow;
      sx.fillRect(0, 0, w, h);
      const r = Math.max(12, h * T.sun.r);
      sx.fillStyle = T.sun.color;
      sx.beginPath();
      sx.arc(this.sunX, this.sunY, r, 0, TAU);
      sx.fill();
      if (T.night) {
        // Moon seas.
        sx.fillStyle = 'rgba(120,130,160,0.18)';
        for (const [dx, dy, k] of [[-0.3, -0.2, 0.32], [0.25, 0.1, 0.22], [-0.05, 0.4, 0.18]]) {
          sx.beginPath();
          sx.arc(this.sunX + dx * r, this.sunY + dy * r, k * r, 0, TAU);
          sx.fill();
        }
      }
    }

    const vx = prep(this.vignetteLayer);
    const v = vx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, T.vignette);
    vx.fillStyle = v;
    vx.fillRect(0, 0, w, h);

    if (T.night) this.shadeCtx = prep(this.shadeLayer);
    else {
      // Free the memory until a night chapter needs it again.
      this.shadeLayer.width = this.shadeLayer.height = 0;
      this.shadeCtx = null;
    }

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

  /** The concrete anchor size on the level being drawn. */
  private blockDef: BlockDef = BLOCK;

  draw(v: SceneView): void {
    this.blockDef = blockOf(v.level);
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
      // At night the bridge, debris and vehicle go on their own layer, shaded down together.
      const shade = this.look.night && v.develop > 0 ? this.shadeCtx : null;
      if (shade) {
        shade.save();
        shade.setTransform(1, 0, 0, 1, 0, 0);
        shade.clearRect(0, 0, this.shadeLayer.width, this.shadeLayer.height);
        shade.restore();
        this.ctx = shade;
      }
      this.drawRunMembers(v.run, v.time);
      this.drawDebris(this.debris.items);
      this.drawVehicleRun(v.run, v.wheelAngles);
      if (shade) {
        this.ctx = ctx;
        shade.globalCompositeOperation = 'source-atop';
        shade.fillStyle = `rgba(6,12,38,${0.5 * v.develop})`;
        shade.fillRect(0, 0, this.w, this.h);
        shade.globalCompositeOperation = 'source-over';
        ctx.drawImage(this.shadeLayer, 0, 0, this.w, this.h);
        for (const handle of v.run.vehicles) this.drawLights(v.run, handle, v.develop);
      }
      // Snapping cables stay bright even at night: the eye should catch them.
      this.drawWhips(v.run, this.debris.whips);
      this.drawWaterFront(v);
      if (v.highlight) this.drawHighlight(v.run, v.highlight, v.time);
    } else if (v.editor) {
      this.drawVehicleParked(v.level);
      if (v.showHint && v.level.hint) this.drawHint(v, v.level.hint);
      if (v.reviewHint?.length) this.drawHint(v, v.reviewHint);
      this.drawEditor(v, v.editor);
      if (v.maker) this.drawMakerCursor(v.maker, v.level, v.time);
    }

    this.drawParticles();
    if (v.develop > 0) this.drawWeather(v);
    if (v.level.wind) this.drawWind(v, v.level.wind);
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
    if (v.loupe) this.drawLoupe(v.loupe);
    ctx.restore();
  }

  /** Enlarges the finished frame around the point a finger is placing, in a circle lifted clear of the finger. */
  private drawLoupe(l: NonNullable<SceneView['loupe']>): void {
    const { ctx, dpr } = this;
    const r = 56;
    const zoom = 2;
    const lift = 104;
    let cx = l.fx;
    let cy = l.fy - lift;
    // No room above the finger (the HUD sits up there too): go beside it instead.
    if (cy - r < 72) {
      cx = l.fx + (l.fx < this.w / 2 ? lift : -lift);
      cy = Math.max(r + 8, l.fy);
    }
    cx = Math.min(this.w - r - 8, Math.max(r + 8, cx));
    const half = r / zoom;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fillStyle = PAL.paperDeep;
    ctx.fill();
    ctx.clip();
    ctx.drawImage(this.canvas, (l.x - half) * dpr, (l.y - half) * dpr, 2 * half * dpr, 2 * half * dpr, cx - r, cy - r, 2 * r, 2 * r);
    // A crosshair with an open middle, so the joint itself stays visible.
    ctx.strokeStyle = 'rgba(233,243,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(cx + dx * 6, cy + dy * 6);
      ctx.lineTo(cx + dx * 14, cy + dy * 14);
    }
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = PAL.chalk;
    ctx.lineWidth = 2;
    ctx.stroke();
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
    for (const [px, py] of footings(L)) {
      banks.push([[px - 0.45, py], [px + 0.45, py], [px + 0.45, deep], [px - 0.45, deep]]);
    }
    for (const o of L.overhangs ?? []) banks.push(overhangPoly(o, W));
    for (const [r0, r1, top] of L.rocks ?? []) banks.push(rockPoly(r0, r1, top, deep));
    for (const [m0, m1, top] of L.mud ?? []) banks.push(mudPoly(m0, m1, top, deep));
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

    for (const [px, py] of seatPiers(L)) this.seat(px, py, true);
    for (const t of L.towers ?? []) this.tower(t[0], t[1], t[2], true);
    for (const [x, base, top] of L.masts ?? []) this.mast(x, base, x, top, true);
    // Where concrete anchors may go: a dashed strip in each bank, with a tick at every free spot.
    if (L.blocks) {
      const reach = L.blocks.reach;
      const design = v.editor?.design;
      ctx.strokeStyle = PAL.chalkDim;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      for (const [left, y] of [
        [-reach - 0.5, 0],
        [W + 0.5, bankY(L)],
      ]) {
        ctx.strokeRect(cam.sx(left), cam.sy(y), reach * cam.scale, this.blockDef.depth * cam.scale);
      }
      ctx.setLineDash([]);
      ctx.beginPath();
      for (const [x, y] of blockSpots(L)) {
        if (design && design.findNode(x, y) >= 0) continue;
        ctx.moveTo(cam.sx(x), cam.sy(y));
        ctx.lineTo(cam.sx(x), cam.sy(y) + Math.max(4, 0.25 * cam.scale));
      }
      ctx.stroke();
    }
    // Where piles may go: a dashed pile down to the bed under every free spot on the mud.
    if (L.piles) {
      const design = v.editor?.design;
      ctx.strokeStyle = PAL.chalkDim;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      for (const [x, y] of pileSpots(L)) {
        if (design && design.findNode(x, y) >= 0) continue;
        ctx.moveTo(cam.sx(x), cam.sy(y));
        ctx.lineTo(cam.sx(x), cam.sy(y - PILE_DEPTH));
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const n of v.editor?.design.nodes ?? []) if (n.pile) this.pile(n.x, n.y, true);
    (L.channels ?? []).forEach(([cx0, cx1, top], i) => this.channelBlueprint(cx0, cx1, top, L.waterY, i === 0 ? L.ship?.mast : undefined));

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
    const T = this.look;
    const L = v.level;
    const W = L.width;
    ctx.drawImage(this.skyLayer, 0, 0, this.w, this.h);
    const sunX = this.sunX;

    this.clouds(v.time);
    if (T.birds) this.birds(v.time);

    // Parallax land: a distant range, then two nearer layers, shaped by the chapter.
    const horizon = cam.sy(L.waterY + 0.5);
    const [s0, s1, s2, a0, a1, a2] = LAND_LAYERS[T.land];
    this.hills(horizon - 70, 0.06, 95 * a0, T.mountain, 0.0022, 7.7, s0, T.snowCaps);
    this.hills(horizon - 30, 0.15, 60 * a1, T.hillFar, 0.004, 1.3, s1, T.snowCaps && s1 === 'peaks');
    this.hills(horizon - 5, 0.3, 40 * a2, T.hillNear, 0.007, 4.1, s2, false);

    // Water body, risen if a flood has come.
    const wy = cam.sy(v.run?.world.waterY ?? L.waterY);
    const wg = ctx.createLinearGradient(0, wy, 0, this.h);
    wg.addColorStop(0, T.waterTop);
    wg.addColorStop(1, T.waterDeep);
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.moveTo(0, this.h);
    for (let x = 0; x <= this.w + 12; x += 12) {
      ctx.lineTo(x, wy + Math.sin(x * 0.03 + v.time * 1.6) * 3 + Math.sin(x * 0.011 - v.time) * 2);
    }
    ctx.lineTo(this.w, this.h);
    ctx.fill();
    // Light glinting on the water.
    ctx.fillStyle = T.glint;
    for (let i = 0; i < 14; i++) {
      const gx = sunX + Math.sin(i * 7.3 + v.time * 0.7) * 50 * (1 + i * 0.15);
      const gy = wy + 8 + i * 7;
      if (gy > this.h) break;
      ctx.fillRect(gx - 12 + Math.sin(v.time * 3 + i) * 4, gy, 24 - i, 2);
    }

    // Banks: rock with a lip of grass, sand, snow or curb.
    const deep = L.waterY - 30;
    this.bank([[-80, 0], [0, 0], [0.15, -0.8], [-0.1, -2.2], [0.2, -3.5], [0, deep], [-80, deep]]);
    const rY = bankY(L);
    this.bank([[W, rY], [W + 80, rY], [W + 80, deep], [W, deep], [W - 0.2, rY - 3.5], [W + 0.1, rY - 2.2], [W - 0.15, rY - 0.8]]);
    const gs = Math.max(3, 0.28 * cam.scale);
    ctx.fillStyle = T.grass;
    ctx.fillRect(cam.sx(-80), cam.sy(0) - 1, cam.sx(0.1) - cam.sx(-80), gs);
    ctx.fillRect(cam.sx(W - 0.1), cam.sy(rY) - 1, cam.sx(W + 80) - cam.sx(W - 0.1), gs);
    ctx.fillStyle = T.grassDark;
    ctx.fillRect(cam.sx(-80), cam.sy(0) - 1 + gs, cam.sx(0.1) - cam.sx(-80), 2);
    ctx.fillRect(cam.sx(W - 0.1), cam.sy(rY) - 1 + gs, cam.sx(W + 80) - cam.sx(W - 0.1), 2);
    this.flora(-2.5, -45, 0, 1);
    this.flora(goalX(L) + 2, W + 45, rY, 2);
    if (T.tufts) {
      this.tufts(-40, -0.3, 0);
      this.tufts(W + 0.3, W + 40, rY);
    }

    for (const o of L.overhangs ?? []) this.overhang(o, W);
    for (const [x0, x1, top] of L.rocks ?? []) this.bank(rockPoly(x0, x1, top, deep));
    for (const [x0, x1, top] of L.mud ?? []) this.mud(x0, x1, top, deep);
    for (const n of v.run?.design.nodes ?? v.editor?.design.nodes ?? []) if (n.pile) this.pile(n.x, n.y, false);

    // Piers, and the footings masts stand on.
    for (const [px, py] of footings(L)) {
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
    for (const [px, py] of seatPiers(L)) this.seat(px, py, false);

    for (const t of L.towers ?? []) this.tower(t[0], t[1], t[2], false);
    this.sceneMastsAndBlocks(v);
    (L.channels ?? []).forEach(([x0, x1, top], i) => {
      // On a drawbridge level the first channel's boat is the tall ship, waiting or under way.
      const ship = i === 0 && L.ship ? { x: (x0 + x1) / 2, mast: L.ship.mast, progress: v.run ? v.run.shipProgress : -1 } : undefined;
      this.channelScene(x0, x1, top, L.waterY, v.time, ship);
    });

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

  /** One parallax land layer. City layers are skylines; the rest are ridgelines, optionally snow-capped. */
  private hills(base: number, parallax: number, amp: number, color: string, freq: number, seed: number, shape: Ridge, snow: boolean): void {
    const { ctx, cam } = this;
    const off = cam.cx * cam.scale * parallax;
    if (shape === 'city') {
      this.skyline(base, off, amp, color, seed);
      return;
    }
    const path = new Path2D();
    path.moveTo(0, this.h);
    for (let x = 0; x <= this.w + 16; x += 16) path.lineTo(x, base - amp * ridge(shape, (x + off) * freq, seed));
    path.lineTo(this.w, this.h);
    path.closePath();
    ctx.fillStyle = color;
    ctx.fill(path);
    if (!snow) return;
    // Snow above a wavy snowline, clipped to the ridge.
    ctx.save();
    ctx.clip(path);
    ctx.fillStyle = 'rgba(246,250,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let x = 0; x <= this.w + 16; x += 16) {
      const u = (x + off) * freq;
      ctx.lineTo(x, base - amp * (1.12 + 0.08 * Math.sin(u * 7 + seed)));
    }
    ctx.lineTo(this.w, 0);
    ctx.fill();
    ctx.restore();
  }

  /** A city skyline: blocks of buildings, with lit windows at night. */
  private skyline(base: number, off: number, amp: number, color: string, seed: number): void {
    const { ctx } = this;
    const slot = 26 + seed * 3;
    const k0 = Math.floor(off / slot) - 1;
    const k1 = Math.ceil((off + this.w) / slot) + 1;
    const tops: [number, number, number][] = [];
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let k = k0; k <= k1; k++) {
      const r = hash(k * 7.13 + seed * 101);
      const hgt = amp * (0.35 + r * r * 1.4);
      const bw = slot * (0.72 + 0.28 * hash(k + seed * 17));
      const x = k * slot - off;
      ctx.rect(x, base - hgt, bw, hgt + this.h);
      if (r > 0.86) ctx.rect(x + bw / 2 - 1, base - hgt - 14, 2, 14);
      tops.push([x, bw, base - hgt]);
    }
    ctx.fill();
    if (!this.look.night) return;
    ctx.fillStyle = `rgba(255,214,140,${0.45 + seed * 0.04})`;
    ctx.beginPath();
    for (const [x, bw, top] of tops) {
      // Window pattern keyed to the building, so it stays put while panning.
      const key = Math.round(x + off);
      for (let wy = top + 6, row = 0; wy < base - 4; wy += 8, row++) {
        for (let wx = 4, col = 0; wx < bw - 5; wx += 7, col++) {
          if (hash(key * 0.37 + row * 1.91 + col * 5.3 + seed * 13) > 0.64) ctx.rect(x + wx, wy, 3, 4);
        }
      }
    }
    ctx.fill();
  }

  /** Soft drifting clouds, colored by the chapter's light. */
  private clouds(time: number): void {
    const { ctx, cam } = this;
    const C = this.look.clouds;
    const span = this.w + 500;
    for (let i = 0; i < C.count; i++) {
      const speed = 6 + hash(i) * 10;
      const x = ((((hash(i + 10) * span + time * speed - cam.cx * cam.scale * 0.04) % span) + span) % span) - 250;
      const y = this.h * (0.07 + 0.22 * hash(i + 20));
      const s = (0.6 + hash(i + 30) * 0.9) * C.scale;
      ctx.fillStyle = `rgba(${C.rgb},${C.alpha + 0.12 * hash(i + 40)})`;
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

  /** Gulls wheeling over the water. */
  private birds(time: number): void {
    const { ctx } = this;
    const span = this.w + 200;
    ctx.strokeStyle = 'rgba(40,52,64,0.75)';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const x = ((hash(i + 60) * span + time * (14 + 8 * hash(i + 61))) % span) - 100;
      const y = this.h * (0.14 + 0.2 * hash(i + 62)) + Math.sin(time * 0.9 + i * 2) * 10;
      const flap = Math.sin(time * 7 + i * 1.7);
      const s = 5 + 3 * hash(i + 63);
      ctx.moveTo(x - s, y - s * 0.5 * flap);
      ctx.quadraticCurveTo(x - s * 0.4, y - s * 0.6, x, y);
      ctx.quadraticCurveTo(x + s * 0.4, y - s * 0.6, x + s, y - s * 0.5 * flap);
    }
    ctx.stroke();
  }

  /** Whatever grows or stands along a bank, from x0 toward x1, rooted at height y. */
  private flora(x0: number, x1: number, y: number, seed: number): void {
    const { ctx, cam } = this;
    const T = this.look;
    const dir = Math.sign(x1 - x0);
    const s = cam.scale;
    const sy = cam.sy(y);
    const path = new Path2D();
    const snow = new Path2D();
    const glows: [number, number][] = [];
    for (let i = 0, x = x0; (x1 - x) * dir > 0 && i < 40; i++) {
      const r = hash(seed * 100 + i);
      const h = 1.8 + r * 2.6;
      const sx = cam.sx(x);
      const gap = T.flora === 'lamps' ? 5 : T.flora === 'cactus' ? 2.4 + hash(seed * 50 + i) * 4 : 1.4 + hash(seed * 50 + i) * 2.6;
      x += dir * gap;
      if (sx < -80 || sx > this.w + 80) continue;
      switch (T.flora) {
        case 'mixed':
        case 'pine':
          path.rect(sx - 0.07 * s, sy - h * 0.35 * s, 0.14 * s, h * 0.35 * s);
          if (T.flora === 'pine' || r < 0.55) {
            // Pine: stacked triangles, with snowy tips in the mountains.
            for (let k = 0; k < 3; k++) {
              const w = (0.95 - k * 0.22) * s * (0.7 + h * 0.12);
              const top = sy - (h * (0.45 + k * 0.2) + 0.9) * s;
              path.moveTo(sx, top);
              path.lineTo(sx + w, top + h * 0.42 * s);
              path.lineTo(sx - w, top + h * 0.42 * s);
              path.closePath();
              if (T.snowCaps) {
                snow.moveTo(sx, top);
                snow.lineTo(sx + w * 0.35, top + h * 0.15 * s);
                snow.lineTo(sx - w * 0.35, top + h * 0.15 * s);
                snow.closePath();
              }
            }
          } else {
            const rx = 0.75 * s * (0.8 + r * 0.4);
            path.moveTo(sx + rx, sy - h * 0.62 * s);
            path.ellipse(sx, sy - h * 0.62 * s, rx, h * 0.42 * s, 0, 0, TAU);
          }
          break;
        case 'cactus':
          this.cactus(sx, sy, h * 0.75, r, s);
          break;
        case 'willow': {
          path.rect(sx - 0.09 * s, sy - h * 0.55 * s, 0.18 * s, h * 0.55 * s);
          const rx = 1.2 * s * (0.8 + r * 0.4);
          const cy = sy - h * 0.72 * s;
          path.moveTo(sx + rx, cy);
          path.ellipse(sx, cy, rx, 0.75 * s, 0, 0, TAU);
          // A drooping curtain of leaves.
          path.moveTo(sx - rx, cy);
          for (let k = 0; k <= 8; k++) {
            const px = sx - rx + (k / 8) * rx * 2;
            path.lineTo(px, sy - (h * 0.2 + 0.25 * hash(i * 9 + k)) * s);
            path.lineTo(Math.min(sx + rx, px + rx * 0.12), cy + 0.2 * s);
          }
          path.closePath();
          break;
        }
        case 'palm':
          this.palm(sx, sy, h, r, s);
          break;
        case 'lamps': {
          // Street lamp: a post, an arm reaching toward the water, and the lamp head.
          const top = sy - 2.8 * s;
          const reach = -dir * 0.5 * s;
          path.rect(sx - 0.05 * s, top, 0.1 * s, 2.8 * s);
          path.rect(Math.min(sx, sx + reach), top, Math.abs(reach), 0.08 * s);
          path.rect(sx + reach - 0.14 * s, top, 0.28 * s, 0.14 * s);
          glows.push([sx + reach, top + 0.14 * s]);
          break;
        }
      }
    }
    ctx.fillStyle = T.tree;
    ctx.fill(path);
    if (T.snowCaps) {
      ctx.fillStyle = 'rgba(245,250,255,0.9)';
      ctx.fill(snow);
    }
    if (glows.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const [gx, gy] of glows) {
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, 1.8 * s);
      g.addColorStop(0, 'rgba(255,214,150,0.55)');
      g.addColorStop(1, 'rgba(255,190,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(gx - 1.8 * s, gy - 1.8 * s, 3.6 * s, 3.6 * s);
      ctx.fillStyle = 'rgba(255,240,200,0.9)';
      ctx.fillRect(gx - 0.1 * s, gy, 0.2 * s, 0.06 * s);
    }
    ctx.restore();
  }

  /** A saguaro: a trunk with one or two upturned arms. */
  private cactus(sx: number, sy: number, h: number, r: number, s: number): void {
    const { ctx } = this;
    ctx.strokeStyle = this.look.tree;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, 0.32 * s);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx, sy - h * s);
    ctx.moveTo(sx, sy - h * 0.45 * s);
    ctx.lineTo(sx - 0.45 * s, sy - h * 0.45 * s);
    ctx.lineTo(sx - 0.45 * s, sy - h * 0.75 * s);
    if (r > 0.4) {
      ctx.moveTo(sx, sy - h * 0.6 * s);
      ctx.lineTo(sx + 0.42 * s, sy - h * 0.6 * s);
      ctx.lineTo(sx + 0.42 * s, sy - h * 0.85 * s);
    }
    ctx.stroke();
  }

  /** A leaning palm with drooping fronds. */
  private palm(sx: number, sy: number, h: number, r: number, s: number): void {
    const { ctx } = this;
    const lean = (r - 0.5) * 1.6;
    const tx = sx + lean * s;
    const ty = sy - h * 1.1 * s;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#6e5a3e';
    ctx.lineWidth = Math.max(1.5, 0.16 * s);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(sx + lean * 0.1 * s, sy - h * 0.6 * s, tx, ty);
    ctx.stroke();
    ctx.strokeStyle = this.look.tree;
    ctx.lineWidth = Math.max(1.5, 0.2 * s);
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 5) * Math.PI;
      const dx = Math.cos(a) * 1.4 * s;
      ctx.moveTo(tx, ty);
      ctx.quadraticCurveTo(tx + dx * 0.6, ty - (0.5 + Math.sin(a) * 0.4) * s, tx + dx, ty + (0.45 - Math.sin(a) * 0.3) * s);
    }
    ctx.stroke();
  }

  /** Grass tufts along a bank top. */
  private tufts(x0: number, x1: number, y: number): void {
    const { ctx, cam } = this;
    ctx.strokeStyle = this.look.grassDark;
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

  /** Wind streaks racing left to right, more and brighter as a gust builds. Screen space. */
  private drawWind(v: SceneView, wind: Wind): void {
    const { ctx, cam } = this;
    const t = v.run ? v.run.world.time : v.time;
    const gust = windGust(wind, t);
    const W = this.w + 300;
    const pan = cam.cx * cam.scale;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `rgba(255,255,255,${0.12 + 0.35 * gust})`;
    ctx.beginPath();
    const n = Math.round(14 + 36 * gust);
    for (let i = 0; i < n; i++) {
      const depth = 0.5 + hash(i + 5000);
      const speed = (500 + 700 * gust) * depth;
      const x = ((((hash(i + 5100) * W + t * speed - pan * 0.5 * depth) % W) + W) % W) - 150;
      const y = hash(i + 5200) * this.h * 0.85 + Math.sin(t * 2 + i) * 6;
      const len = (40 + 90 * gust) * depth;
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + len * 0.5, y - 3 * depth, x + len, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Rain streaks with rings on the water, or drifting snow. Screen space, with no allocation. */
  private drawWeather(v: SceneView): void {
    const kind = this.look.weather;
    if (kind === 'clear') return;
    const { ctx, cam } = this;
    const t = v.time;
    const W = this.w + 120;
    const H = this.h + 60;
    const pan = cam.cx * cam.scale;
    ctx.save();
    ctx.globalAlpha = v.develop;
    if (kind === 'rain') {
      ctx.strokeStyle = 'rgba(205,218,232,0.38)';
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      for (let i = 0; i < 150; i++) {
        const depth = 0.5 + hash(i + 3000);
        const speed = 850 * depth;
        const y = ((hash(i + 3100) * H + t * speed) % H) - 30;
        const x = ((((hash(i + 3200) * W - t * speed * 0.22 - pan * 0.4 * depth) % W) + W) % W) - 60;
        const len = 12 * depth;
        ctx.moveTo(x, y);
        ctx.lineTo(x - len * 0.22, y + len);
      }
      ctx.stroke();
      // Rings where drops hit the water.
      const wy = cam.sy(v.level.waterY);
      if (wy < this.h) {
        ctx.strokeStyle = 'rgba(225,232,240,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < 22; i++) {
          const cycle = t * 1.6 + hash(i + 3300);
          const p = cycle % 1;
          const n = Math.floor(cycle);
          const x = hash(i * 13 + n * 7.7) * this.w;
          const y = wy + 6 + hash(i * 5 + n * 3.1) * Math.min(80, this.h - wy);
          const r = 2 + p * 9;
          ctx.moveTo(x + r, y);
          ctx.ellipse(x, y, r, r * 0.3, 0, 0, TAU);
        }
        ctx.globalAlpha = v.develop * 0.8;
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = 'rgba(250,252,255,0.85)';
      ctx.beginPath();
      for (let i = 0; i < 120; i++) {
        const depth = 0.4 + hash(i + 4000) * 0.9;
        const y = ((hash(i + 4100) * H + t * 45 * depth) % H) - 30;
        const sway = Math.sin(t * (0.8 + depth) + i) * 18 * depth;
        const x = ((((hash(i + 4200) * W - t * 12 * depth - pan * 0.35 * depth + sway) % W) + W) % W) - 60;
        const r = 1 + depth * 1.8;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TAU);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  /** Night: headlights and taillights on the vehicle, added as light. */
  private drawLights(run: TestRun, v: VehicleHandle, develop: number): void {
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

  /** Rock overhang above an approach road, with strata lines and a sunlit rim. */
  private overhang(o: Overhang, W: number): void {
    const { ctx, cam } = this;
    const poly = overhangPoly(o, W);
    const path = new Path2D();
    poly.forEach(([x, y], i) => (i ? path.lineTo(cam.sx(x), cam.sy(y)) : path.moveTo(cam.sx(x), cam.sy(y))));
    path.closePath();
    const g = ctx.createLinearGradient(0, cam.sy(o.top), 0, cam.sy(o.bottom));
    g.addColorStop(0, this.look.rock);
    g.addColorStop(1, this.look.rockDark);
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
  private channelBlueprint(x0: number, x1: number, top: number, waterY: number, mast?: number): void {
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
    if (mast !== undefined) {
      // The tall ship passes through here: the open bridge has to clear this outline.
      const cx = (x0 + x1) / 2;
      const sl = cam.sx(cx - SHIP_HALF);
      const sr = cam.sx(cx + SHIP_HALF);
      const mt = cam.sy(mast);
      ctx.strokeStyle = PAL.gold;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(sl, mt, sr - sl, b - mt);
      ctx.setLineDash([]);
      this.label(`TALL SHIP · MAST +${mast} m · OPEN THE BRIDGE FOR IT`, (sl + sr) / 2, mt - 14, PAL.gold);
    }
  }

  /** The channel in the painted scene: marker buoys and a moored sailboat whose mast shows the clearance. */
  private channelScene(x0: number, x1: number, top: number, waterY: number, time: number, ship?: { x: number; mast: number; progress: number }): void {
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
    if (ship) {
      this.tallShip(ship.x, ship.mast, ship.progress, waterY + 0.05 + bob, time);
      return;
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

  /**
   * A drawbridge's tall ship, seen bow on as it sails through the bridge toward us: small and
   * far off while it waits, full size as it passes, gone once it's through.
   */
  private tallShip(x: number, mast: number, progress: number, waterline: number, time: number): void {
    if (progress > 1) return;
    const { ctx, cam } = this;
    const k = 0.35 + 0.65 * Math.max(0, Math.min(1, progress));
    const s = cam.scale * k;
    const height = (mast - waterline) * k;
    ctx.save();
    ctx.globalAlpha = progress < 0 ? 0.7 : 1;
    ctx.translate(cam.sx(x), cam.sy(waterline));
    ctx.rotate(Math.sin(time * 0.9) * 0.02);
    // Hull, bow on: a rounded wedge with a stripe.
    ctx.fillStyle = '#23324a';
    ctx.beginPath();
    ctx.moveTo(-SHIP_HALF * s, -1.1 * s);
    ctx.lineTo(SHIP_HALF * s, -1.1 * s);
    ctx.quadraticCurveTo(SHIP_HALF * 0.7 * s, 0.3 * s, 0, 0.35 * s);
    ctx.quadraticCurveTo(-SHIP_HALF * 0.7 * s, 0.3 * s, -SHIP_HALF * s, -1.1 * s);
    ctx.fill();
    ctx.fillStyle = '#f2efe6';
    ctx.fillRect(-SHIP_HALF * s, -1.1 * s, SHIP_HALF * 2 * s, 0.18 * s);
    // Mast with yard and furled sails, up to the full mast height.
    ctx.strokeStyle = '#3b2a1e';
    ctx.lineWidth = Math.max(1.5, 0.1 * s);
    ctx.beginPath();
    ctx.moveTo(0, -1.1 * s);
    ctx.lineTo(0, -height * cam.scale);
    for (const f of [0.45, 0.72]) {
      const y = -height * cam.scale * f;
      ctx.moveTo(-SHIP_HALF * 0.9 * s, y);
      ctx.lineTo(SHIP_HALF * 0.9 * s, y);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(245,240,228,0.95)';
    for (const f of [0.45, 0.72]) {
      const y = -height * cam.scale * f;
      ctx.fillRect(-SHIP_HALF * 0.85 * s, y, SHIP_HALF * 1.7 * s, 0.22 * s);
    }
    // Pennant at the masthead.
    ctx.fillStyle = PAL.bolt;
    ctx.beginPath();
    ctx.moveTo(0, -height * cam.scale);
    ctx.lineTo(0.9 * s, -height * cam.scale + 0.15 * s);
    ctx.lineTo(0, -height * cam.scale + 0.3 * s);
    ctx.fill();
    ctx.restore();
  }

  /** Masts and concrete anchors in the painted scene: where the run has moved them, or as built. */
  private sceneMastsAndBlocks(v: SceneView): void {
    const L = v.level;
    const w = v.run?.world;
    if (w) {
      for (const m of w.masts) this.mast(w.x[m.base], w.y[m.base], w.x[m.top], w.y[m.top], false);
      for (const b of w.blocks) {
        // A block that tore loose leaves its pit behind.
        if (b.loose) this.pit(b.x0, b.ground);
        this.block(w.x[b.p], w.y[b.p], b.ground, b.loose ? 0 : b.util, false);
      }
      return;
    }
    for (const [x, base, top] of L.masts ?? []) this.mast(x, base, x, top, false);
    for (const n of v.editor?.design.nodes ?? []) if (n.block) this.block(n.x, n.y, n.y, 0, false);
  }

  /**
   * A concrete anchor with its bolt at (x, top): a slab hanging below it, clipped to show only what
   * is above the ground while it sits in its pit. Glows as it nears tearing loose.
   */
  private block(x: number, top: number, ground: number, util: number, chalk: boolean): void {
    const { ctx, cam } = this;
    const hw = (this.blockDef.width / 2) * cam.scale;
    const h = this.blockDef.depth * cam.scale;
    const sx = cam.sx(x);
    const sy = cam.sy(top);
    if (chalk) {
      ctx.fillStyle = 'rgba(154,160,168,0.25)';
      ctx.fillRect(sx - hw, sy, hw * 2, h);
      ctx.strokeStyle = PAL.chalk;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sx - hw, sy, hw * 2, h);
      return;
    }
    // Set in the ground, only its top face shows; once out it shows whole.
    const buried = Math.abs(top - ground) < 1e-3;
    const g = ctx.createLinearGradient(sx - hw, 0, sx + hw, 0);
    g.addColorStop(0, PAL.concrete);
    g.addColorStop(1, PAL.concreteDark);
    ctx.fillStyle = g;
    if (buried) ctx.fillRect(sx - hw, sy - 2, hw * 2, Math.max(4, h * 0.18));
    else {
      ctx.fillRect(sx - hw, sy, hw * 2, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx - hw, sy, hw * 2, h);
    }
    if (util > 0.6) {
      ctx.strokeStyle = stressColor(util, Math.min(1, (util - 0.6) * 2.5));
      ctx.lineWidth = Math.max(2, 0.08 * cam.scale);
      ctx.strokeRect(sx - hw - 2, sy - 3, hw * 2 + 4, Math.max(6, h * 0.18) + 2);
    }
  }

  /** The hole a concrete anchor left when it tore loose. */
  private pit(x: number, ground: number): void {
    const { ctx, cam } = this;
    const hw = (this.blockDef.width / 2) * cam.scale;
    ctx.fillStyle = 'rgba(30,20,12,0.75)';
    ctx.fillRect(cam.sx(x) - hw, cam.sy(ground) - 1, hw * 2, this.blockDef.depth * cam.scale * 0.6);
  }

  /**
   * A hinged mast from its foot (bx, by) to its top (tx, ty), at whatever lean the run gives it:
   * two tapering legs with cross bracing, a cap, and the hinge pin at its foot.
   */
  private mast(bx: number, by: number, tx: number, ty: number, chalk: boolean): void {
    const { ctx, cam } = this;
    const len = Math.hypot(tx - bx, ty - by) || 1;
    const ux = (tx - bx) / len;
    const uy = (ty - by) / len;
    // Sideways, perpendicular to the mast.
    const nx = uy;
    const ny = -ux;
    const halfBase = 0.4;
    const halfTop = 0.2;
    const at = (d: number, side: number): [number, number] => {
      const half = halfBase + ((halfTop - halfBase) * d) / len;
      return [cam.sx(bx + ux * d + nx * side * half), cam.sy(by + uy * d + ny * side * half)];
    };
    const lw = chalk ? 1.5 : Math.max(1.5, cam.scale * 0.07);
    ctx.lineCap = 'round';
    ctx.strokeStyle = chalk ? PAL.chalkDim : PAL.towerDark;
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (let d = 0.6; d < len - 0.5; d += 1) {
      const d2 = Math.min(len, d + 1);
      ctx.moveTo(...at(d, -1));
      ctx.lineTo(...at(d2, 1));
      ctx.moveTo(...at(d, 1));
      ctx.lineTo(...at(d2, -1));
    }
    ctx.stroke();
    ctx.strokeStyle = chalk ? PAL.chalk : PAL.tower;
    ctx.lineWidth = lw * 1.8;
    ctx.beginPath();
    // The legs pinch together at the foot, onto the hinge.
    for (const side of [-1, 1]) {
      ctx.moveTo(cam.sx(bx), cam.sy(by));
      ctx.lineTo(...at(0.6, side));
      ctx.lineTo(...at(len, side));
    }
    ctx.moveTo(...at(len, -1));
    ctx.lineTo(...at(len, 1));
    ctx.stroke();
    // The hinge: a pin in a round shoe.
    const r = Math.max(4, 0.22 * cam.scale);
    ctx.fillStyle = chalk ? PAL.paper : PAL.towerDark;
    ctx.strokeStyle = chalk ? PAL.chalk : PAL.tower;
    ctx.lineWidth = chalk ? 1.5 : lw;
    ctx.beginPath();
    ctx.arc(cam.sx(bx), cam.sy(by), r, 0, TAU);
    ctx.fill();
    ctx.stroke();
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
    g.addColorStop(0, this.look.rock);
    g.addColorStop(1, this.look.rockDark);
    ctx.fillStyle = g;
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(cam.sx(x), cam.sy(y)) : ctx.moveTo(cam.sx(x), cam.sy(y))));
    ctx.closePath();
    ctx.fill();
  }

  /** A mud bank: wet brown silt with a darker waterline and a few puddles on top. */
  private mud(x0: number, x1: number, top: number, deep: number): void {
    const { ctx, cam } = this;
    const poly = mudPoly(x0, x1, top, deep);
    const g = ctx.createLinearGradient(0, cam.sy(top), 0, cam.sy(top - 3));
    g.addColorStop(0, PAL.mud);
    g.addColorStop(1, PAL.mudDark);
    ctx.fillStyle = g;
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(cam.sx(x), cam.sy(y)) : ctx.moveTo(cam.sx(x), cam.sy(y))));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(160,190,200,0.35)';
    for (let k = 0; k < Math.floor(x1 - x0); k += 2) {
      const x = x0 + 0.6 + k + hash(k + x0 * 7) * 0.8;
      ctx.beginPath();
      ctx.ellipse(cam.sx(x), cam.sy(top) + 1.5, 0.35 * cam.scale, 0.05 * cam.scale + 1, 0, 0, TAU);
      ctx.fill();
    }
  }

  /** A pile driven through the mud to rock: a steel tube down from its cap, banded where it meets the mud. */
  private pile(x: number, top: number, chalk: boolean): void {
    const { ctx, cam } = this;
    const hw = Math.max(3, 0.16 * cam.scale);
    const sx = cam.sx(x);
    const t = cam.sy(top);
    const b = cam.sy(top - PILE_DEPTH);
    if (chalk) {
      ctx.strokeStyle = PAL.chalk;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sx - hw, t, hw * 2, b - t);
      return;
    }
    const g = ctx.createLinearGradient(sx - hw, 0, sx + hw, 0);
    g.addColorStop(0, PAL.chrome);
    g.addColorStop(1, PAL.steelDark);
    ctx.fillStyle = g;
    ctx.fillRect(sx - hw, t, hw * 2, b - t);
    ctx.fillStyle = PAL.concreteDark;
    ctx.fillRect(sx - hw * 1.8, t - 2, hw * 3.6, Math.max(4, 0.18 * cam.scale));
  }

  private drawWaterFront(v: SceneView): void {
    // A translucent front water layer so sinking things look submerged.
    const { ctx, cam } = this;
    const wy = cam.sy(v.run?.world.waterY ?? v.level.waterY);
    ctx.fillStyle = this.look.waterFront;
    ctx.beginPath();
    ctx.moveTo(0, this.h);
    for (let x = 0; x <= this.w + 12; x += 12) {
      ctx.lineTo(x, wy + 2 + Math.sin(x * 0.035 - v.time * 1.9) * 2.5);
    }
    ctx.lineTo(this.w, this.h);
    ctx.fill();
    ctx.strokeStyle = this.look.foam;
    ctx.globalAlpha = 0.7;
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
  private memberPaint(ax: number, ay: number, bx: number, by: number, mat: MaterialId, stress: number | null, alpha = 1, sag = 0, time = 0, ctl?: Ctl): void {
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
      if (ctl) ctx.bezierCurveTo(ctl[0] + nx * off, ctl[1] + ny * off, ctl[2] + nx * off, ctl[3] + ny * off, bx + nx * off, by + ny * off);
      else if (sag > 0) ctx.quadraticCurveTo((ax + bx) / 2 + nx * off, (ay + by) / 2 + ny * off + sag * 2, bx + nx * off, by + ny * off);
      else ctx.lineTo(bx + nx * off, by + ny * off);
    };
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    if (mat === 'track') {
      // Ballast deck, sleepers along it, and the rail on top.
      line(0);
      ctx.strokeStyle = PAL.trackDark;
      ctx.lineWidth = w + 2;
      ctx.stroke();
      ctx.strokeStyle = PAL.track;
      ctx.lineWidth = w;
      ctx.stroke();
      if (w > 5) {
        line(w * 0.2);
        ctx.setLineDash([w * 0.35, w * 0.45]);
        ctx.lineCap = 'butt';
        ctx.strokeStyle = PAL.sleeper;
        ctx.lineWidth = w * 0.35;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineCap = 'round';
      }
      line(w * 0.48);
      ctx.strokeStyle = PAL.rail;
      ctx.lineWidth = Math.max(1, w * 0.16);
      ctx.stroke();
    } else if (mat === 'road' || mat === 'heavy') {
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
    } else if (mat === 'ram') {
      this.ramShape(ax, ay, bx, by, w, false);
    } else if (mat === 'damper') {
      this.damperShape(ax, ay, bx, by, w, false);
    } else if (mat === 'concrete') {
      line(0);
      ctx.lineCap = 'butt';
      ctx.strokeStyle = PAL.concreteDark;
      ctx.lineWidth = w + 2;
      ctx.stroke();
      ctx.strokeStyle = PAL.concrete;
      ctx.lineWidth = w;
      ctx.stroke();
      // Lit face, and the seams of the formwork every meter or so.
      line(w * 0.3);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = Math.max(1, w * 0.18);
      ctx.stroke();
      if (w > 5) {
        line(0);
        ctx.setLineDash([1.5, Math.max(6, cam.scale * 0.9)]);
        ctx.strokeStyle = 'rgba(40,36,30,0.35)';
        ctx.lineWidth = w * 0.9;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.lineCap = 'round';
    } else if (mat === 'masonry') {
      line(0);
      ctx.lineCap = 'butt';
      ctx.strokeStyle = PAL.masonryDark;
      ctx.lineWidth = w + 2;
      ctx.stroke();
      ctx.strokeStyle = PAL.masonry;
      ctx.lineWidth = w;
      ctx.stroke();
      ctx.lineCap = 'round';
    } else if (mat === 'arch') {
      // Stone voussoirs: a ring of blocks with a joint every half meter or so.
      line(0);
      ctx.lineCap = 'butt';
      ctx.strokeStyle = PAL.archDark;
      ctx.lineWidth = w + 2;
      ctx.stroke();
      ctx.strokeStyle = PAL.arch;
      ctx.lineWidth = w;
      ctx.stroke();
      line(w * 0.3);
      ctx.strokeStyle = PAL.archHi;
      ctx.lineWidth = Math.max(1, w * 0.2);
      ctx.stroke();
      if (w > 5) {
        line(0);
        ctx.setLineDash([1.5, Math.max(5, cam.scale * 0.5)]);
        ctx.strokeStyle = 'rgba(60,44,28,0.45)';
        ctx.lineWidth = w;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.lineCap = 'round';
    } else if (mat === 'main') {
      line(0);
      ctx.strokeStyle = PAL.mainDark;
      ctx.lineWidth = w + 2;
      ctx.stroke();
      ctx.strokeStyle = PAL.main;
      ctx.lineWidth = w;
      ctx.stroke();
      // Wrapping wire catching the light along its top.
      line(w * 0.22);
      ctx.setLineDash([1.6, 2.4]);
      ctx.strokeStyle = PAL.mainHi;
      ctx.lineWidth = Math.max(0.8, w * 0.3);
      ctx.stroke();
      ctx.setLineDash([]);
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
      ctx.lineWidth = Math.max(1.5, w * (MATERIALS[mat].drivable ? 0.3 : mat === 'cable' ? 0.9 : mat === 'main' ? 0.7 : mat === 'concrete' || mat === 'arch' ? 0.35 : 0.55));
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

  /**
   * Paints many members the way memberPaint paints one, in a few strokes per material instead
   * of several per member: every member's outline, then every body, then each detail, then the
   * stress overlay in a stroke per shade. A big bridge is hundreds of members, and canvas
   * strokes, not their length, are what a frame pays for.
   */
  private paintBatch(segs: Seg[], time: number): void {
    const { ctx, cam } = this;
    const byMat = new Map<MaterialId, Seg[]>();
    for (const sg of segs) byMat.set(sg.mat, [...(byMat.get(sg.mat) ?? []), sg]);
    const width = (mat: MaterialId) => Math.max(mat === 'cable' ? 1.5 : 2, MEMBER_WIDTH[mat] * cam.scale);
    const stroke = (list: Seg[], off: number, style: string, lineWidth: number, cap: CanvasLineCap = 'round', dash: number[] | null = null) => {
      const path = new Path2D();
      for (const sg of list) segPath(path, sg, off);
      ctx.strokeStyle = style;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = cap;
      if (dash) ctx.setLineDash(dash);
      ctx.stroke(path);
      if (dash) ctx.setLineDash([]);
    };
    for (const [mat, list] of byMat) {
      const w = width(mat);
      switch (mat) {
        case 'track':
          stroke(list, 0, PAL.trackDark, w + 2);
          stroke(list, 0, PAL.track, w);
          if (w > 5) stroke(list, w * 0.2, PAL.sleeper, w * 0.35, 'butt', [w * 0.35, w * 0.45]);
          stroke(list, w * 0.48, PAL.rail, Math.max(1, w * 0.16));
          break;
        case 'road':
        case 'heavy': {
          const heavy = mat === 'heavy';
          stroke(list, 0, '#1b1d22', w + 2);
          stroke(list, 0, heavy ? PAL.heavy : PAL.road, w);
          // Slab edge below, lit surface above, and the lane line.
          stroke(list, -w * 0.32, heavy ? PAL.heavyEdge : '#2a2c32', Math.max(1, w * (heavy ? 0.3 : 0.2)));
          stroke(list, w * 0.36, 'rgba(255,255,255,0.14)', Math.max(1, w * 0.14));
          if (w > 5) stroke(list, w * 0.05, PAL.roadLine, Math.max(1, w * 0.11), 'butt', [w * 0.9, w * 0.9]);
          break;
        }
        case 'wood':
          stroke(list, 0, PAL.woodDark, w + 2);
          stroke(list, 0, PAL.wood, w);
          if (w > 4) {
            // Grain: two broken streaks along the length.
            stroke(list, w * 0.22, 'rgba(110,62,24,0.45)', Math.max(0.8, w * 0.1), 'butt', [11, 6.6]);
            stroke(list, -w * 0.2, 'rgba(110,62,24,0.45)', Math.max(0.8, w * 0.1), 'butt', [7, 4.2]);
          }
          stroke(list, w * 0.1, 'rgba(255,230,190,0.3)', Math.max(1, w * 0.2));
          break;
        case 'steel': {
          stroke(list, 0, PAL.steelDark, w + 2);
          stroke(list, 0, PAL.steel, w);
          // I-beam flanges, and a rivet near each end.
          stroke(list, w * 0.34, PAL.steelDark, Math.max(0.8, w * 0.16), 'butt');
          stroke(list, -w * 0.34, PAL.steelDark, Math.max(0.8, w * 0.16), 'butt');
          if (w > 4) {
            const rivets = new Path2D();
            const r = Math.max(1, w * 0.14);
            for (const sg of list) {
              for (const t of [0.14, 0.86]) {
                const x = sg.ax + (sg.bx - sg.ax) * t;
                const y = sg.ay + (sg.by - sg.ay) * t;
                disk(rivets, x, y, r);
              }
            }
            ctx.fillStyle = PAL.steelDark;
            ctx.fill(rivets);
          }
          break;
        }
        case 'concrete':
          stroke(list, 0, PAL.concreteDark, w + 2, 'butt');
          stroke(list, 0, PAL.concrete, w, 'butt');
          // Lit face, and the seams of the formwork every meter or so.
          stroke(list, w * 0.3, 'rgba(255,255,255,0.22)', Math.max(1, w * 0.18), 'butt');
          if (w > 5) stroke(list, 0, 'rgba(40,36,30,0.35)', w * 0.9, 'butt', [1.5, Math.max(6, cam.scale * 0.9)]);
          break;
        case 'arch':
          stroke(list, 0, PAL.archDark, w + 2, 'butt');
          stroke(list, 0, PAL.arch, w, 'butt');
          stroke(list, w * 0.3, PAL.archHi, Math.max(1, w * 0.2), 'butt');
          // Stone voussoirs: a joint every half meter or so.
          if (w > 5) stroke(list, 0, 'rgba(60,44,28,0.45)', w, 'butt', [1.5, Math.max(5, cam.scale * 0.5)]);
          break;
        case 'main':
          stroke(list, 0, PAL.mainDark, w + 2);
          stroke(list, 0, PAL.main, w);
          // Wrapping wire catching the light along its top.
          stroke(list, w * 0.22, PAL.mainHi, Math.max(0.8, w * 0.3), 'round', [1.6, 2.4]);
          break;
        case 'ram':
          for (const sg of list) this.ramShape(sg.ax, sg.ay, sg.bx, sg.by, w, false);
          break;
        case 'damper':
          for (const sg of list) this.damperShape(sg.ax, sg.ay, sg.bx, sg.by, w, false);
          break;
        default:
          stroke(list, 0, PAL.cable, w + 1);
          // Braided highlight.
          stroke(list, 0, PAL.cableHi, Math.max(0.8, w * 0.45), 'round', [2.5, 2]);
      }
    }
    // Stress shading, a stroke per material and shade.
    const shades = new Map<string, Seg[]>();
    for (const sg of segs) {
      const key = `${sg.mat} ${Math.round(Math.min(1, Math.abs(sg.stress)) * 20)}`;
      shades.set(key, [...(shades.get(key) ?? []), sg]);
    }
    for (const [key, list] of shades) {
      const mat = list[0].mat;
      const s = Number(key.split(' ')[1]) / 20;
      const w = width(mat);
      stroke(list, 0, stressColor(s, 0.35 + 0.6 * Math.min(1, s * 1.3)), Math.max(1.5, w * (MATERIALS[mat].drivable ? 0.3 : mat === 'cable' ? 0.9 : mat === 'main' ? 0.7 : mat === 'concrete' || mat === 'arch' ? 0.35 : 0.55)), 'butt');
    }
    // Members near failure throb, each at its own strength.
    const pulse = 0.75 + 0.25 * Math.sin(time * 18);
    for (const sg of segs) {
      const s = Math.abs(sg.stress);
      if (s <= 0.75) continue;
      stroke([sg], 0, `rgba(255,59,59,${(s - 0.75) * 1.4 * pulse})`, width(sg.mat) + 10 * (s - 0.5) * pulse);
    }
  }

  private chalkMember(ax: number, ay: number, bx: number, by: number, mat: MaterialId, highlight: 'none' | 'hover' | 'delete', ctl?: Ctl): void {
    const { ctx, cam } = this;
    const w = Math.max(mat === 'cable' ? 1.5 : 2.5, MEMBER_WIDTH[mat] * cam.scale * 0.8);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    if (ctl) ctx.bezierCurveTo(ctl[0], ctl[1], ctl[2], ctl[3], bx, by);
    else ctx.lineTo(bx, by);
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
    if (mat === 'ram') {
      this.ramShape(ax, ay, bx, by, w, true);
      return;
    }
    if (mat === 'damper') {
      this.damperShape(ax, ay, bx, by, w, true);
      return;
    }
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

  /** Blocks and arch wedges in chalk: a tinted face, a firm outline, a red one when a tap would take it off; and the brush's square. */
  private chalkCells(ed: Editor, v: SceneView): void {
    const { ctx, cam } = this;
    const { nodes, cells } = ed.design;
    const hoverPart = v.hoverCell !== undefined && v.hoverCell >= 0 ? cells[v.hoverCell] : null;
    const path = (poly: [number, number][]) => {
      ctx.beginPath();
      poly.forEach(([x, y], i) => (i ? ctx.lineTo(cam.sx(x), cam.sy(y)) : ctx.moveTo(cam.sx(x), cam.sy(y))));
      ctx.closePath();
    };
    for (const c of cells) {
      const poly = c.n.map((i): [number, number] => [nodes[i].x, nodes[i].y]);
      const hot = !!hoverPart && (c === hoverPart || (c.mat === 'arch' && c.part !== undefined && c.part === hoverPart.part));
      path(poly);
      ctx.fillStyle = hot ? 'rgba(255,90,78,0.3)' : MATERIAL_CHALK[c.mat];
      ctx.globalAlpha = hot ? 1 : 0.2;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = hot ? PAL.invalid : MATERIAL_CHALK[c.mat];
      ctx.lineWidth = hot ? 2.5 : 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    const b = v.brush;
    if (b) {
      path(blockPoly(b.x, b.y));
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = b.why ? PAL.invalid : PAL.valid;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      if (b.why) this.label(b.why, cam.sx(b.x + 0.5), cam.sy(b.y + 1) - 14, PAL.invalid);
    }
  }

  /**
   * Marks under the blueprint after a successful test: a pulsing white dashed halo on members
   * that barely carried any load, and a wood-colored one on steel that wood could take over.
   */
  private drawMarks(ed: Editor, marks: NonNullable<SceneView['marks']>, curved: Map<number, Ctl>, time: number): void {
    const { ctx, cam } = this;
    const { nodes, members } = ed.design;
    const pulse = 0.45 + 0.2 * Math.sin(time * 3);
    for (const [list, color] of [
      [marks.idle, '#ffffff'],
      [marks.wood, MATERIAL_CHALK.wood],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = pulse;
      ctx.lineCap = 'round';
      ctx.setLineDash([4, 6]);
      for (const i of list) {
        const m = members[i];
        if (!m) continue;
        const w = Math.max(2.5, MEMBER_WIDTH[m.mat] * cam.scale * 0.8);
        const ctl = curved.get(i);
        ctx.lineWidth = w + 12;
        ctx.beginPath();
        ctx.moveTo(cam.sx(nodes[m.a].x), cam.sy(nodes[m.a].y));
        if (ctl) ctx.bezierCurveTo(ctl[0], ctl[1], ctl[2], ctl[3], cam.sx(nodes[m.b].x), cam.sy(nodes[m.b].y));
        else ctx.lineTo(cam.sx(nodes[m.b].x), cam.sy(nodes[m.b].y));
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  private drawEditor(v: SceneView, ed: Editor): void {
    const { ctx, cam } = this;
    const { nodes, members } = ed.design;
    const curved = this.designCurves(ed.design.members, (n): Pt2 => [cam.sx(nodes[n].x), cam.sy(nodes[n].y)]);

    this.chalkCells(ed, v);
    if (v.marks) this.drawMarks(ed, v.marks, curved, v.time);
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
      this.chalkMember(ax, ay, bx, by, m.mat, i === v.hoverMember ? 'delete' : 'none', p >= 1 ? curved.get(i) : undefined);
    });

    const drag = ed.drag;
    if (drag) {
      const f = { x: drag.sx, y: drag.sy };
      const fx = cam.sx(f.x);
      const fy = cam.sy(f.y);
      const curvedDrag = !!MATERIALS[ed.mat].curved;
      if (!curvedDrag) {
        const maxR = MATERIALS[ed.mat].maxLen * cam.scale;
        ctx.strokeStyle = 'rgba(233,243,255,0.25)';
        ctx.setLineDash([3, 5]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(fx, fy, maxR, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
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
        if (MATERIALS[ed.mat].cell === 'ring' && drag.path.length >= 3) {
          // The ring's wedges, outlined where they would go.
          const intra = drag.path[0][0] <= drag.path[drag.path.length - 1][0] ? drag.path : drag.path.toReversed();
          const ring = { intra, extra: intra.slice(1, -1).map(([x, y]): [number, number] => [x, y + RING]) };
          for (const poly of ringPolys(ring)) {
            poly.forEach(([x, y], i) => (i ? ctx.lineTo(cam.sx(x), cam.sy(y)) : ctx.moveTo(cam.sx(x), cam.sy(y))));
            ctx.closePath();
          }
          ctx.lineWidth = 2;
        } else if (curvedDrag) smoothPath(ctx, drag.path.map(([x, y]): Pt2 => [cam.sx(x), cam.sy(y)]));
        else drag.path.forEach(([x, y], i) => (i ? ctx.lineTo(cam.sx(x), cam.sy(y)) : ctx.moveTo(cam.sx(x), cam.sy(y))));
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
        const span = Math.abs(drag.tx - f.x);
        const what = curvedDrag
          ? `${MATERIALS[ed.mat].name} · ${span.toFixed(1)} m across · ${(MATERIALS[ed.mat].arch ? ringRise(ed.design, [f.x, f.y], [drag.tx, drag.ty]) : defaultSag([f.x, f.y], [drag.tx, drag.ty], ed.mat)).toFixed(1)} m ${MATERIALS[ed.mat].arch ? 'rise' : 'sag'}`
          : segs > 1
            ? `${segs} × ${MATERIALS[ed.mat].name.toLowerCase()} · ${len.toFixed(1)} m`
            : `${len.toFixed(1)} m`;
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

    // Nodes and anchors. A corner only blocks meet at is a small dot: bars may still start there.
    const barred = new Set(members.flatMap((m) => [m.a, m.b]));
    nodes.forEach((n, i) => {
      const x = cam.sx(n.x);
      const y = cam.sy(n.y);
      const hover = i === v.hoverNode || (drag && drag.from === i);
      if (!n.anchor && !barred.has(i) && !hover) {
        ctx.fillStyle = PAL.chalkDim;
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, TAU);
        ctx.fill();
        return;
      }
      if (n.anchor) {
        if (n.block) this.block(n.x, n.y, n.y, 0, true);
        this.bolt(x, y, hover ? 1.25 : 1, v.time, !drag && v.showHint);
        // Paid anchors show their price until they're in use.
        if (n.price && !ed.design.members.some((m) => m.a === i || m.b === i)) this.label(`$${n.price.toLocaleString('en-US')}`, x, y - 16, PAL.gold);
      } else {
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

    if (!drag) this.sagHandles(ed, v.time);

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

  /** Rings the member or joint picked on the stress graph, wherever it ended up. */
  private drawHighlight(run: TestRun, h: NonNullable<SceneView['highlight']>, time: number): void {
    const { ctx, cam } = this;
    const w = run.world;
    const pulse = 0.6 + 0.4 * Math.sin(time * 6);
    ctx.save();
    ctx.lineCap = 'round';
    if (h.member >= 0) {
      const l = w.links.find((k) => k.bridge && k.member === h.member);
      // A broken member is shown dashed where it stood, not stretched between its scattered ends.
      const at = h.ghost ?? (l ? [w.x[l.a], w.y[l.a], w.x[l.b], w.y[l.b]] : null);
      if (at) {
        const ax = cam.sx(at[0]);
        const ay = cam.sy(at[1]);
        const bx = cam.sx(at[2]);
        const by = cam.sy(at[3]);
        ctx.strokeStyle = `rgba(255,204,51,${0.35 * pulse})`;
        ctx.lineWidth = Math.max(14, 0.7 * cam.scale);
        ctx.setLineDash(h.ghost ? [6, 6] : []);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.strokeStyle = PAL.gold;
        ctx.lineWidth = 2;
        ctx.stroke();
        for (const [x, y] of [[ax, ay], [bx, by]]) {
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, TAU);
          ctx.stroke();
        }
      }
    }
    if (h.node >= 0) {
      const r = 10 + 4 * pulse;
      ctx.strokeStyle = PAL.gold;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cam.sx(w.x[h.node]), cam.sy(w.y[h.node]), r, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The level editor's cursor, its channel preview, and a label saying what a tap would do. */
  private drawMakerCursor(m: NonNullable<SceneView['maker']>, level: LevelDef, time: number): void {
    const { ctx, cam } = this;
    const col = m.ok ? PAL.valid : PAL.invalid;
    if (m.channel) {
      const [x0, x1, top] = m.channel;
      ctx.fillStyle = 'rgba(255,90,78,0.12)';
      ctx.strokeStyle = col;
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      const r = [cam.sx(x0), cam.sy(top), cam.sx(x1) - cam.sx(x0), cam.sy(level.waterY) - cam.sy(top)] as const;
      ctx.fillRect(...r);
      ctx.strokeRect(...r);
      ctx.setLineDash([]);
    }
    const x = cam.sx(m.x);
    const y = cam.sy(m.y);
    const s = 9 + Math.sin(time * 6) * 1.5;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, TAU);
    ctx.moveTo(x - s - 6, y);
    ctx.lineTo(x - s + 3, y);
    ctx.moveTo(x + s - 3, y);
    ctx.lineTo(x + s + 6, y);
    ctx.moveTo(x, y - s - 6);
    ctx.lineTo(x, y - s + 3);
    ctx.moveTo(x, y + s - 3);
    ctx.lineTo(x, y + s + 6);
    ctx.stroke();
    this.label(`${m.label} · ${m.x}, ${m.y}`, x, y - s - 16, col);
  }

  /**
   * A damper: thin rods from both ends into a fat oil cylinder in the middle, with a coil spring
   * wound around it. Chalk on the blueprint, painted in the scene.
   */
  private damperShape(ax: number, ay: number, bx: number, by: number, w: number, chalk: boolean): void {
    const { ctx } = this;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    const at = (t: number, off = 0): [number, number] => [ax + (bx - ax) * t - uy * off, ay + (by - ay) * t + ux * off];
    const body = Math.max(6, w * 2);
    const rod = Math.max(2, w * 0.4);
    const col = chalk ? MATERIAL_CHALK.damper : PAL.damper;
    const seg = (t0: number, t1: number, width: number, color: string) => {
      ctx.beginPath();
      ctx.moveTo(...at(t0));
      ctx.lineTo(...at(t1));
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    ctx.save();
    ctx.lineCap = 'butt';
    if (!chalk) seg(0, 1, rod + 2, PAL.steelDark);
    seg(0, 1, rod, chalk ? col : PAL.chrome);
    if (chalk) {
      seg(0.3, 0.7, body, col);
      seg(0.3, 0.7, Math.max(1.5, body - 5), PAL.paper);
    } else {
      seg(0.3, 0.7, body + 2, PAL.damperDark);
      seg(0.3, 0.7, body, PAL.damper);
      ctx.beginPath();
      ctx.moveTo(...at(0.3, body * 0.22));
      ctx.lineTo(...at(0.7, body * 0.22));
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = Math.max(1, body * 0.2);
      ctx.stroke();
    }
    // The spring, a zigzag over the cylinder and a little past it.
    if (len > 24) {
      const turns = Math.max(4, Math.round(len / 9));
      ctx.beginPath();
      for (let i = 0; i <= turns; i++) {
        const t = 0.22 + (0.56 * i) / turns;
        const p = at(t, (i % 2 ? 1 : -1) * body * 0.75);
        if (i) ctx.lineTo(...p);
        else ctx.moveTo(...p);
      }
      ctx.strokeStyle = chalk ? col : PAL.steelDark;
      ctx.lineWidth = Math.max(1.2, w * 0.25);
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * A hydraulic ram: a fat barrel from its lower end, a thin chrome rod the rest of the way,
   * and arrows on the rod showing which way it pushes. Chalk on the blueprint, painted in the scene.
   */
  private ramShape(ax: number, ay: number, bx: number, by: number, w: number, chalk: boolean): void {
    const { ctx } = this;
    // The barrel stands on the lower end (larger screen y), the way a ram is mounted.
    if (ay < by) [ax, ay, bx, by] = [bx, by, ax, ay];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    const split = 0.55;
    const mx = ax + (bx - ax) * split;
    const my = ay + (by - ay) * split;
    const barrel = Math.max(6, w * 1.8);
    const rod = Math.max(2, w * 0.45);
    const col = chalk ? MATERIAL_CHALK.ram : PAL.ram;
    ctx.save();
    ctx.lineCap = 'butt';
    // Rod.
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(bx, by);
    if (!chalk) {
      ctx.strokeStyle = PAL.steelDark;
      ctx.lineWidth = rod + 2;
      ctx.stroke();
    }
    ctx.strokeStyle = chalk ? col : PAL.chrome;
    ctx.lineWidth = rod;
    ctx.stroke();
    // Barrel: filled in the scene, an outline on the blueprint.
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(mx, my);
    if (chalk) {
      ctx.strokeStyle = col;
      ctx.lineWidth = barrel;
      ctx.stroke();
      ctx.strokeStyle = PAL.paper;
      ctx.lineWidth = Math.max(1.5, barrel - 5);
      ctx.stroke();
    } else {
      ctx.strokeStyle = PAL.ramDark;
      ctx.lineWidth = barrel + 2;
      ctx.stroke();
      ctx.strokeStyle = PAL.ram;
      ctx.lineWidth = barrel;
      ctx.stroke();
      // Highlight down the barrel and a collar where the rod comes out.
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = Math.max(1, barrel * 0.22);
      ctx.beginPath();
      ctx.moveTo(ax - uy * barrel * 0.22, ay + ux * barrel * 0.22);
      ctx.lineTo(mx - uy * barrel * 0.22, my + ux * barrel * 0.22);
      ctx.stroke();
    }
    ctx.strokeStyle = chalk ? col : PAL.ramDark;
    ctx.lineWidth = Math.max(2, barrel * 0.3);
    ctx.beginPath();
    ctx.moveTo(mx - uy * barrel * 0.75, my + ux * barrel * 0.75);
    ctx.lineTo(mx + uy * barrel * 0.75, my - ux * barrel * 0.75);
    ctx.stroke();
    // Push arrows along the rod, in chalk only: the blueprint says what it does.
    if (chalk && len > 40) {
      const tx = mx + (bx - mx) * 0.55;
      const ty = my + (by - my) * 0.55;
      const s = Math.max(5, barrel * 0.6);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const d of [-1, 1]) {
        const cx = tx + ux * s * 0.9 * d;
        const cy = ty + uy * s * 0.9 * d;
        ctx.moveTo(cx - uy * s * 0.6 - ux * s * 0.5 * d, cy + ux * s * 0.6 - uy * s * 0.5 * d);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx + uy * s * 0.6 - ux * s * 0.5 * d, cy - ux * s * 0.6 - uy * s * 0.5 * d);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** A small cross-hair marking where a beam will be split. */
  /**
   * Each main cable's sag handle: a ring with arrows up and down on the curve, near mid-span.
   * The one being dragged shows its sag and a guide from the chord, red while it can't be let go there.
   */
  private sagHandles(ed: Editor, time: number): void {
    const { ctx, cam } = this;
    const active = ed.sag;
    for (const h of ed.sagHandles()) {
      const on = active?.part === h.part;
      const x = cam.sx(h.x);
      const y = cam.sy(h.y);
      const col = on && !active!.valid ? PAL.invalid : MATERIAL_CHALK[h.mat];
      if (on) {
        const a = ed.design.nodes[h.chain[0]];
        const b = ed.design.nodes[h.chain[h.chain.length - 1]];
        const chord = a.y + ((b.y - a.y) * (h.x - a.x)) / (b.x - a.x);
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.5;
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cam.sx(a.x), cam.sy(a.y));
        ctx.lineTo(cam.sx(b.x), cam.sy(b.y));
        ctx.moveTo(x, cam.sy(chord));
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        const reason = active!.valid ? '' : ` · ${active!.reason}`;
        const arch = MATERIALS[h.mat].arch;
        this.label(`${arch ? 'Rise' : 'Sag'} ${Math.abs(chord - h.y).toFixed(1)} m${reason}`, x, y + (arch ? -30 : 30), col);
      }
      const r = (on ? 10 : 8) + (on ? 0 : Math.sin(time * 3) * 0.8);
      ctx.fillStyle = 'rgba(16,24,40,0.75)';
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      ctx.stroke();
      // Arrows up and down: it moves only that way.
      ctx.fillStyle = col;
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x, y + dir * r * 0.75);
        ctx.lineTo(x - r * 0.38, y + dir * r * 0.2);
        ctx.lineTo(x + r * 0.38, y + dir * r * 0.2);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /** Control points for the pieces of every main cable in a design, keyed by member index. */
  private designCurves(members: { a: number; b: number; mat: MaterialId; part?: number }[], at: (n: number) => Pt2): Map<number, Ctl> {
    const idx: number[] = [];
    const segs: { a: number; b: number; run: number }[] = [];
    members.forEach((m, i) => {
      if (!MATERIALS[m.mat].curved || m.part === undefined) return;
      idx.push(i);
      segs.push({ a: m.a, b: m.b, run: m.part });
    });
    const out = new Map<number, Ctl>();
    for (const [k, c] of runControls(segs, at)) out.set(idx[k], c);
    return out;
  }

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

  private drawHint(v: SceneView, hint: readonly [GridPt, GridPt, MaterialId][]): void {
    const ed = v.editor;
    if (!ed) return;
    const { ctx, cam } = this;
    const d = ed.design;
    const pulse = 0.25 + 0.15 * Math.sin(v.time * 4);
    let firstTodo = -1;
    hint.forEach(([a, b, mat], i) => {
      if (d.covers(a, b, mat)) return;
      const reachable = d.findNode(a[0], a[1]) >= 0 || d.findNode(b[0], b[1]) >= 0;
      if (firstTodo < 0 && reachable) firstTodo = i;
      ctx.strokeStyle = MATERIAL_CHALK[mat];
      ctx.globalAlpha = pulse;
      ctx.lineWidth = Math.max(2, MEMBER_WIDTH[mat] * cam.scale * 0.8);
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      if (MATERIALS[mat].cell) {
        // A block ghost is the square from its lower left corner to its upper right; an arch ghost its ring.
        const ring = mat === 'arch' ? ringPath(d, a, b, ringRise(d, a, b)) : null;
        const polys = ring ? ringPolys(ring) : [blockPoly(a[0], a[1])];
        ctx.lineWidth = 2;
        for (const poly of polys) {
          poly.forEach(([x, y], k) => (k ? ctx.lineTo(cam.sx(x), cam.sy(y)) : ctx.moveTo(cam.sx(x), cam.sy(y))));
          ctx.closePath();
        }
      } else {
        // A main cable's ghost hangs at the sag it is laid with.
        const pts = (MATERIALS[mat].curved && mainPathIn(d, a, b, defaultSag(a, b, mat))) || [a, b];
        smoothPath(ctx, pts.map(([x, y]): Pt2 => [cam.sx(x), cam.sy(y)]));
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      // A ghost ending partway along another beam: that beam gets split there.
      for (const p of [a, b]) {
        const splits = hint.some(([c, e], j) => j !== i && inside(p, c, e));
        if (splits) this.splitMark(cam.sx(p[0]), cam.sy(p[1]), `rgba(125,255,176,${0.5 + pulse})`);
      }
    });
    if (firstTodo >= 0 && !ed.drag) {
      let [a, b] = hint[firstTodo];
      if (d.findNode(a[0], a[1]) < 0) [a, b] = [b, a];
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
    // Main cables hang as smooth curves through their joints as they move.
    const curved: Link[] = [];
    const segs: { a: number; b: number; run: number }[] = [];
    for (const l of w.links) {
      const part = l.bridge && !l.broken && l.mat && MATERIALS[l.mat].curved ? run.design.members[l.member]?.part : undefined;
      if (part === undefined) continue;
      curved.push(l);
      segs.push({ a: l.a, b: l.b, run: part });
    }
    const ctls = runControls(segs, (p): Pt2 => [cam.sx(w.x[p]), cam.sy(w.y[p])]);
    const ctlOf = new Map(curved.map((l, k) => [l, ctls.get(k)]));
    this.paintCells(run);
    // Cables behind the truss, deck on top of everything. Each layer is painted in batches.
    for (const pass of [0, 1, 2]) {
      const layer: Seg[] = [];
      for (const l of w.links) {
        if (!l.bridge || l.broken || l.cell >= 0 || drawLayer(l) !== pass) continue;
        layer.push(segOf(cam.sx(w.x[l.a]), cam.sy(w.y[l.a]), cam.sx(w.x[l.b]), cam.sy(w.y[l.b]), l.mat!, l.stress, sag(l), ctlOf.get(l)));
      }
      this.paintBatch(layer, time);
    }
    this.guardRails(run);

    // Joints: gusset plates sized by how many members meet there.
    const nodeCount = w.bridgeCount;
    const degree = new Uint8Array(nodeCount);
    for (const l of w.links) {
      if (!l.bridge || l.broken || l.cell >= 0) continue;
      degree[l.a]++;
      degree[l.b]++;
    }
    // A mast's foot is drawn as its hinge, not as a bolt. Gusset plates go in one fill per shade.
    const feet = new Set(w.masts.map((m) => m.base));
    const plates = new Path2D();
    const faces = new Path2D();
    const holes = new Path2D();
    const shines = new Path2D();
    const glows: [number, number, number, number][] = [];
    for (let i = 0; i < nodeCount; i++) {
      if (feet.has(i)) continue;
      const x = cam.sx(w.x[i]);
      const y = cam.sy(w.y[i]);
      if (w.im[i] === 0 && w.y[i] > run.level.waterY - 1) {
        this.bolt(x, y, 1, 0, false);
      } else if (degree[i]) {
        const r = Math.max(3, (0.09 + 0.025 * Math.min(degree[i], 6)) * cam.scale);
        disk(plates, x, y, r);
        disk(faces, x, y, r * 0.78);
        if (r > 5) {
          const bolts = Math.min(degree[i], 5);
          for (let k = 0; k < bolts; k++) {
            const a = (k / bolts) * TAU + 0.4;
            disk(holes, x + Math.cos(a) * r * 0.45, y + Math.sin(a) * r * 0.45, Math.max(0.8, r * 0.12));
          }
        }
        disk(shines, x - r * 0.3, y - r * 0.3, r * 0.22);
        // A joint taking too much at once glows, like an overloaded member.
        const j = w.jointRatio(i);
        if (j > 0.6) glows.push([x, y, r, j]);
      }
    }
    ctx.fillStyle = '#2d3138';
    ctx.fill(plates);
    ctx.fillStyle = '#8d97a3';
    ctx.fill(faces);
    ctx.fillStyle = '#2d3138';
    ctx.fill(holes);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fill(shines);
    for (const [x, y, r, j] of glows) {
      ctx.strokeStyle = stressColor(j, Math.min(1, (j - 0.6) * 2.5));
      ctx.lineWidth = Math.max(2, r * 0.35);
      ctx.beginPath();
      ctx.arc(x, y, r * 1.35, 0, TAU);
      ctx.stroke();
    }
  }

  /**
   * Concrete blocks as they stand: a face shaded by how hard the block works, with a lit top
   * edge, and a dark jagged crack along every side that has given way.
   */
  private paintCells(run: TestRun): void {
    const { ctx, cam } = this;
    const w = run.world;
    if (!w.cells.length) return;
    const at = (p: number): Pt2 => [cam.sx(w.x[p]), cam.sy(w.y[p])];
    for (const [k, c] of w.cells.entries()) {
      const mat = run.design.cells[k]?.mat ?? 'masonry';
      const pts = c.n.map(at);
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = mat === 'arch' ? PAL.arch : PAL.masonry;
      ctx.fill();
      const s = Math.min(1, Math.max(0, ...c.links.map((l) => (l.broken ? 1 : Math.abs(l.stress)))));
      ctx.fillStyle = stressColor(s, 0.12 + 0.45 * s);
      ctx.fill();
      ctx.strokeStyle = mat === 'arch' ? PAL.archDark : PAL.masonryDark;
      ctx.lineWidth = Math.max(1, 0.04 * cam.scale);
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    // Lit tops and cracks over all of them.
    ctx.lineCap = 'round';
    for (const c of w.cells) {
      for (const l of c.links) {
        const [ax, ay] = at(l.a);
        const [bx, by] = at(l.b);
        if (!l.broken) continue;
        ctx.strokeStyle = 'rgba(30,22,14,0.85)';
        ctx.lineWidth = Math.max(1.5, 0.06 * cam.scale);
        ctx.beginPath();
        const n = 5;
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const jig = i % 2 ? 0.05 * cam.scale : -0.05 * cam.scale;
          const nx = -(by - ay);
          const ny = bx - ax;
          const len = Math.hypot(nx, ny) || 1;
          const px = ax + (bx - ax) * t + (i && i < n ? (nx / len) * jig : 0);
          const py = ay + (by - ay) * t + (i && i < n ? (ny / len) * jig : 0);
          if (i) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        }
        ctx.stroke();
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
    // Blocks as dark shapes, then the members as lines.
    ctx.fillStyle = '#3a3830';
    for (const c of w.cells) {
      ctx.beginPath();
      c.n.forEach((p, i) => {
        const y = cam.sy(2 * wy - w.y[p]);
        if (i) ctx.lineTo(cam.sx(w.x[p]) + ripple(y), y);
        else ctx.moveTo(cam.sx(w.x[p]) + ripple(y), y);
      });
      ctx.fill();
    }
    for (const l of w.links) {
      if (!l.bridge || l.broken || l.cell >= 0) continue;
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
      this.memberPaint(cam.sx(d.x - c), cam.sy(d.y - s), cam.sx(d.x + c), cam.sy(d.y + s), d.mat, null, Math.min(1, d.life));
    }
  }

  /**
   * Snapped cables: each half recoils toward its joint with a traveling ripple, then hangs
   * limp and fades.
   */
  private drawWhips(run: TestRun, whips: Whip[]): void {
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

  /**
   * A seat: a bearing cup set into a pier with no bolt, its rim at the point where a deck
   * joint rests. Chalk on the blueprint, steel in the scene.
   */
  private seat(px: number, py: number, chalk: boolean): void {
    const { ctx, cam } = this;
    const x = cam.sx(px);
    const y = cam.sy(py);
    const r = Math.max(5, 0.28 * cam.scale);
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = chalk ? PAL.chalk : PAL.steelDark;
    ctx.fillStyle = chalk ? PAL.paperDeep : PAL.steel;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (chalk) {
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(x, y, r * 0.55, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
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
    for (const { def, x } of convoyLayout(level)) {
      const r = def.wheelR;
      const top = r + def.height * 0.6;
      const mids = (def.midAxles ?? []).map((ax): [number, number] => [x + ax, r]);
      this.vehicle(def, x, r, x + def.wheelbase, r, x, top, x + def.wheelbase, top, mids, [0, 0], true);
    }
  }

  private drawVehicleRun(run: TestRun, angles: [number, number][]): void {
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
