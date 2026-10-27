import { CHAPTERS, FREE_CHAPTERS, totals, type BestMap, type ChapterDef } from './chapters';
import { safeLocalStorage } from './storage';

/**
 * Asking for a rating on Google Play. Google's rules forbid asking players what they think first,
 * so the ask goes only where they're likely to be happy with the game: the card for a chapter just
 * finished, from the last free chapter on, with most of its stars won. It's kept for the device,
 * not the profile, since a rating belongs to the phone's Google account.
 */
const RATE_KEY = 'bridgebuilder.rate';

/** How many chapter cards may ask before the game stops asking. */
export const MAX_ASKS = 3;
/** The first chapter, in play order, whose card may ask: the last free one, about 20 levels in. */
export const RATE_FROM = FREE_CHAPTERS - 1;
/** Stars per level the chapter must average, out of three. */
const MIN_STARS = 2;

export interface RateState {
  /** Chapter cards that have asked. */
  asked: number;
  /** The player went to Google Play from one. */
  rated?: boolean;
}

export function loadRate(): RateState {
  try {
    const raw = safeLocalStorage()?.getItem(RATE_KEY);
    if (raw) return { asked: 0, ...(JSON.parse(raw) as Partial<RateState>) };
  } catch {
    // fall through
  }
  return { asked: 0 };
}

export function saveRate(s: RateState): void {
  try {
    safeLocalStorage()?.setItem(RATE_KEY, JSON.stringify(s));
  } catch {
    // Non-essential.
  }
}

/** Whether the card for a chapter just finished asks for a rating. */
export function shouldAsk(ch: ChapterDef, best: BestMap, s: RateState): boolean {
  return !s.rated && s.asked < MAX_ASKS && CHAPTERS.indexOf(ch) >= RATE_FROM && totals(best, ch.levels).stars >= MIN_STARS * ch.levels.length;
}
