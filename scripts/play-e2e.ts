// Browser acceptance checks for the pause/menu, team identity and map work,
// through the real UI with real input (Playwright's keyboard and mouse;
// headless Chromium grants pointer lock). For online, a real game server is
// started locally and a headless guest joins over a real WebSocket: there is
// no hosted server, so this is the only online check possible here.
//
//   npm run build && node --import tsx scripts/play-e2e.ts
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Page, Browser } from 'playwright-core';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';
import { NetClient, until } from '../tests/helpers/netclient';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'artifacts/play');
const SITE = process.env.E2E_URL || 'http://localhost:4173/';
fs.mkdirSync(OUT, { recursive: true });
const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url: string): Promise<boolean> {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

// Counts live event listeners and animation-frame callbacks per second, to
// catch anything a map switch or a restart would duplicate.
const PROBE = `(() => {
  let live = 0;
  const reg = new WeakMap();
  const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  // Only window and document: listeners there outlive screens and would pile up.
  // (Listeners on elements that get replaced are collected with them.)
  EventTarget.prototype.addEventListener = function (t, f, o) { if (f && (this === window || this === document)) { let m = reg.get(this); if (!m) reg.set(this, m = new Set()); const k = t + '|' + (typeof o === 'object' ? !!o?.capture : !!o); const key = k + '#' + (f.__id ||= Math.random()); if (!m.has(key)) { m.add(key); live++; } } return add.call(this, t, f, o); };
  EventTarget.prototype.removeEventListener = function (t, f, o) { const m = reg.get(this); if (m && f && f.__id) { const k = t + '|' + (typeof o === 'object' ? !!o?.capture : !!o) + '#' + f.__id; if (m.delete(k)) live--; } return rem.call(this, t, f, o); };
  let raf = 0; const r = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { raf++; return r(cb); };
  window.__probe = { listeners: () => live, raf: () => raf };
  window.__name = (f) => f;
})();`;

async function open(browser: Browser, url: string) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript({ content: PROBE });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|healthz|status of 404/.test(m.text())) errors.push(m.text()); });
  await page.goto(url);
  return { page, errors, close: () => ctx.close() };
}

const fps = (p: Page) => p.evaluate(() => {
  const w = window as any;
  const s = w.__fps.session();
  const inp = w.__fps.input();
  return {
    screen: w.__fps.screen, locked: !!document.pointerLockElement, held: inp?.heldCount ?? 0, fallback: inp?.fallback ?? false,
    tl: s?.snap?.tl ?? null, hp: s?.hp ?? null, map: s?.room?.map ?? null, team: s?.team ?? null,
    chip: (document.getElementById('team-chip') as HTMLElement).hidden ? '' : document.getElementById('team-chip')!.textContent,
    banner: (document.getElementById('spawn-banner') as HTMLElement).hidden ? '' : document.getElementById('spawn-banner')!.textContent,
    note: document.getElementById('pause-note')!.textContent, music: w.__fps.music().state(),
  };
});
const rafRate = async (p: Page) => { const a = await p.evaluate(() => (window as any).__probe.raf()); await sleep(1000); return (await p.evaluate(() => (window as any).__probe.raf())) - a; };

async function practiceOn(page: Page, map: string): Promise<void> {
  if (!(await page.isVisible('#scr-practice'))) { await page.click('#btn-practice'); }
  await page.click(`.map-card[data-map="${map}"]`);
  await page.click('#btn-practice-start');
  await page.waitForFunction(() => (window as any).__fps.inMatch && (window as any).__fps.screen === 'none');
}

async function main(): Promise<void> {
  let preview: ChildProcess | null = null;
  if (!process.env.E2E_URL && !(await waitHttp(SITE).catch(() => false))) {
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
    await waitHttp(SITE);
  }
  const browser: Browser = await launch(['--mute-audio']);
  let server: ChildProcess | null = null;
  try {
    // ------------------------------------------------------------ Practice
    {
      const { page, errors, close } = await open(browser, SITE);
      await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
      await page.mouse.click(600, 40); // first gesture: audio
      const base = { listeners: await page.evaluate(() => (window as any).__probe.listeners()), raf: 0 };
      let allyTagsSeen = 0;
      for (const map of ['patio', 'plaza', 'fiesta']) {
        await practiceOn(page, map);
        await sleep(400);
        let s = await fps(page);
        check(`practice ${map}: the room is on the chosen map`, s.map === map, s.map);
        check(`practice ${map}: team chip and spawn banner name the team`, /YOUR TEAM: SOL/.test(s.chip) && /TEAM SOL/.test(s.banner), { chip: s.chip, banner: s.banner });
        await page.waitForFunction(() => document.getElementById('spawn-banner')!.hidden, undefined, { timeout: 12000 }).catch(() => undefined);
        s = await fps(page);
        check(`practice ${map}: the team chip stays after the banner goes`, /YOUR TEAM: SOL/.test(s.chip) && s.banner === '', { chip: s.chip, banner: s.banner });
        // Teammates (Sol) carry ALLY, opponents ENEMY, whenever they are on screen.
        const tags = await page.evaluate(() => [...document.querySelectorAll('.nameplate')].filter((e) => (e as HTMLElement).style.display !== 'none').map((e) => e.className));
        allyTagsSeen += tags.filter((c) => c.includes('sol ally')).length;
        check(`practice ${map}: every visible name tag has the right role`, tags.every((c) => (c.includes('sol') && c.includes('ally')) || (c.includes('luna') && c.includes('enemy'))), tags);
        // Capture the mouse, then move and throw, and press Escape mid-action.
        await page.mouse.click(640, 360);
        await sleep(300);
        await page.keyboard.down('KeyW');
        await page.mouse.down();
        await sleep(250);
        await page.keyboard.press('Escape');
        await sleep(300);
        s = await fps(page);
        check(`practice ${map}: Escape while moving and throwing opens the menu, frees the mouse, drops held input`, s.screen === 'pause' && !s.locked && s.held === 0, { screen: s.screen, locked: s.locked, held: s.held });
        await page.keyboard.up('KeyW');
        await page.mouse.up();
        // Paused: the clock and damage stop.
        const t0 = (await fps(page)).tl, hp0 = (await fps(page)).hp;
        await sleep(2000);
        const t1 = (await fps(page)).tl, hp1 = (await fps(page)).hp;
        check(`practice ${map}: while paused the match clock and health do not change`, t0 === t1 && hp0 === hp1, { t0, t1, hp0, hp1 });
        check(`practice ${map}: the menu says practice is paused`, /paused|pausa/i.test(s.note), s.note);
        // Every local throw gets the next number: compare the counter across the resume click.
        const shotsBefore = await page.evaluate(() => (window as any).__fps.session().localShot);
        await page.click('#btn-resume');
        await sleep(400);
        s = await fps(page);
        const throwsBefore = 0;
        const throwsAfter = (await page.evaluate(() => (window as any).__fps.session().localShot)) - shotsBefore;
        check(`practice ${map}: Resume (an explicit click) captures the mouse again without throwing`, s.screen === 'none' && s.locked && !s.fallback && throwsAfter <= throwsBefore, { locked: s.locked, fallback: s.fallback, throwsBefore, throwsAfter });
        if (map !== 'fiesta') {
          // On to the next map through Change map (with confirmation).
          await page.keyboard.press('Escape'); await sleep(250);
          await page.click('#btn-pause-maps'); await page.click('#btn-confirm-yes'); await sleep(400);
        }
      }
      check('a teammate was seen with the ALLY tag', allyTagsSeen > 0, allyTagsSeen);
      // Five pause/resume cycles, then home and back in.
      let cyclesOk = true;
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Escape'); await sleep(250);
        const a = await fps(page);
        await page.click('#btn-resume'); await sleep(350);
        const b = await fps(page);
        if (a.screen !== 'pause' || b.screen !== 'none' || !b.locked) cyclesOk = false;
      }
      check('five pause/resume cycles in a row all work', cyclesOk);
      // Esc, Esc: menu closed, mouse free, "click to aim": the visible Menu button works.
      await page.keyboard.press('Escape'); await sleep(350);
      await page.keyboard.press('Escape'); await sleep(350);
      const freed = await fps(page);
      const hit = await page.evaluate(() => { const r = document.getElementById('btn-menu')!.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button')?.id; });
      check('Escape on the menu closes it (one press each way)', freed.screen === 'none' && !freed.locked, freed.screen);
      check('with the mouse free, the visible Menu button is on top and clickable', hit === 'btn-menu', hit);
      await page.click('#btn-menu'); await sleep(300);
      check('the Menu button opens the menu', (await fps(page)).screen === 'pause');
      await page.click('#btn-resume'); await sleep(300);
      // Tab switch: the menu opens and practice stays paused until Resume.
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(300);
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(300);
      const tab = await fps(page);
      check('switching tabs opens the menu, and returning keeps it open (paused)', tab.screen === 'pause', tab.screen);
      // Restart keeps the map.
      const mapBefore = (await fps(page)).map;
      await page.click('#btn-pause-restart'); await page.click('#btn-confirm-yes');
      await page.waitForFunction(() => (window as any).__fps.inMatch && (window as any).__fps.screen === 'none');
      await sleep(500);
      const rs = await fps(page);
      check('Restart replays the same map from 0–0', rs.map === mapBefore, { before: mapBefore, after: rs.map });
      // Change map, then Main menu, then back in.
      await page.keyboard.press('Escape'); await sleep(250);
      await page.click('#btn-pause-maps'); await page.click('#btn-confirm-yes'); await sleep(400);
      check('Change map (with confirmation) returns to the map choice', (await fps(page)).screen === 'practice');
      await practiceOn(page, 'plaza');
      await sleep(400);
      await page.keyboard.press('Escape'); await sleep(250);
      await page.click('#btn-pause-leave'); await page.click('#btn-confirm-yes'); await sleep(500);
      const home = await fps(page);
      check('Main menu (with confirmation) from the pause menu goes home', home.screen === 'title', home.screen);
      // Leaks after nine matches and three maps: listeners, render loops, audio.
      await sleep(1000);
      const rate = await rafRate(page);
      const listeners = await page.evaluate(() => (window as any).__probe.listeners());
      check('after repeated map switches: no extra event listeners', listeners <= base.listeners + 6, { before: base.listeners, after: listeners });
      check('after repeated map switches: one render loop (menu runs at about 60 requests a second, not a multiple)', rate < 75, rate);
      await sleep(2500); // let any crossfade finish
      const mus = (await fps(page)).music;
      check('music: one track, not silent', mus.sounding <= 1 && mus.layer !== 'off', { sounding: mus.sounding, sources: mus.sources, layer: mus.layer });
      await practiceOn(page, 'fiesta');
      await sleep(400);
      check('re-entering after going home works', (await fps(page)).map === 'fiesta');
      check('Practice: no page errors', errors.length === 0, errors.slice(0, 4));
      await page.screenshot({ path: path.join(OUT, 'practice-fiesta.png') });
      await close();
    }

    // ------------------------------------------------------------ Campaign
    {
      const { page, errors, close } = await open(browser, SITE);
      await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
      await page.click('#btn-campaign');
      await page.click('.mcard[data-mission="ruleros"] button');
      await page.click('#btn-mi-start');
      await page.waitForFunction(() => (window as any).__fps.campaign().active);
      await page.evaluate(() => (window as any).__fps.campaign().runtime.enableAutopilot(11));
      await sleep(4000); // the bot is moving, throwing and triggering mission events
      await page.mouse.click(640, 360); await sleep(200);
      await page.keyboard.press('Escape'); await sleep(300);
      const t0 = await page.evaluate(() => (window as any).__fps.campaign().runtime.sim.state.timeMs);
      const hp0 = await page.evaluate(() => (window as any).__fps.campaign().runtime.sim.state.player.hp);
      await sleep(2000);
      const t1 = await page.evaluate(() => (window as any).__fps.campaign().runtime.sim.state.timeMs);
      const hp1 = await page.evaluate(() => (window as any).__fps.campaign().runtime.sim.state.player.hp);
      check('campaign: Escape during a mission opens the menu', (await fps(page)).screen === 'pause');
      check('campaign: while paused the mission timer and health stop', t0 === t1 && hp0 === hp1, { t0, t1, hp0, hp1 });
      const hasHome = await page.isVisible('#btn-pause-leave') && await page.isVisible('#btn-pause-select') && await page.isVisible('#btn-pause-restart');
      check('campaign menu: Resume, Restart, Mission select and Main menu', hasHome);
      const chip = await page.evaluate(() => getComputedStyle(document.querySelector('.hud .mode-chip')!).display !== 'none' ? document.querySelector('.hud .mode-chip')!.textContent : '');
      check('campaign shows a solo mode label, not a team', /STORY|HISTORIA/.test(chip ?? '') && (await page.evaluate(() => getComputedStyle(document.getElementById('team-chip')!).display === 'none' || document.getElementById('team-chip')!.hidden)), chip);
      await page.click('#btn-resume'); await sleep(300);
      // Let the bot finish the mission, then Main menu from the results.
      await page.waitForFunction(() => (window as any).__fps.screen === 'mresults', undefined, { timeout: 240000 });
      await page.click('#btn-mr-home'); await sleep(400);
      check('campaign: Main menu from mission results goes home', (await fps(page)).screen === 'title');
      check('campaign: no page errors', errors.length === 0, errors.slice(0, 4));
      await close();
    }

    // ------------------------------------------------------------ Arcade
    {
      const { page, errors, close } = await open(browser, new URL('classic.html', SITE).toString());
      await page.waitForFunction(() => !!(window as any).__chancla);
      const snap = () => page.evaluate(() => { const w = window as any; const s = w.__chancla.snapshot(); const g = w.__chancla.app.game; return { state: s.state, phase: g.phase, loops: s.loops, runTime: g.runTime, hp: g.player.hp, map: g.mapId, locked: !!document.pointerLockElement, held: s.heldInputs }; });
      const base = await page.evaluate(() => (window as any).__probe.listeners());
      for (const map of ['plaza', 'fiesta', 'patio']) {
        await page.click('#btn-play');
        await page.click(`.map-card[data-map="${map}"]`);
        await page.click('#btn-maps-start');
        await sleep(500);
        if (await page.isVisible('#btn-skip-tutorial')) await page.keyboard.press('Enter'); // its shortcut
        await sleep(2500);
        await page.keyboard.down('KeyW');
        await sleep(200);
        await page.keyboard.press('Escape'); await sleep(300);
        let s = await snap();
        check(`Arcade ${map}: Escape while moving pauses and frees the mouse`, s.state === 'paused' && !s.locked && s.held === 0, s);
        await page.keyboard.up('KeyW');
        const r0 = (await snap()).runTime, h0 = (await snap()).hp;
        await sleep(1500);
        s = await snap();
        check(`Arcade ${map}: paused, the run clock and health stop`, s.runTime === r0 && s.hp === h0, { r0, r1: s.runTime });
        await page.click('#btn-resume'); await sleep(400);
        s = await snap();
        check(`Arcade ${map}: Resume returns to play with the mouse captured`, s.state === 'playing' && s.locked, s);
        // Restart keeps the map.
        await page.keyboard.press('Escape'); await sleep(250);
        await page.click('#btn-restart'); await sleep(500);
        check(`Arcade ${map}: Restart keeps the map`, (await snap()).map === map && (await snap()).state === 'playing');
        // Change map from the pause menu (confirmation).
        await page.keyboard.press('Escape'); await sleep(250);
        await page.click('#btn-pause-maps'); await page.click('#btn-confirm-yes'); await sleep(300);
        check(`Arcade ${map}: Change map opens the map choice`, await page.isVisible('#modal-maps'));
        await page.click('#btn-maps-back');
      }
      const s = await snap();
      const listeners = await page.evaluate(() => (window as any).__probe.listeners());
      check('Arcade after switching maps: one game loop, no extra listeners', s.loops === 1 && listeners <= base + 4, { loops: s.loops, before: base, after: listeners });
      // Results (defeat) then Main menu.
      await page.click('#btn-play'); await page.click('.map-card[data-map="fiesta"]'); await page.click('#btn-maps-start');
      await sleep(800);
      await page.evaluate(() => { const g = (window as any).__chancla.app.game; g.player.invuln = 0; g.player.damage(1000); });
      await page.waitForSelector('#screen-results:not([hidden])', { timeout: 15000 });
      check('Arcade: a lost run ends on the results screen with Change map and Main menu', await page.isVisible('#btn-results-maps') && await page.isVisible('#btn-results-home'));
      await page.click('#btn-results-home');
      await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
      check('Arcade: Main menu from results opens the main game', true);
      check('Arcade: no page errors', errors.length === 0, errors.slice(0, 4));
      await close();
    }

    // ------------------------------------------------------------ Online (local server)
    {
      server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: ROOT, env: { ...process.env, PORT: '8787' }, stdio: ['ignore', 'pipe', 'pipe'] });
      await new Promise<void>((res, rej) => { const t = setTimeout(() => rej(new Error('server')), 15000); server!.stdout!.on('data', (d: Buffer) => { if (String(d).includes('listening')) { clearTimeout(t); res(); } }); });
      const { page, errors, close } = await open(browser, SITE);
      await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
      await page.waitForFunction(() => !(document.getElementById('btn-online') as HTMLButtonElement).disabled);
      await page.click('#btn-online');
      await page.fill('#in-name', 'Host');
      await page.click('#btn-create');
      await page.waitForFunction(() => (window as any).__fps.screen === 'lobby');
      await page.click('[data-lmap="fiesta"]');
      const code = await page.evaluate(() => (window as any).__fps.session().room.code);
      const guest = new NetClient('ws://localhost:8787/ws', 'Guest');
      await guest.connect({ origin: 'http://localhost:4173' });
      guest.send({ t: 'join', code });
      await until(() => guest.room?.map === 'fiesta', 6000, 'guest sees fiesta');
      check('online (local server): the guest receives the host\'s map', guest.room?.map === 'fiesta');
      guest.send({ t: 'ready', ready: true });
      await page.waitForFunction(() => !(document.getElementById('btn-start') as HTMLButtonElement).disabled);
      await page.click('#btn-start');
      await page.waitForFunction(() => (window as any).__fps.inMatch && (window as any).__fps.screen === 'none');
      await sleep(4500); // past the countdown
      await page.mouse.click(640, 360); await sleep(300);
      await page.keyboard.press('Escape'); await sleep(300);
      const a = await fps(page);
      await sleep(2200);
      const b = await fps(page);
      check('online: Escape opens the menu, which says the match continues online', a.screen === 'pause' && /continues online|continúa/i.test(a.note), a.note);
      check('online: the match clock keeps running while the menu is open (not paused)', a.tl !== null && b.tl !== null && b.tl < a.tl, { a: a.tl, b: b.tl });
      check('online: the host plays on the chosen map with a team label', a.map === 'fiesta' && /YOUR TEAM/.test(a.chip), { map: a.map, chip: a.chip });
      await page.click('#btn-pause-leave'); await page.click('#btn-confirm-yes'); await sleep(500);
      check('online: Main menu (with confirmation) leaves the match', (await fps(page)).screen === 'title');
      guest.kill();
      check('online: no page errors', errors.length === 0, errors.slice(0, 4));
      await close();
    }
  } finally {
    server?.kill('SIGTERM');
    await browser.close();
    preview?.kill();
  }
  const passed = checks.filter((c) => c.ok).length;
  fs.writeFileSync(path.join(OUT, 'play-e2e.json'), JSON.stringify({ at: new Date().toISOString(), passed, total: checks.length, checks }, null, 2));
  console.log(`${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exitCode = 1;
}

void main();
