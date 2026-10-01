// src/levels.res is gzip-packed JSON; the Vite plugin in vite.config.ts and the tuner's Node
// loader hook (tools/tune/res-register.mjs) both turn it into a module with these exports.
import type { Difficulty } from '../tools/tune/difficulty';
import type { LevelResult } from '../tools/tune/types';
import type { Tuned } from './levels';

export const difficulty: Difficulty;
export const levels: Record<string, Tuned & { fingerprint?: string }>;
/** Each tuned level's proof designs, serialized. */
export const designs: Record<string, { reference: string; bonus: string | null }>;
export const results: Record<string, LevelResult>;
