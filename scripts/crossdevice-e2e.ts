// Four-player mixed-input match in BROWSER EMULATION: four separate Chromium
// instances standing in for an iPhone, an Android phone, an iPad and a
// Windows/Mac desktop, in one private room on a LOCAL game server.
//
//   npm run build && node --import tsx scripts/crossdevice-e2e.ts
//
// Every client is Chromium (Blink). The "devices" differ only in viewport,
// pixel density, touch support and user-agent string; there is no Safari,
// WebKit, iOS, Android, Windows or macOS here. This proves the shared rooms,
// inputs and rules work across input types and screen shapes; it says
// nothing about Safari/WebKit behaviour, real touch hardware or performance.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright-core';
import { World } from '../shared/physics';
import { mapData } from '../shared/maps';
import { buildNavGraph, findPath, nearestNode, walkReaches } from '../shared/navgraph';
import { lineOfSight } from '../shared/collision';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SITE = 'http://localhost:4173/';
const PORT = 8787;
const OUT = path.join(ROOT, 'docs/evidence/crossdevice');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`); };

const DEVICES = {
  iphone: { label: 'iPhone (emulated)', viewport: { width: 844, height: 390 }, dpr: 3, touch: true, mobile: true, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
  android: { label: 'Android phone (emulated)', viewport: { width: 915, height: 412 }, dpr: 2.625, touch: true, mobile: true, ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36' },
  ipad: { label: 'iPad (emulated)', viewport: { width: 1180, height: 820 }, dpr: 2, touch: true, mobile: false, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15' },
  desktop: { label: 'Windows/Mac desktop (emulated)', viewport: { width: 1280, height: 720 }, dpr: 1, touch: false, mobile: false, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0' },
} as const;
type DevId = keyof typeof DEVICES;
interface Client { id: DevId; browser: Browser; ctx: BrowserContext; p: Page; cdp: CDPSession; errors: string[] }

async function waitHttp(url: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}
type Pt = { x: number; y: number; id: number };
const T = (c: Client, type: 'touchStart' | 'touchMove' | 'touchEnd', pts: Pt[]) => c.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q) => ({ ...q, radiusX: 8, radiusY: 8, force: 1 })) });
async function center(p: Page, sel: string) { const b = (await p.locator(sel).boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
async function tap(c: Client, sel: string): Promise<void> {
  await c.p.locator(sel).scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
  const q = await center(c.p, sel);
  await T(c, 'touchStart', [{ ...q, id: 40 }]); await sleep(50); await T(c, 'touchEnd', [{ ...q, id: 40 }]); await sleep(200);
}
const st = (c: Client) => c.p.evaluate(() => {
  const f = (window as any).__fps; const s = f.session(); const i = f.input();
  return { screen: f.screen, inMatch: f.inMatch, team: s?.team ?? null, id: s?.id ?? -1, conn: s?.state ?? null, x: s?.body?.x ?? 0, z: s?.body?.z ?? 0, yaw: i?.yaw ?? 0, shots: s?.localShot ?? 0, held: i?.heldCount ?? -1, touchMode: f.touchMode, controls: !!f.touch()?.visible, locked: !!document.pointerLockElement, map: s?.room?.map ?? null, members: s?.room?.members?.length ?? 0, audio: f.audio().state, bus: f.audio().a?.music?.gain?.value ?? null, sounding: f.music().state().sounding, cue: f.music().state().cue, scores: s?.snap?.scores ?? null, rotate: !document.getElementById('fps-rotate')!.hidden, chip: document.getElementById('team-chip-text')?.textContent ?? '' };
});

/** Three fingers: move + aim + throw together, for about a second. */
async function touchBurst(c: Client): Promise<void> {
  const thr = await center(c.p, '#ft-throw');
  const vp = DEVICES[c.id].viewport;
  const stick = { x: vp.width * 0.13, y: vp.height * 0.74, id: 1 }, look = { x: vp.width * 0.62, y: vp.height * 0.45, id: 2 }, tp = { ...thr, id: 3 };
  await T(c, 'touchStart', [stick]); await T(c, 'touchStart', [stick, look]); await T(c, 'touchStart', [stick, look, tp]);
  for (let i = 1; i <= 8; i++) { await T(c, 'touchMove', [{ ...stick, y: stick.y - Math.min(50, i * 7) }, { ...look, x: look.x + i * 6 }, tp]); await sleep(80); }
  await T(c, 'touchEnd', [stick, look, tp]);
}
async function deskBurst(c: Client): Promise<void> {
  await c.p.keyboard.down('KeyW'); await c.p.mouse.down();
  for (let i = 0; i < 6; i++) { await c.p.mouse.move(640 + i * 20, 360); await sleep(120); }
  await c.p.keyboard.up('KeyW'); await c.p.mouse.up();
}

// Combat. The test steers the VIEW DIRECTION only (in test code; the game
// has no aim assist): it walks the attacker along the game's own navigation
// graph towards the nearest enemy and, once there is a clear line, points
// the view at them. Moving and throwing go through real input: the desktop
// holds W and F on the keyboard, the Android phone holds the on-screen stick
// and Throw button with touch events. The server decides every hit and
// elimination. The targets stand still (nobody is driving them).
async function pilot(attackers: Client[], map: string, done: () => Promise<boolean>, ms: number): Promise<void> {
  const md = mapData(map);
  const world = new World(md.boxes);
  const g = buildNavGraph(md, world);
  const end = Date.now() + ms;
  // Corner clipping: no progress for ~0.6 s means a wall edge; angle off for a moment.
  const stuck = new Map<Client, { x: number; z: number; at: number; dodgeUntil: number; side: number }>();
  // Path following like the game's bots: plan on the graph, then head for the
  // furthest upcoming node that a straight walk actually reaches.
  type P = { x: number; y: number; z: number };
  const plans = new Map<Client, { nodes: P[]; idx: number; replanAt: number }>();
  const nextWaypoint = (c: Client, me: P, t: P): P => {
    const now = Date.now();
    let pl = plans.get(c);
    if (!pl || now > pl.replanAt || pl.idx >= pl.nodes.length) {
      pl = { nodes: [...findPath(g, nearestNode(g, world, me), nearestNode(g, world, t)).map((i) => g.nodes[i]!), t], idx: 0, replanAt: now + 3000 };
      plans.set(c, pl);
    }
    while (pl.idx < pl.nodes.length - 1 && Math.hypot(pl.nodes[pl.idx]!.x - me.x, pl.nodes[pl.idx]!.z - me.z) < 1.0) pl.idx++;
    for (let j = Math.min(pl.nodes.length - 1, pl.idx + 3); j > pl.idx; j--) if (walkReaches(world, me, pl.nodes[j]!)) { pl.idx = j; break; }
    return pl.nodes[pl.idx]!;
  };
  let logAt = 0;
  while (Date.now() < end && !(await done())) {
    const logNow = Date.now() - logAt > 5000;
    if (logNow) logAt = Date.now();
    await Promise.all(attackers.map(async (c) => {
      const v = await c.p.evaluate(() => {
        const s = (window as any).__fps.session();
        if (!s?.alive || !s.room) return null;
        const enemies = [...s.remotes.values()].filter((r: any) => r.alive && s.room.members.find((m: any) => m.id === r.id)?.team !== s.team).map((r: any) => ({ x: r.x, y: r.y, z: r.z }));
        return { x: s.body.x, y: s.body.y, z: s.body.z, enemies };
      });
      if (logNow) console.log(`  pilot ${c.id}: ${v ? `at ${v.x.toFixed(1)},${v.z.toFixed(1)} enemies ${v.enemies.length}` : 'down or no room'} ${JSON.stringify(await c.p.evaluate(() => { const f = (window as any).__fps; return { en: f.input().enabled, lock: f.input().locked, touch: f.touchMode, held: f.input().heldCount, screen: f.screen, shots: f.session()?.localShot, sc: f.session()?.snap?.sc }; }))}`);
      if (!v || !v.enemies.length) return;
      const t = v.enemies.sort((a, b) => Math.hypot(a.x - v.x, a.z - v.z) - Math.hypot(b.x - v.x, b.z - v.z))[0]!;
      const eye = { x: v.x, y: v.y + 1.55, z: v.z }, chest = { x: t.x, y: t.y + 1.1, z: t.z };
      const d = Math.hypot(t.x - v.x, t.z - v.z);
      let yaw: number, pitch = 0;
      if (d < 26 && lineOfSight(eye, chest, world.near(eye.x, eye.z, chest.x, chest.z, 1), () => true)) {
        const tt = d / 42;
        yaw = Math.atan2(-(t.x - v.x), -(t.z - v.z));
        pitch = Math.atan2(chest.y + 0.5 * 5 * tt * tt - eye.y, d);
      } else {
        const wp = nextWaypoint(c, v, t);
        yaw = Math.atan2(-(wp.x - v.x), -(wp.z - v.z));
        const now = Date.now();
        const k = stuck.get(c) ?? { x: v.x, z: v.z, at: now, dodgeUntil: 0, side: 1 };
        if (Math.hypot(v.x - k.x, v.z - k.z) > 0.4) { k.x = v.x; k.z = v.z; k.at = now; }
        else if (now - k.at > 600 && now > k.dodgeUntil) { k.dodgeUntil = now + 500; k.side = -k.side; k.at = now; }
        if (now < k.dodgeUntil) yaw += k.side * 1.2;
        stuck.set(c, k);
      }
      await c.p.evaluate(([y, p]) => { const i = (window as any).__fps.input(); i.yaw = y; i.pitch = p; }, [yaw, pitch] as const);
    }));
    await sleep(100);
  }
}
const scoresOf = (c: Client) => c.p.evaluate(() => (window as any).__fps.session()?.snap?.sc ?? null) as Promise<[number, number] | null>;

async function main(): Promise<void> {
  const procs: ChildProcess[] = [];
  try { await fetch(`http://localhost:${PORT}/healthz`); throw new Error(`port ${PORT} is busy`); } catch (e) { if (String(e).includes('busy')) throw e; }
  procs.push(spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), MATCH_COUNTDOWN_MS: '1500', MATCH_DURATION_MS: '270000', MATCH_SCORE_TO_WIN: '40' }, stdio: 'ignore' }));
  if (!(await waitHttp(SITE, 1500))) procs.push(spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { cwd: ROOT, stdio: 'ignore' }));
  if (!(await waitHttp(`http://localhost:${PORT}/healthz`))) throw new Error('server did not start');
  await waitHttp(SITE);
  const executablePath = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find((x) => fs.existsSync(x));
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--autoplay-policy=document-user-activation-required'];
  const clients: Record<DevId, Client> = {} as Record<DevId, Client>;
  try {
    for (const id of Object.keys(DEVICES) as DevId[]) {
      const d = DEVICES[id];
      const browser = await chromium.launch({ executablePath, headless: true, args }); // one browser per device: separate focus, like separate devices
      const ctx = await browser.newContext({ viewport: d.viewport, deviceScaleFactor: d.dpr, hasTouch: d.touch, isMobile: d.mobile, userAgent: d.ua });
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
      await ctx.addInitScript({ content: `window.__name = (f) => f; localStorage.setItem("chancla.mp.settings.v1", JSON.stringify({ name: "${id}", qualityMode: "low", quality: "low" }));` });
      const p = await ctx.newPage();
      const errors: string[] = [];
      p.on('pageerror', (e) => errors.push(`${id}: ${e.message}`));
      clients[id] = { id, browser, ctx, p, cdp: await ctx.newCDPSession(p), errors };
    }
    const { iphone, android, ipad, desktop } = clients;
    const all = [iphone, android, ipad, desktop];

    // ---- Desktop host creates the room; the others arrive three different ways.
    await desktop.p.goto(SITE);
    await desktop.p.waitForFunction(() => (window as any).__fps?.screen === 'title');
    await desktop.p.click('#btn-online'); await desktop.p.click('#btn-create');
    await desktop.p.waitForFunction(() => (window as any).__fps.screen === 'lobby');
    const invite = await desktop.p.inputValue('#invite-url');
    const code = invite.split('=')[1]!;
    for (const c of [iphone, android]) { // invite link
      await c.p.goto(invite);
      await c.p.waitForFunction(() => (window as any).__fps?.screen === 'online');
      await tap(c, '#btn-join');
    }
    await ipad.p.goto(SITE); // typing the room code
    await ipad.p.waitForFunction(() => (window as any).__fps?.screen === 'title');
    const ipadProfile = await ipad.p.evaluate(() => ({ card: !document.getElementById('mobile-gate')!.hidden, touch: (window as any).__fps.touchMode }));
    check('iPad (touch only, no mouse yet): gets the touch card and touch mode', ipadProfile.card && ipadProfile.touch, ipadProfile);
    await tap(ipad, '#btn-mg-online');
    await ipad.p.fill('#in-code', code.toLowerCase());
    await tap(ipad, '#btn-join');
    for (const c of all) await c.p.waitForFunction(() => (window as any).__fps.screen === 'lobby' && (window as any).__fps.session().room.members.length === 4, undefined, { timeout: 15000 });
    let s = await Promise.all(all.map(st));
    const teams = s.map((x) => x.team);
    check('four devices in one room, two per team, the same roster on every device', s.every((x) => x.members === 4) && teams.filter((t) => t === 0).length === 2 && teams.filter((t) => t === 1).length === 2, teams);
    check('every device unlocked audio with its own gesture (tap or click)', s.every((x) => x.audio === 'running'), s.map((x) => x.audio));
    for (const c of [iphone, android, ipad]) await tap(c, '#btn-ready');
    await desktop.p.screenshot({ path: path.join(OUT, 'desktop-lobby.png') });

    const maps = ['patio', 'plaza', 'fiesta'] as const;
    for (let mi = 0; mi < maps.length; mi++) {
      const map = maps[mi]!;
      if (mi > 0) {
        await desktop.p.click('#btn-to-lobby');
        await desktop.p.waitForFunction(() => (window as any).__fps.screen === 'lobby', undefined, { timeout: 15000 });
        await desktop.p.click(`[data-lmap="${map}"]`);
        for (const c of [iphone, android, ipad]) {
          await c.p.waitForFunction(() => (window as any).__fps.screen === 'lobby', undefined, { timeout: 15000 });
          await sleep(300);
          if ((await c.p.getAttribute('#btn-ready', 'aria-pressed')) !== 'true') await (DEVICES[c.id].touch && !(await c.p.evaluate(() => !(window as any).__fps.touchMode)) ? tap(c, '#btn-ready') : c.p.click('#btn-ready'));
        }
      }
      await desktop.p.waitForFunction(() => !(document.getElementById('btn-start') as HTMLButtonElement).disabled, undefined, { timeout: 15000 });
      await desktop.p.click('#btn-start');
      for (const c of all) await c.p.waitForFunction(() => (window as any).__fps.inMatch && (window as any).__fps.session().phase === 'playing', undefined, { timeout: 20000 });
      await sleep(1000);
      s = await Promise.all(all.map(st));
      check(`${map}: all four on ${map}; touch devices show touch controls, the desktop uses the keyboard and mouse`, s.every((x) => x.map === map) && s[0]!.controls && s[1]!.controls && (mi === 0 ? s[2]!.controls : true) && !s[3]!.touchMode, s.map((x) => ({ map: x.map, controls: x.controls, touch: x.touchMode })));
      check(`${map}: every device shows its own "YOUR TEAM"`, s.every((x, i) => x.chip === `YOUR TEAM: ${x.team === 0 ? 'SOL' : 'LUNA'}` && x.team === teams[i]), s.map((x) => x.chip));
      await desktop.p.mouse.click(640, 360); await sleep(700);
      const before = await Promise.all(all.map(st));
      // Everyone at once: three touch devices with three fingers each, the desktop with keyboard and mouse.
      await Promise.all([touchBurst(iphone), touchBurst(android), mi === 0 ? touchBurst(ipad) : sleep(10), deskBurst(desktop)]);
      await sleep(400);
      const after = await Promise.all(all.map(st));
      const moved = after.map((a, i) => +Math.hypot(a.x - before[i]!.x, a.z - before[i]!.z).toFixed(2));
      const threw = after.map((a, i) => a.shots - before[i]!.shots);
      const active = mi === 0 ? [0, 1, 2, 3] : [0, 1, 3];
      check(`${map}: simultaneous play: every active device moved and threw at the same time`, active.every((i) => moved[i]! > 0.5 && threw[i]! > 0), { moved, threw });
      check(`${map}: no device left with held input`, after.every((a) => a.held === 0), after.map((a) => a.held));

      if (mi === 0) {
        // Combat until the server has scored eliminations (desktop by keyboard, Android by touch).
        await desktop.p.mouse.click(640, 360); await sleep(400);
        await desktop.p.keyboard.down('KeyW'); await desktop.p.keyboard.down('KeyF');
        const vp = DEVICES.android.viewport;
        const thr = await center(android.p, '#ft-throw');
        const stick = { x: vp.width * 0.13, y: vp.height * 0.74, id: 11 };
        await T(android, 'touchStart', [stick]);
        await T(android, 'touchMove', [{ ...stick, y: stick.y - 45 }]);
        await T(android, 'touchStart', [{ ...stick, y: stick.y - 45 }, { ...thr, id: 12 }]);
        const t0 = Date.now();
        const hits0 = await Promise.all([desktop, android].map((c) => c.p.evaluate(() => (window as any).__fps.engine().stats.get((window as any).__fps.session().id)?.k ?? 0)));
        const killsNow = () => Promise.all([desktop, android].map((c) => c.p.evaluate(() => (window as any).__fps.engine().stats.get((window as any).__fps.session().id)?.k ?? 0)));
        // Until BOTH attackers (keyboard and touch) have scored at least once.
        await pilot([desktop, android], map, async () => { const k = await killsNow(); return k[0]! - hits0[0]! >= 1 && k[1]! - hits0[1]! >= 1; }, 150000);
        let sc = await scoresOf(desktop);
        await T(android, 'touchEnd', [{ ...stick, y: stick.y - 45 }, { ...thr, id: 12 }]);
        await desktop.p.keyboard.up('KeyF'); await desktop.p.keyboard.up('KeyW');
        await sleep(1500); // let the last snapshots arrive everywhere
        const all4 = await Promise.all(all.map(scoresOf));
        const stats = await Promise.all(all.map((c) => c.p.evaluate(() => { const e = (window as any).__fps.engine(); return [...(e?.stats ?? new Map()).entries()].map(([id, v]: any) => `${id}:${v.k ?? v.kills ?? 0}/${v.d ?? v.deaths ?? 0}`).sort().join(' '); })));
        sc = await scoresOf(desktop);
        const kills = await Promise.all([desktop, android].map((c) => c.p.evaluate(() => (window as any).__fps.engine().stats.get((window as any).__fps.session().id)?.k ?? 0)));
        check('combat: the server scored real eliminations (non-zero score) within 150 s', !!sc && sc[0] + sc[1] >= 1, { scores: sc, seconds: Math.round((Date.now() - t0) / 1000) });
        check('combat: both input types eliminated someone: the desktop by keyboard (W + F), the Android phone by touch (stick + Throw)', kills[0]! - hits0[0]! >= 1 && kills[1]! - hits0[1]! >= 1, { desktop: kills[0]! - hits0[0]!, android: kills[1]! - hits0[1]! });
        check('combat: all four devices show the same non-null score and the same per-player eliminations', all4.every((x) => !!x && JSON.stringify(x) === JSON.stringify(all4[0])) && stats.every((x) => x === stats[0]) && stats[0] !== '', { scores: all4, stats });
        await desktop.p.screenshot({ path: path.join(OUT, 'desktop-combat.png') });
        await android.p.screenshot({ path: path.join(OUT, 'android-combat.png') });
      }


      if (mi === 0) {
        await iphone.p.screenshot({ path: path.join(OUT, 'iphone-match.png') });
        await ipad.p.screenshot({ path: path.join(OUT, 'ipad-match.png') });
        // iPad: a keyboard and mouse connected mid-match (Magic Keyboard), then back to touch.
        await ipad.p.mouse.move(600, 400); await ipad.p.mouse.move(640, 410);
        await ipad.p.mouse.click(640, 410); // a mouse click switches to mouse play and asks for the pointer
        await sleep(700);
        let ip = await st(ipad);
        check('iPad: a mouse click mid-match switches to keyboard and mouse: touch controls hide', !ip.touchMode && !ip.controls, { touch: ip.touchMode, controls: ip.controls, locked: ip.locked });
        // Chromium refuses pointer lock under touch emulation (a real iPad with a trackpad grants it). The game's
        // answer to a refused lock is drag-to-look plus F to throw, after three refusals: use that path here.
        for (let i = 0; i < 3 && !(await ipad.p.evaluate(() => (window as any).__fps.input().locked || (window as any).__fps.input().fallback)); i++) { await ipad.p.mouse.click(640, 410); await sleep(1700); }
        ip = await st(ipad);
        const mode = ip.locked ? 'pointer lock' : (await ipad.p.evaluate(() => (window as any).__fps.input().fallback)) ? 'drag-to-look fallback (lock refused by the emulator)' : 'none';
        // The iPad was a target in the combat phase: wait until it is back in play.
        await ipad.p.waitForFunction(() => (window as any).__fps.session().alive, undefined, { timeout: 15000 });
        await sleep(2500);
        const b0 = await st(ipad);
        await ipad.p.mouse.move(640, 410); await ipad.p.mouse.down(); await ipad.p.mouse.move(700, 410, { steps: 6 }); await ipad.p.mouse.up();
        await ipad.p.keyboard.down('KeyF');
        let far = 0; // furthest point reached (W then S would otherwise cancel out)
        for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
          await ipad.p.keyboard.down(k);
          for (let i = 0; i < 7; i++) { await sleep(100); const q = await st(ipad); far = Math.max(far, Math.hypot(q.x - b0.x, q.z - b0.z)); }
          await ipad.p.keyboard.up(k);
        }
        await ipad.p.keyboard.up('KeyF');
        ip = await st(ipad);
        check(`iPad with keyboard and mouse (${mode}): moves with WASD, aims with the mouse, throws with F`, mode !== 'none' && far > 0.5 && ip.shots > b0.shots && Math.abs(ip.yaw - b0.yaw) > 0.02, { mode, furthest: +far.toFixed(2), threw: ip.shots - b0.shots, dYaw: +(ip.yaw - b0.yaw).toFixed(3) });
        // The keyboard is put away: a finger on the screen switches back to touch.
        await T(ipad, 'touchStart', [{ x: 700, y: 400, id: 9 }]); await T(ipad, 'touchEnd', [{ x: 700, y: 400, id: 9 }]);
        await sleep(500);
        ip = await st(ipad);
        check('iPad: touching the screen again switches back to touch controls', ip.touchMode && ip.controls && !ip.locked, { touch: ip.touchMode, controls: ip.controls, locked: ip.locked });
        // Android: rotate to portrait mid-match and back.
        await android.p.setViewportSize({ width: 412, height: 915 }); await sleep(500);
        const rot = await st(android);
        await android.p.setViewportSize(DEVICES.android.viewport); await sleep(500);
        const back = await st(android);
        check('Android: portrait shows the rotate screen (match continues); landscape resumes', rot.rotate && !rot.controls && !back.rotate && back.controls, { portrait: rot.rotate, back: back.controls });
        // iPhone: the connection drops, then reconnects into the same team.
        const team = (await st(iphone)).team;
        await iphone.p.evaluate(() => (window as any).__fps.session().transport.close());
        await iphone.p.waitForFunction(() => (window as any).__fps.session()?.state === 'online', undefined, { timeout: 15000 });
        const ri = await st(iphone);
        const seen = await desktop.p.evaluate(() => (window as any).__fps.session().room.members.filter((m: any) => m.connected).length);
        check('iPhone: a dropped connection reconnects into the same match and team; the desktop sees four connected', ri.inMatch && ri.team === team && seen === 4, { team: ri.team, connected: seen });
        // Android: music muted from the in-match menu; the online match continues.
        await tap(android, '#btn-menu'); await tap(android, '#btn-pause-settings');
        await android.p.evaluate(() => { const r = document.getElementById('set-music') as HTMLInputElement; r.value = '0'; r.dispatchEvent(new Event('input', { bubbles: true })); });
        await tap(android, '#btn-settings-close'); await tap(android, '#btn-resume');
        const am = await st(android);
        const snd = (await Promise.all(all.map(st))).map((x) => x.sounding);
        check('Android: music muted from the menu mid-match; back in play; at most one song plus a fade on every device', (am.bus ?? 1) < 0.001 && am.controls && snd.every((n) => n <= 2), { bus: am.bus, screen: am.screen, controls: am.controls, sounding: snd });
      }

      // Play out; compare results on all four devices.
      for (const c of all) await c.p.waitForFunction(() => (window as any).__fps.screen === 'results', undefined, { timeout: 330000 });
      const res = await Promise.all(all.map((c) => c.p.evaluate(() => ({ sol: document.getElementById('res-sol')!.textContent, luna: document.getElementById('res-luna')!.textContent, title: document.getElementById('res-title')!.textContent, rows: [...document.querySelectorAll('#res-table tr')].slice(1).map((r) => r.textContent).sort(), mine: document.querySelector('#res-myteam .tc-text')?.textContent }))));
      const same = res.every((r) => r.sol === res[0]!.sol && r.luna === res[0]!.luna && r.title === res[0]!.title && JSON.stringify(r.rows) === JSON.stringify(res[0]!.rows));
      check(`${map}: identical result, scores and per-player stats on all four devices; each shows its own team`, same && res.every((r, i) => r.mine === `YOUR TEAM: ${teams[i] === 0 ? 'SOL' : 'LUNA'}`), res.map((r) => `${r.sol}-${r.luna} ${r.mine}`));
      if (mi === 0) {
        const sol = Number(res[0]!.sol), luna = Number(res[0]!.luna);
        const want = sol === luna ? /tie/i : sol > luna ? /Sol wins/ : /Luna wins/;
        const winnerOk = res.every((r) => want.test(r.title ?? ''));
        check(`${map}: non-zero final score, and the winner shown matches it on every device`, sol + luna > 0 && winnerOk, { sol, luna, titles: res.map((r) => r.title) });
      }
      if (mi === 0) {
        await iphone.p.screenshot({ path: path.join(OUT, 'iphone-results.png') });
        await desktop.p.click('#btn-rematch');
        for (const c of all) await c.p.waitForFunction(() => (window as any).__fps.inMatch && (window as any).__fps.screen === 'none', undefined, { timeout: 20000 });
        s = await Promise.all(all.map(st));
        check('rematch: all four straight back in, same teams', s.every((x, i) => x.team === teams[i]), s.map((x) => x.team));
        const rs = await Promise.all(all.map(scoresOf));
        check('rematch: the score resets to 0-0 on every device', rs.every((x) => !!x && x[0] === 0 && x[1] === 0), rs);
        for (const c of all) await c.p.waitForFunction(() => (window as any).__fps.screen === 'results', undefined, { timeout: 330000 });
      }
    }
    // Everyone leaves from results; the room empties.
    for (const c of [iphone, android, ipad]) await tap(c, '#btn-res-leave');
    await desktop.p.click('#btn-res-leave');
    await sleep(500);
    s = await Promise.all(all.map(st));
    check('everyone back on the main menu', s.every((x) => x.screen === 'title' && !x.inMatch), s.map((x) => x.screen));
    const health = await (await fetch(`http://localhost:${PORT}/healthz`)).json() as { rooms: number; players: number };
    check('the server is empty afterwards (no leaked rooms or connections)', health.rooms === 0 && health.players === 0, health);
    check('no page errors on any device', all.every((c) => c.errors.length === 0), all.flatMap((c) => c.errors).slice(0, 4));
  } finally {
    for (const c of Object.values(clients)) await c.browser.close().catch(() => undefined);
    for (const pr of procs) pr.kill('SIGTERM');
  }
  const passed = checks.filter((c) => c.ok).length;
  fs.writeFileSync(path.join(OUT, 'crossdevice-e2e.json'), JSON.stringify({ at: new Date().toISOString(), environment: 'Four Chromium 141 (Blink) instances, headless, SwiftShader, Linux container. Device = viewport + DPR + touch + user-agent string only. No Safari/WebKit, no iOS/Android/Windows/macOS, no real touch hardware. Local game server.', devices: DEVICES, passed, total: checks.length, checks }, null, 2));
  console.log(`${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exitCode = 1;
}

void main();
