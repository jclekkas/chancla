// In-game menu access with the mouse captured for aiming, in a real, headed
// Chromium (Xvfb on Linux) where pointer lock behaves as it does for players:
// it needs a click, and right after a release the browser refuses a new lock
// for about a second.
//
//   npm run build && xvfb-run -a node --import tsx scripts/menu-access-e2e.ts
//
// Playwright sends keys to the page, not to the browser, so Chrome's own
// "Escape releases the mouse" is reproduced separately by releasing the lock
// from the page (document.exitPointerLock), which is what the browser does.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Page } from 'playwright-core';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SITE = process.env.E2E_URL || 'http://localhost:4173/';
const OUT = path.join(ROOT, 'artifacts/menu');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); };

async function waitHttp(url: string): Promise<boolean> {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

const fps = (p: Page) => p.evaluate(() => {
  const f = (window as any).__fps; const s = f.session(); const inp = f.input();
  const me = s?.snap?.players?.find((x: any) => x.id === s.id);
  return {
    screen: f.screen, locked: !!document.pointerLockElement, held: inp?.heldCount ?? -1, fallback: !!inp?.fallback,
    tl: s?.snap?.tl ?? null, shots: s?.localShot ?? 0, x: me?.x ?? 0, z: me?.z ?? 0,
    focus: (document.activeElement as HTMLElement | null)?.id ?? '', hint: document.querySelector('#hud .esc-hint')?.textContent ?? '',
    ctp: !document.getElementById('click-to-play')!.hidden, ctpNote: document.getElementById('ctp-note')?.textContent ?? '',
    paused: !!f.host()?.paused,
  };
});

async function main(): Promise<void> {
  let preview: ChildProcess | null = null;
  if (!process.env.E2E_URL && !(await waitHttp(SITE).catch(() => false))) {
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
    await waitHttp(SITE);
  }
  const executablePath = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p));
  const headed = !!process.env.DISPLAY;
  const browser = await chromium.launch({ executablePath, headless: !headed, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  console.log(`browser: Chromium ${headed ? 'headed (real pointer-lock rules)' : 'HEADLESS (lock rules not enforced)'}`);
  const errors: string[] = [];
  try {
    // ---------------- Main page: Practice with the mouse captured.
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript({ content: 'window.__name = (f) => f;' });
      await page.goto(SITE);
      await page.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { timeout: 30000 });
      await page.click('#btn-practice');
      await page.click('#btn-practice-start');
      await page.waitForFunction(() => (window as any).__fps.inMatch, undefined, { timeout: 30000 });
      await sleep(1500);
      let s = await fps(page);
      check('Start captures the mouse right away (its click counts), or practice waits paused behind "click to aim"', s.locked ? !s.paused && !s.ctp : s.ctp && s.paused && /Paused|pausa/i.test(s.ctpNote), { locked: s.locked, ctp: s.ctp, paused: s.paused });
      await page.mouse.click(640, 360);
      await sleep(600);
      s = await fps(page);
      check('a click captures the mouse; play runs', s.locked && !s.paused && !s.ctp, s);
      check('while aiming, the HUD shows "Esc or P: Menu"', /Esc or P: Menu/.test(s.hint), s.hint);
      await page.screenshot({ path: path.join(OUT, 'aiming-hint.png') });
      // The menu icon can't be reached while aiming: the cursor is captured. (The reported problem.)
      const b = (await page.locator('#btn-menu').boundingBox())!;
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await sleep(400);
      s = await fps(page);
      check('reproduced: clicking where the menu icon is, while aiming, does not reach it (the click goes to the game)', s.locked && s.screen === 'none', { locked: s.locked, screen: s.screen });

      // Escape: one press frees the mouse and opens the menu, focused, with held input dropped.
      await page.keyboard.down('KeyW');
      await page.mouse.down();
      await sleep(300);
      const shots0 = (await fps(page)).shots;
      await page.keyboard.press('Escape');
      // The same press arriving twice (some browsers deliver Escape again after releasing the lock), plus the lock change.
      await page.evaluate(() => { document.dispatchEvent(new Event('pointerlockchange')); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true })); });
      await sleep(300);
      s = await fps(page);
      check('overlapping events from one Escape press (repeat keydown, lock change) leave the menu open', s.screen === 'pause', s.screen);
      check('Escape while moving and throwing: mouse freed, menu open, held input dropped', !s.locked && s.screen === 'pause' && s.held === 0, s);
      check('the menu takes keyboard focus on Resume', s.focus === 'btn-resume', s.focus);
      await page.keyboard.up('KeyW');
      await page.mouse.up();
      const shotsAtMenu = (await fps(page)).shots;
      check('releasing the mouse button over the menu throws nothing', shotsAtMenu - shots0 <= 1, { shots0, shotsAtMenu });
      const t0 = (await fps(page)).tl;
      await sleep(1500);
      s = await fps(page);
      check('while the menu is open, practice is paused (clock frozen)', s.tl === t0 && s.paused, { t0, t1: s.tl });
      await page.screenshot({ path: path.join(OUT, 'menu-open.png') });


      // Resume straight after Escape: Chrome refuses the lock for about a second. Practice must stay paused with a way back.
      await page.click('#btn-resume');
      await sleep(500);
      s = await fps(page);
      if (!s.locked) {
        check('a refused re-capture leaves practice paused, with the "click to aim" recovery button', s.paused && s.ctp && s.screen === 'none', s);
        await sleep(1200);
        await page.click('#btn-click-play');
        await sleep(600);
        s = await fps(page);
      }
      check('Resume (an explicit click) captures the mouse again and play continues', s.locked && !s.paused, s);
      const shotsAfterResume = (await fps(page)).shots;
      check('the resuming click throws nothing', shotsAfterResume === shotsAtMenu, { shotsAtMenu, shotsAfterResume });

      // The browser releasing the lock itself (Chrome's Escape, alt-tab) also opens the menu, in one go.
      await sleep(1200);
      await page.evaluate(() => document.exitPointerLock());
      await sleep(300);
      s = await fps(page);
      check('when the browser itself releases the mouse, the menu opens', s.screen === 'pause' && !s.locked, s);
      // No re-capture on its own: focus returns, stray clicks on the backdrop.
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.mouse.click(30, 700);
      await sleep(300);
      check('no automatic re-capture (focus return, a click beside the menu)', !(await fps(page)).locked && (await fps(page)).screen === 'pause');

      // Ten cycles, alternating Escape and P, mid-move and mid-throw.
      let stuck = 0, thrown = 0, opened = 0;
      for (let i = 0; i < 10; i++) {
        await sleep(1150); // Chrome's re-lock cooldown
        await page.click('#btn-resume');
        await sleep(350);
        if (!(await fps(page)).locked) { await sleep(1100); await page.click('#btn-click-play'); await sleep(350); }
        const before = await fps(page);
        await page.keyboard.down(i % 2 ? 'KeyA' : 'KeyD');
        if (i % 3 === 0) await page.mouse.down();
        await sleep(200);
        await page.keyboard.press(i % 2 ? 'KeyP' : 'Escape');
        await sleep(250);
        const m = await fps(page);
        if (m.screen === 'pause' && !m.locked) opened++;
        if (m.held !== 0) stuck++;
        await page.keyboard.up(i % 2 ? 'KeyA' : 'KeyD');
        if (i % 3 === 0) await page.mouse.up();
        thrown += Math.max(0, (await fps(page)).shots - m.shots);
        void before;
      }
      check('10 Escape / P cycles while moving and throwing: the menu opened every time', opened === 10, { opened });
      check('no stuck input after any cycle, and nothing thrown from the menu', stuck === 0 && thrown === 0, { stuck, thrown });
      await sleep(1150);
      await page.click('#btn-resume');
      await sleep(400);
      if (!(await fps(page)).locked) { await sleep(1100); await page.click('#btn-click-play'); await sleep(400); }
      const p0 = await fps(page);
      await sleep(800);
      const p1 = await fps(page);
      check('after the last resume, no movement without keys pressed', Math.hypot(p1.x - p0.x, p1.z - p0.z) < 0.3, { moved: +Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2) });

      // A refused re-capture (Chrome's cooldown, a browser prompt): practice stays paused, with a way back.
      await page.keyboard.press('Escape');
      await sleep(300);
      await page.evaluate(() => {
        const proto = Element.prototype as any;
        (window as any).__realLock = proto.requestPointerLock;
        proto.requestPointerLock = function () { setTimeout(() => document.dispatchEvent(new Event('pointerlockerror')), 30); return Promise.reject(new DOMException('refused', 'NotAllowedError')); };
      });
      await page.click('#btn-resume');
      await sleep(500);
      s = await fps(page);
      const tr0 = s.tl;
      await sleep(1200);
      const tr1 = (await fps(page)).tl;
      check('a refused re-capture: practice stays paused (clock frozen) behind the "click to aim" recovery button', !s.locked && s.ctp && s.paused && tr0 === tr1, { locked: s.locked, ctp: s.ctp, paused: s.paused, tr0, tr1 });
      await page.screenshot({ path: path.join(OUT, 'refused-recovery.png') });
      await page.evaluate(() => { (Element.prototype as any).requestPointerLock = (window as any).__realLock; });
      await page.click('#btn-click-play');
      await sleep(500);
      s = await fps(page);
      check('the recovery button captures the mouse and play continues', s.locked && !s.paused && !s.ctp, s);
      // Dead (waiting to respawn): the menu still opens.
      await page.evaluate(() => { const f = (window as any).__fps; const room = [...f.host().hub.rooms.values()][0]; const me = room.sim.players.get(f.session().id); me.alive = false; me.respawnAt = room.sim.timeMs + 4000; });
      await sleep(300);
      await page.keyboard.press('Escape');
      await sleep(300);
      s = await fps(page);
      check('while dead, Escape still opens the menu and frees the mouse', s.screen === 'pause' && !s.locked, s);
      // Results: the match ends; the screen's buttons are reachable with a free cursor.
      await page.click('#btn-resume');
      await sleep(1300);
      if (!(await fps(page)).locked) { await page.click('#btn-click-play').catch(() => undefined); await sleep(400); }
      await page.evaluate(() => { const room = [...(window as any).__fps.host().hub.rooms.values()][0]; room.sim.playMs = room.sim.durationMs; });
      await page.waitForFunction(() => (window as any).__fps.screen === 'results', undefined, { timeout: 15000 }).catch(() => undefined);
      await sleep(400);
      s = await fps(page);
      const btns = await page.evaluate(() => [...document.querySelectorAll('#scr-results button')].filter((b) => !(b as HTMLElement).hidden && (b as HTMLElement).offsetParent).map((b) => b.id));
      check('results: the mouse is free and the screen offers its way out', s.screen === 'results' && !s.locked && btns.length >= 2, { screen: s.screen, locked: s.locked, btns });
      await page.screenshot({ path: path.join(OUT, 'results.png') });
      await page.close();
    }

    // ---------------- The Arcade.
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript({ content: 'window.__name = (f) => f; localStorage.setItem("chancla.progress.v1", JSON.stringify({ runs: 1 }));' });
      await page.goto(new URL('classic.html', SITE).toString());
      await page.waitForFunction(() => !!(window as any).__chancla);
      await page.click('#btn-play');
      await page.click('#btn-maps-start');
      await page.waitForFunction(() => (window as any).__chancla.snapshot().state === 'playing');
      await sleep(900);
      const arc = () => page.evaluate(() => { const c = (window as any).__chancla; const s = c.snapshot(); return { state: s.state, locked: !!document.pointerLockElement, throws: c.app.game.scoring.throws, held: c.app.game.chanclas.heldCount(), hint: document.querySelector('.hud-tr .esc-hint')?.textContent ?? '', run: +c.app.game.runTime.toFixed(2) }; });
      if (!(await arc()).locked) { await page.mouse.click(640, 360); await sleep(500); }
      let a = await arc();
      check('Arcade: aiming with the mouse captured, the hint says "Esc or P: Menu"', a.locked && /Esc or P: Menu/.test(a.hint), a);
      for (const key of ['Escape', 'KeyP'] as const) {
        await page.keyboard.down('KeyW');
        await sleep(200);
        await page.keyboard.press(key);
        await sleep(300);
        a = await arc();
        await page.keyboard.up('KeyW');
        check(`Arcade: ${key === 'Escape' ? 'Escape' : 'P'} frees the mouse and pauses the run in one press`, a.state === 'paused' && !a.locked, a);
        const r0 = a.run;
        await sleep(1000);
        check(`Arcade: paused run stays frozen (${key})`, (await arc()).run === r0);
        const th = (await arc()).throws;
        await sleep(1200);
        await page.click('#btn-resume');
        await sleep(500);
        a = await arc();
        if (!a.locked) { await sleep(1100); await page.mouse.click(640, 360); await sleep(400); a = await arc(); }
        check(`Arcade: Resume by click re-captures, nothing thrown by it (${key})`, a.state === 'playing' && a.locked && a.throws === th, a);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    preview?.kill();
  }
  check('no page errors', errors.length === 0, errors.slice(0, 3));
  const passed = checks.filter((c) => c.ok).length;
  fs.writeFileSync(path.join(OUT, 'menu-access-e2e.json'), JSON.stringify({ at: new Date().toISOString(), browser: headed ? 'Chromium 141 headed under Xvfb (Linux), real pointer lock' : 'Chromium headless', passed, total: checks.length, checks }, null, 2));
  console.log(`${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exitCode = 1;
}

void main();
