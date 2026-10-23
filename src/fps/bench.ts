// Graphics experiment benchmark: offline practice on El Patio, the normal
// game renderer, one variant per page load. Only offline graphics previews
// include it (see main.ts); it sends nothing anywhere.
//
//   ?bench                    the upgraded section (Experiment)
//   ?bench&section=off        the same run without it: production's drawing
//   &quality=high|medium|low  (default high)   &secs=60   &warmup=10
//
// The run: 1 ally and 2 enemy bots (normal difficulty), Rosa held at four
// spots around the café and the Panadería in turn, panning slowly and
// throwing every 1.5 s, kept at full health so the view never drops to a
// death camera. Warm-up frames are not counted. Hiding the tab, resizing,
// changing quality, opening a menu or the match ending invalidates the run.
import { MATCH } from '../../shared/config';
import { setSectionEnabled } from './render/section';
import type { Quality } from './settings';

declare const __BUILD_ID__: string;

export interface BenchParams { section: boolean; quality: Quality; secs: number; warmup: number }

export function benchParams(search: string): BenchParams | null {
  const q = new URLSearchParams(search);
  if (!q.has('bench')) return null;
  const quality = (['high', 'medium', 'low'] as const).find((x) => x === q.get('quality')) ?? 'high';
  const num = (k: string, d: number, min: number) => { const v = Number(q.get(k)); return Number.isFinite(v) && v >= min ? v : d; };
  return { section: q.get('section') !== 'off', quality, secs: num('secs', 60, 5), warmup: num('warmup', 10, 2) };
}

/** Called before the engine starts, so the first world is built for the tested variant only. */
export function prepareBench(p: BenchParams): void { setSectionEnabled(p.section); }

// Spots at standing eye height looking at the section (the same as the comparison lab's views).
const STATIONS = [
  { name: 'café, player height', x: 2.8, z: -3.4, look: [-2.5, 2.2, -8.5] },
  { name: 'facade close-up', x: -4.2, z: -3.6, look: [0.2, 2.6, -8] },
  { name: 'wider courtyard', x: 9.5, z: 3.5, look: [-4, 2.2, -8] },
  { name: 'Panadería side', x: -2.8, z: 3.4, look: [2.5, 2.2, 8.5] },
] as const;
const EYE = 1.58;

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Hooks {
  api: any;
  startPractice: () => void;
  screen: () => string;
}

export interface BenchResult {
  kind: 'chancla-section-benchmark'; version: 1;
  build: string; variant: 'experiment' | 'production-equivalent'; quality: Quality;
  valid: boolean; invalidReason: string | null;
  warmupS: number; measuredS: number; frames: number;
  avgFps: number; p95FrameMs: number; p99FrameMs: number; medianFrameMs: number; framesOver50ms: number;
  render: { cssSize: [number, number]; bufferSize: [number, number]; pixelRatio: number; devicePixelRatio: number };
  drawCalls: { avg: number; max: number }; triangles: { avg: number; max: number };
  workload: { bots: number; throwsByRosa: number; maxProjectilesInFlight: number; rosaEliminated: number };
  renderer: string; userAgent: string; startedAt: string;
  note: string;
}

export function runBench(p: BenchParams, h: Hooks): void {
  const ui = panel(p);
  const engine = h.api.engine(), input = h.api.input();
  if (!engine || !input) { ui.status('3D rendering did not start, so nothing can be measured.'); return; }
  const r = engine.renderer;
  const startSize = `${innerWidth}x${innerHeight}@${devicePixelRatio}`;
  let invalid: string | null = null;
  const invalidate = (why: string) => { if (!invalid) invalid = why; };
  document.addEventListener('visibilitychange', () => { if (document.hidden) invalidate('the tab was hidden'); });
  window.addEventListener('resize', () => { if (`${innerWidth}x${innerHeight}@${devicePixelRatio}` !== startSize) invalidate('the window size or zoom changed'); });

  // Throw on a steady beat (the normal input path, as if the throw key were pressed).
  let throwing = false;
  const sample = input.sample.bind(input);
  input.sample = () => { const c = sample(); return throwing ? { ...c, fire: true } : c; };

  // The view is scripted, so don't wait for a click to capture the mouse
  // (practice pauses until then): use the game's drag-to-look mode instead.
  input.fallback = true;
  ui.status('Starting practice on El Patio…');
  h.startPractice();

  let t0 = -1, measuring = false, last = 0;
  const dts: number[] = [];
  let calls = 0, callsMax = 0, tris = 0, trisMax = 0, maxProj = 0, deaths = 0, wasAlive = true, throwsAt = 0;
  const room = () => [...(h.api.host()?.hub.rooms.values() ?? [])][0];

  const frame = (now: number) => {
    const s = h.api.session();
    if (!s || s.phase !== 'playing') {
      if (t0 < 0) { requestAnimationFrame(frame); return; }
      invalidate('the match ended'); finish(); return;
    }
    if (t0 < 0) {
      if (!s.alive) { requestAnimationFrame(frame); return; }
      t0 = now; last = now; throwsAt = s.localShot ?? 0;
      r.info.autoReset = false; r.info.reset();
      requestAnimationFrame(frame); return;
    }
    if (engine.quality !== p.quality) invalidate('the graphics quality changed');
    if (h.screen() !== 'none') invalidate('a menu was opened');
    const el = (now - t0) / 1000;
    const inWarmup = el < p.warmup;
    if (!inWarmup && !measuring) { measuring = true; dts.length = 0; throwsAt = s.localShot ?? throwsAt; maxProj = 0; deaths = 0; }
    if (measuring && !invalid) {
      dts.push(now - last);
      const c = r.info.render.calls, t = r.info.render.triangles;
      calls += c; tris += t; callsMax = Math.max(callsMax, c); trisMax = Math.max(trisMax, t);
      maxProj = Math.max(maxProj, s.projectiles.size);
      if (wasAlive && !s.alive) deaths++;
    }
    wasAlive = s.alive;
    r.info.reset();
    last = now;

    // Where Rosa stands and looks: four spots, an equal share of the run each, panning slowly.
    const total = p.warmup + p.secs, phase = (el % total) / total;
    const st = STATIONS[Math.min(STATIONS.length - 1, Math.floor(phase * STATIONS.length))]!;
    const local = (phase * STATIONS.length) % 1;
    const rm = room(), me = rm?.sim?.players.get(s.id);
    for (const b of [me?.body, s.body]) if (b) { b.x = st.x; b.z = st.z; b.vx = 0; b.vz = 0; }
    if (me) me.hp = MATCH.maxHealth;
    const dx = st.look[0] - st.x, dz = st.look[2] - st.z;
    input.yaw = Math.atan2(-dx, -dz) + Math.sin(local * Math.PI * 2) * 0.35;
    input.pitch = Math.atan2(st.look[1] - EYE, Math.hypot(dx, dz));
    throwing = (now / 1500) % 1 < 0.1;

    if (invalid) { finish(); return; }
    if (measuring) ui.status(`Measuring ${Math.min(p.secs, Math.floor(el - p.warmup))} / ${p.secs} s · ${st.name}`);
    else ui.status(`Warming up ${Math.ceil(p.warmup - el)} s (not counted) · ${st.name}`);
    if (el >= total) { finish(); return; }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  function finish(): void {
    throwing = false;
    // Free the mouse so the results panel can be used (the game may have captured it).
    if (document.pointerLockElement) document.exitPointerLock();
    input.sample = sample;
    r.info.autoReset = true;
    const s = h.api.session();
    const sorted = [...dts].sort((a, b) => a - b), n = sorted.length;
    const pct = (q: number) => (n ? sorted[Math.min(n - 1, Math.floor(q * n))]! : 0);
    const measured = dts.reduce((a, b) => a + b, 0) / 1000;
    const c = r.domElement as HTMLCanvasElement;
    const shortRun = p.secs < 60;
    const res: BenchResult = {
      kind: 'chancla-section-benchmark', version: 1,
      build: typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev',
      variant: p.section ? 'experiment' : 'production-equivalent', quality: p.quality,
      valid: !invalid && n > 0, invalidReason: invalid ?? (n ? null : 'no frames measured'),
      warmupS: p.warmup, measuredS: +measured.toFixed(2), frames: n,
      avgFps: measured ? +(n / measured).toFixed(1) : 0, p95FrameMs: +pct(0.95).toFixed(1), p99FrameMs: +pct(0.99).toFixed(1), medianFrameMs: +pct(0.5).toFixed(1),
      framesOver50ms: dts.filter((d) => d > 50).length,
      render: { cssSize: [c.clientWidth, c.clientHeight], bufferSize: [c.width, c.height], pixelRatio: r.getPixelRatio(), devicePixelRatio: devicePixelRatio },
      drawCalls: { avg: n ? Math.round(calls / n) : 0, max: callsMax }, triangles: { avg: n ? Math.round(tris / n) : 0, max: trisMax },
      workload: { bots: Math.max(0, (room()?.sim?.players.size ?? 1) - 1), throwsByRosa: (s?.localShot ?? throwsAt) - throwsAt, maxProjectilesInFlight: maxProj, rosaEliminated: deaths },
      renderer: rendererName(r), userAgent: navigator.userAgent, startedAt: new Date(performance.timeOrigin).toISOString(),
      note: `Offline practice, normal game renderer, one variant loaded. Draw calls and triangles are per frame including the shadow pass and the held item.${shortRun ? ' Shorter than 60 s: indicative only.' : ''}`,
    };
    ui.done(res);
  }
}

function rendererName(r: any): string {
  try {
    const gl = r.getContext() as WebGLRenderingContext;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch { return 'unknown'; }
}

/** The on-screen panel: status while running, then the results with Copy, Save and links to the other runs. */
function panel(p: BenchParams) {
  const el = document.createElement('div');
  el.id = 'bench-panel';
  el.setAttribute('role', 'status');
  el.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;max-width:min(440px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;background:rgba(20,12,28,.88);color:#fff;font:13px/1.45 system-ui,sans-serif;padding:10px 12px;border-radius:10px;pointer-events:auto';
  const head = document.createElement('div');
  head.innerHTML = `<b>Benchmark</b> · ${p.section ? 'Experiment (upgraded café)' : 'Production drawing (section off)'} · ${p.quality}`;
  const status = document.createElement('div');
  el.append(head, status);
  document.body.append(el);
  const link = (label: string, mod: (q: URLSearchParams) => void) => {
    const q = new URLSearchParams(location.search); mod(q);
    const a = document.createElement('a'); a.href = `${location.pathname}?${q.toString()}`; a.textContent = label; a.style.cssText = 'color:#ffd27a;margin-right:10px';
    return a;
  };
  const btn = (label: string, fn: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.style.cssText = 'margin:6px 6px 0 0;padding:6px 10px;border-radius:6px;border:0;font:inherit;cursor:pointer'; b.onclick = fn; return b; };
  return {
    status: (t: string) => { status.textContent = t; },
    done: (res: BenchResult) => {
      (window as unknown as { __benchResult: BenchResult }).__benchResult = res;
      const json = JSON.stringify(res, null, 1);
      status.innerHTML = '';
      const lines = res.valid
        ? [`<b>${res.avgFps} FPS</b> average · p95 ${res.p95FrameMs} ms · p99 ${res.p99FrameMs} ms`,
          `${res.frames} frames in ${res.measuredS} s after ${res.warmupS} s warm-up`,
          `${res.render.bufferSize[0]} × ${res.render.bufferSize[1]} px (pixel ratio ${res.render.pixelRatio})`,
          `${res.drawCalls.avg} draw calls · ${res.triangles.avg.toLocaleString()} triangles per frame`,
          `${res.workload.bots} bots · ${res.workload.throwsByRosa} throws · up to ${res.workload.maxProjectilesInFlight} in flight`,
          `<span style="opacity:.75">${res.renderer}</span>`]
        : [`<b>Not valid:</b> ${res.invalidReason}. Run it again with the tab in front and the window left alone.`];
      for (const l of lines) { const d = document.createElement('div'); d.innerHTML = l; status.append(d); }
      status.append(
        btn('Copy results', () => { void navigator.clipboard?.writeText(json).then(() => toastIn(status, 'Copied.'), () => toastIn(status, 'Copy was blocked: use Save.')); }),
        btn('Save JSON', () => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
          a.download = `chancla-bench-${res.variant}-${res.quality}-${res.build.split(' ')[0]}.json`;
          document.body.append(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }),
      );
      const links = document.createElement('div'); links.style.marginTop = '6px';
      links.append(
        link('Run again', () => undefined),
        link(p.section ? 'Run production drawing' : 'Run experiment', (q) => { if (p.section) q.set('section', 'off'); else q.delete('section'); }),
        link(p.quality === 'high' ? 'Medium' : 'High', (q) => q.set('quality', p.quality === 'high' ? 'medium' : 'high')),
        link('Low', (q) => q.set('quality', 'low')),
      );
      status.append(links);
    },
  };
}

function toastIn(el: HTMLElement, t: string): void { const d = document.createElement('div'); d.textContent = t; el.append(d); setTimeout(() => d.remove(), 2500); }
