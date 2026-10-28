import { sfx, type Bed } from './audio';
import type { Theme } from './render/themes';

/** One layer of a scene's sound: it fades out and stops, and may play now and then as time passes. */
interface Layer {
  stop(): void;
  tick?(t: number): void;
}

/** Scenes where a ship's horn carries over the water. */
const HORNS = new Set(['harbor', 'estuary']);
/** Scenes with thunder in the rain. */
const THUNDER = new Set(['storm']);

/**
 * The sound of a scene, under the music: wind, water lapping, rain with drips, gulls, a city's
 * hum, crickets at night, and storm gusts with thunder, from the theme's weather, land, birds and
 * time of day. A handful of nodes per scene, crossfaded when the scene changes, and none at all
 * while the ambience can't be heard.
 */
export class Ambience {
  private bed: Bed | null = null;
  private level: GainNode | null = null;
  private layers: Layer[] = [];
  private scene: string | null = null;
  private loudness = -1;

  /** Called every frame: the scene on screen (or none), and how loud its sound sits, 0 to 1. */
  update(theme: Theme | null, loudness: number): void {
    const bed = this.bed ?? this.start();
    if (!bed) return;
    const want = theme && sfx.audible('ambience') ? theme.id : null;
    if (want !== this.scene) {
      this.fadeOut();
      this.scene = want;
      if (theme && want) this.layers = this.build(theme);
    }
    if (loudness !== this.loudness) {
      this.loudness = loudness;
      this.level!.gain.setTargetAtTime(loudness, bed.ctx.currentTime, 0.4);
    }
    const t = bed.ctx.currentTime;
    for (const l of this.layers) l.tick?.(t);
  }

  private start(): Bed | null {
    const bed = sfx.bed('ambience');
    if (!bed) return null;
    this.level = bed.ctx.createGain();
    this.level.gain.value = 0;
    this.level.connect(bed.out);
    this.bed = bed;
    return bed;
  }

  private fadeOut(): void {
    for (const l of this.layers) l.stop();
    this.layers = [];
  }

  private build(th: Theme): Layer[] {
    const city = th.land === 'city';
    const layers: Layer[] = [];
    const storm = THUNDER.has(th.id);
    layers.push(this.wind(storm ? 0.35 : th.weather === 'snow' ? 0.16 : city ? 0.05 : 0.08, storm ? 900 : th.weather === 'snow' ? 1400 : 500, storm));
    layers.push(this.water(th.land === 'mesa' || th.land === 'peaks' ? 0.06 : 0.12));
    if (th.weather === 'rain') layers.push(this.rain(storm ? 0.16 : 0.1));
    if (city) layers.push(this.hum(th.night ? 0.05 : 0.035));
    if (th.night) layers.push(this.crickets());
    if (th.birds) layers.push(this.gulls());
    if (storm) layers.push(this.thunder());
    if (HORNS.has(th.id)) layers.push(this.horn());
    if (th.land === 'volcano') layers.push(this.rumble(), this.steam());
    return layers;
  }

  /** A looped stretch of noise through a filter, fading in. `wobble` adds a slow swing to one of its settings. */
  private noiseBed(type: BiquadFilterType, freq: number, q: number, vol: number): { filter: BiquadFilterNode; gain: GainNode; layer: Layer; wobble(rate: number, depth: number, into: AudioParam): void } {
    const { ctx, noise } = this.bed!;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(vol, ctx.currentTime, 0.8);
    src.connect(filter).connect(gain).connect(this.level!);
    src.start(ctx.currentTime, Math.random() * 2);
    const extra: AudioScheduledSourceNode[] = [];
    const layer: Layer = {
      stop: () => {
        const t = ctx.currentTime;
        gain.gain.setTargetAtTime(0, t, 0.5);
        src.stop(t + 2.5);
        for (const n of extra) n.stop(t + 2.5);
      },
    };
    return { filter, gain, layer, wobble: (rate, depth, into) => void extra.push(this.lfo(rate, depth, into)) };
  }

  /** A slow wobble on a parameter. */
  private lfo(rate: number, depth: number, into: AudioParam): OscillatorNode {
    const ctx = this.bed!.ctx;
    const o = ctx.createOscillator();
    o.frequency.value = rate;
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(into);
    o.start();
    return o;
  }

  private wind(vol: number, freq: number, gusty: boolean): Layer {
    const b = this.noiseBed('bandpass', freq, 0.7, vol);
    b.wobble(gusty ? 0.13 : 0.07, freq * 0.5, b.filter.frequency);
    b.wobble(gusty ? 0.09 : 0.05, vol * (gusty ? 0.8 : 0.5), b.gain.gain);
    return b.layer;
  }

  /** Water lapping: a low wash that swells and falls away, so it reads as waves and not as hiss. */
  private water(vol: number): Layer {
    const b = this.noiseBed('lowpass', 300, 0.8, vol);
    b.wobble(0.16, vol * 0.9, b.gain.gain);
    return b.layer;
  }

  private rain(vol: number): Layer {
    const b = this.noiseBed('highpass', 1300, 0.5, vol);
    let next = 0;
    return {
      stop: b.layer.stop,
      tick: (t) => {
        if (t < next) return;
        next = t + 0.05 + Math.random() * 0.25;
        this.blip(1400 + Math.random() * 2600, t + Math.random() * 0.05, 0.05, 0.02 + Math.random() * 0.03, 'sine', 0.6);
      },
    };
  }

  private hum(vol: number): Layer {
    const { ctx } = this.bed!;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 170;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(vol, ctx.currentTime, 0.8);
    filter.connect(gain).connect(this.level!);
    const oscs = [55, 82.6].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(filter);
      o.start();
      return o;
    });
    const traffic = this.noiseBed('lowpass', 300, 0.6, vol * 1.6);
    return {
      stop: () => {
        const t = ctx.currentTime;
        gain.gain.setTargetAtTime(0, t, 0.5);
        for (const o of oscs) o.stop(t + 2.5);
        traffic.layer.stop();
      },
    };
  }

  /** Chirps in threes and fours, from here and there. */
  private crickets(): Layer {
    let next = 0;
    return {
      stop: () => {},
      tick: (t) => {
        if (t < next) return;
        next = t + 0.4 + Math.random() * 1.4;
        const f = 4200 + Math.random() * 600;
        const n = 3 + Math.floor(Math.random() * 2);
        for (let i = 0; i < n; i++) this.blip(f, t + i * 0.055, 0.035, 0.012, 'sine');
      },
    };
  }

  /** A gull's cry now and then: two or three falling calls. */
  private gulls(): Layer {
    let next = 0;
    return {
      stop: () => {},
      tick: (t) => {
        if (!next) next = t + 2 + Math.random() * 4;
        if (t < next) return;
        next = t + 6 + Math.random() * 10;
        const calls = 2 + Math.floor(Math.random() * 2);
        const pitch = 0.85 + Math.random() * 0.3;
        for (let i = 0; i < calls; i++) this.cry(t + i * 0.32, pitch, 0.035 - i * 0.008);
      },
    };
  }

  private cry(t: number, pitch: number, vol: number): void {
    const ctx = this.bed!.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1300 * pitch, t);
    o.frequency.linearRampToValueAtTime(2300 * pitch, t + 0.06);
    o.frequency.exponentialRampToValueAtTime(1000 * pitch, t + 0.26);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(this.level!);
    o.start(t);
    o.stop(t + 0.3);
  }

  /** The ground's low rumble near a volcano, swelling and settling. */
  private rumble(): Layer {
    const b = this.noiseBed('lowpass', 70, 0.8, 0.14);
    b.wobble(0.06, 0.08, b.gain.gain);
    b.wobble(0.11, 25, b.filter.frequency);
    return b.layer;
  }

  /** A wellhead venting steam every so often: a hiss that swells, holds and dies away. */
  private steam(): Layer {
    let next = 0;
    return {
      stop: () => {},
      tick: (t) => {
        if (!next) next = t + 3 + Math.random() * 5;
        if (t < next) return;
        next = t + 7 + Math.random() * 9;
        const { ctx, noise } = this.bed!;
        const long = 1.5 + Math.random() * 2.5;
        const src = ctx.createBufferSource();
        src.buffer = noise;
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.setValueAtTime(2600 + Math.random() * 1200, t);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05, t + 0.5);
        g.gain.setValueAtTime(0.05, t + long);
        g.gain.exponentialRampToValueAtTime(0.0001, t + long + 1.2);
        src.connect(f).connect(g).connect(this.level!);
        src.start(t, Math.random() * 1.5);
        src.stop(t + long + 1.3);
      },
    };
  }

  /** A far roll of thunder every so often. */
  private thunder(): Layer {
    let next = 0;
    return {
      stop: () => {},
      tick: (t) => {
        if (!next) next = t + 5 + Math.random() * 8;
        if (t < next) return;
        next = t + 14 + Math.random() * 16;
        const { ctx, noise } = this.bed!;
        const src = ctx.createBufferSource();
        src.buffer = noise;
        src.playbackRate.value = 0.4;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(260, t);
        f.frequency.exponentialRampToValueAtTime(70, t + 3.5);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.3);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
        src.connect(f).connect(g).connect(this.level!);
        src.start(t);
        src.stop(t + 4.1);
      },
    };
  }

  /** A ship's horn far off: a long low two-note blast. */
  private horn(): Layer {
    let next = 0;
    return {
      stop: () => {},
      tick: (t) => {
        if (!next) next = t + 8 + Math.random() * 10;
        if (t < next) return;
        next = t + 30 + Math.random() * 30;
        for (const f of [73.4, 110]) {
          const ctx = this.bed!.ctx;
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          const lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 260;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.03, t + 0.4);
          g.gain.setValueAtTime(0.03, t + 2);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
          o.connect(lp).connect(g).connect(this.level!);
          o.start(t);
          o.stop(t + 3.3);
        }
      },
    };
  }

  /** One short tone: a drip or a chirp. */
  private blip(f: number, t: number, dur: number, vol: number, type: OscillatorType, slide = 1): void {
    const ctx = this.bed!.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(f * slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.level!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}

export const ambience = new Ambience();
