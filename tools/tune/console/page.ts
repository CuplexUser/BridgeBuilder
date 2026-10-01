/**
 * The tuner page (`npm run tuner`): pick levels and an effort, run the tuner and watch it, and
 * edit the difficulty with a live preview of every level's numbers. Talks to plugin.ts.
 */
import { deriveNumbers, normalize, rate, RATINGS, type Difficulty, type Slack } from '../difficulty';
import { clock } from '../progress';
import { Curve, type CurvePoint } from './curve';
import { tuneArgs, type Info, type Job, type LevelRow, type RunOptions, type TunerEvent } from './protocol';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let info: Info | null = null;
let draft: Difficulty | null = null;
let job: Job | null = null;
const selected = new Set<number>();
let effort = 'normal';
let fresh = false;
let useTime = false;
/** Which selection an estimate was made for, so a stale one isn't shown. */
let estimateFor = '';
/** The level last picked by hand, where a shift-click range starts. */
let lastPicked: number | null = null;
let shiftPick = false;
const curve = new Curve($('curve'), $('curve-legend'));

// ───────────────────────────── Data ─────────────────────────────

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/__tuner/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

async function refresh(first = false): Promise<void> {
  const keepDraft = draft && info && dirty();
  info = await api<Info>('info');
  job = info.job;
  if (!keepDraft) draft = clone(info.difficulty);
  if (first) {
    effort = info.defaultEffort;
    for (const l of info.levels) if (needsTuning(l)) selected.add(l.id);
    $('log').textContent = info.log.join('\n');
  }
  renderChapters();
  renderRows();
  renderRun();
}

function listen(): void {
  const events = new EventSource('/__tuner/events');
  events.addEventListener('message', (m) => {
    const e = JSON.parse(m.data as string) as TunerEvent;
    if (e.type === 'log') appendLog(e.line);
    else if (e.type === 'status' && job) {
      job.status = e.status;
      renderProgress();
    } else if (e.type === 'estimate' && job) {
      job.estimate = e.estimate;
      renderRun();
    } else if (e.type === 'job') {
      const ended = job?.running && !e.job.running;
      job = e.job;
      renderRun();
      if (ended) {
        void refresh();
        toast(e.job.code === 0 ? 'Tuning finished.' : e.job.code === 130 ? 'Tuning stopped; finished levels are saved.' : `The tuner exited with code ${e.job.code}.`);
      }
    } else if (e.type === 'saved') void refresh();
  });
  events.addEventListener('error', () => setState('offline', 'bad'));
  events.addEventListener('open', () => renderRun());
}

// ───────────────────────────── Run ─────────────────────────────

function needsTuning(l: LevelRow): boolean {
  return l.stale || !l.ok;
}

/** Whether a pick button's rule (all, needed, or effort:<name> for the effort a level was last tuned at) takes a level. */
function picks(rule: string, l: LevelRow): boolean {
  if (rule === 'all') return true;
  if (rule === 'needed') return needsTuning(l);
  return l.tuned && rule === `effort:${l.effort}`;
}

/** Levels the tuner will actually work on: selected, and out of date unless re-tuning is forced. */
function toTune(): LevelRow[] {
  return (info?.levels ?? []).filter((l) => selected.has(l.id) && (fresh || needsTuning(l)));
}

function runOptions(estimate: boolean): RunOptions {
  const all = info!.levels.every((l) => selected.has(l.id));
  const minutes = Number(($('minutes') as HTMLInputElement).value);
  return {
    levels: all ? null : info!.levels.filter((l) => selected.has(l.id)).map((l) => l.id),
    effort,
    minutes: useTime && minutes > 0 ? minutes : null,
    fresh,
    estimate,
  };
}

function selectionKey(): string {
  const o = runOptions(false);
  return JSON.stringify([o.levels, o.fresh]);
}

function renderRun(): void {
  if (!info) return;
  const running = !!job?.running;
  setState(running ? (job!.args.includes('--estimate') ? 'estimating' : 'tuning') : 'idle', running ? 'busy' : 'idle');

  const work = toTune();
  const sel = selected.size;
  $('run-summary').textContent = sel
    ? `${sel} level${sel === 1 ? '' : 's'} selected, ${work.length} to tune${work.length < sel && !fresh ? ' (the rest are up to date)' : ''}.`
    : 'No levels selected.';

  const est = job?.estimate && estimateFor === selectionKey() ? job.estimate : null;
  $('efforts').innerHTML = info.efforts
    .map((name) => {
      const t = est?.efforts[name];
      const hint = t === undefined ? '' : `<small>~${clock(t * 0.4)}</small>`;
      return `<button type="button" role="radio" aria-checked="${name === effort}" data-effort="${name}" ${useTime ? 'disabled' : ''}>${name}${hint}</button>`;
    })
    .join('');

  ($('fresh') as HTMLInputElement).checked = fresh;
  const args = tuneArgs(runOptions(false));
  $('command').textContent = sel ? `npm run tune${args.length ? ` -- ${args.join(' ')}` : ''}` : 'Select levels to build the command.';
  ($('copy') as HTMLButtonElement).disabled = !sel;
  ($('start') as HTMLButtonElement).disabled = running || !work.length;
  ($('estimate') as HTMLButtonElement).disabled = running || !work.length;
  $('start').hidden = running;
  $('stop').hidden = !running;
  for (const el of document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('#difficulty input, #difficulty button, #rows input.room')) el.disabled = running;
  renderPick();
  renderDiffSummary();
  renderProgress();
}

function renderProgress(): void {
  const s = job?.status;
  const running = !!job?.running;
  $('progress').hidden = !running || !s;
  if (!s) return;
  $('bar').style.width = `${s.pct.toFixed(1)}%`;
  $('p-label').textContent = `${s.pct.toFixed(1)}% · ${s.label}`;
  $('p-detail').textContent = s.detail;
  $('p-stats').textContent = `${s.rate.toFixed(0)} sims/s · ${clock(s.elapsed)} elapsed · ${s.eta === null ? '…' : `${clock(s.eta)} left`}`;
}

function appendLog(line: string): void {
  const pre = $('log');
  const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4;
  pre.textContent += `${pre.textContent ? '\n' : ''}${line}`;
  if (atEnd) pre.scrollTop = pre.scrollHeight;
}

async function start(estimate: boolean): Promise<void> {
  try {
    $('log').textContent = '';
    ($('log-box') as HTMLDetailsElement).open = true;
    estimateFor = estimate ? selectionKey() : estimateFor;
    job = (await api<{ job: Job }>('run', runOptions(estimate))).job;
    renderRun();
  } catch (e) {
    toast((e as Error).message, true);
  }
}

// ───────────────────────────── Difficulty ─────────────────────────────

/** Slack as percent room over the best design: 1.3 is 30. */
function pct(slack: number): number {
  return Math.round((slack - 1) * 100);
}

const KINDS = ['target', 'money'] as const;
const KIND_NAME = { target: 'Cost star', money: 'Budget' } as const;
/** Slider ends, in percent room; the number boxes go up to 300. */
const SLIDER_MAX = { target: 100, money: 200 } as const;

function renderChapters(): void {
  if (!info || !draft) return;
  $('scales').innerHTML = KINDS.map((k) => {
    const steps = RATINGS[k].map(([min, word], i, all) => `<span class="rating r${i}">${word}</span> ${i === all.length - 1 ? 'below' : `+${Math.round(min * 100)}% or more`}`);
    return `<div><dt>${KIND_NAME[k]}</dt><dd>${steps.join('<span class="sep">·</span>')}</dd></div>`;
  }).join('');
  const counts = info.chapters.map((_, i) => info!.levels.filter((l) => l.chapter === i).length);
  $('chapters').innerHTML = `
    <div class="ch-head"><span>Chapter</span><span>Star target: room over the best design</span><span>Budget: room over the best design</span></div>
    ${info.chapters
      .map((c, i) => {
        const s = chapterSlack(i);
        return `<div class="ch-row">
          <div class="ch-name"><b>${c.id}</b> ${esc(c.name)} <small class="muted">${counts[i]} levels</small><p class="example" id="c${i}-example"></p></div>
          ${KINDS.map((k) => `<div class="ch-ctl">${slider(`c${i}-${k}`, pct(s[k]), SLIDER_MAX[k], `${KIND_NAME[k]} room for chapter ${c.id}`)}<p class="cap" id="c${i}-${k}-cap"></p></div>`).join('')}
        </div>`;
      })
      .join('')}`;
  ($('seed-range') as HTMLInputElement).value = String(pct(draft.seedSlack));
  ($('seed-room') as HTMLInputElement).value = String(pct(draft.seedSlack));
  renderDiffSummary();
}

function slider(id: string, v: number, max: number, label: string): string {
  return `<span class="pair"><input type="range" min="0" max="${max}" step="1" value="${v}" data-pair="${id}" aria-label="${label}, percent" /><span class="pct"><input type="number" min="0" max="300" step="1" value="${v}" data-pair="${id}" aria-label="${label}, percent" />%</span></span>`;
}

function chapterSlack(i: number): Slack {
  return draft!.chapters[Math.min(i, draft!.chapters.length - 1)];
}

/**
 * Under each chapter's sliders: the rating its levels end up with, and the range of room they
 * get (floors such as the hand-made design can lift some above the setting). Beside the name:
 * a typical level's numbers in dollars.
 */
function renderChapterCaptions(): void {
  if (!info) return;
  for (const i of info.chapters.keys()) {
    const levels = info.levels.filter((l) => l.chapter === i && l.best);
    const example = $(`c${i}-example`);
    if (!levels.length || !example) continue;
    for (const k of KINDS) {
      const rooms = levels.map((l) => preview(l)![k] / l.best!.cost - 1);
      const avg = rooms.reduce((a, b) => a + b, 0) / rooms.length;
      const { step, word } = rate(k, avg);
      const [lo, hi] = [Math.min(...rooms), Math.max(...rooms)].map((r) => Math.round(r * 100));
      $(`c${i}-${k}-cap`).innerHTML = `<span class="rating r${step}">${word}</span> levels average +${Math.round(avg * 100)}%${hi > lo ? `, from +${lo}% to +${hi}%` : ''}`;
    }
    // The level with the median best cost stands for the chapter.
    const typical = [...levels].sort((a, b) => a.best!.cost - b.best!.cost)[Math.floor(levels.length / 2)];
    const n = preview(typical)!;
    example.innerHTML = `e.g. <b class="mono">${esc(typical.code)}</b> ${esc(typical.name)}: best design ${usd(typical.best!.cost)} → star at ${usd(n.target)} or less, budget ${usd(n.money)}`;
  }
}

function renderCurve(): void {
  if (!info) return;
  const points = info.levels.flatMap((l): CurvePoint[] => {
    const next = preview(l);
    return l.best && next ? [{ code: l.code, name: l.name, chapter: l.chapter, best: l.best.cost, saved: { target: l.target, money: l.money }, next }] : [];
  });
  curve.draw(points, info.chapters, dirty());
}

/** The numbers a level would get under the draft difficulty, or null if it has no result to derive from. */
function preview(l: LevelRow): { money: number; target: number } | null {
  if (!draft || !l.best) return null;
  return deriveNumbers(normalize(draft), l.chapter, l.id, l.best.cost, l.seed ? { ...l.seed, parts: 0, reason: '' } : null);
}

function dirty(): boolean {
  return !!draft && !!info && JSON.stringify(normalize(draft)) !== JSON.stringify(normalize(info.difficulty));
}

function renderDiffSummary(): void {
  if (!info) return;
  const changed = info.levels.filter((l) => {
    const p = preview(l);
    return p && (p.money !== l.money || p.target !== l.target);
  }).length;
  const isDirty = dirty();
  $('diff-summary').textContent = isDirty ? `Unsaved: ${changed} level${changed === 1 ? '' : 's'} would change.` : 'Saved.';
  ($('save') as HTMLButtonElement).disabled = !isDirty || !!job?.running;
  ($('discard') as HTMLButtonElement).disabled = !isDirty || !!job?.running;
}

async function save(): Promise<void> {
  try {
    const { changed } = await api<{ changed: number[] }>('difficulty', normalize(draft!));
    draft = null;
    await refresh();
    const flagged = info!.levels.filter((l) => changed.includes(l.id) && !l.ok).length;
    toast(`Saved. ${changed.length} level${changed.length === 1 ? '' : 's'} changed${flagged ? `; ${flagged} now need${flagged === 1 ? 's' : ''} a re-tune (selected below)` : ''}.`);
    if (flagged) {
      for (const l of info!.levels) if (changed.includes(l.id) && !l.ok) selected.add(l.id);
      renderRows();
      renderRun();
    }
  } catch (e) {
    toast((e as Error).message, true);
  }
}

// ───────────────────────────── Levels table ─────────────────────────────

function renderRows(): void {
  if (!info || !draft) return;
  const html: string[] = [];
  for (const [i, c] of info.chapters.entries()) {
    const rows = info.levels.filter((l) => l.chapter === i);
    const all = rows.every((l) => selected.has(l.id));
    const some = rows.some((l) => selected.has(l.id));
    html.push(`<tr class="chapter"><td class="c-check"><input type="checkbox" data-chapter="${i}" ${all ? 'checked' : ''} ${!all && some ? 'data-mixed' : ''} aria-label="Select chapter ${c.id}" /></td><td colspan="10">Chapter ${c.id} · ${esc(c.name)}</td></tr>`);
    for (const l of rows) html.push(row(l));
  }
  $('rows').innerHTML = html.join('');
  renderPick();
  for (const el of document.querySelectorAll<HTMLInputElement>('[data-mixed]')) el.indeterminate = true;
  updatePreview();
}

/** The pick buttons, with how many levels each would pick. */
function renderPick(): void {
  if (!info) return;
  const running = !!job?.running;
  const count = (rule: string) => info!.levels.filter((l) => picks(rule, l)).length;
  $('pick-efforts').innerHTML = info.efforts
    .map((name) => {
      const n = count(`effort:${name}`);
      return `<button type="button" class="ghost small" data-select="effort:${name}" ${n && !running ? '' : 'disabled'}>${name} <small>${n}</small></button>`;
    })
    .join('');
  for (const rule of ['all', 'needed']) {
    const b = document.querySelector<HTMLButtonElement>(`[data-select="${rule}"]`)!;
    const n = count(rule);
    b.innerHTML = `${rule === 'all' ? 'All' : 'Needs tuning'} <small>${n}</small>`;
    b.disabled = running || !n;
  }
  document.querySelector<HTMLButtonElement>('[data-select="none"]')!.disabled = running;
}

function row(l: LevelRow): string {
  const own = draft!.levels[l.id] ?? {};
  const status = !l.tuned
    ? ['Not tuned', 'muted']
    : l.stale
      ? ['Stale', 'warn']
      : !l.ok
        ? ['Needs re-tune', 'bad']
        : l.warnings.length
          ? ['Tuned ⚠', 'ok']
          : ['Tuned', 'ok'];
  const why = [...(l.stale && l.tuned ? ["The level's inputs changed since it was tuned."] : []), ...l.notes, ...l.warnings].join('\n');
  return `<tr data-id="${l.id}" class="${selected.has(l.id) ? 'sel' : ''}">
    <td class="c-check"><input type="checkbox" data-level="${l.id}" ${selected.has(l.id) ? 'checked' : ''} aria-label="Select ${esc(l.code)}" /></td>
    <td><b class="mono">${esc(l.code)}</b> ${esc(l.name)}</td>
    <td><span class="badge ${status[1]}" ${why ? `title="${esc(why)}"` : ''}>${status[0]}</span></td>
    <td class="num">${l.best ? `${usd(l.best.cost)} <small class="muted" title="Peak stress of the best design">peak ${Math.round(l.best.peak * 100)}%</small>` : '—'}</td>
    <td class="num">${l.hand === null ? '—' : usd(l.hand)}</td>
    <td class="num" data-cell="target"></td>
    <td class="num" data-cell="money"></td>
    <td>${esc(l.bonus)}</td>
${KINDS.map((k) => `    <td class="num"><span class="pct"><input class="room" type="number" min="0" max="300" step="1" value="${own[k] === undefined ? '' : pct(own[k])}" data-room="${k}" data-id="${l.id}" aria-label="${KIND_NAME[k]} room for ${esc(l.code)}, percent; blank uses the chapter's" />%</span></td>`).join('\n')}
    <td class="num muted">${l.effort ? `${l.effort} · ${clock(l.seconds)}` : ''}</td>
  </tr>`;
}

/** Fills the target and budget cells, showing old → new where the draft changes them. */
function updatePreview(): void {
  if (!info) return;
  for (const l of info.levels) {
    const tr = document.querySelector(`tr[data-id="${l.id}"]`);
    if (!tr) continue;
    const p = preview(l);
    for (const k of KINDS) {
      const cell = tr.querySelector<HTMLElement>(`[data-cell="${k}"]`)!;
      const now = l[k];
      const next = p?.[k] ?? now;
      const roomText = l.best ? ` <small class="muted">+${Math.round((next / l.best.cost - 1) * 100)}%</small>` : '';
      cell.innerHTML = (next === now ? usd(now) : `<s class="muted">${usd(now)}</s> <span class="${next > now ? 'up' : 'down'}">${usd(next)}</span>`) + roomText;
      // A blank room box shows the chapter's room it falls back to.
      const box = tr.querySelector<HTMLInputElement>(`input[data-room="${k}"]`);
      if (box && draft) box.placeholder = String(pct(chapterSlack(l.chapter)[k]));
    }
    const own = draft?.levels[l.id];
    tr.classList.toggle('custom', !!own && Object.values(own).some((v) => v !== undefined));
  }
  renderChapterCaptions();
  renderCurve();
  renderDiffSummary();
}

// ───────────────────────────── Events ─────────────────────────────

document.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (!draft) return;
  const pair = el.dataset.pair;
  if (pair) {
    const [, ch, key] = /^c(\d+)-(target|money)$/.exec(pair) ?? [];
    const v = Number(el.value);
    if (ch !== undefined && el.value !== '' && Number.isFinite(v)) {
      draft.chapters[Number(ch)] = { ...draft.chapters[Number(ch)], [key]: 1 + v / 100 };
      for (const other of document.querySelectorAll<HTMLInputElement>(`[data-pair="${pair}"]`)) if (other !== el) other.value = String(v);
    }
    updatePreview();
  } else if (el.id === 'seed-range' || el.id === 'seed-room') {
    const v = Number(el.value);
    if (el.value !== '' && Number.isFinite(v)) {
      draft.seedSlack = 1 + v / 100;
      ($(el.id === 'seed-range' ? 'seed-room' : 'seed-range') as HTMLInputElement).value = String(v);
    }
    updatePreview();
  } else if (el.dataset.room) {
    const id = el.dataset.id!;
    const k = el.dataset.room as keyof Slack;
    const own = { ...draft.levels[id] };
    // Blank falls back to the chapter's room.
    if (el.value === '') delete own[k];
    else if (Number.isFinite(Number(el.value))) own[k] = 1 + Number(el.value) / 100;
    if (Object.keys(own).length) draft.levels[id] = own;
    else delete draft.levels[id];
    updatePreview();
  } else if (el.id === 'minutes') renderRun();
});

document.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.level) {
    const id = Number(el.dataset.level);
    // Shift-click sets every level between the last pick and this one, in play order, the same way.
    const ids = info!.levels.map((l) => l.id);
    const [a, b] = [ids.indexOf(lastPicked ?? id), ids.indexOf(id)].sort((x, y) => x - y);
    for (const i of shiftPick ? ids.slice(a, b + 1) : [id]) {
      if (el.checked) selected.add(i);
      else selected.delete(i);
    }
    lastPicked = id;
    renderRows();
    renderRun();
  } else if (el.dataset.chapter) {
    for (const l of info!.levels) {
      if (l.chapter !== Number(el.dataset.chapter)) continue;
      if (el.checked) selected.add(l.id);
      else selected.delete(l.id);
    }
    renderRows();
    renderRun();
  } else if (el.id === 'fresh') {
    fresh = el.checked;
    renderRun();
  } else if (el.id === 'use-time') {
    useTime = el.checked;
    renderRun();
  }
});

document.addEventListener('click', (e) => {
  // A checkbox's click comes before its change event, so this is where the shift key shows.
  if ((e.target as HTMLElement).matches('input[data-level]')) shiftPick = e.shiftKey;
  const el = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!el || el.hasAttribute('disabled') || !info) return;
  if (el.dataset.effort) {
    effort = el.dataset.effort;
    renderRun();
  } else if (el.dataset.select) {
    const rule = el.dataset.select;
    selected.clear();
    for (const l of info.levels) if (picks(rule, l)) selected.add(l.id);
    // Levels picked by the effort they were tuned at are usually up to date, and those only run again when forced.
    if (rule.startsWith('effort:') && !fresh && info.levels.some((l) => selected.has(l.id) && !needsTuning(l))) {
      fresh = true;
      toast('Turned on re-tuning up-to-date levels, so the picked levels run again. Choose a higher effort above.');
    }
    renderRows();
    renderRun();
  } else if (el.id === 'start') void start(false);
  else if (el.id === 'estimate') void start(true);
  else if (el.id === 'stop') void api('stop', {}).catch((err: Error) => toast(err.message, true));
  else if (el.id === 'save') void save();
  else if (el.id === 'discard' || el.id === 'defaults') {
    draft = clone(el.id === 'discard' ? info.difficulty : info.defaults);
    renderChapters();
    renderRows();
  } else if (el.id === 'copy') {
    void navigator.clipboard.writeText($('command').textContent ?? '').then(() => toast('Copied the command.'));
  }
});

// ───────────────────────────── Bits ─────────────────────────────

function setState(text: string, kind: string): void {
  const pill = $('state');
  pill.textContent = text;
  pill.className = `pill ${kind}`;
}

let toastTimer = 0;
function toast(text: string, bad = false): void {
  const t = $('toast');
  t.textContent = text;
  t.className = `toast${bad ? ' bad' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 5000);
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function usd(v: number): string {
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

listen();
refresh(true).catch((e: Error) => {
  setState('offline', 'bad');
  toast(`Couldn't load the tuner: ${e.message}. Is this the dev server (npm run tuner)?`, true);
});
