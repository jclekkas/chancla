// ¡Puro Chanclazo! in the real page (Chromium with SwiftShader; the phone is
// emulated, not a real device). Practice (offline build): the selector, the
// HUD, the primary button and V swinging (never a throw, never twice), weapon
// switching, pause, the replay's attribution, and switching back to Classic.
// Phone: the Slap button in the throw button's place, jump and menu.
// Online (a localhost build and a local game server, never production): the
// host's rules in both lobbies, the joiner's own saved choice ignored.
//
//   GRAPHICS_EXPERIMENT=1 npx vite build --outDir <offline> && npx vite build --outDir <online>
//   OFFLINE=<offline> ONLINE=<online> OUT=<dir> node --import tsx scripts/puro-e2e.ts
//   VIDEO=1 records the clip (both attacks), frame by frame on a fake clock.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OFFLINE = path.resolve(process.env.OFFLINE || path.join(ROOT, 'dist'));
const ONLINE = process.env.ONLINE ? path.resolve(process.env.ONLINE) : null;
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'artifacts/puro'));
const PORT_OFF = 4211, PORT_ON = 4212, GAME = 8787;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); };
const procs: ChildProcess[] = [];

async function waitHttp(url: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}
function serve(dir: string, port: number): void {
  procs.push(spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', dir, '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' }));
}

type Opts = { touch?: boolean; lang?: 'en' | 'es'; settings?: Record<string, unknown>; port?: number };
async function page(browser: Browser, o: Opts = {}): Promise<{ ctx: BrowserContext; p: Page }> {
  const site = `http://localhost:${o.port ?? PORT_OFF}/`;
  const ctx = await browser.newContext(o.touch
    ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1100, height: 640 } });
  // Only this site and the local game server: nothing else is reachable.
  await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(site) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const p = await ctx.newPage();
  const settings = { practiceAllies: 0, practiceEnemies: 1, practiceDifficulty: 'easy', quality: 'low', qualityMode: 'low', music: 0, lang: o.lang ?? 'en', name: 'Rosa', ...o.settings };
  await p.addInitScript({ content: `window.__name = (f) => f; try { localStorage.setItem('chancla.mp.settings.v1', JSON.stringify(${JSON.stringify(settings)})); } catch {}` });
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto(site);
  await p.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { polling: 100 });
  await sleep(300);
  return { ctx, p };
}

async function startPractice(p: Page, touch = false): Promise<void> {
  await p.evaluate(() => (document.getElementById('btn-practice-start') as HTMLElement).click());
  await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing' && (window as any).__fps.session()?.alive, undefined, { timeout: 40000, polling: 100 });
  if (touch) { await sleep(300); await p.touchscreen.tap(422, 120); await sleep(400); }
  else { await sleep(300); if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true }); else await p.click('#stage', { force: true }); await sleep(500); }
  // The bot stands still in front of you, 1 m away, on the open floor.
  await p.evaluate(() => {
    const f = (window as any).__fps, s = f.session(), room = [...f.host().hub.rooms.values()][0], sim = room.sim;
    for (const m of room.members.values()) if (m.bot) m.brain = null;
    const me = sim.players.get(s.id), bot = [...sim.players.values()].find((q: any) => q.team !== me.team);
    me.body.x = -6; me.body.z = 3; me.body.y = 0; me.body.vx = me.body.vz = 0; me.protectedUntil = 0;
    bot.body.x = -7.05; bot.body.z = 3; bot.body.y = 0; bot.body.vx = bot.body.vz = 0; bot.protectedUntil = 0; bot.hp = 100;
    f.input().yaw = Math.PI / 2; f.input().pitch = 0.05;
  });
  await sleep(500);
}

const stats = (p: Page) => p.evaluate(() => {
  const f = (window as any).__fps, s = f.session(), room = [...f.host().hub.rooms.values()][0], sim = room.sim;
  const me = sim.players.get(s.id), bot = [...sim.players.values()].find((q: any) => q.team !== me.team);
  return { swings: me.stats.swings, throws: me.stats.throws, meleeHits: me.stats.meleeHits, weapon: me.weapon, botHp: bot.hp, rules: sim.rules, refused: sim.refusedThrows, held: f.input().heldCount, vy: s.body.vy, onGround: s.body.onGround, screen: f.screen };
});
const restore = (p: Page) => p.evaluate(() => {
  const f = (window as any).__fps, s = f.session(), room = [...f.host().hub.rooms.values()][0], sim = room.sim;
  const me = sim.players.get(s.id), bot = [...sim.players.values()].find((q: any) => q.team !== me.team);
  bot.hp = 100; bot.alive = true; me.hp = 100;
  me.body.x = -6; me.body.z = 3; bot.body.x = -7.05; bot.body.z = 3;
  f.input().yaw = Math.PI / 2; f.input().pitch = 0.05;
});
const vis = (p: Page, sel: string) => p.evaluate((sel) => { const e = document.querySelector(sel); return !!e && (e as HTMLElement).checkVisibility({ visibilityProperty: true } as never); }, sel);
const text = (p: Page, sel: string) => p.evaluate((sel) => document.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? null, sel);

async function desktop(browser: Browser): Promise<void> {
  const { ctx, p } = await page(browser, { settings: { practiceMap: 'patio' } });
  await p.click('#btn-practice');
  await sleep(300);
  check('practice: Classic is selected by default', await p.getAttribute('[data-prules="classic"]', 'aria-checked') === 'true');
  await p.click('[data-prules="melee"]');
  await sleep(200);
  const picked = await p.evaluate(() => ({ melee: document.querySelector('[data-prules="melee"]')!.getAttribute('aria-checked'), map: JSON.parse(localStorage.getItem('chancla.mp.settings.v1')!).practiceMap }));
  check('practice: choosing ¡Puro Chanclazo! suggests La Fiesta', picked.melee === 'true' && picked.map === 'fiesta', picked);
  await p.screenshot({ path: path.join(OUT, 'practice-selector-en.png') });
  await ctx.close();
  // The suggestion is only a suggestion: El Patio for the checks (open floor in front of the café).
  const { ctx: ctx2, p: p2 } = await page(browser, { settings: { practiceMap: 'patio', practiceRules: 'melee' } });
  await melee(p2);
  await ctx2.close();
  const { ctx: ctx3, p: p3 } = await page(browser, { settings: { practiceMap: 'patio', practiceRules: 'classic' } });
  await classicAgain(p3);
  await ctx3.close();
}

async function melee(p: Page): Promise<void> {
  await p.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
  await sleep(200);
  await startPractice(p);

  const hud = { chip: await vis(p, '#hud-rules'), kbd: await text(p, '.wslot[data-w="0"] .wmelee kbd'), rules: (await stats(p)).rules };
  check('melee-only HUD: mode chip shown, swing key reads Click · V', hud.chip && hud.kbd === 'Click · V' && hud.rules === 'melee', hud);
  await p.screenshot({ path: path.join(OUT, 'hud-melee-desktop.png') });

  // The primary button (F, the trackpad throw key; a click is the same button) swings: a hold is one swing, never a throw.
  const s0 = await stats(p);
  await p.keyboard.down('KeyF'); await sleep(1200); await p.keyboard.up('KeyF'); await sleep(900);
  const s1 = await stats(p);
  check('primary held 1.2 s: one Chanclazo, no throw', s1.swings - s0.swings === 1 && s1.throws === 0 && s1.meleeHits - s0.meleeHits === 1, { swings: s1.swings - s0.swings, throws: s1.throws, hits: s1.meleeHits - s0.meleeHits });
  // F and V together: still one swing.
  await restore(p);
  await p.keyboard.down('KeyF'); await p.keyboard.down('KeyV'); await sleep(120); await p.keyboard.up('KeyV'); await p.keyboard.up('KeyF'); await sleep(900);
  const s2 = await stats(p);
  check('primary and V together: one swing', s2.swings - s1.swings === 1 && s2.throws === 0, { swings: s2.swings - s1.swings });
  // V alone still works; then La Pesada and El Revés from the primary button.
  await restore(p);
  await p.keyboard.press('KeyV'); await sleep(900);
  const s3 = await stats(p);
  check('V alone still swings', s3.swings - s2.swings === 1);
  await p.keyboard.press('Digit2'); await sleep(700);
  await restore(p);
  await p.keyboard.press('KeyF'); await sleep(1500);
  const s4 = await stats(p);
  check('switch to La Pesada: the primary button is El Revés', s4.weapon === 1 && s4.swings - s3.swings === 1 && s4.botHp <= 100 - 45 && s4.throws === 0, { weapon: s4.weapon, botHp: s4.botHp });

  // Pause shows the match's rules; resume carries on.
  await p.keyboard.press('Escape'); await sleep(500);
  const pm = { screen: (await stats(p)).screen, line: await text(p, '#pause-mode-text') };
  check('pause: menu shows Combat mode: ¡Puro Chanclazo!', pm.screen === 'pause' && pm.line === 'Combat mode: ¡Puro Chanclazo!', pm);
  await p.screenshot({ path: path.join(OUT, 'pause-melee.png') });
  await p.click('#btn-resume', { force: true }).catch(() => p.evaluate(() => (document.getElementById('btn-resume') as HTMLElement)?.click()));
  await sleep(500);
  if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true });
  await sleep(400);
  check('resume: back in play', (await stats(p)).screen === 'none' || (await stats(p)).screen === 'practice', await stats(p));

  // The replay names the melee attack that finished you.
  await p.evaluate(async () => {
    const f = (window as any).__fps, s = f.session(), room = [...f.host().hub.rooms.values()][0], sim = room.sim;
    const me = sim.players.get(s.id), bot = [...sim.players.values()].find((q: any) => q.team !== me.team);
    me.body.x = -6; me.body.z = 3; me.hp = 40; me.protectedUntil = 0;
    bot.body.x = -4.9; bot.body.z = 3; bot.weapon = 1; bot.switchMs = 0; bot.cooldownMs = 0; bot.meleeMs = 0; bot.alive = true; bot.hp = 100;
    await new Promise((r) => setTimeout(r, 1200));
    let seq = bot.lastSeq;
    for (let i = 0; i < 30; i++) sim.queueInput(bot.id, { seq: ++seq, mx: 0, mz: 0, yaw: Math.PI / 2, pitch: 0.12, buttons: i === 0 ? 1 : 0, weapon: 1 }); // the bot's PRIMARY button
  });
  const by = await p.waitForFunction(() => { const t = document.getElementById('kc-by')?.textContent ?? ''; return /Revés/.test(t) ? t.replace(/\s+/g, ' ').trim() : false; }, undefined, { timeout: 8000, polling: 50 }).then((h) => h.jsonValue()).catch(() => null);
  check('killcam: attributed to El Revés (a primary-button swing)', !!by, by);
  await p.screenshot({ path: path.join(OUT, 'killcam-melee.png') });
  await p.waitForFunction(() => (window as any).__fps.session().alive, undefined, { timeout: 12000, polling: 50 });

  // A click shorter than one game tick still swings (the press is latched).
  await restore(p);
  await p.keyboard.press('Digit1'); await sleep(700);
  const q0 = await stats(p);
  await p.keyboard.press('KeyF'); await sleep(900);
  const q1 = await stats(p);
  check('a press shorter than a tick still swings once', q1.swings - q0.swings === 1 && q1.throws === 0, { swings: q1.swings - q0.swings });
}

async function classicAgain(p: Page): Promise<void> {
  // Classic: the chip goes, V is V again, the primary button throws, nothing held leaks across.
  await p.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
  await sleep(200);
  await startPractice(p);
  const c0 = await stats(p);
  const back = { chip: await vis(p, '#hud-rules'), kbd: await text(p, '.wslot[data-w="0"] .wmelee kbd'), rules: c0.rules, held: c0.held };
  check('Classic again: no chip, V hint, nothing held', !back.chip && back.kbd === 'V' && back.rules === 'classic' && back.held === 0, back);
  const enabled = await p.evaluate(() => (window as any).__fps.input().enabled);
  await p.keyboard.down('KeyF'); await sleep(300); await p.keyboard.up('KeyF'); await sleep(600);
  check('Classic again: the primary button throws', (await stats(p)).throws >= 1, { ...(await stats(p)), inputEnabled: enabled });
}

async function inPageSwitch(browser: Browser): Promise<void> {
  // Mode change within one page: a key held when the rules change is dropped.
  const { ctx, p } = await page(browser, { settings: { practiceMap: 'patio', practiceRules: 'melee' } });
  await p.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
  await sleep(200);
  await startPractice(p);
  await p.keyboard.down('KeyW');
  await sleep(200);
  const heldBefore = (await stats(p)).held;
  await p.keyboard.press('Escape'); await sleep(300);
  await p.evaluate(() => (document.getElementById('btn-pause-leave') as HTMLElement).click());
  await sleep(400);
  await p.evaluate(() => (document.getElementById('btn-confirm-yes') as HTMLElement | null)?.click());
  await sleep(600);
  await p.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
  await sleep(200);
  await p.click('[data-prules="classic"]');
  await p.keyboard.up('KeyW');
  await startPractice(p);
  const after = await stats(p);
  check('switching modes in one page: Classic restored, nothing held carried over', heldBefore >= 1 && after.rules === 'classic' && after.held === 0 && !(await vis(p, '#hud-rules')), { heldBefore, after: after.held, rules: after.rules });
  await ctx.close();
}

async function phone(browser: Browser, lang: 'en' | 'es'): Promise<void> {
  const { ctx, p } = await page(browser, { touch: true, lang, settings: { practiceMap: 'patio', practiceRules: 'melee' } });
  await p.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
  await sleep(300);
  if (lang === 'es') await p.screenshot({ path: path.join(OUT, 'practice-selector-es-phone.png') });
  await startPractice(p, true);
  const want = lang === 'es' ? 'Chanclazo' : 'Slap';
  const ui = { label: await text(p, '#ft-throw .ft-lbl'), aria: await p.getAttribute('#ft-throw', 'aria-label'), melee: await vis(p, '#ft-melee'), jump: await vis(p, '#ft-jump'), menu: await vis(p, '#btn-menu') };
  check(`phone (${lang}): the throw button is the ${want} button; the duplicate melee button is gone; jump and menu there`, ui.label === want && ui.aria === want && !ui.melee && ui.jump && ui.menu, ui);
  await p.screenshot({ path: path.join(OUT, `phone-melee-${lang}.png`) });
  if (lang === 'en') {
    const s0 = await stats(p);
    await p.locator('#ft-throw').tap(); await sleep(900);
    const s1 = await stats(p);
    check('phone: a tap on Slap is one swing, no throw', s1.swings - s0.swings === 1 && s1.throws === 0, { swings: s1.swings - s0.swings });
    // A finger on Jump for 150 ms, as a real press.
    const cdp = await p.context().newCDPSession(p);
    const jb = (await p.locator('#ft-jump').boundingBox())!;
    const pt = { x: jb.x + jb.width / 2, y: jb.y + jb.height / 2, id: 7, radiusX: 8, radiusY: 8, force: 1 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
    await sleep(150);
    const j = await stats(p);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    check('phone: jump works', j.vy > 0 || !j.onGround, { vy: j.vy, onGround: j.onGround });
    await sleep(800);
    await p.locator('#btn-menu').tap(); await sleep(500);
    check('phone: menu opens', (await stats(p)).screen === 'pause');
  }
  await ctx.close();
  if (lang === 'en') {
    // Classic on the phone: Throw is back, and so is the melee button.
    const c = await page(browser, { touch: true, settings: { practiceMap: 'patio', practiceRules: 'classic' } });
    await c.p.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
    await sleep(200);
    await startPractice(c.p, true);
    const ui = { label: await text(c.p, '#ft-throw .ft-lbl'), melee: await vis(c.p, '#ft-melee') };
    check('phone, Classic: Throw and the melee button as before', ui.label === 'Throw' && ui.melee, ui);
    await c.p.screenshot({ path: path.join(OUT, 'phone-classic-en.png') });
    await c.ctx.close();
  }
}

async function online(browser: Browser): Promise<void> {
  if (!ONLINE) { console.log('skip online (no ONLINE build)'); return; }
  // Host: Create Room with ¡Puro Chanclazo!. Joiner: has Classic saved, joins by code.
  const host = await page(browser, { port: PORT_ON, settings: { roomRules: 'classic', name: 'Rosa' } });
  await host.p.click('#btn-online'); await sleep(300);
  await host.p.click('[data-rrules="melee"]'); await sleep(150);
  await host.p.screenshot({ path: path.join(OUT, 'create-room-selector.png') });
  await host.p.click('#btn-create');
  await host.p.waitForFunction(() => (window as any).__fps.screen === 'lobby', undefined, { timeout: 15000, polling: 100 });
  await sleep(500);
  const code = (await text(host.p, '#room-code'))!;
  const joiner = await page(browser, { port: PORT_ON, settings: { roomRules: 'classic', name: 'Lupita' } });
  await joiner.p.click('#btn-online'); await sleep(300);
  await joiner.p.fill('#in-code', code);
  await joiner.p.click('#btn-join');
  await joiner.p.waitForFunction(() => (window as any).__fps.screen === 'lobby', undefined, { timeout: 15000, polling: 100 });
  await sleep(800);
  const lob = async (p: Page) => ({ melee: await p.getAttribute('[data-lrules="melee"]', 'aria-checked'), classicDisabled: await p.evaluate(() => (document.querySelector('[data-lrules="classic"]') as HTMLButtonElement).disabled), rules: await text(p, '#lobby-rules') });
  const h = await lob(host.p), j = await lob(joiner.p);
  check('lobby: the host sees ¡Puro Chanclazo! and can change it', h.melee === 'true' && !h.classicDisabled && /melee only/.test(h.rules ?? ''), h);
  check('lobby: the joiner (Classic saved) gets the host\'s ¡Puro Chanclazo!, read-only', j.melee === 'true' && j.classicDisabled && /melee only/.test(j.rules ?? ''), j);
  await host.p.screenshot({ path: path.join(OUT, 'lobby-host.png') });
  await joiner.p.screenshot({ path: path.join(OUT, 'lobby-joiner.png') });
  // The host switches to Classic: the joiner's lobby follows.
  await host.p.click('[data-lrules="classic"]');
  await joiner.p.waitForFunction(() => document.querySelector('[data-lrules="classic"]')?.getAttribute('aria-checked') === 'true', undefined, { timeout: 5000, polling: 50 }).then(() => check('lobby: the host\'s change reaches the joiner', true)).catch(() => check('lobby: the host\'s change reaches the joiner', false));
  await host.ctx.close(); await joiner.ctx.close();
}

async function clip(browser: Browser): Promise<void> {
  if (!process.env.VIDEO) return;
  // Both attacks on El Patio's open square: El Chanclazo from the primary button, switch, El Revés from the primary button.
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(`http://localhost:${PORT_OFF}/`) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const p = await ctx.newPage();
  const settings = { practiceAllies: 0, practiceEnemies: 1, practiceDifficulty: 'easy', quality: 'medium', qualityMode: 'medium', music: 0, lang: 'en', name: 'Rosa', practiceMap: 'patio', practiceRules: 'melee' };
  await p.addInitScript({ content: `window.__name = (f) => f; try { localStorage.setItem('chancla.mp.settings.v1', JSON.stringify(${JSON.stringify(settings)})); } catch {}` });
  await p.goto(`http://localhost:${PORT_OFF}/`);
  await p.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { polling: 100 });
  await p.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
  await sleep(200);
  await p.evaluate(() => (document.getElementById('btn-practice-start') as HTMLElement).click());
  await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing' && (window as any).__fps.session()?.alive, undefined, { timeout: 40000, polling: 100 });
  if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true });
  await sleep(500);
  // The fake clock (as in scripts/killcam-e2e.ts): the in-page host rebased onto it.
  await p.evaluate(() => { const h = (window as any).__fps.host(); (window as any).__h0 = h.now(); h.pause(); });
  await p.clock.install();
  await p.clock.pauseAt((await p.evaluate(() => Date.now())) + 200);
  await p.evaluate(() => {
    const h = (window as any).__fps.host();
    h.pausedAt = -1; h.pausedTotal = performance.now() - (window as any).__h0;
    for (const room of h.hub.rooms.values()) { room.lastUpdate = h.now(); room.acc = 0; }
    h.timer = setInterval(() => { if (h.pausedAt < 0) h.hub.update(); }, 1000 / 120);
    const f = (window as any).__fps, s = f.session(), room = [...h.hub.rooms.values()][0], sim = room.sim;
    for (const m of room.members.values()) if (m.bot) m.brain = null;
    const me = sim.players.get(s.id), bot = [...sim.players.values()].find((q: any) => q.team !== me.team);
    // In front of the café, the bot 1.1 m away facing you.
    me.body.x = -6; me.body.z = 3; me.body.y = 0; me.body.vx = me.body.vz = 0; me.protectedUntil = 0;
    bot.body.x = -4.9; bot.body.z = 3; bot.body.y = 0; bot.body.vx = bot.body.vz = 0; bot.protectedUntil = 0; bot.hp = 100; bot.yaw = Math.PI / 2;
    f.input().yaw = -Math.PI / 2; f.input().pitch = 0.04; f.input().weapon = 0;
  });
  const run = async (ms: number) => { for (let t = 0; t < ms; t += 50) await p.clock.runFor(Math.min(50, ms - t)); };
  await run(800);
  const frames = path.join(OUT, 'frames');
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames, { recursive: true });
  let n = 0;
  const film = async (ms: number) => { for (let t = 0; t < ms - 1e-6; t += 1000 / 30) { await p.clock.runFor(1000 / 30); await p.screenshot({ path: path.join(frames, `f-${String(n++).padStart(4, '0')}.png`), timeout: 120000 }); } };
  await film(400);
  await p.keyboard.down('KeyF'); await film(100); await p.keyboard.up('KeyF'); // El Chanclazo
  await film(1000);
  await p.keyboard.press('Digit2'); // La Pesada
  await film(900);
  await p.keyboard.down('KeyF'); await film(100); await p.keyboard.up('KeyF'); // El Revés
  await film(1600);
  const st = await p.evaluate(() => { const f = (window as any).__fps, s = f.session(), room = [...f.host().hub.rooms.values()][0], sim = room.sim; const me = sim.players.get(s.id); return { swings: me.stats.swings, hits: me.stats.meleeHits, throws: me.stats.throws }; });
  fs.writeFileSync(path.join(OUT, 'clip.json'), JSON.stringify({ frames: n, fps: 30, ...st }, null, 1));
  console.log(`clip: ${n} frames ${JSON.stringify(st)}`);
  await ctx.close();
}

const browser = await launch(['--mute-audio']);
try {
  serve(OFFLINE, PORT_OFF);
  if (ONLINE) {
    serve(ONLINE, PORT_ON);
    procs.push(spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: ROOT, env: { ...process.env, PORT: String(GAME), ALLOWED_ORIGINS: `http://localhost:${PORT_ON}` }, stdio: 'ignore' }));
    await waitHttp(`http://localhost:${GAME}/healthz`);
    await waitHttp(`http://localhost:${PORT_ON}/`);
  }
  await waitHttp(`http://localhost:${PORT_OFF}/`);
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
  if (!only || only.has('desktop')) await desktop(browser);
  if (!only || only.has('switch')) await inPageSwitch(browser);
  if (!only || only.has('phone')) { await phone(browser, 'en'); await phone(browser, 'es'); }
  if (!only || only.has('online')) await online(browser);
  if (!only || only.has('clip')) await clip(browser);
} finally {
  await browser.close();
  for (const c of procs) c.kill('SIGTERM');
}
fs.writeFileSync(path.join(OUT, 'puro-e2e.json'), JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
