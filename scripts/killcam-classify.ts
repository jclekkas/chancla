// Killcam, classified: one page, a series of eliminations, and for each death a timestamped record
// of what the replay system did. Every death must end in exactly one of:
//   REPLAY    a replay started, ended (done / skip / respawn) and control came back;
//   FALLBACK  no replay, with a recorded reason (the replay could not fit before respawn), and
//             control came back;
// anything else (no replay and no reason, a replay that never ends, control that never returns,
// a thrown kill whose replay shows no chancla) is a DEFECT. One death presses Escape only once the
// replay is on screen, then resumes. Offline build; nothing leaves the machine.
//
//   DIST=<offline build> node --import tsx scripts/killcam-classify.ts
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Browser, BrowserContext, Page } from 'playwright';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.PORT || 4187);
const SITE = `http://localhost:${PORT}/`;
const DIST = path.resolve(process.env.DIST || path.join(ROOT, 'dist'));
const OUT = ROOT;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const { chromium } = createRequire(import.meta.url)('playwright');
async function waitHttp(url: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}
interface OpenOpts { touch?: boolean; killcam?: boolean; quality?: string; video?: boolean; lang?: string; small?: boolean }

async function open(browser: Browser, o: OpenOpts = {}): Promise<{ ctx: BrowserContext; p: Page }> {
  const ctx = await browser.newContext(o.touch
    ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...(o.video ? { recordVideo: { dir: OUT, size: { width: 844, height: 390 } } } : {}) }
    : { viewport: { width: o.small ? 768 : 960, height: o.small ? 432 : 540 }, ...(o.video ? { recordVideo: { dir: OUT, size: { width: 960, height: 540 } } } : {}) });
  await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
  const p = await ctx.newPage();
  const settings = { practiceMap: 'patio', practiceAllies: 0, practiceEnemies: 1, practiceDifficulty: 'easy', quality: o.quality ?? 'medium', qualityMode: o.quality ?? 'medium', music: 0, killcam: o.killcam ?? true, lang: o.lang ?? 'en' };
  await p.addInitScript({ content: `window.__name = (f) => f; try { localStorage.setItem('chancla.mp.settings.v1', JSON.stringify(${JSON.stringify({ ...settings, ...(process.env.ROSA === 'candidate' ? { rosaCandidate: true } : {}) })})); } catch {}` });
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  p.on('console', (m) => { if (/not eliminated/.test(m.text())) console.log(m.text()); });
  await p.goto(SITE);
  await p.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { polling: 100 });
  await sleep(400);
  await p.evaluate(() => (document.getElementById('btn-practice') as HTMLElement).click());
  await p.evaluate(() => (document.getElementById('btn-practice-start') as HTMLElement).click());
  await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing' && (window as any).__fps.session()?.alive, undefined, { timeout: 90000, polling: 100 });
  // A real tap puts the page in touch mode (the touch controls), as a phone would.
  if (o.touch) { await sleep(300); await p.touchscreen.tap(422, 120); await sleep(400); }
  // "Click to aim": headless Chromium refuses the pointer lock, so the page falls back to drag-to-look and play runs.
  if (!o.touch) { await sleep(300); await p.waitForSelector('#btn-click-play', { state: 'visible', timeout: 20000 }).catch(() => undefined); if (await p.isVisible('#btn-click-play')) await p.click('#btn-click-play', { force: true }); await sleep(600); }
  await p.evaluate(() => {
    const f = (window as any).__fps;
    const room = [...f.host().hub.rooms.values()][0];
    for (const m of room.members.values()) if (m.bot) m.brain = null;
  });
  await sleep(1500);
  return { ctx, p };
}

/** A bot eliminates you: 'chanclazo' | 'reves' (to the face) | 'throw'. Returns the score and hp before. */
async function eliminate(p: Page, kind: 'chanclazo' | 'reves' | 'throw' | 'heavy'): Promise<{ scores: number[]; botHp: number; deaths: number }> {
  return p.evaluate(async (kind) => {
    const f = (window as any).__fps, s = f.session(), room = [...f.host().hub.rooms.values()][0], sim = room.sim;
    const me = sim.players.get(s.id);
    const bot = [...sim.players.values()].find((q: any) => q.team !== me.team);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // Somewhere open (the plaza in front of the café), the bot in front of you (10 m for a throw: about a quarter of a second in the air).
    const thrown = kind === 'throw' || kind === 'heavy';
    me.body.x = -6; me.body.z = 3; me.body.y = 0; me.body.vx = me.body.vz = 0; me.protectedUntil = 0;
    bot.body.x = thrown ? 4 : -4.9; bot.body.z = 3; bot.body.y = 0; bot.body.vx = bot.body.vz = 0; bot.protectedUntil = 0;
    const w = kind === 'reves' || kind === 'heavy' ? 1 : 0;
    bot.weapon = w; bot.switchMs = 0; bot.cooldownMs = 0; bot.meleeMs = 0; bot.hp = 100;
    await wait(1400); // a lead-in for the replay
    const before = { scores: [...sim.scores], botHp: bot.hp, deaths: me.stats.deaths };
    me.hp = kind === 'reves' ? 40 : kind === 'chanclazo' ? 20 : 5;
    me.protectedUntil = 0;
    const yaw = Math.PI / 2, pitch = kind === 'reves' ? 0.12 : thrown ? -0.03 : -0.25;
    let seq = bot.lastSeq;
    const buttons = thrown ? 1 : 8; // BTN.fire, BTN.melee
    // The host keeps at most 40 queued inputs (NET.maxInputQueue); the bot's aim persists after the last one.
    for (let i = 0; i < 30; i++) sim.queueInput(bot.id, { seq: ++seq, mx: 0, mz: 0, yaw, pitch, buttons: i === 0 ? buttons : 0, weapon: w });
    for (let i = 0; i < 100 && s.alive; i++) await wait(20);
    if (s.alive) console.log('not eliminated', JSON.stringify({ me: [me.body.x, me.body.z, me.hp], bot: [bot.body.x, bot.body.z, bot.weapon, bot.meleeMs], swings: bot.stats.swings }));
    return before;
  }, kind);
}


const ks = (p: Page) => p.evaluate(() => { const f = (window as any).__fps, k = f.engine().killcamState, s = f.session(); return { deaths: (() => { const room = [...f.host().hub.rooms.values()][0]; return room.sim.players.get(s.id)?.stats.deaths ?? -1; })(), protectedMs: s.protectedMs ?? 0, active: k.active, rt: k.rt, projMax: k.projMax, started: k.counts.started, fallback: k.lastFallback, fb: k.counts.fallback, last: k.last, alive: s.alive, respawnInMs: s.respawnInMs, screen: f.screen, input: f.input()?.enabled ?? null }; });
const msPerFrame = (p: Page) => p.evaluate(() => new Promise<number>((r) => { let n = 0; const t0 = performance.now(); const f = () => { if (++n === 6) r((performance.now() - t0) / 5); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));

async function death(p: Page, kind: 'chanclazo' | 'reves' | 'throw', esc: boolean) {
  // Start only from a settled state: alive, no replay on screen, spawn protection over.
  await p.waitForFunction(() => { const f = (window as any).__fps, s = f.session(); return s.alive && !f.engine().killcamState.active && (s.protectedMs ?? 0) <= 0 && f.screen === 'none'; }, undefined, { timeout: 90000, polling: 200 }).catch(() => undefined);
  const s0 = await ks(p);
  const t0 = Date.now();
  await eliminate(p, kind);
  const tDead = Date.now() - t0;
  let replayAt: number | null = null, maxProj = 0, escNote: string | null = null, sawFallback: string | null = null;
  const end = Date.now() + 90000; // respawn runs on game time: slow frames stretch it
  while (Date.now() < end) {
    const s = await ks(p);
    if (s.active && replayAt === null) replayAt = Date.now() - t0;
    if (s.active) maxProj = Math.max(maxProj, s.projMax ?? 0);
    if (s.fallback && !sawFallback && s.started === s0.started) sawFallback = s.fallback;
    if (esc && s.active && escNote === null) {
      const rt0 = s.rt; await p.keyboard.press('Escape'); await sleep(900); const a = await ks(p);
      escNote = `menu:${a.screen} held:${a.rt === rt0 || (a.rt !== null && rt0 !== null && Math.abs(a.rt - rt0) < 60)}`;
      await p.evaluate(() => (document.getElementById('btn-resume') as HTMLElement | null)?.click()); await sleep(600);
    }
    if (s.alive && Date.now() - t0 > tDead + 500 && !s.active) break;
    await sleep(80);
  }
  const s1 = await ks(p);
  const started = s1.started - s0.started;
  const back = s1.alive && s1.screen === 'none';
  const died = s1.deaths - s0.deaths;
  let verdict: string;
  if (died !== 1) verdict = `NOT ELIMINATED (probe setup; deaths +${died})`;
  else if (!back) verdict = 'DEFECT: control did not return';
  else if (started === 1 && ['done', 'skip', 'respawn'].includes(s1.last?.reason)) verdict = kind === 'throw' && s1.last?.view === 'attacker' && (s1.last?.projMax ?? maxProj) === 0 ? 'REPLAY (no chancla drawn in flight)' : 'REPLAY';
  else if (started === 0 && (sawFallback || s1.fallback)) verdict = `FALLBACK (${sawFallback ?? s1.fallback})`;
  else verdict = `DEFECT: started=${started} fallback=${s1.fallback} last=${JSON.stringify(s1.last)}`;
  return { kind, died, esc: escNote, tDeadMs: tDead, replayAtMs: replayAt, aliveAgainMs: Date.now() - t0, replayReason: started ? s1.last?.reason : null, replayMs: started ? s1.last?.endedAt - s1.last?.startedAt : null, projMax: started ? s1.last?.projMax : null, verdict };
}

async function main() {
  const preview: ChildProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST], { cwd: ROOT, stdio: 'ignore' });
  let defects = 0;
  try {
    if (!(await waitHttp(SITE))) throw new Error('preview did not start');
    const browser: Browser = await chromium.launch();
    try {
      for (const quality of ['medium', 'low']) {
        const { ctx, p } = await open(browser, { quality });
        const mpf = Math.round(await msPerFrame(p));
        console.log(`== quality ${quality}, ${mpf} ms per frame (software renderer)`);
        const plan: Array<['chanclazo' | 'reves' | 'throw', boolean]> = [['chanclazo', false], ['reves', false], ['throw', false], ['chanclazo', true], ['reves', false], ['throw', false]];
        for (const [kind, esc] of plan) {
          const r = await death(p, kind, esc);
          if (r.verdict.startsWith('DEFECT') || r.verdict.startsWith('NOT ELIMINATED')) defects++;
          console.log(JSON.stringify(r));
        }
        await ctx.close();
      }
    } finally { await browser.close(); }
  } catch (e) { defects++; console.log('ERROR', (e as Error).message); }
  finally { preview.kill('SIGTERM'); }
  console.log(defects ? `${defects} defect(s)` : 'no defects: every death ended in a replay or a recorded fallback, and control returned');
  process.exit(defects ? 1 : 0);
}
main();
