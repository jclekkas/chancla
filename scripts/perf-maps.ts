// Performance of each map against El Patio under the same conditions:
// 1280x720, quality "medium", Practice 2v2 (1 bot teammate, 2 bot
// opponents) and an Arcade run, 15 s of play after a 4 s warm-up, the
// camera following the player at spawn. Headless Chromium with SwiftShader
// (software rendering on the CPU): frame rates here measure this container,
// not a real GPU. Draw calls, triangles and resource counts are what the
// renderer submits, which does carry over to real hardware.
//
//   npm run build && node --import tsx scripts/perf-maps.ts
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SITE = process.env.E2E_URL || 'http://localhost:4173/';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url: string): Promise<boolean> {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

async function main(): Promise<void> {
  let preview: ChildProcess | null = null;
  if (!process.env.E2E_URL && !(await waitHttp(SITE).catch(() => false))) {
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
    await waitHttp(SITE);
  }
  const browser = await launch(['--mute-audio']);
  const rows: Array<Record<string, unknown>> = [];
  try {
    for (const map of ['patio', 'plaza', 'fiesta']) {
      // Practice
      {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        await ctx.addInitScript({ content: 'window.__name = (f) => f; localStorage.setItem("chancla.mp.settings.v1", JSON.stringify({ quality: "medium", practiceAllies: 1, practiceEnemies: 2, practiceDifficulty: "normal" }));' });
        const page = await ctx.newPage();
        await page.goto(SITE);
        await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
        await page.click('#btn-practice');
        await page.click(`.map-card[data-map="${map}"]`);
        const t0 = Date.now();
        await page.click('#btn-practice-start');
        await page.waitForFunction(() => (window as any).__fps.inMatch && (window as any).__fps.screen === 'none');
        const loadMs = Date.now() - t0;
        await sleep(4000);
        const samples: Array<{ frameMs: number; fps: number }> = [];
        for (let i = 0; i < 15; i++) { await sleep(1000); samples.push(await page.evaluate(() => { const i = (window as any).__fps.info(); return { frameMs: i.frameMs, fps: i.fps }; })); }
        const info = await page.evaluate(() => { const e = (window as any).__fps.engine(); const i = (window as any).__fps.info(); const m = e.renderer.info.memory; return { drawCalls: i.drawCalls, triangles: i.triangles, geometries: m.geometries, textures: m.textures, worldDrawCalls: e.world.drawCalls, heapMB: (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 1048576) : null }; });
        const avg = (k: 'frameMs' | 'fps') => +(samples.reduce((s, x) => s + x[k], 0) / samples.length).toFixed(1);
        rows.push({ mode: 'practice', map, loadMs, jsFrameMs: avg('frameMs'), fps: avg('fps'), ...info });
        console.log(JSON.stringify(rows[rows.length - 1]));
        await ctx.close();
      }
      // Arcade
      {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        await ctx.addInitScript({ content: `window.__name = (f) => f; localStorage.setItem("chancla.settings.v1", JSON.stringify({ quality: "medium", arcadeMap: "${map}" })); localStorage.setItem("chancla.progress.v1", JSON.stringify({ runs: 1 }));` });
        const page = await ctx.newPage();
        await page.goto(new URL('classic.html', SITE).toString());
        await page.waitForFunction(() => !!(window as any).__chancla);
        await page.click('#btn-play');
        const t0 = Date.now();
        await page.click('#btn-maps-start');
        await page.waitForFunction(() => (window as any).__chancla.snapshot().state === 'playing');
        const loadMs = Date.now() - t0;
        await sleep(4000);
        const samples: number[] = [];
        for (let i = 0; i < 15; i++) { await sleep(1000); samples.push(await page.evaluate(() => (window as any).__chancla.snapshot().fps)); }
        const info = await page.evaluate(() => { const a = (window as any).__chancla.app; const r = a.renderer.info; return { drawCalls: r.render.calls, triangles: r.render.triangles, geometries: r.memory.geometries, textures: r.memory.textures, heapMB: (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 1048576) : null }; });
        rows.push({ mode: 'arcade', map, loadMs, fps: +(samples.reduce((s, x) => s + x, 0) / samples.length).toFixed(1), ...info });
        console.log(JSON.stringify(rows[rows.length - 1]));
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    preview?.kill();
  }
  const env = { at: new Date().toISOString(), browser: 'Chromium 141 headless, SwiftShader (software GL)', cpu: os.cpus()[0]?.model, cores: os.cpus().length, os: `${os.type()} ${os.release()}` };
  fs.mkdirSync(path.join(ROOT, 'docs/evidence/maps'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs/evidence/maps/perf.json'), JSON.stringify({ env, rows }, null, 2));
  console.log(JSON.stringify(env));
}

void main();
