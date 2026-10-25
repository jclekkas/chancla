// The Rosa candidate in the real game page (practice in El Patio, bots
// frozen): per-character cost of Sol as the candidate and as the current
// model at each quality tier (her avatar rendered alone, the same method as
// rosa-shots.ts cost.json), each tier's GLB download and load time, and
// resource stability while the candidate is switched on and off and the
// quality changes several times (renderer.info memory and programs, the
// scene's object count, the same state compared before and after).
//
//   GRAPHICS_EXPERIMENT=1 npx vite build --outDir /home/user/dist-wrig .
//   DIST=/home/user/dist-wrig OUT=<dir> PORT=4533 node --import tsx scripts/rosa-candidate-soak.ts
// ROUNDS=3 sets the number of toggle rounds.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Page } from 'playwright-core';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.PORT || 4533);
const SITE = `http://localhost:${PORT}/`;
const DIST = path.resolve(process.env.DIST || path.join(ROOT, 'dist'));
const OUT = path.resolve(process.env.OUT || path.join(ROOT, '..', 'rosa-candidate-soak'));
const ROUNDS = Number(process.env.ROUNDS || 3);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

/** Applies settings the way the Settings screen does (the store's value, then engine.applySettings), and waits for the rebuild. */
async function apply(p: Page, patch: Record<string, unknown>): Promise<number> {
  return p.evaluate(async (patch) => {
    const e = (window as any).__fps.engine();
    const w = window as any;
    w.__over = { ...(w.__over ?? {}), ...patch };
    if (!w.__wrapped) { const orig = e.settings; e.settings = () => ({ ...orig(), ...w.__over }); w.__wrapped = true; }
    const t0 = performance.now();
    e.applySettings();
    // A tier that is not loaded yet rebuilds when it arrives.
    const want = (w.__over.rosaCandidate as boolean | undefined) ?? false;
    const end = performance.now() + 20000;
    while (performance.now() < end) {
      const st = e.rosaCandidateState();
      if (!want || st.ready) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    return Math.round(performance.now() - t0);
  }, patch);
}

/** Lets the match draw (avatars come back on the next frames). */
async function frames(p: Page, ms = 700): Promise<void> { await sleep(ms); }

async function solCost(p: Page): Promise<unknown> {
  return p.evaluate(() => {
    const f = (window as any).__fps; const e = f.engine(); const r = e.renderer; const s = f.session();
    const m = s.room.members as Array<{ id: number; team: number }>;
    const entry = [...e.avatars.entries()].find(([id]: [number, any]) => m.find((x) => x.id === id)?.team === 0);
    if (!entry) return null;
    const av = entry[1] as any;
    const parent = av.root.parent; const pos = av.root.position.clone(); const rot = av.root.rotation.y;
    const sc = new e.scene.constructor();
    sc.add(av.root); av.root.position.set(0, 0, 0); av.root.rotation.y = Math.PI;
    const bubble = av.model.bubble.visible; av.model.bubble.visible = false;
    const cam = e.camera.clone(); cam.position.set(0, 1.2, 3); cam.lookAt(0, 0.9, 0); cam.updateMatrixWorld();
    av.root.updateMatrixWorld(true);
    let casters = 0, meshes = 0;
    av.root.traverseVisible((o: any) => { if (o.isMesh) { meshes++; if (o.castShadow) casters++; } });
    const autoClear = r.autoClear; r.autoClear = true;
    r.render(sc, cam);
    const out = { candidate: !!av.isCandidate, quality: av.quality, draws: r.info.render.calls, triangles: r.info.render.triangles, visibleMeshes: meshes, shadowCasters: casters };
    r.autoClear = autoClear;
    av.model.bubble.visible = bubble;
    parent.add(av.root); av.root.position.copy(pos); av.root.rotation.y = rot;
    return out;
  });
}

async function snapshot(p: Page, label: string): Promise<Record<string, unknown>> {
  return p.evaluate((label) => {
    const e = (window as any).__fps.engine(); const r = e.renderer;
    let objects = 0, skinned = 0; e.scene.traverse((o: any) => { objects++; if (o.isSkinnedMesh) skinned++; });
    return { label, quality: e.quality, candidate: e.rosaCandidateState(), geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length, objects, skinned, avatars: e.avatars.size };
  }, label);
}

async function main(): Promise<void> {
  let preview: ChildProcess | null = null;
  if (!(await waitHttp(SITE, 500))) {
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST], { cwd: ROOT, stdio: 'ignore' });
    if (!(await waitHttp(SITE))) throw new Error('preview did not start');
  }
  const browser = await launch();
  const report: Record<string, unknown> = { dist: DIST };
  try {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
    await ctx.route('**/*', (r: any) => { const u = r.request().url(); return u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
    const p: Page = await ctx.newPage();
    p.on('pageerror', (err) => console.error('pageerror', err.message));
    await p.addInitScript({ content: `window.__name = (f) => f; localStorage.setItem('chancla.mp.settings.v1', JSON.stringify({ practiceMap: 'patio', practiceAllies: 1, practiceEnemies: 1, practiceDifficulty: 'easy', quality: 'high', qualityMode: 'high', fov: 70, music: 0, rosaCandidate: false }));` });
    await p.goto(SITE);
    await p.waitForFunction(() => (window as any).__fps?.screen === 'title');
    await p.click('#btn-practice'); await p.click('#btn-practice-start');
    await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing' && (window as any).__fps.session()?.remotes.size >= 2, undefined, { timeout: 30000 });
    await p.click('#btn-click-play', { force: true }).catch(() => p.click('#stage', { force: true }));
    await p.evaluate(() => { const f = (window as any).__fps; const room = [...f.host().hub.rooms.values()][0] as any; for (const m of room.members.values()) if (m.bot) m.brain = null; });
    await frames(p, 1500);

    // Cost and load per tier (each tier loaded cold, the first time it is switched on).
    const cost: Record<string, unknown> = {};
    const load: Record<string, unknown> = {};
    for (const q of ['high', 'medium', 'low']) {
      await apply(p, { quality: q, rosaCandidate: false });
      await frames(p);
      const current = await solCost(p);
      const ms = await apply(p, { rosaCandidate: true });
      await frames(p);
      const candidate = await solCost(p);
      cost[q] = { current, candidate };
      load[q] = { switchOnMs: ms, ...(await p.evaluate((q) => {
        const e = performance.getEntriesByType('resource').filter((x) => x.name.includes(`rosa-sol-${q}.glb`)).pop() as PerformanceResourceTiming | undefined;
        return e ? { fetchMs: Math.round(e.duration), bytes: e.decodedBodySize } : {};
      }, q)) };
      console.log(q, JSON.stringify(cost[q]), JSON.stringify(load[q]));
    }
    report.cost = cost;
    report.load = load;
    report.loaderChunk = await p.evaluate(() => (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter((x) => /GLTFLoader/.test(x.name)).map((x) => ({ name: x.name.split('/').pop(), bytes: x.decodedBodySize, ms: Math.round(x.duration) })));

    // Stability: the same states visited again and again.
    const steps: Array<Record<string, unknown>> = [];
    const seq: Array<[string, Record<string, unknown>]> = [
      ['high off', { quality: 'high', rosaCandidate: false }], ['high on', { rosaCandidate: true }], ['medium on', { quality: 'medium' }],
      ['medium off', { rosaCandidate: false }], ['low off', { quality: 'low' }], ['low on', { rosaCandidate: true }], ['high on', { quality: 'high' }],
    ];
    for (let round = 0; round < ROUNDS; round++) {
      for (const [label, patch] of seq) {
        await apply(p, patch);
        await frames(p);
        steps.push({ round, ...(await snapshot(p, label)) });
      }
    }
    report.steps = steps;
    const at = (round: number, label: string) => steps.find((s) => s.round === round && s.label === label);
    report.stable = ['high off', 'high on', 'medium on', 'medium off', 'low off', 'low on'].map((l) => {
      const a = at(1, l) as any, b = at(ROUNDS - 1, l) as any;
      return { state: l, round1: a && { geometries: a.geometries, textures: a.textures, programs: a.programs, objects: a.objects }, last: b && { geometries: b.geometries, textures: b.textures, programs: b.programs, objects: b.objects } };
    });
    console.log(JSON.stringify(report.stable));
    await p.screenshot({ path: path.join(OUT, 'soak-end.png') });
    await ctx.close();
  } finally {
    await browser.close();
    preview?.kill();
  }
  fs.writeFileSync(path.join(OUT, 'soak.json'), JSON.stringify(report, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
