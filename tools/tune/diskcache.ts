import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bankY, goalX, mudAt, seatPiers, START_X } from '../../src/levels';
import type { Outcome } from './simulate';

const DIR = fileURLToPath(new URL('./cache', import.meta.url));
const ROOT = new URL('../../', import.meta.url);
/** The simulator's own source: an edit to any of it can change an outcome. */
const SOURCES = ['src/physics/world.ts', 'src/physics/testrun.ts', 'src/physics/build.ts', 'src/physics/hazards.ts', 'src/physics/materials.ts', 'src/physics/stresslog.ts', 'src/physics/vehicles.ts', 'src/design.ts', 'src/rules.ts', 'src/masonry.ts', 'src/maincable.ts', 'tools/tune/simulate.ts'];

/** Identifies the simulator as it stands, by its source. */
function simulatorId(): string {
  const h = createHash('sha256');
  for (const f of SOURCES) h.update(readFileSync(new URL(f, ROOT)));
  // The few level helpers it calls, by their code: the level data itself is in every key.
  for (const fn of [bankY, goalX, mudAt, seatPiers]) h.update(fn.toString());
  h.update(String(START_X));
  return h.digest('hex').slice(0, 16);
}

/**
 * Test drive outcomes kept on disk between runs, so a level tuned or verified again replays its
 * seeded search from here instead of driving every design again. An edit to the simulator
 * starts a fresh cache, and the stale one is deleted.
 */
export class DiskCache {
  private readonly file: string;
  private readonly map = new Map<string, Outcome>();

  constructor() {
    const id = simulatorId();
    mkdirSync(DIR, { recursive: true });
    for (const f of readdirSync(DIR)) if (f !== `${id}.jsonl`) rmSync(join(DIR, f), { force: true });
    this.file = join(DIR, `${id}.jsonl`);
    if (!existsSync(this.file)) return;
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const [k, o] = JSON.parse(line) as [string, Outcome];
        this.map.set(k, o);
      } catch {
        // A line cut short when a run was stopped: that design is simply driven again.
      }
    }
  }

  get size(): number {
    return this.map.size;
  }

  /** A short digest of a cache key, which can run to kilobytes for a big design. */
  static digest(key: string): string {
    return createHash('sha256').update(key).digest('base64url').slice(0, 24);
  }

  get(digest: string): Outcome | undefined {
    return this.map.get(digest);
  }

  set(digest: string, o: Outcome): void {
    if (this.map.has(digest)) return;
    this.map.set(digest, o);
    appendFileSync(this.file, `${JSON.stringify([digest, o])}\n`);
  }
}
