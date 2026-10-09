import { describe, expect, it } from 'vitest';
import { Design } from '../src/design';
import { LEVELS, TUNED, type LevelDef } from '../src/levels';
import { TestRun } from '../src/physics/world';
import { designProblems } from '../src/rules';
import { bonusLabel, bonusMet } from '../src/scoring';
import { levelFingerprint } from '../tools/tune/fingerprint';
import { handSeed, INTENTS } from '../tools/tune/intents';
import { designs } from '../src/levels.res';

const DESIGNS = designs as Record<string, { reference: string; bonus: string | null }>;

function drive(design: Design, level: LevelDef, seconds = 30) {
  const run = new TestRun(design, level);
  for (let i = 0; i < seconds * 60 && run.status === 'running'; i++) run.step();
  return run;
}

/** No joint hangs off a single member. */
function loose(d: Design): string[] {
  const degree = new Uint16Array(d.nodes.length);
  for (const m of d.members) {
    degree[m.a]++;
    degree[m.b]++;
  }
  return d.nodes.filter((n, i) => !n.anchor && degree[i] < 2).map((n) => `${n.x},${n.y}`);
}

describe('tuned levels', () => {
  it('are tuned for their current inputs (run `npm run tune` if not)', () => {
    const stale = LEVELS.filter((l) => TUNED.levels[l.id]?.fingerprint !== levelFingerprint(l.id)).map((l) => l.id);
    expect(stale).toEqual([]);
  });

  for (const level of LEVELS) {
    describe(`level ${level.id} "${level.name}"`, () => {
      const saved = DESIGNS[level.id];

      it('has a reference design that is buildable, on target and crosses', () => {
        expect(saved?.reference).toBeTruthy();
        const d = Design.deserialize(saved.reference);
        expect(designProblems(level, d)).toEqual([]);
        expect(loose(d)).toEqual([]);
        expect(d.cost()).toBeLessThanOrEqual(level.target);
        const run = drive(d, level);
        expect({ status: run.status, reason: run.reason }).toEqual({ status: 'success', reason: '' });
        expect(run.world.links.some((l) => l.bridge && l.broken)).toBe(false);
        expect(run.peakStress).toBeLessThan(1);
      });

      it(`can meet its bonus goal: ${bonusLabel(level.bonus)}`, () => {
        const d = Design.deserialize(saved?.bonus ?? saved.reference);
        expect(designProblems(level, d)).toEqual([]);
        const run = drive(d, level);
        expect(run.status).toBe('success');
        expect(run.world.links.some((l) => l.bridge && l.broken)).toBe(false);
        expect(bonusMet(level.bonus, d, run.peakStress)).toBe(true);
      });

      const seed = handSeed(level);
      it.runIf(seed)('keeps the hand-made design affordable and working', () => {
        expect(designProblems(level, seed!)).toEqual([]);
        expect(drive(seed!, level).status).toBe('success');
      });

      for (const s of INTENTS[level.id]?.shortcuts ?? []) {
        it(`shuts out the shortcut "${s.name}"`, () => {
          const d = s.build(level);
          // Ruled out by breaking the level's rules (such as a part limit), going over budget, failing,
          // or only getting across by breaking a member or tearing out a concrete anchor.
          const blocked = designProblems(level, d, { budget: false }).length > 0 || d.cost() > level.money;
          const run = blocked ? null : drive(d, level);
          const broke = !!run && (run.world.links.some((l) => l.bridge && l.broken) || run.world.blocks.some((b) => b.loose));
          expect(blocked || run!.status === 'fail' || broke).toBe(true);
        });
      }
    });
  }
});
