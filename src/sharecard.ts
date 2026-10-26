import { font } from './render/fonts';
import { PAL } from './render/palette';

/** The card's size, px: the landscape shape link previews and chat apps show whole. */
export const CARD_W = 1200;
export const CARD_H = 675;
const W = CARD_W;
const H = CARD_H;

export interface CardText {
  /** The level, e.g. "1-1 FIRST CROSSING". */
  title: string;
  /** What happened: the score for a crossing, the stamp and reason for a collapse. */
  line: string;
  /** Who built it. */
  by: string;
  /** Stars won, for a crossing; null for a collapse. */
  stars: number | null;
  /** The line's color. */
  tone: string;
}

/**
 * The picture that goes with a shared link: a frame of the game, drawn at the card's size, under
 * a band naming the level and what happened. A PNG.
 */
export function shareCard(source: HTMLCanvasElement, text: CardText): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#0b1d38';
  c.fillRect(0, 0, W, H);
  c.drawImage(source, 0, 0, W, H);

  const band = 132;
  const shade = c.createLinearGradient(0, H - band - 40, 0, H);
  shade.addColorStop(0, 'rgba(11, 29, 56, 0)');
  shade.addColorStop(0.3, 'rgba(11, 29, 56, 0.82)');
  shade.addColorStop(1, 'rgba(11, 29, 56, 0.95)');
  c.fillStyle = shade;
  c.fillRect(0, H - band - 40, W, band + 40);

  const pad = 40;
  c.textBaseline = 'alphabetic';
  c.fillStyle = PAL.gold;
  c.font = font(700, 18, 'mono');
  c.fillText('BRIDGE BUILDER', pad, H - band + 22);
  c.fillStyle = '#e9f3ff';
  c.font = font(800, 40);
  c.fillText(fitText(c, text.title, W - pad * 2 - 200), pad, H - band + 70);
  c.fillStyle = text.tone;
  c.font = font(700, 24);
  c.fillText(fitText(c, text.line, W - pad * 2 - 200), pad, H - band + 108);
  c.textAlign = 'right';
  c.fillStyle = '#a9bdd8';
  c.font = font(600, 22);
  c.fillText(fitText(c, text.by, 280), W - pad, H - band + 108);
  if (text.stars !== null) for (let i = 0; i < 3; i++) star(c, W - pad - 20 - (2 - i) * 50, H - band + 52, 20, i < text.stars);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No image'))), 'image/png'));
}

/** Cuts text that runs wider than the room, with an ellipsis. */
function fitText(c: CanvasRenderingContext2D, s: string, room: number): string {
  if (c.measureText(s).width <= room) return s;
  while (s.length > 1 && c.measureText(`${s}…`).width > room) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

function star(c: CanvasRenderingContext2D, x: number, y: number, r: number, lit: boolean): void {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const d = i % 2 ? r * 0.45 : r;
    c.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  c.closePath();
  c.fillStyle = lit ? PAL.gold : 'rgba(233, 243, 255, 0.16)';
  c.fill();
}
