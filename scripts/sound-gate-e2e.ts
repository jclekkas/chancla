// First-visit sound checks in a real, headed Chromium (its own autoplay
// policy, nothing emulated), with an empty profile each time.
//
//   npm run build && xvfb-run -a node --import tsx scripts/sound-gate-e2e.ts [url]
//
// What a "blocked" browser looks like can't be produced on demand in
// Chromium, so that one case stubs AudioContext.resume() to never succeed.
// It is labelled as simulated in the output.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright-core';

const MENU = ['036c0292', '91dee4c5', '6265def8']; // the menus' songs
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'artifacts/sound');
const SITE = process.argv[2] || process.env.E2E_URL || 'http://localhost:4173/';
fs.mkdirSync(OUT, { recursive: true });
const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); };

async function waitHttp(url: string): Promise<boolean> {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 250)); }
  return false;
}

const gate = (p: Page) => p.evaluate(() => { const g = document.getElementById('sound-gate') as HTMLButtonElement | null; return g ? { shown: !g.hidden, state: g.dataset.state ?? '', text: g.textContent ?? '' } : { shown: false, state: 'missing', text: '' }; });
const fps = (p: Page) => p.evaluate(() => { const w = window as any; const a = w.__fps.audio(); const m = w.__fps.music().state(); return { ctx: a.state, layer: m.layer, rec: m.recording, want: m.want }; });
async function until<T>(f: () => Promise<T>, pred: (v: T) => boolean, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = await f(); if (pred(v) || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 150)); }
}

async function fresh(browser: Browser, url: string, init?: string) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 650 } });
  await ctx.addInitScript({ content: 'window.__name = (f) => f;' });
  if (init) await ctx.addInitScript({ content: init });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  const errors: string[] = [];
  const bad: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (/\/(music|voice)\//.test(r.url()) && r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  await page.goto(url);
  return { page, errors, bad, close: () => ctx.close() };
}

async function main(): Promise<void> {
  let preview: ChildProcess | null = null;
  if (!process.env.E2E_URL && !process.argv[2] && !(await waitHttp(SITE).catch(() => false))) {
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
    await waitHttp(SITE);
  }
  const headed = !!process.env.DISPLAY;
  console.log(`browser: Chromium ${headed ? 'headed (real autoplay policy)' : 'HEADLESS (autoplay relaxed: results are weaker)'} at ${SITE}`);
  const executablePath = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p));
  const browser = await chromium.launch({ executablePath, headless: !headed, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run'] });
  try {
    // 1. Fresh visit: the control is offered; its own click starts audio; it then hides.
    {
      const { page, errors, bad, close } = await fresh(browser, SITE);
      await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
      const g0 = await gate(page);
      check('fresh visit: "Enable sound" is offered before any interaction', g0.shown && g0.state === 'enable', g0);
      await page.click('#sound-gate');
      const s = await until(() => fps(page), (v) => v.ctx === 'running' && v.layer === 'recorded');
      check('clicking it starts audio and the menu theme', s.ctx === 'running' && MENU.includes(s.rec ?? ''), s);
      check('the control hides once audio is really running', !(await gate(page)).shown, await gate(page));
      await page.click('#btn-practice');
      await page.click('#btn-practice-start');
      const pr = await until(() => fps(page), (v) => v.want === 'combat' && v.layer === 'recorded');
      check('Practice: a playlist song plays and the control stays hidden', pr.want === 'combat' && pr.layer === 'recorded' && !(await gate(page)).shown, pr);
      check('no music or voice request failed, no page errors', bad.length === 0 && errors.length === 0, { bad, errors });
      await page.screenshot({ path: path.join(OUT, 'practice-after-enable.png') });
      await close();
    }
    // 2. Fresh visit, first click is the Story button: audio starts from it; mission and return home.
    {
      const { page, close } = await fresh(browser, SITE);
      await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
      await page.click('#btn-campaign');
      const s = await until(() => fps(page), (v) => v.ctx === 'running' && v.layer === 'recorded');
      check('fresh visit, first click on Story: audio starts, no extra step', s.ctx === 'running' && !(await gate(page)).shown, s);
      await page.click('.mcard[data-mission="ruleros"] button');
      await page.click('#btn-mi-start');
      await page.waitForFunction(() => (window as any).__fps.campaign().active);
      const m = await until(() => fps(page), (v) => v.rec === '66be822e');
      check('campaign mission: its pool\'s opening song plays (Ruleros, 66be822e)', m.rec === '66be822e', m);
      await page.evaluate(() => (window as any).__fps.campaign().toSelect());
      await page.waitForFunction(() => (window as any).__fps.screen === 'campaign');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => (window as any).__fps.screen === 'title');
      const h = await until(() => fps(page), (v) => v.want === 'menu' && MENU.includes(v.rec ?? ''));
      check('back home: the menu theme, control hidden', MENU.includes(h.rec ?? '') && !(await gate(page)).shown, h);
      await close();
    }
    // 3. Simulated blocked browser: resume never succeeds. The control must not claim success.
    {
      const block = `(() => { const AC = window.AudioContext; window.__allow = false; class B extends AC { constructor(o) { super(o); AC.prototype.suspend.call(this); } resume() { return window.__allow ? AC.prototype.resume.call(this) : new Promise(() => {}); } } window.AudioContext = B; })();`;
      const { page, close } = await fresh(browser, SITE, block);
      await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
      await page.mouse.click(600, 40);
      const g1 = await until(() => gate(page), (v) => v.state === 'blocked', 4000);
      check('[simulated block] after a click that could not start audio, the control says blocked', g1.shown && g1.state === 'blocked', g1);
      await page.click('#sound-gate');
      await page.waitForTimeout(1800);
      const g2 = await gate(page);
      check('[simulated block] clicking it while still blocked keeps it offered (not shown as enabled)', g2.shown && g2.state === 'blocked', g2);
      check('[simulated block] the game stays playable: menus still work', await page.evaluate(() => { (document.getElementById('btn-campaign') as HTMLButtonElement).click(); return (window as any).__fps.screen === 'campaign'; }));
      await page.evaluate(() => { (window as any).__allow = true; });
      await page.click('#sound-gate');
      const s = await until(() => fps(page), (v) => v.ctx === 'running' && v.layer === 'recorded');
      check('[simulated block] once the browser allows it, the button starts audio and hides', s.ctx === 'running' && !(await gate(page)).shown, s);
      await close();
    }
    // 4. Intentional mute: shown as muted (menus), never as blocked, never overridden.
    {
      const { page, close } = await fresh(browser, SITE);
      await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
      await page.click('#sound-gate');
      await until(() => fps(page), (v) => v.ctx === 'running');
      await page.click('#btn-settings');
      for (const id of ['set-music', 'set-sfx']) await page.$eval(`#${id}`, (el) => { (el as HTMLInputElement).value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      const status = await page.textContent('#sound-status');
      await page.keyboard.press('Escape');
      const g = await until(() => gate(page), (v) => v.state === 'muted', 3000);
      check('muted on purpose: the control says muted, not blocked', g.shown && g.state === 'muted', g);
      check('the Settings status line names the mute', /zero|cero/i.test(status ?? ''), status);
      await page.waitForTimeout(800); // the level ramps to zero over ~0.2 s
      const bus = await page.evaluate(() => (window as any).__fps.audio().a.music.gain.value);
      check('mute is kept (music bus at zero)', bus < 0.001, bus);
      await close();
    }
    // 5. A music track that fails to download: sound is on, the built-in score plays, Settings says so.
    {
      const ctx = await browser.newContext();
      await ctx.addInitScript({ content: 'window.__name = (f) => f;' });
      const page = await ctx.newPage();
      await page.route(/\/music\/playlist\/(08|10|11)-[^/]*\.mp3$/, (r) => r.abort()); // every menu song
      await page.goto(SITE);
      await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
      await page.click('#sound-gate');
      const s = await until(() => fps(page), (v) => v.layer === 'synth');
      await page.click('#btn-settings');
      const status = await page.textContent('#sound-status');
      check('track failure: the built-in score plays, the control is not shown as an error', s.layer === 'synth' && !(await gate(page)).shown, s);
      check('track failure: the Settings status line explains the fallback', /built-in|integrada/i.test(status ?? ''), status);
      await ctx.close();
    }
    // 6. The Arcade: fresh visit, enable, title music, play, back to the main menu.
    {
      const { page, errors, close } = await fresh(browser, new URL('classic.html', SITE).toString());
      await page.waitForFunction(() => !!(window as any).__chancla);
      await page.waitForTimeout(600);
      const g0 = await gate(page);
      check('Arcade fresh visit: "Enable sound" is offered', g0.shown && g0.state === 'enable', g0);
      await page.click('#sound-gate');
      await page.waitForTimeout(1200);
      const a = await page.evaluate(() => (window as any).__chancla.snapshot());
      check('Arcade: the button starts audio and its title music', a.audioState === 'running' && a.musicTimer === true && !(await gate(page)).shown, { audio: a.audioState, timer: a.musicTimer });
      await page.click('#btn-play');
      await page.click('#btn-maps-start'); // Play opens the map choice first
      await page.waitForFunction(() => (window as any).__chancla.snapshot().state === 'playing');
      await page.waitForTimeout(1500);
      check('Arcade run: the control stays hidden', !(await gate(page)).shown);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      await page.click('#btn-pause-home');
      await page.click('#btn-confirm-yes');
      await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
      const g1 = await gate(page);
      check('Arcade -> Main menu: a new page, so sound waits for a gesture and says so', g1.shown && g1.state === 'enable', g1);
      await page.mouse.click(600, 40);
      const s = await until(() => fps(page), (v) => v.ctx === 'running' && MENU.includes(v.rec ?? ''));
      check('one click on the main menu brings the theme back', MENU.includes(s.rec ?? '') && !(await gate(page)).shown, s);
      check('Arcade: no page errors', errors.length === 0, errors);
      await close();
    }
  } finally {
    await browser.close();
    preview?.kill();
  }
  const passed = checks.filter((c) => c.ok).length;
  fs.writeFileSync(path.join(OUT, 'sound-gate-e2e.json'), JSON.stringify({ at: new Date().toISOString(), site: SITE, headed, passed, total: checks.length, checks }, null, 2));
  console.log(`${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exitCode = 1;
}

void main();
