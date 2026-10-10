import type { Design } from './design';
import type { LevelDef } from './levels';
import { compressionLimit, MATERIALS } from './physics/materials';

/** A part whose busiest piece never carried more than this share of its strength is barely used. */
export const IDLE_LOAD = 0.2;
/** Steel that wood could take over would load the wood to at most this: still safe for the safety star. */
const WOOD_LOAD = 0.75;

/** What a successful test says about the material in the bridge. */
export interface Efficiency {
  /** Members of parts that never carried more than IDLE_LOAD, leaving out the deck, rams and steel that wood could replace. */
  idle: number[];
  /** Parts among them, and what they cost. */
  idleParts: number;
  idleCost: number;
  /** Steel members wood would carry with room to spare, on a level that offers wood. */
  toWood: number[];
  /** Steel parts among them, and what building them in wood would save. */
  woodParts: number;
  woodSaving: number;
}

/**
 * Finds the material a successful test drive barely used. `pull` and `push` are each member's
 * highest load ratios during the run (TestRun.peakPull and peakPush). Steel that wood could
 * carry is suggested as wood rather than listed as idle. A split beam or main cable counts as a
 * whole: by its busiest piece, and it goes to wood only if every piece can.
 */
export function efficiency(level: LevelDef, d: Design, pull: ArrayLike<number>, push: ArrayLike<number>): Efficiency {
  const groups = new Map<number | string, number[]>();
  d.members.forEach((m, i) => {
    const key = m.part ?? `m${i}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  const wood = MATERIALS.wood;
  const out: Efficiency = { idle: [], idleParts: 0, idleCost: 0, toWood: [], woodParts: 0, woodSaving: 0 };
  for (const members of groups.values()) {
    const mat = MATERIALS[d.members[members[0]].mat];
    if (mat.drivable || mat.stroke) continue;
    // Steel first: the forces it carried, against what wood of the same length can take.
    const woodFits =
      mat.id === 'steel' &&
      level.materials.includes('wood') &&
      members.every((i) => {
        const len = d.length(i);
        if (len > wood.maxLen + 1e-9) return false;
        return Math.max((pull[i] * mat.tension) / wood.tension, (push[i] * compressionLimit(mat, len)) / compressionLimit(wood, len)) <= WOOD_LOAD;
      });
    if (woodFits) {
      out.toWood.push(...members);
      out.woodParts++;
      out.woodSaving += members.reduce((c, i) => c + d.length(i) * (mat.price - wood.price), 0);
    } else if (Math.max(...members.map((i) => Math.max(pull[i], push[i]))) <= IDLE_LOAD) {
      out.idle.push(...members);
      out.idleParts++;
      out.idleCost += members.reduce((c, i) => c + d.length(i) * mat.price, 0);
    }
  }
  out.idleCost = Math.round(out.idleCost);
  out.woodSaving = Math.round(out.woodSaving);
  return out;
}
