/**
 * Play Games achievements and leaderboards. Most achievements follow from a profile's progress,
 * so they come back on a new phone once the cloud save arrives; a few are earned by moments in
 * play. Keys are the names in games-ids.xml without their `achievement_` or `leaderboard_` prefix.
 */
import { CHAPTERS, chapterComplete, totals, type BestMap, type ChapterDef } from './chapters';
import { LEVELS } from './levels';

export interface AchievementDef {
  key: string;
  /** The name to give it in the Play Console, which makes the key from it. */
  name: string;
  how: string;
}

/** Achievements earned by a moment in play rather than by progress. */
export type PlayMoment = 'collapse' | 'challenge' | 'flawless' | 'playtest';

const MOMENTS: Record<PlayMoment, AchievementDef> = {
  collapse: { key: 'back_to_the_drawing_board', name: 'Back to the Drawing Board', how: 'Watch one of your bridges collapse.' },
  challenge: { key: 'against_the_odds', name: 'Against the Odds', how: 'Finish a chapter challenge.' },
  flawless: { key: 'flawless', name: 'Flawless', how: 'Finish a chapter challenge without losing a life.' },
  playtest: { key: 'architect', name: 'Architect', how: 'Cross a level you made in the level editor.' },
};

/** Chapter names as keys: "Modern Works" is `modern_works`, as the Play Console spells it. */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

const chapterKey = (c: ChapterDef) => `chapter_${slug(c.name)}`;

/** Every achievement, for the Play Console setup and the tests. */
export const ACHIEVEMENTS: AchievementDef[] = [
  { key: 'first_crossing', name: 'First Crossing', how: 'Cross any level.' },
  { key: 'three_stars', name: 'Three Stars', how: 'Earn all three stars on a level.' },
  { key: 'above_and_beyond', name: 'Above and Beyond', how: 'Meet a bonus goal.' },
  ...CHAPTERS.map((c) => ({ key: chapterKey(c), name: `Chapter ${c.name}`, how: `Cross every level in ${c.name}.` })),
  { key: 'chief_engineer', name: 'Chief Engineer', how: 'Cross every level.' },
  { key: 'perfectionist', name: 'Perfectionist', how: 'Earn three stars on every level.' },
  { key: 'overachiever', name: 'Overachiever', how: 'Meet every bonus goal.' },
  ...Object.values(MOMENTS),
];

/** The achievement a moment in play earns. */
export function momentAchievement(m: PlayMoment): string {
  return MOMENTS[m].key;
}

/** The achievements a profile's progress has earned. */
export function earnedBy(best: BestMap): string[] {
  const all = Object.values(best);
  const t = totals(best);
  const out: string[] = [];
  if (t.crossed > 0) out.push('first_crossing');
  if (all.some((b) => b?.stars === 3)) out.push('three_stars');
  if (t.bonus > 0) out.push('above_and_beyond');
  for (const c of CHAPTERS) if (chapterComplete(c, best)) out.push(chapterKey(c));
  if (t.crossed === LEVELS.length) out.push('chief_engineer');
  if (t.stars === LEVELS.length * 3) out.push('perfectionist');
  if (t.bonus === LEVELS.length) out.push('overachiever');
  return out;
}

export interface LeaderboardDef {
  key: string;
  name: string;
  what: string;
}

/** Every leaderboard: the career score, total stars, and one for each chapter's challenge. */
export const LEADERBOARDS: LeaderboardDef[] = [
  { key: 'career', name: 'Career', what: 'The sum of your best score on every level.' },
  { key: 'stars', name: 'Stars', what: 'Stars earned over every level, bonus stars not counted.' },
  ...CHAPTERS.map((c) => ({ key: challengeBoardKey(c), name: `Challenge ${c.name}`, what: `${c.name} in a row, from scratch, with three lives.` })),
];

export function challengeBoardKey(c: ChapterDef): string {
  return `challenge_${slug(c.name)}`;
}

/** What the progress-based leaderboards stand at for a profile. */
export function progressScores(best: BestMap): { key: string; score: number }[] {
  const t = totals(best);
  return [
    { key: 'career', score: t.score },
    { key: 'stars', score: t.stars },
  ];
}
