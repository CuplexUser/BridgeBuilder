import { sfx } from '../audio';
import { quickTune, TUNE_DIFFICULTIES, TUNE_SECONDS, tuneKey, type TuneResult } from '../autotune';
import { Design } from '../design';
import { Editor, money } from '../editor';
import type { LevelDef } from '../levels';
import { addChannel, addMud, blankLevel, channelSpan, deckTop, eraseAt, exportLevel, makerIssues, nextCustomId, parseLevel, saveCustom, toggleBolt, toggleMast, togglePier, togglePylon, toggleRock, type MakerTool } from '../maker';
import { copyText, exportFile } from '../platform';
import { PAL } from '../render/palette';
import type { SceneView } from '../render/renderer';
import { bonusLabel } from '../scoring';
import { TunePool } from '../tunepool';
import { MAKER_TOOLS, MakerUi } from '../ui/makerui';
import { sideRoom, type Game } from './game';

/** The level editor's bolt preview never places members, so it ignores editor events. */
const NO_EVENTS = { place() {}, remove() {}, invalid() {} };

/** The level editor: its tools, undo history, quick tune, sharing, and playtesting a custom level. */
export class Maker {
  makerUi = new MakerUi();
  private tool: MakerTool = 'bolt';
  private makerUndo: string[] = [];
  private makerRedo: string[] = [];
  makerHover: [number, number] | null = null;
  /** Where a channel or mud drag started. */
  channelFrom: [number, number] | null = null;
  /** A finger or button is down in the level editor and the tool acts where it lifts. */
  makerPending = false;
  /** The quick tune running in the level editor. */
  tuning: TunePool | null = null;
  /** What the last quick tune of each custom level found, for the level as it was then. */
  private tuned = new Map<number, { key: string; result: TuneResult }>();
  /** Level being exported in the share dialog, or null when importing. */
  private shareFor: LevelDef | null = null;

  constructor(private game: Game) {}

  /** The list of custom levels. */
  private enterWorkshop(): void {
    this.game.leavePlay();
    this.game.state = 'workshop';
    this.makerUi.workshop(this.game.custom.levels);
    this.game.ui.show('workshop');
  }

  /** Edits a custom level on the blueprint, with the settings panel beside it. */
  enterMaker(level: LevelDef): void {
    this.game.leavePlay();
    this.game.demo = null;
    this.game.run = null;
    this.game.mode = 'custom';
    this.game.customLevel = level;
    this.game.state = 'maker';
    this.makerUndo = [];
    this.makerRedo = [];
    this.makerHover = null;
    this.game.develop = this.game.developTarget = 0;
    this.game.particles.clear();
    this.game.debris.clear();
    this.game.floats.length = 0;
    this.game.renderer.setTheme(this.game.themeOf(level));
    this.game.editor = new Editor(level, NO_EVENTS);
    this.game.ui.show(null);
    this.game.ui.setPlaying(false);
    this.makerUi.show(true);
    this.makerUi.setTool(this.tool);
    this.makerUi.fill(level);
    this.makerUi.setStatus(level, this.tuneFound(level));
    this.fitMaker(true);
  }

  /** Records an undo step, applies a change to the level being edited, and saves. */
  makerChange(change: (l: LevelDef) => { ok: boolean; msg: string } | void, at?: [number, number]): void {
    const l = this.game.customLevel;
    if (!l || this.game.state !== 'maker') return;
    const before = JSON.stringify(l);
    const res = change(l);
    if (res && at) this.game.float(at[0], at[1] + 0.6, res.msg, res.ok ? PAL.valid : PAL.bolt, 14);
    if (res && !res.ok) {
      sfx.invalid();
      return;
    }
    if (JSON.stringify(l) === before) return;
    this.makerUndo.push(before);
    if (this.makerUndo.length > 100) this.makerUndo.shift();
    this.makerRedo = [];
    if (at) sfx.place('steel');
    this.makerSaved(before);
  }

  /** After any edit: rebuild the bolts, refresh the panel and save the level list. */
  private makerSaved(before: string): void {
    const l = this.game.customLevel!;
    const was = JSON.parse(before) as LevelDef;
    this.game.editor = new Editor(l, NO_EVENTS);
    this.makerUi.fill(l);
    this.makerUi.setStatus(l, this.tuneFound(l));
    this.game.renderer.setTheme(this.game.themeOf(l));
    if (was.width !== l.width || was.waterY !== l.waterY || (was.rightY ?? 0) !== (l.rightY ?? 0)) this.fitMaker(false);
    const i = this.game.custom.levels.findIndex((c) => c.id === l.id);
    if (i >= 0) this.game.custom.levels[i] = l;
    else this.game.custom.levels.push(l);
    if (!saveCustom(this.game.custom)) this.game.ui.showToast('Could not save: this browser has no storage. Export the level to keep it.');
  }

  /** What the last quick tune found, if the level still has the shape it was tuned with. */
  tuneFound(l: LevelDef): TuneResult | undefined {
    const t = this.tuned.get(l.id);
    return t && t.key === tuneKey(l) ? t.result : undefined;
  }

  /**
   * Searches the level being edited for a few seconds, on workers, then sets its budget, star
   * target and bonus goal as one undoable edit. The bridges found are never shown.
   */
  private async autoTune(): Promise<void> {
    const l = this.game.customLevel;
    if (!l || this.game.state !== 'maker' || this.tuning) return;
    // Problems the tune would fix itself (the numbers and the bonus goal) don't stop it.
    const blocking = makerIssues({ ...l, target: 0, bonus: { kind: 'stress', max: 0.5 } });
    if (blocking.length) {
      sfx.invalid();
      this.game.ui.showToast(blocking[0], 3200);
      return;
    }
    const difficulty = this.makerUi.tuneDifficulty();
    const key = tuneKey(l);
    const pool = new TunePool();
    this.tuning = pool;
    const maxSeconds = this.makerUi.tuneMaxSeconds();
    this.makerUi.tuneRunning(TUNE_SECONDS);
    // Runs still going when the time is up are cut off.
    const cutoff = setTimeout(() => pool.close(), maxSeconds * 1000 + 500);
    let result: TuneResult | null = null;
    try {
      result = await quickTune(pool, structuredClone(l), difficulty, { seed: this.game.custom.designs[l.id], maxSeconds });
    } catch (e) {
      console.error(e);
    }
    clearTimeout(cutoff);
    pool.close();
    this.tuning = null;
    if (this.game.state !== 'maker' || this.game.customLevel !== l) return;
    if (tuneKey(l) !== key) {
      this.makerUi.tuneDone('The level changed while tuning. Tune again.');
      return;
    }
    if (!result) {
      sfx.invalid();
      this.makerUi.tuneDone(`No bridge found that crosses in ${maxSeconds} s. Build one and playtest it, then tune again: the tune starts from your bridge.`);
      return;
    }
    const found = result;
    this.tuned.set(l.id, { key, result: found });
    this.makerUi.tuneDone();
    this.makerChange((lv) => {
      lv.money = found.money;
      lv.target = found.target;
      lv.bonus = found.bonus;
    });
    this.makerUi.setStatus(l, found);
    sfx.select();
    this.game.ui.showToast(`Tuned for ${TUNE_DIFFICULTIES[difficulty].name}: budget ${money(found.money)}, star target ${money(found.target)}, bonus “${bonusLabel(found.bonus)}”.`, 3600);
  }

  /** Dev builds: drives one of the quick tune's bridges over the level, from a playtest. */
  private viewTuned(which: 'cheapest' | 'bonus'): void {
    const l = this.game.customLevel;
    const found = l && this.game.state === 'maker' ? this.tuneFound(l) : undefined;
    const json = found?.proof[which];
    if (!l || !found || !json) {
      sfx.invalid();
      return;
    }
    const design = Design.deserialize(json);
    this.playCustom(l);
    if (this.game.state !== 'build') return;
    const what = which === 'cheapest' ? 'cheapest bridge' : `bridge for “${bonusLabel(found.bonus)}”`;
    this.game.startExample({ design, note: `DEV: the tune’s ${what}, ${money(design.cost())}. Your blueprint is kept. Press T to go back.` });
  }

  private makerHistory(dir: -1 | 1): void {
    const l = this.game.customLevel;
    if (!l || this.game.state !== 'maker') return;
    const from = dir < 0 ? this.makerUndo : this.makerRedo;
    const to = dir < 0 ? this.makerRedo : this.makerUndo;
    const snap = from.pop();
    if (!snap) {
      sfx.invalid();
      return;
    }
    const now = JSON.stringify(l);
    to.push(now);
    // Restore in place, so everything holding the level sees the change.
    for (const k of Object.keys(l)) delete (l as unknown as Record<string, unknown>)[k];
    Object.assign(l, JSON.parse(snap));
    sfx.ui();
    this.makerSaved(now);
  }

  /** What the current tool would do at a grid point, tried on a copy of the level. */
  private toolPreview(x: number, y: number): { ok: boolean; msg: string } {
    const copy = structuredClone(this.game.customLevel!);
    if (this.tool === 'channel') {
      const [x0, top] = this.channelFrom ?? [x, deckTop(copy)];
      const res = addChannel(copy, x0, x, top);
      return this.channelFrom || !res.ok ? res : { ok: true, msg: 'Tap to fill the open water, or drag' };
    }
    if (this.tool === 'mud') {
      const [x0, top] = this.channelFrom ?? [x, y];
      return addMud(copy, x0, x, top);
    }
    return this.applyTool(copy, x, y);
  }

  private applyTool(l: LevelDef, x: number, y: number): { ok: boolean; msg: string } {
    switch (this.tool) {
      case 'bolt':
        return toggleBolt(l, x, y);
      case 'pier':
        return togglePier(l, x, y);
      case 'pylon':
        return togglePylon(l, x, y);
      case 'mast':
        return toggleMast(l, x, y);
      case 'rock':
        return toggleRock(l, x, y);
      case 'erase':
        return eraseAt(l, x, y);
      case 'channel':
        return { ok: false, msg: 'Drag across for a ship channel' };
      case 'mud':
        return addMud(l, x, x, y);
    }
  }

  private setTool(tool: MakerTool): void {
    this.tool = tool;
    this.channelFrom = null;
    this.makerUi.setTool(tool);
    sfx.ui();
  }

  /** Grid point under a screen position: whole meters. */
  snapAt(sx: number, sy: number): [number, number] {
    const [wx, wy] = this.game.input.worldAt(sx, sy);
    return [Math.round(wx), Math.round(wy)];
  }

  /**
   * In the level editor a finger aims the tool and lifting it acts, so a slip can be slid right
   * before it lands. A second finger turns the touch into pinch and pan, and nothing is placed.
   */
  makerPointerDown(e: PointerEvent): void {
    if (this.game.input.pointers.size >= 2) {
      this.makerPending = false;
      this.channelFrom = null;
      this.game.input.startPinch();
      return;
    }
    if (e.button !== 0) return;
    const p = this.snapAt(e.clientX, e.clientY);
    this.makerHover = p;
    this.makerPending = true;
    if (this.tool === 'channel' || this.tool === 'mud') this.channelFrom = p;
  }

  makerPointerUp(e: PointerEvent, cancelled: boolean): void {
    if (this.game.input.pointers.size > 0) {
      // A finger left over from a pinch: the next pinch starts afresh.
      this.game.input.pinchDist = 0;
      return;
    }
    const act = this.makerPending && !cancelled;
    const from = this.channelFrom;
    this.makerPending = false;
    this.channelFrom = null;
    if (!act) return;
    const p = this.snapAt(e.clientX, e.clientY);
    this.makerHover = p;
    if (!from) {
      this.makerChange((l) => this.applyTool(l, p[0], p[1]), p);
      return;
    }
    if (this.tool === 'mud') {
      // A drag lays mud across it, its top where it started; a tap lays or removes one.
      this.makerChange((l) => addMud(l, from[0], p[0], from[1]), [(from[0] + p[0]) / 2, from[1]]);
      return;
    }
    // A tap fills the open water around it up to the road; a drag marks its own span.
    const tap = p[0] === from[0];
    this.makerChange((l) => addChannel(l, from[0], p[0], tap ? deckTop(l) : from[1]), [(from[0] + p[0]) / 2, from[1]]);
  }

  /** Frames the level beside the settings panel and between the editor's bars. */
  fitMaker(snap: boolean): void {
    const l = this.game.customLevel;
    if (!l || !this.game.editor) return;
    const w = this.game.renderer.w;
    const top = w < 560 ? 136 : 64;
    const bottom = 86;
    const right = w < 560 ? 0 : this.makerUi.panelWidth();
    const rect = { x: 12, y: top, w: Math.max(120, w - 24 - right), h: Math.max(100, this.game.renderer.h - top - bottom) };
    // Leave headroom above the banks for pylons.
    this.game.cam.fit(-sideRoom(l), l.width + sideRoom(l), l.waterY - 0.5, Math.max(this.game.editor.topY + 0.5, 10), rect, snap);
  }

  /** Plays a custom level: build, test and score it, with nothing saved to the career. */
  private playCustom(level: LevelDef): void {
    const issues = makerIssues(level);
    if (issues.length) {
      sfx.invalid();
      this.game.ui.showToast(issues[0], 3200);
      return;
    }
    this.game.leavePlay();
    this.game.mode = 'custom';
    this.game.customLevel = level;
    this.game.loadLevel(this.game.levelIdx);
  }

  private openShare(level: LevelDef | null): void {
    this.shareFor = level;
    this.game.ui.show('share');
    if (level) this.makerUi.share('export', exportLevel(level), level.name);
    else this.makerUi.share('import');
  }

  private closeShare(): void {
    this.game.ui.show(this.game.state === 'workshop' ? 'workshop' : null);
  }

  private importLevel(): void {
    try {
      const level = parseLevel(this.makerUi.shareText(), nextCustomId(this.game.custom.levels));
      this.game.custom.levels.push(level);
      saveCustom(this.game.custom);
      sfx.select();
      this.enterWorkshop();
      this.game.ui.showToast(`Imported “${level.name}”.`);
    } catch (err) {
      sfx.invalid();
      this.makerUi.shareError(err instanceof Error ? err.message : 'Could not read that level.');
    }
  }

  private customById(el?: HTMLElement): LevelDef | undefined {
    return this.game.custom.levels.find((l) => l.id === Number(el?.dataset.id));
  }

  /** Level editor buttons. */
  makerAct(a: string, el?: HTMLElement): void {
    switch (a) {
      case 'workshop':
        sfx.ui();
        this.enterWorkshop();
        break;
      case 'ws-new': {
        sfx.select();
        const l = blankLevel(nextCustomId(this.game.custom.levels));
        this.game.custom.levels.push(l);
        saveCustom(this.game.custom);
        this.enterMaker(l);
        break;
      }
      case 'ws-edit': {
        const l = this.customById(el);
        if (l) {
          sfx.select();
          this.enterMaker(l);
        }
        break;
      }
      case 'ws-play': {
        const l = this.customById(el);
        if (l) {
          sfx.select();
          this.playCustom(l);
        }
        break;
      }
      case 'ws-export':
        sfx.ui();
        this.openShare(this.customById(el) ?? null);
        break;
      case 'ws-import':
        sfx.ui();
        this.openShare(null);
        break;
      case 'ws-delete': {
        const l = this.customById(el);
        if (!l || !el || !this.makerUi.confirmDelete(el)) break;
        sfx.remove();
        this.game.custom.levels = this.game.custom.levels.filter((c) => c !== l);
        delete this.game.custom.designs[l.id];
        saveCustom(this.game.custom);
        this.makerUi.workshop(this.game.custom.levels);
        break;
      }
      case 'share-close':
        sfx.ui();
        this.closeShare();
        break;
      case 'share-copy':
        copyText(this.makerUi.shareText()).then(
          () => this.game.ui.showToast('Copied to the clipboard.'),
          () => this.game.ui.showToast('Could not copy. Select the text and copy it yourself.'),
        );
        break;
      case 'share-download': {
        const name = (this.shareFor?.name ?? 'level').replace(/[^\w-]+/g, '-').toLowerCase();
        exportFile(`${name}.json`, this.makerUi.shareText()).catch(() => this.game.ui.showToast('Could not save the file. Copy the text instead.'));
        break;
      }
      case 'share-import':
        this.importLevel();
        break;
      case 'mk-tool':
        this.setTool((el?.dataset.tool as MakerTool) ?? 'bolt');
        break;
      case 'mk-undo':
        this.makerHistory(-1);
        break;
      case 'mk-redo':
        this.makerHistory(1);
        break;
      case 'mk-help':
        sfx.ui();
        if (this.game.state === 'maker') this.game.ui.show('mkhelp');
        break;
      case 'mk-help-close':
        sfx.ui();
        this.game.ui.show(null);
        break;
      case 'mk-settings':
        sfx.ui();
        this.makerUi.togglePanel();
        this.fitMaker(false);
        break;
      case 'mk-tune':
        sfx.ui();
        void this.autoTune();
        break;
      case 'mk-tune-view':
        if (import.meta.env.DEV) this.viewTuned(el?.dataset.which === 'bonus' ? 'bonus' : 'cheapest');
        break;
      case 'mk-export':
        sfx.ui();
        if (this.game.customLevel) this.openShare(this.game.customLevel);
        break;
      case 'mk-play':
        if (this.game.customLevel) {
          sfx.select();
          this.playCustom(this.game.customLevel);
        }
        break;
      case 'mk-done':
        sfx.ui();
        this.enterWorkshop();
        break;
    }
  }

  /** Keys in the workshop list and the editor. */
  makerKey(e: KeyboardEvent): void {
    const k = e.key;
    const lower = k.toLowerCase();
    if (this.game.ui.current === 'share') {
      if (k === 'Escape') this.game.act('share-close');
      return;
    }
    if (this.game.ui.current === 'mkhelp') {
      if (k === 'Escape' || k === 'Enter' || lower === 'h' || k === '?') {
        e.preventDefault();
        this.game.act('mk-help-close');
      }
      return;
    }
    if (this.game.state === 'workshop') {
      if (k === 'Escape' || k === 'Backspace') this.game.act('back');
      else if (lower === 'n') this.game.act('ws-new');
      else if (lower === 'i') this.game.act('ws-import');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && lower === 'z') {
      e.preventDefault();
      this.makerHistory(e.shiftKey ? 1 : -1);
      return;
    }
    if (k >= '1' && k <= String(MAKER_TOOLS.length) && k.length === 1) this.setTool(MAKER_TOOLS[Number(k) - 1].id);
    else if (lower === 'z') this.makerHistory(-1);
    else if (lower === 'y') this.makerHistory(1);
    else if (lower === 'h' || k === '?') this.game.act('mk-help');
    else if (lower === 's') this.game.act('mk-settings');
    else if (lower === 'p') this.game.act('mk-play');
    else if (lower === 'f') this.fitMaker(false);
    else if (k === 'Escape') this.game.act('mk-done');
  }

  /** The editor's cursor: where the tool would act, and what it would do there. */
  makerView(): SceneView['maker'] {
    const p = this.makerHover;
    if (this.game.state !== 'maker' || !p || !this.game.customLevel || this.game.ui.current) return null;
    const res = this.toolPreview(p[0], p[1]);
    // The preview says what a tap will do: "Bolt added" reads as "Add bolt".
    const label = res.msg.replace(/^(.+) added$/, (_, w: string) => `Add ${w.toLowerCase()}`).replace(/^(.+) removed$/, (_, w: string) => `Remove ${w.toLowerCase()}`);
    return { x: p[0], y: p[1], label, ok: res.ok, channel: this.tool === 'channel' ? this.channelPreview(p) : null };
  }

  /** The channel the current tap or drag would mark, outlined before it lands. */
  private channelPreview(p: [number, number]): [number, number, number] | null {
    const l = this.game.customLevel!;
    const [x0, top] = this.channelFrom ?? [p[0], deckTop(l)];
    const span = channelSpan(l, x0, p[0]);
    if (span.ok) return [span.a, span.b, top];
    return this.channelFrom ? [Math.min(x0, p[0]), Math.max(x0, p[0]), top] : null;
  }
}
