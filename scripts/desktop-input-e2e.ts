// Desktop keyboard-and-mouse play through repeated menu, focus and mouse-
// capture transitions: the things that made Mac controls "sometimes stop
// working". Real page, practice match (and a campaign stage change), local
// only. Chromium (headless, pointer lock available).
//
//   npm run build && node --import tsx scripts/desktop-input-e2e.ts
//
// What Chromium cannot show: macOS Safari keeps focus on a field or button
// after a click and drops keyups while Cmd is held. Those are simulated
// here (keys sent from a hidden field; Cmd pressed with W released under
// it), which tests the game's handling, not Safari itself.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright-core';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SITE = 'http://localhost:4173/';
const OUT = path.join(ROOT, 'docs/evidence/desktop-input');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); };

async function waitHttp(url: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

const st = (p: Page) => p.evaluate(() => {
  const f = (window as any).__fps; const s = f.session(); const i = f.input();
  const vis = (id: string) => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none' && !el.closest('[hidden]'); };
  return {
    screen: f.screen, locked: i.locked, enabled: i.enabled, fallback: i.fallback, held: i.heldCount, touch: f.touchMode,
    yaw: i.yaw, shots: s?.localShot ?? 0, x: s?.body.x ?? 0, z: s?.body.z ?? 0,
    focus: document.activeElement?.tagName ?? '', ctp: !document.getElementById('click-to-play')!.hidden,
    menuBtn: vis('btn-menu'), escHint: vis('esc-hint') ? document.getElementById('esc-hint')!.textContent : '',
  };
});
/** What the game reads for the next tick, while `key` is held. */
const sampleWith = async (p: Page, key: string) => {
  await p.keyboard.down(key); await sleep(120);
  const c = await p.evaluate(() => (window as any).__fps.input().sample());
  await p.keyboard.up(key); await sleep(60);
  return c as { mx: number; mz: number; fire: boolean; jump: boolean };
};
/** Moves, throws and turns: the full "controls work" check. */
async function controlsWork(p: Page): Promise<{ ok: boolean; detail: Record<string, unknown> }> {
  // Practice bots can eliminate Rosa; a dead player cannot throw. Wait for respawn.
  await p.waitForFunction(() => (window as any).__fps.session()?.alive, undefined, { timeout: 10000 }).catch(() => undefined);
  const a = await st(p);
  const w = await sampleWith(p, 'KeyW');
  const s = await sampleWith(p, 'KeyS');
  const f = await sampleWith(p, 'KeyF');
  await p.keyboard.down('KeyF'); await sleep(700); await p.keyboard.up('KeyF');
  await p.mouse.move(700, 360); await sleep(80);
  const y0 = (await st(p)).yaw;
  await p.mouse.move(780, 360, { steps: 4 }); await sleep(150); // a known 80 px to the right
  const b = await st(p);
  const extra = await p.evaluate(() => { const f = (window as any).__fps; const s = f.session(); return { enginePaused: !!f.engine()?.paused, hostPaused: !!f.host()?.paused, inputActive: !!f.engine()?.inputActive, phase: s?.phase, alive: s?.alive, cooldown: Math.round(s?.cooldownMs ?? -1), switchMs: Math.round(s?.switchMs ?? -1) }; });
  const detail = { ...extra, w: w.mz, s: s.mz, fire: f.fire, threw: b.shots - a.shots, turned: +(b.yaw - y0).toFixed(3), held: b.held, locked: b.locked };
  return { ok: w.mz === 1 && s.mz === -1 && f.fire && b.shots > a.shots && Math.abs(b.yaw - y0) > 0.01 && b.held === 0, detail };
}

/** What a player does to capture the mouse: press "Click to aim" if shown, else click the game. */
async function clickToAim(p: Page): Promise<void> {
  if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true }); // it pulses, so never "stable" for Playwright
  else await p.click('#stage', { force: true });
}

async function main(): Promise<void> {
  const procs: ChildProcess[] = [];
  if (!(await waitHttp(SITE, 1500))) procs.push(spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { cwd: ROOT, stdio: 'ignore' }));
  await waitHttp(SITE);
  // HEADED=1 under Xvfb: a real window with real focus and pointer lock (closer to a desktop than headless).
  const headed = !!process.env.HEADED && !!process.env.DISPLAY;
  const browser: Browser = headed
    ? await chromium.launch({ executablePath: ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find((x) => fs.existsSync(x)), headless: false, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] })
    : await launch();
  const errors: string[] = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript({ content: 'window.__name = (f) => f;' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(SITE);
    await p.waitForFunction(() => (window as any).__fps?.screen === 'title');
    check('a desktop browser starts in keyboard-and-mouse mode (touch detection does not take over)', !(await st(p)).touch);

    // 1. Type a name, then start with a click that leaves focus on the field (as Safari does).
    await p.click('#btn-practice');
    await p.click('#btn-online').catch(() => undefined);
    await p.evaluate(() => (window as any).__fps && undefined);
    await p.goto(SITE); await p.waitForFunction(() => (window as any).__fps?.screen === 'title');
    await p.click('#btn-online');
    await p.fill('#in-name', 'Mac Rosa');
    await p.focus('#in-name');
    await p.keyboard.press('Escape'); // back to the title, the name is kept
    await p.click('#btn-practice');
    await p.evaluate(() => (document.getElementById('btn-practice-start') as HTMLElement).click()); // no focus change
    await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing', undefined, { timeout: 20000 });
    await clickToAim(p); await sleep(500);
    let r = await controlsWork(p);
    check('after typing a name and starting: move, throw and turn all work', r.ok, r.detail);

    // 2. Keys aimed at a stale, hidden field (Safari keeps focus on it).
    const viaField = await p.evaluate(() => {
      const fld = document.getElementById('in-name') as HTMLInputElement;
      const send = (type: string, code: string) => fld.dispatchEvent(new KeyboardEvent(type, { code, key: code === 'KeyW' ? 'w' : code, bubbles: true, cancelable: true }));
      send('keydown', 'KeyW');
      const during = (window as any).__fps.input().sample().mz;
      send('keyup', 'KeyW');
      const after = (window as any).__fps.input().sample().mz;
      return { during, after, value: fld.value };
    });
    check('a key sent from a hidden field that kept focus still moves Rosa, and is not typed into the field', viaField.during === 1 && viaField.after === 0 && viaField.value === 'Mac Rosa', viaField);

    // 3. Menu affordance while captured.
    let s = await st(p);
    check('while the mouse is captured: no unreachable hamburger, a "Menu · Esc" label instead', s.locked && !s.menuBtn && s.escHint === 'Menu · Esc', { locked: s.locked, menuBtn: s.menuBtn, hint: s.escHint });
    await p.screenshot({ path: path.join(OUT, 'captured-menu-esc.png') });

    // 4. Esc → Resume, ten times, holding keys each time.
    let allOk = true; const fails: unknown[] = [];
    for (let i = 0; i < 10; i++) {
      await p.keyboard.down('KeyW'); await p.mouse.down();
      await p.keyboard.press('Escape'); await sleep(250);
      const m = await st(p);
      await p.mouse.up(); await p.keyboard.up('KeyW');
      const cleared = m.screen === 'pause' && m.held === 0 && !m.locked && !m.enabled;
      const resumeBox = (await p.locator('#btn-resume').boundingBox())!;
      const hit = await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [resumeBox.x + resumeBox.width / 2, resumeBox.y + resumeBox.height / 2] as const);
      await p.click('#btn-resume'); await sleep(350 + (i % 3) * 300);
      let after = await st(p);
      if (!after.locked) { await clickToAim(p); await sleep(500); after = await st(p); } // browser cooldown: "click to aim" then click
      r = await controlsWork(p);
      if (!(cleared && hit === 'btn-resume' && r.ok)) { allOk = false; fails.push({ i, cleared, hit, ...r.detail, ctp: after.ctp }); }
    }
    check('Esc → Resume ten times: each time the menu opens with nothing held, Resume is clickable, then move, throw and turn work', allOk, fails.length ? fails : undefined);

    // 5. Settings slider keeps focus, then close and resume (Safari: clicks don't move focus).
    await p.keyboard.press('Escape'); await sleep(250);
    await p.click('#btn-pause-settings');
    await p.click('#set-sens');
    await p.evaluate(() => (document.getElementById('btn-settings-close') as HTMLElement).click());
    await p.evaluate(() => (document.getElementById('btn-resume') as HTMLElement).click());
    await clickToAim(p); await sleep(500);
    s = await st(p);
    r = await controlsWork(p);
    check('Settings slider used, closed and resumed without moving focus: controls work, the slider does not hold focus', r.ok && s.focus !== 'INPUT', { ...r.detail, focus: s.focus });

    // 6. macOS: W released while Cmd is held (no keyup for W).
    await p.keyboard.down('KeyW'); await sleep(150);
    await p.keyboard.down('Meta'); await sleep(80);
    await p.keyboard.up('Meta'); await sleep(150);
    const stuck = await p.evaluate(() => (window as any).__fps.input().sample().mz);
    await p.keyboard.up('KeyW');
    check('W released under Cmd (macOS sends no keyup): Rosa does not keep walking', stuck === 0, { mz: stuck });
    r = await controlsWork(p);
    check('…and controls work normally afterwards', r.ok, r.detail);

    // 7. The browser releases the mouse by itself (no Escape key event), then an Escape arrives late.
    await p.keyboard.down('KeyD');
    await p.evaluate(() => document.exitPointerLock()); await sleep(120);
    await p.keyboard.up('KeyD');
    s = await st(p);
    check('the browser releasing the mouse on its own opens the menu and clears held input', s.screen === 'pause' && s.held === 0 && !s.enabled, s);
    await p.keyboard.press('Escape'); await sleep(200);
    check('a late Escape from the same press does not toggle the menu closed again', (await st(p)).screen === 'pause');
    await p.click('#btn-resume'); await sleep(400);
    if (!(await st(p)).locked) { await clickToAim(p); await sleep(500); }
    r = await controlsWork(p);
    check('…Resume, then controls work', r.ok, r.detail);

    // 8. Window loses focus (Cmd+Tab) and the page is hidden (another app or tab), keys held.
    await p.keyboard.down('KeyA'); await p.mouse.down();
    await p.evaluate(() => window.dispatchEvent(new Event('blur')));
    await sleep(100);
    const afterBlur = await st(p);
    await p.mouse.up(); await p.keyboard.up('KeyA');
    check('window loses focus while A and the mouse button are held: nothing stays held', afterBlur.held === 0, { held: afterBlur.held });
    await p.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await sleep(200);
    s = await st(p);
    check('switching to another app or tab opens the menu (practice pauses)', s.screen === 'pause' && s.held === 0, s);
    await p.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await p.click('#btn-resume'); await sleep(400);
    if (!(await st(p)).locked) { await clickToAim(p); await sleep(500); }
    r = await controlsWork(p);
    check('back from another app, Resume: controls work', r.ok, r.detail);

    // 9. Mouse capture refused: "click to aim" first, then drag-to-look after repeated refusals.
    await p.keyboard.press('Escape'); await sleep(250);
    await p.evaluate(() => {
      const c = document.querySelector('#stage canvas') as any;
      (window as any).__realLock = HTMLElement.prototype.requestPointerLock;
      HTMLElement.prototype.requestPointerLock = function () { setTimeout(() => document.dispatchEvent(new Event('pointerlockerror')), 10); return Promise.reject(new Error('refused')); } as any;
      void c;
    });
    await sleep(1800); // past the browser's normal re-lock cooldown
    await p.click('#btn-resume'); await sleep(400);
    s = await st(p);
    const menuClickable = s.menuBtn;
    check('capture refused on Resume: a visible prompt (click to aim), and the Menu button is clickable (cursor is free)', s.ctp && menuClickable, { ctp: s.ctp, menuBtn: s.menuBtn });
    for (let i = 0; i < 3; i++) { await clickToAim(p); await sleep(400); }
    s = await st(p);
    const dragA = s.yaw;
    await p.mouse.move(640, 360); await p.mouse.down(); await p.mouse.move(700, 360, { steps: 5 }); await p.mouse.up();
    const w2 = await sampleWith(p, 'KeyW');
    await p.keyboard.down('KeyF'); await sleep(700); await p.keyboard.up('KeyF');
    const s2 = await st(p);
    check('capture keeps failing: drag-to-look takes over, and moving, turning and throwing all work', s.fallback && Math.abs(s2.yaw - dragA) > 0.01 && w2.mz === 1 && s2.shots > s.shots, { fallback: s.fallback, turned: +(s2.yaw - dragA).toFixed(3), w: w2.mz, threw: s2.shots - s.shots });
    await p.screenshot({ path: path.join(OUT, 'drag-to-look-menu-button.png') });
    const mb = (await p.locator('#btn-menu').boundingBox())!;
    const hitMenu = await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.id, [mb.x + mb.width / 2, mb.y + mb.height / 2] as const);
    await p.click('#btn-menu'); await sleep(300);
    check('uncaptured: the "☰ Menu · Esc" button is on top and opens the menu', hitMenu === 'btn-menu' && (await st(p)).screen === 'pause', { hitMenu });
    await p.evaluate(() => { HTMLElement.prototype.requestPointerLock = (window as any).__realLock; });

    // 10. Restart the match (a new match in the same page), and a campaign stage change.
    await p.click('#btn-pause-restart'); await p.click('#btn-confirm-yes').catch(() => undefined);
    await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing', undefined, { timeout: 20000 });
    await clickToAim(p); await sleep(600);
    r = await controlsWork(p);
    check('after restarting the match: controls work', r.ok, r.detail);
    await p.keyboard.press('Escape'); await sleep(250);
    await p.click('#btn-pause-leave'); await p.click('#btn-confirm-yes').catch(() => undefined);
    await p.waitForFunction(() => (window as any).__fps.screen === 'title');
    await p.click('#btn-campaign'); await p.click('.mcard[data-mission="ruleros"] button'); await p.click('#btn-mi-start');
    await p.waitForFunction(() => (window as any).__fps.campaign().active, undefined, { timeout: 20000 });
    await clickToAim(p); await sleep(400);
    await p.evaluate(() => (window as any).__fps.campaign().runtime.enableAutopilot(3));
    await p.waitForFunction(() => (window as any).__fps.campaign().runtime.sim.state.stage >= 1, undefined, { timeout: 60000 });
    await p.evaluate(() => { (window as any).__fps.campaign().runtime.autopilot = null; });
    await sleep(500);
    const cw = await sampleWith(p, 'KeyW');
    const cs = await st(p);
    check('campaign: after a stage change the keyboard still drives Rosa', cw.mz === 1 && cs.locked, { mz: cw.mz, locked: cs.locked });

    // 11. The diagnostics report has the input state and the transitions.
    const diag = await p.evaluate(() => (window as any).__fps.diagText());
    check('diagnostics: pointer lock, focused element kind, input mode, menu state and recent input transitions', /"input": \{/.test(diag) && /"locked"/.test(diag) && /"focus": "/.test(diag) && /"mode": "mouse/.test(diag) && /"menu"/.test(diag) && /input\s+mouse captured/.test(diag) && /input\s+Esc: menu/.test(diag) && /Cmd\/Ctrl pressed/.test(diag) && !diag.includes('Mac Rosa'));
    fs.writeFileSync(path.join(OUT, 'diagnostics-sample.txt'), diag);
    check('no page errors', errors.length === 0, errors.slice(0, 3));
  } finally {
    await browser.close();
    for (const pr of procs) pr.kill('SIGTERM');
  }
  const passed = checks.filter((c) => c.ok).length;
  fs.writeFileSync(path.join(OUT, 'desktop-input-e2e.json'), JSON.stringify({ at: new Date().toISOString(), environment: `Chromium 141 ${process.env.HEADED && process.env.DISPLAY ? 'headed under Xvfb' : 'headless'} (SwiftShader), Linux container, pointer lock available. Safari focus and Cmd-keyup behaviour simulated, not run.`, passed, total: checks.length, checks }, null, 2));
  console.log(`${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
