/**
 * Writes android/app/src/main/res/values/games-ids.xml: every Play Games achievement and
 * leaderboard key the game sends, with the ids left blank for the Play Console's. Ids already in
 * the file are kept, so it can be run again after adding an achievement (npm run games-ids).
 *
 * `npm run games-ids -- --names <dir>` also writes `<dir>/play-games-<lang>.txt`: every name
 * and description in each language, to paste into the Play Console's translations.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ACHIEVEMENTS, challengeBoardKey, LEADERBOARDS, slug } from '../src/achievements';
import { CHAPTERS, type ChapterDef } from '../src/chapters';
import type { Table } from '../src/i18n';
import { GAMES_TEXT } from './games-names';

const FILE = 'android/app/src/main/res/values/games-ids.xml';

const old = (() => {
  try {
    return readFileSync(FILE, 'utf8');
  } catch {
    return '';
  }
})();
const kept = new Map([...old.matchAll(/<string name="(\w+)"[^>]*>([^<]*)<\/string>/g)].map((m) => [m[1], m[2]]));
const line = (name: string, comment: string) => `    <!-- ${comment} -->\n    <string name="${name}" translatable="false">${kept.get(name) ?? ''}</string>`;
const xml = `<?xml version="1.0" encoding="utf-8"?>
<!--
  Google Play Games ids, from the Play Console (Play Games Services → Setup → Get resources).
  Paste each id in by name; the Console's own copy of this file works too, without its
  package_name line, which strings.xml already has. With app_id empty, Play Games stays off.
  Written by npm run games-ids, which keeps the ids already here.
-->
<resources>
${line('app_id', 'Play Games project id')}

${ACHIEVEMENTS.map((a) => line(`achievement_${a.key}`, `${a.name}: ${a.how}`)).join('\n')}

${LEADERBOARDS.map((b) => line(`leaderboard_${b.key}`, `${b.name}: ${b.what}`)).join('\n')}
</resources>
`;
writeFileSync(FILE, xml);
console.log(`Wrote ${FILE}: ${ACHIEVEMENTS.length} achievements, ${LEADERBOARDS.length} leaderboards.`);

const at = process.argv.indexOf('--names');
if (at >= 0) {
  const dir = process.argv[at + 1];
  if (!dir) throw new Error('--names needs a folder');
  for (const [lang, text] of Object.entries(GAMES_TEXT)) {
    const url = pathToFileURL(fileURLToPath(new URL(`../src/i18n/locales/${lang}.ts`, import.meta.url))).href;
    const table = ((await import(url)) as { default: Table }).default;
    const chapterName = (c: ChapterDef) => String(table[`chapter.${c.id}.name`] ?? c.name);
    const rows: string[] = [];
    const add = (key: string, pair: readonly [string, string], name = '') => rows.push([key, ...pair.map((s) => `  ${s.replaceAll('{name}', name)}`)].join('\n'));
    for (const a of ACHIEVEMENTS) {
      const c = CHAPTERS.find((ch) => a.key === `chapter_${slug(ch.name)}`);
      const pair = c ? text.chapter : text.achievements[a.key];
      if (!pair) throw new Error(`${lang}: no text for ${a.key}`);
      add(`achievement_${a.key}`, pair, c && chapterName(c));
    }
    for (const b of LEADERBOARDS) {
      const c = CHAPTERS.find((ch) => challengeBoardKey(ch) === b.key);
      add(`leaderboard_${b.key}`, c ? text.challenge : b.key === 'career' ? text.career : text.stars, c && chapterName(c));
    }
    const file = join(dir, `play-games-${lang}.txt`);
    const head = `# Play Games achievements and leaderboards (${lang}): the key, then its name and description.\n# Written by npm run games-ids -- --names; machine-drafted, like the game's own tables.`;
    writeFileSync(file, `${head}\n\n${rows.join('\n\n')}\n`);
    console.log(`Wrote ${file}.`);
  }
}
