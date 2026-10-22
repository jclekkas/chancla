// Extended session: one player keeps playing for a long time without
// reloading (campaign, online with a friend who joins and leaves, rematches,
// map changes, practice with restarts), then crosses into the Arcade and
// back. Measures what could accumulate: JS heap after GC, GPU geometries
// and textures, DOM size, animation loops, errors, frame stalls, and the
// server's rooms and connections. Local server only.
//
//   npm run build && node --import tsx scripts/soak-e2e.ts [minutes=15]
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Browser, BrowserContext, Page } from 'playwright-core';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SITE = 'http://localhost:4173/';
const PORT = 8787;
const MINUTES = Number(process.argv[2] || 15);
const OUT = path.join(ROOT, 'docs/evidence/failure');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (m: string) => console.log(`${((Date.now() - T0) / 60000).toFixed(1)}m ${m}`);
const T0 = Date.now();

async function waitHttp(url: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}
async function until(p: Page, f: string, ms: number): Promise<boolean> {
  try { await p.waitForFunction(f, undefined, { timeout: ms, polling: 250 }); return true; } catch { return false; }
}

async function page(browser: Browser): Promise<{ ctx: BrowserContext; p: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 576 } });
  await ctx.addInitScript({ content: 'window.__name = (f) => f;' });
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|404/.test(m.text())) errors.push(m.text()); });
  return { ctx, p, errors };
}

async function boot(p: Page): Promise<void> {
  await p.goto(SITE);
  await p.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { timeout: 30000 });
}

/** Random movement, turning and throwing for `ms`. */
async function play(p: Page, ms: number): Promise<void> {
  const keys = ['w', 'a', 's', 'd'];
  const end = Date.now() + ms;
  await p.click('#stage', { force: true }).catch(() => undefined);
  while (Date.now() < end) {
    const k = keys[Math.floor(Math.random() * 4)]!;
    await p.keyboard.down(k);
    await p.mouse.move(400 + Math.random() * 200, 300, { steps: 2 });
    if (Math.random() < 0.6) await p.keyboard.press('f');
    if (Math.random() < 0.1) await p.keyboard.press(Math.random() < 0.5 ? '1' : '2');
    await sleep(250 + Math.random() * 300);
    await p.keyboard.up(k);
  }
}

async function measure(p: Page): Promise<Record<string, number>> {
  return p.evaluate(() => {
    (window as any).gc?.();
    const f = (window as any).__fps;
    const e = f.engine();
    const info = e?.diag() ?? {};
    const mem = (performance as any).memory;
    return {
      heapMB: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : -1,
      geometries: info.geometries ?? -1,
      textures: info.textures ?? -1,
      domNodes: document.getElementsByTagName('*').length,
      errors: JSON.parse(f.diagText().split('\n\nRecent')[0].replace(/^Chancla Warfare diagnostics\n/, '')).errors,
      stalls: (f.diagText().match(/ stall /g) ?? []).length,
    };
  });
}

async function serverStats(): Promise<Record<string, unknown>> {
  return (await (await fetch(`http://localhost:${PORT}/healthz`)).json()) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const busy = await new Promise<boolean>((r) => { const s = net.connect(PORT, '127.0.0.1'); s.on('connect', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
  if (busy) throw new Error(`port ${PORT} is busy`);
  const procs: ChildProcess[] = [];
  procs.push(spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), MATCH_COUNTDOWN_MS: '800', MATCH_DURATION_MS: '25000' }, stdio: 'ignore' }));
  if (!(await waitHttp(SITE, 1500))) procs.push(spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { cwd: ROOT, stdio: 'ignore' }));
  await waitHttp(SITE);
  if (!(await waitHttp(`http://localhost:${PORT}/healthz`))) throw new Error('server did not start');
  const browser: Browser = await launch(['--enable-precise-memory-info', '--js-flags=--expose-gc']);
  const samples: Array<Record<string, unknown>> = [];
  const problems: string[] = [];
  let cycles = 0;
  let matches = 0;
  try {
    const me = await page(browser);
    await boot(me.p);
    samples.push({ cycle: 0, minutes: 0, ...(await measure(me.p)) });
    const maps = ['patio', 'plaza', 'fiesta'];
    while (Date.now() - T0 < MINUTES * 60000) {
      cycles++;
      // --- Campaign: start a mission, play a bit with the helper bot, leave to the menu.
      await me.p.click('#btn-campaign');
      await me.p.click(`.mcard[data-mission="${cycles % 2 ? 'ruleros' : 'cocina'}"] button`).catch(async () => me.p.click('.mcard[data-mission="ruleros"] button'));
      await me.p.click('#btn-mi-start');
      if (!(await until(me.p, '(window).__fps.campaign().active', 20000))) problems.push(`cycle ${cycles}: mission did not start`);
      await me.p.evaluate((seed) => (window as any).__fps.campaign().runtime.enableAutopilot(seed), cycles);
      await sleep(20000);
      await me.p.keyboard.press('Escape');
      await until(me.p, "(window).__fps.screen === 'pause'", 3000);
      await me.p.click('#btn-pause-select');
      await me.p.click('#btn-confirm-yes');
      await me.p.click('#btn-camp-back');
      await until(me.p, "(window).__fps.screen === 'title'", 5000);

      // --- Online: a friend joins by link, two matches (rematch), a map change, both leave.
      const friend = await page(browser);
      await boot(friend.p);
      await me.p.click('#btn-online');
      await me.p.click('#btn-create');
      await until(me.p, "(window).__fps.screen === 'lobby' && !!(window).__fps.code", 10000);
      await me.p.click(`[data-lmap="${maps[cycles % 3]}"]`).catch(() => undefined);
      const code = await me.p.evaluate(() => (window as any).__fps.code);
      await friend.p.goto(`${SITE}#room=${code}`);
      await until(friend.p, "(window).__fps?.screen === 'online'", 15000);
      await friend.p.click('#btn-join');
      await until(friend.p, "(window).__fps.screen === 'lobby'", 10000);
      for (let round = 0; round < 2; round++) {
        for (const pg of [me.p, friend.p]) if ((await pg.getAttribute('#btn-ready', 'aria-pressed').catch(() => 'true')) !== 'true') await pg.click('#btn-ready').catch(() => undefined);
        if (round === 0) {
          await me.p.waitForFunction(() => !(document.getElementById('btn-start') as HTMLButtonElement).disabled, undefined, { timeout: 15000 });
          await me.p.click('#btn-start');
        }
        if (!(await until(me.p, "(window).__fps.session()?.phase === 'playing'", 20000))) problems.push(`cycle ${cycles} round ${round}: online match did not start`);
        await Promise.all([play(me.p, 26000), play(friend.p, 26000)]);
        if (!(await until(me.p, "(window).__fps.screen === 'results'", 15000))) problems.push(`cycle ${cycles} round ${round}: no results screen`);
        else matches++;
        if (round === 0) { await me.p.click('#btn-rematch'); await friend.p.click('#btn-rematch').catch(() => undefined); }
      }
      await me.p.click('#btn-to-lobby').catch(() => undefined);
      await until(me.p, "(window).__fps.screen === 'lobby'", 8000);
      await me.p.click(`[data-lmap="${maps[(cycles + 1) % 3]}"]`).catch(() => undefined);
      await sleep(500);
      await friend.p.click('#btn-leave-room').catch(() => undefined);
      await friend.ctx.close();
      await me.p.click('#btn-leave-room').catch(() => undefined);
      await until(me.p, "(window).__fps.screen === 'title'", 5000);

      // --- Practice: random arena, play, restart once, leave.
      await me.p.click('#btn-practice');
      await me.p.click('#btn-practice-start');
      if (!(await until(me.p, "(window).__fps.session()?.phase === 'playing'", 20000))) problems.push(`cycle ${cycles}: practice did not start`);
      await play(me.p, 12000);
      await me.p.keyboard.press('Escape');
      await me.p.click('#btn-pause-restart');
      await me.p.click('#btn-confirm-yes').catch(() => undefined);
      await until(me.p, "(window).__fps.session()?.phase === 'playing'", 20000);
      await play(me.p, 8000);
      await me.p.keyboard.press('Escape');
      await me.p.click('#btn-pause-leave');
      await me.p.click('#btn-confirm-yes').catch(() => undefined);
      await until(me.p, "(window).__fps.screen === 'title'", 5000);
      matches += 2;
      await sleep(1500);
      const m = await measure(me.p);
      const srv = await serverStats();
      samples.push({ cycle: cycles, minutes: +((Date.now() - T0) / 60000).toFixed(1), ...m, serverRooms: srv.rooms, serverPlayers: srv.players });
      log(`cycle ${cycles}: ${JSON.stringify(samples.at(-1))}`);
    }

    // --- Campaign → menu → Arcade → online, twice: the page changes and comes back.
    for (let i = 0; i < 2; i++) {
      await me.p.click('#lnk-classic');
      await me.p.waitForURL(/classic\.html/, { timeout: 15000 });
      await me.p.waitForSelector('#btn-play', { state: 'visible', timeout: 30000 });
      await me.p.click('#btn-play');
      await me.p.click('#btn-maps-start');
      await sleep(1500);
      await me.p.keyboard.down('w'); await sleep(4000); await me.p.keyboard.up('w');
      await me.p.keyboard.press('Escape');
      await me.p.click('#btn-pause-home');
      await me.p.click('#btn-confirm-yes');
      await me.p.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { timeout: 30000 });
      await me.p.click('#btn-online');
      await me.p.click('#btn-create');
      const ok = await until(me.p, "(window).__fps.screen === 'lobby'", 10000);
      if (!ok) problems.push(`arcade round trip ${i}: online lobby did not open`);
      await me.p.click('#btn-leave-room');
      await until(me.p, "(window).__fps.screen === 'title'", 5000);
    }
    await sleep(1500);
    const final = await serverStats();
    const errs = me.errors;
    const first = samples[1] ?? samples[0]!, last = samples.at(-1)!;
    const report = {
      at: new Date().toISOString(),
      environment: 'Chromium 141 headless (SwiftShader), Linux container, local game server (25 s matches)',
      minutes: +((Date.now() - T0) / 60000).toFixed(1),
      cycles, matches, problems, pageErrors: errs.slice(0, 20), serverAtEnd: final,
      growth: { heapMB: +((last.heapMB as number) - (first.heapMB as number)).toFixed(1), geometries: (last.geometries as number) - (first.geometries as number), textures: (last.textures as number) - (first.textures as number), domNodes: (last.domNodes as number) - (first.domNodes as number) },
      samples,
    };
    // Regression guard: GPU buffers left behind per match (avatars) or per
    // mission (bank texture) used to grow without bound.
    if (cycles >= 3 && (report.growth.geometries > 20 || report.growth.textures > 3)) problems.push(`GPU resources grew: ${JSON.stringify(report.growth)}`);
    fs.writeFileSync(path.join(OUT, 'soak.json'), JSON.stringify(report, null, 2));
    if (problems.length || errs.length) process.exitCode = 1;
    console.log(JSON.stringify({ minutes: report.minutes, cycles, matches, problems, pageErrors: errs.length, growth: report.growth, server: final }, null, 1));
  } finally {
    await browser.close();
    for (const p of procs) p.kill('SIGTERM');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
