import type { GridPt } from '../design';
import type { Editor } from '../editor';
import { fmt, t } from '../i18n';
import { matInline, matName } from '../i18n/data';
import { bankY, goalX, seatPiers, type LevelDef } from '../levels';
import { defaultSag, mainPathIn } from '../maincable';
import { blockPoly, RING, ringPath, ringPolys, ringRise } from '../masonry';
import { MATERIALS, type MaterialId } from '../physics/materials';
import type { TestRun } from '../physics/testrun';
import { blockSpots, pileSpots } from '../rules';
import { font } from './fonts';
import type { Members } from './members';
import { MATERIAL_CHALK, PAL } from './palette';
import type { SceneView } from './renderer';
import { curveControls, footings, inside, MEMBER_WIDTH, mudPoly, overhangPoly, PILE_DEPTH, rockPoly, runControls, TAU, type Ctl, type Pt2 } from './shapes';
import { ScenePart, type Stage } from './stage';
import type { Structures } from './structures';

/** Traces a smooth curve through screen points. */
function smoothPath(ctx: CanvasRenderingContext2D, pts: Pt2[]): void {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const c = curveControls(pts[Math.max(0, i - 1)], pts[i], pts[i + 1], pts[Math.min(pts.length - 1, i + 2)]);
    ctx.bezierCurveTo(c[0], c[1], c[2], c[3], pts[i + 1][0], pts[i + 1][1]);
  }
}

function easeOutBack(x: number): number {
  const c = 1.9;
  const u = x - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

/** The blueprint view and the editor drawn on it: grid, chalk members, handles, hints and cursors. */
export class Blueprint extends ScenePart {
  constructor(stage: Stage, private structures: Structures, private members: Members) {
    super(stage);
  }

  drawBlueprint(v: SceneView): void {
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
    for (const [k, poly] of banks.entries()) {
      // The lower deck's tunnels, cut into the banks before the piers go on.
      if (k === 2 && L.lower) this.structures.tunnels(L.lower.y, W, true);
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

    for (const [px, py] of seatPiers(L)) this.structures.seat(px, py, true);
    if (L.lift?.length) this.structures.liftTowers(L, true);
    // The center lock between two leaves: a short bar across the gap.
    if (L.lock !== undefined) {
      ctx.strokeStyle = PAL.chalk;
      ctx.lineWidth = 2;
      ctx.strokeRect(cam.sx(L.lock - 0.3), cam.sy(-0.15), 0.6 * cam.scale, 0.3 * cam.scale);
    }
    // Road ends on sliding bearings: a pair of rollers under each.
    if (L.sliding) {
      const r = Math.max(2.5, 0.16 * cam.scale);
      ctx.strokeStyle = PAL.chalk;
      ctx.lineWidth = 1.5;
      for (const [x, y] of [
        [0, 0],
        [W, bankY(L)],
      ]) {
        const [sx, sy] = [cam.sx(x), cam.sy(y)];
        ctx.beginPath();
        for (const dx of [-1.4 * r, 1.4 * r]) {
          ctx.moveTo(sx + dx + r, sy + r);
          ctx.arc(sx + dx, sy + r, r, 0, Math.PI * 2);
        }
        ctx.moveTo(sx - 3 * r, sy + 2 * r);
        ctx.lineTo(sx + 3 * r, sy + 2 * r);
        ctx.stroke();
      }
    }
    for (const tw of L.towers ?? []) this.structures.tower(tw[0], tw[1], tw[2], true);
    for (const [x, base, top] of L.masts ?? []) this.structures.mast(x, base, x, top, true);
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
    for (const n of v.editor?.design.nodes ?? []) if (n.pile) this.structures.pile(n.x, n.y, true);
    (L.channels ?? []).forEach(([cx0, cx1, top], i) => this.structures.channelBlueprint(cx0, cx1, top, L.waterY, i === 0 ? L.ship?.mast : undefined));

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
    const label = t('unit.m', { v: fmt.fixed(W, 1) });
    ctx.font = font(600, 12, 'mono');
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

  drawEditor(v: SceneView, ed: Editor): void {
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
      this.members.chalkMember(ax, ay, bx, by, m.mat, i === v.hoverMember ? 'delete' : 'none', p >= 1 ? curved.get(i) : undefined);
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
        const grade =
          MATERIALS[ed.mat].drivable && drag.tx !== f.x && drag.ty !== f.y ? ` · ${t('drag.grade', { pct: fmt.pct(Math.abs(drag.ty - f.y) / Math.abs(drag.tx - f.x)) })}` : '';
        const span = Math.abs(drag.tx - f.x);
        const arch = MATERIALS[ed.mat].arch;
        const what = curvedDrag
          ? t(arch ? 'drag.rise' : 'drag.sag', {
              mat: matName(ed.mat),
              span: fmt.fixed(span, 1),
              v: fmt.fixed(arch ? ringRise(ed.design, [f.x, f.y], [drag.tx, drag.ty], ed.level) : defaultSag([f.x, f.y], [drag.tx, drag.ty], ed.mat), 1),
            })
          : segs > 1
            ? `${segs} × ${matInline(ed.mat)} · ${t('unit.m', { v: fmt.fixed(len, 1) })}`
            : t('unit.m', { v: fmt.fixed(len, 1) });
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
        if (n.block) this.structures.block(n.x, n.y, n.y, 0, true);
        this.bolt(x, y, hover ? 1.25 : 1, v.time, !drag && v.showHint);
        // Paid anchors show their price until they're in use.
        if (n.price && !ed.design.members.some((m) => m.a === i || m.b === i)) this.label(fmt.money(n.price), x, y - 16, PAL.gold);
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

  /** Rings the member or joint picked on the stress graph, wherever it ended up. */
  drawHighlight(run: TestRun, h: NonNullable<SceneView['highlight']>, time: number): void {
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
  drawMakerCursor(m: NonNullable<SceneView['maker']>, level: LevelDef, time: number): void {
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
        this.label(`${t(arch ? 'drag.riseHandle' : 'drag.sagHandle', { v: fmt.fixed(Math.abs(chord - h.y), 1) })}${reason}`, x, y + (arch ? -30 : 30), col);
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

  drawHint(v: SceneView, hint: readonly [GridPt, GridPt, MaterialId][]): void {
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
        // A block ghost is the rectangle of blocks from one corner to the other; an arch ghost its ring.
        const ring = mat === 'arch' ? ringPath(d, a, b, ringRise(d, a, b, ed.level)) : null;
        const block: [number, number][] = [a, [b[0], a[1]], b, [a[0], b[1]]];
        const polys = ring ? ringPolys(ring) : [block];
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
      const phase = (v.time * 0.8) % 1.4;
      const u = Math.min(1, phase);
      const e = u * u * (3 - 2 * u);
      const x = cam.sx(a[0] + (b[0] - a[0]) * e);
      const y = cam.sy(a[1] + (b[1] - a[1]) * e);
      ctx.fillStyle = `rgba(255,255,255,${phase > 1 ? 1.4 - phase : 0.9})`;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = PAL.paper;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}
