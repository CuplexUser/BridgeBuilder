/**
 * npm run desktop:dist: builds the desktop app with Tauri (desktop/), then copies the installer
 * and the bare executable into release/ under names that carry the version. The executable
 * holds the whole game, so it doubles as the portable build: it only needs WebView2, which
 * Windows 10 and 11 already have.
 */
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const target = path.join('desktop', 'target', 'release');

execSync('npx tauri build', { stdio: 'inherit' });
mkdirSync('release', { recursive: true });

const copy = (from, name) => {
  copyFileSync(from, path.join('release', name));
  console.log(`release/${name}`);
};

if (process.platform === 'win32') {
  const nsis = path.join(target, 'bundle', 'nsis');
  const setup = readdirSync(nsis).find((f) => f.includes(version) && f.endsWith('-setup.exe'));
  if (!setup) throw new Error(`No installer for ${version} in ${nsis}`);
  copy(path.join(nsis, setup), `Bridge-Builder-Setup-${version}.exe`);
  copy(path.join(target, 'bridge-builder.exe'), `Bridge-Builder-${version}-portable.exe`);
}
