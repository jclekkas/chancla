// La Fiesta's own props at the El Patio kit's quality (see map-dressing.ts).
// Owned by the La Fiesta workstream; the arena (world.ts) routes this map's
// box types and decor listed below here.
//
// A dusk party courtyard, drawn from the same authoritative boxes, so
// collision, cover and sight lines are unchanged:
//  - hedges: clipped box hedges in a low cantera kerb, the leaf mass
//    lumpy, leaf-textured and mottled, with a few clusters of blossom.
//    The leaf mass fills the whole box (cover stays opaque to full height);
//  - party tables: a full-length pleated cloth with a serape-striped hem
//    and a lace edge, a cream top with a runner, and clay cazuelas, plates
//    and little vases on it (all under the box's top);
//  - gift stacks: wrapped presents with lids, ribbons and a bow on top,
//    the upper ones turned a little, all inside the footprint;
//  - the two tarimas: a cantera plinth, a pleated violet skirt with a gold
//    hem, a painted fascia with a papel picado valance and a plank deck;
//  - the dance floor: a round mosaic of glazed tiles in turning colour
//    sectors with grout lines, a star medallion and a talavera border,
//    flush with the ground.
// Every vertex stays inside its box's footprint (trim at most 6 cm) and at
// or under its box's top; tests/fiesta-dressing.test.ts holds these bounds.
//
// One mesh per material: leaf, painted (flat), wrapping paper, wood,
// cantera, floor tiles, the floor's talavera border and the contact
// shadows: eight draw calls for the whole map. Low drops the pleats, the
// blossoms, the table goods and the valance, coarsens the hedges' lumps and
// the bows, and casts no shadows.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapBox, MapDecor } from '../../../shared/map';
import type { Quality } from '../settings';
import type { DressingModule } from './map-dressing';
import { COLORS, boxGeo, toonRamp } from './materials';
import { kitMaterials, noBackfaceShadow } from './patio-materials';

const C = {
  leafDeep: 0x2f5a2c, leafMid: 0x4c8a3e, leafLit: 0x7cbc5a, kerb: 0xd6bf98, kerbCap: 0xe4d2b0,
  cream: 0xf4e6c8, lace: 0xfbf3e2, clay: 0xb85a3c, clayDark: 0x6e2f1f, plate: 0xf2ece0,
  grout: 0x4a3a40, stageCore: 0x2a1a22, fascia: 0xe8a33a, gold: COLORS.gold,
} as const;
const PAPEL = [COLORS.pink, COLORS.turquoise, COLORS.marigold, COLORS.violet] as const;

type MatKey = 'leaf' | 'flat' | 'wrap' | 'wood' | 'cantera' | 'floor' | 'border' | 'shadow';
const ORDER: readonly MatKey[] = ['leaf', 'flat', 'wrap', 'wood', 'cantera', 'floor', 'border', 'shadow'];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Geometry per material, normalised (non-indexed; position, normal, uv, colour) so it merges. */
class Bucket {
  readonly parts = new Map<MatKey, THREE.BufferGeometry[]>();
  /** Adds a copy of `g` tinted by `hex` (its own vertex colours, if any, are kept and tinted); `g` is disposed unless `shared`. */
  add(k: MatKey, g: THREE.BufferGeometry, hex = 0xffffff, m?: THREE.Matrix4, shared = false): void {
    const n = g.index ? g.toNonIndexed() : g.clone();
    if (m) n.applyMatrix4(m);
    for (const name of Object.keys(n.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') n.deleteAttribute(name);
    const count = n.getAttribute('position').count;
    if (!n.getAttribute('normal')) n.computeVertexNormals();
    if (!n.getAttribute('uv')) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    // RGBA only for the shadows, so the kit materials keep their usual RGB vertex-colour program.
    const w = k === 'shadow' ? 4 : 3;
    const col = new THREE.Color(hex), out = new Float32Array(count * w), src = n.getAttribute('color');
    for (let i = 0; i < count; i++) {
      out[i * w] = col.r * (src ? src.getX(i) : 1); out[i * w + 1] = col.g * (src ? src.getY(i) : 1); out[i * w + 2] = col.b * (src ? src.getZ(i) : 1);
      if (w === 4) out[i * 4 + 3] = src && src.itemSize === 4 ? src.getW(i) : 1;
    }
    n.setAttribute('color', new THREE.BufferAttribute(out, w));
    if (!this.parts.has(k)) this.parts.set(k, []);
    this.parts.get(k)!.push(n);
    if (!shared) g.dispose();
  }
  box(k: MatKey, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: number, scale = 1, faces = 63, m?: THREE.Matrix4): void {
    this.add(k, boxGeo(x0, y0, z0, x1, y1, z1, scale, faces), hex, m);
  }
  merged(k: MatKey): THREE.BufferGeometry | null {
    const list = this.parts.get(k);
    if (!list?.length) return null;
    const g = mergeGeometries(list, false)!;
    for (const p of list) p.dispose();
    g.computeBoundingSphere();
    return g;
  }
}

/** An indexed geometry from flat arrays (colours linear RGB, optional). */
function mesh(pos: number[], idx: number[], col?: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Normals straight up (flat floor pieces). */
function upNormals(g: THREE.BufferGeometry): void {
  const n = g.getAttribute('position').count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a[i * 3 + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(a, 3));
}

const lin = (hex: number) => new THREE.Color(hex);
const shadeHex = (hex: number, k: number) => new THREE.Color(hex).multiplyScalar(k).getHex();

// ------------------------------------------------------------------ cloth

interface Band { y0: number; y1: number; hex: number }
type Side = 'n' | 's' | 'e' | 'w';

/**
 * A hanging cloth round a footprint: horizontal colour bands, each a strip
 * of vertical pleats that swing out a little more towards the hem (at most
 * `amp` past the footprint). The pleats fall to nothing at each corner, so
 * the sides meet without gaps. `step` = 0 draws flat sides (Low).
 */
function skirt(bk: Bucket, b: MapBox, sides: readonly Side[], bands: readonly Band[], amp: number, step: number, period = 0.24): void {
  const yTop = Math.max(...bands.map((x) => x.y1)), yBot = Math.min(...bands.map((x) => x.y0));
  for (const side of sides) {
    // Start, direction along the side (direction x up = outward normal), outward normal, length.
    const [sx, sz, tx, tz, nx, nz, L] =
      side === 's' ? [b.minX, b.maxZ, 1, 0, 0, 1, b.maxX - b.minX]
        : side === 'n' ? [b.maxX, b.minZ, -1, 0, 0, -1, b.maxX - b.minX]
          : side === 'e' ? [b.maxX, b.maxZ, 0, -1, 1, 0, b.maxZ - b.minZ]
            : [b.minX, b.minZ, 0, 1, -1, 0, b.maxZ - b.minZ];
    const cols = step > 0 ? Math.max(2, Math.round(L / step)) : 1;
    const m = Math.max(1, Math.round(L / period));
    for (const band of bands) {
      const pos: number[] = [], idx: number[] = [], col: number[] = [];
      const c = lin(band.hex);
      for (let i = 0; i <= cols; i++) {
        const s = (i / cols) * L, fold = step > 0 ? Math.sin((Math.PI * m * s) / L) ** 2 : 0;
        for (const y of [band.y0, band.y1]) {
          const hang = 1 - (y - yBot) / Math.max(0.01, yTop - yBot); // 1 at the hem, 0 at the top
          const o = amp * fold * (0.25 + 0.75 * hang);
          // The pleats' valleys a touch darker, so the folds read even in flat light.
          const k = 0.86 + 0.14 * fold;
          pos.push(sx + tx * s + nx * o, y, sz + tz * s + nz * o);
          col.push(c.r * k, c.g * k, c.b * k);
        }
      }
      for (let i = 0; i < cols; i++) { const a = i * 2; idx.push(a, a + 2, a + 3, a, a + 3, a + 1); }
      bk.add('flat', mesh(pos, idx, col));
    }
  }
}

// ------------------------------------------------------------------ hedges

/** A smooth, deterministic displacement field (same point, same offset, so the lumpy box stays watertight). y is always down. */
function lump(x: number, y: number, z: number): [number, number, number] {
  const a = Math.sin(x * 9.3 + y * 6.1 + 1.3) * Math.sin(z * 8.7 - y * 10.9 + 0.7);
  const b = Math.sin(x * 15.7 - z * 12.1 + y * 4.3 + 2.1);
  const c = Math.sin(z * 14.3 + x * 5.9 - y * 9.7 + 0.4) * Math.sin(y * 7.3 + x * 3.1);
  return [0.65 * a + 0.35 * c, -(0.5 + 0.5 * (0.6 * b + 0.4 * a)), 0.65 * b + 0.35 * c];
}

/**
 * The leaf mass: a box subdivided every `seg` metres and pushed in and out
 * by a few centimetres, mottled darker in the hollows and low down and
 * lighter on the bumps and towards the top.
 */
function leafMass(bk: Bucket, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, seg: number, amp: number): void {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, out = 0.03;
  const faces: Array<{ o: number[]; u: number[]; v: number[]; n: number[] }> = [
    { o: [x1, y0, z1], u: [0, 0, -dz], v: [0, dy, 0], n: [1, 0, 0] },
    { o: [x0, y0, z0], u: [0, 0, dz], v: [0, dy, 0], n: [-1, 0, 0] },
    { o: [x0, y0, z1], u: [dx, 0, 0], v: [0, dy, 0], n: [0, 0, 1] },
    { o: [x1, y0, z0], u: [-dx, 0, 0], v: [0, dy, 0], n: [0, 0, -1] },
    { o: [x0, y1, z1], u: [dx, 0, 0], v: [0, 0, -dz], n: [0, 1, 0] },
  ];
  const deep = lin(C.leafDeep), mid = lin(C.leafMid), lit = lin(C.leafLit), tmp = new THREE.Color();
  for (const f of faces) {
    const lu = Math.hypot(f.u[0]!, f.u[1]!, f.u[2]!), lv = Math.hypot(f.v[0]!, f.v[1]!, f.v[2]!);
    const nu = Math.max(1, Math.round(lu / seg)), nv = Math.max(1, Math.round(lv / seg));
    const pos: number[] = [], idx: number[] = [], col: number[] = [], uv: number[] = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      uv.push((i / nu) * lu / LEAF_TEX_M, (j / nv) * lv / LEAF_TEX_M);
      let x = f.o[0]! + f.u[0]! * (i / nu) + f.v[0]! * (j / nv);
      let y = f.o[1]! + f.u[1]! * (i / nu) + f.v[1]! * (j / nv);
      let z = f.o[2]! + f.u[2]! * (i / nu) + f.v[2]! * (j / nv);
      const [ox, oy, oz] = lump(x, y, z);
      const ground = y <= y0 + 1e-6;
      // Sideways lumps fade out at the foot, so the leaves stay tucked inside the kerb.
      const foot = Math.min(1, (y - y0) / 0.18), sa = amp * foot * foot;
      x = Math.min(x1 + out, Math.max(x0 - out, x + ox * sa));
      z = Math.min(z1 + out, Math.max(z0 - out, z + oz * sa));
      if (!ground) y = Math.min(y1, Math.max(y0, y + oy * amp * 0.7));
      // Bump: how far out of the face this point moved (-1..1).
      const bump = f.n[1] ? 1 + 2 * oy : ox * f.n[0]! + oz * f.n[2]!;
      const h = (y - y0) / dy;
      const t = Math.min(1, Math.max(0, 0.22 + 0.45 * h + 0.35 * bump));
      tmp.copy(t < 0.5 ? deep : mid).lerp(t < 0.5 ? mid : lit, t < 0.5 ? t * 2 : (t - 0.5) * 2);
      pos.push(x, y, z); col.push(tmp.r, tmp.g, tmp.b);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 2, d = a + nu + 1;
      idx.push(a, b, c, a, c, d);
    }
    const g = mesh(pos, idx, col);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    bk.add('leaf', g);
  }
}

interface Shared { bud: THREE.BufferGeometry }

/**
 * A clipped hedge in a low cantera kerb. The leaf mass fills the box from
 * the kerb to its top (full cover); on High and Medium, a few clusters of
 * blossom on the long faces.
 */
function hedge(bk: Bucket, b: MapBox, q: Quality, sh: Shared, r: () => number): void {
  const kerbH = 0.16, t = 0.03;
  bk.box('cantera', b.minX - t, 0, b.minZ - t, b.maxX + t, kerbH - 0.03, b.maxZ + t, C.kerb, 1.2, 63 & ~8 & ~4);
  bk.box('cantera', b.minX - t - 0.005, kerbH - 0.03, b.minZ - t - 0.005, b.maxX + t + 0.005, kerbH, b.maxZ + t + 0.005, C.kerbCap, 1.2, 63 & ~8);
  const seg = q === 'high' ? 0.2 : q === 'medium' ? 0.28 : 0.42;
  leafMass(bk, b.minX, kerbH - 0.02, b.minZ, b.maxX, b.maxY, b.maxZ, seg, q === 'low' ? 0.03 : 0.045);
  if (q === 'low') return;
  const w = b.maxX - b.minX, d = b.maxZ - b.minZ, alongX = w >= d, long = Math.max(w, d);
  // Blossom clusters on both long faces, half sunk into the leaves.
  const clusters = Math.max(1, Math.round(long / (q === 'high' ? 1.3 : 2.4)));
  for (let k = 0; k < clusters; k++) for (const sgn of [-1, 1]) {
    const a = (k + 0.2 + r() * 0.6) / clusters, y = 0.45 + r() * (b.maxY - 0.75), hex = r() < 0.6 ? COLORS.pink : COLORS.marigold;
    // Round blossoms, a few centimetres proud of the leaves.
    for (let j = 0; j < 3; j++) {
      const da = (j - 1) * 0.065 + (r() - 0.5) * 0.02, dy = (j % 2) * 0.055 + (r() - 0.5) * 0.02;
      const x = alongX ? b.minX + w * a + da : (sgn > 0 ? b.maxX : b.minX);
      const z = alongX ? (sgn > 0 ? b.maxZ : b.minZ) : b.minZ + d * a + da;
      const s = 0.08 + r() * 0.015, flatS = new THREE.Vector3(alongX ? s : 0.06, s, alongX ? 0.06 : s);
      bk.add('flat', sh.bud, j === 1 ? shadeHex(hex, 0.85) : hex, new THREE.Matrix4().compose(new THREE.Vector3(x, y + dy, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, j * 0.9)), flatS), true);
    }
  }
}

// ------------------------------------------------------------------ tables

/**
 * A party table under a full-length cloth (no gap under it, as the box is
 * solid): pleated sides in the table's colour, a serape hem of three
 * stripes, a lace edge, a cream top with a runner and, on High and Medium,
 * cazuelas, plates and little vases, all at or under the box's top.
 */
function table(bk: Bucket, b: MapBox, q: Quality, idx: number, sh: Shared): void {
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, w = b.maxX - b.minX, d = b.maxZ - b.minZ;
  const cloth = Math.round(cx + cz) % 2 ? COLORS.pink : COLORS.turquoise;
  const other = cloth === COLORS.pink ? COLORS.turquoise : COLORS.pink;
  const topY = b.maxY - 0.08, skirtTop = topY - 0.02;
  const bands: Band[] = [
    { y0: 0, y1: 0.05, hex: shadeHex(cloth, 0.7) },
    { y0: 0.05, y1: 0.1, hex: COLORS.marigold },
    { y0: 0.1, y1: 0.16, hex: COLORS.violet },
    { y0: 0.16, y1: skirtTop - 0.07, hex: cloth },
    { y0: skirtTop - 0.07, y1: skirtTop, hex: C.lace },
  ];
  skirt(bk, b, ['n', 's', 'e', 'w'], bands, 0.026, q === 'high' ? 0.1 : q === 'medium' ? 0.2 : 0);
  // The top: the cloth's cream top, a little proud of the skirt, and a runner.
  const o = 0.03;
  bk.box('flat', b.minX - o, skirtTop, b.minZ - o, b.maxX + o, topY, b.maxZ + o, C.cream, 1, 63 & ~8);
  const alongX = w >= d, rw = Math.min(w, d) * 0.34;
  if (alongX) bk.box('flat', b.minX - o - 0.002, topY - 0.06, cz - rw / 2, b.maxX + o + 0.002, topY + 0.003, cz + rw / 2, other, 1, 63 & ~8);
  else bk.box('flat', cx - rw / 2, topY - 0.06, b.minZ - o - 0.002, cx + rw / 2, topY + 0.003, b.maxZ + o + 0.002, other, 1, 63 & ~8);
  if (q === 'low') return;
  // Goods along the runner, kept under the box's top (8 cm of room).
  const long = Math.max(w, d), n = q === 'high' ? Math.max(2, Math.floor((long - 0.3) / 0.55)) : 2;
  const y = topY + 0.003;
  const at = (gx: number, gy: number, gz: number) => new THREE.Matrix4().makeTranslation(gx, gy, gz);
  for (let i = 0; i < n; i++) {
    const a = -long / 2 + 0.15 + (i + 0.5) * ((long - 0.3) / n), side = (i % 2 ? 1 : -1) * Math.min(w, d) * 0.12;
    const x = alongX ? cx + a : cx + side, z = alongX ? cz + side : cz + a;
    const kind = q === 'medium' ? 0 : (i + idx) % 3;
    if (kind === 0) {
      // A clay cazuela: a wide bowl with a dark inside and a rolled rim.
      bk.add('flat', new THREE.CylinderGeometry(0.13, 0.095, 0.06, 10, 1, true), C.clay, at(x, y + 0.03, z));
      bk.add('flat', new THREE.CircleGeometry(0.122, 10).rotateX(-Math.PI / 2), C.clayDark, at(x, y + 0.05, z));
      if (q === 'high') bk.add('flat', new THREE.TorusGeometry(0.128, 0.012, 3, 10).rotateX(Math.PI / 2), C.clay, at(x, y + 0.06, z));
    } else if (kind === 1) {
      // A stack of plates.
      bk.add('flat', new THREE.CylinderGeometry(0.11, 0.085, 0.035, 10, 1, true), C.plate, at(x, y + 0.0175, z));
      bk.add('flat', new THREE.CircleGeometry(0.11, 10).rotateX(-Math.PI / 2), PAPEL[(i + idx) % 4]!, at(x, y + 0.036, z));
    } else {
      // A little clay vase with a paper flower.
      bk.add('flat', new THREE.CylinderGeometry(0.03, 0.04, 0.045, 8), C.clay, at(x, y + 0.0225, z));
      bk.add('flat', sh.bud, PAPEL[(i + idx + 1) % 4]!, new THREE.Matrix4().compose(new THREE.Vector3(x, y + 0.05, z), new THREE.Quaternion(), new THREE.Vector3(0.07, 0.05, 0.07)), true);
    }
  }
}

// ------------------------------------------------------------------ gifts

/**
 * One present in a local frame (origin at the centre of its base): wrapped
 * body, a lid a touch wider, and a ribbon crossing every side and the lid.
 */
function present(bk: Bucket, m: THREE.Matrix4, w: number, h: number, d: number, paper: number, ribbon: number): void {
  const lid = Math.min(0.08, h * 0.2), lo = 0.012, rb = Math.min(0.1, Math.min(w, d) * 0.14), e = 0.005;
  bk.box('wrap', -w / 2, 0, -d / 2, w / 2, h - lid, d / 2, paper, 0.5, 63 & ~8 & ~4, m);
  bk.box('flat', -w / 2 - lo, h - lid, -d / 2 - lo, w / 2 + lo, h, d / 2 + lo, shadeHex(paper, 0.88), 1, 63, m);
  // Ribbon: round the body along x and along z, and across the lid.
  bk.box('flat', -rb / 2, 0, -d / 2 - e, rb / 2, h - lid, d / 2 + e, ribbon, 1, 1 | 2 | 16 | 32, m);
  bk.box('flat', -w / 2 - e, 0, -rb / 2, w / 2 + e, h - lid, rb / 2, ribbon, 1, 1 | 2 | 16 | 32, m);
  bk.box('flat', -rb / 2, h - lid, -d / 2 - lo - e, rb / 2, h + e, d / 2 + lo + e, ribbon, 1, 63 & ~8, m);
  bk.box('flat', -w / 2 - lo - e, h - lid, -rb / 2, w / 2 + lo + e, h + e, rb / 2, ribbon, 1, 63 & ~8, m);
}

/** A bow: two loops and a knot, standing on a lid (its top at most `BOW_H` over the lid). */
const BOW_H = 0.16;
function bow(bk: Bucket, m: THREE.Matrix4, hex: number, q: Quality): void {
  const loop = new THREE.TorusGeometry(0.066, 0.02, q === 'high' ? 5 : 4, q === 'high' ? 10 : 8);
  for (const s of [-1, 1]) {
    const l = new THREE.Matrix4().compose(new THREE.Vector3(s * 0.06, 0.065, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, s * 0.55)), new THREE.Vector3(1, 0.95, 0.7));
    bk.add('flat', loop, hex, m.clone().multiply(l), true);
  }
  loop.dispose();
  bk.add('flat', new THREE.SphereGeometry(0.036, 6, 4), shadeHex(hex, 0.85), m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.03, 0)));
}

/**
 * A stack of presents filling the box: the bottom tier covers the
 * footprint (two side by side on a long box), the upper ones are smaller
 * and turned a little, with a bow on the top one. Every corner, turned or
 * not, stays inside the footprint.
 */
function gifts(bk: Bucket, b: MapBox, q: Quality, idx: number): void {
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, w = b.maxX - b.minX, d = b.maxZ - b.minZ, H = b.maxY;
  const k = Math.abs(Math.round(cx * 3 + cz * 7)) + idx;
  const paper = (i: number) => PAPEL[(k + i) % 4]!;
  const ribbon = (i: number) => [C.gold, C.lace, COLORS.pink, C.gold][(k + i) % 4]!;
  const alongX = w >= d, long = Math.max(w, d), short = Math.min(w, d), i0 = 0.02;
  const tall = H > 1.4;
  const h0 = Math.round(H * (tall ? 0.53 : 0.56) * 100) / 100;
  const n = Math.max(1, Math.round(long / 1.15)), seg = long / n;
  for (let i = 0; i < n; i++) {
    const a = -long / 2 + (i + 0.5) * seg;
    const pw = (alongX ? seg : short) - 2 * i0 - (n > 1 ? 0.02 : 0), pd = (alongX ? short : seg) - 2 * i0 - (n > 1 ? 0.02 : 0);
    const m = new THREE.Matrix4().makeTranslation(cx + (alongX ? a : 0), 0, cz + (alongX ? 0 : a));
    present(bk, m, pw - 0.03, h0, pd - 0.03, paper(i), ribbon(i));
  }
  // Upper tiers: a turned present and, on a tall stack, a smaller one on it.
  const tiers: Array<{ s: number; t: number; rot: number }> = tall ? [{ s: 0.74, t: 0.45, rot: 0.21 }, { s: 0.5, t: 0, rot: -0.3 }] : [{ s: 0.62, t: 0, rot: 0.14 }];
  let y = h0;
  for (let j = 0; j < tiers.length; j++) {
    const tr = tiers[j]!, last = j === tiers.length - 1, ar = Math.abs(tr.rot);
    const hh = last ? H - BOW_H - y : tr.t;
    // Size so the turned corners stay inside: half-extent = s/2 (cos + sin) <= short/2 - inset.
    const fit = (short / 2 - i0 - 0.02) / (Math.cos(ar) + Math.sin(ar));
    let pw = Math.min(short * tr.s, 2 * fit), pd = pw;
    if (n > 1) pd = Math.min(long * 0.45, ((long / 2 - i0 - 0.02 - (pw / 2) * Math.sin(ar)) * 2) / Math.cos(ar));
    if (n > 1) pw = Math.min(pw, ((short / 2 - i0 - 0.02 - (pd / 2) * Math.sin(ar)) * 2) / Math.cos(ar));
    const rot = new THREE.Matrix4().makeRotationY(tr.rot + (alongX ? Math.PI / 2 : 0));
    const m = new THREE.Matrix4().makeTranslation(cx, y, cz).multiply(rot);
    present(bk, m, pw, hh, pd, paper(j + n), ribbon(j + n + 1));
    y += hh;
    if (last) {
      const bm = m.clone().multiply(new THREE.Matrix4().makeTranslation(0, hh, 0));
      if (q === 'low') bk.add('flat', new THREE.SphereGeometry(0.06, 6, 4).scale(1.4, 1, 0.8), ribbon(j + n + 1), bm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.05, 0)));
      else bow(bk, bm, ribbon(j + n + 1), q);
    }
  }
}

// ------------------------------------------------------------------ stages

/**
 * The band's tarima: a cantera plinth, a pleated violet skirt with a gold
 * hem, a painted fascia under the deck's edge with a papel picado valance
 * (High and Medium), and a deck of planks over a dark core so the gaps
 * read. The back, against the houses, has no skirt.
 */
function stage(bk: Bucket, b: MapBox, q: Quality): void {
  const cz = (b.minZ + b.maxZ) / 2, cx = (b.minX + b.maxX) / 2, w = b.maxX - b.minX, d = b.maxZ - b.minZ, top = b.maxY;
  const alongX = w >= d;
  // The back: the long side facing away from the arena's middle.
  const back: Side = alongX ? (cz < 0 ? 'n' : 's') : (cx < 0 ? 'w' : 'e');
  const sides = (['n', 's', 'e', 'w'] as Side[]).filter((s) => s !== back);
  const plinth = 0.12, fasciaY = top - 0.16, deckY = top - 0.04, t = 0.02;
  bk.box('cantera', b.minX - t, 0, b.minZ - t, b.maxX + t, plinth, b.maxZ + t, C.kerb, 1.2, 63 & ~8);
  skirt(bk, b, sides, [
    { y0: plinth, y1: plinth + 0.08, hex: C.gold },
    { y0: plinth + 0.08, y1: fasciaY, hex: COLORS.violet },
  ], 0.025, q === 'high' ? 0.1 : q === 'medium' ? 0.2 : 0, 0.3);
  bk.box('flat', b.minX - t, fasciaY, b.minZ - t, b.maxX + t, deckY, b.maxZ + t, C.fascia, 1, 63 & ~8 & ~4);
  bk.box('flat', b.minX, fasciaY, b.minZ, b.maxX, deckY - 0.005, b.maxZ, C.stageCore, 1, 4);
  // Deck planks run across the stage (the wood grain runs along them), small gaps between.
  const span = alongX ? w : d, nP = Math.round(span / 0.2), pw = span / nP;
  for (let i = 0; i < nP; i++) {
    const a0 = (alongX ? b.minX : b.minZ) + i * pw + 0.006, a1 = a0 + pw - 0.012;
    if (alongX) bk.box('wood', a0, deckY, b.minZ, a1, top, b.maxZ, 0xffffff, 0.6, 63 & ~8);
    else bk.box('wood', b.minX, deckY, a0, b.maxX, top, a1, 0xffffff, 0.6, 63 & ~8);
  }
  if (q === 'low') return;
  // Papel picado valance: little paper triangles hanging under the fascia.
  for (const side of sides) {
    const ns = side === 'n' || side === 's', L = ns ? w : d, n = Math.round(L / 0.22);
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const x = ns ? b.minX + w * u : (side === 'e' ? b.maxX + t + 0.004 : b.minX - t - 0.004);
      const z = ns ? (side === 's' ? b.maxZ + t + 0.004 : b.minZ - t - 0.004) : b.minZ + d * u;
      const tri = new THREE.ConeGeometry(0.09, 0.12, 3).rotateX(Math.PI).scale(1, 1, 0.08).rotateY(ns ? 0 : Math.PI / 2);
      bk.add('flat', tri, PAPEL[i % 4]!, new THREE.Matrix4().makeTranslation(x, fasciaY - 0.06, z));
    }
  }
}

// ------------------------------------------------------------------ dance floor

/**
 * The dance floor: rings of glazed tiles with grout between them, coloured
 * in turning sectors (a pinwheel), a marigold star on violet in the middle,
 * a cream band and a talavera border. Flat on the ground, nothing overlapping.
 */
function danceFloor(bk: Bucket, df: { x: number; z: number; r: number }, q: Quality): void {
  const pos: number[] = [], idx: number[] = [], col: number[] = [];
  const put = (x: number, z: number, c: THREE.Color) => { pos.push(df.x + x, 0, df.z + z); col.push(c.r, c.g, c.b); return pos.length / 3 - 1; };
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d);
  const P = (rr: number, a: number) => [Math.cos(a) * rr, Math.sin(a) * rr] as const;
  const grout = lin(C.grout), white = new THREE.Color(1, 1, 1), pal = PAPEL.map(lin), r = rng(97);
  const border = df.r - 0.34, band = border - 0.1, med = 0.62;
  // Tile rings from the medallion to the band; each tile framed by its own grout strips.
  const rings = Math.max(1, Math.round((band - med) / 0.42)), rw = (band - med) / rings, g = 0.018;
  for (let k = 0; k < rings; k++) {
    const r0 = med + k * rw, r1 = r0 + rw, n = Math.max(8, Math.round((Math.PI * (r0 + r1)) / 0.42 / 8) * 8);
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, sector = Math.floor((i / n) * 8);
      const tile = pal[(sector + k) % 4]!.clone().multiplyScalar(0.9 + r() * 0.16);
      const glaze = tile.clone().lerp(white, q === 'low' ? 0 : 0.2);
      const o = [P(r0, a0), P(r0, a1), P(r1, a1), P(r1, a0)];
      const t = [P(r0 + g, a0 + g / r0), P(r0 + g, a1 - g / r0), P(r1 - g, a1 - g / r1), P(r1 - g, a0 + g / r1)];
      const vo = o.map(([x, z]) => put(x, z, grout));
      const vt = t.map(([x, z], j) => put(x, z, j === 2 ? glaze : tile));
      for (let j = 0; j < 4; j++) { const j1 = (j + 1) % 4; quad(vo[j]!, vo[j1]!, vt[j1]!, vt[j]!); }
      quad(vt[0]!, vt[1]!, vt[2]!, vt[3]!);
    }
  }
  // Medallion: an eight-point marigold star, violet round it.
  const gold = lin(C.gold), star = lin(COLORS.marigold), violet = lin(COLORS.violetDeep);
  const c0 = put(0, 0, gold), sp: number[] = [], sv: number[] = [], cv: number[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, rr = i % 2 ? med * 0.42 : med * 0.86;
    sp.push(put(...P(rr, a), star)); sv.push(put(...P(rr, a), violet)); cv.push(put(...P(med, a), violet));
  }
  for (let i = 0; i < 16; i++) { const j = (i + 1) % 16; idx.push(c0, sp[j]!, sp[i]!); quad(sv[i]!, sv[j]!, cv[j]!, cv[i]!); }
  // Cream band between the tiles and the border.
  const nb = q === 'low' ? 48 : 96, cream = lin(C.cream), inner: number[] = [], outer: number[] = [];
  for (let i = 0; i < nb; i++) { const a = (i / nb) * Math.PI * 2; inner.push(put(...P(band, a), cream)); outer.push(put(...P(border, a), cream)); }
  for (let i = 0; i < nb; i++) { const j = (i + 1) % nb; quad(inner[i]!, inner[j]!, outer[j]!, outer[i]!); }
  // The medallion's ring and the band meet the tile rings on the same circles; the band's
  // 96 sides and the tiles' chords differ by under 3 mm, below what the eye resolves.
  const floor = mesh(pos, idx, col);
  upNormals(floor);
  bk.add('floor', floor);
  // Talavera border: one whole tile per segment.
  const nt = Math.round((Math.PI * (border + df.r)) / 0.34);
  const bp: number[] = [], bu: number[] = [], bi: number[] = [];
  for (let i = 0; i < nt; i++) {
    const a0 = (i / nt) * Math.PI * 2, a1 = ((i + 1) / nt) * Math.PI * 2, u0 = (i % 4) * 0.25, v0 = (Math.floor(i / 4) % 4) * 0.25;
    const base = bp.length / 3;
    for (const [rr, a] of [[border, a0], [border, a1], [df.r, a1], [df.r, a0]] as const) bp.push(df.x + Math.cos(a) * rr, 0, df.z + Math.sin(a) * rr);
    bu.push(u0, v0, u0 + 0.25, v0, u0 + 0.25, v0 + 0.25, u0, v0 + 0.25);
    bi.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
  bg.setAttribute('uv', new THREE.Float32BufferAttribute(bu, 2));
  bg.setIndex(bi);
  upNormals(bg);
  bk.add('border', bg);
}

// ------------------------------------------------------------------ contact shadows

/** A soft dark band on the paving round a footprint (no shadow map needed, so Low keeps it). */
function contactShadow(bk: Bucket, b: MapBox, width: number, s: number): void {
  const x0 = b.minX, x1 = b.maxX, z0 = b.minZ, z1 = b.maxZ, o = width, y = 0.006;
  const pos: number[] = [], col: number[] = [];
  const quad = (a: number[], bb: number[], c: number[], d: number[]) => {
    pos.push(...a, ...bb, ...c, ...a, ...c, ...d);
    for (const al of [s, s, 0, s, 0, 0]) col.push(1, 1, 1, al);
  };
  quad([x0, y, z1], [x1, y, z1], [x1 + o, y, z1 + o], [x0 - o, y, z1 + o]);
  quad([x1, y, z0], [x0, y, z0], [x0 - o, y, z0 - o], [x1 + o, y, z0 - o]);
  quad([x1, y, z1], [x1, y, z0], [x1 + o, y, z0 - o], [x1 + o, y, z1 + o]);
  quad([x0, y, z0], [x0, y, z1], [x0 - o, y, z1 + o], [x0 - o, y, z0 - o]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  upNormals(g);
  bk.add('shadow', g, 0x2a1810);
}

// ------------------------------------------------------------------ materials

/** Wrapping paper (1 texture = 0.5 m): white with soft, slightly darker dots, tinted by the paper's colour. */
let wrapTex: THREE.CanvasTexture | null | undefined;
function wrapTexture(q: Quality): THREE.CanvasTexture | null {
  if (wrapTex === undefined) {
    wrapTex = null;
    const el = typeof document === 'undefined' ? null : document.createElement('canvas');
    const c = el?.getContext('2d');
    if (el && c) {
      const S = 128;
      el.width = el.height = S;
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, S, S);
      c.fillStyle = 'rgba(70,40,60,0.22)';
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        const x = (i + (j % 2) * 0.5) * (S / 4) + S / 8, y = j * (S / 4) + S / 8;
        for (const ox of [-S, 0, S]) { c.beginPath(); c.arc(x + ox, y, 7, 0, Math.PI * 2); c.fill(); }
      }
      wrapTex = new THREE.CanvasTexture(el);
      wrapTex.colorSpace = THREE.SRGBColorSpace;
      wrapTex.wrapS = wrapTex.wrapT = THREE.RepeatWrapping;
    }
  }
  if (wrapTex) wrapTex.anisotropy = q === 'high' ? 8 : q === 'medium' ? 4 : 1;
  return wrapTex;
}

/**
 * Clipped leaves (1 texture = LEAF_TEX_M): small overlapping leaves in light
 * greys over darker gaps, white at the brightest so the vertex colours give
 * the green. Leaves are 10 px or more (a few centimetres), so mipmaps
 * soften them into a gentle mottle at range rather than shimmer.
 */
const LEAF_TEX_M = 0.8;
let leafTex: THREE.CanvasTexture | null | undefined;
function leafTexture(q: Quality): THREE.CanvasTexture | null {
  if (leafTex === undefined) {
    leafTex = null;
    const el = typeof document === 'undefined' ? null : document.createElement('canvas');
    const c = el?.getContext('2d');
    if (el && c) {
      const S = 256, r = rng(123);
      el.width = el.height = S;
      c.fillStyle = 'rgb(118,124,112)'; c.fillRect(0, 0, S, S);
      for (let i = 0; i < 900; i++) {
        const x = r() * S, y = r() * S, a = r() * Math.PI * 2, l = 7 + r() * 6, wd = l * (0.45 + r() * 0.15);
        const g = 175 + Math.floor(r() * 80);
        for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
          const cx = x + ox, cy = y + oy;
          if (cx < -20 || cx > S + 20 || cy < -20 || cy > S + 20) continue;
          c.fillStyle = `rgb(${g - 40},${g - 34},${g - 46})`;
          c.beginPath(); c.ellipse(cx + 1.5, cy + 2, l, wd, a, 0, Math.PI * 2); c.fill();
          c.fillStyle = `rgb(${g},${g},${g - 8})`;
          c.beginPath(); c.ellipse(cx, cy, l, wd, a, 0, Math.PI * 2); c.fill();
        }
      }
      leafTex = new THREE.CanvasTexture(el);
      leafTex.colorSpace = THREE.SRGBColorSpace;
      leafTex.wrapS = leafTex.wrapT = THREE.RepeatWrapping;
    }
  }
  if (leafTex) leafTex.anisotropy = q === 'high' ? 8 : q === 'medium' ? 4 : 1;
  return leafTex;
}

function materials(q: Quality): Record<MatKey, THREE.Material> {
  const kit = kitMaterials(q);
  const ramp = toonRamp();
  const talavera = (kit.talavera as THREE.MeshToonMaterial).map;
  const decal = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  return {
    flat: kit.flat, wood: kit.wood, cantera: kit.cantera,
    // The kit's foliage shading (its lifted shadow band), with the leaf texture.
    leaf: noBackfaceShadow(new THREE.MeshToonMaterial({ gradientMap: (kit.leaf as THREE.MeshToonMaterial).gradientMap, vertexColors: true, map: leafTexture(q) })),
    wrap: noBackfaceShadow(new THREE.MeshToonMaterial({ gradientMap: ramp, vertexColors: true, map: wrapTexture(q) })),
    floor: new THREE.MeshToonMaterial({ gradientMap: ramp, vertexColors: true, ...decal }),
    border: new THREE.MeshToonMaterial({ gradientMap: ramp, map: talavera, ...decal }),
    shadow: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
  };
}

// ------------------------------------------------------------------ build

/** Box types drawn here on La Fiesta. */
export const FIESTA_MATS: ReadonlySet<string> = new Set(['hedge', 'table', 'gift', 'stage']);

export function buildFiestaDressing(boxes: readonly MapBox[], decor: Pick<MapDecor, 'danceFloor'>, quality: Quality): { group: THREE.Group; calls: number } {
  const bk = new Bucket(), r = rng(41), lite = quality === 'low';
  const sh: Shared = {
    bud: new THREE.IcosahedronGeometry(0.5, 0),
  };
  let t = 0, g = 0;
  for (const b of boxes) {
    if (b.mat === 'hedge') { hedge(bk, b, quality, sh, r); contactShadow(bk, b, 0.35, 0.34); }
    else if (b.mat === 'table') { table(bk, b, quality, t++, sh); contactShadow(bk, b, 0.28, 0.3); }
    else if (b.mat === 'gift') { gifts(bk, b, quality, g++); contactShadow(bk, b, 0.25, 0.3); }
    else if (b.mat === 'stage') { stage(bk, b, quality); contactShadow(bk, b, 0.4, 0.3); }
  }
  if (decor.danceFloor) danceFloor(bk, decor.danceFloor, quality);
  sh.bud.dispose();

  const mats = materials(quality);
  const group = new THREE.Group();
  group.name = 'fiesta-dressing';
  let calls = 0;
  for (const k of ORDER) {
    const geo = bk.merged(k);
    if (!geo) continue;
    const m = new THREE.Mesh(geo, mats[k]);
    m.name = `fiesta-${k}`;
    const solid = k !== 'floor' && k !== 'border' && k !== 'shadow';
    m.castShadow = solid && !lite;
    m.receiveShadow = k !== 'shadow';
    if (k === 'floor' || k === 'border') m.position.y = 0.004;
    group.add(m);
    calls++;
  }
  return { group, calls };
}

export const FIESTA_DRESSING: DressingModule = {
  mats: FIESTA_MATS,
  decor: new Set(['danceFloor'] as const),
  build: (boxes, decor, quality) => buildFiestaDressing(boxes, decor, quality),
};
