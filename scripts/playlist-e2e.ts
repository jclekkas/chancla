// The full soundtrack in a real browser: the Settings controls on both pages,
// preferences that persist, automatic rotation at song endings, Next, one
// chosen song, no bulk loading, tab switches, fast scene changes, the Arcade
// flow, decoded-audio memory, and short recordings of the transitions for
// someone to listen to.
//
//   npm run build && xvfb-run -a node --import tsx scripts/playlist-e2e.ts
//
// Headed Chromium under Xvfb enforces the real autoplay rule (audio starts
// only from a user gesture). Recordings are the page's own mix, captured
// with MediaRecorder: nobody has listened to them yet.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright-core';
import { PLAYLIST } from '../src/audio/playlist-data';
import { POOLS, SONGS } from '../src/audio/library';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SITE = process.env.E2E_URL || 'http://localhost:4173/';
const OUT = path.join(ROOT, 'docs/evidence/music/transitions');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); };
const report: Record<string, unknown> = {};

async function waitHttp(url: string): Promise<boolean> {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

type M = { cue: string; layer: string; mode: string; recording: string | null; title: string | null; position: number | null; duration: number | null; loop: [number, number] | null; loaded: string[]; sounding: number; upNext: string | null };
const mus = (p: Page, arcade = false): Promise<M> => p.evaluate((a) => (a ? (window as any).__chancla.snapshot().music : (window as any).__fps.music().state()), arcade);
async function until(p: Page, f: (m: M) => boolean, ms = 15000, arcade = false): Promise<M> {
  const end = Date.now() + ms;
  for (;;) { const m = await mus(p, arcade); if (f(m) || Date.now() > end) return m; await sleep(150); }
}
/** Decoded audio held by the controller, in MB (frames x channels x 4 bytes). */
const decodedMB = (p: Page, arcade = false) => p.evaluate((a) => {
  const m = a ? (window as any).__chancla.music : (window as any).__fps.music();
  let b = 0; for (const buf of (m.buffers as Map<string, AudioBuffer>).values()) b += buf.length * buf.numberOfChannels * 4;
  return +(b / 1048576).toFixed(1);
}, arcade);

async function startRec(p: Page, arcade = false): Promise<void> {
  await p.evaluate((a) => {
    const w = window as any;
    const au = a ? w.__chancla.audio : w.__fps.audio();
    const rec = new MediaRecorder(au.captureStream(), { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 160000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.start(500);
    w.__rec = { rec, chunks };
  }, arcade);
}
async function stopRec(p: Page, name: string): Promise<string> {
  const b64: string = await p.evaluate(async () => {
    const { rec, chunks } = (window as any).__rec;
    await new Promise<void>((res) => { rec.onstop = () => res(); rec.stop(); });
    const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const f = path.join(OUT, `${name}.webm`);
  const raw = `${f}.raw.webm`;
  fs.writeFileSync(raw, Buffer.from(b64, 'base64'));
  // MediaRecorder leaves no duration in the file: remux (no re-encode) so players can seek.
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-c', 'copy', f]);
  fs.rmSync(raw, { force: true });
  return path.relative(ROOT, f);
}

async function open(browser: Browser, url: string, init = '', route?: (p: Page) => Promise<unknown>): Promise<{ page: Page; requests: string[]; errors: string[]; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript({ content: `window.__name = (f) => f; ${init}` });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => { if (/\/music\//.test(r.url())) requests.push(new URL(r.url()).pathname); });
  page.on('pageerror', (e) => errors.push(e.message));
  if (route) await route(page);
  await page.goto(url);
  return { page, requests, errors, close: () => ctx.close() };
}

async function main(): Promise<void> {
  let preview: ChildProcess | null = null;
  if (!process.env.E2E_URL && !(await waitHttp(SITE).catch(() => false))) {
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
    await waitHttp(SITE);
  }
  const executablePath = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p));
  const headed = !!process.env.DISPLAY;
  const browser = await chromium.launch({ executablePath, headless: !headed, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=document-user-activation-required'] });
  console.log(`browser: Chromium ${headed ? 'headed (real autoplay rule)' : 'headless'}`);
  const marks: Record<string, Array<[number, string]>> = {};
  try {
    // ---- 1. Fresh visit: nothing plays or decodes before a gesture, and only one song is fetched.
    const { page, requests, errors, close } = await open(browser, SITE);
    await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
    await sleep(1500);
    let m = await mus(page);
    check('fresh visit: no audio before a gesture; at most the opening song is fetched ahead', m.layer === 'off' && new Set(requests).size <= 1, { layer: m.layer, fetched: [...new Set(requests)] });
    const heap0 = await page.evaluate(() => (performance as any).memory?.usedJSHeapSize ?? 0);
    await page.click('#sound-gate');
    m = await until(page, (x) => x.layer === 'recorded');
    check('first gesture: Groquo de diversión opens the menus', m.recording === '036c0292' && m.mode === 'auto', { recording: m.recording, mode: m.mode });

    // ---- 2. Settings: the soundtrack section.
    await page.click('#btn-settings');
    await sleep(300);
    const ui = await page.evaluate(() => ({
      modes: [...document.querySelectorAll('#soundtrack [data-st-mode]')].map((b) => b.textContent),
      checked: document.querySelector('#soundtrack [aria-checked="true"]')?.getAttribute('data-st-mode'),
      options: [...(document.getElementById('st-song') as HTMLSelectElement).options].map((o) => o.value),
      now: document.getElementById('st-now')!.textContent,
    }));
    check('Settings has a soundtrack section: Automatic / Shuffle all / One song, a song list, Next and what is playing', ui.modes.join('|') === 'Automatic|Shuffle all|One song' && ui.checked === 'auto' && /Now playing: Groquo de diversión/.test(ui.now ?? ''), ui);
    check('the song list offers all 13 recordings (11 playlist songs + 2 earlier versions)', ui.options.length === 13 && PLAYLIST.every((p) => ui.options.includes(p.id)), ui.options.length);
    await page.screenshot({ path: path.join(OUT, '..', 'settings-soundtrack.png') });
    await page.click('#btn-mg-lang').catch(() => undefined);
    await page.click('[data-lang="es"]');
    await sleep(200);
    const es = await page.evaluate(() => ({ modes: [...document.querySelectorAll('#soundtrack [data-st-mode]')].map((b) => b.textContent).join('|'), next: document.getElementById('st-next')!.textContent, now: document.getElementById('st-now')!.textContent }));
    check('in Spanish too', es.modes === 'Automática|Todas al azar|Una canción' && es.next === 'Siguiente canción' && /^Suena:/.test(es.now ?? ''), es);
    await page.click('[data-lang="en"]');

    // Recordings are made with music at 100% so they are easy to listen to (the default is 45%).
    await page.evaluate(() => { const r = document.getElementById('set-music') as HTMLInputElement; r.value = '100'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
    // ---- 3. Next, with a listening capture.
    await startRec(page);
    const t0 = Date.now(); marks.next = [];
    const mk = (k: string, w: string) => marks[k]!.push([+((Date.now() - t0) / 1000).toFixed(1), w]);
    mk('next', 'Groquo de diversión (menu)');
    await sleep(5000);
    const before = (await mus(page)).recording;
    await page.click('#st-next'); mk('next', 'Next pressed: 1 s crossfade');
    m = await until(page, (x) => x.layer === 'recorded' && x.recording !== before);
    await sleep(6000);
    report.nextClip = await stopRec(page, 'next-button');
    const nowLine = await page.textContent('#st-now');
    check('Next: another menu song, at once, and the Settings line follows', m.recording !== before && POOLS.menu.songs.includes(m.recording!) && nowLine!.includes(m.title!), { from: before, to: m.recording, line: nowLine });

    // ---- 4. A natural song ending in Shuffle all, captured.
    await page.click('#soundtrack [data-st-mode="shuffle"]');
    m = await until(page, (x) => x.mode === 'shuffle' && x.layer === 'recorded');
    await sleep(1500);
    const sh0 = (await mus(page)).recording;
    await page.evaluate(() => { const mm = (window as any).__fps.music(); mm.seek(mm.state().duration - 10); });
    await startRec(page);
    marks.ending = [[0, `${SONGS.find((s) => s.id === sh0)?.title}, 10 s before its end`]];
    let peak = 0, peakLoaded = 0, peakMB = 0;
    for (let i = 0; i < 64; i++) { await sleep(250); const x = await mus(page); peak = Math.max(peak, x.sounding); peakLoaded = Math.max(peakLoaded, x.loaded.length); peakMB = Math.max(peakMB, await decodedMB(page)); }
    marks.ending.push([7, 'crossfade into the next song (3 s)']);
    report.endingClip = await stopRec(page, 'natural-ending-shuffle');
    m = await mus(page);
    check('Shuffle all: at the end of a song the next one takes over by itself, crossfading', m.recording !== sh0 && m.layer === 'recorded', { from: sh0, to: m.recording });
    check('two songs sound only during the crossfade; at most two are decoded', peak <= 2 && m.sounding === 1 && peakLoaded <= 2, { peak, now: m.sounding, peakLoaded });
    report.memory = { decodedPeakMB: peakMB };

    // ---- 5. One song: choose it from the list; it repeats; the choice survives a reload; so does mute.
    await page.selectOption('#st-song', 'd4b3fb6f'); // Festive Boss Battle, no curated loop
    m = await until(page, (x) => x.mode === 'one' && x.recording === 'd4b3fb6f');
    check('choosing a song switches to One song and plays it', m.recording === 'd4b3fb6f' && m.loop === null, m.recording);
    await page.evaluate(() => { const mm = (window as any).__fps.music(); mm.seek(mm.state().duration - 7); });
    await startRec(page);
    marks.repeat = [[0, 'Festive Boss Battle, 7 s before its end'], [4, 'repeats from the top (3 s crossfade)']];
    await sleep(12000);
    report.repeatClip = await stopRec(page, 'one-song-repeat');
    m = await mus(page);
    check('One song without a curated loop repeats from the top', m.recording === 'd4b3fb6f' && (m.position ?? 99) < 12, { position: m.position });
    await page.selectOption('#st-song', '66be822e'); // Ruleros: has the curated loop
    m = await until(page, (x) => x.recording === '66be822e' && x.loop !== null);
    check('One song with a curated loop uses the seamless loop file', m.loop !== null, m.loop);
    await page.evaluate(() => { const r = document.getElementById('set-music') as HTMLInputElement; r.value = '0'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
    await sleep(300);
    await page.reload();
    await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
    await page.mouse.click(5, 5);
    m = await until(page, (x) => x.layer === 'recorded');
    const persisted = await page.evaluate(() => ({ prefs: JSON.parse(localStorage.getItem('chancla.music.v1') ?? 'null'), bus: (window as any).__fps.audio().a.music.gain.value }));
    check('after a reload: One song (Ruleros) is still chosen, and music stays muted', m.mode === 'one' && m.recording === '66be822e' && persisted.bus < 0.001, persisted);
    // Back to defaults for the rest.
    await page.evaluate(() => { const r = document.getElementById('set-music') as HTMLInputElement; r.value = '100'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.click('#btn-settings');
    await page.click('#soundtrack [data-st-mode="auto"]');
    await page.click('#btn-settings-close');

    // ---- 6. Tab switch: suspended while hidden, resumed on return, same song.
    const tabFrom = (await until(page, (x) => x.layer === 'recorded')).recording;
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(800);
    const hiddenState = await page.evaluate(() => (window as any).__fps.audio().state);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(800);
    m = await mus(page);
    check('tab hidden: audio suspends; back: it resumes on the same song', hiddenState === 'suspended' && (await page.evaluate(() => (window as any).__fps.audio().state)) === 'running' && m.recording === tabFrom, { hiddenState, recording: m.recording });

    // ---- 7. Rapid scene changes through the real menus, then a scene change captured.
    await page.evaluate(() => {
      const d = Object.fromEntries(['ruleros', 'cocina', 'patio', 'pinata'].map((id) => [id, { completed: true, bestMs: null, challenges: { complete: true, time: false, skill: false }, plays: 1 }]));
      localStorage.setItem('chancla.campaign.v1', JSON.stringify({ v: 1, missions: d }));
    });
    await page.reload();
    await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
    await page.mouse.click(5, 5);
    await until(page, (x) => x.layer === 'recorded');
    let peakRapid = 0;
    await page.click('#btn-campaign');
    for (let i = 0; i < 6; i++) {
      if (!(await page.isVisible('#scr-campaign'))) await page.evaluate(() => (window as any).__fps.campaign().openSelect());
      await page.click('.mcard[data-mission="pinata"] button');
      await page.click('#btn-mi-start');
      await sleep(250);
      peakRapid = Math.max(peakRapid, (await mus(page)).sounding);
      await page.evaluate(() => (window as any).__fps.campaign().toSelect());
      await sleep(150);
      peakRapid = Math.max(peakRapid, (await mus(page)).sounding);
    }
    if (!(await page.isVisible('#scr-campaign'))) await page.evaluate(() => (window as any).__fps.campaign().openSelect());
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => (window as any).__fps.screen === 'title').catch(() => undefined);
    m = await until(page, (x) => (x.cue === 'menu' || x.cue === 'select') && x.layer === 'recorded' && x.sounding === 1, 10000);
    check('rapid mission / menu switching: never more than two songs at once, and the menu wins at the end', peakRapid <= 2 && POOLS.menu.songs.includes(m.recording!) && m.sounding === 1, { peakRapid, recording: m.recording, sounding: m.sounding });
    await startRec(page);
    marks.scene = [[0, `${m.title} (menu)`]];
    await sleep(4000);
    await page.click('#btn-campaign');
    await page.click('.mcard[data-mission="ruleros"] button');
    await sleep(1200);
    await page.click('#btn-mi-start'); marks.scene.push([5.2, 'Mission 1 starts: 1.5 s crossfade to the exploration pool']);
    await until(page, (x) => x.cue === 'ruleros' && x.layer === 'recorded');
    await sleep(7000);
    report.sceneClip = await stopRec(page, 'scene-change-menu-to-mission');
    report.memory = { ...(report.memory as object), decodedNowMB: await decodedMB(page), jsHeapGrowthMB: +((((await page.evaluate(() => (performance as any).memory?.usedJSHeapSize ?? 0)) - heap0) / 1048576).toFixed(1)) };
    check('fetched only what was played or queued next (no bulk download)', new Set(requests).size < SONGS.length, { distinct: new Set(requests).size });
    report.requests = [...new Set(requests)];
    check('main page: no page errors', errors.length === 0, errors.slice(0, 3));
    await close();

    // ---- 8. Main menu -> Arcade -> pause -> resume -> home.
    {
      const { page, errors, close } = await open(browser, new URL('classic.html', SITE).toString(), 'localStorage.setItem("chancla.progress.v1", JSON.stringify({ runs: 1 }));');
      await page.waitForFunction(() => !!(window as any).__chancla);
      await page.click('#sound-gate');
      await page.evaluate(() => (window as any).__chancla.audio.setVolume(1));
      let a = await until(page, (x) => x.layer === 'recorded', 15000, true);
      check('Arcade title: the menus\' songs (shared controller)', POOLS.menu.songs.includes(a.recording!), a.recording);
      await page.click('#btn-play');
      await page.click('#btn-maps-start');
      await page.waitForFunction(() => (window as any).__chancla.snapshot().state === 'playing');
      a = await until(page, (x) => x.cue === 'arcade' && x.layer === 'recorded', 15000, true);
      check('Arcade run: a song from the whole playlist', a.cue === 'arcade' && POOLS.action.songs.includes(a.recording!), a.recording);
      await startRec(page, true);
      marks.arcadePause = [[0, `${a.title} (Arcade run)`], [4, 'paused: the song carries on, lower'], [9, 'resumed']];
      await sleep(4000);
      await page.keyboard.press('Escape');
      await sleep(300);
      const pausedSong = (await mus(page, true)).recording;
      await sleep(5000);
      const stillSame = (await mus(page, true)).recording === pausedSong;
      await page.click('#btn-resume');
      await sleep(4000);
      report.arcadePauseClip = await stopRec(page, 'arcade-pause-resume');
      check('Arcade pause and resume keep the same song (no restart)', stillSame && (await mus(page, true)).recording === pausedSong, pausedSong);
      await page.keyboard.press('Escape');
      await sleep(300);
      await page.click('#btn-pause-home');
      await page.click('#btn-confirm-yes');
      await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
      await page.mouse.click(5, 5);
      const home = await until(page, (x) => x.layer === 'recorded');
      check('back on the main menu: a menu song (a new page, after a gesture)', POOLS.menu.songs.includes(home.recording!), home.recording);
      check('Arcade: no page errors', errors.length === 0, errors.slice(0, 3));
      await close();
    }

    // ---- 9. A failed and a slow song: the pool moves on; nothing breaks.
    {
      const { page, errors, close } = await open(browser, SITE, '', async (p) => {
        await p.route('**/music/playlist/11-*.mp3', (r) => r.fulfill({ status: 404, body: 'gone' }));
        await p.route('**/music/playlist/08-*.mp3', async (r) => { await sleep(5000); await r.continue(); });
      });
      await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
      await page.mouse.click(5, 5);
      const m1 = await until(page, (x) => x.layer === 'recorded', 20000);
      check('opening song missing (404): another menu song plays instead', m1.recording !== '036c0292' && POOLS.menu.songs.includes(m1.recording!), m1.recording);
      check('a missing song causes no page errors', errors.length === 0, errors.slice(0, 3));
      await close();
    }
  } finally {
    await browser.close();
    preview?.kill();
  }
  report.marks = marks;
  const passed = checks.filter((c) => c.ok).length;
  fs.writeFileSync(path.join(OUT, '..', 'playlist-e2e.json'), JSON.stringify({ at: new Date().toISOString(), browser: 'Chromium 141 headed under Xvfb (Linux)', passed, total: checks.length, checks, report }, null, 2));
  console.log(JSON.stringify(report.memory), JSON.stringify(marks));
  console.log(`${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exitCode = 1;
}

void main();
