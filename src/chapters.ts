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

export const CHAPTERS: ChapterDef[] = [
  {
    id: 1,
    name: 'Groundwork',
    blurb: 'Short crossings. Learn the road, triangles and your first truss.',
    difficulty: 1,
    effort: 'Quick builds · 4–20 parts',
    levels: [1, 2, 21, 3, 4],
  },
  {
    id: 2,
    name: 'Load Bearing',
    blurb: 'Slopes, piers and heavier vehicles. Steel earns its price.',
    difficulty: 2,
    effort: 'Short builds · 15–30 parts',
    levels: [5, 6, 22, 7, 8],
  },
  {
    id: 3,
    name: 'Deep Water',
    blurb: 'Longer spans, high anchors, flood water and a busload of kids.',
    difficulty: 3,
    effort: 'Medium builds · 20–35 parts',
    levels: [9, 10, 23, 11, 12],
  },
  {
    id: 4,
    name: 'Tension',
    blurb: 'Cables only pull. Pylons, cliffs, mid-air joints and ship channels.',
    difficulty: 4,
    effort: 'Medium builds · 15–30 parts',
    levels: [13, 14, 15, 24, 16],
  },
  {
    id: 5,
    name: 'Heavy Metal',
    blurb: 'Semis and heavy deck, steep climbs and suspension bridges. Mistakes are expensive.',
    difficulty: 5,
    effort: 'Big builds · 25–40 parts',
    levels: [17, 18, 25, 26, 19],
  },
  {
    id: 6,
    name: 'Master Works',
    blurb: 'Thirty-meter spans and forty-tonne loads. Everything at once.',
    difficulty: 6,
    effort: 'Huge builds · 40–60 parts',
    levels: [27, 28, 20, 29, 30],
  },
  {
    id: 7,
    name: 'Moving Parts',
    blurb: 'Drawbridges on hydraulic rams, convoys, toll bolts and rationed steel.',
    difficulty: 7,
    effort: 'Medium builds · 15–40 parts',
    levels: [31, 32, 33, 34, 35],
  },
  {
    id: 8,
    name: 'Anchorage',
    blurb: 'Hinged masts and concrete anchors you set yourself. Balance every pull, or the bank lets go.',
    difficulty: 8,
    effort: 'Big builds · 30–60 parts',
    levels: [36, 37, 38, 39, 40],
  },
  {
    id: 9,
    name: 'Main Cable',
    blurb: 'Very long spans: a thick main cable hung over tall concrete towers, sagged just right and anchored deep in the banks.',
    difficulty: 9,
    effort: 'Grand builds · 60–120 parts',
    levels: [41, 42, 43, 44, 45],
  },
];

export function levelById(id: number): LevelDef {
  const l = LEVELS.find((x) => x.id === id);
  if (!l) throw new Error(`No level ${id}`);
  return l;
}

export function chapterOf(levelId: number): ChapterDef {
  const c = CHAPTERS.find((ch) => ch.levels.includes(levelId));
  if (!c) throw new Error(`Level ${levelId} is in no chapter`);
  return c;
}

/** Chapter-position label shown to players, e.g. "3-2". */
export function levelCode(levelId: number): string {
  const c = chapterOf(levelId);
  return `${c.id}-${c.levels.indexOf(levelId) + 1}`;
}

export function crossed(best: BestMap, levelId: number): boolean {
  return (best[levelId]?.stars ?? 0) > 0;
}

export function chapterComplete(chapter: ChapterDef, best: BestMap): boolean {
  return chapter.levels.every((id) => crossed(best, id));
}

/** The first chapter is always open; each later one opens once the one before is finished. */
export function chapterUnlocked(chapter: ChapterDef, best: BestMap): boolean {
  const i = CHAPTERS.indexOf(chapter);
  return i <= 0 || chapterComplete(CHAPTERS[i - 1], best);
}

/** Inside an open chapter, levels open one after another. */
export function levelUnlocked(levelId: number, best: BestMap): boolean {
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
