import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { Design } from '../../src/design';
import type { LevelDef } from '../../src/levels';
import { testSeconds } from '../../src/physics/world';
import { DiskCache } from './diskcache';
import { canonical, failed, levelKey, type Runner } from './runner';
import type { Outcome } from './simulate';
import type { Task } from './worker';

const WORKER = fileURLToPath(new URL('./worker.ts', import.meta.url));
/** Workers load TypeScript and src/levels.res the same way the tuner does. */
const EXEC_ARGV = ['--import', 'tsx', '--import', new URL('./res-register.mjs', import.meta.url).href];

/** Settles a design's run. `keep` is false for a run that was skipped, which mustn't be cached; `done` is true only for one a worker finished, which may be kept on disk. */
type Settle = (o: Outcome, keep?: boolean, done?: boolean) => void;

interface Slot {
  worker: Worker;
  busy: { task: Task; resolve: Settle; timer: NodeJS.Timeout } | null;
}

/**
 * Test drives designs on worker threads. A worker that crashes or hangs is replaced and its
 * design counts as a failure, so one bad run never stops a long optimization.
 */
export class Pool implements Runner {
  private slots: Slot[] = [];
  private queue: { task: Task; resolve: Settle }[] = [];
  private nextId = 1;
  private cache = new Map<string, Outcome>();
  runs = 0;
  hits = 0;
  /** Of the hits, those found in the cache kept on disk from earlier runs. */
  saved = 0;
  crashes = 0;
  private closing = false;
  /** Called after every design, simulated or cached; drives the progress display. */
  onResult?: () => void;
  /** Runs that would start after this time (Date.now() milliseconds) are skipped as failures. */
  until = Infinity;

  constructor(
    size = Math.max(1, availableParallelism() - 1),
    private timeoutMs = 120_000,
    /** Outcomes kept between runs; null to drive every design afresh. */
    private disk: DiskCache | null = process.env.TUNE_FRESH_CACHE ? null : new DiskCache(),
  ) {
    for (let i = 0; i < size; i++) this.slots.push(this.spawn());
  }

  get size(): number {
    return this.slots.length;
  }

  private spawn(): Slot {
    const slot: Slot = { worker: new Worker(WORKER, { execArgv: EXEC_ARGV }), busy: null };
    slot.worker.on('message', (m: { id: number; outcome?: Outcome; error?: string }) => {
      const job = slot.busy;
      if (!job || job.task.id !== m.id) return;
      clearTimeout(job.timer);
      slot.busy = null;
      job.resolve(m.outcome ?? failed(`error: ${m.error?.split('\n')[0]}`), true, !!m.outcome);
      this.pump();
    });
    const replace = (why: string) => {
      if (this.closing) return;
      const job = slot.busy;
      slot.busy = null;
      if (job) {
        clearTimeout(job.timer);
        this.crashes++;
        job.resolve(failed(why));
      }
      const i = this.slots.indexOf(slot);
      if (i >= 0) {
        this.slots[i] = this.spawn();
        this.pump();
      }
    };
    slot.worker.on('error', (e: Error) => replace(`worker crashed: ${e.message}`));
    slot.worker.on('exit', (code) => {
      if (code !== 0) replace(`worker exited with ${code}`);
    });
    return slot;
  }

  private pump(): void {
    for (const slot of this.slots) {
      if (slot.busy || !this.queue.length) continue;
      if (Date.now() >= this.until) {
        for (const late of this.queue.splice(0)) late.resolve(failed('out of time'), false);
        return;
      }
      const job = this.queue.shift()!;
      const timer = setTimeout(() => {
        // A hung run: drop the worker, count the design as a failure.
        const i = this.slots.indexOf(slot);
        if (slot.busy?.task.id === job.task.id) {
          slot.busy = null;
          this.crashes++;
          job.resolve(failed('timed out'));
          void slot.worker.terminate();
          if (i >= 0) this.slots[i] = this.spawn();
          this.pump();
        }
      }, this.timeoutMs);
      slot.busy = { ...job, timer };
      slot.worker.postMessage(job.task);
    }
  }

  /** Test drives one design; equal designs on equal levels are only ever simulated once. */
  run(level: LevelDef, d: Design, seconds = testSeconds(level)): Promise<Outcome> {
    const key = `${levelKey(level)}|${seconds}|${canonical(d)}`;
    const digest = this.disk ? DiskCache.digest(key) : '';
    const local = { cost: d.cost(), parts: d.parts() };
    let hit = this.cache.get(key);
    if (!hit && this.disk) {
      hit = this.disk.get(digest);
      if (hit) {
        this.saved++;
        this.cache.set(key, hit);
      }
    }
    if (hit) {
      this.hits++;
      this.onResult?.();
      return Promise.resolve({ ...hit, ...local });
    }
    this.runs++;
    return new Promise((resolve) => {
      const task: Task = { id: this.nextId++, level, design: d.serialize(), seconds };
      this.queue.push({
        task,
        resolve: (o, keep = true, done = false) => {
          if (keep) this.cache.set(key, o);
          if (done) this.disk?.set(digest, o);
          this.onResult?.();
          resolve({ ...o, ...local });
        },
      });
      this.pump();
    });
  }

  /** Forgets cached outcomes, to keep memory bounded between levels. */
  clearCache(): void {
    this.cache.clear();
  }

  async close(): Promise<void> {
    this.closing = true;
    await Promise.all(this.slots.map((s) => s.worker.terminate()));
    this.slots = [];
  }
}
