import './style.css';
import { Game } from './game';
import { pickStore } from './storage';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas, await pickStore());

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
