/**
 * Persistence. Two interchangeable backends:
 *  - ServerStore: REST API backed by SQLite (npm run dev / npm start).
 *  - LocalStore: browser localStorage, for static hosting such as GitHub Pages.
 * The game picks the server when `api/health` answers, and falls back to local otherwise.
 */

/** A finished chapter challenge: a chapter played in a row, with lives. */
export interface HighScore {
  name: string;
  score: number;
  /** Levels cleared in the run. */
  levels: number;
  /** Chapter the run was played on; 0 for runs from the old full-campaign mode. */
  chapter: number;
  date: string;
}

/** One profile's best result on one level. */
export interface LevelRecord {
  level: number;
  name: string;
  score: number;
  stars: number;
  /** What the best-scoring bridge cost and its peak stress (0–1), for records set since they were kept. */
  cost?: number;
  peak?: number;
  /** The best-scoring bridge was kept and can be fetched with Store.recordDesign. */
  hasDesign?: boolean;
}

/** One level's best result in a profile's progress. */
export interface BestEntry {
  score: number;
  stars: number;
  /** The level's bonus goal was met at least once. */
  bonus?: boolean;
  /** The best-scoring run: what its bridge cost, its peak stress (0–1) and the design itself. */
  cost?: number;
  peak?: number;
  design?: string;
}

export interface Profile {
  id: string;
  name: string;
  unlocked: number;
  stars: number;
  /** Career score: the sum of the profile's best score on every level. */
  score: number;
}

export interface Progress {
  /** Best result per level; `bonus` is set once the level's bonus goal has been met. */
  best: Record<number, BestEntry>;
  unlocked: number;
  designs: Record<number, string>;
  /** The engineer's hints shown on each level: which members of its best known design. */
  hints?: Record<number, number[]>;
}

export interface Store {
  readonly kind: 'server' | 'local';
  listProfiles(): Promise<Profile[]>;
  /** Creates a profile, or returns the existing one with the same name (case-insensitive). */
  openProfile(name: string): Promise<Profile>;
  loadProgress(profileId: string): Promise<Progress>;
  saveProgress(profileId: string, p: Progress): Promise<void>;
  /** Top challenge runs on one chapter. */
  highScores(chapter: number): Promise<HighScore[]>;
  /** Every profile's best on every level it has crossed: the source for career, chapter and level boards. */
  levelScores(): Promise<LevelRecord[]>;
  /** The bridge behind a profile's best score on a level, by profile name, or null if it wasn't kept. */
  recordDesign(level: number, name: string): Promise<string | null>;
  /** Records a finished chapter challenge. Returns its rank (0-based) on that chapter's board, or -1. */
  submitScore(profileId: string, score: number, levels: number, chapter: number): Promise<number>;
}

export const MAX_HIGHS = 10;
export const MAX_NAME = 16;

export function blankProgress(): Progress {
  return { best: {}, unlocked: 1, designs: {} };
}

export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

export function totalStars(p: Progress): number {
  return Object.values(p.best).reduce((s, b) => s + b.stars, 0);
}

export function totalScore(p: Progress): number {
  return Object.values(p.best).reduce((s, b) => s + b.score, 0);
}

export interface BoardRow {
  name: string;
  score: number;
  stars: number;
  /** Levels crossed among those counted. */
  levels: number;
}

/** Ranks profiles by their summed best scores over the given levels (all levels when omitted). */
export function rankProfiles(rows: LevelRecord[], levelIds?: number[]): BoardRow[] {
  const by = new Map<string, BoardRow>();
  for (const r of rows) {
    if (levelIds && !levelIds.includes(r.level)) continue;
    const row = by.get(r.name) ?? { name: r.name, score: 0, stars: 0, levels: 0 };
    row.score += r.score;
    row.stars += r.stars;
    row.levels += r.stars > 0 ? 1 : 0;
    by.set(r.name, row);
  }
  const out = [...by.values()].filter((r) => r.score > 0);
  out.sort((a, b) => b.score - a.score || b.stars - a.stars || a.name.localeCompare(b.name));
  return out;
}

/** Keeps the best entry per level (higher score, then more stars; first seen wins ties). */
export function bestPerLevel(entries: LevelRecord[]): LevelRecord[] {
  const best = new Map<number, LevelRecord>();
  for (const e of entries) {
    const cur = best.get(e.level);
    if (e.score <= 0) continue;
    if (!cur || e.score > cur.score || (e.score === cur.score && e.stars > cur.stars)) best.set(e.level, e);
  }
  const out = [...best.values()];
  out.sort((a, b) => a.level - b.level);
  return out;
}

/** A profile's best on one level as the boards show it, with the record run's details where they were kept. */
function recordOf(level: number, name: string, b: BestEntry): LevelRecord {
  const r: LevelRecord = { level, name, score: b.score, stars: b.stars };
  if (b.cost !== undefined) r.cost = b.cost;
  if (b.peak !== undefined) r.peak = b.peak;
  if (b.design) r.hasDesign = true;
  return r;
}

/** Inserts a score, keeps the table sorted and trimmed, returns its rank (0-based) or -1. */
export function insertHigh(highs: HighScore[], entry: HighScore): number {
  highs.push(entry);
  highs.sort((a, b) => b.score - a.score);
  const rank = highs.indexOf(entry);
  highs.length = Math.min(highs.length, MAX_HIGHS);
  return rank < MAX_HIGHS ? rank : -1;
}

// ───────────────────────────── Local (browser) ─────────────────────────────

export interface LocalData {
  profiles: { id: string; name: string; created: string }[];
  progress: Record<string, Progress>;
  highs: HighScore[];
}

export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const LOCAL_KEY = 'bridgebuilder.v2';
const LEGACY_KEY = 'bridgebuilder.v1';

export class LocalStore implements Store {
  readonly kind = 'local';

  constructor(private kv: KeyValue | null = safeLocalStorage()) {}

  private read(): LocalData {
    try {
      const raw = this.kv?.getItem(LOCAL_KEY);
      if (raw) return { profiles: [], progress: {}, highs: [], ...(JSON.parse(raw) as Partial<LocalData>) };
    } catch {
      // Unreadable storage: start over rather than crash.
    }
    return { profiles: [], progress: {}, highs: [] };
  }

  private write(d: LocalData): void {
    try {
      this.kv?.setItem(LOCAL_KEY, JSON.stringify(d));
    } catch {
      // Private mode or full storage: the game still runs, it just forgets.
    }
  }

  async listProfiles(): Promise<Profile[]> {
    const d = this.read();
    return d.profiles.map((p) => {
      const prog = d.progress[p.id] ?? blankProgress();
      return { id: p.id, name: p.name, unlocked: prog.unlocked, stars: totalStars(prog), score: totalScore(prog) };
    });
  }

  async openProfile(name: string): Promise<Profile> {
    const clean = cleanName(name);
    if (!clean) throw new Error('Enter a name');
    const d = this.read();
    let p = d.profiles.find((x) => x.name.toLowerCase() === clean.toLowerCase());
    if (!p) {
      p = { id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: clean, created: new Date().toISOString() };
      d.profiles.push(p);
      // The very first profile inherits progress from the pre-profile version of the game.
      d.progress[p.id] = d.profiles.length === 1 ? this.legacyProgress() : blankProgress();
      this.write(d);
    }
    const prog = d.progress[p.id] ?? blankProgress();
    return { id: p.id, name: p.name, unlocked: prog.unlocked, stars: totalStars(prog), score: totalScore(prog) };
  }

  private legacyProgress(): Progress {
    try {
      const raw = this.kv?.getItem(LEGACY_KEY);
      if (raw) {
        const o = JSON.parse(raw) as Partial<Progress>;
        return { best: o.best ?? {}, unlocked: o.unlocked ?? 1, designs: o.designs ?? {} };
      }
    } catch {
      // Ignore a broken legacy save.
    }
    return blankProgress();
  }

  async loadProgress(profileId: string): Promise<Progress> {
    return { ...blankProgress(), ...this.read().progress[profileId] };
  }

  async saveProgress(profileId: string, p: Progress): Promise<void> {
    const d = this.read();
    d.progress[profileId] = p;
    this.write(d);
  }

  async highScores(chapter: number): Promise<HighScore[]> {
    return this.read().highs.filter((h) => (h.chapter ?? 0) === chapter);
  }

  async levelScores(): Promise<LevelRecord[]> {
    const d = this.read();
    const all: LevelRecord[] = [];
    for (const p of d.profiles) {
      for (const [level, b] of Object.entries(d.progress[p.id]?.best ?? {})) all.push(recordOf(Number(level), p.name, b));
    }
    return all;
  }

  async recordDesign(level: number, name: string): Promise<string | null> {
    const d = this.read();
    const p = d.profiles.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return (p && d.progress[p.id]?.best[level]?.design) ?? null;
  }

  /** Everything this store keeps, for a cloud save. */
  snapshot(): string {
    return JSON.stringify(this.read());
  }

  /** Merges a cloud save into this store. Returns true if anything here changed. */
  mergeSnapshot(json: string): boolean {
    let other: Partial<LocalData>;
    try {
      other = JSON.parse(json) as Partial<LocalData>;
    } catch {
      return false;
    }
    const before = this.read();
    const merged = mergeLocalData(before, { profiles: other.profiles ?? [], progress: other.progress ?? {}, highs: other.highs ?? [] });
    if (JSON.stringify(merged) === JSON.stringify(before)) return false;
    this.write(merged);
    return true;
  }

  async submitScore(profileId: string, score: number, levels: number, chapter: number): Promise<number> {
    const d = this.read();
    const p = d.profiles.find((x) => x.id === profileId);
    if (!p || score <= 0) return -1;
    // Each chapter keeps its own top table.
    const board = d.highs.filter((h) => (h.chapter ?? 0) === chapter);
    const rank = insertHigh(board, { name: p.name, score, levels, chapter, date: new Date().toISOString().slice(0, 10) });
    d.highs = [...d.highs.filter((h) => (h.chapter ?? 0) !== chapter), ...board];
    this.write(d);
    return rank;
  }
}

/**
 * Merges two devices' saves, such as this phone's and the Play Games cloud save, losing nothing:
 * profiles are matched by name, each level keeps its better result, designs and hints already
 * here stay, and the challenge boards keep the best runs from both. Profiles keep this device's ids.
 */
export function mergeLocalData(here: LocalData, there: LocalData): LocalData {
  const out: LocalData = { profiles: [...here.profiles], progress: { ...here.progress }, highs: [...here.highs] };
  for (const p of there.profiles) {
    const mine = out.profiles.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
    const theirs = there.progress[p.id];
    if (!mine) {
      out.profiles.push(p);
      if (theirs) out.progress[p.id] = theirs;
      continue;
    }
    if (theirs) out.progress[mine.id] = mergeProgress(out.progress[mine.id] ?? blankProgress(), theirs);
  }
  const key = (h: HighScore) => `${h.chapter ?? 0}|${h.name.toLowerCase()}|${h.score}|${h.levels}|${h.date}`;
  const seen = new Set(out.highs.map(key));
  for (const h of there.highs) if (!seen.has(key(h))) out.highs.push(h);
  // Each chapter's board keeps its own top runs.
  const byChapter = new Map<number, HighScore[]>();
  for (const h of out.highs) byChapter.set(h.chapter ?? 0, [...(byChapter.get(h.chapter ?? 0) ?? []), h]);
  out.highs = [...byChapter.values()].flatMap((board) => board.toSorted((a, b) => b.score - a.score).slice(0, MAX_HIGHS));
  return out;
}

function mergeProgress(here: Progress, there: Progress): Progress {
  const best: Record<number, BestEntry> = { ...here.best };
  for (const [id, b] of Object.entries(there.best ?? {})) {
    const a = best[Number(id)];
    if (!a) {
      best[Number(id)] = b;
      continue;
    }
    // The better run's details go with its score; stars and the bonus are kept from either.
    const top = b.score > a.score ? b : a;
    best[Number(id)] = { ...top, stars: Math.max(a.stars, b.stars), ...(a.bonus || b.bonus ? { bonus: true } : {}) };
  }
  // Hints taken on either device count against the level's scores.
  const hints: Record<number, number[]> = { ...here.hints };
  for (const [id, list] of Object.entries(there.hints ?? {})) if (list.length > (hints[Number(id)]?.length ?? 0)) hints[Number(id)] = list;
  return {
    best,
    unlocked: Math.max(here.unlocked ?? 1, there.unlocked ?? 1),
    designs: { ...there.designs, ...here.designs },
    ...(Object.keys(hints).length ? { hints } : {}),
  };
}

let deviceKv: KeyValue | null = null;

/** Replaces localStorage as the device's key-value storage, such as native preferences in the Android app. */
export function useDeviceStorage(kv: KeyValue): void {
  deviceKv = kv;
}

/** The device's key-value storage: localStorage unless a platform supplied its own. */
export function safeLocalStorage(): KeyValue | null {
  if (deviceKv) return deviceKv;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

// ───────────────────────────── Server (SQLite) ─────────────────────────────

export class ServerStore implements Store {
  readonly kind = 'server';

  constructor(private base = 'api') {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}/${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
    return (await res.json()) as T;
  }

  listProfiles(): Promise<Profile[]> {
    return this.req('GET', 'profiles');
  }

  openProfile(name: string): Promise<Profile> {
    return this.req('POST', 'profiles', { name: cleanName(name) });
  }

  loadProgress(id: string): Promise<Progress> {
    return this.req('GET', `profiles/${encodeURIComponent(id)}/progress`);
  }

  async saveProgress(id: string, p: Progress): Promise<void> {
    await this.req('PUT', `profiles/${encodeURIComponent(id)}/progress`, p);
  }

  highScores(chapter: number): Promise<HighScore[]> {
    return this.req('GET', `scores?chapter=${chapter}`);
  }

  levelScores(): Promise<LevelRecord[]> {
    return this.req('GET', 'level-scores');
  }

  async recordDesign(level: number, name: string): Promise<string | null> {
    const r = await this.req<{ design: string | null }>('GET', `level-design?level=${level}&name=${encodeURIComponent(name)}`);
    return r.design;
  }

  async submitScore(profileId: string, score: number, levels: number, chapter: number): Promise<number> {
    const r = await this.req<{ rank: number }>('POST', 'scores', { profileId, score, levels, chapter });
    return r.rank;
  }
}

/** Uses the SQLite server when one answers quickly, otherwise browser storage. */
export async function pickStore(): Promise<Store> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1200);
    const res = await fetch('api/health', { signal: ctl.signal });
    clearTimeout(t);
    if (res.ok && ((await res.json()) as { ok?: boolean }).ok) return new ServerStore();
  } catch {
    // No server (static hosting): fall through.
  }
  return new LocalStore();
}

// ───────────────────────────── Device prefs ─────────────────────────────

const PREFS_KEY = 'bridgebuilder.prefs';

export interface Prefs {
  muted: boolean;
  profileId: string | null;
  /** How the chapters screen was last shown: the map of every level, or the chapter book. */
  chaptersView?: 'map' | 'book';
  /** Haptics on devices that can buzz; on unless turned off. */
  haptics?: boolean;
  /** The language picked in Settings, e.g. "de"; unset follows the device. */
  lang?: string;
  /** Volume per bus, 0 to 1 as the slider sits; unset is full. */
  volume?: Partial<Record<VolumeBus, number>>;
  /** Less movement on screen; unset follows the system's reduced-motion setting. */
  reduceMotion?: boolean;
  /** The colors stress is drawn in: green to red, or a ramp colorblind players can tell apart. */
  stressPalette?: StressPalette;
}

export type VolumeBus = 'master' | 'sfx' | 'music' | 'ambience';
export type StressPalette = 'classic' | 'colorblind';

export function loadPrefs(): Prefs {
  try {
    const raw = safeLocalStorage()?.getItem(PREFS_KEY);
    if (raw) return { muted: false, profileId: null, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    // fall through
  }
  return { muted: false, profileId: null };
}

export function savePrefs(p: Prefs): void {
  try {
    safeLocalStorage()?.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // Non-essential.
  }
}
