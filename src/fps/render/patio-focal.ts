// El Patio's focal objects at the architectural kit's quality: the fountain,
// the chancla statue and the two kiosks (El Patio only; La Plaza keeps the
// arena's generic drawing). Visual only, built from the same authoritative
// boxes: collision, cover, sight lines and the walkable space are unchanged.
// Below head height everything stays inside its box's footprint (shallow
// trim aside, at most 6 cm); above it only the kiosk eaves overhang, and
// nothing solid rises above its box. The one exception is the fountain's
// thin, translucent water arcs (3 cm) over the basin on High and Medium.
// tests/patio-focal.test.ts holds these bounds.
//
// All geometry is merged into one mesh per material (shared with the kit's
// materials: cantera stone, talavera tile, tinted paint, wood), plus the
// statue's bronze, the water and a soft contact shadow: seven draw calls
// for all four objects. Low quality drops the spouts, the goods, the panel
// mouldings, the valance and the water's motion; the silhouettes stay.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapBox } from '../../../shared/map';
import type { Quality } from '../settings';
import { boxGeo, toonRamp } from './materials';
import { kitMaterials, noBackfaceShadow } from './patio-materials';
import { fpChanclaGeometry } from './fp-chancla';

/** Box types drawn here on El Patio. */
export const FOCAL_MATS: ReadonlySet<string> = new Set(['fountain', 'statue', 'kiosk']);

const C = {
  stone: 0xe4d2b0, stoneWarm: 0xd6bf98, stoneDark: 0xa98e6c, coping: 0xf0e2c4, basin: 0x2f8f9a,
  ironDark: 0x3a2a3c, cream: 0xf4e6c8, roof: 0xc4553a, roofDark: 0x9a3b2a, paper: 0xf2ece0, ink: 0x4b2a6b,
  corn: 0xf2c94a, husk: 0x9cbf5a, brass: 0xd9a441,
} as const;
/** Kiosk paint by sign (the arena's colours, kept). */
const KIOSK_PAINT: Record<string, number> = { ELOTES: 0xf0c64a, 'PERIÓDICOS': 0x3f8f6a, 'AGUAS FRESCAS': 0x3fa9b5 };

type MatKey = 'cantera' | 'talavera' | 'flat' | 'wood' | 'bronze' | 'water' | 'shadow';

/** Geometry per material, normalised (non-indexed; position, normal, uv, rgba colour) so it merges. */
class Bucket {
  private parts = new Map<MatKey, THREE.BufferGeometry[]>();
  /** Adds a copy of `g`; the input is disposed unless `shared` (a cached geometry). */
  add(k: MatKey, g: THREE.BufferGeometry, hex = 0xffffff, alpha = 1, m?: THREE.Matrix4, shared = false): void {
    let n = g.index ? g.toNonIndexed() : g.clone();
    if (m) n.applyMatrix4(m);
    for (const name of Object.keys(n.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') n.deleteAttribute(name);
    const count = n.getAttribute('position').count;
    if (!n.getAttribute('normal')) n.computeVertexNormals();
    if (!n.getAttribute('uv')) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    // RGBA only where it is needed (the water and the shadow), so the shared
    // kit materials keep their usual RGB vertex-colour program.
    const w = k === 'water' || k === 'shadow' ? 4 : 3;
    const col = new THREE.Color(hex), rgba = new Float32Array(count * w), src = n.getAttribute('color');
    for (let i = 0; i < count; i++) {
      // Painted geometry (the chancla) keeps its own colours times the tint.
      rgba[i * w] = col.r * (src ? src.getX(i) : 1); rgba[i * w + 1] = col.g * (src ? src.getY(i) : 1); rgba[i * w + 2] = col.b * (src ? src.getZ(i) : 1);
      if (w === 4) rgba[i * 4 + 3] = alpha;
    }
    n.setAttribute('color', new THREE.BufferAttribute(rgba, w));
    if (!this.parts.has(k)) this.parts.set(k, []);
    this.parts.get(k)!.push(n);
    if (!shared) g.dispose();
  }
  box(k: MatKey, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: number, scale = 1, faces = 63): void {
    this.add(k, boxGeo(x0, y0, z0, x1, y1, z1, scale, faces), hex);
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

/** A box given by its centre and size, in a local frame (m), into the bucket. */
function cuboid(bk: Bucket, k: MatKey, m: THREE.Matrix4, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, hex: number, scale = 1, faces = 63): void {
  bk.add(k, boxGeo(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2, scale, faces), hex, 1, m);
}

// ------------------------------------------------------------------ fountain

/**
 * A square basin of warm cantera on a darker plinth: talavera panels between
 * stone pilasters on the outside, a two-step coping, inner walls, a tiled
 * floor seen through the water, and four arcs of water from the statue's
 * pedestal (High and Medium).
 */
function fountain(bk: Bucket, b: MapBox, q: Quality, ripples: THREE.Vector2[]): void {
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const hw = (b.maxX - b.minX) / 2, hd = (b.maxZ - b.minZ) / 2, top = b.maxY;
  const at = new THREE.Matrix4().makeTranslation(cx, 0, cz);
  const plinthH = 0.12, copeH = 0.15, wallTop = top - copeH, rim = 0.32;
  // Plinth: the darkest stone, the full footprint (grounds the basin).
  cuboid(bk, 'cantera', at, 0, plinthH / 2, 0, hw * 2, plinthH, hd * 2, C.stoneDark, 1.2, 63 & ~8);
  // Wall core, set in a little so the tiles and pilasters sit proud of it.
  cuboid(bk, 'cantera', at, 0, (plinthH + wallTop) / 2, 0, hw * 2 - 0.1, wallTop - plinthH, hd * 2 - 0.1, C.stoneWarm, 1.2, 63 & ~12);
  // Corner and mid pilasters, and talavera panels between them, on all four sides.
  const panelH = wallTop - plinthH - 0.1;
  for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const len = ax ? hd * 2 : hw * 2, out = ax ? hw : hd;
    const rot = new THREE.Matrix4().makeRotationY(ax ? (ax > 0 ? Math.PI / 2 : -Math.PI / 2) : (az > 0 ? 0 : Math.PI));
    const f = at.clone().multiply(rot); // local x along the face, z out of it
    for (const u of [-len / 2 + 0.14, 0, len / 2 - 0.14]) cuboid(bk, 'cantera', f, u, (plinthH + wallTop) / 2, out - 0.06, 0.28, wallTop - plinthH, 0.12, C.stone, 1.2);
    for (const s of [-1, 1]) {
      const a0 = s < 0 ? -len / 2 + 0.28 : 0.14, a1 = s < 0 ? -0.14 : len / 2 - 0.28;
      bk.add('talavera', boxGeo(a0, plinthH + 0.05, out - 0.07, a1, plinthH + 0.05 + panelH, out - 0.04, 0.5, 16), 0xffffff, 1, f);
    }
  }
  // Coping: a wide lower course (a few cm proud) and a narrower cap.
  cuboid(bk, 'cantera', at, 0, wallTop + 0.05, 0, hw * 2 + 0.06, 0.1, hd * 2 + 0.06, C.coping, 1.2, 63 & ~12);
  const ring = (y0: number, y1: number, inset: number, hex: number) => {
    const o = hw - inset, i = hw - inset - rim;
    cuboid(bk, 'cantera', at, 0, (y0 + y1) / 2, o - rim / 2, o * 2, y1 - y0, rim, hex, 1.2);
    cuboid(bk, 'cantera', at, 0, (y0 + y1) / 2, -o + rim / 2, o * 2, y1 - y0, rim, hex, 1.2);
    cuboid(bk, 'cantera', at, o - rim / 2, (y0 + y1) / 2, 0, rim, y1 - y0, i * 2, hex, 1.2);
    cuboid(bk, 'cantera', at, -o + rim / 2, (y0 + y1) / 2, 0, rim, y1 - y0, i * 2, hex, 1.2);
  };
  ring(wallTop + 0.1, top, 0.02, C.coping);
  // Inner basin: walls down to a tiled floor, under the water.
  const inner = hw - 0.02 - rim, floorY = 0.28;
  for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const rot = new THREE.Matrix4().makeRotationY(ax ? (ax > 0 ? -Math.PI / 2 : Math.PI / 2) : (az > 0 ? Math.PI : 0));
    bk.add('cantera', boxGeo(-inner, floorY, -inner, inner, top, -inner + 0.01, 1.2, 16), C.stoneDark, 1, at.clone().multiply(rot)); // faces the middle
  }
  bk.add('talavera', boxGeo(-inner, floorY - 0.01, -inner, inner, floorY, inner, 0.5, 4), 0x9fd9e0, 1, at);
  // The water: a slab a little below the coping, plus arcs from the pedestal.
  const waterY = top - 0.13;
  bk.add('water', boxGeo(-inner, waterY - 0.01, -inner, inner, waterY, inner, 1, 4), C.basin, 0.84, at);
  ripples.push(new THREE.Vector2(cx, cz));
  if (q !== 'low') {
    const seg = q === 'high' ? 14 : 8;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const p0 = new THREE.Vector3(cx + dx * 0.78, 1.42, cz + dz * 0.78), p2 = new THREE.Vector3(cx + dx * 1.75, waterY, cz + dz * 1.75);
      const p1 = new THREE.Vector3(cx + dx * 1.35, 1.6, cz + dz * 1.35);
      const tube = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(p0, p1, p2), seg, 0.032, q === 'high' ? 6 : 4, false);
      bk.add('water', tube, 0x8fe3ea, 0.78);
      // A small bronze spout where each arc leaves the pedestal.
      bk.add('bronze', new THREE.CylinderGeometry(0.045, 0.06, 0.16, 8).rotateZ(Math.PI / 2).rotateY(dx ? 0 : Math.PI / 2), 0xffffff, 1, new THREE.Matrix4().makeTranslation(cx + dx * 0.74, 1.42, cz + dz * 0.74));
      ripples.push(new THREE.Vector2(p2.x, p2.z));
    }
  }
}

// ------------------------------------------------------------------ statue

/** The monument chanclas' length (m): heel at the pedestal, tip at about 4.3 m, under the box's 4.4 m. */
const MONUMENT_M = 1.75;
let monument: Partial<Record<'full' | 'lite', THREE.BufferGeometry>> = {};

/**
 * The monument: a pair of the game's own chanclas, cast in bronze-gold,
 * standing on their heels with the flowered footbeds facing out, on a stepped cantera pedestal
 * with talavera panels and a brass band. Static: monuments do not sway.
 */
function statue(bk: Bucket, b: MapBox, q: Quality): void {
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, hw = (b.maxX - b.minX) / 2, y0 = b.minY;
  const at = new THREE.Matrix4().makeTranslation(cx, 0, cz);
  const base = hw * 2 - 0.2, shaft = base - 0.5;
  // The lowest step goes down to the basin floor: it stands in the water, not on it.
  cuboid(bk, 'cantera', at, 0, (0.28 + y0 + 0.3) / 2, 0, base, y0 + 0.3 - 0.28, base, C.stoneDark, 1.2, 63 & ~8);
  cuboid(bk, 'cantera', at, 0, y0 + 0.36, 0, base - 0.18, 0.12, base - 0.18, C.stone, 1.2, 63 & ~8);
  const sTop = 2.35;
  cuboid(bk, 'cantera', at, 0, (y0 + 0.42 + sTop) / 2, 0, shaft, sTop - y0 - 0.42, shaft, C.stoneWarm, 1.2, 63 & ~12);
  for (let k = 0; k < 4; k++) {
    const f = at.clone().multiply(new THREE.Matrix4().makeRotationY((k * Math.PI) / 2));
    const out = shaft / 2;
    bk.add('talavera', boxGeo(-shaft / 2 + 0.16, y0 + 0.62, out - 0.005, shaft / 2 - 0.16, sTop - 0.2, out + 0.02, 0.5, 16), 0xffffff, 1, f);
    for (const u of [-1, 1]) cuboid(bk, 'cantera', f, u * (shaft / 2 - 0.06), (y0 + 0.42 + sTop) / 2, out - 0.04, 0.14, sTop - y0 - 0.42, 0.14, C.stone, 1.2);
  }
  cuboid(bk, 'cantera', at, 0, sTop + 0.07, 0, shaft + 0.24, 0.14, shaft + 0.24, C.coping, 1.2);
  cuboid(bk, 'cantera', at, 0, sTop + 0.19, 0, shaft + 0.08, 0.1, shaft + 0.08, C.stone, 1.2);
  cuboid(bk, 'bronze', at, 0, sTop + 0.27, 0, shaft - 0.2, 0.06, shaft - 0.2, C.brass);
  const detail = q === 'low' ? 'lite' : 'full';
  if (!monument[detail]) {
    const { body, flower } = fpChanclaGeometry(detail);
    const g = mergeGeometries([body.index ? body.toNonIndexed() : body.clone(), flower.index ? flower.toNonIndexed() : flower.clone()].map((x) => { for (const n of Object.keys(x.attributes)) if (!['position', 'normal', 'color'].includes(n)) x.deleteAttribute(n); return x; }), false)!;
    g.computeBoundingBox();
    const bb = g.boundingBox!, k = MONUMENT_M / (bb.max.z - bb.min.z);
    g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -bb.max.z); // heel at the origin, toe along -z
    g.scale(k, k, k);
    g.rotateX(Math.PI / 2); // stand it up: toe up, footbed (and its flower) facing +z
    // Bronze: keep the painted pattern's light and dark, in a deep gold.
    const col = g.getAttribute('color');
    if (col) for (let i = 0; i < col.count; i++) {
      const l = 0.3 * col.getX(i) + 0.55 * col.getY(i) + 0.15 * col.getZ(i), t = 0.5 + 0.5 * l;
      col.setXYZ(i, 0.92 * t, 0.6 * t, 0.2 * t);
    }
    monument[detail] = g;
  }
  // A pair, heels together, leaning apart and turned a quarter turn from
  // each other, so a footbed faces you from any side of the plaza.
  for (const [yaw, lean] of [[0.4, 0.3], [0.4 + Math.PI / 2, -0.3]] as const) {
    const m = at.clone().multiply(new THREE.Matrix4().makeTranslation(0, sTop + 0.3, 0)).multiply(new THREE.Matrix4().makeRotationY(yaw)).multiply(new THREE.Matrix4().makeRotationZ(lean));
    bk.add('bronze', monument[detail]!, 0xffffff, 1, m, true);
  }
}

// ------------------------------------------------------------------ kiosks

/**
 * A painted wooden kiosk: a stone plinth, a panelled cabinet, a wooden
 * counter, corner posts, a shallow service window on the side facing the
 * plaza (newspapers or corn on display, never deeper than 12 cm), a cream
 * fascia, a striped valance and a hipped tile roof whose eaves overhang
 * above head height, its finial at the box's top. The signs stay where the arena puts them.
 */
function kiosk(bk: Bucket, b: MapBox, q: Quality): void {
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, w = b.maxX - b.minX, d = b.maxZ - b.minZ;
  const paint = KIOSK_PAINT[b.sign ?? ''] ?? 0x3f8f6a, top = b.maxY;
  const at = new THREE.Matrix4().makeTranslation(cx, 0, cz);
  const counterY = 1.02, bodyTop = 2.1;
  cuboid(bk, 'cantera', at, 0, 0.06, 0, w, 0.12, d, C.stoneDark, 1.2, 63 & ~8);
  cuboid(bk, 'flat', at, 0, (0.12 + counterY) / 2, 0, w - 0.04, counterY - 0.12, d - 0.04, paint, 1, 63 & ~12);
  // The plaza side: the side facing the arena's middle.
  const front = cx < 0 ? 1 : -1;
  const f = at.clone().multiply(new THREE.Matrix4().makeRotationY(front > 0 ? Math.PI / 2 : -Math.PI / 2)); // local z out of the front
  const half = w / 2, len = d, depth = 0.12, uY = (counterY + bodyTop) / 2, uH = bodyTop - counterY;
  // Upper body, set back 12 cm on the front for the service window, with a
  // dark back wall, jambs and a header framing the opening.
  bk.add('flat', boxGeo(-len / 2 + 0.04, counterY, -half + 0.04, len / 2 - 0.04, bodyTop, half - depth, 1, 63 & ~12), paint, 1, f);
  bk.add('flat', boxGeo(-len / 2 + 0.16, counterY + 0.08, half - depth, len / 2 - 0.16, bodyTop - 0.16, half - depth + 0.005, 1, 16), 0x2b1c2e, 1, f);
  for (const u of [-1, 1]) cuboid(bk, 'flat', f, u * (len / 2 - 0.1), uY, half - 0.04 - (depth - 0.04) / 2, 0.12, uH, depth - 0.04, paint, 1, 63 & ~12);
  cuboid(bk, 'flat', f, 0, bodyTop - 0.08, half - 0.04 - (depth - 0.04) / 2, len - 0.08, 0.16, depth - 0.04, paint, 1, 63 & ~4);
  cuboid(bk, 'wood', at, 0, counterY + 0.035, 0, w + 0.06, 0.07, d + 0.06, 0xffffff, 1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cuboid(bk, 'wood', at, sx * (w / 2 - 0.05), uY, sz * (d / 2 - 0.05), 0.1, uH, 0.1, 0xffffff, 1);
  // A sill inside the window, and on High and Medium the goods on it.
  cuboid(bk, 'wood', f, 0, counterY + 0.08, half - 0.07, len - 0.3, 0.02, 0.1, 0xffffff, 1);
  if (q !== 'low') {
    const sign = b.sign ?? '';
    if (sign === 'ELOTES') {
      for (let i = 0; i < 9; i++) {
        const u = -len / 2 + 0.3 + (i % 5) * ((len - 0.6) / 4), y = counterY + 0.2 + Math.floor(i / 5) * 0.16;
        bk.add('flat', new THREE.CapsuleGeometry(0.045, 0.16, 2, 6).rotateZ(Math.PI / 2 + (i % 2 ? 0.2 : -0.15)), C.corn, 1, f.clone().multiply(new THREE.Matrix4().makeTranslation(u, y, half - 0.07)));
      }
    } else {
      // Folded newspapers on a stepped rack.
      for (let r = 0; r < 3; r++) for (let i = 0; i < 4; i++) {
        const u = -len / 2 + 0.34 + i * ((len - 0.68) / 3);
        cuboid(bk, 'flat', f, u, counterY + 0.24 + r * 0.24, half - 0.1, 0.26, 0.17, 0.02, i % 2 ? C.paper : 0xe7dcc6);
        cuboid(bk, 'flat', f, u, counterY + 0.29 + r * 0.24, half - 0.089, 0.2, 0.03, 0.004, [0xc4553a, 0x4b2a6b, 0x2f8f9a][(r + i) % 3]!);
      }
    }
    // Raised panel mouldings on the cabinet, all four sides.
    for (let k = 0; k < 4; k++) {
      const g = at.clone().multiply(new THREE.Matrix4().makeRotationY((k * Math.PI) / 2));
      const span = k % 2 ? d : w, out = (k % 2 ? w : d) / 2 - 0.02;
      const n = span > 1.7 ? 2 : 1, pw = (span - 0.3) / n - 0.08;
      for (let i = 0; i < n; i++) {
        const u = -span / 2 + 0.15 + (i + 0.5) * ((span - 0.3) / n);
        cuboid(bk, 'flat', g, u, (0.2 + counterY - 0.1) / 2 + 0.02, out + 0.008, pw, counterY - 0.36, 0.016, shadeHex(paint, 0.82));
      }
    }
  }
  // Fascia, valance and the hipped roof (only the eaves, above 2.2 m, overhang).
  cuboid(bk, 'flat', at, 0, bodyTop + 0.07, 0, w + 0.04, 0.14, d + 0.04, C.cream, 1);
  if (q !== 'low') {
    const n = Math.round(len / 0.2);
    for (let i = 0; i < n; i++) {
      const u = -len / 2 + (i + 0.5) * (len / n);
      bk.add('flat', new THREE.ConeGeometry(0.1, 0.13, 3).rotateX(Math.PI).rotateY(Math.PI / 6), i % 2 ? C.cream : 0xd9534a, 1, f.clone().multiply(new THREE.Matrix4().makeTranslation(u, bodyTop - 0.065, half - 0.04)));
    }
  }
  const roofY = bodyTop + 0.14, eave = 0.28, rise = top - roofY - 0.12; // the finial's top at the box's
  const roof = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4);
  roof.scale(w + eave * 2, rise, d + eave * 2);
  roof.translate(0, roofY + rise / 2, 0);
  bk.add('flat', roof, C.roof, 1, at);
  cuboid(bk, 'flat', at, 0, roofY + 0.02, 0, w + eave * 2, 0.05, d + eave * 2, C.roofDark, 1, 63 & ~4);
  bk.add('bronze', new THREE.SphereGeometry(0.07, 8, 6), 0xffffff, 1, new THREE.Matrix4().makeTranslation(cx, roofY + rise + 0.04, cz));
}

function shadeHex(hex: number, k: number): number { return new THREE.Color(hex).multiplyScalar(k).getHex(); }

// ------------------------------------------------------------------ contact shadows

/** A soft dark band on the paving around a footprint: grounds the object (no shadow map needed, so Low keeps it). */
function contactShadow(bk: Bucket, b: MapBox, width: number, strength: number): void {
  const x0 = b.minX, x1 = b.maxX, z0 = b.minZ, z1 = b.maxZ, o = width;
  const pos: number[] = [], alpha: number[] = [];
  const quad = (a: number[], bb: number[], c: number[], d: number[], aa: number[]) => { pos.push(...a, ...bb, ...c, ...a, ...c, ...d); alpha.push(aa[0]!, aa[1]!, aa[2]!, aa[0]!, aa[2]!, aa[3]!); };
  const y = 0.006, s = strength;
  quad([x0, y, z1], [x1, y, z1], [x1 + o, y, z1 + o], [x0 - o, y, z1 + o], [s, s, 0, 0]);
  quad([x1, y, z0], [x0, y, z0], [x0 - o, y, z0 - o], [x1 + o, y, z0 - o], [s, s, 0, 0]);
  quad([x1, y, z1], [x1, y, z0], [x1 + o, y, z0 - o], [x1 + o, y, z1 + o], [s, s, 0, 0]);
  quad([x0, y, z0], [x0, y, z1], [x0 - o, y, z1 + o], [x0 - o, y, z0 - o], [s, s, 0, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const n = pos.length / 3;
  bk.add('shadow', g, 0x2a1810, 1);
  // Per-vertex alpha (the bucket set 1): fade outwards.
  const last = (bk as unknown as { parts: Map<MatKey, THREE.BufferGeometry[]> }).parts.get('shadow')!.at(-1)!;
  const c = last.getAttribute('color') as THREE.BufferAttribute;
  for (let i = 0; i < n; i++) c.setW(i, alpha[i]!);
}

// ------------------------------------------------------------------ water

/**
 * Restrained water: the toon water colour with soft rings spreading from
 * the middle and from where the arcs fall, and a slow broad shimmer, all in
 * the fragment shader from world position and time (no textures, no
 * reflections). Low: still water.
 */
function waterMaterial(q: Quality, ripples: THREE.Vector2[]): { mat: THREE.MeshToonMaterial; time: { value: number } } {
  const time = { value: 0 };
  const mat = new THREE.MeshToonMaterial({ gradientMap: toonRamp(), vertexColors: true, transparent: true, emissive: 0x0b3d44, depthWrite: false });
  if (q === 'low') return { mat, time };
  const pts = ripples.slice(0, 5);
  while (pts.length < 5) pts.push(new THREE.Vector2(1e4, 1e4));
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.uniforms.uRip = { value: pts };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform float uTime;\nuniform vec2 uRip[5];')
      .replace('#include <color_fragment>', `#include <color_fragment>
  {
    float w = 0.0;
    for (int i = 0; i < 5; i++) {
      float r = distance(vWPos.xz, uRip[i]);
      w += sin(r * 11.0 - uTime * 2.6) * exp(-r * 1.4) * (i == 0 ? 0.5 : 1.0);
    }
    w += sin(vWPos.x * 1.7 + uTime * 0.6) * sin(vWPos.z * 2.1 - uTime * 0.45) * 0.35;
    float band = smoothstep(0.35, 0.6, w);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.97, 0.98), band * 0.32);
  }`);
  };
  mat.customProgramCacheKey = () => 'patio-water';
  return { mat, time };
}

// ------------------------------------------------------------------ build

export interface Focal { group: THREE.Group; calls: number; update(t: number): void }

export function buildFocal(boxes: readonly MapBox[], quality: Quality): Focal {
  const bk = new Bucket(), ripples: THREE.Vector2[] = [];
  for (const b of boxes) {
    if (b.mat === 'fountain') { fountain(bk, b, quality, ripples); contactShadow(bk, b, 0.45, 0.3); }
    else if (b.mat === 'statue') statue(bk, b, quality);
    else if (b.mat === 'kiosk') { kiosk(bk, b, quality); contactShadow(bk, b, 0.35, 0.32); }
  }
  const kit = kitMaterials(quality);
  const ramp = toonRamp();
  const water = waterMaterial(quality, ripples);
  const mats: Record<MatKey, THREE.Material> = {
    cantera: kit.cantera, talavera: kit.talavera, flat: kit.flat, wood: kit.wood, water: water.mat,
    bronze: noBackfaceShadow(new THREE.MeshToonMaterial({ gradientMap: ramp, vertexColors: true, emissive: 0x3a2400 })),
    shadow: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
  };
  const group = new THREE.Group();
  group.name = 'patio-focal';
  let calls = 0;
  for (const k of ['cantera', 'talavera', 'flat', 'wood', 'bronze', 'water', 'shadow'] as MatKey[]) {
    const g = bk.merged(k);
    if (!g) continue;
    const m = new THREE.Mesh(g, mats[k]);
    m.name = `focal-${k}`;
    const solid = k !== 'water' && k !== 'shadow';
    m.castShadow = solid && quality !== 'low';
    m.receiveShadow = k !== 'shadow';
    if (k === 'water') m.renderOrder = 1;
    group.add(m);
    calls++;
  }
  return { group, calls, update(t: number) { water.time.value = t; } };
}
