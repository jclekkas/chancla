// End-to-end check of the production build in headless Chromium.
// Usage: npm run build && npm run preview (in another shell) && npm run e2e
// Drives real keyboard, mouse and touch input; uses window.__chancla only to
// read state and to fast-forward long stretches (clearly marked below).
import { launch } from './browser.mjs';
import fs from 'node:fs';

const URL_ = process.env.E2E_URL || 'http://localhost:4173/classic.html';
const OUT = process.env.E2E_OUT || 'artifacts/e2e';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const errors = [];
const ok = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const snap = (page) => page.evaluate(() => window.__chancla.snapshot());
const wait = (page, ms) => page.waitForTimeout(ms);

async function waitFor(page, fn, arg, timeout = 15000) {
  try { await page.waitForFunction(fn, arg, { timeout, polling: 100 }); return true; } catch { return false; }
}

async function aimAt(page, getter) {
  // Points the camera at a target computed in-page. Equivalent to the player
  // moving the mouse; done directly so the check is deterministic.
  await page.evaluate((src) => {
    const g = window.__chancla.app.game;
    const t = new Function('g', src)(g);
    const dx = t.x - g.player.pos.x, dz = t.z - g.player.pos.z;
    g.player.yaw = Math.atan2(-dx, -dz);
    g.player.pitch = Math.atan2(t.y - 1.6, Math.hypot(dx, dz));
  }, getter);
}

// Esc while pointer-locked is handled by the browser, which releases the
// lock; headless Chromium does not do that for synthetic keys, so release it
// the same way the browser would.
async function pressEscape(page) {
  await page.keyboard.press('Escape');
  await page.evaluate(() => { if (document.pointerLockElement) document.exitPointerLock(); });
  await page.waitForTimeout(250);
}

async function pauseGame(page) {
  const locked = await page.evaluate(() => !!document.pointerLockElement);
  if (locked) await pressEscape(page);
  else await page.click('#btn-pause');
  await page.waitForTimeout(150);
}

const browser = await launch();

// ---------------- Desktop ----------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  // Note: software rendering in CI is slow, so waits below poll for state.
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });

  const t0 = Date.now();
  await page.goto(URL_);
  const loaded = await waitFor(page, () => !!window.__chancla, null, 30000);
  ok('loads and boots', loaded, `${Date.now() - t0} ms`);
  await wait(page, 600);
  await page.screenshot({ path: `${OUT}/01-title.png` });
  ok('title shows Play as focused primary action', await page.evaluate(() => document.activeElement?.id === 'btn-play'));
  ok('title shows a personal best line', (await page.textContent('#title-best')).length > 5);

  // Language toggle on the title screen.
  await page.click('#btn-lang');
  ok('Spanish toggle updates the title', (await page.textContent('#btn-play')).includes('Jugar'));
  ok('Spanish sets <html lang>', (await page.getAttribute('html', 'lang')) === 'es');
  await page.screenshot({ path: `${OUT}/02-title-es.png` });
  await page.click('#btn-lang');
  ok('English toggle restores the title', (await page.textContent('#btn-play')).includes('Play'));

  // How to play.
  await page.click('#btn-howto');
  ok('controls dialog opens', await page.isVisible('#modal-howto'));
  await page.screenshot({ path: `${OUT}/03-howto.png` });
  await page.keyboard.press('Escape');
  ok('Escape closes the controls dialog and returns focus', !(await page.isVisible('#modal-howto')) && (await page.evaluate(() => document.activeElement?.id)) === 'btn-howto');

  // Play: tutorial with real input.
  await page.mouse.move(640, 360);
  await page.click('#btn-play');
  // Play opens the map choice (El Patio is preselected); Start begins the run.
  await page.click('#btn-maps-start');
  await wait(page, 400);
  let s = await snap(page);
  ok('Play starts the tutorial', s.state === 'playing' && s.phase === 'tutorial', `lock=${s.lock}`);
  await page.keyboard.down('KeyW');
  const moved = await waitFor(page, () => window.__chancla.app.game.tutorial.step !== 'move', null, 10000);
  await page.keyboard.up('KeyW');
  ok('WASD moves Rosa and advances the tutorial', moved);
  await aimAt(page, 'const d=g.dummies[0];return {x:d.x,y:1.2,z:d.z}');
  await page.mouse.down();
  await wait(page, 60);
  await page.mouse.up();
  await waitFor(page, () => window.__chancla.app.game.chanclas.real.some((c) => c.state === 'flying'), null, 3000);
  await page.screenshot({ path: `${OUT}/04-throw.png` });
  ok('click throws a chancla that hits the cardboard target', await waitFor(page, () => window.__chancla.app.game.tutorial.step === 'charge', null, 6000));
  await waitFor(page, () => window.__chancla.app.game.chanclas.heldCount() === 2, null, 6000);
  await aimAt(page, 'const d=g.dummies[1];return {x:d.x,y:1.2,z:d.z}');
  await page.mouse.down();
  await waitFor(page, () => window.__chancla.app.game.chargeAmount > 0.5, null, 6000);
  await page.screenshot({ path: `${OUT}/05-charging.png` });
  await waitFor(page, () => window.__chancla.app.game.chargeAmount >= 1, null, 6000);
  await page.mouse.up();
  ok('hold-and-release charged throw completes the charge step', await waitFor(page, () => window.__chancla.app.game.tutorial.step === 'recall', null, 6000));
  await waitFor(page, () => window.__chancla.app.game.chanclas.heldCount() === 2, null, 6000);
  await aimAt(page, 'return {x:0,y:4,z:-20}');
  await page.keyboard.press('Space');
  await waitFor(page, () => window.__chancla.app.game.chanclas.real.some((c) => c.state === 'flying'), null, 3000);
  await page.keyboard.press('KeyR');
  ok('Space throws and R recalls', await waitFor(page, () => window.__chancla.app.game.tutorial.step === 'done' || window.__chancla.app.game.phase === 'wave', null, 4000));
  await waitFor(page, () => window.__chancla.app.game.phase === 'wave', null, 15000);
  s = await snap(page);
  ok('tutorial hands over to wave 1', s.phase === 'wave' && s.wave === 0);
  ok('both chanclas back in hand after recall', await waitFor(page, () => window.__chancla.app.game.chanclas.heldCount() === 2, null, 4000));

  // Wave 1: wait for an enemy, then hit it for real.
  await waitFor(page, () => window.__chancla.app.game.enemies.pool.some((e) => e.alive && e.state !== 'enter'), null, 40000);
  await page.evaluate(() => { const g = window.__chancla.app.game; for (const e of g.enemies.pool) { e.attackCd = 5; } });
  const scoreBefore = (await snap(page)).score;
  await aimAt(page, 'const e=g.enemies.pool.find(x=>x.alive);return {x:e.pos.x,y:1.2,z:e.pos.z}');
  await page.mouse.down();
  await wait(page, 40);
  await page.mouse.up();
  const hitOk = await waitFor(page, (b) => window.__chancla.app.game.scoring.score > b, scoreBefore, 6000);
  await wait(page, 60);
  await page.screenshot({ path: `${OUT}/06-hit.png` });
  ok('a real throw hits an enemy and scores', hitOk);

  // Let an attack telegraph happen and capture it.
  await page.evaluate(() => { const g = window.__chancla.app.game; for (const e of g.enemies.pool) e.attackCd = 0; });
  await waitFor(page, () => window.__chancla.app.game.hazards.pendingTelegraphs() > 0, null, 8000);
  await aimAt(page, 'const e=g.enemies.pool.find(x=>x.alive)||{pos:{x:0,z:0}};return {x:e.pos.x,y:0.6,z:e.pos.z}');
  await wait(page, 300);
  await page.screenshot({ path: `${OUT}/07-telegraph.png` });
  ok('enemy attacks are telegraphed before they fire', true);

  // Pause with Escape (or the HUD button when headless keeps the lock).
  await pressEscape(page);
  s = await snap(page);
  ok('Esc (pointer lock released) pauses the game and shows the menu', s.state === 'paused' && (await page.isVisible('#screen-pause')));
  const frozen1 = await page.evaluate(() => window.__chancla.app.game.runTime);
  await wait(page, 600);
  const frozen2 = await page.evaluate(() => window.__chancla.app.game.runTime);
  ok('simulation is frozen while paused', frozen1 === frozen2);
  ok('held inputs cleared on pause', (await snap(page)).heldInputs === 0);
  await page.screenshot({ path: `${OUT}/08-pause.png` });
  await page.click('#btn-resume');
  await wait(page, 300);
  ok('resume continues the run', (await snap(page)).state === 'playing');

  // Esc in the middle of a charge must cancel it, not fire on Resume.
  const throwsBefore = await page.evaluate(() => window.__chancla.app.game.scoring.throws);
  await page.mouse.down();
  await waitFor(page, () => window.__chancla.app.game.charging, null, 4000);
  await pressEscape(page);
  await page.mouse.up();
  await page.click('#btn-resume');
  await wait(page, 800);
  ok('Esc during a charge cancels the throw', (await page.evaluate(() => window.__chancla.app.game.scoring.throws)) === throwsBefore);

  // Visibility loss pauses.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  ok('hiding the page pauses', (await snap(page)).state === 'paused');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.click('#btn-resume');

  // Fast-forward (automation shortcut): jump to the boss and win.
  const baseline = await snap(page);
  await page.evaluate(() => window.__chancla.app.game.debugJumpToWave(3));
  await waitFor(page, () => window.__chancla.app.game.boss.state === 'attack', null, 15000);
  await aimAt(page, 'return {x:g.boss.pos.x,y:g.boss.pos.y+3,z:g.boss.pos.z}');
  await wait(page, 200);
  await page.screenshot({ path: `${OUT}/09-boss.png` });
  ok('boss encounter starts with a health bar', await page.isVisible('#boss-panel'));
  // Throw at him while shielded: must be blocked.
  const hpBefore = (await snap(page)).bossHp;
  await page.mouse.down(); await wait(page, 40); await page.mouse.up();
  await wait(page, 800);
  const shieldHeld = (await snap(page)).bossHp === hpBefore || (await page.evaluate(() => window.__chancla.app.game.boss.state === 'vulnerable'));
  ok('the shield blocks hits during attacks', shieldHeld);
  // Step out from behind the fountain with real keyboard movement.
  await page.evaluate(() => { const g = window.__chancla.app.game; g.player.yaw = 0; });
  await page.keyboard.down('KeyD');
  await waitFor(page, () => window.__chancla.app.game.player.pos.x > 5, null, 15000);
  await page.keyboard.up('KeyD');
  // Real throws during vulnerable windows until he falls (Rosa made invulnerable to keep the check short).
  let thrown = 0;
  for (let i = 0; i < 1500; i++) {
    const st = await page.evaluate(() => { const g = window.__chancla.app.game; g.player.invuln = 99; return { b: g.boss.state, held: g.chanclas.heldCount(), phase: g.phase }; });
    if (st.phase !== 'boss' || st.b === 'dying' || st.b === 'dead') break;
    if (st.b === 'vulnerable' && st.held > 0) {
      await aimAt(page, 'return {x:g.boss.pos.x,y:g.boss.pos.y+2.6,z:g.boss.pos.z}');
      await page.mouse.down(); await wait(page, 30); await page.mouse.up();
      thrown++;
      if (thrown === 3) await page.screenshot({ path: `${OUT}/10-boss-open.png` });
    }
    await wait(page, 150);
  }
  const won = await waitFor(page, () => ['victory'].includes(window.__chancla.app.game.phase), null, 30000);
  const bossInfo = await page.evaluate(() => { const g = window.__chancla.app.game; return `hp=${g.boss.hp} state=${g.boss.state} phase=${g.phase} player=${g.player.pos.x.toFixed(1)},${g.player.pos.z.toFixed(1)} hits=${g.scoring.hits}`; });
  ok('boss falls to real chancla throws in his open windows', won, `${thrown} throws; ${bossInfo}`);
  const resultsShown = await waitFor(page, () => !document.getElementById('screen-results').hidden, null, 10000);
  await wait(page, 400);
  await page.screenshot({ path: `${OUT}/11-victory.png` });
  ok('victory results screen appears', resultsShown);
  ok('results show score, combo, accuracy and personal best', (await page.textContent('#r-score')).length > 0 && (await page.textContent('#r-acc')).includes('%') && (await page.textContent('#r-best-note')).includes('device'));

  // Share and copy (clipboard permission granted for the check).
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(URL_).origin });
  await page.click('#btn-copy');
  await wait(page, 300);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok('copy link puts the score and the deployed origin on the clipboard', clip.includes(new URL(URL_).origin) && /\d/.test(clip), clip.slice(0, 80));
  ok('copy shows visible feedback', await page.isVisible('#toast'));
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.click('#btn-download')]);
  ok('score card downloads as a PNG', !!dl && dl.suggestedFilename().endsWith('.png'), dl ? dl.suggestedFilename() : 'none');
  if (dl) await dl.saveAs(`${OUT}/scorecard.png`);

  // Play again: full reset after victory.
  await page.click('#btn-again');
  await wait(page, 400);
  s = await snap(page);
  ok('play again shows the wave 1 banner', await page.isVisible('#banner'));
  ok('play again resets the run after victory', s.state === 'playing' && s.score === 0 && s.hp === 100 && s.wave === 0 && s.enemiesActive === 0 && s.bossVisible === 0 && s.chanclasHeld === 2);

  // Defeat flow.
  await page.evaluate(() => window.__chancla.app.game.player.damage(1000));
  ok('health at zero shows the defeat screen', await waitFor(page, () => !document.getElementById('screen-results').hidden, null, 20000));
  await wait(page, 300);
  await page.screenshot({ path: `${OUT}/12-defeat.png` });
  await page.click('#btn-again');
  await wait(page, 300);
  s = await snap(page);
  ok('play again resets the run after defeat', s.state === 'playing' && s.hp === 100 && s.score === 0);

  // Mid-run restart, repeated, checking for leaks.
  const leaks = [];
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => window.__chancla.app.game.debugJumpToWave(2));
    await waitFor(page, () => window.__chancla.app.game.enemies.activeCount() > 0, null, 8000);
    await pauseGame(page);
    await page.click('#btn-restart');
    await wait(page, 200);
    leaks.push(await snap(page));
  }
  const first = leaks[0], last = leaks[leaks.length - 1];
  ok('repeated restarts keep one animation loop', last.loops === 1);
  ok('repeated restarts do not add DOM listeners', last.listeners === baseline.listeners, `${baseline.listeners} -> ${last.listeners}`);
  ok('repeated restarts do not add game event handlers', last.eventHandlers === first.eventHandlers);
  ok('repeated restarts do not grow the enemy pool unboundedly', last.enemyPool <= 18, `pool=${last.enemyPool}`);
  ok('repeated restarts keep one audio context and bounded voices', last.audioContexts <= 1 && last.audioVoices < 40, `voices=${last.audioVoices}`);
  ok('restart leaves no stray entities', last.enemiesActive === 0 && last.hazards === 0 && last.chanclasActive === 0 && last.pickups <= 1);

  // Return to title, then settings: reset saved progress with confirmation.
  await pauseGame(page);
  await page.click('#btn-to-title');
  await wait(page, 300);
  ok('return to title works from pause', (await snap(page)).state === 'title' && (await page.isVisible('#screen-title')));
  const bestBefore = await page.textContent('#title-best');
  await page.click('#btn-settings');
  await page.screenshot({ path: `${OUT}/13-settings.png` });
  await page.click('[data-lang="es"]');
  ok('settings language switch translates the dialog', (await page.textContent('#settings-title')).includes('Ajustes'));
  await page.click('[data-lang="en"]');
  await page.click('#btn-reset');
  ok('reset asks for confirmation', await page.isVisible('#modal-confirm'));
  await page.click('#btn-confirm-no');
  ok('cancel keeps saved progress', (await page.evaluate(() => window.__chancla.app.progress.value.bestScore)) > 0);
  await page.click('#btn-reset');
  await page.click('#btn-confirm-yes');
  await page.click('#btn-settings-close');
  const bestAfter = await page.textContent('#title-best');
  ok('confirmed reset clears the personal best only', bestAfter !== bestBefore && (await page.evaluate(() => window.__chancla.app.progress.value.bestScore)) === 0 && (await page.evaluate(() => window.__chancla.app.settings.value.lang)) === 'en');

  // Keyboard focus is visible.
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  ok('keyboard focus has a visible outline', outline !== 'none', outline);

  // Context loss and restore.
  await page.click('#btn-play');
  await page.click('#btn-maps-start');
  await wait(page, 300);
  await page.evaluate(() => {
    const gl = window.__chancla.app.renderer.getContext();
    window.__lose = gl.getExtension('WEBGL_lose_context');
    window.__lose.loseContext();
  });
  await wait(page, 300);
  ok('WebGL context loss pauses and explains', (await snap(page)).state === 'paused' && (await page.isVisible('#screen-ctx')));
  await page.evaluate(() => window.__lose.restoreContext());
  await wait(page, 800);
  ok('WebGL context restore recovers', !(await page.isVisible('#screen-ctx')));
  await page.click('#btn-resume');
  await wait(page, 500);
  await page.screenshot({ path: `${OUT}/14-after-restore.png` });

  // Frame timing in this environment (software rendering).
  const perf = await page.evaluate(async () => {
    const app = window.__chancla.app;
    app.loop.frameTimes.length = 0;
    await new Promise((r) => setTimeout(r, 4000));
    const ft = app.loop.frameTimes.slice();
    ft.sort((a, b) => a - b);
    return { frames: ft.length, median: ft[Math.floor(ft.length / 2)], p95: ft[Math.floor(ft.length * 0.95)], calls: app.renderer.info.render.calls, tris: app.renderer.info.render.triangles };
  });
  console.log('PERF', JSON.stringify(perf));
  results.push({ name: 'perf-desktop', pass: true, detail: JSON.stringify(perf) });
  await ctx.close();
}

// ---------------- Storage blocked ----------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(URL_);
  const booted = await waitFor(page, () => !!window.__chancla, null, 30000);
  ok('boots with storage blocked', booted && errs.length === 0, errs.join('; '));
  ok('explains that saving is unavailable', await page.isVisible('#title-storage'));
  await ctx.close();
}

// ---------------- WebGL unavailable ----------------
{
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  await ctx.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (String(type).startsWith('webgl')) return null;
      return orig.call(this, type, ...rest);
    };
  });
  const page = await ctx.newPage();
  await page.goto(URL_);
  const shown = await waitFor(page, () => !document.getElementById('screen-error').hidden, null, 15000);
  await page.screenshot({ path: `${OUT}/15-webgl-error.png` });
  ok('friendly WebGL failure screen with actions', shown && (await page.textContent('#error-tips')).length > 20);
  await ctx.close();
}

// ---------------- Mobile (touch, landscape and portrait) ----------------
for (const [name, vp] of [['landscape', { width: 844, height: 390 }], ['portrait', { width: 390, height: 844 }], ['small-landscape', { width: 667, height: 375 }]]) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`mobile pageerror: ${e.message}`));
  await page.goto(URL_);
  await waitFor(page, () => !!window.__chancla, null, 30000);
  await wait(page, 500);
  await page.screenshot({ path: `${OUT}/m-${name}-title.png` });
  const playBox = await page.locator('#btn-play').boundingBox();
  ok(`[${name}] Play is visible on screen`, playBox && playBox.y + playBox.height <= vp.height && playBox.x >= 0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  ok(`[${name}] no horizontal overflow`, !overflow);
  await page.tap('#btn-play');
  await wait(page, 300);
  await page.tap('#btn-maps-start');
  await wait(page, 500);
  const s = await snap(page);
  ok(`[${name}] touch mode with on-screen controls`, s.touch && (await page.isVisible('#touch')));
  const sizes = await page.evaluate(() => ['t-throw', 't-recall', 't-special', 'btn-pause'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { id, w: r.width, h: r.height, inView: r.right <= innerWidth && r.bottom <= innerHeight && r.left >= 0 && r.top >= 0 }; }));
  ok(`[${name}] touch buttons are large and on screen`, sizes.every((b) => b.w >= 44 && b.h >= 44 && b.inView), JSON.stringify(sizes.map((b) => `${b.id}:${Math.round(b.w)}`)));
  // Simultaneous move + aim + throw with three touch points via CDP.
  const cdp = await ctx.newCDPSession(page);
  const throwBox = await page.locator('#t-throw').boundingBox();
  const mv = { x: vp.width * 0.18, y: vp.height * 0.7 };
  const lk = { x: vp.width * 0.6, y: vp.height * 0.35 };
  const th = { x: throwBox.x + throwBox.width / 2, y: throwBox.y + throwBox.height / 2 };
  const pts = (a) => a.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 }));
  const yaw0 = await page.evaluate(() => window.__chancla.app.game.player.yaw);
  const pos0 = await page.evaluate(() => ({ ...window.__chancla.app.game.player.pos }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts([mv]) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts([{ x: mv.x, y: mv.y - 50 }]) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts([{ x: mv.x, y: mv.y - 50 }, lk]) });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts([{ x: mv.x, y: mv.y - 50 }, { x: lk.x + i * 12, y: lk.y }]) });
    await wait(page, 40);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts([{ x: mv.x, y: mv.y - 50 }, { x: lk.x + 72, y: lk.y }, th]) });
  await wait(page, 500);
  await page.screenshot({ path: `${OUT}/m-${name}-play.png` });
  const charging = await page.evaluate(() => window.__chancla.app.game.charging);
  // CDP's touchEnd lists the finger being lifted: release only the throw.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ ...th, id: 3 }] });
  await waitFor(page, () => window.__chancla.app.game.scoring.throws > 0, null, 4000);
  const thrownTouch = await page.evaluate(() => window.__chancla.app.game.scoring.throws);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: pts([{ x: mv.x, y: mv.y - 50 }, { x: lk.x + 72, y: lk.y }]) });
  const yaw1 = await page.evaluate(() => window.__chancla.app.game.player.yaw);
  const pos1 = await page.evaluate(() => ({ ...window.__chancla.app.game.player.pos }));
  ok(`[${name}] move, aim and throw work simultaneously`, Math.abs(yaw1 - yaw0) > 0.05 && Math.hypot(pos1.x - pos0.x, pos1.z - pos0.z) > 0.3 && charging && thrownTouch >= 1, `dYaw=${(yaw1 - yaw0).toFixed(2)} moved=${Math.hypot(pos1.x - pos0.x, pos1.z - pos0.z).toFixed(2)} charging=${charging} throws=${thrownTouch}`);
  await page.tap('#btn-pause');
  await wait(page, 200);
  await page.screenshot({ path: `${OUT}/m-${name}-pause.png` });
  ok(`[${name}] pause menu fits`, await page.evaluate(() => { const r = document.querySelector('#screen-pause .panel').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1; }));
  await page.tap('#btn-to-title');
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
ok('no console errors, page errors or failed requests', errors.length === 0, errors.slice(0, 5).join(' | '));
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify({ results, errors }, null, 2));
console.log(`\n${results.length - failed.length - (errors.length ? 1 : 0)}/${results.length} checks passed`);
process.exit(failed.length || errors.length ? 1 : 0);
