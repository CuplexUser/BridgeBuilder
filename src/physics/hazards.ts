/** What a level can throw at a bridge besides its traffic: a flood, wind gusts, a quake and marching feet. */
import { GRAVITY } from './world';

export interface Flood {
  /** Where the lead vehicle is when the river starts to rise, m. */
  at: number;
  /** How far the river rises, m. */
  rise: number;
  /** Push of the current on members in the water, N per m under water. */
  current: number;
}

export interface Wind {
  /** Push on members across the wind at a gust's peak, N per m of their height. */
  push: number;
  /** Lift on the deck at a gust's peak, N per m of its length. */
  lift: number;
  /** Seconds from gust to gust. */
  period: number;
  /**
   * Flutter: at a gust's peak, the wind pushes a moving deck further the way it's already going,
   * N per m of deck per m/s it moves up or down. It feeds a deck's own bounce, so a light,
   * lively deck swings ever harder, while a stiff or damped one barely moves to begin with.
   */
  flutter?: number;
}

export interface Quake {
  /** Strongest shaking, as a share of gravity. */
  g: number;
  /** Shakes a second. */
  freq: number;
  /**
   * Shakes a second at the end, when the shaking sweeps: it rises steadily from `freq`, so at
   * some moment it matches the bridge's own sway, whatever that is, and sets it swinging.
   */
  sweep?: number;
  /** Where the lead vehicle is when the shaking starts, m, and how long it lasts, s. */
  at: number;
  dur: number;
}

export interface March {
  /** Steps a second, every marcher in time. */
  pace: number;
  /** How much harder each step lands than standing, as a share of the marchers' weight. */
  force: number;
}

/** How hard the wind gusts at time t, 0 to 1: a smooth gust every period, never quite still. */
export function windGust(w: Wind, t: number): number {
  const s = Math.sin((Math.PI * t) / w.period);
  return 0.15 + 0.85 * s * s;
}

/** How strongly the ground shakes t seconds into a quake, 0 to 1: it builds quickly and dies away. */
function quakeEnvelope(q: Quake, t: number): number {
  const u = t / q.dur;
  if (u <= 0 || u >= 1) return 0;
  return Math.min(1, u * 6) * Math.min(1, (1 - u) * 3);
}

/** The quake's phase t seconds in, radians: its frequency rises from freq to sweep across the quake. */
function quakePhase(q: Quake, t: number): number {
  const rise = ((q.sweep ?? q.freq) - q.freq) / q.dur;
  return 2 * Math.PI * (q.freq * t + (rise * t * t) / 2);
}

/** Shakes a second t seconds into a quake. */
function quakeFreq(q: Quake, t: number): number {
  return q.freq + (((q.sweep ?? q.freq) - q.freq) * Math.min(Math.max(t, 0), q.dur)) / q.dur;
}

/** The ground's acceleration t seconds into a quake, m/s²: mostly sideways, a little up and down. */
export function quakeAccel(q: Quake, t: number): [number, number] {
  const env = quakeEnvelope(q, t);
  if (!env) return [0, 0];
  const w = quakePhase(q, t);
  const a = q.g * -GRAVITY * env;
  return [a * Math.sin(w), 0.3 * a * Math.sin(1.37 * w + 0.6)];
}

/** How far the ground has moved sideways t seconds into a quake, m, for drawing it. */
export function quakeShift(q: Quake, t: number): number {
  const env = quakeEnvelope(q, t);
  if (!env) return 0;
  const w = 2 * Math.PI * quakeFreq(q, t);
  return (-q.g * -GRAVITY * env * Math.sin(quakePhase(q, t))) / (w * w);
}

/** Extra downward push on a marcher at time t, m/s²: each footfall lands together. */
export function marchAccel(m: March, t: number): number {
  return m.force * -GRAVITY * Math.sin(2 * Math.PI * m.pace * t);
}
