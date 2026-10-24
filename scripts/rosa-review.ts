// Review stills of Rosa, her movement and combat in real gameplay: offline
// practice on El Patio, the real game page with its HUD, on a fake clock so
// every run (and every build) shows the same moments. The scenes are
// staged on the practice host: positions are set, and the bots are driven
// by inputs queued on the host exactly as a player's would be, so every
// step, jump, throw, swing, hit and roller is the real game's. Runs against
// any build (DIST), including the baseline, for matching before/after sets.
//
//   GRAPHICS_EXPERIMENT=1 npm run build && DIST=dist OUT=<dir> node --import tsx scripts/rosa-review.ts
//   PHONE=1 adds the phone landscape set (Low quality, touch controls).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Browser, Page } from 'playwright-core';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.PORT || 4187);
const SITE = `http://localhost:${PORT}/`;
const DIST = path.resolve(process.env.DIST || path.join(ROOT, 'dist'));
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'docs/rosa/review'));
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shots: Array<{ file: string; label: string }> = [];

async function waitHttp(url: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

// Software rendering on a busy machine can take a long time per frame.
async function snap(p: Page, file: string): Promise<void> {
  for (let i = 0; ; i++) {
    try { await p.screenshot({ path: file, timeout: 120000 }); return; } catch (e) { if (i >= 2) throw e; }
  }
}

async function run(p: Page, ms: number): Promise<void> { for (let t = 0; t < ms; t += 50) await p.clock.runFor(Math.min(50, ms - t)); }

// The spawn banner and centre messages ("YOU ARE ON TEAM SOL", "¡A la
// chancla!") are transient in play but cover the characters in staged
// stills, so the captures hide them (and nothing else).
const HIDE_TRANSIENT = '#spawn-banner, #center-msg { visibility: hidden !important; }';

async function shot(p: Page, name: string, label: string): Promise<void> {
  await p.clock.runFor(1000 / 60);
  const file = path.join(OUT, `${name}.png`);
  await snap(p, file);
  shots.push({ file: path.basename(file), label });
}

type Who = 'ally' | 'foe' | 'foe2';
interface Put { at: [number, number]; face?: [number, number]; hp?: number; weapon?: 0 | 1 }

/**
 * Rosa at `me` looking at `look`; bots placed (or parked far away when not
 * listed) and standing still. `spectate` hides your own first-person hand
 * (stated in the labels), for third-person views of the others.
 */
async function stage(p: Page, o: { me: [number, number]; look: [number, number, number]; bots?: Partial<Record<Who, Put>>; spectate?: boolean }): Promise<void> {
  await p.evaluate((o) => {
    const f = (window as any).__fps; const s = f.session(); const room = [...f.host().hub.rooms.values()][0];
    const W = window as any;
    W.__drive = {};
    const me = room.sim.players.get(s.id);
    const bots = [...room.sim.players.values()].filter((q: any) => q.isBot);
    const ally = bots.filter((q: any) => q.team === me.team), foes = bots.filter((q: any) => q.team !== me.team);
    const pick: Record<string, any> = { ally: ally[0], foe: foes[0], foe2: foes[1] };
    W.__bots = Object.fromEntries(Object.entries(pick).filter(([, q]) => q).map(([k, q]) => [k, q.id]));
    for (const b of [me.body, s.body]) { b.x = o.me[0]; b.z = o.me[1]; b.y = 0; b.vx = b.vy = b.vz = 0; }
    me.protectedUntil = 0;
    let park = 0;
    for (const q of bots) {
      const k = Object.keys(pick).find((n) => pick[n] === q);
      const put = k ? o.bots?.[k] : undefined;
      if (!q.alive) { q.alive = true; q.hp = 100; }
      q.body.vx = q.body.vz = q.body.vy = 0; q.body.y = 0; q.queue.length = 0; q.protectedUntil = 0;
      if (!put) { q.body.x = 24; q.body.z = 14 + 2 * park++; continue; }
      q.body.x = put.at[0]; q.body.z = put.at[1];
      const fc = put.face ?? o.me;
      q.yaw = Math.atan2(-(fc[0] - put.at[0]), -(fc[1] - put.at[1]));
      if (put.hp !== undefined) q.hp = put.hp;
      if (put.weapon !== undefined) { q.weapon = put.weapon; q.switchMs = 0; }
      q.ruleros = 15;
    }
    const i = f.input();
    const dx = o.look[0] - o.me[0], dz = o.look[2] - o.me[1], dy = o.look[1] - 1.58;
    i.yaw = Math.atan2(-dx, -dz); i.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    f.engine().vm.root.scale.setScalar(o.spectate ? 1e-4 : 1);
  }, o);
  await run(p, 900); // positions reach the client, the bots and name tags settle
}

/**
 * Drives a bot like a player: from now on, every host tick gets this input
 * (move in its own frame: mz forward, mx right; facing `face` or `yaw`).
 * `press` buttons go out once (1 throw, 2 jump, 8 melee).
 */
async function drive(p: Page, who: Who, d: { mx?: number; mz?: number; face?: [number, number, number]; yaw?: number; press?: number; weapon?: 0 | 1 } | null): Promise<void> {
  await p.evaluate(({ who, d }) => {
    const W = window as any;
    if (!W.__driver) {
      W.__driver = setInterval(() => {
        const f = W.__fps; const room = [...f.host().hub.rooms.values()][0];
        if (!room?.sim || f.host().paused) return;
        for (const [k, c] of Object.entries(W.__drive ?? {}) as Array<[string, any]>) {
          const q = room.sim.players.get(W.__bots?.[k]);
          if (!q || !c) continue;
          let yaw = c.yaw ?? q.yaw, pitch = 0;
          if (c.face) {
            const dx = c.face[0] - q.body.x, dz = c.face[2] - q.body.z;
            yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(c.face[1] - (q.body.y + 1.58), Math.hypot(dx, dz));
          }
          q.__seq = Math.max(q.__seq ?? 0, q.lastSeq) + 1;
          room.sim.queueInput(q.id, { seq: q.__seq, mx: c.mx ?? 0, mz: c.mz ?? 0, yaw, pitch, buttons: c.press ?? 0, weapon: c.weapon ?? q.weapon });
          c.press = 0;
        }
      }, 1000 / 60);
    }
    W.__drive = W.__drive ?? {};
    W.__drive[who] = d;
  }, { who, d });
}

async function startPractice(browser: Browser, o: { quality: string; viewport: { width: number; height: number }; phone?: boolean; allies: number; enemies: number }): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: o.viewport,
    ...(o.phone ? { deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' } : {}),
  });
  await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const p = await ctx.newPage();
  await p.addInitScript({ content: `window.__name = (f) => f; try { localStorage.setItem('chancla.mp.settings.v1', JSON.stringify({ practiceMap: 'patio', practiceAllies: ${o.allies}, practiceEnemies: ${o.enemies}, practiceDifficulty: 'easy', quality: '${o.quality}', qualityMode: '${o.quality}', music: 0 })); } catch {}` });
  await p.goto(SITE);
  await p.addStyleTag({ content: HIDE_TRANSIENT });
  await p.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { polling: 100 });
  await sleep(600);
  await p.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
  await p.evaluate(() => (document.getElementById('btn-practice-start') as HTMLElement).click());
  await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing' && (window as any).__fps.session()?.alive, undefined, { timeout: 40000, polling: 100 });
  if (!o.phone) { if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true }); else await p.click('#stage', { force: true }); }
  else await p.evaluate(() => { const i = (window as any).__fps.input(); i.fallback = true; });
  await p.evaluate(() => { const f = (window as any).__fps; const room = [...f.host().hub.rooms.values()][0]; for (const m of room.members.values()) if (m.bot) m.brain = null; });
  await sleep(3500); // spawn banner and hints settle
  // The fake clock (see scripts/melee-footage.ts for why the host is rebased).
  await p.evaluate(() => { const h = (window as any).__fps.host(); (window as any).__h0 = h.now(); h.pause(); });
  await p.clock.install();
  await p.clock.pauseAt((await p.evaluate(() => Date.now())) + 200);
  await p.evaluate(() => {
    const h = (window as any).__fps.host();
    h.pausedAt = -1;
    h.pausedTotal = performance.now() - (window as any).__h0;
    for (const room of h.hub.rooms.values()) { room.lastUpdate = h.now(); room.acc = 0; }
    h.timer = setInterval(() => { if (h.pausedAt < 0) h.hub.update(); }, 1000 / 120);
  });
  await run(p, 5000); // the spawn banner and hints time out
  return p;
}

const want = (k: string) => !ONLY || ONLY.has(k);

// The staged scenes use the open lane in front of the turquoise house
// (x 4 to 11.5, z -7.6 to -3), clear of the bench, planters and fountain.
const LANE_Z = -5.6;

async function desktop(p: Page): Promise<void> {
  // Both teams side by side, first person, close and at combat distance.
  if (want('teams')) {
    const bots = { ally: { at: [6.4, -6.2] as [number, number] }, foe: { at: [7.6, -6.2] as [number, number] } };
    await stage(p, { me: [7, -4.2], look: [7, 1.25, -6.2], bots });
    await shot(p, 'teams-2m', 'Both teams, 2 m, first person (Sol left, Luna right)');
    await stage(p, { me: [7, -0.2], look: [7, 1.1, -6.2], bots });
    await shot(p, 'teams-6m', 'Both teams, 6 m, first person');
    await stage(p, { me: [7, 3.8], look: [7, 1.0, -6.2], bots });
    await shot(p, 'teams-10m', 'Both teams, 10 m, first person');
  }
  // Backgrounds: the café door, shade, bright paving (an enemy, at 4-5 m).
  if (want('backgrounds')) {
    await stage(p, { me: [-0.8, -3.2], look: [-1.0, 1.2, -7.4], bots: { foe: { at: [-1.0, -7.3] } } });
    await shot(p, 'bg-cafe-door', 'An enemy against the café door, 4 m');
    await stage(p, { me: [-20.5, 2.0], look: [-22.0, 1.2, -2.2], bots: { foe: { at: [-22.0, -2.2] } } });
    await shot(p, 'bg-shade', 'An enemy in the shade of the west houses, 4.5 m');
    await stage(p, { me: [-7.0, 1.4], look: [-7.0, 1.1, 5.8], bots: { foe: { at: [-7.0, 5.8] } } });
    await shot(p, 'bg-paving', 'An enemy on bright paving, 4.4 m');
  }
  // Movement, third person (own hand hidden), side-on at 4 m.
  if (want('move')) {
    const look: [number, number, number] = [7.5, 1.0, LANE_Z];
    await stage(p, { me: [7.5, -1.6], look, spectate: true, bots: { foe: { at: [4.6, LANE_Z], face: [11, LANE_Z] } } });
    await drive(p, 'foe', { mz: 1, yaw: -Math.PI / 2 });
    await run(p, 420);
    await shot(p, 'move-walk-a', 'Walking (6 m/s), third person, own hand hidden');
    await run(p, 83);
    await shot(p, 'move-walk-b', 'Walking, 83 ms later');
    await drive(p, 'foe', { mx: -1, yaw: 0 });
    await run(p, 300);
    await shot(p, 'move-strafe', 'Strafing while facing away from the camera');
    await drive(p, 'foe', { mz: 1, yaw: Math.PI / 2, press: 2 });
    await run(p, 330);
    await shot(p, 'move-jump', 'Jumping (near the top)');
    await run(p, 380);
    await shot(p, 'move-land', 'Landing');
    await drive(p, 'foe', null);
    await run(p, 700);
    await shot(p, 'move-idle', 'Standing');
  }
  // Attacks, third person, side-on 2.8 m: Chanclazo hit, Revés head hit with a roller, a miss, a throw.
  if (want('attacks')) {
    const duel = { me: [7.45, -2.8] as [number, number], look: [7.45, 1.3, LANE_Z] as [number, number, number], spectate: true };
    const A: [number, number] = [6.8, LANE_Z], B: [number, number] = [8.1, LANE_Z];
    const bots = { ally: { at: A, face: B, weapon: 0 as const }, foe: { at: B, face: A } };
    await stage(p, { ...duel, bots });
    await drive(p, 'ally', { face: [B[0], 1.45, B[1]], press: 8, weapon: 0 });
    await run(p, 150);
    await shot(p, 'atk-chanclazo-contact', 'El Chanclazo, contact (a hit)');
    await run(p, 120);
    await shot(p, 'atk-chanclazo-after', 'El Chanclazo, follow-through and reaction');
    await drive(p, 'ally', null);
    await run(p, 900);
    await stage(p, { ...duel, bots: { ...bots, ally: { ...bots.ally, weapon: 1 } } });
    await drive(p, 'ally', { face: [B[0], 1.52, B[1]], press: 8, weapon: 1 });
    await run(p, 230);
    await shot(p, 'atk-reves-windup', 'El Revés, wind-up');
    await run(p, 100);
    await shot(p, 'atk-reves-contact', 'El Revés, contact to the face');
    await run(p, 120);
    await shot(p, 'atk-reves-roller', 'El Revés, the head reaction and a rulero in the air');
    await drive(p, 'ally', null);
    await run(p, 1200);
    await stage(p, { ...duel, bots: { ...bots, foe: { at: [9.6, LANE_Z], face: A } } });
    await drive(p, 'ally', { face: [9.6, 1.45, LANE_Z], press: 8, weapon: 0 });
    await run(p, 200);
    await shot(p, 'atk-miss', 'El Chanclazo out of reach: a miss');
    await run(p, 150);
    await shot(p, 'atk-miss-after', 'The miss, follow-through');
    await drive(p, 'ally', null);
    await run(p, 900);
    await stage(p, { me: [7.9, -2.0], look: [8.4, 1.3, LANE_Z], spectate: true, bots: { ally: { at: [5.6, LANE_Z], face: [11.0, LANE_Z], weapon: 0 }, foe: { at: [11.0, LANE_Z], face: [5.6, LANE_Z] } } });
    await drive(p, 'ally', { face: [11.0, 1.3, LANE_Z], press: 1, weapon: 0 });
    await run(p, 70);
    await shot(p, 'atk-throw-release', 'A throw, release');
    await run(p, 180);
    await shot(p, 'atk-throw-flight', 'A throw, the chancla in flight');
    await run(p, 400);
    await shot(p, 'atk-throw-impact', 'A throw, the impact on the target');
    await drive(p, 'ally', null);
    await run(p, 800);
  }
  // First person: your own Revés to the face.
  if (want('fp')) {
    await stage(p, { me: [6.8, LANE_Z], look: [8.1, 1.55, LANE_Z], bots: { foe: { at: [8.1, LANE_Z] } } });
    await p.evaluate(() => { (window as any).__fps.input().weapon = 1; });
    await run(p, 500);
    await p.keyboard.press('KeyV');
    await run(p, 330);
    await shot(p, 'fp-reves-contact', 'First person: El Revés to the face');
    await run(p, 150);
    await shot(p, 'fp-reves-after', 'First person: the reaction and the rulero');
    await p.evaluate(() => { (window as any).__fps.input().weapon = 0; });
    await run(p, 1200);
  }
}

async function crowd(p: Page): Promise<void> {
  // Four Rosas, two fights at once, overlapping effects, at about 4 m.
  await stage(p, {
    me: [7.4, -1.6], look: [7.6, 1.2, LANE_Z], spectate: true,
    bots: { ally: { at: [6.2, LANE_Z], face: [7.4, LANE_Z], weapon: 1 }, foe: { at: [7.4, LANE_Z], face: [6.2, LANE_Z] }, foe2: { at: [9.4, -6.4], face: [6.2, LANE_Z] } },
  });
  await p.evaluate(() => { const f = (window as any).__fps; const room = [...f.host().hub.rooms.values()][0]; const me = room.sim.players.get(f.session().id); const a2 = [...room.sim.players.values()].find((q: any) => q.isBot && q.team === me.team && q.id !== (window as any).__bots.ally); if (a2) { a2.body.x = 8.8; a2.body.z = -5.2; a2.body.vx = a2.body.vz = 0; a2.yaw = Math.atan2(-(9.4 - 8.8), -(-6.4 + 5.2)); a2.weapon = 0; a2.protectedUntil = 0; (window as any).__bots.ally2 = a2.id; } });
  await run(p, 200);
  await drive(p, 'ally', { face: [7.4, 1.52, LANE_Z], press: 8, weapon: 1 });
  await drive(p, 'foe2', { face: [6.2, 1.3, LANE_Z], press: 1, weapon: 0 });
  await drive(p, 'ally2' as Who, { face: [9.4, 1.45, -6.4], press: 8, weapon: 0 });
  await run(p, 340);
  await shot(p, 'crowd-overlap', 'Four Rosas, two attacks and a throw at once (own hand hidden)');
  await run(p, 160);
  await shot(p, 'crowd-overlap-b', 'The same, 160 ms later');
  for (const k of ['ally', 'foe2', 'ally2']) await drive(p, k as Who, null);
  await run(p, 900);
}

async function phone(p: Page): Promise<void> {
  await stage(p, { me: [7, -1.8], look: [7, 1.2, -6.2], bots: { ally: { at: [6.4, -6.2] }, foe: { at: [7.6, -6.2] } } });
  await shot(p, 'phone-low-teams', 'Phone landscape, Low: both teams at 4.4 m');
  const A: [number, number] = [6.8, LANE_Z], B: [number, number] = [8.1, LANE_Z];
  await stage(p, { me: [7.45, -2.8], look: [7.45, 1.3, LANE_Z], bots: { ally: { at: A, face: B, weapon: 1 }, foe: { at: B, face: A } } });
  await drive(p, 'ally', { face: [B[0], 1.52, B[1]], press: 8, weapon: 1 });
  await run(p, 340);
  await shot(p, 'phone-low-reves', 'Phone landscape, Low: El Revés to the face, 2.8 m');
  await run(p, 160);
  await shot(p, 'phone-low-reves-b', 'Phone landscape, Low: the reaction and the rulero');
}

// ---------------------------------------------------------------- the clip

let frame = 0;
const marks: Array<{ frame: number; label: string }> = [];
async function film(p: Page, ms: number, stepMs = 1000 / 30): Promise<void> {
  for (let t = 0; t < ms - 1e-6; t += stepMs) {
    await p.clock.runFor(stepMs);
    await snap(p, path.join(OUT, `f-${String(frame++).padStart(4, '0')}.png`));
  }
}
const mark = (label: string) => marks.push({ frame, label });

/** A short clip: movement, both melee attacks, a miss, a throw and a rulero head hit (VIDEO=1). */
async function clip(p: Page): Promise<void> {
  await stage(p, { me: [7.5, -1.4], look: [7.5, 1.0, LANE_Z], spectate: true, bots: { foe: { at: [4.4, LANE_Z], face: [11, LANE_Z] } } });
  mark('Walking, strafing, a jump and landing (third person, own hand hidden)');
  await film(p, 300);
  await drive(p, 'foe', { mz: 1, yaw: -Math.PI / 2 });
  await film(p, 1000);
  await drive(p, 'foe', { mx: -1, yaw: 0 });
  await film(p, 700);
  await drive(p, 'foe', { mz: -1, yaw: Math.PI / 2, press: 2 });
  await film(p, 900);
  await drive(p, 'foe', null);
  await film(p, 600);
  const A: [number, number] = [6.8, LANE_Z], B: [number, number] = [8.1, LANE_Z];
  const duel = { me: [7.45, -2.8] as [number, number], look: [7.45, 1.3, LANE_Z] as [number, number, number], spectate: true };
  await stage(p, { ...duel, bots: { ally: { at: A, face: B, weapon: 0 }, foe: { at: B, face: A } } });
  mark('El Chanclazo: a hit (25)');
  await film(p, 200);
  await drive(p, 'ally', { face: [B[0], 1.45, B[1]], press: 8, weapon: 0 });
  await film(p, 900);
  await drive(p, 'ally', null);
  await stage(p, { ...duel, bots: { ally: { at: A, face: B, weapon: 1 }, foe: { at: B, face: A } } });
  mark('El Revés to the face (45): a rulero flies');
  await film(p, 200);
  await drive(p, 'ally', { face: [B[0], 1.52, B[1]], press: 8, weapon: 1 });
  await film(p, 1500);
  await drive(p, 'ally', null);
  await stage(p, { ...duel, bots: { ally: { at: A, face: B, weapon: 0 }, foe: { at: [9.6, LANE_Z], face: A } } });
  mark('El Chanclazo out of reach: a miss');
  await film(p, 200);
  await drive(p, 'ally', { face: [9.6, 1.45, LANE_Z], press: 8, weapon: 0 });
  await film(p, 1000);
  await drive(p, 'ally', null);
  await stage(p, { me: [7.9, -2.0], look: [8.4, 1.3, LANE_Z], spectate: true, bots: { ally: { at: [5.6, LANE_Z], face: [11.0, LANE_Z], weapon: 0 }, foe: { at: [11.0, LANE_Z], face: [5.6, LANE_Z] } } });
  mark('A throw: La Chancla hits');
  await film(p, 200);
  await drive(p, 'ally', { face: [11.0, 1.3, LANE_Z], press: 1, weapon: 0 });
  await film(p, 1200);
  await drive(p, 'ally', null);
  await stage(p, { me: A, look: [B[0], 1.55, B[1]], bots: { foe: { at: B } } });
  await p.evaluate(() => { (window as any).__fps.input().weapon = 1; });
  await run(p, 600);
  mark('First person: El Revés to the face');
  await film(p, 200);
  await p.keyboard.press('KeyV');
  await film(p, 1300);
  await p.evaluate(() => { (window as any).__fps.input().weapon = 0; });
  await run(p, 600);
  // Three-quarter, behind the attacker's right shoulder, the recipient's face toward the camera.
  await stage(p, { me: [5.0, -3.6], look: [7.8, 1.5, -5.7], spectate: true, bots: { ally: { at: A, face: B, weapon: 1 }, foe: { at: B, face: A } } });
  mark('SLOW MOTION x4: El Revés to the face, three-quarter view');
  await film(p, 60, 1000 / 120);
  await drive(p, 'ally', { face: [B[0], 1.52, B[1]], press: 8, weapon: 1 });
  await film(p, 900, 1000 / 120);
  await drive(p, 'ally', null);
}

async function main(): Promise<void> {
  let preview: ChildProcess | null = null;
  if (!(await waitHttp(SITE, 500))) {
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST], { cwd: ROOT, stdio: 'ignore' });
    if (!(await waitHttp(SITE))) throw new Error('preview did not start');
  }
  const browser = await launch();
  try {
    if (process.env.VIDEO) {
      const p = await startPractice(browser, { quality: 'high', viewport: { width: 960, height: 540 }, allies: 1, enemies: 1 });
      await clip(p);
      await p.context().close();
      fs.writeFileSync(path.join(OUT, 'marks.json'), JSON.stringify({ fps: 30, frames: frame, marks }, null, 1));
      console.log(`${frame} frames; ${marks.map((m) => `${m.frame} ${m.label}`).join(' | ')}`);
      return;
    }
    for (const q of (process.env.QUALITIES || 'high').split(',')) {
      const p = await startPractice(browser, { quality: q, viewport: { width: 960, height: 540 }, allies: 1, enemies: 1 });
      const before = shots.length;
      await desktop(p);
      for (const s of shots.slice(before)) { const f = s.file.replace('.png', `-${q}.png`); fs.renameSync(path.join(OUT, s.file), path.join(OUT, f)); s.file = f; s.label += ` (${q})`; }
      await p.context().close();
    }
    if (want('crowd')) {
      const p = await startPractice(browser, { quality: 'high', viewport: { width: 960, height: 540 }, allies: 2, enemies: 2 });
      await crowd(p);
      await p.context().close();
    }
    if (process.env.PHONE) {
      const p = await startPractice(browser, { quality: 'low', viewport: { width: 844, height: 390 }, phone: true, allies: 1, enemies: 1 });
      await phone(p);
      await p.context().close();
    }
  } finally {
    await browser.close();
    preview?.kill();
  }
  fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify(shots, null, 1));
  console.log(`${shots.length} shots in ${OUT}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
