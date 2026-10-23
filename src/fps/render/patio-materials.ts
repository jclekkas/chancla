// El Patio kit: textures, paving and the materials the kit's meshes use
// (one material per kind; tints go into vertex colours). Geometry and
// placement live in section.ts; this file owns how surfaces look.
import * as THREE from 'three';
import { groundTexture, toonRamp, woodTexture } from './materials';
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

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Soft circles that wrap at the edges, so the texture tiles without seams. */
function mottle(c: CanvasRenderingContext2D, size: number, seed: number, count: number, r0: number, r1: number, shade: (r: () => number) => string): void {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = r() * size, y = r() * size, rad = r0 + r() * (r1 - r0), col = shade(r);
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      const cx = x + ox, cy = y + oy;
      if (cx + rad < 0 || cx - rad > size || cy + rad < 0 || cy - rad > size) continue;
      const g = c.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, col); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }
  }
}

/** Lime plaster: broad, faint clouding only. Fine streaks shimmered at a distance (1 tile = 2 m). */
function plasterTexture(): THREE.CanvasTexture | null {
  return tex('plaster', 256, 256, (c) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, 256, 256);
    mottle(c, 256, 11, 70, 24, 70, (r) => { const g = 228 + Math.floor(r() * 18); return `rgba(${g},${g - 4},${g - 12},${0.1 + r() * 0.1})`; });
  });
}

/** Cantera stone: soft, low-contrast speckle for steps, caps and the threshold (no pixel grain). */
function canteraTexture(): THREE.CanvasTexture | null {
  return tex('cantera', 128, 128, (c) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, 128, 128);
    mottle(c, 128, 23, 90, 3, 9, (r) => { const g = 218 + Math.floor(r() * 26); return `rgba(${g},${g - 8},${g - 20},${0.18 + r() * 0.14})`; });
  });
}

/** Talavera-style tiles: muted cobalt and ochre on cream, 4×4 tiles per texture. Placed with whole tiles per panel (see tilePanel). */
function talaveraTexture(): THREE.CanvasTexture | null {
  return tex('talavera', 256, 256, (c) => {
    const s = 64;
    for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
      const x = tx * s, y = ty * s;
      c.fillStyle = '#f2e8d4'; c.fillRect(x, y, s, s);
      c.strokeStyle = '#d2c3a6'; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, s - 2, s - 2);
      const cx = x + s / 2, cy = y + s / 2;
      c.fillStyle = '#4f6aa3';
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + Math.PI / 4;
        c.beginPath(); c.ellipse(cx + Math.cos(a) * 13, cy + Math.sin(a) * 13, 11, 5, a, 0, Math.PI * 2); c.fill();
      }
      c.fillStyle = '#d9a648'; c.beginPath(); c.arc(cx, cy, 6, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#4f6aa3';
      for (const [qx, qy] of [[x, y], [x + s, y], [x, y + s], [x + s, y + s]] as const) { c.beginPath(); c.arc(qx, qy, 9, 0, Math.PI * 2); c.fill(); }
    }
  });
}

/** Louvered shutter slats, white so the shutter colour tints them. */
function louverTexture(): THREE.CanvasTexture | null {
  return tex('louver', 64, 128, (c) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, 64, 128);
    for (let y = 6; y < 122; y += 9) {
      c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(6, y + 5, 52, 3);
      c.fillStyle = 'rgba(255,255,255,0.9)'; c.fillRect(6, y, 52, 2);
    }
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 4; c.strokeRect(2, 2, 60, 124);
  });
}

/** Window glass: deep interior with a muntin cross and a soft sky reflection. */
function glassTexture(): THREE.CanvasTexture | null {
  return tex('glass', 128, 160, (c) => {
    const g = c.createLinearGradient(0, 0, 128, 160);
    g.addColorStop(0, '#6b5a86'); g.addColorStop(0.45, '#2c2140'); g.addColorStop(1, '#1d1530');
    c.fillStyle = g; c.fillRect(0, 0, 128, 160);
    c.fillStyle = 'rgba(255,230,200,0.12)';
    c.beginPath(); c.moveTo(10, 0); c.lineTo(52, 0); c.lineTo(14, 160); c.lineTo(0, 160); c.closePath(); c.fill();
    c.fillStyle = '#f1e2c4';
    c.fillRect(60, 0, 8, 160); c.fillRect(0, 74, 128, 8);
  });
}

/** Large rectangular pavers in running bond, warm grey-beige (1 texture = 2.4 m). */
function paverTexture(): THREE.CanvasTexture | null {
  return tex('pavers', 256, 256, (c) => {
    const r = rng(41);
    c.fillStyle = '#b9a88c'; c.fillRect(0, 0, 256, 256);
    const rowH = 64;
    for (let row = 0; row < 4; row++) {
      const off = row % 2 ? 48 : 0;
      for (let x = -96 + off; x < 256; x += 96) {
        const g = 206 + Math.floor(r() * 26);
        c.fillStyle = `rgb(${g},${g - 10},${g - 26})`;
        c.fillRect(x + 3, row * rowH + 3, 90, rowH - 6);
        for (let i = 0; i < 25; i++) { c.fillStyle = `rgba(120,100,80,${0.05 + r() * 0.08})`; c.fillRect(x + 3 + r() * 88, row * rowH + 3 + r() * 56, 2 + r() * 6, 1 + r() * 3); }
      }
    }
  });
}


export type Kind = 'plaster' | 'cantera' | 'flat' | 'detail' | 'louver' | 'talavera' | 'glass' | 'wood' | 'lamp' | 'pavers' | 'leaf';
export interface Mat { k: Kind; c: number | null }
export const TINTED: ReadonlySet<Kind> = new Set<Kind>(['plaster', 'cantera', 'flat', 'detail', 'louver', 'pavers', 'leaf']);

/** One material per kind for the kit's merged meshes. */
export function kitMaterials(quality: Quality): Record<Kind, THREE.Material> {
  void quality;
  const ramp = toonRamp();
  const toonOf = (opts: THREE.MeshToonMaterialParameters) => new THREE.MeshToonMaterial({ gradientMap: ramp, ...opts });
  return {
    plaster: toonOf({ vertexColors: true, map: plasterTexture() }),
    cantera: toonOf({ vertexColors: true, map: canteraTexture() }),
    flat: toonOf({ vertexColors: true }),
    detail: toonOf({ vertexColors: true }),
    louver: toonOf({ vertexColors: true, map: louverTexture() }),
    talavera: toonOf({ map: talaveraTexture() }),
    glass: toonOf({ map: glassTexture() }),
    wood: toonOf({ color: 0x9a6440, map: woodTexture() }),
    lamp: toonOf({ color: 0xffe3a0, emissive: 0xc88a2a }),
    pavers: toonOf({ vertexColors: true, map: paverTexture(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    leaf: toonOf({ vertexColors: true, side: THREE.DoubleSide }),
  };
}

/** The arena floor on El Patio (the production texture until the paving pass replaces it). */
export function patioGroundTexture(quality: Quality): THREE.Texture | null {
  return groundTexture(quality === 'high' ? 40 : quality === 'medium' ? 28 : 18);
}

/** El Patio's light, adjusted from its theme (identity until the lighting pass). */
export interface PatioLight { hemi: [number, number, number]; sun: [number, number] } // fog stays the theme's (the engine sets it)
export function patioLight(base: PatioLight): PatioLight { return base; }
