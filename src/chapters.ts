import { LEVELS, type LevelDef } from './levels';

/** A level's best result, as stored per profile. */
export interface Best {
  score: number;
  /** The three main stars. */
  stars: number;
  /** The bonus goal was met at least once. */
  bonus?: boolean;
  /** The best-scoring run: what its bridge cost, its peak stress (0–1) and the design itself. */
  cost?: number;
  peak?: number;
  design?: string;
}
export type BestMap = Record<number, Best | undefined>;

export interface ChapterDef {
  id: number;
  name: string;
  blurb: string;
  /** 1 (gentle) up to the number of chapters (brutal): shown as pips on the chapter card. */
  difficulty: number;
  /** How much building a typical level takes. */
  effort: string;
  /** Level ids in play order. Ids are stable across releases so saved progress survives reordering. */
  levels: number[];
}

/**
 * Seven levels a chapter, ordered by difficulty. Each mechanic's levels stay together where
 * they can, with the one that teaches it (its ghost) first, so a chapter may end on the first
 * levels of the next topic.
 */
export const CHAPTERS: ChapterDef[] = [
  {
    id: 1,
    name: 'Groundwork',
    blurb: 'Short crossings. Learn the road, triangles and your first truss, then steel, a slope and a pier.',
    difficulty: 1,
    effort: 'Quick builds · 3–20 parts',
    levels: [1, 2, 21, 3, 4, 5, 6],
  },
  {
    id: 2,
    name: 'Load Bearing',
    blurb: 'Piers, trucks and gorges, high anchors, flood water and a busload of kids. Steel earns its price.',
    difficulty: 2,
    effort: 'Short builds · 15–30 parts',
    levels: [22, 7, 8, 9, 10, 23, 11],
  },
  {
    id: 3,
    name: 'Tension',
    blurb: 'Cables only pull. Pylons, cliffs, mid-air joints and ship channels, and a semi on heavy deck to finish.',
    difficulty: 3,
    effort: 'Medium builds · 15–35 parts',
    levels: [12, 13, 14, 15, 24, 16, 17],
  },
  {
    id: 4,
    name: 'Heavy Traffic',
    blurb: 'Steep climbs and suspension bridges on heavy deck, then drawbridges on hydraulic rams, convoys and toll bolts.',
    difficulty: 4,
    effort: 'Medium builds · 10–45 parts',
    levels: [18, 25, 26, 19, 31, 32, 33],
  },
  {
    id: 5,
    name: 'Arches',
    blurb: 'Drawbridges in traffic, then concrete blocks and block arches. They only push: send every thrust into rock.',
    difficulty: 5,
    effort: 'Big builds · 15–85 parts',
    levels: [34, 35, 46, 47, 48, 49, 50],
  },
  {
    id: 6,
    name: 'Railway',
    blurb: 'Trains: long, heavy and coupled, on track that climbs 3% at most. Then soft mud that sinks under a load.',
    difficulty: 6,
    effort: 'Big builds · 15–80 parts',
    levels: [51, 52, 53, 54, 55, 61, 62],
  },
  {
    id: 7,
    name: 'Anchorage',
    blurb: 'Floods that wash out what stands on mud, then hinged masts and concrete anchors you set yourself.',
    difficulty: 7,
    effort: 'Big builds · 15–80 parts',
    levels: [63, 64, 65, 36, 37, 38, 39],
  },
  {
    id: 8,
    name: 'Main Cable',
    blurb: 'Very long spans: a thick main cable over tall concrete towers, sagged just right and anchored deep in the banks.',
    difficulty: 8,
    effort: 'Grand builds · 40–95 parts',
    levels: [40, 41, 42, 43, 44, 45, 27],
  },
  {
    id: 9,
    name: 'Master Works',
    blurb: 'Thirty-meter spans and forty-tonne loads, then bridges that move: marching boots, gales and an earthquake.',
    difficulty: 9,
    effort: 'Huge builds · 25–75 parts',
    levels: [28, 20, 29, 30, 56, 57, 58],
  },
  // Added after the finale, and played before it: its id is 11, its number 10. See chapterNumber.
  {
    id: 11,
    name: 'Modern Works',
    blurb: 'Prestressed girders, a double-deck railway, and drawbridges that split, lift and swing for the ships.',
    difficulty: 10,
    effort: 'Big builds · 10–85 parts',
    levels: [71, 72, 74, 75, 73, 76, 77],
  },
  {
    id: 10,
    name: 'Grand Finale',
    blurb: 'Everything at once: the greatest arch, parades in a storm, and trains and semis over a delta in flood.',
    difficulty: 11,
    effort: 'Grand builds · 20–90 parts',
    levels: [69, 59, 66, 60, 68, 67, 70],
  },
];

/**
 * The scene each level is tested in, as an index into THEMES: the look of the topic it was made
 * for, whichever chapter it sits in now.
 */
const SCENES: number[][] = [
  [1, 2, 21, 3, 4],
  [5, 6, 22, 7, 8],
  [9, 10, 23, 11, 12, 67],
  [13, 14, 15, 24, 16],
  [17, 18, 25, 26, 19],
  [27, 28, 20, 29, 30],
  [31, 32, 33, 34, 35, 74, 75, 76],
  [36, 37, 38, 39, 40],
  [41, 42, 43, 44, 45],
  [46, 47, 48, 49, 50, 69, 71, 72],
  [51, 52, 53, 54, 55, 66, 73, 77],
  [56, 57, 58, 59, 60, 68],
  [61, 62, 63, 64, 65, 70],
];

export function sceneOf(levelId: number): number {
  return Math.max(0, SCENES.findIndex((ids) => ids.includes(levelId)));
}

/**
 * The challenge board a chapter's runs go on. Chapters were regrouped from five levels to seven,
 * so their boards start afresh past the old ones, which stay in storage unseen.
 */
export function challengeBoard(chapterId: number): number {
  return CHALLENGE_BOARDS + chapterId;
}

const CHALLENGE_BOARDS = 20;

export function levelById(id: number): LevelDef {
  const l = LEVELS.find((x) => x.id === id);
  if (!l) throw new Error(`No level ${id}`);
  return l;
}

/** A chapter by its id, which since chapters were reordered is not always its number. */
export function chapterById(id: number): ChapterDef | undefined {
  return CHAPTERS.find((c) => c.id === id);
}

export function chapterOf(levelId: number): ChapterDef {
  const c = CHAPTERS.find((ch) => ch.levels.includes(levelId));
  if (!c) throw new Error(`Level ${levelId} is in no chapter`);
  return c;
}

/**
 * A chapter's number as players see it: its place in the order. Ids stay fixed, since saved
 * challenge boards hang on them, so a chapter added before the last has a higher id than number.
 */
export function chapterNumber(c: ChapterDef): number {
  return CHAPTERS.indexOf(c) + 1;
}

/** Chapter-position label shown to players, e.g. "3-2". */
export function levelCode(levelId: number): string {
  const c = chapterOf(levelId);
  return `${chapterNumber(c)}-${c.levels.indexOf(levelId) + 1}`;
}

export function crossed(best: BestMap, levelId: number): boolean {
  return (best[levelId]?.stars ?? 0) > 0;
}

export function chapterComplete(chapter: ChapterDef, best: BestMap): boolean {
  return chapter.levels.every((id) => crossed(best, id));
}

/**
 * The first chapter is always open; each later one opens once the one before is finished. One
 * with a level already crossed stays open too, so regrouping the chapters locks no one out.
 */
export function chapterUnlocked(chapter: ChapterDef, best: BestMap): boolean {
  const i = CHAPTERS.indexOf(chapter);
  return i <= 0 || chapterComplete(CHAPTERS[i - 1], best) || chapter.levels.some((id) => crossed(best, id));
}

/** Inside an open chapter, levels open one after another; a level once crossed stays open. */
export function levelUnlocked(levelId: number, best: BestMap): boolean {
  if (crossed(best, levelId)) return true;
  const c = chapterOf(levelId);
  if (!chapterUnlocked(c, best)) return false;
  const i = c.levels.indexOf(levelId);
  return i === 0 || crossed(best, c.levels[i - 1]);
}

/** Next level in the same chapter, or null at the chapter's end. */
export function nextInChapter(levelId: number): number | null {
  const c = chapterOf(levelId);
  const i = c.levels.indexOf(levelId);
  return i < c.levels.length - 1 ? c.levels[i + 1] : null;
}

/** Where "Continue" goes: the first open level not yet crossed, or the very last level once all are done. */
export function continueLevel(best: BestMap): number {
  for (const c of CHAPTERS) {
    if (!chapterUnlocked(c, best)) break;
    for (const id of c.levels) if (!crossed(best, id)) return id;
  }
  const last = CHAPTERS[CHAPTERS.length - 1];
  return last.levels[last.levels.length - 1];
}

export interface Totals {
  score: number;
  stars: number;
  /** Bonus goals met. */
  bonus: number;
  crossed: number;
}

/** Career totals over the given levels (all levels by default). */
export function totals(best: BestMap, levelIds: number[] = LEVELS.map((l) => l.id)): Totals {
  let score = 0;
  let stars = 0;
  let bonus = 0;
  let n = 0;
  for (const id of levelIds) {
    const b = best[id];
    if (!b) continue;
    score += b.score;
    stars += b.stars;
    if (b.bonus) bonus++;
    if (b.stars > 0) n++;
  }
  return { score, stars, bonus, crossed: n };
}

/** Highest level id currently open, kept for the `unlocked` field older saves and the server still store. */
export function highestUnlocked(best: BestMap): number {
  let hi = 1;
  for (const l of LEVELS) if (levelUnlocked(l.id, best)) hi = Math.max(hi, l.id);
  return hi;
}
