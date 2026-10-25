// The minimap and cafecito milestone in the real page (Chromium with
// SwiftShader; the phone is emulated, not a real device). Offline practice:
//   - the compact map on every arena map, its title, your marker where the
//     session says you are, teammates only (never an opponent);
//   - the expanded map through the menu (practice pauses), the option to hide;
//   - hidden while you are down and during the replay, back on respawn;
//   - phone: clear of the touch controls; a tap opens the expanded map and
//     neither attacks nor turns the camera;
//   - cafecitos: the hint near a visible cup, the actual health restored
//     (+20 from 80), "Health full" and no use at full health, the recharging
//     state, and a brief primary press (Classic) still throwing.
//
//   GRAPHICS_EXPERIMENT=1 npx vite build --outDir <dir> && DIST=<dir> OUT=<out> node --import tsx scripts/minimap-e2e.ts
//   VIDEO=1 also films a short walk to a cafecito with the map (frame by frame on a fake clock).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST || path.join(ROOT, 'dist'));
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'artifacts/minimap'));
const PORT = Number(process.env.PORT || 4241);
const SITE = `http://localhost:${PORT}/`;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); };

async function open(browser: Browser, o: { touch?: boolean; map?: string; quality?: string; lang?: string; rules?: string } = {}): Promise<{ ctx: BrowserContext; p: Page }> {
  const ctx = await browser.newContext(o.touch
    ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 720 } });
  await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const p = await ctx.newPage();
  const q = o.quality ?? (o.touch ? 'low' : 'high');
  const settings = { practiceMap: o.map ?? 'patio', practiceAllies: 1, practiceEnemies: 1, practiceDifficulty: 'easy', quality: q, qualityMode: q, music: 0, lang: o.lang ?? 'en', name: 'Rosa', killcam: true, practiceRules: o.rules ?? 'classic' };
  await p.addInitScript({ content: `window.__name = (f) => f; try { localStorage.setItem('chancla.mp.settings.v1', JSON.stringify(${JSON.stringify(settings)})); } catch {}` });
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto(SITE);
  await p.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { polling: 100 });
  await sleep(300);
  await p.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
  await sleep(200);
  await p.evaluate(() => (document.getElementById('btn-practice-start') as HTMLElement).click());
  await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing' && (window as any).__fps.session()?.alive, undefined, { timeout: 40000, polling: 100 });
  if (o.touch) { await sleep(300); await p.touchscreen.tap(422, 200); await sleep(400); }
  else { await sleep(300); if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true }); else await p.click('#stage', { force: true }); await sleep(400); }
  await p.evaluate(() => { const room = [...(window as any).__fps.host().hub.rooms.values()][0]; for (const m of room.members.values()) if (m.bot) m.brain = null; });
  return { ctx, p };
}

/** Puts you, your teammate and the opponent somewhere (sim positions), and aims you. */
const stage = (p: Page, me: [number, number, number], yaw: number, hp: number, ally: [number, number], enemy: [number, number]) => p.evaluate(([me, yaw, hp, ally, enemy]) => {
  const f = (window as any).__fps, s = f.session(), room = [...f.host().hub.rooms.values()][0], sim = room.sim;
  const mine = sim.players.get(s.id);
  const a = [...sim.players.values()].find((q: any) => q !== mine && q.team === mine.team);
  const e = [...sim.players.values()].find((q: any) => q.team !== mine.team);
  const put = (pl: any, x: number, z: number) => { pl.body.x = x; pl.body.z = z; pl.body.y = 0; pl.body.vx = pl.body.vz = 0; pl.protectedUntil = 0; };
  put(mine, me[0], me[1]); mine.hp = hp;
  if (a) put(a, ally[0], ally[1]);
  if (e) put(e, enemy[0], enemy[1]);
  f.input().yaw = yaw; f.input().pitch = -0.1;
  return { me: mine.id, ally: a?.id, enemy: e?.id };
}, [me, yaw, hp, ally, enemy] as const);

const vis = (p: Page, sel: string) => p.evaluate((sel) => { const e = document.querySelector(sel) as HTMLElement | null; return !!e && e.checkVisibility({ visibilityProperty: true } as never); }, sel);
const state = (p: Page) => p.evaluate(() => {
  const f = (window as any).__fps, s = f.session(), room = [...f.host().hub.rooms.values()][0], sim = room.sim;
  const me = sim.players.get(s.id);
  return { hp: me.hp, alive: s.alive, screen: f.screen, throws: me.stats.throws, swings: me.stats.swings, yaw: f.input().yaw, pk: sim.pickups.map((q: any) => Math.max(0, Math.round(q.availableAt - sim.timeMs))), simMs: sim.timeMs };
});
const cafeText = (p: Page) => p.evaluate(() => { const e = document.querySelector('.cafe-label') as HTMLElement | null; return e && !e.hidden ? { text: e.textContent, cls: e.className } : null; });

async function desktop(browser: Browser): Promise<void> {
  for (const map of ['patio', 'plaza', 'fiesta']) {
    const { ctx, p } = await open(browser, { map });
    await sleep(800);
    const info = await p.evaluate(() => {
      const f = (window as any).__fps, s = f.session(), m = f.engine().miniMarkers();
      const el = document.getElementById('minimap')!;
      const r = el.getBoundingClientRect();
      const room = s.room;
      const enemyIds = room.members.filter((x: any) => x.team !== s.team).map((x: any) => x.id);
      return { shown: !el.hidden, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], me: [m.me.x - s.body.x, m.me.z - s.body.z], mates: m.mates.map((x: any) => x.id), enemyInMates: m.mates.some((x: any) => enemyIds.includes(x.id)), cups: m.pickups.length };
    });
    check(`${map}: compact map shown, you where the session says, teammate only, both cups`, info.shown && Math.abs(info.me[0]) < 1e-6 && Math.abs(info.me[1]) < 1e-6 && info.mates.length === 1 && !info.enemyInMates && info.cups === 2, info);
    await p.screenshot({ path: path.join(OUT, `desktop-${map}.png`) });
    await ctx.close();
  }

  const { ctx, p } = await open(browser, { map: 'patio' });
  // The expanded map from the menu: practice pauses; Back returns to the menu.
  await p.keyboard.press('Escape'); await sleep(400);
  const t0 = (await state(p)).simMs;
  await p.click('#btn-pause-map'); await sleep(900);
  const t1 = (await state(p)).simMs;
  check('menu > Map: the expanded map opens and practice stays paused', (await vis(p, '#scr-map')) && t1 === t0, { t0, t1 });
  await p.screenshot({ path: path.join(OUT, 'expanded-patio.png') });
  await p.click('#btn-map-back'); await sleep(300);
  check('Back: the menu again', (await state(p)).screen === 'pause');
  await p.click('#btn-resume'); await sleep(400);
  if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true });
  await sleep(300);
  // The option hides it, and brings it back (through the real settings screen, so the box shows the saved value).
  const toggle = async () => {
    await p.keyboard.press('Escape'); await sleep(300);
    await p.click('#btn-pause-settings'); await sleep(300);
    await p.click('#set-minimap'); await sleep(200);
    await p.keyboard.press('Escape'); await sleep(200);
    await p.click('#btn-resume'); await sleep(400);
    if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true });
    await sleep(400);
  };
  await toggle();
  const off = !(await vis(p, '#minimap'));
  await toggle();
  const mmDbg = await p.evaluate(() => ({ hiddenAttr: document.getElementById('minimap')!.hidden, setting: JSON.parse(localStorage.getItem('chancla.mp.settings.v1')!).minimap, checked: (document.getElementById('set-minimap') as HTMLInputElement).checked }));
  check('Show minimap off hides it; on shows it again', off && (await vis(p, '#minimap')), { off, ...mmDbg });

  // Cafecitos. West cup (-13, -6.6): hurt at 80, three metres away, facing it.
  await stage(p, [-10, -6.6, 0], Math.PI / 2, 80, [-11, -2], [-20, 6]);
  await p.waitForFunction(() => { const e = document.querySelector('.cafe-label') as HTMLElement | null; return !!e && !e.hidden && e.classList.contains('walk'); }, undefined, { timeout: 4000, polling: 50 }).catch(() => null);
  const hint = await cafeText(p);
  check('hurt, cup in view: "Cafecito · Walk over to heal"', hint?.text === 'Cafecito · Walk over to heal', hint);
  await p.screenshot({ path: path.join(OUT, 'cafe-walk-desktop.png') });
  await stage(p, [-13, -6.6, 0], Math.PI / 2, 80, [-11, -2], [-20, 6]);
  const gotFloat = await p.waitForFunction(() => [...document.querySelectorAll('#names .float')].map((e) => e.textContent).find((x) => /health/.test(x ?? '')) ?? false, undefined, { timeout: 4000, polling: 30 }).then((h) => h.jsonValue()).catch(() => null);
  const after = await state(p);
  check('walk over it at 80: +20 health (the amount actually restored), hp 100, cup recharging', gotFloat === '+20 health' && after.hp === 100 && after.pk[0]! > 15000, { gotFloat, hp: after.hp, pk: after.pk });
  await p.screenshot({ path: path.join(OUT, 'cafe-heal-desktop.png') });
  await stage(p, [-10, -6.6, 0], Math.PI / 2, 60, [-11, -2], [-20, 6]);
  await sleep(500);
  const off2 = await cafeText(p);
  check('the same cup while recharging: shown as unavailable', off2?.cls?.includes('unavailable') === true, off2);
  await p.screenshot({ path: path.join(OUT, 'cafe-recharging-desktop.png') });
  // East cup (13, 6.6) at full health: "Health full", and walking over it does nothing.
  await stage(p, [10, 6.6, 0], -Math.PI / 2, 100, [8, 3], [-20, 6]);
  // Wait for the hint to name this cup (the choice refreshes ten times a second of game frames; this renderer is slow).
  await p.waitForFunction(() => { const e = document.querySelector('.cafe-label') as HTMLElement | null; return !!e && !e.hidden && e.classList.contains('full'); }, undefined, { timeout: 4000, polling: 50 }).catch(() => null);
  const full = await cafeText(p);
  await stage(p, [13, 6.6, 0], -Math.PI / 2, 100, [8, 3], [-20, 6]);
  await sleep(600);
  const st = await state(p);
  check('full health: "Health full", and the cup is not used', full?.text === 'Health full' && st.pk[1] === 0 && st.hp === 100, { full, pk: st.pk });
  // A wall between you and the cup: no hint (El Patio, the cup behind the café block).
  await stage(p, [-13, 2, 0], 0, 60, [-11, -2], [-20, 6]);
  await sleep(500);
  check('a cup behind you or out of sight: no hint', (await cafeText(p)) === null);

  // A brief primary press (Classic): key down and up well inside one frame on this slow renderer.
  await stage(p, [4, 4, 0], Math.PI / 2, 100, [-11, -2], [-20, 6]);
  await sleep(500);
  const fm = await p.evaluate(() => (window as any).__fps.engine().frameMs);
  await p.evaluate(() => {
    const f = (window as any).__fps, s = f.session(), room = [...f.host().hub.rooms.values()][0], sim = room.sim, me = sim.players.get(s.id);
    (window as any).__log = [];
    const q = sim.queueInput.bind(sim);
    sim.queueInput = (id: number, inp: any) => { if (id === s.id && (inp.buttons & 1)) (window as any).__log.push(['host', inp.seq, me.cooldownMs, me.switchMs, me.meleeMs, me.weapon, inp.weapon]); return q(id, inp); };
  });
  let accepted = 0;
  const throwsAtStart = (await state(p)).throws;
  const presses = [];
  for (let i = 0; i < 4; i++) {
    const pre = await p.evaluate(() => { const f = (window as any).__fps, s = f.session(), e = f.engine(), inp = f.input(); return { cd: s.cooldownMs, sw: s.switchMs, me: s.meleeMs, w: s.weapon, enabled: inp.enabled, active: e.inputActive, alive: s.alive, held: inp.heldCount }; });
    const b = (await state(p)).throws;
    await p.keyboard.down('KeyF'); await p.keyboard.up('KeyF');
    await sleep(900);
    const ok = (await state(p)).throws === b + 1;
    if (ok) accepted++;
    presses.push({ ok, ...pre });
  }
  // Each press must reach the host; there it throws when the chancla is ready, and is refused (legally) inside the
  // cooldown. On this software renderer the client may simulate fewer ticks than the clock allows (at most six per
  // frame), so presses a second apart on the clock can land inside one cooldown in game time: that is a refusal, not a loss.
  const host = await p.evaluate(() => (window as any).__log as Array<[string, number, number, number, number, number, number]>);
  const fps = await p.evaluate(() => (window as any).__fps.engine().debugInfo().fps);
  // The host may apply a throw after the per-press window on a slow renderer, so compare totals: every press that
  // reached the host with the chancla ready threw, and nothing else did.
  await sleep(1200);
  const reached = host.length;
  const legalRefusals = host.filter((h) => h[2] > 0 || h[3] > 0 || h[4] > 0).length;
  const thrown = (await state(p)).throws - throwsAtStart;
  check('brief primary presses (Classic): every one reaches the host and throws unless the chancla is cooling', reached === 4 && thrown === reached - legalRefusals, { thrown, perWindowAccepted: accepted, legalRefusals, reached, fps, frameMs: fm, presses, host });
  const b2 = (await state(p)).throws;
  await p.keyboard.down('KeyF'); await p.keyboard.up('KeyF'); await sleep(40);
  await p.keyboard.down('KeyF'); await p.keyboard.up('KeyF'); await sleep(900);
  check('a second brief press inside the cooldown is refused (legal), not queued', (await state(p)).throws === b2 + 1, { throws: (await state(p)).throws - b2 });

  // Down, the replay, and back: the map hides, then returns on respawn (a second attempt if no replay was produced).
  const die = () => p.evaluate(async () => {
    const f = (window as any).__fps, s = f.session(), room = [...f.host().hub.rooms.values()][0], sim = room.sim;
    const me = sim.players.get(s.id), bot = [...sim.players.values()].find((q: any) => q.team !== me.team);
    me.body.x = -6; me.body.z = 3; me.hp = 40; me.protectedUntil = 0; f.input().yaw = -Math.PI / 2;
    bot.body.x = -4.9; bot.body.z = 3; bot.weapon = 1; bot.switchMs = 0; bot.cooldownMs = 0; bot.meleeMs = 0; bot.alive = true; bot.hp = 100; bot.protectedUntil = 0;
    await new Promise((r) => setTimeout(r, 1200));
    me.hp = 40; me.protectedUntil = 0;
    let seq = bot.lastSeq;
    for (let i = 0; i < 30; i++) sim.queueInput(bot.id, { seq: ++seq, mx: 0, mz: 0, yaw: Math.PI / 2, pitch: 0.12, buttons: i === 0 ? 8 : 0, weapon: 1 });
    const shown = () => { const e = document.getElementById('minimap')!; return !e.hidden && e.checkVisibility(); };
    const hint = () => { const e = document.querySelector('.cafe-label') as HTMLElement | null; return !!e && !e.hidden; };
    const w = { died: false, replay: false, badDown: 0, badReplay: 0, samples: 0, backAlive: false, shownAfter: false };
    const t0 = performance.now();
    while (performance.now() - t0 < 16000) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      w.samples++;
      if (!s.alive) { w.died = true; if (shown() || hint()) w.badDown++; }
      if (f.engine().replaying) { w.replay = true; if (shown() || hint()) w.badReplay++; }
      if (w.died && s.alive) { await new Promise((r) => setTimeout(r, 600)); w.backAlive = true; w.shownAfter = shown(); break; }
    }
    return w;
  });
  let watch = await die();
  if (!watch.replay) { await sleep(2500); watch = await die(); }
  check('down and in the replay: no minimap, no cafecito hint; back on respawn', watch.died && watch.replay && watch.badDown === 0 && watch.badReplay === 0 && watch.backAlive && watch.shownAfter, watch);
  await ctx.close();
}

async function phone(browser: Browser): Promise<void> {
  for (const rules of ['classic', 'melee']) {
    const { ctx, p } = await open(browser, { touch: true, map: 'fiesta', rules });
    await stage(p, [-9.2, -9.5, 0], Math.PI / 2, 55, [-14.5, -7.5], [-16, -11]);
    await sleep(800);
    const geo = await p.evaluate(() => {
      const r = (sel: string) => { const e = document.querySelector(sel) as HTMLElement | null; if (!e || !e.checkVisibility()) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
      const mm = r('#minimap');
      const ctl = ['#ft-throw', '#ft-jump', '#ft-crouch', '#ft-melee', '#ft-weapon', '#ft-score', '#btn-menu', '.ft-base', '#hp'].map((s) => [s, r(s)] as const).filter(([, b]) => b);
      const hit = (a: number[], b: number[]) => a[0]! < b[2]! && a[2]! > b[0]! && a[1]! < b[3]! && a[3]! > b[1]!;
      return { mm, overlaps: mm ? ctl.filter(([, b]) => hit(mm, b as number[])).map(([s]) => s) : ['no minimap'] };
    });
    check(`phone (${rules}): the minimap clears movement, aim, jump, attack, Menu and health`, !!geo.mm && geo.overlaps.length === 0, geo);
    await p.screenshot({ path: path.join(OUT, `phone-low-${rules}.png`) });
    if (rules === 'classic') {
      const s0 = await state(p);
      const mm = (await p.locator('#minimap').boundingBox())!;
      await p.touchscreen.tap(mm.x + mm.width / 2, mm.y + mm.height / 2);
      await sleep(900);
      const s1 = await state(p);
      check('phone: a tap on the minimap opens the expanded map through the menu; no throw, swing or turn', (await vis(p, '#scr-map')) && s1.screen !== 'none' && s1.throws === s0.throws && s1.swings === s0.swings && Math.abs(s1.yaw - s0.yaw) < 1e-6, { s0, s1 });
      await p.screenshot({ path: path.join(OUT, 'phone-expanded.png') });
      await p.locator('#btn-map-back').tap(); await sleep(300);
      await p.locator('#btn-resume').tap(); await sleep(700);
      check('phone: back in play from the menu, controls back, nothing held', (await state(p)).screen === 'none' && (await vis(p, '#ft-throw')) && (await p.evaluate(() => (window as any).__fps.input().heldCount)) === 0);
    }
    await ctx.close();
  }
}

async function clip(browser: Browser): Promise<void> {
  if (!process.env.VIDEO) return;
  const { ctx, p } = await open(browser, { map: 'patio', quality: 'high' });
  await p.evaluate(() => { const h = (window as any).__fps.host(); (window as any).__h0 = h.now(); h.pause(); });
  await p.clock.install();
  await p.clock.pauseAt((await p.evaluate(() => Date.now())) + 200);
  await p.evaluate(() => {
    const h = (window as any).__fps.host();
    h.pausedAt = -1; h.pausedTotal = performance.now() - (window as any).__h0;
    for (const room of h.hub.rooms.values()) { room.lastUpdate = h.now(); room.acc = 0; }
    h.timer = setInterval(() => { if (h.pausedAt < 0) h.hub.update(); }, 1000 / 120);
  });
  // Hurt, 4.5 m from El Patio's west cup with a clear line to it; the teammate nearby, the opponent far off.
  await stage(p, [-8.5, -6.6, 0], Math.PI / 2, 45, [-9.5, -3.4], [20, 6]);
  for (let t = 0; t < 3200; t += 50) await p.clock.runFor(50); // the spawn banners fade
  const frames = path.join(OUT, 'frames');
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames, { recursive: true });
  let n = 0;
  const film = async (ms: number) => { for (let t = 0; t < ms - 1e-6; t += 1000 / 30) { await p.clock.runFor(1000 / 30); await p.screenshot({ path: path.join(frames, `f-${String(n++).padStart(4, '0')}.png`), timeout: 120000 }); } };
  // The hint, the walk (the map marker moves), the +N health, the cup recharging.
  await film(700);
  await p.keyboard.down('KeyW'); await film(1000); await p.keyboard.up('KeyW');
  await film(1400);
  console.log(`clip: ${n} frames ${JSON.stringify(await state(p))}`);
  await ctx.close();
}

const procs: ChildProcess[] = [spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' })];
const browser = await launch(['--mute-audio']);
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(SITE)).ok) break; } catch { /* not yet */ } await sleep(250); }
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
  if (!only || only.has('desktop')) await desktop(browser);
  if (!only || only.has('phone')) await phone(browser);
  if (!only || only.has('clip')) await clip(browser);
} finally {
  await browser.close();
  for (const c of procs) c.kill('SIGTERM');
}
fs.writeFileSync(path.join(OUT, 'minimap-e2e.json'), JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
