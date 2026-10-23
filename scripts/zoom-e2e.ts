// Unexpected zoom on phones: regression checks in Chromium's mobile
// emulation (touch, DPR 2), pinches and taps sent as real multi-touch over
// the DevTools protocol. Chromium's emulation pinch-zooms the page like
// Android Chrome does, so a pinch the page fails to block shows up in
// visualViewport.scale. It does NOT reproduce iOS Safari's zoom-on-focus (that
// is checked statically: text fields at 16 px or more) or iOS-specific
// gesture handling. Not a real iPhone or Android phone.
//
//   npm run build && node --import tsx scripts/zoom-e2e.ts
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright-core';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SITE = process.env.E2E_URL || 'http://localhost:4173/';
const OUT = path.join(ROOT, 'docs/evidence/mobile-mp');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); };

async function waitHttp(url: string): Promise<boolean> {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

interface Phone { ctx: BrowserContext; p: Page; cdp: CDPSession; errors: string[] }
async function phone(browser: Browser, vp = { width: 844, height: 390 }): Promise<Phone> {
  const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript({ content: 'window.__name = (f) => f; localStorage.setItem("chancla.progress.v1", JSON.stringify({ runs: 1 }));' });
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  return { ctx, p, cdp: await ctx.newCDPSession(p), errors };
}
type Pt = { x: number; y: number; id: number };
const T = (cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', pts: Pt[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q) => ({ ...q, radiusX: 8, radiusY: 8, force: 1 })) });
const scale = (p: Page) => p.evaluate(() => +(visualViewport?.scale ?? 1).toFixed(3));
/** Two fingers spreading apart (out = false) or closing in (out = true) around a point. */
async function pinch(f: Phone, cx: number, cy: number, out = false): Promise<void> {
  const d = (i: number) => (out ? 20 + (10 - i) * 14 : 20 + i * 14);
  await T(f.cdp, 'touchStart', [{ x: cx - d(0), y: cy, id: 21 }, { x: cx + d(0), y: cy, id: 22 }]);
  for (let i = 1; i <= 10; i++) { await T(f.cdp, 'touchMove', [{ x: cx - d(i), y: cy, id: 21 }, { x: cx + d(i), y: cy, id: 22 }]); await sleep(30); }
  await T(f.cdp, 'touchEnd', [{ x: cx, y: cy, id: 21 }, { x: cx, y: cy, id: 22 }]);
  await sleep(350);
}
async function tapAt(f: Phone, x: number, y: number, id = 30): Promise<void> {
  await T(f.cdp, 'touchStart', [{ x, y, id }]);
  await sleep(40);
  await T(f.cdp, 'touchEnd', [{ x, y, id }]);
}
async function center(p: Page, sel: string): Promise<{ x: number; y: number }> {
  const b = (await p.locator(sel).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function practice(f: Phone): Promise<void> {
  await f.p.goto(SITE);
  await f.p.waitForFunction(() => (window as any).__fps?.screen === 'title');
  await f.p.evaluate(() => (document.getElementById('btn-mg-practice') as HTMLElement).click());
  await sleep(200);
  await f.p.evaluate(() => (document.getElementById('btn-practice-start') as HTMLElement).click());
  await f.p.waitForFunction(() => (window as any).__fps.inMatch && !!(window as any).__fps.touch()?.visible, undefined, { timeout: 30000 });
  await sleep(1500);
}
const view = (p: Page) => p.evaluate(() => {
  const f = (window as any).__fps; const v = f.engine().viewSize; const m = document.getElementById('btn-menu')!.getBoundingClientRect();
  return { ...v, iw: innerWidth, ih: innerHeight, scrollY, menu: { x: Math.round(m.x), y: Math.round(m.y), r: Math.round(m.right), b: Math.round(m.bottom), w: Math.round(m.width), h: Math.round(m.height) }, held: f.input().heldCount, shots: f.session()?.localShot ?? 0, controls: !!f.touch()?.visible, zoomNote: !document.getElementById('zoom-note')!.hidden, enabled: f.input().enabled };
});
const sized = (v: { css: number[]; buffer: number[]; aspect: number; iw: number; ih: number }) =>
  v.css[0] === v.iw && v.css[1] === v.ih && Math.abs(v.aspect - v.css[0]! / v.css[1]!) < 0.01 && Math.abs(v.buffer[0]! / v.buffer[1]! - v.css[0]! / v.css[1]!) < 0.02;

async function main(): Promise<void> {
  let preview: ChildProcess | null = null;
  if (!process.env.E2E_URL && !(await waitHttp(SITE).catch(() => false))) {
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
    await waitHttp(SITE);
  }
  const executablePath = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find((x) => fs.existsSync(x));
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  try {
    // 1. Static causes: viewport, text-field sizes (iOS zooms on focus under 16 px), button touch-action.
    for (const page of ['', 'classic.html']) {
      const f = await phone(browser);
      await f.p.goto(new URL(page, SITE).toString());
      await f.p.waitForTimeout(1500);
      const s = await f.p.evaluate(() => ({
        meta: document.querySelector('meta[name=viewport]')?.getAttribute('content') ?? '',
        small: [...document.querySelectorAll('input, select, textarea')].filter((e) => !['range', 'checkbox', 'radio', 'hidden'].includes((e as HTMLInputElement).type)).map((e) => ({ id: e.id || e.className, px: parseFloat(getComputedStyle(e).fontSize) })).filter((x) => x.px < 16),
        buttons: [...document.querySelectorAll('button, a.btn')].map((b) => getComputedStyle(b).touchAction).filter((ta) => ta !== 'manipulation' && ta !== 'none').length,
      }));
      const name = page || 'main page';
      check(`${name}: viewport allows zoom for accessibility (no user-scalable=no / maximum-scale)`, /width=device-width/.test(s.meta) && !/user-scalable\s*=\s*no|maximum-scale/.test(s.meta), s.meta);
      check(`${name}: every text field and select is at least 16 px on a touch screen (no iOS focus zoom)`, s.small.length === 0, s.small);
      check(`${name}: every button blocks double-tap zoom (touch-action manipulation or none)`, s.buttons === 0, s.buttons);
      await f.ctx.close();
    }

    // 2. Pinches started anywhere on the play screen don't zoom (each in a fresh page).
    const spots: Array<[string, (p: Page) => Promise<{ x: number; y: number }>]> = [
      ['the look area', async () => ({ x: 620, y: 200 })],
      ['the move area', async () => ({ x: 150, y: 300 })],
      ['the top-left gap', async () => ({ x: 150, y: 60 })],
      ['across stick and look', async () => ({ x: 340, y: 250 })],
      ['the menu button', (p) => center(p, '#btn-menu')],
      ['the Throw button', (p) => center(p, '#ft-throw')],
      ['the HUD score', (p) => center(p, '.hud-top')],
    ];
    for (const [name, at] of spots) {
      const f = await phone(browser);
      await practice(f);
      const c = await at(f.p);
      await pinch(f, c.x, c.y);
      check(`in play: a pinch starting on ${name} does not zoom`, (await scale(f.p)) === 1, await scale(f.p));
      await f.ctx.close();
    }
    {
      const f = await phone(browser);
      await practice(f);
      await f.p.evaluate(() => (window as any).__fps.input().toggleScoreboard());
      await sleep(300);
      await pinch(f, 422, 195);
      check('in play: a pinch on the open scoreboard does not zoom', (await scale(f.p)) === 1, await scale(f.p));
      await f.ctx.close();
    }

    // 3. Repeated Throw taps, then move + aim + throw together: no zoom, nothing held.
    {
      const f = await phone(browser);
      await practice(f);
      const thr = await center(f.p, '#ft-throw');
      const v0 = await view(f.p);
      for (let i = 0; i < 8; i++) { await tapAt(f, thr.x, thr.y, 40 + i); await sleep(90); } // double and triple taps
      await sleep(400);
      let v = await view(f.p);
      check('repeated quick Throw taps: no zoom, they throw, nothing held', (await scale(f.p)) === 1 && v.shots > v0.shots && v.held === 0, { scale: await scale(f.p), shots: v.shots - v0.shots, held: v.held });
      const jump = await center(f.p, '#ft-jump');
      for (let i = 0; i < 4; i++) { await tapAt(f, jump.x, jump.y, 60 + i); await sleep(80); }
      check('repeated quick taps on Jump: no zoom', (await scale(f.p)) === 1);
      const stick = { x: 110, y: 290, id: 1 }, look = { x: 560, y: 170, id: 2 }, tp = { ...thr, id: 3 };
      await T(f.cdp, 'touchStart', [stick]);
      await T(f.cdp, 'touchStart', [stick, look]);
      await T(f.cdp, 'touchStart', [stick, look, tp]);
      for (let i = 1; i <= 10; i++) { await T(f.cdp, 'touchMove', [{ ...stick, y: 290 - i * 5, x: 110 + i * 3 }, { ...look, x: 560 + i * 8, y: 170 + i * 3 }, tp]); await sleep(60); }
      await T(f.cdp, 'touchEnd', [stick, look, tp]);
      await sleep(300);
      v = await view(f.p);
      check('three fingers at once (move, aim, throw): no zoom, nothing held', (await scale(f.p)) === 1 && v.held === 0, { scale: await scale(f.p), held: v.held });
      check('the canvas and camera still match the screen', sized(v), v);
      await f.ctx.close();
    }

    // 4. Zoomed in a menu first (accessibility zoom), then play: never stuck.
    {
      const f = await phone(browser);
      await f.p.goto(SITE);
      await f.p.waitForFunction(() => (window as any).__fps?.screen === 'title');
      await pinch(f, 420, 200);
      const z = await scale(f.p);
      check('menus keep pinch zoom (accessibility)', z > 1.5, z);
      await f.p.evaluate(() => (document.getElementById('btn-mg-practice') as HTMLElement).click());
      await sleep(200);
      await f.p.evaluate(() => (document.getElementById('btn-practice-start') as HTMLElement).click());
      await f.p.waitForFunction(() => (window as any).__fps.inMatch, undefined, { timeout: 30000 });
      await sleep(1200);
      let v = await view(f.p);
      check('starting play while zoomed: a "pinch out" notice, controls and input held back', v.zoomNote && !v.controls && !v.enabled, { note: v.zoomNote, controls: v.controls });
      const vis = await f.p.evaluate(() => { const vv = visualViewport!; const r = document.getElementById('zoom-note-title')!.getBoundingClientRect(); return { inside: r.left >= vv.offsetLeft - 1 && r.right <= vv.offsetLeft + vv.width + 1 && r.top >= vv.offsetTop - 1 && r.bottom <= vv.offsetTop + vv.height + 1 && r.width > 0, onScreenPx: Math.round(r.height * vv.scale) }; });
      check('the notice sits inside the zoomed-in visible area, at a readable size', vis.inside && vis.onScreenPx >= 16 && vis.onScreenPx < 120, vis);
      await f.p.screenshot({ path: path.join(OUT, 'phone-zoom-note.png') });
      for (let i = 0; i < 4 && (await scale(f.p)) > 1.03; i++) await pinch(f, 420, 200, true);
      await sleep(500);
      v = await view(f.p);
      check('pinching out on the notice works; play resumes at normal size', (await scale(f.p)) <= 1.03 && !v.zoomNote && v.controls && v.enabled, { scale: await scale(f.p), note: v.zoomNote, controls: v.controls });
      // The pause menu keeps pinch zoom too.
      await tapAt(f, (await center(f.p, '#btn-menu')).x, (await center(f.p, '#btn-menu')).y);
      await sleep(400);
      await pinch(f, 420, 200);
      check('the in-match menu keeps pinch zoom', (await scale(f.p)) > 1.5, await scale(f.p));
      await f.ctx.close();
    }

    // 5. Name / room-code fields: focus, type, blur: page not scrolled, game sized correctly.
    {
      const f = await phone(browser);
      await f.p.goto(SITE);
      await f.p.waitForFunction(() => (window as any).__fps?.screen === 'title');
      await f.p.evaluate(() => (document.getElementById('btn-mg-online') as HTMLElement).click());
      await sleep(300);
      for (const id of ['in-name', 'in-code']) {
        await tapAt(f, (await center(f.p, `#${id}`)).x, (await center(f.p, `#${id}`)).y);
        await f.p.keyboard.type('ABCD');
        await f.p.evaluate(() => (document.activeElement as HTMLElement)?.blur());
        await sleep(200);
      }
      const v = await view(f.p);
      check('text fields: focus and blur leave the page unscrolled and unzoomed', v.scrollY === 0 && (await scale(f.p)) === 1, { scrollY: v.scrollY, scale: await scale(f.p) });
      // A shorter visible area (keyboard open), then back: the game resizes to match each time.
      await f.p.setViewportSize({ width: 844, height: 220 });
      await sleep(300);
      const k = await view(f.p);
      await f.p.setViewportSize({ width: 844, height: 390 });
      await sleep(300);
      const k2 = await view(f.p);
      check('keyboard shown and dismissed (viewport 390 -> 220 -> 390 tall): canvas and camera follow', sized(k) && sized(k2), { open: k.css, closed: k2.css });
      await f.ctx.close();
    }

    // 6. Rotation and several screen sizes: canvas, camera and the menu button.
    {
      const f = await phone(browser);
      await practice(f);
      await T(f.cdp, 'touchStart', [{ x: 110, y: 290, id: 1 }]);
      await T(f.cdp, 'touchMove', [{ x: 110, y: 240, id: 1 }]);
      for (const [w, h] of [[390, 844], [844, 390], [568, 320], [667, 375], [932, 430], [1024, 768]] as const) {
        await f.p.setViewportSize({ width: w, height: h });
        await sleep(450);
        const v = await view(f.p);
        const reach = v.menu.x >= 0 && v.menu.y >= 0 && v.menu.r <= w && v.menu.b <= h && v.menu.w >= 44 && v.menu.h >= 44;
        check(`${w}x${h}: canvas and camera match the screen; menu button on screen and 44 px+`, sized(v) && reach && (await scale(f.p)) === 1, { css: v.css, buffer: v.buffer, aspect: v.aspect, menu: v.menu });
        if (w === 390) { check('rotating mid-touch drops the held finger', v.held === 0, v.held); await T(f.cdp, 'touchEnd', [{ x: 110, y: 240, id: 1 }]); }
      }
      // Background and back: still sized, nothing held.
      await f.p.setViewportSize({ width: 844, height: 390 });
      await f.p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      await f.p.setViewportSize({ width: 390, height: 844 }); // rotated while away
      await f.p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(400);
      const v = await view(f.p);
      check('rotated while in the background: on return the canvas fits the new shape, nothing held', sized(v) && v.held === 0, { css: v.css, buffer: v.buffer });
      check('main page: no page errors', f.errors.length === 0, f.errors.slice(0, 3));
      await f.ctx.close();
    }

    // 7. The Arcade: pinches during a run, and a run started while zoomed.
    {
      const f = await phone(browser);
      await f.p.goto(new URL('classic.html', SITE).toString());
      await f.p.waitForFunction(() => !!(window as any).__chancla);
      await f.p.evaluate(() => (document.getElementById('btn-play') as HTMLElement).click());
      await f.p.evaluate(() => (document.getElementById('btn-maps-start') as HTMLElement).click());
      await f.p.waitForFunction(() => (window as any).__chancla.snapshot().state === 'playing');
      await sleep(800);
      for (const sel of ['#btn-pause', '#t-throw', '.hud-tr']) {
        const c = await center(f.p, sel);
        await pinch(f, c.x, c.y);
      }
      await pinch(f, 600, 200);
      check('Arcade: pinches on Pause, Throw, the HUD and the look area do not zoom', (await scale(f.p)) === 1, await scale(f.p));
      const thr = await center(f.p, '#t-throw');
      for (let i = 0; i < 6; i++) { await tapAt(f, thr.x, thr.y, 70 + i); await sleep(90); }
      check('Arcade: repeated quick Throw taps do not zoom', (await scale(f.p)) === 1);
      // Pause, zoom on the menu, resume: the run waits on the menu until zoomed back out.
      await f.p.evaluate(() => (document.getElementById('btn-pause') as HTMLElement).click());
      await sleep(300);
      await pinch(f, 420, 200);
      const z = await scale(f.p);
      await f.p.evaluate(() => (document.getElementById('btn-resume') as HTMLElement).click());
      await sleep(300);
      const st = await f.p.evaluate(() => (window as any).__chancla.snapshot().state);
      check('Arcade: resuming while zoomed keeps the run paused on its menu (where pinch-out works)', z > 1.5 && st === 'paused', { zoom: z, state: st });
      for (let i = 0; i < 4 && (await scale(f.p)) > 1.03; i++) await pinch(f, 420, 200, true);
      await f.p.evaluate(() => (document.getElementById('btn-resume') as HTMLElement).click());
      await sleep(300);
      check('Arcade: zoomed back out, Resume plays', (await f.p.evaluate(() => (window as any).__chancla.snapshot().state)) === 'playing' && (await scale(f.p)) <= 1.03);
      check('Arcade: no page errors', f.errors.length === 0, f.errors.slice(0, 3));
      await f.ctx.close();
    }
  } finally {
    await browser.close();
    preview?.kill();
  }
  const passed = checks.filter((c) => c.ok).length;
  fs.writeFileSync(path.join(OUT, 'zoom-e2e.json'), JSON.stringify({ at: new Date().toISOString(), environment: 'Chromium 141 headless, mobile emulation (touch, DPR 2), multi-touch over CDP. Emulation pinch-zooms like Android Chrome; iOS Safari focus zoom and gestures are not reproduced. NOT a real phone.', passed, total: checks.length, checks }, null, 2));
  console.log(`${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exitCode = 1;
}

void main();
