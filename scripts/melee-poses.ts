// Pose sheets for reviewing the melee animations: the real game page and
// the real avatar and first-person code, with two Rosas posed at fixed
// moments of a swing (the display only; nothing is simulated). Writes:
//   poses-<attack>-3q.png   third person, three-quarter view: the attacker's
//                           right side and the recipient's face
//   poses-<attack>-side.png third person, the attacker's front-left
//   poses-<attack>-fp.png   first person
// for El Revés (heavy) and El Chanclazo (light), each frame labelled with its
// time and phase against the attack's contact window.
//
//   GRAPHICS_EXPERIMENT=1 npm run build && OUT=<dir> node --import tsx scripts/melee-poses.ts
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Page } from 'playwright-core';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';
import { MELEE } from '../shared/config';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.PORT || 4194);
const SITE = `http://localhost:${PORT}/`;
const DIST = path.resolve(process.env.DIST || path.join(ROOT, 'dist'));
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'docs/melee/poses'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

type View = '3q' | 'side' | 'fp';
const VIEWS: Record<View, { me: [number, number]; look: [number, number, number] }> = {
  // Attacker at (-3, 3.4) facing +x, recipient 1.3 m ahead facing her.
  // Three-quarter, behind the attacker and off her right shoulder: the sweep
  // runs across the frame and the recipient faces the camera.
  '3q': { me: [-5.0, 5.4], look: [-2.0, 1.5, 3.3] },
  // In front of the attacker, off to her left: her face and chest, the
  // wind-up across her chest, the sweep seen mirrored.
  side: { me: [-0.9, 1.9], look: [-2.45, 1.45, 3.4] },
  fp: { me: [-3, 3.4], look: [-1.7, 1.55, 3.4] },
};

async function pose(p: Page, view: View, weapon: 0 | 1, t: number): Promise<void> {
  await p.evaluate(({ v, weapon, t }) => {
    const f = (window as any).__fps; const s = f.session(); const e = f.engine();
    const ids = [...s.remotes.keys()];
    const st = (window as any).__pose ??= {};
    st.view = v; st.weapon = weapon; st.t = t; st.ids = ids;
    if (!st.patched) {
      st.patched = true;
      s.updateRemotes = () => {
        const P = (window as any).__pose;
        const fp = P.view.name === 'fp';
        const base = { y: 0, pitch: 0, vx: 0, vz: 0, alive: true, crouched: false, onGround: true, protected: false, connected: true, hp: 100, msSinceThrow: 1e6, msSinceHit: 1e6, ruleros: 15 };
        // The attacker (hidden in first person: that is you) and the recipient.
        s.remotes.set(P.ids[0], { ...base, id: P.ids[0], x: fp ? 40 : -3, z: fp ? 40 : 3.4, yaw: -Math.PI / 2, weapon: P.weapon, msSinceMelee: fp ? 1e6 : P.t });
        s.remotes.set(P.ids[1], { ...base, id: P.ids[1], x: -1.7, z: 3.4, yaw: Math.PI / 2, weapon: 0, msSinceMelee: 1e6 });
        for (const b of [s.body]) { b.x = P.view.me[0]; b.z = P.view.me[1]; b.y = 0; b.vx = b.vz = b.vy = 0; }
        const dx = P.view.look[0] - P.view.me[0], dz = P.view.look[2] - P.view.me[1], dy = P.view.look[1] - 1.58;
        f.input().yaw = Math.atan2(-dx, -dz); f.input().pitch = Math.atan2(dy, Math.hypot(dx, dz));
        // First person: your own swing at this moment.
        s.weapon = P.weapon; s.switchMs = 0; s.cooldownMs = 0;
        e.vm.root.scale.setScalar(fp ? 1 : 1e-4); // third-person views: hide your own hand
        if (fp) { s.meleeMs = 2000; s.swing = { seq: 0, weapon: P.weapon, hit: true }; e.localMeleeWeapon = P.weapon; e.lastLocalMelee = performance.now() - P.t; }
        else { s.meleeMs = 0; e.lastLocalMelee = -1e9; }
      };
    }
  }, { v: { name: view, ...VIEWS[view] }, weapon, t });
  await sleep(260); // a few frames at this pose
}

async function main(): Promise<void> {
  let preview: ChildProcess | null = null;
  if (!(await waitHttp(SITE, 500))) {
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST], { cwd: ROOT, stdio: 'ignore' });
    if (!(await waitHttp(SITE))) throw new Error('preview did not start');
  }
  const browser = await launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
    await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
    const p = await ctx.newPage();
    await p.addInitScript({ content: `window.__name = (f) => f; localStorage.setItem('chancla.mp.settings.v1', JSON.stringify({ practiceMap: 'patio', practiceAllies: 1, practiceEnemies: 1, practiceDifficulty: 'easy', quality: 'high', qualityMode: 'high', fov: 70 }));` });
    await p.goto(SITE);
    await p.waitForFunction(() => (window as any).__fps?.screen === 'title');
    await p.click('#btn-practice'); await p.click('#btn-practice-start');
    await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing' && (window as any).__fps.session()?.remotes.size >= 2, undefined, { timeout: 30000 });
    await p.click('#btn-click-play', { force: true }).catch(() => p.click('#stage', { force: true }));
    await p.evaluate(() => { const f = (window as any).__fps; const room = [...f.host().hub.rooms.values()][0]; for (const m of room.members.values()) if (m.bot) m.brain = null; document.getElementById('hud')!.style.opacity = '0'; });
    await sleep(500);
    for (const weapon of (process.env.WEAPONS ? process.env.WEAPONS.split(',').map(Number) : [1, 0]) as Array<0 | 1>) {
      const d = MELEE[weapon]!;
      const hit0 = d.windupMs, hit1 = d.windupMs + d.activeMs;
      const times = weapon === 1 ? [0, 120, 220, 285, 300, 330, 360, 390, 450, 560, 750, 1000] : [0, 50, 90, 120, 145, 170, 190, 240, 330, 450, 600, 690];
      const label = (t: number) => `${t} ms  ${t < hit0 ? 'wind-up' : t < hit1 ? 'CONTACT' : t < hit1 + 260 ? 'follow-through' : 'recovery'}`;
      for (const view of (process.env.VIEWS ? process.env.VIEWS.split(',') : ['3q', 'side', 'fp']) as View[]) {
        const files: string[] = [];
        for (const t of times) {
          await pose(p, view, weapon, t);
          const f = path.join(OUT, `_${weapon}-${view}-${t}.png`);
          await p.screenshot({ path: f });
          files.push(f);
        }
        fs.writeFileSync(path.join(OUT, `_${weapon}-${view}.json`), JSON.stringify(times.map((t, i) => ({ file: files[i], label: label(t) }))));
      }
    }
  } finally {
    await browser.close();
    preview?.kill();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
