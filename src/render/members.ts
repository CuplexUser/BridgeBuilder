import { MATERIALS, type MaterialId } from '../physics/materials';
import type { TestRun } from '../physics/testrun';
import type { Face, Link, World } from '../physics/world';
import { SAFE_STRESS } from '../scoring';
import { MATERIAL_CHALK, PAL, stressColor, stressLook } from './palette';
import { curveControls, hash, insetPoly, LIGHT, MEMBER_WIDTH, runControls, TAU, type Ctl, type Pt2 } from './shapes';
import { ScenePart } from './stage';
import { archStyle, bilerp, cellLooks, quadOf, type CellLook } from './stone';
import { SWING_SLICES, turnPoint, type Turn } from './swing';

/** Paint order for a bridge link: cables, then truss, then deck. */
function drawLayer(l: Link): number {
  return l.tensionOnly ? 0 : l.drivable ? 2 : 1;
}

/**
 * One member to paint in a batch, in screen space, with a unit normal for details off its line:
 * up the screen for a deck, so its lane and slab edges sit right, and toward the light for
 * anything else, so every member is lit on the same side however steep.
 */
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
  /** A damper's built length, px, and how fast its ends move apart, m/s (negative together). */
  rest?: number;
  motion?: number;
}

function segOf(ax: number, ay: number, bx: number, by: number, mat: MaterialId, stress: number, sag: number, ctl?: Ctl, rest?: number, motion?: number): Seg {
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let nx = (by - ay) / len;
  let ny = -(bx - ax) / len;
  if (MATERIALS[mat].drivable ? ny > 0 : nx * LIGHT[0] + ny * LIGHT[1] < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { ax, ay, bx, by, nx, ny, mat, stress, sag, ctl, rest, motion };
}

/** Adds a full circle to a path as its own subpath. */
function disk(p: Path2D, x: number, y: number, r: number): void {
  p.moveTo(x + r, y);
  p.arc(x, y, r, 0, TAU);
}

/** How fast a link's ends move apart, m/s; negative as they close. */
function stretchRate(w: World, l: Link): number {
  const dx = w.x[l.b] - w.x[l.a];
  const dy = w.y[l.b] - w.y[l.a];
  const len = Math.hypot(dx, dy) || 1;
  return ((w.vx[l.b] - w.vx[l.a]) * dx + (w.vy[l.b] - w.vy[l.a]) * dy) / len;
}

/** Adds a closed polygon to a path as its own subpath. */
function polyPath(p: Path2D, pts: Pt2[]): void {
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
}

/**
 * Each run's cell looks, worked out once from its design, and the joint between each ring wedge
 * and the next one along, if it has one.
 */
const looks = new WeakMap<TestRun, { cells: (CellLook | null)[]; joints: (Face | null)[] }>();

/** Whether a ring joint still holds: neither parted nor cracked. */
function holds(f: Face | null): boolean {
  return !!f && !f.apart && !f.crack1 && !f.crack2;
}

function cellLook(run: TestRun): { cells: (CellLook | null)[]; joints: (Face | null)[] } {
  let look = looks.get(run);
  if (!look) {
    const cells = cellLooks(run.design);
    const w = run.world;
    // Which wedge a face's side belongs to: the one with both its corners.
    const owner = (a: number, b: number) => w.cells.findIndex((c, k) => run.design.cells[k]?.mat === 'arch' && c.n.includes(a) && c.n.includes(b));
    const joints: (Face | null)[] = cells.map(() => null);
    for (const f of w.faces) {
      const [ka, kb] = [owner(f.a1, f.a2), owner(f.b1, f.b2)];
      if (ka < 0 || kb < 0) continue;
      if (cells[ka]?.next === kb) joints[ka] = f;
      else if (cells[kb]?.next === ka) joints[kb] = f;
    }
    looks.set(run, (look = { cells, joints }));
  }
  return look;
}

/** The point at t along a cubic Bézier from p0 through controls c to p1. */
function bezierAt(p0: Pt2, c: Ctl, p1: Pt2, t: number): Pt2 {
  const m = 1 - t;
  const a = m * m * m;
  const b = 3 * m * m * t;
  const d = 3 * m * t * t;
  const e = t * t * t;
  return [a * p0[0] + b * c[0] + d * c[2] + e * p1[0], a * p0[1] + b * c[1] + d * c[3] + e * p1[1]];
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

/** The bridge itself: members and cells painted by stress, chalk outlines, and a swing bridge turning. */
export class Members extends ScenePart {
  /**
   * Paints one member in the golden-hour style, as paintBatch paints many. Coordinates are screen
   * px; `sag` bows a slack cable downward by that many px at its middle. A null stress leaves the
   * stress shade off, as for a broken piece falling away.
   */
  memberPaint(ax: number, ay: number, bx: number, by: number, mat: MaterialId, stress: number | null, alpha = 1, sag = 0, time = 0, ctl?: Ctl): void {
    this.ctx.globalAlpha = alpha;
    this.paintBatch([segOf(ax, ay, bx, by, mat, stress ?? 0, sag, ctl)], time, stress !== null);
    this.ctx.globalAlpha = 1;
  }

  /**
   * Paints many members in a few strokes per material instead of several per member: a soft
   * shadow under all of them, then every member's outline, then every body, then each detail,
   * then the stress overlay in a stroke per shade. A big bridge is hundreds of members, and canvas
   * strokes, not their length, are what a frame pays for.
   */
  private paintBatch(segs: Seg[], time: number, stressed = true): void {
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
    // The shadow each member casts on what is behind it, away from the light.
    const drop = Math.max(1, 0.05 * cam.scale);
    ctx.save();
    ctx.translate(-LIGHT[0] * drop, -LIGHT[1] * drop);
    for (const [mat, list] of byMat) {
      if (mat !== 'cable' && mat !== 'tendon') stroke(list, 0, PAL.castShadow, width(mat) + 2, mat === 'concrete' || mat === 'arch' || mat === 'masonry' ? 'butt' : 'round');
    }
    ctx.restore();
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
          // Slab edge below, lit surface and curb above, and the lane line.
          stroke(list, -w * 0.32, heavy ? PAL.heavyEdge : '#2a2c32', Math.max(1, w * (heavy ? 0.3 : 0.2)));
          stroke(list, w * 0.36, 'rgba(255,255,255,0.14)', Math.max(1, w * 0.14));
          stroke(list, w * 0.47, 'rgba(255,255,255,0.22)', Math.max(1, w * 0.07));
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
          // Shade on the side away from the light, light on the other.
          stroke(list, -w * 0.34, 'rgba(96,52,20,0.4)', Math.max(0.8, w * 0.16), 'butt');
          stroke(list, w * 0.26, 'rgba(255,230,190,0.32)', Math.max(1, w * 0.2));
          break;
        case 'steel': {
          stroke(list, 0, PAL.steelDark, w + 2);
          stroke(list, 0, PAL.steel, w);
          // I-beam flanges, the lit one bright, and a rivet near each end.
          stroke(list, w * 0.34, PAL.steelHi, Math.max(0.8, w * 0.16), 'butt');
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
          // Lit face, shaded underside, and the seams of the formwork every meter or so.
          stroke(list, w * 0.3, 'rgba(255,255,255,0.22)', Math.max(1, w * 0.18), 'butt');
          stroke(list, -w * 0.32, 'rgba(40,36,30,0.28)', Math.max(1, w * 0.16), 'butt');
          if (w > 5) stroke(list, 0, 'rgba(40,36,30,0.35)', w * 0.9, 'butt', [1.5, Math.max(6, cam.scale * 0.9)]);
          break;
        case 'masonry':
          stroke(list, 0, PAL.masonryDark, w + 2, 'butt');
          stroke(list, 0, PAL.masonry, w, 'butt');
          stroke(list, w * 0.3, PAL.stoneLit, Math.max(1, w * 0.2), 'butt');
          stroke(list, -w * 0.3, PAL.stoneShade, Math.max(1, w * 0.2), 'butt');
          break;
        case 'arch':
          stroke(list, 0, PAL.archDark, w + 2, 'butt');
          stroke(list, 0, PAL.arch, w, 'butt');
          stroke(list, w * 0.3, PAL.archHi, Math.max(1, w * 0.2), 'butt');
          stroke(list, -w * 0.3, PAL.stoneShade, Math.max(1, w * 0.2), 'butt');
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
          for (const sg of list) this.damperShape(sg.ax, sg.ay, sg.bx, sg.by, w, false, sg.rest, sg.motion);
          break;
        case 'tendon':
          // A taut strand of steel wires, and an anchor plate at each end.
          stroke(list, 0, PAL.tendonDark, w + 1.5);
          stroke(list, 0, PAL.tendon, w);
          for (const sg of list) {
            const p = Math.max(2.5, w * 1.6);
            ctx.fillStyle = PAL.tendonDark;
            ctx.fillRect(sg.ax - p / 2, sg.ay - p / 2, p, p);
            ctx.fillRect(sg.bx - p / 2, sg.by - p / 2, p, p);
          }
          break;
        default:
          stroke(list, 0, PAL.cable, w + 1);
          // Braided highlight.
          stroke(list, 0, PAL.cableHi, Math.max(0.8, w * 0.45), 'round', [2.5, 2]);
      }
    }
    if (!stressed) return;
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
      const dash = stressLook.dashed && s > SAFE_STRESS ? [w * 0.9, w * 0.6] : null;
      stroke(list, 0, stressColor(s, 0.35 + 0.6 * Math.min(1, s * 1.3)), Math.max(1.5, w * (MATERIALS[mat].drivable ? 0.3 : mat === 'cable' ? 0.9 : mat === 'main' ? 0.7 : mat === 'concrete' || mat === 'arch' ? 0.35 : 0.55)), 'butt', dash);
    }
    // Members near failure throb, each at its own strength.
    const pulse = 0.75 + 0.25 * Math.sin(time * 18);
    for (const sg of segs) {
      const s = Math.abs(sg.stress);
      if (s <= 0.75) continue;
      stroke([sg], 0, stressColor(1, (s - 0.75) * 1.4 * pulse), width(sg.mat) + 10 * (s - 0.5) * pulse);
    }
  }

  chalkMember(ax: number, ay: number, bx: number, by: number, mat: MaterialId, highlight: 'none' | 'hover' | 'delete', ctl?: Ctl): void {
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

  /**
   * A damper: an oil cylinder on one end, a chrome rod from the other sliding in and out of it,
   * and a coil spring between their seats. The cylinder keeps the length it was built with, so as
   * the damper works the rod shows more or less of itself and the spring's coils bunch and spread.
   * In the scene the cylinder glows warm while its ends are moving, as the oil takes up the work.
   * `rest` is the built length, px, and `motion` how fast the ends move apart, m/s. Chalk on the
   * blueprint, painted in the scene.
   */
  private damperShape(ax: number, ay: number, bx: number, by: number, w: number, chalk: boolean, rest = 0, motion = 0): void {
    const { ctx } = this;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const built = rest > 0 ? rest : len;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    // A point d px along it from end a, `off` px to the side.
    const at = (d: number, off = 0): [number, number] => [ax + ux * d - uy * off, ay + uy * d + ux * off];
    const body = Math.max(6, w * 2);
    const rod = Math.max(2, w * 0.4);
    const col = chalk ? MATERIAL_CHALK.damper : PAL.damper;
    const seg = (d0: number, d1: number, width: number, color: string) => {
      ctx.beginPath();
      ctx.moveTo(...at(d0));
      ctx.lineTo(...at(d1));
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    // The cylinder, from near end a; never past the rod's seat near end b, however short it gets.
    const c0 = built * 0.1;
    const seat = len - built * 0.1;
    const c1 = Math.max(c0 + 2, Math.min(built * 0.56, seat - 2));
    ctx.save();
    ctx.lineCap = 'butt';
    if (!chalk) seg(0, len, rod + 2, PAL.steelDark);
    seg(0, len, rod, chalk ? col : PAL.chrome);
    if (chalk) {
      seg(c0, c1, body, col);
      seg(c0, c1, Math.max(1.5, body - 5), PAL.paper);
    } else {
      // Heat in the oil while the ends move.
      const heat = Math.min(0.6, Math.abs(motion) * 1.6);
      if (heat > 0.04) seg(c0 - 2, c1 + 2, body + 4 + 8 * heat, `rgba(255,140,40,${heat})`);
      seg(c0, c1, body + 2, PAL.damperDark);
      seg(c0, c1, body, PAL.damper);
      ctx.beginPath();
      ctx.moveTo(...at(c0, -body * 0.22));
      ctx.lineTo(...at(c1, -body * 0.22));
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = Math.max(1, body * 0.2);
      ctx.stroke();
      // A gland where the rod goes in.
      seg(c1 - Math.max(1.5, body * 0.18), c1, body + 2, PAL.damperDark);
    }
    // The spring's seats: a plate on the cylinder, and one on the rod near end b.
    const plate = Math.max(1.5, w * 0.3);
    for (const d of [c0, seat]) {
      ctx.beginPath();
      ctx.moveTo(...at(d, body * 0.85));
      ctx.lineTo(...at(d, -body * 0.85));
      ctx.strokeStyle = chalk ? col : PAL.steelDark;
      ctx.lineWidth = plate;
      ctx.stroke();
    }
    // The spring between them, a turn every third of a meter or so of its built length.
    if (built > 24) {
      const turns = Math.max(4, Math.round(built / Math.max(9, w * 2.2)));
      ctx.beginPath();
      for (let i = 0; i <= turns; i++) {
        const d = c0 + ((seat - c0) * i) / turns;
        const p = at(d, (i % 2 ? 1 : -1) * body * 0.75);
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

  /**
   * The bridge as it stands: members, then joints. `only` limits it to some members and joints,
   * drawn without slack, and leaves the blocks out.
   */
  drawRunMembers(run: TestRun, time: number, only?: { link: (l: Link) => boolean; node: (i: number) => boolean }): void {
    const { ctx, cam } = this;
    const w = run.world;
    const sag = (l: Link) => {
      if (!l.tensionOnly || only) return 0;
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
    if (!only) this.paintCells(run);
    // Cables behind the truss, deck on top of everything. Each layer is painted in batches.
    for (const pass of [0, 1, 2]) {
      const layer: Seg[] = [];
      for (const l of w.links) {
        if (!l.bridge || l.broken || l.cell >= 0 || drawLayer(l) !== pass || (only && !only.link(l))) continue;
        const damper = l.mat === 'damper';
        layer.push(segOf(cam.sx(w.x[l.a]), cam.sy(w.y[l.a]), cam.sx(w.x[l.b]), cam.sy(w.y[l.b]), l.mat!, l.stress, sag(l), ctlOf.get(l), damper ? l.rest * cam.scale : undefined, damper ? stretchRate(w, l) : undefined));
      }
      this.paintBatch(layer, time);
    }
    this.guardRails(run, only?.link);

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
    const shadows = new Path2D();
    const plates = new Path2D();
    const faces = new Path2D();
    const lit = new Path2D();
    const boltShades = new Path2D();
    const bolts = new Path2D();
    const shines = new Path2D();
    const glows: [number, number, number, number][] = [];
    for (let i = 0; i < nodeCount; i++) {
      if (feet.has(i) || (only && !only.node(i))) continue;
      const x = cam.sx(w.x[i]);
      const y = cam.sy(w.y[i]);
      if (w.im[i] === 0 && w.y[i] > run.level.waterY - 1) {
        this.bolt(x, y, 1, 0, false);
      } else if (degree[i]) {
        const r = Math.max(3, (0.09 + 0.025 * Math.min(degree[i], 6)) * cam.scale);
        // A plate standing off the members: its shadow, rim, face, a lit dome, and bolt heads.
        disk(shadows, x - LIGHT[0] * r * 0.25, y - LIGHT[1] * r * 0.25, r);
        disk(plates, x, y, r);
        disk(faces, x, y, r * 0.78);
        disk(lit, x + LIGHT[0] * r * 0.12, y + LIGHT[1] * r * 0.12, r * 0.6);
        if (r > 5) {
          const count = Math.min(degree[i], 5);
          const b = Math.max(0.8, r * 0.13);
          for (let k = 0; k < count; k++) {
            const a = (k / count) * TAU + 0.4;
            const bx = x + Math.cos(a) * r * 0.48;
            const by = y + Math.sin(a) * r * 0.48;
            disk(boltShades, bx - LIGHT[0] * b * 0.5, by - LIGHT[1] * b * 0.5, b);
            disk(bolts, bx, by, b);
          }
        }
        disk(shines, x - r * 0.3, y - r * 0.3, r * 0.2);
        // A joint taking too much at once glows, like an overloaded member.
        const j = w.jointRatio(i);
        if (j > 0.6) glows.push([x, y, r, j]);
      }
    }
    ctx.fillStyle = PAL.castShadow;
    ctx.fill(shadows);
    ctx.fillStyle = '#2d3138';
    ctx.fill(plates);
    ctx.fillStyle = '#7b8591';
    ctx.fill(faces);
    ctx.fillStyle = '#9aa4b0';
    ctx.fill(lit);
    ctx.fillStyle = '#2d3138';
    ctx.fill(boltShades);
    ctx.fillStyle = '#c3ccd6';
    ctx.fill(bolts);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
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
   * A swing bridge turning on its pier: its design drawn twice, as the near and far side
   * trusses, with the underside of the road between them. It is painted far to near in depth
   * slices, each sized for its distance. The far truss stands in the road's shadow, and the
   * half swinging away is dimmed a little too.
   */
  drawTurning(run: TestRun, time: number, t: Turn): void {
    const { cam } = this;
    const w = run.world;
    const n = t.xs.length;
    // The blocks see the near truss, as everything else does.
    this.paintCells(run);
    const sides = [-1, 1].map((side) => Array.from({ length: n }, (_, i) => turnPoint(t, t.xs[i], t.ys[i], side)));
    const [far, near] = sides;
    let zMax = 0.5;
    for (const pts of sides) for (const [, , z] of pts) zMax = Math.max(zMax, Math.abs(z));
    const slice = (z: number) => Math.min(SWING_SLICES - 1, Math.max(0, Math.floor(((z + zMax) / (2 * zMax)) * SWING_SLICES)));
    const links = w.links.filter((l) => l.bridge && !l.broken && l.cell < 0);
    const sliceOf = sides.map((pts) => new Map(links.map((l) => [l, slice((pts[l.a][2] + pts[l.b][2]) / 2)])));
    const deck = links.filter((l) => l.drivable);
    const deckSlice = new Map(deck.map((l) => [l, slice((far[l.a][2] + far[l.b][2] + near[l.a][2] + near[l.b][2]) / 4)]));
    const scale = cam.scale;
    const truss = (s: number, k: number) => {
      // Each slice is drawn at its own scale, so nearer members are thicker: its points are
      // placed so the scaled camera puts them where the perspective has them.
      const grow = t.dist / (t.dist + zMax - ((k + 0.5) / SWING_SLICES) * 2 * zMax);
      const pts = sides[s];
      for (let i = 0; i < n; i++) {
        w.x[i] = cam.cx + (pts[i][0] - cam.cx) / grow;
        w.y[i] = cam.cy + (pts[i][1] - cam.cy) / grow;
      }
      cam.scale = scale * grow;
      try {
        this.drawRunMembers(run, time, { link: (l) => sliceOf[s].get(l) === k, node: (i) => slice(pts[i][2]) === k });
      } finally {
        cam.scale = scale;
      }
    };
    const both = (k: number) => {
      this.roadUnderside(deck.filter((l) => deckSlice.get(l) === k), far, near);
      truss(1, k);
    };
    const half = SWING_SLICES / 2;
    const turned = Math.sin(t.angle);
    this.hazed(0.4 * turned, () => {
      for (let k = 0; k < SWING_SLICES; k++) truss(0, k);
    });
    this.hazed(0.2 * turned, () => {
      for (let k = 0; k < half; k++) both(k);
    });
    for (let k = half; k < SWING_SLICES; k++) both(k);
    for (let i = 0; i < n; i++) [w.x[i], w.y[i]] = near[i];
  }

  /** The underside of a turning swing bridge's road between its trusses, with a cross beam at each joint. */
  private roadUnderside(deck: Link[], far: [number, number, number][], near: [number, number, number][]): void {
    if (!deck.length) return;
    const { ctx, cam } = this;
    const at = (p: [number, number, number]): Pt2 => [cam.sx(p[0]), cam.sy(p[1])];
    const slab = new Path2D();
    const beams = new Path2D();
    for (const l of deck) {
      const quad = [at(near[l.a]), at(near[l.b]), at(far[l.b]), at(far[l.a])];
      quad.forEach(([x, y], i) => (i ? slab.lineTo(x, y) : slab.moveTo(x, y)));
      slab.closePath();
      for (const p of [l.a, l.b]) {
        beams.moveTo(...at(near[p]));
        beams.lineTo(...at(far[p]));
      }
    }
    ctx.fillStyle = '#2a2c32';
    ctx.fill(slab);
    ctx.strokeStyle = PAL.steelDark;
    ctx.lineWidth = Math.max(1.5, 0.12 * cam.scale);
    ctx.lineCap = 'round';
    ctx.stroke(beams);
  }

  /**
   * Blocks and arch rings as they stand, painted in a few fills for all of them.
   *
   * A block is dressed stone: its face, flecks in it, the stress shade over the face, edges lit on
   * the side facing the sky and shaded on the other, and its joints. An arch ring's wedges are
   * drawn as one smooth curve along its underside and top while their joints hold, lit along the
   * top and shaded underneath; where a joint cracks the curve breaks. The level says what the ring
   * is built of (see archStyle): stone cut into voussoirs, or a steel rib with flanges along both
   * curves, a stiffener plate over every joint and a shoe at each springing. Then a dark jagged
   * crack along every side that has given way, and a seam down every ring joint whose mortar
   * cracked. Everything is laid out on each cell's own corners, so it moves with them.
   */
  private paintCells(run: TestRun): void {
    const { ctx, cam } = this;
    const w = run.world;
    if (!w.cells.length) return;
    const { cells: lookOf, joints } = cellLook(run);
    const scale = cam.scale;
    const at = (p: number): Pt2 => [cam.sx(w.x[p]), cam.sy(w.y[p])];
    const pts = w.cells.map((c) => c.n.map(at));
    const quads = lookOf.map((l, k) => (l ? quadOf(pts[k], l.shape) : null));
    const bevel = scale >= 12 ? 0.08 * scale : 0;
    const detail = scale >= 8;
    const steel = archStyle(run.level.id) === 'steel';
    const blocks = new Path2D();
    const blockLines = new Path2D();
    const ring = new Path2D();
    const flecks = [new Path2D(), new Path2D()];
    const cuts = new Path2D();
    const tops = new Path2D();
    const unders = new Path2D();
    const lights = new Path2D();
    const soffits = new Path2D();
    const lightW = 0.22 * scale;
    const soffitW = 0.26 * scale;
    const bands = new Path2D();
    const rivets = new Path2D();
    // Lit and shaded edges of the blocks, strong then soft.
    const edges = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    // The stress shade over each face, a fill per shade.
    const shades = new Map<number, Path2D>();
    const shadeOf = (s: number) => {
      const key = Math.round(s * 20);
      let p = shades.get(key);
      if (!p) shades.set(key, (p = new Path2D()));
      return p;
    };
    for (const [k, c] of w.cells.entries()) {
      const arch = run.design.cells[k]?.mat === 'arch';
      const look = lookOf[k];
      const q = quads[k];
      const s = Math.min(1, Math.max(0, ...c.links.map((l) => (l.broken ? 1 : Math.abs(l.stress)))));
      // Flecks in the stone, the same ones every frame, close up where they show.
      if (q && scale >= 40 && !(arch && steel)) {
        for (let j = 0; j < (pts[k].length === 4 ? 8 : 4); j++) {
          const h = k * 7.31 + j * 1.93;
          const [x, y] = bilerp(q, 0.12 + 0.76 * hash(h), 0.15 + 0.7 * hash(h + 0.5));
          disk(flecks[j & 1], x, y, (0.018 + 0.022 * hash(h + 0.7)) * scale);
        }
      }
      if (arch && look && q) {
        // The underside and top as curves through the neighbors' corners where the joints hold.
        const left = look.prev >= 0 && holds(joints[look.prev]) ? quads[look.prev] : null;
        const right = look.next >= 0 && holds(joints[k]) ? quads[look.next] : null;
        const under = curveControls(left ? left[0] : q[0], q[0], q[1], right ? right[1] : q[1]);
        const top = curveControls(right ? right[2] : q[2], q[2], q[3], left ? left[3] : q[3]);
        const outline = (p: Path2D) => {
          p.moveTo(...q[0]);
          p.bezierCurveTo(under[0], under[1], under[2], under[3], ...q[1]);
          p.lineTo(...q[2]);
          p.bezierCurveTo(top[0], top[1], top[2], top[3], ...q[3]);
          p.closePath();
        };
        outline(ring);
        outline(shadeOf(s));
        tops.moveTo(...q[2]);
        tops.bezierCurveTo(top[0], top[1], top[2], top[3], ...q[3]);
        unders.moveTo(...q[0]);
        unders.bezierCurveTo(under[0], under[1], under[2], under[3], ...q[1]);
        // Light along the top and shade along the underside, each a band just inside its edge.
        const mid = bilerp(q, 0.5, 0.5);
        const inside = (a: Pt2, b: Pt2, d: number): Pt2 => {
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          let nx = -(b[1] - a[1]) / len;
          let ny = (b[0] - a[0]) / len;
          if (nx * (mid[0] - a[0]) + ny * (mid[1] - a[1]) < 0) {
            nx = -nx;
            ny = -ny;
          }
          return [nx * d, ny * d];
        };
        const [lx, ly] = inside(q[2], q[3], lightW / 2);
        lights.moveTo(q[2][0] + lx, q[2][1] + ly);
        lights.bezierCurveTo(top[0] + lx, top[1] + ly, top[2] + lx, top[3] + ly, q[3][0] + lx, q[3][1] + ly);
        const [sx, sy] = inside(q[0], q[1], soffitW / 2);
        soffits.moveTo(q[0][0] + sx, q[0][1] + sy);
        soffits.bezierCurveTo(under[0] + sx, under[1] + sy, under[2] + sx, under[3] + sy, q[1][0] + sx, q[1][1] + sy);
        if (detail) {
          if (!steel) {
            // The joints between the voussoirs.
            for (const u of look.cuts) {
              cuts.moveTo(...bezierAt(q[0], under, q[1], u));
              cuts.lineTo(...bezierAt(q[2], top, q[3], 1 - u));
            }
            continue;
          }
          // Half a stiffener plate at each end that meets another wedge: the two halves make one
          // plate over the joint, and part when it opens.
          const span = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) || 1;
          const half = Math.min(0.45, (0.05 * scale) / span);
          for (const [u0, u1, has] of [
            [0, half, look.prev >= 0],
            [1 - half, 1, look.next >= 0],
          ] as const) {
            if (!has) continue;
            polyPath(bands, [bilerp(q, u0, -0.05), bilerp(q, u1, -0.05), bilerp(q, u1, 1.05), bilerp(q, u0, 1.05)]);
            if (scale >= 40) for (const v of [0.22, 0.78]) disk(rivets, ...bilerp(q, (u0 + u1) / 2, v), Math.max(0.8, 0.022 * scale));
          }
          // A steel shoe over the springing, where the ring comes down to a point.
          if (look.shape !== 'quad') {
            const len = Math.min(0.5, (0.7 * scale) / span);
            const [u0, u1] = look.shape === 'first' ? [0, len] : [1 - len, 1];
            const tip = look.shape === 'first' ? q[0] : q[1];
            const back = look.shape === 'first' ? u1 : u0;
            polyPath(bands, [tip, bilerp(q, back, -0.06), bilerp(q, back, 1.06)]);
            if (scale >= 40) disk(rivets, ...bilerp(q, look.shape === 'first' ? len * 0.6 : 1 - len * 0.6, 0.5), Math.max(0.8, 0.022 * scale));
          }
        }
        continue;
      }
      polyPath(blocks, pts[k]);
      polyPath(blockLines, pts[k]);
      const inner = bevel ? insetPoly(pts[k], bevel) : pts[k];
      polyPath(shadeOf(s), inner);
      if (!bevel) continue;
      const p = pts[k];
      for (let i = 0; i < p.length; i++) {
        const j = (i + 1) % p.length;
        const [ax, ay] = p[i];
        const [bx, by] = p[j];
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 1) continue;
        // The side's outward normal, against the light.
        let nx = (by - ay) / len;
        let ny = -(bx - ax) / len;
        const [ix, iy] = inner[i];
        if (nx * (ax - ix) + ny * (ay - iy) < 0) {
          nx = -nx;
          ny = -ny;
        }
        const lit = nx * LIGHT[0] + ny * LIGHT[1];
        const band = lit > 0.6 ? 0 : lit > 0.15 ? 1 : lit < -0.6 ? 2 : lit < -0.15 ? 3 : -1;
        if (band >= 0) polyPath(edges[band], [p[i], p[j], inner[j], inner[i]]);
      }
    }
    const thin = Math.max(1, 0.035 * scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';

    // The stone of blocks and rings alike: faces, flecks and the stress shade.
    ctx.fillStyle = PAL.masonry;
    ctx.fill(blocks);
    ctx.fillStyle = steel ? PAL.steel : PAL.arch;
    ctx.fill(ring);
    ctx.fillStyle = PAL.stoneFleckDark;
    ctx.fill(flecks[0]);
    ctx.fillStyle = PAL.stoneFleckLight;
    ctx.fill(flecks[1]);
    for (const [shade, path] of shades) {
      const s = shade / 20;
      ctx.fillStyle = stressColor(s, 0.12 + 0.45 * s);
      ctx.fill(path);
    }
    // Blocks: lit and shaded edges, and joints.
    [PAL.stoneLit, PAL.stoneLitSoft, PAL.stoneShade, PAL.stoneShadeSoft].forEach((style, i) => {
      ctx.fillStyle = style;
      ctx.fill(edges[i]);
    });
    ctx.lineWidth = Math.max(1, 0.04 * scale);
    ctx.strokeStyle = PAL.masonryDark;
    ctx.stroke(blockLines);

    // Arch rings: joints between the stones, light along the top and shade underneath, the
    // outline.
    ctx.strokeStyle = PAL.archLo;
    ctx.lineWidth = thin;
    ctx.stroke(cuts);
    ctx.strokeStyle = PAL.stoneLitSoft;
    ctx.lineWidth = lightW;
    ctx.stroke(lights);
    ctx.strokeStyle = PAL.stoneShadeSoft;
    ctx.lineWidth = soffitW;
    ctx.stroke(soffits);
    ctx.lineWidth = Math.max(1, 0.04 * scale);
    ctx.strokeStyle = steel ? PAL.steelDark : PAL.archDark;
    ctx.stroke(ring);
    if (steel) {
      // A steel rib: flanges along both curves, the top one catching the light, then the
      // stiffener plates over the joints and the shoes.
      const flange = Math.max(2, 0.08 * scale);
      ctx.lineCap = 'round';
      ctx.strokeStyle = PAL.steelDark;
      ctx.lineWidth = flange;
      ctx.stroke(unders);
      ctx.stroke(tops);
      ctx.strokeStyle = PAL.steelHi;
      ctx.lineWidth = Math.max(1, flange * 0.4);
      ctx.stroke(tops);
      ctx.lineCap = 'butt';
      ctx.fillStyle = PAL.steelDark;
      ctx.fill(bands);
      ctx.fillStyle = PAL.steelHi;
      ctx.fill(rivets);
    }

    // Cracks along the sides that gave way.
    const cracks = new Path2D();
    for (const c of w.cells) {
      for (const l of c.links) {
        if (!l.broken) continue;
        const [ax, ay] = at(l.a);
        const [bx, by] = at(l.b);
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const nx = -(by - ay) / len;
        const ny = (bx - ax) / len;
        const n = 5;
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const jig = i && i < n ? (i % 2 ? 0.05 : -0.05) * scale : 0;
          const px = ax + (bx - ax) * t + nx * jig;
          const py = ay + (by - ay) * t + ny * jig;
          if (i) cracks.lineTo(px, py);
          else cracks.moveTo(px, py);
        }
      }
    }
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(30,22,14,0.85)';
    ctx.lineWidth = Math.max(1.5, 0.06 * scale);
    ctx.stroke(cracks);
    // A ring joint whose mortar cracked: a dark seam down both its faces, which gapes as it hinges.
    if (!w.faces.some((f) => f.crack1 || f.crack2)) return;
    ctx.lineWidth = Math.max(1, 0.05 * scale);
    ctx.beginPath();
    for (const f of w.faces) {
      if (!f.crack1 && !f.crack2) continue;
      for (const [a, b] of [
        [f.a1, f.a2],
        [f.b1, f.b2],
      ]) {
        ctx.moveTo(...at(a));
        ctx.lineTo(...at(b));
      }
    }
    ctx.stroke();
  }

  /** Low guard rail with posts about every meter along each intact deck piece. */
  private guardRails(run: TestRun, only?: (l: Link) => boolean): void {
    const { ctx, cam } = this;
    const w = run.world;
    if (cam.scale < 10) return;
    const railH = 0.55;
    ctx.strokeStyle = 'rgba(214,220,228,0.75)';
    ctx.lineWidth = Math.max(1, cam.scale * 0.035);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    for (const l of w.links) {
      if (!l.bridge || l.broken || !l.drivable || (only && !only(l))) continue;
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
}
