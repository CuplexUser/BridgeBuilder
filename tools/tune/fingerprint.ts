import type { Design } from '../../src/design';
import { BASE_LEVELS, type LevelBase, type LevelDef } from '../../src/levels';
import { MATERIALS } from '../../src/physics/materials';
import { VEHICLES } from '../../src/physics/vehicles';
import { PHYSICS_VERSION } from '../../src/physics/world';
import { INTENTS, paramCombos, type Intent } from './intents';

/** Bump when the tuner's rules change (how targets, budgets or bonus goals are derived). */
export const TUNER_VERSION = 4;

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
  const { name: _name, tip: _tip, hint: _hint, hintSolves: _solves, ...geometry } = base;
  const intent = intentData(base, INTENTS[id] ?? {});
  return hash(JSON.stringify({ geometry, intent, MATERIALS, VEHICLES, PHYSICS_VERSION, TUNER_VERSION }));
}

/**
 * An intent as plain data. Its functions count by what they produce on every geometry the
 * tuner may try, not by their source text, which depends on how the code was compiled.
 */
function intentData(base: LevelBase, intent: Intent): unknown {
  const { deck, shape, shortcuts, ...rest } = intent;
  const shapes = paramCombos(intent).map((p) => shape?.(p) ?? {});
  const levels = shapes.map((g): LevelDef => ({ ...base, ...g, money: 0, target: 0, bonus: { kind: 'cost', max: 0 } }));
  return {
    ...rest,
    shapes,
    deck: deck ? levels.map((l) => deck(l)) : null,
    shortcuts: (shortcuts ?? []).map((sc) => ({ name: sc.name, designs: levels.map((l) => tryBuild(sc.build, l)) })),
  };
}

/** A shortcut's design on one geometry, or null where it can't be built. */
function tryBuild(build: (l: LevelDef) => Design, l: LevelDef): string | null {
  try {
    return build(l).serialize();
  } catch {
    return null;
  }
}
