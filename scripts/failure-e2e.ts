// Failure paths, in the real page: what a player sees when something goes
// wrong, and whether they can get out of it. Local game server behind a
// relay that can stall or cut the network; nothing touches production.
//
//   npm run build && node --import tsx scripts/failure-e2e.ts
//
// Covers: a server that never answers, a network that stalls mid-match
// (and comes back, or not), engine and mission code that fails to download,
// WebGL context loss (restored, and not), frames that keep throwing, the
// Copy diagnostics action (clipboard allowed and refused), rapid menu
// toggling while a mission loads, and backgrounding with keys held.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Browser, BrowserContext, Page } from 'playwright-core';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';
import { LatencyProxy } from '../tests/helpers/latency-proxy';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SITE = 'http://localhost:4173/';
const CLIENT_PORT = 8787; // what a localhost page connects to
const GAME_PORT = 8791;
const OUT = path.join(ROOT, 'docs/evidence/failure');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); };

async function waitHttp(url: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}
async function until(p: Page, f: string, ms: number): Promise<boolean> {
  try { await p.waitForFunction(f, undefined, { timeout: ms, polling: 200 }); return true; } catch { return false; }
}

const st = (p: Page) => p.evaluate(() => {
  const f = (window as any).__fps; const s = f.session(); const i = f.input();
  const vis = (id: string) => { const el = document.getElementById(id); return !!el && !el.hidden; };
  return {
    screen: f.screen, inMatch: f.inMatch, conn: s?.state ?? null, held: i?.heldCount ?? -1, enabled: !!i?.enabled,
    crash: vis('scr-crash'), gfx: vis('scr-gfx'), gfxSlow: vis('gfx-slow'), lost: vis('scr-lost'), diagbox: vis('scr-diagbox'),
    banner: vis('banner-conn') ? document.getElementById('banner-conn')!.textContent : '', onlineErr: document.getElementById('online-err')?.textContent ?? '',
    paused: !!f.engine()?.paused, frameErrors: f.engine()?.frameErrors ?? 0,
  };
});

async function newPage(browser: Browser, opts: { clipboard?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript({ content: 'window.__name = (f) => f;' }); // tsx helper names in evaluated functions
  if (opts.clipboard) await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:4173' });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}

async function boot(page: Page): Promise<void> {
  await page.goto(SITE);
  await page.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { timeout: 30000 });
}

async function startPractice(page: Page): Promise<void> {
  await page.click('#btn-practice');
  await page.click('#btn-practice-start');
  await until(page, "(window).__fps.inMatch && (window).__fps.session()?.phase === 'playing'", 20000);
  await page.click('#stage', { force: true }).catch(() => undefined);
  await sleep(300);
}

const loseGl = (page: Page) => page.evaluate(() => {
  const c = document.querySelector('#stage canvas') as HTMLCanvasElement;
  const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGL2RenderingContext;
  (window as any).__loseExt = gl.getExtension('WEBGL_lose_context');
  (window as any).__loseExt.loseContext();
});
const restoreGl = (page: Page) => page.evaluate(() => (window as any).__loseExt.restoreContext());
/** True if whatever is at the centre of the screen belongs to an overlay that blocks play. */
const centreBlocked = (page: Page) => page.evaluate(() => {
  const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  return !!el?.closest('#scr-gfx, #scr-crash, #scr-diagbox');
});

async function main(): Promise<void> {
  const procs: ChildProcess[] = [];
  for (const port of [CLIENT_PORT, GAME_PORT]) {
    const busy = await new Promise<boolean>((r) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
    if (busy) throw new Error(`port ${port} is busy`);
  }
  if (!(await waitHttp(SITE, 1500))) procs.push(spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { cwd: ROOT, stdio: 'ignore' }));
  await waitHttp(SITE);
  const browser: Browser = await launch();
  let proxy: LatencyProxy | null = null;
  try {
    // ------------------------------------------------------------------
    // 1. A server that accepts connections but never answers.
    {
      const held: net.Socket[] = [];
      const hole = net.createServer((s) => { held.push(s); s.on('error', () => undefined); });
      await new Promise<void>((r) => hole.listen(CLIENT_PORT, r));
      const { ctx, page } = await newPage(browser);
      await boot(page);
      await page.click('#btn-online');
      const t0 = Date.now();
      await page.click('#btn-create');
      const gaveUp = await until(page, "!!document.getElementById('online-err')?.textContent && !/Connecting|Conectando/i.test(document.getElementById('online-err').textContent)", 15000);
      const s = await st(page);
      check('server that never answers: the player is told it is unreachable (not stuck on "Connecting…")', gaveUp && s.screen === 'online', { afterS: (Date.now() - t0) / 1000, msg: s.onlineErr });
      await ctx.close();
      for (const h of held) h.destroy();
      await new Promise<void>((r) => hole.close(() => r()));
    }

    // Real game server behind a relay that can stall or cut the network.
    procs.push(spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: ROOT, env: { ...process.env, PORT: String(GAME_PORT), ALLOWED_ORIGINS: 'http://localhost:4173,http://test.local', MATCH_COUNTDOWN_MS: '1000', MATCH_DURATION_MS: '120000' }, stdio: 'ignore' }));
    if (!(await waitHttp(`http://localhost:${GAME_PORT}/healthz`))) throw new Error('game server did not start');
    proxy = new LatencyProxy(CLIENT_PORT, `ws://127.0.0.1:${GAME_PORT}/ws`, 5, 0);

    // ------------------------------------------------------------------
    // 2. Network stalls mid-match, then comes back.
    {
      const host = await newPage(browser);
      const guest = await newPage(browser);
      await boot(host.page); await boot(guest.page);
      await host.page.click('#btn-online'); await host.page.click('#btn-create');
      await until(host.page, "(window).__fps.screen === 'lobby' && !!(window).__fps.code", 10000);
      const code = await host.page.evaluate(() => (window as any).__fps.code);
      await guest.page.goto(`${SITE}#room=${code}`);
      await until(guest.page, "(window).__fps?.screen === 'online'", 15000);
      await guest.page.click('#btn-join');
      await until(guest.page, "(window).__fps.screen === 'lobby'", 10000);
      for (const pg of [host.page, guest.page]) if ((await pg.getAttribute('#btn-ready', 'aria-pressed')) !== 'true') await pg.click('#btn-ready');
      await host.page.waitForFunction(() => !(document.getElementById('btn-start') as HTMLButtonElement).disabled, undefined, { timeout: 15000 });
      await host.page.click('#btn-start');
      const playing = await until(guest.page, "(window).__fps.session()?.phase === 'playing'", 15000);
      check('stall: two browsers in an online match', playing);
      await guest.page.click('#stage', { force: true }).catch(() => undefined);
      // Online: graphics lost mid-match. The match is not paused (it can't be:
      // others are playing), the screen says so, input is released, and
      // server updates keep arriving.
      await guest.page.keyboard.down('w');
      const tl0 = await guest.page.evaluate(() => (window as any).__fps.session().snap?.tl ?? 0);
      await loseGl(guest.page);
      await sleep(1500);
      const og = await st(guest.page);
      const ogText = await guest.page.textContent('#gfx-body');
      const tl1 = await guest.page.evaluate(() => (window as any).__fps.session().snap?.tl ?? 0);
      check('online, graphics lost: says the match keeps going, does not pause it, releases input, updates keep arriving', og.gfx && /keeps going/.test(ogText ?? '') && !og.paused && og.held === 0 && og.conn === 'online' && tl1 !== tl0, { paused: og.paused, held: og.held, tl0, tl1 });
      await guest.page.keyboard.up('w');
      await restoreGl(guest.page);
      await sleep(1200);
      check('online, graphics restored: the notice is gone and nothing blocks the screen', !(await st(guest.page)).gfx && !(await centreBlocked(guest.page)));
      await guest.page.click('#stage', { force: true }).catch(() => undefined);
      await guest.page.keyboard.down('w');
      proxy.stall();
      proxy.interrupt();
      const rec = await until(guest.page, "(window).__fps.session()?.state === 'reconnecting'", 6000);
      const s1 = await st(guest.page);
      check('stall: "Reconnecting…" shows when the network drops', rec && /reconnect/i.test(s1.banner ?? ''), { banner: s1.banner });
      await sleep(9000); // the first reconnect attempt is hung by now
      proxy.unstall();
      const tBack = Date.now();
      await guest.page.evaluate(() => window.dispatchEvent(new Event('online'))); // what the browser fires when the network returns
      const back = await until(guest.page, "(window).__fps.session()?.state === 'online' && (window).__fps.inMatch", 20000);
      check('stall: the browser\'s "online" signal retries at once instead of waiting out a hung attempt', back && Date.now() - tBack < 3000, { seconds: (Date.now() - tBack) / 1000 });
      await guest.page.keyboard.up('w');
      const s2 = await st(guest.page);
      check('stall: when the network returns the player is back in the same match (a hung attempt no longer blocks it)', back && s2.inMatch, { conn: s2.conn });
      await guest.page.screenshot({ path: path.join(OUT, 'reconnected.png') });

      // 3. ...and when it never returns.
      proxy.stall();
      proxy.interrupt();
      const t0 = Date.now();
      const lost = await until(guest.page, "!document.getElementById('scr-lost').hidden", 45000);
      const s3 = await st(guest.page);
      check('network never returns: the "connection lost" screen with a way home, within the grace period', lost && s3.held === 0 && !s3.inMatch, { afterS: (Date.now() - t0) / 1000, held: s3.held });
      await guest.page.screenshot({ path: path.join(OUT, 'lost.png') });
      await guest.page.click('#btn-lost-title');
      check('network never returns: "Main menu" works', (await st(guest.page)).screen === 'title');
      proxy.unstall();
      await host.ctx.close(); await guest.ctx.close();
    }

    // ------------------------------------------------------------------
    // 4. Engine code fails to download at startup.
    {
      const { ctx, page } = await newPage(browser);
      await page.route(/\/assets\/engine-[^/]*\.js$/, (r) => r.abort());
      await page.goto(SITE);
      await page.waitForFunction(() => !document.getElementById('app')?.hasAttribute('hidden'), undefined, { timeout: 30000 });
      const msg = await page.evaluate(() => document.getElementById('webgl-status')?.textContent ?? '');
      const btn = await page.locator('#webgl-status button').count();
      check('engine download fails: says it did not load and offers Reload (not "no 3D graphics")', /did not load/i.test(msg) && !/3D graphics/i.test(msg) && btn === 1, { msg });
      await page.unroute(/\/assets\/engine-[^/]*\.js$/);
      await page.click('#webgl-status button');
      const ok = await until(page, "(window).__fps?.screen === 'title' && !!(window).__fps.engine()", 30000);
      check('engine download fails: Reload brings the game back', ok);
      await ctx.close();
    }

    // ------------------------------------------------------------------
    // 5. Mission code fails to download; rapid menu toggling while it loads.
    {
      const { ctx, page, errors } = await newPage(browser);
      let fail = true;
      await page.route(/\/assets\/runtime-[^/]*\.js$/, (r) => (fail ? r.abort() : r.continue()));
      await boot(page);
      await page.click('#btn-campaign');
      await page.click('.mcard[data-mission="ruleros"] button');
      await until(page, "(window).__fps.screen === 'mintro'", 5000);
      await page.click('#btn-mi-start');
      await until(page, "!document.getElementById('btn-mi-reload').hidden", 10000);
      const msg = await page.textContent('#mi-status');
      check('mission download fails: says so and offers Reload (not "connection to the room ended")', /did not load/i.test(msg ?? '') && !/room/i.test(msg ?? ''), { msg });
      check('mission download fails: no unhandled error from the background prefetch', !errors.some((e) => /dynamically imported/i.test(e)), errors);
      fail = false;
      await page.click('#btn-mi-reload');
      await page.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { timeout: 30000 });
      await page.click('#btn-campaign');
      await page.click('.mcard[data-mission="ruleros"] button');
      await page.click('#btn-mi-start');
      // Hammer the menu while the mission is starting.
      for (let i = 0; i < 12; i++) { await page.keyboard.press('Escape'); await sleep(60); }
      const started = await until(page, '(window).__fps.campaign().active', 20000);
      // Whatever state the toggling left, the player can get back into play.
      if ((await st(page)).screen === 'pause') await page.click('#btn-resume');
      await sleep(400);
      const s = await st(page);
      check('after Reload the mission starts; 12 rapid menu toggles while loading leave a playable state', started && s.screen === 'none' && s.enabled !== undefined && s.held === 0, s);
      await ctx.close();
    }

    // ------------------------------------------------------------------
    // 6. WebGL context loss in a practice match: restored, then not restored.
    {
      const { ctx, page, errors } = await newPage(browser);
      await boot(page);
      await startPractice(page);
      await page.keyboard.down('w');
      const lose = () => page.evaluate(() => {
        const c = document.querySelector('#stage canvas') as HTMLCanvasElement;
        const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGL2RenderingContext;
        (window as any).__loseExt = gl.getExtension('WEBGL_lose_context');
        (window as any).__loseExt.loseContext();
      });
      await lose();
      await sleep(600);
      const s1 = await st(page);
      check('context lost: "Graphics paused" explains it, practice pauses, held keys are released', s1.gfx && s1.screen === 'pause' && s1.held === 0 && s1.paused, s1);
      await page.screenshot({ path: path.join(OUT, 'graphics-paused.png') });
      await page.keyboard.up('w');
      await page.evaluate(() => (window as any).__loseExt.restoreContext());
      await sleep(1500);
      const s2 = await st(page);
      await page.click('#btn-resume');
      await page.click('#stage', { force: true }).catch(() => undefined);
      await sleep(500);
      const fps = await page.evaluate(() => (window as any).__fps.engine().fps);
      check('context restored: the notice goes away, Resume returns to a drawing match, nothing blocks the screen', !s2.gfx && fps > 1 && !(await centreBlocked(page)) && (await st(page)).screen === 'none', { fps });
      await lose();
      await sleep(9000);
      const s3 = await st(page);
      check('context not restored: after 8 s the notice adds that reloading usually fixes it', s3.gfx && s3.gfxSlow);
      check('context loss: no page errors', errors.length === 0, errors);
      await ctx.close();
    }

    // ------------------------------------------------------------------
    // 6b. Graphics lost during a mission: it pauses, then Resume continues it.
    {
      const { ctx, page } = await newPage(browser);
      await boot(page);
      await page.click('#btn-campaign');
      await page.click('.mcard[data-mission="ruleros"] button');
      await page.click('#btn-mi-start');
      await until(page, '(window).__fps.campaign().active', 20000);
      await sleep(3000);
      const rate = async () => { const a = await page.evaluate(() => (window as any).__fps.campaign().runtime.sim.state.timeMs); await sleep(2000); const b = await page.evaluate(() => (window as any).__fps.campaign().runtime.sim.state.timeMs); return { msPerS: Math.round((b - a) / 2), fps: Math.round(await page.evaluate(() => (window as any).__fps.engine().fps)) }; };
      const before = await rate();
      const t0 = await page.evaluate(() => (window as any).__fps.campaign().runtime.sim.state.timeMs);
      await loseGl(page);
      await sleep(2000);
      const t1 = await page.evaluate(() => (window as any).__fps.campaign().runtime.sim.state.timeMs);
      const text = await page.textContent('#gfx-body');
      const sm = await st(page);
      check('mission, graphics lost: the mission pauses (its clock stops) and the screen says so', sm.gfx && sm.screen === 'pause' && Math.abs(t1 - t0) < 200 && /paused/.test(text ?? ''), { clockAdvancedMs: t1 - t0 });
      await restoreGl(page);
      await sleep(1200);
      await page.click('#btn-resume');
      await page.click('#stage', { force: true }).catch(() => undefined);
      const samples: number[] = [];
      for (let i = 0; i < 6; i++) { await sleep(1000); samples.push(await page.evaluate(() => (window as any).__fps.campaign().runtime.sim.state.timeMs)); }
      const t2 = samples.at(-1)!;
      const gaps = await page.evaluate(() => (window as any).__fps.diagText().split('\n').filter((l: string) => / stall /.test(l)).slice(-3));
      // The software renderer recompiles every shader after a restore (a stall of a few
      // seconds here); the check is that the same mission then runs at full speed.
      const after = await rate();
      // Same speed as before the loss (this software renderer is slow in missions either way).
      check('mission, graphics restored: Resume continues the same mission at the same speed as before', after.msPerS >= before.msPerS * 0.8 && after.msPerS > 0 && !(await st(page)).gfx, { before, after, stalls: gaps });
      await ctx.close();
    }

    // ------------------------------------------------------------------
    // 7. Frames that keep throwing: the stopped-picture screen, diagnostics, a way back.
    {
      const { ctx, page } = await newPage(browser, { clipboard: true });
      await boot(page);
      await startPractice(page);
      await page.keyboard.down('w');
      await page.keyboard.down('f');
      await page.evaluate(() => {
        const e = (window as any).__fps.engine();
        (window as any).__calls = 0;
        e.frame = () => { (window as any).__calls++; throw new Error('injected render failure'); };
      });
      const shown = await until(page, "!document.getElementById('scr-crash').hidden", 5000);
      const sc = await st(page);
      check('frames keep failing: "The game stopped" screen appears, held keys are released', shown && sc.held === 0, { held: sc.held });
      const c0 = await page.evaluate(() => (window as any).__calls);
      await sleep(1500);
      const c1 = await page.evaluate(() => (window as any).__calls);
      check('frames keep failing: the failing work is halted (no endless error loop behind the screen)', c1 === c0, { callsDuring1_5s: c1 - c0 });
      const body = await page.textContent('#crash-body');
      check('"The game stopped" explains what going back or reloading costs', /ends the current match or mission/.test(body ?? '') && /kept/.test(body ?? ''));
      await page.keyboard.up('w'); await page.keyboard.up('f');
      await page.screenshot({ path: path.join(OUT, 'game-stopped.png') });
      await page.click('#btn-crash-diag');
      await sleep(300);
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      const code = await page.evaluate(() => (window as any).__fps.code);
      check('Copy diagnostics: the report has the build, mode, the error and the frame-error count', /Chancla Warfare diagnostics/.test(clip) && /"build"/.test(clip) && /injected render failure/.test(clip) && /"frameErrors": \d+/.test(clip) && /"mode": "practice"/.test(clip));
      check('Copy diagnostics: no room code in the report', !code || !clip.includes(code), { code });
      fs.writeFileSync(path.join(OUT, 'diagnostics-sample.txt'), clip);
      await page.evaluate(() => { const e = (window as any).__fps.engine(); delete e.frame; });
      await page.click('#btn-crash-home');
      await sleep(500);
      const s = await st(page);
      check('"Back to the menu" leaves the match and the game draws again', s.screen === 'title' && !s.crash && !s.inMatch && s.frameErrors === 0, s);
      await startPractice(page);
      check('a new practice match starts normally afterwards', (await st(page)).inMatch);
      await ctx.close();
    }

    // ------------------------------------------------------------------
    // 8. Copy diagnostics when the clipboard is refused; background with keys held.
    {
      const { ctx, page } = await newPage(browser);
      await boot(page);
      await startPractice(page);
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
        (document as any).execCommand = () => false;
      });
      await page.keyboard.down('w');
      await page.keyboard.down('d');
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await sleep(300);
      const s1 = await st(page);
      check('backgrounded with W and D held: menu opens, practice pauses, nothing stays held', s1.screen === 'pause' && s1.held === 0 && s1.paused, s1);
      await page.keyboard.up('w'); await page.keyboard.up('d');
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.click('#btn-pause-diag');
      await sleep(300);
      const s2 = await st(page);
      const text = await page.evaluate(() => (document.getElementById('diagbox-text') as HTMLTextAreaElement).value);
      check('clipboard refused: the report is shown in a selectable box instead', s2.diagbox && /Chancla Warfare diagnostics/.test(text) && /visibility hidden/.test(text));
      await page.screenshot({ path: path.join(OUT, 'diagnostics-fallback.png') });
      await page.click('#btn-diagbox-close');
      await page.click('#btn-resume');
      await sleep(300);
      check('back from the background and the box: Resume returns to play', (await st(page)).screen === 'none');
      await ctx.close();
    }
  } finally {
    await browser.close();
    proxy?.close();
    for (const p of procs) p.kill('SIGTERM');
  }
  const passed = checks.filter((c) => c.ok).length;
  fs.writeFileSync(path.join(OUT, 'failure-e2e.json'), JSON.stringify({ at: new Date().toISOString(), environment: 'Chromium 141 headless (SwiftShader), Linux container, local game server behind a stall/cut relay', passed, total: checks.length, checks }, null, 2));
  console.log(`${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
