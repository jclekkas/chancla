// Graphics experiment: offline practice on El Patio with the upgraded café
// section. Real page, real game loop, local only. Checks that playing still
// works (move, jump, aim, throw, Esc menu and resume, touch controls), that
// the page never tries to reach a game server, and takes in-game screenshots
// from fixed spots so a build with and without the section can be compared.
//
//   GRAPHICS_EXPERIMENT=1 npm run build && node --import tsx scripts/graphics-practice-e2e.ts
//
// DIST=<dir> serves another build (for example production's, for the "before"
// screenshots); LABEL names the output files. Every request that is not to
// this local server is blocked and recorded: the test fails if there is one.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Browser, CDPSession, Page } from 'playwright-core';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.PORT || 4175);
const SITE = `http://localhost:${PORT}/`;
const DIST = path.resolve(process.env.DIST || path.join(ROOT, 'dist'));
const LABEL = process.env.LABEL || 'after';
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'docs/graphics/practice'));
const SHOTS_ONLY = process.env.SHOTS_ONLY === '1';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); };

async function waitHttp(url: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

// Spots for screenshots, at standing eye height (same as the comparison lab).
const SPOTS = {
  player: { x: 2.8, z: -3.4, look: [-2.5, 2.2, -8.5] },
  facade: { x: -4.2, z: -3.6, look: [0.2, 2.6, -8] },
  wide: { x: 9.5, z: 3.5, look: [-4, 2.2, -8] },
  panaderia: { x: -2.8, z: 3.4, look: [2.5, 2.2, 8.5] },
} as const;
const EYE = 1.58;

const st = (p: Page) => p.evaluate(() => {
  const f = (window as any).__fps; const s = f.session(); const i = f.input();
  return { screen: f.screen, alive: !!s?.alive, phase: s?.phase, x: s?.body.x ?? 0, y: s?.body.y ?? 0, z: s?.body.z ?? 0, onGround: !!s?.body.onGround, yaw: i.yaw, pitch: i.pitch, shots: s?.localShot ?? 0, held: i.heldCount, locked: i.locked, touch: f.touchMode, controls: !!f.touch()?.visible, map: s?.room?.map ?? null };
});

/** Polls the state until `ok` holds (the software renderer runs the game slowly, so fixed waits are not enough). */
async function until(p: Page, ok: (s: Awaited<ReturnType<typeof st>>) => boolean, ms = 6000): Promise<Awaited<ReturnType<typeof st>>> {
  const end = Date.now() + ms; let s = await st(p);
  while (!ok(s) && Date.now() < end) { await sleep(100); s = await st(p); }
  return s;
}

/** Whole-frame renderer counts (the game renders the world, then the held item; three.js resets its counters per render call). */
async function frameStats(p: Page): Promise<{ drawCalls: number; triangles: number; geometries: number; textures: number; pixelRatio: number }> {
  return p.evaluate(() => new Promise((res) => {
    const r = (window as any).__fps.engine().renderer;
    r.info.autoReset = false;
    requestAnimationFrame(() => { r.info.reset(); requestAnimationFrame(() => setTimeout(() => {
      const o = { drawCalls: r.info.render.calls, triangles: r.info.render.triangles, geometries: r.info.memory.geometries, textures: r.info.memory.textures, pixelRatio: r.getPixelRatio() };
      r.info.autoReset = true; res(o);
    }, 0)); });
  }));
}

/** Moves Rosa on the authoritative practice host and in the client's prediction, then points the view. */
async function place(p: Page, x: number, z: number, look: readonly number[]): Promise<void> {
  await p.evaluate(({ x, z, look, EYE }) => {
    const f = (window as any).__fps; const s = f.session(); const h = f.host();
    const room = [...h.hub.rooms.values()][0]; const sp = room.sim.players.get(s.id);
    for (const b of [sp.body, s.body]) { b.x = x; b.z = z; b.y = 0; b.vx = 0; b.vy = 0; b.vz = 0; }
    const dx = look[0]! - x, dz = look[2]! - z, dy = look[1]! - EYE;
    const i = f.input(); i.yaw = Math.atan2(-dx, -dz); i.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }, { x, z, look, EYE });
}

/** Holds the bots back: they stay where they are while screenshots are taken. */
async function freezeBots(p: Page): Promise<void> {
  await p.evaluate(() => {
    const f = (window as any).__fps; const room = [...f.host().hub.rooms.values()][0];
    for (const pl of room.sim.players.values()) if (pl.isBot) { pl.body.x = 40; pl.body.z = 40; }
  });
}

async function desktop(browser: Browser, blocked: string[], errors: string[]): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript({ content: `window.__name = (f) => f; try { localStorage.setItem('chancla.mp.settings.v1', JSON.stringify({ practiceMap: 'patio', practiceAllies: 0, practiceEnemies: 1, practiceDifficulty: 'easy', quality: 'high', qualityMode: 'high' })); } catch {}` });
  await ctx.route('**/*', (r) => { const u = r.request().url(); if (u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); blocked.push(u); return r.abort(); });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  p.on('websocket', (w) => blocked.push(`websocket ${w.url()}`));
  await p.goto(SITE);
  await p.waitForFunction(() => (window as any).__fps?.screen === 'title');
  await sleep(800);
  const status = await p.evaluate(() => document.getElementById('server-status')?.textContent ?? '');
  if (!SHOTS_ONLY) check('title screen says online play is off on this preview', /Graphics preview|Vista previa/.test(status), status);

  await p.click('#btn-practice');
  await p.evaluate(() => (document.getElementById('btn-practice-start') as HTMLElement).click());
  await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing', undefined, { timeout: 30000 });
  await p.waitForFunction(() => (window as any).__fps.session()?.alive, undefined, { timeout: 15000 });
  const s0 = await st(p);
  if (!SHOTS_ONLY) check('practice starts on El Patio', s0.map === 'patio', { map: s0.map });
  if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true }); else await p.click('#stage', { force: true });
  await sleep(500);

  if (!SHOTS_ONLY) {
    // Move: walk into the café's paved strip and along it.
    await freezeBots(p);
    await place(p, -1.5, -4.5, [-1.5, 1.58, -12]);
    await sleep(300);
    const a = await st(p);
    await p.keyboard.down('KeyW');
    await until(p, (q) => q.z < -7.3, 10000);
    await sleep(1500); // keep pushing into the wall
    const b = await st(p);
    await p.keyboard.up('KeyW'); await sleep(300);
    // Café facade is the plane z = -8; Rosa's radius keeps her off it.
    check('W walks toward the café and stops at its wall (collision unchanged)', b.z < a.z - 1 && b.z > -8 && b.z < -7.3, { from: +a.z.toFixed(2), to: +b.z.toFixed(2) });
    await p.keyboard.down('KeyD');
    const c = await until(p, (q) => Math.abs(q.x - b.x) > 1);
    await p.keyboard.up('KeyD'); await sleep(300);
    check('strafing along the facade works and she stays on the ground (no snag on paving or kerb)', Math.abs(c.x - b.x) > 1 && c.onGround && Math.abs(c.y) < 0.05, { dx: +(c.x - b.x).toFixed(2), y: +c.y.toFixed(3) });
    // Door: shut, so no way in.
    await place(p, -1.5, -6.5, [-1.5, 1.58, -12]);
    await p.keyboard.down('KeyW'); await sleep(2500);
    const d = await st(p);
    await p.keyboard.up('KeyW'); await sleep(200);
    check('walking into the door stops at the wall (the door is shut and solid)', d.z > -8 && d.z < -7.3, { z: +d.z.toFixed(2) });

    // Jump.
    await place(p, 0, -3.6, [0, 1.58, -12]); await sleep(300);
    let peak = 0;
    await p.keyboard.down('Space');
    peak = (await until(p, (q) => q.y > 0.3, 3000)).y;
    await p.keyboard.up('Space');
    for (let i = 0; i < 10; i++) { peak = Math.max(peak, (await st(p)).y); await sleep(40); }
    const j = await until(p, (q) => q.onGround);
    check('Space jumps and she lands back on the paving', peak > 0.4 && j.onGround && Math.abs(j.y) < 0.05, { peak: +peak.toFixed(2), landedY: +j.y.toFixed(3) });

    // Aim and throw.
    await p.mouse.move(640, 360); await sleep(80);
    const y0 = (await st(p)).yaw;
    await p.mouse.move(720, 360, { steps: 4 }); await sleep(150);
    const y1 = (await st(p)).yaw;
    check('mouse turns the view', Math.abs(y1 - y0) > 0.01, { turned: +(y1 - y0).toFixed(3) });
    const t0 = (await st(p)).shots;
    await p.keyboard.down('KeyF'); await sleep(700); await p.keyboard.up('KeyF'); await sleep(200);
    const t1 = (await st(p)).shots;
    check('F throws', t1 > t0, { throws: t1 - t0 });

    // Esc, menu, resume.
    await p.keyboard.press('Escape'); await sleep(400);
    const m = await st(p);
    check('Esc opens the menu with nothing held', m.screen === 'pause' && m.held === 0, { screen: m.screen, held: m.held });
    await p.click('#btn-resume'); await sleep(500);
    const r = await st(p);
    await p.keyboard.down('KeyS');
    const r2 = await until(p, (q) => Math.hypot(q.x - r.x, q.z - r.z) > 0.3);
    await p.keyboard.up('KeyS'); await sleep(200);
    check('Resume returns to play and controls respond', r.screen !== 'pause' && Math.hypot(r2.x - r.x, r2.z - r.z) > 0.3, { screen: r.screen, moved: +Math.hypot(r2.x - r.x, r2.z - r.z).toFixed(2) });

    // Music is a separate system: still in the same state as before.
    const mus = await p.evaluate(() => { try { return (window as any).__fps.music().state(); } catch (e) { return { error: String(e) }; } });
    check('music controller still reports a state (not touched by this change)', !!mus && !('error' in mus), mus);
  }

  // Screenshots and frame timing at fixed spots.
  const perf: Record<string, unknown> = {};
  await p.waitForFunction(() => { const el = document.getElementById('spawn-banner'); return !el || el.hidden || getComputedStyle(el).opacity === '0'; }, undefined, { timeout: 8000 }).catch(() => undefined);
  await sleep(4000); // let the start-of-match banners fade
  for (const [name, spot] of Object.entries(SPOTS)) {
    await freezeBots(p);
    await place(p, spot.x, spot.z, spot.look);
    await sleep(900);
    await place(p, spot.x, spot.z, spot.look); // settle again in case a snapshot arrived
    await sleep(400);
    await p.screenshot({ path: path.join(OUT, `${name}-${LABEL}.png`) });
    // 3 s of frame timing at this spot (the game's own counter).
    const samples: number[] = [];
    for (let i = 0; i < 6; i++) { await sleep(500); samples.push((await p.evaluate(() => (window as any).__fps.info())).fps as number); }
    const info = await p.evaluate(() => (window as any).__fps.info());
    perf[name] = { fps: samples, ...(await frameStats(p)), quality: info.quality };
  }
  // Team readability: an enemy (Luna) standing in front of the café door, seen from the plaza.
  await place(p, 3.2, -2.6, [-1.2, 1.2, -7]);
  await p.evaluate(() => {
    const f = (window as any).__fps; const room = [...f.host().hub.rooms.values()][0];
    for (const pl of room.sim.players.values()) if (pl.isBot) { pl.body.x = -1.2; pl.body.z = -7; pl.body.vx = 0; pl.body.vz = 0; }
  });
  await sleep(350);
  await p.screenshot({ path: path.join(OUT, `readability-${LABEL}.png`) });
  fs.writeFileSync(path.join(OUT, `practice-${LABEL}.json`), JSON.stringify({ label: LABEL, dist: path.relative(ROOT, DIST) || DIST, perf, renderer: await p.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const d = g?.getExtension('WEBGL_debug_renderer_info'); return d ? g!.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; }), ua: await p.evaluate(() => navigator.userAgent) }, null, 1));
  console.log(JSON.stringify(perf));
  await ctx.close();
}

async function phone(browser: Browser, blocked: string[], errors: string[]): Promise<void> {
  const vp = { width: 844, height: 390 };
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 3, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  await ctx.addInitScript({ content: `window.__name = (f) => f; try { localStorage.setItem('chancla.mp.settings.v1', JSON.stringify({ practiceMap: 'patio', practiceAllies: 0, practiceEnemies: 1, practiceDifficulty: 'easy' })); } catch {}` });
  await ctx.route('**/*', (r) => { const u = r.request().url(); if (u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); blocked.push(u); return r.abort(); });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
  const cdp: CDPSession = await ctx.newCDPSession(p);
  type Pt = { x: number; y: number; id: number };
  const T = (type: 'touchStart' | 'touchMove' | 'touchEnd', pts: Pt[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q) => ({ ...q, radiusX: 8, radiusY: 8, force: 1 })) });
  const center = async (sel: string) => { const b = (await p.locator(sel).boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const tap = async (sel: string) => { await p.locator(sel).scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined); const q = await center(sel); await T('touchStart', [{ ...q, id: 40 }]); await sleep(50); await T('touchEnd', [{ ...q, id: 40 }]); await sleep(250); };

  await p.goto(SITE);
  await p.waitForFunction(() => (window as any).__fps?.screen === 'title');
  await sleep(600);
  await tap('#btn-mg-practice'); // phones get the simplified title screen
  await sleep(500);
  await tap('#btn-practice-start');
  await p.waitForFunction(() => (window as any).__fps.session()?.alive, undefined, { timeout: 30000 });
  await sleep(500);
  const a = await st(p);
  check('phone: touch controls shown in practice', a.touch && a.controls, { touch: a.touch, controls: a.controls });
  await freezeBots(p);
  await place(p, 0, -4, [0, 1.58, -12]); await sleep(300); // open paving in front of the café
  const b = await st(p);
  const stick = { x: vp.width * 0.13, y: vp.height * 0.74, id: 1 }, look = { x: vp.width * 0.62, y: vp.height * 0.45, id: 2 };
  await T('touchStart', [stick]);
  for (let i = 1; i <= 10; i++) { await T('touchMove', [{ ...stick, y: stick.y - Math.min(50, i * 7) }]); await sleep(80); }
  const c = await until(p, (q) => Math.hypot(q.x - b.x, q.z - b.z) > 0.5, 8000); // emulated phone at dpr 3 runs slowly here
  await T('touchEnd', [stick]); await sleep(200);
  check('phone: stick moves Rosa', Math.hypot(c.x - b.x, c.z - b.z) > 0.5, { moved: +Math.hypot(c.x - b.x, c.z - b.z).toFixed(2) });
  await T('touchStart', [look]);
  for (let i = 1; i <= 6; i++) { await T('touchMove', [{ ...look, x: look.x + i * 10 }]); await sleep(60); }
  await T('touchEnd', [look]); await sleep(150);
  const d = await st(p);
  check('phone: dragging turns the view', Math.abs(d.yaw - c.yaw) > 0.01, { turned: +(d.yaw - c.yaw).toFixed(3) });
  const s0 = d.shots; await tap('#ft-throw'); await sleep(300);
  check('phone: Throw button throws', (await st(p)).shots > s0);
  await tap('#ft-jump'); let peak = 0; for (let i = 0; i < 10; i++) { peak = Math.max(peak, (await st(p)).y); await sleep(40); }
  check('phone: Jump button jumps', peak > 0.3, { peak: +peak.toFixed(2) });
  await tap('#btn-menu'); await sleep(300);
  check('phone: Menu opens', (await st(p)).screen === 'pause');
  await tap('#btn-resume'); await sleep(300);
  check('phone: Resume returns to play with controls shown', (await st(p)).screen !== 'pause' && (await st(p)).controls);
  await place(p, SPOTS.player.x, SPOTS.player.z, SPOTS.player.look); await sleep(800);
  await p.screenshot({ path: path.join(OUT, `phone-${LABEL}.png`) });
  await ctx.close();
}

async function main(): Promise<void> {
  const procs: ChildProcess[] = [];
  procs.push(spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST], { cwd: ROOT, stdio: 'ignore' }));
  if (!(await waitHttp(SITE))) throw new Error('preview server did not start');
  const browser: Browser = await launch(['--mute-audio']);
  const blocked: string[] = [], errors: string[] = [];
  try {
    await desktop(browser, blocked, errors);
    if (!SHOTS_ONLY) await phone(browser, blocked, errors);
  } finally {
    await browser.close();
    for (const pr of procs) pr.kill();
  }
  // The before build (production code) checks its default local server on the title screen; that is not a game server request from this test.
  const external = blocked.filter((u) => !/^https?:\/\/localhost:8787\//.test(u));
  check('no request or socket left this machine (production game server never contacted)', external.length === 0, external.slice(0, 5));
  check('no page errors', errors.filter((e) => !/Failed to load resource/.test(e)).length === 0, errors.slice(0, 5));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  fs.writeFileSync(path.join(OUT, `checks-${LABEL}.json`), JSON.stringify(checks, null, 1));
  process.exit(failed.length ? 1 : 0);
}

void main();
