// Arcade performance at phone size, per map and quality: 844x390 landscape,
// touch emulation, device pixel ratio 3 (a current iPhone or flagship
// Android). Headless Chromium with SwiftShader: the frame rate measures this
// container's CPU rasterizer, NOT a phone. What carries over to a phone is
// the work submitted: pixels drawn per frame, draw calls, triangles,
// geometries and textures held, and the JS heap.
//
//   npm run build && node --import tsx scripts/perf-mobile.ts [label]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SITE = process.env.E2E_URL || 'http://localhost:4173/';
const LABEL = process.argv[2] || 'run';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const executablePath = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p));
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const rows: Array<Record<string, unknown>> = [];
  try {
    for (const quality of ['low', 'medium']) {
      for (const map of ['patio', 'plaza', 'fiesta']) {
        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
        await ctx.addInitScript({ content: `window.__name = (f) => f; localStorage.setItem("chancla.settings.v1", JSON.stringify({ quality: "${quality}", arcadeMap: "${map}" })); localStorage.setItem("chancla.progress.v1", JSON.stringify({ runs: 1 }));` });
        const page = await ctx.newPage();
        await page.goto(new URL('classic.html', SITE).toString());
        await page.waitForFunction(() => !!(window as any).__chancla);
        await page.evaluate(() => (document.getElementById('btn-play') as HTMLElement).click());
        const t0 = Date.now();
        await page.evaluate(() => (document.getElementById('btn-maps-start') as HTMLElement).click());
        await page.waitForFunction(() => (window as any).__chancla.snapshot().state === 'playing', undefined, { timeout: 30000 });
        const loadMs = Date.now() - t0;
        await sleep(10000); // the touch render scale adapts every 3 s; let it settle
        const samples: number[] = [];
        for (let i = 0; i < 12; i++) { await sleep(1000); samples.push(await page.evaluate(() => (window as any).__chancla.snapshot().fps)); }
        const info = await page.evaluate(() => {
          const a = (window as any).__chancla.app; const r = a.renderer; const i = r.info; const c = r.domElement as HTMLCanvasElement;
          return { renderScale: (window as any).__chancla.snapshot().renderScale, pixelRatio: +r.getPixelRatio().toFixed(2), canvas: `${c.width}x${c.height}`, megapixels: +((c.width * c.height) / 1e6).toFixed(2), shadows: r.shadowMap.enabled, drawCalls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, heapMB: (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 1048576) : null };
        });
        rows.push({ quality, map, loadMs, fps: +(samples.reduce((s, x) => s + x, 0) / samples.length).toFixed(1), ...info });
        console.log(JSON.stringify(rows[rows.length - 1]));
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  const env = { at: new Date().toISOString(), label: LABEL, device: 'Chromium mobile emulation, 844x390 landscape, DPR 3, touch', browser: 'Chromium 141 headless, SwiftShader (software GL). NOT a phone.', cpu: os.cpus()[0]?.model, cores: os.cpus().length };
  fs.mkdirSync(path.join(ROOT, 'docs/evidence/mobile'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, `docs/evidence/mobile/perf-${LABEL}.json`), JSON.stringify({ env, rows }, null, 2));
}

void main();
