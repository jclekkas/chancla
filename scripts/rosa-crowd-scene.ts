// Several characters at once, measured: the real game page in its showcase
// view of El Patio (a fixed camera at eye height over the open paving), with
// 1, 4 and 8 Sol characters built through the normal Avatar path
// (engine.setCrowd), all current models or all candidates, each stepped to
// the same idle pose and held. For every count and model: the renderer's
// whole-frame draw calls and triangles averaged over the frames drawn in
// 2 s, texture memory (scene textures and skinning bone textures; render
// targets such as the shadow map are not included), shader programs, and the
// frame timings this machine gives (software rendering: not a device's).
// Then a stability check: repeated model toggles, a quality round trip and
// disposal, with renderer memory compared at matching states.
//
//   DIST=<build> [Q=high|low] [PORT=4253] [OUT=<dir>] node --import tsx scripts/rosa-crowd-scene.ts
// Q=low uses a phone-sized viewport (844x390, scale 2, touch).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST || path.join(ROOT, 'dist'));
const PORT = Number(process.env.PORT || 4253);
const Q = process.env.Q || 'high';
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'artifacts/rosa-crowd'));
const SITE = `http://localhost:${PORT}/`;
/** How long each measurement samples frames (ms); longer gives steadier timings on a slow renderer. */
const SAMPLE_MS = Number(process.env.SAMPLE_MS || 2000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

// The formation's front-row centre, facing the camera 6 m away (rows recede from it).
const AT: [number, number, number] = [4.5, 0, -4.5];
const CAM = { pos: [4.5, 1.58, 1.5] as [number, number, number], look: [4.5, 1.0, -5.2] as [number, number, number] };

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
const browser = await launch(['--mute-audio']);
const report: Record<string, any> = { quality: Q, dist: DIST, at: AT, camera: CAM, runs: [] as any[] };
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(SITE)).ok) break; } catch { /* not yet */ } await sleep(250); }
  const phone = Q === 'low';
  const ctx = await browser.newContext(phone ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 720 } });
  await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript({ content: `window.__name = (f) => f; try { localStorage.setItem('chancla.mp.settings.v1', JSON.stringify(${JSON.stringify({ quality: Q, qualityMode: Q, music: 0, lang: 'en' })})); } catch {}` });
  await p.goto(SITE);
  await p.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { polling: 100 });
  await p.evaluate((c) => (window as any).__fps.engine().setShowcase('patio', c.pos, c.look), CAM);
  await p.evaluate(() => { for (const id of ['screens', 'title', 'hud']) { const el = document.getElementById(id); if (el) el.style.visibility = 'hidden'; } document.querySelectorAll('.screen, button, #sound-status').forEach((e) => ((e as HTMLElement).style.visibility = 'hidden')); });
  await sleep(1500);

  const sample = () => p.evaluate((SAMPLE_MS) => new Promise<any>((res) => {
    const e = (window as any).__fps.engine(), r = e.renderer;
    // Texture memory: every texture the scene's materials use, plus skinning bone textures (bytes, mip chains counted).
    const seen = new Set<any>(); let bytes = 0; let boneBytes = 0;
    const texBytes = (t: any) => { const im = t.image; if (!im) return 0; const w = im.width || 0, h = im.height || 0; const bpp = t.type === 1015 ? 16 : t.type === 1016 ? 8 : 4; return w * h * bpp * (t.generateMipmaps && t.minFilter !== 1006 && t.minFilter !== 1003 ? 4 / 3 : 1); };
    e.scene.traverse((o: any) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) for (const k of Object.keys(m)) { const v = (m as any)[k]; if (v && v.isTexture && !seen.has(v)) { seen.add(v); bytes += texBytes(v); } }
      if (o.isSkinnedMesh && o.skeleton?.boneTexture && !seen.has(o.skeleton.boneTexture)) { seen.add(o.skeleton.boneTexture); boneBytes += texBytes(o.skeleton.boneTexture); }
    });
    r.info.autoReset = false; r.info.reset();
    const t0 = performance.now(); let n = 0; let last = t0; const gaps: number[] = []; const fms: number[] = [];
    const tick = (now: number) => {
      gaps.push(now - last); last = now; fms.push(e.frameMs); n++;
      if (now - t0 < SAMPLE_MS) { requestAnimationFrame(tick); return; }
      const sorted = [...gaps.slice(1)].sort((a, b) => a - b);
      const out = {
        frames: n, calls: Math.round(r.info.render.calls / n), tris: Math.round(r.info.render.triangles / n),
        geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length ?? 0,
        textureKB: Math.round(bytes / 1024), boneTextureKB: Math.round(boneBytes / 1024),
        frameIntervalMsMedian: +(sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(1), frameIntervalMsP90: +(sorted[Math.floor(sorted.length * 0.9)] ?? 0).toFixed(1),
        engineFrameMs: +e.frameMs.toFixed(2),
      };
      r.info.autoReset = true;
      res(out);
    };
    requestAnimationFrame(tick);
  }), SAMPLE_MS);
  const crowd = (n: number, cand: boolean) => p.evaluate(({ n, cand, at }) => (window as any).__fps.engine().setCrowd(n, cand, at, Math.PI), { n, cand, at: AT });

  report.empty = await sample();
  for (const n of [1, 4, 8]) {
    for (const cand of [false, true]) {
      const built = await crowd(n, cand);
      await sleep(1200);
      const s = await sample();
      const label = `${n}-${cand ? 'candidate' : 'current'}`;
      await p.screenshot({ path: path.join(OUT, `crowd-${Q}-${label}.png`) });
      report.runs.push({ n, model: cand ? 'candidate' : 'current', candidatesBuilt: built, ...s });
      console.log(Q, label, JSON.stringify(s));
    }
  }
  // Stability: three rounds of 8 candidates, 8 current, none; memory must match round to round.
  const mem = () => p.evaluate(() => { const e = (window as any).__fps.engine(), r = e.renderer; let objs = 0; e.scene.traverse(() => objs++); return { geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length ?? 0, objects: objs }; });
  report.stability = [];
  for (let round = 0; round < 3; round++) {
    for (const [n, cand] of [[8, true], [8, false], [0, false]] as const) {
      await crowd(n, cand); await sleep(600); await sample();
      report.stability.push({ round, state: `${n}-${cand ? 'candidate' : 'current'}`, ...(await mem()) });
    }
  }
  // A quality round trip with 8 candidates up, then disposal.
  const other = Q === 'high' ? 'low' : 'high';
  for (const q of [other, Q]) {
    await p.evaluate((q) => (document.querySelector(`[data-q="${q}"]`) as HTMLElement).click(), q);
    await p.waitForFunction((q) => (window as any).__fps.engine().quality === q, q, { timeout: 30000 });
    await p.evaluate((c) => (window as any).__fps.engine().setShowcase('patio', c.pos, c.look), CAM);
    await crowd(8, true); await sleep(800); await sample();
    report.stability.push({ round: 'quality', state: `${q} 8-candidate`, ...(await mem()) });
  }
  await crowd(0, false); await sleep(600); await sample();
  report.stability.push({ round: 'end', state: '0-current', ...(await mem()) });
  const byState = (st: string) => report.stability.filter((x: any) => x.state === st && typeof x.round === 'number');
  report.stable = ['8-candidate', '8-current', '0-current'].map((st) => {
    const xs = byState(st); const a = xs[0], b = xs[xs.length - 1];
    return { state: st, first: a, last: b, same: a.geometries === b.geometries && a.textures === b.textures && a.objects === b.objects };
  });
  report.errors = errors;
  fs.writeFileSync(path.join(OUT, `crowd-${Q}.json`), JSON.stringify(report, null, 1));
  console.log('stable', JSON.stringify(report.stable.map((x: any) => [x.state, x.same])), 'errors', errors.length);
  await ctx.close();
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
