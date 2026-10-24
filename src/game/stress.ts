import { fmt, t } from '../i18n';
import { matName } from '../i18n/data';
import { StressGraph, type GraphPick } from '../ui/graph';
import type { Game } from './game';

/** A load ratio as a whole percentage. */
function pct(v: number): string {
  return fmt.pct(v);
}

/** A length or a time to one decimal. */
function tenths(v: number): string {
  return fmt.fixed(v, 1);
}

/** The stress graph docked over a finished run, and the member or joint it picks out on the bridge. */
export class StressView {
  /** The stress graph is docked over a finished run, with what it highlights. */
  graphOpen = false;
  pick: GraphPick | null = null;
  graph = new StressGraph(document.getElementById('stress-canvas') as HTMLCanvasElement);

  constructor(private game: Game) {}

  /** Docks the stress graph under the finished run, starting at the moment it peaked. */
  openGraph(): void {
    const run = this.game.run;
    if (!run || (this.game.state !== 'result' && this.game.state !== 'collapse') || !run.log.length) return;
    this.graphOpen = true;
    this.game.ui.show(null);
    this.game.ui.setGraph(true);
    const s = run.log.peakSample();
    this.pickSample(s);
    this.frameGraph();
  }

  closeGraph(): void {
    if (!this.graphOpen) return;
    this.hideGraph();
    this.game.ui.show(this.game.state === 'result' ? 'result' : 'collapse');
    if (this.game.run) this.game.frameTest(this.game.run, this.game.viewRect());
  }

  hideGraph(): void {
    if (!this.graphOpen) return;
    this.graphOpen = false;
    this.pick = null;
    this.game.ui.setGraph(false);
  }

  /** Frames the bridge in the space above the dock. */
  frameGraph(): void {
    const top = this.game.renderer.w < 560 ? 104 : 70;
    const dock = this.game.ui.graphTop();
    const [a, b, c, d] = this.game.buildBounds();
    this.game.cam.fit(a, b, c, d, { x: 12, y: top, w: this.game.renderer.w - 24, h: Math.max(100, dock - top - 10) }, false);
  }

  /** Picks the busiest member (or joint) at a sample. */
  pickSample(sample: number): void {
    const log = this.game.run?.log;
    if (!log || sample < 0) return;
    const who = log.who[sample];
    this.pick = { sample, member: who >= 0 ? who : -1, node: who <= -2 ? -2 - who : -1 };
    this.showPick();
  }

  /** Picks one member, at the moment it was loaded hardest. */
  pickMember(member: number): void {
    const log = this.game.run?.log;
    if (!log) return;
    const { t: at } = log.memberPeak(member);
    this.pick = { sample: log.sampleAt(at), member, node: -1 };
    this.showPick();
  }

  showPick(): void {
    const run = this.game.run;
    const p = this.pick;
    if (!run || !p) return;
    const log = run.log;
    const time = log.t[p.sample];
    let info = t('stress.nothing');
    if (p.member >= 0) {
      const d = this.game.editor!.design;
      const m = d.members[p.member];
      const len = Math.hypot(d.nodes[m.b].x - d.nodes[m.a].x, d.nodes[m.b].y - d.nodes[m.a].y);
      const now = log.members[p.sample][p.member];
      const peak = log.memberPeak(p.member);
      const broke = log.breaks.find((b) => b.member === p.member);
      const head = t('stress.member', { mat: matName(m.mat), len: tenths(len), load: Number.isNaN(now) ? t('stress.broken') : pct(now), t: tenths(time) });
      const tail = broke ? t('stress.peakBroke', { pct: pct(1), t: tenths(broke.t) }) : t('stress.peak', { pct: pct(peak.value), t: tenths(peak.t) });
      info = `${head} · ${tail}`;
    } else if (p.node >= 0) {
      const n = this.game.editor!.design.nodes[p.node];
      info = t('stress.joint', { at: t('unit.point', { x: fmt.dec(n.x), y: fmt.dec(n.y) }), load: pct(log.peak[p.sample]), t: fmt.fixed(time, 1) });
    }
    this.game.ui.setStressInfo(info);
    this.graph.draw(log, p);
  }

  /** Where a broken member stood in the design, so the graph can show it after it fell. */
  ghostOf(member: number): [number, number, number, number] | null {
    const run = this.game.run;
    const d = this.game.editor?.design;
    if (!run || !d || member < 0 || !run.log.breaks.some((b) => b.member === member)) return null;
    const m = d.members[member];
    return [d.nodes[m.a].x, d.nodes[m.a].y, d.nodes[m.b].x, d.nodes[m.b].y];
  }

  /** The bridge member nearest a screen point, for picking on the frozen run. */
  memberNear(sx: number, sy: number): number {
    const run = this.game.run;
    if (!run) return -1;
    const [wx, wy] = this.game.input.worldAt(sx, sy);
    const w = run.world;
    const r = this.game.input.pickRadius(18, 0.35);
    let best = -1;
    let bd = r;
    for (const l of w.links) {
      if (!l.bridge || l.member < 0) continue;
      const ax = w.x[l.a];
      const ay = w.y[l.a];
      const dx = w.x[l.b] - ax;
      const dy = w.y[l.b] - ay;
      const u = Math.max(0, Math.min(1, ((wx - ax) * dx + (wy - ay) * dy) / (dx * dx + dy * dy || 1)));
      const dist = Math.hypot(wx - (ax + dx * u), wy - (ay + dy * u));
      if (dist < bd) {
        bd = dist;
        best = l.member;
      }
    }
    return best;
  }
}
