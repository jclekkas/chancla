// Runs the in-game section benchmark (src/fps/bench.ts) locally: the
// controlled comparison (?bench) for the experiment and the environment-off
// equivalent drawing, alternating, and the live stress test (?bench=live).
// Checks that the controlled scene is identical at different frame rates and
// that runs invalidate themselves when they should. Needs an offline build:
//
//   GRAPHICS_EXPERIMENT=1 npm run build && node --import tsx scripts/graphics-bench-e2e.ts
//
// QUICK=1 runs 15 s measurements instead of 60 s (indicative only). Every
// request that is not to this local server is blocked and recorded; the
// test fails if there is one. Results go to docs/graphics/bench (or OUT).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Browser, BrowserContextOptions, Page } from 'playwright-core';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.PORT || 4177);
const SITE = `http://localhost:${PORT}/`;
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'docs/graphics/bench'));
const SECS = process.env.QUICK === '1' ? 15 : 60;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); };

async function waitHttp(url: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 };
const PHONE: BrowserContextOptions = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' };

async function open(browser: Browser, ctxOpts: BrowserContextOptions, query: string, blocked: string[], errors: string[]): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ ...ctxOpts, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SITE.replace(/\/$/, '') }).catch(() => undefined);
  await ctx.addInitScript({ content: 'window.__name = (f) => f;' });
  await ctx.route('**/*', (r) => { const u = r.request().url(); if (u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); blocked.push(u); return r.abort(); });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('websocket', (w) => blocked.push(`websocket ${w.url()}`));
  await page.goto(query ? `${SITE}?${query}` : SITE);
  return { page, close: () => ctx.close() };
}

/** Waits for the panel to say it is measuring (the software renderer is slow to load and warm up). */
const measuring = (p: Page) => p.waitForFunction(() => /Measuring/.test(document.getElementById('bench-panel')?.textContent ?? ''), undefined, { timeout: 180000, polling: 250 })
  .catch(async (e) => { throw new Error(`never reached measuring: ${await p.evaluate(() => document.getElementById('bench-panel')?.textContent ?? 'no panel').catch(() => '?')} (${e})`); });
const result = (p: Page, ms: number) => p.waitForFunction(() => (window as any).__benchResult, undefined, { timeout: ms, polling: 500 }).then((h) => h.jsonValue() as Promise<any>);

async function main(): Promise<void> {
  const procs: ChildProcess[] = [spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' })];
  if (!(await waitHttp(SITE))) throw new Error('preview server did not start');
  const browser: Browser = await launch(['--mute-audio']);
  const blocked: string[] = [], errors: string[] = [];
  const runs: any[] = [];
  try {
    // EQ_ONLY=1 runs only the frame-rate equivalence check (section 2).
    if (process.env.EQ_ONLY !== '1') {
    // 1. Invalidation and the panel's controls, on short runs.
    {
      const { page, close } = await open(browser, DESKTOP, 'bench&secs=5&warmup=2', blocked, errors);
      await measuring(page);
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      const r = await result(page, 30000);
      check('hiding the tab invalidates the run', !r.valid && /hidden/.test(r.invalidReason), r.invalidReason);
      await close();
    }
    {
      const { page, close } = await open(browser, DESKTOP, 'bench&secs=5&warmup=2', blocked, errors);
      await measuring(page);
      await page.setViewportSize({ width: 1100, height: 700 });
      const r = await result(page, 30000);
      check('resizing the window invalidates the run', !r.valid && /size/.test(r.invalidReason), r.invalidReason);
      await close();
    }
    {
      const { page, close } = await open(browser, DESKTOP, 'bench&secs=5&warmup=2', blocked, errors);
      await measuring(page);
      await page.keyboard.press('Escape');
      const r = await result(page, 30000);
      check('opening the menu invalidates the run', !r.valid && /menu/.test(r.invalidReason), r.invalidReason);
      await close();
    }
    {
      // Known saved settings first, so the check below can tell whether the run put them back.
      const { page, close } = await open(browser, DESKTOP, '', blocked, errors);
      await page.evaluate(() => localStorage.setItem('chancla.mp.settings.v1', JSON.stringify({ qualityMode: 'medium', quality: 'medium', practiceEnemies: 1, practiceMap: 'plaza' })));
      await page.goto(`${SITE}?bench&secs=5&warmup=2&section=off`);
      const r = await result(page, 90000);
      check('a short run completes, says it is indicative only, and records every field', r.valid && /indicative/.test(r.note) && r.frames > 0 && r.render.bufferSize[0] === 1280 && r.drawCalls.avg > 0 && r.triangles.avg > 0 && r.quality === 'high' && r.variant === 'environment-off' && r.comparison === 'environment-only' && r.firstPerson.drawCalls > 0 && /Complete frame intervals/.test(r.sampling), { frames: r.frames, buffer: r.render.bufferSize, calls: r.drawCalls, variant: r.variant });
      const dl = page.waitForEvent('download', { timeout: 10000 });
      await page.getByRole('button', { name: 'Save JSON' }).click();
      const file = await dl;
      const saved = JSON.parse(fs.readFileSync((await file.path())!, 'utf8'));
      check('Save JSON downloads the result locally', saved.kind === 'chancla-section-benchmark' && saved.frames === r.frames, file.suggestedFilename());
      await page.getByRole('button', { name: 'Copy results' }).click();
      await sleep(300);
      const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
      check('Copy results puts the JSON on the clipboard', clip.includes('chancla-section-benchmark'));
      const links = await page.evaluate(() => [...document.querySelectorAll('#bench-panel a')].map((a) => (a as HTMLAnchorElement).search));
      check('the panel links to the other variant and qualities', links.some((l) => l.includes('bench') && !l.includes('section=off')) && links.some((l) => l.includes('quality=low')), links);
      await page.goto(SITE); // leaving the benchmark page
      await sleep(500);
      const after = await page.evaluate(() => JSON.parse(localStorage.getItem('chancla.mp.settings.v1') || '{}'));
      check('leaving the benchmark puts the saved settings back', after.qualityMode === 'medium' && after.practiceEnemies === 1 && after.practiceMap === 'plaza', { qualityMode: after.qualityMode, enemies: after.practiceEnemies, map: after.practiceMap });
      await close();
    }

    }
    // 2. The controlled scene is the same at the same moment whatever the frame rate:
    //    one run as fast as it goes, one slowed by a 900 ms busy wait per frame.
    {
      const runEq = async (q: string) => { const { page, close } = await open(browser, DESKTOP, `bench&secs=20&warmup=4&${q}`, blocked, errors); const r = await result(page, 400000); await close(); return r; };
      const fast = await runEq('section=on');
      const slow = await runEq('section=off&throttle=900');
      const ok = (r: any) => r.valid && r.scene.maxCameraError <= 1e-3 && r.scene.maxCharacterError <= 1e-3 && r.scene.maxProjectileError <= 1e-3 && r.scene.minCharactersDrawn === 3 && r.scene.minProjectilesDrawn === 6;
      check('controlled scene: what was drawn matched the script at every checkpoint, at normal speed', ok(fast), fast.scene);
      check('controlled scene: and with frames slowed by a 900 ms busy wait (the other variant)', ok(slow), slow.scene);
      check('the two runs drew clearly different numbers of frames, yet ran the same workload', slow.frames < fast.frames * 0.7 && fast.workload.id === slow.workload.id && fast.workload.hash === slow.workload.hash, { fast: fast.frames, slow: slow.frames, workload: `${fast.workload.id}#${fast.workload.hash}` });
      // Each view's window is scheduled exactly; the time of the complete frames counted in it
      // can differ by up to one frame at each boundary (frames belong, whole, to the view they start in).
      const even = (r: any) => r.perView.every((v: any) => v.windowS === 5 && Math.abs(v.sampledS - v.windowS) <= 2 * r.maxFrameMs / 1000 + 0.05);
      check('each view has an equal scheduled window, and its counted frames cover it to within a frame at each end', even(fast) && even(slow), { fast: fast.perView.map((v: any) => v.sampledS), slow: slow.perView.map((v: any) => v.sampledS), maxFrame: [fast.maxFrameMs, slow.maxFrameMs] });
      check('a throttled run is marked as a test run, not a measurement', slow.testRun === true && /not a measurement/.test(slow.note));
    }

    // 3. Measurements. Controlled: A B B A at High, then Low, then an emulated phone at Low.
    //    Live stress test: A B at High (real bots; differences include what was on screen).
    const plan: Array<[string, BrowserContextOptions, string]> = [
      ['desktop', DESKTOP, 'quality=high'], ['desktop', DESKTOP, 'quality=high&section=off'],
      ['desktop', DESKTOP, 'quality=high&section=off'], ['desktop', DESKTOP, 'quality=high'],
      ['desktop', DESKTOP, 'quality=low'], ['desktop', DESKTOP, 'quality=low&section=off'],
      ['phone (emulated)', PHONE, 'quality=low'], ['phone (emulated)', PHONE, 'quality=low&section=off'],
      ['desktop', DESKTOP, 'quality=high&live'], ['desktop', DESKTOP, 'quality=high&section=off&live'],
    ];
    for (const [device, opts, q] of process.env.EQ_ONLY === '1' ? [] : plan) {
      const query = q.endsWith('&live') ? `bench=live&secs=${SECS}&${q.replace('&live', '')}` : `bench&secs=${SECS}&${q}`;
      const { page, close } = await open(browser, opts, query, blocked, errors);
      const r = await result(page, (SECS + 10 + 240) * 1000);
      r.device = device;
      runs.push(r);
      console.log(`${device} ${r.mode} ${r.variant} ${r.quality}: valid=${r.valid} ${r.avgFps} fps p95 ${r.p95FrameMs} ms, ${r.drawCalls.avg} calls (${r.drawCalls.min}-${r.drawCalls.max}), ${r.triangles.avg} tris, buffer ${r.render.bufferSize.join('x')} @${r.render.pixelRatio}, views ${r.perView.map((v: any) => v.sampledS).join('/')} s, first person ${r.firstPerson.drawCalls} calls ${r.firstPerson.triangles} tris, ${JSON.stringify(r.scene)}`);
      if (r.mode === 'controlled') check(`${device} controlled ${r.variant} ${r.quality}: valid, scene matched the script`, r.valid && r.scene.maxCharacterError <= 1e-3 && r.measuredS >= SECS - 2, { invalid: r.invalidReason, scene: r.scene });
      else check(`${device} live ${r.variant} ${r.quality}: valid, Rosa never eliminated, throws happened`, r.valid && r.scene.rosaEliminated === 0 && r.scene.throwsByRosa > 0, { invalid: r.invalidReason, scene: r.scene });
      await close();
    }
  } finally {
    await browser.close();
    for (const pr of procs) pr.kill();
  }
  check('no request or socket left this machine (production game server never contacted)', blocked.length === 0, blocked.slice(0, 5));
  check('no page errors', errors.length === 0, errors.slice(0, 5));
  fs.writeFileSync(path.join(OUT, `bench-${SECS}s.json`), JSON.stringify(runs, null, 1));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

void main();
