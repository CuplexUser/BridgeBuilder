/**
 * Reports how complete each language is (`npm run i18n`): the keys each locale table still
 * lacks, which then read in English. `npm run i18n -- de` lists every missing key of one language.
 */
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Table } from '../src/i18n';
import { allKeys, missingKeys } from '../src/i18n/keys';

const dir = new URL('../src/i18n/locales/', import.meta.url);
const only = process.argv[2];
const total = allKeys().size;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts')).toSorted()) {
  const code = file.replace(/\.ts$/, '');
  if (only && code !== only) continue;
  const table = ((await import(pathToFileURL(new URL(file, dir).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href)) as { default: Table }).default;
  const missing = missingKeys(table);
  console.log(`${code.padEnd(6)} ${String(total - missing.length).padStart(4)}/${total}${missing.length ? `  missing ${missing.length}` : '  complete'}`);
  if (only) for (const k of missing) console.log(`  ${k}`);
  else if (missing.length) console.log(`       ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ', …' : ''}`);
}
