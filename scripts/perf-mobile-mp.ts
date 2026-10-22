// The shooter at phone size: a practice match (2v2 with bots) at 844x390,
// touch emulation, DPR 3, quality Auto (Low on a phone) against Medium.
// Headless Chromium with SwiftShader: frame rates measure this container's
// CPU rasterizer, NOT a phone. The pixels drawn per frame carry over.
//
//   npm run build && node --import tsx scripts/perf-mobile-mp.ts
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SITE = process.env.E2E_URL || 'http://localhost:4173/';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const executablePath = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p));
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const rows: Array<Record<string, unknown>> = [];
  try {
    for (const mode of ['auto', 'medium']) {
      for (const map of ['patio', 'plaza', 'fiesta']) {
        const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
        await ctx.addInitScript({ content: `window.__name = (f) => f; localStorage.setItem("chancla.mp.settings.v1", JSON.stringify({ qualityMode: "${mode}", practiceMap: "${map}", practiceAllies: 1, practiceEnemies: 2 }));` });
        const page = await ctx.newPage();
        await page.goto(SITE);
        await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
        await page.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
        await page.evaluate(() => (document.getElementById('btn-practice-start') as HTMLElement).click());
        await page.waitForFunction(() => (window as any).__fps.inMatch, undefined, { timeout: 30000 });
        await sleep(4000);
        const samples: number[] = [];
        for (let i = 0; i < 12; i++) { await sleep(1000); samples.push(await page.evaluate(() => (window as any).__fps.info().fps)); }
        const info = await page.evaluate(() => { const i = (window as any).__fps.info(); const r = (window as any).__fps.engine().renderer; const c = r.domElement as HTMLCanvasElement; return { quality: i.quality, pixelRatio: +r.getPixelRatio().toFixed(2), canvas: `${c.width}x${c.height}`, shadows: r.shadowMap.enabled, heapMB: (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 1048576) : null }; });
        rows.push({ setting: mode, map, fps: +(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(1), ...info });
        console.log(JSON.stringify(rows[rows.length - 1]));
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  const env = { at: new Date().toISOString(), device: 'Chromium mobile emulation, 844x390 landscape, DPR 3, touch', browser: 'Chromium 141 headless, SwiftShader (software GL). NOT a phone.', cpu: os.cpus()[0]?.model, cores: os.cpus().length };
  fs.mkdirSync(path.join(ROOT, 'docs/evidence/mobile-mp'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs/evidence/mobile-mp/perf.json'), JSON.stringify({ env, rows }, null, 2));
}

void main();
