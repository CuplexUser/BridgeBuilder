import { MATERIALS, type MaterialId } from '../physics/materials';
import type { Link, TestRun } from '../physics/world';
import { MATERIAL_CHALK, PAL, stressColor } from './palette';
import { MEMBER_WIDTH, runControls, TAU, type Ctl, type Pt2 } from './shapes';
import { ScenePart } from './stage';
import { SWING_SLICES, turnPoint, type Turn } from './swing';

/** Paint order for a bridge link: cables, then truss, then deck. */
function drawLayer(l: Link): number {
  return l.tensionOnly ? 0 : l.drivable ? 2 : 1;
}

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

/** The bridge itself: members and cells painted by stress, chalk outlines, and a swing bridge turning. */
export class Members extends ScenePart {
  /** A turning swing bridge's farther parts are drawn here first, then darkened as one. Sized on first use. */
  private hazeLayer: HTMLCanvasElement = document.createElement('canvas');

  /**
   * Paints one member in the golden-hour style. Coordinates are screen px; `sag` bows a slack
   * cable downward by that many px at its middle.
   */
  memberPaint(ax: number, ay: number, bx: number, by: number, mat: MaterialId, stress: number | null, alpha = 1, sag = 0, time = 0, ctl?: Ctl): void {
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
        layer.push(segOf(cam.sx(w.x[l.a]), cam.sy(w.y[l.a]), cam.sx(w.x[l.b]), cam.sy(w.y[l.b]), l.mat!, l.stress, sag(l), ctlOf.get(l)));
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
    const plates = new Path2D();
    const faces = new Path2D();
    const holes = new Path2D();
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

  /** Draws on a layer of its own, then lays that over the picture darkened by `dim`, 0..1. */
  private hazed(dim: number, draw: () => void): void {
    if (dim < 0.02) return draw();
    const main = this.ctx;
    const c = this.hazeLayer;
    const W = Math.round(this.w * this.dpr);
    const H = Math.round(this.h * this.dpr);
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    const x = c.getContext('2d')!;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, W, H);
    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.stage.ctx = x;
    try {
      draw();
    } finally {
      this.stage.ctx = main;
    }
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = `rgba(22,30,46,${dim.toFixed(3)})`;
    x.fillRect(0, 0, this.w, this.h);
    x.globalCompositeOperation = 'source-over';
    main.drawImage(c, 0, 0, this.w, this.h);
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
   * Concrete blocks as they stand: a face shaded by how hard the block works, with a lit top
   * edge, a dark jagged crack along every side that has given way, and a seam down every arch
   * ring joint whose mortar cracked.
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
    // A ring joint whose mortar cracked: a dark seam down both its faces, which gapes as it hinges.
    if (!w.faces.some((f) => f.crack1 || f.crack2)) return;
    ctx.strokeStyle = 'rgba(30,22,14,0.85)';
    ctx.lineWidth = Math.max(1, 0.05 * cam.scale);
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
