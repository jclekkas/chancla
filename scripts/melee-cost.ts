// Rendering cost of close combat, in exact renderer counts (draw calls and
// triangles for a whole frame: world plus first-person view), in offline
// practice with three Rosas in view. Compares, at each quality:
//   attached    every Rosa wears her four ruleros (2 instanced draws each)
//   removed     the ruleros taken off the scene entirely
//   flying      the attached case plus the pool's cap of 12 rollers in flight
// The swing animations change poses only, so they add no geometry.
//
//   GRAPHICS_EXPERIMENT=1 npm run build && node --import tsx scripts/melee-cost.ts
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Page } from 'playwright-core';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.PORT || 4188);
const SITE = `http://localhost:${PORT}/`;
const DIST = path.resolve(process.env.DIST || path.join(ROOT, 'dist'));
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'docs/melee'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

async function frameStats(p: Page): Promise<{ calls: number; tris: number }> {
  return p.evaluate(() => new Promise((res) => {
    const r = (window as any).__fps.engine().renderer;
    r.info.autoReset = false;
    requestAnimationFrame(() => { r.info.reset(); requestAnimationFrame(() => setTimeout(() => {
      const o = { calls: r.info.render.calls, tris: r.info.render.triangles };
      r.info.autoReset = true; res(o);
    }, 0)); });
  }));
}

async function measure(quality: string): Promise<Record<string, { calls: number; tris: number }>> {
  const browser = await launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
    const p = await ctx.newPage();
    await p.addInitScript({ content: `window.__name = (f) => f; localStorage.setItem('chancla.mp.settings.v1', JSON.stringify({ practiceMap: 'patio', practiceAllies: 1, practiceEnemies: 2, practiceDifficulty: 'easy', quality: '${quality}', qualityMode: '${quality}' }));` });
    await p.goto(SITE);
    await p.waitForFunction(() => (window as any).__fps?.screen === 'title');
    await p.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
    await p.evaluate(() => (document.getElementById('btn-practice-start') as HTMLElement).click());
    await p.waitForFunction(() => (window as any).__fps.session()?.alive, undefined, { timeout: 30000 });
    await sleep(3000);
    // Three Rosas in a row 3 m ahead, standing still; the view fixed on them.
    await p.evaluate(() => {
      const f = (window as any).__fps; const s = f.session(); const room = [...f.host().hub.rooms.values()][0];
      for (const m of room.members.values()) if (m.bot) m.brain = null;
      const me = room.sim.players.get(s.id);
      for (const b of [me.body, s.body]) { b.x = -3; b.z = 3.4; b.vx = b.vz = 0; }
      [...room.sim.players.values()].filter((q: any) => q.isBot).forEach((q: any, i: number) => { q.body.x = 0; q.body.z = 2.2 + i * 1.2; q.body.vx = q.body.vz = 0; q.yaw = Math.PI / 2; });
      const i = f.input(); i.yaw = -Math.PI / 2; i.pitch = -0.05;
    });
    await sleep(1500);
    const out: Record<string, { calls: number; tris: number }> = {};
    out.attached = await frameStats(p);
    await p.evaluate(() => { for (const a of (window as any).__fps.engine().avatars.values()) { a.rulMesh.visible = false; a.rulOutline.visible = false; } });
    out.removed = await frameStats(p);
    await p.evaluate(() => {
      const e = (window as any).__fps.engine();
      for (const a of e.avatars.values()) { a.rulMesh.visible = true; a.rulOutline.visible = true; }
      const THREE_V = e.camera.position.constructor;
      for (let k = 0; k < 12; k++) e.ruleros.spawn(k % 4, new THREE_V(0, 1.7, 2.2 + (k % 3) * 1.2), new THREE_V(-1, 0, 0), 0, { simple: false });
    });
    await sleep(120);
    out.flying = await frameStats(p);
    out.flyingActive = { calls: await p.evaluate(() => (window as any).__fps.engine().ruleros.active), tris: 0 };
    return out;
  } finally { await browser.close(); }
}

async function main(): Promise<void> {
  let preview: ChildProcess | null = null;
  if (!(await waitHttp(SITE, 500))) {
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST], { cwd: ROOT, stdio: 'ignore' });
    if (!(await waitHttp(SITE))) throw new Error('preview did not start');
  }
  const result: Record<string, unknown> = { note: 'Exact renderer counts per frame (world + first person), SwiftShader. Counts, not timings.' };
  try {
    for (const q of ['high', 'low']) { result[q] = await measure(q); console.log(q, JSON.stringify(result[q])); }
  } finally { preview?.kill(); }
  fs.writeFileSync(path.join(OUT, 'melee-cost.json'), JSON.stringify(result, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
