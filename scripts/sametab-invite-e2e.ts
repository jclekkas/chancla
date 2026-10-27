// Same-tab invite, isolated: ONE browser page (the production-mode build) and a protocol client as
// the host, so nothing competes with the page for the renderer. The page sits on the title screen;
// the invite link is then opened in that same tab (only the #room= part changes, as when a player
// pastes or taps a second invite). The join screen must show the code, and Join must reach the lobby.
// Three rounds. Local server and preview only; it starts and stops both itself.
//
//   npm run build && node --import tsx scripts/sametab-invite-e2e.ts
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { NetClient, until } from '../tests/helpers/netclient';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SITE = 'http://localhost:4173/';
const { chromium } = createRequire(import.meta.url)('playwright');
const procs: ChildProcess[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name: string, ok: boolean, info?: unknown) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info === undefined ? '' : ' ' + JSON.stringify(info)}`); };
async function waitHttp(url: string) { for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); } return false; }

async function main() {
  procs.push(spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: ROOT, env: { ...process.env, PORT: '8787', HOST: '127.0.0.1', ALLOWED_ORIGINS: 'http://localhost:4173,http://test.local' }, stdio: 'ignore' }));
  procs.push(spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { cwd: ROOT, stdio: 'ignore' }));
  if (!(await waitHttp('http://localhost:8787/healthz')) || !(await waitHttp(SITE))) throw new Error('server or preview did not start');
  const health = await (await fetch('http://localhost:8787/healthz')).json();
  check('local server speaks protocol 6', health.protocol === 6, health);
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript({ content: 'window.__name = (f) => f;' });
    const page = await ctx.newPage();
    await page.goto(SITE);
    await page.waitForFunction(() => (window as any).__fps?.screen === 'title', undefined, { timeout: 60000 });
    for (let round = 1; round <= 3; round++) {
      const host = new NetClient('ws://127.0.0.1:8787/ws', `Host${round}`);
      await host.connect();
      host.send({ t: 'create', map: 'patio' });
      await until(() => !!host.room?.code, 8000, 'room created');
      const code = host.room!.code;
      const t0 = Date.now();
      await page.evaluate((c) => { location.hash = `#room=${c}`; }, code); // same tab, only the hash changes
      const shown = await page.waitForFunction(() => (window as any).__fps.screen === 'online', undefined, { timeout: 20000 }).then(() => true, () => false);
      const field = await page.inputValue('#in-code').catch(() => '');
      check(`round ${round}: the invite opens the join screen in the same tab`, shown, { afterMs: Date.now() - t0 });
      check(`round ${round}: the join screen carries the invite's code`, field.replace(/[^A-Z0-9]/gi, '').toUpperCase() === code.replace(/[^A-Z0-9]/gi, '').toUpperCase(), { field, code });
      await page.click('#btn-join');
      const inLobby = await page.waitForFunction(() => (window as any).__fps.screen === 'lobby', undefined, { timeout: 20000 }).then(() => true, () => false);
      await until(() => (host.room?.members?.length ?? 0) >= 2, 8000, 'host sees the guest').catch(() => undefined);
      check(`round ${round}: Join reaches the lobby and the host sees the guest`, inLobby && (host.room?.members?.length ?? 0) >= 2, { inLobby, members: host.room?.members?.length, afterMs: Date.now() - t0 });
      // Back to the title for the next round: leave the room from the lobby.
      await page.evaluate(() => (document.getElementById('btn-leave-room') as HTMLElement | null)?.click());
      await page.waitForFunction(() => ['title', 'online'].includes((window as any).__fps.screen), undefined, { timeout: 15000 }).catch(() => undefined);
      if ((await page.evaluate(() => (window as any).__fps.screen)) === 'online') await page.evaluate(() => (document.getElementById('btn-online-back') as HTMLElement | null)?.click());
      host.close();
      await sleep(500);
    }
  } finally {
    await browser.close();
  }
}
main().catch((e) => { failures++; console.log('ERROR', e?.message ?? e); }).finally(() => { for (const p of procs) p.kill('SIGTERM'); console.log(failures ? `${failures} failed` : 'all passed'); process.exit(failures ? 1 : 0); });
