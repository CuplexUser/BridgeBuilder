import { sfx } from '../audio';
import { challengeBoard, chapterById, chapterComplete, CHAPTERS, highestUnlocked, levelById, nextInChapter, totals, type ChapterDef } from '../chapters';
import { LEVELS } from '../levels';
import { canRate } from '../platform';
import { loadRate, saveRate, shouldAsk } from '../rating';
import { scoreLevel, type LevelScore } from '../scoring';
import { bestPerLevel, rankProfiles } from '../storage';
import { MAX_LIVES, type Board, type Game } from './game';
import { fmt, t } from '../i18n';
import { chapterText } from '../i18n/data';

/** How a run ends: the result card and its score, a collapse, the next level, game over, and the leaderboards. */
export class Results {
  board: Board = 'career';
  /** The leaderboard's chapter, by id. */
  private boardChapter = 1;
  /**
   * The result card counting up: stars lit so far, the score shown, and whether the three-star
   * moment and the new-record ribbon have played. `record`: the score beat an earlier best.
   */
  resultAnim: { t: number; score: LevelScore; shown: number; stars: number; bonusShown: boolean; record: boolean; perfect: boolean; ribbon: boolean } | null = null;
  /**
   * A chapter this result finished for the first time: its card comes next, even after another
   * go at the level. Leaving the level drops it.
   */
  pendingDone: ChapterDef | null = null;
  /** The chapter card showing, over the result. */
  doneOpen: ChapterDef | null = null;
  /** The score of the last crossing, for sharing it. */
  lastScore: LevelScore | null = null;

  constructor(private game: Game) {}

  finishSuccess(): void {
    const run = this.game.run!;
    const level = this.game.level;
    if (this.game.mode === 'custom') {
      // A playtest scores like any level, but nothing goes on the career or the boards.
      const s = scoreLevel(level, this.game.editor!.design, run.peakStress, 0, run.lost.size);
      this.game.persistDesign();
      this.game.playGames.moment('playtest');
      this.game.state = 'result';
      this.game.drive.stopEngine();
      this.lastScore = s;
      this.game.ui.setShare(this.game.sharing.available);
      this.game.ui.result(level, s, run.peakStress, t('res.playtest'), true, t('res.editLevel'), this.game.review(level, run, true));
      this.resultAnim = this.startAnim(s, false);
      return;
    }
    const ch = this.game.chapter;
    const best = this.game.data.best;
    // Hints count against free play only: a challenge starts from scratch and offers none.
    const score = scoreLevel(level, this.game.editor!.design, run.peakStress, this.game.mode === 'play' ? this.game.hintsShown().length : 0, run.lost.size);
    const prev = best[level.id];
    const careerBefore = totals(best).score;
    const wasComplete = chapterComplete(ch, best);
    // The record run's cost, peak stress and bridge go with the best score, for the level boards.
    const record = !prev || score.total > prev.score;
    const { cost, peak, design } = record ? { cost: score.spent, peak: run.peakStress, design: this.game.editor!.design.serialize() } : prev;
    best[level.id] = {
      score: Math.max(prev?.score ?? 0, score.total),
      stars: Math.max(prev?.stars ?? 0, score.stars),
      ...(prev?.bonus || score.bonus ? { bonus: true } : {}),
      ...(cost === undefined ? {} : { cost }),
      ...(peak === undefined ? {} : { peak }),
      ...(design === undefined ? {} : { design }),
    };
    this.game.data.unlocked = highestUnlocked(best);
    // Challenge runs start from scratch; they never overwrite your saved free-play design.
    if (this.game.mode === 'play') this.game.data.designs[level.id] = this.game.editor!.design.serialize();
    this.game.flushSave();

    const lines: string[] = [];
    if (this.game.mode === 'challenge') {
      this.game.runScore += score.total;
      this.game.levelsCleared++;
      lines.push(t('hud.challenge', { score: this.game.runScore }));
      if (score.stars === 3 && this.game.lives < MAX_LIVES) {
        this.game.lives++;
        this.game.ui.setLives(this.game.lives, MAX_LIVES, 'gained');
        lines.push(t('res.perfect'));
      }
      this.game.ui.setScore(t('hud.challenge', { score: this.game.runScore }), true);
    } else if (!prev) lines.push(t('res.first'));
    else if (score.total > prev.score) lines.push(t('res.personalBest'));
    else lines.push(t('res.best', { score: prev.score }));
    if (score.bonus && !prev?.bonus) lines.push(t('res.bonusMet'));
    const gain = totals(best).score - careerBefore;
    if (gain > 0) lines.push(t('res.career', { gain }));
    if (!wasComplete && chapterComplete(ch, best)) {
      const next = CHAPTERS[CHAPTERS.indexOf(ch) + 1];
      lines.push(next ? t('res.chapterDone', { name: fmt.upper(chapterText(next, 'name')) }) : t('res.allDone'));
      this.pendingDone = ch;
    }

    this.game.state = 'result';
    this.game.drive.stopEngine();
    this.lastScore = score;
    this.game.ui.setShare(this.game.sharing.available);
    const next = nextInChapter(level.id);
    const nextLabel = t(next ? 'res.next' : this.game.mode === 'challenge' ? 'res.finish' : 'res.chapters');
    this.game.ui.result(level, score, run.peakStress, lines.join(' · '), this.game.mode === 'play', nextLabel, this.game.review(level, run, this.game.mode === 'play'));
    this.resultAnim = this.startAnim(score, this.game.mode === 'play' && !!prev && score.total > prev.score);
  }

  private startAnim(score: LevelScore, record: boolean): NonNullable<Results['resultAnim']> {
    return { t: 0, score, shown: 0, stars: 0, bonusShown: false, record, perfect: false, ribbon: false };
  }

  /** The card for the chapter this result finished. */
  showDone(): void {
    const ch = this.pendingDone;
    if (!ch) return;
    this.pendingDone = null;
    this.doneOpen = ch;
    sfx.fanfare();
    this.game.haptics.celebrate();
    // A chapter finished well, a while into the game, is when a rating on Google Play is asked for.
    const rate = loadRate();
    const ask = canRate && shouldAsk(ch, this.game.data.best, rate);
    if (ask) saveRate({ ...rate, asked: rate.asked + 1 });
    this.game.ui.chapterDone(ch, this.game.data.best, CHAPTERS[CHAPTERS.indexOf(ch) + 1], ask);
  }

  /** On to the map, where the road into the next chapter is laid. */
  closeDone(): void {
    const ch = this.doneOpen;
    if (!ch) return;
    this.doneOpen = null;
    sfx.select();
    this.game.enterChapters(CHAPTERS[CHAPTERS.indexOf(ch) + 1]);
  }

  finishCollapse(): void {
    this.game.state = 'collapse';
    this.game.drive.stopEngine();
    const run = this.game.run!;
    if (run.collapsed) this.game.playGames.moment('collapse');
    this.game.ui.setShare(this.game.sharing.available);
    if (this.game.mode === 'challenge') {
      this.game.lifeLost = true;
      this.game.lives--;
      this.game.ui.setLives(this.game.lives, MAX_LIVES, 'lost');
      if (this.game.lives <= 0) {
        this.gameOver(false);
        return;
      }
      this.game.ui.collapse(run.reason, run.collapsed, this.game.lives, MAX_LIVES);
    } else this.game.ui.collapse(run.reason, run.collapsed, null, MAX_LIVES, this.game.mode === 'custom');
  }

  nextLevel(): void {
    if (this.pendingDone) {
      this.showDone();
      return;
    }
    if (this.game.mode === 'custom') {
      this.game.maker.enterMaker(this.game.level);
      return;
    }
    const next = nextInChapter(this.game.level.id);
    if (this.game.mode === 'challenge') {
      if (next) this.game.loadLevel(LEVELS.indexOf(levelById(next)));
      else this.gameOver(true);
    } else if (next) this.game.playLevel(next);
    else this.game.enterChapters();
  }

  private gameOver(victory: boolean): void {
    this.game.state = 'over';
    this.game.drive.stopEngine();
    if (victory) sfx.success();
    else sfx.gameOver();
    this.game.ui.over(victory, this.game.runScore, this.game.levelsCleared, this.game.chapter);
    if (victory) {
      this.game.playGames.moment('challenge');
      if (!this.game.lifeLost) this.game.playGames.moment('flawless');
    }
    this.game.ui.challengeTable([], 'over-rows', this.game.profile?.name ?? '');
    if (victory) this.game.confetti(this.game.cam.wx(this.game.renderer.w / 2), this.game.cam.wy(this.game.renderer.h * 0.3), 120);
    void this.recordRun();
  }

  /** Challenge runs are filed under the current profile's name on that chapter's board. */
  private async recordRun(): Promise<void> {
    if (!this.game.profile) return;
    const chapter = challengeBoard(this.game.chapter.id);
    try {
      this.game.playGames.challenge(this.game.chapter, this.game.runScore);
      const rank = await this.game.store.submitScore(this.game.profile.id, this.game.runScore, this.game.levelsCleared, chapter);
      const highs = await this.game.store.highScores(chapter);
      if (this.game.state !== 'over') return;
      this.game.ui.challengeTable(highs, 'over-rows', this.game.profile.name, rank);
      this.game.ui.overRank(rank);
      if (rank >= 0) sfx.star(2);
    } catch {
      this.game.ui.showToast(t('toast.scoreFail'));
    }
  }

  enterScores(): void {
    this.game.leavePlay();
    this.game.state = 'scores';
    this.game.ui.show('scores');
    this.game.ui.playGames(this.game.playGames.status);
    this.showBoard(this.board);
  }

  /** Every board is computed from the same per-level bests, except challenges, which have their own table. */
  /** Shows a leaderboard tab, for the chapter with the given id. */
  showBoard(tab: Board, chapter = this.boardChapter): void {
    this.board = tab;
    this.boardChapter = chapter;
    const me = this.game.profile?.name ?? '';
    const ch = chapterById(chapter) ?? CHAPTERS[0];
    this.game.ui.boardTabs(tab, chapter);
    const still = () => this.game.state === 'scores' && this.board === tab && this.boardChapter === chapter;
    if (tab === 'challenge') {
      void this.game.store
        .highScores(challengeBoard(chapter))
        .catch(() => [])
        .then((h) => still() && this.game.ui.challengeTable(h, 'score-rows', me));
      return;
    }
    void this.game.store
      .levelScores()
      .catch(() => [])
      .then((rows) => {
        if (!still()) return;
        if (tab === 'career') this.game.ui.rankTable(rankProfiles(rows), me, 'career');
        else if (tab === 'chapter') this.game.ui.rankTable(rankProfiles(rows, ch.levels), me, 'chapter');
        else this.game.ui.levelRecordTable(ch.levels.map(levelById), bestPerLevel(rows), this.game.data, me);
      });
  }

  /** Quitting a challenge mid-way still banks the score earned so far on that chapter's board. */
  async bankAbandonedRun(): Promise<void> {
    if (this.game.mode !== 'challenge' || this.game.runScore <= 0 || !this.game.profile) return;
    const score = this.game.runScore;
    this.game.runScore = 0;
    this.game.playGames.challenge(this.game.chapter, score);
    try {
      const rank = await this.game.store.submitScore(this.game.profile.id, score, this.game.levelsCleared, challengeBoard(this.game.chapter.id));
      this.game.ui.showToast(rank >= 0 ? t('toast.bankedRank', { score, rank: rank + 1 }) : t('toast.banked', { score }), 3200);
      if (rank >= 0) sfx.star(2);
    } catch {
      this.game.ui.showToast(t('toast.scoreFail'));
    }
  }

  animateResult(dt: number): void {
    const a = this.resultAnim!;
    a.t += dt;
    const starTimes = [0.35, 0.6, 0.85];
    while (a.stars < a.score.stars && a.t > starTimes[a.stars]) {
      this.game.ui.lightStar(a.stars);
      sfx.star(a.stars);
      a.stars++;
    }
    const perfect = a.score.stars === 3;
    if (perfect && !a.perfect && a.t > 1.05) {
      a.perfect = true;
      this.game.ui.perfect();
      sfx.perfect();
      this.game.haptics.celebrate();
    }
    // After a three-star chord, the bonus star waits for it to ring out.
    if (a.score.bonus && !a.bonusShown && a.t > (perfect ? 1.6 : 1.15)) {
      a.bonusShown = true;
      this.game.ui.lightBonus();
      sfx.star(3);
    }
    const countT = Math.max(0, Math.min(1, (a.t - 0.5) / 1.0));
    const shown = Math.round(a.score.total * (1 - (1 - countT) ** 3));
    if (shown !== a.shown) {
      if (Math.floor(shown / 60) !== Math.floor(a.shown / 60)) sfx.tick();
      a.shown = shown;
      this.game.ui.setResultTotal(shown);
    }
    if (countT >= 1 && a.record && !a.ribbon && a.t > 1.7) {
      a.ribbon = true;
      this.game.ui.showRibbon();
      sfx.record();
    }
    if (countT >= 1 && (a.bonusShown || !a.score.bonus) && (a.perfect || !perfect) && (a.ribbon || !a.record)) this.resultAnim = null;
  }
}
