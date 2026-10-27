// Mid-match quality change: switches the graphics quality several times during
// ROSA=candidate turns on the candidate Rosa model for team Sol (preview builds).
// an offline practice match, through the real settings buttons, and checks that
// the match carries on (same phase, health, score, weapon in hand), that the
// first-person hand is rebuilt for the tier, and that renderer memory does not
// grow across repeated round trips (no leaked geometries or textures).
//
//   DIST=<build> [PORT=4241] [OUT=<dir>] node --import tsx scripts/quality-switch-e2e.ts
// OUT also saves a labelled frame after each change (q-NN-<tier>.png) and, with
// ffmpeg, a slideshow of them (quality-change.mp4; stills, not real-time footage).
import path from 'node:path';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST || path.join(ROOT, 'dist'));
const PORT = Number(process.env.PORT || 4241);
const SITE = `http://localhost:${PORT}/`;
const OUT = process.env.OUT ? path.resolve(process.env.OUT) : null;
if (OUT) fs.mkdirSync(OUT, { recursive: true });
let shot = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
const browser = await launch(['--mute-audio']);
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(SITE)).ok) break; } catch { /* not yet */ } await sleep(250); }
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const p = await ctx.newPage();
  const settings = { practiceMap: 'patio', practiceAllies: 1, practiceEnemies: 1, practiceDifficulty: 'easy', quality: 'high', qualityMode: 'high', music: 0, lang: 'en', name: 'Rosa' };
  await p.addInitScript({ content: `window.__name = (f) => f; try { localStorage.setItem('chancla.mp.settings.v1', JSON.stringify(${JSON.stringify({ ...settings, ...(process.env.ROSA === 'candidate' ? { rosaCandidate: true } : {}) })})); } catch {}` });
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(SITE);
  await p.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { polling: 100 });
  await p.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
  await sleep(200);
  await p.evaluate(() => (document.getElementById('btn-practice-start') as HTMLElement).click());
  await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing' && (window as any).__fps.session()?.alive, undefined, { timeout: 60000, polling: 100 });
  // Bots hold still, nobody can be hurt, and La Pesada is in hand.
  await p.evaluate(() => {
    const f = (window as any).__fps, h = f.host(), room = [...h.hub.rooms.values()][0], sim = room.sim;
    for (const m of room.members.values()) if (m.bot) m.brain = null;
    for (const pl of sim.players.values()) pl.protectedUntil = 1e15;
    f.input().weapon = 1;
  });
  if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true }); else await p.click('#stage', { force: true });
  await p.waitForFunction(() => (window as any).__fps.engine().vm.shown === 1, undefined, { timeout: 20000, polling: 100 });
  await sleep(1500);

  const state = () => p.evaluate(() => {
    const f = (window as any).__fps, e = f.engine(), s = f.session(), room = [...f.host().hub.rooms.values()][0] as any;
    const me = room.sim.players.get(s.id);
    let tris = 0, meshes = 0;
    e.vm.root.traverse((o: any) => { if (o.isMesh && o.visible) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
    return {
      phase: s.phase, alive: s.alive, hp: me.hp, kills: me.stats.kills, deaths: me.stats.deaths, swings: me.stats.swings, weapon: me.weapon, shown: e.vm.shown,
      quality: e.quality, handTris: Math.round(tris), handMeshes: meshes, vmQuality: e.vm.quality ?? null,
      geometries: e.renderer.info.memory.geometries, textures: e.renderer.info.memory.textures, programs: e.renderer.info.programs?.length ?? 0,
      tick: room.sim.tick ?? null,
      rosa: e.rosaCandidateState?.() ?? null, solCandidate: [...e.avatars.values()].filter((a: any) => a.isCandidate).length,
    };
  });
  const setQ = async (q: string) => {
    await p.evaluate((q) => (document.querySelector(`[data-q="${q}"]`) as HTMLElement).click(), q);
    await p.waitForFunction((q) => (window as any).__fps.engine().quality === q, q, { timeout: 20000, polling: 100 });
    await sleep(2500);
    const st = await state();
    if (OUT) {
      await p.evaluate((t) => { let el = document.getElementById('__qlabel'); if (!el) { el = document.createElement('div'); el.id = '__qlabel'; el.style.cssText = 'position:fixed;left:50%;top:40%;transform:translateX(-50%);z-index:99;font:bold 20px sans-serif;color:#fff;background:#000a;padding:4px 10px;border-radius:4px'; document.body.appendChild(el); } el.textContent = t; }, `Quality: ${q}  hand ${st.handTris} tris  (still frame)`);
      await p.screenshot({ path: path.join(OUT, `q-${String(++shot).padStart(2, '0')}-${q}.png`) });
    }
    return st;
  };

  const s0 = await state();
  console.log('start', JSON.stringify(s0));
  const seq = ['low', 'medium', 'high', 'low', 'high', 'low', 'high'];
  const seen: Record<string, any[]> = {};
  for (const q of seq) {
    const s = await setQ(q);
    (seen[q] ||= []).push(s);
    console.log(q, JSON.stringify(s));
    check(`${q}: match continues`, s.phase === 'playing' && s.alive, `phase=${s.phase} alive=${s.alive}`);
    check(`${q}: health, kills and deaths unchanged`, s.hp === s0.hp && s.kills === s0.kills && s.deaths === s0.deaths, `hp=${s.hp} k=${s.kills} d=${s.deaths}`);
    if (process.env.ROSA === 'candidate') check(`${q}: candidate Sol rebuilt for the tier`, !!s.rosa?.ready && s.solCandidate > 0, JSON.stringify({ rosa: s.rosa, sol: s.solCandidate }));
    check(`${q}: La Pesada still in hand`, s.weapon === 1 && s.shown === 1, `sim=${s.weapon} shown=${s.shown}`);
  }
  // A swing right after a change still lands in the sim (the attack path is untouched).
  await setQ('medium');
  const before = (await state()).swings;
  await p.keyboard.press('KeyV');
  await sleep(2500);
  const after = (await state()).swings;
  check('El Revés swings right after a quality change', after === before + 1, `swings ${before} -> ${after}`);
  const hi = seen.high!, lo = seen.low!;
  check('hand triangles drop on low', lo[0].handTris < hi[0].handTris, `high=${hi[0].handTris} low=${lo[0].handTris} medium=${seen.medium![0].handTris}`);
  check('geometries stable across round trips (high)', hi[hi.length - 1].geometries <= hi[0].geometries, hi.map((s) => s.geometries).join(','));
  // The first switch to a tier builds its shared caches once; later visits must not add to them.
  check('geometries stable across round trips (low)', lo[lo.length - 1].geometries <= lo[1].geometries, lo.map((s) => s.geometries).join(','));
  check('textures stable across round trips', hi[hi.length - 1].textures <= hi[0].textures && lo[lo.length - 1].textures <= lo[1].textures, `high ${hi.map((s) => s.textures).join(',')} low ${lo.map((s) => s.textures).join(',')}`);
  if (OUT) spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '1', '-pattern_type', 'glob', '-i', path.join(OUT, 'q-*.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', path.join(OUT, 'quality-change.mp4')]);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
