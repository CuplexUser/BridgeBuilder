/**
 * Screenshots every screen of the game, for checking a style or layout change by eye or by diff.
 *
 *   npm run screens -- [--out dir] [--narrow]
 *
 * It walks a new engineer through the game as the smoke test does (see tools/browser.ts) and saves
 * two pictures of each screen: `<name>.png` as a player sees it, and `<name>.dom.png` with the
 * canvas hidden and CSS animations finished, which stays the same from run to run. --narrow uses
 * a 360×740 touch phone instead of a 1280×760 desktop window.
 */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright-core';
import { buildFirstBridge, launch, press, startServer } from './browser';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const narrow = args.includes('--narrow');
const out = resolve(opt('--out') ?? join(tmpdir(), 'bridge-screens', narrow ? 'narrow' : 'wide'));

type GameHandle = { act(a: string): void; setPaused(p: boolean): void; offerFullGame(): void; askQuit(): void };

/** Runs a method on the game the page exposes with ?debug. */
async function game(page: Page, call: (g: GameHandle) => void): Promise<void> {
  await page.evaluate(`(${call.toString()})(window.__game)`);
}

let shots = 0;
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(450);
  await page.screenshot({ path: join(out, `${name}.png`) });
  await page.addStyleTag({ content: '#game { visibility: hidden !important; } #toast, #fps { display: none !important; }' }).then(async (tag) => {
    await page.screenshot({ path: join(out, `${name}.dom.png`), animations: 'disabled', caret: 'hide' });
    await tag.evaluate((el) => (el as Element).remove());
  });
  shots++;
  console.log(`· ${name}`);
}

async function visible(page: Page, id: string): Promise<void> {
  await page.locator(`#${id}:not(.hidden)`).waitFor({ timeout: 15000 });
}

async function main(): Promise<void> {
  mkdirSync(out, { recursive: true });
  const { url, close } = await startServer();
  const browser = await launch();
  try {
    const page = await browser.newPage(narrow ? { viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 760 } });
    page.on('pageerror', (e) => console.error(`  page error: ${e.message}`));

    await page.goto(`${url}?debug`);
    await visible(page, 'scr-profile');
    await shot(page, 'profile');
    await page.fill('#profile-name', 'Screen Tester');
    await page.press('#profile-name', 'Enter');
    await visible(page, 'scr-title');
    await shot(page, 'title');

    await game(page, (g) => g.act('chapters'));
    await visible(page, 'scr-chapters');
    await page.click('#view-map');
    await shot(page, 'map');
    await page.click('#view-book');
    await shot(page, 'book');
    await page.locator('#scr-chapters [data-act=chapter]:visible').first().click();
    await visible(page, 'scr-chapter');
    await shot(page, 'chapter');

    await game(page, (g) => g.act('continue'));
    await visible(page, 'scr-brief');
    await shot(page, 'brief');
    await press(page, 'Enter');
    await page.locator('#scr-brief').waitFor({ state: 'hidden' });
    await shot(page, 'build-empty');
    await buildFirstBridge(page);
    await shot(page, 'build');
    await game(page, (g) => g.setPaused(true));
    await visible(page, 'scr-pause');
    await shot(page, 'pause');
    // Only a challenge asks before quitting; this shows the same card over the pause menu.
    await game(page, (g) => g.askQuit());
    await visible(page, 'scr-confirm');
    await shot(page, 'confirm');
    await game(page, (g) => g.act('quit-cancel'));
    await game(page, (g) => g.setPaused(false));

    await press(page, 't');
    await visible(page, 'scr-result');
    await page.waitForTimeout(2500);
    await shot(page, 'result');
    await game(page, (g) => g.act('stress'));
    await shot(page, 'stress');
    await game(page, (g) => g.act('stress-close'));

    // Nothing over 1-1's gap: the car drops in, for the collapse screen.
    await game(page, (g) => g.act('retry'));
    await page.locator('#scr-result').waitFor({ state: 'hidden' });
    await press(page, 'z', 'z', 'z', 't');
    await visible(page, 'scr-collapse');
    await page.waitForTimeout(2500);
    await shot(page, 'collapse');

    await game(page, (g) => g.offerFullGame());
    if (await page.locator('#scr-unlock:not(.hidden)').count()) {
      await shot(page, 'unlock');
      await game(page, (g) => g.act('unlock-close'));
    }

    for (let i = 0; i < 4 && !(await page.locator('#scr-title:not(.hidden)').count()); i++) {
      await press(page, 'Escape');
      await page.waitForTimeout(300);
    }
    await visible(page, 'scr-title');
    await game(page, (g) => g.act('scores'));
    await visible(page, 'scr-scores');
    await page.locator('#score-rows tr').first().waitFor({ timeout: 10000 });
    await shot(page, 'scores');
    await page.click('#tab-levels');
    await shot(page, 'scores-levels');
    await game(page, (g) => g.act('back'));

    await game(page, (g) => g.act('workshop'));
    await visible(page, 'scr-workshop');
    await shot(page, 'workshop');
    await game(page, (g) => g.act('ws-new'));
    await page.locator('#maker-bar:not(.hidden)').waitFor();
    await shot(page, 'maker');
    await game(page, (g) => g.act('mk-help'));
    await visible(page, 'scr-mkhelp');
    await shot(page, 'mkhelp');
    await game(page, (g) => g.act('mk-help-close'));
    await game(page, (g) => g.act('mk-export'));
    await visible(page, 'scr-share');
    await shot(page, 'share');

    console.log(`${shots} screens saved to ${out}`);
  } finally {
    await browser.close();
    await close();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
