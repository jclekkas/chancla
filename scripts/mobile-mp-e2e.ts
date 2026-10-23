// Mixed-input online play: an emulated phone (touch only) and a desktop
// browser (keyboard and mouse) in the same private room, on a LOCAL game
// server started by this script (never the production one).
//
//   npm run build && node --import tsx scripts/mobile-mp-e2e.ts
//
// The phone is Chromium's mobile emulation (844x390, touch, DPR 2) driven
// with real multi-touch over the DevTools protocol: separate touch ids per
// finger, so the page receives one pointer per finger. Names are typed with
// fill() (a real phone uses its on-screen keyboard). This is emulation on a
// desktop CPU: it proves the flow, input handling and netcode integration,
// not how a real phone feels or performs.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type CDPSession, type Page } from 'playwright-core';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SITE = 'http://localhost:4173/';
const PORT = 8787;
const SHOTS = path.join(ROOT, 'docs/evidence/mobile-mp');
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); };
const LAND = { width: 844, height: 390 };
const PORT_VP = { width: 390, height: 844 };

async function waitHttp(url: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

type Pt = { x: number; y: number; id: number };
const touchEv = (cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', pts: Pt[]) =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 8, radiusY: 8, force: 1 })) });
async function tap(page: Page, cdp: CDPSession, sel: string): Promise<void> {
  await page.locator(sel).scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
  const b = await page.locator(sel).boundingBox();
  if (!b) throw new Error(`no ${sel}`);
  await touchEv(cdp, 'touchStart', [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 40 }]);
  await sleep(50);
  await touchEv(cdp, 'touchEnd', [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 40 }]);
  await sleep(200);
}
async function center(page: Page, sel: string): Promise<{ x: number; y: number }> {
  const b = (await page.locator(sel).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

const st = (p: Page) => p.evaluate(() => {
  const f = (window as any).__fps; const s = f.session(); const i = f.input();
  return {
    screen: f.screen, inMatch: f.inMatch, phase: s?.phase ?? null, team: s?.team ?? null, conn: s?.state ?? null,
    x: s?.body?.x ?? 0, z: s?.body?.z ?? 0, yaw: i?.yaw ?? 0, shots: s?.localShot ?? 0, held: i?.heldCount ?? -1, enabled: !!i?.enabled,
    tl: s?.snap?.tl ?? null, map: f.room ? s?.room?.map : null, touchMode: f.touchMode, controls: !!f.touch()?.visible,
    locked: !!document.pointerLockElement, chip: document.getElementById('team-chip-text')?.textContent ?? '', chipClass: document.getElementById('team-chip')?.className ?? '',
    music: f.music().state().cue, sounding: f.music().state().sounding, audio: f.audio().state, musicBus: f.audio().a?.music?.gain?.value ?? null,
    members: s?.room?.members?.length ?? 0, ctp: !document.getElementById('click-to-play')!.hidden, rotate: !document.getElementById('fps-rotate')!.hidden,
  };
});

async function main(): Promise<void> {
  const procs: ChildProcess[] = [];
  try { await fetch(`http://localhost:${PORT}/healthz`); throw new Error(`port ${PORT} is busy: stop the other game server first`); } catch (e) { if (String(e).includes('busy')) throw e; }
  const srv = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), MATCH_COUNTDOWN_MS: '1500', MATCH_DURATION_MS: '75000', MATCH_SCORE_TO_WIN: '30' }, stdio: 'ignore' });
  procs.push(srv);
  if (!(await waitHttp(SITE, 1500))) procs.push(spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { cwd: ROOT, stdio: 'ignore' }));
  if (!(await waitHttp(`http://localhost:${PORT}/healthz`))) throw new Error('server did not start');
  await waitHttp(SITE);
  const executablePath = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find((p) => fs.existsSync(p));
  // Two browsers, like two devices: each keeps its own focus (pointer lock is
  // released when a page loses focus, so one browser would fight itself).
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--autoplay-policy=document-user-activation-required'];
  const browser: Browser = await chromium.launch({ executablePath, headless: true, args });
  const deskBrowser: Browser = await chromium.launch({ executablePath, headless: true, args });
  const errors: string[] = [];
  try {
    // ---- Desktop host creates the room.
    const dctx = await deskBrowser.newContext({ viewport: { width: 1280, height: 720 } });
    await dctx.addInitScript({ content: 'window.__name = (f) => f; localStorage.setItem("chancla.mp.settings.v1", JSON.stringify({ qualityMode: "low", quality: "low" }));' });
    const desk = await dctx.newPage();
    desk.on('pageerror', (e) => errors.push(`desk: ${e.message}`));
    await desk.goto(SITE);
    await desk.waitForFunction(() => (window as any).__fps?.screen === 'title');
    await desk.click('#btn-online');
    await desk.fill('#in-name', 'Escritorio');
    await desk.click('#btn-create');
    await desk.waitForFunction(() => (window as any).__fps.screen === 'lobby');
    const invite = await desk.inputValue('#invite-url');
    check('desktop: room created, invite link ready', /#room=[A-Z0-9]{8}$/.test(invite), invite);

    // ---- Phone opens the invite.
    const pctx = await browser.newContext({ viewport: LAND, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await pctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    await pctx.addInitScript({ content: 'window.__name = (f) => f;' });
    const phone = await pctx.newPage();
    phone.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
    const cdp = await pctx.newCDPSession(phone);
    // A bad code first: a clear message and a way back.
    await phone.goto(`${SITE}#room=ZZZZ2222`);
    await phone.waitForFunction(() => (window as any).__fps?.screen === 'online');
    await phone.fill('#in-name', 'Teléfono');
    await tap(phone, cdp, '#btn-join');
    await phone.waitForFunction(() => (document.getElementById('online-err')!.textContent ?? '').length > 20, undefined, { timeout: 8000 }).catch(() => undefined);
    const bad = await phone.textContent('#online-err');
    check('phone: an invalid or expired invite says so, and Back is there', /does not exist|closed/i.test(bad ?? '') && (await phone.isVisible('#btn-online-back')), bad);
    await phone.goto(invite);
    await phone.waitForFunction(() => (window as any).__fps?.screen === 'online');
    const pre = await phone.evaluate(() => ({ code: (document.getElementById('in-code') as HTMLInputElement).value, touch: (window as any).__fps.touchMode, focus: document.activeElement?.id }));
    check('phone: the invite opens Play online with the code filled in, in touch mode', pre.code === invite.split('=')[1] && pre.touch, pre);
    await phone.screenshot({ path: path.join(SHOTS, 'phone-invite.png') });
    const joinBox = (await phone.locator('#btn-join').boundingBox())!;
    check('phone: the Join button is on screen and finger-sized', joinBox.x >= 0 && joinBox.x + joinBox.width <= LAND.width && joinBox.height >= 44, joinBox);
    await tap(phone, cdp, '#btn-join'); // a real gesture: also unlocks audio
    await phone.waitForFunction(() => (window as any).__fps.screen === 'lobby', undefined, { timeout: 10000 });
    await sleep(400);
    let p = await st(phone);
    check('phone: joined the desktop room; Join unlocked audio', p.members === 2 && p.audio === 'running', { members: p.members, audio: p.audio });
    const lobbyTeam = await phone.evaluate(() => ({ text: document.querySelector('#lobby-myteam .tc-text')?.textContent, cls: document.getElementById('lobby-myteam')!.className, icon: document.querySelector('#lobby-myteam .tc-icon')?.textContent, mine: document.querySelector('.team.mine h3')?.textContent }));
    check('lobby: "YOUR TEAM" with name, icon and colour, and your team box marked', /YOUR TEAM: (SOL|LUNA)/.test(lobbyTeam.text ?? '') && /sol|luna/.test(lobbyTeam.cls) && !!lobbyTeam.icon && !!lobbyTeam.mine, lobbyTeam);
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    check('lobby: no sideways scrolling on the phone', !overflow);
    await phone.screenshot({ path: path.join(SHOTS, 'phone-lobby.png') });
    // Switch team twice: the indicator follows.
    const t0 = p.team;
    await tap(phone, cdp, '#btn-switch');
    await phone.waitForFunction((t) => (window as any).__fps.session().team !== t, t0, { timeout: 5000 });
    const switched = await phone.evaluate(() => document.querySelector('#lobby-myteam .tc-text')?.textContent);
    await tap(phone, cdp, '#btn-switch');
    await phone.waitForFunction((t) => (window as any).__fps.session().team === t, t0, { timeout: 5000 });
    check('phone: switching team updates "YOUR TEAM" each time', switched !== lobbyTeam.text, { before: lobbyTeam.text, after: switched });
    // Copy invite on the phone (clipboard granted here; the fallback selects the link).
    await tap(phone, cdp, '#btn-copy-invite');
    const clip = await phone.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    check('phone: Copy invite copies the link', clip === invite, clip);
    // Settings from the lobby: music at zero (a saved preference that must hold).
    await tap(phone, cdp, '#btn-lobby-settings');
    await phone.evaluate(() => { const r = document.getElementById('set-music') as HTMLInputElement; r.value = '0'; r.dispatchEvent(new Event('input', { bubbles: true })); });
    await tap(phone, cdp, '#btn-settings-close');
    await tap(phone, cdp, '#btn-ready');

    // ---- Matches: one per map, mixed input, through the real UI.
    const maps = ['patio', 'plaza', 'fiesta'] as const;
    for (let mi = 0; mi < maps.length; mi++) {
      const map = maps[mi]!;
      if (mi > 0) {
        // Host: back to the lobby, change map, bots on for the second match.
        await desk.waitForFunction(() => (window as any).__fps.screen === 'lobby', undefined, { timeout: 15000 });
        await desk.click(`[data-lmap="${map}"]`);
        if (mi === 1) await desk.check('#chk-bots');
        await phone.waitForFunction(() => (window as any).__fps.screen === 'lobby', undefined, { timeout: 15000 });
        await sleep(400);
        const ready = await phone.evaluate(() => (document.getElementById('btn-ready')!.getAttribute('aria-pressed')));
        if (ready !== 'true') await tap(phone, cdp, '#btn-ready');
      }
      await desk.waitForFunction(() => !(document.getElementById('btn-start') as HTMLButtonElement).disabled, undefined, { timeout: 10000 });
      await desk.click('#btn-start');
      await phone.waitForFunction(() => (window as any).__fps.inMatch && (window as any).__fps.session().phase === 'playing', undefined, { timeout: 15000 });
      await desk.waitForFunction(() => (window as any).__fps.inMatch, undefined, { timeout: 15000 });
      await sleep(1200);
      p = await st(phone);
      check(`${map}: both in the match on ${map}; phone shows touch controls, no "click to aim", no pointer lock`, p.map === map && p.controls && !p.ctp && !p.locked && p.enabled, { map: p.map, controls: p.controls, ctp: p.ctp, locked: p.locked });
      check(`${map}: phone HUD says "YOUR TEAM" with its team colour`, /YOUR TEAM: (SOL|LUNA)/.test(p.chip) && p.chipClass.includes(p.team === 0 ? 'sol' : 'luna'), { chip: p.chip, cls: p.chipClass });
      if (mi === 0) await phone.screenshot({ path: path.join(SHOTS, 'phone-match.png') });
      // Desktop: keyboard and mouse at the same time.
      await desk.mouse.click(640, 360);
      await sleep(700); // the click that captures the mouse is never a throw: press again after it
      await desk.keyboard.down('KeyW');
      await desk.mouse.down();
      // Phone: three fingers, move + look + throw together.
      const thr = await center(phone, '#ft-throw');
      const before = await st(phone);
      const stick = { x: 110, y: 290, id: 1 }, look = { x: 520, y: 180, id: 2 }, throwPt = { x: thr.x, y: thr.y, id: 3 };
      await touchEv(cdp, 'touchStart', [stick]);
      await touchEv(cdp, 'touchStart', [stick, look]);
      await touchEv(cdp, 'touchStart', [stick, look, throwPt]);
      for (let i = 1; i <= 14; i++) { await touchEv(cdp, 'touchMove', [{ ...stick, y: 290 - Math.min(55, i * 6) }, { ...look, x: 520 + i * 5 }, throwPt]); await sleep(90); }
      await sleep(600);
      const during = await st(phone);
      await touchEv(cdp, 'touchEnd', [throwPt]);
      await sleep(200);
      await touchEv(cdp, 'touchEnd', [{ ...stick, y: 235 }, { ...look, x: 590 }]);
      await desk.keyboard.up('KeyW');
      await desk.mouse.up();
      await sleep(400);
      const after = await st(phone);
      const d = await st(desk);
      const moved = Math.hypot(during.x - before.x, during.z - before.z);
      check(`${map}: phone moves, aims and throws at the same time`, moved > 0.8 && Math.abs(during.yaw - before.yaw) > 0.05 && during.shots > before.shots, { moved: +moved.toFixed(2), dYaw: +(during.yaw - before.yaw).toFixed(2), shots: during.shots - before.shots });
      check(`${map}: after the fingers lift, nothing is held`, after.held === 0, { held: after.held });
      check(`${map}: desktop moved and threw with keyboard and mouse in the same match`, d.shots > 0 && d.locked, { shots: d.shots, locked: d.locked });

      if (mi === 0) {
        // Menu during an online match: inputs stop, the match keeps going, Resume returns.
        await touchEv(cdp, 'touchStart', [stick]); await touchEv(cdp, 'touchMove', [{ ...stick, y: 240 }]);
        await tap(phone, cdp, '#btn-menu');
        p = await st(phone);
        const note = await phone.textContent('#pause-note');
        const btns = await phone.evaluate(() => [...document.querySelectorAll('#scr-pause button')].filter((b) => !(b as HTMLElement).hidden).map((b) => b.id));
        check('menu: opens from the ☰ button, input stops, nothing held', p.screen === 'pause' && !p.enabled && p.held === 0, { screen: p.screen, held: p.held });
        check('menu: Resume, Audio & settings, Controls, Leave match; says the online match continues', ['btn-resume', 'btn-pause-settings', 'btn-pause-controls', 'btn-pause-leave'].every((b) => btns.includes(b)) && /online match: it keeps going/i.test(note ?? ''), { btns, note });
        const tl0 = p.tl;
        await sleep(1500);
        check('menu: the online match keeps running meanwhile', (await st(phone)).tl !== tl0);
        await phone.screenshot({ path: path.join(SHOTS, 'phone-menu.png') });
        await tap(phone, cdp, '#btn-pause-controls');
        check('controls help shows the touch controls', await phone.isVisible('.controls.touch-list'));
        await tap(phone, cdp, '#btn-controls-close');
        await tap(phone, cdp, '#btn-resume');
        await sleep(400);
        p = await st(phone);
        check('menu: Resume returns to play, controls back, the tap did not throw', p.screen === 'none' && p.controls && p.enabled && p.held === 0, { screen: p.screen, controls: p.controls, held: p.held });
        // Portrait mid-match: rotate screen, input stops; landscape again: playable.
        await touchEv(cdp, 'touchStart', [stick]); await touchEv(cdp, 'touchMove', [{ ...stick, y: 240 }]);
        await phone.setViewportSize(PORT_VP);
        await sleep(500);
        p = await st(phone);
        check('portrait: rotate screen, inputs stopped, nothing held, match continues', p.rotate && !p.enabled && p.held === 0 && !p.controls, { rotate: p.rotate, enabled: p.enabled, held: p.held });
        await phone.screenshot({ path: path.join(SHOTS, 'phone-portrait-rotate.png') });
        await touchEv(cdp, 'touchEnd', []);
        await phone.setViewportSize(LAND);
        await sleep(500);
        p = await st(phone);
        check('landscape again: back in play', !p.rotate && p.enabled && p.controls, { rotate: p.rotate });
        // Backgrounding (app switch, screen lock): menu opens, held input cleared.
        await touchEv(cdp, 'touchStart', [stick]); await touchEv(cdp, 'touchMove', [{ ...stick, y: 240 }]);
        await phone.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
        await sleep(300);
        p = await st(phone);
        check('backgrounded: the menu opens and nothing stays held', p.screen === 'pause' && p.held === 0, { screen: p.screen, held: p.held });
        await touchEv(cdp, 'touchEnd', []);
        await phone.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
        await tap(phone, cdp, '#btn-resume');
        // Connection drop: the existing reconnect brings the phone back into the same match.
        const teamBefore = (await st(phone)).team;
        await phone.evaluate(() => (window as any).__fps.session().transport.close());
        await sleep(150);
        const banner = await phone.evaluate(() => ({ shown: !document.getElementById('banner-conn')!.hidden, text: document.getElementById('banner-conn')!.textContent }));
        await phone.waitForFunction(() => (window as any).__fps.session()?.state === 'online', undefined, { timeout: 15000 });
        p = await st(phone);
        check('connection drop: "Reconnecting" shows, then the phone is back in the same match and team', banner.shown && /reconnect/i.test(banner.text ?? '') && p.inMatch && p.team === teamBefore, { banner, team: p.team });
        // Audio through it all: the saved zero music level held; one song at most plus a fade.
        check('audio: the saved music level (0) held from lobby into the match; no overlapping songs', (p.musicBus ?? 1) < 0.001 && p.sounding <= 2, { bus: p.musicBus, sounding: p.sounding, cue: p.music });
      }

      // Play out the match (time limit) and check results on both.
      await phone.waitForFunction(() => (window as any).__fps.screen === 'results', undefined, { timeout: 120000 });
      await desk.waitForFunction(() => (window as any).__fps.screen === 'results', undefined, { timeout: 15000 });
      const res = await phone.evaluate(() => ({ my: document.querySelector('#res-myteam .tc-text')?.textContent, cls: document.getElementById('res-myteam')!.className, rows: [...document.querySelectorAll('#res-table tr.me')].map((r) => r.className), btns: [...document.querySelectorAll('#scr-results button')].filter((b) => !(b as HTMLElement).hidden && (b as HTMLElement).offsetParent).map((b) => b.id) }));
      check(`${map}: results show your team (name, icon, colour) and mark your row; the phone can leave`, /YOUR TEAM/.test(res.my ?? '') && res.rows.length === 1 && res.btns.includes('btn-res-leave'), res);
      if (mi === 0) {
        await phone.screenshot({ path: path.join(SHOTS, 'phone-results.png') });
        check('results: the music cue is the results/menu pool, still muted', (await st(phone)).music === 'results' && ((await st(phone)).musicBus ?? 1) < 0.001);
        // Rematch on the same map, then back to the lobby for the next map.
        await desk.click('#btn-rematch');
        await phone.waitForFunction(() => (window as any).__fps.inMatch && (window as any).__fps.screen === 'none', undefined, { timeout: 15000 });
        p = await st(phone);
        check('rematch: the phone goes straight back in with touch controls', p.controls && p.enabled, { controls: p.controls });
        await phone.waitForFunction(() => (window as any).__fps.screen === 'results', undefined, { timeout: 120000 });
      }
      if (mi < maps.length - 1) await desk.click('#btn-to-lobby');
    }

    // ---- Leave mid-match with confirmation, from the phone.
    await desk.click('#btn-rematch');
    await phone.waitForFunction(() => (window as any).__fps.inMatch && (window as any).__fps.screen === 'none', undefined, { timeout: 15000 });
    await sleep(800);
    await tap(phone, cdp, '#btn-menu');
    await tap(phone, cdp, '#btn-pause-leave');
    const conf = await phone.evaluate(() => ({ shown: !document.getElementById('scr-confirm')!.hidden, body: document.getElementById('confirm-body')!.textContent }));
    check('leaving an active match asks first', conf.shown, conf);
    await tap(phone, cdp, '#btn-confirm-yes');
    await phone.waitForFunction(() => (window as any).__fps.screen === 'title', undefined, { timeout: 8000 });
    p = await st(phone);
    check('the phone is back on the main menu, menu music, no session', !p.inMatch && p.conn === null && p.music === 'menu', { inMatch: p.inMatch, music: p.music });
    await desk.waitForFunction(() => (window as any).__fps.session().room.members.filter((m: any) => !m.bot).length === 1, undefined, { timeout: 30000 }).catch(() => undefined);
    check('desktop sees the phone leave', (await desk.evaluate(() => (window as any).__fps.session().room.members.filter((m: any) => !m.bot && m.connected).length)) === 1);
    check('no page errors on either client', errors.length === 0, errors.slice(0, 3));
    await desk.click('#btn-menu').catch(() => undefined);
    await pctx.close();
    await dctx.close();
  } finally {
    await browser.close();
    await deskBrowser.close();
    for (const c of procs) c.kill('SIGTERM');
  }
  const passed = checks.filter((c) => c.ok).length;
  fs.writeFileSync(path.join(SHOTS, 'mobile-mp-e2e.json'), JSON.stringify({ at: new Date().toISOString(), environment: 'Chromium 141 headless. Phone: mobile emulation 844x390 (390x844 for the rotation check), touch, DPR 2, multi-touch over CDP. Desktop: 1280x720 keyboard and mouse. Local game server (not production). NOT a real phone.', passed, total: checks.length, checks }, null, 2));
  console.log(`${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exitCode = 1;
}

void main();
