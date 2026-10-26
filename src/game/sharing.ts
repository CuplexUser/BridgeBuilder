import { chapterOf, levelById, levelCode, levelUnlocked } from '../chapters';
import { Design } from '../design';
import { fitDesign } from '../editor';
import { fmt, t } from '../i18n';
import { levelName } from '../i18n/data';
import { LEVELS, type LevelDef } from '../levels';
import { exportLevel, isCustom, makerIssues, nextCustomId, parseLevel, saveCustom } from '../maker';
import type { TestRun } from '../physics/testrun';
import { shareBridge } from '../platform';
import { PAL } from '../render/palette';
import { readShareLink, shareLink, storeBridge, storePicture, type SharedBridge } from '../share';
import { CARD_H, CARD_W, cardImage, shareCard, type CardText } from '../sharecard';
import type { Game } from './game';

/** How long into a collapse the picture is taken, s after the first part breaks. */
const INTO_COLLAPSE = 0.5;
/**
 * How long sharing waits for the share service to take a bridge, ms, before handing on its short
 * link anyway. A browser's share sheet only opens soon after the tap, so it can't wait long.
 */
const SHORT_WAIT = 1500;

/**
 * Sharing a bridge as a picture and a link, and watching one that came in by link: it drives
 * across in the recipient's game the way a level's example does.
 */
export class Sharing {
  /** A bridge from a link, waiting for a profile to watch it under, or for a challenge to end. */
  private pending: SharedBridge | null = null;
  /** The shared bridge being watched is on a level the player can't build on yet: watching ends on the chapters. */
  leaveAfter = false;
  private busy = false;

  constructor(private game: Game) {}

  /** Whether the run on screen can be shared: one of the player's own, with its moments logged. */
  get available(): boolean {
    const g = this.game;
    return !g.example && !!g.run?.log.poses?.length && !!g.profile;
  }

  /** Shares the run on screen: a picture of its key moment, and a link that drives it. */
  async share(): Promise<void> {
    const g = this.game;
    const run = g.run;
    const design = g.editor?.design;
    if (!this.available || this.busy || !run || !design || !g.profile) return;
    this.busy = true;
    try {
      const level = g.level;
      // A custom level has no code, and goes in the link whole.
      const custom = isCustom(level.id);
      const code = custom ? '' : levelCode(level.id);
      const name = g.profile.name;
      const crossed = run.status === 'success';
      const score = crossed ? g.results.lastScore : null;
      const words: CardText = {
        title: custom ? fmt.upper(levelName(level)) : `${code} ${fmt.upper(levelName(level))}`,
        line: score ? t('share.cardScore', { score: fmt.num(score.total), cost: fmt.money(score.spent) }) : `${t(run.collapsed ? 'collapse.collapsed' : 'collapse.failed')} · ${run.reason}`,
        by: t('share.by', { name }),
        stars: score ? score.stars : null,
        tone: crossed ? PAL.ok : PAL.bad,
      };
      const card = this.picture(run, words);
      const image = cardImage(card, 'image/png');
      const url = await this.linkFor({ level: level.id, design: design.serialize(), name, custom: custom ? exportLevel(level) : undefined }, words, card);
      const said = custom ? (crossed ? 'share.crossedCustom' : 'share.collapsedCustom') : crossed ? 'share.crossed' : 'share.collapsed';
      const text = t(said, { name, code, level: levelName(level) });
      const outcome = await shareBridge(`bridge-builder-${code || 'custom'}.png`, await image, text, url);
      if (outcome === 'copied') g.ui.showToast(t('share.copied'), 3200);
    } catch {
      g.ui.showToast(t('share.fail'));
    } finally {
      this.busy = false;
    }
  }

  /**
   * The short link, once the share service has the bridge or is still taking it after SHORT_WAIT,
   * and the long one when the service can't be reached. The preview picture follows the bridge.
   */
  private async linkFor(bridge: SharedBridge, words: CardText, card: HTMLCanvasElement): Promise<string> {
    if (navigator.onLine !== false) {
      try {
        const stored = await storeBridge(bridge, { title: words.title, line: words.line, by: words.by });
        const jpeg = cardImage(card, 'image/jpeg');
        // A link without its picture still opens the bridge: a failed upload costs only the preview.
        stored.saved.then(async () => storePicture(stored.code, await jpeg)).catch(() => {});
        const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(true), SHORT_WAIT));
        if (await Promise.race([stored.saved.then(() => true, () => false), timeout])) return stored.url;
      } catch {
        // The long link, below.
      }
    }
    return shareLink(bridge);
  }

  /**
   * The run drawn at its key moment at the card's size, then made into the card. The canvas is
   * back to the window's size and drawn over before the next frame paints, so nobody sees it.
   */
  private picture(run: TestRun, text: CardText): HTMLCanvasElement {
    const g = this.game;
    const log = run.log;
    const first = log.breaks[0];
    const sample = run.status === 'success' ? log.peakSample() : first ? log.sampleAt(first.t + INTO_COLLAPSE) : log.length - 1;
    const cam = g.cam;
    const kept = { cx: cam.cx, cy: cam.cy, scale: cam.scale, tcx: cam.tcx, tcy: cam.tcy, tscale: cam.tscale, ox: cam.ox, oy: cam.oy };
    let card: HTMLCanvasElement | null = null;
    try {
      g.renderer.atSize(CARD_W, CARD_H, () => {
        cam.ox = cam.oy = 0;
        const [x0, x1, y0, y1] = g.testBounds();
        cam.fit(x0, x1, y0, y1, { x: 0, y: 0, w: CARD_W, h: CARD_H }, true);
        log.posed(run.world, sample, () => g.drawScene(run, true));
        card = shareCard(g.canvas, text);
      });
    } finally {
      Object.assign(cam, kept);
    }
    const made = card as HTMLCanvasElement | null;
    if (!made) throw new Error('No picture');
    return made;
  }

  /** Reads a link the game was opened with, and watches its bridge as soon as it can. */
  async open(url: string): Promise<void> {
    let s: SharedBridge | null;
    try {
      s = await readShareLink(url);
    } catch {
      this.game.ui.showToast(t('share.offline'), 4000);
      return;
    }
    if (!s || (!s.custom && !LEVELS.some((l) => l.id === s.level))) {
      this.game.ui.showToast(t('share.bad'), 4000);
      return;
    }
    this.pending = s;
    this.watchPending();
  }

  /** Watches a bridge that came in by link, once there's a profile and no challenge is running. */
  watchPending(): void {
    const g = this.game;
    const s = this.pending;
    const inChallenge = g.mode === 'challenge' && (g.state === 'build' || g.state === 'test' || g.state === 'result' || g.state === 'collapse');
    if (!s || !g.profile || g.state === 'profile' || inChallenge) return;
    this.pending = null;
    if (g.state === 'build') g.persistDesign();
    if (s.custom) {
      this.watchCustom(s, s.custom);
      return;
    }
    let design: Design;
    try {
      // Fitted to the level as it is now, in case it changed since the link was made.
      design = fitDesign(levelById(s.level), Design.deserialize(s.design)).design;
    } catch {
      g.ui.showToast(t('share.bad'), 4000);
      return;
    }
    const open = levelUnlocked(s.level, g.data.best) && !g.forSale(chapterOf(s.level));
    g.leavePlay();
    g.mode = 'play';
    g.chapter = chapterOf(s.level);
    g.loadLevel(LEVELS.indexOf(levelById(s.level)));
    this.leaveAfter = !open;
    g.startExample({ design, note: t(open ? 'share.watch' : 'share.watchLocked', { name: s.name || '?' }) });
  }

  /** A custom level from a link goes in the workshop, the first time, and its bridge drives on it there. */
  private watchCustom(s: SharedBridge, custom: string): void {
    const g = this.game;
    let level: LevelDef;
    let design: Design;
    let added = false;
    try {
      const read = parseLevel(custom, nextCustomId(g.custom.levels));
      if (makerIssues(read).length) throw new Error('Not playable');
      // The same level opened again, or one already imported by hand, isn't added twice.
      const key = levelKey(read);
      level = g.custom.levels.find((l) => levelKey(l) === key) ?? read;
      design = fitDesign(level, Design.deserialize(s.design)).design;
      if (level === read) {
        g.custom.levels.push(read);
        added = true;
        if (!saveCustom(g.custom)) g.ui.showToast(t('mkr.noStorage'));
      }
    } catch {
      g.ui.showToast(t('share.bad'), 4000);
      return;
    }
    g.leavePlay();
    g.mode = 'custom';
    g.customLevel = level;
    g.loadLevel(g.levelIdx);
    g.startExample({ design, note: t(added ? 'share.watchNew' : 'share.watch', { name: s.name || '?' }) });
  }
}

/** A custom level as it reads after import, so two copies of one level compare equal. */
function levelKey(l: LevelDef): string {
  return exportLevel(parseLevel(exportLevel(l), 0));
}
