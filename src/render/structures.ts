import type { LevelDef } from '../levels';
import { LOG_RADIUS, SHIP_HALF, TUNNEL_HEIGHT, type TestRun } from '../physics/world';
import { PAL, stressColor } from './palette';
import type { SceneView } from './renderer';
import { PILE_DEPTH, TAU } from './shapes';
import { ScenePart } from './stage';
import { SWING_ROAD } from './swing';

/** What stands in and around the river: piers, masts, towers, piles, blocks, tunnels, ships and logs. */
export class Structures extends ScenePart {
  /** A ship channel in the blueprint: a hatched keep-clear zone with its clearance height. */
  channelBlueprint(x0: number, x1: number, top: number, waterY: number, mast?: number): void {
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
  channelScene(x0: number, x1: number, top: number, waterY: number, time: number, ship?: { x: number; mast: number; progress: number }): void {
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
  sceneMastsAndBlocks(v: SceneView): void {
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
  block(x: number, top: number, ground: number, util: number, chalk: boolean): void {
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
  mast(bx: number, by: number, tx: number, ty: number, chalk: boolean): void {
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
  tower(x: number, base: number, top: number, chalk: boolean): void {
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

  /** A pile driven through the mud to rock: a steel tube down from its cap, banded where it meets the mud. */
  pile(x: number, top: number, chalk: boolean): void {
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

  /**
   * A seat: a bearing cup set into a pier with no bolt, its rim at the point where a deck
   * joint rests. Chalk on the blueprint, steel in the scene.
   */
  seat(px: number, py: number, chalk: boolean): void {
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

  /** A lift bridge's guide towers: a pair of rails from each seat up past the ship's mast, braced across. */
  liftTowers(L: LevelDef, chalk: boolean): void {
    const { ctx, cam } = this;
    const top = (L.ship?.mast ?? 4) + 2;
    ctx.strokeStyle = chalk ? PAL.chalkDim : '#4a5562';
    ctx.lineWidth = Math.max(1.5, 0.1 * cam.scale);
    for (const x of L.lift ?? []) {
      const [l, r] = [cam.sx(x - 0.5), cam.sx(x + 0.5)];
      ctx.beginPath();
      ctx.moveTo(l, cam.sy(0));
      ctx.lineTo(l, cam.sy(top));
      ctx.moveTo(r, cam.sy(0));
      ctx.lineTo(r, cam.sy(top));
      ctx.lineTo(l, cam.sy(top));
      for (let y = 0; y < top - 0.5; y += 1) {
        ctx.moveTo(l, cam.sy(y));
        ctx.lineTo(r, cam.sy(y + 1));
      }
      ctx.stroke();
    }
  }

  /** A lower deck's tunnels through both banks: a dark bore with a lit floor, and a portal arch at each mouth. */
  tunnels(y: number, W: number, chalk: boolean): void {
    const { ctx, cam } = this;
    const h = TUNNEL_HEIGHT;
    for (const [x0, x1, mouth] of [
      [-80, 0, 0],
      [W, W + 80, W],
    ]) {
      const [l, r, b, t] = [cam.sx(x0), cam.sx(x1), cam.sy(y), cam.sy(y + h)];
      ctx.fillStyle = chalk ? 'rgba(4,12,26,0.85)' : 'rgba(14,12,10,0.88)';
      ctx.fillRect(l, t, r - l, b - t);
      ctx.fillStyle = chalk ? PAL.chalkDim : 'rgba(120,110,95,0.6)';
      ctx.fillRect(l, b - 2, r - l, 2);
      // The portal: a stone arch around the mouth.
      ctx.strokeStyle = chalk ? PAL.chalk : '#8d8577';
      ctx.lineWidth = Math.max(2, 0.18 * cam.scale);
      const mx = cam.sx(mouth);
      ctx.beginPath();
      ctx.moveTo(mx, b);
      ctx.lineTo(mx, t);
      ctx.stroke();
    }
  }

  /**
   * A swing bridge's turntable: a steel drum across the tops of the piers under its pivot,
   * its seams sliding round as the bridge turns.
   */
  turntable(L: LevelDef): void {
    const p = L.swing!.pivot;
    const under = L.piers.filter(([x]) => Math.abs(x - p) < 3);
    if (!under.length) return;
    const { ctx, cam } = this;
    const top = Math.max(...under.map(([, y]) => y));
    const r = Math.hypot(Math.max(...under.map(([x]) => Math.abs(x - p))), SWING_ROAD / 2) + 0.25;
    const x0 = cam.sx(p - r);
    const x1 = cam.sx(p + r);
    const y0 = cam.sy(top);
    const y1 = cam.sy(top - 0.6);
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, PAL.steelDark);
    g.addColorStop(0.35, PAL.steel);
    g.addColorStop(1, PAL.steelDark);
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    // Seams round the drum, each in sight while it faces the eye, thinning as it turns away.
    const angle = this.turn?.angle ?? 0;
    ctx.strokeStyle = PAL.steelDark;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TAU + angle;
      if (Math.sin(a) <= 0.05) continue;
      const x = cam.sx(p + r * Math.cos(a));
      ctx.lineWidth = Math.max(1, 0.08 * cam.scale * Math.sin(a));
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();
    }
    // A lit rim on top, and the shadow under it.
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(x0, y0, x1 - x0, Math.max(1.5, 0.06 * cam.scale));
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x0, y1, x1 - x0, Math.max(2, 0.12 * cam.scale));
  }

  /** Driftwood a flood carries down the river: logs riding low in the water, bobbing. */
  drawLogs(run: TestRun, time: number): void {
    const { ctx, cam } = this;
    const w = run.world;
    const r = LOG_RADIUS * cam.scale;
    const half = 1.2 * cam.scale;
    for (const [k, log] of w.logs.entries()) {
      if (!log.afloat || w.x[log.p] > w.banks.width + 2) continue;
      const x = cam.sx(w.x[log.p]);
      const y = cam.sy(w.y[log.p]) + Math.sin(time * 2.3 + k) * 0.06 * cam.scale;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(time * 1.7 + k * 2) * 0.05);
      ctx.fillStyle = '#5e4128';
      ctx.beginPath();
      ctx.roundRect(-half, -r, 2 * half, 2 * r, r);
      ctx.fill();
      ctx.strokeStyle = '#3c2a1a';
      ctx.lineWidth = Math.max(1, 0.04 * cam.scale);
      ctx.stroke();
      // Its cut ends, and the bark's grain along it.
      ctx.fillStyle = '#a8805a';
      for (const sx of [-half + r * 0.6, half - r * 0.6]) {
        ctx.beginPath();
        ctx.ellipse(sx, 0, r * 0.45, r * 0.85, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(-half * 0.6, -r * 0.35);
      ctx.lineTo(half * 0.5, -r * 0.35);
      ctx.moveTo(-half * 0.3, r * 0.25);
      ctx.lineTo(half * 0.6, r * 0.25);
      ctx.stroke();
      ctx.restore();
    }
  }
}
