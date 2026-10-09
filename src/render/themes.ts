/**
 * Chapter looks for the painted (test-mode) scene: sky, land, water, trees, weather and time of
 * day. The blueprint stays the same in every chapter so building always feels the same.
 */

/** Silhouette of the distant land layers. */
export type Land = 'hills' | 'mesa' | 'flat' | 'dunes' | 'peaks' | 'city';
/** What grows (or stands) along the banks. */
export type Flora = 'mixed' | 'cactus' | 'willow' | 'palm' | 'pine' | 'lamps';
export type Weather = 'clear' | 'rain' | 'snow';

export interface Theme {
  id: string;
  name: string;
  /** Sky gradient: top, middle, horizon. */
  sky: [string, string, string];
  /** Sun (or moon) center as fractions of the screen, radius as a fraction of its height, and colors. */
  sun: { x: number; y: number; r: number; color: string; glow: string } | null;
  /** Stars in the sky, for night. */
  stars: boolean;
  /** Cloud color as "r,g,b", how opaque, how many, and how big. */
  clouds: { rgb: string; alpha: number; count: number; scale: number };
  land: Land;
  /** Distant, middle and near land layers. */
  mountain: string;
  hillFar: string;
  hillNear: string;
  /** Snow on the highest ridges. */
  snowCaps: boolean;
  flora: Flora;
  tree: string;
  /** Bank top: grass, sand, snow or a concrete curb. */
  grass: string;
  grassDark: string;
  /** Grass tufts along the banks, or none. */
  tufts: boolean;
  rock: string;
  rockDark: string;
  waterTop: string;
  waterDeep: string;
  /** The translucent layer in front of anything sinking. */
  waterFront: string;
  foam: string;
  /** Light glinting on the water. */
  glint: string;
  vignette: string;
  weather: Weather;
  /** Night: the bridge and vehicle are shaded down, and lights glow. */
  night: boolean;
  /** Gulls wheeling over the water. */
  birds: boolean;
}

export const THEMES: Theme[] = [
  {
    id: 'river',
    name: 'River',
    sky: ['#2a3a6e', '#e46f5c', '#ffc27a'],
    sun: { x: 0.72, y: 0.4, r: 0.06, color: '#fff1c4', glow: '255,210,140' },
    stars: false,
    clouds: { rgb: '255,214,190', alpha: 0.16, count: 6, scale: 1 },
    land: 'hills',
    mountain: '#8a6a8e',
    hillFar: '#6b4f7a',
    hillNear: '#3f3a5c',
    snowCaps: false,
    flora: 'mixed',
    tree: '#2c2a45',
    grass: '#4f9d58',
    grassDark: '#2f6b3e',
    tufts: true,
    rock: '#6e5a52',
    rockDark: '#43352f',
    waterTop: '#3d8fb0',
    waterDeep: '#173a5e',
    waterFront: 'rgba(40,110,150,0.55)',
    foam: '#cfefff',
    glint: 'rgba(255,230,180,0.5)',
    vignette: 'rgba(10,5,30,0.45)',
    weather: 'clear',
    night: false,
    birds: false,
  },
  {
    id: 'canyon',
    name: 'Canyon',
    sky: ['#3d7cc9', '#9cc8e8', '#f3d9a4'],
    sun: { x: 0.26, y: 0.2, r: 0.05, color: '#fffbe8', glow: '255,244,210' },
    stars: false,
    clouds: { rgb: '255,255,255', alpha: 0.22, count: 3, scale: 0.8 },
    land: 'mesa',
    mountain: '#d19a78',
    hillFar: '#b86a44',
    hillNear: '#8a4a2e',
    snowCaps: false,
    flora: 'cactus',
    tree: '#4a6b3a',
    grass: '#c9a45c',
    grassDark: '#9a7a3c',
    tufts: true,
    rock: '#b5623b',
    rockDark: '#6e3420',
    waterTop: '#4a9a8a',
    waterDeep: '#1f4f52',
    waterFront: 'rgba(40,120,110,0.5)',
    foam: '#e8fff6',
    glint: 'rgba(255,255,240,0.55)',
    vignette: 'rgba(60,20,0,0.35)',
    weather: 'clear',
    night: false,
    birds: false,
  },
  {
    id: 'flood',
    name: 'Flood plain',
    sky: ['#454f5c', '#7a8591', '#a7aeb2'],
    sun: null,
    stars: false,
    clouds: { rgb: '92,100,112', alpha: 0.45, count: 9, scale: 1.5 },
    land: 'flat',
    mountain: '#727d83',
    hillFar: '#5c6a5e',
    hillNear: '#44543f',
    snowCaps: false,
    flora: 'willow',
    tree: '#33412f',
    grass: '#5f8a4a',
    grassDark: '#3d5e32',
    tufts: true,
    rock: '#6b6152',
    rockDark: '#3f382e',
    waterTop: '#7a7458',
    waterDeep: '#3d3a2a',
    waterFront: 'rgba(95,88,60,0.6)',
    foam: '#e0dcc8',
    glint: 'rgba(220,225,230,0.2)',
    vignette: 'rgba(10,15,20,0.5)',
    weather: 'rain',
    night: false,
    birds: false,
  },
  {
    id: 'coast',
    name: 'Coast',
    sky: ['#1e6fb8', '#6ec0ea', '#d9f1ff'],
    sun: { x: 0.8, y: 0.17, r: 0.05, color: '#ffffff', glow: '255,255,235' },
    stars: false,
    clouds: { rgb: '255,255,255', alpha: 0.35, count: 5, scale: 1.1 },
    land: 'dunes',
    mountain: '#7fa6c0',
    hillFar: '#5e8a6a',
    hillNear: '#d8c39a',
    snowCaps: false,
    flora: 'palm',
    tree: '#2f5a3a',
    grass: '#7fb35a',
    grassDark: '#4f7f3a',
    tufts: true,
    rock: '#c9bfa8',
    rockDark: '#8a7f68',
    waterTop: '#1f9fbf',
    waterDeep: '#0b4f7a',
    waterFront: 'rgba(20,120,160,0.5)',
    foam: '#ffffff',
    glint: 'rgba(255,255,255,0.6)',
    vignette: 'rgba(0,20,40,0.3)',
    weather: 'clear',
    night: false,
    birds: true,
  },
  {
    id: 'mountains',
    name: 'Mountains',
    sky: ['#4f6089', '#a3b2cf', '#ebdcd6'],
    sun: { x: 0.3, y: 0.34, r: 0.045, color: '#fdf1e0', glow: '255,225,205' },
    stars: false,
    clouds: { rgb: '235,238,248', alpha: 0.28, count: 6, scale: 1.2 },
    land: 'peaks',
    mountain: '#8d9bb4',
    hillFar: '#5d6e8a',
    hillNear: '#34424f',
    snowCaps: true,
    flora: 'pine',
    tree: '#1f2d35',
    grass: '#eef3f8',
    grassDark: '#b9c6d4',
    tufts: false,
    rock: '#6d7480',
    rockDark: '#3e434c',
    waterTop: '#6fb3c8',
    waterDeep: '#1d4a66',
    waterFront: 'rgba(80,140,170,0.5)',
    foam: '#f4fbff',
    glint: 'rgba(255,240,230,0.45)',
    vignette: 'rgba(20,25,45,0.4)',
    weather: 'snow',
    night: false,
    birds: false,
  },
  {
    id: 'city',
    name: 'Night city',
    sky: ['#03061a', '#0d1a40', '#2a3668'],
    sun: { x: 0.8, y: 0.18, r: 0.035, color: '#f4f1e2', glow: '190,205,255' },
    stars: true,
    clouds: { rgb: '70,82,125', alpha: 0.25, count: 4, scale: 1.3 },
    land: 'city',
    mountain: '#1a2442',
    hillFar: '#121a35',
    hillNear: '#0b1128',
    snowCaps: false,
    flora: 'lamps',
    tree: '#23262e',
    grass: '#4a4f5c',
    grassDark: '#2c3038',
    tufts: false,
    rock: '#3a3d47',
    rockDark: '#1c1e25',
    waterTop: '#1b2c55',
    waterDeep: '#050a1c',
    waterFront: 'rgba(15,25,60,0.6)',
    foam: '#b8c8ff',
    glint: 'rgba(255,215,140,0.5)',
    vignette: 'rgba(0,0,10,0.55)',
    weather: 'clear',
    night: true,
    birds: false,
  },
  {
    id: 'harbor',
    name: 'Harbor',
    sky: ['#5d7fa8', '#b9c9d6', '#f2dcc2'],
    sun: { x: 0.18, y: 0.3, r: 0.05, color: '#fff4dc', glow: '255,226,190' },
    stars: false,
    clouds: { rgb: '236,240,246', alpha: 0.3, count: 5, scale: 1.2 },
    land: 'city',
    mountain: '#8d9bb0',
    hillFar: '#6f7e95',
    hillNear: '#4e5b70',
    snowCaps: false,
    flora: 'lamps',
    tree: '#3b4454',
    grass: '#9a9c9e',
    grassDark: '#6b6e72',
    tufts: false,
    rock: '#6d6660',
    rockDark: '#443f3b',
    waterTop: '#3f7892',
    waterDeep: '#15344a',
    waterFront: 'rgba(40,95,125,0.55)',
    foam: '#e2f2fa',
    glint: 'rgba(255,240,215,0.5)',
    vignette: 'rgba(15,25,40,0.4)',
    weather: 'clear',
    night: false,
    birds: true,
  },
  {
    id: 'fjord',
    name: 'Fjord',
    sky: ['#2c3a63', '#8f8fb8', '#f4c8a4'],
    sun: { x: 0.8, y: 0.46, r: 0.05, color: '#fff0d8', glow: '255,205,160' },
    stars: false,
    clouds: { rgb: '240,226,226', alpha: 0.24, count: 5, scale: 1.4 },
    land: 'peaks',
    mountain: '#6c7598',
    hillFar: '#3f4e66',
    hillNear: '#26353a',
    snowCaps: true,
    flora: 'pine',
    tree: '#1a2a26',
    grass: '#5f7d4a',
    grassDark: '#3e5733',
    tufts: true,
    rock: '#5c6068',
    rockDark: '#33363d',
    waterTop: '#4f7f99',
    waterDeep: '#132c40',
    waterFront: 'rgba(55,100,130,0.55)',
    foam: '#e8f4fa',
    glint: 'rgba(255,225,200,0.55)',
    vignette: 'rgba(15,20,40,0.42)',
    weather: 'clear',
    night: false,
    birds: true,
  },
];

/** Each chapter has its own look, in chapter order. */
export function themeForChapter(chapterId: number): Theme {
  return THEMES[(chapterId - 1) % THEMES.length];
}
