// Stills of the third-person Rosa for reviewing her model: the real game
// page (practice in El Patio, bots frozen), two remote Rosas (one per team)
// placed and posed through the session, the camera at player eye height.
// Works against any build that has window.__fps (including the pre-milestone
// model), so before and after can be compared shot for shot. Writes, per
// quality (high, medium, low):
//   <q>-<dist>-<view>.png  both teams side by side, 1.5 / 4 / 8 m, front,
//                          three-quarter, side and back
//   <q>-door-<team>.png    one of each team against the café door
//   <q>-shade.png, <q>-sun.png   in a building's shade, on bright paving
//   <q>-grip-*.png         close-up of the right hand holding each weapon
//   <q>-home.png           the campaign home look with six curlers
//   sheet-<q>.jpg          contact sheet of all of the above
//   cost.json              per-Rosa cost (main-pass draws, shadow casters,
//                          triangles) and a create/dispose leak check
//
//   GRAPHICS_EXPERIMENT=1 node node_modules/vite/bin/vite.js build --outDir dist-a
//   DIST=dist-a OUT=<dir> PORT=4411 node --import tsx scripts/rosa-shots.ts
// QUALITIES=high,low limits the tiers; SHOTS=door,grip limits the shots.
// LIGHTS=sun,shade,dusk instead films only the side-by-side line-ups (DISTS,
// views) once per lighting: sun (El Patio's open paving, as above), shade (El
// Patio in the marigold house's cast shadow) and dusk (La Fiesta's dance
// floor), named <q>-<light>-<dist>-<view>.png. All staging is done here
// (map choice, positions), so it works on any build with window.__fps.
// Every shot pins the Rosas' idle (no blink, the breath at one phase, a
// fixed step) and the world's clock, so before and after match pose for pose.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import type { Page } from 'playwright-core';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.PORT || 4411);
const SITE = `http://localhost:${PORT}/`;
const DIST = path.resolve(process.env.DIST || path.join(ROOT, 'dist'));
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'docs/rosa/shots'));
const QUALITIES = (process.env.QUALITIES || 'high,medium,low').split(',');
const ONLY = process.env.SHOTS ? new Set(process.env.SHOTS.split(',')) : null;
const LIGHTS = process.env.LIGHTS ? process.env.LIGHTS.split(',') : null;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

interface Pose { x: number; z: number; yaw: number; weapon?: 0 | 1 }
interface Shot { name: string; label: string; sol: Pose; luna: Pose; eye: [number, number]; look: [number, number, number]; fov?: number }

// Side by side on open paving, facing the camera (Rosa faces -z at yaw 0;
// yaw pi faces +z, toward a camera standing at larger z).
const MID = { x: 4.5, z: -2.5 };
const VIEWS: Array<[string, number]> = [['front', Math.PI], ['3q', Math.PI - 0.75], ['side', Math.PI / 2], ['back', 0]];
/**
 * The pair side by side at `c`, the camera `dist` away in direction `th`
 * (0: toward +z), each view's yaw relative to facing the camera.
 */
function lineup(dist: number, tag: string, view: string, yaw: number, c = MID, th = 0, prefix = ''): Shot {
  const dx = Math.sin(th), dz = Math.cos(th), px = Math.cos(th), pz = -Math.sin(th);
  const y = yaw + th;
  return {
    name: `${prefix}${tag}-${view}`, label: `${prefix}${dist} m ${view}`,
    sol: { x: c.x - 0.45 * px, z: c.z - 0.45 * pz, yaw: y }, luna: { x: c.x + 0.45 * px, z: c.z + 0.45 * pz, yaw: y },
    eye: [c.x + dx * dist, c.z + dz * dist], look: [c.x, dist < 2 ? 1.1 : 1.0, c.z],
  };
}
/** The LIGHTS settings: map, where the pair stands, where the camera looks from. */
const LIGHT_SET: Record<string, { map: string; c: { x: number; z: number }; th: number }> = {
  sun: { map: 'patio', c: MID, th: 0 },
  shade: { map: 'patio', c: { x: 2.05, z: 6.6 }, th: Math.PI }, // under the marigold house (front z = 8; sun from -x, +z)
  dusk: { map: 'fiesta', c: { x: -1, z: 0.5 }, th: -Math.PI / 2 }, // the dance floor, seen along the party floor from the west
};
const DIST_TAGS = (process.env.DISTS ? process.env.DISTS.split(',').map(Number) : [1.5, 4, 8]).map((d) => [d, `${String(d).replace('.', 'm')}${Number.isInteger(d) ? 'm' : ''}`] as const);
function lightShots(light: string): Shot[] {
  const L = LIGHT_SET[light];
  if (!L) throw new Error(`unknown light ${light}`);
  return DIST_TAGS.flatMap(([d, tag]) => VIEWS.map(([v, yaw]) => lineup(d, tag, v, yaw, L.c, L.th, `${light}-`)));
}
const SHOTS: Shot[] = [
  // DISTS=1.5,5,10 picks other distances (tag: 1m5, 5m, 10m).
  ...DIST_TAGS.flatMap(([d, tag]) => VIEWS.map(([v, yaw]) => lineup(d, tag, v, yaw))),
  // Against the café door (the facade is the plane z = -8, the door near x = -1.2), seen from the plaza.
  { name: 'door-sol', label: 'Sol at the café door, 4 m', sol: { x: -1.2, z: -7.4, yaw: Math.PI - 0.3 }, luna: { x: 30, z: 30, yaw: 0 }, eye: [-0.2, -3.5], look: [-1.2, 1.0, -7.4] },
  { name: 'door-luna', label: 'Luna at the café door, 4 m', sol: { x: 30, z: 30, yaw: 0 }, luna: { x: -1.2, z: -7.4, yaw: Math.PI - 0.3 }, eye: [-0.2, -3.5], look: [-1.2, 1.0, -7.4] },
  // In the shadow of the marigold house (its front is z = 8, the sun comes from -x, +z).
  { name: 'shade', label: 'in shade, 4 m', sol: { x: 1.6, z: 6.6, yaw: Math.PI + 0.4 }, luna: { x: 2.5, z: 6.6, yaw: Math.PI - 0.4 }, eye: [2.6, 2.8], look: [2.05, 1.0, 6.6] },
  // Full sun on the open paving.
  { name: 'sun', label: 'bright paving, 4 m', sol: { x: -6.5, z: 1.5, yaw: Math.PI + 0.5 }, luna: { x: -5.6, z: 1.5, yaw: Math.PI - 0.5 }, eye: [-5.2, 5.3], look: [-6.05, 1.0, 1.5] },
  // The right hand from her right side: La Chancla (Sol) and La Pesada (Luna).
  // Her right hand from her right side (+x local turned toward the camera at -z), one weapon each.
  { name: 'grip-chancla', label: 'grip, 1 m: La Chancla', sol: { x: 4.5, z: -2.5, yaw: Math.PI / 2 - 0.4, weapon: 0 }, luna: { x: 30, z: 30, yaw: 0 }, eye: [4.75, -3.5], look: [4.75, 0.8, -2.5] },
  { name: 'grip-pesada', label: 'grip, 1 m: La Pesada', sol: { x: 30, z: 30, yaw: 0 }, luna: { x: 4.5, z: -2.5, yaw: Math.PI / 2 - 0.4, weapon: 1 }, eye: [4.75, -3.5], look: [4.75, 0.8, -2.5] },
];

async function place(p: Page, shot: Shot): Promise<void> {
  await p.evaluate((shot) => {
    const f = (window as any).__fps; const s = f.session(); const e = f.engine();
    const st = (window as any).__shot ??= {};
    st.shot = shot;
    if (!st.patched) {
      st.patched = true;
      const members = s.room.members as Array<{ id: number; team: number }>;
      const ids = [...s.remotes.keys()] as number[];
      st.sol = ids.find((id) => members.find((m) => m.id === id)?.team === 0);
      st.luna = ids.find((id) => members.find((m) => m.id === id)?.team === 1);
      s.updateRemotes = () => {
        const S = (window as any).__shot.shot;
        const base = { y: 0, pitch: 0, vx: 0, vz: 0, alive: true, crouched: false, onGround: true, protected: false, connected: true, hp: 100, msSinceThrow: 1e6, msSinceHit: 1e6, msSinceMelee: 1e6, ruleros: 15 };
        for (const [id, P] of [[st.sol, S.sol], [st.luna, S.luna]]) if (id !== undefined) s.remotes.set(id, { ...base, id, x: P.x, z: P.z, yaw: P.yaw, weapon: P.weapon ?? 0 });
        const b = s.body; b.x = S.eye[0]; b.z = S.eye[1]; b.y = 0; b.vx = b.vz = b.vy = 0;
        const dx = S.look[0] - S.eye[0], dz = S.look[2] - S.eye[1], dy = S.look[1] - 1.58;
        f.input().yaw = Math.atan2(-dx, -dz); f.input().pitch = Math.atan2(dy, Math.hypot(dx, dz));
        s.weapon = 0; s.switchMs = 0; s.cooldownMs = 0; s.meleeMs = 0; e.lastLocalMelee = -1e9;
        e.vm.root.scale.setScalar(1e-4); // hide your own first-person hand
      };
      // The world's clock stands at one time (fiesta lights, water, flags).
      if (e.world?.update && !e.world.__pinned) { const wu = e.world.update.bind(e.world); e.world.update = () => wu(100); e.world.__pinned = true; }
    }
    // Pin each Rosa's idle: fixed seed and step, the clock held at one
    // breath phase, no blinks; then settle the springs at that pose.
    for (const [id, seed] of [[st.sol, 0.31], [st.luna, 0.77]] as Array<[number, number]>) {
      const av = e.avatars.get(id); const an = av?.anim;
      if (!av || !an || av.__pinned) continue;
      av.__pinned = true;
      const up = av.update.bind(av);
      an.seed = seed;
      av.update = (s2: unknown, _dt: number, rm: boolean) => { an.time = 10; an.blinkAt = 1e9; up(s2, 1 / 60, rm); };
    }
  }, shot);
  await sleep(450);
  // Settle: the same number of fixed steps at the new spot for every shot.
  await p.evaluate(() => {
    const f = (window as any).__fps; const s = f.session(); const e = f.engine(); const st = (window as any).__shot;
    s.updateRemotes();
    const S = st.shot;
    for (const [id, P] of [[st.sol, S.sol], [st.luna, S.luna]]) {
      const av = e.avatars.get(id); const r = s.remotes.get(id);
      if (!av?.__pinned || !r) continue;
      av.root.position.set(P.x, 0, P.z); av.root.rotation.y = P.yaw;
      const as = { speed: 0, strafe: 0, back: 0, onGround: true, crouched: false, alive: true, protected: false, pitch: r.pitch, weapon: r.weapon, msSinceThrow: r.msSinceThrow, msSinceHit: r.msSinceHit, connected: true, msSinceMelee: r.msSinceMelee, ruleros: r.ruleros };
      for (let i = 0; i < 240; i++) av.update(as, 1 / 60, false);
    }
  });
  await sleep(250);
}

/** Per-Rosa cost: each remote's root rendered alone (exact main-pass draws and triangles), shadow casters counted. */
async function cost(p: Page): Promise<unknown> {
  return p.evaluate(() => {
    const f = (window as any).__fps; const e = f.engine(); const r = e.renderer;
    const st = (window as any).__shot;
    const out: Record<string, unknown> = {};
    const Scene = e.scene.constructor;
    for (const [team, id] of [['sol', st.sol], ['luna', st.luna]]) {
      const av = e.avatars.get(id); if (!av) continue;
      const parent = av.root.parent; const pos = av.root.position.clone(); const rot = av.root.rotation.y;
      const sc = new Scene();
      sc.add(av.root); av.root.position.set(0, 0, 0); av.root.rotation.y = Math.PI;
      const cam = e.camera.clone(); cam.position.set(0, 1.2, 3); cam.lookAt(0, 0.9, 0); cam.updateMatrixWorld();
      av.root.updateMatrixWorld(true);
      let casters = 0, meshes = 0;
      const mats = new Set(), geos = new Set();
      av.root.traverseVisible((o: any) => { if (o.isMesh) { meshes++; mats.add(o.material); geos.add(o.geometry); if (o.castShadow) casters++; } });
      const autoClear = r.autoClear; r.autoClear = true;
      r.render(sc, cam);
      out[team as string] = { draws: r.info.render.calls, triangles: r.info.render.triangles, visibleMeshes: meshes, shadowCasters: casters, materials: mats.size, geometries: geos.size };
      r.autoClear = autoClear;
      parent.add(av.root); av.root.position.copy(pos); av.root.rotation.y = rot;
    }
    // Leak check: build and dispose avatars of both teams repeatedly.
    const any = [...e.avatars.values()][0];
    const Avatar = any.constructor;
    const mem = () => ({ geometries: r.info.memory.geometries, textures: r.info.memory.textures });
    const cam = e.camera.clone(); cam.position.set(0, 1.2, 3); cam.lookAt(0, 0.9, 0); cam.updateMatrixWorld();
    const round = () => {
      const sc = new Scene();
      const made = [new Avatar(0, { quality: any.quality }), new Avatar(1, { quality: any.quality }), new Avatar(0, { home: true, quality: any.quality })];
      for (const a of made) sc.add(a.root);
      r.render(sc, cam);
      for (const a of made) a.dispose();
    };
    round();
    const before = mem();
    for (let i = 0; i < 8; i++) round();
    out.leak = { before, after: mem(), rounds: 8 };
    out.memory = mem();
    out.programs = r.info.programs?.length;
    return out;
  });
}

async function runQuality(browser: any, q: string, light?: string): Promise<Record<string, unknown>> {
  const map = light ? LIGHT_SET[light]!.map : 'patio';
  const shots = light ? lightShots(light) : SHOTS;
  const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
  await ctx.route('**/*', (r: any) => { const u = r.request().url(); return u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const p: Page = await ctx.newPage();
  p.on('pageerror', (err) => console.error('pageerror', err.message));
  await p.addInitScript({ content: `window.__name = (f) => f; localStorage.setItem('chancla.mp.settings.v1', JSON.stringify({ practiceMap: '${map}', practiceAllies: 1, practiceEnemies: 1, practiceDifficulty: 'easy', quality: '${q}', qualityMode: '${q}', fov: 70 }));` });
  await p.goto(SITE);
  await p.waitForFunction(() => (window as any).__fps?.screen === 'title');
  await p.click('#btn-practice'); await p.click('#btn-practice-start');
  await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing' && (window as any).__fps.session()?.remotes.size >= 2, undefined, { timeout: 30000 });
  await p.click('#btn-click-play', { force: true }).catch(() => p.click('#stage', { force: true }));
  await p.evaluate(() => { const f = (window as any).__fps; const room = [...f.host().hub.rooms.values()][0] as any; for (const m of room.members.values()) if (m.bot) m.brain = null; document.getElementById('hud')!.style.opacity = '0'; });
  await sleep(4000); // start-of-match banners fade
  const files: Array<{ file: string; label: string }> = [];
  for (const shot of shots) {
    const bare = light ? shot.name.slice(light.length + 1) : shot.name;
    if (ONLY && !ONLY.has(shot.name) && !ONLY.has(bare) && !ONLY.has(bare.split('-')[0]!)) continue;
    await place(p, shot);
    const file = path.join(OUT, `${q}-${shot.name}.png`);
    await p.screenshot({ path: file });
    files.push({ file, label: `${q}: ${shot.label}` });
  }
  if (!light && (!ONLY || ONLY.has('home'))) {
    // The campaign's home look (no hat or hood, six recovered curlers), built from the avatar class the page uses.
    await place(p, { name: 'home', label: '', sol: { x: 30, z: 30, yaw: 0 }, luna: { x: 31, z: 30, yaw: 0 }, eye: [MID.x + 0.2, MID.z + 1.4], look: [MID.x, 1.35, MID.z] });
    await p.evaluate((mid) => {
      const e = (window as any).__fps.engine();
      const Avatar = [...e.avatars.values()][0].constructor;
      const a = new Avatar(0, { home: true, quality: e.quality });
      a.setRuleros(6);
      if (a.model?.bubble) a.model.bubble.visible = false; // no spawn bubble (nothing updates this avatar)
      a.root.position.set(mid.x, 0, mid.z); a.root.rotation.y = Math.PI - 0.5;
      e.scene.add(a.root);
      (window as any).__home = a;
    }, MID);
    await sleep(400);
    const file = path.join(OUT, `${q}-home.png`);
    await p.screenshot({ path: file });
    files.push({ file, label: `${q}: campaign home look, six curlers` });
    await p.evaluate(() => { const a = (window as any).__home; a.root.removeFromParent(); a.dispose(); });
  }
  const c = await cost(p);
  await ctx.close();
  sheet(files, path.join(OUT, `sheet-${light ? `${light}-` : ''}${q}.jpg`));
  return { cost: c, files: files.map((f) => path.basename(f.file)) };
}

/** Contact sheet with PIL: four columns, each tile labelled. */
function sheet(files: Array<{ file: string; label: string }>, out: string): void {
  if (!files.length) return;
  const py = `
import json, sys
from PIL import Image, ImageDraw
items = json.loads(sys.argv[1]); out = sys.argv[2]
W, H, cols = 480, 300, 4
rows = (len(items) + cols - 1) // cols
sheet = Image.new('RGB', (W * cols, (H + 20) * rows), (30, 24, 34))
d = ImageDraw.Draw(sheet)
for i, it in enumerate(items):
    im = Image.open(it['file']).convert('RGB').resize((W, H))
    x, y = (i % cols) * W, (i // cols) * (H + 20)
    sheet.paste(im, (x, y + 20))
    d.text((x + 6, y + 4), it['label'], fill=(255, 236, 200))
sheet.save(out, quality=88)
`;
  const r = spawnSync('python3', ['-I', '-c', py, JSON.stringify(files), out], { stdio: 'inherit' });
  if (r.status !== 0) console.error('contact sheet failed (python3 with PIL needed)');
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
    for (const q of QUALITIES) {
      for (const light of LIGHTS ?? [undefined]) {
        const k = light ? `${light}-${q}` : q;
        report[k] = await runQuality(browser, q, light);
        console.log(k, JSON.stringify((report[k] as any).cost));
      }
    }
  } finally {
    await browser.close();
    preview?.kill();
  }
  fs.writeFileSync(path.join(OUT, 'cost.json'), JSON.stringify(report, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
