import { simulate } from '../tools/tune/simulate';
import type { LevelDef } from './levels';

/** The quick tune's test drives, one per message, off the main thread. */
self.addEventListener('message', (e: MessageEvent<{ id: number; level: LevelDef; design: string; seconds: number }>) => {
  const { id, level, design, seconds } = e.data;
  try {
    self.postMessage({ id, outcome: simulate(level, design, seconds) });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
});
