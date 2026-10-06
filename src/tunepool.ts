import { canonical, failed, levelKey } from '../tools/tune/runner';
import type { Outcome } from '../tools/tune/simulate';
import type { TimedRunner } from './autotune';
import type { Design } from './design';
import type { LevelDef } from './levels';

interface Job {
  id: number;
  level: LevelDef;
  design: string;
  seconds: number;
  /** `real` is false for a run that was skipped or cut off, which mustn't be cached. */
  done: (o: Outcome, real: boolean) => void;
}

/**
 * Test drives designs on Web Workers for the level editor's quick tune. Runs that would start
 * after `until` are skipped as failures, and closing the pool fails whatever is still going, so
 * a tune always ends on time.
 */
export class TunePool implements TimedRunner {
  until = Infinity;
  private workers: Worker[] = [];
  private busy = new Map<Worker, Job>();
  private queue: Job[] = [];
  private cache = new Map<string, Outcome>();
  private nextId = 1;
  private closed = false;

  constructor(size = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1))) {
    for (let i = 0; i < size; i++) this.workers.push(this.spawn());
  }

  private spawn(): Worker {
    const w = new Worker(new URL('./tuneworker.ts', import.meta.url), { type: 'module' });
    w.addEventListener('message', (e: MessageEvent<{ id: number; outcome?: Outcome; error?: string }>) => {
      const job = this.busy.get(w);
      if (!job || job.id !== e.data.id) return;
      this.busy.delete(w);
      job.done(e.data.outcome ?? failed(`error: ${e.data.error}`), !!e.data.outcome);
      this.pump();
    });
    // A worker that fails is dropped; with none left, everything still waiting fails.
    w.addEventListener('error', (e) => {
      e.preventDefault();
      w.terminate();
      this.workers = this.workers.filter((x) => x !== w);
      this.busy.get(w)?.done(failed('worker crashed'), false);
      this.busy.delete(w);
      if (!this.workers.length) this.close();
      else this.pump();
    });
    return w;
  }

  /** Test drives one design; equal designs on equal levels are only ever simulated once. */
  run(level: LevelDef, d: Design, seconds = 30): Promise<Outcome> {
    const local = { cost: d.cost(), parts: d.parts() };
    if (this.closed) return Promise.resolve({ ...failed('stopped'), ...local });
    const key = `${levelKey(level)}|${seconds}|${canonical(d)}`;
    const hit = this.cache.get(key);
    if (hit) return Promise.resolve({ ...hit, ...local });
    return new Promise((resolve) => {
      this.queue.push({
        id: this.nextId++,
        level,
        design: d.serialize(),
        seconds,
        done: (o, real) => {
          if (real) this.cache.set(key, o);
          resolve({ ...o, ...local });
        },
      });
      this.pump();
    });
  }

  private pump(): void {
    for (const w of this.workers) {
      if (this.busy.has(w)) continue;
      let job = this.queue.shift();
      while (job && Date.now() >= this.until) {
        job.done(failed('out of time'), false);
        job = this.queue.shift();
      }
      if (!job) return;
      this.busy.set(w, job);
      w.postMessage({ id: job.id, level: job.level, design: job.design, seconds: job.seconds });
    }
  }

  /** Stops every worker. Runs still waiting or going count as failures. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const w of this.workers) w.terminate();
    for (const job of [...this.busy.values(), ...this.queue]) job.done(failed('stopped'), false);
    this.workers = [];
    this.busy.clear();
    this.queue = [];
  }
}
