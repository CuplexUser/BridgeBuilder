import { Game } from './game';
import { bindApp, initPlatform, isNative } from './platform';
import { LocalStore, pickStore } from './storage';

await initPlatform();
const canvas = document.getElementById('game') as HTMLCanvasElement;
// The app has no server to look for: it keeps everything on the device.
const game = new Game(canvas, isNative ? new LocalStore() : await pickStore());
bindApp(game);

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
