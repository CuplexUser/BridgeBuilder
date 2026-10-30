import { ambience } from '../ambience';
import { sfx } from '../audio';
import { bonusStatus } from '../brief';
import { chapterById, chapterComplete, chapterOf, CHAPTERS, chapterUnlocked, continueLevel, crossed, inFullGame, levelById, levelCode, levelUnlocked, sceneOf, sceneVariant, setOpenAll, type ChapterDef } from '../chapters';
import { Design } from '../design';
import { Editor, fitDesign, isOverBudget, money, type AttachPick } from '../editor';
import { efficiency, IDLE_LOAD } from '../efficiency';
import { DebrisField, Particles, PK, Shake } from '../fx/particles';
import { HapticFeel } from '../haptics';
import { fmt, t, tn } from '../i18n';
import { chapterText, matInline } from '../i18n/data';
import { bankY, goalX, LEVELS, START_X, type LevelDef } from '../levels';
import { isCustom, loadCustom, saveCustom, type CustomSave } from '../maker';
import { motion } from '../motion';
import { music, type MusicState } from '../music';
import { type MaterialId } from '../physics/materials';
import { TestRun } from '../physics/testrun';
import { billing, canOpenAll, games, hasPaywall, openListing, vibrate, type BillingStatus } from '../platform';
import { PlayGamesLink } from '../playgames';
import { loadRate, saveRate } from '../rating';
import { Camera, type Rect } from '../render/camera';
import { MATERIAL_CHALK, PAL } from '../render/palette';
import { Renderer, type FloatText, type SceneView } from '../render/renderer';
import { THEMES, type Theme } from '../render/themes';
import { bestKnown, costReview, ghosts, nextHint, type Ghost } from '../review';
import { bonusLabel, HINT_PENALTY } from '../scoring';
import { SOLUTIONS } from '../solutions';
import { blankProgress, loadPrefs, LocalStore, safeLocalStorage, savePrefs, type Prefs, type Profile, type Progress, type Store } from '../storage';
import { BOOK_PAGE, recordDetail, Ui, type ChaptersView, type ScreenId } from '../ui/ui';
import { Drive } from './drive';
import { Input } from './input';
import { Maker } from './maker';
import { Results } from './results';
import { Settings } from './settings';
import { Sharing } from './sharing';
import { StressView } from './stress';

export type State = 'title' | 'profile' | 'chapters' | 'chapter' | 'scores' | 'workshop' | 'maker' | 'build' | 'test' | 'result' | 'collapse' | 'over';
export type Board = 'career' | 'chapter' | 'levels' | 'challenge';

export const MAX_LIVES = 5;
const START_LIVES = 3;
/** Where the app remembers that the full game was bought, for when Google Play can't be asked. */
const OWNED_KEY = 'bridgebuilder.fullgame';

/** A grid point as players read it, e.g. "4, 2.5". */
function gridText(p: [number, number]): string {
  return t('unit.point', { x: fmt.dec(p[0]), y: fmt.dec(p[1]) });
}

/** How far past each bank edge to frame the build view: a little ground, or the whole anchor strip. */
export function sideRoom(level: LevelDef): number {
  return level.blocks ? level.blocks.reach + 1.5 : 2.5;
}

/**
 * The game: profiles, screens and their flow, the level being played, the main loop, the camera and
 * what gets drawn. The level editor, input, the running test drive, results and the stress graph
 * are features in their own modules (maker.ts, input.ts, drive.ts, results.ts, stress.ts). Each
 * holds this game and shares its state: the members left without `private` are that shared state.
 */
export class Game {
  canvas: HTMLCanvasElement;
  cam = new Camera();
  particles = new Particles();
  debris = new DebrisField();
  shake = new Shake();
  renderer: Renderer;
  ui = new Ui();
  store: Store;
  /** The device's settings, saved with savePrefs as they change. */
  prefs: Prefs = loadPrefs();
  profile: Profile | null = null;
  data: Progress = blankProgress();
  private saveTimer = 0;

  state: State = 'title';
  paused = false;
  /** The level briefing is open over the blueprint; building waits until it closes. */
  briefing = false;
  /** The test drive running is the level's example bridge, not the player's design. */
  example = false;
  /** What the last successful test showed about the material, marked on the blueprint until the design changes. */
  private marks: { idle: number[]; wood: number[]; revision: number; told: boolean } | null = null;
  /** Each built-in level's best known design, as the members the engineer's hints reveal. */
  private hintGhosts = new Map<number, Ghost[] | null>();
  /** Quitting a challenge is waiting on a yes or no, asked over this screen. */
  quitAsk: ScreenId | null = null;

  // Platform extras: haptics, Play Games and the full-game unlock.
  haptics = new HapticFeel(vibrate);
  playGames: PlayGamesLink;
  /** The full game is bought, where there's a paywall at all. */
  private owned = false;
  private billing: BillingStatus = { available: false, owned: false };
  /** The full-game offer is open over this screen. */
  unlockFrom: ScreenId | null = null;
  /** A life was lost in the challenge running, which rules out a flawless finish. */
  lifeLost = false;

  custom: CustomSave = loadCustom();
  /** The custom level being edited or played; built-in levels come from LEVELS. */
  customLevel: LevelDef | null = null;
  /**
   * Free play from the chapter screens, a chapter challenge (its levels in a row, with lives), or a
   * playtest of a custom level from the level editor, which never touches career progress.
   */
  mode: 'play' | 'challenge' | 'custom' = 'play';
  levelIdx = 0;
  /** Chapter shown on the chapter screen, and the one a challenge is running on. */
  chapter: ChapterDef = CHAPTERS[0];
  /** The chapter book's page, while the chapters screen shows it. */
  bookPage = 0;
  lives = START_LIVES;
  runScore = 0;
  levelsCleared = 0;
  editor: Editor | null = null;
  run: TestRun | null = null;
  demo: TestRun | null = null;
  demoTimer = 0;
  demoEnd = 0;
  /** The title demo shows off a different chapter's look each time it loops. */
  private demoRound = -1;
  private attempts = 0;

  private time = 0;
  develop = 0;
  developTarget = 0;
  slowmo = 0;
  flash = 0;
  endTimer = -1;
  anyBreak = false;
  floats: FloatText[] = [];

  hoverNode = -1;
  hoverMember = -1;
  hoverAttach: AttachPick | null = null;
  keyboardMode = false;
  /** The block or ring wedge under the mouse, and the square the brush would paint. */
  hoverCell = -1;
  brushAt: [number, number] | null = null;
  private fpsFrames = 0;
  private fpsTime = 0;
  private debug = new URLSearchParams(location.search).has('debug');

  // The game's features, each in its own module.
  readonly maker = new Maker(this);
  readonly input = new Input(this);
  readonly drive = new Drive(this);
  readonly results = new Results(this);
  readonly stress = new StressView(this);
  readonly settings = new Settings(this);
  readonly sharing = new Sharing(this);

  constructor(canvas: HTMLCanvasElement, store: Store) {
    this.canvas = canvas;
    this.store = store;
    this.playGames = new PlayGamesLink(store instanceof LocalStore ? store : null);
    this.renderer = new Renderer(canvas, this.cam, this.particles, this.debris);
    sfx.muted = this.prefs.muted;
    this.ui.setMuted(this.prefs.muted);
    this.haptics.enabled = this.prefs.haptics !== false;
    setOpenAll(canOpenAll && this.prefs.openAll === true);
    this.settings.apply();
    this.ui.forSale = (c) => this.forSale(c);
    this.ui.fps.classList.toggle('hidden', !this.debug);
    this.input.bindInput();
    this.onResize();
    this.startDemo();
    void this.boot();
  }

  /** Resumes the last profile used on this device, or asks who is playing. */
  private async boot(): Promise<void> {
    const list = await this.store.listProfiles().catch(() => [] as Profile[]);
    const last = list.find((p) => p.id === this.prefs.profileId);
    if (last) await this.useProfile(last.name);
    else this.enterProfiles(list);
    void this.startServices();
  }

  /**
   * The store and Play Games, in the Android app. Neither holds the game up: each answers when it
   * can, and the game carries on without them.
   */
  private async startServices(): Promise<void> {
    if (hasPaywall) {
      this.owned = safeLocalStorage()?.getItem(OWNED_KEY) === '1';
      billing.onChange((s) => this.setBilling(s, true));
      void billing.status().then((s) => this.setBilling(s));
    }
    this.flushSave();
    if (await this.playGames.start()) await this.afterCloudSave();
    else await this.adoptPlayer();
    if (this.profile) this.playGames.progress(this.data.best);
  }

  /** The cloud save changed what's on this device: reread the open profile, or the list to pick from. */
  private async afterCloudSave(): Promise<void> {
    if (this.profile) {
      this.data = await this.store.loadProgress(this.profile.id);
      if (this.state === 'title') this.enterTitle();
      else if (this.state === 'chapters') this.showChapters();
      this.ui.showToast(t('toast.cloudLoaded'));
    } else await this.adoptPlayer();
  }

  /**
   * A Play Games player on a fresh install plays under their Play Games name, without picking a
   * profile. Profiles that came with the cloud save are offered as usual.
   */
  private async adoptPlayer(): Promise<void> {
    const player = this.playGames.status.player;
    if (this.profile || this.state !== 'profile' || !player) return;
    const list = await this.store.listProfiles().catch(() => [] as Profile[]);
    const last = list.find((p) => p.id === this.prefs.profileId);
    if (last) await this.useProfile(last.name);
    else if (!list.length) await this.useProfile(player);
    else this.ui.profiles(list, this.store.kind);
  }

  private async enterProfiles(list?: Profile[]): Promise<void> {
    this.state = 'profile';
    this.ui.setPlaying(false);
    const profiles = list ?? (await this.store.listProfiles().catch(() => [] as Profile[]));
    this.ui.profiles(profiles, this.store.kind);
  }

  async useProfile(name: string): Promise<void> {
    try {
      this.flushSave();
      const p = await this.store.openProfile(name);
      this.data = await this.store.loadProgress(p.id);
      this.profile = p;
      this.prefs.profileId = p.id;
      savePrefs(this.prefs);
      sfx.select();
      this.enterTitle();
    } catch (e) {
      sfx.invalid();
      this.ui.profileError(e instanceof Error && e.message === 'Enter a name' ? t('toast.enterName') : t('toast.profileFail'));
    }
  }

  /** Progress saves are debounced so a burst of edits costs one write. */
  private persist(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), 400);
  }

  flushSave(): void {
    clearTimeout(this.saveTimer);
    if (!this.profile) return;
    this.store.saveProgress(this.profile.id, this.data).catch(() => this.ui.showToast(t('toast.saveFail')));
    this.playGames.progress(this.data.best);
    this.playGames.saveSoon();
  }

  get level(): LevelDef {
    return this.customLevel ?? LEVELS[this.levelIdx];
  }

  /** The level's code for the HUD, e.g. "3-2", or CUSTOM. */
  private codeOf(level: LevelDef): string {
    return isCustom(level.id) ? 'CUSTOM' : levelCode(level.id);
  }

  /** Built-in levels take their topic's scene; custom levels pick one. */
  themeOf(level: LevelDef): Theme {
    return isCustom(level.id) ? (THEMES.find((th) => th.id === level.theme) ?? THEMES[0]) : THEMES[sceneOf(level.id)];
  }

  // ───────────────────────────── Flow ─────────────────────────────

  enterTitle(): void {
    this.leavePlay();
    this.state = 'title';
    this.ui.title(this.profile, this.data, continueLevel(this.data.best));
    this.ui.show('title');
    // A bridge that came in by link waited for a profile.
    this.sharing.watchPending();
  }

  /** Stops whatever was being built or driven and brings the demo back behind the menus. */
  leavePlay(): void {
    this.results.pendingDone = null;
    this.paused = false;
    this.briefing = false;
    this.stress.hideGraph();
    this.drive.stopEngine();
    this.sharing.leaveAfter = false;
    this.editor = null;
    this.customLevel = null;
    this.maker.channelFrom = null;
    this.maker.makerPending = false;
    this.maker.tuning?.close();
    this.maker.makerUi.show(false);
    this.run = null;
    this.ui.setPlaying(false);
    this.ui.hideToast();
    if (!this.demo) this.startDemo();
  }

  startDemo(): void {
    const level = levelById(3);
    this.levelIdx = LEVELS.indexOf(level);
    this.demo = new TestRun(SOLUTIONS[level.id](level), level);
    this.demoRound = (this.demoRound + 1) % THEMES.length;
    this.renderer.setTheme(THEMES[this.demoRound]);
    this.demoTimer = 0;
    this.demoEnd = 0;
    this.develop = this.developTarget = 1;
    this.particles.clear();
    this.debris.clear();
    this.drive.resetWheels(this.demo);
    this.fitCamera(true);
  }

  /** The chapters screen. `opened`: a chapter just opened, whose road is laid in as it shows. */
  enterChapters(opened?: ChapterDef): void {
    this.leavePlay();
    this.state = 'chapters';
    // The book opens on the page with the chapter being played.
    this.bookPage = Math.floor(CHAPTERS.indexOf(chapterOf(continueLevel(this.data.best))) / BOOK_PAGE);
    this.ui.show('chapters');
    this.showChapters(opened);
    if (this.chaptersView === 'map') this.ui.showNextOnMap(this.data.best, !!opened);
    // Or for the challenge running when it came to end.
    this.sharing.watchPending();
  }

  get chaptersView(): ChaptersView {
    return this.prefs.chaptersView ?? 'map';
  }

  /** Draws the chapters screen as it stands: the map, or the book at its page. */
  private showChapters(opened?: ChapterDef): void {
    this.ui.chapters(this.data.best, this.chaptersView, this.bookPage, opened);
  }

  setChaptersView(view: ChaptersView): void {
    if (view === this.chaptersView) return;
    sfx.ui();
    this.prefs.chaptersView = view;
    savePrefs(this.prefs);
    this.showChapters();
    if (view === 'map') this.ui.showNextOnMap(this.data.best);
  }

  /** Turns the chapter book by some pages, or to one. */
  turnBook(to: number): void {
    const last = Math.ceil(CHAPTERS.length / BOOK_PAGE) - 1;
    const page = Math.max(0, Math.min(last, to));
    if (page === this.bookPage || this.chaptersView !== 'book') return;
    sfx.ui();
    this.bookPage = page;
    this.showChapters();
  }

  private enterChapter(ch: ChapterDef): void {
    this.leavePlay();
    this.chapter = ch;
    this.state = 'chapter';
    this.ui.chapter(ch, this.data.best);
    this.ui.show('chapter');
  }

  /** Free play: any open level, starting from your saved design. */
  playLevel(id: number): void {
    if (this.forSale(chapterOf(id))) {
      this.offerFullGame();
      return;
    }
    if (!levelUnlocked(id, this.data.best)) {
      sfx.invalid();
      return;
    }
    this.mode = 'play';
    this.chapter = chapterOf(id);
    this.loadLevel(LEVELS.indexOf(levelById(id)));
  }

  /** A finished chapter played again in a row, from blank designs, with lives: one score for the board. */
  private startChallenge(ch: ChapterDef): void {
    if (this.forSale(ch)) {
      this.offerFullGame();
      return;
    }
    if (!chapterComplete(ch, this.data.best)) {
      sfx.invalid();
      this.ui.showToast(t('toast.challengeLocked', { name: chapterText(ch, 'name') }));
      return;
    }
    this.mode = 'challenge';
    this.chapter = ch;
    this.lifeLost = false;
    this.lives = START_LIVES;
    this.runScore = 0;
    this.levelsCleared = 0;
    this.loadLevel(LEVELS.indexOf(levelById(ch.levels[0])));
  }

  loadLevel(idx: number): void {
    this.stress.hideGraph();
    this.levelIdx = idx;
    const level = this.level;
    this.demo = null;
    this.run = null;
    this.paused = false;
    this.attempts = 0;
    const saved = this.mode === 'play' ? this.data.designs[level.id] : this.mode === 'custom' ? this.custom.designs[level.id] : undefined;
    this.editor = new Editor(level, this.editorEvents(), saved);
    this.editor.cursorX = 0;
    this.editor.cursorY = 0;
    this.editor.setMaterial(level.materials[0]);
    this.renderer.setTheme(this.themeOf(level));
    this.state = 'build';
    this.developTarget = 0;
    this.develop = 0;
    this.particles.clear();
    this.debris.clear();
    this.floats.length = 0;
    this.ui.show(null);
    this.ui.setPlaying(true);
    this.ui.setLevel(level, this.codeOf(level));
    this.ui.setTesting(false);
    this.refreshHud();
    this.fitCamera(true);
    this.ui.hideToast();
    this.openBrief();
    sfx.whoosh();
    const fit = this.editor.fitted;
    if (fit) {
      const parts = fit.removed ? `${t('toast.levelChanged')} ${tn('toast.fitRemoved', fit.removed)}` : '';
      const over = fit.over ? t('toast.fitOver', { money: money(fit.over) }) : '';
      this.ui.showToast([parts, over].filter(Boolean).join(' '), 7000);
    }
  }

  /** Shows the level's goals and rules over the blueprint. Opens with every level, and on demand. */
  private openBrief(): void {
    if (this.state !== 'build' || !this.editor) return;
    if (this.paused) this.setPaused(false);
    this.editor.cancel();
    this.briefing = true;
    const all = this.mode === 'play' ? this.allGhosts() : null;
    const hints = all ? { shown: this.hintsShown().length, penalty: HINT_PENALTY, left: nextHint(all, this.editor.design, this.hintsShown()) >= 0 } : null;
    this.ui.brief(this.level, this.codeOf(this.level), this.mode === 'play' ? this.data.best[this.level.id] : undefined, this.hasExample(), hints);
  }

  // ───────────────────────────── Engineer's review ─────────────────────────────

  /** The level's best known design as hint ghosts, or null for levels without one. */
  private allGhosts(): Ghost[] | null {
    const level = this.level;
    if (isCustom(level.id)) return null;
    if (!this.hintGhosts.has(level.id)) {
      const best = bestKnown(level);
      this.hintGhosts.set(level.id, best ? ghosts(best) : null);
    }
    return this.hintGhosts.get(level.id)!;
  }

  /** Which of the level's hint ghosts have been shown, in the order they were taken. */
  hintsShown(): number[] {
    return this.data.hints?.[this.level.id] ?? [];
  }

  /** Shows one more member of the best known design, for points off every score on the level. */
  private takeHint(): void {
    const all = this.mode === 'play' && this.state === 'build' && this.editor ? this.allGhosts() : null;
    if (!all || !this.editor) return;
    const shown = this.hintsShown();
    const i = nextHint(all, this.editor.design, shown);
    if (i < 0) {
      sfx.invalid();
      this.ui.showToast(t('toast.hintNone'));
      return;
    }
    (this.data.hints ??= {})[this.level.id] = [...shown, i];
    this.persist();
    this.closeBrief();
    sfx.select();
    const [a, b, mat] = all[i];
    this.ui.showToast(t('toast.hint', { n: shown.length + 1, mat: matInline(mat), a: gridText(a), b: gridText(b), penalty: HINT_PENALTY }), 5000);
  }

  /** The engineer's notes on a bridge that crossed: its cost against the best known design, and material it barely used. */
  review(level: LevelDef, run: TestRun, canRetry: boolean): string[] {
    const d = this.editor!.design;
    const out: string[] = [];
    const best = isCustom(level.id) ? null : bestKnown(level);
    if (best) out.push(costReview(d.cost(), best.cost(), money));
    const broke = new Set(run.world.links.filter((l) => l.bridge && l.broken && l.member >= 0).map((l) => l.member)).size;
    const tore = run.world.blocks.filter((b) => b.loose).length;
    if (broke || tore) {
      const what = [broke ? tn('review.broke', broke) : '', tore ? tn('review.tore', tore) : ''].filter(Boolean);
      out.push(t('review.brokeHeld', { what: fmt.list(what) }));
    }
    const e = efficiency(level, d, run.peakPull, run.peakPush);
    if (e.idleParts) out.push(tn('review.idle', e.idleParts, { pct: fmt.pct(IDLE_LOAD), money: money(e.idleCost) }));
    if (e.woodParts) out.push(tn('review.wood', e.woodParts, { money: money(e.woodSaving) }));
    if (!e.idleParts && !e.woodParts) out.push(t('review.allWork'));
    else if (canRetry) out.push(t('review.marks'));
    this.marks = e.idle.length || e.toWood.length ? { idle: e.idle, wood: e.toWood, revision: this.editor!.revision, told: false } : null;
    return out;
  }

  // ───────────────────────────── Stress graph ─────────────────────────────

  /** Tutorial levels (the ones with a ghost) can show their intended bridge first, outside challenges. */
  hasExample(): boolean {
    return this.mode === 'play' && !!this.level.hint && !!SOLUTIONS[this.level.id];
  }

  /**
   * Drives the level's example bridge so the player can see the idea work, then hands back the
   * blueprint. `shown` drives another bridge instead, with its own note.
   */
  startExample(shown?: { design: Design; note: string }): void {
    if (this.state !== 'build' || !this.editor || (!shown && !this.hasExample())) return;
    this.closeBrief();
    this.editor.cancel();
    this.example = true;
    this.run = new TestRun(shown?.design ?? SOLUTIONS[this.level.id](this.level), this.level);
    this.state = 'test';
    this.developTarget = 1;
    this.endTimer = -1;
    this.anyBreak = false;
    this.drive.lastPhase = '';
    this.drive.lastBrake = 'none';
    this.drive.quakeSaid = this.drive.stepSaid = this.drive.gustSaid = this.drive.floodSaid = false;
    this.drive.lastStep = 0;
    this.drive.acc = 0;
    this.particles.clear();
    this.debris.clear();
    this.drive.resetWheels(this.run);
    this.ui.setTesting(true);
    this.ui.showToast(shown?.note ?? t('toast.example'), 120000);
    this.fitCamera(false);
    sfx.whoosh();
    sfx.engineStart(this.drive.engineBase());
  }

  private closeBrief(): void {
    if (!this.briefing) return;
    this.briefing = false;
    this.ui.show(null);
  }

  startTest(): void {
    if (this.state !== 'build' || !this.editor || this.paused) return;
    this.closeBrief();
    this.editor.cancel();
    if (this.editor.left() < 0) {
      sfx.invalid();
      this.ui.showToast(t('toast.overBudget', { money: money(-this.editor.left()) }), 3200);
      return;
    }
    this.persistDesign();
    this.run = new TestRun(this.editor.design, this.level);
    // Its poses let the stress graph show the bridge as it stood, not where the pieces landed.
    this.run.log.poses = [];
    this.state = 'test';
    this.developTarget = 1;
    this.endTimer = -1;
    this.anyBreak = false;
    this.drive.lastPhase = '';
    this.drive.lastBrake = 'none';
    this.drive.quakeSaid = this.drive.stepSaid = this.drive.gustSaid = this.drive.floodSaid = false;
    this.drive.lastStep = 0;
    this.drive.acc = 0;
    this.attempts++;
    this.particles.clear();
    this.debris.clear();
    this.drive.resetWheels(this.run);
    this.ui.setTesting(true);
    this.ui.hideToast();
    this.ui.testBtn.classList.remove('pulse');
    this.hoverMember = this.hoverNode = -1;
    this.fitCamera(false);
    sfx.whoosh();
    sfx.engineStart(this.drive.engineBase());
  }

  backToBuild(): void {
    if (!this.editor) return;
    // A challenge run that has failed costs its life now: leaving before the collapse card can't dodge it.
    if (this.mode === 'challenge' && this.state === 'test' && this.run?.status === 'fail') {
      this.paused = false;
      this.results.finishCollapse();
      return;
    }
    if (this.example) {
      this.example = false;
      // A bridge shared from a level this player can't build on yet: back to the chapters.
      if (this.sharing.leaveAfter) {
        this.enterChapters();
        this.ui.showToast(t('share.locked'), 4500);
        return;
      }
      this.ui.showToast(t(this.level.hintSolves ? 'toast.yourTurnGhost' : 'toast.yourTurn'), 4000);
    }
    this.stress.hideGraph();
    this.drive.stopEngine();
    this.run = null;
    this.state = 'build';
    this.paused = false;
    this.developTarget = 0;
    this.slowmo = 0;
    this.particles.clear();
    this.debris.clear();
    this.ui.show(null);
    this.ui.setTesting(false);
    this.refreshHud();
    this.fitCamera(false);
    if (this.marks && !this.marks.told && this.marks.revision === this.editor.revision) {
      this.marks.told = true;
      const what = [this.marks.idle.length ? t('marks.idle') : '', this.marks.wood.length ? t('marks.wood') : ''].filter(Boolean).join(' · ');
      this.ui.showToast(t('toast.marks', { what }), 4500);
    }
  }

  setPaused(p: boolean): void {
    if (this.state !== 'build' && this.state !== 'test') return;
    if (p) this.closeBrief();
    if (p === this.paused) return;
    this.paused = p;
    if (p) this.ui.pauseMenu(this.state === 'test', this.mode === 'custom');
    this.ui.show(p ? 'pause' : null);
    if (p) this.editor?.cancel();
    if (this.state === 'test' && this.run?.status === 'running') {
      if (p) sfx.engineStop();
      else sfx.engineStart(this.drive.engineBase());
    }
  }

  /** Writes again, in the language just picked, the text the script put on screen. */
  relabel(): void {
    this.ui.relabel();
    this.maker.makerUi.relabel();
    if (this.state === 'title') this.ui.title(this.profile, this.data, continueLevel(this.data.best));
    if (this.state === 'build' || this.state === 'test') {
      this.ui.setLevel(this.level, this.codeOf(this.level));
      this.ui.setTesting(this.state === 'test');
      this.ui.pauseMenu(this.state === 'test', this.mode === 'custom');
      this.refreshHud();
    }
  }

  /** Signs in to Play Games from the leaderboards, pulling in the cloud save as it does. */
  private async signInPlayGames(): Promise<void> {
    if (await this.playGames.signIn()) await this.afterCloudSave();
    if (this.state === 'scores') this.ui.playGames(this.playGames.status);
    if (this.playGames.signedIn) this.playGames.progress(this.data.best);
    else this.ui.showToast(t('toast.notSignedIn'));
  }

  /** Opens every level for testing, or closes them again; players are never told about it. Not on Android. */
  toggleOpenAll(): void {
    if (!canOpenAll) return;
    this.prefs.openAll = !this.prefs.openAll;
    setOpenAll(this.prefs.openAll);
    savePrefs(this.prefs);
    sfx.select();
    this.ui.title(this.profile, this.data, continueLevel(this.data.best));
    this.ui.showToast(this.prefs.openAll ? 'Test mode: every level open' : 'Test mode off', 3200);
  }

  toggleMute(): void {
    this.prefs.muted = !this.prefs.muted;
    sfx.unlock();
    sfx.setMuted(this.prefs.muted);
    this.ui.setMuted(this.prefs.muted);
    savePrefs(this.prefs);
  }

  persistDesign(): void {
    if (!this.editor) return;
    if (this.mode === 'custom') {
      this.custom.designs[this.level.id] = this.editor.design.serialize();
      saveCustom(this.custom);
      return;
    }
    this.data.designs[this.level.id] = this.editor.design.serialize();
    this.persist();
  }

  // ───────────────────────────── Full game ─────────────────────────────

  /** A chapter past the free ones in a build with a paywall, while the full game isn't bought. */
  forSale(ch: ChapterDef): boolean {
    return hasPaywall && !this.owned && inFullGame(ch);
  }

  /**
   * What Google Play says about the full game. Play is believed whenever it answers; when it
   * can't be reached, the last answer stands, so a bought game stays open offline.
   */
  private setBilling(s: BillingStatus, announce = false): void {
    this.billing = s;
    if (s.available && s.owned !== this.owned) {
      this.owned = s.owned;
      try {
        safeLocalStorage()?.setItem(OWNED_KEY, s.owned ? '1' : '0');
      } catch {
        // Play is asked again next time.
      }
      if (s.owned && announce) {
        sfx.star(2);
        this.ui.showToast(t('toast.unlocked'), 3200);
      }
      if (this.state === 'chapters') this.showChapters();
      else if (this.state === 'title') this.enterTitle();
    }
    if (this.unlockFrom) this.ui.unlockOffer(this.billing, this.owned);
  }

  /** Shows what the full game opens and its price, over the current screen. */
  private offerFullGame(): void {
    sfx.ui();
    this.unlockFrom ??= this.ui.current ?? 'title';
    this.ui.unlockOffer(this.billing, this.owned);
    // The price may not have arrived yet, and Play may have come back since.
    void billing.status().then((s) => this.setBilling(s));
  }

  closeOffer(): void {
    if (!this.unlockFrom) return;
    this.ui.show(this.unlockFrom);
    this.unlockFrom = null;
  }

  private async buyFullGame(restore: boolean): Promise<void> {
    if (this.owned) {
      this.closeOffer();
      return;
    }
    try {
      const s = await (restore ? billing.restore() : billing.buy());
      this.setBilling(s, true);
      if (s.owned) this.closeOffer();
      else if (s.pending) this.ui.showToast(t('toast.pending'), 4500);
      else if (restore) this.ui.showToast(t('toast.noPurchase'), 3200);
    } catch (e) {
      sfx.invalid();
      this.ui.showToast(e instanceof Error && e.message ? e.message : t('toast.playUnreachable'), 3200);
    }
  }

  // ───────────────────────────── Actions ─────────────────────────────

  /** Opens a chapter's level list, or explains what unlocks it. */
  openChapter(ch: ChapterDef): void {
    if (this.forSale(ch)) this.offerFullGame();
    else if (chapterUnlocked(ch, this.data.best)) {
      sfx.select();
      this.enterChapter(ch);
    } else {
      sfx.invalid();
      this.ui.showToast(t('toast.chapterLocked', { prev: chapterText(CHAPTERS[CHAPTERS.indexOf(ch) - 1], 'name'), name: chapterText(ch, 'name') }));
    }
  }

  act(a: string, el?: HTMLElement): void {
    sfx.unlock();
    // Buttons name a chapter by its id.
    const chapterArg = () => chapterById(Number(el?.dataset.chapter)) ?? this.chapter;
    switch (a) {
      case 'continue':
        sfx.select();
        this.playLevel(continueLevel(this.data.best));
        break;
      case 'chapters':
        sfx.ui();
        this.enterChapters();
        break;
      case 'chapter':
        this.openChapter(chapterArg());
        break;
      case 'chapters-view':
        this.setChaptersView(el?.dataset.view === 'book' ? 'book' : 'map');
        break;
      case 'book-page':
        this.turnBook(el?.dataset.page !== undefined ? Number(el.dataset.page) : this.bookPage + Number(el?.dataset.dir ?? 0));
        break;
      case 'pick':
        sfx.select();
        this.playLevel(Number(el?.dataset.level));
        break;
      case 'challenge':
        sfx.select();
        this.startChallenge(chapterArg());
        break;
      case 'scores':
        sfx.ui();
        this.results.enterScores();
        break;
      case 'board':
        sfx.ui();
        this.results.showBoard((el?.dataset.board as Board) ?? 'career');
        break;
      case 'board-chapter':
        sfx.ui();
        this.results.showBoard(this.results.board === 'career' ? 'chapter' : this.results.board, chapterById(Number(el?.dataset.chapter))?.id ?? CHAPTERS[0].id);
        break;
      case 'back':
        sfx.ui();
        if (this.state === 'chapter') this.enterChapters();
        else this.enterTitle();
        break;
      case 'profiles':
        sfx.ui();
        void this.enterProfiles();
        break;
      case 'profile':
        if (el?.dataset.name) void this.useProfile(el.dataset.name);
        break;
      case 'resume':
        sfx.ui();
        this.setPaused(false);
        break;
      case 'brief':
        sfx.ui();
        this.openBrief();
        break;
      case 'stress':
        sfx.ui();
        this.stress.openGraph();
        break;
      case 'stress-close':
        sfx.ui();
        this.stress.closeGraph();
        break;
      case 'brief-example':
        sfx.select();
        this.startExample();
        break;
      case 'brief-close':
        sfx.select();
        this.closeBrief();
        break;
      case 'retry':
        sfx.ui();
        this.backToBuild();
        break;
      case 'next':
        sfx.select();
        this.results.nextLevel();
        break;
      case 'done-close':
        this.results.closeDone();
        break;
      case 'rate':
        sfx.select();
        saveRate({ ...loadRate(), rated: true });
        this.ui.rated();
        openListing().catch(() => this.ui.showToast(t('toast.playUnreachable'), 3200));
        break;
      case 'quit':
        sfx.ui();
        // Leaving a result that finished a chapter shows the chapter's card first.
        if (this.state === 'result' && this.results.pendingDone) {
          this.results.showDone();
          break;
        }
        // Leaving a challenge part-way ends the run, so ask first.
        if (this.mode === 'challenge' && this.state !== 'over') {
          this.askQuit();
          break;
        }
        this.quit();
        break;
      case 'review-hint':
        this.takeHint();
        break;
      case 'record-view':
        sfx.select();
        void this.watchRecord(Number(el?.dataset.level), el?.dataset.name ?? '');
        break;
      case 'quit-confirm':
        sfx.ui();
        this.quitAsk = null;
        this.quit();
        break;
      case 'quit-cancel':
        sfx.ui();
        this.cancelQuit();
        break;
      case 'restart':
        sfx.select();
        this.startChallenge(this.chapter);
        break;
      case 'share':
        sfx.ui();
        void this.sharing.share();
        break;
      case 'unlock':
        this.offerFullGame();
        break;
      case 'buy':
        sfx.select();
        void this.buyFullGame(false);
        break;
      case 'restore':
        sfx.ui();
        void this.buyFullGame(true);
        break;
      case 'unlock-close':
        sfx.ui();
        this.closeOffer();
        break;
      case 'settings':
        this.settings.open();
        break;
      case 'settings-close':
        this.settings.close();
        break;
      case 'set-palette':
        this.settings.setPalette(el?.dataset.palette === 'colorblind' ? 'colorblind' : 'classic');
        break;
      case 'pgs-signin':
        sfx.ui();
        void this.signInPlayGames();
        break;
      case 'pgs-boards':
        sfx.ui();
        void games.showLeaderboards().catch(() => this.ui.showToast(t('toast.gamesUnreachable')));
        break;
      case 'pgs-achievements':
        sfx.ui();
        void games.showAchievements().catch(() => this.ui.showToast(t('toast.gamesUnreachable')));
        break;
      default:
        this.maker.makerAct(a, el);
    }
  }

  /**
   * Drives a level's record bridge from the boards, once you've crossed the level yourself. It
   * opens the level with your own blueprint kept, as the level's example does.
   */
  private async watchRecord(id: number, name: string): Promise<void> {
    if (!crossed(this.data.best, id) || !name) return;
    let design: Design;
    try {
      const saved = await this.store.recordDesign(id, name);
      if (!saved) throw new Error('No design');
      // Fitted to the level as it is now, in case it changed since the record was set.
      design = fitDesign(levelById(id), Design.deserialize(saved)).design;
    } catch {
      this.ui.showToast(t('toast.recordMissing'));
      return;
    }
    if (this.state !== 'scores') return;
    const r = (await this.store.levelScores().catch(() => [])).find((x) => x.level === id && x.name === name);
    this.playLevel(id);
    const detail = r ? recordDetail(r) : '';
    this.startExample({ design, note: detail ? t('toast.recordDetail', { name, detail }) : t('toast.record', { name }) });
  }

  /** Asks before ending a challenge run, over whichever screen asked to quit. */
  private askQuit(): void {
    this.quitAsk = this.ui.current ?? 'pause';
    this.ui.confirmQuit(this.runScore, this.levelsCleared, this.chapter);
  }

  private cancelQuit(): void {
    if (!this.quitAsk) return;
    this.ui.show(this.quitAsk);
    this.quitAsk = null;
  }

  /** Back to the menus, or the level editor from a playtest. A challenge banks what it scored. */
  private quit(): void {
    if (this.state !== 'over') void this.results.bankAbandonedRun();
    if (this.mode === 'custom') this.maker.enterMaker(this.level);
    else if (this.mode === 'play') this.enterChapter(this.chapter);
    else this.enterChapters();
  }

  selectMaterial(m: MaterialId): void {
    if (!this.editor || this.state !== 'build') return;
    if (this.editor.setMaterial(m)) {
      sfx.ui();
      this.refreshHud();
    } else {
      sfx.invalid();
      this.ui.shakeMat(m);
    }
  }

  cycleMaterial(dir: number): void {
    if (!this.editor) return;
    const avail = this.level.materials;
    const i = avail.indexOf(this.editor.mat);
    this.selectMaterial(avail[(i + dir + avail.length) % avail.length]);
  }

  private editorEvents() {
    return {
      place: (ax: number, ay: number, bx: number, by: number, mat: MaterialId, index: number, count: number) => {
        if (index === 0) sfx.place(mat);
        const col = MATERIAL_CHALK[mat];
        this.particles.burst(PK.Chalk, bx, by, 10, 2.2, 0.45, 0.07, [col, PAL.chalk]);
        this.particles.burst(PK.Chalk, ax, ay, 4, 1.2, 0.35, 0.05, [col]);
        this.particles.spawn(PK.Ring, bx, by, 0, 0, 0.35, 0.8, col);
        this.shake.add(count > 1 ? 0.04 : 0.06);
        if (index < count - 1) return;
        if (count > 1) sfx.place(mat);
        const left = this.editor!.left();
        if (left < this.level.money * 0.15) this.float((ax + bx) / 2, (ay + by) / 2 + 0.6, t('float.left', { money: money(left) }), left < this.level.money * 0.05 ? PAL.bolt : PAL.gold, 15);
        this.refreshHud();
      },
      remove: (ax: number, ay: number, bx: number, by: number, mat: MaterialId) => {
        sfx.remove();
        for (let i = 0; i <= 6; i++) {
          const f = i / 6;
          this.particles.burst(PK.Chalk, ax + (bx - ax) * f, ay + (by - ay) * f, 2, 1.5, 0.4, 0.06, [MATERIAL_CHALK[mat]]);
        }
        this.refreshHud();
      },
      invalid: (reason: string, x: number, y: number) => {
        sfx.invalid();
        this.float(x, y + 0.5, reason, PAL.bolt, 15);
        if (isOverBudget(reason) && this.editor) this.ui.shakeMat(this.editor.mat);
      },
    };
  }

  refreshHud(): void {
    const ed = this.editor;
    if (!ed) return;
    this.ui.setMaterials(this.level, ed.mat, ed.left(), (m) => ed.partsLeft(m));
    this.ui.setBudget(ed.spent(), this.level.money, this.level.target);
    if (this.mode === 'challenge') {
      this.ui.setLives(this.lives, MAX_LIVES);
      this.ui.setScore(t('hud.challenge', { score: this.runScore }));
    } else {
      this.ui.hudLives.innerHTML = '';
      const best = this.data.best[this.level.id];
      this.ui.setScore(best ? t('hud.best', { score: best.score, stars: `${'★'.repeat(best.stars)}${'☆'.repeat(3 - best.stars)}` }) : t('hud.notCrossed'));
    }
    const bonus = this.level.bonus;
    this.ui.setGoal(bonusLabel(bonus), !!this.data.best[this.level.id]?.bonus && this.mode === 'play', bonusStatus(this.level, ed.design), bonus.kind === 'parts' && ed.design.members.length ? t('hud.partsNow', { n: ed.design.parts() }) : '');
    // Nudge first-timers toward the test button once the hint is built, on levels whose ghost
    // is a whole bridge; other ghosts just show off a new mechanic.
    const hint = this.level.hintSolves ? this.level.hint : undefined;
    this.ui.testBtn.classList.toggle('pulse', !!hint && hint.every(([a, b, mat]) => ed.design.covers(a, b, mat)) && this.attempts === 0);
  }

  float(x: number, y: number, text: string, color: string, size = 18, life = 1.1): void {
    this.floats.push({ x, y, text, color, life, max: life, size });
    if (this.floats.length > 24) this.floats.shift();
  }

  confetti(x: number, y: number, n: number): void {
    if (motion.reduced) n = Math.ceil(n / 4);
    for (let i = 0; i < n; i++) {
      const a = Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const s = 6 + Math.random() * 9;
      this.particles.spawn(PK.Confetti, x, y, Math.cos(a) * s, Math.sin(a) * s, 2 + Math.random() * 1.5, 0.22, PAL.confetti[(Math.random() * PAL.confetti.length) | 0]);
    }
  }

  // ───────────────────────────── Update ─────────────────────────────

  /**
   * Keeps the music and the scene's ambience in step with what's on screen: calm in the menus,
   * building, a pulse that rises with the stress in a test run, muffled under a collapse.
   */
  private soundtrack(): void {
    const s = this.state;
    const inLevel = s === 'build' || s === 'maker' || s === 'test' || s === 'result' || s === 'collapse' || s === 'over';
    const state: MusicState = this.paused ? 'pause' : s === 'test' ? 'test' : s === 'result' ? 'result' : s === 'collapse' || s === 'over' ? 'collapse' : inLevel ? 'build' : 'menu';
    const theme = this.renderer.theme;
    const level = inLevel ? this.level : null;
    const variant = level && !isCustom(level.id) ? sceneVariant(level.id) : 0;
    music.update(state, theme.id, this.run?.peakStress ?? 0, { variant, tense: this.mode === 'challenge' && inLevel });
    ambience.update(theme, this.paused ? 0.35 : !inLevel ? 0.3 : s === 'build' || s === 'maker' ? 0.75 : 1);
  }

  update(dtReal: number): void {
    const dt = Math.min(dtReal, 1 / 20);
    this.time += dt;

    if (this.debug) {
      this.fpsFrames++;
      this.fpsTime += dtReal;
      if (this.fpsTime > 0.5) {
        this.ui.fps.textContent = `${Math.round(this.fpsFrames / this.fpsTime)} fps · ${this.particles.n} p`;
        this.fpsFrames = 0;
        this.fpsTime = 0;
      }
    }

    this.soundtrack();

    const devSpeed = this.developTarget > this.develop ? 2.4 : 4;
    this.develop += Math.sign(this.developTarget - this.develop) * Math.min(Math.abs(this.developTarget - this.develop), dt * devSpeed);

    if (!this.paused) {
      this.slowmo = Math.max(0, this.slowmo - dt);
      const timeScale = this.slowmo > 0 ? 0.25 + 0.75 * (1 - this.slowmo / 0.7) ** 3 : 1;
      const sim = this.run ?? this.demo;
      if (sim && (this.state === 'test' || this.state === 'result' || this.state === 'collapse' || this.state === 'over' || this.demo)) {
        this.drive.stepSim(sim, dt * timeScale);
      }
      this.editor?.tick(dt);
      // A flood raises the water things splash into.
      const water = sim?.world.waterY ?? this.level.waterY;
      this.particles.update(dt * timeScale, water);
      this.debris.update(dt * timeScale, water, (x, y, size) => {
        const T = this.renderer.theme;
        this.particles.burst(PK.Water, x, y, 4 + size * 12, 3.5, 0.8, 0.08, [T.foam, T.waterTop], 3);
        // Rubble plops silently; only real pieces of bridge get a splash sound.
        if (!this.demo && size > 0.35) sfx.splash(false);
      });
      for (const f of this.floats) {
        f.life -= dt;
        f.y += dt * 0.8;
      }
      this.floats = this.floats.filter((f) => f.life > 0);
      this.flash = Math.max(0, this.flash - dt * 3);
    }

    if (this.state === 'test' && this.run) this.drive.trackRun(dt);
    if (this.results.resultAnim && this.state === 'result') this.results.animateResult(dt);

    if (this.demo) this.demoCamera();
    this.shake.update(dt);
    this.cam.update(dt);
    this.cam.ox = this.shake.x;
    this.cam.oy = this.shake.y;
  }

  // ───────────────────────────── Camera ─────────────────────────────

  viewRect(): Rect {
    const w = this.renderer.w;
    const h = this.renderer.h;
    const playing = this.state === 'build' || this.state === 'test';
    // Phones stack the budget meter under the HUD's top row, and the toolbar's tools under its materials.
    const top = playing ? (w < 560 ? 104 : 70) : 20;
    const bottom = playing ? (w < 560 ? 140 : 96) : 20;
    return { x: 12, y: top, w: w - 24, h: Math.max(100, h - top - bottom) };
  }

  buildBounds(): [number, number, number, number] {
    const L = this.level;
    const top = this.editor?.topY ?? 4;
    const side = sideRoom(L);
    return [-side, L.width + side, L.waterY - 0.5, top + 0.5];
  }

  testBounds(): [number, number, number, number] {
    const L = this.level;
    // Tall towers the player raised count too, so their peaks stay in view.
    const built = this.editor?.design.nodes.map((n) => n.y + 1.5) ?? [];
    const top = Math.max(4, bankY(L) + 4, ...L.anchors.map((a) => a[1] + 2.5), ...(L.masts ?? []).map((m) => m[2] + 2.5), ...built);
    // Oncoming traffic waits out on the right bank as far as the rest wait on the left.
    const right = L.oncoming ? L.width - START_X + 2 : goalX(L) + 2.5;
    return [Math.min(START_X - 2, -sideRoom(L)), Math.max(right, L.width + sideRoom(L)), L.waterY - 1, top];
  }

  fitCamera(snap: boolean): void {
    const [a, b, c, d] = this.state === 'build' ? this.buildBounds() : this.testBounds();
    this.cam.fit(a, b, c, d, this.viewRect(), snap);
  }

  /** Frames the whole test scene, or tracks the vehicle when that would be too small to read. */
  frameTest(run: TestRun, vr: Rect, padBottom = 0, padTop = 0): void {
    const [x0, x1, y0, y1] = this.testBounds();
    this.cam.fit(x0, x1, y0 - padBottom, y1 + padTop, vr);
    const minScale = this.renderer.h > this.renderer.w * 1.2 ? 30 : 22;
    if (this.cam.tscale >= minScale) return;
    const s = Math.min(minScale, vr.h / (y1 - y0 + padBottom + padTop));
    this.cam.tscale = s;
    const halfW = this.renderer.w / 2 / s;
    // While a drawbridge holds traffic, watch the channel: the opening is what the vehicle waits for.
    const focus = run.level.ship && run.time < run.releaseAt ? run.shipX : run.convoyX + 2;
    this.cam.tcx = Math.max(x0 + halfW - 1, Math.min(x1 - halfW + 1, focus));
    this.cam.tcy = (y0 - padBottom + y1 + padTop) / 2 + (vr.y + vr.h / 2 - this.renderer.h / 2) / s;
  }

  private demoCamera(): void {
    if (!this.demo) return;
    const { w, h } = this.renderer;
    // Portrait: frame the demo below the title card instead of behind it.
    const view = h > w * 1.2 ? { x: 0, y: h * 0.66, w, h: h * 0.34 } : { x: 0, y: 0, w, h };
    this.frameTest(this.demo, view, 1, 3);
  }

  onResize(): void {
    this.renderer.resize();
    // The map lays its road out to the width it has.
    if (this.state === 'chapters' && this.chaptersView === 'map') this.showChapters();
    if (this.demo) this.demoCamera();
    else if (this.state === 'maker') this.maker.fitMaker(true);
    else if (this.stress.graphOpen) {
      this.stress.frameGraph();
      this.stress.showPick();
    } else this.fitCamera(true);
    this.cam.snap();
  }

  // ───────────────────────────── Render ─────────────────────────────

  render(): void {
    const sim = this.run ?? this.demo;
    this.stress.posed(() => this.drawScene(sim));
  }

  /**
   * Draws the scene. `still` draws a logged moment of the run for a picture: no cursor, rings or
   * floating words. The stress graph's moments are still too, as far as the wreckage goes.
   */
  drawScene(sim: TestRun | null, still = false): void {
    this.renderer.draw({
      level: this.level,
      editor: this.state === 'build' || (!this.run && this.editor) ? this.editor : null,
      run: sim,
      develop: this.develop,
      hoverNode: this.state === 'build' ? this.hoverNode : -1,
      hoverMember: this.state === 'build' ? this.hoverMember : -1,
      hoverAttach: this.state === 'build' ? this.hoverAttach : null,
      showCursor: this.keyboardMode && this.state === 'build' && !this.paused,
      showHint: this.state === 'build' && !!this.level.hint && this.attempts === 0,
      time: this.time,
      flash: still ? 0 : this.flash,
      wheelAngles: this.drive.wheelAngles,
      floats: still ? [] : this.floats,
      highlight: still ? null : this.stress.highlight(),
      still: still || this.stress.graphOpen,
      maker: this.maker.makerView(),
      loupe: still ? null : this.loupeView(),
      hoverCell: this.state === 'build' ? this.hoverCell : -1,
      brush: this.state === 'build' && !this.paused && this.brushAt && this.editor && !this.editor.paint ? { x: this.brushAt[0], y: this.brushAt[1], why: this.editor.blockProblem(...this.brushAt) } : null,
      reviewHint: this.state === 'build' && this.mode === 'play' && this.hintsShown().length ? this.hintsShown().flatMap((i) => this.allGhosts()?.slice(i, i + 1) ?? []) : null,
      marks: this.state === 'build' && this.marks && this.marks.revision === this.editor?.revision ? this.marks : null,
    });
  }

  /** While a finger places something, a magnifier shows the point the finger hides. */
  private loupeView(): SceneView['loupe'] {
    if (this.input.pointers.size !== 1 || this.paused) return null;
    const p = this.input.pointers.values().next().value!;
    if (p.type !== 'touch') return null;
    // A quick tap gets no magnifier; only a finger that holds or moves is aiming.
    if (performance.now() - p.downAt < 150 && Math.hypot(p.x - p.startX, p.y - p.startY) < 10) return null;
    let at: [number, number] | null = null;
    if (this.state === 'build' && this.input.dragging && this.editor?.drag) at = [this.editor.drag.tx, this.editor.drag.ty];
    else if (this.state === 'maker' && this.maker.makerPending) at = this.maker.makerHover;
    if (!at) return null;
    return { x: this.cam.sx(at[0]), y: this.cam.sy(at[1]), fx: p.x, fy: p.y };
  }

  // ───────────────────────────── Input ─────────────────────────────
}
