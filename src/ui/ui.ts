import { chapterById, chapterComplete, chapterNumber, chapterUnlocked, CHAPTERS, continueLevel, crossed, levelById, levelCode, levelUnlocked, totals, type Best, type BestMap, type ChapterDef } from '../chapters';
import { mapLayout } from './chaptermap';
import { money } from '../editor';
import type { LevelDef } from '../levels';
import { MATERIAL_ORDER, MATERIALS, type MaterialId } from '../physics/materials';
import { levelBrief, traffic } from '../brief';
import { bonusLabel, GOAL_SCORE, SAFE_STRESS, type LevelScore } from '../scoring';
import { platform, uiProfile, type BillingStatus, type GamesStatus } from '../platform';
import type { BoardRow, HighScore, LevelRecord, Profile, Progress } from '../storage';
import { fmt, t, tn } from '../i18n';
import { chapterText, levelName, matName, matShort } from '../i18n/data';
import { escapeHtml } from '../i18n/dom';
import { motion } from '../motion';

export type ScreenId = 'title' | 'profile' | 'chapters' | 'chapter' | 'scores' | 'workshop' | 'share' | 'mkhelp' | 'pause' | 'settings' | 'done' | 'confirm' | 'unlock' | 'brief' | 'result' | 'collapse' | 'over';
type BoardTab = 'career' | 'chapter' | 'levels' | 'challenge';
/** How the chapters screen shows them: a road of level nodes, or pages of chapter cards. */
export type ChaptersView = 'map' | 'book';

/** Chapter cards on one page of the book. */
export const BOOK_PAGE = 6;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

/** How long a screen takes to fade out as the next comes in, ms (style.css .leaving). */
const LEAVE_MS = 160;

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
    settings: $('scr-settings'),
    done: $('scr-done'),
    confirm: $('scr-confirm'),
    unlock: $('scr-unlock'),
    brief: $('scr-brief'),
    result: $('scr-result'),
    collapse: $('scr-collapse'),
    over: $('scr-over'),
  };
  private toastTimer = 0;
  /** Screens fading out, and when each goes. */
  private leaving = new Map<ScreenId, number>();
  current: ScreenId | null = 'title';
  /** Chapters behind the full-game unlock, marked as such wherever chapters are shown. */
  forSale: (c: ChapterDef) => boolean = () => false;

  constructor() {
    const mats = $('mats');
    MATERIAL_ORDER.forEach((id, i) => {
      const b = document.createElement('button');
      b.className = 'mat';
      b.dataset.mat = id;
      b.innerHTML = `<kbd>${(i + 1) % 10}</kbd><i></i><span class="full"></span><span class="short"></span><b>0</b><em hidden></em>`;
      mats.appendChild(b);
      this.matBtns.set(id, b);
    });
    const pills = $('board-chapters');
    for (const c of CHAPTERS) {
      const b = document.createElement('button');
      b.className = 'pill';
      b.dataset.act = 'board-chapter';
      b.dataset.chapter = String(c.id);
      b.textContent = String(chapterNumber(c));
      pills.appendChild(b);
    }
    this.relabel();
  }

  /** Text this class wrote once at start, written again in the current language. */
  relabel(): void {
    for (const [id, b] of this.matBtns) {
      b.querySelector('.full')!.textContent = matName(id);
      b.querySelector('.short')!.textContent = matShort(id);
      if (MATERIALS[id].drivable) b.title = t('mat.deckTitle', { name: matName(id), t: MATERIALS[id].rating ?? 0 });
      else if (MATERIALS[id].stroke) b.title = t('mat.ramTitle', { pct: fmt.pct(MATERIALS[id].stroke) });
    }
    for (const p of $('board-chapters').querySelectorAll<HTMLElement>('.pill')) p.title = chapterText(chapterById(Number(p.dataset.chapter))!, 'name');
  }

  onAction(handler: (act: string, el: HTMLElement) => void): void {
    document.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (el) handler(el.dataset.act!, el);
    });
  }

  /**
   * Shows one screen, or none. The one being left fades out for a moment, deaf to clicks, while
   * the new one comes in (at once, with reduced motion).
   */
  show(id: ScreenId | null): void {
    for (const [k, el] of Object.entries(this.screens) as [ScreenId, HTMLElement][]) {
      clearTimeout(this.leaving.get(k));
      if (k === id || el.classList.contains('hidden') || motion.reduced) {
        el.classList.remove('leaving');
        el.classList.toggle('hidden', k !== id);
        continue;
      }
      el.classList.add('leaving');
      this.leaving.set(
        k,
        window.setTimeout(() => {
          el.classList.remove('leaving');
          el.classList.add('hidden');
        }, LEAVE_MS),
      );
    }
    this.current = id;
    if (id) {
      const primary = this.screens[id].querySelector<HTMLButtonElement>('.btn.primary:not(.hidden)');
      // A keyboard can press it at once; on a touch screen, focus would only draw a ring.
      if (primary && uiProfile === 'desktop') primary.focus({ preventScroll: true });
    }
  }

  setPlaying(on: boolean): void {
    this.hud.classList.toggle('hidden', !on);
    this.toolbar.classList.toggle('hidden', !on);
  }

  setLevel(level: LevelDef, code: string): void {
    this.hudNum.textContent = code;
    this.hudName.textContent = levelName(level);
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
  brief(level: LevelDef, code: string, best: Best | undefined, example: boolean, hints: { shown: number; penalty: number; left: boolean } | null = null): void {
    const b = levelBrief(level);
    $('brief-code').textContent = code;
    $('brief-name').textContent = levelName(level);
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
    $('brief-best').textContent = best
      ? t('brief.best', { details: [fmt.num(best.score), `${starText(best.stars)}${best.bonus ? ` ${BONUS_MARK}` : ''}`, ...(best.cost === undefined ? [] : [money(best.cost)])].join(' · ') })
      : '';
    // The engineer's hints: each shows one member of the best known design, for points off every score here.
    const hint = $('brief-hint');
    hint.classList.toggle('hidden', !hints?.left);
    hint.innerHTML = `${t('brief.hint')} <small>−${fmt.num(hints?.penalty ?? 0)}</small>`;
    hint.title = tn('brief.hintTitle', hints?.penalty ?? 0);
    $('brief-hints').textContent = hints?.shown ? t('brief.hintsTaken', { n: hints.shown, points: hints.shown * hints.penalty }) : '';
    this.show('brief');
  }

  /** Toolbar state: prices, the active material, and what's affordable or still allowed. */
  setMaterials(level: LevelDef, active: MaterialId, left: number, partsLeft: (m: MaterialId) => number | null): void {
    for (const [id, b] of this.matBtns) {
      const price = MATERIALS[id].price;
      const parts = partsLeft(id);
      b.querySelector('b')!.textContent = t('mat.price', { price: money(price) });
      // Parts left on a level with a limit, as a badge opposite the key.
      const badge = b.querySelector('em')!;
      badge.hidden = parts === null;
      badge.textContent = parts === null ? '' : tn('mat.left', parts);
      b.classList.toggle('active', id === active);
      // Materials a level doesn't offer are hidden so the toolbar stays compact on phones. The
      // keys number the ones it does, in toolbar order.
      b.classList.toggle('hidden', !level.materials.includes(id));
      const key = offeredInOrder(level).indexOf(id);
      b.querySelector('kbd')!.textContent = key >= 0 && key < 10 ? String((key + 1) % 10) : '';
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
    this.testBtn.querySelector('.go-label')!.textContent = t(testing ? 'tool.edit' : 'tool.test');
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
    const sum = totals(save.best);
    const allStars = CHAPTERS.reduce((n, c) => n + c.levels.length * 3, 0);
    const open = CHAPTERS.filter((c) => chapterUnlocked(c, save.best)).length;
    $('title-career').innerHTML = profile
      ? `<div><span>${t('title.career')}</span><b>${fmt.num(sum.score)}</b></div>` +
        `<div><span>${t('title.stars')}</span><b>★ ${sum.stars}<small>/${allStars}</small></b></div>` +
        `<div><span>${t('title.bonus')}</span><b class="bonus">${BONUS_MARK} ${sum.bonus}<small>/${allStars / 3}</small></b></div>` +
        `<div><span>${t('title.chapterCount')}</span><b>${open}<small>/${CHAPTERS.length}</small></b></div>`
      : '';
    const level = levelById(next);
    const name = levelName(level);
    $('continue-sub').textContent = crossed(save.best, next) ? t('title.replay', { code: levelCode(next), name }) : `${levelCode(next)} · ${name}`;
    $('title-engineer').innerHTML = profile ? t('title.engineer', { name: escapeHtml(profile.name) }) : '';
    $('title-unlock').classList.toggle('hidden', !CHAPTERS.some((c) => this.forSale(c)));
  }

  profiles(list: Profile[], storage: 'server' | 'local', error = ''): void {
    const box = $('profile-list');
    box.innerHTML = '';
    for (const p of list) {
      const b = document.createElement('button');
      b.className = 'profile-card';
      b.dataset.act = 'profile';
      b.dataset.name = p.name;
      b.innerHTML = `<b>${escapeHtml(p.name)}</b><span>★ ${p.stars} · ${fmt.num(p.score)}</span>`;
      box.appendChild(b);
    }
    $('profile-error').textContent = error;
    $('storage-note').textContent = t(storage === 'server' ? 'storage.server' : platform === 'android' ? 'storage.android' : platform === 'desktop' ? 'storage.desktop' : 'storage.web');
    this.show('profile');
    const input = $<HTMLInputElement>('profile-name');
    input.value = '';
    if (uiProfile === 'desktop') setTimeout(() => input.focus(), 50);
  }

  profileError(msg: string): void {
    $('profile-error').textContent = msg;
  }

  /**
   * The chapters screen, as the progression map or as one page of the chapter book. `opened`: a
   * chapter just opened by finishing the one before, whose road is laid in as the screen shows.
   */
  chapters(best: BestMap, view: ChaptersView, page: number, opened?: ChapterDef): void {
    for (const v of ['map', 'book'] as const) {
      $(`view-${v}`).classList.toggle('on', v === view);
      $(`view-${v}`).setAttribute('aria-pressed', String(v === view));
    }
    $('chapter-map').classList.toggle('hidden', view !== 'map');
    $('chapter-book').classList.toggle('hidden', view !== 'book');
    $('chapters-note').textContent = t(view === 'map' ? 'chapters.noteMap' : 'chapters.noteBook');
    if (view === 'map') this.chapterMap(best, opened);
    else this.chapterBook(best, page, opened);
  }

  /** Every level as a node on one winding road, with each chapter's heading, the next level lit and the rest locked. */
  private chapterMap(best: BestMap, opened?: ChapterDef): void {
    const box = $('chapter-map');
    const layout = mapLayout(CHAPTERS, box.clientWidth || 360);
    const next = continueLevel(best);
    const order = layout.nodes.map((n) => n.id);
    // The road is paved up to the furthest level crossed, and dashed beyond.
    const reached = Math.max(0, ...order.map((id, i) => (crossed(best, id) ? i : 0)));
    const legs = (from: number, to: number) => layout.legs.slice(from, to).join('');
    // The leg into a chapter just opened is drawn in, unless the road is already paved past it.
    const fresh = opened && !this.forSale(opened) ? order.indexOf(opened.levels[0]) - 1 : -1;
    const opening = fresh >= reached ? layout.legs[fresh] : '';
    const ahead = opening ? legs(reached, fresh) + legs(fresh + 1, layout.legs.length) : legs(reached, layout.legs.length);
    let html = `<svg class="map-road" width="${layout.width}" height="${layout.height}" aria-hidden="true">
      ${opening ? `<defs><mask id="map-reveal"><path class="reveal" pathLength="1" d="${opening}"/></mask></defs>` : ''}
      <path class="ahead" d="${ahead}"/>
      ${opening ? `<path class="ahead opening" mask="url(#map-reveal)" d="${opening}"/>` : ''}
      <path class="paved" d="${legs(0, reached)}"/>
    </svg>`;
    for (const h of layout.heads) {
      const c = chapterById(h.chapter)!;
      const sum = totals(best, c.levels);
      const sale = this.forSale(c);
      const open = chapterUnlocked(c, best) && !sale;
      html += `<div class="map-head${open ? '' : sale ? ' for-sale' : ' locked'}${opening && c === opened ? ' fresh' : ''}" style="top:${h.y}px">
        <button class="map-title" data-act="chapter" data-chapter="${c.id}" ${open ? '' : 'aria-disabled="true"'}><span class="ch-no">${t('map.ch', { n: chapterNumber(c) })}</span> ${escapeHtml(chapterText(c, 'name'))}</button>
        ${sale ? `<button class="full-tag" data-act="unlock" title="${t('map.fullTitle')}">${t('map.fullGame')}</button>` : `<span class="map-stars">★ ${sum.stars}/${c.levels.length * 3}</span>`}
        ${chapterComplete(c, best) && !sale ? challengeButton(c) : ''}
      </div>`;
    }
    for (const n of layout.nodes) {
      const l = levelById(n.id);
      const b = best[n.id];
      const sale = this.forSale(chapterById(n.chapter)!);
      const open = levelUnlocked(n.id, best) && !sale;
      const state = sale ? 'locked' : b && b.stars > 0 ? 'done' : n.id === next ? 'next' : open ? 'open' : 'locked';
      const name = escapeHtml(levelName(l));
      html += `<button class="map-node ${state}" style="left:${n.x}px;top:${n.y}px" data-act="pick" data-level="${n.id}" title="${levelCode(n.id)} · ${open ? name : t(sale ? 'map.full' : 'map.locked')}" ${open ? '' : 'aria-disabled="true"'}>
        <span class="dot">${state === 'locked' ? '🔒' : levelCode(n.id)}</span>
        <span class="name">${open ? name : ''}</span>
        <span class="stars">${open ? starText(b?.stars ?? 0) : ''}${b?.bonus ? `<em>${BONUS_MARK}</em>` : ''}</span>
      </button>`;
    }
    box.innerHTML = `<div class="map" style="height:${layout.height}px">${html}</div>`;
  }

  /** Scrolls the map so the next level to play is in view. */
  showNextOnMap(best: BestMap, smooth = false): void {
    const box = $('chapter-map');
    const node = box.querySelector<HTMLElement>(`.map-node[data-level="${continueLevel(best)}"]`);
    if (node) box.scrollTo({ top: node.offsetTop - box.clientHeight / 2, behavior: smooth ? 'smooth' : 'instant' });
  }

  /** One page of chapter cards, with progress, difficulty and lock state, and the arrows and dots to turn pages. */
  private chapterBook(best: BestMap, page: number, opened?: ChapterDef): void {
    const pages = Math.ceil(CHAPTERS.length / BOOK_PAGE);
    const grid = $('chapter-grid');
    grid.innerHTML = '';
    for (const c of CHAPTERS.slice(page * BOOK_PAGE, (page + 1) * BOOK_PAGE)) {
      const sale = this.forSale(c);
      const open = chapterUnlocked(c, best) && !sale;
      const done = chapterComplete(c, best);
      const sum = totals(best, c.levels);
      const card = document.createElement('div');
      card.className = `ch-card${open ? '' : ' locked'}${done ? ' done' : ''}${c === opened && open ? ' fresh' : ''}`;
      const prev = CHAPTERS[CHAPTERS.indexOf(c) - 1];
      card.innerHTML = `
        <button class="ch-open" data-act="chapter" data-chapter="${c.id}" ${open ? '' : 'aria-disabled="true"'}>
          <span class="ch-no"><span class="long">${t('book.chapter')}</span><span class="short">${t('book.ch')}</span> ${chapterNumber(c)}</span>
          <span class="ch-name">${escapeHtml(chapterText(c, 'name'))}</span>
          ${pips(c.difficulty)}
          <span class="ch-blurb">${escapeHtml(chapterText(c, 'blurb'))}</span>
          <span class="ch-effort">${escapeHtml(chapterText(c, 'effort'))}</span>
          <span class="ch-progress"><span class="bar"><i style="width:${(sum.crossed / c.levels.length) * 100}%"></i></span><span class="long">★ ${sum.stars}/${c.levels.length * 3} · ${BONUS_MARK} ${sum.bonus}/${c.levels.length}</span><span class="short">★ ${sum.stars}/${c.levels.length * 3}</span></span>
          ${
            open
              ? ''
              : sale
                ? `<span class="ch-lock sale"><span class="long">${t('book.saleLong')}</span><span class="short">${t('book.saleShort')}</span></span>`
                : `<span class="ch-lock"><span class="long">${t('book.lockLong', { name: escapeHtml(chapterText(prev, 'name')) })}</span><span class="short">${t('book.lockShort')}</span></span>`
          }
        </button>
        ${done && !sale ? challengeButton(c) : ''}`;
      grid.appendChild(card);
    }
    $<HTMLButtonElement>('book-prev').disabled = page <= 0;
    $<HTMLButtonElement>('book-next').disabled = page >= pages - 1;
    $('book-dots').innerHTML = Array.from(
      { length: pages },
      (_, i) => `<button class="book-dot${i === page ? ' on' : ''}" data-act="book-page" data-page="${i}" aria-label="${t('book.page', { n: i + 1, of: pages })}"></button>`,
    ).join('');
  }

  /** One chapter's levels, in play order. */
  chapter(c: ChapterDef, best: BestMap): void {
    $('ch-kicker').innerHTML = `${t('chapter.kicker', { n: chapterNumber(c) })} ${pips(c.difficulty)}`;
    $('ch-title').textContent = chapterText(c, 'name');
    $('ch-blurb').textContent = t('chapter.blurb', { blurb: chapterText(c, 'blurb'), effort: chapterText(c, 'effort') });
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
        <span class="t">${open ? escapeHtml(levelName(l)) : t('level.locked')}</span>
        <span class="meta">${open ? `${escapeHtml(traffic(l))} · ${l.width} m · ${money(l.money)}` : t('level.lockedMeta')}</span>
        ${open ? `<span class="goal${b?.bonus ? ' met' : ''}">${BONUS_MARK} ${escapeHtml(bonusLabel(l.bonus))}</span>` : ''}
        <span class="s">${starText(b?.stars ?? 0)}${b?.bonus ? `<em>${BONUS_MARK}</em>` : ''}</span>
        <span class="b">${b ? fmt.num(b.score) : '—'}</span>`;
      grid.appendChild(card);
    });
    const ch = $<HTMLButtonElement>('ch-challenge');
    ch.dataset.chapter = String(c.id);
    ch.classList.toggle('hidden', !chapterComplete(c, best));
  }

  // ───────────────────────────── Leaderboards ─────────────────────────────

  /** Marks the tab and the chapter (by id) a leaderboard shows. */
  boardTabs(tab: BoardTab, chapter: number): void {
    for (const name of ['career', 'chapter', 'levels', 'challenge'] as const) {
      const el = $(`tab-${name}`);
      el.classList.toggle('on', name === tab);
      el.setAttribute('aria-selected', String(name === tab));
    }
    const pills = $('board-chapters');
    pills.classList.toggle('hidden', tab === 'career');
    for (const p of pills.querySelectorAll<HTMLElement>('.pill')) p.classList.toggle('on', Number(p.dataset.chapter) === chapter);
    const ch = chapterById(chapter) ?? CHAPTERS[0];
    const name = chapterText(ch, 'name');
    $('board-note').textContent = {
      career: () => t('board.career'),
      chapter: () => tn('board.chapter', ch.levels.length, { name }),
      levels: () => t('board.levels', { name }),
      challenge: () => t('board.challenge', { name }),
    }[tab]();
    $('score-rows').innerHTML = `<tr><td class="empty" colspan="4">${t('board.loading')}</td></tr>`;
  }

  /** Career or chapter ranking. */
  rankTable(rows: BoardRow[], me: string, kind: 'career' | 'chapter'): void {
    const body = $('score-rows');
    body.innerHTML = '';
    if (rows.length === 0) {
      body.innerHTML = `<tr><td class="empty" colspan="4">${t(kind === 'career' ? 'board.emptyCareer' : 'board.emptyChapter')}</td></tr>`;
      return;
    }
    rows.slice(0, 50).forEach((r, i) => {
      const tr = document.createElement('tr');
      if (r.name.toLowerCase() === me.toLowerCase()) tr.className = 'mine';
      tr.innerHTML = `<td>${i + 1}.</td><td>${escapeHtml(r.name)}<small>${tn('board.levelCount', r.levels)}</small></td><td class="st">★ ${r.stars}</td><td>${fmt.num(r.score)}</td>`;
      body.appendChild(tr);
    });
  }

  /** Challenge runs for one chapter; also used on the challenge-over screen. */
  challengeTable(highs: HighScore[], tbodyId: 'score-rows' | 'over-rows', me: string, highlight = -1): void {
    const body = $(tbodyId);
    body.innerHTML = '';
    if (highs.length === 0) {
      body.innerHTML = `<tr><td class="empty" colspan="4">${t('board.emptyChallenge')}</td></tr>`;
      return;
    }
    highs.forEach((h, i) => {
      const tr = document.createElement('tr');
      if (i === highlight) tr.className = 'me';
      else if (me && h.name.toLowerCase() === me.toLowerCase()) tr.className = 'mine';
      tr.innerHTML = `<td>${i + 1}.</td><td>${escapeHtml(h.name)}<small>${h.date}</small></td><td>${h.levels}/5</td><td>${fmt.num(h.score)}</td>`;
      body.appendChild(tr);
    });
  }

  /**
   * One row per level: the record holder, with what the record bridge cost and its peak stress,
   * plus your own best when someone else holds it. A record bridge that was kept can be watched
   * once you've crossed the level yourself.
   */
  levelRecordTable(levels: LevelDef[], records: LevelRecord[], mine: Progress, me: string): void {
    const body = $('score-rows');
    body.innerHTML = '';
    for (const l of levels) {
      const r = records.find((x) => x.level === l.id);
      const own = mine.best[l.id];
      const tr = document.createElement('tr');
      const holder = !!r && r.name.toLowerCase() === me.toLowerCase();
      if (holder) tr.className = 'mine';
      const you = own && !holder ? `<small>${t('board.you', { score: own.score })}</small>` : '';
      const detail = r ? recordDetail(r) : '';
      const crossedIt = (own?.stars ?? 0) > 0;
      const view = r?.hasDesign
        ? crossedIt
          ? `<button class="link-btn rec-view" data-act="record-view" data-level="${l.id}" data-name="${escapeHtml(r.name)}">${t('board.watch')}</button>`
          : `<small class="rec-locked">${t('board.crossToWatch')}</small>`
        : '';
      tr.innerHTML = r
        ? `<td>${levelCode(l.id)}</td><td>${escapeHtml(r.name)}${detail ? `<small>${detail}</small>` : ''}${you}${view}</td><td class="st">${starText(r.stars)}</td><td>${fmt.num(r.score)}</td>`
        : `<td>${levelCode(l.id)}</td><td class="open">${escapeHtml(t('board.open', { name: levelName(l) }))}</td><td></td><td>—</td>`;
      body.appendChild(tr);
    }
  }

  // ───────────────────────────── Results ─────────────────────────────

  /**
   * The result card. `review` is the engineer's notes on the bridge: how its cost compares with
   * the best known design, and material it barely used.
   */
  result(level: LevelDef, s: LevelScore, peak: number, runLine: string, canRetry: boolean, nextLabel: string, review: string[] = []): void {
    const rows = $('res-rows');
    const lines: [string, string][] = [
      [t('result.held'), fmt.num(s.base)],
      [t('result.budgetLeft', { money: money(level.money - s.spent) }), `+${fmt.num(s.savingsBonus)}`],
      [t('result.safety', { pct: fmt.pct(peak) }), `+${fmt.num(s.safetyBonus)}`],
      [t('result.bonusGoal', { label: bonusLabel(level.bonus) }), s.bonus ? `+${fmt.num(GOAL_SCORE)}` : t('result.missed')],
    ];
    if (s.lost) lines.splice(1, 0, [t('result.squadLost'), t('result.oneStar')]);
    if (s.hintPenalty) lines.push([t('result.hints'), `−${fmt.num(s.hintPenalty)}`]);
    $('res-review').innerHTML = review.length ? `<b>${t('result.review')}</b><ul>${review.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : '';
    rows.innerHTML = lines.map(([a, b], i) => `<tr style="animation-delay:${0.25 + i * 0.18}s"><td>${escapeHtml(a)}</td><td>${escapeHtml(b)}</td></tr>`).join('');
    $('res-total').textContent = '0';
    $('res-run').textContent = runLine;
    for (const star of $('res-stars').querySelectorAll('i')) star.classList.remove('on');
    $('scr-result').querySelector('.panel')!.classList.remove('perfect');
    $('res-ribbon').classList.remove('show');
    $('res-notes').innerHTML =
      `<span class="yes">${t('result.crossed')}</span><span class="${s.underTarget ? 'yes' : ''}">${escapeHtml(t('result.underTarget', { target: money(level.target), spent: money(s.spent) }))}</span>` +
      `<span class="${s.safe ? 'yes' : ''}">${escapeHtml(t('result.safe', { pct: fmt.pct(SAFE_STRESS) }))}</span>` +
      `<span class="bonus${s.bonus ? ' yes' : ''}">${BONUS_MARK} ${escapeHtml(bonusLabel(level.bonus))}</span>`;
    $('res-retry').classList.toggle('hidden', !canRetry);
    $('res-next').innerHTML = `${nextLabel} <kbd>Enter</kbd>`;
    this.show('result');
  }

  lightStar(i: number): void {
    $('res-stars').querySelectorAll('i:not(.bonus)')[i]?.classList.add('on');
  }

  /** All three stars: a gold sweep over the card and confetti from its top. */
  perfect(): void {
    const panel = $('scr-result').querySelector<HTMLElement>('.panel')!;
    panel.classList.add('perfect');
    this.confetti($('scr-result'), panel, 46);
  }

  /** The score beat the player's best on this level. */
  showRibbon(): void {
    $('res-ribbon').classList.add('show');
  }

  /** Paper confetti bursting from the top of `from`, drawn over `host` (the canvas's sits under the dim). */
  confetti(host: HTMLElement, from: HTMLElement, n: number): void {
    if (motion.reduced) return;
    const box = from.getBoundingClientRect();
    const colors = ['var(--gold)', 'var(--bolt)', 'var(--ok)', 'var(--cyan)', 'var(--chalk)'];
    for (let i = 0; i < n; i++) {
      const bit = document.createElement('i');
      bit.className = 'confetti';
      const spread = (Math.random() - 0.5) * box.width * 1.2;
      bit.style.left = `${box.left + box.width / 2 + (Math.random() - 0.5) * box.width * 0.5}px`;
      bit.style.top = `${box.top + 10}px`;
      bit.style.background = colors[i % colors.length];
      bit.style.setProperty('--dx', `${spread}px`);
      bit.style.setProperty('--dy', `${-90 - Math.random() * 160}px`);
      bit.style.setProperty('--spin', `${(Math.random() - 0.5) * 1440}deg`);
      bit.style.animationDelay = `${Math.random() * 0.12}s`;
      bit.addEventListener('animationend', () => bit.remove());
      host.appendChild(bit);
    }
  }

  /** The card for a chapter just finished: its stars, bonus goals and score, and each level's best. */
  chapterDone(c: ChapterDef, best: BestMap, next: ChapterDef | undefined): void {
    const sum = totals(best, c.levels);
    $('done-kicker').textContent = t('chapter.kicker', { n: chapterNumber(c) });
    $('done-name').textContent = chapterText(c, 'name');
    $('done-stats').innerHTML =
      `<span class="gold">★ ${sum.stars}/${c.levels.length * 3}</span>` +
      `<span class="bonus">${BONUS_MARK} ${sum.bonus}/${c.levels.length}</span>` +
      `<span>${t('done.score', { score: fmt.num(sum.score) })}</span>`;
    $('done-rows').innerHTML = c.levels
      .map((id, i) => {
        const b = best[id];
        return `<tr style="animation-delay:${i * 0.06}s"><td class="code">${levelCode(id)}</td><td>${escapeHtml(levelName(levelById(id)))}</td><td class="st">${starText(b?.stars ?? 0)}${b?.bonus ? `<em>${BONUS_MARK}</em>` : ''}</td><td class="pts">${fmt.num(b?.score ?? 0)}</td></tr>`;
      })
      .join('');
    $('done-next').innerHTML = !next ? t('done.last') : t(this.forSale(next) ? 'done.nextSale' : 'done.next', { name: escapeHtml(chapterText(next, 'name')) });
    this.show('done');
    const panel = $('scr-done').querySelector<HTMLElement>('.panel')!;
    this.confetti($('scr-done'), panel, 70);
  }

  lightBonus(): void {
    $('res-stars').querySelector('i.bonus')?.classList.add('on');
  }

  setResultTotal(v: number): void {
    $('res-total').textContent = fmt.num(v);
  }

  /**
   * Fits the pause menu to where you are: back to the drawing board only while a test runs,
   * and back to the level editor, not the menus, from a playtest.
   */
  pauseMenu(testing: boolean, playtest: boolean): void {
    $('pause-retry').classList.toggle('hidden', !testing);
    $('pause-quit').innerHTML = t(playtest ? 'pause.edit' : 'pause.quit');
  }

  /** Asks before leaving a chapter challenge part-way, saying what goes on the board. */
  confirmQuit(score: number, cleared: number, chapter: ChapterDef): void {
    $('confirm-bank').innerHTML = score > 0 ? tn('confirm.bank', chapter.levels.length, { score, cleared, name: escapeHtml(chapterText(chapter, 'name')) }) : t('confirm.nothing');
    $('confirm-note').textContent = t('confirm.note');
    this.show('confirm');
  }

  /** The full-game offer: what it opens, its price, and buttons to buy or restore it. */
  unlockOffer(b: BillingStatus, owned: boolean): void {
    const paid = CHAPTERS.filter((c) => this.forSale(c));
    const levels = paid.reduce((n, c) => n + c.levels.length, 0);
    const last = paid[paid.length - 1];
    $('unlock-what').textContent = paid.length
      ? t('unlock.what', { from: chapterNumber(paid[0]), to: chapterNumber(last), n: levels, first: chapterText(paid[0], 'name'), last: chapterText(last, 'name') })
      : t('unlock.allOpen');
    const buy = $<HTMLButtonElement>('unlock-buy');
    buy.disabled = owned || !b.available;
    buy.innerHTML = owned ? t('unlock.unlocked') : `${t('unlock.buy')}${b.price ? ` · ${escapeHtml(b.price)}` : ''} <kbd>Enter</kbd>`;
    $<HTMLButtonElement>('unlock-restore').disabled = owned || !b.available;
    $('unlock-note').textContent = t(owned ? 'unlock.thanks' : b.pending ? 'unlock.pending' : b.available ? 'unlock.oneTime' : 'unlock.offline');
    this.show('unlock');
  }

  /** Shows the buttons that share the bridge on the result, collapse and game over cards. */
  setShare(can: boolean): void {
    for (const b of document.querySelectorAll<HTMLElement>('.share-btn')) b.classList.toggle('hidden', !can);
  }

  /** The pause menu's vibration switch, on devices that can vibrate. */
  /** The Play Games bar over the leaderboards, in the Android app. */
  playGames(s: GamesStatus): void {
    $('pgs-bar').classList.toggle('hidden', !s.available);
    $('pgs-signin').classList.toggle('hidden', s.signedIn);
    for (const id of ['pgs-boards', 'pgs-achievements']) $(id).classList.toggle('hidden', !s.signedIn);
    $('pgs-who').textContent = s.signedIn ? `Google Play Games${s.player ? `: ${s.player}` : ''}` : 'Google Play Games';
  }

  /** The card after a failed run: COLLAPSED if the bridge itself gave way, else just FAILED. */
  collapse(reason: string, collapsed: boolean, lives: number | null, maxLives: number, playtest = false): void {
    $('col-stamp').textContent = t(collapsed ? 'collapse.collapsed' : 'collapse.failed');
    $('col-quit').innerHTML = t(playtest ? 'collapse.edit' : 'collapse.menu');
    $('col-reason').textContent = reason;
    const livesEl = $('col-lives');
    if (lives === null) {
      livesEl.innerHTML = '';
      $('col-note').textContent = t(playtest ? 'collapse.playtest' : 'collapse.free');
    } else {
      this.setLives(lives, maxLives, 'lost', livesEl);
      $('col-note').textContent = lives === 1 ? t('collapse.lastLife') : tn('collapse.lives', lives);
    }
    this.show('collapse');
  }

  over(victory: boolean, score: number, levels: number, chapter: ChapterDef): void {
    const title = $('over-title');
    title.textContent = t(victory ? 'over.complete' : 'over.over');
    title.classList.toggle('win', victory);
    $('over-score').textContent = fmt.num(score);
    const name = chapterText(chapter, 'name');
    $('over-sub').textContent = victory ? t('over.held', { name }) : tn('over.cleared', chapter.levels.length, { cleared: levels, name });
    $('over-rank').textContent = '';
    this.show('over');
  }

  overRank(rank: number): void {
    $('over-rank').textContent = rank >= 0 ? t('over.rank', { rank: rank + 1 }) : '';
  }
}

/** The materials a level offers, in toolbar order: what keys 1–9 and 0 pick. */
export function offeredInOrder(level: LevelDef): MaterialId[] {
  return MATERIAL_ORDER.filter((m) => level.materials.includes(m));
}

/** Marks the bonus star wherever it is shown. */
export const BONUS_MARK = '✦';

/** The ⚑ button that starts a chapter's challenge. */
function challengeButton(c: ChapterDef): string {
  return `<button class="btn small ch-challenge" data-act="challenge" data-chapter="${c.id}" aria-label="${t('map.challenge')}" title="${tn('map.challengeTitle', c.levels.length)}">⚑</button>`;
}

/** Difficulty as filled and empty pips. */
function pips(n: number): string {
  return `<span class="pips" aria-label="${t('chapter.difficulty', { n, of: CHAPTERS.length })}">${'<i class="on"></i>'.repeat(n)}${'<i></i>'.repeat(CHAPTERS.length - n)}</span>`;
}

/** A record run's cost and peak stress, e.g. "$12,340 · peak 62%", or '' for records from before they were kept. */
export function recordDetail(r: { cost?: number; peak?: number }): string {
  return [r.cost === undefined ? '' : money(r.cost), r.peak === undefined ? '' : t('record.peak', { pct: fmt.pct(r.peak) })].filter(Boolean).join(' · ');
}

function starText(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}

