// Baked ambient occlusion and grounding for the arena maps: one top-down
// field over the map, built once at world build time from the solid boxes
// (every solid box is both collision and the rendered footprint), sampled
// by the world's toon materials at their world position. It darkens only
// the sky and ground fill (the hemisphere light), so the sun stays crisp:
//
//   local   contact shade: the paving at a wall's foot, inner corners,
//           around crates, bins, planters and kiosks, the riser of each step.
//           Four height layers (0, 0.5, 1.0, 1.5 m): an object only shades
//           what is below its top, so a crate's shade is gone by its lid
//           while a wall's corner stays dark to head height, then fades out
//           by about 2.5 m.
//   broad   how much big mass is near: the narrow alley and the foot of the
//           houses take less sky than the open plaza (fades out up the walls).
//   cover   under a ceiling (the covered doorways, lintels): darker, and on
//           Low (no shadow map) the sun is held off there too.
//
// High: fine field at 12.5 cm plus the coarse one (two taps). Medium: the
// same at 20 cm. Low: one 25 cm texture carrying the ground contact layer,
// the broad term, the cover and a baked sun shadow (one tap, a shorter
// shader): Low has no shadow map, so the houses' shade on the paving and
// walls, and the covered doorways, are baked from the boxes and the sun.
// No draw call is added; the materials keep their own programs (a cache key
// suffix), characters and the first-person hand are never touched.
import * as THREE from 'three';
import type { MapBox } from '../../../shared/map';
import type { Quality } from '../settings';
import { isSharedMaterial, toonRamp, worldRamp } from './materials';

/** Strengths, in the fraction of the fill a fully occluded point loses. */
export interface AoTune {
  local: number; // contact shade
  wall: number; // how much of the contact shade a vertical face takes (the floor takes all of it)
  broad: number; // canyon / mass term
  cover: number; // under a ceiling
  coverDirect: number; // Low only: how much sun is held off under a ceiling
  sunShadow: number; // Low only: the baked sun shadow's depth (1 = as dark as a shadow map's)
  ramp: boolean; // the world's own toon bands (materials.ts worldRamp)
  /** Review only: 1 shows the fill factor, 2 the Low sun visibility, as grey. */
  debug?: number;
}
export const AO_TUNE: AoTune = { local: 0.85, wall: 0.45, broad: 0.5, cover: 0.6, coverDirect: 0, sunShadow: 1, ramp: true };

const LAYERS = [0, 0.5, 1.0, 1.5];

interface Rect { x0: number; z0: number; x1: number; z1: number }

export interface AoField {
  /** Patch every opaque toon material under `root` (world meshes only). */
  apply(root: THREE.Object3D): number;
  /** CPU sample of the fill factor at a point (for whoever lights characters later). 1 = open sky. */
  ambientAt(x: number, y: number, z: number): number;
  /** Texture memory, bytes. */
  bytes: number;
  bakeMs: number;
  dispose(): void;
}

/** Fractional box rasteriser: max of w * covered area per texel. */
function raster(out: Float32Array, W: number, H: number, cell: number, r: Rect, b: { minX: number; maxX: number; minZ: number; maxZ: number }, w: number): void {
  if (w <= 0) return;
  const gx0 = (b.minX - r.x0) / cell, gx1 = (b.maxX - r.x0) / cell, gz0 = (b.minZ - r.z0) / cell, gz1 = (b.maxZ - r.z0) / cell;
  const i0 = Math.max(0, Math.floor(gx0)), i1 = Math.min(W - 1, Math.ceil(gx1) - 1);
  const j0 = Math.max(0, Math.floor(gz0)), j1 = Math.min(H - 1, Math.ceil(gz1) - 1);
  for (let j = j0; j <= j1; j++) {
    const fz = Math.min(j + 1, gz1) - Math.max(j, gz0);
    if (fz <= 0) continue;
    for (let i = i0; i <= i1; i++) {
      const fx = Math.min(i + 1, gx1) - Math.max(i, gx0);
      if (fx <= 0) continue;
      const v = w * fx * fz, k = j * W + i;
      if (v > out[k]!) out[k] = v;
    }
  }
}

/** In-place box blur along one axis (running sum), edges clamped. */
function boxBlur1(src: Float32Array, dst: Float32Array, W: number, H: number, rad: number, alongX: boolean): void {
  const n = alongX ? W : H, m = alongX ? H : W;
  const at = (a: number, b: number) => (alongX ? b * W + a : a * W + b);
  const inv = 1 / (2 * rad + 1);
  for (let b = 0; b < m; b++) {
    let s = 0;
    for (let a = -rad; a <= rad; a++) s += src[at(Math.min(n - 1, Math.max(0, a)), b)]!;
    for (let a = 0; a < n; a++) {
      dst[at(a, b)] = s * inv;
      s += src[at(Math.min(n - 1, a + rad + 1), b)]! - src[at(Math.max(0, a - rad), b)]!;
    }
  }
}
/** Three box passes per axis: close to a gaussian of the given sigma (in texels). */
function gauss(src: Float32Array, W: number, H: number, sigma: number): Float32Array {
  const rad = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2 - 0.5));
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  for (const ax of [true, false]) for (let p = 0; p < 3; p++) { boxBlur1(a, b, W, H, rad, ax); [a, b] = [b, a]; }
  return a;
}

const isColumn = (b: MapBox) => b.minY < 1.0; // standing on the ground (or on a box that does)
const isCeiling = (b: MapBox) => b.minY >= 1.8 && b.minY <= 3.5;

const SUN_H_MAX = 10;
/**
 * Low's sun shadow: for each column, the height below which the sun is
 * hidden by a box (every box taken as a column from the ground, which holds
 * for these maps: the lintels span between walls at least as tall). March
 * toward the sun over the height grid: hs = max over t of H(p + t d) - t tan(elevation).
 */
function sunShadowHeights(boxes: readonly MapBox[], W: number, H: number, cell: number, r: Rect, sun: THREE.Vector3): Float32Array {
  // A column's height where a box covers the texel centre.
  const full = new Float32Array(W * H);
  for (const b of boxes) {
    const i0 = Math.max(0, Math.round((b.minX - r.x0) / cell)), i1 = Math.min(W - 1, Math.round((b.maxX - r.x0) / cell) - 1);
    const j0 = Math.max(0, Math.round((b.minZ - r.z0) / cell)), j1 = Math.min(H - 1, Math.round((b.maxZ - r.z0) / cell) - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * W + i; if (b.maxY > full[k]!) full[k] = b.maxY; }
  }
  const hl = Math.hypot(sun.x, sun.z) || 1, dx = sun.x / hl, dz = sun.z / hl, tanE = Math.max(0.05, sun.y / hl);
  const out = new Float32Array(W * H), step = cell * 0.7, tMax = SUN_H_MAX / tanE;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let hs = 0;
    for (let t = step; t < tMax; t += step) {
      const fi = Math.round(i + (dx * t) / cell), fj = Math.round(j + (dz * t) / cell);
      if (fi < 0 || fj < 0 || fi >= W || fj >= H) break;
      const v = full[fj * W + fi]! - t * tanE;
      if (v > hs) hs = v;
    }
    out[j * W + i] = Math.min(SUN_H_MAX, hs);
  }
  return out;
}

let live: AoField | null = null;

export function buildAoField(boxes: readonly MapBox[], bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, quality: Quality, tune: AoTune = AO_TUNE, sunDir: THREE.Vector3 = new THREE.Vector3(-0.6, 0.65, 0.35)): AoField {
  live?.dispose();
  const t0 = performance.now();
  const lite = quality === 'low';
  const r: Rect = { x0: bounds.minX - 1.5, z0: bounds.minZ - 1.5, x1: bounds.maxX + 1.5, z1: bounds.maxZ + 1.5 };
  const cell = quality === 'high' ? 0.125 : quality === 'medium' ? 0.2 : 0.25;
  const W = Math.ceil((r.x1 - r.x0) / cell), H = Math.ceil((r.z1 - r.z0) / cell), N = W * H;
  const cols = boxes.filter(isColumn), ceils = boxes.filter(isCeiling);

  // Local layers: an object counts at height L only where it rises clearly above L.
  const local = (L: number) => {
    const occ = new Float32Array(N);
    for (const b of cols) raster(occ, W, H, cell, r, b, Math.min(1, Math.max(0, (b.maxY - L - 0.1) / 0.35)));
    const g1 = gauss(occ, W, H, 0.32 / cell), g2 = gauss(occ, W, H, 1.0 / cell);
    for (let k = 0; k < N; k++) occ[k] = 0.6 * g1[k]! + 0.4 * g2[k]!;
    return occ;
  };
  // Broad mass at ground and at 3 m, and the cover mask: smooth, so a coarse grid does.
  const cc = lite ? cell : 0.5;
  const CW = Math.ceil((r.x1 - r.x0) / cc), CH = Math.ceil((r.z1 - r.z0) / cc), CN = CW * CH;
  const broad = (L: number) => {
    const occ = new Float32Array(CN);
    for (const b of cols) raster(occ, CW, CH, cc, r, b, Math.min(1, Math.max(0, (b.maxY - L) / 5)));
    return gauss(occ, CW, CH, 2.4 / cc);
  };
  const coverMask = () => {
    const occ = new Float32Array(CN);
    for (const b of ceils) raster(occ, CW, CH, cc, r, b, 1);
    return gauss(occ, CW, CH, 0.45 / cc);
  };

  const u8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  const textures: THREE.DataTexture[] = [];
  const mk = (data: Uint8Array, w: number, h: number) => {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = THREE.NoColorSpace;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.flipY = false;
    t.needsUpdate = true;
    textures.push(t);
    return t;
  };

  // CPU copies for ambientAt.
  let fineF: Float32Array[], broadF: Float32Array[], coverF: Float32Array;
  let fine: THREE.DataTexture, coarse: THREE.DataTexture | null = null;
  let sunH: Float32Array | null = null;
  if (lite) {
    const l0 = local(0), b0 = broad(0), cv = coverMask();
    sunH = sunShadowHeights(boxes, W, H, cell, r, sunDir);
    const d = new Uint8Array(N * 4);
    for (let k = 0; k < N; k++) { d[k * 4] = u8(l0[k]!); d[k * 4 + 1] = u8(sunH[k]! / SUN_H_MAX); d[k * 4 + 2] = u8(b0[k]!); d[k * 4 + 3] = u8(cv[k]!); }
    fine = mk(d, W, H);
    fineF = [l0, l0]; broadF = [b0, b0]; coverF = cv;
  } else {
    const ls = LAYERS.map(local);
    const d = new Uint8Array(N * 4);
    for (let k = 0; k < N; k++) for (let c = 0; c < 4; c++) d[k * 4 + c] = u8(ls[c]![k]!);
    fine = mk(d, W, H);
    const b0 = broad(0), b3 = broad(3), cv = coverMask();
    const e = new Uint8Array(CN * 4);
    for (let k = 0; k < CN; k++) { e[k * 4] = u8(b0[k]!); e[k * 4 + 1] = u8(b3[k]!); e[k * 4 + 2] = u8(cv[k]!); e[k * 4 + 3] = 255; }
    coarse = mk(e, CW, CH);
    fineF = ls; broadF = [b0, b3]; coverF = cv;
  }

  const uniforms = {
    aoFine: { value: fine },
    aoCoarse: { value: coarse ?? fine },
    aoRect: { value: new THREE.Vector4(r.x0, r.z0, 1 / (r.x1 - r.x0), 1 / (r.z1 - r.z0)) },
    aoK: { value: new THREE.Vector4(tune.local, tune.broad, tune.cover, tune.wall) },
    aoCoverDirect: { value: lite ? tune.coverDirect : 0 },
    aoSun: { value: lite ? tune.sunShadow : 0 },
    aoSunDir: { value: sunDir.clone().normalize() },
    aoDebug: { value: tune.debug ?? 0 },
  };

  const vertPars = '\nvarying vec3 vAoW;\nvarying vec3 vAoN;\n';
  const vertMain = `
  {
    vec4 aoWp = vec4( transformed, 1.0 );
    vec3 aoN = objectNormal;
    #ifdef USE_INSTANCING
      aoWp = instanceMatrix * aoWp;
      aoN = mat3( instanceMatrix ) * aoN;
    #endif
    aoWp = modelMatrix * aoWp;
    vAoW = aoWp.xyz;
    vAoN = mat3( modelMatrix ) * aoN;
  }`;
  // The fill factor. Layers are 0.5 m apart; an upward face reads the layer
  // at or just above its own height, so the box it lies on does not shade it.
  const fragPars = `
varying vec3 vAoW;
varying vec3 vAoN;
uniform sampler2D aoFine;
uniform sampler2D aoCoarse;
uniform vec4 aoRect;
uniform vec4 aoK;
uniform float aoCoverDirect;
uniform float aoSun;
uniform vec3 aoSunDir;
uniform float aoDebug;
float aoCover;
float aoSunVis;
float aoFieldFill() {
  vec3 n = normalize( vAoN );
  float up = n.y;
  vec2 p = vAoW.xz + n.xz * 0.14;
  vec2 uv = ( p - aoRect.xy ) * aoRect.zw;
  aoSunVis = 1.0;
  if ( uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 ) { aoCover = 0.0; return 1.0; }
  float y = vAoW.y;
  vec4 f = texture2D( aoFine, uv );
${lite ? `
  // One layer: an upward face off the ground (a lid, a step, a roof) takes none of it.
  float loc = f.r * ( 1.0 - smoothstep( 0.3, 1.8, y ) ) * ( 1.0 - step( 0.7, up ) * step( 0.2, y ) );
  // Baked sun shadow (no shadow map on Low): the height up to which this column is in shade.
  aoSunVis = 1.0 - aoSun * smoothstep( -0.1, 0.1, f.g * ${SUN_H_MAX.toFixed(1)} - y - 0.03 ) * step( 0.05, dot( n, aoSunDir ) );
  float bro = f.b * ( 1.0 - smoothstep( 2.0, 6.0, y ) );
  float cov = f.a;` : `
  float fl = y / 0.5;
  fl = mix( fl, ceil( fl - 0.1 ), step( 0.7, up ) );
  vec4 wl = max( vec4( 0.0 ), 1.0 - abs( vec4( clamp( fl, 0.0, 3.0 ) ) - vec4( 0.0, 1.0, 2.0, 3.0 ) ) );
  float loc = dot( f, wl ) * ( 1.0 - smoothstep( 1.5, 2.5, y ) );
  vec4 c = texture2D( aoCoarse, uv );
  float bro = mix( c.r, c.g, clamp( y / 3.0, 0.0, 1.0 ) ) * ( 1.0 - smoothstep( 3.0, 7.0, y ) );
  float cov = c.b;`}
  // Under a ceiling (2.4 to 2.7 m on every map): everything below it, and its underside.
  cov *= max( 1.0 - smoothstep( 2.2, 2.6, y ), step( up, -0.5 ) );
  aoCover = cov;
  float wn = mix( aoK.w, 1.0, clamp( up, 0.0, 1.0 ) );
  return ( 1.0 - aoK.x * loc * wn ) * ( 1.0 - aoK.y * bro ) * ( 1.0 - aoK.z * cov );
}
`;
  const fragApply = `
  {
    float aoF = aoFieldFill();
    reflectedLight.indirectDiffuse *= aoF;
    reflectedLight.directDiffuse *= ( 1.0 - aoCoverDirect * aoCover ) * aoSunVis;
    if ( aoDebug > 0.5 ) { reflectedLight.directDiffuse = vec3( 0.0 ); totalEmissiveRadiance = vec3( 0.0 ); reflectedLight.indirectDiffuse = vec3( aoDebug > 1.5 ? aoSunVis : aoF ); }
  }`;
  const key = `|aofield:${lite ? 'l' : 'f'}`;

  const patched = new WeakMap<THREE.Material, THREE.Material>();
  const patch = (m: THREE.Material): THREE.Material => {
    const done = patched.get(m);
    if (done) return done;
    if (!(m as THREE.MeshToonMaterial).isMeshToonMaterial || m.transparent || m.userData.aoField) { patched.set(m, m); return m; }
    // A material from the shared cache may also dress a character or a prop: the world gets its own copy.
    const mm = isSharedMaterial(m) ? m.clone() : m;
    // Chain whatever the material already patches (and extend its cache key, never replace it).
    // three's default key is the onBeforeCompile source, so it is read before ours replaces it.
    // Both come from the original: a clone carries neither its patch nor its key.
    const prevKeyFn = m.customProgramCacheKey;
    const prevKey = prevKeyFn === THREE.Material.prototype.customProgramCacheKey ? m.customProgramCacheKey() : null;
    const prev = m.onBeforeCompile;
    mm.onBeforeCompile = function (sh, rr) {
      prev.call(this, sh, rr);
      if (!sh.fragmentShader.includes('#include <aomap_fragment>') || !sh.vertexShader.includes('#include <fog_vertex>')) return;
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>' + vertPars).replace('#include <fog_vertex>', '#include <fog_vertex>' + vertMain);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + fragPars).replace('#include <aomap_fragment>', '#include <aomap_fragment>' + fragApply);
    };
    mm.customProgramCacheKey = function () { return (prevKey ?? prevKeyFn.call(m)) + key; };
    const tm = mm as THREE.MeshToonMaterial;
    if (tune.ramp && tm.gradientMap === toonRamp()) tm.gradientMap = worldRamp();
    mm.userData.aoField = true;
    mm.needsUpdate = true;
    patched.set(m, mm);
    if (mm !== m) patched.set(mm, mm);
    return mm;
  };

  const sample = (arr: Float32Array, w: number, h: number, c: number, x: number, z: number) => {
    const gx = Math.min(w - 1, Math.max(0, (x - r.x0) / c - 0.5)), gz = Math.min(h - 1, Math.max(0, (z - r.z0) / c - 0.5));
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, i1 = Math.min(w - 1, i + 1), j1 = Math.min(h - 1, j + 1);
    return (arr[j * w + i]! * (1 - fx) + arr[j * w + i1]! * fx) * (1 - fz) + (arr[j1 * w + i]! * (1 - fx) + arr[j1 * w + i1]! * fx) * fz;
  };
  const sm = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

  const field: AoField = {
    apply(root) {
      let n = 0;
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((m) => { const p = patch(m); if (p.userData.aoField) n++; return p; });
        else { const p = patch(mesh.material); if (p.userData.aoField) n++; mesh.material = p; }
      });
      return n;
    },
    ambientAt(x, y, z) {
      if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) return 1;
      const lw = lite ? 1.0 : 0.5, nl = fineF.length;
      const fl = Math.min(nl - 1, Math.max(0, y / lw)), i = Math.min(nl - 2, Math.floor(fl));
      const loc = (sample(fineF[i]!, W, H, cell, x, z) * (1 - (fl - i)) + sample(fineF[i + 1]!, W, H, cell, x, z) * (fl - i)) * (1 - sm(lite ? 1.0 : 1.5, 2.5, y));
      const bro = (sample(broadF[0]!, CW, CH, cc, x, z) * (1 - Math.min(1, y / 3)) + sample(broadF[1]!, CW, CH, cc, x, z) * Math.min(1, y / 3)) * (1 - sm(3, 7, y));
      const cov = sample(coverF, CW, CH, cc, x, z) * (1 - sm(2.2, 2.6, y));
      return (1 - tune.local * loc * 0.55) * (1 - tune.broad * bro) * (1 - tune.cover * cov);
    },
    bytes: textures.reduce((s, t) => s + t.image.width * t.image.height * 4, 0),
    bakeMs: 0,
    dispose() { textures.forEach((t) => t.dispose()); if (live === field) live = null; },
  };
  field.bakeMs = Math.round(performance.now() - t0);
  live = field;
  return field;
}
