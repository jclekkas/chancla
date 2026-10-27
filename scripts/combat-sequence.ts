// A short, repeatable first-person combat sequence in offline practice on
// El Patio, for reviewing movement and combat presentation as a player sees
// it. The page runs on a fake clock (the in-page host rebased onto it, as in
// scripts/route-walk.ts and scripts/milestone-shots.ts), the bots' brains are
// off and every position is set on the host sim each frame, so each run
// films the same thing. Everything that happens in combat is the real game:
// your throws and swings go through the input, the sim decides what lands,
// and the engine draws its own effects, reactions and replay.
//
// The sequence (s): 0-5.2 out of the sunlit plaza, through the opening into
// the shaded alley and east (a teammate crosses the alley ahead); 5.6 a throw
// at the opponent (a confirmed hit); 6.6-7.6 up to him; 8.0 El Chanclazo (a
// hit); he steps back out of reach; 9.6 El Revés (a confirmed miss); he steps
// in; 11.8 El Revés to the face (a hit that eliminates him); 13.6 you turn
// back up the alley, where a second opponent walks in; 14.7 she lands El
// Revés on you (your elimination), and the replay plays; filmed until you are
// back in play (or 8 s after the blow).
//
// Writes, per view: <tag>/f-NNNN.png (30 fps), <tag>.mp4 (with ffmpeg),
// <tag>-contact.jpg (a contact sheet of the key moments), <tag>-log.json
// (per-frame state: killcam, hp, who is alive; and the sim's events).
// Views: desktop-high (1280x720), phone-low (844x390, touch).
//
//   DIST=<build> OUT=<dir> [PORT=4582] [VIEWS=desktop-high,phone-low] [FRAMES=0] node --import tsx scripts/combat-sequence.ts
// FRAMES=0 runs the sequence without screenshots (checks the events only).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import type { Browser } from 'playwright-core';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST || path.join(ROOT, 'dist'));
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'artifacts/combat-sequence'));
const PORT = Number(process.env.PORT || 4582);
const SITE = `http://localhost:${PORT}/`;
const FRAMES = process.env.FRAMES !== '0';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

type Key = { t: number; x: number; z: number; look: [number, number, number] };
// Your route and look. Positions and looks are interpolated (smoothstep per leg).
const ENEMY: [number, number] = [-4.4, -13.2];
const KEYS: Key[] = [
  { t: 0.0, x: -13.4, z: -3.6, look: [-15.7, 1.7, -12] }, // the sunlit plaza, facing the opening
  { t: 1.8, x: -15.7, z: -7.2, look: [-15.7, 1.6, -14] }, // through the opening
  { t: 3.6, x: -15.7, z: -12.6, look: [-4, 1.5, -13.4] }, // in the shaded alley, turning east
  { t: 5.2, x: -11.2, z: -13.0, look: [ENEMY[0], 1.35, ENEMY[1]] }, // the opponent ahead, past the bin
  { t: 6.6, x: -11.2, z: -13.0, look: [ENEMY[0], 1.3, ENEMY[1]] }, // (the throw at 5.6)
  { t: 7.6, x: -5.6, z: -13.2, look: [ENEMY[0], 1.0, ENEMY[1]] }, // up to him (1.2 m)
  { t: 11.6, x: -5.6, z: -13.2, look: [ENEMY[0], 1.0, ENEMY[1]] },
  { t: 11.75, x: -5.6, z: -13.2, look: [ENEMY[0], 1.55, ENEMY[1]] }, // El Revés to the face
  { t: 13.6, x: -5.6, z: -13.2, look: [ENEMY[0], 1.0, ENEMY[1]] },
  { t: 14.2, x: -5.6, z: -13.2, look: [-10, 1.45, -13.1] }, // turn back up the alley
  { t: 30, x: -5.6, z: -13.2, look: [-10, 1.45, -13.1] },
];
const THROW_AT = 5.6, CHANCLAZO_AT = 8.0, SWITCH_AT = 8.2, REVES_MISS_AT = 9.6, REVES_HIT_AT = 11.8, B_SWING_AT = 14.7;
const END_MIN = 15.2, END_MAX = B_SWING_AT + 8;
// The contact sheet: fixed moments (s), then four from the replay.
const SHEET: Array<[number, string]> = [
  [0.4, 'sun'], [2.6, 'shade'], [4.2, 'ally crosses'], [5.75, 'throw'], [5.95, 'throw lands'],
  [8.12, 'chanclazo'], [8.26, 'chanclazo hit'], [9.95, 'reves'], [10.1, 'reves miss'],
  [12.12, 'reves hit'], [12.3, 'hit +0.2'], [12.9, 'eliminated'], [14.4, 'second opponent'], [15.0, 'blow on you'],
];

async function run(browser: Browser, tag: string): Promise<void> {
  const phone = tag === 'phone-low';
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 720 } });
  await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const p = await ctx.newPage();
  const q = phone ? 'low' : 'high';
  const settings = { practiceMap: 'patio', practiceAllies: 1, practiceEnemies: 2, practiceDifficulty: 'easy', quality: q, qualityMode: q, music: 0, lang: 'en', name: 'Rosa', killcam: true };
  await p.addInitScript({ content: `window.__name = (f) => f; try { localStorage.setItem('chancla.mp.settings.v1', JSON.stringify(${JSON.stringify(settings)})); } catch {}` });
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto(SITE);
  await p.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { polling: 100 });
  await sleep(300);
  await p.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
  await sleep(200);
  await p.evaluate(() => (document.getElementById('btn-practice-start') as HTMLElement).click());
  await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing' && (window as any).__fps.session()?.alive, undefined, { timeout: 60000, polling: 100 });
  if (phone) { await sleep(300); await p.touchscreen.tap(422, 120); await sleep(400); }
  else { await sleep(300); if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true }); else await p.click('#stage', { force: true }); await sleep(400); }
  await p.evaluate(() => { const h = (window as any).__fps.host(); (window as any).__h0 = h.now(); h.pause(); });
  await p.clock.install();
  await p.clock.pauseAt((await p.evaluate(() => Date.now())) + 200);
  await p.evaluate(({ keys, enemy, cue }) => {
    const w = window as any, f = w.__fps, h = f.host();
    h.pausedAt = -1; h.pausedTotal = performance.now() - w.__h0;
    for (const room of h.hub.rooms.values()) { room.lastUpdate = h.now(); room.acc = 0; }
    h.timer = setInterval(() => { if (h.pausedAt < 0) h.hub.update(); }, 1000 / 120);
    const s = f.session(), room = [...h.hub.rooms.values()][0] as any, sim = room.sim;
    for (const m of room.members.values()) if (m.bot) m.brain = null;
    const me = sim.players.get(s.id);
    const ally = [...sim.players.values()].find((q: any) => q !== me && q.team === me.team);
    const foes = [...sim.players.values()].filter((q: any) => q.team !== me.team);
    const A = foes[0], B = foes[1];
    w.__ids = { me: me.id, ally: ally?.id, A: A?.id, B: B?.id };
    // The sim's events, as the session hears them (what the engine is told).
    w.__events = [] as unknown[];
    const on = f.engine().onEvent.bind(f.engine());
    f.engine().onEvent = (e: any) => { if (['hit', 'whiff', 'elim', 'swing', 'throw', 'shielded'].includes(e.k)) w.__events.push({ t: +(w.__t ?? 0).toFixed(3), ...e }); on(e); };
    const sm = (u: number) => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
    const at = (t: number) => {
      let i = 0; while (i < keys.length - 2 && t > keys[i + 1].t) i++;
      const a = keys[i], b = keys[i + 1], u = sm((t - a.t) / (b.t - a.t));
      const L = (k: number) => a.look[k] + (b.look[k] - a.look[k]) * u;
      return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, look: [L(0), L(1), L(2)] };
    };
    const put = (pl: any, x: number, z: number, vx: number, vz: number, yaw: number) => { pl.body.x = x; pl.body.z = z; pl.body.y = 0; pl.body.vx = vx; pl.body.vz = vz; pl.yaw = yaw; };
    // A path from (x0, z0) to (x1, z1) between t0 and t1 (eased), facing along it (or `face`).
    const walk = (pl: any, t: number, t0: number, t1: number, x0: number, z0: number, x1: number, z1: number, face?: number) => {
      const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0))), k = sm(u), dk = u > 0 && u < 1 ? 6 * u * (1 - u) / (t1 - t0) : 0;
      put(pl, x0 + (x1 - x0) * k, z0 + (z1 - z0) * k, (x1 - x0) * dk, (z1 - z0) * dk, face ?? Math.atan2(-(x1 - x0), -(z1 - z0)));
    };
    let lastT = -1, lx = 0, lz = 0;
    let bSwung = false;
    w.__route = (t: number) => {
      w.__t = t;
      const r = at(t), dt = lastT < 0 ? 0 : Math.max(1e-3, t - lastT);
      const vx = lastT < 0 ? 0 : (r.x - lx) / dt, vz = lastT < 0 ? 0 : (r.z - lz) / dt;
      lastT = t; lx = r.x; lz = r.z;
      if (me.alive && s.alive) {
        for (const b of [me.body, s.body]) { b.x = r.x; b.z = r.z; b.y = 0; b.vx = vx; b.vz = vz; }
        me.protectedUntil = 0;
        if (t < B_SWING - 0.1) me.hp = 100; else if (!bSwung) me.hp = 40;
        const dx = r.look[0] - r.x, dz = r.look[2] - r.z;
        f.input().yaw = Math.atan2(-dx, -dz); f.input().pitch = Math.atan2(r.look[1] - 1.58, Math.hypot(dx, dz));
      }
      // The teammate crosses the alley ahead, then waits by the north wall.
      if (ally) { walk(ally, t, 3.0, 5.0, -9.0, -11.7, -9.6, -14.5); ally.protectedUntil = 0; }
      // Opponent A: by the alley, facing you; out of reach for the miss, back in for the last blow.
      if (A && A.alive && t < cue.revesHit + 1.5) {
        const face = Math.PI / 2;
        if (t < cue.chanclazo + 0.8) walk(A, t, 0, 1, enemy[0], enemy[1], enemy[0], enemy[1], face);
        else if (t < cue.revesMiss + 1.0) walk(A, t, cue.chanclazo + 0.8, cue.chanclazo + 1.3, enemy[0], enemy[1], enemy[0] + 1.8, enemy[1], face);
        else walk(A, t, cue.revesMiss + 1.4, cue.revesMiss + 1.8, enemy[0] + 1.8, enemy[1], enemy[0], enemy[1], face);
        A.protectedUntil = 0;
        // Health: the throw and the Chanclazo land; the last Revés finishes him.
        A.hp = t < cue.revesHit - 0.3 ? Math.max(A.hp, 60) : Math.min(A.hp, 40);
      }
      // Opponent B: parked out of the way, then walks in up the alley and swings.
      if (B && !bSwung) {
        if (t < 13.6) put(B, -20, -13.2, 0, 0, -Math.PI / 2);
        else walk(B, t, 13.6, 14.6, -11.2, -13.0, -6.8, -13.2);
        B.protectedUntil = 0; B.hp = 100; B.weapon = 1; B.switchMs = 0; B.cooldownMs = 0; B.meleeMs = 0;
        if (t >= cue.bSwing) {
          bSwung = true;
          B.body.vx = B.body.vz = 0;
          let seq = B.lastSeq;
          // The yaw to face you (she faces +x: yaw -pi/2).
          for (let i = 0; i < 30; i++) sim.queueInput(B.id, { seq: ++seq, mx: 0, mz: 0, yaw: -Math.PI / 2, pitch: 0.12, buttons: i === 0 ? 8 : 0, weapon: 1 });
        }
      }
    };
    const B_SWING = cue.bSwing;
    f.input().weapon = 0; me.weapon = 0; me.switchMs = 0;
    w.__route(0);
  }, { keys: KEYS, enemy: ENEMY, cue: { chanclazo: CHANCLAZO_AT, revesMiss: REVES_MISS_AT, revesHit: REVES_HIT_AT, bSwing: B_SWING_AT } });
  // Settle the spawn banners on the first pose (unfilmed).
  for (let i = 0; i < 90; i++) { await p.evaluate(() => (window as any).__route(0)); await p.clock.runFor(50); }
  const dir = path.join(OUT, tag);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const fps = 30;
  const log: Array<Record<string, unknown>> = [];
  let blowAt = -1;
  for (let i = 0; ; i++) {
    const t = i / fps;
    const firing = t >= THROW_AT && t < THROW_AT + 0.15;
    const st = await p.evaluate(({ t, firing, press, sw }) => {
      const w = window as any, f = w.__fps;
      w.__route(t);
      (f.input() as any).mouseFire = firing;
      if (sw) f.input().weapon = 1;
      if (press) f.input().pressMelee();
      const s = f.session(), k = f.engine().killcamState;
      return { alive: s.alive, hp: s.hp ?? null, replay: !!k.active, view: k.active ? k.view ?? null : null };
    }, {
      t, firing,
      press: [CHANCLAZO_AT, REVES_MISS_AT, REVES_HIT_AT].some((c) => t >= c && t < c + 1 / fps - 1e-6),
      sw: t >= SWITCH_AT && t < SWITCH_AT + 1 / fps - 1e-6,
    });
    await p.clock.runFor(1000 / fps);
    if (FRAMES) await p.screenshot({ path: path.join(dir, `f-${String(i).padStart(4, '0')}.png`), timeout: 180000 });
    log.push({ i, t: +t.toFixed(3), ...st });
    if (blowAt < 0 && t > B_SWING_AT && !st.alive) blowAt = t;
    const back = blowAt > 0 && st.alive && t > blowAt + 1;
    if (t >= END_MIN && (back || t >= END_MAX)) break;
    if (i % 60 === 0) console.log(tag, 't', t.toFixed(1), JSON.stringify(st));
  }
  const events = await p.evaluate(() => (window as any).__events);
  const ids = await p.evaluate(() => (window as any).__ids);
  const killcam = await p.evaluate(() => (window as any).__fps.engine().killcamState);
  fs.writeFileSync(path.join(OUT, `${tag}-log.json`), JSON.stringify({ ids, events, killcam: killcam.last ?? killcam, frames: log }, null, 1));
  // A summary: what landed and what missed.
  const ev = events as any[];
  const mine = ev.filter((e) => e.a === ids.me);
  const summary = {
    throwHit: mine.some((e) => e.k === 'hit' && e.m === undefined && e.v === ids.A),
    chanclazoHit: mine.some((e) => e.k === 'hit' && e.m !== undefined && e.w === 0),
    revesWhiff: mine.some((e) => e.k === 'whiff' && e.w === 1),
    revesHit: mine.some((e) => e.k === 'hit' && e.m !== undefined && e.w === 1),
    elimA: mine.some((e) => e.k === 'elim' && e.v === ids.A),
    elimMe: ev.some((e) => e.k === 'elim' && e.v === ids.me),
    replayFrames: log.filter((r) => r.replay).length,
  };
  console.log(tag, 'summary', JSON.stringify(summary));
  fs.writeFileSync(path.join(OUT, `${tag}-summary.json`), JSON.stringify(summary, null, 1));
  if (FRAMES && spawnSync('which', ['ffmpeg']).status === 0) {
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, 'f-%04d.png'), '-c:v', 'libx264', '-crf', '24', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', path.join(OUT, `${tag}.mp4`)]);
    // The contact sheet: the fixed moments, then four frames of the replay.
    const rep = log.filter((r) => r.replay).map((r) => r.i as number);
    const picks = SHEET.map(([t]) => Math.round(t * fps));
    if (rep.length) for (const u of [0.15, 0.45, 0.75, 0.95]) picks.push(rep[Math.min(rep.length - 1, Math.floor(rep.length * u))]!);
    const sheet = path.join(dir, 'sheet');
    fs.mkdirSync(sheet, { recursive: true });
    picks.forEach((n, k) => { const src = path.join(dir, `f-${String(n).padStart(4, '0')}.png`); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(sheet, `s-${String(k).padStart(2, '0')}.png`)); });
    const w = phone ? 422 : 426;
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(sheet, 's-%02d.png'), '-vf', `scale=${w}:-2,tile=4x${Math.ceil(picks.length / 4)}:padding=4`, '-frames:v', '1', '-q:v', '3', path.join(OUT, `${tag}-contact.jpg`)]);
    fs.rmSync(sheet, { recursive: true, force: true });
    fs.writeFileSync(path.join(OUT, `${tag}-contact.json`), JSON.stringify(picks.map((n, k) => ({ cell: k, frame: n, t: +(n / fps).toFixed(3), label: SHEET[k]?.[1] ?? 'replay' })), null, 1));
  }
  await ctx.close();
}

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
const browser = await launch(['--mute-audio']);
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(SITE)).ok) break; } catch { /* not yet */ } await sleep(250); }
  for (const tag of (process.env.VIEWS || 'desktop-high,phone-low').split(',')) await run(browser, tag);
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
