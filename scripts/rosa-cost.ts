// What one Rosa costs to draw, per quality and team, in the real game page
// (offline practice, El Patio, three bots): visible meshes (main-pass draw
// calls), shadow casters (shadow-pass draws where shadows are on),
// triangles, materials, and the GPU texture bytes her materials use; plus
// the download size of the build. Exact counts, not timings. Works against
// any build (DIST), including the baseline.
//
//   GRAPHICS_EXPERIMENT=1 npm run build && DIST=dist OUT=<file.json> node --import tsx scripts/rosa-cost.ts
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, type ChildProcess } from 'node:child_process';
// @ts-expect-error plain ESM helper without types
import { launch } from './browser.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(process.env.PORT || 4185);
const SITE = `http://localhost:${PORT}/`;
const DIST = path.resolve(process.env.DIST || path.join(ROOT, 'dist'));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await sleep(250); }
  return false;
}

function download(): { jsBytes: number; jsGzip: number; totalBytes: number } {
  let jsBytes = 0, jsGzip = 0, totalBytes = 0;
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f), st = fs.statSync(p);
      if (st.isDirectory()) { walk(p); continue; }
      totalBytes += st.size;
      if (f.endsWith('.js')) { const b = fs.readFileSync(p); jsBytes += b.length; jsGzip += zlib.gzipSync(b, { level: 9 }).length; }
    }
  };
  walk(DIST);
  return { jsBytes, jsGzip, totalBytes };
}

async function main(): Promise<void> {
  let preview: ChildProcess | null = null;
  if (!(await waitHttp(SITE, 500))) {
    preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--outDir', DIST], { cwd: ROOT, stdio: 'ignore' });
    if (!(await waitHttp(SITE))) throw new Error('preview did not start');
  }
  const browser = await launch();
  const out: Record<string, unknown> = { dist: DIST, download: download() };
  try {
    for (const q of ['high', 'medium', 'low']) {
      const ctx = await browser.newContext({ viewport: { width: 800, height: 500 } });
      await ctx.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(SITE) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
      const p = await ctx.newPage();
      await p.addInitScript({ content: `window.__name = (f) => f; localStorage.setItem('chancla.mp.settings.v1', JSON.stringify({ practiceMap: 'patio', practiceAllies: 1, practiceEnemies: 2, practiceDifficulty: 'easy', quality: '${q}', qualityMode: '${q}', music: 0 }));` });
      await p.goto(SITE);
      await p.waitForFunction(() => (window as any).__fps?.screen === 'title');
      await p.click('#btn-practice'); await p.click('#btn-practice-start');
      await p.waitForFunction(() => (window as any).__fps.session()?.phase === 'playing' && (window as any).__fps.engine().avatars.size >= 3, undefined, { timeout: 40000 });
      await sleep(800);
      out[q] = await p.evaluate(() => {
        const e = (window as any).__fps.engine();
        const shadows = e.renderer.shadowMap.enabled;
        const texBytes = (t: any): number => {
          const img = t?.image; if (!img) return 0;
          const w = img.width ?? 0, h = img.height ?? 0;
          const bpp = t.isDataTexture ? (img.data?.BYTES_PER_ELEMENT ?? 1) * (t.format === 1023 ? 4 : t.format === 1028 ? 1 : t.format === 1030 ? 2 : 4) : 4;
          return w * h * bpp * (t.generateMipmaps ? 4 / 3 : 1);
        };
        const allTex = new Map<any, number>();
        const per = [...e.avatars.values()].map((a: any) => {
          let meshes = 0, tris = 0, casters = 0;
          const mats = new Set<any>(), geos = new Set<any>();
          a.root.traverse((o: any) => {
            if (!o.isMesh) return;
            for (let x = o; x; x = x.parent) if (!x.visible) return;
            const ms = Array.isArray(o.material) ? o.material : [o.material];
            const g = o.geometry;
            const groups = Array.isArray(o.material) && g.groups.length ? g.groups.length : 1;
            meshes += groups;
            if (o.castShadow && shadows) casters += groups;
            for (const m of ms) { mats.add(m); for (const k of ['map', 'gradientMap', 'normalMap', 'alphaMap', 'emissiveMap']) if (m[k]) allTex.set(m[k], texBytes(m[k])); }
            geos.add(g);
            const n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
            tris += n * (o.isInstancedMesh ? o.count : 1);
          });
          return { team: a.team, drawCalls: meshes, shadowCasters: casters, triangles: Math.round(tris), materials: mats.size, geometries: geos.size };
        });
        return { shadows, perRosa: per, characterTextureBytes: Math.round([...allTex.values()].reduce((x, y) => x + y, 0)), gpu: e.renderer.info.memory };
      });
      await ctx.close();
    }
  } finally {
    await browser.close();
    preview?.kill();
  }
  const json = JSON.stringify(out, null, 1);
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, json);
  console.log(json);
}
main().catch((e) => { console.error(e); process.exit(1); });
