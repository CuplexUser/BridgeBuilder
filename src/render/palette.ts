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

  // Golden hour (test mode)
  skyTop: '#2a3a6e',
  skyMid: '#e46f5c',
  skyLow: '#ffc27a',
  sun: '#fff1c4',
  hillFar: '#6b4f7a',
  hillNear: '#3f3a5c',
  mountain: '#8a6a8e',
  tree: '#2c2a45',
  tower: '#c86b4a',
  towerDark: '#7a3a2a',
  grass: '#4f9d58',
  grassDark: '#2f6b3e',
  rock: '#6e5a52',
  rockDark: '#43352f',
  waterTop: '#3d8fb0',
  waterDeep: '#173a5e',
  foam: '#cfefff',
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
};

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const OK = hexToRgb(PAL.ok);
const WARN = hexToRgb(PAL.warn);
const BAD = hexToRgb(PAL.bad);

/** Green → yellow → red for |stress| in 0..1. */
export function stressColor(s: number, alpha = 1): string {
  const t = Math.min(1, Math.abs(s));
  const [a, b, u] = t < 0.5 ? [OK, WARN, t / 0.5] : [WARN, BAD, (t - 0.5) / 0.5];
  const r = Math.round(a[0] + (b[0] - a[0]) * u);
  const g = Math.round(a[1] + (b[1] - a[1]) * u);
  const bl = Math.round(a[2] + (b[2] - a[2]) * u);
  return `rgba(${r},${g},${bl},${alpha})`;
}
