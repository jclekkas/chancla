// Graphics experiment: one upgraded courtyard section (the Café Chancla on
// the Sol side of El Patio, and its mirror, the Panadería Rosa). Everything
// here is visual: the authoritative collision boxes are not changed, no
// opening is cut into a wall, and decoration stays inside a box's footprint,
// flush with the ground, or as shallow trim (at most ~0.3 m) on a wall.
//
// The section is built as a small reusable kit: a window, a door, a cornice
// with a barrel-tile eave, a painted base band, corner pilasters, stone steps
// with tiled risers, a tiled bench, a planter and a paved strip, each placed
// in a facade's own frame (along the wall, up, and out of it). All geometry
// for both sections bakes into one mesh per material kind; colours that only
// differ by tint share a material through vertex colours (11 draw calls).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapBox } from '../../../shared/map';
import { COLORS, boxGeo, toonRamp, woodTexture } from './materials';

/** Where the section is: the café block, its stairs, bench and planter (and the point-mirrored copy). */
const ZONE = { minX: -8.3, maxX: 3.6, minZ: -11.2, maxZ: -4.4 };

export function inSection(b: MapBox): boolean {
  const inside = (z: typeof ZONE) => b.minX >= z.minX && b.maxX <= z.maxX && b.minZ >= z.minZ && b.maxZ <= z.maxZ;
  return inside(ZONE) || inside({ minX: -ZONE.maxX, maxX: -ZONE.minX, minZ: -ZONE.maxZ, maxZ: -ZONE.minZ });
}

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

/** Fine lime plaster: low-contrast trowel marks, no blotches (1 tile = 2 m). */
function plasterTexture(): THREE.CanvasTexture | null {
  return tex('plaster', 256, 256, (c) => {
    const r = rng(11);
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 260; i++) {
      const g = 236 + Math.floor(r() * 19);
      c.fillStyle = `rgba(${g},${g - 3},${g - 8},${0.22 + r() * 0.2})`;
      c.beginPath(); c.ellipse(r() * 256, r() * 256, 10 + r() * 22, 2 + r() * 4, (r() - 0.5) * 0.6, 0, Math.PI * 2); c.fill();
    }
    // A faint rising-damp tint low on the wall is added by geometry, not here,
    // so the texture tiles vertically.
  });
}

/** Cantera stone: warm grey with soft grain, for steps, caps and the threshold. */
function canteraTexture(): THREE.CanvasTexture | null {
  return tex('cantera', 128, 128, (c) => {
    const r = rng(23);
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 500; i++) {
      const g = 214 + Math.floor(r() * 38);
      c.fillStyle = `rgba(${g},${g - 6},${g - 14},0.5)`;
      c.fillRect(r() * 128, r() * 128, 1 + r() * 3, 1 + r() * 2);
    }
  });
}

/** Talavera-style tiles: blue and yellow on white, 4×4 tiles per texture (1 tile = 0.3 m). */
function talaveraTexture(): THREE.CanvasTexture | null {
  return tex('talavera', 256, 256, (c) => {
    const s = 64;
    for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
      const x = tx * s, y = ty * s;
      c.fillStyle = '#f7f1e3'; c.fillRect(x, y, s, s);
      c.strokeStyle = '#d9cfb8'; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, s - 2, s - 2);
      const cx = x + s / 2, cy = y + s / 2;
      c.fillStyle = '#2d4f9e';
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + Math.PI / 4;
        c.beginPath(); c.ellipse(cx + Math.cos(a) * 13, cy + Math.sin(a) * 13, 11, 5, a, 0, Math.PI * 2); c.fill();
      }
      c.fillStyle = '#f0b43a'; c.beginPath(); c.arc(cx, cy, 6, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#2d4f9e';
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

/** A vertical fade from soft shade to clear: contact shading at a wall base. */
function fadeTexture(): THREE.CanvasTexture | null {
  return tex('fade', 4, 64, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, 'rgba(40,24,30,0.38)'); g.addColorStop(0.5, 'rgba(40,24,30,0.12)'); g.addColorStop(1, 'rgba(40,24,30,0)');
    c.fillStyle = g; c.fillRect(0, 0, 4, 64);
  });
}

// ------------------------------------------------------------- facade frame

interface Frame { len: number; m: THREE.Matrix4 }

/** Local axes for a facade: x along the wall, y up, z out of it (origin at the wall's left end, ground level). */
function frameOf(b: MapBox, side: 'n' | 's' | 'e' | 'w'): Frame {
  const u = new THREE.Vector3(), n = new THREE.Vector3(), o = new THREE.Vector3();
  switch (side) {
    case 's': o.set(b.minX, 0, b.maxZ); u.set(1, 0, 0); n.set(0, 0, 1); break;
    case 'n': o.set(b.maxX, 0, b.minZ); u.set(-1, 0, 0); n.set(0, 0, -1); break;
    case 'e': o.set(b.maxX, 0, b.maxZ); u.set(0, 0, -1); n.set(1, 0, 0); break;
    default: o.set(b.minX, 0, b.minZ); u.set(0, 0, 1); n.set(-1, 0, 0);
  }
  const m = new THREE.Matrix4().makeBasis(u, new THREE.Vector3(0, 1, 0), n).setPosition(o);
  const len = side === 'n' || side === 's' ? b.maxX - b.minX : b.maxZ - b.minZ;
  return { len, m };
}

/** Which way the side faces of a box are seen from (its exposed sides, by convention the facade's neighbours). */
const RIGHT_OF: Record<'n' | 's' | 'e' | 'w', 'n' | 's' | 'e' | 'w'> = { s: 'e', n: 'w', e: 'n', w: 's' };
const OPPOSITE: Record<'n' | 's' | 'e' | 'w', 'n' | 's' | 'e' | 'w'> = { s: 'n', n: 's', e: 'w', w: 'e' };

const STUCCO: Record<string, number> = {
  stuccoTerracotta: 0xd8765a, stuccoCream: 0xf1dfbc, stuccoTurquoise: 0x7cc7bb, stuccoMarigold: 0xf0b45a,
  stuccoViolet: 0x8a6aa8, stuccoPink: 0xeb9aac,
};

// --------------------------------------------------------------- batching
// Materials that differ only in colour share one material: the colour goes
// into the vertices. One merged mesh per kind.
type Kind = 'plaster' | 'cantera' | 'flat' | 'louver' | 'talavera' | 'glass' | 'wood' | 'lamp' | 'pavers' | 'shade';
interface Mat { k: Kind; c: number | null }
const TINTED: ReadonlySet<Kind> = new Set<Kind>(['plaster', 'cantera', 'flat', 'louver']);

class KindBatch {
  private b = new Map<Kind, THREE.BufferGeometry[]>();
  private tmp = new THREE.Color();
  add(m: Mat, g: THREE.BufferGeometry): void {
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    const n = (g.getAttribute('position') as THREE.BufferAttribute).count;
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.index) g.setIndex(Array.from({ length: n }, (_, i) => i));
    if (TINTED.has(m.k)) {
      this.tmp.setHex(m.c ?? 0xffffff); // sRGB hex to the linear working space, like a material colour
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = this.tmp.r; col[i * 3 + 1] = this.tmp.g; col[i * 3 + 2] = this.tmp.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    let list = this.b.get(m.k);
    if (!list) { list = []; this.b.set(m.k, list); }
    list.push(g);
  }
  addMesh(m: Mat, geo: THREE.BufferGeometry, matrix: THREE.Matrix4): void { this.add(m, geo.clone().applyMatrix4(matrix)); }
  build(group: THREE.Group, materials: Record<Kind, THREE.Material>): number {
    let calls = 0;
    for (const [k, gs] of this.b) {
      const merged = mergeGeometries(gs, false);
      gs.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, materials[k]);
      mesh.name = `section-${k}`;
      mesh.castShadow = k !== 'pavers' && k !== 'shade';
      mesh.receiveShadow = true;
      group.add(mesh);
      calls++;
    }
    this.b.clear();
    return calls;
  }
}

/** Builds the section. Returns the group and its draw-call count. */
export function buildSection(boxes: readonly MapBox[]): { group: THREE.Group; calls: number } {
  const group = new THREE.Group();
  group.name = 'section-cafe';
  const batch = new KindBatch();
  const plaster = plasterTexture(), cantera = canteraTexture(), talavera = talaveraTexture();
  const ramp = toonRamp();
  const toonOf = (opts: THREE.MeshToonMaterialParameters) => new THREE.MeshToonMaterial({ gradientMap: ramp, ...opts });
  const materials: Record<Kind, THREE.Material> = {
    plaster: toonOf({ vertexColors: true, map: plaster }),
    cantera: toonOf({ vertexColors: true, map: cantera }),
    flat: toonOf({ vertexColors: true }),
    louver: toonOf({ vertexColors: true, map: louverTexture() }),
    talavera: toonOf({ map: talavera }),
    glass: toonOf({ map: glassTexture() }),
    wood: toonOf({ color: 0x9a6440, map: woodTexture() }),
    lamp: toonOf({ color: 0xffe3a0, emissive: 0xc88a2a }),
    pavers: toonOf({ map: paverTexture(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    shade: new THREE.MeshBasicMaterial({ map: fadeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
  };
  const M = {
    trim: { k: 'plaster', c: 0xfbf1dc }, cantera: { k: 'cantera', c: 0xe6cfa6 }, pot: { k: 'cantera', c: COLORS.terracottaDark },
    talavera: { k: 'talavera', c: null }, glass: { k: 'glass', c: null }, wood: { k: 'wood', c: null }, lamp: { k: 'lamp', c: null },
    iron: { k: 'flat', c: 0x2a1d2c }, woodDark: { k: 'flat', c: 0x4c2d1c }, brass: { k: 'flat', c: COLORS.gold },
    tileA: { k: 'flat', c: COLORS.terracotta }, tileB: { k: 'flat', c: 0xb24a33 }, tileC: { k: 'flat', c: 0xd66a4b },
    eave: { k: 'flat', c: 0x7a3a2a }, soil: { k: 'flat', c: 0x5b3a22 },
    leaf: { k: 'flat', c: COLORS.leaf }, leafDark: { k: 'flat', c: COLORS.leafDark }, pink: { k: 'flat', c: COLORS.pink }, marigold: { k: 'flat', c: COLORS.marigold },
  } satisfies Record<string, Mat>;
  const wallMat = (c: number): Mat => ({ k: 'plaster', c });
  const shutterMat = (c: number): Mat => ({ k: 'louver', c });
  const pavers: Mat = { k: 'pavers', c: null }, shadeMat: Mat = { k: 'shade', c: null };
  const LEAF = new THREE.IcosahedronGeometry(0.5, 1); // rounder than the arena's faceted foliage (detail 0)
  const POT = new THREE.CylinderGeometry(0.5, 0.38, 1, 14);
  const TILE = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1, false, 0, Math.PI);

  /** A box in a facade frame: a = along, y = up, n = out of the wall. */
  const fbox = (f: Frame, mat: Mat, a0: number, y0: number, n0: number, a1: number, y1: number, n1: number, uv = 1) => {
    batch.add(mat, boxGeo(a0, y0, n0, a1, y1, n1, uv).applyMatrix4(f.m));
  };
  /** A mesh (unit geometry) in a facade frame. */
  const fmesh = (f: Frame, mat: Mat, geo: THREE.BufferGeometry, a: number, y: number, n: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) => {
    const local = new THREE.Matrix4().compose(new THREE.Vector3(a, y, n), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    batch.addMesh(mat, geo, new THREE.Matrix4().multiplyMatrices(f.m, local));
  };
  /** A flat plane lying on the ground in a facade frame (a0..a1 along, n0..n1 out), for paving and contact shade. */
  const groundQuad = (f: Frame, mat: Mat, a0: number, n0: number, a1: number, n1: number, y: number, uvScale: number) => {
    const g = new THREE.PlaneGeometry(a1 - a0, n1 - n0);
    g.rotateX(-Math.PI / 2);
    g.translate((a0 + a1) / 2, y, (n0 + n1) / 2);
    // World-scale UVs so the pavers keep one size everywhere.
    const uv = g.getAttribute('uv') as THREE.BufferAttribute, p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / uvScale, p.getZ(i) / uvScale);
    batch.add(mat, g.applyMatrix4(f.m));
  };
  /** Contact shade on a wall's foot: a strip on the ground fading away from the wall. */
  const contactStrip = (f: Frame, a0: number, a1: number, depth: number) => {
    const g = new THREE.PlaneGeometry(a1 - a0, depth);
    g.rotateX(-Math.PI / 2);
    g.translate((a0 + a1) / 2, 0.012, depth / 2);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) > 0.5 ? 0 : 1); // dark at the wall
    batch.add(shadeMat, g.applyMatrix4(f.m));
  };

  // -------------------------------------------------------------- components

  function windowUnit(f: Frame, a: number, wy: number, shutter: number, ground: boolean, balcony: boolean): void {
    const hw = 0.45, hh = 0.6, top = wy + hh, bot = wy - hh;
    fbox(f, M.glass, a - hw, bot, 0.0, a + hw, top, 0.012);                        // glass, flush with the wall
    fbox(f, M.trim, a - hw - 0.1, bot, 0, a - hw, top, 0.17);                       // jambs: a 0.16 m reveal
    fbox(f, M.trim, a + hw, bot, 0, a + hw + 0.1, top, 0.17);
    fbox(f, M.trim, a - hw - 0.14, top, 0, a + hw + 0.14, top + 0.16, 0.2);         // lintel
    fbox(f, M.trim, a - hw - 0.2, top + 0.16, 0, a + hw + 0.2, top + 0.22, 0.26);   // its cap
    fbox(f, M.trim, a - 0.08, top - 0.04, 0, a + 0.08, top + 0.2, 0.23);            // keystone
    fbox(f, M.cantera, a - hw - 0.16, bot - 0.08, 0, a + hw + 0.16, bot, 0.25);     // sill
    for (const s of [-1, 1]) fbox(f, M.trim, a + s * (hw - 0.02) - 0.05, bot - 0.22, 0, a + s * (hw - 0.02) + 0.05, bot - 0.08, 0.17); // corbels
    // Louvered shutters folded back against the wall.
    for (const s of [-1, 1]) fbox(f, shutterMat(shutter), a + s * (hw + 0.12) - (s > 0 ? 0 : 0.42), bot + 0.02, 0.02, a + s * (hw + 0.12) + (s > 0 ? 0.42 : 0), top - 0.02, 0.06, 0.6);
    if (ground) {
      // Wrought bars inside the reveal, with a top and bottom rail.
      for (let i = -2; i <= 2; i++) fbox(f, M.iron, a + i * 0.17 - 0.013, bot + 0.02, 0.1, a + i * 0.17 + 0.013, top - 0.02, 0.126);
      for (const y of [bot + 0.12, top - 0.12]) fbox(f, M.iron, a - hw, y - 0.015, 0.1, a + hw, y + 0.015, 0.13);
    } else if (balcony) {
      // Juliet balcony: a molded slab on two corbels, iron railing, flower pots. Above head height.
      const sy = bot - 0.1;
      fbox(f, M.cantera, a - 0.75, sy - 0.08, 0, a + 0.75, sy, 0.34);
      fbox(f, M.trim, a - 0.68, sy - 0.14, 0, a + 0.68, sy - 0.08, 0.28);
      for (const s of [-1, 1]) fbox(f, M.trim, a + s * 0.55 - 0.06, sy - 0.32, 0, a + s * 0.55 + 0.06, sy - 0.14, 0.22);
      for (let i = -6; i <= 6; i++) fbox(f, M.iron, a + i * 0.115 - 0.012, sy, 0.3, a + i * 0.115 + 0.012, sy + 0.62, 0.324);
      for (const y of [sy + 0.05, sy + 0.6]) fbox(f, M.iron, a - 0.74, y - 0.02, 0.29, a + 0.74, y + 0.02, 0.33);
      for (const s of [-0.45, 0, 0.45]) {
        fmesh(f, M.pot, POT, a + s, sy + 0.1, 0.17, 0.2, 0.2, 0.2);
        fmesh(f, s ? M.pink : M.marigold, LEAF, a + s, sy + 0.28, 0.17, 0.26, 0.22, 0.26);
      }
    } else {
      // Window box with trailing greenery.
      fbox(f, M.pot, a - 0.44, bot - 0.08, 0.06, a + 0.44, bot + 0.1, 0.24);
      for (const s of [-0.3, 0, 0.3]) fmesh(f, s ? M.leaf : M.leafDark, LEAF, a + s, bot + 0.2, 0.15, 0.32, 0.26, 0.26);
      fmesh(f, M.pink, LEAF, a - 0.15, bot + 0.3, 0.2, 0.12, 0.12, 0.12);
      fmesh(f, M.marigold, LEAF, a + 0.17, bot + 0.29, 0.2, 0.12, 0.12, 0.12);
    }
  }

  function doorUnit(f: Frame, a: number): void {
    const hw = 0.62, top = 2.4;
    // Casing and a molded head; the leaves sit 0.14 m back from the casing face.
    fbox(f, M.trim, a - hw - 0.14, 0, 0, a - hw, top, 0.18);
    fbox(f, M.trim, a + hw, 0, 0, a + hw + 0.14, top, 0.18);
    fbox(f, M.trim, a - hw - 0.18, top, 0, a + hw + 0.18, top + 0.2, 0.22);
    fbox(f, M.trim, a - hw - 0.26, top + 0.2, 0, a + hw + 0.26, top + 0.27, 0.3);
    // Two closed wooden leaves with raised panels, a center stile and brass handles.
    fbox(f, M.wood, a - hw, 0, 0, a + hw, top, 0.03, 0.6);
    fbox(f, M.woodDark, a - 0.02, 0.02, 0.03, a + 0.02, top - 0.02, 0.05);
    for (const s of [-1, 1]) for (const [y0, y1] of [[0.18, 0.9], [1.05, 1.65], [1.8, 2.25]] as const) {
      const ax0 = s < 0 ? a - hw + 0.1 : a + 0.1, ax1 = s < 0 ? a - 0.1 : a + hw - 0.1;
      fbox(f, M.woodDark, ax0, y0, 0.03, ax1, y1, 0.045);
      fbox(f, M.wood, ax0 + 0.05, y0 + 0.05, 0.045, ax1 - 0.05, y1 - 0.05, 0.06, 0.6);
    }
    for (const s of [-1, 1]) fbox(f, M.brass, a + s * 0.09 - 0.02, 1.0, 0.05, a + s * 0.09 + 0.02, 1.22, 0.08);
    // Stone threshold, flush with the ground (no new step to trip on).
    fbox(f, M.cantera, a - hw - 0.2, 0, 0, a + hw + 0.2, 0.025, 0.45, 0.8);
    // Wall lanterns either side, above head height, glowing warm.
    for (const s of [-1, 1]) {
      const la = a + s * (hw + 0.5);
      fbox(f, M.iron, la - 0.03, 2.35, 0, la + 0.03, 2.4, 0.26);
      fbox(f, M.iron, la - 0.11, 2.02, 0.16, la + 0.11, 2.06, 0.38);
      fbox(f, M.lamp, la - 0.09, 2.06, 0.18, la + 0.09, 2.3, 0.36);
      fbox(f, M.iron, la - 0.12, 2.3, 0.15, la + 0.12, 2.35, 0.39);
      for (const c of [-1, 1]) for (const d of [0.18, 0.36]) fbox(f, M.iron, la + c * 0.09 - 0.012, 2.06, d - 0.012, la + c * 0.09 + 0.012, 2.3, d + 0.012);
    }
  }

  /** Cornice in three steps and a barrel-tile eave: replaces the flat slab and the tile "teeth". */
  function roofUnit(f: Frame, h: number): void {
    fbox(f, M.trim, -0.04, h - 0.42, 0, f.len + 0.04, h - 0.3, 0.08);
    fbox(f, M.trim, -0.08, h - 0.3, 0, f.len + 0.08, h - 0.18, 0.17);
    fbox(f, M.trim, -0.12, h - 0.18, 0, f.len + 0.12, h - 0.02, 0.27);
    fbox(f, M.eave, -0.12, h - 0.02, -0.4, f.len + 0.12, h + 0.04, 0.4);           // eave board under the tiles
    const n = Math.round((f.len + 0.2) / 0.24);
    for (let i = 0; i < n; i++) {
      const a = -0.1 + (i + 0.5) * ((f.len + 0.2) / n);
      const mat = [M.tileA, M.tileB, M.tileA, M.tileC][i % 4]!;
      // Each barrel tile runs from the roof out over the edge, slightly tilted down.
      fmesh(f, mat, TILE, a, h + 0.11, 0.0, 0.22, 0.84, 0.16, Math.PI / 2 - 0.12, 0, 0);
    }
    // Rain spouts (canales) near both ends: a classic detail and a landmark at the roofline.
    for (const a of [0.5, f.len - 0.5]) {
      fbox(f, M.tileB, a - 0.07, h - 0.36, 0, a + 0.07, h - 0.24, 0.62);
      fbox(f, M.eave, a - 0.05, h - 0.28, 0.08, a + 0.05, h - 0.24, 0.62);
    }
  }

  /** Painted base band with a molded cap, and pilasters framing the facade. */
  function baseAndPilasters(f: Frame, h: number, band: number, pilasters: boolean): void {
    fbox(f, wallMat(band), 0, 0, 0, f.len, 0.8, 0.03);
    fbox(f, M.trim, -0.02, 0.8, 0, f.len + 0.02, 0.88, 0.07);
    if (!pilasters) return;
    for (const a of [0, f.len - 0.34]) {
      fbox(f, M.trim, a, 0.88, 0, a + 0.34, h - 0.42, 0.05);
      fbox(f, M.trim, a - 0.03, 0.8, 0, a + 0.37, 0.88, 0.09);
    }
  }

  // ---------------------------------------------------------------- assembly

  for (const b of boxes) {
    const w = b.maxX - b.minX, h = b.maxY - b.minY, d = b.maxZ - b.minZ;
    if (b.mat in STUCCO && b.facade) {
      // The building: walls in fine plaster, then its facade kit.
      const col = STUCCO[b.mat]!;
      batch.add(wallMat(col), boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 2));
      const f = frameOf(b, b.facade);
      const side = frameOf(b, RIGHT_OF[b.facade]);
      const band = col === STUCCO.stuccoCream ? 0xc2704f : 0xa45c3e; // a softer, earthier base band
      baseAndPilasters(f, h, band, true);
      baseAndPilasters(side, h, band, false);
      roofUnit(f, h);
      roofUnit(side, h);
      // The back and the other side keep a plain stepped cornice (seen from the alley and the terrace).
      for (const other of [frameOf(b, OPPOSITE[b.facade]), frameOf(b, OPPOSITE[RIGHT_OF[b.facade]])]) {
        fbox(other, M.trim, -0.08, h - 0.3, 0, other.len + 0.08, h - 0.18, 0.12);
        fbox(other, M.trim, -0.12, h - 0.18, 0, other.len + 0.12, h + 0.06, 0.22);
      }
      // Same bays as the arena's generic facades, so the comparison is like for like.
      const cols = Math.max(1, Math.floor(f.len / 2.7)), spacing = f.len / cols;
      const shutter = col === STUCCO.stuccoTurquoise ? COLORS.marigold : COLORS.turquoise;
      for (let k = 0; k < cols; k++) {
        const a = spacing * (k + 0.5);
        if (k === Math.floor(cols / 2)) doorUnit(f, a); else windowUnit(f, a, 1.55, shutter, true, false);
        windowUnit(f, a, 4.6, shutter, false, k !== Math.floor(cols / 2));
      }
      // The sign gets a painted wooden frame (the sign itself is drawn by the arena, at 3.3 m).
      const sw = Math.min(f.len - 0.6, 4.2), sh = sw * 0.21, sa = f.len / 2;
      fbox(f, M.woodDark, sa - sw / 2 - 0.08, 3.3 - sh / 2 - 0.08, 0, sa + sw / 2 + 0.08, 3.3 + sh / 2 + 0.08, 0.05);
      // Paved strip along the front (flush), with contact shade at the wall foot.
      groundQuad(f, pavers, 0, 0, f.len, 1.4, 0.008, 2.4);
      fbox(f, M.cantera, 0, 0, 1.4, f.len, 0.03, 1.55, 0.8);                        // flush curb line
      contactStrip(f, 0, f.len, 0.7);
      contactStrip(side, 0, side.len, 0.7);
      continue;
    }
    if (b.mat === 'step') {
      // Stone steps: cantera treads with a slight nosing, tiled risers, plaster stringers.
      batch.add(M.cantera, boxGeo(b.minX, b.maxY - 0.06, b.minZ, b.maxX, b.maxY, b.maxZ, 0.8));
      batch.add(M.trim, boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY - 0.06, b.maxZ, 2, 1 | 2 | 8 | 32));
      batch.add(M.talavera, boxGeo(b.minX, Math.max(0, b.maxY - 0.45), b.maxZ - 0.0, b.maxX, b.maxY - 0.06, b.maxZ, 1.2, 16));
      batch.add(M.cantera, boxGeo(b.minX, b.maxY - 0.04, b.maxZ, b.maxX, b.maxY, b.maxZ + 0.03, 0.8, 4 | 16 | 1 | 2));
      continue;
    }
    if (b.mat === 'stone') {
      // The bench in front of the café: tiled sides, a stone cap with a small overhang.
      batch.add(M.talavera, boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY - 0.08, b.maxZ, 1.2, 1 | 2 | 16 | 32));
      batch.add(M.cantera, boxGeo(b.minX - 0.03, b.maxY - 0.08, b.minZ - 0.03, b.maxX + 0.03, b.maxY, b.maxZ + 0.03, 0.8));
      batch.add(M.trim, boxGeo(b.minX - 0.01, 0, b.minZ - 0.01, b.maxX + 0.01, 0.1, b.maxZ + 0.01, 1, 1 | 2 | 16 | 32));
      continue;
    }
    if (b.mat === 'planter') {
      // Planter: terracotta body with a tile band, a stone cap, and rounder foliage.
      batch.add(M.pot, boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 1));
      batch.add(M.talavera, boxGeo(b.minX - 0.005, b.maxY - 0.38, b.minZ - 0.005, b.maxX + 0.005, b.maxY - 0.2, b.maxZ + 0.005, 1.2, 1 | 2 | 16 | 32));
      batch.add(M.cantera, boxGeo(b.minX - 0.04, b.maxY - 0.06, b.minZ - 0.04, b.maxX + 0.04, b.maxY, b.maxZ + 0.04, 0.8, 63 & ~4));
      batch.add(M.cantera, boxGeo(b.minX - 0.04, b.maxY - 0.06, b.minZ - 0.04, b.minX + 0.08, b.maxY, b.maxZ + 0.04, 0.8, 4));
      batch.add(M.cantera, boxGeo(b.maxX - 0.08, b.maxY - 0.06, b.minZ - 0.04, b.maxX + 0.04, b.maxY, b.maxZ + 0.04, 0.8, 4));
      batch.add(M.cantera, boxGeo(b.minX + 0.08, b.maxY - 0.06, b.minZ - 0.04, b.maxX - 0.08, b.maxY, b.minZ + 0.08, 0.8, 4));
      batch.add(M.cantera, boxGeo(b.minX + 0.08, b.maxY - 0.06, b.maxZ - 0.08, b.maxX - 0.08, b.maxY, b.maxZ + 0.04, 0.8, 4));
      batch.add(M.soil, boxGeo(b.minX + 0.08, b.maxY - 0.09, b.minZ + 0.08, b.maxX - 0.08, b.maxY - 0.07, b.maxZ - 0.08, 1, 4));
      // Same spacing and no larger than the arena's planter bushes, so the
      // foliage never hides more of the line of sight than it does in production.
      const alongX = w >= d, long = Math.max(w, d), n = Math.max(2, Math.round(long / 0.5));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = alongX ? b.minX + w * t : (b.minX + b.maxX) / 2, z = alongX ? (b.minZ + b.maxZ) / 2 : b.minZ + d * t;
        const s = 0.46 + (i % 3) * 0.06;
        batch.addMesh(i % 2 ? M.leaf : M.leafDark, LEAF, new THREE.Matrix4().compose(new THREE.Vector3(x, b.maxY + s * 0.32, z), new THREE.Quaternion(), new THREE.Vector3(s, s * 0.8, s)));
        if (i % 2 === 0) batch.addMesh(i % 4 ? M.marigold : M.pink, LEAF, new THREE.Matrix4().compose(new THREE.Vector3(x + 0.1, b.maxY + s * 0.62, z + 0.05), new THREE.Quaternion(), new THREE.Vector3(0.17, 0.17, 0.17)));
      }
      continue;
    }
    // Anything else in the zone keeps a neutral stone look.
    batch.add(M.cantera, boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 1));
  }

  const calls = batch.build(group, materials);
  return { group, calls };
}
