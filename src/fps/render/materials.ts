// Shared art-direction building blocks: a three-band cel-shading ramp,
// cached toon materials, procedural textures, and box geometry with
// world-scale UVs so textures keep the same density on every wall.
import * as THREE from 'three';

export const COLORS = {
  terracotta: 0xc8553d, terracottaDark: 0x9c3d2c, turquoise: 0x4fb3a9, turquoiseFaded: 0x86c9be,
  marigold: 0xf2a33a, marigoldDeep: 0xe8871e, cream: 0xf4e6c8, creamDark: 0xe0cba0, violet: 0x5a3480,
  violetDeep: 0x2e1846, pink: 0xe9789a, gold: 0xf5c542, ink: 0x241626, leaf: 0x5c9a4a, leafDark: 0x3c7037,
  wood: 0x8a5a3b, woodDark: 0x5e3b25, stone: 0xd9c9a8, stoneDark: 0xb7a483, skin: 0xc68a5e, skinShade: 0xa87048,
  water: 0x5fc7d0, sol: 0xf29a2e, solDeep: 0xc8691a, luna: 0x36b9c9, lunaDeep: 0x1f7d8c,
};

let ramp: THREE.DataTexture | null = null;
/**
 * Shadow, mid and lit bands. 'classic' (the campaign, and everything before the
 * lighting milestone): a soft ramp that lets faces turned from the sun keep
 * nearly half of it. 'arena': a deeper shadow band, so a face turned from the
 * sun is lit mostly by the cool sky fill: warm light against cool shade, and
 * clearer forms, with the fill raised to keep shade readable (lighting.ts).
 */
const RAMPS = { classic: [120, 190, 255], arena: [64, 118, 255] } as const;
export type RampProfile = keyof typeof RAMPS;
let rampProfile: RampProfile = 'classic';
/** Switches every toon material's bands at once (one shared texture). */
export function setToonRamp(p: RampProfile): void {
  if (p === rampProfile && ramp) return;
  rampProfile = p;
  if (!ramp) return;
  const d = ramp.image.data as Uint8Array;
  RAMPS[p].forEach((v, i) => { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; });
  ramp.needsUpdate = true;
}
export function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp;
  // Shadow, mid, lit: a three-step ramp so lighting reads as painted.
  const [a, b, c] = RAMPS[rampProfile];
  const data = new Uint8Array([a, a, a, 255, b, b, b, 255, c, c, c, 255]);
  ramp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  ramp.minFilter = THREE.NearestFilter;
  ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

/**
 * The arena world's own bands (ao-field.ts swaps them in on the world's
 * materials only; characters, the hand and props keep the shared ramp).
 * A wall turned from the sun keeps less of it, so a face in shade is lit by
 * the cool sky fill and reads as shade, not as dimmer sunlight.
 */
export const WORLD_RAMP: readonly [number, number, number] = [30, 112, 255];
let wramp: THREE.DataTexture | null = null;
export function worldRamp(): THREE.DataTexture {
  if (wramp) return wramp;
  const [a, b, c] = WORLD_RAMP;
  wramp = new THREE.DataTexture(new Uint8Array([a, a, a, 255, b, b, b, 255, c, c, c, 255]), 3, 1, THREE.RGBAFormat);
  wramp.minFilter = wramp.magFilter = THREE.NearestFilter;
  wramp.generateMipmaps = false;
  wramp.needsUpdate = true;
  return wramp;
}

const cache = new Map<string, THREE.Material>();
const shared = new WeakSet<THREE.Material>();
/** A material from the shared toon/flat cache (it may also dress characters or props). */
export function isSharedMaterial(m: THREE.Material): boolean { return shared.has(m); }

export function toon(color: number, opts: { map?: THREE.Texture | null; emissive?: number; side?: THREE.Side; transparent?: boolean; opacity?: number } = {}): THREE.MeshToonMaterial {
  const key = `t:${color}:${opts.map?.uuid ?? ''}:${opts.emissive ?? 0}:${opts.side ?? 0}:${opts.transparent ? 1 : 0}:${opts.opacity ?? 1}`;
  let m = cache.get(key) as THREE.MeshToonMaterial | undefined;
  if (!m) {
    m = new THREE.MeshToonMaterial({
      color, gradientMap: toonRamp(), map: opts.map ?? null, emissive: opts.emissive ?? 0x000000,
      side: opts.side ?? THREE.FrontSide, transparent: !!opts.transparent, opacity: opts.opacity ?? 1,
    });
    cache.set(key, m);
    shared.add(m);
  }
  return m;
}

export function flat(color: number, opts: { transparent?: boolean; opacity?: number; side?: THREE.Side; additive?: boolean; depthWrite?: boolean } = {}): THREE.MeshBasicMaterial {
  const key = `b:${color}:${opts.transparent ? 1 : 0}:${opts.opacity ?? 1}:${opts.side ?? 0}:${opts.additive ? 1 : 0}:${opts.depthWrite ?? 'd'}`;
  let m = cache.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color, transparent: !!opts.transparent, opacity: opts.opacity ?? 1, side: opts.side ?? THREE.FrontSide,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: opts.depthWrite ?? !opts.transparent,
    });
    cache.set(key, m);
  }
  return m;
}

export const OUTLINE = new THREE.MeshBasicMaterial({ color: COLORS.ink, side: THREE.BackSide });

function canvas(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat = true): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const el = document.createElement('canvas');
  el.width = w; el.height = h;
  const ctx = el.getContext('2d');
  if (!ctx) return null;
  draw(ctx);
  const tex = new THREE.CanvasTexture(el);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const texCache = new Map<string, THREE.Texture | null>();

// Hand-painted stucco: soft blotches, a few cracks and a grimy base band.
// White, so the material colour tints it.
export function stuccoTexture(): THREE.Texture | null {
  if (texCache.has('stucco')) return texCache.get('stucco')!;
  const t = canvas(256, 256, (c) => {
    const r = rand(7);
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 140; i++) {
      const g = 225 + Math.floor(r() * 30);
      c.fillStyle = `rgba(${g},${g - 4},${g - 10},${0.25 + r() * 0.35})`;
      c.beginPath();
      c.ellipse(r() * 256, r() * 256, 6 + r() * 26, 4 + r() * 16, r() * 3, 0, Math.PI * 2);
      c.fill();
    }
    c.strokeStyle = 'rgba(150,130,110,0.35)';
    c.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      let x = r() * 256, y = r() * 256;
      c.beginPath(); c.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 22; y += 6 + r() * 10; c.lineTo(x, y); }
      c.stroke();
    }
  });
  texCache.set('stucco', t);
  return t;
}

export function woodTexture(): THREE.Texture | null {
  if (texCache.has('wood')) return texCache.get('wood')!;
  const t = canvas(128, 128, (c) => {
    const r = rand(3);
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 16) {
      c.fillStyle = 'rgba(90,60,40,0.35)';
      c.fillRect(0, y, 128, 2);
      for (let i = 0; i < 6; i++) {
        c.fillStyle = `rgba(120,80,50,${0.1 + r() * 0.15})`;
        c.fillRect(0, y + 3 + r() * 11, 128, 1);
      }
    }
  });
  texCache.set('wood', t);
  return t;
}

// Ground: one painted texture for the whole map (plaza pavers, cobbled
// streets, tiled spawn courtyards). Map coordinates x∈[-27,27], z∈[-19,19].
export function groundTexture(pxPerMeter: number): THREE.Texture | null {
  const key = `ground${pxPerMeter}`;
  if (texCache.has(key)) return texCache.get(key)!;
  const W = Math.round(54 * pxPerMeter), H = Math.round(38 * pxPerMeter);
  const t = canvas(W, H, (c) => {
    const r = rand(11);
    const P = pxPerMeter;
    const X = (x: number) => (x + 27) * P, Z = (z: number) => (z + 19) * P;
    // Streets: rounded cobbles.
    c.fillStyle = '#b9a98f';
    c.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += P * 0.32) {
      for (let x = (Math.floor(y / (P * 0.32)) % 2) * P * 0.16; x < W; x += P * 0.32) {
        const g = 150 + Math.floor(r() * 50);
        c.fillStyle = `rgb(${g + 20},${g + 8},${g - 8})`;
        c.beginPath();
        c.ellipse(x, y, P * 0.14, P * 0.12, 0, 0, Math.PI * 2);
        c.fill();
      }
    }
    // Plaza: terracotta pavers with cream grout and a diagonal border.
    c.fillStyle = '#e8d3ae';
    c.fillRect(X(-17), Z(-8), (34) * P, 16 * P);
    const tones = ['#cf7354', '#c96a4d', '#d98665', '#c4634a'];
    for (let z = -8; z < 8; z += 0.6) {
      for (let x = -17; x < 17; x += 0.6) {
        c.fillStyle = tones[Math.floor(r() * tones.length)]!;
        c.fillRect(X(x) + 1, Z(z) + 1, 0.6 * P - 2, 0.6 * P - 2);
      }
    }
    // Cream path ring around the fountain and a star in the centre.
    c.strokeStyle = '#f1e2c2';
    c.lineWidth = P * 0.6;
    c.beginPath(); c.arc(X(0), Z(0), 4.2 * P, 0, Math.PI * 2); c.stroke();
    c.lineWidth = P * 0.25;
    c.strokeStyle = '#7a4a8a';
    c.beginPath(); c.arc(X(0), Z(0), 4.75 * P, 0, Math.PI * 2); c.stroke();
    // Spawn courtyards: ochre tiles tinted toward the team colour.
    const court = (x0: number, z0: number, x1: number, z1: number, a: string, b: string) => {
      for (let z = z0; z < z1; z += 0.5) for (let x = x0; x < x1; x += 0.5) {
        c.fillStyle = (Math.floor(x * 2) + Math.floor(z * 2)) % 2 === 0 ? a : b;
        c.fillRect(X(x), Z(z), 0.5 * P, 0.5 * P);
      }
    };
    court(-26, -6.4, -21, 6.4, '#e9b25e', '#f3d39a');
    court(21, -6.4, 26, 6.4, '#6fc4c6', '#bfe6dd');
    // Soft dirt and grime at the plaza edges.
    const grd = c.createRadialGradient(X(0), Z(0), 8 * P, X(0), Z(0), 26 * P);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(60,30,20,0.18)');
    c.fillStyle = grd;
    c.fillRect(0, 0, W, H);
  }, false);
  if (t) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
  texCache.set(key, t);
  return t;
}

export function signTexture(text: string, bg: string, fg: string, w = 512, h = 128): THREE.Texture | null {
  const key = `sign:${text}:${bg}:${fg}`;
  if (texCache.has(key)) return texCache.get(key)!;
  const t = canvas(w, h, (c) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = fg;
    c.lineWidth = 6;
    c.strokeRect(8, 8, w - 16, h - 16);
    c.fillStyle = fg;
    c.font = `${Math.floor(h * 0.5)}px "Lilita One", "Arial Black", sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, w / 2, h / 2 + 4, w - 40);
  }, false);
  texCache.set(key, t);
  return t;
}

// Adds a box with world-scale UVs (one texture repeat per `scale` metres)
// to a geometry list.
export function boxGeo(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, scale = 2, faces = 63): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[], u0: number, v0: number, u1: number, v1: number) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    for (let i = 0; i < 4; i++) nor.push(...n);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const s = 1 / scale;
  if (faces & 1) quad([maxX, minY, maxZ], [maxX, minY, minZ], [maxX, maxY, minZ], [maxX, maxY, maxZ], [1, 0, 0], maxZ * s, minY * s, minZ * s, maxY * s); // +x
  if (faces & 2) quad([minX, minY, minZ], [minX, minY, maxZ], [minX, maxY, maxZ], [minX, maxY, minZ], [-1, 0, 0], minZ * s, minY * s, maxZ * s, maxY * s); // -x
  if (faces & 4) quad([minX, maxY, maxZ], [maxX, maxY, maxZ], [maxX, maxY, minZ], [minX, maxY, minZ], [0, 1, 0], minX * s, maxZ * s, maxX * s, minZ * s); // +y
  if (faces & 8) quad([minX, minY, minZ], [maxX, minY, minZ], [maxX, minY, maxZ], [minX, minY, maxZ], [0, -1, 0], minX * s, minZ * s, maxX * s, maxZ * s); // -y
  if (faces & 16) quad([minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ], [0, 0, 1], minX * s, minY * s, maxX * s, maxY * s); // +z
  if (faces & 32) quad([maxX, minY, minZ], [minX, minY, minZ], [minX, maxY, minZ], [maxX, maxY, minZ], [0, 0, -1], maxX * s, minY * s, minX * s, maxY * s); // -z
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Collects geometry per material and bakes it into one mesh each.
export class GeoBatch {
  private buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(mat: THREE.Material, g: THREE.BufferGeometry): void {
    let b = this.buckets.get(mat);
    if (!b) { b = []; this.buckets.set(mat, b); }
    b.push(g);
  }
  addMesh(mat: THREE.Material, geo: THREE.BufferGeometry, m: THREE.Matrix4): void {
    const g = geo.index ? geo.clone() : geo.clone();
    g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position as THREE.BufferAttribute).count * 2), 2));
    if (!g.index) {
      const n = (g.attributes.position as THREE.BufferAttribute).count;
      g.setIndex(Array.from({ length: n }, (_, i) => i));
    }
    this.add(mat, g);
  }
  build(group: THREE.Object3D, mergeFn: (gs: THREE.BufferGeometry[]) => THREE.BufferGeometry | null, shadows = true): number {
    let calls = 0;
    for (const [mat, gs] of this.buckets) {
      const merged = mergeFn(gs);
      gs.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadows && !(mat as THREE.Material).transparent;
      mesh.receiveShadow = true;
      group.add(mesh);
      calls++;
    }
    this.buckets.clear();
    return calls;
  }
}
