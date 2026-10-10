/**
 * End-to-end smoke test in a headless browser: a new engineer builds 1-1 with the keyboard,
 * tests it, and finds the crossing on the result screen and the leaderboards.
 *
 *   npm run smoke
 *
 * It starts its own dev server on a free port, with a throwaway database, and drives an
 * installed Chrome or Edge (or Playwright's own Chromium, if downloaded). SMOKE_CHANNEL picks
 * one: chrome, msedge or chromium. SMOKE_HEADED=1 shows the window.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer } from 'vite';

const dir = mkdtempSync(join(tmpdir(), 'bridge-smoke-'));
process.env.DB_FILE = join(dir, 'smoke.db');

let step = '';
function log(s: string): void {
  step = s;
  console.log(`· ${s}`);
}

async function launch(): Promise<Browser> {
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

async function press(page: Page, ...keys: string[]): Promise<void> {
  for (const k of keys) {
    await page.keyboard.press(k);
    await page.waitForTimeout(40);
  }
}

/** Drags one member with the keyboard: from the cursor, by (dx, dy) grid steps, then lets go. */
async function lay(page: Page, dx: number, dy: number): Promise<void> {
  await press(page, 'Space');
  const keys = [...Array(Math.abs(dx)).fill(dx > 0 ? 'ArrowRight' : 'ArrowLeft'), ...Array(Math.abs(dy)).fill(dy > 0 ? 'ArrowUp' : 'ArrowDown')];
  await press(page, ...keys, 'Space', 'Escape');
}

/** Errors the page logged, reported with any failure. */
const errors: string[] = [];

async function main(): Promise<void> {
  const server = await createServer({ logLevel: 'error', server: { port: 0, strictPort: false } });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('The dev server has no address');
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

    log('a new engineer signs in');
    await page.goto(url);
    await page.locator('#profile-name').waitFor({ state: 'visible' });
    await page.fill('#profile-name', 'Smoke Tester');
    await page.press('#profile-name', 'Enter');
    await page.locator('#scr-title:not(.hidden)').waitFor();

    log('Continue opens 1-1 and its briefing');
    await press(page, 'Enter');
    await page.locator('#scr-brief:not(.hidden)').waitFor();
    if ((await page.textContent('#brief-code'))?.trim() !== '1-1') throw new Error('Continue did not open 1-1');
    await press(page, 'Enter');
    await page.locator('#scr-brief').waitFor({ state: 'hidden' });

    log('builds the road and two wood braces with the keyboard');
    // The cursor starts on the left road end, (0, 0).
    await lay(page, 4, 0);
    // Number keys pick from the level's own materials: road, then wood.
    await press(page, '2');
    await press(page, 'ArrowDown', 'ArrowDown');
    await lay(page, -2, 2);
    await press(page, 'ArrowLeft', 'ArrowLeft', 'ArrowDown', 'ArrowDown');
    await lay(page, 2, 2);
    const spent = await page.textContent('#hud-spent');
    if (!spent || spent === '$0') throw new Error('Nothing was built');

    log(`tests the bridge (${spent})`);
    await press(page, 't');
    await page.locator('#scr-result:not(.hidden)').waitFor({ timeout: 60000 });
    await page.waitForTimeout(2500);
    const total = Number((await page.textContent('#res-total'))?.replace(/,/g, ''));
    if (!(total > 0)) throw new Error(`The result shows no score (${total})`);
    if (!(await page.textContent('#res-run'))?.includes('FIRST CROSSING')) throw new Error('The result does not call it a first crossing');
    const stars = await page.locator('#res-stars i.on:not(.bonus)').count();
    log(`the result shows ${total.toLocaleString('en-US')} points and ${stars} stars`);
    if (stars < 1) throw new Error('No stars lit');

    log('the leaderboards list the crossing');
    await press(page, 'Escape');
    await page.locator('#scr-chapter:not(.hidden)').waitFor();
    await press(page, 'Escape');
    await page.locator('#scr-chapters:not(.hidden)').waitFor();
    await press(page, 'Escape');
    await page.locator('#scr-title:not(.hidden)').waitFor();
    await press(page, 'h');
    await page.locator('#scr-scores:not(.hidden)').waitFor();
    const career = page.locator('#score-rows tr', { hasText: 'Smoke Tester' });
    await career.waitFor({ timeout: 10000 });
    if (!(await career.textContent())?.includes(total.toLocaleString('en-US'))) throw new Error('The career board has the wrong score');
    await page.click('#tab-levels');
    const record = page.locator('#score-rows tr', { hasText: 'Smoke Tester' }).first();
    await record.waitFor({ timeout: 10000 });
    if (!(await record.textContent())?.includes('1-1')) throw new Error('The levels board has no record on 1-1');
    if (!(await record.locator('.rec-view').count())) throw new Error('The record bridge cannot be watched');

    if (errors.length) throw new Error(`The page logged errors:\n${errors.join('\n')}`);
    console.log('Smoke test passed.');
  } finally {
    await browser.close();
    await server.close();
  }
}

main()
  .catch((e: unknown) => {
    console.error(`Smoke test failed while it ${step}:\n${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // The database may still be open on Windows; it's in the temp folder either way.
    }
  });
