// Screenshots of every standalone map for review: an overview from above
// and a player's-eye view, rendered by the game itself (headless Chromium,
// software rendering), plus the generated overhead views used on the cards.
//
//   npm run build && node --import tsx scripts/map-shots.ts
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'docs/evidence/maps');
const SITE = process.env.E2E_URL || 'http://localhost:4173/';
fs.mkdirSync(OUT, { recursive: true });

const VIEWS: Record<string, Array<{ name: string; pos: [number, number, number]; look: [number, number, number] }>> = {
  patio: [{ name: 'overview', pos: [0, 34, 30], look: [0, 0, -1] }, { name: 'ground', pos: [-15, 1.6, 6], look: [10, 1.4, -2] }],
  plaza: [{ name: 'overview', pos: [0, 38, 32], look: [0, 0, -1] }, { name: 'ground', pos: [-20, 1.6, 2], look: [10, 1.3, -1] }, { name: 'walkway', pos: [-22, 1.6, -12.4], look: [10, 1.5, -12.4] }],
  fiesta: [{ name: 'overview', pos: [0, 28, 24], look: [0, 0, -1] }, { name: 'ground', pos: [-13, 1.6, 4.5], look: [6, 2.2, -1.5] }, { name: 'pinata', pos: [-5, 1.6, 5], look: [0, 3.6, 0] }],
};

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
  const browser = await launch(['--mute-audio']);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript({ content: 'window.__name = (f) => f;' });
    const page = await ctx.newPage();
    await page.goto(SITE);
    await page.waitForFunction(() => (window as any).__fps?.screen === 'title');
    // The overhead views drawn on the map cards, straight from the collision boxes.
    await page.click('#btn-practice');
    for (const id of Object.keys(VIEWS)) {
      const url: string = await page.evaluate((id) => document.querySelector<HTMLElement>(`#practice-maps .map-card[data-map="${id}"] .mc-pic`)?.style.backgroundImage ?? '', id);
      const b64 = url.match(/base64,([^"')]+)/)?.[1];
      if (b64) { fs.writeFileSync(path.join(OUT, `${id}-overhead.png`), Buffer.from(b64, 'base64')); console.log(`${id}-overhead.png`); }
    }
    await page.screenshot({ path: path.join(OUT, 'practice-map-select.png') });
    await page.keyboard.press('Escape');
    await page.evaluate(() => { document.getElementById('app')!.style.visibility = 'visible'; for (const id of ['scr-title', 'sound-gate']) { const el = document.getElementById(id); if (el) el.style.visibility = 'hidden'; } });
    for (const [id, views] of Object.entries(VIEWS)) {
      for (const v of views) {
        await page.evaluate(({ id, v }) => (window as any).__fps.engine().setShowcase(id, v.pos, v.look), { id, v });
        await page.waitForTimeout(1500);
        await page.screenshot({ path: path.join(OUT, `${id}-${v.name}.png`) });
        console.log(`${id}-${v.name}.png`);
      }
    }
  } finally {
    await browser.close();
    preview?.kill();
  }
}

void main();
