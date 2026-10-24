import type { StressPalette } from '../storage';

/** One palette for canvas and menus so the whole game reads as a single piece. */
export const PAL = {
  // Blueprint (build mode)
  paper: '#10284a',
  paperDeep: '#0b1d38',
  gridMinor: 'rgba(120, 190, 255, 0.10)',
  gridMajor: 'rgba(120, 190, 255, 0.22)',
  chalk: '#e9f3ff',
  chalkDim: 'rgba(233, 243, 255, 0.55)',
  cyan: '#6cc6ff',
  bolt: '#ff5a4e',
  boltDark: '#8e1f1a',
  invalid: '#ff5a4e',
  valid: '#7dffb0',

  // Painted scene (test mode). Sky, land and water come from the chapter theme (themes.ts).
  tower: '#c86b4a',
  towerDark: '#7a3a2a',
  concrete: '#9aa0a8',
  concreteDark: '#646a73',

  // Materials
  road: '#3b3e46',
  roadLine: '#ffd23f',
  wood: '#c98b4a',
  woodDark: '#8a5a2b',
  steel: '#9fb4c8',
  steelDark: '#52667a',
  heavy: '#2a2d33',
  heavyEdge: '#8d939c',
  cable: '#3b4450',
  cableHi: '#c9d3de',
  main: '#b8482a',
  mainDark: '#5e2214',
  mainHi: '#ffab7d',
  arch: '#b9a58a',
  track: '#4a423a',
  trackDark: '#1e1c1a',
  sleeper: '#6e4d31',
  rail: '#cfd6de',
  masonry: '#a9a497',
  masonryDark: '#57534b',
  archDark: '#5f4f3c',
  archHi: 'rgba(255,240,215,0.3)',
  ram: '#c8369f',
  ramDark: '#5c1048',
  damper: '#e3a81e',
  tendon: '#c9d2dc',
  mud: '#7a5c3e',
  mudDark: '#3f2e1f',
  damperDark: '#6a4708',
  tendonDark: '#2c3540',
  chrome: '#dfe6ee',

  // Stress
  ok: '#39d98a',
  warn: '#ffd23f',
  bad: '#ff3b3b',

  // Accents
  gold: '#ffcc33',
  confetti: ['#ff5a4e', '#ffd23f', '#39d98a', '#6cc6ff', '#c07dff', '#ffffff'],
};

export const MATERIAL_CHALK: Record<string, string> = {
  road: '#f4f8ff',
  wood: '#ffc98a',
  steel: '#9fdcff',
  heavy: '#d6dbe3',
  cable: '#c7a6ff',
  main: '#ff8f5a',
  concrete: '#d8cfbe',
  masonry: '#d9cba8',
  track: '#f2a8a0',
  arch: '#e9d58c',
  ram: '#ff6ad5',
  damper: '#ffe27a',
  tendon: '#b8f0e0',
};

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

type Rgb = [number, number, number];

/**
 * Stress from none to breaking: green → yellow → red, or for colorblind players blue → yellow →
 * vermillion (Okabe–Ito), which differ in lightness as well as hue.
 */
const RAMPS: Record<StressPalette, [Rgb, Rgb, Rgb]> = {
  classic: [hexToRgb(PAL.ok), hexToRgb(PAL.warn), hexToRgb(PAL.bad)],
  colorblind: [hexToRgb('#56b4e9'), hexToRgb('#f0e442'), hexToRgb('#ff6f1a')],
};
let ramp = RAMPS.classic;

/** How stress is drawn. `dashed`: overloaded members are dashed too, so color isn't the only cue. */
export const stressLook = { palette: 'classic' as StressPalette, dashed: false };

export function setStressPalette(p: StressPalette): void {
  ramp = RAMPS[p];
  stressLook.palette = p;
  stressLook.dashed = p === 'colorblind';
}

/** The stress ramp's color for |stress| in 0..1. */
export function stressColor(s: number, alpha = 1): string {
  const t = Math.min(1, Math.abs(s));
  const [ok, warn, bad] = ramp;
  const [a, b, u] = t < 0.5 ? [ok, warn, t / 0.5] : [warn, bad, (t - 0.5) / 0.5];
  const r = Math.round(a[0] + (b[0] - a[0]) * u);
  const g = Math.round(a[1] + (b[1] - a[1]) * u);
  const bl = Math.round(a[2] + (b[2] - a[2]) * u);
  return `rgba(${r},${g},${bl},${alpha})`;
}
