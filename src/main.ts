import { Game } from './game/game';
import { appVersion, bindApp, initPlatform, platform } from './platform';
import { LocalStore, pickStore } from './storage';

await initPlatform();
// Shows which build is installed, so testers can tell a Play update has arrived.
const version = appVersion();
if (version) document.getElementById('app-version')!.textContent = `v${version}`;
const canvas = document.getElementById('game') as HTMLCanvasElement;
// The Android and desktop apps have no server to look for: they keep everything on the device.
const game = new Game(canvas, platform === 'web' ? await pickStore() : new LocalStore());
bindApp(game.input);

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
