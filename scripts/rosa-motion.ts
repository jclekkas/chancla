// Motion review for Rosa's animation: the real game page and the real
// avatar code, with a remote Rosa driven along scripted paths (position,
// facing, velocity, jumps, throws, swings, hits, elimination) on a fake
// clock, so every frame is reproducible. Nothing is simulated: the script
// only places the remote and poses the camera. Writes, per scene and view:
//   <scene>-<view>/f-NNNN.png   the frames (30 fps unless the scene says)
//   <scene>-<view>.mp4          the clip (when ffmpeg is present)
//   <scene>-<view>.jpg          a strip of evenly spaced frames
// and prints the foot-slip measurement (walks at 1.5, 3 and 6 m/s): the
// world-space horizontal speed of a foot while it is on the ground (within
// 2 cm of its lowest point), in cm/s, and the slide per contact in cm.
// Works on older builds too (the baseline Avatar kept its joints on itself;
// newer ones keep them on avatar.model).
//
//   GRAPHICS_EXPERIMENT=1 node node_modules/vite/bin/vite.js build --outDir dist-b
//   DIST=dist-b OUT=<dir> node --import tsx scripts/rosa-motion.ts
//   env: SCENES=walk6,jump (filter), VIEWS=side,3q, MEASURE=only (no frames), CAM=4 (camera distance, m), PORT
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import type { Page } from 'playwright-core';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.PORT || 4421);
const SITE = `http://localhost:${PORT}/`;
const DIST = path.resolve(ROOT, process.env.DIST || 'dist-b');
const OUT = path.resolve(process.env.OUT || path.join(ROOT, '..', 'rosa-motion-out'));
const MEASURE_ONLY = process.env.MEASURE === 'only';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hasFfmpeg = spawnSync('which', ['ffmpeg']).status === 0;

async function waitHttp(url: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

type View = 'side' | '3q';
interface Scene { name: string; dur: number; pre: number; fps: number; views: View[]; strip: number }
// Durations in seconds; `pre`: a lead-in that is played but not filmed.
const SCENES: Scene[] = [
  { name: 'walk1.5', dur: 1.6, pre: 1.0, fps: 30, views: ['side', '3q'], strip: 10 },
  { name: 'walk3', dur: 1.2, pre: 1.0, fps: 30, views: ['side', '3q'], strip: 10 },
  { name: 'walk6', dur: 0.9, pre: 1.0, fps: 60, views: ['side', '3q'], strip: 10 },
  { name: 'startstop', dur: 3.0, pre: 0.4, fps: 30, views: ['side'], strip: 12 },
  { name: 'strafeL', dur: 0.9, pre: 0.8, fps: 30, views: ['side', '3q'], strip: 8 },
  { name: 'strafeR', dur: 0.9, pre: 0.8, fps: 30, views: ['side', '3q'], strip: 8 },
  { name: 'back', dur: 0.9, pre: 0.8, fps: 30, views: ['side', '3q'], strip: 8 },
  { name: 'turn', dur: 3.2, pre: 0.4, fps: 30, views: ['3q'], strip: 12 },
  { name: 'runturn', dur: 1.3, pre: 0.4, fps: 30, views: ['side'], strip: 12 },
  { name: 'jump', dur: 1.4, pre: 0.4, fps: 30, views: ['side', '3q'], strip: 12 },
  { name: 'runjump', dur: 1.0, pre: 0.6, fps: 30, views: ['side'], strip: 12 },
  { name: 'crouch', dur: 1.6, pre: 0.4, fps: 30, views: ['side', '3q'], strip: 10 },
  { name: 'throw0', dur: 0.6, pre: 0.4, fps: 60, views: ['side', '3q'], strip: 12 },
  { name: 'throw1', dur: 1.2, pre: 0.4, fps: 60, views: ['side', '3q'], strip: 12 },
  { name: 'chanclazo', dur: 0.8, pre: 0.4, fps: 60, views: ['side', '3q'], strip: 12 },
  { name: 'reves', dur: 1.2, pre: 0.4, fps: 60, views: ['side', '3q'], strip: 12 },
  { name: 'reveswhiff', dur: 1.5, pre: 0.4, fps: 60, views: ['side', '3q'], strip: 12 },
  { name: 'chanclazowhiff', dur: 0.9, pre: 0.4, fps: 60, views: ['3q'], strip: 12 },
  { name: 'headhit', dur: 0.9, pre: 0.4, fps: 60, views: ['side', '3q'], strip: 12 },
  { name: 'throwhit', dur: 0.6, pre: 0.4, fps: 60, views: ['side'], strip: 10 },
  { name: 'elim', dur: 3.4, pre: 0.4, fps: 30, views: ['side'], strip: 12 },
  { name: 'idle', dur: 4.0, pre: 0.4, fps: 15, views: ['side'], strip: 8 },
];
const MEASURED = ['walk1.5', 'walk3', 'walk6', 'crouch', 'strafeR', 'back'];

// Runs in the page: the scripted remotes and the camera. `t` in seconds from the scene start.
function install(): void {
  const w = window as any;
  const f = w.__fps; const s = f.session(); const e = f.engine();
  const ids = [...s.remotes.keys()];
  // An open strip of El Patio along x, clear of the kiosk, planters and
  // fountain for both cameras while she is filmed (x up to -5.5).
  const Z = 3.1, X0 = -6, Z0 = 3.4; // walks; standing scenes
  const M = w.__mo = { scene: '', view: 'side', dur: 1, t0: 0, ids, samples: [] as number[][], fired: {} as Record<string, boolean>, lastT: -1 };
  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;left:8px;top:6px;z-index:99;font:bold 15px sans-serif;color:#fff;background:#0008;padding:2px 7px;border-radius:4px';
  document.body.appendChild(label);
  const rigOf = (av: any) => av?.model ?? av; // newer builds: av.model; the baseline: joints on the Avatar
  const base = { y: 0, pitch: 0, vx: 0, vz: 0, alive: true, crouched: false, onGround: true, protected: false, connected: true, hp: 100, msSinceThrow: 1e6, msSinceHit: 1e6, msSinceMelee: 1e6, ruleros: 15, weapon: 0 };
  const FWD = -Math.PI / 2; // facing +x
  // Each scene: the subject's state at time t (x, z, yaw, vx, vz, y, onGround...) and an optional partner.
  // Walking along +x; the filmed part (0..dur) ends at x = -5.5.
  const walk = (v: number, t: number, extra: any = {}) => ({ x: -5.5 - v * M.dur + v * t, z: Z, yaw: FWD, vx: v, vz: 0, ...extra });
  const still = (extra: any = {}) => ({ x: X0, z: Z0, yaw: FWD, ...extra });
  const partnerAt = (extra: any = {}) => ({ x: X0 + 1.3, z: Z0, yaw: Math.PI / 2, ...extra });
  const scenes: Record<string, (t: number) => { me: any; partner?: any; ev?: Array<[number, string, () => void]> }> = {
    'walk1.5': (t) => ({ me: walk(1.5, t) }),
    walk3: (t) => ({ me: walk(3, t) }),
    walk6: (t) => ({ me: walk(6, t) }),
    crouch: (t) => ({ me: walk(3, t, { crouched: true }) }),
    // Accelerate to 6 m/s at the game's rate (70 m/s2), run, stop (55 m/s2), wait, again.
    startstop: (t) => {
      const seg = (tt: number, tp: number) => { // distance and speed of one go: tp s of pressing, from rest
        const ta = 6 / 70, td = 6 / 55;
        if (tt <= 0) return [0, 0];
        if (tt < ta) return [35 * tt * tt, 70 * tt];
        const da = 35 * ta * ta;
        if (tt < tp) return [da + 6 * (tt - ta), 6];
        const dp = da + 6 * (tp - ta);
        if (tt < tp + td) { const u = tt - tp; return [dp + 6 * u - 27.5 * u * u, 6 - 55 * u]; }
        return [dp + 6 * td - 27.5 * td * td, 0];
      };
      const a = seg(t - 0.2, 0.8), b = seg(t - 1.9, 0.4);
      const x = -11.5 + a[0]! + b[0]!;
      return { me: { x, z: Z, yaw: FWD, vx: a[1]! + b[1]!, vz: 0 } };
    },
    // Facing the side camera (+z), moving along +x (her left) or -x (her right).
    strafeL: (t) => ({ me: { ...walk(6, t), yaw: Math.PI } }),
    strafeR: (t) => ({ me: { x: -12 + 6 * M.dur - 6 * t, z: Z, yaw: Math.PI, vx: -6, vz: 0 } }),
    back: (t) => ({ me: { ...walk(6, t), yaw: Math.PI / 2 } }),
    // Turning in place: a quick 90-degree flick, a hold, a slow turn back, a hold.
    turn: (t) => {
      const k = (u: number) => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
      const yaw = FWD + (Math.PI / 2) * k(t / 0.2) - (Math.PI / 2) * k((t - 1.4) / 1.0);
      return { me: still({ yaw }) };
    },
    // Running at 6 m/s and turning the aim 90 degrees (strafing afterwards), then back.
    runturn: (t) => {
      const k = (u: number) => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
      const yaw = FWD + (Math.PI / 2) * k((t - 0.2) / 0.3) - (Math.PI / 2) * k((t - 0.9) / 0.3);
      return { me: { ...walk(6, t), yaw } };
    },
    // A standing jump (7 m/s up, gravity 21: 0.67 s in the air), then another.
    jump: (t) => {
      const u = t - 0.15;
      const air = u > 0 && u < 2 / 3;
      return { me: still({ y: air ? 7 * u - 10.5 * u * u : 0, onGround: !air }) };
    },
    runjump: (t) => {
      const u = t - 0.2;
      const air = u > 0 && u < 2 / 3;
      return { me: { ...walk(6, t), y: air ? 7 * u - 10.5 * u * u : 0, onGround: !air } };
    },
    throw0: (t) => ({ me: still({ weapon: 0, msSinceThrow: t >= 0.05 ? (t - 0.05) * 1000 : 1e6 }) }),
    throw1: (t) => ({ me: still({ weapon: 1, msSinceThrow: t >= 0.05 ? (t - 0.05) * 1000 : 1e6 }) }),
    chanclazo: (t) => ({ me: still({ weapon: 0, msSinceMelee: t >= 0.05 ? (t - 0.05) * 1000 : 1e6 }), partner: partnerAt({ msSinceHit: t >= 0.2 ? (t - 0.2) * 1000 : 1e6 }), ev: [[0.2, 'react-body', () => partnerAv()?.react(false, -1)]] }),
    reves: (t) => ({ me: still({ weapon: 1, msSinceMelee: t >= 0.05 ? (t - 0.05) * 1000 : 1e6 }), partner: partnerAt({ msSinceHit: t >= 0.38 ? (t - 0.38) * 1000 : 1e6 }), ev: [[0.38, 'react-head', () => partnerAv()?.react(true, 1)]] }),
    // A miss: nobody in reach; the authoritative 'whiff' arrives at the end of the contact window.
    reveswhiff: (t) => ({ me: still({ weapon: 1, msSinceMelee: t >= 0.05 ? (t - 0.05) * 1000 : 1e6 }), ev: [[0.05 + 0.39, 'whiff', () => subjectAv()?.whiff?.(1)]] }),
    chanclazowhiff: (t) => ({ me: still({ weapon: 0, msSinceMelee: t >= 0.05 ? (t - 0.05) * 1000 : 1e6 }), ev: [[0.05 + 0.19, 'whiff', () => subjectAv()?.whiff?.(0)]] }),
    // The subject takes an El Revés to the face from her left (knocked to her right).
    headhit: (t) => ({ me: still({ msSinceHit: t >= 0.1 ? (t - 0.1) * 1000 : 1e6 }), ev: [[0.1, 'react', () => subjectAv()?.react(true, -1)]] }),
    throwhit: (t) => ({ me: still({ msSinceHit: t >= 0.1 ? (t - 0.1) * 1000 : 1e6 }) }),
    elim: (t) => ({ me: still({ alive: !(t >= 0.1 && t < 2.9) }) }),
    idle: () => ({ me: { x: -3, z: Z, yaw: FWD } }),
  };
  const subjectAv = () => e.avatars.get(M.ids[0]);
  const partnerAv = () => e.avatars.get(M.ids[1]);
  s.updateRemotes = () => {
    if (!M.scene) return;
    const t = (performance.now() - M.t0) / 1000;
    // Measure what was just rendered: the subject's ankles (shin end) and root.
    const av = subjectAv(); const rig = rigOf(av);
    if (av && rig?.shinL && M.lastT > -1e8) {
      av.root.updateMatrixWorld(true);
      const THREE_V = av.root.position.constructor;
      const a = new THREE_V(0, -0.43, 0).applyMatrix4(rig.shinL.matrixWorld), b = new THREE_V(0, -0.43, 0).applyMatrix4(rig.shinR.matrixWorld);
      M.samples.push([M.lastT, a.x, a.y, a.z, b.x, b.y, b.z, av.root.position.x, av.root.position.y, av.root.position.z]);
    }
    M.lastT = t;
    const sc = scenes[M.scene]!(t);
    const me = { ...base, ...sc.me, id: M.ids[0] };
    s.remotes.set(M.ids[0], me);
    s.remotes.set(M.ids[1], { ...base, x: 40, z: 40, yaw: 0, ...(sc.partner ?? {}), id: M.ids[1] });
    for (const [at, key, fn] of sc.ev ?? []) if (t >= at && !M.fired[key]) { M.fired[key] = true; fn(); }
    // Camera at eye height, 4 m away: 'side' on her right (+z), '3q' ahead
    // of her on her left (standing) or on her right (moving).
    let cx: number, cz: number;
    const cd = (w.__camDist ?? 4) / 4;
    if (M.view === 'side') { cx = me.x; cz = me.z + 4.0 * cd; }
    else if (M.scene.startsWith('strafe')) { cx = me.x + 2.5 * cd; cz = me.z + 3.1 * cd; }
    else if (me.vx) { cx = me.x + 2.0 * cd; cz = me.z + 3.3 * cd; } // walks: ahead of her on her right (clear of the planters)
    else { cx = me.x + 2.9 * cd; cz = me.z - 2.75 * cd; }
    for (const bd of [s.body]) { bd.x = cx; bd.z = cz; bd.y = 0; bd.vx = bd.vz = bd.vy = 0; }
    const lx = me.x - cx, lz = me.z - cz, ly = 0.95 - 1.58;
    f.input().yaw = Math.atan2(-lx, -lz); f.input().pitch = Math.atan2(ly, Math.hypot(lx, lz));
    e.vm.root.scale.setScalar(1e-4); // your own first-person hand stays out of the shot
    s.meleeMs = 0;
    label.textContent = `${M.scene}  ${M.view}  ${t < 0 ? 'pre' : Math.round(t * 1000) + ' ms'}`;
  };
}

async function main(): Promise<void> {
  let preview: ChildProcess | null = null;
  if (!(await waitHttp(SITE, 500))) {
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST], { cwd: ROOT, stdio: 'ignore' });
    if (!(await waitHttp(SITE))) throw new Error('preview did not start');
  }
  const browser = await launch();
  const filter = process.env.SCENES ? process.env.SCENES.split(',') : null;
  const viewFilter = process.env.VIEWS ? process.env.VIEWS.split(',') : null;
  const report: Record<string, unknown> = {};
  try {
    const ctx = await browser.newContext({ viewport: { width: 560, height: 420 } });
    await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
    const p = await ctx.newPage();
    await p.addInitScript({ content: `window.__name = (f) => f; try { localStorage.setItem('chancla.mp.settings.v1', JSON.stringify({ practiceMap: 'patio', practiceAllies: 1, practiceEnemies: 1, practiceDifficulty: 'easy', quality: 'high', qualityMode: 'high', fov: 70, music: 0 })); } catch {}` });
    await p.goto(SITE);
    await p.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { polling: 100 });
    await p.click('#btn-practice'); await p.click('#btn-practice-start');
    await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing' && (window as any).__fps.session()?.remotes.size >= 2, undefined, { timeout: 30000, polling: 100 });
    await p.click('#btn-click-play', { force: true }).catch(() => p.click('#stage', { force: true }));
    await p.evaluate(() => {
      const f = (window as any).__fps; const room = [...f.host().hub.rooms.values()][0];
      for (const m of room.members.values()) if (m.bot) m.brain = null;
      document.getElementById('hud')!.style.opacity = '0';
      f.host().pause(); // the match clock stands still; only the display runs
    });
    await sleep(500);
    await p.evaluate((d) => { (window as any).__camDist = d; }, Number(process.env.CAM || 4));
    await p.evaluate(install);
    await p.clock.install();
    await p.clock.pauseAt((await p.evaluate(() => Date.now())) + 200);
    // Warm up (shaders, the first frames on the fake clock) standing still.
    // (The first seconds on the fake clock drop frames: a walk is played through them unfilmed.)
    await p.evaluate(() => { const M = (window as any).__mo; M.scene = 'walk3'; M.view = 'side'; M.dur = 3; M.t0 = performance.now(); });
    for (let i = 0; i < 240; i++) await p.clock.runFor(1000 / 60);
    await p.evaluate(() => { (window as any).__mo.scene = ''; });

    const run = async (sc: Scene, view: View, shots: boolean): Promise<number[][]> => {
      await p.evaluate(({ name, view, pre, dur }) => { const M = (window as any).__mo; M.scene = name; M.view = view; M.dur = dur; M.t0 = performance.now() + pre * 1000; M.samples = []; M.fired = {}; M.lastT = -1e9; }, { name: sc.name, view, pre: sc.pre, dur: sc.dur });
      // Lead-in, unfilmed, at 60 fps.
      for (let t = 0; t < sc.pre * 1000; t += 1000 / 60) await p.clock.runFor(1000 / 60);
      const dir = path.join(OUT, `${sc.name}-${view}`);
      if (shots) { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); }
      const n = Math.round(sc.dur * sc.fps);
      for (let i = 0; i < n; i++) {
        // The display runs at 60 fps under the camera's frame rate.
        const sub = Math.max(1, Math.round(60 / sc.fps));
        for (let k = 0; k < sub; k++) await p.clock.runFor(1000 / 60);
        if (shots) await p.screenshot({ path: path.join(dir, `f-${String(i).padStart(4, '0')}.png`), timeout: 180000 });
      }
      const samples = await p.evaluate(() => (window as any).__mo.samples as number[][]);
      await p.evaluate(() => { (window as any).__mo.scene = ''; });
      if (shots && hasFfmpeg) {
        spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(sc.fps), '-i', path.join(dir, 'f-%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-vf', 'scale=560:420', path.join(OUT, `${sc.name}-${view}.mp4`)]);
        const every = Math.max(1, Math.floor(n / sc.strip));
        const cols = Math.min(sc.strip, 6), rows = Math.ceil(sc.strip / cols);
        // A close strip (her, 2x, from the middle of the frame) and a wide one.
        spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(dir, 'f-%04d.png'), '-vf', `select='not(mod(n\\,${every}))',crop=180:250:190:95,scale=270:375,tile=${cols}x${rows}`, '-frames:v', '1', '-q:v', '3', path.join(OUT, `${sc.name}-${view}.jpg`)]);
        spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(dir, 'f-%04d.png'), '-vf', `select='not(mod(n\\,${every}))',crop=360:400:100:10,scale=216:240,tile=${cols}x${rows}`, '-frames:v', '1', '-q:v', '3', path.join(OUT, `${sc.name}-${view}-wide.jpg`)]);
      }
      return samples;
    };

    for (const sc of SCENES) {
      if (filter && !filter.includes(sc.name)) continue;
      if (MEASURED.includes(sc.name)) {
        // A longer run, unfilmed, for the foot-slip numbers.
        const m: Scene = { ...sc, dur: 3.0, fps: 60, pre: 0.2 };
        let samples = await run(m, 'side', false);
        // The very first run after the clock switch can come back short: run it again.
        if (samples.filter((r) => r[0]! >= 0.8).length < 100) samples = await run(m, 'side', false);
        report[sc.name] = footSlip(samples);
        if (process.env.DEBUG) console.log(samples.length, samples.slice(0, 5).map((r) => r[0]!.toFixed(3)).join(" "), samples.slice(-3).map((r) => r[0]!.toFixed(3)).join(" "));
        console.log(sc.name.padEnd(10), JSON.stringify(report[sc.name]));
      }
      if (MEASURE_ONLY) continue;
      for (const v of sc.views) {
        if (viewFilter && !viewFilter.includes(v)) continue;
        await run(sc, v, true);
        console.log('filmed', sc.name, v);
      }
    }
    fs.writeFileSync(path.join(OUT, 'foot-slip.json'), JSON.stringify(report, null, 1));
  } finally {
    await browser.close();
    preview?.kill();
  }
}

// Foot slip: a foot is on the ground while its ankle is within 2 cm of its
// lowest height over the run (the first 0.8 s, the start, is skipped). Each
// frame counts the slowest foot on the ground (the most generous reading of
// which one carries her): its world-space horizontal speed. A contact is a
// run of frames with a foot on the ground; its slide is the path length.
function footSlip(samples: number[][]): Record<string, number> {
  const S = samples.filter((r) => r[0]! >= 0.8);
  const hOf = (r: number[], foot: number) => r[2 + foot * 3]! - r[8]!;
  const hMin = [0, 1].map((f) => Math.min(...S.map((r) => hOf(r, f))));
  const speeds: number[] = [];
  let slide = 0, contacts = 0, inC = false;
  for (let i = 1; i < S.length; i++) {
    const dt = S[i]![0]! - S[i - 1]![0]!;
    let best = Infinity;
    for (const f of [0, 1]) {
      if (hOf(S[i]!, f) > hMin[f]! + 0.02 || hOf(S[i - 1]!, f) > hMin[f]! + 0.02) continue;
      const o = 1 + f * 3;
      best = Math.min(best, Math.hypot(S[i]![o]! - S[i - 1]![o]!, S[i]![o + 2]! - S[i - 1]![o + 2]!));
    }
    if (best === Infinity || dt <= 0) { inC = false; continue; }
    if (!inC) { inC = true; contacts++; }
    speeds.push(best / dt);
    slide += best;
  }
  speeds.sort((x, y) => x - y);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    meanCmPerS: r1((speeds.reduce((x, y) => x + y, 0) / Math.max(1, speeds.length)) * 100),
    p90CmPerS: r1((speeds[Math.floor(speeds.length * 0.9)] ?? 0) * 100),
    cmPerContact: r1((slide / Math.max(1, contacts)) * 100),
    contacts,
    contactFrames: speeds.length,
    frames: S.length,
  };
}

main().catch((e) => { console.error(e); process.exit(1); });
