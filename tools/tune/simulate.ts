import { Design } from '../../src/design';
import { goalX, START_X, type LevelDef } from '../../src/levels';
import { designProblems } from '../../src/rules';
import { TestRun } from '../../src/physics/world';

/** What one test drive of a design showed. */
export interface Outcome {
  /** Buildable under the editor's rules (budget aside). */
  valid: boolean;
  crossed: boolean;
  /** Why it failed: a build problem or the run's failure reason. */
  reason: string;
  peak: number;
  cost: number;
  parts: number;
  /** How far the vehicle got, 0 at the start line to 1 at the goal. */
  progress: number;
  /** Some bridge member broke on the way, even if the vehicles made it. */
  broken: boolean;
}

/** Drives a design across a level, the way the game's TEST button does. Budget is not checked here. */
export function simulate(level: LevelDef, designJson: string, seconds = 30): Outcome {
  const d = Design.deserialize(designJson);
  const base = { cost: d.cost(), parts: d.parts() };
  const problems = designProblems(level, d, { budget: false });
  if (problems.length) return { ...base, valid: false, crossed: false, reason: problems[0], peak: 1, progress: 0, broken: false };
  const run = new TestRun(d, level);
  let furthest = START_X;
  for (let i = 0; i < seconds * 60 && run.status === 'running'; i++) {
    run.step();
    furthest = Math.max(furthest, run.vehicleX);
  }
  const crossed = run.status === 'success';
  const progress = crossed ? 1 : Math.max(0, Math.min(1, (furthest - START_X) / (goalX(level) - START_X)));
  // A concrete anchor torn out of the bank is as much a failure as a snapped member.
  const broken = run.world.links.some((l) => l.bridge && l.broken) || run.world.blocks.some((b) => b.loose);
  return { ...base, valid: true, crossed, reason: crossed ? '' : run.reason || 'timed out', peak: run.peakStress, progress, broken };
}
