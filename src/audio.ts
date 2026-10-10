import type { MaterialId } from './physics/materials';

/** Every sound is synthesized on the fly with WebAudio, so there are no asset files. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private lastCreak = 0;
  muted = false;

  /** Must be called from a user gesture before audio can start. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.02);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, vol: number, filter: BiquadFilterType, freq: number, q = 1, sweepTo?: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  ui(): void {
    this.tone(880, 0.06, 'square', 0.05, 1320);
  }

  select(): void {
    this.tone(520, 0.08, 'triangle', 0.12, 780);
  }

  place(mat: MaterialId): void {
    const base = mat === 'steel' ? 340 : mat === 'wood' ? 200 : 150;
    this.tone(base, 0.12, 'triangle', 0.22, base * 0.6);
    this.burst(0.07, 0.25, 'bandpass', mat === 'steel' ? 3200 : 1400, 3);
    if (mat === 'steel') this.tone(base * 4.1, 0.25, 'sine', 0.05);
  }

  remove(): void {
    this.burst(0.18, 0.2, 'lowpass', 2400, 1, 300);
    this.tone(300, 0.14, 'sine', 0.1, 120);
  }

  invalid(): void {
    this.tone(160, 0.14, 'square', 0.08, 110);
  }

  crack(mat: MaterialId | null): void {
    if (mat === 'steel' || mat === 'ram' || mat === 'damper') {
      this.tone(1900, 0.5, 'sine', 0.12, 700);
      this.burst(0.3, 0.6, 'highpass', 2500, 0.7);
    } else if (mat === 'main') {
      // A thick cable lets go with a long, falling twang.
      this.tone(420, 0.7, 'sawtooth', 0.1, 140);
      this.burst(0.25, 0.6, 'highpass', 2000, 0.6);
    } else {
      this.burst(0.35, 0.8, 'bandpass', 900, 0.8, 200);
      this.burst(0.08, 0.6, 'highpass', 3000, 0.5);
    }
    this.tone(90, 0.35, 'sine', 0.35, 40);
  }

  creak(intensity: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.currentTime - this.lastCreak < 0.35) return;
    this.lastCreak = ctx.currentTime;
    const f = 70 + Math.random() * 50;
    this.tone(f, 0.4, 'sawtooth', 0.04 + intensity * 0.05, f * 1.4);
  }

  splash(big: boolean): void {
    this.burst(big ? 1.1 : 0.45, big ? 0.9 : 0.35, 'lowpass', big ? 2200 : 3000, 0.8, 200);
    if (big) this.tone(120, 0.6, 'sine', 0.3, 50);
  }

  thud(): void {
    this.tone(70, 0.25, 'sine', 0.4, 35);
    this.burst(0.12, 0.25, 'lowpass', 600);
  }

  success(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.16, undefined, i * 0.09));
    this.tone(1568, 0.6, 'sine', 0.06, undefined, 0.36);
  }

  star(i: number): void {
    this.tone(660 * Math.pow(1.26, i), 0.28, 'triangle', 0.18, 660 * Math.pow(1.26, i) * 1.5);
    this.burst(0.15, 0.12, 'highpass', 6000, 0.5);
  }

  tick(): void {
    this.tone(1200 + Math.random() * 200, 0.025, 'square', 0.025);
  }

  fail(): void {
    [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.3, 'sawtooth', 0.07, f * 0.97, i * 0.13));
  }

  gameOver(): void {
    [330, 262, 220, 165].forEach((f, i) => this.tone(f, 0.5, 'square', 0.06, f * 0.95, i * 0.22));
  }

  whoosh(): void {
    this.burst(0.4, 0.22, 'bandpass', 400, 1.2, 2400);
  }

  /** A column of boots landing together. */
  tramp(vol: number): void {
    this.burst(0.09, 0.35 * vol, 'lowpass', 260, 1.2);
    this.tone(70, 0.08, 'sine', 0.12 * vol, 50);
  }

  /** The ground rumbling through an earthquake, s. */
  rumble(dur: number): void {
    for (let t = 0; t < dur; t += 0.8) this.burst(1.2, 0.45 * (1 - t / dur), 'lowpass', 110, 0.8, undefined, t);
  }

  engineStart(base: number): void {
    const ctx = this.ctx;
    // Marchers have no engine.
    if (!ctx || !this.master || this.engine || !base) return;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc2.type = 'square';
    osc.frequency.value = base;
    osc2.frequency.value = base * 0.502;
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    gain.gain.value = 0.0001;
    gain.gain.setTargetAtTime(0.06, ctx.currentTime, 0.1);
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain).connect(this.master);
    osc.start();
    osc2.start();
    this.engine = { osc, osc2, gain, filter };
  }

  engineUpdate(base: number, speed: number): void {
    const e = this.engine;
    if (!e || !this.ctx) return;
    const t = this.ctx.currentTime;
    const f = base + speed * 9;
    e.osc.frequency.setTargetAtTime(f, t, 0.05);
    e.osc2.frequency.setTargetAtTime(f * 0.502, t, 0.05);
    e.filter.frequency.setTargetAtTime(400 + speed * 120, t, 0.05);
  }

  engineStop(): void {
    const e = this.engine;
    if (!e || !this.ctx) return;
    const t = this.ctx.currentTime;
    e.gain.gain.setTargetAtTime(0.0001, t, 0.08);
    e.osc.stop(t + 0.4);
    e.osc2.stop(t + 0.4);
    this.engine = null;
  }
}

export const sfx = new Sfx();
