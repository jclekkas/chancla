// Graphics experiment benchmark: El Patio in offline practice, drawn by the
// normal game renderer, one variant per page load. Only offline graphics
// previews include it (see main.ts); it sends nothing anywhere.
//
//   ?bench                    controlled comparison, section on (Experiment)
//   ?bench&section=off        the same with the El Patio kit off (production's environment
//                             drawing; the first-person view is this build's in both:
//                             an environment-only comparison)
//   ?bench=live[&section=off] live gameplay stress test (real bots; not a cost comparison)
//   ?bench&scene=combat       controlled character and combat workload (see COMBAT below)
//   &quality=high|medium|low  (default high)   &secs=60   &warmup=10
//
// Controlled comparison: practice starts as usual (so the bots' avatars,
// teams and name tags are real), then the match is held still and every
// frame the scene is set from a script that depends only on scene time:
// Rosa's view, three walking characters and six projectiles in flight. The
// state is written at the moment the renderer reads it, so both variants
// draw the same scene at the same timestamp whatever their frame rate.
// Animation phase and projectile trails still integrate frame time, which
// can change their shape slightly between frame rates but never what is
// drawn (meshes, draw calls, triangles).
//
// Both modes: warm-up and measurement are separate; the four views get equal
// time in each; hiding the tab, resizing, changing quality, opening a menu
// or the match ending invalidates the run; so does Rosa being eliminated.
import * as THREE from 'three';
import { setSectionEnabled } from './render/section';
import type { Quality } from './settings';

declare const __BUILD_ID__: string;

export const BENCH_VERSION = 3;
export type BenchMode = 'controlled' | 'live';

export type BenchScene = 'cafe' | 'combat';
export interface BenchParams { mode: BenchMode; scene: BenchScene; section: boolean; quality: Quality; secs: number; warmup: number; throttleMs: number }

export function benchParams(search: string): BenchParams | null {
  const q = new URLSearchParams(search);
  if (!q.has('bench')) return null;
  const quality = (['high', 'medium', 'low'] as const).find((x) => x === q.get('quality')) ?? 'high';
  const num = (k: string, d: number, min: number) => { const v = Number(q.get(k)); return q.has(k) && Number.isFinite(v) && v >= min ? v : d; };
  return {
    mode: q.get('bench') === 'live' ? 'live' : 'controlled',
    scene: q.get('scene') === 'combat' ? 'combat' : 'cafe',
    section: q.get('section') !== 'off', quality, secs: num('secs', 60, 4), warmup: num('warmup', 10, 2),
    throttleMs: num('throttle', 0, 0), // test only: a busy wait per frame, to check the scene does not depend on frame rate
  };
}

/** Called before the engine starts, so the first world is built for the tested variant only. */
export function prepareBench(p: BenchParams): void { setSectionEnabled(p.section); }

// ---------------------------------------------------------------- the scene

// Views at standing eye height looking at the section (the comparison lab's views).
const STATIONS = [
  { name: 'café, player height', x: 2.8, z: -3.4, look: [-2.5, 2.2, -8.5], side: 1 },
  { name: 'facade close-up', x: -4.2, z: -3.6, look: [0.2, 2.6, -8], side: 1 },
  { name: 'wider courtyard', x: 9.5, z: 3.5, look: [-4, 2.2, -8], side: 1 },
  { name: 'Panadería side', x: -2.8, z: 3.4, look: [2.5, 2.2, 8.5], side: -1 },
] as const;
const EYE = 1.58;
// Three characters walking small loops on open paving in front of the café
// (point-mirrored when the view is on the Panadería side).
const WALKERS = [
  { cx: -1.5, cz: -5.6, r: 0.9, w: 0.8, ph: 0 },
  { cx: 0.8, cz: -4.6, r: 0.9, w: -0.7, ph: 2.1 },
  { cx: -3.2, cz: -3.6, r: 0.9, w: 0.9, ph: 4.2 },
] as const;
// Six projectiles always in flight, thrown in turn between the walkers.
const PROJ = { count: 6, periodS: 1.6, arc: 1.2 } as const;
const SCENE = { id: 'cafe-scripted', stations: STATIONS, walkers: WALKERS, proj: PROJ };

/** A short, stable digest of the scene definition: two runs with the same id ran the same script. */
function digest(s: string): string { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); }
const SCENE_HASH = digest(JSON.stringify(SCENE));

interface Timeline { warmup: number; secs: number }
/** Which view at scene time t (s), how far through it (0..1), and whether it is measured. Equal time per view in both phases. */
function stationAt(tl: Timeline, t: number): { i: number; u: number; measured: boolean } {
  const n = STATIONS.length;
  if (t < tl.warmup) { const d = tl.warmup / n, i = Math.min(n - 1, Math.floor(t / d)); return { i, u: (t - i * d) / d, measured: false }; }
  const d = tl.secs / n, k = t - tl.warmup, i = Math.min(n - 1, Math.floor(k / d));
  return { i, u: Math.min(1, (k - i * d) / d), measured: true };
}

/**
 * One complete engine frame, from the start of one main render to the start
 * of the next (scene seconds), with what it drew. fpCalls/fpTris are the
 * first-person view's share (it is rendered separately, after the world).
 */
export interface FrameSample { start: number; end: number; calls: number; tris: number; fpCalls: number; fpTris: number }
export interface Agg {
  frames: number; sampledS: number; windowS: number; avgFps: number;
  medianFrameMs: number; p95FrameMs: number; p99FrameMs: number; maxFrameMs: number; framesOver50ms: number;
  drawCalls: Stat; triangles: Stat; firstPerson: { drawCalls: number; triangles: number };
}

/**
 * How frames become measurements (one rule for every number):
 * - A sample is a complete frame interval. The interval still in progress
 *   when the run ends has no end, so it is never a sample.
 * - A sample counts when its START lies inside the measurement window
 *   [warmup, warmup + secs). Frames that start in the warm-up are left out,
 *   even if they end inside the window.
 * - A counted sample belongs to the view whose window contains its start and
 *   contributes its whole duration (never a clipped part) to that view's
 *   frame times and to its time denominator (sampledS). FPS = frames / sampledS.
 * - windowS is the scheduled time per view (secs / views, exact). sampledS
 *   can differ from it by up to about one frame at each boundary.
 * - Draw-call and triangle averages are weighted by frame duration over the
 *   same counted samples.
 */
export const SAMPLING_RULE = 'Complete frame intervals only; a frame counts if it starts inside the measurement window and belongs, whole, to the view its start falls in; the final unfinished interval and frames starting in the warm-up are excluded; FPS = frames / sum of their durations; count averages are weighted by duration.';

export function aggregate(samples: readonly FrameSample[], tl: Timeline): { all: Agg; perView: Agg[] } {
  const end = tl.warmup + tl.secs, n = STATIONS.length;
  const counted = samples.filter((f) => f.end > f.start && f.start >= tl.warmup && f.start < end);
  const one = (fs: readonly FrameSample[], windowS: number): Agg => {
    const dts = fs.map((f) => (f.end - f.start) * 1000), sorted = [...dts].sort((a, b) => a - b), k = sorted.length;
    const sum = dts.reduce((a, b) => a + b, 0);
    const pct = (q: number) => (k ? sorted[Math.min(k - 1, Math.floor(q * k))]! : 0);
    const wavg = (key: 'calls' | 'tris' | 'fpCalls' | 'fpTris') => (sum ? fs.reduce((a, f, i) => a + f[key] * dts[i]!, 0) / sum : 0);
    const st = (key: 'calls' | 'tris'): Stat => (k ? { avg: Math.round(wavg(key)), min: Math.min(...fs.map((f) => f[key])), max: Math.max(...fs.map((f) => f[key])) } : { avg: 0, min: 0, max: 0 });
    return {
      frames: k, sampledS: +(sum / 1000).toFixed(3), windowS: +windowS.toFixed(3), avgFps: sum ? +(k / (sum / 1000)).toFixed(2) : 0,
      medianFrameMs: +pct(0.5).toFixed(1), p95FrameMs: +pct(0.95).toFixed(1), p99FrameMs: +pct(0.99).toFixed(1), maxFrameMs: +(k ? sorted[k - 1]! : 0).toFixed(1),
      framesOver50ms: dts.filter((d) => d > 50).length, drawCalls: st('calls'), triangles: st('tris'),
      firstPerson: { drawCalls: Math.round(wavg('fpCalls')), triangles: Math.round(wavg('fpTris')) },
    };
  };
  const perView = STATIONS.map((_, i) => one(counted.filter((f) => stationAt(tl, f.start).i === i), tl.secs / n));
  return { all: one(counted, tl.secs), perView };
}

interface Pose {
  x: number; z: number; vx: number; vz: number; yaw: number;
  /** Combat scene only (defaults: on the ground, La Chancla, nothing recent, all ruleros). */
  y?: number; onGround?: boolean; weapon?: 0 | 1; msSinceMelee?: number; msSinceThrow?: number; msSinceHit?: number; ruleros?: number;
}
function walker(k: number, t: number, side: number): Pose {
  const w = WALKERS[k]!, a = w.w * t + w.ph;
  const x = w.cx + w.r * Math.cos(a), z = w.cz + w.r * Math.sin(a);
  const vx = -w.r * w.w * Math.sin(a), vz = w.r * w.w * Math.cos(a);
  return { x: side * x, z: side * z, vx: side * vx, vz: side * vz, yaw: Math.atan2(-side * vx, -side * vz) };
}

export interface SceneState {
  t: number; station: number; measured: boolean;
  cam: { x: number; z: number; yaw: number; pitch: number };
  walkers: Pose[];
  proj: Array<{ key: string; weapon: 0 | 1; owner: number; x: number; y: number; z: number }>;
}

/** The whole controlled scene as a pure function of scene time. */
export function sceneAt(tl: Timeline, t: number): SceneState {
  const st = stationAt(tl, t), S = STATIONS[st.i]!;
  const dx = S.look[0] - S.x, dz = S.look[2] - S.z;
  const cam = { x: S.x, z: S.z, yaw: Math.atan2(-dx, -dz) + Math.sin(st.u * Math.PI * 2) * 0.35, pitch: Math.atan2(S.look[1] - EYE, Math.hypot(dx, dz)) };
  const walkers = WALKERS.map((_, k) => walker(k, t, S.side));
  const proj: SceneState['proj'] = [];
  for (let j = 0; j < PROJ.count; j++) {
    const off = (j * PROJ.periodS) / PROJ.count;
    const c = Math.floor((t + PROJ.periodS - off) / PROJ.periodS); // cycle number, so one of each is always in flight
    const ts = c * PROJ.periodS + off - PROJ.periodS, u = (t - ts) / PROJ.periodS;
    const from = walker(j % 3, ts, S.side), to = walker((j + 1) % 3, ts, S.side);
    proj.push({
      key: `bench-${j}-${c}`, weapon: j < 4 ? 0 : 1, owner: j % 3,
      x: from.x + (to.x - from.x) * u, y: 1.4 + (1.0 - 1.4) * u + PROJ.arc * 4 * u * (1 - u), z: from.z + (to.z - from.z) * u,
    });
  }
  return { t, station: st.i, measured: st.measured, cam, walkers, proj };
}

// ---------------------------------------------------------------- the combat workload

// Character and combat presentation (?bench&scene=combat): the same three
// characters, in front of the café at combat distance, act out a fixed
// 2.4 s cycle. A (La Pesada) lands El Revés to B's face, knocking a roller
// off (B's roller comes back at the next cycle, like a respawn); B answers
// with El Chanclazo that misses; C strafes, jumps and throws La Chancla at
// the wall twice. The hit, the miss and the impacts go through the
// engine's normal handlers (onEvent, proj.impact), so each build draws its
// own effects for exactly the same events at the same scene times.
const COMBAT_STATIONS = [
  { name: 'duel, 2 m', x: -0.4, z: -3.1, look: [-0.4, 1.35, -5.2], side: 1 },
  { name: 'duel, 5 m', x: 4.4, z: -4.4, look: [-0.4, 1.25, -5.2], side: 1 },
  { name: 'skirmish, 9 m', x: -9.4, z: -3.6, look: [-0.4, 1.1, -5.0], side: 1 },
  { name: 'from the café door, 3 m', x: -2.2, z: -7.6, look: [-0.4, 1.2, -4.6], side: 1 },
] as const;
const CYCLE_S = 2.4;
const DUEL = { a: [-1.0, -5.2], b: [0.2, -5.2], hitS: 0.33, answerS: 1.2, whiffS: 1.2 + 0.19 } as const;
const THROWER = { cx: -2.6, cz: -3.4, amp: 0.8, w: 2.2, jumpS: 1.25, jumpV: 7.0, g: 21, throwS: [0.4, 1.6], flightS: 0.5, target: [-3.6, 1.6, -8.4] } as const;
const COMBAT = { id: 'combat-scripted', stations: COMBAT_STATIONS, cycleS: CYCLE_S, duel: DUEL, thrower: THROWER };
const COMBAT_HASH = digest(JSON.stringify(COMBAT));

/** A scripted event: what the engine is told, and when (scene seconds). */
export type ScriptedEvent =
  | { at: number; kind: 'hit'; cycle: number }
  | { at: number; kind: 'whiff'; cycle: number }
  | { at: number; kind: 'impact'; cycle: number; n: number; pos: [number, number, number] };

function throwerPose(t: number): Pose {
  const T = THROWER, u = t - Math.floor(t / CYCLE_S) * CYCLE_S;
  const x = T.cx + T.amp * Math.sin(T.w * t), vx = T.amp * T.w * Math.cos(T.w * t);
  const air = u - T.jumpS, airT = (2 * T.jumpV) / T.g;
  const up = air >= 0 && air < airT;
  const y = up ? T.jumpV * air - 0.5 * T.g * air * air : 0;
  const last = T.throwS.filter((s) => s <= u).pop();
  return { x, z: T.cz, vx, vz: 0, yaw: Math.atan2(-(T.target[0] - x), -(T.target[2] - T.cz)), y, onGround: !up, weapon: 0, msSinceThrow: last === undefined ? 1e6 : (u - last) * 1000 };
}

/** The combat workload as a pure function of scene time. */
export function combatAt(tl: Timeline, t: number): SceneState {
  const st = stationAt(tl, t), S = COMBAT_STATIONS[st.i]!;
  const dx = S.look[0] - S.x, dz = S.look[2] - S.z;
  const cam = { x: S.x, z: S.z, yaw: Math.atan2(-dx, -dz) + Math.sin(st.u * Math.PI * 2) * 0.12, pitch: Math.atan2(S.look[1] - EYE, Math.hypot(dx, dz)) };
  const c = Math.floor(t / CYCLE_S), u = t - c * CYCLE_S;
  const a: Pose = { x: DUEL.a[0], z: DUEL.a[1], vx: 0, vz: 0, yaw: -Math.PI / 2, weapon: 1, msSinceMelee: u * 1000 };
  const b: Pose = {
    x: DUEL.b[0], z: DUEL.b[1], vx: 0, vz: 0, yaw: Math.PI / 2, weapon: 0,
    msSinceMelee: u >= DUEL.answerS ? (u - DUEL.answerS) * 1000 : 1e6,
    msSinceHit: u >= DUEL.hitS ? (u - DUEL.hitS) * 1000 : 1e6,
    ruleros: u >= DUEL.hitS ? 15 & ~(1 << (c % 4)) : 15,
  };
  const th = throwerPose(t);
  const proj: SceneState['proj'] = [];
  THROWER.throwS.forEach((s0, n) => {
    const k = (u - s0) / THROWER.flightS;
    if (k < 0 || k >= 1) return;
    const from = throwerPose(c * CYCLE_S + s0), tg = THROWER.target, y0 = 1.4 + (from.y ?? 0);
    proj.push({ key: `combat-${c}-${n}`, weapon: 0, owner: 2, x: from.x + (tg[0] - from.x) * k, y: y0 + (tg[1] - y0) * k + 0.6 * 4 * k * (1 - k), z: from.z + (tg[2] - from.z) * k });
  });
  return { t, station: st.i, measured: st.measured, cam, walkers: [a, b, th], proj };
}

/** Events with scene times in (t0, t1], in time order. */
export function combatEvents(t0: number, t1: number): ScriptedEvent[] {
  const out: ScriptedEvent[] = [];
  for (let c = Math.max(0, Math.floor(t0 / CYCLE_S)); c * CYCLE_S <= t1; c++) {
    const base = c * CYCLE_S;
    const evs: ScriptedEvent[] = [
      { at: base + DUEL.hitS, kind: 'hit', cycle: c },
      { at: base + DUEL.whiffS, kind: 'whiff', cycle: c },
      ...THROWER.throwS.map((s0, n): ScriptedEvent => ({ at: base + s0 + THROWER.flightS, kind: 'impact', cycle: c, n, pos: [THROWER.target[0], THROWER.target[1], THROWER.target[2]] })),
    ];
    for (const e of evs) if (e.at > t0 && e.at <= t1) out.push(e);
  }
  return out.sort((x, y) => x.at - y.at);
}

/** Projectiles the scripted scenes keep in flight at all times (for the drawn-versus-script check). */
const MIN_PROJ = { cafe: PROJ.count, combat: 0 } as const;

// ---------------------------------------------------------------- the run

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Hooks {
  api: any;
  startPractice: () => void;
  screen: () => string;
  /** Holds the practice match still (host and prediction paused) without opening a menu. */
  hold: (on: boolean) => void;
}

interface Stat { avg: number; min: number; max: number }

export interface BenchResult {
  kind: 'chancla-section-benchmark'; version: typeof BENCH_VERSION;
  mode: BenchMode; label: string;
  /**
   * experiment: this build. environment-off: the El Patio kit switched off,
   * so the arena is drawn as in production; the first-person view,
   * characters and projectiles are this build's in both. An environment-only
   * comparison, not a production baseline (the first-person cost is reported
   * separately in firstPerson).
   */
  build: string; variant: 'experiment' | 'environment-off'; comparison: 'environment-only'; quality: Quality;
  valid: boolean; invalidReason: string | null; testRun: boolean;
  workload: { id: string; hash: string; warmupS: number; measuredSPerView: number; views: string[] };
  measuredS: number; frames: number;
  avgFps: number; medianFrameMs: number; p95FrameMs: number; p99FrameMs: number; maxFrameMs: number; framesOver50ms: number;
  render: { cssSize: [number, number]; bufferSize: [number, number]; pixelRatio: number; devicePixelRatio: number };
  drawCalls: Stat; triangles: Stat;
  /** The first-person view's own share of drawCalls/triangles (time-weighted average per frame). */
  firstPerson: { drawCalls: number; triangles: number };
  perView: Array<{ name: string } & Omit<Agg, 'firstPerson'>>;
  sampling: string;
  /** Controlled: checks that what was drawn matched the script at sampled timestamps. Live: what was on screen. */
  scene: Record<string, number | boolean | string>;
  throttleMs: number;
  renderer: string; userAgent: string; startedAt: string;
  note: string;
}

export function runBench(p: BenchParams, h: Hooks): void {
  const ui = panel(p);
  const engine = h.api.engine(), input = h.api.input();
  if (!engine || !input) { ui.status('3D rendering did not start, so nothing can be measured.'); return; }
  const r = engine.renderer as THREE.WebGLRenderer;
  const tl: Timeline = { warmup: p.warmup, secs: p.secs };
  const combat = p.mode === 'controlled' && p.scene === 'combat';
  const VIEWS = combat ? COMBAT_STATIONS : STATIONS;
  const at = combat ? combatAt : sceneAt;
  let lastT = -1;
  const startSize = `${innerWidth}x${innerHeight}@${devicePixelRatio}`;
  let invalid: string | null = null;
  const invalidate = (why: string) => { if (!invalid) invalid = why; };
  document.addEventListener('visibilitychange', () => { if (document.hidden) invalidate('the tab was hidden'); });
  window.addEventListener('resize', () => { if (`${innerWidth}x${innerHeight}@${devicePixelRatio}` !== startSize) invalidate('the window size or zoom changed'); });

  // The view is scripted, so don't wait for a click to capture the mouse
  // (practice pauses until then): use the game's drag-to-look mode instead.
  input.fallback = true;
  // Live mode throws by holding the throw input down: the game throws at the
  // weapon's own rate, independent of how often frames are drawn.
  const sample = input.sample.bind(input);
  if (p.mode === 'live') input.sample = () => ({ ...sample(), fire: true });

  ui.status('Starting practice on El Patio…');
  h.startPractice();

  const room = () => [...(h.api.host()?.hub.rooms.values() ?? [])][0];
  let t0 = -1, done = false, session: any = null, ids: number[] = [], origUpdate: (() => void) | null = null;
  let lastMain = -1, applied: SceneState | null = null;
  const samples: FrameSample[] = [];
  let fpCalls = 0, fpTris = 0; // the first-person render's share of the frame in progress
  const checks = { n: 0, camErr: 0, walkerErr: 0, projErr: 0, minAvatars: Infinity, minProjectiles: Infinity };
  let nextCheck = 0;
  const live = { avatarsInView: 0, projectiles: 0, deaths: 0, throws0: 0, samples: 0 };
  let wasAlive = true;

  /** Controlled: write the scene for this engine frame into the session, at the moment the engine reads it. */
  const applyScene = () => {
    const s = session, t = (performance.now() - t0) / 1000;
    const sc = at(tl, t);
    applied = sc;
    for (const b of [s.body]) { b.x = sc.cam.x; b.z = sc.cam.z; b.y = 0; b.vx = 0; b.vy = 0; b.vz = 0; b.onGround = true; b.crouched = false; }
    input.yaw = sc.cam.yaw; input.pitch = sc.cam.pitch;
    ids.forEach((id, k) => {
      const w = sc.walkers[k]!;
      s.remotes.set(id, { id, x: w.x, y: w.y ?? 0, z: w.z, yaw: w.yaw, pitch: 0, vx: w.vx, vz: w.vz, alive: true, crouched: false, onGround: w.onGround ?? true, protected: false, connected: true, hp: 100, weapon: w.weapon ?? 0, msSinceThrow: w.msSinceThrow ?? 1e6, msSinceHit: w.msSinceHit ?? 1e6, msSinceMelee: w.msSinceMelee ?? 1e6, ruleros: w.ruleros ?? 15 });
    });
    if (combat) {
      // The engine reads each character's ruleros from the newest snapshot.
      for (const tp of s.snap?.p ?? []) { const k = ids.indexOf(tp[0]); if (k >= 0) tp[14] = sc.walkers[k]!.ruleros ?? 15; }
      for (const e of combatEvents(lastT, t)) fire(e);
      lastT = t;
    }
    s.projectiles.clear();
    for (const q of sc.proj) {
      s.projectiles.set(q.key, { id: q.key, weapon: q.weapon, owner: ids[q.owner] ?? 0, predicted: true, startAt: 0, endAt: 0, endPos: null, done: false, trail: [],
        pr: { id: 0, owner: ids[q.owner] ?? 0, team: 0, weapon: q.weapon, x: q.x, y: q.y, z: q.z, vx: 0, vy: 0, vz: 0, ageMs: 0, traveled: 0, bounces: 0, fireSeq: 0 } });
    }
  };

  /** One scripted event through the engine's normal handlers (never involving Rosa, so no HUD). */
  const fire = (e: ScriptedEvent) => {
    const s = session, rt = s.renderTime();
    const [a, b] = ids, A = s.remotes.get(a), B = s.remotes.get(b);
    if (e.kind === 'hit' && A && B) engine.onEvent({ k: 'hit', a, v: b, d: 45, hp: 55, head: true, w: 1, splash: false, p: [B.x - 0.2, 1.5, B.z], m: 900000 + e.cycle * 4, tm: rt, ru: [e.cycle % 4] });
    else if (e.kind === 'whiff') engine.onEvent({ k: 'whiff', id: 900000 + e.cycle * 4 + 1, a: b, w: 0, tm: rt });
    else if (e.kind === 'impact') engine.proj.impact(0, e.pos, false);
  };

  /** What the engine actually drew this frame, against the script (controlled), sampled once per scene second. */
  const checkDrawn = () => {
    const sc = applied!;
    if (sc.t < nextCheck) return;
    nextCheck = Math.floor(sc.t) + 1;
    const cam = engine.camera as THREE.PerspectiveCamera;
    checks.n++;
    checks.camErr = Math.max(checks.camErr, Math.hypot(cam.position.x - sc.cam.x, cam.position.z - sc.cam.z), Math.abs(cam.rotation.y - sc.cam.yaw), Math.abs(cam.rotation.x - sc.cam.pitch));
    let avatars = 0;
    ids.forEach((id, k) => {
      const av = engine.avatars.get(id), w = sc.walkers[k]!;
      if (!av) { checks.walkerErr = Infinity; return; }
      if (av.root.visible) avatars++;
      checks.walkerErr = Math.max(checks.walkerErr, Math.hypot(av.root.position.x - w.x, av.root.position.z - w.z), Math.abs(av.root.rotation.y - w.yaw));
    });
    let shown = 0;
    for (const q of sc.proj) {
      const slot = [...engine.proj.pools[0], ...engine.proj.pools[1]].find((x: any) => x.key === q.key);
      if (!slot || !slot.mesh.visible) { checks.projErr = Infinity; continue; }
      shown++;
      checks.projErr = Math.max(checks.projErr, Math.hypot(slot.mesh.position.x - q.x, slot.mesh.position.y - q.y, slot.mesh.position.z - q.z));
    }
    checks.minAvatars = Math.min(checks.minAvatars, avatars);
    checks.minProjectiles = Math.min(checks.minProjectiles, shown);
  };

  // Every count and frame time is taken at the start of the engine's main
  // render, so each sample is exactly one engine frame (world, shadow pass,
  // held item).
  const render = r.render.bind(r);
  const frustum = new THREE.Frustum(), m = new THREE.Matrix4();
  r.render = (scene: THREE.Object3D, camera: THREE.Camera) => {
    if (scene === engine.scene && t0 >= 0 && !done) {
      const now = performance.now();
      if (lastMain >= 0 && !invalid) samples.push({ start: (lastMain - t0) / 1000, end: (now - t0) / 1000, calls: r.info.render.calls, tris: r.info.render.triangles, fpCalls, fpTris });
      r.info.reset();
      fpCalls = 0; fpTris = 0;
      lastMain = now;
      if (p.mode === 'controlled' && applied) checkDrawn();
      if (p.mode === 'live' && stationAt(tl, (now - t0) / 1000).measured) {
        m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(m);
        let inView = 0;
        for (const av of engine.avatars.values()) if (av.root.visible && frustum.containsPoint(av.root.position)) inView++;
        live.avatarsInView += inView; live.projectiles += session.projectiles.size; live.samples++;
      }
      if (p.throttleMs > 0) { const end = now + p.throttleMs; while (performance.now() < end) { /* test only: a slower frame */ } }
    }
    if (scene === engine.vmScene && t0 >= 0 && !done) {
      const c0 = r.info.render.calls, k0 = r.info.render.triangles;
      render(scene, camera);
      fpCalls += r.info.render.calls - c0; fpTris += r.info.render.triangles - k0;
      return;
    }
    render(scene, camera);
  };

  const tick = () => {
    if (done) return;
    const s = h.api.session();
    if (t0 < 0) {
      if (!s || s.phase !== 'playing' || !s.alive || !room()) { requestAnimationFrame(tick); return; }
      session = s;
      ids = [...room().sim.players.keys()].filter((id: number) => id !== s.id).sort((a: number, b: number) => a - b);
      if (p.mode === 'controlled') {
        h.hold(true);
        origUpdate = s.updateRemotes.bind(s);
        s.updateRemotes = applyScene; // the engine calls this every frame, just before it places the camera and avatars
      } else {
        // Rosa cannot be hurt in the stress test (spawn protection held on for her only), so the view never drops to a death camera.
        const me = room().sim.players.get(s.id);
        if (me) Object.defineProperty(me, 'protectedUntil', { configurable: true, get: () => Number.MAX_SAFE_INTEGER, set: () => undefined });
        live.throws0 = s.localShot ?? 0;
      }
      r.info.autoReset = false;
      t0 = performance.now();
      requestAnimationFrame(tick); return;
    }
    const t = (performance.now() - t0) / 1000;
    if (s !== session || s.phase !== 'playing') invalidate('the match ended');
    if (engine.quality !== p.quality) invalidate('the graphics quality changed');
    if (h.screen() !== 'none') invalidate('a menu was opened');
    if (!s.alive) invalidate('Rosa was eliminated');
    if (p.mode === 'controlled' && !h.api.host()?.paused) invalidate('the scripted scene stopped being held');
    if (p.mode === 'live') {
      if (wasAlive && !s.alive) live.deaths++;
      wasAlive = s.alive;
      const st = stationAt(tl, t), S = STATIONS[st.i]!;
      const rm = room(), me = rm?.sim?.players.get(s.id);
      for (const b of [me?.body, s.body]) if (b) { b.x = S.x; b.z = S.z; b.vx = 0; b.vz = 0; }
      const dx = S.look[0] - S.x, dz = S.look[2] - S.z;
      input.yaw = Math.atan2(-dx, -dz) + Math.sin(st.u * Math.PI * 2) * 0.35;
      input.pitch = Math.atan2(S.look[1] - EYE, Math.hypot(dx, dz));
    }
    const st = stationAt(tl, t);
    if (invalid || t >= p.warmup + p.secs) { finish(); return; }
    ui.status(st.measured ? `Measuring ${Math.floor(t - p.warmup)} / ${p.secs} s · ${VIEWS[st.i]!.name}` : `Warming up ${Math.ceil(p.warmup - t)} s (not counted) · ${VIEWS[st.i]!.name}`);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  function finish(): void {
    done = true;
    r.render = render;
    r.info.autoReset = true;
    input.sample = sample;
    if (session && origUpdate) session.updateRemotes = origUpdate;
    if (p.mode === 'controlled') h.hold(false);
    // Free the mouse so the results panel can be used (the game may have captured it).
    if (document.pointerLockElement) document.exitPointerLock();
    const s = h.api.session();
    const agg = aggregate(samples, tl), all = agg.all;
    const perView = VIEWS.map((S, i) => { const { firstPerson: _fp, ...v } = agg.perView[i]!; void _fp; return { name: S.name, ...v }; });
    if (!invalid && perView.some((v) => v.frames === 0)) invalidate('a view had no measured frames');
    const tol = 1e-3;
    if (p.mode === 'controlled' && !invalid && (checks.n < Math.floor(p.secs / 2) || checks.camErr > tol || checks.walkerErr > tol || checks.projErr > tol || checks.minAvatars < ids.length || checks.minProjectiles < MIN_PROJ[combat ? 'combat' : 'cafe'])) {
      invalidate('what was drawn did not match the scripted scene');
    }
    const c = r.domElement;
    const res: BenchResult = {
      kind: 'chancla-section-benchmark', version: BENCH_VERSION, mode: p.mode,
      label: p.mode === 'controlled' ? 'Controlled comparison: scripted scene, identical in both variants' : 'Live gameplay stress test: real bots, varies run to run; not a section cost comparison',
      build: typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev',
      variant: p.section ? 'experiment' : 'environment-off', comparison: 'environment-only', quality: p.quality,
      valid: !invalid && all.frames > 0, invalidReason: invalid ?? (all.frames ? null : 'no frames measured'), testRun: p.throttleMs > 0 || p.secs < 60,
      workload: { id: p.mode === 'controlled' ? `${combat ? COMBAT.id : SCENE.id}-v${BENCH_VERSION}` : `live-practice-1v2-normal-v${BENCH_VERSION}`, hash: p.mode === 'controlled' ? (combat ? COMBAT_HASH : SCENE_HASH) : 'random (live bots)', warmupS: p.warmup, measuredSPerView: p.secs / VIEWS.length, views: VIEWS.map((x) => x.name) },
      measuredS: +all.sampledS.toFixed(2), frames: all.frames,
      avgFps: +all.avgFps.toFixed(1), medianFrameMs: all.medianFrameMs, p95FrameMs: all.p95FrameMs, p99FrameMs: all.p99FrameMs, maxFrameMs: all.maxFrameMs,
      framesOver50ms: all.framesOver50ms,
      render: { cssSize: [c.clientWidth, c.clientHeight], bufferSize: [c.width, c.height], pixelRatio: r.getPixelRatio(), devicePixelRatio },
      drawCalls: all.drawCalls, triangles: all.triangles, firstPerson: all.firstPerson,
      perView, sampling: SAMPLING_RULE,
      scene: p.mode === 'controlled'
        ? { characters: ids.length, projectiles: combat ? 'two thrown per 2.4 s cycle' : PROJ.count, checkpoints: checks.n, maxCameraError: +checks.camErr.toExponential(2), maxCharacterError: +checks.walkerErr.toExponential(2), maxProjectileError: +checks.projErr.toExponential(2), minCharactersDrawn: checks.minAvatars, minProjectilesDrawn: checks.minProjectiles }
        : { bots: ids.length, throwsByRosa: (s?.localShot ?? live.throws0) - live.throws0, avgCharactersInView: live.samples ? +(live.avatarsInView / live.samples).toFixed(2) : 0, avgProjectilesInFlight: live.samples ? +(live.projectiles / live.samples).toFixed(2) : 0, rosaEliminated: live.deaths },
      throttleMs: p.throttleMs,
      renderer: rendererName(r), userAgent: navigator.userAgent, startedAt: new Date(performance.timeOrigin).toISOString(),
      note: `${p.mode === 'controlled' ? 'Scripted scene through the normal game renderer; one variant loaded.' : 'Live bots; what is on screen differs between runs, so differences between variants include that.'} Draw calls and triangles are per engine frame including the shadow pass and the first-person view (its share is in firstPerson). Environment-only comparison: the first-person view is this build's in both variants.${p.secs < 60 ? ' Shorter than 60 s: indicative only.' : ''}${p.throttleMs > 0 ? ` Test run with a ${p.throttleMs} ms busy wait per frame: not a measurement.` : ''}`,
    };
    ui.done(res);
  }
}

function rendererName(r: THREE.WebGLRenderer): string {
  try {
    const gl = r.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch { return 'unknown'; }
}

/** The on-screen panel: status while running, then the results with Copy, Save and links to the other runs. */
function panel(p: BenchParams) {
  const el = document.createElement('div');
  el.id = 'bench-panel';
  el.setAttribute('role', 'status');
  el.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9999;max-width:min(460px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;background:rgba(20,12,28,.88);color:#fff;font:13px/1.45 system-ui,sans-serif;padding:10px 12px;border-radius:10px;pointer-events:auto';
  const head = document.createElement('div');
  head.innerHTML = `<b>${p.mode === 'controlled' ? 'Controlled comparison' : 'Live stress test'}</b> · ${p.section ? 'Experiment (upgraded café)' : 'Environment off (production environment, this build\'s first-person view)'} · ${p.quality}`;
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
          `${res.frames} frames, ${res.measuredS} s of complete frames, after ${res.workload.warmupS} s warm-up (${res.workload.measuredSPerView} s scheduled per view)`,
          `First-person view: ${res.firstPerson.drawCalls} calls, ${res.firstPerson.triangles.toLocaleString()} triangles of each frame`,
          `${res.render.bufferSize[0]} × ${res.render.bufferSize[1]} px (pixel ratio ${res.render.pixelRatio})`,
          `${res.drawCalls.avg} draw calls (${res.drawCalls.min}-${res.drawCalls.max}) · ${res.triangles.avg.toLocaleString()} triangles per frame`,
          res.mode === 'controlled' ? `Scene ${res.workload.id} #${res.workload.hash}: matched the script at ${res.scene.checkpoints} checkpoints` : `Live bots: ${res.scene.avgCharactersInView} characters in view on average (varies by run)`,
          `<span style="opacity:.75">${res.renderer}</span>`]
        : [`<b>Not valid:</b> ${res.invalidReason}. Run it again with the tab in front and the window left alone.`];
      if (res.testRun) lines.push('<span style="opacity:.75">Test or short run: indicative only.</span>');
      for (const l of lines) { const d = document.createElement('div'); d.innerHTML = l; status.append(d); }
      status.append(
        btn('Copy results', () => { void navigator.clipboard?.writeText(json).then(() => toastIn(status, 'Copied.'), () => toastIn(status, 'Copy was blocked: use Save.')); }),
        btn('Save JSON', () => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
          a.download = `chancla-bench-${res.mode}-${res.variant}-${res.quality}-${res.build.split(' ')[0]}.json`;
          document.body.append(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }),
      );
      const links = document.createElement('div'); links.style.marginTop = '6px';
      links.append(
        link('Run again', () => undefined),
        link(p.section ? 'Run with environment off' : 'Run experiment', (q) => { if (p.section) q.set('section', 'off'); else q.delete('section'); }),
        link(p.quality === 'high' ? 'Medium' : 'High', (q) => q.set('quality', p.quality === 'high' ? 'medium' : 'high')),
        link('Low', (q) => q.set('quality', 'low')),
        link(p.mode === 'controlled' ? 'Live stress test' : 'Controlled comparison', (q) => q.set('bench', p.mode === 'controlled' ? 'live' : '')),
      );
      status.append(links);
    },
  };
}

function toastIn(el: HTMLElement, t: string): void { const d = document.createElement('div'); d.textContent = t; el.append(d); setTimeout(() => d.remove(), 2500); }
