import { CHAPTERS } from '../chapters';
import { LEVELS } from '../levels';
import { MATERIALS, type MaterialId } from '../physics/materials';
import { VEHICLES, type VehicleId } from '../physics/vehicles';
import { THEMES } from '../render/themes';
import { en, type Plural } from './en';
import type { Table } from './index';

/**
 * Every key a complete locale table has, with its English: the UI messages, then each level's,
 * chapter's, material's, vehicle's and scene's text by id. Used by the tests and `npm run i18n`.
 */
export function allKeys(): Map<string, string | Plural> {
  const out = new Map<string, string | Plural>(Object.entries(en));
  for (const l of LEVELS) {
    out.set(`level.${l.id}.name`, l.name);
    out.set(`level.${l.id}.tip`, l.tip);
  }
  for (const c of CHAPTERS) for (const f of ['name', 'blurb', 'effort'] as const) out.set(`chapter.${c.id}.${f}`, c[f]);
  for (const id of Object.keys(MATERIALS) as MaterialId[]) {
    out.set(`mat.${id}.name`, MATERIALS[id].name);
    out.set(`mat.${id}.short`, MATERIALS[id].short);
    out.set(`mat.${id}.inline`, MATERIALS[id].name.toLowerCase());
  }
  for (const id of Object.keys(VEHICLES) as VehicleId[]) {
    out.set(`vehicle.${id}.name`, VEHICLES[id].name);
    out.set(`vehicle.${id}.inline`, VEHICLES[id].name.toLowerCase());
  }
  for (const th of THEMES) out.set(`theme.${th.id}`, th.name);
  return out;
}

/** The keys a locale table has no message for. */
export function missingKeys(table: Table): string[] {
  return [...allKeys().keys()].filter((k) => table[k] === undefined);
}

/** The `{param}` names in a message, sorted. */
export function placeholders(msg: string): string[] {
  return [...msg.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).toSorted();
}

/** The markup tags in a message, e.g. ["<b>", "</b>"], sorted. */
export function tags(msg: string): string[] {
  return [...msg.matchAll(/<\/?[a-z]+[^>]*>/g)].map((m) => m[0].replace(/\s.*>$/, '>')).toSorted();
}
