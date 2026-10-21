// Browser check of the music lifecycle under a browser autoplay policy:
// audio may only start from a real user activation (enforced in the page,
// see open()).
//
//   npm run build && node --import tsx scripts/music-lifecycle-e2e.ts
//
// Flows:
//   1. fresh load, a first key press that cannot start audio, then a click
//   2. main menu -> Arcade -> Main menu (the Arcade's title music too)
//   3. main menu -> campaign select -> mission -> back -> main menu
//   4. rapid navigation while a track is still downloading
//   5. switching tabs and returning (Chrome-like and strict autoplay policies)
//   6. slow connection; failed download with recovery; failed for good
//   7. music volume at zero survives navigation and retries
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright-core';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'artifacts/music');
const SITE = process.env.E2E_URL || 'http://localhost:4173/';
fs.mkdirSync(OUT, { recursive: true });

const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); };

async function waitHttp(url: string): Promise<boolean> {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 250)); }
  return false;
}

type MState = { cue: string; want: string; layer: string; recording: string | null; failed: string[]; retrying: string[]; context: string; sounding: number };
const state = (page: Page): Promise<MState> => page.evaluate(() => (window as any).__fps.music().state());
async function until(page: Page, pred: (s: MState) => boolean, ms = 12000): Promise<MState> {
  const end = Date.now() + ms;
  for (;;) { const s = await state(page); if (pred(s) || Date.now() > end) return s; await page.waitForTimeout(100); }
}
const short = (s: MState) => ({ cue: s.cue, layer: s.layer, recording: s.recording, context: s.context, sounding: s.sounding, retrying: s.retrying, failed: s.failed });
// The menus' pool (Groquo de diversión opens it; Sueño de Cumbia and Grojo Curioso follow).
const MENU = ['036c0292', '91dee4c5', '6265def8'];
const MENU_FILES = /\/music\/playlist\/(08|10|11)-[^/]*\.mp3$/;
const menuTheme = (s: MState) => s.layer === 'recorded' && MENU.includes(s.recording ?? '') && s.context === 'running';

async function open(browser: Browser, opts: { route?: (p: Page) => Promise<void>; save?: boolean; policy?: 'sticky' | 'transient' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  await ctx.addInitScript({ content: 'window.__name = (f) => f;' });
  // Headless Chromium lets audio start without a gesture (and Playwright's
  // evaluate counts as one), so the policy is enforced here instead, from
  // trusted pointer and key events only (synthetic events never count):
  //   sticky     like Chrome: once the page has had a real gesture, audio may
  //              start or resume at any time
  //   transient  like Safari at its strictest: only within 1 s of a gesture
  await ctx.addInitScript({ content: `(() => {
    const sticky = ${JSON.stringify((opts.policy ?? 'sticky') === 'sticky')};
    let last = -1e9;
    for (const t of ['pointerdown', 'pointerup', 'mousedown', 'click', 'keydown', 'touchend']) window.addEventListener(t, (e) => { if (e.isTrusted) last = performance.now(); }, true);
    const active = () => (sticky ? last > -1e9 : performance.now() - last < 1000);
    const AC = window.AudioContext;
    class Gated extends AC {
      constructor(o) { super(o); if (!active()) AC.prototype.suspend.call(this); }
      resume() { return active() ? AC.prototype.resume.call(this) : Promise.resolve(); }
    }
    window.AudioContext = Gated;
  })();` });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|status of 404|ERR_FAILED|ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  if (opts.route) await opts.route(page);
  await page.goto(SITE);
  await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
  if (opts.save !== false) {
    await page.evaluate(() => localStorage.setItem('chancla.campaign.v1', JSON.stringify({ v: 1, missions: { ruleros: { completed: true, bestMs: null, challenges: { complete: true, time: false, skill: false }, plays: 1 } } })));
  }
  return { page, errors, close: () => ctx.close() };
}

async function main(): Promise<void> {
  let preview: ChildProcess | null = null;
  if (!process.env.E2E_URL && !(await waitHttp(SITE).catch(() => false))) {
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
    await waitHttp(SITE);
  }
  const executablePath = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p));
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  try {
    // 1. Fresh load; a first event that can't start audio; then a click.
    {
      const { page, errors, close } = await open(browser);
      await page.waitForTimeout(800);
      check('before any interaction, nothing plays and the menu theme is the intended cue', (await state(page)).want === 'menu' && (await state(page)).context === 'locked', short(await state(page)));
      // A synthetic key press is not a user activation: the context can't start.
      await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })));
      await page.waitForTimeout(800);
      const s1 = await state(page);
      check('a non-activating first event leaves audio waiting (not started, not given up)', s1.context !== 'running', short(s1));
      await page.mouse.click(480, 30);
      const s2 = await until(page, menuTheme);
      check('the next real click starts the menu theme, no reload needed', menuTheme(s2) && s2.sounding === 1, short(s2));
      check('flow 1: no page errors', errors.length === 0, errors.slice(0, 3));
      await close();
    }

    // 2. Main menu -> Arcade -> Main menu.
    {
      const { page, errors, close } = await open(browser);
      await page.mouse.click(480, 30);
      await until(page, menuTheme);
      await page.click('#lnk-classic');
      await page.waitForURL(/classic/);
      await page.waitForFunction(() => !!(window as any).__chancla);
      await page.waitForTimeout(800);
      await page.mouse.click(700, 500); // anywhere on the title, not a button
      await page.waitForTimeout(1200);
      const arc = await page.evaluate(() => (window as any).__chancla.snapshot());
      check('Arcade: a click anywhere on its title starts its title music', arc.audioState === 'running' && arc.musicMode === 'title' && arc.musicTimer === true, { audioState: arc.audioState, musicMode: arc.musicMode, timer: arc.musicTimer });
      check('Arcade: its title has a Main menu link', await page.isVisible('#lnk-main'));
      await page.click('#lnk-main');
      await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
      // Arriving by link is a new page: audio must wait for a gesture, then start.
      await page.mouse.click(480, 30);
      const back = await until(page, menuTheme);
      check('back on the main menu, the first click starts the menu theme', menuTheme(back) && back.sounding === 1, short(back));
      // And via the browser's Back button (bfcache where available).
      await page.click('#lnk-classic');
      await page.waitForURL(/classic/);
      await page.waitForTimeout(500);
      await page.goBack();
      await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
      await page.mouse.click(480, 30);
      const bb = await until(page, menuTheme);
      check('after the browser Back button, the menu theme plays on the next click', menuTheme(bb) && bb.sounding === 1, short(bb));
      check('flow 2: no page errors', errors.length === 0, errors.slice(0, 3));
      await close();
    }

    // 3. Main menu -> campaign select -> mission -> back -> main menu.
    {
      const { page, errors, close } = await open(browser);
      await page.mouse.click(480, 30);
      await until(page, menuTheme);
      await page.click('#btn-campaign');
      await page.waitForFunction(() => (window as any).__fps.screen === 'campaign');
      const sel = await until(page, (s) => s.cue === 'select');
      check('campaign select keeps the menu theme going', menuTheme(sel) && sel.sounding === 1, short(sel));
      await page.click('.mcard[data-mission="ruleros"] button');
      await page.click('#btn-mi-start');
      await page.waitForFunction(() => (window as any).__fps.campaign().active);
      const m = await until(page, (s) => s.recording === '66be822e');
      check('the mission plays its pool\'s opening song (Ruleros, 66be822e)', m.recording === '66be822e', short(m));
      await page.evaluate(() => (window as any).__fps.campaign().toSelect());
      await page.waitForFunction(() => (window as any).__fps.screen === 'campaign');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => (window as any).__fps.screen === 'title');
      const t = await until(page, (s) => s.cue === 'menu' && menuTheme(s));
      await page.waitForTimeout(2000); // let the crossfade finish
      check('back on the main menu: the menu theme, one track sounding', menuTheme(t) && (await state(page)).sounding === 1, short(await state(page)));
      check('flow 3: no page errors', errors.length === 0, errors.slice(0, 3));
      await close();
    }

    // 4. Rapid navigation while tracks are still downloading (3 s each).
    {
      const { page, close } = await open(browser, { route: (p) => p.route('**/music/**/*.mp3', async (r) => { await new Promise((res) => setTimeout(res, 3000)); await r.continue(); }) });
      await page.mouse.click(480, 30);
      await page.click('#btn-campaign');
      await page.click('.mcard[data-mission="ruleros"] button');
      await page.click('#btn-mi-start');
      await page.waitForFunction(() => (window as any).__fps.campaign().active);
      await page.waitForTimeout(300);
      await page.evaluate(() => (window as any).__fps.campaign().toSelect());
      await page.waitForFunction(() => (window as any).__fps.screen === 'campaign');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => (window as any).__fps.screen === 'title');
      await page.waitForTimeout(8000); // both downloads have arrived by now
      const s = await state(page);
      check('rapid navigation while loading: the late mission track does not start on the main menu', s.cue === 'menu' && MENU.includes(s.recording ?? '') && s.sounding === 1, short(s));
      await close();
    }

    // 5. Switching tabs and returning.
    {
      const { page, close } = await open(browser);
      await page.mouse.click(480, 30);
      await until(page, menuTheme);
      const setHidden = (h: boolean) => page.evaluate((hidden) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); }, h);
      await setHidden(true);
      await page.waitForTimeout(500);
      const hid = await state(page);
      check('tab hidden: audio pauses', hid.context === 'suspended', short(hid));
      await setHidden(false);
      const ret = await until(page, menuTheme, 4000);
      check('tab shown again: the menu theme resumes on its own', menuTheme(ret) && ret.sounding === 1, short(ret));
      // A suspension the page didn't make (an OS interruption): the next click resumes it.
      await page.evaluate(() => (window as any).__fps.audio().nodes.ctx.suspend());
      await page.waitForTimeout(300);
      await page.mouse.click(480, 30);
      const ext = await until(page, menuTheme, 4000);
      check('after an outside suspension, the next click resumes the music', menuTheme(ext), short(ext));
      await close();
    }
    // 5b. The same under the strict policy: returning can't resume by itself; the next click does.
    {
      const { page, close } = await open(browser, { policy: 'transient' });
      await page.mouse.click(480, 30);
      await until(page, menuTheme);
      await page.waitForTimeout(1200); // the gesture's activation has expired
      const setHidden = (h: boolean) => page.evaluate((hidden) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden }); document.dispatchEvent(new Event('visibilitychange')); }, h);
      await setHidden(true);
      await page.waitForTimeout(300);
      await setHidden(false);
      await page.waitForTimeout(800);
      const waitS = await state(page);
      check('strict policy: back on the tab, audio waits for a gesture (no error, intended cue kept)', waitS.context === 'suspended' && waitS.want === 'menu', short(waitS));
      await page.keyboard.press('KeyX');
      const r = await until(page, menuTheme, 4000);
      check('strict policy: the first key press after returning resumes the menu theme', menuTheme(r) && r.sounding === 1, short(r));
      await close();
    }

    // 6a. Failed download that recovers: fallback, then the retry hands over.
    {
      let fail = true;
      let requests = 0;
      const { page, errors, close } = await open(browser, { route: (p) => p.route(MENU_FILES, (r) => { requests++; return fail ? r.abort() : r.continue(); }) });
      await page.mouse.click(480, 30);
      const fb = await until(page, (s) => s.layer === 'synth');
      check('failed download: the synthesized menu music plays instead', fb.layer === 'synth' && fb.retrying.length === 3, short(fb));
      fail = false;
      const rec = await until(page, menuTheme, 25000);
      check('when the network recovers, a retry brings the menu theme back without a reload', menuTheme(rec) && rec.sounding === 1, { ...short(rec), requests });
      await page.waitForTimeout(2000);
      check('after the hand-over, only one music source is sounding', (await state(page)).sounding === 1 && (await page.evaluate(() => (window as any).__fps.music().state().layer)) === 'recorded');
      check('flow 6a: no page errors', errors.length === 0, errors.slice(0, 3));
      await close();
    }
    // 6b. Failed for good: bounded retries, the fallback keeps playing.
    {
      let requests = 0;
      const { page, close } = await open(browser, { route: (p) => p.route(MENU_FILES, (r) => { requests++; return r.abort(); }) });
      await page.mouse.click(480, 30);
      await page.waitForTimeout(24000);
      const s = await state(page);
      check('failed for good: three attempts per menu song (nine in all), then it stops trying', requests === 9 && s.failed.length === 3, { requests, ...short(s) });
      check('failed for good: the synthesized menu music keeps playing', s.layer === 'synth' && s.context === 'running', short(s));
      await close();
    }

    // 7. Music volume at zero is kept through navigation and a retry.
    {
      let fail = true;
      const { page, close } = await open(browser, { route: (p) => p.route(MENU_FILES, (r) => (fail ? r.abort() : r.continue())) });
      await page.evaluate(() => { const raw = localStorage.getItem('chancla.fps.settings.v1'); void raw; });
      await page.mouse.click(480, 30);
      await page.click('#btn-settings');
      await page.$eval('#set-music', (el) => { (el as HTMLInputElement).value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
      await page.keyboard.press('Escape');
      fail = false;
      await page.click('#btn-campaign');
      await page.waitForTimeout(800);
      await page.keyboard.press('Escape');
      await until(page, menuTheme, 25000);
      const gain = await page.evaluate(() => (window as any).__fps.audio().a.music.gain.value);
      check('music at zero stays silent through navigation, unlock and the retry', gain < 0.001, { gain, ...short(await state(page)) });
      await page.reload();
      await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
      await page.mouse.click(480, 30);
      await page.waitForTimeout(1500);
      const g2 = await page.evaluate(() => (window as any).__fps.audio().a.music.gain.value);
      check('music at zero is still zero after a reload and the first click', g2 < 0.001, { gain: g2 });
      await close();
    }
  } finally {
    await browser.close();
    preview?.kill();
  }
  const passed = checks.filter((c) => c.ok).length;
  fs.writeFileSync(path.join(OUT, 'music-lifecycle-e2e.json'), JSON.stringify({ at: new Date().toISOString(), passed, total: checks.length, checks }, null, 2));
  console.log(`${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exitCode = 1;
}

void main();
