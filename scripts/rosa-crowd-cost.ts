// Several characters in view: offline practice in El Patio with three
// teammates and three opponents (bots frozen), all six lined up 6 m in front
// of the camera, and the renderer's whole-frame counts (scene, shadow and
// hand passes) averaged over 30 frames, first with the current Rosa, then
// with the candidate model on team Sol, in the same page and the same state.
//
//   DIST=<build> [Q=high] [PORT=4247] [OUT=<dir>] node --import tsx scripts/rosa-crowd-cost.ts
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST || path.join(ROOT, 'dist'));
const PORT = Number(process.env.PORT || 4247);
const Q = process.env.Q || 'high';
const OUT = process.env.OUT ? path.resolve(process.env.OUT) : null;
const SITE = `http://localhost:${PORT}/`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
const browser = await launch(['--mute-audio']);
const out: Record<string, unknown> = { quality: Q };
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(SITE)).ok) break; } catch { /* not yet */ } await sleep(250); }
  const phone = Q === 'low';
  const ctx = await browser.newContext(phone ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 720 } });
  await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const p = await ctx.newPage();
  const settings = { practiceMap: 'patio', practiceAllies: 3, practiceEnemies: 3, practiceDifficulty: 'easy', quality: Q, qualityMode: Q, music: 0, lang: 'en', name: 'Rosa' };
  await p.addInitScript({ content: `window.__name = (f) => f; try { localStorage.setItem('chancla.mp.settings.v1', JSON.stringify(${JSON.stringify(settings)})); } catch {}` });
  await p.goto(SITE);
  await p.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { polling: 100 });
  await p.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
  await sleep(200);
  await p.evaluate(() => (document.getElementById('btn-practice-start') as HTMLElement).click());
  await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing' && (window as any).__fps.session()?.alive, undefined, { timeout: 60000, polling: 100 });
  // Everyone frozen and lined up across the open paving, facing the camera.
  const stage = () => p.evaluate(() => {
    const f = (window as any).__fps, s = f.session(), room = [...f.host().hub.rooms.values()][0] as any, sim = room.sim;
    for (const m of room.members.values()) if (m.bot) m.brain = null;
    const me = sim.players.get(s.id);
    const put = (pl: any, x: number, z: number, yaw: number) => { pl.body.x = x; pl.body.z = z; pl.body.y = 0; pl.body.vx = pl.body.vz = 0; pl.yaw = yaw; pl.protectedUntil = 0; };
    put(me, -4, 3, Math.PI / 2);
    const others = [...sim.players.values()].filter((q: any) => q !== me).sort((a: any, b: any) => a.team - b.team || a.id - b.id);
    others.forEach((q: any, i: number) => put(q, -10, 3 + (i - (others.length - 1) / 2) * 1.1, -Math.PI / 2));
    f.input().yaw = Math.PI / 2; f.input().pitch = 0;
    return { sol: others.filter((q: any) => q.team === me.team).length, luna: others.filter((q: any) => q.team !== me.team).length };
  });
  out.lineup = await stage();
  const measure = async (label: string) => {
    await stage();
    await sleep(2500);
    if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await p.screenshot({ path: path.join(OUT, `crowd-${Q}-${label}.png`) }); }
    return p.evaluate(() => new Promise((res) => {
      const e = (window as any).__fps.engine(), r = e.renderer;
      r.info.autoReset = false; r.info.reset();
      let n = 0;
      const tick = () => {
        if (++n < 30) { requestAnimationFrame(tick); return; }
        const v = { frames: n, calls: Math.round(r.info.render.calls / n), tris: Math.round(r.info.render.triangles / n), geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length ?? 0, candidates: e.rosaCandidateState?.().avatars ?? 0 };
        r.info.autoReset = true;
        res(v);
      };
      requestAnimationFrame(tick);
    }));
  };
  out.current = await measure('current');
  await p.evaluate(() => (window as any).__fps.engine().setRosaCandidate(true));
  out.candidate = await measure('candidate');
  console.log(JSON.stringify(out));
  if (OUT) fs.writeFileSync(path.join(OUT, `crowd-${Q}.json`), JSON.stringify(out, null, 1));
  await ctx.close();
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
