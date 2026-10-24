// Browser checks for the elimination replay, in offline practice (the real
// page, the in-page host and the real sim). A bot is placed and told to
// swing or throw (the same inputs a bot sends); you are eliminated for real,
// and the page's own replay plays. Each check reads the engine's replay
// state, the HUD and the match, and the run writes a JSON report.
//
//   GRAPHICS_EXPERIMENT=1 npm run build && OUT=<dir> node --import tsx scripts/killcam-e2e.ts
//   ONLY=chanclazo,reves,...   run some checks;  VIDEO=1 records the clip
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Browser, BrowserContext, Page } from 'playwright-core';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.PORT || 4186);
const SITE = `http://localhost:${PORT}/`;
const DIST = path.resolve(process.env.DIST || path.join(ROOT, 'dist'));
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'artifacts/killcam'));
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const results: Array<{ name: string; ok: boolean; detail: unknown }> = [];
function check(name: string, ok: boolean, detail: unknown = null): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== null ? ` ${JSON.stringify(detail)}` : ''}`);
}

async function waitHttp(url: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

interface OpenOpts { touch?: boolean; killcam?: boolean; quality?: string; video?: boolean; lang?: string; small?: boolean }

async function open(browser: Browser, o: OpenOpts = {}): Promise<{ ctx: BrowserContext; p: Page }> {
  const ctx = await browser.newContext(o.touch
    ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...(o.video ? { recordVideo: { dir: OUT, size: { width: 844, height: 390 } } } : {}) }
    : { viewport: { width: o.small ? 768 : 960, height: o.small ? 432 : 540 }, ...(o.video ? { recordVideo: { dir: OUT, size: { width: 960, height: 540 } } } : {}) });
  await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const p = await ctx.newPage();
  const settings = { practiceMap: 'patio', practiceAllies: 0, practiceEnemies: 1, practiceDifficulty: 'easy', quality: o.quality ?? 'medium', qualityMode: o.quality ?? 'medium', music: 0, killcam: o.killcam ?? true, lang: o.lang ?? 'en' };
  await p.addInitScript({ content: `window.__name = (f) => f; try { localStorage.setItem('chancla.mp.settings.v1', JSON.stringify(${JSON.stringify(settings)})); } catch {}` });
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  p.on('console', (m) => { if (/not eliminated/.test(m.text())) console.log(m.text()); });
  await p.goto(SITE);
  await p.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { polling: 100 });
  await sleep(400);
  await p.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
  await p.evaluate(() => (document.getElementById('btn-practice-start') as HTMLElement).click());
  await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing' && (window as any).__fps.session()?.alive, undefined, { timeout: 40000, polling: 100 });
  // A real tap puts the page in touch mode (the touch controls), as a phone would.
  if (o.touch) { await sleep(300); await p.touchscreen.tap(422, 120); await sleep(400); }
  // "Click to aim": headless Chromium refuses the pointer lock, so the page falls back to drag-to-look and play runs.
  if (!o.touch) { await sleep(300); if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true }); else await p.click('#stage', { force: true }); await sleep(600); }
  await p.evaluate(() => {
    const f = (window as any).__fps;
    const room = [...f.host().hub.rooms.values()][0];
    for (const m of room.members.values()) if (m.bot) m.brain = null;
  });
  await sleep(1500);
  return { ctx, p };
}

/** A bot eliminates you: 'chanclazo' | 'reves' (to the face) | 'throw'. Returns the score and hp before. */
async function eliminate(p: Page, kind: 'chanclazo' | 'reves' | 'throw' | 'heavy'): Promise<{ scores: number[]; botHp: number; deaths: number }> {
  return p.evaluate(async (kind) => {
    const f = (window as any).__fps, s = f.session(), room = [...f.host().hub.rooms.values()][0], sim = room.sim;
    const me = sim.players.get(s.id);
    const bot = [...sim.players.values()].find((q: any) => q.team !== me.team);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // Somewhere open (the plaza in front of the café), the bot in front of you (10 m for a throw: about a quarter of a second in the air).
    const thrown = kind === 'throw' || kind === 'heavy';
    me.body.x = -6; me.body.z = 3; me.body.y = 0; me.body.vx = me.body.vz = 0; me.protectedUntil = 0;
    bot.body.x = thrown ? 4 : -4.9; bot.body.z = 3; bot.body.y = 0; bot.body.vx = bot.body.vz = 0; bot.protectedUntil = 0;
    const w = kind === 'reves' || kind === 'heavy' ? 1 : 0;
    bot.weapon = w; bot.switchMs = 0; bot.cooldownMs = 0; bot.meleeMs = 0; bot.hp = 100;
    await wait(1400); // a lead-in for the replay
    const before = { scores: [...sim.scores], botHp: bot.hp, deaths: me.stats.deaths };
    me.hp = kind === 'reves' ? 40 : kind === 'chanclazo' ? 20 : 5;
    me.protectedUntil = 0;
    const yaw = Math.PI / 2, pitch = kind === 'reves' ? 0.12 : thrown ? -0.03 : -0.25;
    let seq = bot.lastSeq;
    const buttons = thrown ? 1 : 8; // BTN.fire, BTN.melee
    // The host keeps at most 40 queued inputs (NET.maxInputQueue); the bot's aim persists after the last one.
    for (let i = 0; i < 30; i++) sim.queueInput(bot.id, { seq: ++seq, mx: 0, mz: 0, yaw, pitch, buttons: i === 0 ? buttons : 0, weapon: w });
    for (let i = 0; i < 100 && s.alive; i++) await wait(20);
    if (s.alive) console.log('not eliminated', JSON.stringify({ me: [me.body.x, me.body.z, me.hp], bot: [bot.body.x, bot.body.z, bot.weapon, bot.meleeMs], swings: bot.stats.swings }));
    return before;
  }, kind);
}

const state = (p: Page) => p.evaluate(() => (window as any).__fps.engine().killcamState);
async function untilState(p: Page, pred: string, ms = 4000): Promise<boolean> {
  try { await p.waitForFunction(`(() => { const k = window.__fps.engine().killcamState; return ${pred}; })()`, undefined, { timeout: ms, polling: 30 }); return true; } catch { return false; }
}
const untilAlive = (p: Page) => p.waitForFunction(() => (window as any).__fps.session().alive, undefined, { timeout: 8000, polling: 50 });

/** HUD while the replay shows: overlay text, and the live parts hidden. */
const hudNow = (p: Page) => p.evaluate(() => {
  const vis = (id: string) => { const e = document.getElementById(id); return !!e && e.checkVisibility({ visibilityProperty: true } as never); };
  return {
    overlay: vis('killcam'), by: document.getElementById('kc-by')?.textContent?.replace(/\s+/g, ' ').trim(), nameClass: document.getElementById('kc-name')?.className,
    hp: vis('hp'), scores: vis('sc-sol'), timer: vis('timer'), crosshair: vis('crosshair'), killfeed: vis('killfeed'), menu: vis('btn-menu'),
    skip: vis('kc-skip'), tap: vis('kc-tap'),
  };
});

/**
 * Where the finishing blow lands on screen, and whether any replay overlay covers it
 * (the REPLAY tag, the attribution line, Skip or Tap to skip, the respawn countdown).
 */
const contactClear = (p: Page) => p.evaluate(() => {
  const f = (window as any).__fps, e = f.engine(), me = f.session().id, cam = e.camera;
  const hit = [...e.killcam.rec.events].reverse().find((r: any) => r.e.k === 'hit' && r.e.v === me);
  if (!hit) return { ok: false, why: 'no hit' };
  const v = new cam.position.constructor(hit.e.p[0], hit.e.p[1], hit.e.p[2]).project(cam);
  const W = innerWidth, H = innerHeight, x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H;
  const covers: string[] = [];
  for (const sel of ['.kc-tag', '#kc-by', '#kc-skip', '.kc-tap span', '#sub-msg']) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el || !el.checkVisibility({ visibilityProperty: true } as never)) continue;
    const r = el.getBoundingClientRect();
    if (x > r.left - 12 && x < r.right + 12 && y > r.top - 12 && y < r.bottom + 12) covers.push(sel);
  }
  return { ok: v.z < 1 && x > 0 && x < W && y > 0 && y < H && !covers.length, x: Math.round(x), y: Math.round(y), covers };
});

const simInfo = (p: Page) => p.evaluate(() => {
  const f = (window as any).__fps, s = f.session(), room = [...f.host().hub.rooms.values()][0], sim = room.sim;
  const me = sim.players.get(s.id), bot = [...sim.players.values()].find((q: any) => q.team !== me.team);
  return { scores: [...sim.scores] as number[], botHp: bot.hp, deaths: me.stats.deaths, kills: bot.stats.kills, alive: s.alive, held: f.input().heldCount, vy: s.body.vy, onGround: s.body.onGround };
});

/** Per-frame renderer counts by phase (live, replay, death screen), sampled in the page. */
async function startSampler(p: Page): Promise<void> {
  await p.evaluate(() => {
    const f = (window as any).__fps, r = f.engine().renderer;
    (window as any).__samples = {};
    // Whole frames: the counts add up over the scene and hand passes, read and cleared once per frame (this runs after the engine's frame).
    r.info.autoReset = false;
    const loop = () => {
      const s = f.session(), k = f.engine().killcamState;
      const ph = k.active ? 'replay' : s?.alive ? 'live' : 'dead';
      const acc = (window as any).__samples;
      const a = acc[ph] ?? (acc[ph] = { n: 0, calls: 0, tris: 0, ms: 0 });
      a.n++; a.calls += r.info.render.calls; a.tris += r.info.render.triangles; a.ms += f.engine().frameMs;
      r.info.reset();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}
const samples = (p: Page) => p.evaluate(() => Object.fromEntries(Object.entries((window as any).__samples as Record<string, { n: number; calls: number; tris: number; ms: number }>).map(([k, v]) => [k, { frames: v.n, calls: Math.round(v.calls / v.n), tris: Math.round(v.tris / v.n), cpuMs: +(v.ms / v.n).toFixed(1) }])));

/** Approximate bytes the replay buffer holds beyond what the session already keeps. */
const bufferBytes = (p: Page) => p.evaluate(() => {
  const rec = (window as any).__fps.engine().killcam.rec;
  const snaps = rec.snaps.slice(0, Math.max(0, rec.snaps.length - 40)); // the newest 40 are the session's own history too
  const players = snaps.reduce((n: number, sn: any) => n + JSON.stringify([...sn.players.values()]).length, 0);
  return { snapshotsOnlyHere: snaps.length, playersBytes: players, eventsBytes: JSON.stringify(rec.events).length, size: rec.size };
});

async function main(): Promise<void> {
  let preview: ChildProcess | null = null;
  if (!(await waitHttp(SITE, 500))) {
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST], { cwd: ROOT, stdio: 'ignore' });
    if (!(await waitHttp(SITE))) throw new Error('preview did not start');
  }
  const browser: Browser = await launch();
  const want = (n: string) => !ONLY || ONLY.has(n);
  const report: Record<string, unknown> = {};
  try {
    if (want('desktop')) {
      // Low quality keeps the software renderer near 10 fps, so 30 Hz sampling sees a thrown chancla's short flight.
      const { ctx, p } = await open(browser, { quality: process.env.QUALITY || 'low' });
      await startSampler(p);
      // 1. El Chanclazo.
      const menuBefore = (await hudNow(p)).menu;
      let before = await eliminate(p, 'chanclazo');
      let started = await untilState(p, 'k.active', 3000);
      let k = await state(p);
      const hud = await hudNow(p);
      // While the replay is still on screen (the screenshot below is slow in software rendering).
      await untilState(p, 'k.rt >= 100', 2000); // the replay's camera is placed
      const clear1 = { ...(await contactClear(p)), active: (await state(p)).active };
      await p.screenshot({ path: path.join(OUT, 'desktop-replay-chanclazo.png') });
      check('chanclazo: replay starts after the death screen', started, { view: k.view, length: k.length, killer: k.killer });
      check('chanclazo: the melee view (both of them, not her eyes), 1.5 s (1.2 s before the blow, 0.3 s after)', k.view === 'melee' && k.length === 1500, { view: k.view, length: k.length });
      check('chanclazo: the contact is on screen and no overlay covers it (desktop)', clear1.ok && clear1.active, clear1);
      check('chanclazo: overlay names killer, team and attack', hud.overlay && /Eliminated by ☾ .+ \(Luna\) · El Chanclazo/.test(hud.by ?? '') && /luna/.test(hud.nameClass ?? ''), hud.by);
      check('chanclazo: live health, scores, timer, crosshair and kill feed hidden', !hud.hp && !hud.scores && !hud.timer && !hud.crosshair && !hud.killfeed, hud);
      check('chanclazo: menu button kept; desktop Skip shown, no tap layer', hud.menu === menuBefore && hud.skip && !hud.tap, hud);
      await untilState(p, '!k.active', 4000);
      k = await state(p);
      check('chanclazo: the attacker is drawn mid-swing in the replay', k.last?.swingShown === true, k.last);
      check('chanclazo: plays to its end in real time, then the death screen', k.last?.reason === 'done' && k.last.shownMs === 1500 && Math.abs((k.last.endedAt - k.last.startedAt) - 1500) < 400, k.last);
      check('chanclazo: two replay sounds at most (the swing and the slap)', (k.last?.cues ?? 9) <= 2 && (k.last?.cues ?? 0) >= 1, k.last?.cues);
      await untilAlive(p);
      let after = await simInfo(p);
      check('chanclazo: one kill and one death scored; the replay adds no damage, score or kill', after.deaths === before.deaths + 1 && after.scores[0] + after.scores[1] === before.scores.reduce((a, b) => a + b, 0) + 1 && after.botHp === before.botHp, { before, after });

      // 2. El Revés to the face: the rollers that came off, once.
      before = await eliminate(p, 'reves');
      await untilState(p, 'k.active', 3000);
      await p.waitForTimeout(700);
      await p.screenshot({ path: path.join(OUT, 'desktop-replay-reves.png') });
      await untilState(p, '!k.active', 4000);
      k = await state(p);
      // Every roller the server said came off, once; Low (like live play on Low) launches only the first of a scatter.
      const ru = await p.evaluate(() => { const me = (window as any).__fps.session().id, low = (window as any).__fps.engine().killcamState && document.documentElement && JSON.parse(localStorage.getItem('chancla.mp.settings.v1') || '{}').quality === 'low'; const evs = (window as any).__fps.engine().killcam.rec.events.filter((r: any) => (r.e.k === 'hit' || r.e.k === 'elim') && r.e.ru && r.e.v === me).slice(-2); return { sent: evs.reduce((n: number, r: any) => n + r.e.ru.length, 0), expected: evs.reduce((n: number, r: any) => n + (r.e.k === 'elim' && low ? Math.min(1, r.e.ru.length) : r.e.ru.length), 0) }; });
      check('revés: the melee view, the attacker drawn mid-swing', k.last?.view === 'melee' && k.last?.swingShown === true, k.last);
      check('revés: the rollers the server sent fly once in the replay', k.last?.ruleros === ru.expected && ru.sent >= 1, { shown: k.last?.ruleros, ...ru });
      await untilAlive(p);

      // 3. A thrown chancla: the chancla in the air, from the attacker or behind you.
      before = await eliminate(p, 'throw');
      started = await untilState(p, 'k.active', 3000);
      const hudT = await hudNow(p);
      await p.waitForTimeout(500);
      await p.screenshot({ path: path.join(OUT, 'desktop-replay-thrown.png') });
      await untilState(p, '!k.active', 4000);
      k = await state(p);
      check('thrown: replay with the chancla in flight', started && (k.last?.projMax ?? 0) >= 1, k.last);
      check('thrown: overlay says La Chancla, thrown', /La Chancla, thrown/.test(hudT.by ?? ''), hudT.by);
      await untilAlive(p);

      // 4. Space skips, and the whole press is used up: held through respawn with the
      //    keyboard's auto-repeat, it never jumps; a fresh press afterwards does.
      await eliminate(p, 'chanclazo');
      await untilState(p, 'k.active', 3000);
      await p.keyboard.down('Space');
      await untilState(p, '!k.active', 1000);
      k = await state(p);
      check('Space skips the replay', k.last?.reason === 'skip', k.last);
      const deadAfterSkip = await simInfo(p);
      check('after Skip: back to the death screen, nothing held', !deadAfterSkip.alive && deadAfterSkip.held === 0, deadAfterSkip);
      // Auto-repeat, as a held key sends it (about 30 a second), until well after respawn.
      await p.evaluate(() => { (window as any).__rep = setInterval(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', repeat: true, bubbles: true, cancelable: true })), 33); });
      await untilAlive(p);
      let maxVy = 0, airborne = false;
      for (let i = 0; i < 12; i++) { await p.waitForTimeout(100); const x = await simInfo(p); maxVy = Math.max(maxVy, x.vy); airborne ||= !x.onGround; }
      after = await simInfo(p);
      check('Space held through respawn (auto-repeat): no jump', !airborne && maxVy < 0.01 && after.held === 0, { maxVy, airborne, held: after.held });
      await p.evaluate(() => clearInterval((window as any).__rep));
      await p.keyboard.up('Space');
      await p.waitForTimeout(200);
      await p.keyboard.down('Space');
      let jumped = false;
      for (let i = 0; i < 10 && !jumped; i++) { await p.waitForTimeout(60); const x = await simInfo(p); jumped = x.vy > 0.5 || !x.onGround; }
      await p.keyboard.up('Space');
      check('a fresh Space press afterwards jumps', jumped, null);
      await p.waitForTimeout(800);

      // 5. Respawn during playback ends it at once.
      await eliminate(p, 'chanclazo');
      await untilState(p, 'k.active', 3000);
      await p.evaluate(() => { const f = (window as any).__fps, room = [...f.host().hub.rooms.values()][0], sim = room.sim; sim.players.get(f.session().id).respawnAt = sim.timeMs + 100; });
      await untilState(p, '!k.active', 2000);
      k = await state(p);
      after = await simInfo(p);
      check('respawn during playback ends it immediately and play resumes', k.last?.reason === 'respawn' && (k.last.shownMs ?? 9999) < 1500, { last: k.last, alive: after.alive });
      await untilAlive(p);

      // 6. Esc (practice menu) and focus loss pause the replay with the match; Resume carries on.
      await eliminate(p, 'chanclazo');
      await untilState(p, 'k.active', 3000);
      await p.keyboard.press('Escape');
      await p.waitForTimeout(250);
      const rt0 = (await state(p)).rt;
      await p.waitForTimeout(700);
      const k6 = await state(p);
      const screen = await p.evaluate(() => (window as any).__fps.screen);
      check('Esc: the menu opens and the replay holds still with the paused match', screen === 'pause' && k6.active && k6.rt === rt0, { screen, rt0, rt: k6.rt });
      await p.click('#btn-resume');
      if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true });
      await untilState(p, '!k.active', 4000);
      k = await state(p);
      check('Resume: the replay carries on to its end', k.last?.reason === 'done' || k.last?.reason === 'respawn', k.last);
      await untilAlive(p);
      // Focus loss: the page goes to the background.
      await eliminate(p, 'chanclazo');
      await untilState(p, 'k.active', 3000);
      await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await p.waitForTimeout(500);
      const k7 = await state(p);
      const held7 = (await simInfo(p)).held;
      await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
      check('focus loss: menu, nothing held, replay paused with the match', k7.active && held7 === 0 && (await p.evaluate(() => (window as any).__fps.screen)) === 'pause', { active: k7.active, held7 });
      await p.click('#btn-resume');
      if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true });
      await untilState(p, '!k.active', 4000);
      await untilAlive(p);

      // 7. The setting off: the existing death screen only.
      await p.evaluate(() => { const c = document.getElementById('set-killcam') as HTMLInputElement; c.checked = false; c.dispatchEvent(new Event('change')); });
      const off0 = (await state(p)).counts.started;
      await eliminate(p, 'chanclazo');
      const none = !(await untilState(p, 'k.active', 2500));
      const center = await p.evaluate(() => document.getElementById('center-msg')?.textContent);
      k = await state(p);
      check('setting off: no replay, the death screen as before', none && k.counts.started === off0 && k.lastFallback === 'off', { lastFallback: k.lastFallback, center });
      await untilAlive(p);
      await p.evaluate(() => { const c = document.getElementById('set-killcam') as HTMLInputElement; c.checked = true; c.dispatchEvent(new Event('change')); });
      await p.waitForTimeout(3600); // the buffer refills

      // 8. Repeated deaths: no growth.
      const mem0 = await p.evaluate(() => ({ ...(window as any).__fps.engine().renderer.info.memory, pool: (window as any).__fps.engine().killcamState.pool }));
      const startedBefore = (await state(p)).counts.started;
      for (let i = 0; i < 5; i++) { await eliminate(p, i % 2 ? 'reves' : 'chanclazo'); await untilState(p, 'k.active', 3000); await untilState(p, '!k.active', 4000); await untilAlive(p); }
      const mem1 = await p.evaluate(() => ({ ...(window as any).__fps.engine().renderer.info.memory, pool: (window as any).__fps.engine().killcamState.pool }));
      k = await state(p);
      const buf = await bufferBytes(p);
      check('repeated deaths: one replay each; characters, geometry and buffer do not grow', k.counts.started === startedBefore + 5 && mem1.pool === mem0.pool && mem1.geometries <= mem0.geometries + 2 && buf.size.snaps <= 90 && buf.size.events <= 256, { mem0, mem1, size: buf.size, started: k.counts.started });
      report.buffer = buf;
      report.costs = await samples(p);

      // 9. The match ends with the elimination: no replay, the results.
      await p.evaluate(() => { const f = (window as any).__fps, room = [...f.host().hub.rooms.values()][0], sim = room.sim; const me = sim.players.get(f.session().id); const bot = [...sim.players.values()].find((q: any) => q.team !== me.team); sim.scores[bot.team] = room.sim.scoreToWin ? room.sim.scoreToWin - 1 : 14; });
      const sc = await p.evaluate(() => { const f = (window as any).__fps, room = [...f.host().hub.rooms.values()][0]; return { scores: [...room.sim.scores], toWin: room.sim.scoreToWin ?? null }; });
      await eliminate(p, 'chanclazo');
      const noReplay = !(await untilState(p, 'k.active', 2500));
      const ended = await p.evaluate(() => { const f = (window as any).__fps, room = [...f.host().hub.rooms.values()][0]; return { session: f.session().phase, room: room.phase, sim: room.sim?.phase, scores: room.sim ? [...room.sim.scores] : null, screen: f.screen }; });
      check('match end on the elimination: no replay, results', noReplay && ended.room === 'results' && ended.screen === 'results', { ended, sc });
      await ctx.close();
    }

    // Rendering cost by quality: the replay against the death screen it replaces (same spot, same kill).
    if (want('costs')) {
      const costs: Record<string, unknown> = {};
      for (const q of ['high', 'medium', 'low']) {
        const { ctx, p } = await open(browser, { quality: q });
        await startSampler(p);
        await p.evaluate(() => { const c = document.getElementById('set-killcam') as HTMLInputElement; c.checked = false; c.dispatchEvent(new Event('change')); });
        await eliminate(p, 'chanclazo'); await untilAlive(p);
        const deathOnly = await samples(p);
        await p.evaluate(() => { const c = document.getElementById('set-killcam') as HTMLInputElement; c.checked = true; c.dispatchEvent(new Event('change')); (window as any).__samples = {}; });
        await p.waitForTimeout(3600);
        // A first replay builds its two characters once (they are reused): measure the second.
        await eliminate(p, 'chanclazo'); await untilState(p, 'k.active', 3000); await untilState(p, '!k.active', 4000); await untilAlive(p);
        await p.evaluate(() => { (window as any).__samples = {}; });
        await eliminate(p, 'chanclazo'); await untilState(p, 'k.active', 3000); await untilState(p, '!k.active', 4000);
        const withReplay = await samples(p);
        const last = (await state(p)).last;
        costs[q] = { deathScreen: deathOnly.dead, replay: withReplay.replay, live: deathOnly.live, replayJsMsPerFrame: last?.jsMsPerFrame, replayFrames: last?.frames };
        await ctx.close();
      }
      report.costsByQuality = costs;
    }

    // The clip: an elimination, its replay, and back to play, at true speed (VIDEO=1).
    // Rendered frame by frame on Playwright's controlled clock (the in-page host rebased onto it, as in
    // scripts/rosa-review.ts), so the software renderer's frame rate does not show; 30 frames a second.
    if (process.env.VIDEO) {
      const { ctx, p } = await open(browser, { quality: 'medium' });
      await p.evaluate(() => { const h = (window as any).__fps.host(); (window as any).__h0 = h.now(); h.pause(); });
      await p.clock.install();
      await p.clock.pauseAt((await p.evaluate(() => Date.now())) + 200);
      await p.evaluate(() => {
        const h = (window as any).__fps.host();
        h.pausedAt = -1;
        h.pausedTotal = performance.now() - (window as any).__h0;
        for (const room of h.hub.rooms.values()) { room.lastUpdate = h.now(); room.acc = 0; }
        h.timer = setInterval(() => { if (h.pausedAt < 0) h.hub.update(); }, 1000 / 120);
      });
      const run = async (ms: number) => { for (let t = 0; t < ms; t += 50) await p.clock.runFor(Math.min(50, ms - t)); };
      await run(3000);
      const frames = path.join(OUT, 'frames');
      fs.rmSync(frames, { recursive: true, force: true });
      fs.mkdirSync(frames, { recursive: true });
      let n = 0;
      const film = async (ms: number) => { for (let t = 0; t < ms - 1e-6; t += 1000 / 30) { await p.clock.runFor(1000 / 30); await p.screenshot({ path: path.join(frames, `f-${String(n++).padStart(4, '0')}.png`), timeout: 120000 }); } };
      // You face the bot 3 m away; she steps in and lands El Revés to the face.
      await p.evaluate(() => {
        const f = (window as any).__fps, s = f.session(), room = [...f.host().hub.rooms.values()][0], sim = room.sim;
        const me = sim.players.get(s.id), bot = [...sim.players.values()].find((q: any) => q.team !== me.team);
        me.body.x = -6; me.body.z = 3; me.body.vx = me.body.vz = 0; me.protectedUntil = 0; me.hp = 40;
        bot.body.x = -3; bot.body.z = 3; bot.body.vx = bot.body.vz = 0; bot.protectedUntil = 0; bot.weapon = 1; bot.switchMs = 0; bot.cooldownMs = 0; bot.meleeMs = 0;
        f.input().yaw = -Math.PI / 2; f.input().pitch = 0; f.input().weapon = 0;
      });
      await run(600);
      await film(500);
      await p.evaluate(() => {
        const f = (window as any).__fps, s = f.session(), room = [...f.host().hub.rooms.values()][0], sim = room.sim;
        const me = sim.players.get(s.id), bot = [...sim.players.values()].find((q: any) => q.team !== me.team);
        me.hp = 40; me.protectedUntil = 0;
        let seq = bot.lastSeq;
        for (let i = 0; i < 26; i++) sim.queueInput(bot.id, { seq: ++seq, mx: 0, mz: i < 20 ? 1 : 0, yaw: Math.PI / 2, pitch: 0.12, buttons: i === 20 ? 8 : 0, weapon: 1 });
      });
      await film(4000); // the blow, the death screen, the replay, the death screen
      for (let i = 0; i < 90 && !(await p.evaluate(() => (window as any).__fps.session().alive)); i++) await film(100);
      await p.keyboard.down('KeyW');
      await film(1500); // back in play
      await p.keyboard.up('KeyW');
      const last = await state(p);
      fs.writeFileSync(path.join(OUT, 'clip.json'), JSON.stringify({ frames: n, fps: 30, replay: last.last }, null, 1));
      console.log(`clip: ${n} frames; replay ${JSON.stringify(last.last)}`);
      await ctx.close();
    }

    if (want('touch')) {
      const { ctx, p } = await open(browser, { touch: true, quality: 'low' });
      const touchOn = await p.evaluate(() => (window as any).__fps.input().touchMode);
      await eliminate(p, 'reves');
      await untilState(p, 'k.active', 3000);
      const hud = await hudNow(p);
      check('touch: large Tap to skip, no desktop button', touchOn && hud.tap && !hud.skip, { touchOn, hud });
      await untilState(p, 'k.rt >= 100', 2000);
      const clearT = { ...(await contactClear(p)), active: (await state(p)).active };
      check('touch: the contact is on screen and no overlay covers it (phone)', clearT.ok && clearT.active, clearT);
      await p.touchscreen.tap(422, 300);
      await untilState(p, '!k.active', 1500);
      const k = await state(p);
      const info = await simInfo(p);
      const touchUi = await p.evaluate(() => (document.getElementById('fps-touch') as HTMLElement).checkVisibility({ visibilityProperty: true } as never));
      check('touch: a tap skips; nothing held; touch controls back', k.last?.reason === 'skip' && info.held === 0 && touchUi, { last: k.last, held: info.held, touchUi });
      await untilAlive(p);
      // The phone screenshot, from a replay left to play.
      await eliminate(p, 'reves');
      await untilState(p, 'k.active', 3000);
      await p.waitForTimeout(300);
      await p.screenshot({ path: path.join(OUT, 'phone-replay.png') });
      await ctx.close();
    }

    if (want('spanish')) {
      const { ctx, p } = await open(browser, { lang: 'es', quality: 'low' });
      await eliminate(p, 'reves');
      await untilState(p, 'k.active', 3000);
      await p.screenshot({ path: path.join(OUT, 'desktop-replay-es.png') });
      const hud = await hudNow(p);
      const tag = await p.evaluate(() => document.querySelector('.kc-tag')?.textContent);
      check('Spanish: REPETICIÓN, Te eliminó … · El Revés, Saltar', tag === 'REPETICIÓN' && /Te eliminó ☾ .+ \(Luna\) · El Revés/.test(hud.by ?? '') && (await p.evaluate(() => document.getElementById('kc-skip')?.textContent ?? '')).includes('Saltar'), { tag, by: hud.by });
      await ctx.close();
    }
  } finally {
    await browser.close();
    preview?.kill();
    fs.writeFileSync(path.join(OUT, 'killcam-e2e.json'), JSON.stringify({ results, report }, null, 1));
  }
  console.log(JSON.stringify(report));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
