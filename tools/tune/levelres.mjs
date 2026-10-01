/**
 * The level resource, src/levels.res: the difficulty settings and everything the level tuner
 * decided, packed into one gzip-compressed JSON file. It is the committed source of truth; the
 * readable JSON under tools/tune/results is a git-ignored export of it.
 *
 * Plain JavaScript, so the tuner, the Vite plugin and the Node loader hook can all load it
 * without a TypeScript step. Types are in levelres.d.mts.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

export const FORMAT = 1;
export const RESOURCE_FILE = fileURLToPath(new URL('../../src/levels.res', import.meta.url));

export function readResource(file = RESOURCE_FILE) {
  const data = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
  if (data.format !== FORMAT) throw new Error(`${file} has resource format ${data.format}; this code reads format ${FORMAT}.`);
  return data;
}

export function writeResource(data, file = RESOURCE_FILE) {
  const { format: _format, ...rest } = data;
  const packed = gzipSync(JSON.stringify({ format: FORMAT, ...rest }), { level: 9 });
  // The gzip header names the system that packed it; "unknown" keeps the bytes the same everywhere.
  packed[9] = 0xff;
  // Written aside and renamed, so a dev server watching the file never reads half of it.
  writeFileSync(`${file}.tmp`, packed);
  renameSync(`${file}.tmp`, file);
}

/** Each tuned level's proof designs: the reference, and the design that meets its bonus goal. */
export function designsOf(data) {
  const designs = {};
  for (const [id, r] of Object.entries(data.results)) {
    if (r.reference?.design) designs[id] = { reference: r.reference.design, bonus: r.bonusDesign?.design ?? null };
  }
  return designs;
}

/**
 * The resource as an ES module with one named export per section. The game only imports
 * `levels`, so a production build tree-shakes the search results away.
 */
export function resourceModule(data) {
  const sections = { difficulty: data.difficulty, levels: data.levels, designs: designsOf(data), results: data.results };
  return Object.entries(sections)
    .map(([name, value]) => `export const ${name} = ${JSON.stringify(value)};`)
    .join('\n');
}
