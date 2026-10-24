import { font } from './render/fonts';

/**
 * Collapse clips. A test drive is recorded off the game canvas so that, when the bridge comes
 * down, the player can share the last seconds of it. The frames are copied into a smaller canvas
 * with a caption, which is what gets encoded, and the game's sound goes along.
 *
 * MediaRecorder can't trim, so the recording restarts every ROLL seconds while nothing has broken.
 * Once something snaps it runs on to the end, and a clip holds up to ROLL seconds of lead-in and
 * then the whole collapse.
 */

/** The clip's longer side, px. */
const SIZE = 1280;
const FPS = 30;
const ROLL = 12;
const BITRATE = 5_000_000;

/** Containers in order of preference: MP4 shares to the most apps. */
const TYPES = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

export class ClipRecorder {
  /** The finished clip of the last collapse, ready to share. */
  clip: Blob | null = null;
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private started = 0;
  private broken = false;
  private caption = '';
  private state: 'idle' | 'recording' | 'finishing' = 'idle';

  private constructor(
    private type: string,
    private audio: () => MediaStream | null,
  ) {}

  /** A recorder, or null where the browser can't record a canvas. */
  static create(audio: () => MediaStream | null): ClipRecorder | null {
    try {
      if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null;
      const type = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
      return type ? new ClipRecorder(type, audio) : null;
    } catch {
      return null;
    }
  }

  /** The file extension for the clip's container. */
  get extension(): string {
    return this.type.startsWith('video/mp4') ? 'mp4' : 'webm';
  }

  /** Starts recording a test drive, with a caption naming the level. */
  start(source: HTMLCanvasElement, caption: string): void {
    this.cancel();
    this.clip = null;
    this.caption = caption;
    this.broken = false;
    const scale = SIZE / Math.max(source.width, source.height, 1);
    // Even sizes: some encoders refuse odd ones.
    this.canvas.width = Math.round((source.width * scale) / 2) * 2;
    this.canvas.height = Math.round((source.height * scale) / 2) * 2;
    try {
      this.stream ??= this.canvas.captureStream(FPS);
      // Sound starts with the first tap, so it may join a later clip than the first.
      if (!this.stream.getAudioTracks().length) for (const t of this.audio()?.getAudioTracks() ?? []) this.stream.addTrack(t);
      this.frame(source);
      this.state = 'recording';
      this.begin();
    } catch {
      this.state = 'idle';
    }
  }

  private begin(): void {
    this.chunks = [];
    const rec = new MediaRecorder(this.stream!, { mimeType: this.type, videoBitsPerSecond: BITRATE });
    rec.addEventListener('dataavailable', (e) => {
      if (rec === this.rec && e.data.size) this.chunks.push(e.data);
    });
    rec.start(1000);
    this.rec = rec;
    this.started = performance.now();
  }

  /** Copies the game's frame into the clip; call after every render while a drive runs. */
  frame(source: HTMLCanvasElement): void {
    if (this.state === 'idle') return;
    const { width: w, height: h } = this.canvas;
    const c = this.ctx;
    // Fits the frame in, as the game canvas may have been resized since the clip started.
    const s = Math.min(w / source.width, h / source.height);
    const dw = source.width * s;
    const dh = source.height * s;
    c.fillStyle = '#0b1d38';
    c.fillRect(0, 0, w, h);
    c.drawImage(source, (w - dw) / 2, (h - dh) / 2, dw, dh);
    const px = Math.round(h * 0.034);
    c.font = font(700, px);
    c.textBaseline = 'bottom';
    c.fillStyle = 'rgba(11, 29, 56, 0.55)';
    const text = `BRIDGE BUILDER · ${this.caption}`;
    c.fillRect(0, h - px * 2, c.measureText(text).width + px * 2, px * 2);
    c.fillStyle = '#e9f3ff';
    c.fillText(text, px, h - px * 0.5);
    if (this.state === 'recording' && !this.broken && performance.now() - this.started > ROLL * 1000) {
      this.rec?.stop();
      this.begin();
    }
  }

  /** Something broke: keep everything from here on. */
  markBreak(): void {
    this.broken = true;
  }

  /** Records a little past the collapse, then makes the clip. Resolves it, or null if recording failed. */
  async finish(tailMs: number): Promise<Blob | null> {
    if (this.state !== 'recording' || !this.rec) return null;
    this.state = 'finishing';
    const rec = this.rec;
    await new Promise((r) => setTimeout(r, tailMs));
    const done = new Promise((r) => rec.addEventListener('stop', r, { once: true }));
    rec.stop();
    await done;
    if (this.rec !== rec) return null;
    this.rec = null;
    this.state = 'idle';
    this.clip = this.chunks.length ? new Blob(this.chunks, { type: this.type.split(';')[0] }) : null;
    this.chunks = [];
    return this.clip;
  }

  /** Drops a recording in progress: the bridge held, or the drive was stopped. */
  cancel(): void {
    if (this.state !== 'recording') return;
    this.state = 'idle';
    const rec = this.rec;
    this.rec = null;
    this.chunks = [];
    try {
      rec?.stop();
    } catch {
      // Already stopped.
    }
  }
}
