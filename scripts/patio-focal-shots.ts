// Stills of El Patio's focal objects (the fountain, the statue and the two
// kiosks) in the real game page: offline practice, bots parked out of view,
// the camera at player eye height (1.58 m) at fixed spots, the HUD and your
// own first-person hand hidden so the architecture is unobstructed. For each
// view it records the whole frame's draw calls and triangles, so the same
// views on two builds give the incremental cost. Works against any build
// (DIST), including the baseline.
//
//   GRAPHICS_EXPERIMENT=1 npm run build && DIST=dist OUT=<dir> node --import tsx scripts/patio-focal-shots.ts
//   QUALITIES=high,medium,low (default)   PHONE=1 adds a phone landscape view on Low
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Browser, Page } from 'playwright-core';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.PORT || 4184);
const SITE = `http://localhost:${PORT}/`;
const DIST = path.resolve(process.env.DIST || path.join(ROOT, 'dist'));
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'docs/patio-focal/shots'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Camera spots: [name, eye x, eye z, look x, look y, look z]. Clear of every box on El Patio. */
export const VIEWS: ReadonlyArray<readonly [string, number, number, number, number, number]> = [
  ['fountain-front-7m', 0, 7.2, 0, 1.4, 0],
  ['fountain-close-3m', 3.2, 4.0, 0, 0.9, 0],
  ['fountain-rim-2m', 3.9, 1.6, 1.2, 0.5, 0.2],
  ['statue-10m', 8.0, -6.2, 0, 2.9, 0],
  ['kiosk-periodicos-4m', -9.4, 7.2, -12.8, 1.4, 4.5],
  ['kiosk-periodicos-2m', -11.2, 6.9, -12.8, 1.5, 4.5],
  ['kiosk-elotes-5m', 8.6, -7.4, 12.8, 1.4, -4.5],
];

async function waitHttp(url: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

async function open(browser: Browser, quality: string, phone: boolean): Promise<Page> {
  const ctx = await browser.newContext(phone ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 960, height: 540 } });
  await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const p = await ctx.newPage();
  await p.addInitScript({ content: `window.__name = (f) => f; try { localStorage.setItem('chancla.mp.settings.v1', JSON.stringify({ practiceMap: 'patio', practiceAllies: 1, practiceEnemies: 1, practiceDifficulty: 'easy', quality: '${quality}', qualityMode: '${quality}', music: 0 })); } catch {}` });
  await p.goto(SITE);
  await p.addStyleTag({ content: '#hud, .ft-root, #fps-touch, #touch, .touch-ui { visibility: hidden !important; }' });
  await p.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { polling: 100 });
  await sleep(500);
  await p.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
  await p.evaluate(() => (document.getElementById('btn-practice-start') as HTMLElement).click());
  await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing' && (window as any).__fps.session()?.alive, undefined, { timeout: 40000, polling: 100 });
  await p.evaluate(() => {
    const f = (window as any).__fps; const i = f.input(); i.fallback = true;
    const room = [...f.host().hub.rooms.values()][0];
    for (const m of room.members.values()) if (m.bot) m.brain = null;
    f.engine().vm.root.scale.setScalar(1e-4);
  });
  await sleep(2500);
  return p;
}

async function view(p: Page, v: (typeof VIEWS)[number]): Promise<{ calls: number; tris: number }> {
  return p.evaluate(async ([, ex, ez, lx, ly, lz]) => {
    const f = (window as any).__fps, s = f.session(), room = [...f.host().hub.rooms.values()][0];
    const me = room.sim.players.get(s.id);
    let k = 0;
    for (const q of room.sim.players.values()) if (q !== me) { q.body.x = 24 + k++; q.body.z = 17; q.body.vx = q.body.vz = 0; }
    for (const b of [me.body, s.body]) { b.x = ex; b.z = ez; b.y = 0; b.vx = b.vy = b.vz = 0; }
    const i = f.input(), dx = lx - ex, dz = lz - ez;
    i.yaw = Math.atan2(-dx, -dz); i.pitch = Math.atan2(ly - 1.58, Math.hypot(dx, dz));
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await wait(700);
    const r = f.engine().renderer;
    r.info.autoReset = false;
    await new Promise((res) => requestAnimationFrame(() => { r.info.reset(); requestAnimationFrame(() => setTimeout(res, 0)); }));
    const out = { calls: r.info.render.calls, tris: r.info.render.triangles };
    r.info.autoReset = true;
    return out;
  }, v);
}

async function main(): Promise<void> {
  let preview: ChildProcess | null = null;
  if (!(await waitHttp(SITE, 500))) {
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST], { cwd: ROOT, stdio: 'ignore' });
    if (!(await waitHttp(SITE))) throw new Error('preview did not start');
  }
  const browser = await launch();
  const costs: Record<string, { calls: number; tris: number }> = {};
  try {
    for (const q of (process.env.QUALITIES || 'high,medium,low').split(',')) {
      const p = await open(browser, q, false);
      for (const v of VIEWS) {
        costs[`${v[0]}-${q}`] = await view(p, v);
        await p.screenshot({ path: path.join(OUT, `${v[0]}-${q}.png`), timeout: 120000 });
      }
      await p.context().close();
    }
    if (process.env.PHONE) {
      const p = await open(browser, 'low', true);
      for (const v of [VIEWS[0]!, VIEWS[4]!]) {
        costs[`${v[0]}-phone-low`] = await view(p, v);
        await p.screenshot({ path: path.join(OUT, `${v[0]}-phone-low.png`), timeout: 120000 });
      }
      await p.context().close();
    }
  } finally {
    await browser.close();
    preview?.kill();
  }
  fs.writeFileSync(path.join(OUT, 'costs.json'), JSON.stringify(costs, null, 1));
  console.log(JSON.stringify(costs));
}
main().catch((e) => { console.error(e); process.exit(1); });
