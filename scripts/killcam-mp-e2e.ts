// The elimination replay online, on a local server only: the victim plays
// in a real browser page; the attacker is a scripted client on the same
// local server (the real protocol and client code, no browser). The
// attacker walks up and lands El Revés until the victim is eliminated, three
// times. Checks that the victim's replay plays (and, in turn, that Esc and a
// dropped connection end it), while the attacker's match carries on
// normally: it keeps moving and receiving snapshots, nothing is applied
// twice, and both sides agree on the score. The page may reach only the
// local site and the local game server; anything else is blocked and fails
// the run.
//
//   npx vite build --outDir ../dist-mp   (a normal build: online play allowed, to localhost only)
//   DIST=../dist-mp OUT=<dir> node --import tsx scripts/killcam-mp-e2e.ts
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import WS from 'ws';
import type { Browser, Page } from 'playwright-core';
import { GameSession, wsTransport, type LocalInput } from '../src/net/session';
import { NET } from '../shared/config';
import { mapData } from '../shared/maps';
import { World } from '../shared/physics';
import { buildNavGraph, findPath, nearestNode } from '../shared/navgraph';
import type { SimEvent } from '../shared/sim';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const WEB = 4188, GAME = 8787;
const SITE = `http://localhost:${WEB}/`;
const DIST = path.resolve(process.env.DIST || path.join(ROOT, '../dist-mp'));
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'artifacts/killcam-mp'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: Array<{ name: string; ok: boolean; detail: unknown }> = [];
function check(name: string, ok: boolean, detail: unknown = null): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== null ? ` ${JSON.stringify(detail)}` : ''}`);
}
async function until(f: () => boolean | Promise<boolean>, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await f()) return; await sleep(50); }
  throw new Error(`timeout: ${what}`);
}
async function waitHttp(url: string, ms = 20000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { await fetch(url); return; } catch { /* not yet */ } await sleep(250); }
  throw new Error(`no ${url}`);
}

class OriginWS extends WS { constructor(url: string) { super(url, { origin: `http://localhost:${WEB}` }); } }

async function main(): Promise<void> {
  const procs: ChildProcess[] = [];
  const env = { ...process.env, PORT: String(GAME), ALLOWED_ORIGINS: `http://localhost:${WEB}`, MATCH_COUNTDOWN_MS: '1500', MATCH_DURATION_MS: '300000', MATCH_SCORE_TO_WIN: '20' };
  delete env.VITE_GAME_SERVER_URL;
  const srv = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stdout!.pipe(fs.createWriteStream(path.join(OUT, 'server.log')));
  procs.push(srv);
  procs.push(spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(WEB), '--strictPort', '--outDir', DIST], { cwd: ROOT, stdio: 'ignore' }));
  await waitHttp(SITE);
  await waitHttp(`http://localhost:${GAME}/healthz`);
  const browser: Browser = await launch();
  const blocked: string[] = [];
  const sockets: string[] = [];
  let tick: ReturnType<typeof setInterval> | null = null;
  let a: GameSession | null = null;
  try {
    const ctx = await browser.newContext({ viewport: { width: 768, height: 432 } });
    const local = (u: string) => u.startsWith(SITE) || u.startsWith(`http://localhost:${GAME}/`) || u.startsWith('data:') || u.startsWith('blob:');
    await ctx.route('**/*', (r) => { const u = r.request().url(); if (local(u)) return r.continue(); blocked.push(u); return r.abort(); });
    const p: Page = await ctx.newPage();
    p.on('websocket', (w) => sockets.push(w.url()));
    await p.addInitScript({ content: `window.__name = (f) => f; try { localStorage.setItem('chancla.mp.settings.v1', JSON.stringify({ name: 'Rosa', quality: 'low', qualityMode: 'low', music: 0, killcam: true, lang: 'en' })); } catch {}` });
    await p.goto(SITE);
    await p.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { polling: 100 });
    await p.click('#btn-online');
    await p.click('#btn-create');
    await p.waitForFunction(() => /#room=/.test((document.getElementById('invite-url') as HTMLInputElement)?.value ?? ''), undefined, { timeout: 10000 });
    const code = (await p.inputValue('#invite-url')).split('#room=')[1]!;

    // The attacker: a scripted client on the same local server.
    const seen = { elims: new Map<number, number>(), hitsOnB: 0, handled: 0 };
    a = new GameSession(wsTransport(`ws://localhost:${GAME}/ws`, OriginWS as unknown as { new (url: string): WebSocket }), {
      event: (e: SimEvent) => {
        seen.handled++;
        if (e.k === 'elim' && e.m !== undefined) seen.elims.set(e.m, (seen.elims.get(e.m) ?? 0) + 1);
      },
    });
    a.connect('Lupe');
    await until(() => a!.state === 'online', 5000, 'attacker online');
    a.send({ t: 'join', code });
    await until(() => !!a!.room && a!.room.members.length === 2, 5000, 'joined');
    const bId = a.room!.members.find((m) => m.id !== a!.id)!.id;
    if (a.team === a.room!.members.find((m) => m.id === bId)!.team) a.send({ t: 'team', team: a.team === 0 ? 1 : 0 });
    await sleep(300);
    a.send({ t: 'ready', ready: true });
    await p.waitForFunction(() => !(document.getElementById('btn-start') as HTMLButtonElement).disabled, undefined, { timeout: 8000 });
    await p.click('#btn-start');
    await until(() => a!.phase === 'playing', 10000, 'playing');
    await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing', undefined, { timeout: 10000 });
    if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true }); else await p.click('#stage', { force: true });
    // The attacker walks to the victim (standing still) and swings El Revés at her head.
    const map = mapData('patio'), world = new World(map.boxes), graph = buildNavGraph(map, world);
    let pathN: number[] = [], replanAt = 0, t = 0, lastPress = -1e9, stuckAt = { x: 0, z: 0 };

    // The victim walks over to the attacker along the navigation graph (her view turned toward the next
    // node, W held: real keys in the page), then stands still in front of her.
    const walkOut = async () => {
      const where = () => p.evaluate((aid) => {
        const s = (window as any).__fps.session(), r = s.remotes.get(aid);
        return { x: s.body.x, y: s.body.y, z: s.body.z, alive: s.alive, ax: r?.x ?? 0, az: r?.z ?? 0 };
      }, a!.id);
      let me = await where();
      const route = findPath(graph, nearestNode(graph, world, me), nearestNode(graph, world, { x: me.ax, y: 0, z: me.az }));
      const end = Date.now() + 30000;
      let down = false, stuck = { x: me.x, z: me.z, at: Date.now() };
      while (Date.now() < end && me.alive) {
        const dA = Math.hypot(me.ax - me.x, me.az - me.z);
        if (dA < 1.8) break;
        let n = route[0] !== undefined ? graph.nodes[route[0]]! : { x: me.ax, z: me.az };
        if (route.length && Math.hypot(n.x - me.x, n.z - me.z) < 0.9) { route.shift(); continue; }
        if (Date.now() - stuck.at > 1500) { if (Math.hypot(me.x - stuck.x, me.z - stuck.z) < 0.3 && route.length) route.shift(); stuck = { x: me.x, z: me.z, at: Date.now() }; }
        if (dA < 3) n = { x: me.ax, z: me.az };
        await p.evaluate(([x, z]) => { const f = (window as any).__fps, s = f.session(); f.input().yaw = Math.atan2(-(x! - s.body.x), -(z! - s.body.z)); }, [n.x, n.z]);
        if (!down) { await p.keyboard.down('KeyW'); down = true; }
        await sleep(60);
        me = await where();
      }
      if (down) await p.keyboard.up('KeyW');
    };

    const idle: LocalInput = { mx: 0, mz: 0, yaw: 0, pitch: 0, fire: false, jump: false, crouch: false, weapon: 1 };
    let attack = true;
    const moves: Array<[number, number]> = [];
    // The attacker waits in the open plaza (east of the fountain) and swings El Revés at the victim's head when she is in reach.
    const SPOT = { x: 7, y: 0, z: 4 };
    const step = () => {
      const s = a!;
      t++;
      const r = s.remotes.get(bId);
      let inp: LocalInput = { ...idle, yaw: s.yaw };
      const toSpot = Math.hypot(SPOT.x - s.body.x, SPOT.z - s.body.z);
      if (attack && s.alive && toSpot > 1.2 && !(r && r.alive && Math.hypot(r.x - s.body.x, r.z - s.body.z) < 2.5)) {
        if (!pathN.length && t >= replanAt) { pathN = findPath(graph, nearestNode(graph, world, s.body), nearestNode(graph, world, SPOT)); replanAt = t + 30; }
        if (t % 60 === 0) { if (Math.hypot(s.body.x - stuckAt.x, s.body.z - stuckAt.z) < 0.3) pathN.shift(); stuckAt = { x: s.body.x, z: s.body.z }; }
        const n = pathN[0] !== undefined ? graph.nodes[pathN[0]] : SPOT;
        if (n && pathN.length && Math.hypot(n.x - s.body.x, n.z - s.body.z) < 1.0) pathN.shift();
        inp = { ...idle, yaw: Math.atan2(-(n!.x - s.body.x), -(n!.z - s.body.z)), mz: 1 };
      } else if (attack && r && r.alive && s.alive) {
        const dx = r.x - s.body.x, dz = r.z - s.body.z, d = Math.hypot(dx, dz);
        const yaw = Math.atan2(-dx, -dz);
        const pitch = Math.atan2(r.y + 1.52 - (s.body.y + 1.58), Math.max(0.6, d - 0.25));
        const inReach = d < 1.35;
        const press = inReach && s.meleeMs <= 0 && s.switchMs <= 0 && t - lastPress > 10;
        if (press) lastPress = t;
        inp = { ...idle, yaw, pitch: inReach ? pitch : 0, mz: d > 1.1 && d < 2.5 ? 1 : 0, melee: press };
      } else if (!attack) {
        // While the victim watches her replay, the attacker walks a small circle: her match goes on.
        inp = { ...idle, yaw: (t / 40) % (Math.PI * 2), mz: 1, weapon: 1 };
      }
      s.tick(inp);
      s.flush();
      s.updateRemotes();
      if (t % 6 === 0) moves.push([s.body.x, s.body.z]);
    };
    let acc = 0, last = performance.now();
    tick = setInterval(() => { const now = performance.now(); acc += now - last; last = now; let n = 0; while (acc >= 1000 / NET.tickRate && n++ < 6) { acc -= 1000 / NET.tickRate; step(); } }, 4);

    const kState = () => p.evaluate(() => (window as any).__fps.engine().killcamState);
    const kill = async (label: string) => {
      attack = true;
      pathN = [];
      await until(() => Math.hypot(SPOT.x - a!.body.x, SPOT.z - a!.body.z) < 1.5, 30000, `${label}: attacker at her spot`);
      await walkOut();
      const before = seen.elims.size;
      const dbg = setInterval(() => { const r = a!.remotes.get(bId); if (process.env.KC_DEBUG) console.log(JSON.stringify({ t, a: [a!.body.x.toFixed(1), a!.body.z.toFixed(1), a!.alive, a!.weapon, a!.meleeMs], b: r && [r.x.toFixed(1), r.z.toFixed(1), r.alive, r.hp, r.protected], path: pathN.length, phase: a!.phase, teams: a!.room?.members.map((m) => [m.id, m.team]), me: a!.id, crouch: r?.crouched })); }, 3000);
      try { await until(() => seen.elims.size > before, 60000, `${label}: attacker eliminates the victim`); } finally { clearInterval(dbg); }
      attack = false;
    };

    // 1. A replay plays; the attacker's match continues meanwhile.
    await kill('first');
    await p.waitForFunction(() => (window as any).__fps.engine().killcamState.active, undefined, { timeout: 4000, polling: 30 });
    const k1 = await kState();
    await p.screenshot({ path: path.join(OUT, 'online-replay.png') });
    const snapsAt = a.msgsIn, movesAt = moves.length, posAt = [a.body.x, a.body.z], t0 = Date.now();
    await p.waitForFunction(() => !(window as any).__fps.engine().killcamState.active, undefined, { timeout: 5000, polling: 30 });
    const k1b = await kState();
    const moved = Math.hypot(a.body.x - posAt[0]!, a.body.z - posAt[1]!), ms = Date.now() - t0;
    check('online: the victim sees a replay of the Revés from the attacker', k1.active && k1.killer === a.id, { view: k1.view, killer: k1.killer, attacker: a.id });
    check('online: the replay plays to its end', k1b.last?.reason === 'done', k1b.last);
    check('online: the attacker keeps playing meanwhile (moves, gets at least 10 snapshots a second, alive)', moved > 1 && a.msgsIn - snapsAt >= ms / 100 && a.alive && moves.length > movesAt, { moved: +moved.toFixed(2), msgs: a.msgsIn - snapsAt, ms, alive: a.alive });
    await p.waitForFunction(() => (window as any).__fps.session().alive, undefined, { timeout: 6000 });
    await sleep(400);
    const sc1 = { a: a.snap?.sc, b: await p.evaluate(() => (window as any).__fps.session().snap?.sc) };
    check('online: both sides agree on the score; each elimination handled once', JSON.stringify(sc1.a) === JSON.stringify(sc1.b) && [...seen.elims.values()].every((n) => n === 1), { sc1, elims: [...seen.elims.values()] });

    // 2. Esc online opens the menu and ends the replay (the match goes on behind it).
    await kill('second');
    await p.waitForFunction(() => (window as any).__fps.engine().killcamState.active, undefined, { timeout: 4000, polling: 30 });
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !(window as any).__fps.engine().killcamState.active, undefined, { timeout: 2000, polling: 30 });
    const k2 = await kState();
    const screen2 = await p.evaluate(() => (window as any).__fps.screen);
    check('online: Esc opens the menu and ends the replay', k2.last?.reason === 'menu' && screen2 === 'pause', { reason: k2.last?.reason, screen2 });
    await p.click('#btn-resume');
    if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true });
    await p.waitForFunction(() => (window as any).__fps.session().alive, undefined, { timeout: 6000 });

    // 3. A dropped connection ends it; after the reconnect nothing is replayed or counted twice.
    await kill('third');
    await p.waitForFunction(() => (window as any).__fps.engine().killcamState.active, undefined, { timeout: 4000, polling: 30 });
    await p.evaluate(() => (window as any).__fps.session().checkAlive(0));
    await p.waitForFunction(() => !(window as any).__fps.engine().killcamState.active, undefined, { timeout: 2000, polling: 30 });
    const k3 = await kState();
    await p.waitForFunction(() => (window as any).__fps.session().state === 'online', undefined, { timeout: 15000 });
    await p.waitForFunction(() => (window as any).__fps.session().alive, undefined, { timeout: 8000 });
    await sleep(800);
    const k3b = await kState();
    const sc3 = { a: a.snap?.sc, b: await p.evaluate(() => (window as any).__fps.session().snap?.sc) };
    check('reconnect: the replay ends; no second replay after it', k3.last?.reason === 'connection' && k3b.counts.started === 3, { reason: k3.last?.reason, started: k3b.counts.started, repeats: k3b.counts.repeats });
    check('reconnect: the score still agrees; three eliminations, each once', JSON.stringify(sc3.a) === JSON.stringify(sc3.b) && seen.elims.size === 3 && [...seen.elims.values()].every((n) => n === 1), { sc3 });

    check('only the local site and the local game server were contacted', blocked.length === 0 && sockets.every((u) => u.startsWith(`ws://localhost:${GAME}/`)), { blocked, sockets });
    await ctx.close();
  } finally {
    if (tick) clearInterval(tick);
    a?.close();
    await browser.close();
    for (const c of procs) c.kill('SIGTERM');
    fs.writeFileSync(path.join(OUT, 'killcam-mp-e2e.json'), JSON.stringify(results, null, 1));
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
