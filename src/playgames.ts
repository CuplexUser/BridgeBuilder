import { challengeBoardKey, earnedBy, momentAchievement, progressScores, type PlayMoment } from './achievements';
import type { BestMap, ChapterDef } from './chapters';
import { games, type GamesStatus } from './platform';
import { safeLocalStorage, type LocalStore } from './storage';

/**
 * What Play Games has taken, per player, so nothing is sent twice. Up to 1.0.10 a send was
 * counted before Play Games answered, so that record (`bridgebuilder.playgames`) may hold
 * achievements that never arrived; this one starts over and sends them again.
 */
const SENT_KEY = 'bridgebuilder.playgames.2';
/** A burst of saves goes up to the cloud as one write, this long after the last, ms. */
const CLOUD_DELAY = 20_000;

interface Sent {
  achievements: string[];
  /** The last score sent to each leaderboard; Play keeps the best, so only a higher one goes. */
  scores: Record<string, number>;
}

/**
 * The game's side of Google Play Games: it signs in, sends achievements and leaderboard scores as
 * they are earned, and keeps the device's profiles and progress in the Play Games cloud save, so
 * a new phone picks up where the old one left off. Where Play Games isn't available, it does nothing.
 */
export class PlayGamesLink {
  status: GamesStatus = { available: false, signedIn: false };
  private cloudTimer: ReturnType<typeof setTimeout> | undefined;
  /** Unlocks and scores on their way, so a save while they're out doesn't send them again. */
  private inFlight = new Set<string>();

  constructor(private store: LocalStore | null) {}

  get signedIn(): boolean {
    return this.status.signedIn;
  }

  /** Play Games signs players in as the app starts; this picks that up and pulls the cloud save. Resolves true if the save changed anything here. */
  async start(): Promise<boolean> {
    this.status = await games.status();
    return this.status.signedIn ? this.pull() : false;
  }

  /** Signs in from the leaderboards screen, for players who turned automatic sign-in down. */
  async signIn(): Promise<boolean> {
    this.status = await games.signIn();
    return this.status.signedIn ? this.pull() : false;
  }

  private async pull(): Promise<boolean> {
    if (!this.store) return false;
    try {
      const data = await games.loadSave();
      const changed = data ? this.store.mergeSnapshot(data) : false;
      // The merged save goes back up, so the cloud has this device's progress too.
      this.saveNow();
      return changed;
    } catch {
      return false;
    }
  }

  /** Sends the achievements and scores a profile's progress has earned. */
  progress(best: BestMap): void {
    if (!this.signedIn) return;
    const sent = this.sent();
    for (const key of earnedBy(best)) this.unlock(sent, key);
    for (const { key, score } of progressScores(best)) this.submit(sent, key, score);
  }

  /** An achievement earned by a moment in play. */
  moment(m: PlayMoment): void {
    if (!this.signedIn) return;
    this.unlock(this.sent(), momentAchievement(m));
  }

  /** A finished chapter challenge, for that chapter's leaderboard. */
  challenge(c: ChapterDef, score: number): void {
    if (!this.signedIn) return;
    this.submit(this.sent(), challengeBoardKey(c), score);
  }

  /** Counts an achievement as sent only once Play Games has it; a failed one goes again with the next save. */
  private unlock(sent: Sent, key: string): void {
    const flight = `a:${key}`;
    if (sent.achievements.includes(key) || this.inFlight.has(flight)) return;
    this.inFlight.add(flight);
    games
      .unlock(key)
      .then(() => this.record((s) => void (s.achievements.includes(key) || s.achievements.push(key))))
      .catch((e: unknown) => console.log('Play Games:', e))
      .finally(() => this.inFlight.delete(flight));
  }

  private submit(sent: Sent, key: string, score: number): void {
    const flight = `s:${key}:${score}`;
    if (score <= 0 || score <= (sent.scores[key] ?? 0) || this.inFlight.has(flight)) return;
    this.inFlight.add(flight);
    games
      .submitScore(key, score)
      .then(() => this.record((s) => void (s.scores[key] = Math.max(s.scores[key] ?? 0, score))))
      .catch((e: unknown) => console.log('Play Games:', e))
      .finally(() => this.inFlight.delete(flight));
  }

  /** Rereads the record before changing it, since other sends may have landed in the meantime. */
  private record(change: (sent: Sent) => void): void {
    const sent = this.sent();
    change(sent);
    this.keep(sent);
  }

  /** The device's saves changed: send them to the cloud once things settle. */
  saveSoon(): void {
    if (!this.signedIn || !this.store) return;
    clearTimeout(this.cloudTimer);
    this.cloudTimer = setTimeout(() => this.saveNow(), CLOUD_DELAY);
  }

  /** Sends a cloud write that is still waiting, as the app goes to the background. */
  flush(): void {
    if (this.cloudTimer !== undefined) this.saveNow();
  }

  private saveNow(): void {
    clearTimeout(this.cloudTimer);
    this.cloudTimer = undefined;
    if (!this.signedIn || !this.store) return;
    games.writeSave(this.store.snapshot(), 'Bridge Builder engineers and progress').catch(() => undefined);
  }

  private sent(): Sent {
    try {
      const all = JSON.parse(safeLocalStorage()?.getItem(SENT_KEY) ?? '{}') as Record<string, Sent>;
      const mine = all[this.status.player ?? ''];
      if (mine) return { achievements: mine.achievements ?? [], scores: mine.scores ?? {} };
    } catch {
      // Start over: sending again is harmless.
    }
    return { achievements: [], scores: {} };
  }

  private keep(sent: Sent): void {
    try {
      const kv = safeLocalStorage();
      const all = JSON.parse(kv?.getItem(SENT_KEY) ?? '{}') as Record<string, Sent>;
      all[this.status.player ?? ''] = sent;
      kv?.setItem(SENT_KEY, JSON.stringify(all));
    } catch {
      // Non-essential.
    }
  }
}
