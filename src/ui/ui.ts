import type { LevelDef } from '../levels';
import { MATERIAL_ORDER, MATERIALS, type MaterialId } from '../physics/materials';
import type { LevelScore } from '../scoring';
import type { HighScore, Profile, Progress } from '../storage';

export type ScreenId = 'title' | 'profile' | 'levels' | 'scores' | 'pause' | 'result' | 'collapse' | 'over';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Thin layer over the static DOM in index.html: no game logic lives here. */
export class Ui {
  hud = $('hud');
  toolbar = $('toolbar');
  hudNum = $('hud-num');
  hudName = $('hud-name');
  hudLives = $('hud-lives');
  hudScore = $('hud-score');
  muteBtn = $<HTMLButtonElement>('btn-mute');
  pauseBtn = $<HTMLButtonElement>('btn-pause');
  undoBtn = $<HTMLButtonElement>('btn-undo');
  redoBtn = $<HTMLButtonElement>('btn-redo');
  clearBtn = $<HTMLButtonElement>('btn-clear');
  testBtn = $<HTMLButtonElement>('btn-test');
  toast = $('toast');
  fps = $('fps');
  matBtns = new Map<MaterialId, HTMLButtonElement>();
  private screens: Record<ScreenId, HTMLElement> = {
    title: $('scr-title'),
    profile: $('scr-profile'),
    levels: $('scr-levels'),
    scores: $('scr-scores'),
    pause: $('scr-pause'),
    result: $('scr-result'),
    collapse: $('scr-collapse'),
    over: $('scr-over'),
  };
  private toastTimer = 0;
  current: ScreenId | null = 'title';

  constructor() {
    const mats = $('mats');
    MATERIAL_ORDER.forEach((id, i) => {
      const b = document.createElement('button');
      b.className = 'mat';
      b.dataset.mat = id;
      b.innerHTML = `<kbd>${i + 1}</kbd><i></i><span>${MATERIALS[id].name}</span><b>0</b>`;
      mats.appendChild(b);
      this.matBtns.set(id, b);
    });
  }

  onAction(handler: (act: string, el: HTMLElement) => void): void {
    document.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (el) handler(el.dataset.act!, el);
    });
  }

  show(id: ScreenId | null): void {
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('hidden', k !== id);
    this.current = id;
    if (id) {
      const primary = this.screens[id].querySelector<HTMLButtonElement>('.btn.primary:not(.hidden)');
      if (primary && matchMedia('(hover: hover)').matches) primary.focus({ preventScroll: true });
    }
  }

  setPlaying(on: boolean): void {
    this.hud.classList.toggle('hidden', !on);
    this.toolbar.classList.toggle('hidden', !on);
  }

  setLevel(level: LevelDef): void {
    this.hudNum.textContent = String(level.id).padStart(2, '0');
    this.hudName.textContent = level.name;
  }

  setLives(lives: number, max: number, anim: 'none' | 'lost' | 'gained' = 'none', el = this.hudLives): void {
    el.innerHTML = '';
    for (let i = 0; i < max; i++) {
      const h = document.createElement('i');
      if (i >= lives) h.className = 'lost';
      if (anim === 'lost' && i === lives) h.className = 'breaking';
      if (anim === 'gained' && i === lives - 1) h.className = 'gained';
      el.appendChild(h);
    }
  }

  setScore(score: number, bump = false): void {
    this.hudScore.textContent = score.toLocaleString('en-US');
    if (bump) {
      this.hudScore.classList.remove('bump');
      void this.hudScore.offsetWidth;
      this.hudScore.classList.add('bump');
    }
  }

  setMaterials(level: LevelDef, remaining: (m: MaterialId) => number, active: MaterialId): void {
    for (const [id, b] of this.matBtns) {
      const r = remaining(id);
      b.querySelector('b')!.textContent = level.budget[id] > 0 ? `${r}/${level.budget[id]}` : '—';
      b.classList.toggle('active', id === active);
      b.classList.toggle('locked', level.budget[id] <= 0);
      b.classList.toggle('empty', r <= 0);
    }
  }

  shakeMat(id: MaterialId): void {
    const b = this.matBtns.get(id);
    if (!b) return;
    b.classList.remove('shake');
    void b.offsetWidth;
    b.classList.add('shake');
  }

  setTesting(testing: boolean): void {
    this.testBtn.classList.toggle('stop', testing);
    this.testBtn.querySelector('.go-label')!.textContent = testing ? 'EDIT' : 'TEST';
    this.testBtn.querySelector('.go-icon')!.textContent = testing ? '✎' : '▶';
    for (const b of this.matBtns.values()) b.disabled = testing;
    this.undoBtn.disabled = this.redoBtn.disabled = this.clearBtn.disabled = testing;
  }

  setMuted(m: boolean): void {
    this.muteBtn.classList.toggle('off', m);
  }

  showToast(text: string, ms = 2600): void {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), ms);
  }

  hideToast(): void {
    this.toast.classList.remove('show');
  }

  titleInfo(top: HighScore | undefined, profile: Profile | null): void {
    $('title-best').textContent = top ? `BEST RUN · ${top.name} · ${top.score.toLocaleString('en-US')}` : '';
    $('title-engineer').innerHTML = profile ? `Engineer: <b>${escapeHtml(profile.name)}</b>` : '';
  }

  profiles(list: Profile[], storage: 'server' | 'local', error = ''): void {
    const box = $('profile-list');
    box.innerHTML = '';
    for (const p of list) {
      const b = document.createElement('button');
      b.className = 'profile-card';
      b.dataset.act = 'profile';
      b.dataset.name = p.name;
      b.innerHTML = `<b>${escapeHtml(p.name)}</b><span>★ ${p.stars} · L${p.unlocked}</span>`;
      box.appendChild(b);
    }
    $('profile-error').textContent = error;
    $('storage-note').textContent = storage === 'server' ? 'Saved to the SQLite database on the server.' : 'Saved in this browser (local storage).';
    this.show('profile');
    const input = $<HTMLInputElement>('profile-name');
    input.value = '';
    if (matchMedia('(hover: hover)').matches) setTimeout(() => input.focus(), 50);
  }

  profileError(msg: string): void {
    $('profile-error').textContent = msg;
  }

  levelGrid(levels: LevelDef[], save: Progress): void {
    const grid = $('level-grid');
    grid.innerHTML = '';
    for (const l of levels) {
      const best = save.best[l.id];
      const locked = l.id > save.unlocked;
      const b = document.createElement('button');
      b.className = `lvl-card${locked ? ' locked' : ''}`;
      b.dataset.act = 'pick';
      b.dataset.level = String(l.id);
      const stars = best ? '★'.repeat(best.stars) + '☆'.repeat(3 - best.stars) : '☆☆☆';
      b.innerHTML = `<span class="n">${String(l.id).padStart(2, '0')}</span><span class="t">${locked ? 'Locked' : l.name}</span><span class="s">${stars}</span><span class="b">${best ? best.score.toLocaleString('en-US') : '—'}</span>`;
      grid.appendChild(b);
    }
  }

  scoreTable(highs: HighScore[], tbodyId: 'score-rows' | 'over-rows', highlight = -1): void {
    const body = $(tbodyId);
    body.innerHTML = '';
    if (highs.length === 0) {
      body.innerHTML = '<tr><td class="empty" colspan="4">No runs yet. Be the first engineer on the board.</td></tr>';
      return;
    }
    highs.forEach((h, i) => {
      const tr = document.createElement('tr');
      if (i === highlight) tr.className = 'me';
      tr.innerHTML = `<td>${i + 1}.</td><td>${escapeHtml(h.name)}</td><td>L${h.levels}</td><td>${h.score.toLocaleString('en-US')}</td>`;
      body.appendChild(tr);
    });
  }

  result(level: LevelDef, s: LevelScore, peak: number, runLine: string, canRetry: boolean, isLast: boolean): void {
    const rows = $('res-rows');
    const lines: [string, string][] = [
      ['Bridge held', `${s.base}`],
      [`Unused parts × ${s.unused}`, `+${s.partsBonus}`],
      [`Safety (peak ${Math.round(peak * 100)}%)`, `+${s.safetyBonus}`],
    ];
    rows.innerHTML = lines.map(([a, b], i) => `<tr style="animation-delay:${0.25 + i * 0.18}s"><td>${a}</td><td>${b}</td></tr>`).join('');
    $('res-total').textContent = '0';
    $('res-run').textContent = runLine;
    for (const star of $('res-stars').querySelectorAll('i')) star.classList.remove('on');
    $('res-notes').innerHTML = `<span class="yes">★ Crossed</span><span class="${s.underPar ? 'yes' : ''}">★ ≤ ${level.par} parts (${s.used})</span><span class="${s.safe ? 'yes' : ''}">★ Peak stress &lt; 75%</span>`;
    $('res-retry').classList.toggle('hidden', !canRetry);
    $('res-next').innerHTML = `${isLast ? 'FINISH' : 'NEXT'} <kbd>Enter</kbd>`;
    this.show('result');
  }

  lightStar(i: number): void {
    $('res-stars').querySelectorAll('i')[i]?.classList.add('on');
  }

  setResultTotal(v: number): void {
    $('res-total').textContent = v.toLocaleString('en-US');
  }

  collapse(reason: string, lives: number | null, maxLives: number): void {
    $('col-reason').textContent = reason;
    const livesEl = $('col-lives');
    if (lives === null) {
      livesEl.innerHTML = '';
      $('col-note').textContent = 'Practice mode: no lives lost. Tweak and try again.';
    } else {
      this.setLives(lives, maxLives, 'lost', livesEl);
      $('col-note').textContent = lives === 1 ? 'Last life. Make it count.' : `${lives} lives left.`;
    }
    this.show('collapse');
  }

  over(victory: boolean, score: number, levels: number): void {
    const t = $('over-title');
    t.textContent = victory ? 'RUN COMPLETE' : 'GAME OVER';
    t.classList.toggle('win', victory);
    $('over-score').textContent = score.toLocaleString('en-US');
    $('over-sub').textContent = victory ? 'Every crossing held. The county thanks you.' : `You cleared ${levels} level${levels === 1 ? '' : 's'}.`;
    $('over-rank').textContent = '';
    this.show('over');
  }

  overRank(rank: number): void {
    $('over-rank').textContent = rank >= 0 ? `New high score! #${rank + 1} on the board.` : '';
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
