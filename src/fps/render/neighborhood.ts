// The neighbourhood around the arenas: what stands beyond the walls. One shared builder, one small
// spec per map (palette, hills, landmarks, fog), so the three maps keep their own identity without
// three implementations.
//
// From the arena floor the houses' roofline hides everything below roughly 15-25 degrees of
// elevation, so anything that is to be seen has to rise above it. Four layers do:
//   roof clusters  tinacos, antennas, washing lines and roof rooms on the tall houses' flat roofs
//                  (houses are 5 m and more: no player can stand on or behind any of it)
//   near rooflines a ring of taller houses just outside the walls, with their own roofs
//   hillside       stepped terraces of houses rising behind the ring, in two sectors
//   ridge          a hazy skyline on the sky dome, and landmarks (towers, a dome, a water tank, a
//                  hilltop chapel) set on the lane axes so street ends and plaza views lead somewhere
// Everything is visual: no collision, no cover, no sight line changes. It is merged per material
// from the kit's own materials: a handful of draw calls, no new textures.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapBox, MapData } from '../../../shared/map';
import type { Quality } from '../settings';
import { COLORS } from './materials';
import { kitMaterials } from './patio-materials';

export interface HoodResult {
  group: THREE.Group;
  /** Draw calls added. */
  calls: number;
  /** Triangles added (for the cost record). */
  tris: number;
  /** This map's fog distances (near, far). */
  fog: [number, number];
}

/** Review switch: ?hood=0 in the page URL builds the arenas without the neighbourhood. */
export function hoodWanted(): boolean {
  try { return typeof location === 'undefined' || new URLSearchParams(location.search).get('hood') !== '0'; } catch { return true; }
}

// ------------------------------------------------------------------------------------ specs

type LandmarkKind = 'bell' | 'dome' | 'tank' | 'chapel';
interface Hill { az: number; span: number; r0: number; rows: number; step: number; slope: number; base: number }
interface Landmark { kind: LandmarkKind; az?: number; r?: number; x?: number; z?: number; h: number; hill?: number }
interface HoodSpec {
  seed: number;
  /** House paints. */
  palette: readonly number[];
  /** Roof accents (tile, cream cornice, painted slab). */
  roofs: readonly number[];
  /** Near ring: heights (m) for the inner and outer row. */
  ring: { row0: [number, number]; row1: [number, number] };
  hills: readonly Hill[];
  /** Ridge height (m) every 30 degrees from east (0) round through south (90), west (180), north (270). */
  ridge: readonly number[];
  landmarks: readonly Landmark[];
  /** Dusk: some windows are lit. */
  lit: boolean;
  /** Clusters per tall roof (0..1+). */
  clutter: number;
  fog: [number, number];
}

const SPECS: Record<string, HoodSpec> = {
  // El Patio, afternoon: a warm hill town, the steep side to the north, a dome and a tank on the lane axes.
  patio: {
    seed: 11,
    palette: [0xf0b45a, 0xd8765a, 0x7cc7bb, 0xeb9aac, 0xf1dfbc, 0x8a6aa8, 0xd8a25a, 0xe58a6b, 0x9bd1a6, 0x7fb4d6],
    roofs: [0xc8553d, 0xf4e6c8, 0x9c3d2c, 0xe0cba0],
    ring: { row0: [11, 17], row1: [14, 22] },
    hills: [
      { az: 270, span: 110, r0: 56, rows: 7, step: 9, slope: 0.66, base: 5 },
      { az: 90, span: 90, r0: 60, rows: 6, step: 9.5, slope: 0.55, base: 4 },
    ],
    ridge: [30, 38, 46, 48, 44, 40, 34, 40, 50, 74, 78, 56],
    landmarks: [
      { kind: 'dome', x: 62, z: -13.5, h: 27 },
      { kind: 'tank', x: -62, z: -13.5, h: 22 },
      { kind: 'bell', x: 62, z: 13.5, h: 30 },
      { kind: 'chapel', az: 262, hill: 0, r: 111, h: 7 },
    ],
    lit: false,
    clutter: 0.9,
    fog: [45, 175],
  },
  // La Plaza, noon: a colonial town of cream and rose, bell tower and dome on the long axis.
  plaza: {
    seed: 23,
    palette: [0xf1dfbc, 0xe9c9a0, 0xeb9aac, 0x9ad0c8, 0xf0c070, 0xd9876a, 0x8fb4d8, 0xf6efe0, 0xc98aa8],
    roofs: [0xc8553d, 0xf4e6c8, 0x9c3d2c, 0xd8765a],
    ring: { row0: [12, 18], row1: [15, 23] },
    hills: [
      { az: 90, span: 120, r0: 62, rows: 7, step: 9, slope: 0.6, base: 5 },
      { az: 270, span: 80, r0: 64, rows: 5, step: 9.5, slope: 0.5, base: 4 },
    ],
    ridge: [34, 40, 54, 66, 58, 44, 36, 42, 52, 60, 58, 42],
    landmarks: [
      { kind: 'bell', x: 70, z: 0, h: 31 },
      { kind: 'dome', x: -70, z: 0, h: 27 },
      { kind: 'tank', x: 0, z: 76, h: 22 },
      { kind: 'chapel', az: 84, hill: 0, r: 117, h: 7 },
    ],
    lit: false,
    clutter: 0.9,
    fog: [50, 180],
  },
  // La Fiesta, dusk: violet and magenta, lit windows, a tank and a bell tower over the dance floor's axis.
  fiesta: {
    seed: 37,
    palette: [0xd9648f, 0x8a6fb8, 0x4fa6a0, 0xe58a4a, 0xf0c27a, 0xb86ab0, 0x6f8fd0, 0xe8a0b0],
    roofs: [0x7a3a5a, 0xb86a7a, 0x5a3a6a, 0xd08a6a],
    ring: { row0: [10, 16], row1: [13, 20] },
    hills: [
      { az: 270, span: 100, r0: 52, rows: 7, step: 8.5, slope: 0.64, base: 5 },
      { az: 90, span: 100, r0: 52, rows: 7, step: 8.5, slope: 0.64, base: 5 },
    ],
    ridge: [36, 44, 62, 70, 60, 46, 38, 46, 64, 72, 62, 46],
    landmarks: [
      { kind: 'tank', x: 52, z: 0, h: 20 },
      { kind: 'bell', x: -52, z: 0, h: 27 },
      { kind: 'chapel', az: 266, hill: 0, r: 100, h: 7 },
    ],
    lit: true,
    clutter: 1,
    fog: [38, 160],
  },
};

// ---------------------------------------------------------------------------------- helpers

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
/** A matrix from position, scale and rotation (YXZ order). */
function mx(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

type Tone = 'solid' | 'cloth' | 'lamp';
/** Collects small shapes and merges them per material: a few draw calls for the whole neighbourhood. */
class Merge {
  readonly sets: Record<Tone, THREE.BufferGeometry[]> = { solid: [], cloth: [], lamp: [] };
  /** Adds a shape (a unit geometry placed by `m`), coloured by `hex`; `top`/`bottom` scale the colour of faces pointing up/down. */
  add(tone: Tone, geo: THREE.BufferGeometry, m: THREE.Matrix4, hex: number, top = 1.06, bottom = 0.72, topHex?: number): void {
    const g = geo.clone();
    g.applyMatrix4(m);
    g.deleteAttribute('uv');
    if (tone !== 'lamp') {
      _c.setHex(hex);
      const tc = new THREE.Color(topHex ?? hex);
      const n = g.getAttribute('normal') as THREE.BufferAttribute, count = (g.getAttribute('position') as THREE.BufferAttribute).count;
      const col = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const up = n.getY(i) > 0.5, k = up ? top : n.getY(i) < -0.5 ? bottom : 1, c = up ? tc : _c;
        col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    this.sets[tone].push(g);
  }
  tris(): number { let t = 0; for (const k of Object.keys(this.sets) as Tone[]) for (const g of this.sets[k]) t += (g.index ? g.index.count : (g.getAttribute('position') as THREE.BufferAttribute).count) / 3; return t; }
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const PLANE = new THREE.PlaneGeometry(1, 1);
const CYL = (seg: number) => new THREE.CylinderGeometry(0.5, 0.5, 1, seg);
const CYL6 = CYL(6), CYL8 = CYL(8), CYL12 = CYL(12);
const CONE4 = new THREE.ConeGeometry(0.5, 1, 4);
const CONE8 = new THREE.ConeGeometry(0.5, 1, 8);
const DOME = new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
const PRISM = new THREE.CylinderGeometry(0.5, 0.5, 1, 3);

/** Dark window quads, a lit one at dusk, optional shutters, on the face that looks at the arena. */
function windows(m: Merge, base: THREE.Matrix4, w: number, d: number, y0: number, h: number, floors: number, r: () => number, spec: HoodSpec, lite: boolean): void {
  if (lite) return;
  const n = Math.max(1, Math.floor(w / 2.6));
  for (let f = 0; f < floors; f++) {
    const y = 1.4 + f * 3.1;
    if (y > h - 1.0) break;
    for (let i = 0; i < n; i++) {
      if (r() < 0.18) continue;
      const u = ((i + 0.5) / n - 0.5) * w;
      const lit = spec.lit && r() < 0.4;
      const wm = base.clone().multiply(mx(u, y0 + y, d / 2 + 0.07, 0.9, 1.25, 1));
      m.add(lit ? 'lamp' : 'solid', PLANE, wm, 0x2a2030);
      if (!lit && r() < 0.5) {
        const sc = spec.palette[Math.floor(r() * spec.palette.length)]!;
        for (const s of [-1, 1]) m.add('solid', PLANE, base.clone().multiply(mx(u + s * 0.72, y0 + y, d / 2 + 0.08, 0.42, 1.3, 1)), sc);
      }
    }
  }
}

/** One house (or block): body, cornice slab, roof deck and its windows, turned to face the arena. */
function house(m: Merge, spec: HoodSpec, r: () => number, x: number, z: number, y0: number, w: number, d: number, h: number, hex: number, lite: boolean, withWindows: boolean): THREE.Matrix4 {
  const ry = Math.atan2(-x, -z); // local +z looks at the arena centre
  const base = mx(x, 0, z, 1, 1, 1, ry);
  m.add('solid', BOX, base.clone().multiply(mx(0, y0 + h / 2, 0, w, h, d)), hex, 1.1, 0.7);
  const roofHex = spec.roofs[Math.floor(r() * spec.roofs.length)]!;
  m.add('solid', BOX, base.clone().multiply(mx(0, y0 + h + 0.18, 0, w + 0.5, 0.36, d + 0.5)), roofHex, 1.12, 0.7);
  if (withWindows) windows(m, base, w, d, y0, h, Math.floor(h / 3.1), r, spec, lite);
  return base;
}

/** Roof clusters: small recognisable groups, set toward the front of a flat roof (so they read from the arena). */
function cluster(m: Merge, spec: HoodSpec, r: () => number, kind: number, x: number, y: number, z: number, ry: number, lite: boolean): void {
  const base = mx(x, y, z, 1, 1, 1, ry);
  const L = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, rx = 0, rrz = 0) => base.clone().multiply(mx(lx, ly, lz, sx, sy, sz, 0, rx, rrz));
  const tinacoCol = [0x2b2b36, 0xc9744a, 0x3a6ea5, 0xe8e2d0][Math.floor(r() * 4)]!;
  const concrete = 0xb7ae9c;
  if (kind === 0) { // tinacos: two water tanks on a stand, a solar heater
    m.add('solid', BOX, L(0, 0.2, 0, 2.0, 0.4, 1.0), concrete);
    for (const s of [-0.5, 0.5]) {
      m.add('solid', lite ? CYL6 : CYL12, L(s, 0.95, 0, 0.95, 1.1, 0.95), tinacoCol, 1.15);
      m.add('solid', lite ? CYL6 : CYL12, L(s, 1.55, 0, 0.7, 0.16, 0.7), tinacoCol, 1.2);
    }
    if (!lite) m.add('solid', BOX, L(1.9, 0.55, 0.1, 1.3, 0.06, 1.9, -0.5), 0x35506e);
  } else if (kind === 1) { // tendedero: two posts, a line, hanging cloth
    const len = 3.4;
    for (const s of [-1, 1]) m.add('solid', lite ? CYL6 : CYL8, L(s * len / 2, 0.95, 0, 0.09, 1.9, 0.09), 0x6a5238);
    m.add('solid', BOX, L(0, 1.85, 0, len, 0.04, 0.04), 0x4a4036);
    const n = lite ? 3 : 6, cols = spec.palette;
    for (let i = 0; i < n; i++) {
      const cw = 0.45 + r() * 0.4, ch = 0.55 + r() * 0.5, u = -len / 2 + (i + 0.6) * (len / (n + 0.2));
      m.add('cloth', PLANE, L(u, 1.82 - ch / 2, 0, cw, ch, 1), cols[Math.floor(r() * cols.length)]!);
    }
  } else if (kind === 2) { // antennas: a pole with crossbars, a dish, a tinaco beside it
    m.add('solid', lite ? CYL6 : CYL8, L(0, 1.6, 0, 0.07, 3.2, 0.07), 0x39343c);
    if (!lite) for (const [yy, ww] of [[2.2, 1.0], [2.7, 0.8], [3.1, 0.55]] as const) m.add('solid', BOX, L(0, yy, 0, ww, 0.04, 0.04), 0x39343c);
    m.add('solid', lite ? CYL6 : CYL12, L(1.2, 0.9, 0.2, 0.8, 1.0, 0.8), tinacoCol, 1.15);
    m.add('solid', lite ? CYL6 : CYL12, L(-1.3, 0.55, 0, 0.7, 0.07, 0.7, 0.5), 0xdedede);
    m.add('solid', lite ? CYL6 : CYL8, L(-1.3, 0.3, 0, 0.05, 0.6, 0.05), 0x555060);
  } else { // cuarto de azotea: a roof room with a door, a tinaco on top and an antenna
    m.add('solid', BOX, L(0, 1.1, 0, 2.2, 2.2, 2.0), spec.palette[Math.floor(r() * spec.palette.length)]!, 1.1, 0.7);
    m.add('solid', BOX, L(0, 2.3, 0, 2.6, 0.2, 2.4), spec.roofs[Math.floor(r() * spec.roofs.length)]!, 1.12, 0.7);
    if (!lite) m.add('solid', PLANE, L(0.2, 0.95, 1.01, 0.8, 1.9, 1), 0x4a3424);
    m.add('solid', lite ? CYL6 : CYL12, L(-0.5, 3.0, 0, 0.9, 1.0, 0.9), tinacoCol, 1.15);
    m.add('solid', lite ? CYL6 : CYL8, L(0.7, 3.4, -0.3, 0.06, 2.0, 0.06), 0x39343c);
  }
}

/** Roof pieces on the arena's own tall houses: placed on exposed flat roofs, toward the side facing the arena. */
function roofClusters(m: Merge, spec: HoodSpec, boxes: readonly MapBox[], r: () => number, lite: boolean): number {
  const houses = boxes.filter((b) => b.minY <= 0.05 && b.maxY >= 5 && (b.maxX - b.minX) * (b.maxZ - b.minZ) >= 9);
  let placed = 0, kindNext = Math.floor(r() * 4);
  const covered = (x: number, z: number, top: number) => boxes.some((b) => b.maxY > top + 0.01 && x > b.minX - 0.8 && x < b.maxX + 0.8 && z > b.minZ - 0.8 && z < b.maxZ + 0.8);
  for (const b of houses) {
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, w = b.maxX - b.minX, d = b.maxZ - b.minZ;
    const area = w * d, want = Math.min(3, Math.max(1, Math.round((area / 70) * spec.clutter)));
    // The side facing the arena centre decides where clusters sit.
    const towardX = -Math.sign(cx) || 1, towardZ = -Math.sign(cz) || 1;
    const alongX = Math.abs(cx) / Math.max(1, Math.abs(cz) + Math.abs(cx)) > 0.5; // east/west houses face along x
    for (let k = 0; k < want; k++) {
      for (let tries = 0; tries < 14; tries++) {
        const u = r(), v = r();
        const px = alongX ? (towardX > 0 ? b.maxX - 1.4 - u * Math.min(3.5, w - 2.8) : b.minX + 1.4 + u * Math.min(3.5, w - 2.8)) : b.minX + 1.6 + v * Math.max(0.1, w - 3.2);
        const pz = alongX ? b.minZ + 1.6 + v * Math.max(0.1, d - 3.2) : (towardZ > 0 ? b.maxZ - 1.4 - u * Math.min(3.5, d - 2.8) : b.minZ + 1.4 + u * Math.min(3.5, d - 2.8));
        if (w < 3.2 || d < 3.2 || covered(px, pz, b.maxY)) continue;
        cluster(m, spec, r, kindNext++ % 4, px, b.maxY + 0.04, pz, alongX ? (towardX > 0 ? Math.PI / 2 : -Math.PI / 2) : (towardZ > 0 ? 0 : Math.PI), lite);
        placed++;
        break;
      }
    }
  }
  return placed;
}

// --------------------------------------------------------------------------------- landmarks

function bellTower(m: Merge, x: number, z: number, y0: number, h: number, lite: boolean): void {
  const ry = Math.atan2(-x, -z), base = mx(x, 0, z, 1, 1, 1, ry);
  const L = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number) => base.clone().multiply(mx(lx, y0 + ly, lz, sx, sy, sz));
  const body = h * 0.74, paint = 0xf1dfbc;
  m.add('solid', BOX, L(0, body / 2, 0, 5, body, 5), paint, 1.1, 0.7);
  m.add('solid', BOX, L(0, body + 0.3, 0, 5.6, 0.6, 5.6), COLORS.terracotta, 1.12);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.add('solid', BOX, L(sx * 2.0, body + 0.6 + 1.7, sz * 2.0, 0.7, 3.4, 0.7), paint);
  m.add('solid', BOX, L(0, body + 0.6 + 3.5, 0, 5.2, 0.5, 5.2), COLORS.terracotta);
  m.add('solid', lite ? CONE4 : CONE8, L(0, body + 5.6, 0, 5.4, 3.4, 5.4), COLORS.turquoise);
  m.add('solid', BOX, L(0, body + 7.9, 0, 0.25, 1.6, 0.25), COLORS.gold);
  m.add('solid', BOX, L(0, body + 8.1, 0, 0.9, 0.22, 0.22), COLORS.gold);
  if (!lite) for (const f of [0]) m.add('solid', PLANE, L(f, body + 2.2, 2.52, 1.8, 2.6, 1), COLORS.violetDeep);
}

function domeChurch(m: Merge, x: number, z: number, y0: number, h: number, lite: boolean): void {
  const ry = Math.atan2(-x, -z), base = mx(x, 0, z, 1, 1, 1, ry);
  const L = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number) => base.clone().multiply(mx(lx, y0 + ly, lz, sx, sy, sz));
  const nave = h * 0.42, paint = 0xf4e6c8;
  m.add('solid', BOX, L(0, nave / 2, 0, 14, nave, 11), paint, 1.1, 0.7);
  m.add('solid', BOX, L(0, nave + 0.25, 0, 14.6, 0.5, 11.6), COLORS.terracottaDark);
  m.add('solid', lite ? CYL8 : CYL12, L(0, nave + 0.5 + h * 0.1, 0, 7.2, h * 0.2, 7.2), paint);
  m.add('solid', DOME, L(0, nave + 0.5 + h * 0.2, 0, 7.6, 7.6, 7.6), COLORS.turquoise, 1.2);
  m.add('solid', lite ? CYL6 : CYL8, L(0, nave + 0.5 + h * 0.2 + 3.9, 0, 1.4, 1.6, 1.4), paint);
  m.add('solid', BOX, L(0, nave + h * 0.2 + 6.6, 0, 0.25, 1.5, 0.25), COLORS.gold);
  m.add('solid', BOX, L(0, nave + h * 0.2 + 6.9, 0, 0.8, 0.2, 0.2), COLORS.gold);
  m.add('solid', BOX, L(-8.3, h * 0.36, 0, 3.0, h * 0.72, 3.0), paint, 1.1, 0.7);
  m.add('solid', lite ? CONE4 : CONE8, L(-8.3, h * 0.72 + 1.4, 0, 3.2, 2.8, 3.2), COLORS.terracotta);
  if (!lite) m.add('solid', PLANE, L(0, nave * 0.4, 5.52, 2.4, 3.6, 1), COLORS.violetDeep);
}

function waterTank(m: Merge, x: number, z: number, y0: number, h: number, lite: boolean): void {
  const ry = Math.atan2(-x, -z), base = mx(x, 0, z, 1, 1, 1, ry);
  const L = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number) => base.clone().multiply(mx(lx, y0 + ly, lz, sx, sy, sz));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.add('solid', BOX, L(sx * 1.7, h / 2, sz * 1.7, 0.45, h, 0.45), 0xb7ae9c);
  m.add('solid', BOX, L(0, h * 0.5, 0, 4.2, 0.3, 0.3), 0xa89e8c);
  m.add('solid', lite ? CYL8 : CYL12, L(0, h + 1.6, 0, 5.2, 3.2, 5.2), 0xe8e2d0, 1.15);
  m.add('solid', lite ? CONE8 : CONE8, L(0, h + 3.9, 0, 5.4, 1.4, 5.4), COLORS.terracotta);
  m.add('solid', BOX, L(0, h + 1.6, 2.62, 3.4, 0.5, 0.1), COLORS.turquoise);
}

function chapel(m: Merge, x: number, z: number, y0: number): void {
  const ry = Math.atan2(-x, -z), base = mx(x, 0, z, 1, 1, 1, ry);
  const L = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, rx = 0) => base.clone().multiply(mx(lx, y0 + ly, lz, sx, sy, sz, 0, rx));
  m.add('solid', BOX, L(0, 2.2, 0, 6, 4.4, 5), 0xfaf3e4, 1.1, 0.7);
  m.add('solid', PRISM, L(0, 5.2, 0, 7.2, 5.4, 1.0, 0), COLORS.terracottaDark);
  m.add('solid', BOX, L(0, 4.7, 2.52, 1.2, 2.0, 0.1), COLORS.violetDeep);
  m.add('solid', BOX, L(0, 7.6, 0, 0.3, 3.4, 0.3), 0xfaf3e4);
  m.add('solid', BOX, L(0, 8.6, 0, 1.4, 0.3, 0.3), 0xfaf3e4);
}

// ----------------------------------------------------------------------------------- layers

/** The height of hill terraces at radius r (a stepped slope, lower at the sector's ends). */
function hillY(h: Hill, r: number, u: number): number {
  const taper = 0.4 + 0.6 * (1 - Math.min(1, Math.abs(u)) ** 2);
  return (h.base + h.slope * 1.5 * (r - h.r0)) * taper;
}

function ring(m: Merge, spec: HoodSpec, map: MapData, r: () => number, lite: boolean, clear?: { x: number; z: number }): void {
  const b = map.bounds, rows: Array<{ off: [number, number]; h: [number, number]; pitch: number }> = [
    { off: [4, 9], h: spec.ring.row0, pitch: 11 },
    { off: [15, 21], h: spec.ring.row1, pitch: 13 },
  ];
  const sides: Array<{ a: [number, number]; b: [number, number]; n: [number, number] }> = [
    { a: [b.minX - 14, b.minZ], b: [b.maxX + 14, b.minZ], n: [0, -1] }, // north
    { a: [b.minX - 14, b.maxZ], b: [b.maxX + 14, b.maxZ], n: [0, 1] }, // south
    { a: [b.minX, b.minZ], b: [b.minX, b.maxZ], n: [-1, 0] }, // west
    { a: [b.maxX, b.minZ], b: [b.maxX, b.maxZ], n: [1, 0] }, // east
  ];
  let idx = 0;
  for (const row of rows) for (const s of sides) {
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    for (let t = 0; t < len; ) {
      const w = 7 + r() * 6, d = 8 + r() * 4, h = row.h[0] + r() * (row.h[1] - row.h[0]);
      const off = row.off[0] + r() * (row.off[1] - row.off[0]);
      const tt = t + w / 2, x = s.a[0] + ((s.b[0] - s.a[0]) * tt) / len + s.n[0] * (off + d / 2), z = s.a[1] + ((s.b[1] - s.a[1]) * tt) / len + s.n[1] * (off + d / 2);
      t += w + 0.6 + r() * 2.4;
      // Accents, not a wall: the inner row is sparse (it would crowd the sky and shrink the arena), the outer row a little less so.
      if (r() < (row === rows[0] ? 0.5 : 0.3)) continue;
      // The church tower of the map's own skyline keeps its sky.
      if (clear && Math.abs(x - clear.x) < 12 && (z - clear.z) * Math.sign(clear.z || 1) > -16) continue;
      const hex = spec.palette[Math.floor(r() * spec.palette.length)]!;
      const base = house(m, spec, r, x, z, -1, w, d, h + 1, hex, lite, true);
      // A taller block now and then, and roof pieces on some.
      if (r() < 0.22 && !lite) m.add('solid', BOX, base.clone().multiply(mx(w * 0.2, h + 1 + 0.4 + 1.4, 0, w * 0.4, 2.8, d * 0.5)), spec.palette[Math.floor(r() * spec.palette.length)]!, 1.1, 0.7);
      if (r() < 0.5 * spec.clutter) cluster(m, spec, r, idx++ % 4, x + (r() - 0.5) * 2, h + 1 + 0.4, z + (r() - 0.5) * 2, Math.atan2(-x, -z), lite);
    }
  }
}

function hillside(m: Merge, spec: HoodSpec, hill: Hill, r: () => number, lite: boolean): void {
  const a0 = hill.az - hill.span / 2, rows = lite ? Math.max(4, hill.rows - 2) : hill.rows;
  for (let i = 0; i < rows; i++) {
    const rr = hill.r0 + i * hill.step * (hill.rows / rows);
    const arc = (rr * hill.span * Math.PI) / 180, n = Math.max(3, Math.round(arc / 9.6)), cell = arc / n;
    for (let j = 0; j < n; j++) {
      const u = ((j + 0.5) / n - 0.5) * 2;
      const a = ((a0 + (j + 0.5) * (hill.span / n)) * Math.PI) / 180, x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const y = hillY(hill, rr, u) + (r() - 0.5) * 1.6;
      const ry = Math.atan2(-x, -z), base = mx(x, 0, z, 1, 1, 1, ry);
      // The terrace: an earth column whose top is dry grass and whose front is a retaining wall.
      m.add('solid', BOX, base.clone().multiply(mx(0, (y - 3) / 2, 0, cell + 0.7, y + 3, hill.step * (hill.rows / rows) + 1.2)), 0xcbb08a, 1.0, 0.7, r() < 0.5 ? 0x9a9c5c : 0xb3a468);
      if (r() < 0.14) continue; // a gap: a stair, a yard
      const w = cell * (0.55 + r() * 0.35), d = hill.step * (0.45 + r() * 0.25), floors = 1 + (r() < 0.3 ? 1 : 0), h = 3.2 * floors + r() * 0.8;
      const hx = spec.palette[Math.floor(r() * spec.palette.length)]!;
      const px = x + (r() - 0.5) * 1.5, pz = z + (r() - 0.5) * 1.5;
      const hb = house(m, spec, r, px, pz, y, w, d, h, hx, lite, !lite && i < 4);
      if (!lite && r() < 0.18) cluster(m, spec, r, (i + j) % 4, px, y + h + 0.38, pz, Math.atan2(-px, -pz), lite);
      void hb;
    }
  }
}

function landmarks(m: Merge, spec: HoodSpec, lite: boolean): void {
  for (const l of spec.landmarks) {
    let x = l.x ?? 0, z = l.z ?? 0, y0 = 0;
    if (l.az !== undefined && l.r !== undefined) { x = Math.cos((l.az * Math.PI) / 180) * l.r; z = Math.sin((l.az * Math.PI) / 180) * l.r; }
    if (l.hill !== undefined) { const hh = spec.hills[l.hill]!; y0 = hillY(hh, l.r ?? hh.r0, 0) + 0.2; }
    else y0 = -1;
    if (l.kind === 'bell') bellTower(m, x, z, y0, l.h, lite);
    else if (l.kind === 'dome') domeChurch(m, x, z, y0, l.h, lite);
    else if (l.kind === 'tank') waterTank(m, x, z, y0, l.h, lite);
    else chapel(m, x, z, y0);
  }
}

/** The ridge: a hazy skyline on the sky dome (unlit, no fog: its colour is its own), taller to the hills' sides. */
function ridgeMesh(spec: HoodSpec, lite: boolean, horizon: number, deep: number, r: () => number, R: number, scale: number, haze: number): THREE.Mesh {
  const bins = lite ? 48 : 96;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const hor = new THREE.Color(horizon), top = new THREE.Color(horizon).lerp(new THREE.Color(deep), haze);
  const hAt = (deg: number) => { const f = ((deg % 360) + 360) % 360 / 30, i = Math.floor(f), t = f - i, a = spec.ridge[i % 12]!, b = spec.ridge[(i + 1) % 12]!; const s = t * t * (3 - 2 * t); return a + (b - a) * s; };
  const noise = Array.from({ length: bins }, () => 0.9 + r() * 0.2);
  for (let k = 0; k <= bins; k++) {
    const deg = (k / bins) * 360, a = (deg * Math.PI) / 180, hgt = hAt(deg) * scale * noise[k % bins]!;
    pos.push(Math.cos(a) * R, -2, Math.sin(a) * R, Math.cos(a) * R, hgt, Math.sin(a) * R);
    col.push(hor.r, hor.g, hor.b, top.r, top.g, top.b);
    if (k < bins) { const i = k * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false }));
  mesh.name = 'hood-ridge';
  mesh.frustumCulled = false;
  return mesh;
}

// ------------------------------------------------------------------------------------ build

/**
 * Builds the neighbourhood for an arena map: roof clusters on its tall houses, the near ring, the
 * hillside sectors, the landmarks and the ridge. `horizon` and `deep` are the theme's horizon colour
 * and a deeper tone for the ridge.
 */
export function buildNeighborhood(map: MapData, quality: Quality, horizon: number, deep: number, clear?: { x: number; z: number }): HoodResult | null {
  const spec = SPECS[map.id ?? 'patio'];
  if (!spec) return null;
  const lite = quality === 'low';
  const r = rng(spec.seed);
  const near = new Merge(), far = new Merge();
  roofClusters(near, spec, map.boxes, r, lite);
  ring(far, spec, map, r, lite, clear);
  for (const h of spec.hills) hillside(far, spec, h, r, lite);
  landmarks(far, spec, lite);

  const kit = kitMaterials(quality);
  const keep: Record<Tone, THREE.Material> = { solid: kit.flat, cloth: kit.leaf, lamp: kit.lamp };
  for (const [k, mat] of Object.entries(kit)) if (!Object.values(keep).includes(mat)) { void k; mat.dispose(); }
  const group = new THREE.Group();
  group.name = 'neighborhood';
  let calls = 0, tris = 0;
  // Distance haze: far scenery blends toward the horizon colour so each layer recedes (and dusk shade cannot turn it black).
  const hazeC = new THREE.Color(horizon), tmp = new THREE.Color();
  const haze = (g: THREE.BufferGeometry) => {
    const p = g.getAttribute('position') as THREE.BufferAttribute, c = g.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!c) return;
    for (let i = 0; i < p.count; i++) {
      const t = Math.min(1, Math.max(0, (Math.hypot(p.getX(i), p.getZ(i)) - 40) / 85)) * 0.6;
      tmp.setRGB(c.getX(i), c.getY(i), c.getZ(i)).lerp(hazeC, t);
      c.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
  };
  const emit = (m: Merge, label: string, shadows: boolean) => {
    for (const tone of ['solid', 'cloth', 'lamp'] as Tone[]) {
      const gs = m.sets[tone];
      if (!gs.length) continue;
      if (!shadows && tone === 'solid') gs.forEach(haze);
      const merged = mergeGeometries(gs, false);
      gs.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, keep[tone]);
      mesh.name = `hood-${label}-${tone}`;
      mesh.receiveShadow = shadows;
      mesh.castShadow = false;
      group.add(mesh);
      calls++;
      tris += (merged.index ? merged.index.count : (merged.getAttribute('position') as THREE.BufferAttribute).count) / 3;
    }
  };
  emit(near, 'roofs', true);
  emit(far, 'far', false);
  // Two hazy layers: a pale far one and a deeper, lower one in front of it.
  for (const [R, scale, haze] of [[150, 1.6, 0.4], [132, 1.0, 0.68]] as const) {
    const ridgeM = ridgeMesh(spec, lite, horizon, deep, r, R, scale, haze);
    ridgeM.renderOrder = R > 140 ? -2 : -1;
    group.add(ridgeM); calls++; tris += (ridgeM.geometry.index?.count ?? 0) / 3;
  }
  return { group, calls, tris: Math.round(tris), fog: spec.fog };
}
