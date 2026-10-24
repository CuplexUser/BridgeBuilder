import type { BlockDef } from '../physics/materials';
import type { Camera } from './camera';
import { font } from './fonts';
import { PAL } from './palette';
import { TAU } from './shapes';
import type { Turn } from './swing';
import type { Theme } from './themes';

/**
 * What every part of the renderer draws with in a frame: the context (which the renderer swaps
 * for an offscreen layer while it paints the bridge at night), the camera, the screen, and the
 * chapter's look. The renderer owns it and keeps it current; the parts only read it.
 */
export interface Stage {
  ctx: CanvasRenderingContext2D;
  readonly cam: Camera;
  /** Screen size, CSS px, and device pixels per CSS px. */
  w: number;
  h: number;
  dpr: number;
  look: Theme;
  /** The concrete anchor size on the level being drawn. */
  blockDef: BlockDef;
  /** A swing bridge turning on its pier while this frame is drawn. */
  turn: Turn | null;
  /** The blueprint's diagonal hatching. */
  hatch: CanvasPattern | null;
  /** The sky, pre-rendered: redrawing big gradients every frame is costly on mobile. */
  readonly skyLayer: HTMLCanvasElement;
  /** Where the sun (or the light behind the clouds) is on screen. */
  sunX: number;
  sunY: number;
}

/** One part of the renderer. It reads the shared stage as if the fields were its own. */
export abstract class ScenePart {
  constructor(protected readonly stage: Stage) {}

  get ctx(): CanvasRenderingContext2D {
    return this.stage.ctx;
  }
  get cam(): Camera {
    return this.stage.cam;
  }
  get w(): number {
    return this.stage.w;
  }
  get h(): number {
    return this.stage.h;
  }
  get dpr(): number {
    return this.stage.dpr;
  }
  get look(): Theme {
    return this.stage.look;
  }
  get blockDef(): BlockDef {
    return this.stage.blockDef;
  }
  get turn(): Turn | null {
    return this.stage.turn;
  }
  get hatch(): CanvasPattern | null {
    return this.stage.hatch;
  }
  get skyLayer(): HTMLCanvasElement {
    return this.stage.skyLayer;
  }
  get sunX(): number {
    return this.stage.sunX;
  }
  get sunY(): number {
    return this.stage.sunY;
  }

  /** A chalk caption on a dark tag, centered on (x, y). */
  protected label(text: string, x: number, y: number, color: string): void {
    const { ctx } = this;
    ctx.font = font(600, 12, 'mono');
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = 'rgba(11,29,56,0.85)';
    ctx.fillRect(x - w / 2, y - 9, w, 18);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 1);
  }

  /** A hex bolt head at a joint, with a ring pulsing out of it when pulse is set. */
  protected bolt(x: number, y: number, scale: number, time: number, pulse: boolean): void {
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
}
