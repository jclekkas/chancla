// Touch Arcade checks in Chromium's mobile emulation: a phone-sized
// viewport with touch input, multi-touch sent over the DevTools protocol
// (real touch points with separate ids, so the page receives one pointer per
// finger). This is EMULATION on a desktop CPU with software rendering: it
// proves the input, layout and lifecycle logic, not how a real phone feels
// or performs.
//
//   npm run build && node --import tsx scripts/touch-e2e.ts [--round]
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright-core';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'artifacts/touch');
const SHOTS = path.join(ROOT, 'docs/evidence/mobile');
const SITE = process.env.E2E_URL || 'http://localhost:4173/';
const ROUND = process.argv.includes('--round');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LAND = { width: 844, height: 390 };
const PORT = { width: 390, height: 844 };

async function waitHttp(url: string): Promise<boolean> {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

const PROBE = `(() => {
  let live = 0; const reg = new WeakMap();
  const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (t, f, o) { if (f && (this === window || this === document)) { let m = reg.get(this); if (!m) reg.set(this, m = new Set()); const k = t + '|' + (typeof o === 'object' ? !!o?.capture : !!o) + '#' + (f.__id ||= Math.random()); if (!m.has(k)) { m.add(k); live++; } } return add.call(this, t, f, o); };
  EventTarget.prototype.removeEventListener = function (t, f, o) { const m = reg.get(this); if (m && f && f.__id && m.delete(t + '|' + (typeof o === 'object' ? !!o?.capture : !!o) + '#' + f.__id)) live--; return rem.call(this, t, f, o); };
  window.__probe = { listeners: () => live };
  window.__name = (f) => f;
})();`;

async function phone(browser: Browser, opts: { runs?: number; settings?: Record<string, unknown> } = {}): Promise<{ ctx: BrowserContext; page: Page; cdp: CDPSession; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: LAND, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript({ content: PROBE });
  if (opts.runs !== undefined || opts.settings) {
    await ctx.addInitScript({ content: `try { ${opts.runs !== undefined ? `localStorage.setItem('chancla.progress.v1', JSON.stringify({ runs: ${opts.runs} }));` : ''} ${opts.settings ? `localStorage.setItem('chancla.settings.v1', ${JSON.stringify(JSON.stringify(opts.settings))});` : ''} } catch {}` });
  }
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|8787|status of 404/.test(m.text())) errors.push(m.text()); });
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp, errors };
}

type Pt = { x: number; y: number; id: number };
const touch = (cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: Pt[]) =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 8, radiusY: 8, force: 1 })) });
async function tapAt(cdp: CDPSession, x: number, y: number): Promise<void> { await touch(cdp, 'touchStart', [{ x, y, id: 9 }]); await sleep(60); await touch(cdp, 'touchEnd', []); }
async function tap(page: Page, cdp: CDPSession, sel: string): Promise<void> {
  await page.locator(sel).scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined); // a user scrolls a long panel too
  const b = await page.locator(sel).boundingBox();
  if (!b) throw new Error(`no ${sel}`);
  await tapAt(cdp, b.x + b.width / 2, b.y + b.height / 2);
  await sleep(150);
}

const arcade = (p: Page) => p.evaluate(() => {
  const w = window as any; const a = w.__chancla.app; const g = a.game; const s = w.__chancla.snapshot();
  return { state: s.state, phase: g.phase, touch: s.touch, x: +g.player.pos.x.toFixed(2), z: +g.player.pos.z.toFixed(2), yaw: +g.player.yaw.toFixed(3), held: g.chanclas.heldCount(), runTime: +g.runTime.toFixed(2), hp: g.player.hp, map: g.mapId, loops: s.loops, audio: s.audioState, enemies: g.enemies.pool.filter((e: any) => e.alive).length, controls: !document.getElementById('touch')!.hidden, rotate: !document.getElementById('rotate-hint')!.hidden };
});

async function startRun(page: Page, cdp: CDPSession, map: string): Promise<void> {
  await tap(page, cdp, '#btn-play');
  await tap(page, cdp, `.map-card[data-map="${map}"]`);
  await tap(page, cdp, '#btn-maps-start');
  await page.waitForFunction(() => (window as any).__chancla.snapshot().state === 'playing', undefined, { timeout: 20000 });
  await sleep(400);
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
    // ---- Main page on a phone: the mobile card, copy link, Touch Beta.
    {
      const { ctx, page, cdp, errors } = await phone(browser);
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.setViewportSize(PORT);
      await page.goto(SITE);
      await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
      await sleep(500);
      const g = await page.evaluate(() => ({ gate: !document.getElementById('mobile-gate')!.hidden, modes: getComputedStyle(document.getElementById('title-actions')!).display, overflow: document.documentElement.scrollWidth > innerWidth }));
      check('phone: the main page shows the mobile card, hides computer-only modes, no sideways scroll', g.gate && g.modes === 'none' && !g.overflow, g);
      await page.screenshot({ path: path.join(SHOTS, 'phone-portrait-home.png') });
      await tap(page, cdp, '#btn-copy-link');
      await sleep(300);
      const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
      check('phone: "Copy link to play on a computer" copies the site address', clip.startsWith('http'), clip);
      await tap(page, cdp, '#btn-mg-more');
      await tap(page, cdp, '#btn-practice');
      check('phone: a computer-only mode explains itself instead of starting', (await page.evaluate(() => (window as any).__fps.screen)) === 'title' && (await page.isVisible('#toast')));
      await page.setViewportSize(LAND);
      await sleep(300);
      await page.screenshot({ path: path.join(SHOTS, 'phone-landscape-home.png') });
      const href = await page.getAttribute('#lnk-touch-arcade', 'href');
      check('phone: "Play Arcade · Touch Beta" leads to the Arcade', /classic\.html$/.test(href ?? ''), href);
      check('main page on a phone: no page errors', errors.length === 0, errors.slice(0, 3));
      await ctx.close();
    }
    // ---- A tablet with a trackpad is a computer: no card.
    {
      // Chromium's touch emulation always reports a coarse pointer, so the
      // trackpad is simulated by answering the fine-pointer and hover queries.
      const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
      await ctx.addInitScript({ content: `window.__name = (f) => f; const mm = window.matchMedia.bind(window); window.matchMedia = (q) => /any-pointer: fine|any-hover: hover/.test(q) ? Object.defineProperty(mm(q), 'matches', { value: true }) : mm(q);` });
      const page = await ctx.newPage();
      await page.goto(SITE);
      await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
      check('touch screen with a fine pointer (tablet + trackpad, touch laptop): full menu, no card', await page.evaluate(() => document.getElementById('mobile-gate')!.hidden));
      await ctx.close();
    }

    // ---- The Arcade on a phone (landscape), first visit, sound, then play.
    {
      const { ctx, page, cdp, errors } = await phone(browser, { runs: 1 });
      await page.goto(new URL('classic.html', SITE).toString());
      await page.waitForFunction(() => !!(window as any).__chancla);
      await sleep(600);
      check('Arcade on a phone: touch mode, and "Enable sound" offered', (await arcade(page)).touch && (await page.isVisible('#sound-gate')));
      await page.screenshot({ path: path.join(SHOTS, 'arcade-landscape-title.png') });
      await tap(page, cdp, '#sound-gate');
      await sleep(800);
      check('tapping Enable sound starts audio, then the control hides', (await arcade(page)).audio === 'running' && !(await page.isVisible('#sound-gate')));
      await tap(page, cdp, '#btn-play');
      await page.screenshot({ path: path.join(SHOTS, 'arcade-landscape-maps.png') });
      await tap(page, cdp, '.map-card[data-map="plaza"]');
      await tap(page, cdp, '#btn-maps-start');
      await page.waitForFunction(() => (window as any).__chancla.snapshot().state === 'playing', undefined, { timeout: 20000 });
      await sleep(1500);
      let s = await arcade(page);
      check('touch run starts with the on-screen controls', s.state === 'playing' && s.controls, s);
      await page.screenshot({ path: path.join(SHOTS, 'arcade-landscape-play.png') });
      // Sizes and placement: 44 px minimum, larger primary button, inside the safe area.
      const sizes = await page.evaluate(() => ['t-throw', 't-recall', 't-special', 'btn-pause'].map((id) => { const r = document.getElementById(id)!.getBoundingClientRect(); return { id, w: Math.round(r.width), h: Math.round(r.height), inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }; }));
      check('touch targets: all at least 44 px and on screen; Throw is the largest', sizes.every((x) => x.w >= 44 && x.h >= 44 && x.inView) && sizes[0]!.w >= Math.max(...sizes.slice(1).map((x) => x.w)), sizes);
      const overlap = await page.evaluate(() => {
        const r = (id: string) => document.getElementById(id)!.getBoundingClientRect();
        const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const hp = document.querySelector('.hud-tl')!.getBoundingClientRect();
        return ['t-throw', 't-recall', 't-special'].some((id) => hit(r(id), hp));
      });
      check('the buttons stay clear of health and the HUD', !overlap);
      // Move, aim and throw at the same time: three fingers, three pointer ids.
      const thr = (await page.locator('#t-throw').boundingBox())!;
      const tx = thr.x + thr.width / 2, ty = thr.y + thr.height / 2;
      const before = await arcade(page);
      const stick0 = { x: 120, y: 300, id: 1 }, look0 = { x: 560, y: 160, id: 2 }, throw0 = { x: tx, y: ty, id: 3 };
      await touch(cdp, 'touchStart', [stick0]);
      await touch(cdp, 'touchStart', [stick0, look0]);
      await touch(cdp, 'touchStart', [stick0, look0, throw0]);
      for (let i = 1; i <= 12; i++) {
        await touch(cdp, 'touchMove', [{ x: 120, y: 300 - Math.min(50, i * 6), id: 1 }, { x: 560 + i * 6, y: 160, id: 2 }, throw0]);
        await sleep(90);
      }
      await sleep(600);
      const during = await arcade(page);
      await touch(cdp, 'touchEnd', [throw0]); // over CDP, touchEnd lifts the listed fingers: only the throw
      await sleep(400);
      const thrown = await arcade(page);
      await touch(cdp, 'touchEnd', []);
      await sleep(300);
      const moved = Math.hypot(during.x - before.x, during.z - before.z);
      check('simultaneous: the stick moves Rosa while the other fingers aim and hold a throw', moved > 0.6, { moved: +moved.toFixed(2) });
      check('simultaneous: dragging on the right turns the view', Math.abs(during.yaw - before.yaw) > 0.05, { from: before.yaw, to: during.yaw });
      check('simultaneous: releasing the Throw button throws (one chancla leaves her hand)', thrown.held < before.held, { before: before.held, after: thrown.held });
      // An interrupted touch (the browser cancels it): the stick lets go.
      await touch(cdp, 'touchStart', [{ x: 120, y: 300, id: 4 }]);
      await touch(cdp, 'touchMove', [{ x: 120, y: 240, id: 4 }]);
      await sleep(300);
      await touch(cdp, 'touchCancel', []);
      await sleep(700); // let her normal deceleration finish, then look for a stuck stick
      const a1 = await arcade(page);
      await sleep(500);
      const a2 = await arcade(page);
      check('a cancelled touch leaves no held movement', Math.hypot(a2.x - a1.x, a2.z - a1.z) < 0.05, { drift: +Math.hypot(a2.x - a1.x, a2.z - a1.z).toFixed(3) });
      // Pause by the button: the run stops; Resume by a tap neither moves nor throws.
      await tap(page, cdp, '#btn-pause');
      s = await arcade(page);
      const r0 = s.runTime, h0 = s.hp, held0 = s.held;
      await sleep(1500);
      s = await arcade(page);
      check('Pause button: the run, enemies and damage stop', s.state === 'paused' && s.runTime === r0 && s.hp === h0, { r0, r1: s.runTime });
      await page.screenshot({ path: path.join(SHOTS, 'arcade-landscape-pause.png') });
      const p0 = await arcade(page);
      await tap(page, cdp, '#btn-resume');
      await sleep(500);
      const p1 = await arcade(page);
      check('Resume by tap: back in play, no step and no throw from that tap', p1.state === 'playing' && Math.hypot(p1.x - p0.x, p1.z - p0.z) < 0.05 && p1.held >= held0 - 0, { moved: +Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(3), held: [held0, p1.held] });
      // Switching apps or locking the phone: the page is hidden; the run pauses safely.
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(300);
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(300);
      check('switching apps / locking the phone leaves the run paused', (await arcade(page)).state === 'paused');
      await tap(page, cdp, '#btn-resume');
      await sleep(300);
      // Rotation mid-touch: portrait pauses with the rotate screen, and the held finger is dropped.
      await touch(cdp, 'touchStart', [{ x: 120, y: 300, id: 5 }]);
      await touch(cdp, 'touchMove', [{ x: 120, y: 240, id: 5 }]);
      await sleep(200);
      await page.setViewportSize(PORT);
      await sleep(500);
      s = await arcade(page);
      check('turning to portrait pauses the run and shows the rotate screen', s.state === 'paused' && s.rotate, s);
      await page.screenshot({ path: path.join(SHOTS, 'arcade-portrait-rotate.png') });
      await page.setViewportSize(LAND);
      await touch(cdp, 'touchEnd', []);
      await sleep(500);
      s = await arcade(page);
      check('back to landscape: the rotate screen goes, the run waits paused for Resume', s.state === 'paused' && !s.rotate);
      const q0 = await arcade(page);
      await tap(page, cdp, '#btn-resume');
      await sleep(500);
      const q1 = await arcade(page);
      check('after rotating mid-touch, nothing is still held', Math.hypot(q1.x - q0.x, q1.z - q0.z) < 0.05, { moved: +Math.hypot(q1.x - q0.x, q1.z - q0.z).toFixed(3) });
      // Restart keeps the map; Change map; Settings has touch sensitivity.
      await tap(page, cdp, '#btn-pause');
      await tap(page, cdp, '#btn-restart');
      await sleep(400);
      check('Restart keeps the map', (await arcade(page)).map === 'plaza' && (await arcade(page)).state === 'playing');
      await tap(page, cdp, '#btn-pause');
      await tap(page, cdp, '#btn-pause-settings');
      check('Settings (from pause) has touch aim sensitivity', await page.isVisible('#set-tsens'));
      await page.screenshot({ path: path.join(SHOTS, 'arcade-landscape-settings.png') });
      await tap(page, cdp, '#btn-settings-close');
      await tap(page, cdp, '#btn-pause-maps');
      await tap(page, cdp, '#btn-confirm-yes');
      check('Change map (confirmed) opens the map choice', await page.isVisible('#modal-maps'));
      await tap(page, cdp, '#btn-maps-back');
      // Every map: touch play, collisions and enemies arriving and moving.
      for (const map of ['patio', 'plaza', 'fiesta']) {
        await startRun(page, cdp, map);
        const bd = await page.evaluate(() => { const b = (window as any).__chancla.app.game.arena.bounds; return b ?? { minX: -26, maxX: 26, minZ: -26, maxZ: 26 }; });
        // Walk into the scenery in several directions with the stick and look drags.
        for (let k = 0; k < 4; k++) {
          await touch(cdp, 'touchStart', [{ x: 120, y: 300, id: 6 }, { x: 560, y: 160, id: 7 }]);
          for (let i = 0; i < 6; i++) { await touch(cdp, 'touchMove', [{ x: 120, y: 250, id: 6 }, { x: 560 + (i + 1) * 15, y: 160, id: 7 }]); await sleep(100); }
          await sleep(900);
          await touch(cdp, 'touchEnd', []);
        }
        const st = await arcade(page);
        const inside = await page.evaluate(() => { const g = (window as any).__chancla.app.game; const p = g.player.pos; return !g.arena.colliders.some((b: any) => b.maxY > 0.35 && b.minY < 1.8 && p.x > b.minX + 0.05 && p.x < b.maxX - 0.05 && p.z > b.minZ + 0.05 && p.z < b.maxZ - 0.05); });
        check(`${map}: touch movement keeps Rosa inside the arena and out of the scenery`, inside && st.x > bd.minX && st.x < bd.maxX && st.z > bd.minZ && st.z < bd.maxZ, { x: st.x, z: st.z });
        await page.waitForFunction(() => (window as any).__chancla.app.game.enemies.pool.some((e: any) => e.alive), undefined, { timeout: 30000 }).catch(() => undefined);
        const e0 = await page.evaluate(() => (window as any).__chancla.app.game.enemies.pool.filter((e: any) => e.alive).map((e: any) => [e.pos.x, e.pos.z]));
        await sleep(1500);
        const e1 = await page.evaluate(() => (window as any).__chancla.app.game.enemies.pool.filter((e: any) => e.alive).map((e: any) => [e.pos.x, e.pos.z]));
        const movedEnemies = e1.filter((p: number[], i: number) => e0[i] && Math.hypot(p[0]! - e0[i]![0]!, p[1]! - e0[i]![1]!) > 0.2).length;
        check(`${map}: enemies arrive and walk the map`, e0.length > 0 && movedEnemies > 0, { alive: e0.length, moving: movedEnemies });
        if (map === 'fiesta') await page.screenshot({ path: path.join(SHOTS, 'arcade-landscape-fiesta.png') });
        await tap(page, cdp, '#btn-pause');
        await tap(page, cdp, '#btn-to-title');
        await sleep(300);
      }
      const lead = await arcade(page);
      const listeners = await page.evaluate(() => (window as any).__probe.listeners());
      check('after several runs and map switches: one game loop, one audio context', lead.loops === 1 && (await page.evaluate(() => (window as any).__chancla.snapshot().audioContexts)) === 1, { loops: lead.loops });
      check('listeners on window/document stay bounded', listeners < 80, listeners);
      // Main menu from the Arcade, on a phone.
      await tap(page, cdp, '#btn-play');
      await tap(page, cdp, '#btn-maps-start');
      await page.waitForFunction(() => (window as any).__chancla.snapshot().state === 'playing');
      await tap(page, cdp, '#btn-pause');
      await tap(page, cdp, '#btn-pause-home');
      await tap(page, cdp, '#btn-confirm-yes');
      await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
      check('Main menu from the Arcade returns to the phone menu', await page.evaluate(() => !document.getElementById('mobile-gate')!.hidden));
      check('Arcade on a phone: no page errors', errors.length === 0, errors.slice(0, 4));
      await ctx.close();
    }
    // ---- Mute persists across a reload (and the sound control says muted, not blocked).
    {
      const { ctx, page, cdp } = await phone(browser, { runs: 1, settings: { muted: true } });
      await page.goto(new URL('classic.html', SITE).toString());
      await page.waitForFunction(() => !!(window as any).__chancla);
      await tap(page, cdp, '#btn-play');
      await tap(page, cdp, '#btn-maps-back');
      await sleep(600);
      const m = await page.evaluate(() => ({ master: (window as any).__chancla.app && (window as any).__audio?.a?.master?.gain?.value, gate: (document.getElementById('sound-gate') as HTMLElement).dataset.state }));
      check('a saved mute stays muted after a reload; the control reads "muted"', m.gate === 'muted', m);
      await ctx.close();
    }
    // ---- One complete round on a phone (optional: slow in software rendering).
    if (ROUND) {
      const { ctx, page, cdp } = await phone(browser, { runs: 1, settings: { quality: 'low' } });
      await page.goto(new URL('classic.html', SITE).toString());
      await page.waitForFunction(() => !!(window as any).__chancla);
      await startRun(page, cdp, 'fiesta');
      // Keep moving with the stick and throwing at whatever is ahead until the run ends.
      const end = Date.now() + 14 * 60 * 1000;
      const thr = (await page.locator('#t-throw').boundingBox())!;
      let i = 0;
      while (Date.now() < end && (await arcade(page)).state === 'playing') {
        await touch(cdp, 'touchStart', [{ x: 120, y: 300, id: 1 }, { x: thr.x + thr.width / 2, y: thr.y + thr.height / 2, id: 3 }]);
        await touch(cdp, 'touchMove', [{ x: 120 + Math.sin(i) * 40, y: 300 - Math.cos(i) * 40, id: 1 }, { x: thr.x + thr.width / 2 + Math.sin(i * 0.7) * 30, y: thr.y + thr.height / 2, id: 3 }]);
        await sleep(450);
        await touch(cdp, 'touchEnd', []);
        await sleep(150);
        i++;
      }
      const last = await arcade(page);
      const done = await page.waitForSelector('#screen-results:not([hidden])', { timeout: 15000 }).then(() => true, () => false);
      const won = await page.evaluate(() => (window as any).__chancla.app.lastResult?.victory ?? null);
      check('a complete round on a phone ends on the results screen', done, { state: last.state, runTime: last.runTime, victory: won });
      if (done) await page.screenshot({ path: path.join(SHOTS, 'arcade-landscape-results.png') });
      await ctx.close();
    }
  } finally {
    await browser.close();
    preview?.kill();
  }
  const passed = checks.filter((c) => c.ok).length;
  fs.writeFileSync(path.join(OUT, 'touch-e2e.json'), JSON.stringify({ at: new Date().toISOString(), environment: 'Chromium 141 mobile emulation (844x390 landscape / 390x844 portrait, touch, DPR 2), headless, SwiftShader. NOT a real phone.', passed, total: checks.length, checks }, null, 2));
  console.log(`${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exitCode = 1;
}

void main();
