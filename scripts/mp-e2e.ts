// Browser end-to-end test for online play: real pages, real server, real UI.
//
//   node --import tsx scripts/mp-e2e.ts [players=2|4]
//
// Starts the game server and `vite preview` (run `npm run build` first), opens
// one isolated browser context per player, and drives the whole flow through
// the page: create a room, join by invite link, ready up, start, fight to the
// score limit, view results, rematch, leave.
//
// Movement, firing and weapon switching go through the page's real keyboard
// and mouse listeners. Steering and aiming are scripted (an in-page
// autopilot sets the look angles), so this proves the netcode and match flow,
// not human aim. Screenshots, a video of player 1 and a JSON report are
// written to artifacts/mp/.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { EL_PATIO } from '../shared/map';
import { World } from '../shared/physics';
import { buildNavGraph, findPath } from '../shared/navgraph';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'artifacts/mp');
const PLAYERS = Number(process.argv[2] || 2) === 4 ? 4 : 2;
const SITE = process.env.E2E_URL || 'http://localhost:4173/';
const PORT = 8787;
fs.mkdirSync(OUT, { recursive: true });

const graph = buildNavGraph(EL_PATIO, new World(EL_PATIO.boxes));
function nearest(x: number, y: number, z: number): number {
  let best = 0, bd = Infinity;
  graph.nodes.forEach((n, i) => { const d = Math.hypot(n.x - x, n.z - z) + Math.abs(n.y - y) * 3; if (d < bd) { bd = d; best = i; } });
  return best;
}
function route(from: [number, number, number], to: { x: number; z: number }): Array<{ x: number; z: number }> {
  return findPath(graph, nearest(...from), nearest(to.x, 0, to.z)).map((i) => ({ x: graph.nodes[i]!.x, z: graph.nodes[i]!.z }));
}

const report: Record<string, unknown> = { players: PLAYERS, startedAt: new Date().toISOString(), steps: [] as string[] };
const steps = report.steps as string[];
const step = (s: string) => { steps.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`); console.log(steps[steps.length - 1]); };
const t0 = Date.now();

async function waitHttp(url: string, ms = 20000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout waiting for ${url}`);
}

const children: ChildProcess[] = [];
let openBrowser: Browser | null = null;
function startProcs(): void {
  const env = { ...process.env, PORT: String(PORT), MATCH_COUNTDOWN_MS: '2000', MATCH_SCORE_TO_WIN: PLAYERS === 4 ? '5' : '3', MATCH_DURATION_MS: '100000' };
  const srv = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const srvLog = fs.createWriteStream(path.join(OUT, `server-${PLAYERS}p.log`));
  srv.stdout!.pipe(srvLog); srv.stderr!.pipe(srvLog);
  children.push(srv);
  if (!process.env.E2E_URL) {
    const prev = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
    children.push(prev);
  }
}

// In-page autopilot: follows a path supplied from Node, then fights.
function installAutopilot(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __fps: any; __ap: any };
    const fire = (down: boolean) => document.dispatchEvent(new MouseEvent(down ? 'mousedown' : 'mouseup', { button: 0 }));
    const key = (code: string, down: boolean) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
    const ap = { path: [] as Array<{ x: number; z: number }>, needPath: true, wasAlive: false, firing: false, moving: false, shots: 0, fights: 0, weaponFlip: 0, on: true, blockedUntil: 0, target: -1, targetHp: 0, since: 0 };
    w.__ap = ap;
    setInterval(() => {
      if (!ap.on) return;
      const s = w.__fps.session();
      const input = w.__fps.input();
      if (!s || !input) return;
      if (!s.alive || s.phase !== 'playing') {
        if (ap.firing) { fire(false); ap.firing = false; }
        if (ap.moving) { key('KeyW', false); ap.moving = false; }
        if (!s.alive) ap.needPath = true;
        return;
      }
      const me = s.body;
      const myTeam = s.team;
      let best: any = null, bd = Infinity;
      for (const r of s.remotes.values()) {
        const m = s.room?.members.find((x: any) => x.id === r.id);
        if (!m || m.team === myTeam || !r.alive) continue;
        const d = Math.hypot(r.x - me.x, r.z - me.z);
        if (d < bd) { bd = d; best = r; }
      }
      // Throws that never land mean a wall is in the way: go somewhere else.
      if (best && bd < 16 && performance.now() > ap.blockedUntil) {
        if (best.id !== ap.target || best.hp < ap.targetHp) { ap.target = best.id; ap.targetHp = best.hp; ap.since = performance.now(); }
        if (performance.now() - ap.since > 2500) { ap.blockedUntil = performance.now() + 3500; ap.needPath = true; ap.since = performance.now(); }
        const dx = best.x - me.x, dz = best.z - me.z;
        input.yaw = Math.atan2(-dx, -dz);
        input.pitch = Math.atan2(best.y + 1.05 - (me.y + 1.58), bd);
        if (ap.moving) { key('KeyW', false); ap.moving = false; }
        // Tap the trigger so each throw is a separate press.
        ap.firing = !ap.firing;
        fire(ap.firing);
        if (ap.firing) ap.shots++;
        ap.fights++;
        // Occasionally swap to La Pesada and back to exercise switching.
        if (++ap.weaponFlip % 60 === 0) { key('Digit2', true); key('Digit2', false); }
        if (ap.weaponFlip % 60 === 25) { key('Digit1', true); key('Digit1', false); }
        return;
      }
      if (ap.firing) { fire(false); ap.firing = false; }
      while (ap.path.length && Math.hypot(ap.path[0]!.x - me.x, ap.path[0]!.z - me.z) < 0.7) ap.path.shift();
      const n = ap.path[0];
      if (!n) { if (ap.moving) { key('KeyW', false); ap.moving = false; } return; }
      input.yaw = Math.atan2(-(n.x - me.x), -(n.z - me.z));
      input.pitch = 0;
      if (!ap.moving) { key('KeyW', true); ap.moving = true; }
    }, 50);
  });
}

async function newPlayer(browser: Browser, i: number, video: boolean): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({
    viewport: { width: 960, height: 540 },
    ...(video ? { recordVideo: { dir: OUT, size: { width: 960, height: 540 } } } : {}),
  });
  // tsx compiles functions passed to page.evaluate with a __name helper.
  await ctx.addInitScript({ content: 'window.__name = (f) => f;' });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('dialog', (d) => void d.accept());
  void i;
  return { ctx, page, errors };
}

const fps = (p: Page) => p.evaluate(() => (window as any).__fps);
const info = (p: Page) => p.evaluate(() => (window as any).__fps.info());
async function waitFor(p: Page, fn: string, ms = 60000): Promise<void> {
  await p.waitForFunction(fn, null, { timeout: ms, polling: 100 });
}
async function clickIfVisible(p: Page, sel: string): Promise<void> {
  if (await p.locator(sel).isVisible()) await p.click(sel);
}

async function main(): Promise<void> {
  startProcs();
  await waitHttp(`http://localhost:${PORT}/healthz`);
  await waitHttp(SITE);
  step('server and site up');
  const browser: Browser = await launch(['--mute-audio']);
  openBrowser = browser;
  const names = ['Ana', 'Beto', 'Carmen', 'Dani'];
  const players = [] as Array<Awaited<ReturnType<typeof newPlayer>>>;
  for (let i = 0; i < PLAYERS; i++) players.push(await newPlayer(browser, i, i === 0));
  const A = players[0]!.page;

  // Host creates a room.
  await A.goto(SITE);
  await waitFor(A, "window.__fps && window.__fps.screen === 'title'");
  await waitFor(A, "document.getElementById('server-status').classList.contains('ok')", 8000);
  step('title shows server ready');
  await A.screenshot({ path: path.join(OUT, `${PLAYERS}p-01-title.png`) });
  await A.click('#btn-online');
  await A.fill('#in-name', names[0]!);
  await A.click('#btn-create');
  await waitFor(A, "window.__fps.screen === 'lobby' && !!window.__fps.code");
  const code: string = await A.evaluate(() => (window as any).__fps.code);
  const invite = await A.inputValue('#invite-url');
  report.inviteHasOnlyCode = invite.endsWith(`#room=${code}`) && !/token|key|secret/i.test(invite);
  step(`room created; invite link format ${invite.replace(code, '<code>')}`);

  // Everyone else joins through the invite link.
  for (let i = 1; i < PLAYERS; i++) {
    const p = players[i]!.page;
    await p.goto(invite);
    await waitFor(p, "window.__fps && window.__fps.screen === 'online'");
    const prefilled = await p.inputValue('#in-code');
    if (prefilled !== code) throw new Error(`invite did not prefill the code (${prefilled.length} chars)`);
    const hashLeft = await p.evaluate(() => location.hash);
    if (hashLeft) throw new Error('invite code left in the address bar');
    await p.fill('#in-name', names[i]!);
    await p.click('#btn-join');
    await waitFor(p, "window.__fps.screen === 'lobby'");
    step(`${names[i]} joined by invite link`);
  }
  // Teams: in a 4-player room the server balances 2v2 automatically.
  await waitFor(A, `window.__fps.room && window.__fps.room.members === ${PLAYERS}`);
  await A.screenshot({ path: path.join(OUT, `${PLAYERS}p-02-lobby-host.png`) });
  const startDisabledBefore = await A.isDisabled('#btn-start');
  for (let i = 1; i < PLAYERS; i++) await players[i]!.page.click('#btn-ready');
  await A.waitForFunction(() => !(document.getElementById('btn-start') as HTMLButtonElement).disabled, null, { timeout: 8000 });
  report.startGatedOnReady = startDisabledBefore;
  await players[1]!.page.screenshot({ path: path.join(OUT, `${PLAYERS}p-03-lobby-guest.png`) });
  step('everyone ready; host can start');
  await A.click('#btn-start');
  for (const { page } of players) await waitFor(page, 'window.__fps.inMatch');
  step('match started on every client');
  for (const { page } of players) { await clickIfVisible(page, '#btn-click-play'); await installAutopilot(page); }
  await A.waitForTimeout(600);
  await A.screenshot({ path: path.join(OUT, `${PLAYERS}p-04-countdown.png`) });

  // Fight to the score limit, re-routing after each respawn.
  const dests = [{ x: -6, z: 3.5 }, { x: 6.5, z: 2.5 }, { x: -3, z: -6 }, { x: 3, z: 6 }];
  const fpsSamples: number[] = [];
  let combatShot = false, sbShot = false;
  const deadline = Date.now() + 170000;
  let lastLog = 0;
  for (;;) {
    if (Date.now() > deadline) throw new Error('match did not finish in time');
    const phases: string[] = [];
    for (let i = 0; i < players.length; i++) {
      const p = players[i]!.page;
      const st = await p.evaluate(() => {
        const f = (window as any).__fps; const s = f.session(); const ap = (window as any).__ap;
        return { phase: s?.phase, alive: s?.alive, pos: s ? [s.body.x, s.body.y, s.body.z] : null, need: ap?.needPath, fps: f.info().fps, remotesNear: s ? [...s.remotes.values()].filter((r: any) => r.alive && Math.hypot(r.x - s.body.x, r.z - s.body.z) < 12).length : 0, screen: f.screen };
      });
      phases.push(st.screen === 'results' ? 'results' : st.phase);
      if (st.alive && st.need && st.pos) {
        const d = dests[(i + Math.floor(Math.random() * 2) * 2) % dests.length]!;
        const r = route(st.pos as [number, number, number], d);
        await p.evaluate((r) => { const ap = (window as any).__ap; ap.path = r; ap.needPath = false; }, r);
      }
      if (i === 0) {
        if (st.phase === 'playing' && st.fps) fpsSamples.push(st.fps);
        if (!combatShot && st.remotesNear > 0 && st.alive) {
          await A.waitForTimeout(250);
          await A.screenshot({ path: path.join(OUT, `${PLAYERS}p-05-combat.png`) });
          combatShot = true;
          step('combat screenshot (enemy within 12 m)');
        }
        if (combatShot && !sbShot && st.phase === 'playing') {
          await A.keyboard.down('Tab');
          await A.waitForTimeout(150);
          await A.screenshot({ path: path.join(OUT, `${PLAYERS}p-06-scoreboard.png`) });
          await A.keyboard.up('Tab');
          sbShot = true;
        }
      }
    }
    if (Date.now() - lastLog > 10000) {
      lastLog = Date.now();
      const sc = await A.evaluate(() => (window as any).__fps.session()?.snap?.sc);
      const dbg = await Promise.all(players.map(({ page }) => page.evaluate(() => {
        const s = (window as any).__fps.session(); const ap = (window as any).__ap;
        return `${s.body.x.toFixed(1)},${s.body.z.toFixed(1)} path=${ap.path.length} mv=${ap.moving} shots=${ap.shots} remotes=${s.remotes.size} vx=${s.body.vx.toFixed(1)}`;
      })));
      step(`score ${JSON.stringify(sc)} phases ${phases.join(',')} | ${dbg.join(' | ')}`);
    }
    if (phases.every((ph) => ph === 'results')) break;
    await A.waitForTimeout(250);
  }
  step('results on every client');
  await A.waitForTimeout(400);
  await A.screenshot({ path: path.join(OUT, `${PLAYERS}p-07-results-host.png`) });
  await players[1]!.page.screenshot({ path: path.join(OUT, `${PLAYERS}p-08-results-guest.png`) });
  const results = await Promise.all(players.map(({ page }) => page.evaluate(() => ({ title: document.getElementById('res-title')!.textContent, sol: document.getElementById('res-sol')!.textContent, luna: document.getElementById('res-luna')!.textContent }))));
  report.resultsConsistent = results.every((r) => JSON.stringify(r) === JSON.stringify(results[0]));
  report.results = results[0];
  const infos = await Promise.all(players.map(({ page }) => info(page)));
  report.clientInfo = infos;

  // Rematch: host only; everyone returns to the match.
  const guestSeesRematch = await players[1]!.page.isVisible('#btn-rematch');
  report.rematchHostOnly = !guestSeesRematch;
  for (const { page } of players) await page.evaluate(() => { (window as any).__ap.on = false; });
  await A.click('#btn-rematch');
  for (const { page } of players) await waitFor(page, "window.__fps.inMatch && window.__fps.screen === 'none'");
  const scoresAfter = await A.evaluate(() => new Promise((r) => setTimeout(() => r((window as any).__fps.session()?.snap?.sc), 800)));
  report.rematchScoresReset = JSON.stringify(scoresAfter) === '[0,0]';
  step(`rematch started; scores ${JSON.stringify(scoresAfter)}`);

  // A guest leaves mid-match through the menu with confirmation.
  const G = players[PLAYERS - 1]!.page;
  await G.keyboard.press('Escape');
  await G.evaluate(() => (window as any).__fps.input().exitLock());
  await waitFor(G, "window.__fps.screen === 'pause'", 5000).catch(async () => { await G.click('#btn-menu'); });
  await waitFor(G, "window.__fps.screen === 'pause'");
  await G.click('#btn-pause-leave');
  await waitFor(G, "window.__fps.screen === 'confirm'");
  await G.screenshot({ path: path.join(OUT, `${PLAYERS}p-09-confirm-leave.png`) });
  await G.click('#btn-confirm-yes');
  await waitFor(G, "window.__fps.screen === 'title'");
  await waitFor(A, `window.__fps.room && window.__fps.room.members === ${PLAYERS - 1}`, 8000);
  step('guest left with confirmation; host sees the roster shrink');

  // Joining a bogus room shows a clear error.
  await G.click('#btn-online');
  await G.fill('#in-code', 'ZZZZ2222');
  await G.click('#btn-join');
  await G.waitForFunction(() => /not exist|no existe/.test(document.getElementById('online-err')!.textContent || ''), null, { timeout: 8000 });
  step('invalid room code shows an error');

  report.errors = players.map((p, i) => ({ player: names[i], errors: p.errors.slice(0, 20) }));
  fpsSamples.sort((a, b) => a - b);
  report.fpsPlayer1 = fpsSamples.length ? { samples: fpsSamples.length, median: fpsSamples[Math.floor(fpsSamples.length / 2)], p10: fpsSamples[Math.floor(fpsSamples.length * 0.1)], note: 'Headless Chromium with SwiftShader (CPU rendering), all clients on one machine. Not representative of real GPUs.' } : null;
  const vid = await A.video()?.path();
  for (const { ctx } of players) await ctx.close();
  if (vid && fs.existsSync(vid)) { fs.renameSync(vid, path.join(OUT, `${PLAYERS}p-match.webm`)); report.video = `artifacts/mp/${PLAYERS}p-match.webm`; }
  await browser.close();
  report.finishedAt = new Date().toISOString();
  report.ok = true;
}

main()
  .catch((e) => { report.ok = false; report.failure = String(e?.stack || e); console.error(e); process.exitCode = 1; })
  .finally(async () => {
    await openBrowser?.close().catch(() => {});
    fs.writeFileSync(path.join(OUT, `e2e-${PLAYERS}p.json`), JSON.stringify(report, null, 2));
    for (const c of children) c.kill('SIGTERM');
  });
