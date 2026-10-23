// El Patio kit: textures, paving and the materials the kit's meshes use
// (one material per kind; tints go into vertex colours). Geometry and
// placement live in section.ts; this file owns how surfaces look.
//
// Texture rules (milestone 2's restraint, kept): broad, low-contrast
// variation only. Nothing finer than ~4 px at the texture's world scale, so
// mipmaps average detail away instead of letting it shimmer. Low quality gets
// half-size canvases and no anisotropic filtering.
import * as THREE from 'three';
import { toonRamp } from './materials';
import type { Quality } from '../settings';

// ------------------------------------------------------------------ textures
// Small procedural canvases, cached, white or neutral where a colour tints them.

const texCache = new Map<string, THREE.CanvasTexture | null>();
function tex(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture | null {
  if (texCache.has(key)) return texCache.get(key)!;
  let t: THREE.CanvasTexture | null = null;
  if (typeof document !== 'undefined') {
    const el = document.createElement('canvas');
    el.width = w; el.height = h;
    const c = el.getContext('2d');
    if (c) {
      draw(c);
      t = new THREE.CanvasTexture(el);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 4;
    }
  }
  texCache.set(key, t);
  return t;
}

/** Per-quality canvas scale (1 or 1/2) and anisotropy. */
const SCALE: Record<Quality, number> = { high: 1, medium: 1, low: 0.5 };
const ANISO: Record<Quality, number> = { high: 8, medium: 4, low: 1 };
function q(t: THREE.CanvasTexture | null, quality: Quality): THREE.CanvasTexture | null {
  if (t) t.anisotropy = ANISO[quality];
  return t;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Soft circles that wrap at the edges, so the texture tiles without seams. `shade` returns [r, g, b, a]. */
function mottle(c: CanvasRenderingContext2D, size: number, seed: number, count: number, r0: number, r1: number, shade: (r: () => number) => [number, number, number, number]): void {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = r() * size, y = r() * size, rad = r0 + r() * (r1 - r0), [cr, cg, cb, ca] = shade(r);
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      const cx = x + ox, cy = y + oy;
      if (cx + rad < 0 || cx - rad > size || cy + rad < 0 || cy - rad > size) continue;
      const g = c.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${ca})`); g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      c.fillStyle = g; c.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }
  }
}

/**
 * Lime plaster (1 texture = 2 m): two scales of faint clouding plus a few
 * paler patches. No streaks, cracks or base grime (the texture repeats every
 * 2 m vertically, so a base band would repeat up the wall).
 */
function plasterTexture(quality: Quality): THREE.CanvasTexture | null {
  const S = 256 * SCALE[quality], k = S / 256;
  return q(tex(`plaster${S}-${quality}`, S, S, (c) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, S, S);
    mottle(c, S, 11, 26, 60 * k, 110 * k, (r) => { const g = 232 + Math.floor(r() * 14); return [g, g - 6, g - 16, 0.1 + r() * 0.08]; });
    mottle(c, S, 12, 60, 18 * k, 46 * k, (r) => { const g = 226 + Math.floor(r() * 20); return [g, g - 5, g - 13, 0.08 + r() * 0.08]; });
  }), quality);
}

/** Cantera stone: soft, low-contrast speckle for steps, caps and the threshold (no pixel grain). */
function canteraTexture(quality: Quality): THREE.CanvasTexture | null {
  const S = 128 * SCALE[quality], k = S / 128;
  return q(tex(`cantera${S}-${quality}`, S, S, (c) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, S, S);
    mottle(c, S, 22, 10, 30 * k, 56 * k, (r) => { const g = 226 + Math.floor(r() * 16); return [g, g - 8, g - 20, 0.1 + r() * 0.08]; });
    mottle(c, S, 23, 70, 4 * k, 10 * k, (r) => { const g = 218 + Math.floor(r() * 26); return [g, g - 8, g - 20, 0.14 + r() * 0.12]; });
  }), quality);
}

/**
 * Talavera-style tiles: muted cobalt and ochre on cream, exactly 4×4 tiles per
 * texture (tilePanel fits whole tiles to panels). Each tile's glaze is a touch
 * different, as hand-made tiles are.
 */
function talaveraTexture(quality: Quality): THREE.CanvasTexture | null {
  const S = 256 * SCALE[quality], s = S / 4, k = s / 64;
  return q(tex(`talavera${S}-${quality}`, S, S, (c) => {
    const r = rng(31);
    for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
      const x = tx * s, y = ty * s, v = Math.floor((r() - 0.5) * 10);
      c.fillStyle = `rgb(${240 + v},${231 + v},${211 + v})`; c.fillRect(x, y, s, s);
      c.strokeStyle = '#cdbfa3'; c.lineWidth = 3 * k; c.strokeRect(x + 1.5 * k, y + 1.5 * k, s - 3 * k, s - 3 * k);
      const cx = x + s / 2, cy = y + s / 2;
      const blue = `rgb(${76 + v},${102 + v},${158 + v})`;
      c.fillStyle = blue;
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4;
        c.beginPath(); c.ellipse(cx + Math.cos(a) * 13 * k, cy + Math.sin(a) * 13 * k, 11 * k, 5 * k, a, 0, Math.PI * 2); c.fill();
      }
      c.fillStyle = '#d6a44c'; c.beginPath(); c.arc(cx, cy, 6 * k, 0, Math.PI * 2); c.fill();
      c.fillStyle = blue;
      for (const [qx, qy] of [[x, y], [x + s, y], [x, y + s], [x + s, y + s]] as const) { c.beginPath(); c.arc(qx, qy, 9 * k, 0, Math.PI * 2); c.fill(); }
    }
  }), quality);
}

/**
 * Louvered shutter slats (1 texture = 0.6 m), white so the shutter colour
 * tints them: each slat a soft light-to-shade gradient rather than hard 2 px
 * lines. No frame border: UVs are world-scale, so a border landed mid-shutter.
 */
function louverTexture(quality: Quality): THREE.CanvasTexture | null {
  const W = 64 * SCALE[quality], H = 128 * SCALE[quality], n = 12, p = H / n;
  return q(tex(`louver${H}-${quality}`, W, H, (c) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);
    for (let i = 0; i < n; i++) {
      const y = i * p, g = c.createLinearGradient(0, y, 0, y + p);
      g.addColorStop(0, 'rgba(60,40,30,0)'); g.addColorStop(0.55, 'rgba(60,40,30,0.08)');
      g.addColorStop(0.8, 'rgba(60,40,30,0.42)'); g.addColorStop(1, 'rgba(60,40,30,0.2)');
      c.fillStyle = g; c.fillRect(0, y, W, p);
    }
  }), quality);
}

/** Window glass: deep interior with a muntin cross and a soft sky reflection. */
function glassTexture(quality: Quality): THREE.CanvasTexture | null {
  const k = SCALE[quality], W = 128 * k, H = 160 * k;
  return q(tex(`glass${W}-${quality}`, W, H, (c) => {
    const g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#6b5a86'); g.addColorStop(0.45, '#2c2140'); g.addColorStop(1, '#1d1530');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,230,200,0.12)';
    c.beginPath(); c.moveTo(10 * k, 0); c.lineTo(52 * k, 0); c.lineTo(14 * k, H); c.lineTo(0, H); c.closePath(); c.fill();
    c.fillStyle = '#f1e2c4';
    c.fillRect(60 * k, 0, 8 * k, H); c.fillRect(0, 74 * k, W, 8 * k);
  }), quality);
}

/**
 * Door wood (1 texture = 0.6 m): vertical grain in soft bands a few
 * centimetres wide, gently wavy, near-white so the material colour carries
 * the hue. No 1 px lines (the production wood read as stripes at 4+ m).
 */
function woodTexture(quality: Quality): THREE.CanvasTexture | null {
  const S = 128 * SCALE[quality], k = S / 128;
  return q(tex(`wood${S}-${quality}`, S, S, (c) => {
    const r = rng(53);
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, S, S);
    const band = (x0: number, w: number, a: number, dark: boolean, amp: number, waves: number, ph: number) => {
      c.fillStyle = dark ? `rgba(92,56,32,${a})` : `rgba(255,246,228,${a})`;
      for (const ox of [-S, 0, S]) {
        c.beginPath();
        for (let y = 0; y <= S; y += 4 * k) c.lineTo(ox + x0 + Math.sin((y / S) * Math.PI * 2 * waves + ph) * amp, y);
        for (let y = S; y >= 0; y -= 4 * k) c.lineTo(ox + x0 + w + Math.sin((y / S) * Math.PI * 2 * waves + ph + 0.4) * amp, y);
        c.closePath(); c.fill();
      }
    };
    for (let i = 0; i < 9; i++) band(r() * S, (6 + r() * 14) * k, 0.08 + r() * 0.07, true, (1.5 + r() * 3) * k, 1 + Math.floor(r() * 2), r() * 6);
    for (let i = 0; i < 5; i++) band(r() * S, (3 + r() * 4) * k, 0.1 + r() * 0.06, true, (1 + r() * 2) * k, 1, r() * 6);
    for (let i = 0; i < 4; i++) band(r() * S, (8 + r() * 10) * k, 0.12, false, 2 * k, 1, r() * 6);
  }), quality);
}

/** Large rectangular pavers in running bond, warm grey-beige (1 texture = 2.4 m). */
function paverTexture(quality: Quality): THREE.CanvasTexture | null {
  const S = 256 * SCALE[quality], k = S / 256;
  return q(tex(`pavers${S}-${quality}`, S, S, (c) => {
    const r = rng(41);
    c.fillStyle = '#b7a68a'; c.fillRect(0, 0, S, S);
    const rowH = 64 * k, bw = 96 * k, gap = 3 * k;
    for (let row = 0; row < 4; row++) {
      const off = row % 2 ? 48 * k : 0;
      for (let x = -bw + off; x < S; x += bw) {
        const g = 206 + Math.floor(r() * 22);
        c.fillStyle = `rgb(${g},${g - 10},${g - 25})`;
        c.fillRect(x + gap, row * rowH + gap, bw - 2 * gap, rowH - 2 * gap);
      }
    }
    mottle(c, S, 42, 40, 8 * k, 24 * k, (rr) => [120, 100, 80, 0.05 + rr() * 0.06]);
  }), quality);
}

// ------------------------------------------------------------------ paving
/**
 * The arena floor: square barro (terracotta) tiles about 0.68 m across, 8×8
 * per texture, repeated over the ground plane. Grout is a darker terracotta
 * rather than cream, tiles vary gently in tone, a few are sun-faded and worn
 * pale in the middle, and a broad mottle across the texture breaks up the
 * repeat. Kept mid-value and below the players' marigold in saturation.
 */
const GROUND_TILES = 8, GROUND_TILE_M = 0.675; // texture period 5.4 m
function pavingTexture(quality: Quality): THREE.CanvasTexture | null {
  const S = quality === 'low' ? 256 : 512, t = S / GROUND_TILES, k = S / 512;
  return q(tex(`paving${S}-${quality}`, S, S, (c) => {
    const r = rng(77);
    c.fillStyle = '#8a5e50'; c.fillRect(0, 0, S, S); // grout
    const gw = Math.max(2, Math.round(4 * k)), inset = gw / 2;
    for (let ty = 0; ty < GROUND_TILES; ty++) for (let tx = 0; tx < GROUND_TILES; tx++) {
      const x = tx * t + inset, y = ty * t + inset, w = t - gw;
      const v = (r() - 0.5) * 16, warm = (r() - 0.5) * 10;
      const worn = r() < 0.09;
      let R = 174 + v + warm, G = 112 + v * 0.8, B = 92 + v * 0.7 - warm * 0.4;
      if (worn) { R += 14; G += 22; B += 22; }
      c.fillStyle = `rgb(${R | 0},${G | 0},${B | 0})`;
      c.fillRect(x, y, w, w);
      // A soft hand-made dish: a touch lighter in the middle, darker at the rim.
      const d = c.createRadialGradient(x + w * (0.4 + r() * 0.2), y + w * (0.4 + r() * 0.2), w * 0.1, x + w / 2, y + w / 2, w * 0.75);
      d.addColorStop(0, worn ? 'rgba(236,206,182,0.32)' : 'rgba(230,180,150,0.10)');
      d.addColorStop(1, 'rgba(110,60,44,0.12)');
      c.fillStyle = d; c.fillRect(x, y, w, w);
    }
    // Broad, faint wear and dust across many tiles.
    mottle(c, S, 78, 18, 50 * k, 120 * k, (rr) => (rr() < 0.5 ? [214, 170, 140, 0.08 + rr() * 0.06] : [110, 64, 48, 0.06 + rr() * 0.05]));
  }), quality);
}

export type Kind = 'plaster' | 'cantera' | 'flat' | 'detail' | 'louver' | 'talavera' | 'glass' | 'wood' | 'lamp' | 'pavers' | 'leaf';
export interface Mat { k: Kind; c: number | null }
export const TINTED: ReadonlySet<Kind> = new Set<Kind>(['plaster', 'cantera', 'flat', 'detail', 'louver', 'pavers', 'leaf']);

/**
 * Foliage ramp: the same three painted bands as the toon ramp, with the
 * shadow band lifted (120 → 150) so leaves in shade stay green rather than
 * olive-black, and double-sided cards turned from the sun keep some colour.
 */
let leafRampTex: THREE.DataTexture | null = null;
function leafRamp(): THREE.DataTexture {
  if (leafRampTex) return leafRampTex;
  const data = new Uint8Array([150, 150, 150, 255, 205, 205, 205, 255, 255, 255, 255, 255]);
  leafRampTex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  leafRampTex.minFilter = leafRampTex.magFilter = THREE.NearestFilter;
  leafRampTex.generateMipmaps = false;
  leafRampTex.needsUpdate = true;
  return leafRampTex;
}

/**
 * Shadow acne fix for toon materials. Toon shading still lights a face turned
 * away from the sun (the ramp's darkest band is about 47 %, not black), and
 * those same faces are what three.js draws into the shadow map (back faces by
 * default), so each one was shadow-tested against itself and flickered
 * between lit and shadowed in fine diagonal stripes. Such faces get no direct
 * sun, so skip the shadow test for them; faces lit by the sun keep their
 * shadows exactly as before. No change to the shadow map or its resolution.
 */
export function noBackfaceShadow<T extends THREE.Material>(m: T): T {
  m.onBeforeCompile = (sh) => {
    // Includes are still unexpanded here: patch the chunk's own text.
    const from = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ]';
    const chunk = THREE.ShaderChunk.lights_fragment_begin;
    if (!chunk.includes(from)) return; // three.js changed the chunk: leave the material as it was
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', chunk.replace(from,
      'directLight.color *= ( directLight.visible && receiveShadow && dot( geometryNormal, directLight.direction ) > 0.05 ) ? getShadow( directionalShadowMap[ i ]'));
  };
  m.customProgramCacheKey = () => 'no-backface-shadow';
  return m;
}

/** One material per kind for the kit's merged meshes. */
export function kitMaterials(quality: Quality): Record<Kind, THREE.Material> {
  const ramp = toonRamp();
  const toonOf = (opts: THREE.MeshToonMaterialParameters) => noBackfaceShadow(new THREE.MeshToonMaterial({ gradientMap: ramp, ...opts }));
  return {
    plaster: toonOf({ vertexColors: true, map: plasterTexture(quality) }),
    cantera: toonOf({ vertexColors: true, map: canteraTexture(quality) }),
    flat: toonOf({ vertexColors: true }),
    detail: toonOf({ vertexColors: true }),
    louver: toonOf({ vertexColors: true, map: louverTexture(quality) }),
    talavera: toonOf({ map: talaveraTexture(quality) }),
    glass: toonOf({ map: glassTexture(quality) }),
    // Honey-toned wood: the darker brown hid a Luna player's dark skirt against the café door.
    wood: toonOf({ color: 0xb8875a, map: woodTexture(quality) }),
    lamp: toonOf({ color: 0xffe3a0, emissive: 0xc88a2a }),
    pavers: toonOf({ vertexColors: true, map: paverTexture(quality), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    leaf: toonOf({ vertexColors: true, side: THREE.DoubleSide, gradientMap: leafRamp() }),
  };
}

/**
 * The arena floor on El Patio: repeating terracotta paving. The ground plane's
 * UVs run 0..1 over the whole of decor.ground (El Patio: 54 × 38 m), so the
 * repeat lives on the texture.
 */
export function patioGroundTexture(quality: Quality, ground: { w: number; d: number } = { w: 54, d: 38 }): THREE.Texture | null {
  const t = pavingTexture(quality);
  const period = GROUND_TILES * GROUND_TILE_M;
  if (t) t.repeat.set(ground.w / period, ground.d / period);
  return t;
}

/**
 * Optional (world.ts decides): the whole arena floor as one mesh's geometry and
 * material, with the map's zones painted into vertex colours over the same
 * repeating paving, so the floor keeps production's layout cues without a
 * map-sized canvas: dustier, greyer clay in the streets, the warm plaza in the
 * middle, a sand-toned court at Sol's spawn and a cool grey one at Luna's,
 * and a faint darkening toward the arena edge.
 * One vertex every two tiles (~1.2k vertices, 2.2k triangles on El Patio), same single draw call.
 * Zones follow El Patio's map (production groundTexture); other maps get the
 * edge darkening only.
 */
export function patioGround(quality: Quality, ground: { w: number; d: number } = { w: 54, d: 38 }, zones = true): { geometry: THREE.BufferGeometry; material: THREE.MeshToonMaterial } {
  const seg = GROUND_TILE_M * 2, nx = Math.max(1, Math.round(ground.w / seg)), nz = Math.max(1, Math.round(ground.d / seg));
  const geometry = new THREE.PlaneGeometry(ground.w, ground.d, nx, nz);
  geometry.rotateX(-Math.PI / 2); // lies in XZ; the caller must not rotate it again
  const p = geometry.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  // Linear-space multipliers on the terracotta paving (tile ≈ sRGB 174,112,92); >1 is fine in a float attribute.
  const PLAZA = [1, 1, 1], STREET = [0.78, 1.3, 1.45], SOL = [1.05, 1.32, 1.12], LUNA = [0.55, 1.4, 1.9];
  const inBox = (x: number, z: number, x0: number, z0: number, x1: number, z1: number) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    let m = PLAZA;
    if (zones) {
      if (inBox(x, z, -26, -6.4, -21, 6.4)) m = SOL;
      else if (inBox(x, z, 21, -6.4, 26, 6.4)) m = LUNA;
      else if (!inBox(x, z, -17, -8, 17, 8)) m = STREET;
    }
    const e = Math.min(1, Math.max(0, (Math.hypot(x / (ground.w / 2), z / (ground.d / 2)) - 0.55) / 0.6));
    const dim = 1 - 0.14 * e;
    col[i * 3] = m[0]! * dim; col[i * 3 + 1] = m[1]! * dim; col[i * 3 + 2] = m[2]! * dim;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const material = new THREE.MeshToonMaterial({ gradientMap: toonRamp(), map: patioGroundTexture(quality, ground), vertexColors: true });
  return { geometry, material };
}

/**
 * El Patio's light, adjusted from its theme. A slightly stronger, warmer sun
 * and a slightly weaker, less orange sky fill give facades clearer lit/shade
 * separation; a lighter, warmer ground bounce keeps faces in shade readable.
 */
export interface PatioLight { hemi: [number, number, number]; sun: [number, number] } // fog stays the theme's (the engine sets it)
export function patioLight(base: PatioLight): PatioLight {
  const mix = (a: number, b: number, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
  return {
    hemi: [mix(base.hemi[0], 0xf2e2d6, 0.35), mix(base.hemi[1], 0xb07a5c, 0.3), base.hemi[2] * 0.9],
    sun: [mix(base.sun[0], 0xffbe84, 0.4), base.sun[1] * 1.1],
  };
}
