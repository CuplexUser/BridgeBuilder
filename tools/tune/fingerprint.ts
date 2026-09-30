import { BASE_LEVELS } from '../../src/levels';
import { MATERIALS } from '../../src/physics/materials';
import { VEHICLES } from '../../src/physics/vehicles';
import { PHYSICS_VERSION } from '../../src/physics/world';
import { INTENTS } from './intents';

/** Bump when the tuner's rules change (how targets, budgets or bonus goals are derived). */
export const TUNER_VERSION = 2;

/** FNV-1a, 32 bits, as hex: short, stable and dependency-free. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Everything a level's tuning depends on: its authored geometry and vehicle, its intent,
 * the materials and vehicles, and the physics and tuner versions. Names, tips and hints
 * don't count, so rewording a level doesn't call for a new tuning run.
 */
export function levelFingerprint(id: number): string {
  const base = BASE_LEVELS.find((l) => l.id === id);
  if (!base) throw new Error(`No level ${id}`);
  const { name: _name, tip: _tip, hint: _hint, ...geometry } = base;
  const intent = INTENTS[id] ?? {};
  const intentText = JSON.stringify(intent, (_k, v: unknown) => (typeof v === 'function' ? v.toString() : v));
  return hash(JSON.stringify({ geometry, intentText, MATERIALS, VEHICLES, PHYSICS_VERSION, TUNER_VERSION }));
}
