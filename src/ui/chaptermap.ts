/**
 * The progression map's layout: every level as a node on one winding road, chapter by chapter.
 * Each chapter starts on a fresh row under its heading, and every row starts on the side where
 * the one above ended, so the road snakes down the page, bending at each row's end. Pure geometry, in CSS pixels, so it can be
 * tested without a page.
 */

export interface MapNode {
  id: number;
  chapter: number;
  /** Center of the node. */
  x: number;
  y: number;
}

export interface MapHead {
  chapter: number;
  /** Top of the chapter's heading. */
  y: number;
}

export interface MapLayout {
  width: number;
  height: number;
  nodes: MapNode[];
  heads: MapHead[];
  /** The road from each node to the next, as SVG path data: one entry per gap, in order. */
  legs: string[];
}

/** Space a node needs across, px: its circle, and its stars or name under it. */
const MIN_STEP = 70;
const MOST_PER_ROW = 7;
const FEWEST_PER_ROW = 3;
const ROW_HEIGHT = 112;
/** A node's center below its row's top, px: its circle above, its name and stars below. */
const NODE_Y = 40;
const HEAD_HEIGHT = 44;
/** How far the road swings out past a row's last node before it turns down, px. */
const TURN = 24;
/** Up and down along a row, px, so the road winds. */
const WAVE = 9;

/** How many nodes fit on one row of a map this wide. */
export function perRow(width: number): number {
  return Math.max(FEWEST_PER_ROW, Math.min(MOST_PER_ROW, Math.floor((width - 2 * TURN) / MIN_STEP)));
}

export function mapLayout(chapters: { id: number; levels: number[] }[], width: number): MapLayout {
  const n = perRow(width);
  const step = (width - 2 * TURN) / n;
  const nodes: MapNode[] = [];
  const heads: MapHead[] = [];
  let y = 0;
  // Column the road last reached; the first row starts on the left.
  let last = -1;
  for (const c of chapters) {
    heads.push({ chapter: c.id, y });
    y += HEAD_HEIGHT;
    for (let i = 0; i < c.levels.length; i += n) {
      const ids = c.levels.slice(i, i + n);
      const ltr = last < n / 2;
      ids.forEach((id, j) => {
        const col = ltr ? j : n - 1 - j;
        nodes.push({ id, chapter: c.id, x: TURN + step * (col + 0.5), y: y + NODE_Y + (j % 2 ? WAVE : -WAVE) });
        last = col;
      });
      y += ROW_HEIGHT;
    }
  }
  const legs: string[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    if (Math.abs(b.y - a.y) < ROW_HEIGHT / 2) {
      // Along the row: an S-bend from one node to the next.
      const mid = (a.x + b.x) / 2;
      legs.push(`M${f(a.x)} ${f(a.y)}C${f(mid)} ${f(a.y)} ${f(mid)} ${f(b.y)} ${f(b.x)} ${f(b.y)}`);
    } else {
      // Down to the next row: out past whichever side the row ended on, and back in.
      const side = a.x > width / 2 ? 1 : -1;
      const out = side > 0 ? Math.max(a.x, b.x) + TURN * 1.6 : Math.min(a.x, b.x) - TURN * 1.6;
      legs.push(`M${f(a.x)} ${f(a.y)}C${f(out)} ${f(a.y)} ${f(out)} ${f(b.y)} ${f(b.x)} ${f(b.y)}`);
    }
  }
  return { width, height: y, nodes, heads, legs };
}

/** A coordinate for SVG path data. */
function f(v: number): string {
  return v.toFixed(1);
}
