import { sfx } from './audio';
import { Editor, money, type AttachPick } from './editor';
import { DebrisField, Particles, PK, Shake } from './fx/particles';
import { bankY, goalX, LEVELS, START_X, type LevelDef } from './levels';
import { MATERIAL_ORDER, type MaterialId } from './physics/materials';
import { STEP, TestRun } from './physics/world';
import { Camera, type Rect } from './render/camera';
import { MATERIAL_CHALK, PAL } from './render/palette';
import { Renderer, type FloatText } from './render/renderer';
import {
  chapterComplete,
  chapterOf,
  chapterUnlocked,
  CHAPTERS,
  continueLevel,
  highestUnlocked,
  levelById,
  levelCode,
  levelUnlocked,
  nextInChapter,
  totals,
  type ChapterDef,
} from './chapters';
import { scoreLevel, type LevelScore } from './scoring';
import { bestPerLevel, blankProgress, loadPrefs, rankProfiles, savePrefs, type Prefs, type Profile, type Progress, type Store } from './storage';
import { SOLUTIONS } from './solutions';
import { Ui } from './ui/ui';

type State = 'title' | 'profile' | 'chapters' | 'chapter' | 'scores' | 'build' | 'test' | 'result' | 'collapse' | 'over';
export type Board = 'career' | 'chapter' | 'levels' | 'challenge';

const MAX_LIVES = 5;
const START_LIVES = 3;
const RESULT_DELAY = 1.5;
const COLLAPSE_DELAY = 1.7;

interface PointerInfo {
  x: number;
  y: number;
  startX: number;
  startY: number;
  type: string;
}

export class Game {
  private canvas: HTMLCanvasElement;
  private cam = new Camera();
  private particles = new Particles();
  private debris = new DebrisField();
  private shake = new Shake();
  private renderer: Renderer;
  private ui = new Ui();
  private store: Store;
  private prefs: Prefs = loadPrefs();
  private profile: Profile | null = null;
  private data: Progress = blankProgress();
  private saveTimer = 0;

  private state: State = 'title';
  private paused = false;
  /** Free play from the chapter screens, or a chapter challenge: its levels in a row, with lives. */
  private mode: 'play' | 'challenge' = 'play';
  private levelIdx = 0;
  /** Chapter shown on the chapter screen, and the one a challenge is running on. */
  private chapter: ChapterDef = CHAPTERS[0];
  private lives = START_LIVES;
  private runScore = 0;
  private levelsCleared = 0;
  private editor: Editor | null = null;
  private run: TestRun | null = null;
  private demo: TestRun | null = null;
  private demoTimer = 0;
  private demoEnd = 0;
  private splashed = new WeakSet<TestRun>();
  private attempts = 0;
  private board: Board = 'career';
  private boardChapter = 1;

  private time = 0;
  private develop = 0;
  private developTarget = 0;
  private slowmo = 0;
  private flash = 0;
  private acc = 0;
  private endTimer = -1;
  private anyBreak = false;
  private wheelAngles: [number, number] = [0, 0];
  private lastWheelX: [number, number] = [0, 0];
  /** Fastest downward speed of each wheel since it last touched something. */
  private wheelFall: [number, number] = [0, 0];
  private floats: FloatText[] = [];
  private resultAnim: { t: number; score: LevelScore; shown: number; stars: number } | null = null;

  private hoverNode = -1;
  private hoverMember = -1;
  private hoverAttach: AttachPick | null = null;
  private keyboardMode = false;
  private pointers = new Map<number, PointerInfo>();
  private dragging = false;
  private panning = false;
  private pendingDelete = -1;
  private pinchDist = 0;
  private lastMid: [number, number] = [0, 0];
  private fpsFrames = 0;
  private fpsTime = 0;
  private debug = new URLSearchParams(location.search).has('debug');

  constructor(canvas: HTMLCanvasElement, store: Store) {
    this.canvas = canvas;
    this.store = store;
    this.renderer = new Renderer(canvas, this.cam, this.particles, this.debris);
    sfx.muted = this.prefs.muted;
    this.ui.setMuted(this.prefs.muted);
    this.ui.fps.classList.toggle('hidden', !this.debug);
    this.bindInput();
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
  }

  private async enterProfiles(list?: Profile[]): Promise<void> {
    this.state = 'profile';
    this.ui.setPlaying(false);
    const profiles = list ?? (await this.store.listProfiles().catch(() => [] as Profile[]));
    this.ui.profiles(profiles, this.store.kind);
  }

  private async useProfile(name: string): Promise<void> {
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
      this.ui.profileError(e instanceof Error ? e.message : 'Could not open that profile');
    }
  }

  /** Progress saves are debounced so a burst of edits costs one write. */
  private persist(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushSave(), 400);
  }

  private flushSave(): void {
    clearTimeout(this.saveTimer);
    if (!this.profile) return;
    this.store.saveProgress(this.profile.id, this.data).catch(() => this.ui.showToast('Could not save progress.'));
  }

  get level(): LevelDef {
    return LEVELS[this.levelIdx];
  }

  // ───────────────────────────── Flow ─────────────────────────────

  private enterTitle(): void {
    this.leavePlay();
    this.state = 'title';
    this.ui.title(this.profile, this.data, continueLevel(this.data.best));
    this.ui.show('title');
  }

  /** Stops whatever was being built or driven and brings the demo back behind the menus. */
  private leavePlay(): void {
    this.paused = false;
    this.stopEngine();
    this.editor = null;
    this.run = null;
    this.ui.setPlaying(false);
    this.ui.hideToast();
    if (!this.demo) this.startDemo();
  }

  private startDemo(): void {
    const level = levelById(3);
    this.levelIdx = LEVELS.indexOf(level);
    this.demo = new TestRun(SOLUTIONS[level.id](level), level);
    this.demoTimer = 0;
    this.demoEnd = 0;
    this.develop = this.developTarget = 1;
    this.particles.clear();
    this.debris.clear();
    this.resetWheels(this.demo);
    this.fitCamera(true);
  }

  private enterChapters(): void {
    this.leavePlay();
    this.state = 'chapters';
    this.ui.chapters(this.data.best);
    this.ui.show('chapters');
  }

  private enterChapter(ch: ChapterDef): void {
    this.leavePlay();
    this.chapter = ch;
    this.state = 'chapter';
    this.ui.chapter(ch, this.data.best);
    this.ui.show('chapter');
  }

  /** Free play: any open level, starting from your saved design. */
  private playLevel(id: number): void {
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
    if (!chapterComplete(ch, this.data.best)) {
      sfx.invalid();
      this.ui.showToast(`Finish every level in ${ch.name} to unlock its challenge.`);
      return;
    }
    this.mode = 'challenge';
    this.chapter = ch;
    this.lives = START_LIVES;
    this.runScore = 0;
    this.levelsCleared = 0;
    this.loadLevel(LEVELS.indexOf(levelById(ch.levels[0])));
  }

  private loadLevel(idx: number): void {
    this.levelIdx = idx;
    const level = this.level;
    this.demo = null;
    this.run = null;
    this.paused = false;
    this.attempts = 0;
    const saved = this.mode === 'play' ? this.data.designs[level.id] : undefined;
    this.editor = new Editor(level, this.editorEvents(), saved);
    this.editor.cursorX = 0;
    this.editor.cursorY = 0;
    this.editor.setMaterial(level.materials[0]);
    this.state = 'build';
    this.developTarget = 0;
    this.develop = 0;
    this.particles.clear();
    this.debris.clear();
    this.floats.length = 0;
    this.ui.show(null);
    this.ui.setPlaying(true);
    this.ui.setLevel(level, levelCode(level.id));
    this.ui.setTesting(false);
    this.refreshHud();
    this.fitCamera(true);
    this.ui.showToast(level.tip, 4200);
    sfx.whoosh();
  }

  private startTest(): void {
    if (this.state !== 'build' || !this.editor || this.paused) return;
    this.editor.cancel();
    this.persistDesign();
    this.run = new TestRun(this.editor.design, this.level);
    this.state = 'test';
    this.developTarget = 1;
    this.endTimer = -1;
    this.anyBreak = false;
    this.acc = 0;
    this.attempts++;
    this.particles.clear();
    this.debris.clear();
    this.resetWheels(this.run);
    this.ui.setTesting(true);
    this.ui.hideToast();
    this.ui.testBtn.classList.remove('pulse');
    this.hoverMember = this.hoverNode = -1;
    this.fitCamera(false);
    sfx.whoosh();
    sfx.engineStart(this.engineBase());
  }

  private backToBuild(): void {
    if (!this.editor) return;
    this.stopEngine();
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
  }

  private finishSuccess(): void {
    const run = this.run!;
    const level = this.level;
    const ch = this.chapter;
    const best = this.data.best;
    const score = scoreLevel(level, this.editor!.design, run.peakStress);
    const prev = best[level.id];
    const careerBefore = totals(best).score;
    const wasComplete = chapterComplete(ch, best);
    best[level.id] = {
      score: Math.max(prev?.score ?? 0, score.total),
      stars: Math.max(prev?.stars ?? 0, score.stars),
    };
    this.data.unlocked = highestUnlocked(best);
    // Challenge runs start from scratch; they never overwrite your saved free-play design.
    if (this.mode === 'play') this.data.designs[level.id] = this.editor!.design.serialize();
    this.flushSave();

    const lines: string[] = [];
    if (this.mode === 'challenge') {
      this.runScore += score.total;
      this.levelsCleared++;
      lines.push(`CHALLENGE ${this.runScore.toLocaleString('en-US')}`);
      if (score.stars === 3 && this.lives < MAX_LIVES) {
        this.lives++;
        this.ui.setLives(this.lives, MAX_LIVES, 'gained');
        lines.push('PERFECT: +1 LIFE');
      }
      this.ui.setScore(`CHALLENGE ${this.runScore.toLocaleString('en-US')}`, true);
    } else if (!prev) lines.push('FIRST CROSSING');
    else if (score.total > prev.score) lines.push('NEW PERSONAL BEST');
    else lines.push(`BEST ${prev.score.toLocaleString('en-US')}`);
    const gain = totals(best).score - careerBefore;
    if (gain > 0) lines.push(`CAREER +${gain.toLocaleString('en-US')}`);
    if (!wasComplete && chapterComplete(ch, best)) {
      const next = CHAPTERS[CHAPTERS.indexOf(ch) + 1];
      lines.push(next ? `CHAPTER COMPLETE · ${next.name.toUpperCase()} UNLOCKED` : 'EVERY CHAPTER COMPLETE');
    }

    this.state = 'result';
    this.stopEngine();
    const next = nextInChapter(level.id);
    const nextLabel = next ? 'NEXT' : this.mode === 'challenge' ? 'FINISH' : 'CHAPTERS';
    this.ui.result(level, score, run.peakStress, lines.join(' · '), this.mode === 'play', nextLabel);
    this.resultAnim = { t: 0, score, shown: 0, stars: 0 };
  }

  private finishCollapse(): void {
    this.state = 'collapse';
    this.stopEngine();
    if (this.mode === 'challenge') {
      this.lives--;
      this.ui.setLives(this.lives, MAX_LIVES, 'lost');
      if (this.lives <= 0) {
        this.gameOver(false);
        return;
      }
      this.ui.collapse(this.run!.reason, this.lives, MAX_LIVES);
    } else this.ui.collapse(this.run!.reason, null, MAX_LIVES);
  }

  private nextLevel(): void {
    const next = nextInChapter(this.level.id);
    if (this.mode === 'challenge') {
      if (next) this.loadLevel(LEVELS.indexOf(levelById(next)));
      else this.gameOver(true);
    } else if (next) this.playLevel(next);
    else this.enterChapters();
  }

  private gameOver(victory: boolean): void {
    this.state = 'over';
    this.stopEngine();
    if (victory) sfx.success();
    else sfx.gameOver();
    this.ui.over(victory, this.runScore, this.levelsCleared, this.chapter);
    this.ui.challengeTable([], 'over-rows', this.profile?.name ?? '');
    if (victory) this.confetti(this.cam.wx(this.renderer.w / 2), this.cam.wy(this.renderer.h * 0.3), 120);
    void this.recordRun();
  }

  /** Challenge runs are filed under the current profile's name on that chapter's board. */
  private async recordRun(): Promise<void> {
    if (!this.profile) return;
    const chapter = this.chapter.id;
    try {
      const rank = await this.store.submitScore(this.profile.id, this.runScore, this.levelsCleared, chapter);
      const highs = await this.store.highScores(chapter);
      if (this.state !== 'over') return;
      this.ui.challengeTable(highs, 'over-rows', this.profile.name, rank);
      this.ui.overRank(rank);
      if (rank >= 0) sfx.star(2);
    } catch {
      this.ui.showToast('Could not save the score.');
    }
  }

  private enterScores(): void {
    this.leavePlay();
    this.state = 'scores';
    this.ui.show('scores');
    this.showBoard(this.board);
  }

  /** Every board is computed from the same per-level bests, except challenges, which have their own table. */
  private showBoard(tab: Board, chapter = this.boardChapter): void {
    this.board = tab;
    this.boardChapter = chapter;
    const me = this.profile?.name ?? '';
    const ch = CHAPTERS[chapter - 1];
    this.ui.boardTabs(tab, chapter);
    const still = () => this.state === 'scores' && this.board === tab && this.boardChapter === chapter;
    if (tab === 'challenge') {
      void this.store
        .highScores(chapter)
        .catch(() => [])
        .then((h) => still() && this.ui.challengeTable(h, 'score-rows', me));
      return;
    }
    void this.store
      .levelScores()
      .catch(() => [])
      .then((rows) => {
        if (!still()) return;
        if (tab === 'career') this.ui.rankTable(rankProfiles(rows), me, 'career');
        else if (tab === 'chapter') this.ui.rankTable(rankProfiles(rows, ch.levels), me, 'chapter');
        else this.ui.levelRecordTable(ch.levels.map(levelById), bestPerLevel(rows), this.data, me);
      });
  }

  /** Quitting a challenge mid-way still banks the score earned so far on that chapter's board. */
  private async bankAbandonedRun(): Promise<void> {
    if (this.mode !== 'challenge' || this.runScore <= 0 || !this.profile) return;
    const score = this.runScore;
    this.runScore = 0;
    try {
      const rank = await this.store.submitScore(this.profile.id, score, this.levelsCleared, this.chapter.id);
      this.ui.showToast(rank >= 0 ? `Challenge banked: ${score.toLocaleString('en-US')} points, #${rank + 1} on the board.` : `Challenge banked: ${score.toLocaleString('en-US')} points.`, 3200);
      if (rank >= 0) sfx.star(2);
    } catch {
      this.ui.showToast('Could not save the score.');
    }
  }

  private setPaused(p: boolean): void {
    if (this.state !== 'build' && this.state !== 'test') return;
    if (p === this.paused) return;
    this.paused = p;
    this.ui.show(p ? 'pause' : null);
    if (p) this.editor?.cancel();
    if (this.state === 'test' && this.run?.status === 'running') {
      if (p) sfx.engineStop();
      else sfx.engineStart(this.engineBase());
    }
  }

  private toggleMute(): void {
    this.prefs.muted = !this.prefs.muted;
    sfx.unlock();
    sfx.setMuted(this.prefs.muted);
    this.ui.setMuted(this.prefs.muted);
    savePrefs(this.prefs);
  }

  private persistDesign(): void {
    if (!this.editor) return;
    this.data.designs[this.level.id] = this.editor.design.serialize();
    this.persist();
  }

  // ───────────────────────────── Actions ─────────────────────────────

  /** Opens a chapter's level list, or explains what unlocks it. */
  private openChapter(ch: ChapterDef): void {
    if (chapterUnlocked(ch, this.data.best)) {
      sfx.select();
      this.enterChapter(ch);
    } else {
      sfx.invalid();
      this.ui.showToast(`Finish ${CHAPTERS[CHAPTERS.indexOf(ch) - 1].name} to open ${ch.name}.`);
    }
  }

  private act(a: string, el?: HTMLElement): void {
    sfx.unlock();
    const chapterArg = () => CHAPTERS[Number(el?.dataset.chapter) - 1] ?? this.chapter;
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
        this.enterScores();
        break;
      case 'board':
        sfx.ui();
        this.showBoard((el?.dataset.board as Board) ?? 'career');
        break;
      case 'board-chapter':
        sfx.ui();
        this.showBoard(this.board === 'career' ? 'chapter' : this.board, Number(el?.dataset.chapter) || 1);
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
      case 'retry':
        sfx.ui();
        this.backToBuild();
        break;
      case 'next':
        sfx.select();
        this.nextLevel();
        break;
      case 'quit':
        sfx.ui();
        if (this.state !== 'over') void this.bankAbandonedRun();
        if (this.mode === 'play') this.enterChapter(this.chapter);
        else this.enterChapters();
        break;
      case 'restart':
        sfx.select();
        this.startChallenge(this.chapter);
        break;
    }
  }

  private selectMaterial(m: MaterialId): void {
    if (!this.editor || this.state !== 'build') return;
    if (this.editor.setMaterial(m)) {
      sfx.ui();
      this.refreshHud();
    } else {
      sfx.invalid();
      this.ui.shakeMat(m);
    }
  }

  private cycleMaterial(dir: number): void {
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
        if (left < this.level.money * 0.15) this.float((ax + bx) / 2, (ay + by) / 2 + 0.6, `${money(left)} left`, left < this.level.money * 0.05 ? PAL.bolt : PAL.gold, 15);
        this.refreshHud();
      },
      remove: (ax: number, ay: number, bx: number, by: number, mat: MaterialId) => {
        sfx.remove();
        for (let i = 0; i <= 6; i++) {
          const t = i / 6;
          this.particles.burst(PK.Chalk, ax + (bx - ax) * t, ay + (by - ay) * t, 2, 1.5, 0.4, 0.06, [MATERIAL_CHALK[mat]]);
        }
        this.refreshHud();
      },
      invalid: (reason: string, x: number, y: number) => {
        sfx.invalid();
        this.float(x, y + 0.5, reason, PAL.bolt, 15);
        if (reason.startsWith('Over budget') && this.editor) this.ui.shakeMat(this.editor.mat);
      },
    };
  }

  private refreshHud(): void {
    const ed = this.editor;
    if (!ed) return;
    this.ui.setMaterials(this.level, ed.mat, ed.left());
    this.ui.setBudget(ed.spent(), this.level.money, this.level.target);
    if (this.mode === 'challenge') {
      this.ui.setLives(this.lives, MAX_LIVES);
      this.ui.setScore(`CHALLENGE ${this.runScore.toLocaleString('en-US')}`);
    } else {
      this.ui.hudLives.innerHTML = '';
      const best = this.data.best[this.level.id];
      this.ui.setScore(best ? `BEST ${best.score.toLocaleString('en-US')} ${'★'.repeat(best.stars)}${'☆'.repeat(3 - best.stars)}` : 'NOT YET CROSSED');
    }
    // Nudge first-timers toward the test button once the hint is complete.
    const hint = this.level.hint;
    this.ui.testBtn.classList.toggle('pulse', !!hint && ed.design.members.length >= hint.length && this.attempts === 0);
  }

  private float(x: number, y: number, text: string, color: string, size = 18, life = 1.1): void {
    this.floats.push({ x, y, text, color, life, max: life, size });
    if (this.floats.length > 24) this.floats.shift();
  }

  private confetti(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const s = 6 + Math.random() * 9;
      this.particles.spawn(PK.Confetti, x, y, Math.cos(a) * s, Math.sin(a) * s, 2 + Math.random() * 1.5, 0.22, PAL.confetti[(Math.random() * PAL.confetti.length) | 0]);
    }
  }

  // ───────────────────────────── Update ─────────────────────────────

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

    const devSpeed = this.developTarget > this.develop ? 2.4 : 4;
    this.develop += Math.sign(this.developTarget - this.develop) * Math.min(Math.abs(this.developTarget - this.develop), dt * devSpeed);

    if (!this.paused) {
      this.slowmo = Math.max(0, this.slowmo - dt);
      const timeScale = this.slowmo > 0 ? 0.25 + 0.75 * (1 - this.slowmo / 0.7) ** 3 : 1;
      const sim = this.run ?? this.demo;
      if (sim && (this.state === 'test' || this.state === 'result' || this.state === 'collapse' || this.state === 'over' || this.demo)) {
        this.stepSim(sim, dt * timeScale);
      }
      this.editor?.tick(dt);
      this.particles.update(dt * timeScale, this.level.waterY);
      this.debris.update(dt * timeScale, this.level.waterY, (x, y, size) => {
        this.particles.burst(PK.Water, x, y, 8 + size * 6, 3.5, 0.8, 0.08, [PAL.foam, PAL.waterTop], 3);
        if (!this.demo) sfx.splash(false);
      });
      for (const f of this.floats) {
        f.life -= dt;
        f.y += dt * 0.8;
      }
      this.floats = this.floats.filter((f) => f.life > 0);
      this.flash = Math.max(0, this.flash - dt * 3);
    }

    if (this.state === 'test' && this.run) this.trackRun(dt);
    if (this.resultAnim && this.state === 'result') this.animateResult(dt);

    if (this.demo) this.demoCamera();
    this.shake.update(dt);
    this.cam.update(dt);
    this.cam.ox = this.shake.x;
    this.cam.oy = this.shake.y;
  }

  private stepSim(sim: TestRun, dt: number): void {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 4) {
      sim.step();
      this.acc -= STEP;
      steps++;
      this.handleBreaks(sim);
    }
    if (steps === 4) this.acc = 0;
    // Wheel spin follows the distance each wheel actually traveled.
    const w = sim.world;
    const v = sim.vehicle;
    [v.rearWheel, v.frontWheel].forEach((p, i) => {
      const dx = w.x[p] - this.lastWheelX[i];
      this.wheelAngles[i] += dx / v.def.wheelR;
      this.lastWheelX[i] = w.x[p];
    });

    // Dust kicked up by the tires, and a puff when a wheel lands hard.
    [v.rearWheel, v.frontWheel].forEach((p, i) => {
      const onGround = w.contact[p] === 1;
      const speed = Math.abs(w.vx[p]);
      const r = v.def.wheelR;
      if (onGround && this.wheelFall[i] < -3) {
        this.particles.burst(PK.Dust, w.x[p], w.y[p] - r, 10, 2.2, 0.8, 0.14, ['#d9cbb8', '#efe4d2']);
        if (!this.demo) this.shake.add(0.08);
      }
      if (onGround && speed > 1.5 && Math.random() < dt * 5) {
        this.particles.spawn(PK.Dust, w.x[p] - r * 0.8, w.y[p] - r * 0.8, -0.6 - Math.random(), 0.3 + Math.random() * 0.4, 0.7, 0.1, '#e3d6c2');
      }
      this.wheelFall[i] = onGround ? 0 : Math.min(this.wheelFall[i], w.vy[p]);
    });

    if (sim.splashed && !this.splashed.has(sim)) {
      this.splashed.add(sim);
      const x = (w.x[v.rearWheel] + w.x[v.frontWheel]) / 2;
      this.particles.burst(PK.Water, x, sim.level.waterY, 70, 9, 1.4, 0.12, [PAL.foam, '#ffffff', PAL.waterTop], 7);
      this.particles.spawn(PK.Ring, x, sim.level.waterY, 0, 0, 0.8, 4, PAL.foam);
      this.shake.add(0.7);
      if (!this.demo) sfx.splash(true);
    }

    if (this.demo) {
      this.demoTimer += dt;
      if (sim.status === 'running') this.demoEnd = this.demoTimer;
      if (this.demoTimer - this.demoEnd > 1.2 || this.demoTimer > 16) this.startDemo();
    }
  }

  private handleBreaks(sim: TestRun): void {
    const breaks = sim.world.breaks;
    if (breaks.length === 0) return;
    for (const b of breaks) {
      const mat = b.link.mat!;
      this.debris.add(b.ax, b.ay, b.bx, b.by, b.vx, b.vy, mat);
      if (mat === 'wood') {
        this.particles.burst(PK.Splinter, b.x, b.y, 22, 7, 1.2, 0.18, [PAL.wood, PAL.woodDark, '#e8b27a'], 2);
      } else if (mat === 'steel' || mat === 'cable') {
        this.particles.burst(PK.Spark, b.x, b.y, mat === 'cable' ? 18 : 30, 12, 0.6, 0.04, ['#fff3b0', PAL.gold, '#ff9d3b'], 2);
      } else if (mat === 'heavy') {
        this.particles.burst(PK.Splinter, b.x, b.y, 22, 6, 1.3, 0.22, [PAL.concrete, PAL.concreteDark, PAL.heavy], 2);
      } else {
        this.particles.burst(PK.Splinter, b.x, b.y, 16, 5, 1.2, 0.2, [PAL.road, '#555a63', PAL.roadLine], 2);
      }
      this.particles.burst(PK.Dust, b.x, b.y, 10, 1.6, 0.9, 0.25, ['#d9cbb8', '#ffffff']);
      this.particles.spawn(PK.Ring, b.x, b.y, 0, 0, 0.45, 2.2, '#ffffff');
      if (!this.demo) {
        sfx.crack(mat);
        this.shake.add(0.45);
        this.flash = Math.max(this.flash, 0.25);
        this.float(b.x, b.y + 0.8, mat === 'steel' ? 'CLANG!' : mat === 'cable' ? 'PING!' : mat === 'heavy' ? 'CRUNCH!' : 'SNAP!', PAL.bad, 24, 0.9);
        if (!this.anyBreak) this.slowmo = 0.7;
      }
      this.anyBreak = true;
    }
    breaks.length = 0;
  }

  private trackRun(dt: number): void {
    const run = this.run!;
    const w = run.world;
    const v = run.vehicle;
    const speed = Math.hypot(w.vx[v.rearWheel], w.vy[v.rearWheel]);
    sfx.engineUpdate(this.engineBase(), speed);

    // Creaks and dust from heavily loaded members.
    for (const l of w.links) {
      if (!l.bridge || l.broken) continue;
      const s = Math.abs(l.stress);
      if (s > 0.7 && Math.random() < dt * 6 * s) {
        sfx.creak(s);
        const t = Math.random();
        this.particles.spawn(PK.Dust, w.x[l.a] + (w.x[l.b] - w.x[l.a]) * t, w.y[l.a] + (w.y[l.b] - w.y[l.a]) * t, (Math.random() - 0.5) * 0.4, -0.5, 0.8, 0.08, '#e8dcc8');
      }
    }

    // Keep the vehicle in frame when the level is wider than the screen.
    this.frameTest(run, this.viewRect());

    if (run.status !== 'running') {
      if (this.endTimer < 0) {
        this.endTimer = 0;
        if (run.status === 'success') {
          sfx.engineStop();
          sfx.success();
          const x = goalX(this.level);
          const y = bankY(this.level);
          this.confetti(x, y + 3, 90);
          this.float(x - 2, y + 3.5, 'BRIDGE HOLDS!', PAL.ok, 30, 1.6);
          this.shake.add(0.2);
        } else {
          sfx.fail();
          sfx.engineStop();
        }
      }
      this.endTimer += dt;
      if (run.status === 'success' && this.endTimer > RESULT_DELAY) this.finishSuccess();
      else if (run.status === 'fail' && this.endTimer > COLLAPSE_DELAY) this.finishCollapse();
    }
  }

  private animateResult(dt: number): void {
    const a = this.resultAnim!;
    a.t += dt;
    const starTimes = [0.35, 0.6, 0.85];
    while (a.stars < a.score.stars && a.t > starTimes[a.stars]) {
      this.ui.lightStar(a.stars);
      sfx.star(a.stars);
      a.stars++;
    }
    const countT = Math.max(0, Math.min(1, (a.t - 0.5) / 1.0));
    const shown = Math.round(a.score.total * (1 - (1 - countT) ** 3));
    if (shown !== a.shown) {
      if (Math.floor(shown / 60) !== Math.floor(a.shown / 60)) sfx.tick();
      a.shown = shown;
      this.ui.setResultTotal(shown);
    }
    if (countT >= 1) this.resultAnim = null;
  }

  private stopEngine(): void {
    sfx.engineStop();
  }

  private engineBase(): number {
    return { car: 70, van: 58, truck: 44, bus: 40, semi: 34 }[this.level.vehicle];
  }

  private resetWheels(run: TestRun): void {
    const w = run.world;
    this.lastWheelX = [w.x[run.vehicle.rearWheel], w.x[run.vehicle.frontWheel]];
  }

  // ───────────────────────────── Camera ─────────────────────────────

  private viewRect(): Rect {
    const w = this.renderer.w;
    const h = this.renderer.h;
    const playing = this.state === 'build' || this.state === 'test';
    // Phones stack the budget meter under the HUD's top row.
    const top = playing ? (w < 560 ? 104 : 70) : 20;
    const bottom = playing ? (w < 560 ? 86 : 96) : 20;
    return { x: 12, y: top, w: w - 24, h: Math.max(100, h - top - bottom) };
  }

  private buildBounds(): [number, number, number, number] {
    const L = this.level;
    const top = this.editor?.topY ?? 4;
    return [-2.5, L.width + 2.5, L.waterY - 0.5, top + 0.5];
  }

  private testBounds(): [number, number, number, number] {
    const L = this.level;
    const top = Math.max(4, bankY(L) + 4, ...L.anchors.map((a) => a[1] + 2.5));
    return [START_X - 2, goalX(L) + 2.5, L.waterY - 1, top];
  }

  private fitCamera(snap: boolean): void {
    const [a, b, c, d] = this.state === 'build' ? this.buildBounds() : this.testBounds();
    this.cam.fit(a, b, c, d, this.viewRect(), snap);
  }

  /** Frames the whole test scene, or tracks the vehicle when that would be too small to read. */
  private frameTest(run: TestRun, vr: Rect, padBottom = 0, padTop = 0): void {
    const [x0, x1, y0, y1] = this.testBounds();
    this.cam.fit(x0, x1, y0 - padBottom, y1 + padTop, vr);
    const minScale = this.renderer.h > this.renderer.w * 1.2 ? 30 : 22;
    if (this.cam.tscale >= minScale) return;
    const s = Math.min(minScale, vr.h / (y1 - y0 + padBottom + padTop));
    this.cam.tscale = s;
    const halfW = this.renderer.w / 2 / s;
    this.cam.tcx = Math.max(x0 + halfW - 1, Math.min(x1 - halfW + 1, run.vehicleX + 2));
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
    if (this.demo) this.demoCamera();
    else this.fitCamera(true);
    this.cam.snap();
  }

  // ───────────────────────────── Render ─────────────────────────────

  render(): void {
    const sim = this.run ?? this.demo;
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
      flash: this.flash,
      wheelAngles: this.wheelAngles,
      floats: this.floats,
    });
  }

  // ───────────────────────────── Input ─────────────────────────────

  private bindInput(): void {
    window.addEventListener('resize', () => this.onResize());
    this.ui.onAction((a, el) => this.act(a, el));
    this.ui.testBtn.addEventListener('click', () => {
      sfx.unlock();
      if (this.state === 'build') this.startTest();
      else if (this.state === 'test') this.backToBuild();
    });
    this.ui.pauseBtn.addEventListener('click', () => {
      sfx.ui();
      this.setPaused(!this.paused);
    });
    this.ui.muteBtn.addEventListener('click', () => this.toggleMute());
    this.ui.undoBtn.addEventListener('click', () => this.undo());
    this.ui.redoBtn.addEventListener('click', () => this.redo());
    this.ui.clearBtn.addEventListener('click', () => {
      this.editor?.clear();
      this.refreshHud();
    });
    for (const [id, b] of this.ui.matBtns) b.addEventListener('click', () => this.selectMaterial(id));
    document.getElementById('profile-form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      sfx.unlock();
      void this.useProfile((document.getElementById('profile-name') as HTMLInputElement).value);
    });
    window.addEventListener('pagehide', () => this.flushSave());

    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.pointerDown(e));
    c.addEventListener('pointermove', (e) => this.pointerMove(e));
    c.addEventListener('pointerup', (e) => this.pointerUp(e));
    c.addEventListener('pointercancel', (e) => this.pointerUp(e, true));
    c.addEventListener('pointerleave', () => {
      this.hoverNode = this.hoverMember = -1;
      this.hoverAttach = null;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (this.state !== 'build' && this.state !== 'test') return;
        this.cam.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => this.keyDown(e));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.setPaused(true);
    });
  }

  private worldAt(x: number, y: number): [number, number] {
    return [this.cam.wx(x), this.cam.wy(y)];
  }

  private pickRadius(px: number, min: number): number {
    return Math.max(min, px / this.cam.scale);
  }

  private pointerDown(e: PointerEvent): void {
    sfx.unlock();
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, type: e.pointerType });
    this.keyboardMode = false;
    if (this.paused || (this.state !== 'build' && this.state !== 'test')) return;

    if (this.pointers.size === 2) {
      // Second finger: switch to pinch/pan and abandon any in-progress member.
      this.editor?.cancel();
      this.dragging = false;
      this.pendingDelete = -1;
      this.panning = false;
      const [p1, p2] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      this.lastMid = [(p1.x + p2.x) / 2, (p1.y + p2.y) / 2];
      return;
    }
    if (this.pointers.size > 2) return;

    const [wx, wy] = this.worldAt(e.clientX, e.clientY);
    const ed = this.editor;
    if (this.state === 'build' && ed) {
      if (e.button === 2) {
        ed.removeMember(ed.memberAt(wx, wy, this.pickRadius(14, 0.25)));
        return;
      }
      const touch = e.pointerType === 'touch';
      const picked = ed.beginAt(wx, wy, this.pickRadius(touch ? 26 : 18, 0.4), this.pickRadius(touch ? 18 : 12, 0.3));
      if (picked) {
        ed.aim(wx, wy);
        this.dragging = true;
        this.hoverNode = ed.drag!.from;
        // A tap that never moves still deletes the beam under it: from an attach point, or on
        // the body of a beam too short to tap clear of its joints.
        this.pendingDelete = picked === 'split' ? ed.drag!.fromSplit : ed.memberBodyAt(wx, wy, this.pickRadius(touch ? 16 : 10, 0.2));
        sfx.tick();
        return;
      }
      const m = ed.memberAt(wx, wy, this.pickRadius(touch ? 16 : 10, 0.2));
      if (m >= 0) {
        this.pendingDelete = m;
        this.hoverMember = m;
        return;
      }
    }
    this.panning = true;
  }

  private pointerMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    const px = p?.x ?? e.clientX;
    const py = p?.y ?? e.clientY;
    if (p) {
      p.x = e.clientX;
      p.y = e.clientY;
    }
    if (this.paused) return;

    if (this.pointers.size === 2) {
      const [p1, p2] = [...this.pointers.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const mid: [number, number] = [(p1.x + p2.x) / 2, (p1.y + p2.y) / 2];
      if (this.pinchDist > 0) this.cam.zoomAt(mid[0], mid[1], d / this.pinchDist);
      this.cam.pan(mid[0] - this.lastMid[0], mid[1] - this.lastMid[1]);
      this.pinchDist = d;
      this.lastMid = mid;
      return;
    }

    const [wx, wy] = this.worldAt(e.clientX, e.clientY);
    const ed = this.editor;
    if (this.dragging && ed?.drag) {
      if (this.pendingDelete >= 0 && p && Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > 10) this.pendingDelete = -1;
      const before = `${ed.drag.tx},${ed.drag.ty}`;
      ed.aim(wx, wy);
      if (`${ed.drag.tx},${ed.drag.ty}` !== before) sfx.tick();
      return;
    }
    if (this.panning && p) {
      this.cam.pan(e.clientX - px, e.clientY - py);
      return;
    }
    if (this.pendingDelete >= 0 && p && Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > 10) {
      this.pendingDelete = -1;
      this.panning = true;
    }
    if (this.state === 'build' && ed && e.pointerType === 'mouse' && !p) {
      this.hoverNode = ed.nodeAt(wx, wy, this.pickRadius(18, 0.4));
      this.hoverMember = this.hoverNode < 0 ? ed.memberAt(wx, wy, this.pickRadius(10, 0.2)) : ed.memberBodyAt(wx, wy, this.pickRadius(10, 0.2));
      this.hoverAttach = this.hoverNode < 0 ? ed.attachAt(wx, wy, this.pickRadius(12, 0.3)) : null;
    }
  }

  private pointerUp(e: PointerEvent, cancelled = false): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size > 0) {
      if (this.pointers.size === 1) {
        // Leaving a pinch: continue as a pan with the remaining finger.
        this.pinchDist = 0;
        this.panning = true;
      }
      return;
    }
    const ed = this.editor;
    if (this.dragging && ed) {
      if (cancelled || this.pendingDelete >= 0) ed.cancel();
      else ed.commit();
      this.dragging = false;
      if (e.pointerType !== 'mouse') this.hoverNode = -1;
    }
    if (this.pendingDelete >= 0 && ed && !cancelled) {
      ed.removeMember(this.pendingDelete);
    }
    this.pendingDelete = -1;
    this.panning = false;
    if (e.pointerType !== 'mouse') this.hoverMember = -1;
  }

  private undo(): void {
    if (this.state === 'build' && this.editor?.undo()) {
      sfx.remove();
      this.refreshHud();
    }
  }

  private redo(): void {
    if (this.state === 'build' && this.editor?.redo()) {
      sfx.place(this.editor.mat);
      this.refreshHud();
    }
  }

  private keyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT') return;
    const k = e.key;
    const lower = k.toLowerCase();
    sfx.unlock();

    if (lower === 'm') {
      this.toggleMute();
      return;
    }

    switch (this.state) {
      case 'title':
        if (k === 'Enter' || k === ' ') {
          e.preventDefault();
          this.act('continue');
        } else if (lower === 'c') this.act('chapters');
        else if (lower === 'h') this.act('scores');
        return;
      case 'profile':
        return;
      case 'chapters':
        if (k === 'Escape' || k === 'Backspace') this.act('back');
        else if (k >= '1' && k <= String(CHAPTERS.length) && k.length === 1) this.openChapter(CHAPTERS[Number(k) - 1]);
        return;
      case 'chapter':
        if (k === 'Escape' || k === 'Backspace') this.act('back');
        else if (k >= '1' && k <= String(this.chapter.levels.length) && k.length === 1) this.playLevel(this.chapter.levels[Number(k) - 1]);
        return;
      case 'scores': {
        const tabs: Board[] = ['career', 'chapter', 'levels', 'challenge'];
        if (k === 'Escape' || k === 'Backspace') this.act('back');
        else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Tab') {
          e.preventDefault();
          const d = k === 'ArrowLeft' || (k === 'Tab' && e.shiftKey) ? -1 : 1;
          this.showBoard(tabs[(tabs.indexOf(this.board) + d + tabs.length) % tabs.length]);
        } else if (k >= '1' && k <= String(CHAPTERS.length) && k.length === 1) this.showBoard(this.board === 'career' ? 'chapter' : this.board, Number(k));
        return;
      }
      case 'result':
        if (k === 'Enter' || k === ' ' || lower === 'n') {
          e.preventDefault();
          this.act('next');
        } else if (lower === 'r' && this.mode === 'play') this.act('retry');
        else if (k === 'Escape') this.act('quit');
        return;
      case 'collapse':
        if (lower === 'r' || k === 'Enter' || k === ' ') {
          e.preventDefault();
          this.act('retry');
        } else if (k === 'Escape') this.act('quit');
        return;
      case 'over':
        if (lower === 'r' || k === 'Enter') {
          e.preventDefault();
          this.act('restart');
        } else if (k === 'Escape') this.act('quit');
        return;
    }

    // build / test
    if (this.paused) {
      if (k === 'Escape' || lower === 'p') this.setPaused(false);
      else if (lower === 'r') {
        this.setPaused(false);
        this.backToBuild();
      } else if (lower === 'q') this.act('quit');
      return;
    }
    if (lower === 'p') {
      this.setPaused(true);
      return;
    }
    if (lower === 'f') {
      this.fitCamera(false);
      return;
    }
    if (this.state === 'test') {
      if (k === 'Escape') this.setPaused(true);
      else if (lower === 't' || lower === 'r' || lower === 'e') this.backToBuild();
      return;
    }

    const ed = this.editor;
    if (!ed) return;
    const move = (dx: number, dy: number) => {
      e.preventDefault();
      this.keyboardMode = true;
      const nx = ed.cursorX + dx;
      const ny = ed.cursorY + dy;
      if (nx < -1 || nx > this.level.width + 1 || ny > ed.topY || ny < this.level.waterY + 1) return;
      ed.cursorX = nx;
      ed.cursorY = ny;
      sfx.tick();
      if (ed.drag) ed.aim(nx, ny);
    };
    if ((e.ctrlKey || e.metaKey) && lower === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && lower === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }
    switch (k) {
      case 'ArrowLeft':
      case 'a':
      case 'A':
        move(-1, 0);
        return;
      case 'ArrowRight':
      case 'd':
      case 'D':
        move(1, 0);
        return;
      case 'ArrowUp':
      case 'w':
      case 'W':
        move(0, 1);
        return;
      case 'ArrowDown':
      case 's':
      case 'S':
        move(0, -1);
        return;
    }
    if (k === ' ' || k === 'Enter') {
      e.preventDefault();
      this.keyboardMode = true;
      if (ed.drag) {
        const to = ed.commit();
        // Chain: keep building from where the last member ended.
        if (to >= 0) {
          ed.begin(to);
          ed.aim(ed.cursorX, ed.cursorY);
        }
      } else {
        if (ed.beginAt(ed.cursorX, ed.cursorY, 0.05, 0.45)) {
          ed.aim(ed.cursorX, ed.cursorY);
          sfx.tick();
        } else {
          sfx.invalid();
          this.float(ed.cursorX, ed.cursorY + 0.5, 'Start on a node', PAL.bolt, 14);
        }
      }
      return;
    }
    if (k === 'Escape') {
      if (ed.drag) ed.cancel();
      else this.setPaused(true);
      return;
    }
    if (k === 'x' || k === 'X' || k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      this.keyboardMode = true;
      const m = ed.memberAt(ed.cursorX, ed.cursorY, 0.6);
      if (m >= 0) ed.removeMember(m);
      else sfx.invalid();
      return;
    }
    if (k >= '1' && k <= String(MATERIAL_ORDER.length) && k.length === 1) {
      this.selectMaterial(MATERIAL_ORDER[Number(k) - 1]);
      return;
    }
    if (lower === 'q') this.cycleMaterial(-1);
    else if (lower === 'e') this.cycleMaterial(1);
    else if (lower === 'z') this.undo();
    else if (lower === 'y') this.redo();
    else if (lower === 't') this.startTest();
    else if (lower === 'c' && e.shiftKey) {
      ed.clear();
      this.refreshHud();
    }
  }
}
