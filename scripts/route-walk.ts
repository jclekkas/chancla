// A repeatable walk through El Patio for visual review: offline practice,
// the page on a fake clock (the in-page host rebased onto it, as in
// scripts/milestone-shots.ts), Rosa moved along a fixed route at walking
// pace with a scripted look direction, a teammate crossing the view, an
// opponent waiting behind the alley bin, and one real throw at him. Normal
// HUD and field of view. Writes, per viewport:
//   <tag>/f-NNNN.png  frames at 30 fps        <tag>.mp4 (with ffmpeg)
//   <tag>-<station>.png  stills at five fixed stations, costs.json
// The route: out of Casa Sol's covered doorway (arcade) into the sunlit
// plaza, north through the opening into the shaded alley, east to the bin
// where the fight is. Tags: desktop-high (1280x720), phone-low (844x390, touch).
//
//   DIST=<build> OUT=<dir> [PORT=4255] [VIEWS=desktop-high,phone-low] [FRAMES=1] node --import tsx scripts/route-walk.ts
// FRAMES=0 takes only the stills.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import type { Browser } from 'playwright-core';
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST || path.join(ROOT, 'dist'));
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'artifacts/route-walk'));
const PORT = Number(process.env.PORT || 4255);
const SITE = `http://localhost:${PORT}/`;
const FRAMES = process.env.FRAMES !== '0';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const costs: Record<string, unknown> = {};
fs.mkdirSync(OUT, { recursive: true });

/** Route keys: time (s), position, look target (x, y, z). Positions and looks are interpolated (smoothstep per leg). */
const KEYS: Array<{ t: number; x: number; z: number; look: [number, number, number] }> = [
  { t: 0.0, x: -20.6, z: -2.75, look: [-10, 1.6, -2.75] }, // in Casa Sol's covered doorway, facing the plaza
  { t: 2.4, x: -16.2, z: -2.75, look: [-8, 1.4, -3.5] }, // stepping out under the lintel
  { t: 4.6, x: -13.4, z: -3.6, look: [-9, 2.2, -9.5] }, // the sunlit plaza, the terrace and café ahead
  { t: 6.6, x: -15.7, z: -7.2, look: [-15.7, 1.6, -14] }, // to the opening into the alley
  { t: 8.6, x: -15.7, z: -12.9, look: [-4, 1.5, -13.4] }, // in the shaded alley, turning east
  { t: 10.6, x: -11.2, z: -13.0, look: [-6.3, 1.2, -14.4] }, // up to the fight at the bin
  { t: 13.0, x: -10.4, z: -12.8, look: [-6.3, 1.2, -14.4] },
];
const END = KEYS[KEYS.length - 1]!.t;
const STATIONS: Array<[string, number]> = [['arcade', 1.2], ['plaza-sun', 4.6], ['opening', 6.6], ['alley-shade', 8.9], ['fight', 11.4]];
/** The throw: fire held for these frames' worth of time. */
const THROW_AT = 11.0;

async function run(browser: Browser, tag: string): Promise<void> {
  const phone = tag === 'phone-low';
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 720 } });
  await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const p = await ctx.newPage();
  const q = phone ? 'low' : 'high';
  const settings = { practiceMap: 'patio', practiceAllies: 1, practiceEnemies: 1, practiceDifficulty: 'easy', quality: q, qualityMode: q, music: 0, lang: 'en', name: 'Rosa', killcam: true, ...(process.env.ROSA === 'candidate' ? { rosaCandidate: true } : {}) };
  await p.addInitScript({ content: `window.__name = (f) => f; try { localStorage.setItem('chancla.mp.settings.v1', JSON.stringify(${JSON.stringify(settings)})); } catch {}` });
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto(SITE);
  await p.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { polling: 100 });
  await sleep(300);
  await p.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
  await sleep(200);
  await p.evaluate(() => (document.getElementById('btn-practice-start') as HTMLElement).click());
  await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing' && (window as any).__fps.session()?.alive, undefined, { timeout: 60000, polling: 100 });
  if (phone) { await sleep(300); await p.touchscreen.tap(422, 120); await sleep(400); }
  else { await sleep(300); if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true }); else await p.click('#stage', { force: true }); await sleep(400); }
  await p.evaluate(() => { const h = (window as any).__fps.host(); (window as any).__h0 = h.now(); h.pause(); });
  await p.clock.install();
  await p.clock.pauseAt((await p.evaluate(() => Date.now())) + 200);
  await p.evaluate(({ keys }) => {
    const w = window as any, f = w.__fps, h = f.host();
    h.pausedAt = -1; h.pausedTotal = performance.now() - w.__h0;
    for (const room of h.hub.rooms.values()) { room.lastUpdate = h.now(); room.acc = 0; }
    h.timer = setInterval(() => { if (h.pausedAt < 0) h.hub.update(); }, 1000 / 120);
    const s = f.session(), room = [...h.hub.rooms.values()][0] as any, sim = room.sim;
    for (const m of room.members.values()) if (m.bot) m.brain = null;
    const me = sim.players.get(s.id);
    const ally = [...sim.players.values()].find((q: any) => q !== me && q.team === me.team);
    const enemy = [...sim.players.values()].find((q: any) => q.team !== me.team);
    const sm = (u: number) => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
    // Where Rosa is and looks at time t (s).
    const at = (t: number) => {
      let i = 0; while (i < keys.length - 2 && t > keys[i + 1].t) i++;
      const a = keys[i], b = keys[i + 1], u = sm((t - a.t) / (b.t - a.t));
      const L = (k: number) => a.look[k] + (b.look[k] - a.look[k]) * u;
      return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, look: [L(0), L(1), L(2)] };
    };
    let lastT = -1, lx = 0, lz = 0;
    w.__route = (t: number) => {
      const r = at(t), dt = lastT < 0 ? 0 : Math.max(1e-3, t - lastT);
      const vx = lastT < 0 ? 0 : (r.x - lx) / dt, vz = lastT < 0 ? 0 : (r.z - lz) / dt;
      lastT = t; lx = r.x; lz = r.z;
      for (const b of [me.body, s.body]) { b.x = r.x; b.z = r.z; b.y = 0; b.vx = vx; b.vz = vz; }
      me.protectedUntil = 0; me.hp = 100;
      const dx = r.look[0] - r.x, dz = r.look[2] - r.z;
      f.input().yaw = Math.atan2(-dx, -dz); f.input().pitch = Math.atan2(r.look[1] - 1.58, Math.hypot(dx, dz));
      // The teammate crosses the plaza early on, then the alley ahead of the fight.
      if (ally) {
        const ka = t < 6 ? { x0: -9.5, z0: -6.5, x1: -12.5, z1: 1.0, t0: 1.0, t1: 5.5 } : { x0: -9.0, z0: -11.6, x1: -9.6, z1: -14.6, t0: 7.8, t1: 10.0 };
        const u = Math.min(1, Math.max(0, (t - ka.t0) / (ka.t1 - ka.t0)));
        const moving = u > 0 && u < 1, dur = ka.t1 - ka.t0;
        ally.body.x = ka.x0 + (ka.x1 - ka.x0) * u; ally.body.z = ka.z0 + (ka.z1 - ka.z0) * u; ally.body.y = 0;
        ally.body.vx = moving ? (ka.x1 - ka.x0) / dur : 0; ally.body.vz = moving ? (ka.z1 - ka.z0) / dur : 0;
        ally.yaw = Math.atan2(-(ka.x1 - ka.x0), -(ka.z1 - ka.z0)); ally.protectedUntil = 1e15;
      }
      // The opponent waits behind the alley bin, facing up the alley.
      if (enemy) { enemy.body.x = -6.3; enemy.body.z = -14.4; enemy.body.y = 0; enemy.body.vx = enemy.body.vz = 0; enemy.yaw = Math.PI / 2; enemy.protectedUntil = 0; enemy.hp = Math.max(enemy.hp, 100); }
    };
    w.__route(0);
  }, { keys: KEYS });
  // Settle the spawn banners on the first pose (unfilmed).
  for (let i = 0; i < 90; i++) { await p.evaluate(() => (window as any).__route(0)); await p.clock.runFor(50); }
  const dir = path.join(OUT, tag);
  if (FRAMES) { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); }
  const fps = 30, n = Math.round(END * fps);
  const stationFrames = new Map(STATIONS.map(([name, t]) => [Math.round(t * fps), name]));
  for (let i = 0; i <= n; i++) {
    const t = i / fps;
    const firing = t >= THROW_AT && t < THROW_AT + 0.15;
    await p.evaluate(({ t, firing }) => { const w = window as any; w.__route(t); (w.__fps.input() as any).mouseFire = firing; }, { t, firing });
    const station = stationFrames.has(i);
    if (station) await p.evaluate(() => { const r = (window as any).__fps.engine().renderer; r.info.autoReset = false; r.info.reset(); const w = window as any; w.__fc = 0; w.__fcStop = false; const tick = () => { w.__fc++; if (!w.__fcStop) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    await p.clock.runFor(1000 / fps);
    if (FRAMES) await p.screenshot({ path: path.join(dir, `f-${String(i).padStart(4, '0')}.png`), timeout: 180000 });
    const st = stationFrames.get(i);
    if (st) {
      await p.screenshot({ path: path.join(OUT, `${tag}-${st}.png`), timeout: 180000 });
      costs[`${tag}-${st}`] = await p.evaluate(() => {
        const e = (window as any).__fps.engine(), r = e.renderer;
        const seen = new Set<any>(); let bytes = 0;
        const tb = (t: any) => { const im = t.image; if (!im?.width) return 0; const bpp = t.type === 1015 ? 16 : t.type === 1016 ? 8 : 4; return im.width * im.height * bpp * (t.generateMipmaps !== false && t.minFilter !== 1006 && t.minFilter !== 1003 ? 4 / 3 : 1); };
        for (const sc of [e.scene, e.vmScene]) sc.traverse((o: any) => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) for (const k of Object.keys(m)) { const v = m[k]; if (v?.isTexture && !seen.has(v)) { seen.add(v); bytes += tb(v); } } });
        const w = window as any; w.__fcStop = true; const nf = Math.max(1, w.__fc);
        const frame = { calls: Math.round(r.info.render.calls / nf), tris: Math.round(r.info.render.triangles / nf), framesAveraged: nf };
        r.info.autoReset = true;
        return { ...frame, geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length ?? 0, textureMB: +(bytes / 1048576).toFixed(2) };
      });
    }
  }
  if (FRAMES && spawnSync('which', ['ffmpeg']).status === 0) {
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, 'f-%04d.png'), '-c:v', 'libx264', '-crf', '26', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', path.join(OUT, `${tag}.mp4`)]);
  }
  const stats = await p.evaluate(() => { const f = (window as any).__fps, s = f.session(), room = [...f.host().hub.rooms.values()][0] as any; const me = room.sim.players.get(s.id); return { throws: me.stats.throws, hits: me.stats.hits }; });
  console.log(tag, 'done', JSON.stringify(stats));
  await ctx.close();
}

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
const browser = await launch(['--mute-audio']);
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(SITE)).ok) break; } catch { /* not yet */ } await sleep(250); }
  for (const tag of (process.env.VIEWS || 'desktop-high,phone-low').split(',')) await run(browser, tag);
  fs.writeFileSync(path.join(OUT, 'costs.json'), JSON.stringify(costs, null, 1));
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
