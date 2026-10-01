import type { StressLog } from '../physics/stresslog';
import { PAL, stressColor } from '../render/palette';
import { SAFE_STRESS } from '../scoring';

/** What the graph highlights: a sample (time) and the member or joint picked at it. */
export interface GraphPick {
  sample: number;
  /** Design member index, or -1. */
  member: number;
  /** Joint (node) index, or -1. */
  node: number;
}

const PHASE_TINT: Record<string, string> = {
  opening: 'rgba(255,204,51,0.10)',
  ship: 'rgba(108,198,255,0.12)',
  closing: 'rgba(255,204,51,0.10)',
};
const TOP = 1.1;

/**
 * The stress graph shown after a test drive: the busiest member's load over time, the
 * selected member's own curve, breaks, and the drawbridge phases. Draws into its own canvas.
 */
export class StressGraph {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private pad = { l: 38, r: 10, t: 10, b: 20 };

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** Matches the backing store to the canvas's laid-out size. */
  private fit(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    if (this.canvas.width !== Math.round(this.w * dpr) || this.canvas.height !== Math.round(this.h * dpr)) {
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private span(log: StressLog): [number, number] {
    return [log.t[0] ?? 0, Math.max((log.t[0] ?? 0) + 1, log.t.at(-1) ?? 1)];
  }

  private sx(t: number, log: StressLog): number {
    const [t0, t1] = this.span(log);
    return this.pad.l + ((t - t0) / (t1 - t0)) * (this.w - this.pad.l - this.pad.r);
  }

  private sy(v: number): number {
    return this.pad.t + (1 - Math.min(TOP, v) / TOP) * (this.h - this.pad.t - this.pad.b);
  }

  /** The sample under a pointer's x position, in CSS pixels from the canvas's left edge. */
  sampleAtX(x: number, log: StressLog): number {
    const [t0, t1] = this.span(log);
    const u = (x - this.pad.l) / Math.max(1, this.w - this.pad.l - this.pad.r);
    return log.sampleAt(t0 + Math.max(0, Math.min(1, u)) * (t1 - t0));
  }

  draw(log: StressLog, pick: GraphPick | null): void {
    this.fit();
    const { ctx, w, h, pad } = this;
    ctx.clearRect(0, 0, w, h);
    if (!log.length) return;
    const [t0, t1] = this.span(log);

    // Drawbridge phases as tinted bands.
    log.phases.forEach((p, i) => {
      const tint = PHASE_TINT[p.phase];
      if (!tint) return;
      const end = log.phases[i + 1]?.t ?? t1;
      ctx.fillStyle = tint;
      ctx.fillRect(this.sx(p.t, log), pad.t, this.sx(end, log) - this.sx(p.t, log), h - pad.t - pad.b);
    });

    // Grid: every 25%, with the safety line (the third star) and the breaking point marked.
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      const y = Math.round(this.sy(v)) + 0.5;
      const special = v === SAFE_STRESS ? PAL.gold : v === 1 ? PAL.bolt : null;
      ctx.strokeStyle = special ?? 'rgba(108,198,255,0.15)';
      ctx.setLineDash(special ? [5, 4] : []);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.fillStyle = special ?? 'rgba(233,243,255,0.5)';
      ctx.fillText(`${v * 100}%`, pad.l - 4, y);
    }
    ctx.setLineDash([]);
    // Time ticks.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(233,243,255,0.5)';
    const step = t1 - t0 > 24 ? 5 : t1 - t0 > 10 ? 2 : 1;
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) ctx.fillText(`${t}s`, this.sx(t, log), h - pad.b + 5);

    // The busiest member at each moment, colored by load.
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    for (let i = 1; i < log.length; i++) {
      ctx.strokeStyle = stressColor(log.peak[i]);
      ctx.beginPath();
      ctx.moveTo(this.sx(log.t[i - 1], log), this.sy(log.peak[i - 1]));
      ctx.lineTo(this.sx(log.t[i], log), this.sy(log.peak[i]));
      ctx.stroke();
    }

    // The picked member's own curve, until it broke.
    if (pick && pick.member >= 0) {
      ctx.strokeStyle = PAL.chalk;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      let pen = false;
      log.series(pick.member).forEach((v, i) => {
        if (Number.isNaN(v)) {
          pen = false;
          return;
        }
        const x = this.sx(log.t[i], log);
        const y = this.sy(v);
        if (pen) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        pen = true;
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Breaks: a red tick at the top for each member that snapped.
    ctx.strokeStyle = PAL.bolt;
    ctx.lineWidth = 2;
    for (const b of log.breaks) {
      const x = this.sx(b.t, log);
      ctx.beginPath();
      ctx.moveTo(x - 4, pad.t);
      ctx.lineTo(x + 4, pad.t + 8);
      ctx.moveTo(x + 4, pad.t);
      ctx.lineTo(x - 4, pad.t + 8);
      ctx.stroke();
    }

    // Cursor at the picked moment.
    if (pick && pick.sample >= 0) {
      const x = Math.round(this.sx(log.t[pick.sample], log)) + 0.5;
      ctx.strokeStyle = PAL.chalk;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, h - pad.b);
      ctx.stroke();
      const v = pick.member >= 0 ? log.members[pick.sample][pick.member] : log.peak[pick.sample];
      if (!Number.isNaN(v)) {
        ctx.fillStyle = stressColor(v);
        ctx.beginPath();
        ctx.arc(x, this.sy(v), 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = PAL.paperDeep;
        ctx.stroke();
      }
    }
  }
}
