import { chapterComplete, chapterUnlocked, CHAPTERS, crossed, levelById, levelCode, levelUnlocked, totals, type Best, type BestMap, type ChapterDef } from '../chapters';
import { money } from '../editor';
import type { LevelDef } from '../levels';
import { MATERIAL_ORDER, MATERIALS, type MaterialId } from '../physics/materials';
import { levelBrief, traffic } from '../brief';
import { bonusLabel, GOAL_SCORE, type LevelScore } from '../scoring';
import type { BoardRow, HighScore, LevelRecord, Profile, Progress } from '../storage';

export type ScreenId = 'title' | 'profile' | 'chapters' | 'chapter' | 'scores' | 'workshop' | 'share' | 'mkhelp' | 'pause' | 'brief' | 'result' | 'collapse' | 'over';
type BoardTab = 'career' | 'chapter' | 'levels' | 'challenge';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Thin layer over the static DOM in index.html: no game logic lives here. */
export class Ui {
  hud = $('hud');
  toolbar = $('toolbar');
  hudNum = $('hud-num');
  hudName = $('hud-name');
  hudLives = $('hud-lives');
  hudScore = $('hud-score');
  hudGoal = $('hud-goal');
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
    chapters: $('scr-chapters'),
    chapter: $('scr-chapter'),
    scores: $('scr-scores'),
    workshop: $('scr-workshop'),
    share: $('scr-share'),
    mkhelp: $('scr-mkhelp'),
    pause: $('scr-pause'),
    brief: $('scr-brief'),
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
      b.innerHTML = `<kbd>${i + 1}</kbd><i></i><span class="full">${MATERIALS[id].name}</span><span class="short">${MATERIALS[id].short}</span><b>0</b><em hidden></em>`;
      if (MATERIALS[id].drivable) b.title = `${MATERIALS[id].name}: carries up to ${MATERIALS[id].rating} t`;
      else if (MATERIALS[id].stroke) b.title = `Hydraulic ram: extends by ${Math.round(MATERIALS[id].stroke * 100)}% to open a drawbridge`;
      mats.appendChild(b);
      this.matBtns.set(id, b);
    });
    const pills = $('board-chapters');
    for (const c of CHAPTERS) {
      const b = document.createElement('button');
      b.className = 'pill';
      b.dataset.act = 'board-chapter';
      b.dataset.chapter = String(c.id);
      b.textContent = String(c.id);
      b.title = c.name;
      pills.appendChild(b);
    }
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

  setLevel(level: LevelDef, code: string): void {
    this.hudNum.textContent = code;
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

  /** The line under the level name: a challenge total, or your best on this level. */
  setScore(text: string, bump = false): void {
    this.hudScore.textContent = text;
    if (bump) {
      this.hudScore.classList.remove('bump');
      void this.hudScore.offsetWidth;
      this.hudScore.classList.add('bump');
    }
  }

  /**
   * The level's bonus goal under the level name, marked once it has been met. `live` says how
   * the current blueprint stands, with an optional count, e.g. "18 now".
   */
  setGoal(label: string, met: boolean, live: 'met' | 'missed' | 'unknown' = 'unknown', now = ''): void {
    const mark = live === 'met' ? ' ✓' : live === 'missed' ? ' ✗' : '';
    this.hudGoal.textContent = `${BONUS_MARK} ${label}${now ? ` · ${now}` : ''}${mark}`;
    this.hudGoal.classList.toggle('met', met);
    this.hudGoal.classList.toggle('live-met', live === 'met');
    this.hudGoal.classList.toggle('live-missed', live === 'missed');
  }

  /** Shows or hides the stress graph dock; the toolbar steps aside for it. */
  setGraph(open: boolean): void {
    $('stress-dock').classList.toggle('hidden', !open);
    this.toolbar.classList.toggle('hidden', open);
  }

  /** Top edge of the stress dock, in CSS pixels, so the camera can frame the bridge above it. */
  graphTop(): number {
    return $('stress-dock').getBoundingClientRect().top;
  }

  setStressInfo(text: string): void {
    $('stress-info').textContent = text;
  }

  /** The level briefing: who crosses, the tip, the three stars, the bonus goal and any special rules. */
  brief(level: LevelDef, code: string, best: Best | undefined, example: boolean): void {
    const b = levelBrief(level);
    $('brief-code').textContent = code;
    $('brief-name').textContent = level.name;
    $('brief-traffic').textContent = b.traffic;
    $('brief-tip').textContent = b.tip;
    $('brief-goals').innerHTML = b.goals
      .map((g) => {
        const done = g.mark === '✦' && best?.bonus;
        return `<li class="${g.mark === '✦' ? 'bonus' : ''}${done ? ' done' : ''}"><i>${g.mark === '✦' ? BONUS_MARK : '★'}</i><div><b>${escapeHtml(g.text)}${done ? ' ✓' : ''}</b>${g.note ? `<small>${escapeHtml(g.note)}</small>` : ''}</div></li>`;
      })
      .join('');
    $('brief-rules').innerHTML = b.rules.map((r) => `<li>${escapeHtml(r)}</li>`).join('');
    $('brief-rules-box').classList.toggle('hidden', b.rules.length === 0);
    $('brief-example').classList.toggle('hidden', !example);
    $('brief-best').textContent = best ? `Your best: ${best.score.toLocaleString('en-US')} · ${starText(best.stars)}${best.bonus ? ` ${BONUS_MARK}` : ''}` : '';
    this.show('brief');
  }

  /** Toolbar state: prices, the active material, and what's affordable or still allowed. */
  setMaterials(level: LevelDef, active: MaterialId, left: number, partsLeft: (m: MaterialId) => number | null): void {
    for (const [id, b] of this.matBtns) {
      const price = MATERIALS[id].price;
      const parts = partsLeft(id);
      b.querySelector('b')!.textContent = `$${price}/m`;
      // Parts left on a level with a limit, as a badge opposite the key.
      const badge = b.querySelector('em')!;
      badge.hidden = parts === null;
      badge.textContent = `${parts ?? ''} left`;
      b.classList.toggle('active', id === active);
      // Materials a level doesn't offer are hidden so the toolbar stays compact on phones.
      b.classList.toggle('hidden', !level.materials.includes(id));
      // Can't afford even a one-meter piece, or none of this material is left.
      b.classList.toggle('empty', left < price || parts === 0);
    }
  }

  /** Budget meter: spent against the budget, with the star target marked. */
  setBudget(spent: number, budget: number, target: number): void {
    $('hud-spent').textContent = money(spent);
    $('hud-money').textContent = `/ ${money(budget)}`;
    $('hud-bar').style.width = `${Math.min(100, (spent / budget) * 100)}%`;
    const meter = $('hud-meter');
    meter.classList.toggle('over-target', spent > target);
    meter.classList.toggle('nearly-out', spent > budget * 0.9);
    $('hud-target').style.left = `${(target / budget) * 100}%`;
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
    $<HTMLButtonElement>('btn-brief').disabled = testing;
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

  // ───────────────────────────── Menus ─────────────────────────────

  /** Title screen: who is playing, their career so far, and where Continue will go. */
  title(profile: Profile | null, save: Progress, next: number): void {
    const t = totals(save.best);
    const allStars = CHAPTERS.reduce((n, c) => n + c.levels.length * 3, 0);
    const open = CHAPTERS.filter((c) => chapterUnlocked(c, save.best)).length;
    $('title-career').innerHTML = profile
      ? `<div><span>CAREER</span><b>${t.score.toLocaleString('en-US')}</b></div>` +
        `<div><span>STARS</span><b>★ ${t.stars}<small>/${allStars}</small></b></div>` +
        `<div><span>BONUS</span><b class="bonus">${BONUS_MARK} ${t.bonus}<small>/${allStars / 3}</small></b></div>` +
        `<div><span>CHAPTERS</span><b>${open}<small>/${CHAPTERS.length}</small></b></div>`
      : '';
    const level = levelById(next);
    $('continue-sub').textContent = crossed(save.best, next) ? `Replay ${levelCode(next)} · ${level.name}` : `${levelCode(next)} · ${level.name}`;
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
      b.innerHTML = `<b>${escapeHtml(p.name)}</b><span>★ ${p.stars} · ${p.score.toLocaleString('en-US')}</span>`;
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

  /** The chapter map: one card per chapter, with progress, difficulty and lock state. */
  chapters(best: BestMap): void {
    const grid = $('chapter-grid');
    grid.innerHTML = '';
    for (const c of CHAPTERS) {
      const open = chapterUnlocked(c, best);
      const done = chapterComplete(c, best);
      const t = totals(best, c.levels);
      const card = document.createElement('div');
      card.className = `ch-card${open ? '' : ' locked'}${done ? ' done' : ''}`;
      const prev = CHAPTERS[CHAPTERS.indexOf(c) - 1];
      card.innerHTML = `
        <button class="ch-open" data-act="chapter" data-chapter="${c.id}" ${open ? '' : 'aria-disabled="true"'}>
          <span class="ch-no">CHAPTER ${c.id}</span>
          <span class="ch-name">${c.name}</span>
          ${pips(c.difficulty)}
          <span class="ch-blurb">${c.blurb}</span>
          <span class="ch-effort">${c.effort}</span>
          <span class="ch-progress"><span class="bar"><i style="width:${(t.crossed / c.levels.length) * 100}%"></i></span><span>${t.crossed}/${c.levels.length} · ★ ${t.stars}/${c.levels.length * 3} · ${BONUS_MARK} ${t.bonus}/${c.levels.length}</span></span>
          ${open ? '' : `<span class="ch-lock">🔒 Finish ${prev.name} to unlock</span>`}
        </button>
        ${done ? `<button class="btn small ch-challenge" data-act="challenge" data-chapter="${c.id}">CHALLENGE</button>` : ''}`;
      grid.appendChild(card);
    }
  }

  /** One chapter's levels, in play order. */
  chapter(c: ChapterDef, best: BestMap): void {
    $('ch-kicker').innerHTML = `CHAPTER ${c.id} ${pips(c.difficulty)}`;
    $('ch-title').textContent = c.name;
    $('ch-blurb').textContent = `${c.blurb} ${c.effort}.`;
    const grid = $('level-grid');
    grid.innerHTML = '';
    c.levels.forEach((id, i) => {
      const l = levelById(id);
      const b = best[id];
      const open = levelUnlocked(id, best);
      const card = document.createElement('button');
      card.className = `lvl-card${open ? '' : ' locked'}${b && b.stars > 0 ? ' done' : ''}`;
      card.dataset.act = 'pick';
      card.dataset.level = String(id);
      card.innerHTML = `
        <span class="n">${levelCode(id)}<kbd>${i + 1}</kbd></span>
        <span class="t">${open ? l.name : 'Locked'}</span>
        <span class="meta">${open ? `${traffic(l)} · ${l.width} m · ${money(l.money)}` : 'Cross the level before'}</span>
        ${open ? `<span class="goal${b?.bonus ? ' met' : ''}">${BONUS_MARK} ${bonusLabel(l.bonus)}</span>` : ''}
        <span class="s">${starText(b?.stars ?? 0)}${b?.bonus ? `<em>${BONUS_MARK}</em>` : ''}</span>
        <span class="b">${b ? b.score.toLocaleString('en-US') : '—'}</span>`;
      grid.appendChild(card);
    });
    const ch = $<HTMLButtonElement>('ch-challenge');
    ch.dataset.chapter = String(c.id);
    ch.classList.toggle('hidden', !chapterComplete(c, best));
  }

  // ───────────────────────────── Leaderboards ─────────────────────────────

  boardTabs(tab: BoardTab, chapter: number): void {
    for (const t of ['career', 'chapter', 'levels', 'challenge'] as const) {
      const el = $(`tab-${t}`);
      el.classList.toggle('on', t === tab);
      el.setAttribute('aria-selected', String(t === tab));
    }
    const pills = $('board-chapters');
    pills.classList.toggle('hidden', tab === 'career');
    for (const p of pills.querySelectorAll<HTMLElement>('.pill')) p.classList.toggle('on', Number(p.dataset.chapter) === chapter);
    const name = CHAPTERS[chapter - 1].name;
    $('board-note').textContent = {
      career: 'Every engineer, ranked by the sum of their best score on every level.',
      chapter: `Ranked by best scores on the five levels of ${name}.`,
      levels: `The best single-level score on each level of ${name}.`,
      challenge: `${name} played in a row, from scratch, with three lives.`,
    }[tab];
    $('score-rows').innerHTML = '<tr><td class="empty" colspan="4">Loading…</td></tr>';
  }

  /** Career or chapter ranking. */
  rankTable(rows: BoardRow[], me: string, kind: 'career' | 'chapter'): void {
    const body = $('score-rows');
    body.innerHTML = '';
    if (rows.length === 0) {
      body.innerHTML = `<tr><td class="empty" colspan="4">No one has crossed ${kind === 'career' ? 'a level' : 'this chapter'} yet.</td></tr>`;
      return;
    }
    rows.slice(0, 50).forEach((r, i) => {
      const tr = document.createElement('tr');
      if (r.name.toLowerCase() === me.toLowerCase()) tr.className = 'mine';
      tr.innerHTML = `<td>${i + 1}.</td><td>${escapeHtml(r.name)}<small>${r.levels} level${r.levels === 1 ? '' : 's'}</small></td><td class="st">★ ${r.stars}</td><td>${r.score.toLocaleString('en-US')}</td>`;
      body.appendChild(tr);
    });
  }

  /** Challenge runs for one chapter; also used on the challenge-over screen. */
  challengeTable(highs: HighScore[], tbodyId: 'score-rows' | 'over-rows', me: string, highlight = -1): void {
    const body = $(tbodyId);
    body.innerHTML = '';
    if (highs.length === 0) {
      body.innerHTML = '<tr><td class="empty" colspan="4">No challenge runs yet. Finish the chapter, then take it on.</td></tr>';
      return;
    }
    highs.forEach((h, i) => {
      const tr = document.createElement('tr');
      if (i === highlight) tr.className = 'me';
      else if (me && h.name.toLowerCase() === me.toLowerCase()) tr.className = 'mine';
      tr.innerHTML = `<td>${i + 1}.</td><td>${escapeHtml(h.name)}<small>${h.date}</small></td><td>${h.levels}/5</td><td>${h.score.toLocaleString('en-US')}</td>`;
      body.appendChild(tr);
    });
  }

  /** One row per level: the record holder, plus your own best when someone else holds it. */
  levelRecordTable(levels: LevelDef[], records: LevelRecord[], mine: Progress, me: string): void {
    const body = $('score-rows');
    body.innerHTML = '';
    for (const l of levels) {
      const r = records.find((x) => x.level === l.id);
      const own = mine.best[l.id];
      const tr = document.createElement('tr');
      const holder = !!r && r.name.toLowerCase() === me.toLowerCase();
      if (holder) tr.className = 'mine';
      const you = own && !holder ? `<small>you ${own.score.toLocaleString('en-US')}</small>` : '';
      tr.innerHTML = r
        ? `<td>${levelCode(l.id)}</td><td>${escapeHtml(r.name)}${you}</td><td class="st">${starText(r.stars)}</td><td>${r.score.toLocaleString('en-US')}</td>`
        : `<td>${levelCode(l.id)}</td><td class="open">${escapeHtml(l.name)}: open</td><td></td><td>—</td>`;
      body.appendChild(tr);
    }
  }

  // ───────────────────────────── Results ─────────────────────────────

  result(level: LevelDef, s: LevelScore, peak: number, runLine: string, canRetry: boolean, nextLabel: string): void {
    const rows = $('res-rows');
    const lines: [string, string][] = [
      ['Bridge held', `${s.base}`],
      [`Budget left ${money(level.money - s.spent)}`, `+${s.savingsBonus}`],
      [`Safety (peak ${Math.round(peak * 100)}%)`, `+${s.safetyBonus}`],
      [`Bonus goal: ${bonusLabel(level.bonus)}`, s.bonus ? `+${GOAL_SCORE}` : 'missed'],
    ];
    rows.innerHTML = lines.map(([a, b], i) => `<tr style="animation-delay:${0.25 + i * 0.18}s"><td>${a}</td><td>${b}</td></tr>`).join('');
    $('res-total').textContent = '0';
    $('res-run').textContent = runLine;
    for (const star of $('res-stars').querySelectorAll('i')) star.classList.remove('on');
    $('res-notes').innerHTML =
      `<span class="yes">★ Crossed</span><span class="${s.underTarget ? 'yes' : ''}">★ Built for ≤ ${money(level.target)} (${money(s.spent)})</span><span class="${s.safe ? 'yes' : ''}">★ Peak stress &lt; 75%</span>` +
      `<span class="bonus${s.bonus ? ' yes' : ''}">${BONUS_MARK} ${bonusLabel(level.bonus)}</span>`;
    $('res-retry').classList.toggle('hidden', !canRetry);
    $('res-next').innerHTML = `${nextLabel} <kbd>Enter</kbd>`;
    this.show('result');
  }

  lightStar(i: number): void {
    $('res-stars').querySelectorAll('i:not(.bonus)')[i]?.classList.add('on');
  }

  lightBonus(): void {
    $('res-stars').querySelector('i.bonus')?.classList.add('on');
  }

  setResultTotal(v: number): void {
    $('res-total').textContent = v.toLocaleString('en-US');
  }

  /**
   * Fits the pause menu to where you are: back to the drawing board only while a test runs,
   * and back to the level editor, not the menus, from a playtest.
   */
  pauseMenu(testing: boolean, playtest: boolean): void {
    $('pause-retry').classList.toggle('hidden', !testing);
    $('pause-quit').innerHTML = playtest ? 'EDIT LEVEL <kbd>Q</kbd>' : 'QUIT TO MENU <kbd>Q</kbd>';
  }

  collapse(reason: string, lives: number | null, maxLives: number, playtest = false): void {
    $('col-quit').innerHTML = playtest ? 'EDIT LEVEL <kbd>Esc</kbd>' : 'MENU <kbd>Esc</kbd>';
    $('col-reason').textContent = reason;
    const livesEl = $('col-lives');
    if (lives === null) {
      livesEl.innerHTML = '';
      $('col-note').textContent = playtest ? 'Just a playtest. Retry the bridge, or edit the level.' : 'No penalty in free play. Tweak the design and try again.';
    } else {
      this.setLives(lives, maxLives, 'lost', livesEl);
      $('col-note').textContent = lives === 1 ? 'Last life. Make it count.' : `${lives} lives left.`;
    }
    this.show('collapse');
  }

  over(victory: boolean, score: number, levels: number, chapter: ChapterDef): void {
    const t = $('over-title');
    t.textContent = victory ? 'CHALLENGE COMPLETE' : 'CHALLENGE OVER';
    t.classList.toggle('win', victory);
    $('over-score').textContent = score.toLocaleString('en-US');
    $('over-sub').textContent = victory
      ? `Every crossing in ${chapter.name} held.`
      : `You cleared ${levels} of ${chapter.levels.length} level${levels === 1 ? '' : 's'} in ${chapter.name}.`;
    $('over-rank').textContent = '';
    this.show('over');
  }

  overRank(rank: number): void {
    $('over-rank').textContent = rank >= 0 ? `New high score! #${rank + 1} on the board.` : '';
  }
}

/** Marks the bonus star wherever it is shown. */
export const BONUS_MARK = '✦';

/** Difficulty as filled and empty pips. */
function pips(n: number): string {
  return `<span class="pips" aria-label="Difficulty ${n} of ${CHAPTERS.length}">${'<i class="on"></i>'.repeat(n)}${'<i></i>'.repeat(CHAPTERS.length - n)}</span>`;
}

function starText(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
