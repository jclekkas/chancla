// Courtyard Lab: the production arena renderer (world.baseline.ts, a copy of
// world.ts at production d27f74d) next to the experimental one (world.ts with
// the café section), rendered the way the game renders them.
//
// Matching the game (src/fps/engine.ts): the same WebGLRenderer options per
// quality (antialias off on Low), pixel-ratio caps (Low 1, Medium 1.5,
// High 2), PCF shadows (off on Low), clear colour, fog, and the default
// 85° field of view. Differences, on purpose: preserveDrawingBuffer is on so
// the canvas can be saved, both variants stay in memory, the world's small
// animations are frozen at t = 0 so both shots match, and there are no
// characters, viewmodel, HUD or match running.
//
// Offline: courtyard.html has `connect-src 'none'`, and nothing here imports
// networking code.
import * as THREE from 'three';
import { buildWorld as productionWorld } from '../fps/render/world.baseline';
import { buildWorld as experimentWorld } from '../fps/render/world';
import { MOVE } from '../../shared/config';
import type { Quality } from '../fps/settings';

declare const __BUILD_ID__: string;

const EYE = MOVE.eyeStand;
/** Camera presets. The café faces the plaza at z = -8 (x -6..3); the Panadería is its point mirror. */
export const VIEWS = {
  player: { label: 'Player height · plaza', pos: [2.8, EYE, -3.4], look: [-2.5, 2.2, -8.5] },
  facade: { label: 'Facade close-up', pos: [-4.2, EYE, -3.6], look: [0.2, 2.6, -8] },
  wide: { label: 'Wider courtyard', pos: [9.5, EYE + 0.4, 3.5], look: [-4, 2.2, -8] },
  panaderia: { label: 'Mirror side (Panadería)', pos: [-2.8, EYE, 3.4], look: [2.5, 2.2, 8.5] },
  // Whole-arena views (milestone 3: the kit across El Patio).
  terrace: { label: 'Terrace and stairs', pos: [-9.5, EYE, -3.2], look: [-10.5, 2.0, -9.5] },
  southrow: { label: 'South row houses (alley)', pos: [10, EYE, -12.6], look: [-2, 3.6, -15.6] },
  northrow: { label: 'North row houses (alley)', pos: [-10, EYE, 12.6], look: [2, 3.6, 15.6] },
  solspawn: { label: 'Casa Sol courtyard', pos: [-12, EYE, 4], look: [-17.5, 2.5, -1] },
  overview: { label: 'Overview', pos: [0, 34, 30], look: [0, 0, -1] },
} as const;
export type ViewKey = keyof typeof VIEWS;

const PIXEL_CAP: Record<Quality, number> = { low: 1, medium: 1.5, high: 2 };
const FOV = 85;

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
const stage = $('#stage'), status = $('#status'), label = $('#label');

function save(blob: Blob, name: string): void {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}

interface Result {
  build: string; baseline: string; variant: string; quality: Quality; view: ViewKey;
  canvas: [number, number]; pixelRatio: number; devicePixelRatio: number;
  meanFps: number; p95FrameMs: number; frames: number; drawCalls: number; triangles: number; geometries: number; textures: number;
  renderer: string; userAgent: string; note: string;
}

let renderer: THREE.WebGLRenderer | null = null;
let rendererQuality: Quality | null = null;
let glRenderer = 'unknown';
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 260);
const scenes = new Map<string, THREE.Scene>();
const state = { quality: 'high' as Quality, after: true, view: 'player' as ViewKey };
const results: Result[] = [];
let measure: { start: number; last: number; frames: number[] } | null = null;

function makeRenderer(q: Quality): THREE.WebGLRenderer {
  renderer?.dispose();
  renderer?.domElement.remove();
  const r = new THREE.WebGLRenderer({ antialias: q !== 'low', powerPreference: 'high-performance', alpha: false, stencil: false, preserveDrawingBuffer: true });
  r.shadowMap.enabled = q !== 'low';
  r.shadowMap.type = THREE.PCFShadowMap;
  r.setClearColor(0xf2a36b);
  stage.prepend(r.domElement);
  const gl = r.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  glRenderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  rendererQuality = q;
  return r;
}

function scene(): THREE.Scene {
  const key = `${state.quality}:${state.after}`;
  let s = scenes.get(key);
  if (!s) {
    s = new THREE.Scene();
    s.fog = new THREE.Fog(0xf3b07a, 45, 140);
    const world = (state.after ? experimentWorld : productionWorld)(state.quality);
    world.update(0); // freeze the little animations so both variants match
    s.add(world.group);
    scenes.set(key, s);
  }
  return s;
}

function resize(): void {
  if (!renderer) return;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_CAP[state.quality]));
  renderer.setSize(stage.clientWidth, stage.clientHeight, false);
  camera.aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
  camera.updateProjectionMatrix();
}

function cancel(why: string): void {
  if (!measure) return;
  measure = null;
  $<HTMLButtonElement>('#measure').disabled = false;
  status.textContent = `Measurement cancelled: ${why}. Run it again.`;
}

/** Applies the current state and renders one frame. Returns what was drawn. */
function apply(): { width: number; height: number; drawCalls: number; triangles: number } {
  if (rendererQuality !== state.quality) { renderer = makeRenderer(state.quality); }
  resize();
  const v = VIEWS[state.view];
  camera.position.set(v.pos[0], v.pos[1], v.pos[2]);
  camera.lookAt(v.look[0], v.look[1], v.look[2]);
  renderer!.render(scene(), camera);
  label.textContent = state.after ? 'EXPERIMENT · café section' : 'BEFORE · production renderer (d27f74d)';
  for (const id of ['before', 'after']) $(`#${id}`).setAttribute('aria-pressed', String((id === 'after') === state.after));
  const info = renderer!.info.render;
  const c = renderer!.domElement;
  if (!measure) status.textContent = `${state.quality} · ${c.width} × ${c.height} (pixel ratio ${renderer!.getPixelRatio()}) · ${info.calls} draw calls · ${info.triangles.toLocaleString()} triangles`;
  return { width: c.width, height: c.height, drawCalls: info.calls, triangles: info.triangles };
}

function change(fn: () => void, why: string): void { cancel(why); fn(); apply(); }

function tick(now: number): void {
  if (!document.hidden && renderer) renderer.render(scene(), camera);
  if (measure) {
    // The first second is warm-up (shader compilation, texture upload) and is not counted.
    if (now - measure.start > 1000) measure.frames.push(now - measure.last);
    measure.last = now;
    if (now - measure.start >= 11000 && measure.frames.length) {
      const f = measure.frames, sorted = [...f].sort((a, b) => a - b), avg = f.reduce((a, b) => a + b, 0) / f.length;
      const info = renderer!.info;
      const r: Result = {
        build: __BUILD_ID__, baseline: 'd27f74d', variant: state.after ? 'experiment' : 'before', quality: state.quality, view: state.view,
        canvas: [renderer!.domElement.width, renderer!.domElement.height], pixelRatio: renderer!.getPixelRatio(), devicePixelRatio: window.devicePixelRatio,
        meanFps: +(1000 / avg).toFixed(2), p95FrameMs: +sorted[Math.floor(sorted.length * 0.95)]!.toFixed(2), frames: f.length,
        drawCalls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures,
        renderer: glRenderer, userAgent: navigator.userAgent,
        note: 'Static view; both variants kept in memory; preserveDrawingBuffer on. Not a gameplay benchmark.',
      };
      results.push(r);
      measure = null;
      $<HTMLButtonElement>('#measure').disabled = false;
      $<HTMLButtonElement>('#report').disabled = false;
      status.textContent = `Recorded ${r.meanFps.toFixed(1)} FPS average · p95 ${r.p95FrameMs.toFixed(1)} ms · ${r.drawCalls} draw calls. Save results exports every measurement.`;
    }
  }
  requestAnimationFrame(tick);
}

try {
  const viewSel = $<HTMLSelectElement>('#view');
  viewSel.replaceChildren(...Object.entries(VIEWS).map(([k, v]) => { const o = document.createElement('option'); o.value = k; o.textContent = v.label; return o; }));
  $('#before').onclick = () => change(() => (state.after = false), 'variant changed');
  $('#after').onclick = () => change(() => (state.after = true), 'variant changed');
  viewSel.onchange = () => change(() => (state.view = viewSel.value as ViewKey), 'view changed');
  $<HTMLSelectElement>('#quality').onchange = () => change(() => (state.quality = $<HTMLSelectElement>('#quality').value as Quality), 'quality changed');
  $('#shot').onclick = () => renderer!.domElement.toBlob((b) => { if (b) save(b, `chancla-${state.after ? 'experiment' : 'before'}-${state.view}-${state.quality}.png`); });
  $('#measure').onclick = () => {
    measure = { start: performance.now(), last: performance.now(), frames: [] };
    $<HTMLButtonElement>('#measure').disabled = true;
    status.textContent = 'Measuring for 10 seconds after a 1 second warm-up. Keep this tab visible…';
  };
  $('#report').onclick = () => save(new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' }), 'chancla-courtyard-results.json');
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel('the tab was hidden'); });
  new ResizeObserver(() => { cancel('the window was resized'); if (renderer) apply(); }).observe(stage);
  apply();
  requestAnimationFrame(tick);
  // Automation hook for the screenshot and measurement scripts.
  (window as unknown as { __lab: unknown }).__lab = {
    set(s: Partial<typeof state>) { cancel('changed by script'); Object.assign(state, s); return apply(); },
    results: () => results,
    renderer: () => glRenderer,
  };
} catch (e) {
  $('#error').hidden = false;
  $('#error').textContent = `3D rendering could not start: ${e instanceof Error ? e.message : String(e)}. No performance or visual result has been measured.`;
  status.textContent = 'WebGL unavailable';
}
