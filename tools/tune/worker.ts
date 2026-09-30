import { parentPort } from 'node:worker_threads';
import type { LevelDef } from '../../src/levels';
import { simulate } from './simulate';

export interface Task {
  id: number;
  level: LevelDef;
  design: string;
  seconds: number;
}

parentPort!.on('message', (t: Task) => {
  try {
    parentPort!.postMessage({ id: t.id, outcome: simulate(t.level, t.design, t.seconds) });
  } catch (e) {
    parentPort!.postMessage({ id: t.id, error: String((e as Error)?.stack ?? e) });
  }
});
