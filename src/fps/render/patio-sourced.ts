// Sourced surface textures for El Patio (Visual Director comparison, phase 1):
// Poly Haven CC0 sets prepared by scripts/patio-textures.py into
// public/textures/patio/ (see SOURCES.md there). The shooter only, on El
// Patio only: the engine asks for them through WorldOptions.sourced, so
// Plaza, Fiesta, Campaign and Arcade never see them.
//
// The look is picked per page load with a query parameter:
//   ?mat=classic  today's procedural canvases (the default)
//   ?mat=toon     variant a: MeshToonMaterial with the sourced colour + normal maps
//   ?mat=std      variant b: MeshStandardMaterial (colour, normal, roughness) on the
//                 plaster walls, the street cobbles and the door wood only
// The textures are loaded before the engine builds its first world (main.ts
// awaits preloadSourced), so the world is built once, with them, and
// engine.warmWorld() compiles and uploads it: no pop-in, no late compile. A
// failed or slow load (4 s) falls back to classic and says so in the diag log.
import * as THREE from 'three';
import type { Quality } from '../settings';
import { diagLog } from '../../diag';

export type MatMode = 'classic' | 'toon' | 'std';
export type SourcedName = 'plaster' | 'cobble' | 'wood';

/** One surface's maps at one tier. normal and rough are absent where the tier does without them. */
export interface SourcedSurface { map: THREE.Texture; normal: THREE.Texture | null; rough: THREE.Texture | null }
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

/** The query parameter (?mat=classic|toon|std); classic when absent or unknown. */
export function requestedMatMode(search?: string): MatMode {
  try {
    const s = search ?? (typeof location === 'undefined' ? '' : location.search);
    const v = new URLSearchParams(s).get('mat');
    return v === 'toon' || v === 'std' ? v : 'classic';
  } catch { return 'classic'; }
}

const ANISO: Record<Quality, number> = { high: 8, medium: 4, low: 2 };
const tierOf = (q: Quality) => (q === 'low' ? 256 : 512);
/** Low draws the toon variant without normal maps; its std variant keeps all three maps at 256 px. */
const kindsFor = (mode: MatMode, q: Quality): Array<'map' | 'normal' | 'rough'> =>
  mode === 'std' ? ['map', 'normal', 'rough'] : q === 'low' ? ['map'] : ['map', 'normal'];

const loaded = new Map<number, SourcedSet>();
let failed = false;
let maxAniso = 8;

function baseUrl(): string {
  try { return (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'; } catch { return '/'; }
}

async function loadTier(mode: Exclude<MatMode, 'classic'>, q: Quality): Promise<SourcedSet> {
  const size = tierOf(q), kinds = kindsFor(mode, q), loader = new THREE.TextureLoader();
  const one = async (name: SourcedName, kind: 'map' | 'normal' | 'rough'): Promise<THREE.Texture | null> => {
    if (!kinds.includes(kind)) return null;
    const t = await loader.loadAsync(`${baseUrl()}textures/patio/${name}-${kind}-${size}.webp`);
    t.colorSpace = kind === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.anisotropy = Math.min(ANISO[q], maxAniso);
    t.name = `patio-${name}-${kind}-${size}`;
    return t;
  };
  const surface = async (name: SourcedName): Promise<SourcedSurface> => {
    const [map, normal, rough] = await Promise.all([one(name, 'map'), one(name, 'normal'), one(name, 'rough')]);
    return { map: map!, normal, rough };
  };
  const [plaster, cobble, wood] = await Promise.all([surface('plaster'), surface('cobble'), surface('wood')]);
  return { mode, quality: q, plaster, cobble, wood };
}

/**
 * Loads the requested variant's textures for this quality (main.ts awaits it
 * before the engine exists). Resolves either way: on failure or after
 * `timeoutMs` the page stays classic.
 */
export async function preloadSourced(quality: Quality, opts: { mode?: MatMode; timeoutMs?: number; maxAnisotropy?: number } = {}): Promise<void> {
  const mode = opts.mode ?? requestedMatMode();
  if (mode === 'classic' || typeof document === 'undefined') return;
  if (opts.maxAnisotropy) maxAniso = opts.maxAnisotropy;
  const t0 = performance.now(), size = tierOf(quality);
  if (loaded.has(size)) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const set = await Promise.race([
      loadTier(mode, quality),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out after ${opts.timeoutMs ?? 4000} ms`)), opts.timeoutMs ?? 4000); }),
    ]);
    loaded.set(size, set);
    diagLog('gfx', `patio textures (${mode}, ${size} px) loaded in ${Math.round(performance.now() - t0)} ms`);
  } catch (err) {
    if (!loaded.size) failed = true;
    diagLog('gfx', `patio textures (${mode}) failed: ${String(err)}; El Patio stays classic`);
  } finally { if (timer) clearTimeout(timer); }
}

/** The variant in effect: the requested one once its textures are in, else classic. */
export function sourcedMode(): MatMode {
  return failed || !loaded.size ? 'classic' : [...loaded.values()][0]!.mode;
}

/**
 * The loaded set for a quality: its own tier, or (after a quality change to a
 * tier that is not loaded) the other one, while that tier loads for next time.
 */
export function sourcedSet(quality: Quality): SourcedSet | null {
  if (sourcedMode() === 'classic') return null;
  const own = loaded.get(tierOf(quality));
  if (own) return own;
  void preloadSourced(quality, { mode: sourcedMode() });
  return [...loaded.values()][0] ?? null;
}

/** Tests only: forget what was loaded. */
export function resetSourced(): void { loaded.clear(); failed = false; }
/** Tests only: install a set without loading files. */
export function installSourced(set: SourcedSet): void { loaded.set(tierOf(set.quality), set); failed = false; }
