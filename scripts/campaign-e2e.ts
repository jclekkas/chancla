// Browser end-to-end run of the campaign: real page, real UI, the helper
// bot driving Rosa (aim and movement are scripted; everything else is the
// shipping game). Starts from a fresh save, plays the missions in order,
// checks results and progress, replays one, and records each mission as a
// video with the game's own audio mix (captured from Web Audio) muxed in.
//
//   npm run build && node --import tsx scripts/campaign-e2e.ts [missions=all] [--no-video]
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import type { Browser, Page } from 'playwright-core';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';
import { MISSIONS } from '../shared/campaign/missions';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'artifacts/campaign');
const SITE = process.env.E2E_URL || 'http://localhost:4173/';
const only = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2].split(',') : MISSIONS.map((m) => m.id);
const VIDEO = !process.argv.includes('--no-video');
fs.mkdirSync(OUT, { recursive: true });

// Moments worth a screenshot, per mission: event kind (+ id) -> file name.
const SHOTS: Record<string, Array<{ when: (e: Record<string, unknown>) => boolean; name: string; delay?: number }>> = {
  ruleros: [
    { when: (e) => e.k === 'hit' && e.id === 'latch', name: 'latch', delay: 300 },
    { when: (e) => e.k === 'hit' && e.id === 'wedged', name: 'bankshot', delay: 200 },
    { when: (e) => e.k === 'actor' && e.id === 'influ' && e.mode === 'pose', name: 'influencer-pose', delay: 600 },
    { when: (e) => e.k === 'remove' && e.id === 'tower', name: 'box-tower', delay: 200 },
    { when: (e) => e.k === 'stage' && e.id === 'cart', name: 'cart-chase', delay: 2500 },
  ],
  cocina: [
    { when: (e) => e.k === 'collect' && e.item === 'ingredient', name: 'ingredient', delay: 200 },
    { when: (e) => e.k === 'actor' && e.mode === 'film', name: 'influencer-blocks', delay: 300 },
    { when: (e) => e.k === 'actor' && e.mode === 'warn', name: 'speaker-warn', delay: 400 },
    { when: (e) => e.k === 'say' && e.line === 'timer_haywire', name: 'timer', delay: 600 },
    { when: (e) => e.k === 'carry', name: 'tray', delay: 1200 },
  ],
  patio: [
    { when: (e) => e.k === 'remove', name: 'switch-clears-pile', delay: 250 },
    { when: (e) => e.k === 'telegraph' && String(e.src).startsWith('blow'), name: 'leaf-blower-gust', delay: 700 },
    { when: (e) => e.k === 'hit' && e.bank === true, name: 'bank-decoration', delay: 300 },
    { when: (e) => e.k === 'carry', name: 'chairs', delay: 500 },
  ],
  pinata: [
    { when: (e) => e.k === 'stage', name: 'phase1', delay: 4000 },
    { when: (e) => e.k === 'phase' && e.n === 2, name: 'phase2', delay: 3500 },
    { when: (e) => e.k === 'phase' && e.n === 3, name: 'phase3', delay: 2500 },
    { when: (e) => e.k === 'phase' && e.n === 4, name: 'break', delay: 400 },
  ],
};

const report: Record<string, unknown> = { startedAt: new Date().toISOString(), missions: {} as Record<string, unknown> };
const t0 = Date.now();
const log = (s: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s ${s}`);

async function waitHttp(url: string): Promise<boolean> {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 250)); }
  return false;
}

async function main(): Promise<void> {
  let preview: ChildProcess | null = null;
  if (!process.env.E2E_URL && !(await waitHttp(SITE).catch(() => false))) {
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
    await waitHttp(SITE);
  }
  const browser: Browser = await launch(['--mute-audio']);
  try {
    // Fresh save, Spanish subtitles shown in English UI to prove the option works.
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, ...(VIDEO ? { recordVideo: { dir: OUT, size: { width: 960, height: 540 } } } : {}) });
    await ctx.addInitScript({ content: 'window.__name = (f) => f;' });
    const page = await ctx.newPage();
    page.setDefaultTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|status of 404/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    const videoStart = Date.now();
    await page.goto(SITE);
    await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
    await page.evaluate(() => localStorage.removeItem('chancla.campaign.v1'));
    // Running a subset: mark the missions before it as done so it is unlocked.
    const first = MISSIONS.findIndex((m) => only.includes(m.id));
    if (first > 0) {
      const done = Object.fromEntries(MISSIONS.slice(0, first).map((m) => [m.id, { completed: true, bestMs: null, challenges: { complete: true, time: false, skill: false }, plays: 1 }]));
      await page.evaluate((d) => localStorage.setItem('chancla.campaign.v1', JSON.stringify({ v: 1, missions: d })), done);
      await page.reload();
      await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
    }
    // Start audio capture on the first click (user gesture unlocks audio).
    await page.click('#btn-campaign');
    await page.waitForFunction(() => (window as any).__fps.screen === 'campaign');
    const locked = await page.evaluate(() => [...document.querySelectorAll('.mcard')].map((c) => c.classList.contains('locked')));
    report.freshSaveLocks = locked;
    await page.screenshot({ path: path.join(OUT, '00-select-fresh.png') });
    for (const id of MISSIONS.map((m) => m.id)) {
      if (!only.includes(id)) continue;
      await playMission(page, id, videoStart);
    }
    // Progress persisted and the next mission unlocked.
    await page.reload();
    await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
    await page.click('#btn-campaign');
    await page.waitForTimeout(300);
    report.afterReloadLocks = await page.evaluate(() => [...document.querySelectorAll('.mcard')].map((c) => c.classList.contains('locked')));
    report.afterReloadDone = await page.evaluate(() => [...document.querySelectorAll('.mcard')].map((c) => c.classList.contains('done')));
    await page.screenshot({ path: path.join(OUT, '99-select-after.png') });
    report.errors = errors.slice(0, 30);
    await ctx.close();
    const vid = await page.video()?.path();
    if (vid && fs.existsSync(vid)) { fs.renameSync(vid, path.join(OUT, 'campaign-run.webm')); report.video = 'artifacts/campaign/campaign-run.webm'; }
  } finally {
    await browser.close();
    preview?.kill();
  }
  muxAudio();
}

async function playMission(page: Page, id: string, videoStart: number): Promise<void> {
  const m = MISSIONS.find((x) => x.id === id)!;
  const r: Record<string, unknown> = {};
  (report.missions as Record<string, unknown>)[id] = r;
  if (await page.isVisible('#scr-mresults')) await page.click('#btn-mr-select');
  if (!(await page.isVisible('#scr-campaign'))) { await page.evaluate(() => (window as any).__fps.campaign().openSelect()); }
  await page.click(`.mcard[data-mission="${id}"] button`);
  await page.waitForFunction(() => (window as any).__fps.screen === 'mintro');
  await page.screenshot({ path: path.join(OUT, `${m.order}-${id}-intro.png`) });
  await page.click('#btn-mi-start');
  await page.waitForFunction(() => (window as any).__fps.campaign().active);
  r.startedAtVideoS = (Date.now() - videoStart) / 1000;
  // Begin recording the game's audio for this mission.
  await page.evaluate(() => {
    const w = window as any;
    const stream = w.__fps.audio?.().captureStream?.();
    if (!stream || typeof MediaRecorder === 'undefined') { w.__rec = null; return; }
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.start(1000);
    w.__rec = { rec, chunks };
  });
  log(`${id}: started`);
  await page.evaluate(() => (window as any).__fps.campaign().runtime.enableAutopilot(11));
  const shots = SHOTS[id] ?? [];
  const taken = new Set<string>();
  let seen = 0;
  const deadline = Date.now() + 15 * 60 * 1000;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`${id}: did not finish`);
    const st = await page.evaluate((from) => {
      const c = (window as any).__fps.campaign();
      const rt = c.runtime;
      if (!rt) return { done: true, events: [], t: 0 };
      const ev = rt.eventLog.slice(from).map((e: any) => ({ ...e }));
      return { done: false, events: ev, n: rt.eventLog.length, t: rt.sim.state.timeMs, stage: rt.sim.stageDef.id, victory: rt.inVictory, subs: document.getElementById('subs')!.hidden ? '' : document.getElementById('subs')!.textContent };
    }, seen);
    if (st.done) break;
    seen = (st as { n: number }).n;
    for (const e of st.events as Array<Record<string, unknown>>) {
      for (const s of shots) {
        if (taken.has(s.name) || !s.when(e)) continue;
        taken.add(s.name);
        await page.waitForTimeout(s.delay ?? 0);
        await page.screenshot({ path: path.join(OUT, `${m.order}-${id}-${s.name}.png`) });
        log(`${id}: shot ${s.name}`);
      }
    }
    if ((st as { victory: boolean }).victory && !taken.has('victory')) {
      taken.add('victory');
      await page.waitForTimeout(1800);
      await page.screenshot({ path: path.join(OUT, `${m.order}-${id}-victory.png`) });
    }
    if ((st as { subs: string }).subs && !taken.has('subtitle')) { taken.add('subtitle'); await page.screenshot({ path: path.join(OUT, `${m.order}-${id}-subtitle.png`) }); }
    await page.waitForTimeout(300);
  }
  await page.waitForFunction(() => (window as any).__fps.screen === 'mresults');
  r.endedAtVideoS = (Date.now() - videoStart) / 1000;
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${m.order}-${id}-results.png`) });
  r.results = await page.evaluate(() => ({ stats: document.getElementById('mr-stats')!.textContent, ch: [...document.querySelectorAll('#mr-ch li')].map((li) => li.className) }));
  r.dialogue = await page.evaluate(() => (window as any).__fps.dialogue().log.map((l: any) => l.id));
  r.dropped = await page.evaluate(() => (window as any).__fps.dialogue().dropped);
  r.shots = [...taken];
  // Save the audio recording.
  const b64: string | null = await page.evaluate(async () => {
    const w = window as any;
    if (!w.__rec) return null;
    const { rec, chunks } = w.__rec;
    await new Promise<void>((res) => { rec.onstop = () => res(); rec.stop(); });
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  if (b64) { fs.writeFileSync(path.join(OUT, `${m.order}-${id}-audio.webm`), Buffer.from(b64, 'base64')); r.audio = `${m.order}-${id}-audio.webm`; }
  log(`${id}: results ${JSON.stringify(r.results)}`);
}

// Puts each mission's recorded audio under its stretch of the video.
function muxAudio(): void {
  const vid = path.join(OUT, 'campaign-run.webm');
  if (!fs.existsSync(vid)) return;
  for (const [id, raw] of Object.entries(report.missions as Record<string, Record<string, unknown>>)) {
    const m = MISSIONS.find((x) => x.id === id)!;
    if (!raw.audio || typeof raw.startedAtVideoS !== 'number' || typeof raw.endedAtVideoS !== 'number') continue;
    const a = path.join(OUT, raw.audio as string);
    const outFile = path.join(OUT, `${m.order}-${id}-gameplay.webm`);
    try {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(raw.startedAtVideoS), '-to', String(raw.endedAtVideoS), '-i', vid, '-i', a, '-map', '0:v', '-map', '1:a', '-c:v', 'libvpx-vp9', '-crf', '40', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '8', '-vf', 'scale=640:-2,fps=15', '-c:a', 'libopus', '-b:a', '64k', '-shortest', outFile]);
      raw.gameplay = path.relative(ROOT, outFile);
    } catch (e) { raw.muxError = String(e).slice(0, 200); }
  }
}

main()
  .catch((e) => { report.failure = String(e?.stack || e); console.error(e); process.exitCode = 1; })
  .finally(() => fs.writeFileSync(path.join(OUT, 'campaign-e2e.json'), JSON.stringify(report, null, 2)));
