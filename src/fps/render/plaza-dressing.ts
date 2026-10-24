// La Plaza's own props at the El Patio kit's quality (see map-dressing.ts).
// Owned by the La Plaza workstream; the arena (world.ts) routes this map's
// box types and decor listed below here.
//
// A sunny market square: painted wooden market stalls with crates of produce
// under striped, pitched awnings; the two tarimas (plank stages with painted
// skirts); the central fountain (a cantera basin with talavera panels and a
// pedestal with an upper bowl and four spouts); the two kiosks (El Patio's,
// from patio-focal.ts); and the two trees growing out of their planters.
//
// Visual only, built from the same authoritative boxes: below head height
// everything stays inside its box's footprint (shallow trim aside, at most
// 6 cm) and nothing solid rises above its box top, except the awnings (with
// their poles) at the heights decor.awnings gives, the tree trunks and their
// canopies above head height, and the fountain's thin, translucent water
// arcs over the basin. tests/plaza-dressing.test.ts holds these bounds.
//
// All geometry is merged into one mesh per material, shared with the kit
// (cantera, talavera, tinted paint, wood, foliage), plus the water and a soft
// contact shadow: seven draw calls for the whole set. Low quality drops the
// produce, the panel mouldings, the plank gaps, the valances, the spouts and
// the water's motion, uses coarser foliage and casts no shadows.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapBox, MapDecor } from '../../../shared/map';
import type { Quality } from '../settings';
import type { DressingModule, Dressing } from './map-dressing';
import { boxGeo, toonRamp } from './materials';
import { kitMaterials } from './patio-materials';
import { buildFocal } from './patio-focal';

const C = {
  stone: 0xe4d2b0, stoneWarm: 0xd6bf98, stoneDark: 0xa98e6c, coping: 0xf0e2c4, basin: 0x2f8f9a, brass: 0xd9a441,
  cream: 0xf4e6c8, turquoise: 0x3f9e95, violet: 0x5a3480, gold: 0xf2bf3e, bark: 0x6b4a32, barkDark: 0x4e3424,
  leafDark: 0x2f5a2c, leafMid: 0x4f8a40, leafLight: 0x79b257, underlay: 0x3a2618, cloth: 0xfbf3e2,
} as const;
/** Produce on the stalls (oranges, limes, tomatoes, mangos, chiles, avocados). */
const PRODUCE = [0xf08a24, 0x86c440, 0xd9402e, 0xf5c542, 0xc62f2a, 0x55732c] as const;

type MatKey = 'cantera' | 'talavera' | 'flat' | 'wood' | 'leaf' | 'water' | 'shadow';
const ORDER: readonly MatKey[] = ['cantera', 'talavera', 'flat', 'wood', 'leaf', 'water', 'shadow'];

/** Geometry per material, normalised (non-indexed; position, normal, uv, colour) so it merges. */
class Bucket {
  readonly parts = new Map<MatKey, THREE.BufferGeometry[]>();
  /** Adds a copy of `g` tinted by `hex` (times any colours it has); the input is disposed unless `shared`. */
  add(k: MatKey, g: THREE.BufferGeometry, hex = 0xffffff, alpha = 1, m?: THREE.Matrix4, shared = false): void {
    const n = g.index ? g.toNonIndexed() : g.clone();
    if (m) n.applyMatrix4(m);
    for (const name of Object.keys(n.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') n.deleteAttribute(name);
    const count = n.getAttribute('position').count;
    if (!n.getAttribute('normal')) n.computeVertexNormals();
    if (!n.getAttribute('uv')) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    // RGBA only where it is needed (the water and the shadow), so the shared
    // kit materials keep their usual RGB vertex-colour program.
    const w = k === 'water' || k === 'shadow' ? 4 : 3;
    const col = new THREE.Color(hex), out = new Float32Array(count * w), src = n.getAttribute('color');
    for (let i = 0; i < count; i++) {
      out[i * w] = col.r * (src ? src.getX(i) : 1); out[i * w + 1] = col.g * (src ? src.getY(i) : 1); out[i * w + 2] = col.b * (src ? src.getZ(i) : 1);
      if (w === 4) out[i * 4 + 3] = alpha * (src && src.itemSize === 4 ? src.getW(i) : 1);
    }
    n.setAttribute('color', new THREE.BufferAttribute(out, w));
    if (!this.parts.has(k)) this.parts.set(k, []);
    this.parts.get(k)!.push(n);
    if (!shared) g.dispose();
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

function shadeHex(hex: number, k: number): number { return new THREE.Color(hex).multiplyScalar(k).getHex(); }

/** A frame at (cx, 0, cz) whose local +z points out of the face toward (ax, az), one of +-x or +-z. */
function faceFrame(cx: number, cz: number, ax: number, az: number): THREE.Matrix4 {
  const yaw = ax ? (ax > 0 ? Math.PI / 2 : -Math.PI / 2) : (az > 0 ? 0 : Math.PI);
  return new THREE.Matrix4().makeTranslation(cx, 0, cz).multiply(new THREE.Matrix4().makeRotationY(yaw));
}
const SIDES4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const ID = new THREE.Matrix4();

/** Raised panel mouldings on a face (local frame: x along it, z out of it), between y0 and y1. */
function panels(bk: Bucket, f: THREE.Matrix4, span: number, out: number, y0: number, y1: number, n: number, hex: number): void {
  const pw = (span - 0.24) / n - 0.08;
  for (let i = 0; i < n; i++) {
    const u = -span / 2 + 0.12 + (i + 0.5) * ((span - 0.24) / n);
    cuboid(bk, 'flat', f, u, (y0 + y1) / 2, out + 0.008, pw, y1 - y0, 0.016, hex, 1, 63 & ~32);
  }
}

// ------------------------------------------------------------------ stalls

type Awning = NonNullable<MapDecor['awnings']>[number];

/** The cabinet's paint: a deep shade of its awning's colour, so each stall reads as one piece. */
function cabinetPaint(awningHex: number): number {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(awningHex).getHSL(hsl, THREE.SRGBColorSpace);
  return new THREE.Color().setHSL(hsl.h, Math.min(0.55, hsl.s * 0.75), 0.4, THREE.SRGBColorSpace).getHex();
}

/**
 * A market stall: a painted wooden cabinet (panel mouldings, cream rails) on
 * four wooden corner posts that carry on up as the awning's poles, a wooden
 * counter, and a display tray whose rim is the box's top, with three crates
 * of produce sunk into it (loose fruit on High and Medium), so nothing rises
 * above the box.
 */
function stall(bk: Bucket, b: MapBox, q: Quality, idx: number, aw?: Awning): void {
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, w = b.maxX - b.minX, d = b.maxZ - b.minZ, top = b.maxY;
  const at = new THREE.Matrix4().makeTranslation(cx, 0, cz);
  const paint = aw ? cabinetPaint(aw.color) : C.turquoise;
  const counterY = top - 0.2, post = 0.08;
  // Cabinet body, set in from the posts, raised a little off the paving.
  cuboid(bk, 'flat', at, 0, (0.1 + counterY) / 2, 0, w - 0.08, counterY - 0.1, d - 0.08, paint, 1, 63 & ~12);
  cuboid(bk, 'flat', at, 0, 0.13, 0, w - 0.06, 0.06, d - 0.06, C.cream, 1, 63 & ~12); // bottom rail
  cuboid(bk, 'flat', at, 0, counterY - 0.05, 0, w - 0.06, 0.1, d - 0.06, C.cream, 1, 63 & ~12); // top rail
  if (q !== 'low') {
    for (const [ax, az] of SIDES4) {
      const span = ax ? d : w, out = (ax ? w : d) / 2 - 0.04;
      panels(bk, faceFrame(cx, cz, ax, az), span - 0.1, out, 0.24, counterY - 0.16, span > 1.8 ? 3 : 1, shadeHex(paint, 0.8));
    }
  }
  // Corner posts: the awning's poles where there is an awning.
  const postTop = aw ? aw.y : top;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cuboid(bk, 'wood', at, sx * (w / 2 - post / 2), postTop / 2, sz * (d / 2 - post / 2), post, postTop, post, 0xffffff, 1, 63 & ~8);
  // Counter board (2 cm proud) and the display tray's rim, up to the box's top.
  cuboid(bk, 'wood', at, 0, counterY + 0.03, 0, w + 0.04, 0.06, d + 0.04, 0xffffff, 1);
  const rimY0 = counterY + 0.06, rimH = top - rimY0, t = 0.05;
  for (const s of [-1, 1]) {
    cuboid(bk, 'wood', at, 0, rimY0 + rimH / 2, s * (d / 2 - t / 2 - 0.01), w - 0.02, rimH, t, 0xffffff, 1, 63 & ~8);
    cuboid(bk, 'wood', at, s * (w / 2 - t / 2 - 0.01), rimY0 + rimH / 2, 0, t, rimH, d - 0.02 - 2 * t, 0xffffff, 1, 63 & ~8);
  }
  // Three crates of produce in the tray: a heaped fill, and loose fruit on top (High, Medium).
  const inW = w - 0.02 - 2 * t, inD = d - 0.02 - 2 * t, n = 3, cw = inW / n;
  const fruit = q === 'low' ? null : q === 'high' ? new THREE.IcosahedronGeometry(1, 0) : new THREE.OctahedronGeometry(1, 0);
  for (let i = 0; i < n; i++) {
    const ux = -inW / 2 + (i + 0.5) * cw, hex = PRODUCE[(idx * 2 + i) % PRODUCE.length]!;
    if (i) cuboid(bk, 'wood', at, ux - cw / 2, rimY0 + rimH * 0.4, 0, 0.03, rimH * 0.8, inD, 0xffffff, 1, 63 & ~8); // divider
    cuboid(bk, 'flat', at, ux, rimY0 + 0.05, 0, cw - 0.04, 0.1, inD - 0.02, shadeHex(hex, 0.72), 1, 63 & ~8);
    if (!fruit) continue;
    const r = 0.055, sp = 0.16, cols = Math.max(2, Math.floor((cw - 0.06) / sp)), rows = Math.max(2, Math.floor((inD - 0.06) / sp));
    for (let a = 0; a < cols; a++) for (let c = 0; c < rows; c++) {
      if ((a + c) % 2) continue; // a loose layer over the heap
      const fx = ux - ((cols - 1) * sp) / 2 + a * sp + ((c % 2) - 0.5) * 0.03, fz = -((rows - 1) * sp) / 2 + c * sp;
      const fy = Math.min(top - r - 0.005, rimY0 + 0.1 + r * 0.55);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(cx + fx, fy, cz + fz), new THREE.Quaternion().setFromEuler(new THREE.Euler(a * 0.7, c * 1.3, 0)), new THREE.Vector3(r, r * 0.9, r));
      bk.add('flat', fruit, (a + c) % 3 ? hex : shadeHex(hex, 0.86), 1, m, true);
    }
  }
  fruit?.dispose();
}

// ------------------------------------------------------------------ awnings

/**
 * A pitched canvas awning: stripes of the awning's colour and cream running
 * down two slopes from a ridge 28 cm above the eaves (decor's height), on a
 * light wooden frame from the stall's corner posts, with a scalloped valance
 * along both eaves (High and Medium). All of it above head height.
 */
function awning(bk: Bucket, a: Awning, stallBox: MapBox | undefined, q: Quality): void {
  const w = a.maxX - a.minX, d = a.maxZ - a.minZ, cx = (a.minX + a.maxX) / 2, cz = (a.minZ + a.maxZ) / 2;
  const rise = 0.28, half = d / 2, slope = Math.hypot(half, rise), ang = Math.atan2(rise, half), th = 0.025;
  const n = 7, sw = w / n;
  for (const s of [-1, 1]) {
    // One slope: local x along the ridge, z down the slope from the ridge.
    const turn = new THREE.Matrix4().makeRotationY(s > 0 ? 0 : Math.PI);
    const m = new THREE.Matrix4().makeTranslation(cx, a.y + rise, cz).multiply(turn).multiply(new THREE.Matrix4().makeRotationX(ang));
    for (let i = 0; i < n; i++) cuboid(bk, 'flat', m, -w / 2 + (i + 0.5) * sw, th / 2, slope / 2, sw, th, slope, i % 2 ? C.cloth : a.color, 1);
    if (q !== 'low') {
      // Scalloped valance hanging from the eave: a flap and a point per stripe.
      const e = new THREE.Matrix4().makeTranslation(cx, a.y, cz).multiply(turn);
      for (let i = 0; i < n; i++) {
        const u = -w / 2 + (i + 0.5) * sw, hex = i % 2 ? C.cloth : a.color;
        cuboid(bk, 'flat', e, u, -0.06, half - 0.006, sw, 0.12, 0.012, hex, 1, 63 & ~12);
        bk.add('flat', new THREE.ConeGeometry(sw / 2, 0.1, 3, 1).rotateX(Math.PI).rotateY(Math.PI / 6).scale(1, 1, 0.12), hex, 1, e.clone().multiply(new THREE.Matrix4().makeTranslation(u, -0.17, half - 0.006)));
      }
    }
  }
  // Frame: a cloth ridge cap and ridge pole, the two eave rails, cross bars and king posts at the stall's posts.
  cuboid(bk, 'flat', ID, cx, a.y + rise + th * 0.6, cz, w, 0.03, 0.08, C.cloth, 1);
  cuboid(bk, 'wood', ID, cx, a.y + rise - 0.035, cz, w - 0.1, 0.05, 0.05, 0xffffff, 1);
  for (const s of [-1, 1]) cuboid(bk, 'wood', ID, cx, a.y - 0.03, cz + s * (half - 0.04), w - 0.1, 0.05, 0.05, 0xffffff, 1);
  const xs = stallBox ? [stallBox.minX + 0.04, stallBox.maxX - 0.04] : [a.minX + 0.1, a.maxX - 0.1];
  for (const x of xs) {
    cuboid(bk, 'wood', ID, x, a.y - 0.03, cz, 0.05, 0.05, d - 0.08, 0xffffff, 1);
    cuboid(bk, 'wood', ID, x, a.y + rise / 2 - 0.03, cz, 0.05, rise, 0.05, 0xffffff, 1, 63 & ~12);
  }
}

// ------------------------------------------------------------------ stages

/**
 * A tarima: a deck of wooden planks (the box's top) with a gold nosing, a
 * violet painted skirt with raised panels and cream rails, wooden posts and
 * a darker cantera plinth. Its step is the kit's. The face against the
 * arcade wall gets no panels.
 */
function stage(bk: Bucket, b: MapBox, q: Quality): void {
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, w = b.maxX - b.minX, d = b.maxZ - b.minZ, top = b.maxY;
  const at = new THREE.Matrix4().makeTranslation(cx, 0, cz);
  const deckH = 0.06, skirtTop = top - deckH, back = cz < 0 ? -1 : 1;
  cuboid(bk, 'cantera', at, 0, 0.05, 0, w, 0.1, d, C.stoneDark, 1.2, 63 & ~8);
  cuboid(bk, 'flat', at, 0, (0.1 + skirtTop) / 2, 0, w - 0.06, skirtTop - 0.1, d - 0.06, C.violet, 1, 63 & ~12);
  cuboid(bk, 'flat', at, 0, skirtTop - 0.05, 0, w - 0.02, 0.1, d - 0.02, C.cream, 1, 63 & ~12);
  cuboid(bk, 'flat', at, 0, 0.13, 0, w - 0.02, 0.06, d - 0.02, C.cream, 1, 63 & ~12);
  // Posts at the corners and every ~2 m along the front.
  const nx = Math.max(1, Math.round(w / 2)), bay = (w - 0.12) / nx;
  for (let i = 0; i <= nx; i++) cuboid(bk, 'wood', at, -w / 2 + 0.06 + i * bay, (0.1 + skirtTop) / 2, -back * (d / 2 - 0.06), 0.12, skirtTop - 0.1, 0.12, 0xffffff, 1, 63 & ~12);
  for (const sx of [-1, 1]) cuboid(bk, 'wood', at, sx * (w / 2 - 0.06), (0.1 + skirtTop) / 2, back * (d / 2 - 0.06), 0.12, skirtTop - 0.1, 0.12, 0xffffff, 1, 63 & ~12);
  if (q !== 'low') {
    for (const [ax, az] of SIDES4) {
      if (az === back) continue;
      const f = faceFrame(cx, cz, ax, az);
      const span = ax ? d : w, out = (ax ? w : d) / 2 - 0.03, bays = ax ? 1 : nx, bw = (span - 0.12) / bays;
      for (let i = 0; i < bays; i++) {
        const m = f.clone().multiply(new THREE.Matrix4().makeTranslation(-span / 2 + 0.06 + (i + 0.5) * bw, 0, 0));
        panels(bk, m, bw - 0.08, out, 0.24, skirtTop - 0.16, bw > 1.2 ? 2 : 1, shadeHex(C.violet, 0.78));
      }
    }
  }
  // Deck: planks along z (the wood's grain) over a dark underlay; Low: one board.
  if (q === 'low') cuboid(bk, 'wood', at, 0, top - deckH / 2, 0, w, deckH, d, 0xffffff, 1.5, 63 & ~8);
  else {
    cuboid(bk, 'flat', at, 0, top - deckH / 2 - 0.004, 0, w - 0.01, deckH - 0.008, d - 0.01, C.underlay, 1, 4);
    const n = Math.round(w / 0.32), pw = w / n;
    for (let i = 0; i < n; i++) cuboid(bk, 'wood', at, -w / 2 + (i + 0.5) * pw, top - deckH / 2, 0, pw - 0.018, deckH, d, 0xffffff, 1.5, 4 | 16 | 32);
  }
  // Gold nosing along the edges (1 cm proud), a few mm under the deck.
  const ny = top - 0.038;
  for (const s of [-1, 1]) {
    cuboid(bk, 'flat', at, 0, ny, s * (d / 2 - 0.02), w + 0.02, 0.07, 0.06, C.gold, 1, 63 & ~8);
    cuboid(bk, 'flat', at, s * (w / 2 - 0.02), ny, 0, 0.06, 0.07, d + 0.02, C.gold, 1, 63 & ~8);
  }
}

// ------------------------------------------------------------------ fountain

/**
 * The square's fountain at El Patio's quality: a cantera basin on a darker
 * plinth with talavera panels between pilasters, a two-course coping, inner
 * walls and a tiled floor under the water.
 */
function fountainBasin(bk: Bucket, b: MapBox, ripples: THREE.Vector2[]): void {
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const hw = (b.maxX - b.minX) / 2, hd = (b.maxZ - b.minZ) / 2, top = b.maxY;
  const at = new THREE.Matrix4().makeTranslation(cx, 0, cz);
  const plinthH = 0.12, copeH = 0.15, wallTop = top - copeH, rim = 0.32;
  cuboid(bk, 'cantera', at, 0, plinthH / 2, 0, hw * 2, plinthH, hd * 2, C.stoneDark, 1.2, 63 & ~8);
  cuboid(bk, 'cantera', at, 0, (plinthH + wallTop) / 2, 0, hw * 2 - 0.1, wallTop - plinthH, hd * 2 - 0.1, C.stoneWarm, 1.2, 63 & ~12);
  const panelH = wallTop - plinthH - 0.1;
  for (const [ax, az] of SIDES4) {
    const len = ax ? hd * 2 : hw * 2, out = ax ? hw : hd, f = faceFrame(cx, cz, ax, az);
    // Pilasters at the corners and the middle, talavera between them.
    for (const u of [-len / 2 + 0.14, 0, len / 2 - 0.14]) cuboid(bk, 'cantera', f, u, (plinthH + wallTop) / 2, out - 0.06, 0.28, wallTop - plinthH, 0.12, C.stone, 1.2);
    for (const s of [-1, 1]) {
      const a0 = s < 0 ? -len / 2 + 0.28 : 0.14, a1 = s < 0 ? -0.14 : len / 2 - 0.28;
      bk.add('talavera', boxGeo(a0, plinthH + 0.05, out - 0.07, a1, plinthH + 0.05 + panelH, out - 0.04, 0.5, 16), 0xffffff, 1, f);
    }
  }
  // Coping: a wide lower course (3 cm proud) and a narrower cap ring.
  cuboid(bk, 'cantera', at, 0, wallTop + 0.05, 0, hw * 2 + 0.06, 0.1, hd * 2 + 0.06, C.coping, 1.2, 63 & ~12);
  const o = hw - 0.02, inner = o - rim, y0 = wallTop + 0.1;
  for (const s of [-1, 1]) {
    cuboid(bk, 'cantera', at, 0, (y0 + top) / 2, s * (o - rim / 2), o * 2, top - y0, rim, C.coping, 1.2);
    cuboid(bk, 'cantera', at, s * (o - rim / 2), (y0 + top) / 2, 0, rim, top - y0, inner * 2, C.coping, 1.2);
  }
  // Inner walls facing the middle, a tiled floor, and the water a little below the coping.
  const floorY = 0.28;
  for (const [ax, az] of SIDES4) {
    const rot = new THREE.Matrix4().makeRotationY(ax ? (ax > 0 ? -Math.PI / 2 : Math.PI / 2) : (az > 0 ? Math.PI : 0));
    bk.add('cantera', boxGeo(-inner, floorY, -inner, inner, top, -inner + 0.01, 1.2, 16), C.stoneDark, 1, at.clone().multiply(rot));
  }
  bk.add('talavera', boxGeo(-inner, floorY - 0.01, -inner, inner, floorY, inner, 0.5, 4), 0x9fd9e0, 1, at);
  const waterY = top - 0.13;
  bk.add('water', boxGeo(-inner, waterY - 0.01, -inner, inner, waterY, inner, 1, 4), C.basin, 0.84, at);
  ripples.unshift(new THREE.Vector2(cx, cz));
}

/**
 * The fountain's pedestal (no statue on La Plaza): a stepped base standing in
 * the water, a shaft with talavera on all four faces between pilasters, and a
 * cap holding a small upper bowl of water flush under the box's top; four
 * brass spouts on the shaft pour thin arcs into the basin (High and Medium).
 */
function fountainPedestal(bk: Bucket, b: MapBox, basinTop: number, q: Quality, ripples: THREE.Vector2[]): void {
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, hw = (b.maxX - b.minX) / 2, top = b.maxY;
  const at = new THREE.Matrix4().makeTranslation(cx, 0, cz);
  const floorY = 0.28, waterY = basinTop - 0.13;
  cuboid(bk, 'cantera', at, 0, (floorY + basinTop - 0.05) / 2, 0, hw * 2 - 0.04, basinTop - 0.05 - floorY, hw * 2 - 0.04, C.stoneDark, 1.2, 63 & ~8);
  cuboid(bk, 'cantera', at, 0, basinTop, 0, hw * 2 - 0.2, 0.1, hw * 2 - 0.2, C.stone, 1.2, 63 & ~8);
  const s0 = basinTop + 0.05, s1 = top - 0.2, shaft = hw * 2 - 0.56;
  cuboid(bk, 'cantera', at, 0, (s0 + s1) / 2, 0, shaft, s1 - s0, shaft, C.stoneWarm, 1.2, 63 & ~12);
  for (const [ax, az] of SIDES4) {
    const f = faceFrame(cx, cz, ax, az), out = shaft / 2;
    bk.add('talavera', boxGeo(-shaft / 2 + 0.1, s0 + 0.04, out - 0.005, shaft / 2 - 0.1, s1 - 0.04, out + 0.015, 0.5, 16), 0xffffff, 1, f);
    for (const u of [-1, 1]) cuboid(bk, 'cantera', f, u * (shaft / 2 - 0.05), (s0 + s1) / 2, out - 0.03, 0.12, s1 - s0, 0.12, C.stone, 1.2);
  }
  // Cap: a moulded course, then the upper bowl (floor, rim and water) up to the box's top.
  const capW = hw * 2 - 0.04, o = capW / 2, rimW = 0.12, r0 = s1 + 0.08;
  cuboid(bk, 'cantera', at, 0, s1 + 0.04, 0, shaft + 0.2, 0.08, shaft + 0.2, C.coping, 1.2);
  cuboid(bk, 'cantera', at, 0, r0 + 0.02, 0, capW, 0.04, capW, C.stoneWarm, 1.2);
  for (const s of [-1, 1]) {
    cuboid(bk, 'cantera', at, 0, (r0 + top) / 2, s * (o - rimW / 2), capW, top - r0, rimW, C.coping, 1.2);
    cuboid(bk, 'cantera', at, s * (o - rimW / 2), (r0 + top) / 2, 0, rimW, top - r0, capW - 2 * rimW, C.coping, 1.2);
  }
  bk.add('water', boxGeo(-o + rimW, top - 0.05, -o + rimW, o - rimW, top - 0.04, o - rimW, 1, 4), C.basin, 0.84, at);
  if (q === 'low') return;
  const seg = q === 'high' ? 14 : 8, sy = s1 - 0.12;
  for (const [dx, dz] of SIDES4) {
    const f = faceFrame(cx, cz, dx, dz);
    bk.add('flat', new THREE.CylinderGeometry(0.035, 0.05, 0.16, 8).rotateX(Math.PI / 2), C.brass, 1, f.clone().multiply(new THREE.Matrix4().makeTranslation(0, sy, shaft / 2 + 0.06)));
    const p0 = new THREE.Vector3(cx + dx * (shaft / 2 + 0.13), sy, cz + dz * (shaft / 2 + 0.13));
    const p1 = new THREE.Vector3(cx + dx * 1.05, sy + 0.12, cz + dz * 1.05);
    const p2 = new THREE.Vector3(cx + dx * 1.6, waterY, cz + dz * 1.6);
    bk.add('water', new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(p0, p1, p2), seg, 0.028, q === 'high' ? 6 : 4, false), 0x8fe3ea, 0.78);
    ripples.push(new THREE.Vector2(p2.x, p2.z));
  }
}

// ------------------------------------------------------------------ trees

type Tree = NonNullable<MapDecor['trees']>[number];

/** Canopy clumps around the crown: [dx, y, dz, radius]. The lowest leaf stays above 3 m. */
const CLUMPS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 4.15, 0, 1.0], [0.75, 3.85, 0.3, 0.75], [-0.65, 3.95, -0.4, 0.78], [0.15, 4.7, -0.15, 0.72],
  [-0.4, 3.85, 0.62, 0.66], [0.45, 3.95, -0.7, 0.66], [-0.75, 4.4, 0.15, 0.6],
];

function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * A plaza tree: a tapering trunk from the planter's soil with a root flare,
 * three limbs above head height, and a canopy of faceted clumps shaded from
 * deep green underneath to sunlit green on top (fewer, coarser clumps on Low).
 */
function tree(bk: Bucket, tr: Tree, q: Quality, seed: number): void {
  const at = new THREE.Matrix4().makeTranslation(tr.x, 0, tr.z), radial = q === 'low' ? 6 : 8;
  const trunkTop = 3.4, h = trunkTop - tr.y;
  bk.add('flat', new THREE.CylinderGeometry(0.085, 0.13, h, radial, 1).translate(0, tr.y + h / 2, 0), C.bark, 1, at);
  bk.add('flat', new THREE.CylinderGeometry(0.13, 0.22, 0.14, radial, 1).translate(0, tr.y + 0.07, 0), C.barkDark, 1, at);
  for (let i = 0; i < 3; i++) {
    const a = seed * 1.3 + (i * Math.PI * 2) / 3;
    const p0 = new THREE.Vector3(0, 2.55 + i * 0.18, 0), p1 = new THREE.Vector3(Math.cos(a) * 0.62, 3.45 + i * 0.12, Math.sin(a) * 0.62);
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    const limb = new THREE.CylinderGeometry(0.04, 0.065, p0.distanceTo(p1), 6, 1);
    limb.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize()));
    limb.translate(mid.x, mid.y, mid.z);
    bk.add('flat', limb, C.bark, 1, at);
  }
  const dark = new THREE.Color(C.leafDark), mid = new THREE.Color(C.leafMid), light = new THREE.Color(C.leafLight), c = new THREE.Color();
  for (const [k, [dx, y, dz, r]] of CLUMPS.entries()) {
    if (q === 'low' && k > 4) continue;
    const g = new THREE.IcosahedronGeometry(1, q === 'low' ? 0 : 1);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    // Jitter each corner by a hash of where it is (shared corners move together: no cracks).
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), yy = p.getY(i), z = p.getZ(i), j = 0.82 + 0.3 * hash3(x + seed, yy + k, z);
      p.setXYZ(i, x * r * j, yy * r * 0.78 * j, z * r * j);
    }
    g.translate(dx, y, dz);
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      // Darker underneath and inside the crown, sunlit on top.
      const t = THREE.MathUtils.clamp((p.getY(i) - 3.3) / 1.9 + (hash3(p.getX(i), k, p.getZ(i)) - 0.5) * 0.18, 0, 1);
      if (t < 0.5) c.copy(dark).lerp(mid, t * 2); else c.copy(mid).lerp(light, (t - 0.5) * 2);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('normal'); // faceted: flat normals per face
    bk.add('leaf', g, 0xffffff, 1, at);
  }
}

// ------------------------------------------------------------------ contact shadows

/** A soft dark band on the paving around a footprint: grounds the object (no shadow map needed, so Low keeps it). */
function contactShadow(bk: Bucket, b: MapBox, width: number, strength: number): void {
  const x0 = b.minX, x1 = b.maxX, z0 = b.minZ, z1 = b.maxZ, o = width, y = 0.006, s = strength;
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
  g.computeVertexNormals();
  bk.add('shadow', g, 0x2a1810, 1);
}

// ------------------------------------------------------------------ water

/**
 * Restrained water, as El Patio's: the toon water colour with soft rings
 * spreading from the middle and where the arcs fall, and a slow broad
 * shimmer, from world position and time in the fragment shader. Low: still.
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
  mat.customProgramCacheKey = () => 'plaza-water';
  return { mat, time };
}

// ------------------------------------------------------------------ kiosks

/**
 * The kiosks are El Patio's (patio-focal.ts handles any kiosk box; the signs
 * stay where the arena puts them). Their merged geometry joins this set's
 * buckets, so they add no draw calls of their own; the brass finial goes in
 * with the painted parts.
 */
function kiosks(bk: Bucket, boxes: readonly MapBox[], q: Quality): void {
  if (!boxes.length) return;
  const f = buildFocal(boxes, q);
  for (const m of f.group.children as THREE.Mesh[]) {
    const k = m.name.replace('focal-', '');
    const key: MatKey | null = k === 'bronze' ? 'flat' : (ORDER as readonly string[]).includes(k) ? (k as MatKey) : null;
    if (key) bk.add(key, m.geometry, k === 'bronze' ? C.brass : 0xffffff);
    else m.geometry.dispose();
    for (const mm of [m.material].flat()) mm.dispose();
  }
}

// ------------------------------------------------------------------ build

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
const overlaps = (a: Rect, b: Rect) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

export function buildPlaza(boxes: readonly MapBox[], decor: MapDecor, quality: Quality): Dressing {
  const bk = new Bucket(), ripples: THREE.Vector2[] = [];
  const awnings = decor.awnings ?? [];
  const stalls = boxes.filter((b) => b.mat === 'stall');
  stalls.forEach((b, i) => { stall(bk, b, quality, i, awnings.find((a) => overlaps(a, b))); contactShadow(bk, b, 0.3, 0.28); });
  for (const a of awnings) awning(bk, a, stalls.find((s) => overlaps(a, s)), quality);
  for (const b of boxes) if (b.mat === 'stage') { stage(bk, b, quality); contactShadow(bk, b, 0.35, 0.3); }
  const fountains = boxes.filter((b) => b.mat === 'fountain');
  const basin = fountains.find((b) => b.minY === 0);
  if (basin) { fountainBasin(bk, basin, ripples); contactShadow(bk, basin, 0.45, 0.3); }
  for (const b of fountains) if (b !== basin) fountainPedestal(bk, b, basin?.maxY ?? b.minY, quality, ripples);
  kiosks(bk, boxes.filter((b) => b.mat === 'kiosk'), quality);
  (decor.trees ?? []).forEach((t, i) => tree(bk, t, quality, i));

  const kit = kitMaterials(quality);
  const water = waterMaterial(quality, ripples);
  const mats: Record<MatKey, THREE.Material> = {
    cantera: kit.cantera, talavera: kit.talavera, flat: kit.flat, wood: kit.wood, leaf: kit.leaf, water: water.mat,
    shadow: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
  };
  // The kit's other kinds are not used here.
  for (const [k, m] of Object.entries(kit)) if (!(ORDER as readonly string[]).includes(k)) m.dispose();
  const group = new THREE.Group();
  group.name = 'plaza-dressing';
  let calls = 0;
  for (const k of ORDER) {
    const g = bk.merged(k);
    if (!g) { mats[k].dispose(); continue; }
    const m = new THREE.Mesh(g, mats[k]);
    m.name = `plaza-${k}`;
    const solid = k !== 'water' && k !== 'shadow';
    m.castShadow = solid && quality !== 'low';
    m.receiveShadow = k !== 'shadow';
    if (k === 'water') m.renderOrder = 1;
    group.add(m);
    calls++;
  }
  return { group, calls, update(t: number) { water.time.value = t; } };
}

export const PLAZA_DRESSING: DressingModule = {
  mats: new Set(['stall', 'stage', 'fountain', 'kiosk']),
  decor: new Set(['awnings', 'trees'] as const),
  build: buildPlaza,
};
