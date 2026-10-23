// Close combat in the real page: offline practice on El Patio, local only.
// Desktop: El Chanclazo and El Revés hit, a miss, head hits that knock
// ruleros off, an elimination that scatters the rest, respawn restoring them,
// a held V that never repeats, V ignored while the menu is open, the sandal
// staying in the first-person hand. Phone (emulated, real multi-touch over
// CDP): move, aim, throw, jump and melee together, the button naming the
// attack, no page zoom or scroll. Bots: both attacks show up in a bot match.
//
//   GRAPHICS_EXPERIMENT=1 npm run build && node --import tsx scripts/melee-e2e.ts
//
// Every request that is not to this local server is blocked and recorded.
// This is Chromium with a software renderer on a shared CPU: it proves the
// rules, input and effects, not how it feels or performs on a device.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Browser, CDPSession, Page } from 'playwright-core';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.PORT || 4185);
const SITE = `http://localhost:${PORT}/`;
const DIST = path.resolve(process.env.DIST || path.join(ROOT, 'dist'));
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'docs/melee'));
const ONLY = process.env.ONLY ?? '';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); };

async function waitHttp(url: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

async function startPractice(p: Page, settings: Record<string, unknown>): Promise<void> {
  await p.addInitScript({ content: `window.__name = (f) => f; try { localStorage.setItem('chancla.mp.settings.v1', JSON.stringify(${JSON.stringify(settings)})); } catch {}` });
  await p.goto(SITE);
  await p.waitForFunction(() => (window as any).__fps?.screen === 'title');
  await sleep(600);
  await p.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
  await p.evaluate(() => (document.getElementById('btn-practice-start') as HTMLElement).click());
  await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing', undefined, { timeout: 30000 });
  await p.waitForFunction(() => (window as any).__fps.session()?.alive, undefined, { timeout: 15000 });
  // Record every event the client receives (after deduplication).
  await p.evaluate(() => {
    const s = (window as any).__fps.session();
    const h = s.handlers; const orig = h.event;
    (window as any).__ev = [];
    h.event = (e: any, mine: boolean) => { (window as any).__ev.push({ ...e, at: performance.now() }); orig(e, mine); };
  });
}

// Stages a duel on the practice host: the bots stop thinking, nobody is
// protected, and the opponent stands `dist` m ahead of Rosa, facing her.
async function stage(p: Page, dist: number, opts: { pitch?: number; crouch?: boolean; hp?: number } = {}): Promise<void> {
  await p.evaluate(({ dist, opts }) => {
    const f = (window as any).__fps; const s = f.session(); const room = [...f.host().hub.rooms.values()][0];
    for (const m of room.members.values()) if (m.bot) m.brain = null;
    const me = room.sim.players.get(s.id);
    const foe = [...room.sim.players.values()].find((q: any) => q.isBot && q.team !== me.team);
    const ally = [...room.sim.players.values()].find((q: any) => q.isBot && q.team === me.team);
    if (ally) { ally.body.x = 30; ally.body.z = 30; }
    for (const b of [me.body, s.body]) { b.x = -3; b.z = 3.4; b.y = 0; b.vx = 0; b.vz = 0; b.vy = 0; }
    foe.body.x = -3 + dist; foe.body.z = 3.4; foe.body.y = 0; foe.body.vx = 0; foe.body.vz = 0; foe.body.crouched = !!opts.crouch;
    foe.yaw = Math.PI / 2;
    if (opts.hp !== undefined) foe.hp = opts.hp;
    me.protectedUntil = 0; foe.protectedUntil = 0;
    const i = f.input(); i.yaw = -Math.PI / 2; i.pitch = opts.pitch ?? 0;
  }, { dist, opts });
  await sleep(350);
}

const foeState = (p: Page) => p.evaluate(() => {
  const f = (window as any).__fps; const s = f.session(); const room = [...f.host().hub.rooms.values()][0];
  const me = room.sim.players.get(s.id);
  const foe = [...room.sim.players.values()].find((q: any) => q.isBot && q.team !== me.team);
  const r = s.remotes.get(foe.id);
  return { id: foe.id, hp: foe.hp, alive: foe.alive, ruleros: foe.ruleros, shownRuleros: r?.ruleros ?? -1, mySwings: me.stats.swings, myMeleeHits: me.stats.meleeHits, myThrows: me.stats.throws, weapon: me.weapon };
});

const events = (p: Page, k?: string) => p.evaluate((k) => ((window as any).__ev as any[]).filter((e) => !k || e.k === k), k);
const fx = (p: Page) => p.evaluate(() => { const e = (window as any).__fps.engine(); return { active: e.ruleros.active, spawned: e.ruleros.spawned }; });
const popcount = (n: number) => { let c = 0; while (n) { c += n & 1; n >>= 1; } return c; };

async function untilFoe(p: Page, ok: (s: Awaited<ReturnType<typeof foeState>>) => boolean, ms = 4000) {
  const end = Date.now() + ms; let s = await foeState(p);
  while (!ok(s) && Date.now() < end) { await sleep(60); s = await foeState(p); }
  return s;
}

async function desktop(browser: Browser, blocked: string[], errors: string[]): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.route('**/*', (r) => { const u = r.request().url(); if (u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); blocked.push(u); return r.abort(); });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  p.on('websocket', (w) => blocked.push(`websocket ${w.url()}`));
  await startPractice(p, { practiceMap: 'patio', practiceAllies: 1, practiceEnemies: 1, practiceDifficulty: 'easy', quality: 'low', qualityMode: 'low' });
  if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true }); else await p.click('#stage', { force: true });
  await sleep(500);
  const hint = await p.evaluate(() => document.getElementById('sub-msg')?.textContent ?? '');
  check('practice explains melee once at the first spawn (V, Chanclazo, Revés)', /V/.test(hint) && /Chanclazo/.test(hint) && /Rev/.test(hint), hint);
  const slot = await p.evaluate(() => document.querySelector('.wslot.on .wmelee')?.textContent?.trim() ?? '');
  check('the weapon slot names the melee attack beside the throw (V · Chanclazo)', /V\s*Chanclazo/.test(slot), slot);

  // El Chanclazo: hit, 25, the sandal stays in hand.
  await stage(p, 1.3);
  const before = await foeState(p);
  await p.keyboard.press('KeyV');
  const inHand: boolean[] = [];
  for (let i = 0; i < 8; i++) { inHand.push(await p.evaluate(() => { const vm = (window as any).__fps.engine().vm; return vm.rig.items[0].visible; })); await sleep(60); }
  const a = await untilFoe(p, (s) => s.hp < before.hp);
  check('El Chanclazo (V with La Chancla) hits an opponent in reach for 25', a.hp === before.hp - 25 && a.myMeleeHits === before.myMeleeHits + 1, { hp: a.hp });
  check('the sandal stays in the first-person hand through the swing, and nothing is thrown', inHand.every(Boolean) && a.myThrows === before.myThrows, { inHand, throws: a.myThrows });
  const hitEv = (await events(p, 'hit')).filter((e) => e.m !== undefined);
  check('the confirmed hit names its swing and weapon (server event)', hitEv.length === 1 && hitEv[0].w === 0 && hitEv[0].d === 25, hitEv.map((e) => ({ m: e.m, w: e.w, d: e.d, head: e.head })));
  await sleep(800);

  // A miss: out of reach.
  await stage(p, 3.0);
  const m0 = await foeState(p);
  await p.keyboard.press('KeyV');
  await sleep(900);
  const m1 = await foeState(p);
  const whiffs = await events(p, 'whiff');
  check('a swing out of reach misses: no damage, a whiff from the server', m1.hp === m0.hp && m1.mySwings === m0.mySwings + 1 && whiffs.length >= 1, { hp: m1.hp, whiffs: whiffs.length });

  // A held V never repeats.
  await stage(p, 3.0);
  const h0 = await foeState(p);
  await p.keyboard.down('KeyV');
  await sleep(2200);
  await p.keyboard.up('KeyV');
  const h1 = await foeState(p);
  check('holding V swings once, never again until it is pressed again', h1.mySwings === h0.mySwings + 1, { swings: h1.mySwings - h0.mySwings });

  // V does nothing while the menu is open, and play resumes after.
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !(document.getElementById('scr-pause') as HTMLElement | null)?.hidden || (window as any).__fps.screen !== 'match', undefined, { timeout: 4000 }).catch(() => undefined);
  await sleep(400);
  const e0 = await foeState(p);
  await p.keyboard.press('KeyV');
  await sleep(500);
  const e1 = await foeState(p);
  check('V while the menu is open starts no swing', e1.mySwings === e0.mySwings, { swings: e1.mySwings - e0.mySwings });
  const resume = await p.$('#btn-resume');
  if (resume && await resume.isVisible()) await resume.click(); else await p.keyboard.press('Escape');
  await sleep(500);
  if (await p.isVisible('#btn-click-play')) { await p.click('#btn-click-play', { force: true }); await sleep(400); }

  // El Revés to the face: 45, one roller off (it flies and expires).
  await p.keyboard.press('Digit2');
  await sleep(600);
  const label2 = await p.evaluate(() => document.querySelector('.wslot.on .wmelee')?.textContent?.trim() ?? '');
  check('with La Pesada in hand the slot says Revés', /Rev/.test(label2), label2);
  await stage(p, 1.3, { hp: 100 });
  const r0 = await foeState(p);
  const f0 = await fx(p);
  await p.keyboard.press('KeyV');
  const r1 = await untilFoe(p, (s) => s.hp < r0.hp, 5000);
  await sleep(150);
  const f1 = await fx(p);
  const revHit = (await events(p, 'hit')).filter((e) => e.m !== undefined).pop();
  check('El Revés (V with La Pesada) to the face hits for 45 and counts as a head hit', r1.hp === r0.hp - 45 && revHit?.head === true && revHit?.w === 1, { hp: r1.hp, head: revHit?.head });
  check('one attached roller comes off her head (server state and what the client shows)', popcount(r1.ruleros) === popcount(r0.ruleros) - 1 && revHit?.ru?.length === 1, { before: r0.ruleros, after: r1.ruleros, ru: revHit?.ru });
  check('a roller flies (pooled effect)', f1.spawned === f0.spawned + 1 && f1.active >= 1, { f0, f1 });
  await sleep(600);
  const shown = (await foeState(p)).shownRuleros;
  check('everyone sees the same missing roller: the snapshot carries her hairstyle', shown === r1.ruleros, { shown, server: r1.ruleros });
  await sleep(1800);
  const f2 = await fx(p);
  check('the flying roller expires (nothing left in flight)', f2.active === 0, f2);

  // Finish her with El Revés to the face: the rest scatter; respawn restores them.
  let fin = await foeState(p);
  for (let k = 0; k < 4 && fin.alive; k++) {
    await stage(p, 1.3);
    await p.keyboard.press('KeyV');
    await sleep(1600);
    fin = await foeState(p);
  }
  const elim = (await events(p, 'elim')).filter((e) => e.m !== undefined).pop();
  check('an El Revés head hit eliminates her and scatters what was left of her rollers', !fin.alive && elim?.head === true && fin.ruleros === 0, { alive: fin.alive, ruleros: fin.ruleros, scatter: elim?.ru });
  const killfeed = await p.evaluate(() => document.querySelector('#killfeed .kf .kf-melee')?.textContent ?? '');
  check('the kill feed names the attack', /Rev/.test(killfeed), killfeed);
  const back = await untilFoe(p, (s) => s.alive, 6000);
  check('she respawns with a full head of rollers', back.alive && back.ruleros === 15, { ruleros: back.ruleros });
  const dupes = await p.evaluate(() => (window as any).__fps.session().duplicatesDropped);
  const hits = (await events(p, 'hit')).filter((e) => e.m !== undefined);
  check('every melee outcome arrived once (no duplicates handled)', new Set(hits.map((e) => e.m)).size === hits.length, { hits: hits.length, dropped: dupes });
  check('rollers in flight stay within the pool (cap 12)', (await fx(p)).active <= 12);

  await ctx.close();
}

async function phone(browser: Browser, blocked: string[], errors: string[]): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.route('**/*', (r) => { const u = r.request().url(); if (u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); blocked.push(u); return r.abort(); });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('websocket', (w) => blocked.push(`websocket ${w.url()}`));
  const cdp: CDPSession = await ctx.newCDPSession(p);
  const touch = (type: string, pts: Array<{ x: number; y: number; id: number }>) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q) => ({ x: q.x, y: q.y, id: q.id, radiusX: 8, radiusY: 8, force: 1 })) });
  await startPractice(p, { practiceMap: 'patio', practiceAllies: 0, practiceEnemies: 1, practiceDifficulty: 'easy', quality: 'low', qualityMode: 'low' });
  await p.waitForFunction(() => !!(window as any).__fps.touch()?.visible, undefined, { timeout: 10000 });
  await sleep(600);
  const box = async (sel: string) => { const b = (await p.locator(sel).boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height }; };
  const melee = await box('#ft-melee');
  const thr = await box('#ft-throw'), jump = await box('#ft-jump'), crouch = await box('#ft-crouch'), sw = await box('#ft-weapon');
  const overlap = (a: typeof melee, b: typeof melee) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
  check('the melee button is a generous target, on screen and clear of Throw, Jump, Crouch and Switch',
    melee.w >= 56 && melee.x + melee.w / 2 <= 844 && melee.y + melee.h / 2 <= 390 && ![thr, jump, crouch, sw].some((o) => overlap(melee, o)), { melee });
  const lbl = await p.evaluate(() => document.querySelector('#ft-melee .ft-mlbl')?.textContent ?? '');
  check('the melee button says Chanclazo with La Chancla in hand', lbl === 'Chanclazo', lbl);
  await stage(p, 1.3);
  const s0 = await foeState(p);
  const presses0 = await p.evaluate(() => (window as any).__fps.input().meleePresses);
  // Stick held forward-left, a look drag, Throw held, then a melee tap and a jump, all at once.
  const stick = { x: 120, y: 280 };
  await touch('touchStart', [{ ...stick, id: 1 }]);
  await touch('touchMove', [{ x: stick.x + 10, y: stick.y - 30, id: 1 }]);
  await touch('touchStart', [{ x: stick.x + 10, y: stick.y - 30, id: 1 }, { x: 520, y: 180, id: 2 }]);
  await touch('touchMove', [{ x: stick.x + 10, y: stick.y - 30, id: 1 }, { x: 524, y: 181, id: 2 }]);
  await touch('touchStart', [{ x: stick.x + 10, y: stick.y - 30, id: 1 }, { x: 524, y: 181, id: 2 }, { x: melee.x, y: melee.y, id: 3 }]);
  await sleep(60);
  await touch('touchEnd', [{ x: stick.x + 10, y: stick.y - 30, id: 1 }, { x: 524, y: 181, id: 2 }]);
  await sleep(300);
  const s1 = await foeState(p);
  const presses1 = await p.evaluate(() => (window as any).__fps.input().meleePresses);
  check('one tap on melee, with the stick and a look drag held, makes exactly one swing', presses1 === presses0 + 1 && s1.mySwings === s0.mySwings + 1, { presses: presses1 - presses0, swings: s1.mySwings - s0.mySwings });
  // Throw and jump still work with the stick held.
  await touch('touchStart', [{ ...stick, id: 1 }]);
  await touch('touchMove', [{ x: stick.x, y: stick.y - 40, id: 1 }]);
  await sleep(1000);
  const t0 = await foeState(p);
  await touch('touchStart', [{ x: stick.x, y: stick.y - 40, id: 1 }, { x: thr.x, y: thr.y, id: 4 }]);
  await sleep(700);
  await touch('touchStart', [{ x: stick.x, y: stick.y - 40, id: 1 }, { x: thr.x, y: thr.y, id: 4 }, { x: jump.x, y: jump.y, id: 5 }]);
  await sleep(300);
  const jumping = await p.evaluate(() => !(window as any).__fps.session().body.onGround);
  await touch('touchEnd', []);
  await sleep(400);
  const t1 = await foeState(p);
  check('throw and jump work together with the stick after a melee swing', t1.myThrows > t0.myThrows && jumping, { throws: t1.myThrows - t0.myThrows, jumping });
  // Switch: the label follows.
  await touch('touchStart', [{ x: sw.x, y: sw.y, id: 6 }]); await sleep(60); await touch('touchEnd', []);
  await sleep(700);
  const lbl2 = await p.evaluate(() => document.querySelector('#ft-melee .ft-mlbl')?.textContent ?? '');
  check('after switching to La Pesada the button says Revés', lbl2 === 'Revés', lbl2);
  const view = await p.evaluate(() => ({ scale: window.visualViewport?.scale ?? 1, sx: window.scrollX, sy: window.scrollY }));
  check('no page zoom or scroll from the taps', view.scale === 1 && view.sx === 0 && view.sy === 0, view);
  await p.screenshot({ path: path.join(OUT, 'phone-melee.png') });
  await ctx.close();
}

// Bots demonstrate both attacks in an ordinary practice match (hard bots,
// two each side, real thinking), by the same rules as players.
async function bots(browser: Browser, blocked: string[], errors: string[]): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  await ctx.route('**/*', (r) => { const u = r.request().url(); if (u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); blocked.push(u); return r.abort(); });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await startPractice(p, { practiceMap: 'patio', practiceAllies: 1, practiceEnemies: 2, practiceDifficulty: 'hard', quality: 'low', qualityMode: 'low' });
  // Rosa stays out of it: parked high on the terrace, spawn-protected forever.
  await p.evaluate(() => {
    const f = (window as any).__fps; const room = [...f.host().hub.rooms.values()][0];
    const sim = room.sim;
    const orig = sim.step.bind(sim);
    (window as any).__botSwings = { 0: 0, 1: 0, hits: 0 };
    sim.step = () => {
      orig();
      for (const e of sim.events) {
        const a = sim.players.get(e.a);
        if (e.k === 'swing' && a?.isBot) (window as any).__botSwings[e.w]++;
        if (e.k === 'hit' && e.m !== undefined && a?.isBot) (window as any).__botSwings.hits++;
      }
    };
  });
  const end = Date.now() + 120_000;
  let s = { 0: 0, 1: 0, hits: 0 };
  while (Date.now() < end) {
    await sleep(2000);
    s = await p.evaluate(() => (window as any).__botSwings);
    if (s[0] > 0 && s[1] > 0 && s.hits > 0) break;
  }
  check('bots use both El Chanclazo and El Revés, and connect, in an ordinary practice match', s[0] > 0 && s[1] > 0 && s.hits > 0, s);
  await ctx.close();
}

let preview: ChildProcess | null = null;
async function main(): Promise<void> {
  if (!(await waitHttp(SITE, 500))) {
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST], { cwd: ROOT, stdio: 'ignore' });
    if (!(await waitHttp(SITE))) throw new Error('preview did not start');
  }
  const browser = await launch();
  const blocked: string[] = [], errors: string[] = [];
  try {
    if (!ONLY || ONLY === 'desktop') await desktop(browser, blocked, errors);
    if (!ONLY || ONLY === 'phone') await phone(browser, blocked, errors);
    if (!ONLY || ONLY === 'bots') await bots(browser, blocked, errors);
  } finally {
    await browser.close();
    preview?.kill();
  }
  check('no request or socket left this machine', blocked.length === 0, blocked.slice(0, 5));
  check('no page errors', errors.length === 0, errors.slice(0, 5));
  fs.writeFileSync(path.join(OUT, 'melee-e2e.json'), JSON.stringify({ checks }, null, 1));
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); preview?.kill(); process.exit(1); });
