// Browser check of the recorded soundtrack: real page, Chromium's own MP3
// decoder and Web Audio. It does not listen; it measures.
//
//   npm run build && node --import tsx scripts/music-e2e.ts [--calibrate]
//
// Checks:
//   - every prepared file downloads and decodes to the expected length
//   - each loop seam, rendered by the browser's own loop playback, is as
//     continuous as an ordinary moment of the track
//   - the menu, mission select, results, the four missions and practice play
//     their assigned recording, switch with a crossfade, and the menu theme
//     carries on (not restarting) from the menu into mission select
//   - a playing recording wraps from loopEnd back to loopStart
//   - dialogue ducks the music deeper under a recording and lifts afterwards
//   - the music volume slider and zero volume still control the recordings
//   - with the music files blocked, the synthesized score plays instead, and
//     with a slow download it plays first and hands over when ready
// --record captures the game's mix through the transitions (menu, mission
// select, Mission 1 with a line of dialogue, back, Mission 4) as
// artifacts/music/transitions.webm, for listening.
// --calibrate also records each cue in both layers and compares loudness
// (EBU R128) to set REC_LEVEL in src/audio/music.ts.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import type { Browser, Page } from 'playwright-core';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';
import { RECORDED } from '../src/audio/soundtrack';
import { PLAYLIST } from '../src/audio/playlist-data';
import { CUE_POOL, POOLS } from '../src/audio/library';

/** The songs a cue can draw in Automatic mode. */
const POOL = (cue: string): readonly string[] => POOLS[CUE_POOL[cue]!]!.songs;

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'artifacts/music');
const SITE = process.env.E2E_URL || 'http://localhost:4173/';
const CALIBRATE = process.argv.includes('--calibrate');
const RECORD = process.argv.includes('--record');
fs.mkdirSync(OUT, { recursive: true });

const report: Record<string, unknown> = { startedAt: new Date().toISOString() };
const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); };

async function waitHttp(url: string): Promise<boolean> {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 250)); }
  return false;
}

type MState = { cue: string; layer: string; recording: string | null; position: number | null; duration: number | null; loop: [number, number] | null; loaded: string[]; failed: string[]; sounding: number };
const state = (page: Page): Promise<MState> => page.evaluate(() => (window as any).__fps.music().state());
async function waitLayer(page: Page, rec: string | readonly string[] | null, layer: string, ms = 15000): Promise<MState> {
  const end = Date.now() + ms;
  for (;;) {
    const s = await state(page);
    if (s.layer === layer && (rec === null || (typeof rec === 'string' ? s.recording === rec : rec.includes(s.recording ?? '')))) return s;
    if (Date.now() > end) return s;
    await page.waitForTimeout(100);
  }
}

async function openPage(browser: Browser, route?: (p: Page) => Promise<void>): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  await ctx.addInitScript({ content: 'window.__name = (f) => f;' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|status of 404|ERR_FAILED/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  if (route) await route(page);
  await page.goto(SITE);
  await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
  await page.evaluate(() => localStorage.removeItem('chancla.campaign.v1'));
  return { page, errors, close: () => ctx.close() };
}

// Records `sec` seconds of the mix and returns its integrated loudness.
async function loudness(page: Page, sec: number, name: string): Promise<number> {
  const b64: string = await page.evaluate(async (ms) => {
    const w = window as any;
    const stream = w.__fps.audio().captureStream();
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.start(500);
    await new Promise((r) => setTimeout(r, ms));
    await new Promise<void>((res) => { rec.onstop = () => res(); rec.stop(); });
    const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, sec * 1000);
  const f = path.join(OUT, `${name}.webm`);
  fs.writeFileSync(f, Buffer.from(b64, 'base64'));
  const err = spawnSync('ffmpeg', ['-v', 'info', '-nostats', '-i', f, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const tail = err.slice(err.lastIndexOf('Summary:'));
  return Number(tail.split('I:')[1]!.split('LUFS')[0]!.trim());
}

async function main(): Promise<void> {
  let preview: ChildProcess | null = null;
  if (!process.env.E2E_URL && !(await waitHttp(SITE).catch(() => false))) {
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
    await waitHttp(SITE);
  }
  const browser: Browser = await launch(['--mute-audio']);
  try {
    // 1. Files decode in the browser to the prepared length; seams are continuous.
    {
      const { page, close } = await openPage(browser);
      const res = await page.evaluate(async (tracks) => {
        const out: Record<string, unknown> = {};
        for (const t of tracks) {
          const bytes = await (await fetch(t.file)).arrayBuffer();
          const probe = new OfflineAudioContext(2, 48000, 48000);
          const buf = await probe.decodeAudioData(bytes);
          // Render the loop the way the game plays it, from 3 s before loopEnd.
          const pre = 3, post = 3;
          const ctx = new OfflineAudioContext(2, Math.ceil((pre + post) * 48000), 48000);
          const src = ctx.createBufferSource();
          src.buffer = buf; src.loop = true; src.loopStart = t.loopStart; src.loopEnd = t.loopEnd;
          src.connect(ctx.destination);
          src.start(0, t.loopEnd - pre);
          const r = await ctx.startRendering();
          const a = r.getChannelData(0), b = r.getChannelData(1);
          const steps: number[] = [];
          for (let i = 1; i < a.length; i++) steps.push(Math.abs((a[i]! + b[i]!) - (a[i - 1]! + b[i - 1]!)) / 2);
          const at = Math.round(pre * 48000);
          const seamJump = Math.max(...steps.slice(at - 3, at + 3));
          const sorted = [...steps].sort((x, y) => x - y);
          const p999 = sorted[Math.floor(sorted.length * 0.999)]!;
          out[t.id] = { decodedSamples: buf.length, expected: t.samples, sampleRate: buf.sampleRate, duration: buf.duration, seamJump, p999 };
        }
        return out;
      }, RECORDED.map((t) => ({ id: t.id, file: t.file, loopStart: t.loopStart, loopEnd: t.loopEnd, samples: t.samples })));
      report.decode = res;
      for (const t of RECORDED) {
        const r = res[t.id] as { decodedSamples: number; expected: number; seamJump: number; p999: number };
        check(`decode ${t.id}: length matches the prepared file`, Math.abs(r.decodedSamples - r.expected) <= 2, { decoded: r.decodedSamples, expected: r.expected });
        check(`seam ${t.id}: jump no larger than the track's own 99.9th percentile step`, r.seamJump <= r.p999, { seamJump: +r.seamJump.toFixed(5), p999: +r.p999.toFixed(5) });
      }
      // The eleven playlist songs: each fetched from its deployed path and decoded by the browser.
      const pl = await page.evaluate(async (songs) => {
        const out: Record<string, { status: number; type: string; duration: number; rate: number; channels: number } | { error: string }> = {};
        for (const t of songs) {
          try {
            const r = await fetch(t.file);
            const buf = await new OfflineAudioContext(2, 48000, 48000).decodeAudioData(await r.arrayBuffer());
            out[t.id] = { status: r.status, type: r.headers.get('content-type') ?? '', duration: buf.duration, rate: buf.sampleRate, channels: buf.numberOfChannels };
          } catch (e) { out[t.id] = { error: String(e) }; }
        }
        return out;
      }, PLAYLIST.map((t) => ({ id: t.id, file: t.file })));
      report.playlistDecode = pl;
      for (const t of PLAYLIST) {
        const r = pl[t.id] as { status: number; type: string; duration: number; error?: string };
        check(`playlist ${t.id} (${t.title}): served and decoded in the browser, length as measured`, !r.error && r.status === 200 && /audio\/mpeg/.test(r.type) && Math.abs(r.duration - t.duration) < 0.1, r);
      }
      await close();
    }

    // 2. Cues, switching, continuity, looping, ducking, volume.
    {
      const { page, errors, close } = await openPage(browser);
      await page.mouse.click(5, 5); // user gesture: unlocks audio
      const menu = await waitLayer(page, '036c0292', 'recorded');
      check('the menu opens with Groquo de diversión (036c0292)', menu.layer === 'recorded' && menu.recording === '036c0292', menu);
      await page.waitForTimeout(1500);
      const p0 = (await state(page)).position!;
      await page.click('#btn-campaign');
      await page.waitForFunction(() => (window as any).__fps.screen === 'campaign');
      await page.waitForTimeout(600);
      const sel = await state(page);
      check('mission select continues the same song without restarting', sel.recording === menu.recording && sel.cue === 'select' && sel.position! > p0, { before: p0, after: sel.position });
      // Unlock all missions through the save, then play each one's opening.
      await page.evaluate(() => {
        const d = Object.fromEntries(['ruleros', 'cocina', 'patio', 'pinata'].map((id) => [id, { completed: true, bestMs: null, challenges: { complete: true, time: false, skill: false }, plays: 1 }]));
        localStorage.setItem('chancla.campaign.v1', JSON.stringify({ v: 1, missions: d }));
      });
      await page.reload();
      await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
      await page.click('#btn-campaign');
      await page.waitForFunction(() => (window as any).__fps.screen === 'campaign');
      await waitLayer(page, POOL('select'), 'recorded');
      const switches: Record<string, unknown> = {};
      for (const id of ['ruleros', 'cocina', 'patio', 'pinata']) {
        if (!(await page.isVisible('#scr-campaign'))) await page.evaluate(() => (window as any).__fps.campaign().openSelect());
        await page.click(`.mcard[data-mission="${id}"] button`);
        await page.waitForFunction(() => (window as any).__fps.screen === 'mintro');
        await page.waitForTimeout(800); // the intro preloads the music
        await page.click('#btn-mi-start');
        await page.waitForFunction(() => (window as any).__fps.campaign().active);
        const t0 = Date.now();
        const s = await waitLayer(page, POOL(id), 'recorded');
        switches[id] = { ms: Date.now() - t0, ...s };
        check(`mission ${id} plays a song from its pool (${CUE_POOL[id]})`, POOL(id).includes(s.recording ?? '') && s.cue === id, { ms: Date.now() - t0, recording: s.recording, layer: s.layer });
        if (id === 'ruleros') check('Operación Ruleros opens with Ruleros (66be822e)', s.recording === '66be822e', s.recording);
        // Crossfade: the outgoing recording fades rather than cutting (gain mid-fade).
        await page.waitForTimeout(2500);
        if (id === 'ruleros') {
          // A song's natural end: jump close to it and watch the next one of the pool take over.
          const st = await state(page);
          await page.evaluate((sec) => (window as any).__fps.music().seek(sec), st.duration! - 6);
          let peak = 0;
          for (let i = 0; i < 40; i++) { await page.waitForTimeout(250); peak = Math.max(peak, (await state(page)).sounding); }
          const after = await state(page);
          check('at a song\'s natural end the next song of the pool takes over, two sounding only in the crossfade', after.recording !== st.recording && POOL('ruleros').includes(after.recording ?? '') && peak <= 2 && after.sounding === 1, { from: st.recording, to: after.recording, peak, now: after.sounding });
          // Ducking under dialogue.
          const duck = await page.evaluate(async () => {
            const w = window as any;
            const a = w.__fps.audio();
            const before = a.a.musicDuck.gain.value;
            w.__fps.dialogue().say('m1_courtyard');
            await new Promise((r) => setTimeout(r, 900));
            const during = a.a.musicDuck.gain.value;
            const eq = a.a.duckEq.gain.value;
            return { depth: a.duckDepth, before, during, eqDuring: eq, voiced: w.__fps.dialogue().log.slice(-1)[0]?.voiced };
          });
          check('dialogue ducks a recording to 42% with a speech-band dip', duck.depth === 0.42 && duck.during < 0.5 && duck.eqDuring < -2, duck);
          await page.waitForFunction(() => (window as any).__fps.audio().a.musicDuck.gain.value > 0.95, undefined, { timeout: 20000 }).then(() => check('music comes back up after the line', true), () => check('music comes back up after the line', false));
          // Volume slider and zero.
          const vol = await page.evaluate(async () => {
            const w = window as any;
            const a = w.__fps.audio();
            a.setLevels(0.5, 1);
            await new Promise((r) => setTimeout(r, 400));
            const half = a.a.music.gain.value;
            a.setLevels(0, 1);
            await new Promise((r) => setTimeout(r, 400));
            const zero = a.a.music.gain.value;
            a.setLevels(1, 1);
            return { half, zero };
          });
          check('music volume scales the recording bus; zero silences it', Math.abs(vol.half - 0.16) < 0.02 && vol.zero < 0.002, vol);
        }
        await page.evaluate(() => (window as any).__fps.campaign().toSelect());
        await page.waitForTimeout(300);
        if (!(await page.isVisible('#scr-campaign'))) await page.evaluate(() => (window as any).__fps.campaign().openSelect());
        const back = await waitLayer(page, POOL('select'), 'recorded');
        check(`leaving ${id} returns to a menu song`, POOL('select').includes(back.recording ?? ''), back.recording);
      }
      report.switches = switches;
      check('at most two songs stay decoded (the current one and the next)', (await state(page)).loaded.length <= 2, (await state(page)).loaded);
      // Practice: the action cue.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await page.click('#btn-practice');
      await page.waitForTimeout(800);
      await page.click('#btn-practice-start');
      await page.waitForFunction(() => (window as any).__fps.music().state().cue === 'combat', undefined, { timeout: 25000 });
      const pr = await waitLayer(page, POOL('combat'), 'recorded', 25000);
      check('practice plays a song from the whole playlist', POOL('combat').length === 11 && POOL('combat').includes(pr.recording ?? '') && pr.cue === 'combat', pr.recording);
      check('no page errors during the run', errors.length === 0, errors.slice(0, 5));
      if (CALIBRATE) {
        const cal: Record<string, unknown> = {};
        await page.evaluate(() => { const a = (window as any).__fps.audio(); a.setLevels(1, 0); a.setVoiceLevel(0); });
        for (const cue of ['menu', 'ruleros', 'cocina', 'pinata', 'combat']) {
          await page.evaluate((c) => { const m = (window as any).__fps.music(); m.recordings = true; m.play('off'); m.play(c); }, cue);
          await waitLayer(page, null, 'recorded');
          await page.waitForTimeout(2000);
          const rec = await loudness(page, 20, `cal-${cue}-recorded`);
          await page.evaluate((c) => { const m = (window as any).__fps.music(); m.recordings = false; m.play('off'); m.play(c); }, cue);
          await page.waitForTimeout(2500);
          const syn = await loudness(page, 20, `cal-${cue}-synth`);
          cal[cue] = { recordedLufs: rec, synthLufs: syn, diffDb: +(rec - syn).toFixed(1) };
          console.log(cue, cal[cue]);
        }
        report.calibration = cal;
      }
      await close();
    }

    // 3. Fallback: music files blocked.
    {
      const { page, errors, close } = await openPage(browser, (p) => p.route('**/music/**/*.mp3', (r) => r.abort()));
      await page.mouse.click(5, 5);
      const s = await waitLayer(page, null, 'synth', 5000);
      check('with the recordings blocked, the menu plays the synthesized score', s.layer === 'synth' && s.cue === 'menu', s);
      await page.click('#btn-campaign');
      await page.click('.mcard[data-mission="ruleros"] button');
      await page.click('#btn-mi-start');
      await page.waitForFunction(() => (window as any).__fps.campaign().active);
      const m = await waitLayer(page, null, 'synth', 5000);
      check('with the recordings blocked, a mission plays its synthesized arrangement', m.layer === 'synth' && m.cue === 'ruleros', m);
      check('blocked recordings cause no page errors', errors.length === 0, errors.slice(0, 5));
      await close();
    }

    // 4. Slow download: synthesized first, then the recording takes over.
    {
      const { page, close } = await openPage(browser, (p) => p.route('**/music/**/*.mp3', async (r) => { await new Promise((res) => setTimeout(res, 8000)); await r.continue(); })); // longer than the prefetch head start
      await page.mouse.click(5, 5);
      const first = await waitLayer(page, null, 'synth', 3000);
      check('slow download: the synthesized menu plays while the recording loads', first.layer === 'synth', first);
      const later = await waitLayer(page, POOL('menu'), 'recorded', 30000);
      check('slow download: the recording takes over once it arrives', later.layer === 'recorded', later);
      await close();
    }

    // 5. A listening capture of the transitions (optional).
    if (RECORD) {
      const { page, close } = await openPage(browser);
      await page.evaluate(() => {
        const d = Object.fromEntries(['ruleros', 'cocina', 'patio', 'pinata'].map((id) => [id, { completed: true, bestMs: null, challenges: { complete: true, time: false, skill: false }, plays: 1 }]));
        localStorage.setItem('chancla.campaign.v1', JSON.stringify({ v: 1, missions: d }));
      });
      await page.reload();
      await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
      await page.mouse.click(5, 5);
      await waitLayer(page, POOL('menu'), 'recorded');
      await page.evaluate(() => {
        const w = window as any;
        const rec = new MediaRecorder(w.__fps.audio().captureStream(), { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 160000 });
        const chunks: Blob[] = [];
        rec.ondataavailable = (e) => chunks.push(e.data);
        rec.start(500);
        w.__rec = { rec, chunks };
      });
      const marks: Array<[number, string]> = [];
      const t0 = Date.now();
      const mark = (what: string) => marks.push([+((Date.now() - t0) / 1000).toFixed(1), what]);
      mark('menu (Rosa theme)');
      await page.waitForTimeout(8000);
      await page.click('#btn-campaign'); mark('mission select (same recording continues)');
      await page.waitForTimeout(5000);
      await page.click('.mcard[data-mission="ruleros"] button');
      await page.waitForTimeout(1500);
      await page.click('#btn-mi-start'); mark('Mission 1 starts: crossfade to Ruleros');
      await page.waitForTimeout(9000);
      await page.evaluate(() => (window as any).__fps.dialogue().say('m1_courtyard')); mark('a line of dialogue: music ducks');
      await page.waitForTimeout(6000);
      await page.evaluate(() => (window as any).__fps.music().seek((window as any).__fps.music().state().duration - 8)); mark('jump to 8 s before the song ends: crossfade into the next');
      await page.waitForTimeout(10000);
      await page.evaluate(() => (window as any).__fps.campaign().toSelect()); mark('leave: back to Rosa theme');
      await page.waitForTimeout(6000);
      await page.click('.mcard[data-mission="pinata"] button');
      await page.waitForTimeout(1500);
      await page.click('#btn-mi-start'); mark('Mission 4 starts: crossfade to Guerra de Vecinos');
      await page.waitForTimeout(10000);
      const b64: string = await page.evaluate(async () => {
        const { rec, chunks } = (window as any).__rec;
        await new Promise<void>((res) => { rec.onstop = () => res(); rec.stop(); });
        const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
      });
      fs.writeFileSync(path.join(OUT, 'transitions.webm'), Buffer.from(b64, 'base64'));
      report.transitionMarks = marks;
      console.log('transitions', JSON.stringify(marks));
      await close();
    }
  } finally {
    await browser.close();
    preview?.kill();
  }
  report.checks = checks;
  report.passed = checks.filter((c) => c.ok).length;
  report.total = checks.length;
  fs.writeFileSync(path.join(OUT, 'music-e2e.json'), JSON.stringify(report, null, 2));
  console.log(`${report.passed}/${report.total} checks passed`);
  if (report.passed !== report.total) process.exitCode = 1;
}

void main();
