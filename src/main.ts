import { Game } from './game/game';
import { detectLocale, registerLocales, setLocale } from './i18n';
import { applyStatic } from './i18n/dom';
import { appVersion, bindApp, initPlatform, onLink, platform } from './platform';
import { loadPrefs, LocalStore, pickStore } from './storage';

await initPlatform();
// The language the player picked, or the device's; its table loads before anything is shown.
registerLocales(import.meta.glob('./i18n/locales/*.ts'));
await setLocale(loadPrefs().lang ?? detectLocale());
applyStatic();
// Shows which build is installed, so testers can tell a Play update has arrived.
const version = appVersion();
if (version) document.getElementById('app-version')!.textContent = `v${version}`;
const canvas = document.getElementById('game') as HTMLCanvasElement;
// The Android and desktop apps have no server to look for: they keep everything on the device.
const game = new Game(canvas, platform === 'web' ? await pickStore() : new LocalStore());
bindApp(game.input);
// A shared bridge's link, as the game opens or (in the app) while it runs.
onLink((url) => void game.sharing.open(url));

let last = performance.now();
function frame(now: number): void {
  const dt = (now - last) / 1000;
  last = now;
  game.update(dt);
  game.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

document.addEventListener('visibilitychange', () => {
  last = performance.now();
});

if (new URLSearchParams(location.search).has('debug')) {
  (window as unknown as { __game: Game }).__game = game;
}
