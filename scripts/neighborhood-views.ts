// Player-height stills on any arena map, for matched before/after review: offline practice on a
// fake clock (as scripts/route-walk.ts), Rosa placed at each pose and looking at a target, normal HUD
// and field of view, the bots parked out of the way. One still per view, plus the scene's cost.
//
//   DIST=<build> OUT=<dir> [PORT=4260] [MAPS=patio,plaza,fiesta] [VIEWS=desktop-high,phone-low]
//   [ONLY=name1,name2] node --import tsx scripts/neighborhood-views.ts
//
// Writes <OUT>/<tag>-<map>-<view>.png and <OUT>/costs-<tag>.json. Software rendering here: costs are
// exact counts (calls, triangles, textures), never device frame times.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Browser } from 'playwright-core';
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST || path.join(ROOT, 'dist'));
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'artifacts/neighborhood-views'));
const PORT = Number(process.env.PORT || 4260);
const SITE = `http://localhost:${PORT}/`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

interface View { name: string; x: number; z: number; look: [number, number, number] }
/** Poses are gameplay positions on the arenas' own lanes and plazas; look is the point the eye aims at. */
const VIEWS: Record<string, View[]> = {
  patio: [
    { name: 'plaza-east', x: -13, z: 0.5, look: [14, 6.5, 0.5] },
    { name: 'plaza-north', x: 0, z: 8, look: [0, 6.5, -16] },
    { name: 'plaza-casa-sol', x: 7, z: 4, look: [-18, 6.5, -2] },
    { name: 'alley-north-east', x: -12, z: -13.5, look: [20, 4.5, -13.5] },
    { name: 'alley-south-west', x: 12, z: 13.5, look: [-20, 4.5, 13.5] },
    { name: 'opening-north', x: -15.7, z: -7, look: [-15.7, 4.5, -19] },
    { name: 'plaza-south-west', x: 9, z: -6, look: [-10, 7.5, 14] },
  ],
  plaza: [
    { name: 'sol-east', x: -26, z: 0, look: [26, 5, 0] },
    { name: 'fountain-north', x: 0, z: 5, look: [0, 6, -17] },
    { name: 'fountain-south', x: 0, z: -5, look: [0, 6, 17] },
    { name: 'arcade-west', x: 18, z: 3, look: [-22, 4, -2] },
    { name: 'north-walk-east', x: -20, z: -14, look: [24, 4, -14] },
    { name: 'south-walk-west', x: 20, z: 14, look: [-24, 4, 14] },
    { name: 'plaza-diagonal', x: 14, z: -6, look: [-14, 6, 10] },
  ],
  fiesta: [
    { name: 'sol-east', x: -16, z: 0, look: [18, 4, 0] },
    { name: 'dance-north', x: 0, z: 6, look: [0, 6, -14] },
    { name: 'dance-south', x: 0, z: -6, look: [0, 6, 14] },
    { name: 'luna-west', x: 16, z: 3, look: [-18, 4, -2] },
    { name: 'north-lane', x: -14, z: -9, look: [18, 4, -9] },
    { name: 'south-lane', x: 14, z: 9, look: [-18, 4, 9] },
    { name: 'plaza-diagonal', x: 12, z: -5, look: [-12, 6, 10] },
  ],
};
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;

async function run(browser: Browser, tag: string, map: string, costs: Record<string, unknown>): Promise<void> {
  const phone = tag === 'phone-low';
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 720 } });
  await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const p = await ctx.newPage();
  const q = phone ? 'low' : 'high';
  const settings = { practiceMap: map, practiceAllies: 0, practiceEnemies: 1, practiceDifficulty: 'easy', quality: q, qualityMode: q, music: 0, lang: 'en', name: 'Rosa', killcam: true };
  await p.addInitScript({ content: `window.__name = (f) => f; try { localStorage.setItem('chancla.mp.settings.v1', JSON.stringify(${JSON.stringify(settings)})); } catch {}` });
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto(SITE);
  await p.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { polling: 100 });
  await sleep(300);
  await p.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
  await sleep(200);
  await p.evaluate(() => (document.getElementById('btn-practice-start') as HTMLElement).click());
  await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing' && (window as any).__fps.session()?.alive, undefined, { timeout: 90000, polling: 100 });
  if (phone) { await sleep(300); await p.touchscreen.tap(422, 120); await sleep(400); }
  else { await sleep(300); await p.waitForSelector('#btn-click-play', { state: 'visible', timeout: 20000 }).catch(() => undefined); if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true }); await sleep(400); }
  await p.evaluate(() => { const h = (window as any).__fps.host(); (window as any).__h0 = h.now(); h.pause(); });
  await p.clock.install();
  await p.clock.pauseAt((await p.evaluate(() => Date.now())) + 200);
  await p.evaluate(() => {
    const w = window as any, f = w.__fps, h = f.host();
    h.pausedAt = -1; h.pausedTotal = performance.now() - w.__h0;
    for (const room of h.hub.rooms.values()) { room.lastUpdate = h.now(); room.acc = 0; }
    h.timer = setInterval(() => { if (h.pausedAt < 0) h.hub.update(); }, 1000 / 120);
    const s = f.session(), room = [...h.hub.rooms.values()][0] as any, sim = room.sim;
    for (const m of room.members.values()) if (m.bot) m.brain = null;
    const me = sim.players.get(s.id);
    const enemy = [...sim.players.values()].find((o: any) => o.team !== me.team);
    w.__pose = (x: number, z: number, look: number[]) => {
      for (const b of [me.body, s.body]) { b.x = x; b.z = z; b.y = 0; b.vx = 0; b.vz = 0; }
      me.protectedUntil = 0; me.hp = 100;
      const dx = look[0] - x, dz = look[2] - z;
      f.input().yaw = Math.atan2(-dx, -dz); f.input().pitch = Math.atan2(look[1] - 1.58, Math.hypot(dx, dz));
      // The opponent stays at his spawn, out of every composition.
      if (enemy) { enemy.protectedUntil = 1e15; enemy.body.vx = enemy.body.vz = 0; }
    };
  });
  const first = (VIEWS[map] ?? [])[0]!;
  for (let i = 0; i < 90; i++) { await p.evaluate((v) => (window as any).__pose(v.x, v.z, v.look), first); await p.clock.runFor(50); }
  for (const v of VIEWS[map] ?? []) {
    if (ONLY && !ONLY.has(v.name)) continue;
    for (let i = 0; i < 6; i++) { await p.evaluate((vv) => (window as any).__pose(vv.x, vv.z, vv.look), v); await p.clock.runFor(60); }
    const file = `${tag}-${map}-${v.name}.png`;
    await p.screenshot({ path: path.join(OUT, file), timeout: 180000 });
    costs[`${tag}-${map}-${v.name}`] = await p.evaluate(() => {
      const e = (window as any).__fps.engine(), r = e.renderer;
      r.info.autoReset = false; r.info.reset(); r.render(e.scene, e.camera);
      const frame = { calls: r.info.render.calls, tris: r.info.render.triangles };
      r.info.autoReset = true;
      const seen = new Set<any>(); let bytes = 0;
      const tb = (t: any) => { const im = t.image; if (!im?.width) return 0; const bpp = t.type === 1015 ? 16 : t.type === 1016 ? 8 : 4; return im.width * im.height * bpp * (t.generateMipmaps !== false && t.minFilter !== 1006 && t.minFilter !== 1003 ? 4 / 3 : 1); };
      for (const sc of [e.scene, e.vmScene]) sc.traverse((o: any) => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) for (const k of Object.keys(m)) { const x = m[k]; if (x?.isTexture && !seen.has(x)) { seen.add(x); bytes += tb(x); } } });
      return { ...frame, geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length ?? 0, textureMB: +(bytes / 1048576).toFixed(2) };
    });
    console.log('shot', file);
  }
  await ctx.close();
}

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
const browser = await launch(['--mute-audio']);
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(SITE)).ok) break; } catch { /* not yet */ } await sleep(250); }
  for (const tag of (process.env.VIEWS || 'desktop-high').split(',')) {
    const costs: Record<string, unknown> = {};
    for (const map of (process.env.MAPS || 'patio,plaza,fiesta').split(',')) await run(browser, tag, map, costs);
    fs.writeFileSync(path.join(OUT, `costs-${tag}.json`), JSON.stringify(costs, null, 1));
  }
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
