// Frame strips for reviewing the combat effects: offline practice on El
// Patio, the real game page, the real avatars and effect code, on a fake
// clock so every frame lands at an exact time after its trigger. Two Rosas
// are posed by patching the session's remotes (nothing is simulated) and the
// effects are fired straight into engine.fx / engine.proj / engine.ruleros
// at fixed places and times. The view is always at eye height (1.58 m).
// Writes, per quality, <scene>-<dist>.png strips (frames labelled with ms
// after the trigger) and a cost.json with the renderer's draw calls before
// and during the overlapping worst case; then contact sheets (PIL).
//
//   GRAPHICS_EXPERIMENT=1 node node_modules/vite/bin/vite.js build --outDir dist-c
//   DIST=dist-c PORT=4431 OUT=<dir> QUALITIES=high,medium,low node --import tsx scripts/combat-fx-shots.ts
//   (SCENES=a,b to pick scenes; REDUCED=1 for reduced motion)
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import type { Page } from 'playwright-core';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';
import { MELEE } from '../shared/config';
import { EL_PATIO } from '../shared/map';
import { sweepWorld, type WorldHit } from '../shared/collision';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.PORT || 4431);
const SITE = `http://localhost:${PORT}/`;
const DIST = path.resolve(ROOT, process.env.DIST || 'dist-c');
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'artifacts/combat-fx'));
const QUALITIES = (process.env.QUALITIES || 'high,medium,low').split(',');
const ONLY = process.env.SCENES ? process.env.SCENES.split(',') : null;
const REDUCED = process.env.REDUCED === '1';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

// The view: you at ME looking along +x; the victim D m ahead facing you; the
// attacker beside her on your right, facing her, so her blow crosses the view.
const ME: [number, number] = [-4, 3.4];
type Rosa = { x: number; z: number; yaw: number; weapon?: 0 | 1; swing?: boolean; protected?: boolean; ruleros?: number };
type Scene = { me: [number, number]; look: [number, number, number]; rosas: Rosa[] };
const FAR: Rosa = { x: 40, z: 40, yaw: 0 };

// A house front for the wall impacts: the first box hit from ME at 1.3 m
// along a bearing where one stands 4 to 6 m away.
const WALL = (() => {
  const hit = { t: 0, nx: 0, ny: 0, nz: 0, box: null, ground: false } as WorldHit;
  for (let a = 0; a < 360; a += 5) {
    const r = (a * Math.PI) / 180, dx = Math.cos(r), dz = Math.sin(r);
    if (sweepWorld({ x: ME[0], y: 1.3, z: ME[1] }, { x: ME[0] + dx * 25, y: 1.3, z: ME[1] + dz * 25 }, 0.01, EL_PATIO.boxes, hit) && hit.t * 25 > 4 && hit.t * 25 < 6 && Math.abs(hit.nx * dx + hit.nz * dz) > 0.9) {
      return { x: ME[0] + dx * hit.t * 25, z: ME[1] + dz * hit.t * 25, dx, dz };
    }
  }
  throw new Error('no wall found');
})();

function melee(D: number): { scene: Scene; vx: number; vz: number; ax: number; az: number } {
  const vx = ME[0] + D, vz = ME[1];
  const ax = vx, az = vz + 1.25;
  return { scene: { me: ME, look: [vx, 1.3, vz + 0.3], rosas: [{ x: ax, z: az, yaw: 0 }, { x: vx, z: vz, yaw: Math.PI / 2 }] }, vx, vz, ax, az };
}
// The engine's blowDirection() for an attacker with this yaw.
function blowDir(yaw: number, w: 0 | 1): { x: number; z: number } {
  const rx = Math.cos(yaw), rz = -Math.sin(yaw), fx = -Math.sin(yaw), fz = -Math.cos(yaw), side = w === 1 ? 1 : -1;
  const x = rx * side + fx * 0.45, z = rz * side + fz * 0.45, l = Math.hypot(x, z);
  return { x: x / l, z: z / l };
}

async function stage(p: Page, sc: Scene): Promise<void> {
  await p.evaluate((sc) => {
    const f = (window as any).__fps; const s = f.session(); const e = f.engine();
    const st = (window as any).__fx ??= {};
    st.sc = sc;
    if (!st.patched) {
      st.patched = true;
      st.ids = [...s.remotes.keys()];
      s.updateRemotes = () => {
        const P = (window as any).__fx;
        const base = { y: 0, pitch: 0, vx: 0, vz: 0, alive: true, crouched: false, onGround: true, connected: true, hp: 100, msSinceThrow: 1e6, msSinceHit: 1e6 };
        P.sc.rosas.forEach((r: any, k: number) => {
          const id = P.ids[k]; if (id === undefined) return;
          s.remotes.set(id, { ...base, id, x: r.x, z: r.z, yaw: r.yaw, weapon: r.weapon ?? 0, protected: !!r.protected, ruleros: r.ruleros ?? 15, msSinceMelee: r.swingAt !== undefined ? performance.now() - r.swingAt : 1e6 });
        });
        for (const b of [s.body]) { b.x = P.sc.me[0]; b.z = P.sc.me[1]; b.y = 0; b.vx = b.vz = b.vy = 0; }
        const dx = P.sc.look[0] - P.sc.me[0], dz = P.sc.look[2] - P.sc.me[1], dy = P.sc.look[1] - 1.58;
        f.input().yaw = Math.atan2(-dx, -dz); f.input().pitch = Math.atan2(dy, Math.hypot(dx, dz));
        s.meleeMs = 0; e.lastLocalMelee = -1e9;
        e.vm.root.scale.setScalar(1e-4); // no held item: the effects are what is reviewed
      };
      // Scripted projectiles: positions from the fake clock.
      const upd = s.updateProjectiles.bind(s);
      s.updateProjectiles = (dt: number) => {
        const P = (window as any).__fx;
        if (!P.proj) return upd(dt);
        s.projectiles.clear();
        const now = performance.now();
        for (const q of P.proj) {
          const u = (now - q.t0) / q.ms;
          if (u < 0 || u >= 1) continue;
          const x = q.a[0] + (q.b[0] - q.a[0]) * u, z = q.a[2] + (q.b[2] - q.a[2]) * u;
          const y = q.a[1] + (q.b[1] - q.a[1]) * u + Math.sin(Math.PI * u) * q.arc;
          s.projectiles.set(q.key, { id: q.key, weapon: q.w, owner: 0, predicted: true, startAt: 0, endAt: 0, endPos: null, done: false, trail: [],
            pr: { id: 0, owner: 0, team: 0, weapon: q.w, x, y, z, vx: 0, vy: 0, vz: 0, ageMs: 0, traveled: 0, bounces: 0, fireSeq: 0 } });
        }
      };
    }
    st.proj = null;
    e.fx.clear(); e.proj.clear(); e.ruleros.clear();
  }, sc);
}

// Everything at once around a victim at (vx, vz) with a second Rosa at her side.
const BURST = ({ vx, vz }: { vx: number; vz: number }): void => {
  const e = (window as any).__fps.engine(); const V = e.camera.position.constructor;
  for (let i = 0; i < 6; i++) e.fx.meleeHit(i % 2, { x: vx, y: i % 3 ? 1.1 : 1.5, z: vz + 0.2 - i * 0.12 }, { x: -0.9, z: -0.4 }, i % 3 === 0);
  e.fx.meleeWhiff(0, { x: vx + 0.2, y: 0, z: vz - 1.1 }, Math.PI);
  e.fx.meleeWhiff(1, { x: vx + 0.2, y: 0, z: vz - 1.1 }, Math.PI);
  e.fx.shielded({ x: vx + 0.2, y: 1.2, z: vz - 1.1 });
  for (let i = 0; i < 6; i++) e.proj.impact(i % 2, [vx - 0.2 + (i % 3) * 0.3, i < 3 ? 0.02 : 1.3, vz - 0.8 + i * 0.35], i % 2 === 0);
  for (let k = 0; k < 12; k++) e.ruleros.spawn(k % 4, new V(vx, 1.7, vz + (k % 3) * 0.2), new V(-1, 0, ((k % 5) - 2) * 0.3), 0, { simple: false });
};

const STEP = 1000 / 60;
// Headless Chromium only paints (and so only runs rAF) when asked, so each
// step moves the fake clock and then runs exactly one engine frame at that
// time: deterministic frames whatever SwiftShader's speed.
async function step(p: Page, ms = STEP): Promise<number> {
  await p.clock.runFor(Math.max(1, Math.round(ms)));
  return p.evaluate(() => { const e = (window as any).__fps.engine(); e.frame(performance.now()); return performance.now(); });
}
// Runs frames until the fake clock is `ms` further on (runFor's own steps are not exact).
async function advance(p: Page, ms: number): Promise<void> {
  const end = (await p.evaluate(() => performance.now())) + ms;
  let now = end - ms;
  while (end - now > 0.5) now = await step(p, Math.min(STEP, end - now));
}

type Frame = { file: string; label: string };
async function strip(p: Page, name: string, times: number[]): Promise<Frame[]> {
  const out: Frame[] = [];
  let t = 0;
  for (const at of times) {
    await advance(p, at - t);
    t = at;
    const file = path.join(OUT, '_frames', `${name}-${at}.png`);
    await p.screenshot({ path: file });
    out.push({ file, label: `${at} ms` });
  }
  return out;
}

async function cost(p: Page): Promise<{ calls: number; tris: number; fx: unknown }> {
  // One whole engine frame (shadow pass, world, held item), counted from the renderer.
  await p.evaluate(() => { const r = (window as any).__fps.engine().renderer; r.info.autoReset = false; r.info.reset(); });
  await step(p);
  return p.evaluate(() => {
    const e = (window as any).__fps.engine(); const r = e.renderer;
    const o = { calls: r.info.render.calls, tris: r.info.render.triangles, fx: { fx: e.fx.stats?.(), proj: e.proj.stats?.(), ruleros: e.ruleros.stats?.() ?? { active: e.ruleros.active } } };
    r.info.autoReset = true;
    return o;
  });
}

async function run(quality: string): Promise<void> {
  const qdir = path.join(OUT, quality + (REDUCED ? '-reduced' : ''));
  fs.mkdirSync(path.join(OUT, '_frames'), { recursive: true });
  fs.mkdirSync(qdir, { recursive: true });
  const browser = await launch();
  const sheets: Record<string, Frame[]> = {};
  try {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
    await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
    const p = await ctx.newPage();
    await p.addInitScript({ content: `window.__name = (f) => f; try { localStorage.setItem('chancla.mp.settings.v1', JSON.stringify({ practiceMap: 'patio', practiceAllies: 1, practiceEnemies: 1, practiceDifficulty: 'easy', quality: '${quality}', qualityMode: '${quality}', music: 0, sfx: 0, reducedMotion: ${REDUCED}, fov: 70 })); } catch {}` });
    await p.goto(SITE);
    await p.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { polling: 100 });
    await p.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
    await p.evaluate(() => (document.getElementById('btn-practice-start') as HTMLElement).click());
    await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing' && (window as any).__fps.session()?.remotes.size >= 2, undefined, { timeout: 30000, polling: 100 });
    if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true }); else await p.click('#stage', { force: true });
    await p.evaluate(() => { const f = (window as any).__fps; const room = [...f.host().hub.rooms.values()][0]; for (const m of room.members.values()) if (m.bot) m.brain = null; document.getElementById('hud')!.style.opacity = '0'; });
    await sleep(2500);
    // The fake clock (see melee-footage.ts for why the host's timer is remade).
    await p.evaluate(() => { const h = (window as any).__fps.host(); (window as any).__h0 = h.now(); h.pause(); });
    await p.clock.install();
    await p.clock.pauseAt((await p.evaluate(() => Date.now())) + 200);
    // The faked rAF hands its callback the real time, so the engine's dt was
    // however long SwiftShader took (up to its 0.1 s cap); give it the fake
    // clock's time instead, so frames land exactly at the labelled ms.
    await p.evaluate(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb: FrameRequestCallback) => raf(() => cb(performance.now()));
      (window as any).__fps.engine().last = performance.now();
    });
    await p.evaluate(() => {
      const h = (window as any).__fps.host();
      h.pausedAt = -1;
      h.pausedTotal = performance.now() - (window as any).__h0;
      for (const room of h.hub.rooms.values()) { room.lastUpdate = h.now(); room.acc = 0; }
      h.timer = setInterval(() => { if (h.pausedAt < 0) h.hub.update(); }, 1000 / 60);
    });
    await advance(p, 400);
    const clk = () => p.evaluate(() => [(window as any).__fps.engine().time * 1000, performance.now(), (window as any).__fps.engine().last]);
    await advance(p, 300);
    const c0 = await clk();
    await advance(p, 500);
    const c1 = await clk();
    console.log(quality, `clock check: 500 ms advanced the clock ${Math.round(c1[1]! - c0[1]!)} ms, the engine ${Math.round(c1[0]! - c0[0]!)} ms`, c0, c1);
    const want = (n: string) => !ONLY || ONLY.some((o) => n.startsWith(o));
    const T = [17, 50, 100, 150, 200, 270, 350, 500];

    // Melee hits: the attacker swings, contact fires at the end of her wind-up.
    for (const D of [2, 5]) {
      for (const [name, w, head] of [['chanclazo-body', 0, false], ['chanclazo-head', 0, true], ['reves-body', 1, false], ['reves-head', 1, true]] as const) {
        if (!want(name)) continue;
        const m = melee(D);
        await stage(p, m.scene);
        await advance(p, 300);
        const dir = blowDir(0, w);
        await p.evaluate(({ w }) => { const P = (window as any).__fx; P.sc.rosas[0].weapon = w; P.sc.rosas[0].swingAt = performance.now(); }, { w });
        await advance(p, MELEE[w]!.windupMs);
        await p.evaluate(({ w, head, vx, vz, dir }) => {
          const f = (window as any).__fps; const e = f.engine(); const P = (window as any).__fx;
          const pt = { x: vx, y: head ? 1.5 : 1.05, z: vz + 0.22 };
          e.fx.meleeHit(w, pt, dir, head);
          const av = e.avatars.get(P.ids[1]);
          av?.react(head, -1);
          if (w === 1 && head) { e.popRuleros(P.ids[1], [1], dir, false); P.sc.rosas[1].ruleros = 15 & ~2; }
        }, { w, head, vx: m.vx, vz: m.vz, dir });
        sheets[`${name}-${D}m`] = await strip(p, `${quality}-${name}-${D}`, T);
      }
      // Misses: the attacker alone, seen from her front-left so the sweep crosses the view.
      for (const [name, w] of [['whiff-chanclazo', 0], ['whiff-reves', 1]] as const) {
        if (!want(name)) continue;
        const ax = ME[0] + D, az = ME[1] + 0.6 * D;
        // She faces your right-front: yaw such that her forward is toward -z rotated a bit to you.
        const yaw = Math.atan2(-(ME[0] - ax), -(ME[1] - az)) + 0.9;
        await stage(p, { me: ME, look: [ax, 1.35, az], rosas: [{ x: ax, z: az, yaw }, FAR] });
        await advance(p, 300);
        await p.evaluate(({ w }) => { const P = (window as any).__fx; P.sc.rosas[0].weapon = w; P.sc.rosas[0].swingAt = performance.now(); }, { w });
        await advance(p, MELEE[w]!.windupMs + MELEE[w]!.activeMs);
        await p.evaluate(({ w, ax, az, yaw }) => { const e = (window as any).__fps.engine(); const P = (window as any).__fx; e.fx.meleeWhiff(w, { x: ax, y: 0, z: az }, yaw); e.avatars.get(P.ids[0])?.whiff(w); }, { w, ax, az, yaw });
        sheets[`${name}-${D}m`] = await strip(p, `${quality}-${name}-${D}`, T);
      }
      if (want('shielded')) {
        const m = melee(D);
        m.scene.rosas[1]!.protected = true;
        await stage(p, m.scene);
        await advance(p, 300);
        await p.evaluate(() => { const P = (window as any).__fx; P.sc.rosas[0].weapon = 0; P.sc.rosas[0].swingAt = performance.now(); });
        await advance(p, MELEE[0]!.windupMs);
        await p.evaluate(({ vx, vz }) => { (window as any).__fps.engine().fx.shielded({ x: vx, y: 1.2, z: vz }); }, { vx: m.vx, vz: m.vz });
        sheets[`shielded-${D}m`] = await strip(p, `${quality}-shielded-${D}`, T);
      }
    }

    // A thrown chancla across the view, then its impacts: wall, paving, player.
    for (const D of [2, 5]) {
      if (want('throw')) {
        const vx = ME[0] + D;
        await stage(p, { me: ME, look: [vx + 2, 1.4, ME[1]], rosas: [FAR, FAR] });
        await advance(p, 200);
        await p.evaluate(({ vx, z }) => {
          const P = (window as any).__fx;
          P.proj = [
            { key: 'c1', w: 0, a: [vx - 0.5, 1.5, z + 4], b: [vx + 1.5, 1.2, z - 6], arc: 0.5, ms: 700, t0: performance.now() },
            { key: 'p1', w: 1, a: [vx + 3, 1.3, z - 5], b: [vx + 1, 1.6, z + 6], arc: 0.6, ms: 900, t0: performance.now() + 100 },
          ];
        }, { vx, z: ME[1] });
        sheets[`throw-${D}m`] = await strip(p, `${quality}-throw-${D}`, [100, 200, 300, 400, 500, 600, 700, 800]);
      }
      for (const kind of ['impact-wall', 'impact-paving', 'impact-player'] as const) {
        if (!want(kind)) continue;
        // Wall: the house front WALL.d m ahead of you, seen from D m; paving:
        // the ground D m ahead; player: the victim D m ahead.
        const vx = ME[0] + D;
        const rosas: Rosa[] = kind === 'impact-player' ? [FAR, { x: vx, z: ME[1], yaw: Math.PI / 2 }] : [FAR, FAR];
        const me: [number, number] = kind === 'impact-wall' ? [WALL.x - WALL.dx * D, WALL.z - WALL.dz * D] : ME;
        const look: [number, number, number] = kind === 'impact-wall' ? [WALL.x, 1.3, WALL.z] : kind === 'impact-paving' ? [vx, 0.3, ME[1]] : [vx, 1.3, ME[1]];
        await stage(p, { me, look, rosas });
        await advance(p, 200);
        const side = { x: -WALL.dz, z: WALL.dx }; // along the wall
        const pts: Array<[number, number, number]> = kind === 'impact-player' ? [[vx - 0.25, 1.45, ME[1] - 0.15], [vx - 0.25, 1.1, ME[1] + 0.2]]
          : kind === 'impact-paving' ? [[vx, 0.02, ME[1] - 0.45], [vx, 0.02, ME[1] + 0.5]]
          : [[WALL.x - WALL.dx * 0.04 - side.x * 0.45, 1.5, WALL.z - WALL.dz * 0.04 - side.z * 0.45], [WALL.x - WALL.dx * 0.04 + side.x * 0.5, 1.1, WALL.z - WALL.dz * 0.04 + side.z * 0.5]];
        await p.evaluate(({ pts, player }) => {
          const e = (window as any).__fps.engine();
          e.proj.impact(0, pts[0], player);
          e.proj.impact(1, pts[1], player);
        }, { pts, player: kind === 'impact-player' });
        sheets[`${kind}-${D}m`] = await strip(p, `${quality}-${kind}-${D}`, [17, 50, 100, 170, 250, 330, 420, 520]);
      }
    }

    // The overlapping worst case at 3 m: two victims, six hits, two misses,
    // a shielded blow, six impacts and twelve rollers, all at once.
    let worst: unknown = null;
    if (want('worst')) {
      const m = melee(3);
      m.scene.rosas[0] = { x: m.vx + 0.2, z: m.vz - 1.1, yaw: Math.PI };
      await stage(p, m.scene);
      await advance(p, 300);
      const before = await cost(p);
      await p.evaluate(BURST, { vx: m.vx, vz: m.vz });
      // Six more in the air at the same time (their trails are the effects' share).
      await p.evaluate(({ vx, vz }) => {
        (window as any).__fx.proj = [0, 1, 2, 3, 4, 5].map((i) => ({ key: 'w' + i, w: i % 2, a: [vx - 2, 1.2 + i * 0.1, vz + 4], b: [vx + 1, 1.4, vz - 4 + i * 0.3], arc: 0.4, ms: 900, t0: performance.now() - 200 }));
      }, { vx: m.vx, vz: m.vz });
      await advance(p, 50);
      const during = await cost(p);
      // The same frame with this pass's groups hidden: the effects' own share.
      await p.evaluate(() => { const e = (window as any).__fps.engine(); for (const g of [e.fx.group, e.proj.group, e.ruleros.group]) g.visible = false; });
      const hidden = await cost(p);
      await p.evaluate(() => { const e = (window as any).__fps.engine(); for (const g of [e.fx.group, e.proj.group, e.ruleros.group]) g.visible = true; });
      // Effects only (stats): CombatFx, impacts, trails and particles, rollers and accents.
      const st = during.fx as any;
      const effectCalls = st.fx.drawCalls + st.proj.drawCalls + (st.ruleros.drawCalls ?? 0);
      worst = { before, during, hidden, extraCalls: during.calls - before.calls, ownCalls: during.calls - hidden.calls, ownTris: during.tris - hidden.tris, effectCalls };
      await p.evaluate(() => { (window as any).__fx.proj = null; });
      await stage(p, m.scene);
      await advance(p, 200);
      await p.evaluate(BURST, { vx: m.vx, vz: m.vz });
      sheets['worst-3m'] = await strip(p, `${quality}-worst-3`, [17, 50, 100, 200, 300, 450, 700, 1000, 1700]);
      fs.writeFileSync(path.join(qdir, 'cost.json'), JSON.stringify(worst, null, 1));
      console.log(quality, 'worst case', JSON.stringify(worst));
    }
    await ctx.close();
  } finally {
    await browser.close();
  }
  // Contact sheets: one strip per scene, frames labelled.
  const spec = path.join(qdir, 'sheets.json');
  fs.writeFileSync(spec, JSON.stringify({ title: `${quality}${REDUCED ? ' reduced motion' : ''}`, out: qdir, sheets }));
  const py = spawnSync('python3', ['-I', '-c', SHEET_PY, spec], { stdio: 'inherit' });
  if (py.status !== 0) throw new Error('contact sheets failed');
}

const SHEET_PY = `
import json, sys, os
from PIL import Image, ImageDraw
spec = json.load(open(sys.argv[1]))
W, H = 320, 200
for name, frames in spec['sheets'].items():
    sheet = Image.new('RGB', (W * len(frames), H + 18), (24, 22, 38))
    d = ImageDraw.Draw(sheet)
    for i, f in enumerate(frames):
        im = Image.open(f['file']).convert('RGB').resize((W, H), Image.LANCZOS)
        sheet.paste(im, (i * W, 18))
        d.text((i * W + 4, 3), f['label'], fill=(255, 240, 210))
    d.text((W * len(frames) - 200, 3), spec['title'] + ' ' + name, fill=(255, 200, 120))
    sheet.save(os.path.join(spec['out'], name + '.png'))
    # Close-ups: the middle of the first four frames at full resolution.
    crop = Image.new('RGB', (4 * 320, 220), (24, 22, 38))
    d2 = ImageDraw.Draw(crop)
    for i, f in enumerate(frames[:4]):
        im = Image.open(f['file']).convert('RGB')
        w, h = im.size
        crop.paste(im.crop((w // 2 - 160, h // 2 - 100, w // 2 + 160, h // 2 + 100)), (i * 320, 20))
        d2.text((i * 320 + 4, 4), f['label'], fill=(255, 240, 210))
    crop.save(os.path.join(spec['out'], name + '-crop.png'))
`;

async function main(): Promise<void> {
  let preview: ChildProcess | null = null;
  if (!(await waitHttp(SITE, 500))) {
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST], { cwd: ROOT, stdio: 'ignore' });
    if (!(await waitHttp(SITE))) throw new Error('preview did not start');
  }
  try {
    for (const q of QUALITIES) await run(q);
  } finally {
    preview?.kill();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
