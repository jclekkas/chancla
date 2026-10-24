// Keyboard movement, arrow keys and WASD, through the sequences that were
// reported to make Rosa drift or stop responding on a Mac. Real page,
// offline practice, local only, Chromium. After every release it checks
// the whole chain: no key still held by the game, a neutral move command,
// and Rosa standing still (client prediction and the practice host's
// authoritative body), allowing knockback to settle.
//
//   GRAPHICS_EXPERIMENT=1 npm run build && node --import tsx scripts/movement-e2e.ts
//
// Real key events come from Playwright (Chromium's input pipeline). macOS
// behaviour Chromium on Linux cannot produce (a keyup that never arrives
// because Cmd was held, or because the key was released in another app) is
// SIMULATED: the keydown is sent and the keyup withheld, then the blur,
// visibility or Cmd events a Mac would send are delivered. Those checks are
// labelled "simulated".
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Page } from 'playwright-core';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.PORT || 4189);
const SITE = `http://localhost:${PORT}/`;
const DIST = path.resolve(process.env.DIST || path.join(ROOT, 'dist'));
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'docs/evidence/movement'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); };

async function waitHttp(url: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

// The whole chain at once: held keys, the command for the next tick, the
// client's predicted body and the host's authoritative body.
const chain = (p: Page) => p.evaluate(() => {
  const f = (window as any).__fps; const s = f.session(); const i = f.input();
  const room = f.host() ? [...f.host().hub.rooms.values()][0] : null;
  const sp = room?.sim?.players.get(s.id);
  const c = i.sample();
  return {
    keys: [...i.keys], mx: c.mx, mz: c.mz, enabled: i.enabled, locked: i.locked, screen: f.screen,
    x: s.body.x, z: s.body.z, speed: Math.hypot(s.body.vx, s.body.vz),
    sx: sp?.body.x ?? 0, sz: sp?.body.z ?? 0, sspeed: sp ? Math.hypot(sp.body.vx, sp.body.vz) : 0, alive: !!s.alive,
  };
});

/** Waits for `n` game ticks of the client (not wall-clock time: software rendering runs few frames). */
async function ticks(p: Page, n: number): Promise<void> {
  const seq0 = await p.evaluate(() => (window as any).__fps.session().seq);
  await p.waitForFunction((s0) => (window as any).__fps.session().seq - s0 >= (window as any).__n, seq0, { timeout: 20000, polling: 50 }).catch(() => undefined);
}

/** After a release: nothing held, a neutral command, and she comes to rest (30 ticks) and stays there (40 more). */
async function stops(p: Page, label: string, _settleMs = 0): Promise<void> {
  await p.evaluate(() => { (window as any).__n = 30; });
  await ticks(p, 30);
  const a = await chain(p);
  await p.evaluate(() => { (window as any).__n = 40; });
  await ticks(p, 40);
  const b = await chain(p);
  const drift = Math.hypot(b.x - a.x, b.z - a.z), sdrift = Math.hypot(b.sx - a.sx, b.sz - a.sz);
  check(`${label}: released, nothing held, Rosa stops and stays stopped`,
    a.keys.length === 0 && b.mx === 0 && b.mz === 0 && b.speed < 0.05 && b.sspeed < 0.05 && drift < 0.02 && sdrift < 0.02,
    { keys: a.keys, cmd: [b.mx, b.mz], speed: +b.speed.toFixed(3), serverSpeed: +b.sspeed.toFixed(3), drift: +drift.toFixed(3), serverDrift: +sdrift.toFixed(3) });
}

/** Holding `keys` moves her (she covers ground), with the expected command. */
async function moves(p: Page, keys: string[], label: string, expect?: { mx?: number; mz?: number }): Promise<void> {
  const a = await chain(p);
  for (const k of keys) await p.keyboard.down(k);
  await p.evaluate(() => { (window as any).__n = 25; });
  await ticks(p, 25); // a quarter-second and more of game time
  const b = await chain(p);
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const okCmd = (expect?.mx === undefined || b.mx === expect.mx) && (expect?.mz === undefined || b.mz === expect.mz);
  check(`${label}: moves while held`, d > 0.5 && okCmd, { moved: +d.toFixed(2), cmd: [b.mx, b.mz], keys: b.keys });
}

async function up(p: Page, keys: string[]): Promise<void> { for (const k of keys) await p.keyboard.up(k); }

// Puts Rosa back in the open middle of El Patio, facing the café, bots parked far away.
async function reset(p: Page): Promise<void> {
  await p.evaluate(() => {
    const f = (window as any).__fps; const s = f.session(); const room = [...f.host().hub.rooms.values()][0];
    for (const m of room.members.values()) if (m.bot) m.brain = null;
    for (const q of room.sim.players.values()) if (q.isBot) { q.body.x = 30 + q.id % 3; q.body.z = 30; }
    const me = room.sim.players.get(s.id);
    for (const b of [me.body, s.body]) { b.x = -4; b.z = 2.5; b.y = 0; b.vx = b.vz = b.vy = 0; }
    f.input().yaw = 0; f.input().pitch = 0;
  });
  await sleep(300);
}

async function clickToAim(p: Page): Promise<void> {
  if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true });
  else await p.click('#stage', { force: true });
  await sleep(450);
}

// Synthetic events for the Mac cases (see the header): sent to whatever has focus.
const synth = (p: Page, type: 'keydown' | 'keyup', code: string, mods: { metaKey?: boolean } = {}) => p.evaluate(({ type, code, mods }) => {
  const key = code.startsWith('Arrow') ? code : code === 'MetaLeft' ? 'Meta' : code.replace('Key', '').toLowerCase();
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent(type, { code, key, bubbles: true, cancelable: true, ...mods }));
}, { type, code, mods });

async function main(): Promise<void> {
  let preview: ChildProcess | null = null;
  if (!(await waitHttp(SITE, 500))) {
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST], { cwd: ROOT, stdio: 'ignore' });
    if (!(await waitHttp(SITE))) throw new Error('preview did not start');
  }
  const browser = await launch();
  const errors: string[] = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.addInitScript({ content: `window.__name = (f) => f; localStorage.setItem('chancla.mp.settings.v1', JSON.stringify({ practiceMap: 'patio', practiceAllies: 0, practiceEnemies: 1, practiceDifficulty: 'easy', quality: 'low', qualityMode: 'low' }));` });
    await p.goto(SITE);
    await p.waitForFunction(() => (window as any).__fps?.screen === 'title');
    await p.click('#btn-practice');
    await p.click('#btn-practice-start');
    await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing' && (window as any).__fps.session()?.alive, undefined, { timeout: 30000 });
    await clickToAim(p);
    await reset(p);

    // 1. Each arrow, held then released (and the same with WASD).
    for (const [k, mx, mz] of [['ArrowUp', 0, 1], ['ArrowDown', 0, -1], ['ArrowLeft', -1, 0], ['ArrowRight', 1, 0], ['KeyW', 0, 1], ['KeyS', 0, -1], ['KeyA', -1, 0], ['KeyD', 1, 0]] as const) {
      await reset(p);
      await moves(p, [k], k, { mx, mz });
      await up(p, [k]);
      await stops(p, k);
    }
    // 2. Rapid alternation, then opposite directions together.
    await reset(p);
    for (let i = 0; i < 12; i++) { await p.keyboard.down(i % 2 ? 'ArrowLeft' : 'ArrowRight'); await sleep(40); await p.keyboard.up(i % 2 ? 'ArrowLeft' : 'ArrowRight'); }
    await stops(p, 'rapid Left/Right alternation');
    await p.keyboard.down('ArrowLeft'); await p.keyboard.down('ArrowRight'); await sleep(300);
    const opp = await chain(p);
    check('Left and Right held together cancel out', opp.mx === 0, { cmd: [opp.mx, opp.mz] });
    await p.keyboard.up('ArrowLeft');
    await sleep(250);
    const oneLeft = await chain(p);
    check('releasing Left of Left+Right leaves Right moving her', oneLeft.mx === 1, { cmd: [oneLeft.mx, oneLeft.mz], keys: oneLeft.keys });
    await p.keyboard.up('ArrowRight');
    await stops(p, 'Left+Right');
    // 3. Diagonal, releasing one key before the other.
    await reset(p);
    await moves(p, ['ArrowUp', 'ArrowRight'], 'Up+Right diagonal', { mx: 1, mz: 1 });
    await p.keyboard.up('ArrowUp'); await sleep(250);
    const diag = await chain(p);
    check('releasing Up of Up+Right leaves exactly Right', diag.mx === 1 && diag.mz === 0, { cmd: [diag.mx, diag.mz], keys: diag.keys });
    await p.keyboard.up('ArrowRight');
    await stops(p, 'diagonal');
    // 4. An arrow and its WASD twin: releasing one keeps the other.
    await reset(p);
    await p.keyboard.down('ArrowUp'); await p.keyboard.down('KeyW'); await sleep(300);
    await p.keyboard.up('ArrowUp'); await sleep(250);
    const twin = await chain(p);
    check('ArrowUp + W, ArrowUp released: W still moves her forward', twin.mz === 1 && twin.keys.includes('KeyW'), { cmd: [twin.mx, twin.mz], keys: twin.keys });
    await p.keyboard.down('ArrowUp'); await p.keyboard.up('KeyW'); await sleep(250);
    const twin2 = await chain(p);
    check('then W released with ArrowUp held again: ArrowUp still moves her', twin2.mz === 1 && twin2.keys.includes('ArrowUp'), { cmd: [twin2.mx, twin2.mz], keys: twin2.keys });
    await p.keyboard.up('ArrowUp');
    await stops(p, 'ArrowUp/W twins');
    // 5. Moving while throwing, V, switching, and being hit.
    await reset(p);
    await p.keyboard.down('ArrowLeft');
    await p.keyboard.down('KeyF'); await sleep(500); await p.keyboard.up('KeyF');
    await p.keyboard.press('KeyV'); await sleep(250);
    await p.keyboard.press('Digit2'); await sleep(200); await p.keyboard.press('KeyV'); await sleep(200); await p.keyboard.press('Digit1');
    const mid = await chain(p);
    check('throwing, V and switching do not drop a held arrow', mid.mx === -1 && mid.keys.includes('ArrowLeft'), { cmd: [mid.mx, mid.mz], keys: mid.keys });
    await p.keyboard.up('ArrowLeft');
    await stops(p, 'arrow with throw, V and switches', 1200); // let the swing recovery finish
    // Being hit: a bot lands El Revés on her (knockback), with an arrow held, then released.
    await reset(p);
    await p.evaluate(() => {
      const f = (window as any).__fps; const s = f.session(); const room = [...f.host().hub.rooms.values()][0];
      const me = room.sim.players.get(s.id); me.protectedUntil = 0;
      const q = [...room.sim.players.values()].find((x: any) => x.isBot);
      q.body.x = me.body.x; q.body.z = me.body.z + 1.2; q.protectedUntil = 0; q.weapon = 1; q.switchMs = 0;
      room.sim.queueInput(q.id, { seq: q.lastSeq + 1, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 8, weapon: 1 });
    });
    await p.keyboard.down('ArrowRight'); await sleep(700);
    const hitEv = await p.evaluate(() => { const f = (window as any).__fps; const room = [...f.host().hub.rooms.values()][0]; return room.sim.players.get(f.session().id).hp; });
    await p.keyboard.up('ArrowRight');
    await stops(p, `knocked back by El Revés (hp ${hitEv}) while holding Right`, 600);

    // 6a. Esc while walking, key released in the menu, Resume: she must not carry on.
    for (const how of ['Esc', 'hidden tab'] as const) {
      await reset(p);
      await p.keyboard.down('ArrowUp'); await sleep(450);
      if (how === 'Esc') await p.keyboard.press('Escape');
      else await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      await p.keyboard.up('ArrowUp');
      await sleep(300);
      if (how !== 'Esc') await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
      const atPause = await chain(p);
      if (await p.isVisible('#btn-resume')) await p.click('#btn-resume');
      await p.evaluate(() => { (window as any).__n = 60; });
      await ticks(p, 60); // one second of play after Resume, no key held
      const after = await chain(p);
      const d = Math.hypot(after.x - atPause.x, after.z - atPause.z), sd = Math.hypot(after.sx - atPause.sx, after.sz - atPause.sz);
      check(`${how} while walking, key released, Resume: she does not carry on walking (no stale movement)`, d < 0.05 && sd < 0.05 && after.keys.length === 0,
        { moved: +d.toFixed(3), serverMoved: +sd.toFixed(3), keys: after.keys, screen: atPause.screen });
      if (!(await chain(p)).locked) await clickToAim(p);
    }

    // 6b. Esc/Resume three times in quick succession while walking.
    {
      await reset(p);
      await p.keyboard.down('ArrowUp'); await sleep(300);
      for (let i = 0; i < 3; i++) {
        await p.keyboard.press('Escape'); await sleep(120);
        if (await p.isVisible('#btn-resume')) await p.click('#btn-resume');
        await sleep(80);
        if (!(await chain(p)).locked) await clickToAim(p);
      }
      await p.keyboard.up('ArrowUp');
      await p.keyboard.press('Escape'); await sleep(150);
      const atPause = await chain(p);
      if (await p.isVisible('#btn-resume')) await p.click('#btn-resume');
      await p.evaluate(() => { (window as any).__n = 60; });
      await ticks(p, 60);
      const after = await chain(p);
      const d = Math.hypot(after.x - atPause.x, after.z - atPause.z);
      check('repeated Esc/Resume while walking, then a final pause and Resume: no stale movement', d < 0.05 && after.keys.length === 0, { moved: +d.toFixed(3), keys: after.keys });
      if (!after.locked) await clickToAim(p);
      await moves(p, ['ArrowUp'], 'after repeated Esc/Resume: ArrowUp', { mz: 1 });
      await up(p, ['ArrowUp']);
    }

    // 6c. Esc during an enemy's wind-up: the match does not advance and no damage lands while paused.
    {
      await reset(p);
      await p.evaluate(() => {
        const f = (window as any).__fps; const s = f.session(); const room = [...f.host().hub.rooms.values()][0];
        const me = room.sim.players.get(s.id); me.protectedUntil = 0; me.hp = 100;
        const q = [...room.sim.players.values()].find((x: any) => x.isBot);
        q.body.x = me.body.x; q.body.z = me.body.z + 1.2; q.body.vx = q.body.vz = 0; q.protectedUntil = 0; q.weapon = 1; q.switchMs = 0; q.cooldownMs = 0; q.meleeMs = 0;
        room.sim.queueInput(q.id, { seq: q.lastSeq + 1, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 8, weapon: 1 });
        (window as any).__swingQ = q.id;
      });
      // Pause partway through the 300 ms wind-up.
      await p.waitForFunction(() => { const f = (window as any).__fps; const room = [...f.host().hub.rooms.values()][0]; return !!room.sim.players.get((window as any).__swingQ).swing; }, undefined, { polling: 'raf' });
      await p.keyboard.press('Escape');
      const state = () => p.evaluate(() => {
        const f = (window as any).__fps; const room = [...f.host().hub.rooms.values()][0];
        const q = room.sim.players.get((window as any).__swingQ);
        return { timeMs: room.sim.timeMs, hp: room.sim.players.get(f.session().id).hp, swingAgeMs: q.swing ? Math.round((room.sim.tick - q.swing.tick0) * 1000 / 60) : null, meleeMs: q.meleeMs, paused: f.host().paused };
      });
      const s0 = await state(); await sleep(700); const s1 = await state();
      check('Esc during an enemy El Revés wind-up: the match clock, the swing and her health do not move while paused',
        s0.paused && s1.timeMs === s0.timeMs && s1.meleeMs === s0.meleeMs && s1.hp === 100 && s0.hp === 100 && s0.swingAgeMs !== null && s0.swingAgeMs < 300, { atPause: s0, after700ms: s1 });
      if (await p.isVisible('#btn-resume')) await p.click('#btn-resume');
      await p.evaluate(() => { (window as any).__n = 60; });
      await ticks(p, 60);
      const s2 = await state();
      check('after Resume the swing finishes and lands once (45 damage, no duplicate)', s2.hp === 55, { afterResume: s2 });
      await p.evaluate(() => { const f = (window as any).__fps; const room = [...f.host().hub.rooms.values()][0]; room.sim.players.get(f.session().id).hp = 100; });
      if (!(await chain(p)).locked) await clickToAim(p);
    }

    // 6. Esc → Settings → a slider adjusted with the arrow keys → close → Resume.
    await reset(p);
    await p.keyboard.down('ArrowUp'); await sleep(200);
    await p.keyboard.press('Escape'); await sleep(350);
    await p.keyboard.up('ArrowUp');
    const paused = await chain(p);
    check('Esc with an arrow held: the menu opens and nothing stays held', paused.keys.length === 0 && !paused.enabled, { keys: paused.keys, screen: paused.screen });
    await p.click('#btn-pause-settings');
    await sleep(300);
    const slider = await p.$('#set-sens');
    let sliderMoved = false;
    if (slider) {
      const v0 = await slider.inputValue();
      await slider.focus();
      for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowRight');
      await p.keyboard.down('ArrowLeft'); await sleep(150); await p.keyboard.up('ArrowLeft');
      sliderMoved = (await slider.inputValue()) !== v0;
    }
    check('in Settings the arrow keys still adjust a slider (menus keep normal keyboard use)', sliderMoved);
    await p.keyboard.press('Escape'); await sleep(300); // close Settings
    if (await p.isVisible('#btn-resume')) await p.click('#btn-resume');
    await sleep(400);
    if (!(await chain(p)).locked) await clickToAim(p);
    await reset(p);
    await moves(p, ['ArrowUp'], 'after Esc, Settings (slider), Resume: ArrowUp', { mz: 1 });
    await up(p, ['ArrowUp']);
    await stops(p, 'after Esc, Settings, Resume');
    const scrolled = await p.evaluate(() => ({ x: window.scrollX, y: window.scrollY, docTop: document.scrollingElement?.scrollTop ?? 0 }));
    check('arrow keys never scroll the page during play', scrolled.x === 0 && scrolled.y === 0 && scrolled.docTop === 0, scrolled);

    // 7. Cmd+Tab with an arrow held, released in another app (simulated).
    await reset(p);
    await synth(p, 'keydown', 'ArrowLeft');
    await sleep(250);
    await synth(p, 'keydown', 'MetaLeft', { metaKey: true }); // Cmd goes down for Cmd+Tab
    await p.evaluate(() => { window.dispatchEvent(new Event('blur')); });
    // The arrow and Cmd are released in the other app: no keyup reaches the page.
    await sleep(400);
    await p.evaluate(() => { window.dispatchEvent(new Event('focus')); });
    await sleep(100);
    if (!(await chain(p)).locked) await clickToAim(p);
    await stops(p, 'Cmd+Tab away with ArrowLeft held, released elsewhere, back (simulated)');
    // The same with no Cmd keydown at all (some switchers send none) and only a blur.
    await reset(p);
    await synth(p, 'keydown', 'ArrowRight');
    await sleep(250);
    await p.evaluate(() => window.dispatchEvent(new Event('blur')));
    await sleep(300);
    await p.evaluate(() => window.dispatchEvent(new Event('focus')));
    await stops(p, 'focus lost with ArrowRight held and its keyup never delivered (simulated)');
    // A keyup swallowed while Cmd was held (macOS sends none): Cmd down clears it.
    await reset(p);
    await synth(p, 'keydown', 'ArrowDown');
    await sleep(200);
    await synth(p, 'keydown', 'MetaLeft', { metaKey: true });
    await synth(p, 'keyup', 'MetaLeft');
    await stops(p, 'ArrowDown keyup lost under Cmd (simulated)');

    // 8. Hidden tab, pointer-lock loss and reacquisition.
    await reset(p);
    await p.keyboard.down('ArrowLeft'); await sleep(250);
    await p.evaluate(() => document.exitPointerLock());
    await sleep(300);
    await p.keyboard.up('ArrowLeft');
    const unlocked = await chain(p);
    check('losing the mouse capture with an arrow held drops it', unlocked.keys.length === 0, { keys: unlocked.keys, locked: unlocked.locked });
    if (await p.isVisible('#btn-resume')) await p.click('#btn-resume');
    await sleep(300);
    if (!(await chain(p)).locked) await clickToAim(p);
    await reset(p);
    await moves(p, ['ArrowRight'], 'after recapturing the mouse: ArrowRight', { mx: 1 });
    await up(p, ['ArrowRight']);
    await stops(p, 'after recapture');

    // 9. Elimination and respawn with an arrow held; then a rematch.
    await reset(p);
    await p.keyboard.down('ArrowUp'); await sleep(200);
    await p.evaluate(() => { const f = (window as any).__fps; const room = [...f.host().hub.rooms.values()][0]; const me = room.sim.players.get(f.session().id); me.protectedUntil = 0; me.hp = 1; const q = [...room.sim.players.values()].find((x: any) => x.isBot); q.body.x = me.body.x; q.body.z = me.body.z + 1.1; q.protectedUntil = 0; q.weapon = 0; room.sim.queueInput(q.id, { seq: q.lastSeq + 1, mx: 0, mz: 0, yaw: 0, pitch: -0.3, buttons: 8, weapon: 0 }); });
    await p.waitForFunction(() => !(window as any).__fps.session().alive, undefined, { timeout: 5000, polling: 100 }).catch(() => undefined);
    await p.keyboard.up('ArrowUp');
    await p.waitForFunction(() => (window as any).__fps.session().alive, undefined, { timeout: 8000, polling: 100 }).catch(() => undefined);
    await sleep(300);
    await stops(p, 'eliminated with ArrowUp held, respawned');
    await reset(p); // she may have respawned backed against a wall
    await moves(p, ['ArrowDown'], 'after respawn: ArrowDown', { mz: -1 });
    await up(p, ['ArrowDown']);
    await stops(p, 'after respawn');
    const corr = await p.evaluate(() => { const s = (window as any).__fps.session(); return { corrections: s.corrections, maxCorrection: +s.maxCorrection.toFixed(3) }; });
    check('prediction and the practice host agree (no visible corrections from plain movement)', corr.maxCorrection < 0.25, corr);
    // 10. The same holds and releases with the CPU slowed 6x (long frames, late host ticks).
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    for (const k of ['ArrowUp', 'ArrowLeft', 'KeyW', 'KeyD']) {
      await reset(p);
      await p.keyboard.down(k); await sleep(700); await p.keyboard.up(k);
      await stops(p, `${k} with the CPU slowed 6x`, 800);
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await p.screenshot({ path: path.join(OUT, 'movement-final.png') });
  } finally {
    await browser.close();
    preview?.kill();
  }
  check('no page errors', errors.length === 0, errors.slice(0, 5));
  fs.writeFileSync(path.join(OUT, 'movement-e2e.json'), JSON.stringify({ browser: 'Chromium (Playwright, headless, Linux)', checks }, null, 1));
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
