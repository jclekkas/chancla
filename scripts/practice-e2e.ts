// Browser checks for practice mode and the parts of the UI that do not need
// a server: bot labeling, pausing, Spanish, low quality, and the no-WebGL
// fallback. Needs `npm run preview` (or E2E_URL) running.
//
//   node --import tsx scripts/practice-e2e.ts
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';

const OUT = path.resolve(new URL('../artifacts/mp', import.meta.url).pathname);
const SITE = process.env.E2E_URL || 'http://localhost:4173/';
fs.mkdirSync(OUT, { recursive: true });
const results: Array<{ check: string; ok: boolean; detail?: string }> = [];
const check = (name: string, ok: boolean, detail?: string) => { results.push({ check: name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`); };
const wait = (p: Page, fn: string, ms = 90000) => p.waitForFunction(fn, null, { timeout: ms, polling: 100 });

async function main(): Promise<void> {
  const browser = await launch(['--mute-audio']);
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  await ctx.addInitScript({ content: 'window.__name = (f) => f;' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(90000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(SITE);
  await wait(page, "window.__fps && window.__fps.screen === 'title'");

  // Spanish.
  await page.click('#btn-lang');
  const es = await page.textContent('#btn-online');
  check('language toggle switches the title to Spanish', es === 'Jugar en línea', es ?? '');
  await page.screenshot({ path: path.join(OUT, 'p-01-title-es.png') });
  await page.click('#btn-lang');

  // Practice with one bot teammate and two bot opponents.
  await page.click('#btn-practice');
  await page.click('[data-allies="1"]');
  await page.click('[data-enemies="2"]');
  await page.click('#btn-practice-start');
  await wait(page, 'window.__fps.inMatch');
  await page.click('#btn-click-play', { timeout: 3000 }).catch(() => { /* already locked */ });
  await wait(page, "window.__fps.session() && window.__fps.session().phase === 'playing'");
  const members = await page.evaluate(() => (window as any).__fps.session().room.members.map((m: any) => ({ bot: m.bot, name: m.name, team: m.team })));
  check('practice room has 3 bots and the player, 2v2', members.length === 4 && members.filter((m: any) => m.bot).length === 3 && members.filter((m: any) => m.team === 0).length === 2);
  await page.keyboard.down('Tab');
  await page.waitForTimeout(200);
  const sb = await page.textContent('#sb-body');
  check('every bot is labeled BOT on the scoreboard', (sb?.match(/\(BOT\)/g) || []).length === 3);
  await page.screenshot({ path: path.join(OUT, 'p-02-practice-scoreboard.png') });
  await page.keyboard.up('Tab');
  check('the HUD shows the PRACTICE badge', await page.isVisible('#hud-practice'));

  // Walk forward a bit so bots and the plaza come into view.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: path.join(OUT, 'p-03-practice-play.png') });

  // Pause freezes the practice clock.
  // Releasing the pointer (what Esc does in a real browser) opens the menu.
  await page.evaluate(() => (window as any).__fps.input().exitLock());
  await wait(page, "window.__fps.screen === 'pause'");
  const tl0 = await page.evaluate(() => (window as any).__fps.session().snap.tl);
  await page.waitForTimeout(2500);
  const tl1 = await page.evaluate(() => (window as any).__fps.session().snap.tl);
  check('practice pauses while the menu is open', tl0 === tl1, `${tl0} -> ${tl1}`);
  const note = await page.textContent('#pause-note');
  check('pause menu says practice is paused', /paused/i.test(note ?? ''), note ?? '');
  await page.screenshot({ path: path.join(OUT, 'p-04-pause.png') });

  // Low quality, applied live.
  await page.click('#btn-pause-settings');
  await page.click('[data-q="low"]');
  const q = await page.evaluate(() => (window as any).__fps.info().quality);
  check('quality setting applies without reload', q === 'low');
  await page.click('#btn-settings-close');
  await page.click('#btn-resume');
  await page.click('#btn-click-play', { timeout: 3000 }).catch(() => { /* already locked */ });
  await page.waitForTimeout(1500);
  const tl2 = await page.evaluate(() => (window as any).__fps.session().snap.tl);
  check('practice resumes after the menu closes', tl2 < tl1, `${tl1} -> ${tl2}`);
  await page.screenshot({ path: path.join(OUT, 'p-05-low-quality.png') });

  // Leaving asks for confirmation and returns to the title.
  await page.evaluate(() => (window as any).__fps.input().exitLock());
  await wait(page, "window.__fps.screen === 'pause'");
  await page.click('#btn-pause-leave');
  await wait(page, "window.__fps.screen === 'confirm'");
  await page.click('#btn-confirm-yes');
  await wait(page, "window.__fps.screen === 'title'");
  check('leave practice with confirmation returns to the title', true);

  // Settings persist across reloads.
  await page.click('#btn-settings');
  await page.fill('#set-fov', '95');
  await page.dispatchEvent('#set-fov', 'input');
  await page.reload();
  await wait(page, "window.__fps && window.__fps.screen === 'title'");
  const fov = await page.evaluate(() => JSON.parse(localStorage.getItem('chancla.mp.settings.v1') || '{}').fov);
  check('settings persist across reloads', fov === 95, String(fov));
  check('no console errors during practice', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
  await browser.close();

  // No WebGL: menus still work and the title explains the problem.
  const noGl = await launch(['--disable-3d-apis', '--mute-audio']);
  const p2 = await (await noGl.newContext({ viewport: { width: 960, height: 540 } })).newPage();
  await p2.goto(SITE);
  await wait(p2, "window.__fps && window.__fps.screen === 'title'");
  const warn = await p2.isVisible('#webgl-status');
  const disabled = await p2.isDisabled('#btn-practice');
  await p2.click('#btn-settings');
  const settingsOpen = await p2.isVisible('#scr-settings');
  check('without WebGL the title explains why, play is disabled, settings still open', warn && disabled && settingsOpen);
  await p2.screenshot({ path: path.join(OUT, 'p-06-no-webgl.png') });
  await noGl.close();
}

main()
  .catch((e) => { results.push({ check: 'script', ok: false, detail: String(e) }); console.error(e); })
  .finally(() => {
    fs.writeFileSync(path.join(OUT, 'practice-e2e.json'), JSON.stringify(results, null, 2));
    if (results.some((r) => !r.ok)) process.exitCode = 1;
  });
