import { bankY, goalX, seatPiers, type Overhang } from '../levels';
import { windGust, type Wind } from '../physics/hazards';
import type { TestRun } from '../physics/testrun';
import { PAL } from './palette';
import type { SceneView } from './renderer';
import { footings, hash, MEMBER_WIDTH, mudPoly, overhangPoly, rockPoly, TAU } from './shapes';
import { ScenePart, type Stage } from './stage';
import type { Structures } from './structures';
import type { Land } from './themes';
import { shade as tint } from './vehicles';

/** Profile of one land layer. */
type Ridge = 'round' | 'peaks' | 'mesa' | 'dunes' | 'city' | 'cone';

/** Per land type: the shapes of the far, middle and near layers, and how tall each is. */
const LAND_LAYERS: Record<Land, [Ridge, Ridge, Ridge, number, number, number]> = {
  hills: ['peaks', 'round', 'round', 1, 1, 1],
  mesa: ['mesa', 'mesa', 'round', 1.1, 0.9, 0.55],
  flat: ['round', 'round', 'round', 0.45, 0.35, 0.3],
  dunes: ['round', 'round', 'dunes', 0.7, 0.5, 0.8],
  peaks: ['peaks', 'peaks', 'round', 1.7, 1.25, 0.9],
  city: ['city', 'city', 'city', 1.3, 1, 0.55],
  volcano: ['cone', 'peaks', 'round', 1.9, 1, 0.55],
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
    case 'cone': {
      // Volcanic cones out of a low ridge, one where (u × 2.1 + seed) passes 3.5 beyond a
      // multiple of 7, each with a crater dipping into its top.
      const d = Math.abs(((((u * 2.1 + seed) % 7) + 7) % 7) - 3.5);
      const cone = d < 0.25 ? 1.45 + 0.3 * d : 1.75 - 0.9 * d;
      return Math.max(0.35 + 0.18 * Math.sin(u * 1.7 + seed), cone);
    }
    default:
      return round;
  }
}

/** The layers every willow on a bank adds to, each painted once, back to front in this order. */
interface WillowLayers {
  /** The dark inside of the crown. */
  shade: Path2D;
  /** Trunk and limbs, seen through gaps in the fronds. */
  wood: Path2D;
  /** Crown clumps and hanging fronds. */
  leaves: Path2D;
  /** Light catching the crown's clumps on their upper left edge, painted just behind them. */
  lit: Path2D;
}

/** A cubic curve: start, two control points and end, as x, y pairs. */
type Cubic = [number, number, number, number, number, number, number, number];

/** The unit normal on the right of travel along (dx, dy), on screen. */
function rightNormal(dx: number, dy: number): [number, number] {
  const l = Math.hypot(dx, dy) || 1;
  return [dy / l, -dx / l];
}

/**
 * A tapered ribbon along a cubic curve, w0 wide at the start and w1 at the end. It always winds
 * clockwise on screen, like Path2D.ellipse, so overlapping shapes in one path fill as a union.
 */
function ribbon(p: Path2D, [x0, y0, ax, ay, bx, by, x1, y1]: Cubic, w0: number, w1: number): void {
  const n0 = rightNormal(ax - x0, ay - y0);
  const na = rightNormal(bx - x0, by - y0);
  const nb = rightNormal(x1 - ax, y1 - ay);
  const n1 = rightNormal(x1 - bx, y1 - by);
  const wa = (w0 * 0.75 + w1 * 0.25) / 2;
  const wb = (w0 * 0.35 + w1 * 0.65) / 2;
  p.moveTo(x0 + (n0[0] * w0) / 2, y0 + (n0[1] * w0) / 2);
  p.bezierCurveTo(ax + na[0] * wa, ay + na[1] * wa, bx + nb[0] * wb, by + nb[1] * wb, x1 + (n1[0] * w1) / 2, y1 + (n1[1] * w1) / 2);
  p.lineTo(x1 - (n1[0] * w1) / 2, y1 - (n1[1] * w1) / 2);
  p.bezierCurveTo(bx - nb[0] * wb, by - nb[1] * wb, ax - na[0] * wa, ay - na[1] * wa, x0 - (n0[0] * w0) / 2, y0 - (n0[1] * w0) / 2);
  p.closePath();
}

/**
 * A weeping willow rooted at (sx, sy), s pixels to the meter: a trunk that forks into arching
 * limbs, a lumpy crown, and fronds that arch out of it and hang almost to the ground, swaying a
 * little. Light comes from the upper left.
 */
function willow(L: WillowLayers, sx: number, sy: number, h: number, r: number, s: number, seed: number, time: number): void {
  const H = (2.4 + h * 0.6) * s;
  const W = (0.9 + h * 0.2) * (0.85 + r * 0.3) * s;
  const cx = sx + (r - 0.5) * 0.6 * s;
  const top = sy - H;
  /** The crown's outline, in screen y, across u = -1 (left edge) to 1 (right edge). */
  const dome = (u: number): number => top + (1 - Math.sqrt(Math.max(0, 1 - u * u))) * W * 0.55 + 0.08 * W;
  const rnd = (k: number): number => hash(seed * 37 + k);

  // The shaded inside: a mass behind the crown and the top of the curtain. It stops well above
  // the ground, so the fringe below is loose fronds with the background between them.
  const inner = W * 0.82;
  const shadeHem = sy - 1.15 * s;
  L.shade.moveTo(cx - inner, dome(-0.82));
  for (let k = -8; k <= 8; k++) L.shade.lineTo(cx + (k / 10) * W, dome(k / 10));
  L.shade.lineTo(cx + inner, dome(0.82));
  L.shade.quadraticCurveTo(cx + inner * 1.12, (top + shadeHem) / 2, cx + inner * 1.05, shadeHem);
  for (let k = 0; k < 5; k++) {
    const xa = cx + inner * 1.05 - (k / 5) * inner * 2.1;
    const xb = cx + inner * 1.05 - ((k + 1) / 5) * inner * 2.1;
    L.shade.quadraticCurveTo((xa + xb) / 2, shadeHem + (0.15 + 0.2 * rnd(k)) * s, xb, shadeHem);
  }
  L.shade.quadraticCurveTo(cx - inner * 1.12, (top + shadeHem) / 2, cx - inner, dome(-0.82));
  L.shade.closePath();

  // Trunk with a flared foot, forking into limbs that arch up and out under the crown.
  const forkY = sy - H * 0.42;
  L.wood.moveTo(sx - 0.26 * s, sy);
  L.wood.quadraticCurveTo(sx - 0.13 * s, sy - 0.1 * s, sx - 0.14 * s, sy - 0.35 * s);
  L.wood.lineTo(cx - 0.1 * s, forkY);
  L.wood.lineTo(cx + 0.1 * s, forkY);
  L.wood.lineTo(sx + 0.14 * s, sy - 0.35 * s);
  L.wood.quadraticCurveTo(sx + 0.13 * s, sy - 0.1 * s, sx + 0.26 * s, sy);
  L.wood.closePath();
  for (const [k, u0] of [-0.75, -0.25, 0.3, 0.8].entries()) {
    const u = u0 + (rnd(k + 10) - 0.5) * 0.2;
    const tx = cx + u * W * 0.75;
    const ty = dome(u * 0.75) + 0.15 * s;
    ribbon(L.wood, [cx + u * 0.08 * s, forkY + 0.05 * s, cx + u * W * 0.15, forkY - H * 0.22, tx - u * W * 0.2, ty + 0.15 * s, tx, ty], 0.13 * s, 0.04 * s);
  }

  /** A frond arching out of the crown at u and hanging down to y1, w wide at the top. */
  const frond = (p: Path2D, u: number, y1: number, w: number, flare: number): void => {
    const x0 = cx + u * W * 0.9;
    const y0 = dome(u) + 0.12 * s;
    const sway = Math.sin(time * 0.9 + seed * 1.7 + u * 1.3) * 0.12 * s * (0.5 + 0.5 * Math.abs(u));
    const x1 = x0 + u * W * flare + sway;
    ribbon(p, [x0, y0, x0 + u * W * 0.35, y0 - 0.3 * s, x1 - sway * 0.5, y0 + (y1 - y0) * 0.4, x1, y1], w, 0.03 * s);
  };

  // Back fronds, in shadow, hanging between the front ones.
  const n = 10 + Math.round((W / s) * 6);
  for (let k = 0; k < n; k++) {
    const u = -1 + (2 * k + 1.5) / (n + 0.5) + (rnd(k + 80) - 0.5) * 0.1;
    if (Math.abs(u) > 0.97) continue;
    frond(L.shade, u, sy - (0.3 + 0.8 * rnd(k + 90) + (1 - Math.abs(u)) * 0.6) * s, (0.16 + 0.1 * rnd(k + 95)) * s, 0.25);
  }

  // Front fronds. The outer ones flare out and reach lowest; the inner ones stop higher, so the
  // trunk shows at the foot.
  for (let k = 0; k < n; k++) {
    const u = -1 + (2 * (k + 0.5)) / n + (rnd(k + 40) - 0.5) * 0.12;
    const out = Math.abs(u);
    const y1 = sy - (0.15 + 0.9 * rnd(k + 50) + (1 - out) * 0.9) * s;
    frond(L.leaves, u, y1, (0.18 + 0.14 * rnd(k + 60)) * s, 0.3 + 0.1 * rnd(k + 65));
  }

  // Crown: two rows of leafy clumps, so the top is lumpy rather than one smooth dome, lit softly
  // from the upper left.
  for (let k = 0; k < 12; k++) {
    const row = k < 7 ? 0 : 1;
    const u = row === 0 ? -0.9 + (k / 6) * 1.8 : -0.75 + ((k - 7) / 4) * 1.5;
    const ex = cx + u * W * (0.85 - row * 0.1) + (rnd(k + 25) - 0.5) * 0.2 * s;
    const ey = dome(u) + (0.12 + row * 0.45) * s;
    const rx = W * (0.18 + 0.1 * rnd(k + 20));
    const ry = (0.22 + 0.1 * rnd(k + 30)) * s;
    L.leaves.moveTo(ex + rx, ey);
    L.leaves.ellipse(ex, ey, rx, ry, 0, 0, TAU);
    // The same clump, nudged up and left behind this one, shows as a lit rim.
    if (row === 0 && u < 0.6) {
      const lx = ex - 0.09 * s;
      const ly = ey - 0.08 * s;
      L.lit.moveTo(lx + rx, ly);
      L.lit.ellipse(lx, ly, rx, ry, 0, 0, TAU);
    }
  }
}

/** The painted backdrop behind the bridge: sky, land, banks, flora, weather and the water in front. */
export class Scenery extends ScenePart {
  constructor(stage: Stage, private structures: Structures) {
    super(stage);
  }

  drawScene(v: SceneView): void {
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
    this.flora(-2.5, -45, 0, 1, v.time);
    this.flora(goalX(L) + 2, W + 45, rY, 2, v.time);
    if (T.tufts) {
      this.tufts(-40, -0.3, 0);
      this.tufts(W + 0.3, W + 40, rY);
    }

    if (L.lower) this.structures.tunnels(L.lower.y, W, false);
    if (L.lift?.length) this.structures.liftTowers(L, false);
    for (const o of L.overhangs ?? []) this.overhang(o, W);
    for (const [x0, x1, top] of L.rocks ?? []) this.bank(rockPoly(x0, x1, top, deep));
    for (const [x0, x1, top] of L.mud ?? []) this.mud(x0, x1, top, deep);
    for (const n of v.run?.design.nodes ?? v.editor?.design.nodes ?? []) if (n.pile) this.structures.pile(n.x, n.y, false);

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
    for (const [px, py] of seatPiers(L)) this.structures.seat(px, py, false);
    if (L.swing) this.structures.turntable(L);

    for (const t of L.towers ?? []) this.structures.tower(t[0], t[1], t[2], false);
    this.structures.sceneMastsAndBlocks(v);
    (L.channels ?? []).forEach(([x0, x1, top], i) => {
      // On a drawbridge level the first channel's boat is the tall ship, waiting or under way.
      const ship = i === 0 && L.ship ? { x: (x0 + x1) / 2, mast: L.ship.mast, progress: v.run ? v.run.shipProgress : -1 } : undefined;
      this.structures.channelScene(x0, x1, top, L.waterY, v.time, ship);
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
    if (shape === 'cone' && this.look.lava) this.lava(base, off, amp, freq, seed, this.look.lava);
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

  /** Lava (`rgb`, as "r,g,b") glowing in each cone's crater and running in seams down its flanks. */
  private lava(base: number, off: number, amp: number, freq: number, seed: number, rgb: string): void {
    const { ctx } = this;
    const surface = (x: number) => base - amp * ridge('cone', (x + off) * freq, seed);
    // The cones' tops, n of them in from the left: where (u × 2.1 + seed) is 7n + 3.5.
    const apex = (n: number) => (7 * n + 3.5 - seed) / 2.1 / freq - off;
    const first = Math.floor((off * freq * 2.1 + seed - 3.5) / 7) - 1;
    // The crater's rim, this far either side of the top: see ridge's cone.
    const rim = 0.25 / 2.1 / freq;
    const seams = new Path2D();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let n = first; apex(n) < this.w + 300; n++) {
      const ax = apex(n);
      if (ax < -300) continue;
      const top = surface(ax);
      const reach = 0.3 * amp;
      const glow = ctx.createRadialGradient(ax, top, 0, ax, top, reach);
      glow.addColorStop(0, `rgba(${rgb},0.5)`);
      glow.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(ax - reach, top - reach, 2 * reach, 2 * reach);
      // Three seams from the crater rim, each wandering down a flank for its own distance.
      for (let k = 0; k < 3; k++) {
        const r = hash(n * 31.7 + k * 5.3 + seed);
        const side = k === 1 ? -1 : 1;
        const len = (0.25 + 0.35 * r) * amp;
        const x0 = ax + side * (rim + k * 5);
        seams.moveTo(x0, surface(x0) + 2);
        for (let t = 6; t < len; t += 6) {
          const x = x0 + side * t;
          seams.lineTo(x + Math.sin(t * 0.21 + r * 9) * 3, surface(x) + 3 + t * 0.12);
        }
      }
    }
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(${rgb},0.28)`;
    ctx.lineWidth = 6;
    ctx.stroke(seams);
    ctx.strokeStyle = 'rgba(255,196,120,0.8)';
    ctx.lineWidth = 1.6;
    ctx.stroke(seams);
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
  private flora(x0: number, x1: number, y: number, seed: number, time: number): void {
    const { ctx, cam } = this;
    const T = this.look;
    const dir = Math.sign(x1 - x0);
    const s = cam.scale;
    const sy = cam.sy(y);
    const path = new Path2D();
    const snow = new Path2D();
    const willows: WillowLayers = { shade: new Path2D(), wood: new Path2D(), leaves: new Path2D(), lit: new Path2D() };
    const glows: [number, number][] = [];
    const plumes: [number, number, number][] = [];
    for (let i = 0, x = x0; (x1 - x) * dir > 0 && i < 40; i++) {
      const r = hash(seed * 100 + i);
      const h = 1.8 + r * 2.6;
      const sx = cam.sx(x);
      const gap = T.flora === 'lamps' ? 5 : T.flora === 'vents' ? 3.5 + r * 3 : T.flora === 'cactus' ? 2.4 + hash(seed * 50 + i) * 4 : 1.4 + hash(seed * 50 + i) * 2.6;
      x += dir * gap;
      const margin = 80 + 2.5 * s;
      if (sx < -margin || sx > this.w + margin) continue;
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
        case 'willow':
          willow(willows, sx, sy, h, r, s, seed * 100 + i, time);
          break;
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
        case 'vents':
          // The power plant's steam pipe on its posts, and now and then a wellhead with a plume.
          path.rect(sx - 0.06 * s, sy - 1.05 * s, 0.12 * s, 1.05 * s);
          if (r < 0.45) {
            path.rect(sx - 0.4 * s, sy - 0.75 * s, 0.8 * s, 0.75 * s);
            path.rect(sx - 0.12 * s, sy - 1.6 * s, 0.24 * s, 0.85 * s);
            plumes.push([sx, sy - 1.6 * s, r]);
          }
          break;
      }
    }
    if (T.flora === 'vents') {
      // The pipe itself, along the whole bank on screen.
      const a = Math.max(-10, cam.sx(Math.min(x0, x1)));
      const b = Math.min(this.w + 10, cam.sx(Math.max(x0, x1)));
      if (b > a) path.rect(a, sy - 1.2 * s, b - a, 0.24 * s);
    }
    ctx.fillStyle = T.tree;
    ctx.fill(path);
    if (T.flora === 'willow') {
      for (const [layer, f] of [
        [willows.shade, -0.3],
        [willows.wood, -0.5],
        [willows.lit, 0.14],
        [willows.leaves, 0],
      ] as const) {
        ctx.fillStyle = f ? tint(T.tree, f) : T.tree;
        ctx.fill(layer);
      }
    }
    if (T.snowCaps) {
      ctx.fillStyle = 'rgba(245,250,255,0.9)';
      ctx.fill(snow);
    }
    if (plumes.length) this.plumes(plumes, s, time);
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

  /** Steam rising from wellheads at screen points [x, y, seed]: puffs that swell, drift and thin out as they climb. */
  private plumes(at: [number, number, number][], s: number, time: number): void {
    const { ctx } = this;
    for (const [x, y, r] of at) {
      for (let k = 0; k < 6; k++) {
        const p = (time * (0.18 + r * 0.1) + k / 6 + r) % 1;
        ctx.fillStyle = `rgba(232,232,238,${(0.32 * (1 - p)).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x + (p * 1.6 + Math.sin(time * 0.7 + k + r * 7) * 0.25) * s, y - p * 5 * s, (0.3 + p * 1.3) * s, 0, TAU);
        ctx.fill();
      }
    }
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
  drawWind(v: SceneView, wind: Wind): void {
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
  drawWeather(v: SceneView): void {
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
    } else if (kind === 'ash') {
      // Ash drifting slowly down, and embers carried up from the vents, flickering.
      ctx.fillStyle = 'rgba(70,64,70,0.55)';
      ctx.beginPath();
      for (let i = 0; i < 90; i++) {
        const depth = 0.4 + hash(i + 4500) * 0.9;
        const y = ((hash(i + 4600) * H + t * 22 * depth) % H) - 30;
        const x = ((((hash(i + 4700) * W - t * 16 * depth - pan * 0.35 * depth + Math.sin(t * 0.6 + i) * 14) % W) + W) % W) - 60;
        const r = 0.8 + depth * 1.2;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TAU);
      }
      ctx.fill();
      ctx.fillStyle = 'rgba(255,150,70,0.85)';
      ctx.beginPath();
      for (let i = 0; i < 14; i++) {
        const depth = 0.5 + hash(i + 4800);
        const y = H - ((hash(i + 4900) * H + t * 30 * depth) % H) - 30;
        const x = ((((hash(i + 5000) * W + Math.sin(t * 1.3 + i * 2) * 20 - pan * 0.35 * depth) % W) + W) % W) - 60;
        const r = 0.6 + depth * 0.7 * (0.6 + 0.4 * Math.sin(t * 9 + i));
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TAU);
      }
      ctx.fill();
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

  drawWaterFront(v: SceneView): void {
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

  /** Mirror image of the bridge on the river, rippled and faint. */
  drawReflection(run: TestRun, v: SceneView): void {
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
}
