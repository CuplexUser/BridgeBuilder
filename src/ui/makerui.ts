import { traffic } from '../brief';
import { money } from '../editor';
import type { BonusGoal, LevelDef } from '../levels';
import { makerIssues, setSize, type MakerTool } from '../maker';
import { MATERIAL_ORDER, MATERIALS, type MaterialId } from '../physics/materials';
import { VEHICLES, type VehicleId } from '../physics/vehicles';
import { THEMES } from '../render/themes';
import { bonusLabel } from '../scoring';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

/** The editing tools, in toolbar order, with what each does. */
export const MAKER_TOOLS: { id: MakerTool; name: string; help: string }[] = [
  { id: 'bolt', name: 'Bolt', help: 'Tap to add a bolt, or tap one to remove it.' },
  { id: 'pier', name: 'Pier', help: 'Tap a bolt in the gap to stand a pier under it.' },
  { id: 'pylon', name: 'Pylon', help: 'Tap where a pylon top should go: it rises from the water with a bolt on top.' },
  { id: 'channel', name: 'Channel', help: 'Drag across the gap for a ship channel. It stays clear up to the height you start at.' },
  { id: 'erase', name: 'Erase', help: 'Tap a bolt, pylon or channel to remove it.' },
];

/** The level editor's DOM: tools, the settings form, the custom level list and the share dialog. */
export class MakerUi {
  private toolBtns = new Map<MakerTool, HTMLButtonElement>();
  panelOpen = matchMedia('(min-width: 900px)').matches;

  constructor() {
    const set = $('mk-toolset');
    MAKER_TOOLS.forEach((t, i) => {
      const b = document.createElement('button');
      b.className = 'mat mk-tool';
      b.dataset.act = 'mk-tool';
      b.dataset.tool = t.id;
      b.title = t.help;
      b.innerHTML = `<kbd>${i + 1}</kbd><i></i><span>${t.name}</span>`;
      set.appendChild(b);
      this.toolBtns.set(t.id, b);
    });
    const vehicles = (Object.keys(VEHICLES) as VehicleId[]).map((v) => `<option value="${v}">${VEHICLES[v].name} · ${VEHICLES[v].tonnes} t</option>`).join('');
    $('mk-vehicle').innerHTML = vehicles;
    for (const i of [1, 2, 3]) $(`mk-convoy-${i}`).innerHTML = `<option value="">—</option>${vehicles}`;
    $('mk-theme').innerHTML = THEMES.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
    $('mk-mats').innerHTML = MATERIAL_ORDER.map(
      (m) =>
        `<div class="mk-mat" data-mat="${m}"><label><input type="checkbox" id="mk-mat-${m}" /> ${MATERIALS[m].name}</label>` +
        `<label class="mk-limit" title="Most parts allowed; blank for no limit">max <input type="number" id="mk-limit-${m}" min="0" step="1" placeholder="∞" /></label></div>`,
    ).join('');
    $('mk-bonus-mat').innerHTML = MATERIAL_ORDER.map((m) => `<option value="${m}">${MATERIALS[m].name}</option>`).join('');
    $('mk-form').addEventListener('submit', (e) => e.preventDefault());
  }

  /** Calls back when a setting changes; `live` is true while typing in a text field. */
  onChange(cb: (live: boolean) => void): void {
    const form = $('mk-form');
    form.addEventListener('change', () => cb(false));
    form.addEventListener('input', (e) => {
      const t = e.target as HTMLElement;
      if (t.id === 'mk-name' || t.id === 'mk-tip') cb(true);
    });
  }

  show(on: boolean): void {
    $('maker-bar').classList.toggle('hidden', !on);
    $('maker-tools').classList.toggle('hidden', !on);
    $('maker-panel').classList.toggle('hidden', !on || !this.panelOpen);
  }

  togglePanel(): void {
    this.panelOpen = !this.panelOpen;
    $('maker-panel').classList.toggle('hidden', !this.panelOpen);
  }

  /** Width the settings panel takes on the right, so the camera can frame around it. */
  panelWidth(): number {
    const p = $('maker-panel');
    return p.classList.contains('hidden') ? 0 : p.getBoundingClientRect().width + 12;
  }

  setTool(tool: MakerTool): void {
    for (const [id, b] of this.toolBtns) b.classList.toggle('active', id === tool);
  }

  /** The header: the level's name and what still stops it from being played. */
  setStatus(level: LevelDef): void {
    $('mk-title-name').textContent = level.name;
    const issues = makerIssues(level);
    const el = $('mk-issues');
    el.textContent = issues[0] ?? `${traffic(level)} · ${level.width} m · ${money(level.money)}`;
    el.classList.toggle('bad', issues.length > 0);
  }

  /** Puts the level's settings in the form. The field being edited is left alone. */
  fill(l: LevelDef): void {
    const active = document.activeElement;
    const put = (id: string, v: string | number) => {
      const el = $<HTMLInputElement>(id);
      if (el !== active) el.value = String(v);
    };
    put('mk-name', l.name);
    put('mk-tip', l.tip);
    put('mk-width', l.width);
    put('mk-right', l.rightY ?? 0);
    put('mk-water', l.waterY);
    put('mk-vehicle', l.vehicle);
    for (const i of [1, 2, 3]) put(`mk-convoy-${i}`, l.convoy?.[i - 1] ?? '');
    put('mk-mast', l.ship?.mast ?? 0);
    $<HTMLInputElement>('mk-mast').disabled = !l.channels?.length;
    for (const m of MATERIAL_ORDER) {
      const on = l.materials.includes(m);
      $<HTMLInputElement>(`mk-mat-${m}`).checked = on;
      const lim = $<HTMLInputElement>(`mk-limit-${m}`);
      lim.disabled = !on;
      if (lim !== active) lim.value = l.limits?.[m] !== undefined ? String(l.limits[m]) : '';
    }
    put('mk-money', l.money);
    put('mk-target', l.target);
    put('mk-toll', l.anchorCost ?? 0);
    put('mk-bonus-kind', l.bonus.kind);
    const b = l.bonus;
    put('mk-bonus-val', b.kind === 'stress' ? Math.round(b.max * 100) : b.kind === 'without' ? 0 : b.max);
    put('mk-bonus-mat', b.kind === 'without' ? b.mat : l.materials[0]);
    $('mk-bonus-val-box').classList.toggle('hidden', b.kind === 'without');
    $('mk-bonus-mat-box').classList.toggle('hidden', b.kind !== 'without');
    put('mk-theme', l.theme ?? THEMES[0].id);
  }

  /** Copies the form into the level. */
  read(l: LevelDef): void {
    l.name = val('mk-name').trim().slice(0, 40) || 'My level';
    l.tip = val('mk-tip').trim().slice(0, 200);
    setSize(l, n('mk-width', l.width), n('mk-right', l.rightY ?? 0), n('mk-water', l.waterY));
    l.vehicle = val('mk-vehicle') as VehicleId;
    const convoy = [1, 2, 3].map((i) => val(`mk-convoy-${i}`)).filter(Boolean) as VehicleId[];
    if (convoy.length) l.convoy = convoy;
    else delete l.convoy;
    const mast = Math.round(n('mk-mast', 0));
    if (mast > 0 && l.channels?.length) l.ship = { mast: Math.min(20, mast) };
    else delete l.ship;
    const mats = MATERIAL_ORDER.filter((m) => $<HTMLInputElement>(`mk-mat-${m}`).checked);
    l.materials = mats.length ? mats : ['road'];
    const limits: Partial<Record<MaterialId, number>> = {};
    for (const m of l.materials) {
      const v = Number.parseInt(val(`mk-limit-${m}`), 10);
      if (Number.isFinite(v) && v >= 0) limits[m] = v;
    }
    if (Object.keys(limits).length) l.limits = limits;
    else delete l.limits;
    l.money = Math.max(100, Math.round(n('mk-money', l.money)));
    l.target = Math.max(0, Math.round(n('mk-target', l.target)));
    const toll = Math.max(0, Math.round(n('mk-toll', 0)));
    if (toll) l.anchorCost = toll;
    else delete l.anchorCost;
    // A new kind of goal starts from a sensible value, not the old kind's number.
    const kind = val('mk-bonus-kind');
    l.bonus = readBonus(kind, kind === l.bonus.kind ? n('mk-bonus-val', Number.NaN) : Number.NaN, val('mk-bonus-mat') as MaterialId, l);
    l.theme = val('mk-theme');
  }

  /** The custom level list. */
  workshop(levels: LevelDef[]): void {
    const box = $('ws-list');
    if (!levels.length) {
      box.innerHTML = '<p class="ws-empty">No levels yet. Start a new one, or import one someone shared.</p>';
      return;
    }
    box.innerHTML = levels
      .map((l) => {
        const issues = makerIssues(l);
        return `<div class="ws-card">
          <div class="ws-info">
            <b>${escapeHtml(l.name)}</b>
            <span>${escapeHtml(traffic(l))} · ${l.width} m · ${money(l.money)}</span>
            <span class="${issues.length ? 'bad' : 'goal'}">${issues.length ? escapeHtml(issues[0]) : `✦ ${escapeHtml(bonusLabel(l.bonus))}`}</span>
          </div>
          <div class="ws-btns">
            <button class="btn small primary" data-act="ws-play" data-id="${l.id}" ${issues.length ? 'disabled' : ''}>PLAY</button>
            <button class="btn small" data-act="ws-edit" data-id="${l.id}">EDIT</button>
            <button class="btn small" data-act="ws-export" data-id="${l.id}">EXPORT</button>
            <button class="btn small danger" data-act="ws-delete" data-id="${l.id}">DELETE</button>
          </div>
        </div>`;
      })
      .join('');
  }

  /** Arms a delete button: the first tap asks, the second deletes. Returns true when it was already armed. */
  confirmDelete(el: HTMLElement): boolean {
    if (el.dataset.armed) return true;
    el.dataset.armed = '1';
    el.textContent = 'SURE?';
    setTimeout(() => {
      delete el.dataset.armed;
      el.textContent = 'DELETE';
    }, 3000);
    return false;
  }

  /** The share dialog, for exporting a level's JSON or pasting one in. */
  share(mode: 'export' | 'import', text = '', name = ''): void {
    $('share-title').textContent = mode === 'export' ? `Export “${name}”` : 'Import a level';
    $('share-note').textContent =
      mode === 'export'
        ? 'This is the whole level as JSON. Copy it or download it, and anyone can import it in their level editor.'
        : 'Paste a level’s JSON here, or open a .json file. Levels copied from src/levels.ts work too.';
    const ta = $<HTMLTextAreaElement>('share-text');
    ta.value = text;
    ta.readOnly = mode === 'export';
    $('share-error').textContent = '';
    for (const el of document.querySelectorAll<HTMLElement>('.share-export')) el.classList.toggle('hidden', mode !== 'export');
    for (const el of document.querySelectorAll<HTMLElement>('.share-import')) el.classList.toggle('hidden', mode !== 'import');
    if (mode === 'import') setTimeout(() => ta.focus(), 50);
    else ta.select();
  }

  shareText(): string {
    return $<HTMLTextAreaElement>('share-text').value;
  }

  setShareText(text: string): void {
    $<HTMLTextAreaElement>('share-text').value = text;
  }

  shareError(msg: string): void {
    $('share-error').textContent = msg;
  }
}

/** A form field's value. */
function val(id: string): string {
  return $<HTMLInputElement>(id).value;
}

/** A number field's value, or the fallback when it's blank or not a number. */
function n(id: string, fallback: number): number {
  const v = Number.parseFloat(val(id));
  return Number.isFinite(v) ? v : fallback;
}

function readBonus(kind: string, value: number, mat: MaterialId, l: LevelDef): BonusGoal {
  const set = Number.isFinite(value);
  switch (kind) {
    case 'cost':
      return { kind: 'cost', max: Math.max(1, Math.round(set ? value : l.target)) };
    case 'parts':
      return { kind: 'parts', max: Math.max(1, Math.round(set ? value : 20)) };
    case 'without':
      return { kind: 'without', mat: l.materials.includes(mat) ? mat : l.materials.at(-1)! };
    default:
      return { kind: 'stress', max: Math.max(0.05, Math.min(1, Math.round(set ? value : 50) / 100)) };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
