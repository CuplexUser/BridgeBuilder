import type { ChapterDef } from '../chapters';
import type { LevelDef } from '../levels';
import { MATERIALS, type MaterialId } from '../physics/materials';
import { VEHICLES, type VehicleId } from '../physics/vehicles';
import { tData } from './index';

/**
 * Level, chapter, material, vehicle and scene text. The data files keep their English, which
 * is also what the tuner fingerprints, so translation never touches them: these look up a
 * locale's version by id and fall back to that English.
 */

/** Custom levels from the editor carry their author's own words. */
const custom = (l: LevelDef) => l.id >= 1000;

export function levelName(l: LevelDef): string {
  return custom(l) ? l.name : tData(`level.${l.id}.name`, l.name);
}

export function levelTip(l: LevelDef): string {
  return custom(l) ? l.tip : tData(`level.${l.id}.tip`, l.tip);
}

export function chapterText(c: ChapterDef, field: 'name' | 'blurb' | 'effort'): string {
  return tData(`chapter.${c.id}.${field}`, c[field]);
}

export function matName(id: MaterialId): string {
  return tData(`mat.${id}.name`, MATERIALS[id].name);
}

/** The toolbar's name on a narrow phone. */
export function matShort(id: MaterialId): string {
  return tData(`mat.${id}.short`, MATERIALS[id].short);
}

/** The name as it reads mid-sentence, e.g. "no heavy deck" (lower case in English, capitalized in German). */
export function matInline(id: MaterialId): string {
  return tData(`mat.${id}.inline`, MATERIALS[id].name.toLowerCase());
}

export function vehicleName(id: VehicleId): string {
  return tData(`vehicle.${id}.name`, VEHICLES[id].name);
}

/** A vehicle's name mid-sentence, e.g. "the semi truck". */
export function vehicleInline(id: VehicleId): string {
  return tData(`vehicle.${id}.inline`, VEHICLES[id].name.toLowerCase());
}

export function themeName(id: string, english: string): string {
  return tData(`theme.${id}`, english);
}
