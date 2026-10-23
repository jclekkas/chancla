// Gameplay footage for review: offline practice on El Patio, the real game
// with its HUD. The page runs on a fake clock that advances exactly 1/30 s
// per captured frame, so the clip plays at true speed although the software
// renderer is slow. The scenes are staged on the practice host (positions,
// health); every swing, hit, roller and elimination is the real game's.
//
//   GRAPHICS_EXPERIMENT=1 npm run build && OUT=<dir> node --import tsx scripts/melee-footage.ts
//   then: ffmpeg -framerate 30 -i <dir>/f-%04d.png ... (see the end of this file)
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Page } from 'playwright-core';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.PORT || 4186);
const SITE = `http://localhost:${PORT}/`;
const DIST = path.resolve(process.env.DIST || path.join(ROOT, 'dist'));
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'footage'));
const QUALITY = process.env.QUALITY || 'high';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let frame = 0;
const marks: Array<{ frame: number; label: string }> = [];

async function waitHttp(url: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

async function advance(p: Page, ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 100) await p.clock.runFor(100);
}

async function shoot(p: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await p.clock.runFor(1000 / 30);
    await p.screenshot({ path: path.join(OUT, `f-${String(frame++).padStart(4, '0')}.png`) });
  }
}

// Rosa at (x, z) looking at (lx, ly, lz); the foe `dist` m in front of her, facing her.
async function stage(p: Page, o: { me: [number, number]; look: [number, number, number]; foe?: [number, number, number]; ally?: [number, number, number]; hp?: number; weapon?: 0 | 1 }): Promise<void> {
  await p.evaluate((o) => {
    const f = (window as any).__fps; const s = f.session(); const room = [...f.host().hub.rooms.values()][0];
    for (const m of room.members.values()) if (m.bot) m.brain = null;
    const me = room.sim.players.get(s.id);
    const foe = [...room.sim.players.values()].find((q: any) => q.isBot && q.team !== me.team);
    const ally = [...room.sim.players.values()].find((q: any) => q.isBot && q.team === me.team);
    for (const b of [me.body, s.body]) { b.x = o.me[0]; b.z = o.me[1]; b.y = 0; b.vx = b.vy = b.vz = 0; }
    const put = (q: any, at: number[]) => { q.body.x = at[0]; q.body.z = at[1]; q.body.y = 0; q.body.vx = q.body.vz = 0; q.yaw = at[2]; q.protectedUntil = 0; };
    if (foe) { if (o.foe) put(foe, o.foe); else { foe.body.x = 40; foe.body.z = 40; } if (o.hp !== undefined) foe.hp = o.hp; }
    if (ally) { if (o.ally) put(ally, o.ally); else { ally.body.x = -40; ally.body.z = 40; } }
    me.protectedUntil = 0;
    const i = f.input();
    const dx = o.look[0] - o.me[0], dz = o.look[2] - o.me[1], dy = o.look[1] - 1.58;
    i.yaw = Math.atan2(-dx, -dz); i.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    if (o.weapon !== undefined) i.weapon = o.weapon;
  }, o);
}

// A bot swings: one input on the host with the melee press, aimed at (x, y, z).
async function botSwing(p: Page, who: 'ally' | 'foe', at: [number, number, number], weapon: 0 | 1): Promise<void> {
  await p.evaluate(({ who, at, weapon }) => {
    const f = (window as any).__fps; const s = f.session(); const room = [...f.host().hub.rooms.values()][0];
    const me = room.sim.players.get(s.id);
    const q = [...room.sim.players.values()].find((x: any) => x.isBot && (who === 'ally' ? x.team === me.team : x.team !== me.team));
    const dx = at[0] - q.body.x, dz = at[2] - q.body.z, dy = at[1] - (q.body.y + 1.58);
    const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
    q.weapon = weapon; q.switchMs = 0;
    room.sim.queueInput(q.id, { seq: q.lastSeq + 1, mx: 0, mz: 0, yaw, pitch, buttons: 8, weapon });
  }, { who, at, weapon });
}

async function main(): Promise<void> {
  let preview: ChildProcess | null = null;
  if (!(await waitHttp(SITE, 500))) {
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST], { cwd: ROOT, stdio: 'ignore' });
    if (!(await waitHttp(SITE))) throw new Error('preview did not start');
  }
  const browser = await launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
    const p = await ctx.newPage();
    await p.addInitScript({ content: `window.__name = (f) => f; try { localStorage.setItem('chancla.mp.settings.v1', JSON.stringify({ practiceMap: 'patio', practiceAllies: 1, practiceEnemies: 1, practiceDifficulty: 'easy', quality: '${QUALITY}', qualityMode: '${QUALITY}', music: 0 })); } catch {}` });
    await p.goto(SITE);
    await p.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { polling: 100 });
    await sleep(600);
    await p.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
    await p.evaluate(() => (document.getElementById('btn-practice-start') as HTMLElement).click());
    await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing', undefined, { timeout: 30000, polling: 100 });
    await p.waitForFunction(() => (window as any).__fps.session()?.alive, undefined, { timeout: 15000, polling: 100 });
    if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true }); else await p.click('#stage', { force: true });
    await sleep(3000); // spawn banner and the melee hint settle
    // From here the page runs on a fake clock. The practice host's tick timer
    // was made before it, so it is made again on the fake clock.
    // The host's clock must carry on from where it was (performance.now
    // jumps when the fake clock takes over), or the room would sit idle
    // working off a negative time debt.
    // The host is paused across the switch (its old timer ignores updates
    // while paused), and each room's time accumulator starts afresh.
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
    await advance(p, 600);

    // 1. El Chanclazo: a hit.
    await stage(p, { me: [-3, 3.4], look: [-1.7, 1.55, 3.4], foe: [-1.7, 3.4, Math.PI / 2], hp: 100, weapon: 0 });
    await shoot(p, 8);
    marks.push({ frame, label: 'El Chanclazo: hit (25)' });
    await p.keyboard.press('KeyV');
    await shoot(p, 26);
    // 2. A miss: out of reach.
    await stage(p, { me: [-3, 3.4], look: [-0.3, 1.5, 3.4], foe: [-0.2, 3.4, Math.PI / 2], weapon: 0 });
    await shoot(p, 6);
    marks.push({ frame, label: 'A miss: out of reach' });
    await p.keyboard.press('KeyV');
    await shoot(p, 24);
    // 3. El Revés to the face: a roller flies.
    await p.keyboard.press('Digit2');
    await shoot(p, 12);
    await stage(p, { me: [-3, 3.4], look: [-1.7, 1.55, 3.4], foe: [-1.7, 3.4, Math.PI / 2], hp: 100, weapon: 1 });
    await shoot(p, 6);
    marks.push({ frame, label: 'El Revés: head hit, a rulero flies' });
    await p.keyboard.press('KeyV');
    await shoot(p, 48);
    // 4. Elimination by El Revés to the face: the rest scatter.
    await stage(p, { me: [-3, 3.4], look: [-1.7, 1.55, 3.4], foe: [-1.7, 3.4, Math.PI / 2], hp: 40, weapon: 1 });
    await shoot(p, 20);
    marks.push({ frame, label: 'El Revés: elimination, the ruleros scatter' });
    await p.keyboard.press('KeyV');
    await shoot(p, 66);
    // 5. Seen from the side: a bot's Chanclazo, then a bot's Revés, with a roller.
    await p.evaluate(() => { const i = (window as any).__fps.input(); i.weapon = 0; });
    await advance(p, 3600); // the foe respawns (not filmed)
    // Watching from the side, 2.8 m away: the ally (Sol) and the foe (Luna) face each other 1.3 m apart.
    await stage(p, { me: [-2.35, 6.2], look: [-2.35, 1.3, 3.4], ally: [-3.0, 3.4, -Math.PI / 2], foe: [-1.7, 3.4, Math.PI / 2], hp: 100, weapon: 0 });
    await shoot(p, 8);
    marks.push({ frame, label: 'Third person: El Chanclazo' });
    await botSwing(p, 'ally', [-1.7, 1.5, 3.4], 0);
    await shoot(p, 26);
    marks.push({ frame, label: 'Third person: El Revés, a rulero flies' });
    await botSwing(p, 'ally', [-1.7, 1.52, 3.4], 1);
    await shoot(p, 50);
    await ctx.close();
  } finally {
    await browser.close();
    preview?.kill();
  }
  fs.writeFileSync(path.join(OUT, 'marks.json'), JSON.stringify({ fps: 30, frames: frame, marks }, null, 1));
  console.log(`${frame} frames; marks: ${marks.map((m) => `${m.frame} ${m.label}`).join(' | ')}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
