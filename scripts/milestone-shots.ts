// Matched HUD stills for the motion, minimap and cafecito milestone: the real
// game page (offline practice), staged identically on any build that has
// window.__fps, so before and after compare shot for shot. The page runs on a
// fake clock (the in-page host rebased onto it, as in scripts/killcam-e2e.ts),
// so animation time is the same in every capture. Writes, per scene:
//   <scene>-desktop-high.png (1280x720)  <scene>-phone-low.png (844x390, touch), costs.json
//
//   DIST=<build> OUT=<dir> [PORT=4231] [SCENES=cafe,mates,plaza,fiesta] node --import tsx scripts/milestone-shots.ts
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Browser, Page } from 'playwright-core';
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST || path.join(ROOT, 'dist'));
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'artifacts/milestone-shots'));
const PORT = Number(process.env.PORT || 4231);
const SITE = `http://localhost:${PORT}/`;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const costs: Record<string, unknown> = {};

type Scene = { map: 'patio' | 'plaza' | 'fiesta'; me: [number, number, number]; yaw: number; pitch: number; hp: number; ally: [number, number]; enemy: [number, number]; lang?: 'en' | 'es' };
// me: x, z, (unused); the first cafecito on each map is in view where it matters.
const SCENES: Record<string, Scene> = {
  // El Patio: hurt, a few steps from the west cafecito, a teammate and an opponent in the square.
  cafe: { map: 'patio', me: [-9.6, -6.6, 0], yaw: Math.PI / 2, pitch: -0.12, hp: 60, ally: [-11.5, -3.6], enemy: [-15.5, -4.8] },
  // El Patio: full health, the same cup (the "Health full" state), Spanish.
  full: { map: 'patio', me: [-9.6, -6.6, 0], yaw: Math.PI / 2, pitch: -0.12, hp: 100, ally: [-11.5, -3.6], enemy: [-15.5, -4.8], lang: 'es' },
  // Character read at combat distance: both teams facing you.
  mates: { map: 'patio', me: [-4, 3, 0], yaw: Math.PI / 2, pitch: 0, hp: 100, ally: [-7.2, 2.2], enemy: [-7.6, 4.2] },
  plaza: { map: 'plaza', me: [-4.5, -12.8, 0], yaw: Math.PI / 2, pitch: -0.1, hp: 55, ally: [-10, -10.5], enemy: [-12, -14] },
  fiesta: { map: 'fiesta', me: [-9.2, -9.5, 0], yaw: Math.PI / 2, pitch: -0.1, hp: 55, ally: [-14.5, -7.5], enemy: [-16, -11] },
};

async function shoot(browser: Browser, name: string, sc: Scene, phone: boolean): Promise<void> {
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 720 } });
  await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const p: Page = await ctx.newPage();
  const q = phone ? 'low' : 'high';
  const settings = { practiceMap: sc.map, practiceAllies: 1, practiceEnemies: 1, practiceDifficulty: 'easy', quality: q, qualityMode: q, music: 0, lang: sc.lang ?? 'en', name: 'Rosa', killcam: true };
  await p.addInitScript({ content: `window.__name = (f) => f; try { localStorage.setItem('chancla.mp.settings.v1', JSON.stringify(${JSON.stringify(settings)})); } catch {}` });
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto(SITE);
  await p.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { polling: 100 });
  await sleep(300);
  await p.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
  await sleep(200);
  await p.evaluate(() => (document.getElementById('btn-practice-start') as HTMLElement).click());
  await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing' && (window as any).__fps.session()?.alive, undefined, { timeout: 40000, polling: 100 });
  if (phone) { await sleep(300); await p.touchscreen.tap(422, 120); await sleep(400); }
  else { await sleep(300); if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true }); else await p.click('#stage', { force: true }); await sleep(400); }
  // The fake clock: animation and the match advance only as the script says.
  await p.evaluate(() => { const h = (window as any).__fps.host(); (window as any).__h0 = h.now(); h.pause(); });
  await p.clock.install();
  await p.clock.pauseAt((await p.evaluate(() => Date.now())) + 200);
  await p.evaluate((sc) => {
    const h = (window as any).__fps.host();
    h.pausedAt = -1; h.pausedTotal = performance.now() - (window as any).__h0;
    for (const room of h.hub.rooms.values()) { room.lastUpdate = h.now(); room.acc = 0; }
    h.timer = setInterval(() => { if (h.pausedAt < 0) h.hub.update(); }, 1000 / 120);
    const f = (window as any).__fps, s = f.session(), room = [...h.hub.rooms.values()][0], sim = room.sim;
    for (const m of room.members.values()) if (m.bot) m.brain = null;
    const me = sim.players.get(s.id);
    const ally = [...sim.players.values()].find((q: any) => q !== me && q.team === me.team);
    const enemy = [...sim.players.values()].find((q: any) => q.team !== me.team);
    const put = (pl: any, x: number, z: number, yaw: number) => { pl.body.x = x; pl.body.z = z; pl.body.y = 0; pl.body.vx = pl.body.vz = 0; pl.yaw = yaw; pl.protectedUntil = 0; };
    put(me, sc.me[0], sc.me[1], sc.yaw); me.hp = sc.hp;
    const face = (x: number, z: number) => Math.atan2(-(sc.me[0] - x), -(sc.me[1] - z));
    if (ally) put(ally, sc.ally[0], sc.ally[1], face(sc.ally[0], sc.ally[1]));
    if (enemy) put(enemy, sc.enemy[0], sc.enemy[1], face(sc.enemy[0], sc.enemy[1]));
    f.input().yaw = sc.yaw; f.input().pitch = sc.pitch;
  }, sc);
  // 4.5 s: long enough for the spawn banners to fade in every build, so only lasting changes differ.
  for (let t = 0; t < 4500; t += 50) await p.clock.runFor(50);
  await p.screenshot({ path: path.join(OUT, `${name}-${phone ? 'phone-low' : 'desktop-high'}.png`), timeout: 120000 });
  // The renderer's counts per whole frame (scene and hand passes added up), averaged over the frames drawn in 0.5 s.
  await p.evaluate(() => {
    const r = (window as any).__fps.engine().renderer; r.info.autoReset = false; r.info.reset();
    const w = window as any; w.__frames = 0;
    const tick = () => { w.__frames++; if (w.__frames < 1e6 && !w.__stopCount) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  for (let t = 0; t < 500; t += 50) await p.clock.runFor(50);
  costs[`${name}-${phone ? 'phone-low' : 'desktop-high'}`] = await p.evaluate(() => {
    const w = window as any, e = w.__fps.engine(), r = e.renderer, n = Math.max(1, w.__frames);
    w.__stopCount = true;
    const out = { frames: n, calls: Math.round(r.info.render.calls / n), tris: Math.round(r.info.render.triangles / n), geometries: r.info.memory.geometries, textures: r.info.memory.textures };
    r.info.autoReset = true;
    return out;
  });
  await ctx.close();
}

const procs: ChildProcess[] = [spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' })];
const browser = await launch(['--mute-audio']);
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(SITE)).ok) break; } catch { /* not yet */ } await sleep(250); }
  const want = (process.env.SCENES || 'cafe,full,mates,plaza,fiesta').split(',');
  for (const name of want) {
    const sc = SCENES[name];
    if (!sc) continue;
    for (const phone of [false, true]) await shoot(browser, name, sc, phone);
    console.log(`shot ${name}`);
  }
  fs.writeFileSync(path.join(OUT, 'costs.json'), JSON.stringify(costs, null, 1));
} finally {
  await browser.close();
  for (const c of procs) c.kill('SIGTERM');
}
