/**
 * The difficulty curve on the tuner page: every level's star-target and budget room over its
 * best design, in play order, so levels and chapters can be compared at a glance. Draws
 * inline SVG; hover or arrow keys show one level's numbers.
 */

/** Series colors, checked for contrast and color-blind separation against the card surface. */
const COLOR = { target: '#c08a00', money: '#2f95e0' } as const;
const NAME = { target: 'Star target', money: 'Budget' } as const;
const SURFACE = '#0f2647';
const HEIGHT = 230;
const PAD = { l: 52, r: 92, t: 30, b: 14 };

type Kind = keyof typeof COLOR;
type Numbers = Record<Kind, number>;

export interface CurvePoint {
  code: string;
  name: string;
  chapter: number;
  best: number;
  saved: Numbers;
  next: Numbers;
}

export class Curve {
  private points: CurvePoint[] = [];
  private chapters: { id: number; name: string }[] = [];
  private dirty = false;
  private focus = -1;
  private readonly tip: HTMLDivElement;

  constructor(
    private host: HTMLElement,
    private legend: HTMLElement,
  ) {
    host.tabIndex = 0;
    host.setAttribute('role', 'group');
    host.setAttribute('aria-label', 'Difficulty curve. Use the arrow keys to read each level.');
    this.tip = document.createElement('div');
    this.tip.className = 'curve-tip';
    this.tip.hidden = true;
    host.addEventListener('pointermove', (e) => this.show(this.nearest(e.clientX)));
    host.addEventListener('pointerleave', () => this.show(-1));
    host.addEventListener('blur', () => this.show(-1));
    host.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step || !this.points.length) return;
      e.preventDefault();
      this.show(Math.max(0, Math.min(this.points.length - 1, (this.focus < 0 ? (step > 0 ? -1 : this.points.length) : this.focus) + step)));
    });
    // Redraw only when the width really changes, a frame later, so a redraw can't feed the observer.
    let width = 0;
    new ResizeObserver(() => {
      if (host.clientWidth === width) return;
      width = host.clientWidth;
      requestAnimationFrame(() => this.render());
    }).observe(host);
  }

  /** Redraws with new numbers; `dirty` also draws the saved numbers, dashed, for comparison. */
  draw(points: CurvePoint[], chapters: { id: number; name: string }[], dirty: boolean): void {
    this.points = points;
    this.chapters = chapters;
    this.dirty = dirty;
    this.render();
    this.show(this.focus);
  }

  private get width(): number {
    return Math.max(320, this.host.clientWidth);
  }

  private x(i: number): number {
    return PAD.l + ((i + 0.5) * (this.width - PAD.l - PAD.r)) / Math.max(1, this.points.length);
  }

  private top(): number {
    const most = Math.max(1, ...this.points.flatMap((p) => [room(p, 'target', 'next'), room(p, 'money', 'next'), room(p, 'target', 'saved'), room(p, 'money', 'saved')]));
    return Math.ceil(most / 0.5) * 0.5;
  }

  private y(v: number, top: number): number {
    return PAD.t + (1 - v / top) * (HEIGHT - PAD.t - PAD.b);
  }

  private render(): void {
    const w = this.width;
    const n = this.points.length;
    const top = this.top();
    const step = (w - PAD.l - PAD.r) / Math.max(1, n);
    const out: string[] = [];

    // Chapter bands, labeled along the top.
    for (const [ci, c] of this.chapters.entries()) {
      const idx = this.points.flatMap((p, i) => (p.chapter === ci ? [i] : []));
      if (!idx.length) continue;
      const x0 = this.x(idx[0]) - step / 2;
      const x1 = this.x(idx.at(-1)!) + step / 2;
      if (ci % 2 === 0) out.push(`<rect x="${x0}" y="${PAD.t - 22}" width="${x1 - x0}" height="${HEIGHT - PAD.t - PAD.b + 22}" class="band" />`);
      const label = x1 - x0 > 110 ? `${c.id} ${c.name}` : x1 - x0 > 40 ? `Ch ${c.id}` : String(c.id);
      out.push(`<text x="${(x0 + x1) / 2}" y="${PAD.t - 9}" class="band-label" text-anchor="middle">${esc(label)}</text>`);
    }

    // Gridlines every 50 points of room.
    for (let v = 0; v <= top + 1e-9; v += 0.5) {
      const y = this.y(v, top);
      out.push(`<line x1="${PAD.l}" x2="${w - PAD.r}" y1="${y}" y2="${y}" class="grid${v === 0 ? ' base' : ''}" />`);
      out.push(`<text x="${PAD.l - 8}" y="${y + 4}" class="tick" text-anchor="end">+${Math.round(v * 100)}%</text>`);
    }

    const path = (kind: Kind, which: 'next' | 'saved') => this.points.map((p, i) => `${i ? 'L' : 'M'}${this.x(i).toFixed(1)} ${this.y(room(p, kind, which), top).toFixed(1)}`).join(' ');
    if (this.dirty) for (const k of ['money', 'target'] as const) out.push(`<path d="${path(k, 'saved')}" class="saved" stroke="${COLOR[k]}" />`);
    for (const k of ['money', 'target'] as const) {
      out.push(`<path d="${path(k, 'next')}" class="line" stroke="${COLOR[k]}" />`);
      for (const [i, p] of this.points.entries()) out.push(`<circle cx="${this.x(i)}" cy="${this.y(room(p, k, 'next'), top)}" r="4" fill="${COLOR[k]}" stroke="${SURFACE}" stroke-width="2" />`);
    }

    // Direct labels at the right end, nudged apart when the lines finish close together.
    if (n) {
      const ends = (['target', 'money'] as const).map((k) => ({ k, y: this.y(room(this.points[n - 1], k, 'next'), top) }));
      if (Math.abs(ends[0].y - ends[1].y) < 14) {
        const mid = (ends[0].y + ends[1].y) / 2;
        const [hi, lo] = ends[0].y <= ends[1].y ? [ends[0], ends[1]] : [ends[1], ends[0]];
        hi.y = mid - 7;
        lo.y = mid + 7;
      }
      for (const e of ends) out.push(`<text x="${this.x(n - 1) + 12}" y="${e.y + 4}" class="end-label">${NAME[e.k]}</text>`);
    }

    out.push(`<line id="curve-cross" class="cross" y1="${PAD.t - 22}" y2="${HEIGHT - PAD.b}" visibility="hidden" />`);
    out.push('<g id="curve-focus"></g>');
    this.host.innerHTML = `<svg width="${w}" height="${HEIGHT}" viewBox="0 0 ${w} ${HEIGHT}" aria-hidden="true">${out.join('')}</svg>`;
    this.host.append(this.tip);

    this.legend.innerHTML = [
      ...(['target', 'money'] as const).map((k) => `<span><i class="key" style="background:${COLOR[k]}"></i>${NAME[k]} room</span>`),
      ...(this.dirty ? ['<span><i class="key dashed"></i>Saved</span>'] : []),
    ].join('');
  }

  private nearest(clientX: number): number {
    if (!this.points.length) return -1;
    const left = this.host.getBoundingClientRect().left;
    const step = (this.width - PAD.l - PAD.r) / this.points.length;
    return Math.max(0, Math.min(this.points.length - 1, Math.floor((clientX - left - PAD.l) / step)));
  }

  /** Shows the crosshair and readout for one level, or hides them for -1. */
  private show(i: number): void {
    this.focus = i;
    const cross = this.host.querySelector('#curve-cross');
    const focus = this.host.querySelector('#curve-focus');
    const p = this.points[i];
    if (!cross || !focus || !p) {
      cross?.setAttribute('visibility', 'hidden');
      if (focus) focus.innerHTML = '';
      this.tip.hidden = true;
      return;
    }
    const top = this.top();
    const x = this.x(i);
    cross.setAttribute('x1', String(x));
    cross.setAttribute('x2', String(x));
    cross.setAttribute('visibility', 'visible');
    focus.innerHTML = (['target', 'money'] as const)
      .map((k) => `<circle cx="${x}" cy="${this.y(room(p, k, 'next'), top)}" r="6" fill="${COLOR[k]}" stroke="${SURFACE}" stroke-width="2" />`)
      .join('');
    const line = (k: Kind) => {
      const changed = p.next[k] !== p.saved[k];
      const what = k === 'target' ? `star at ${usd(p.next[k])} or less` : `budget ${usd(p.next[k])}`;
      return `<div class="tip-row"><i class="key" style="background:${COLOR[k]}"></i><strong>+${Math.round(room(p, k, 'next') * 100)}%</strong> <span>${what}</span>${changed ? ` <s class="muted">${usd(p.saved[k])}</s>` : ''}</div>`;
    };
    this.tip.innerHTML = `<div class="tip-head"><b class="mono">${esc(p.code)}</b> ${esc(p.name)}</div>${line('target')}${line('money')}<div class="muted">Best design ${usd(p.best)}</div>`;
    this.tip.hidden = false;
    const tw = this.tip.offsetWidth;
    this.tip.style.left = `${x + 14 + tw > this.width ? x - 14 - tw : x + 14}px`;
    this.tip.style.top = `${PAD.t}px`;
  }
}

/** A level's room over its best design: 0.3 means 30% above it. */
function room(p: CurvePoint, kind: Kind, which: 'next' | 'saved'): number {
  return p[which][kind] / p.best - 1;
}

function usd(v: number): string {
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
