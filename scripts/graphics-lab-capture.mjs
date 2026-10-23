// Renders comparison-lab views (courtyard.html) for Before (production's
// renderer) and Experiment (this branch), saves each canvas as PNG and the
// renderer counts as JSON. Builds into its own folder, so several of these
// can run at once without touching dist/.
//
//   node scripts/graphics-lab-capture.mjs --out <dir> [--quality high] [--views player,facade] [--port 4300] [--dist <dir>] [--no-build]
//
// Views: see VIEWS in src/graphics-lab/main.ts. Local only: every request to
// another host is blocked.
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('out', path.join(ROOT, 'lab-capture')));
const QUALITY = arg('quality', 'high');
const VIEWS = arg('views', 'player,facade,wide,panaderia,terrace,southrow,northrow,solspawn,overview').split(',');
const PORT = Number(arg('port', 4300 + Math.floor(Math.random() * 500)));
const DIST = path.resolve(arg('dist', path.join(OUT, '_dist')));
fs.mkdirSync(OUT, { recursive: true });

if (!process.argv.includes('--no-build')) {
  const r = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', DIST, '--emptyOutDir', '--logLevel', 'error'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, GRAPHICS_EXPERIMENT: '1' } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const prev = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST], { cwd: ROOT, stdio: 'ignore' });
const site = `http://localhost:${PORT}/`;
for (let i = 0; i < 80; i++) { try { if ((await fetch(site + 'courtyard.html')).ok) break; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 250)); }
const b = await launch();
const log = { quality: QUALITY, console: [], stats: {} };
try {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await ctx.route('**/*', (r) => (r.request().url().startsWith(site) || r.request().url().startsWith('data:') ? r.continue() : r.abort()));
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) log.console.push(m.text()); });
  p.on('pageerror', (e) => log.console.push(`pageerror: ${e.message}`));
  await p.goto(`${site}courtyard.html`);
  await p.waitForFunction(() => !!window.__lab, undefined, { timeout: 60000 });
  log.renderer = await p.evaluate(() => window.__lab.renderer());
  for (const view of VIEWS) for (const after of [false, true]) {
    await p.evaluate((a) => window.__lab.set(a), { view, after, quality: QUALITY });
    await p.waitForTimeout(500);
    const s = await p.evaluate((a) => window.__lab.set(a), { view, after, quality: QUALITY });
    const data = await p.evaluate(() => document.querySelector('#stage canvas').toDataURL('image/png'));
    fs.writeFileSync(path.join(OUT, `${view}-${after ? 'after' : 'before'}-${QUALITY}.png`), Buffer.from(data.split(',')[1], 'base64'));
    log.stats[`${view}-${after ? 'after' : 'before'}`] = s;
  }
} finally { await b.close(); prev.kill(); }
fs.writeFileSync(path.join(OUT, `capture-${QUALITY}.json`), JSON.stringify(log, null, 1));
for (const [k, v] of Object.entries(log.stats)) console.log(`${k.padEnd(20)} ${String(v.drawCalls).padStart(4)} calls ${String(v.triangles).padStart(7)} tris`);
if (log.console.length) console.log('page errors:', log.console);
