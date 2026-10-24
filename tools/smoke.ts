/**
 * End-to-end smoke test in a headless browser: a new engineer builds 1-1 with the keyboard,
 * tests it, and finds the crossing on the result screen and the leaderboards.
 *
 *   npm run smoke
 *
 * It starts its own dev server on a free port, with a throwaway database, and drives an
 * installed Chrome or Edge (see tools/browser.ts).
 */
import { buildFirstBridge, launch, press, startServer } from './browser';

let step = '';
function log(s: string): void {
  step = s;
  console.log(`· ${s}`);
}

/** Errors the page logged, reported with any failure. */
const errors: string[] = [];

async function main(): Promise<void> {
  const { url, close } = await startServer();
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
    await page.locator('#scr-title:not(.hidden, .leaving)').waitFor();

    log('Continue opens 1-1 and its briefing');
    await press(page, 'Enter');
    await page.locator('#scr-brief:not(.hidden, .leaving)').waitFor();
    if ((await page.textContent('#brief-code'))?.trim() !== '1-1') throw new Error('Continue did not open 1-1');
    await press(page, 'Enter');
    await page.locator('#scr-brief').waitFor({ state: 'hidden' });

    log('builds the road and two wood braces with the keyboard');
    await buildFirstBridge(page);
    const spent = await page.textContent('#hud-spent');
    if (!spent || spent === '$0') throw new Error('Nothing was built');

    log(`tests the bridge (${spent})`);
    await press(page, 't');
    await page.locator('#scr-result:not(.hidden, .leaving)').waitFor({ timeout: 60000 });
    await page.waitForTimeout(2500);
    const total = Number((await page.textContent('#res-total'))?.replace(/,/g, ''));
    if (!(total > 0)) throw new Error(`The result shows no score (${total})`);
    if (!(await page.textContent('#res-run'))?.includes('FIRST CROSSING')) throw new Error('The result does not call it a first crossing');
    const stars = await page.locator('#res-stars i.on:not(.bonus)').count();
    log(`the result shows ${total.toLocaleString('en-US')} points and ${stars} stars`);
    if (stars < 1) throw new Error('No stars lit');

    log('the leaderboards list the crossing');
    await press(page, 'Escape');
    await page.locator('#scr-chapter:not(.hidden, .leaving)').waitFor();
    await press(page, 'Escape');
    await page.locator('#scr-chapters:not(.hidden, .leaving)').waitFor();
    await press(page, 'Escape');
    await page.locator('#scr-title:not(.hidden, .leaving)').waitFor();
    await press(page, 'h');
    await page.locator('#scr-scores:not(.hidden, .leaving)').waitFor();
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
    await close();
  }
}

main().catch((e: unknown) => {
  console.error(`Smoke test failed while it ${step}:\n${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
