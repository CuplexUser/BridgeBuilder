import { sfx } from '../audio';
import { CHAPTERS, continueLevel } from '../chapters';
import { MATERIALS } from '../physics/materials';
import type { SagHandle } from '../editor';
import { PAL } from '../render/palette';
import { offeredInOrder } from '../ui/ui';
import { sideRoom, type Board, type Game } from './game';
import { t } from '../i18n';

interface PointerInfo {
  x: number;
  y: number;
  startX: number;
  startY: number;
  type: string;
  /** When the pointer went down, from performance.now(). */
  downAt: number;
}

/** The chapter a digit key picks, 1–9 then 0 for the tenth, as an index into CHAPTERS; -1 for any other key. */
function chapterKey(k: string): number {
  if (k.length !== 1 || k < '0' || k > '9') return -1;
  const i = k === '0' ? 9 : Number(k) - 1;
  return i < CHAPTERS.length ? i : -1;
}

/** Stops a click from reaching the game's buttons. */
function swallowClick(e: MouseEvent): void {
  e.stopPropagation();
}

/** Pointer, touch and keyboard input, and the app shell's back button and suspend. */
export class Input {
  pointers = new Map<number, PointerInfo>();
  dragging = false;
  private panning = false;
  private pendingDelete = -1;
  /** A block tapped for removal, taken off if the tap lifts without moving. */
  private pendingCell = -1;
  /** Where the block brush went down on a square that can't take a block: a tap there says why, a drag pans. */
  private pendingBrush: [number, number] | null = null;
  /** How far above the pointer the sag or rise handle being dragged sits, so it doesn't jump to it. */
  private sagOffset = 0;
  pinchDist = 0;
  private lastMid: [number, number] = [0, 0];

  constructor(private game: Game) {}

  bindInput(): void {
    window.addEventListener('resize', () => this.game.onResize());
    // A swipe turns the chapter book's pages.
    const book = document.getElementById('chapter-book')!;
    let swipeX = Number.NaN;
    book.addEventListener('pointerdown', (e) => (swipeX = e.clientX));
    book.addEventListener('pointerup', (e) => {
      const dx = e.clientX - swipeX;
      swipeX = Number.NaN;
      if (Math.abs(dx) <= 50) return;
      this.game.turnBook(this.game.bookPage + (dx < 0 ? 1 : -1));
      // The swipe was not a tap on the card it started on.
      book.addEventListener('click', swallowClick, { capture: true, once: true });
      setTimeout(() => book.removeEventListener('click', swallowClick, { capture: true }), 400);
    });
    this.game.ui.onAction((a, el) => this.game.act(a, el));
    this.game.ui.testBtn.addEventListener('click', () => {
      sfx.unlock();
      if (this.game.state === 'build') this.game.startTest();
      else if (this.game.state === 'test') this.game.backToBuild();
    });
    this.game.ui.pauseBtn.addEventListener('click', () => {
      sfx.ui();
      this.game.setPaused(!this.game.paused);
    });
    this.game.ui.muteBtn.addEventListener('click', () => this.game.toggleMute());
    // Level editor settings: text fields update live, everything else on change.
    this.game.maker.makerUi.onChange((live) => {
      if (live && this.game.customLevel) {
        this.game.customLevel.name = (document.getElementById('mk-name') as HTMLInputElement).value.trim().slice(0, 40) || t('mkr.defaultName');
        this.game.maker.makerUi.setStatus(this.game.customLevel, this.game.maker.tuneFound(this.game.customLevel));
      }
      this.game.maker.makerChange((l) => this.game.maker.makerUi.read(l));
    });
    document.getElementById('share-file')!.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) void file.text().then((text) => this.game.maker.makerUi.setShareText(text));
      (e.target as HTMLInputElement).value = '';
    });
    // Scrubbing the stress graph picks the busiest member at that moment.
    const graphCanvas = document.getElementById('stress-canvas')!;
    const scrub = (e: PointerEvent) => {
      if (!this.game.stress.graphOpen || !this.game.run) return;
      const r = graphCanvas.getBoundingClientRect();
      this.game.stress.pickSample(this.game.stress.graph.sampleAtX(e.clientX - r.left, this.game.run.log));
    };
    graphCanvas.addEventListener('pointerdown', (e) => {
      graphCanvas.setPointerCapture(e.pointerId);
      scrub(e);
    });
    graphCanvas.addEventListener('pointermove', (e) => {
      if (e.buttons) scrub(e);
    });
    this.game.ui.undoBtn.addEventListener('click', () => this.undo());
    this.game.ui.redoBtn.addEventListener('click', () => this.redo());
    this.game.ui.clearBtn.addEventListener('click', () => {
      this.game.editor?.clear();
      this.game.refreshHud();
    });
    for (const [id, b] of this.game.ui.matBtns) b.addEventListener('click', () => this.game.selectMaterial(id));
    document.getElementById('profile-form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      sfx.unlock();
      void this.game.useProfile((document.getElementById('profile-name') as HTMLInputElement).value);
    });
    window.addEventListener('pagehide', () => this.game.flushSave());

    const c = this.game.canvas;
    c.addEventListener('pointerdown', (e) => this.pointerDown(e));
    c.addEventListener('pointermove', (e) => this.pointerMove(e));
    c.addEventListener('pointerup', (e) => this.pointerUp(e));
    c.addEventListener('pointercancel', (e) => this.pointerUp(e, true));
    c.addEventListener('pointerleave', () => {
      this.game.hoverNode = this.game.hoverMember = -1;
      this.game.hoverAttach = null;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (this.game.state !== 'build' && this.game.state !== 'test' && this.game.state !== 'maker') return;
        this.game.cam.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => this.keyDown(e));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.suspend();
    });
  }

  /** Leaving the page or app: pause a level in play, and save now rather than after the debounce. */
  suspend(): void {
    this.game.setPaused(true);
    this.game.flushSave();
    this.game.playGames.flush();
  }

  /**
   * The Android back button does what Escape does on each screen. Returns false on the title
   * screen, and on the first-run profile screen, where back leaves the app.
   */
  back(): boolean {
    if (this.game.settings.from) {
      this.game.settings.close();
      return true;
    }
    if (this.game.results.doneOpen) {
      this.game.act('done-close');
      return true;
    }
    if (this.game.unlockFrom) {
      this.game.closeOffer();
      return true;
    }
    if (this.game.state === 'title') return false;
    if (this.game.state === 'profile') {
      if (!this.game.profile) return false;
      this.game.enterTitle();
      return true;
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    return true;
  }

  worldAt(x: number, y: number): [number, number] {
    return [this.game.cam.wx(x), this.game.cam.wy(y)];
  }

  pickRadius(px: number, min: number): number {
    return Math.max(min, px / this.game.cam.scale);
  }

  private pointerDown(e: PointerEvent): void {
    sfx.unlock();
    this.game.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, type: e.pointerType, downAt: performance.now() });
    this.game.keyboardMode = false;
    if (this.game.state === 'maker') {
      this.game.maker.makerPointerDown(e);
      return;
    }
    if (this.game.stress.graphOpen) {
      const m = this.game.stress.memberNear(e.clientX, e.clientY);
      if (m >= 0) {
        sfx.tick();
        this.game.stress.pickMember(m);
      }
      return;
    }
    if (this.game.paused || (this.game.state !== 'build' && this.game.state !== 'test')) return;

    if (this.pointers.size === 2) {
      // Second finger: switch to pinch/pan and abandon any in-progress member.
      this.game.editor?.cancel();
      this.dragging = false;
      this.pendingDelete = -1;
      this.pendingCell = -1;
      this.pendingBrush = null;
      this.panning = false;
      this.startPinch();
      return;
    }
    if (this.pointers.size > 2) return;

    const [wx, wy] = this.worldAt(e.clientX, e.clientY);
    const ed = this.game.editor;
    if (this.game.state === 'build' && ed) {
      if (e.button === 2) {
        const m = ed.memberAt(wx, wy, this.pickRadius(14, 0.25));
        if (m >= 0) ed.removeMember(m);
        else ed.removeCell(ed.cellAt(wx, wy));
        this.game.refreshHud();
        return;
      }
      // With the block brush in hand, a drag paints blocks, or erases them if it starts on one.
      // Started where no block can go, such as out in the open, it pans instead.
      if (MATERIALS[ed.mat].cell === 'brush') {
        if (e.button === 0 && ed.beginPaint(wx, wy, true)) {
          this.dragging = true;
          this.pendingDelete = -1;
          this.game.refreshHud();
        } else {
          this.pendingBrush = [wx, wy];
          this.panning = true;
        }
        return;
      }
      const touch = e.pointerType === 'touch';
      // With the arch in hand, a press on a ring takes hold of its rise; a tap still takes it off.
      const ring = this.ringRiseAt(wx, wy, touch);
      if (ring) {
        ed.beginSag(ring.handle);
        this.sagOffset = ring.handle.y - wy;
        this.dragging = true;
        this.pendingDelete = -1;
        this.pendingCell = ring.cell;
        sfx.tick();
        return;
      }
      const picked = ed.beginAt(wx, wy, this.pickRadius(touch ? 26 : 18, 0.4), this.pickRadius(touch ? 18 : 12, 0.3));
      if (picked === 'sag') {
        this.sagOffset = ed.sag!.y - wy;
        this.dragging = true;
        this.pendingDelete = -1;
        sfx.tick();
        return;
      }
      if (picked) {
        ed.aim(wx, wy);
        this.dragging = true;
        this.game.hoverNode = ed.drag!.from;
        // A tap that never moves still deletes the beam under it: from an attach point, or on
        // the body of a beam too short to tap clear of its joints.
        this.pendingDelete = picked === 'split' ? ed.drag!.fromSplit : ed.memberBodyAt(wx, wy, this.pickRadius(touch ? 16 : 10, 0.2));
        sfx.tick();
        return;
      }
      const m = ed.memberAt(wx, wy, this.pickRadius(touch ? 16 : 10, 0.2));
      if (m >= 0) {
        this.pendingDelete = m;
        this.game.hoverMember = m;
        return;
      }
      // A tap on a block takes it off; a drag from one pans.
      const c = ed.cellAt(wx, wy);
      if (c >= 0) {
        this.pendingCell = c;
        this.game.hoverCell = c;
      }
    }
    this.panning = true;
  }

  /**
   * With the arch in hand, the ring under a point and its rise handle: a press anywhere on a ring
   * takes hold of its rise, unless it's right on a joint, where a new arch can start. Null otherwise.
   */
  private ringRiseAt(wx: number, wy: number, touch: boolean): { cell: number; handle: SagHandle } | null {
    const ed = this.game.editor;
    if (!ed || MATERIALS[ed.mat].cell !== 'ring') return null;
    const cell = ed.cellAt(wx, wy);
    const handle = cell >= 0 ? ed.ringHandle(cell) : null;
    if (!handle || ed.nodeAt(wx, wy, this.pickRadius(touch ? 12 : 8, 0.15)) >= 0) return null;
    return { cell, handle };
  }

  /** Takes the first two fingers down as the starting point of a pinch. */
  startPinch(): void {
    const [p1, p2] = [...this.pointers.values()];
    this.pinchDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    this.lastMid = [(p1.x + p2.x) / 2, (p1.y + p2.y) / 2];
  }

  private pointerMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    const px = p?.x ?? e.clientX;
    const py = p?.y ?? e.clientY;
    if (p) {
      p.x = e.clientX;
      p.y = e.clientY;
    }
    if (this.game.paused) return;

    if (this.pointers.size === 2) {
      const [p1, p2] = [...this.pointers.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const mid: [number, number] = [(p1.x + p2.x) / 2, (p1.y + p2.y) / 2];
      if (this.pinchDist > 0) this.game.cam.zoomAt(mid[0], mid[1], d / this.pinchDist);
      this.game.cam.pan(mid[0] - this.lastMid[0], mid[1] - this.lastMid[1]);
      this.pinchDist = d;
      this.lastMid = mid;
      return;
    }
    if (this.game.state === 'maker') {
      this.game.maker.makerHover = this.game.maker.snapAt(e.clientX, e.clientY);
      return;
    }

    const [wx, wy] = this.worldAt(e.clientX, e.clientY);
    const ed = this.game.editor;
    if (this.dragging && ed?.paint) {
      const n = ed.design.cells.length;
      ed.paintAt(wx, wy);
      if (ed.design.cells.length !== n) this.game.refreshHud();
      return;
    }
    const moved = !!p && Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > 10;
    if (this.pendingCell >= 0 && moved) this.pendingCell = -1;
    if (this.pendingBrush && moved) this.pendingBrush = null;
    if (this.dragging && ed?.sag) {
      const before = ed.sag.y;
      ed.aimSag(wy + this.sagOffset);
      if (ed.sag.y !== before) {
        sfx.tick();
        this.game.refreshHud();
      }
      return;
    }
    if (this.dragging && ed?.drag) {
      if (this.pendingDelete >= 0 && p && Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > 10) this.pendingDelete = -1;
      const before = `${ed.drag.tx},${ed.drag.ty}`;
      ed.aim(wx, wy);
      if (`${ed.drag.tx},${ed.drag.ty}` !== before) sfx.tick();
      return;
    }
    if (this.panning && p) {
      this.game.cam.pan(e.clientX - px, e.clientY - py);
      return;
    }
    if (this.pendingDelete >= 0 && p && Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > 10) {
      this.pendingDelete = -1;
      this.panning = true;
    }
    if (this.game.state === 'build' && ed && e.pointerType === 'mouse' && !p) {
      this.game.hoverNode = ed.nodeAt(wx, wy, this.pickRadius(18, 0.4));
      this.game.hoverMember = this.game.hoverNode < 0 ? ed.memberAt(wx, wy, this.pickRadius(10, 0.2)) : ed.memberBodyAt(wx, wy, this.pickRadius(10, 0.2));
      this.game.hoverAttach = this.game.hoverNode < 0 ? ed.attachAt(wx, wy, this.pickRadius(12, 0.3)) : null;
      const brush = MATERIALS[ed.mat].cell === 'brush';
      this.game.hoverCell = this.game.hoverMember < 0 ? ed.cellAt(wx, wy) : -1;
      this.game.brushAt = brush ? [Math.floor(wx), Math.floor(wy)] : null;
      if (brush) this.game.hoverNode = this.game.hoverMember = -1;
      // Over a handle, or a ring with the arch in hand, a press raises or lowers it.
      const rise = !brush && (this.ringRiseAt(wx, wy, false) !== null || ed.handlePick(wx, wy, this.pickRadius(18, 0.4)) !== null);
      if (rise) this.game.hoverNode = this.game.hoverMember = this.game.hoverCell = -1;
      this.game.canvas.style.cursor = rise ? 'ns-resize' : '';
    } else if (!p) this.game.canvas.style.cursor = '';
  }

  private pointerUp(e: PointerEvent, cancelled = false): void {
    this.pointers.delete(e.pointerId);
    if (this.game.state === 'maker') {
      this.game.maker.makerPointerUp(e, cancelled);
      return;
    }
    if (this.pointers.size > 0) {
      if (this.pointers.size === 1) {
        // Leaving a pinch: continue as a pan with the remaining finger.
        this.pinchDist = 0;
        this.panning = true;
      }
      return;
    }
    const ed = this.game.editor;
    if (this.dragging && ed?.paint) {
      ed.endPaint();
      this.dragging = false;
      this.game.refreshHud();
    } else if (this.dragging && ed) {
      const sag = !!ed.sag;
      if (cancelled || this.pendingDelete >= 0 || this.pendingCell >= 0) ed.cancel();
      else ed.commit();
      if (sag) this.game.refreshHud();
      this.dragging = false;
      if (e.pointerType !== 'mouse') this.game.hoverNode = -1;
    }
    if (this.pendingDelete >= 0 && ed && !cancelled) {
      ed.removeMember(this.pendingDelete);
    }
    if (this.pendingCell >= 0 && ed && !cancelled) {
      ed.removeCell(this.pendingCell);
      this.game.refreshHud();
    }
    // A tap where the brush couldn't paint says why.
    if (this.pendingBrush && ed && !cancelled && ed.beginPaint(...this.pendingBrush)) ed.endPaint();
    this.pendingDelete = -1;
    this.pendingCell = -1;
    this.pendingBrush = null;
    if (e.pointerType !== 'mouse') this.game.hoverCell = -1;
    this.panning = false;
    if (e.pointerType !== 'mouse') this.game.hoverMember = -1;
  }

  private undo(): void {
    if (this.game.state === 'build' && this.game.editor?.undo()) {
      sfx.remove();
      this.game.refreshHud();
    }
  }

  private redo(): void {
    if (this.game.state === 'build' && this.game.editor?.redo()) {
      sfx.place(this.game.editor.mat);
      this.game.refreshHud();
    }
  }

  private keyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
      // Typing goes to the field; Escape leaves it, and closes the share dialog and Settings.
      if (e.key === 'Escape') {
        target.blur();
        if (this.game.ui.current === 'share') this.game.act('share-close');
        if (this.game.settings.from) this.game.settings.close();
      }
      return;
    }
    const k = e.key;
    const lower = k.toLowerCase();
    sfx.unlock();

    if (lower === 'm') {
      this.game.toggleMute();
      return;
    }
    if (this.game.quitAsk) {
      if (k === 'Escape' || k === 'Backspace') this.game.act('quit-cancel');
      else if (lower === 'q') this.game.act('quit-confirm');
      return;
    }
    if (this.game.unlockFrom) {
      if (k === 'Escape' || k === 'Backspace') this.game.act('unlock-close');
      else if (k === 'Enter') this.game.act('buy');
      return;
    }
    if (this.game.settings.from) {
      if (k === 'Escape' || k === 'Backspace') this.game.settings.close();
      return;
    }
    if (this.game.results.doneOpen) {
      if (k === 'Enter' || k === ' ' || k === 'Escape' || k === 'Backspace') {
        e.preventDefault();
        this.game.act('done-close');
      }
      return;
    }

    switch (this.game.state) {
      case 'title':
        if (k === 'Enter' || k === ' ') {
          e.preventDefault();
          this.game.act('continue');
        } else if (lower === 'c') this.game.act('chapters');
        else if (lower === 'h') this.game.act('scores');
        else if (lower === 'l') this.game.act('workshop');
        else if (lower === 's') this.game.act('settings');
        return;
      case 'workshop':
      case 'maker':
        this.game.maker.makerKey(e);
        return;
      case 'profile':
        return;
      case 'chapters':
        if (k === 'Escape' || k === 'Backspace') this.game.act('back');
        else if (lower === 'v') this.game.setChaptersView(this.game.chaptersView === 'map' ? 'book' : 'map');
        else if (k === 'ArrowLeft' || k === 'ArrowRight') this.game.turnBook(this.game.bookPage + (k === 'ArrowLeft' ? -1 : 1));
        else if (k === 'Enter') this.game.playLevel(continueLevel(this.game.data.best));
        else if (chapterKey(k) >= 0) this.game.openChapter(CHAPTERS[chapterKey(k)]);
        return;
      case 'chapter':
        if (k === 'Escape' || k === 'Backspace') this.game.act('back');
        else if (k >= '1' && k <= String(this.game.chapter.levels.length) && k.length === 1) this.game.playLevel(this.game.chapter.levels[Number(k) - 1]);
        return;
      case 'scores': {
        const tabs: Board[] = ['career', 'chapter', 'levels', 'challenge'];
        if (k === 'Escape' || k === 'Backspace') this.game.act('back');
        else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Tab') {
          e.preventDefault();
          const d = k === 'ArrowLeft' || (k === 'Tab' && e.shiftKey) ? -1 : 1;
          this.game.results.showBoard(tabs[(tabs.indexOf(this.game.results.board) + d + tabs.length) % tabs.length]);
        } else if (chapterKey(k) >= 0) this.game.results.showBoard(this.game.results.board === 'career' ? 'chapter' : this.game.results.board, CHAPTERS[chapterKey(k)].id);
        return;
      }
      case 'result':
      case 'collapse':
        if (this.game.stress.graphOpen) {
          if (k === 'Escape' || lower === 'g' || k === 'Backspace') this.game.act('stress-close');
          else if (k === 'ArrowLeft' || k === 'ArrowRight') {
            e.preventDefault();
            const n = this.game.run?.log.length ?? 0;
            if (n) this.game.stress.pickSample(Math.max(0, Math.min(n - 1, (this.game.stress.pick?.sample ?? 0) + (k === 'ArrowLeft' ? -1 : 1))));
          }
          return;
        }
        if (lower === 'g') {
          this.game.act('stress');
          return;
        }
        if (this.game.state === 'collapse') {
          if (lower === 's') this.game.act('share-clip');
          else if (lower === 'r' || k === 'Enter' || k === ' ') {
            e.preventDefault();
            this.game.act('retry');
          } else if (k === 'Escape') this.game.act('quit');
          return;
        }
        if (k === 'Enter' || k === ' ' || lower === 'n') {
          e.preventDefault();
          this.game.act('next');
        } else if (lower === 'r' && this.game.mode === 'play') this.game.act('retry');
        else if (k === 'Escape') this.game.act('quit');
        return;
      case 'over':
        if (lower === 's') this.game.act('share-clip');
        else if (lower === 'r' || k === 'Enter') {
          e.preventDefault();
          this.game.act('restart');
        } else if (k === 'Escape') this.game.act('quit');
        return;
    }

    // build / test
    if (this.game.briefing) {
      if (k === 'Enter' || k === ' ' || k === 'Escape' || lower === 'i') {
        e.preventDefault();
        this.game.act('brief-close');
      } else if (lower === 'w' && this.game.hasExample()) this.game.act('brief-example');
      return;
    }
    if (this.game.paused) {
      if (k === 'Escape' || lower === 'p') this.game.setPaused(false);
      else if (lower === 'r' && this.game.state === 'test') {
        this.game.setPaused(false);
        this.game.backToBuild();
      } else if (lower === 'q') this.game.act('quit');
      else if (lower === 's') this.game.act('settings');
      return;
    }
    if (lower === 'p') {
      this.game.setPaused(true);
      return;
    }
    if (lower === 'f') {
      this.game.fitCamera(false);
      return;
    }
    if (lower === 'i' && this.game.state === 'build') {
      this.game.act('brief');
      return;
    }
    if (this.game.state === 'test') {
      if (k === 'Escape') this.game.setPaused(true);
      else if (lower === 't' || lower === 'r' || lower === 'e') this.game.backToBuild();
      return;
    }

    const ed = this.game.editor;
    if (!ed) return;
    const move = (dx: number, dy: number) => {
      e.preventDefault();
      this.game.keyboardMode = true;
      // A main cable held by its sag handle moves only up and down, half a meter a press.
      if (ed.sag) {
        if (dy) ed.nudgeSag(dy * 0.5);
        sfx.tick();
        this.game.refreshHud();
        return;
      }
      const nx = ed.cursorX + dx;
      const ny = ed.cursorY + dy;
      const side = sideRoom(this.game.level) - 1.5;
      if (nx < -side || nx > this.game.level.width + side || ny > ed.topY || ny < this.game.level.waterY + 1) return;
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
    if ((k === ' ' || k === 'Enter') && MATERIALS[ed.mat].cell === 'brush') {
      e.preventDefault();
      this.game.keyboardMode = true;
      // The block up and to the right of the cursor: painted, or taken off if it's there.
      ed.beginPaint(ed.cursorX + 0.5, ed.cursorY + 0.5);
      ed.endPaint();
      this.game.refreshHud();
      return;
    }
    if (k === ' ' || k === 'Enter') {
      e.preventDefault();
      this.game.keyboardMode = true;
      if (ed.sag) {
        ed.commit();
        this.game.refreshHud();
      } else if (ed.drag) {
        const to = ed.commit();
        // Chain: keep building from where the last member ended.
        if (to >= 0) {
          ed.begin(to);
          ed.aim(ed.cursorX, ed.cursorY);
        }
      } else {
        if (ed.beginAt(ed.cursorX, ed.cursorY, 0.05, 0.45, 0.8)) {
          ed.aim(ed.cursorX, ed.cursorY);
          sfx.tick();
        } else {
          sfx.invalid();
          this.game.float(ed.cursorX, ed.cursorY + 0.5, t('edit.startOnNode'), PAL.bolt, 14);
        }
      }
      return;
    }
    if (k === 'Escape') {
      if (ed.drag || ed.sag) ed.cancel();
      else this.game.setPaused(true);
      return;
    }
    if (k === 'x' || k === 'X' || k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      this.game.keyboardMode = true;
      const m = ed.memberAt(ed.cursorX, ed.cursorY, 0.6);
      const c = ed.cellAt(ed.cursorX + 0.5, ed.cursorY + 0.5);
      if (m >= 0) ed.removeMember(m);
      else if (c >= 0) ed.removeCell(c);
      else sfx.invalid();
      this.game.refreshHud();
      return;
    }
    // Keys 1–9 and 0 pick the level's materials, in toolbar order.
    if (k.length === 1 && k >= '0' && k <= '9') {
      const mat = offeredInOrder(this.game.level)[k === '0' ? 9 : Number(k) - 1];
      if (mat) this.game.selectMaterial(mat);
      return;
    }
    if (lower === 'q') this.game.cycleMaterial(-1);
    else if (lower === 'e') this.game.cycleMaterial(1);
    else if (lower === 'z') this.undo();
    else if (lower === 'y') this.redo();
    else if (lower === 't') this.game.startTest();
    else if (lower === 'c' && e.shiftKey) {
      ed.clear();
      this.game.refreshHud();
    }
  }
}
