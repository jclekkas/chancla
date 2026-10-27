// Sourced surface textures for El Patio (Poly Haven CC0 sets prepared by
// scripts/patio-textures.py into public/textures/patio/, see SOURCES.md
// there). The shooter only, on El Patio only: the engine asks for them
// through WorldOptions.sourced, so Plaza, Fiesta, Campaign and Arcade never
// see them.
//
// The look per quality tier (Visual Director, checkpoint 2):
//   High    std: MeshStandardMaterial on the plaster walls, street cobbles and
//           door wood (colour + normal maps, 512 px, anisotropy 8)
//   Medium  std, the same 512 px files at anisotropy 4: Medium keeps the
//           shadow map, so the walls' raking-sun relief and the cobbles' light
//           still read there, and a High <-> Medium switch needs no download
//   Low     toon with the colour maps only (256 px; no normal maps loaded):
//           std bought nothing visible at phone size and cost +50 % render time
// Query parameter, for comparison: ?mat=classic (today's procedural look on
// every tier), ?mat=std or ?mat=toon (force that variant on any tier; toon
// keeps its normal maps above Low).
// Roughness is a constant on the standard materials: maps remapped into a
// matte 0.85..1 made no visible difference (checkpoint 2) and cost 1.4 MB of
// texture memory each.
//
// The textures are loaded before the engine builds a world that needs them:
// main.ts awaits preloadSourced before the engine exists, and a quality change
// waits for the new tier's files (engine.applySettings) before rebuilding, so
// a world is only ever built with its textures in place and warmWorld
// compiles and uploads it: no pop-in, no late compile. A failed or slow load
// (4 s) leaves that tier classic and says so in the diag log.
import * as THREE from 'three';
import type { Quality } from '../settings';
import { diagLog } from '../../diag';

export type MatMode = 'classic' | 'toon' | 'std';
/** What the page asked for: a forced variant, or 'auto' (the tier's default). */
export type MatRequest = MatMode | 'auto';
export type SourcedName = 'plaster' | 'cobble' | 'wood';

/** One surface's maps for one variant and tier; normal is absent where the variant does without it. */
export interface SourcedSurface { map: THREE.Texture; normal: THREE.Texture | null }
export interface SourcedSet { mode: Exclude<MatMode, 'classic'>; quality: Quality; plaster: SourcedSurface; cobble: SourcedSurface; wood: SourcedSurface }

/**
 * Physical size and grading constants (scripts/patio-textures.py prints them).
 * `metres`: how much surface one texture repeat covers. `mean`: the linear
 * mean the neutral colour maps were graded to (the material divides it out,
 * so the vertex paint and the wood tint keep their value).
 */
export const SOURCED = {
  plaster: { metres: 2.75, mean: 0.8 },
  cobble: { metres: 1.6 },
  wood: { metres: 1.0, mean: 0.4647 },
} as const;

/** The query parameter: ?mat=classic|toon|std; 'auto' when absent or unknown. */
export function requestedMatMode(search?: string): MatRequest {
  try {
    const s = search ?? (typeof location === 'undefined' ? '' : location.search);
    const v = new URLSearchParams(s).get('mat');
    return v === 'toon' || v === 'std' || v === 'classic' ? v : 'auto';
  } catch { return 'auto'; }
}

/** The variant a tier gets for a request. */
export function modeFor(q: Quality, req: MatRequest = requestedMatMode()): MatMode {
  if (req !== 'auto') return req;
  return q === 'low' ? 'toon' : 'std';
}

const ANISO: Record<Quality, number> = { high: 8, medium: 4, low: 2 };
const sizeOf = (q: Quality) => (q === 'low' ? 256 : 512);
/** Low's toon loads colour maps only; every other combination loads colour + normal. */
const withNormals = (mode: MatMode, q: Quality) => !(mode === 'toon' && q === 'low');
const keyOf = (mode: MatMode, q: Quality) => `${mode}-${sizeOf(q)}-${withNormals(mode, q) ? 'n' : 'c'}-a${ANISO[q]}`;

const loaded = new Map<string, SourcedSet>();
const failed = new Set<string>();
const pending = new Map<string, Promise<void>>();

function baseUrl(): string {
  try { return (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'; } catch { return '/'; }
}

async function loadSet(mode: Exclude<MatMode, 'classic'>, q: Quality): Promise<SourcedSet> {
  const size = sizeOf(q), normals = withNormals(mode, q), loader = new THREE.TextureLoader();
  const one = async (name: SourcedName, kind: 'map' | 'normal'): Promise<THREE.Texture> => {
    const t = await loader.loadAsync(`${baseUrl()}textures/patio/${name}-${kind}-${size}.webp`);
    t.colorSpace = kind === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.anisotropy = ANISO[q]; // three clamps it to the device's maximum
    t.name = `patio-${name}-${kind}-${size}`;
    return t;
  };
  const surface = async (name: SourcedName): Promise<SourcedSurface> => {
    const [map, normal] = await Promise.all([one(name, 'map'), normals ? one(name, 'normal') : Promise.resolve(null)]);
    return { map, normal };
  };
  const [plaster, cobble, wood] = await Promise.all([surface('plaster'), surface('cobble'), surface('wood')]);
  return { mode, quality: q, plaster, cobble, wood };
}

/**
 * Loads the textures this tier's variant needs (main.ts awaits it before the
 * engine exists; the engine awaits it before a quality change rebuilds).
 * Resolves either way: on failure or after `timeoutMs` that tier stays classic.
 */
export function preloadSourced(quality: Quality, opts: { request?: MatRequest; timeoutMs?: number } = {}): Promise<void> {
  const mode = modeFor(quality, opts.request);
  if (mode === 'classic' || typeof document === 'undefined') return Promise.resolve();
  const key = keyOf(mode, quality);
  if (loaded.has(key) || failed.has(key)) return Promise.resolve();
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const ms = opts.timeoutMs ?? 4000, t0 = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const p = Promise.race([
    loadSet(mode, quality),
    new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out after ${ms} ms`)), ms); }),
  ]).then((set) => {
    loaded.set(key, set);
    diagLog('gfx', `patio textures (${key}) loaded in ${Math.round(performance.now() - t0)} ms`);
  }, (err: unknown) => {
    failed.add(key);
    diagLog('gfx', `patio textures (${key}) failed: ${String(err)}; El Patio stays classic on ${quality}`);
  }).finally(() => { if (timer) clearTimeout(timer); pending.delete(key); });
  pending.set(key, p);
  return p;
}

/** True when a world for this tier can be built now: its textures are in, failed (classic), or not wanted. */
export function sourcedReady(quality: Quality, request?: MatRequest): boolean {
  const mode = modeFor(quality, request);
  if (mode === 'classic' || typeof document === 'undefined') return true;
  const key = keyOf(mode, quality);
  return loaded.has(key) || failed.has(key);
}

/** The loaded set for this tier, or null (classic: not wanted, not loaded, or failed). */
export function sourcedSet(quality: Quality, request?: MatRequest): SourcedSet | null {
  const mode = modeFor(quality, request);
  return mode === 'classic' ? null : loaded.get(keyOf(mode, quality)) ?? null;
}

/** Tests only: forget what was loaded. */
export function resetSourced(): void { loaded.clear(); failed.clear(); pending.clear(); }
/** Tests only: install a set without loading files. */
export function installSourced(set: SourcedSet): void { loaded.set(keyOf(set.mode, set.quality), set); }
