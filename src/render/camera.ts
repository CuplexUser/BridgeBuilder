export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** World (meters, y up) ↔ screen (CSS px, y down) with smooth easing toward a target. */
export class Camera {
  cx = 0;
  cy = 0;
  scale = 30;
  tcx = 0;
  tcy = 0;
  tscale = 30;
  viewW = 800;
  viewH = 600;
  /** Screen-space offset added by shake. */
  ox = 0;
  oy = 0;

  resize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
  }

  /** Frames a world-space box inside a screen-space rect. */
  fit(minX: number, maxX: number, minY: number, maxY: number, view: Rect, snap = false): void {
    const s = Math.min(view.w / (maxX - minX), view.h / (maxY - minY));
    this.tscale = Math.max(4, s);
    // Center the box inside the view rect, then convert back to a world center for the full canvas.
    const vcx = view.x + view.w / 2;
    const vcy = view.y + view.h / 2;
    this.tcx = (minX + maxX) / 2 - (vcx - this.viewW / 2) / this.tscale;
    this.tcy = (minY + maxY) / 2 + (vcy - this.viewH / 2) / this.tscale;
    if (snap) this.snap();
  }

  snap(): void {
    this.cx = this.tcx;
    this.cy = this.tcy;
    this.scale = this.tscale;
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 8);
    this.cx += (this.tcx - this.cx) * k;
    this.cy += (this.tcy - this.cy) * k;
    this.scale += (this.tscale - this.scale) * k;
  }

  sx(wx: number): number {
    return (wx - this.cx) * this.scale + this.viewW / 2 + this.ox;
  }

  sy(wy: number): number {
    return -(wy - this.cy) * this.scale + this.viewH / 2 + this.oy;
  }

  wx(sx: number): number {
    return (sx - this.viewW / 2 - this.ox) / this.scale + this.cx;
  }

  wy(sy: number): number {
    return -(sy - this.viewH / 2 - this.oy) / this.scale + this.cy;
  }

  /** Zooms around a screen point, keeping that point fixed. Applies immediately. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const wx = this.wx(sx);
    const wy = this.wy(sy);
    this.scale = this.tscale = Math.max(6, Math.min(160, this.tscale * factor));
    this.cx = this.tcx = wx - (sx - this.viewW / 2 - this.ox) / this.scale;
    this.cy = this.tcy = wy + (sy - this.viewH / 2 - this.oy) / this.scale;
  }

  pan(dxPx: number, dyPx: number): void {
    this.cx = this.tcx -= dxPx / this.scale;
    this.cy = this.tcy += dyPx / this.scale;
  }
}
