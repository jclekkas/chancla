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
import { EL_PATIO } from '../../../shared/map';

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
 * Lime plaster (1 texture = 2 m): broad clouding at two scales, a few warm
 * and cool washes (lime dries unevenly), soft trowel sweeps and a handful of
 * paler patched repairs. All soft-edged and within a few per cent of white,
 * so the wall colour stays the wall colour. No streaks, cracks or base grime
 * (the texture repeats every 2 m vertically, so a base band would repeat up
 * the wall).
 */
function plasterTexture(quality: Quality): THREE.CanvasTexture | null {
  const S = 256 * SCALE[quality], k = S / 256;
  return q(tex(`plaster${S}-${quality}`, S, S, (c) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, S, S);
    mottle(c, S, 11, 26, 60 * k, 110 * k, (r) => { const g = 214 + Math.floor(r() * 22); return [g, g - 8, g - 20, 0.16 + r() * 0.14]; });
    // Warm and cool washes: the lime's own unevenness, a hue shift more than a value one.
    mottle(c, S, 13, 8, 70 * k, 120 * k, (r) => (r() < 0.5 ? [232, 206, 178, 0.14 + r() * 0.08] : [200, 208, 220, 0.12 + r() * 0.08]));
    mottle(c, S, 12, 60, 18 * k, 46 * k, (r) => { const g = 214 + Math.floor(r() * 26); return [g, g - 7, g - 17, 0.12 + r() * 0.1]; });
    // Trowel sweeps: long, soft, faint arcs (wrapped so the texture still tiles).
    const r = rng(14);
    for (let i = 0; i < 14; i++) {
      const x = r() * S, y = r() * S, len = (40 + r() * 50) * k, w = (6 + r() * 6) * k, a = (r() - 0.5) * 0.9;
      const light = r() < 0.5, al = 0.07 + r() * 0.05;
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        const cx = x + ox, cy = y + oy;
        if (cx + len < 0 || cx - len > S || cy + len < 0 || cy - len > S) continue;
        c.save(); c.translate(cx, cy); c.rotate(a); c.scale(1, w / len);
        const g = c.createRadialGradient(0, 0, 0, 0, 0, len);
        const col = light ? '255,252,244' : '196,180,160';
        g.addColorStop(0, `rgba(${col},${al})`); g.addColorStop(1, `rgba(${col},0)`);
        c.fillStyle = g; c.fillRect(-len, -len, len * 2, len * 2);
        c.restore();
      }
    }
    // Patched repairs: a few paler, slightly cleaner soft rectangles.
    for (let i = 0; i < 3; i++) {
      const x = r() * S, y = r() * S, w = (26 + r() * 30) * k, h = (18 + r() * 22) * k;
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        const cx = x + ox, cy = y + oy;
        if (cx + w < 0 || cx > S || cy + h < 0 || cy > S) continue;
        c.fillStyle = 'rgba(255,253,248,0.1)';
        c.beginPath(); c.roundRect(cx, cy, w, h, 8 * k); c.fill();
        c.strokeStyle = 'rgba(170,150,128,0.06)'; c.lineWidth = 4 * k; c.stroke();
      }
    }
  }), quality);
}

/**
 * Cantera stone: soft clouding, faint sedimentary banding along the bed and
 * scattered small pores, all low-contrast (steps, caps, sills, the threshold).
 */
function canteraTexture(quality: Quality): THREE.CanvasTexture | null {
  const S = 128 * SCALE[quality], k = S / 128;
  return q(tex(`cantera${S}-${quality}`, S, S, (c) => {
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, S, S);
    mottle(c, S, 22, 10, 30 * k, 56 * k, (r) => { const g = 222 + Math.floor(r() * 16); return [g, g - 9, g - 22, 0.12 + r() * 0.08]; });
    // Bedding: a few soft horizontal bands, gently wavy, wrapping in x.
    const r = rng(24);
    for (let i = 0; i < 5; i++) {
      const y0 = r() * S, h = (5 + r() * 9) * k, amp = (2 + r() * 3) * k, ph = r() * 6, dark = r() < 0.6;
      c.fillStyle = dark ? `rgba(150,112,76,${0.07 + r() * 0.05})` : `rgba(255,246,226,${0.12 + r() * 0.06})`;
      for (const oy of [-S, 0, S]) {
        c.beginPath();
        for (let x = 0; x <= S; x += 4 * k) c.lineTo(x, oy + y0 + Math.sin((x / S) * Math.PI * 2 + ph) * amp);
        for (let x = S; x >= 0; x -= 4 * k) c.lineTo(x, oy + y0 + h + Math.sin((x / S) * Math.PI * 2 + ph + 0.7) * amp);
        c.closePath(); c.fill();
      }
    }
    mottle(c, S, 23, 70, 4 * k, 10 * k, (rr) => { const g = 214 + Math.floor(rr() * 26); return [g, g - 9, g - 22, 0.14 + rr() * 0.12]; });
    // Pores: small, soft and sparse (about 2 cm at the stone's scale).
    mottle(c, S, 25, 26, 2.2 * k, 3.2 * k, () => [120, 92, 66, 0.28]);
  }), quality);
}

/**
 * Talavera-style tiles: muted cobalt and ochre on cream, exactly 4×4 tiles per
 * texture (tilePanel fits whole tiles to panels). Each tile's glaze is a touch
 * different, as hand-made tiles are: a soft sheen toward one corner, a glaze
 * that pools a little darker at the rim, the cobalt brushed with a deeper
 * edge. The grout stays a mid warm grey, never a bright grid.
 */
function talaveraTexture(quality: Quality): THREE.CanvasTexture | null {
  const S = 256 * SCALE[quality], s = S / 4, k = s / 64;
  return q(tex(`talavera${S}-${quality}`, S, S, (c) => {
    const r = rng(31);
    c.fillStyle = '#b9ab90'; c.fillRect(0, 0, S, S); // grout
    for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
      const x = tx * s, y = ty * s, v = Math.floor((r() - 0.5) * 12), g0 = 2 * k;
      c.fillStyle = `rgb(${238 + v},${228 + v},${206 + v})`; c.fillRect(x + g0, y + g0, s - 2 * g0, s - 2 * g0);
      const cx = x + s / 2, cy = y + s / 2;
      const blue = `rgb(${72 + v},${98 + v},${156 + v})`, deep = `rgb(${50 + v},${70 + v},${126 + v})`;
      c.lineWidth = 2 * k; c.strokeStyle = deep;
      c.fillStyle = blue;
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4;
        c.beginPath(); c.ellipse(cx + Math.cos(a) * 13 * k, cy + Math.sin(a) * 13 * k, 11 * k, 5 * k, a, 0, Math.PI * 2); c.fill(); c.stroke();
      }
      c.fillStyle = '#d6a44c'; c.beginPath(); c.arc(cx, cy, 6 * k, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(150,104,40,0.7)'; c.stroke();
      c.fillStyle = blue; c.strokeStyle = deep;
      for (const [qx, qy] of [[x, y], [x + s, y], [x, y + s], [x + s, y + s]] as const) {
        c.save(); c.beginPath(); c.rect(x + g0, y + g0, s - 2 * g0, s - 2 * g0); c.clip();
        c.beginPath(); c.arc(qx, qy, 9 * k, 0, Math.PI * 2); c.fill(); c.stroke();
        c.restore();
      }
      // Glaze: a soft sheen toward the upper left, pooling darker at the rim.
      const hx = x + s * (0.3 + r() * 0.15), hy = y + s * (0.3 + r() * 0.15);
      const gl = c.createRadialGradient(hx, hy, 2 * k, x + s / 2, y + s / 2, s * 0.72);
      gl.addColorStop(0, 'rgba(255,252,240,0.2)'); gl.addColorStop(0.55, 'rgba(255,252,240,0)'); gl.addColorStop(1, 'rgba(120,96,64,0.16)');
      c.fillStyle = gl; c.fillRect(x + g0, y + g0, s - 2 * g0, s - 2 * g0);
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
      // Lit top edge of each slat, its face, then the shadow the slat above casts on it.
      g.addColorStop(0, 'rgba(255,250,236,0.22)'); g.addColorStop(0.18, 'rgba(60,40,30,0)'); g.addColorStop(0.55, 'rgba(60,40,30,0.1)');
      g.addColorStop(0.8, 'rgba(60,40,30,0.46)'); g.addColorStop(1, 'rgba(60,40,30,0.24)');
      c.fillStyle = g; c.fillRect(0, y, W, p);
    }
  }), quality);
}

/**
 * A window, fitted to the opening (UVs 0..1 across each window): a painted
 * wooden casement frame with a centre stile and a transom, the panes a deep
 * interior with a soft sky reflection, and the reveal's shadow on it: darker
 * under the lintel and along one jamb, so the glass reads set back in a
 * thick wall rather than painted on it.
 */
function glassTexture(quality: Quality): THREE.CanvasTexture | null {
  const k = SCALE[quality], W = 128 * k, H = 160 * k;
  return q(tex(`glass2-${W}-${quality}`, W, H, (c) => {
    // Canvas y runs down; the window's top (v = 1) is the canvas's top row.
    const g = c.createLinearGradient(0, 0, W * 0.4, H);
    g.addColorStop(0, '#2a2038'); g.addColorStop(0.5, '#3a2d4e'); g.addColorStop(1, '#4a3c5c');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // Sky reflection: one soft diagonal sheen.
    const sh = c.createLinearGradient(0, H * 0.2, W, H * 0.6);
    sh.addColorStop(0.15, 'rgba(255,226,196,0)'); sh.addColorStop(0.35, 'rgba(255,226,196,0.14)'); sh.addColorStop(0.55, 'rgba(255,226,196,0)');
    c.fillStyle = sh; c.fillRect(0, 0, W, H);
    // Frame: outer border, centre stile, transom (painted wood, a warm cream).
    const fw = 9 * k, st = 7 * k, ty = H * 0.3;
    c.fillStyle = '#e8d6b4';
    c.fillRect(0, 0, W, fw); c.fillRect(0, H - fw, W, fw); c.fillRect(0, 0, fw, H); c.fillRect(W - fw, 0, fw, H);
    c.fillRect(W / 2 - st / 2, ty, st, H - ty); c.fillRect(0, ty - st / 2, W, st);
    // Thin glazing bars in the lower lights.
    c.fillRect(W * 0.25 - 2 * k, ty, 4 * k, H - ty); c.fillRect(W * 0.75 - 2 * k, ty, 4 * k, H - ty);
    c.fillRect(0, ty + (H - ty) / 2 - 2 * k, W, 4 * k);
    // The frame's inner edge a step darker (a rebate), the panes' edges darker still.
    c.strokeStyle = 'rgba(40,28,36,0.35)'; c.lineWidth = 2 * k; c.strokeRect(fw, fw, W - 2 * fw, H - 2 * fw);
    // The reveal's shadow: down from the lintel, and in from one jamb.
    const top = c.createLinearGradient(0, 0, 0, H * 0.36);
    top.addColorStop(0, 'rgba(20,12,24,0.55)'); top.addColorStop(1, 'rgba(20,12,24,0)');
    c.fillStyle = top; c.fillRect(0, 0, W, H * 0.36);
    const side = c.createLinearGradient(0, 0, W * 0.2, 0);
    side.addColorStop(0, 'rgba(20,12,24,0.4)'); side.addColorStop(1, 'rgba(20,12,24,0)');
    c.fillStyle = side; c.fillRect(0, 0, W * 0.2, H);
  }), quality);
}

/**
 * Door wood (1 texture = 0.6 m): vertical grain in soft bands a few
 * centimetres wide, gently wavy, near-white so the material colour carries
 * the hue; over them, finer grain lines (2 px soft strokes, never 1 px: the
 * production wood read as stripes at 4+ m) that bend round a small knot.
 */
function woodTexture(quality: Quality): THREE.CanvasTexture | null {
  const S = 128 * SCALE[quality], k = S / 128;
  return q(tex(`wood${S}-${quality}`, S, S, (c) => {
    const r = rng(53);
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, S, S);
    const knot = { x: S * 0.68, y: S * 0.3, r: 5 * k };
    /** x offset of the grain at (x0, y): a wave plus the bend round the knot. */
    const bend = (x0: number, y: number) => {
      const dy = (y - knot.y) / (knot.r * 3.2), dx = x0 - knot.x;
      return Math.exp(-dy * dy) * Math.sign(dx || 1) * Math.max(0, knot.r * 2.4 - Math.abs(dx)) * 0.7;
    };
    const band = (x0: number, w: number, a: number, dark: boolean, amp: number, waves: number, ph: number) => {
      c.fillStyle = dark ? `rgba(92,56,32,${a})` : `rgba(255,246,228,${a})`;
      for (const ox of [-S, 0, S]) {
        c.beginPath();
        for (let y = 0; y <= S; y += 4 * k) c.lineTo(ox + x0 + Math.sin((y / S) * Math.PI * 2 * waves + ph) * amp + bend(x0, y), y);
        for (let y = S; y >= 0; y -= 4 * k) c.lineTo(ox + x0 + w + Math.sin((y / S) * Math.PI * 2 * waves + ph + 0.4) * amp + bend(x0 + w, y), y);
        c.closePath(); c.fill();
      }
    };
    for (let i = 0; i < 9; i++) band(r() * S, (6 + r() * 14) * k, 0.09 + r() * 0.08, true, (1.5 + r() * 3) * k, 1 + Math.floor(r() * 2), r() * 6);
    for (let i = 0; i < 5; i++) band(r() * S, (3 + r() * 4) * k, 0.1 + r() * 0.07, true, (1 + r() * 2) * k, 1, r() * 6);
    for (let i = 0; i < 4; i++) band(r() * S, (8 + r() * 10) * k, 0.12, false, 2 * k, 1, r() * 6);
    // Fine grain: thin soft strokes (2 px at full size), faint.
    c.lineWidth = Math.max(1, 2 * k); c.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const x0 = r() * S, amp = (1 + r() * 2.5) * k, ph = r() * 6, waves = 1 + Math.floor(r() * 2);
      c.strokeStyle = `rgba(84,50,28,${0.1 + r() * 0.08})`;
      for (const ox of [-S, 0, S]) {
        c.beginPath();
        for (let y = 0; y <= S; y += 4 * k) c.lineTo(ox + x0 + Math.sin((y / S) * Math.PI * 2 * waves + ph) * amp + bend(x0, y), y);
        c.stroke();
      }
    }
    // The knot: a soft dark eye with a lighter ring.
    const kg = c.createRadialGradient(knot.x, knot.y, 0, knot.x, knot.y, knot.r * 1.8);
    kg.addColorStop(0, 'rgba(80,44,22,0.42)'); kg.addColorStop(0.45, 'rgba(80,44,22,0.22)'); kg.addColorStop(0.7, 'rgba(255,240,214,0.12)'); kg.addColorStop(1, 'rgba(255,240,214,0)');
    c.fillStyle = kg; c.save(); c.translate(knot.x, knot.y); c.scale(0.7, 1.4); c.translate(-knot.x, -knot.y);
    c.fillRect(knot.x - knot.r * 2, knot.y - knot.r * 2, knot.r * 4, knot.r * 4); c.restore();
  }), quality);
}

/**
 * Sidewalk slabs of pale cantera (1 texture = 2.4 m) in courses of 0.6 m,
 * the slabs of uneven length (0.6 to 1.1 m) so no regular grid shows. Each
 * slab its own tone, a little warmer or cooler, worn rounder and darker at
 * its edges; the joints a dusty mid tone close to the stone, never a bright
 * line.
 */
function paverTexture(quality: Quality): THREE.CanvasTexture | null {
  const S = 256 * SCALE[quality], k = S / 256;
  return q(tex(`pavers${S}-${quality}`, S, S, (c) => {
    const r = rng(41);
    c.fillStyle = '#b3a386'; c.fillRect(0, 0, S, S); // joints: dust, a step below the stone
    const rowH = 64 * k, gap = 2.5 * k;
    for (let row = 0; row < 4; row++) {
      // Slabs of uneven length that sum to the texture's width, from a random start (wrapped).
      let x = r() * S;
      const end = x + S;
      while (x < end - 1) {
        let w = (64 + r() * 54) * k;
        if (end - x - w < 50 * k) w = end - x;
        const g = 196 + Math.floor(r() * 34), warm = (r() - 0.5) * 12;
        const py = row * rowH + gap, pw = w - 2 * gap, ph = rowH - 2 * gap;
        for (const ox of [-S, 0]) {
          const px = x + ox + gap;
          if (px > S || px + pw < 0) continue;
          c.fillStyle = `rgb(${(g + warm) | 0},${g - 9},${(g - 24 - warm * 0.6) | 0})`;
          c.beginPath(); c.roundRect(px, py, pw, ph, 3 * k); c.fill();
          // Worn edges: each stone a touch darker toward its rim, lighter where feet polish it.
          const d = c.createRadialGradient(px + pw * (0.35 + r() * 0.3), py + ph * 0.5, ph * 0.1, px + pw / 2, py + ph / 2, pw * 0.62);
          d.addColorStop(0, 'rgba(250,240,222,0.1)'); d.addColorStop(0.7, 'rgba(96,78,58,0.04)'); d.addColorStop(1, 'rgba(96,78,58,0.18)');
          c.fillStyle = d; c.beginPath(); c.roundRect(px, py, pw, ph, 3 * k); c.fill();
        }
        x += w;
      }
    }
    mottle(c, S, 42, 40, 8 * k, 24 * k, (rr) => [120, 100, 80, 0.05 + rr() * 0.06]);
    mottle(c, S, 44, 10, 40 * k, 80 * k, (rr) => (rr() < 0.5 ? [250, 240, 220, 0.06] : [110, 92, 70, 0.07])); // broad dust and polish
    mottle(c, S, 43, 40, 2.5 * k, 4 * k, () => [104, 88, 70, 0.2]); // sparse pits
  }), quality);
}

/**
 * Street flagstones (laja), 1 texture = 4 m: courses 0.25 to 0.45 m deep,
 * slabs 0.3 to 0.75 m long, each its own grey-beige (a few warmer, a few
 * darker), edges worn round and a shade darker, joints a muted dusty grey a
 * step below the stone (never a bright grid), and broad dust over it all.
 * Darker and greyer than the sidewalk cantera and the plaza's barro, so the
 * three floors read apart.
 */
const STREET_M = 4;
function streetTexture(quality: Quality): THREE.CanvasTexture | null {
  const S = quality === 'low' ? 256 : 512, k = S / 512;
  return q(tex(`street${S}-${quality}`, S, S, (c) => {
    const r = rng(91);
    c.fillStyle = 'rgb(118,110,100)'; c.fillRect(0, 0, S, S); // joints
    const gap = Math.max(1.5, 3 * k);
    let y0 = 0;
    while (y0 < S - 1) {
      let h = (32 + r() * 26) * k;
      if (S - y0 - h < 32 * k) h = S - y0;
      let x = r() * S;
      const end = x + S;
      while (x < end - 1) {
        let w = (38 + r() * 58) * k;
        if (end - x - w < 30 * k) w = end - x;
        const odd = r(), g = 150 + (r() - 0.5) * 36;
        const [R, G, B] = odd < 0.12 ? [g + 14, g, g - 18] : odd < 0.22 ? [g - 18, g - 18, g - 16] : [g + 4, g, g - 7 + (r() - 0.5) * 6];
        const pw = w - 2 * gap, ph = h - 2 * gap;
        const cx0 = x + pw * (0.3 + r() * 0.4), cy0 = y0 + gap + ph * (0.3 + r() * 0.4);
        for (const ox of [-S, 0]) {
          const px = x + ox + gap, py = y0 + gap;
          if (px > S || px + pw < 0) continue;
          c.fillStyle = `rgb(${R | 0},${G | 0},${B | 0})`;
          c.beginPath(); c.roundRect(px, py, pw, ph, 4 * k); c.fill();
          // Worn: a little polish where the slab is crossed most, darker and rounder at the rim.
          const d = c.createRadialGradient(cx0 + ox + gap, cy0, ph * 0.1, px + pw / 2, py + ph / 2, Math.max(pw, ph) * 0.62);
          d.addColorStop(0, 'rgba(230,224,210,0.1)'); d.addColorStop(0.65, 'rgba(60,54,46,0.03)'); d.addColorStop(1, 'rgba(60,54,46,0.2)');
          c.fillStyle = d; c.beginPath(); c.roundRect(px, py, pw, ph, 4 * k); c.fill();
        }
        x += w;
      }
      y0 += h;
    }
    mottle(c, S, 92, 50, 6 * k, 18 * k, (rr) => [90, 82, 72, 0.05 + rr() * 0.06]);
    mottle(c, S, 93, 14, 60 * k, 140 * k, (rr) => (rr() < 0.5 ? [196, 182, 160, 0.08 + rr() * 0.06] : [80, 74, 66, 0.06 + rr() * 0.05])); // dust and damp
    mottle(c, S, 94, 60, 2.5 * k, 4 * k, () => [70, 64, 58, 0.22]); // pits
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
    c.fillStyle = '#946454'; c.fillRect(0, 0, S, S); // grout: a step below the tiles, never a bright line
    const gw = Math.max(2, Math.round(4 * k)), inset = gw / 2;
    for (let ty = 0; ty < GROUND_TILES; ty++) for (let tx = 0; tx < GROUND_TILES; tx++) {
      const x = tx * t + inset, y = ty * t + inset, w = t - gw;
      const v = (r() - 0.5) * 24, warm = (r() - 0.5) * 12;
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
      // A soft bevel: the edge toward the light a little paler, the far edge a little deeper (about 4 cm).
      const e = Math.max(3, 6 * k), lit = c.createLinearGradient(x, y, x + e, y + e);
      lit.addColorStop(0, 'rgba(236,196,168,0.08)'); lit.addColorStop(1, 'rgba(236,196,168,0)');
      c.fillStyle = lit; c.fillRect(x, y, w - e, e); c.fillRect(x, y + e, e, w - 2 * e);
      const dk = c.createLinearGradient(x + w, y + w, x + w - e, y + w - e);
      dk.addColorStop(0, 'rgba(96,52,38,0.16)'); dk.addColorStop(1, 'rgba(96,52,38,0)');
      c.fillStyle = dk; c.fillRect(x + e, y + w - e, w - e, e); c.fillRect(x + w - e, y + e, e, w - 2 * e);
    }
    // Sparse pits and a little grit in the fired clay.
    mottle(c, S, 79, 90, 2.5 * k, 4.5 * k, (rr) => [112, 66, 50, 0.16 + rr() * 0.1]);
    // Broad, faint wear and dust across many tiles.
    mottle(c, S, 78, 18, 50 * k, 120 * k, (rr) => (rr() < 0.5 ? [214, 170, 140, 0.08 + rr() * 0.06] : [110, 64, 48, 0.06 + rr() * 0.05]));
  }), quality);
}

export type Kind = 'plaster' | 'cantera' | 'flat' | 'detail' | 'louver' | 'talavera' | 'glass' | 'wood' | 'lamp' | 'pavers' | 'leaf';
export interface Mat { k: Kind; c: number | null }
// Wood and glass carry vertex colours too (white unless tinted): the kit bakes doorway and window-reveal shading into them.
export const TINTED: ReadonlySet<Kind> = new Set<Kind>(['plaster', 'cantera', 'flat', 'detail', 'louver', 'pavers', 'leaf', 'wood', 'glass']);

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
 * Chains a shader patch onto a material: an earlier onBeforeCompile (and its
 * program cache key) is kept and runs first, so patches compose (the
 * backface-shadow fix, the plaster's macro variation, a later baked-light
 * pass) instead of replacing one another.
 */
export function patchShader<T extends THREE.Material>(m: T, key: string, fn: (sh: THREE.WebGLProgramParametersWithUniforms) => void): T {
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = function (sh, r) { prev.call(this, sh, r); fn(sh); };
  m.customProgramCacheKey = function () { return `${prevKey.call(this)}|${key}`; };
  return m;
}

/**
 * Plaster's broad tonal variation: the plaster texture sampled a second
 * time, rotated and about four times larger (its soft clouds become patches
 * a few metres across), as a gentle multiplier around 1. The UVs are world
 * scale, so neighbouring walls never repeat in step, and the 2 m repeat of
 * the texture itself no longer reads as a pattern. One extra texture read.
 */
function plasterMacro<T extends THREE.Material>(m: T, mean: number): T {
  return patchShader(m, `plaster-macro-${mean.toFixed(4)}`, (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
float gMacro = 1.0;
#ifdef USE_MAP
  {
    vec2 mu = mat2(0.80, -0.60, 0.60, 0.80) * vMapUv * 0.23 + vec2(0.37, 0.11);
    gMacro = texture2D(map, mu).g / ${mean.toFixed(4)};
    diffuseColor.rgb *= clamp(1.0 + (gMacro - 1.0) * 3.2, 0.82, 1.1);
  }
#endif`).replace('#include <opaque_fragment>', `{
  // In the toon ramp's shadow band the same albedo variation is only a few
  // levels of a dark colour and vanishes: there, the broad patches get more
  // contrast, centred on 1 so the shade as a whole is no lighter.
  float gAlb = max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
  float gLit = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)) / gAlb;
  float gShade = 1.0 - smoothstep(0.35, 1.3, gLit);
  outgoingLight *= mix(1.0, clamp(1.0 + (gMacro - 1.0) * 3.0, 0.8, 1.16), gShade);
}
#include <opaque_fragment>`);
  });
}

/** Mean of a texture canvas's green channel in linear terms (for normalising a texture used as a multiplier). */
function meanLinearG(t: THREE.CanvasTexture | null): number {
  const el = t?.image as HTMLCanvasElement | undefined, c = el?.getContext?.('2d');
  if (!el || !c) return 1;
  const d = c.getImageData(0, 0, el.width, el.height).data;
  let sum = 0;
  for (let i = 1; i < d.length; i += 4) { const v = d[i]! / 255; sum += v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  return sum / (d.length / 4) || 1;
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
  return patchShader(m, 'no-backface-shadow', (sh) => {
    // Includes are still unexpanded here: patch the chunk's own text.
    const from = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ]';
    const chunk = THREE.ShaderChunk.lights_fragment_begin;
    if (!chunk.includes(from)) return; // three.js changed the chunk: leave the material as it was
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', chunk.replace(from,
      'directLight.color *= ( directLight.visible && receiveShadow && dot( geometryNormal, directLight.direction ) > 0.05 ) ? getShadow( directionalShadowMap[ i ]'));
  });
}

/** One material per kind for the kit's merged meshes. */
export function kitMaterials(quality: Quality): Record<Kind, THREE.Material> {
  const ramp = toonRamp();
  const toonOf = (opts: THREE.MeshToonMaterialParameters) => noBackfaceShadow(new THREE.MeshToonMaterial({ gradientMap: ramp, ...opts }));
  return {
    plaster: plasterMacro(toonOf({ vertexColors: true, map: plasterTexture(quality) }), meanLinearG(plasterTexture(quality))),
    cantera: toonOf({ vertexColors: true, map: canteraTexture(quality) }),
    flat: toonOf({ vertexColors: true }),
    detail: toonOf({ vertexColors: true }),
    louver: toonOf({ vertexColors: true, map: louverTexture(quality) }),
    talavera: toonOf({ map: talaveraTexture(quality) }),
    glass: toonOf({ vertexColors: true, map: glassTexture(quality) }),
    // Honey-toned wood: the darker brown hid a Luna player's dark skirt against the café door.
    // Vertex colours are white wherever nothing bakes shading into them (every dressing's wood).
    wood: toonOf({ color: 0xb8875a, vertexColors: true, map: woodTexture(quality) }),
    // A lit lantern: the glow (emissive) carries it, the lit colour is kept low so the sun cannot wash it to white.
    lamp: toonOf({ color: 0x6a4a28, emissive: 0xffa63a, emissiveIntensity: 1.15 }),
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
 * Zones follow each map's layout (GROUND_ZONES; El Patio's match production's
 * groundTexture); a map without zones gets the edge darkening only.
 */
/** A map's floor zones: the spawn courts (minX, minZ, maxX, maxZ) and the open square; everything else is street. */
export interface GroundZones { sol: readonly number[]; luna: readonly number[]; plaza: readonly number[] }

/** Floor zones by arena map, following each layout (spawn courts, the central square, the lanes and walkways around it). */
export const GROUND_ZONES: Record<string, GroundZones> = {
  patio: { sol: [-26, -6.4, -21, 6.4], luna: [21, -6.4, 26, 6.4], plaza: [-17, -8, 17, 8] },
  // The market square inside the arcades; the arcade walkways and the outer lanes are street.
  plaza: { sol: [-30, -7.5, -23.6, 7.5], luna: [23.6, -7.5, 30, 7.5], plaza: [-23, -10, 23, 10] },
  // The party courtyard between the hedge lines; the two lanes beyond them are street.
  fiesta: { sol: [-21, -6.4, -15.8, 6.4], luna: [15.8, -6.4, 21, 6.4], plaza: [-15.8, -7, 15.8, 7] },
};

export function patioGround(quality: Quality, ground: { w: number; d: number } = { w: 54, d: 38 }, zones: boolean | GroundZones = true): { geometry: THREE.BufferGeometry; material: THREE.MeshToonMaterial } {
  const zn = zones === true ? GROUND_ZONES.patio! : zones || null;
  const seg = GROUND_TILE_M * 2, nx = Math.max(1, Math.round(ground.w / seg)), nz = Math.max(1, Math.round(ground.d / seg));
  const geometry = new THREE.PlaneGeometry(ground.w, ground.d, nx, nz);
  geometry.rotateX(-Math.PI / 2); // lies in XZ; the caller must not rotate it again
  const p = geometry.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  // Linear-space multipliers. The plaza and the courts are the terracotta
  // paving (tile ≈ sRGB 174,112,92), the courts tinted; the streets are the
  // flagstone texture (the shader picks it outside the zones), left near its
  // own colour.
  // Other maps (La Plaza, La Fiesta) keep the terracotta tinted grey in their streets, as before.
  const flags = zn === GROUND_ZONES.patio;
  const PLAZA = [1, 1, 1], STREET = flags ? [1, 1, 1] : [0.78, 1.3, 1.45], SOL = [1.05, 1.32, 1.12], LUNA = [0.55, 1.4, 1.9];
  const inBox = (x: number, z: number, x0: number, z0: number, x1: number, z1: number) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
  // El Patio's lanes: worn paler down the middle, dustier toward the walls (by distance to the nearest wall).
  const walls = zn === GROUND_ZONES.patio ? EL_PATIO.boxes.filter((b) => b.minY === 0 && b.maxY > 1.5) : [];
  const wallDist = (x: number, z: number) => {
    let d = 9;
    for (const b of walls) d = Math.min(d, Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ)));
    return d;
  };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    let m = PLAZA, street = false;
    if (zn) {
      const at = (r: readonly number[]) => inBox(x, z, r[0]!, r[1]!, r[2]!, r[3]!);
      if (at(zn.sol)) m = SOL;
      else if (at(zn.luna)) m = LUNA;
      else if (!at(zn.plaza)) { m = STREET; street = true; }
    }
    const e = Math.min(1, Math.max(0, (Math.hypot(x / (ground.w / 2), z / (ground.d / 2)) - 0.55) / 0.6));
    // Broad patches of dust and damp a few metres across, so the repeat never lines up.
    const n = 0.5 * Math.sin(x * 0.61 + z * 0.23) * Math.sin(z * 0.47 - x * 0.19 + 1.3) + 0.5 * Math.sin(x * 0.17 - z * 0.29 + 0.4);
    let dim = (1 - 0.14 * e) * (1 + 0.05 * n);
    if (street && walls.length) dim *= 0.9 + 0.1 * Math.min(1, wallDist(x, z) / 1.6);
    if (!flags) dim = 1 - 0.14 * e;
    dim = Math.min(1, dim);
    col[i * 3] = m[0]! * dim; col[i * 3 + 1] = m[1]! * dim; col[i * 3 + 2] = m[2]! * dim;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const material = new THREE.MeshToonMaterial({ gradientMap: toonRamp(), map: patioGroundTexture(quality, ground), vertexColors: true });
  const street = streetTexture(quality);
  if (flags && street) {
    const rect = (r: readonly number[]) => new THREE.Vector4(r[0]!, r[1]!, r[2]!, r[3]!);
    patchShader(material, 'patio-ground-street', (sh) => {
      sh.uniforms.gStreetMap = { value: street };
      sh.uniforms.gZone = { value: [rect(zn.plaza), rect(zn.sol), rect(zn.luna)] };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec2 vGXZ;
uniform sampler2D gStreetMap;
uniform vec4 gZone[3];
float gIn( vec4 r ) { return step( r.x, vGXZ.x ) * step( vGXZ.x, r.z ) * step( r.y, vGXZ.y ) * step( vGXZ.y, r.w ); }`)
        .replace('#include <map_fragment>', `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  vec4 gStreet = texture2D( gStreetMap, vGXZ * ${(1 / STREET_M).toFixed(4)} );
  float gS = 1.0 - max( gIn( gZone[0] ), max( gIn( gZone[1] ), gIn( gZone[2] ) ) );
  diffuseColor *= mix( sampledDiffuseColor, gStreet, gS );
#endif`);
    });
  }
  return { geometry, material };
}
