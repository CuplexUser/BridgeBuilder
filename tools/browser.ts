/**
 * What the browser tools (`npm run smoke`, `npm run screens`) share: a dev server with a throwaway
 * database, a headless browser, and keyboard building.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer } from 'vite';

/** Starts the dev server on a free port with an empty database of its own. */
export async function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-smoke-'));
  process.env.DB_FILE = join(dir, 'smoke.db');
  const server = await createServer({ logLevel: 'error', server: { port: 0, strictPort: false } });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('The dev server has no address');
  return {
    url,
    close: async () => {
      await server.close();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // The database may still be open on Windows; it's in the temp folder either way.
      }
    },
  };
}

/**
 * An installed Chrome or Edge, or Playwright's own Chromium if downloaded. SMOKE_CHANNEL picks
 * one: chrome, msedge or chromium. SMOKE_HEADED=1 shows the window.
 */
export async function launch(): Promise<Browser> {
  const wanted = process.env.SMOKE_CHANNEL;
  const channels = wanted ? [wanted] : ['chromium', 'chrome', 'msedge'];
  for (const channel of channels) {
    try {
      return await chromium.launch({ channel: channel === 'chromium' ? undefined : channel, headless: !process.env.SMOKE_HEADED });
    } catch {
      // Not installed: try the next one.
    }
  }
  throw new Error(`No browser found (tried ${channels.join(', ')}). Install Chrome or Edge, or run: npx playwright-core install chromium`);
}

export async function press(page: Page, ...keys: string[]): Promise<void> {
  for (const k of keys) {
    await page.keyboard.press(k);
    await page.waitForTimeout(40);
  }
}

/** Drags one member with the keyboard: from the cursor, by (dx, dy) grid steps, then lets go. */
export async function lay(page: Page, dx: number, dy: number): Promise<void> {
  await press(page, 'Space');
  const keys = [...Array(Math.abs(dx)).fill(dx > 0 ? 'ArrowRight' : 'ArrowLeft'), ...Array(Math.abs(dy)).fill(dy > 0 ? 'ArrowUp' : 'ArrowDown')];
  await press(page, ...keys, 'Space', 'Escape');
}

/** Builds 1-1's road and two wood braces, from the cursor's start on the left road end. */
export async function buildFirstBridge(page: Page): Promise<void> {
  await lay(page, 4, 0);
  // Number keys pick from the level's own materials: road, then wood.
  await press(page, '2');
  await press(page, 'ArrowDown', 'ArrowDown');
  await lay(page, -2, 2);
  await press(page, 'ArrowLeft', 'ArrowLeft', 'ArrowDown', 'ArrowDown');
  await lay(page, 2, 2);
}
