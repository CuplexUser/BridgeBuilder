import type { DebrisField, Particles } from '../fx/particles';
import { motion } from '../motion';
import { BLOCK, blockOf } from '../physics/materials';
import { Blueprint } from './blueprint';
import type { Camera } from './camera';
import { Effects } from './effects';
import { Members } from './members';
import { PAL } from './palette';
import { Scenery } from './scenery';
import { hash, TAU } from './shapes';
import { ScenePart } from './stage';
import { Structures } from './structures';
import { turnOf, turnPoint } from './swing';
import { THEMES, type Theme } from './themes';
import { Traffic } from './traffic';
import type { AttachPick, Editor } from '../editor';
import type { GridPt } from '../design';
import type { LevelDef } from '../levels';
import type { MaterialId } from '../physics/materials';
import type { TestRun } from '../physics/testrun';

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
  /**
   * A member or joint picked on the stress graph, ringed on the bridge, and where the members that
   * had broken by then stood. The run is drawn as it was at that moment.
   */
  highlight?: { member: number; node: number; ghost?: [number, number, number, number] | null; broken?: [number, number, number, number][] } | null;
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

/**
 * Draws a frame: the blueprint or the painted scene, the bridge, its traffic and effects. Each
 * area is its own part (scenery.ts, structures.ts, members.ts, blueprint.ts, traffic.ts,
 * effects.ts), all drawing on one shared stage that this class keeps current.
 */
export class Renderer extends ScenePart {
  private readonly structures: Structures;
  private readonly members: Members;
  private readonly scenery: Scenery;
  private readonly blueprint: Blueprint;
  private readonly traffic: Traffic;
  private readonly effects: Effects;
  private vignetteLayer: HTMLCanvasElement = document.createElement('canvas');
  /** At night the bridge and vehicle are drawn here first, then shaded down as one layer. */
  private shadeLayer: HTMLCanvasElement = document.createElement('canvas');
  private shadeCtx: CanvasRenderingContext2D | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    cam: Camera,
    particles: Particles,
    private debris: DebrisField,
  ) {
    super({
      ctx: canvas.getContext('2d', { alpha: false })!,
      cam,
      w: 0,
      h: 0,
      dpr: 1,
      look: THEMES[0],
      blockDef: BLOCK,
      turn: null,
      hatch: null,
      skyLayer: document.createElement('canvas'),
      sunX: 0,
      sunY: 0,
    });
    this.structures = new Structures(this.stage);
    this.members = new Members(this.stage);
    this.scenery = new Scenery(this.stage, this.structures);
    this.blueprint = new Blueprint(this.stage, this.structures, this.members);
    this.traffic = new Traffic(this.stage, particles);
    this.effects = new Effects(this.stage, this.members, particles);
  }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.stage.w = window.innerWidth;
    this.stage.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cam.resize(this.w, this.h);
    this.stage.dpr = dpr;
    this.buildLayers(dpr);
  }

  get theme(): Theme {
    return this.look;
  }

  /** Switches the painted scene's look; the cached sky is redrawn to match. */
  setTheme(t: Theme): void {
    if (t === this.look) return;
    this.stage.look = t;
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
    this.stage.sunX = w * (T.sun?.x ?? 0.6);
    this.stage.sunY = h * (T.sun?.y ?? 0.3);
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
    this.stage.hatch = this.ctx.createPattern(tile, 'repeat');
  }

  draw(v: SceneView): void {
    // A swing bridge turning out of the picture is drawn in perspective, then put back as the
    // physics has it. Everything but the bridge itself (its reflection, a highlight) sees its near truss.
    const t = turnOf(v.level, v.run);
    if (!t) return this.drawView(v);
    const w = v.run!.world;
    for (let p = 0; p < t.xs.length; p++) [w.x[p], w.y[p]] = turnPoint(t, t.xs[p], t.ys[p], 1);
    this.stage.turn = t;
    try {
      this.drawView(v);
    } finally {
      this.stage.turn = null;
      w.x.set(t.xs);
      w.y.set(t.ys);
    }
  }

  private drawView(v: SceneView): void {
    this.stage.blockDef = blockOf(v.level);
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = PAL.paperDeep;
    ctx.fillRect(0, 0, this.w, this.h);

    // Background: blueprint, then the painted scene wiped in from the left (faded in, with less motion).
    const wipe = v.develop < 1 && !motion.reduced;
    if (v.develop < 1) this.blueprint.drawBlueprint(v);
    if (v.develop > 0) {
      ctx.save();
      if (v.develop < 1 && !wipe) ctx.globalAlpha = v.develop;
      if (wipe) {
        const edge = this.w * 1.3 * v.develop - this.h * 0.3;
        ctx.beginPath();
        ctx.moveTo(-10, -10);
        ctx.lineTo(edge + this.h * 0.3, -10);
        ctx.lineTo(edge, this.h + 10);
        ctx.lineTo(-10, this.h + 10);
        ctx.closePath();
        ctx.clip();
      }
      this.scenery.drawScene(v);
      ctx.restore();
      if (wipe) {
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
      if (v.develop > 0) this.scenery.drawReflection(v.run, v);
      // At night the bridge, debris and vehicle go on their own layer, shaded down together.
      const shade = this.look.night && v.develop > 0 ? this.shadeCtx : null;
      if (shade) {
        shade.save();
        shade.setTransform(1, 0, 0, 1, 0, 0);
        shade.clearRect(0, 0, this.shadeLayer.width, this.shadeLayer.height);
        shade.restore();
        this.stage.ctx = shade;
      }
      if (this.turn) this.members.drawTurning(v.run, v.time, this.turn);
      else this.members.drawRunMembers(v.run, v.time);
      // Over the stress graph the bridge stands as it was at the picked moment: no wreckage yet.
      if (!v.highlight) this.effects.drawDebris(this.debris.items);
      this.traffic.drawVehicleRun(v.run, v.wheelAngles);
      if (shade) {
        this.stage.ctx = ctx;
        shade.globalCompositeOperation = 'source-atop';
        shade.fillStyle = `rgba(6,12,38,${0.5 * v.develop})`;
        shade.fillRect(0, 0, this.w, this.h);
        shade.globalCompositeOperation = 'source-over';
        ctx.drawImage(this.shadeLayer, 0, 0, this.w, this.h);
        for (const handle of v.run.vehicles) this.traffic.drawLights(v.run, handle, v.develop);
      }
      // Snapping cables stay bright even at night: the eye should catch them.
      if (!v.highlight) this.effects.drawWhips(v.run, this.debris.whips);
      this.structures.drawLogs(v.run, v.time);
      this.scenery.drawWaterFront(v);
      if (v.highlight) this.blueprint.drawHighlight(v.run, v.highlight, v.time);
    } else if (v.editor) {
      this.traffic.drawVehicleParked(v.level);
      if (v.showHint && v.level.hint) this.blueprint.drawHint(v, v.level.hint);
      if (v.reviewHint?.length) this.blueprint.drawHint(v, v.reviewHint);
      this.blueprint.drawEditor(v, v.editor);
      if (v.maker) this.blueprint.drawMakerCursor(v.maker, v.level, v.time);
    }

    this.effects.drawParticles();
    if (v.develop > 0) this.scenery.drawWeather(v);
    if (v.level.wind) this.scenery.drawWind(v, v.level.wind);
    this.effects.drawFloats(v.floats);

    if (v.develop > 0) {
      ctx.globalAlpha = v.develop;
      ctx.drawImage(this.vignetteLayer, 0, 0, this.w, this.h);
      ctx.globalAlpha = 1;
    }
    if (v.flash > 0 && !motion.reduced) {
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
}
