// Stills and rendering cost of the arena maps, from the real game page:
// offline practice on each map, the camera at player eye height (1.58 m) at
// fixed spots, the HUD and your own hand hidden, bots parked out of view.
// For every view it records the whole frame's draw calls and triangles and,
// over two seconds, the median and 95th-percentile frame time. The same
// views on two builds give before/after pairs and the incremental cost.
//
// Here (Linux container, software rendering):
//   GRAPHICS_EXPERIMENT=1 npm run build && OUT=<dir> node --import tsx scripts/map-capture.ts
//
// On a Mac with a real GPU (uses the installed Google Chrome, in a window):
//   GRAPHICS_EXPERIMENT=1 npm run build && npm run capture:maps -- --gpu
//   (writes artifacts/map-capture/<maps>-<quality>/*.png and costs.json)
//
// Options (environment or --flags): MAPS=patio,plaza,fiesta  QUALITIES=high,medium,low
//   DIST=<build dir>  OUT=<dir>  PORT=4185  --gpu (or GPU=1)  PHONE=1 (adds a phone view on Low)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright-core';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';

const argv = new Set(process.argv.slice(2));
const GPU = argv.has('--gpu') || process.env.GPU === '1';
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.PORT || 4185);
const SITE = `http://localhost:${PORT}/`;
const DIST = path.resolve(process.env.DIST || path.join(ROOT, 'dist'));
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'artifacts/map-capture'));
const MAPS = (process.env.MAPS || 'patio,plaza,fiesta').split(',');
const QUALITIES = (process.env.QUALITIES || 'high,medium,low').split(',');
const SET = process.env.SET === 'lighting' ? 'lighting' : 'maps';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Camera spots per map: [name, eye x, eye z, look x, look y, look z]. All clear of every box. */
export const VIEWS: Record<string, ReadonlyArray<readonly [string, number, number, number, number, number]>> = {
  patio: [
    ['plaza-west', -15, 6, 10, 1.4, -2],
    ['fountain', 0, 7.2, 0, 1.4, 0],
    ['cafe', -2.5, -1.5, -2.5, 2.2, -10],
  ],
  plaza: [
    ['market-west', -21, 2, 10, 1.3, -1],
    ['walkway-north', -21, -12.4, 10, 1.5, -12.4],
    ['fountain', -8, 4.5, 0, 1.3, 0],
    ['stage-south', 9, 4.0, 0, 1.6, 8.8],
    ['stalls-east', 15, -2, 11.3, 1.1, -5.8],
  ],
  fiesta: [
    ['tables-west', -14.8, 5.2, 6, 1.6, -1.5],
    ['pinata', -5, 5.5, 0, 3.4, 0],
    ['stage-north', -1, -5, 0, 1.5, -11],
    ['hedges-east', 16, 4.5, 4, 1.4, 7.3],
  ],
};

/**
 * SET=lighting: the lighting milestone's matched views, with both teams in shot.
 * A view's 7th entry places your ally (Sol) and the enemy (Luna): [solX, solZ, lunaX, lunaZ];
 * both face the camera and stand still (bots paused), so before and after match.
 */
export const LIGHT_VIEWS: Record<string, ReadonlyArray<readonly [string, number, number, number, number, number, (readonly [number, number, number, number])?]>> = {
  patio: [
    ['sun-close', -12, 4, 0, 1.3, 4, [-9.1, 3.1, -9.1, 4.9]],
    ['sun-combat', -15, 0.5, 0, 1.3, 1, [-5.5, -0.3, -5, 2.2]],
    ['alley-shade', 12, -12, -6, 1.6, -12, [9, -12.6, 8.2, -11.3]],
  ],
  plaza: [
    ['market', -21, 2, 10, 1.3, -1, [-14, 1, -13, 3.2]],
    ['walkway', -21, -13.6, 10, 1.5, -13.6, [-16, -14, -13.5, -13.2]],
  ],
  fiesta: [
    ['dance-floor', -5.5, 3.5, 0, 1.3, 0, [-2.2, 1.3, -1.2, -0.6]],
    ['hedge-route', 16, 4.5, 4, 1.4, 7.3, [12, 5.6, 9.5, 5.2]],
  ],
};

async function waitHttp(url: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

async function browser(): Promise<Browser> {
  if (!GPU) return launch();
  // A real GPU: the installed Chrome, in a window (headless Chrome may fall back to software).
  // CHROMIUM_PATH picks another Chromium-based browser instead of Google Chrome.
  const args = ['--autoplay-policy=no-user-gesture-required', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
  return process.env.CHROMIUM_PATH
    ? chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: false, args })
    : chromium.launch({ channel: 'chrome', headless: false, args });
}

async function open(b: Browser, map: string, quality: string, phone: boolean): Promise<Page> {
  const ctx = await b.newContext(phone ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 960, height: 540 } });
  await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const p = await ctx.newPage();
  await p.addInitScript({ content: `window.__name = (f) => f; try { localStorage.setItem('chancla.mp.settings.v1', JSON.stringify({ practiceMap: '${map}', practiceAllies: 1, practiceEnemies: 1, practiceDifficulty: 'easy', quality: '${quality}', qualityMode: '${quality}', music: 0, killcam: false })); } catch {}` });
  await p.goto(SITE);
  await p.addStyleTag({ content: '#hud, .ft-root, #fps-touch, #touch, .touch-ui, #subs { visibility: hidden !important; }' });
  await p.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { polling: 100 });
  await sleep(500);
  await p.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
  await p.evaluate(() => (document.getElementById('btn-practice-start') as HTMLElement).click());
  await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing' && (window as any).__fps.session()?.alive, undefined, { timeout: 60000, polling: 100 });
  await p.evaluate(() => {
    const f = (window as any).__fps; f.input().fallback = true;
    const room = [...f.host().hub.rooms.values()][0];
    for (const m of room.members.values()) if (m.bot) m.brain = null;
    f.engine().vm.root.scale.setScalar(1e-4);
  });
  await sleep(2000);
  return p;
}

interface Cost { calls: number; tris: number; medianMs: number; p95Ms: number; frames: number }

type View = readonly [string, number, number, number, number, number, (readonly [number, number, number, number])?];

async function view(p: Page, v: View, sampleMs: number): Promise<Cost> {
  return p.evaluate(async ([[, ex, ez, lx, ly, lz, chars], sampleMs]) => {
    const f = (window as any).__fps, s = f.session(), room = [...f.host().hub.rooms.values()][0];
    const me = room.sim.players.get(s.id);
    let k = 0;
    // Bots far outside the arena, so no character is in shot; or, with `chars`, your ally and the enemy where given, facing the camera.
    for (const q of room.sim.players.values()) {
      if (q === me) continue;
      q.body.vx = q.body.vz = 0; q.protectedUntil = 0;
      if (chars) {
        const [x, z] = q.team === me.team ? [chars[0], chars[1]] : [chars[2], chars[3]];
        q.body.x = x; q.body.z = z; q.body.y = 0;
        q.yaw = Math.atan2(-(ex - x), -(ez - z)); q.pitch = 0;
      } else { q.body.x = 80 + k++ * 2; q.body.z = 80; }
    }
    for (const b of [me.body, s.body]) { b.x = ex; b.z = ez; b.y = 0; b.vx = b.vy = b.vz = 0; }
    const i = f.input(), dx = lx - ex, dz = lz - ez;
    i.yaw = Math.atan2(-dx, -dz); i.pitch = Math.atan2(ly - 1.58, Math.hypot(dx, dz));
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await wait(700);
    const r = f.engine().renderer;
    r.info.autoReset = false;
    // One whole frame's counts (scene, shadows and the hand pass together).
    await new Promise((res) => requestAnimationFrame(() => { r.info.reset(); requestAnimationFrame(() => setTimeout(res, 0)); }));
    const calls = r.info.render.calls, tris = r.info.render.triangles;
    r.info.autoReset = true;
    // Frame times over the sampling window.
    const times: number[] = [];
    await new Promise<void>((res) => {
      let last = performance.now();
      const end = last + (sampleMs as number);
      const tick = (t: number) => { times.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else res(); };
      requestAnimationFrame(tick);
    });
    times.shift();
    times.sort((a, b) => a - b);
    const q = (x: number) => times[Math.min(times.length - 1, Math.floor(x * times.length))] ?? 0;
    return { calls, tris, medianMs: +q(0.5).toFixed(1), p95Ms: +q(0.95).toFixed(1), frames: times.length };
  }, [v, sampleMs] as const);
}

async function main(): Promise<void> {
  let preview: ChildProcess | null = null;
  if (!(await waitHttp(SITE, 500))) {
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST], { cwd: ROOT, stdio: 'ignore' });
    if (!(await waitHttp(SITE))) throw new Error('preview did not start');
  }
  const b = await browser();
  const costs: Record<string, Cost> = {};
  let glRenderer = '';
  const sampleMs = GPU ? 2000 : 600; // software rendering: the counts are exact, the times are not evidence
  try {
    for (const map of MAPS) {
      for (const q of QUALITIES) {
        const p = await open(b, map, q, false);
        // What actually rendered (on a Mac: the Apple GPU through ANGLE/Metal; here: SwiftShader).
        if (!glRenderer) glRenderer = await p.evaluate(() => { const gl = (window as any).__fps.engine().renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info'); return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); });
        for (const v of (SET === 'lighting' ? LIGHT_VIEWS : VIEWS)[map] ?? []) {
          costs[`${map}/${v[0]}-${q}`] = await view(p, v, sampleMs);
          await p.screenshot({ path: path.join(OUT, `${map}-${v[0]}-${q}.png`), timeout: 120000 });
          console.log(`${map}/${v[0]}-${q}`, JSON.stringify(costs[`${map}/${v[0]}-${q}`]));
        }
        await p.context().close();
      }
      if (process.env.PHONE) {
        const p = await open(b, map, 'low', true);
        const v = (SET === 'lighting' ? LIGHT_VIEWS : VIEWS)[map]![0]!;
        costs[`${map}/${v[0]}-phone-low`] = await view(p, v, sampleMs);
        await p.screenshot({ path: path.join(OUT, `${map}-${v[0]}-phone-low.png`), timeout: 120000 });
        await p.context().close();
      }
    }
  } finally {
    await b.close();
    preview?.kill();
  }
  const env = { gpu: GPU, webgl: glRenderer, renderer: GPU ? 'system Chrome, hardware' : 'Chromium, SwiftShader (software)', host: `${os.platform()} ${os.arch()} ${os.cpus()[0]?.model ?? ''}`, at: new Date().toISOString() };
  fs.writeFileSync(path.join(OUT, 'costs.json'), JSON.stringify({ env, costs }, null, 1));
  console.log(`wrote ${Object.keys(costs).length} views to ${OUT}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
