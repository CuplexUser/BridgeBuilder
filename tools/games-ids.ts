/**
 * Writes android/app/src/main/res/values/games-ids.xml: every Play Games achievement and
 * leaderboard key the game sends, with the ids left blank for the Play Console's. Ids already in
 * the file are kept, so it can be run again after adding an achievement (npm run games-ids).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { ACHIEVEMENTS, LEADERBOARDS } from '../src/achievements';

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
