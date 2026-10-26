// Graphics experiment: the El Patio kit. It draws the whole arena's
// buildings, walls, terrace, stairs, parapets and props (everything but the
// fountain, the statue and the kiosks) from the authoritative boxes.
// Everything here is visual: the collision boxes are not changed, no opening
// is cut into a wall, and decoration stays inside a box's footprint, flush
// with the ground, as shallow trim (at most ~0.3 m) on a wall, or above head
// height (lanterns, balconies, cornices, eaves).
//
// The kit is a small set of components (a window, a door, a cornice with a
// barrel-tile eave, a base band with pilasters, a coping, a blind arcade,
// stone steps with tiled risers, a tiled bench, a planter, a paved strip),
// each placed in a facade's own frame (along the wall, up, and out of it),
// and only on the parts of a face that no neighbouring box hides
// (patio-shapes.ts: exposedSpans). The Café Chancla and its point-mirrored
// Panadería Rosa keep the milestone 2 dressing as the kit's hero blocks.
//
// All geometry bakes into one mesh per material kind (and per spatial chunk,
// see CHUNKS); colours that only differ by tint share a material through
// vertex colours. Only walls, stone and the larger tinted pieces cast
// shadows; flush or thin details (glass, louvers, tiles, iron, leaves) do
// not. Low quality (no shadows) also gets lighter geometry.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EL_PATIO, type MapBox } from '../../../shared/map';
import type { Quality } from '../settings';
import { COLORS, boxGeo } from './materials';
import { ATLAS, TINTED, atlasUV, kitMaterials, type AtlasRegion, type Kind, type Mat } from './patio-materials';
import { archPanel, archRing, exposedSpans, faceCovered, faceOf, leafTuft, tileStrip, toAlong, SIDES, type Side } from './patio-shapes';

/** The hero blocks: the café and its point-mirrored Panadería keep their milestone 2 dressing. */
const ZONE = { minX: -8.3, maxX: 3.6, minZ: -11.2, maxZ: -4.4 };
const inZone = (b: MapBox): boolean => {
  const inside = (z: typeof ZONE) => b.minX >= z.minX && b.maxX <= z.maxX && b.minZ >= z.minZ && b.maxZ <= z.maxZ;
  return inside(ZONE) || inside({ minX: -ZONE.maxX, maxX: -ZONE.minX, minZ: -ZONE.maxZ, maxZ: -ZONE.minZ });
};

/**
 * The section can be switched off for the benchmark's production-equivalent
 * run: the same boxes then go through the arena's normal drawing, exactly as
 * in production.
 */
let enabled = true;
export function setSectionEnabled(on: boolean): void { enabled = on; }
export function sectionEnabled(): boolean { return enabled; }

const STUCCO: Record<string, number> = {
  stuccoTerracotta: 0xd8765a, stuccoCream: 0xf1dfbc, stuccoTurquoise: 0x7cc7bb, stuccoMarigold: 0xf0b45a,
  stuccoViolet: 0x8a6aa8, stuccoPink: 0xeb9aac,
};
/** Box types the kit draws. Fountain, statue and kiosks (whose signs the arena places itself) stay with production. */
const KIT_MATS: ReadonlySet<string> = new Set(['step', 'stone', 'parapet', 'lintel', 'planter', 'crate', 'bin']);

/** Called by the arena (El Patio only): which boxes the kit draws. */
export function inSection(b: MapBox): boolean {
  return b.mat in STUCCO || KIT_MATS.has(b.mat);
}

// ------------------------------------------------------------- facade frame

interface Frame { len: number; m: THREE.Matrix4 }

/** Local axes for a facade: x along the wall, y up, z out of it (origin at the wall's left end, ground level). */
function frameOf(b: MapBox, side: Side): Frame {
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

/** The face at a frame's far end (a = len); the near end (a = 0) is OPPOSITE[RIGHT_OF[side]]. */
const RIGHT_OF: Record<Side, Side> = { s: 'e', n: 'w', e: 'n', w: 's' };
const OPPOSITE: Record<Side, Side> = { s: 'n', n: 's', e: 'w', w: 'e' };
const FACE_BIT: Record<Side, 1 | 2 | 16 | 32> = { e: 1, w: 2, s: 16, n: 32 };

/**
 * How a run of trim ends: 'c' at a convex corner (the next face round is
 * seen too), 'f' flush against a neighbour that continues the wall, 'i' in
 * the middle of the face where a neighbour stands against it.
 */
type End = 'c' | 'f' | 'i';
interface Span { a0: number; a1: number; e0: End; e1: End }

// --------------------------------------------------------------- batching
// Materials that differ only in colour share one material: the colour goes
// into the vertices. One merged mesh per kind and chunk.
// 'detail' is 'flat' without shadows: iron, brass, roof tiles, flowers.
const CASTS: ReadonlySet<Kind> = new Set<Kind>(['plaster', 'cantera', 'flat']);

/**
 * Spatial chunks, so the parts of the arena behind the camera can be
 * frustum culled. A chunk is a cell of this grid over the arena (by box
 * centre); each costs one draw per kind present (and per casting kind in the
 * shadow pass).
 */
// Measured (milestone 3): from inside the arena the 85° view sees most cells,
// and the shadow pass draws every casting chunk anyway, so a 2 x 2 grid cost
// 34-42 more draw calls to save 3-12k triangles per view. One cell it is.
const CHUNKS = { nx: 1, nz: 1, minX: -28, maxX: 28, minZ: -20, maxZ: 20 };
function chunkOf(b: MapBox): string {
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const i = Math.min(CHUNKS.nx - 1, Math.max(0, Math.floor((cx - CHUNKS.minX) / (CHUNKS.maxX - CHUNKS.minX) * CHUNKS.nx)));
  const j = Math.min(CHUNKS.nz - 1, Math.max(0, Math.floor((cz - CHUNKS.minZ) / (CHUNKS.maxZ - CHUNKS.minZ) * CHUNKS.nz)));
  return `${i}${j}`;
}

// ----------------------------------------------------------- baked shading
// Light the sun and the sky cannot be relied on to separate: eave soffits,
// the undersides of cornices, lintels and sills, door and window reveals.
// It is baked into vertex colours (no screen-space pass), so it costs nothing
// at run time and reads the same on Low (no shadow map). Kept restrained:
// these faces are mostly turned from the sun, so High's shadow map does not
// darken them again (noBackfaceShadow skips its test there), and the lit
// faces it does shade (the wall under an eave) get only a light gradient.
/** Every downward-facing face (soffits, undersides): a step darker than shade. */
const SOFFIT = 0.78;
/**
 * A facade's top band under its eave: from 1 at EAVE_BAND below the
 * roofline, through EAVE_MID at EAVE_DARK below it (the eave's shadow band,
 * just under the cornice), to EAVE_K at the roofline (behind the cornice).
 */
const EAVE_BAND = 1.25, EAVE_DARK = 0.55, EAVE_MID = 0.76, EAVE_K = 0.7;
/** How far the eave (board and tiles) overhangs the wall: deeper than the cornice, always above head height. */
const EAVE_OUT = 0.64;
/**
 * Weathering by height on plaster that stands on the ground, as control
 * points (height, shade) the wall's vertex colours run through linearly:
 * the foot darker and stained (splash and rising damp), easing out by about
 * 2.2 m, a slightly deeper middle, and the top paler, sun-bleached, up to
 * the eave band (which then darkens toward the roofline as before). A wall
 * body is drawn in rows at these heights: two triangles per face per row.
 */
const FOOT: ReadonlyArray<readonly [number, number]> = [[0, 0.74], [0.9, 0.79], [2.4, 0.95]];
const WALL_MID = 0.95, WALL_TOP = 1, BLEACH_BAND = 1.6;
function weatherRows(minY: number, maxY: number, eave: boolean): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  if (minY <= 0.001) { for (const [y, k] of FOOT) if (y < maxY - 0.3) pts.push([y, k]); } else pts.push([minY, WALL_MID]);
  const yb = maxY - (eave ? EAVE_BAND : BLEACH_BAND);
  if (yb > pts[pts.length - 1]![0] + 0.3) pts.push([yb, WALL_TOP]);
  if (eave && maxY - EAVE_DARK > pts[pts.length - 1]![0] + 0.2) pts.push([maxY - EAVE_DARK, EAVE_MID]);
  pts.push([maxY, eave ? EAVE_K : WALL_TOP]);
  return pts;
}
/** The weathering shade at height y on a wall from minY to maxY (see weatherRows). */
function weatherAt(y: number, minY: number, maxY: number, eave: boolean): number {
  const pts = weatherRows(minY, maxY, eave);
  if (y <= pts[0]![0]) return pts[0]![1];
  for (let i = 1; i < pts.length; i++) {
    const [y0, k0] = pts[i - 1]!, [y1, k1] = pts[i]!;
    if (y <= y1) return k0 + (k1 - k0) * (y - y0) / Math.max(1e-6, y1 - y0);
  }
  return pts[pts.length - 1]![1];
}
/** Per-vertex shade in a facade frame (local position and normal: x along, y up, z out). */
type ShadeFn = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number;
/** Faces of a reveal turned toward the opening (normal along +x or -x in the frame). */
const reveal = (dir: 1 | -1, k: number): ShadeFn => (_x, _y, _z, nx) => (nx * dir > 0.5 ? k : 1);
/** The head of a reveal: a lintel's underside a step darker than the other soffits. */
const HEAD: ShadeFn = (_x, _y, _z, _nx, ny) => (ny < -0.5 ? 0.72 : 1);
/** A sill: the top lit, the front and ends a step darker. */
const SILL: ShadeFn = (_x, _y, _z, _nx, ny) => (ny > 0.5 ? 1 : 0.84);
/** A vertical gradient: k0 at y0, k1 at y1 (clamped). */
const grade = (y0: number, y1: number, k0: number, k1: number): ShadeFn => (_x, y) => k0 + (k1 - k0) * Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
/** Sets a geometry's 'shade' attribute (read and dropped by KindBatch.add) from its current positions and normals. */
function shadeGeo(g: THREE.BufferGeometry, fn: ShadeFn): THREE.BufferGeometry {
  const p = g.getAttribute('position') as THREE.BufferAttribute, nr = g.getAttribute('normal') as THREE.BufferAttribute;
  const out = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) out[i] = fn(p.getX(i), p.getY(i), p.getZ(i), nr.getX(i), nr.getY(i), nr.getZ(i));
  g.setAttribute('shade', new THREE.BufferAttribute(out, 1));
  return g;
}

class KindBatch {
  chunk = '00';
  private b = new Map<string, { k: Kind; gs: THREE.BufferGeometry[] }>();
  private tmp = new THREE.Color();
  add(m: Mat, g: THREE.BufferGeometry): void {
    const keep = TINTED.has(m.k) && g.getAttribute('color') ? 'color' : ''; // a geometry may bring its own shading (pavers, leaves, tiles)
    const shade = g.getAttribute('shade') as THREE.BufferAttribute | undefined;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== keep) g.deleteAttribute(k);
    const n = (g.getAttribute('position') as THREE.BufferAttribute).count;
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.index) g.setIndex(Array.from({ length: n }, (_, i) => i));
    if (TINTED.has(m.k) && !keep) {
      this.tmp.setHex(m.c ?? 0xffffff); // sRGB hex to the linear working space, like a material colour
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = this.tmp.r; col[i * 3 + 1] = this.tmp.g; col[i * 3 + 2] = this.tmp.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    // Baked shading (foliage keeps its own: its cards face every way).
    const col = g.getAttribute('color') as THREE.BufferAttribute | undefined, nr = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
    if (col && m.k !== 'leaf') for (let i = 0; i < n; i++) {
      const f = (shade ? shade.getX(i) : 1) * (nr && nr.getY(i) < -0.5 ? SOFFIT : 1);
      if (f !== 1) col.setXYZ(i, col.getX(i) * f, col.getY(i) * f, col.getZ(i) * f);
    }
    const key = `${this.chunk}:${m.k}`;
    let e = this.b.get(key);
    if (!e) { e = { k: m.k, gs: [] }; this.b.set(key, e); }
    e.gs.push(g);
  }
  addMesh(m: Mat, geo: THREE.BufferGeometry, matrix: THREE.Matrix4): void { this.add(m, geo.clone().applyMatrix4(matrix)); }
  build(group: THREE.Group, materials: Record<Kind, THREE.Material>): number {
    let calls = 0;
    for (const [key, { k, gs }] of this.b) {
      const merged = mergeGeometries(gs, false);
      gs.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, materials[k]);
      mesh.name = `section-${key}`;
      mesh.castShadow = CASTS.has(k);
      mesh.receiveShadow = true;
      group.add(mesh);
      calls++;
    }
    this.b.clear();
    return calls;
  }
}

/** Map-specific inputs: El Patio's by default. */
export interface SectionOptions {
  /** The café and the Panadería (El Patio only) get their hero dressing. */
  heroZone?: boolean;
  /** Team banners hung on the walls (windows keep clear of them). */
  banners?: ReadonlyArray<{ x: number; z: number }>;
}

/** Builds the kit for the given boxes. Returns the group and its draw-call count. */
export function buildSection(boxes: readonly MapBox[], quality: Quality = 'high', opts: SectionOptions = {}): { group: THREE.Group; calls: number } {
  const heroZone = opts.heroZone ?? true;
  const banners = opts.banners ?? EL_PATIO.decor?.banners ?? [];
  const lite = quality === 'low'; // no shadows on Low, so the smallest details go too
  const group = new THREE.Group();
  group.name = 'section-patio';
  const batch = new KindBatch();
  const materials = kitMaterials(quality);
  const M = {
    trim: { k: 'plaster', c: 0xfbf1dc },
    // Small trim (caps, keystones, corbels): untextured and casting no shadow. Its shadow is
    // smaller than a shadow-map texel and drew a sawtooth on the lintel under it.
    trimSmall: { k: 'detail', c: 0xfbf1dc }, cantera: { k: 'cantera', c: 0xe6cfa6 }, pot: { k: 'cantera', c: COLORS.terracottaDark },
    talavera: { k: 'talavera', c: null }, glass: { k: 'glass', c: null }, wood: { k: 'wood', c: null }, lamp: { k: 'lamp', c: null },
    iron: { k: 'detail', c: 0x2a1d2c }, woodDark: { k: 'detail', c: 0x6a4428 }, brass: { k: 'detail', c: COLORS.gold },
    tileA: { k: 'detail', c: COLORS.terracotta }, tileB: { k: 'detail', c: 0xb24a33 }, tileC: { k: 'detail', c: 0xd66a4b },
    eave: { k: 'flat', c: 0x7a3a2a }, soil: { k: 'flat', c: 0x5b3a22 }, spout: { k: 'flat', c: 0xb24a33 },
    leaf: { k: 'leaf', c: null }, crate: { k: 'flat', c: 0x7a5236 }, bin: { k: 'flat', c: 0x3d7d5a }, binLid: { k: 'detail', c: 0x2f5f45 },
    pink: { k: 'detail', c: COLORS.pink }, marigold: { k: 'detail', c: COLORS.marigold },
  } satisfies Record<string, Mat>;
  const wallMat = (c: number): Mat => ({ k: 'plaster', c });
  const shutterMat = (c: number): Mat => ({ k: 'louver', c });
  const pavers: Mat = { k: 'pavers', c: null };
  const STONE = 0xead8b4; // terrace and stair plaster: a warm stone white
  const BUD = new THREE.IcosahedronGeometry(0.5, 0);
  const POT = new THREE.CylinderGeometry(0.5, 0.38, 1, lite ? 8 : 10);
  const BIN = new THREE.CylinderGeometry(0.5, 0.5, 1, lite ? 8 : 12, 1, true);
  // Roof tiles are far above the eye line: six-sided on High, four on Medium and Low (hero blocks).
  const TILE = new THREE.CylinderGeometry(0.5, 0.5, 1, quality === 'high' ? 6 : 4, 1, false, 0, Math.PI);
  const TILE_COLORS = [COLORS.terracotta, 0xb24a33, COLORS.terracotta, 0xd66a4b];
  // Stylized leaves: a few tuft variants, light and dark, baked with their own colours.
  const BLADES = lite ? 5 : 7;
  // Window boxes are small and high up: one or two tiers of five blades.
  const SPRIG = [leafTuft(5, 0x2f5a2c, COLORS.leaf, 5, lite ? 1 : 2), leafTuft(5, 0x284a26, 0x4f8a40, 9, lite ? 1 : 2)];
  // The rest of the arena (not the hero blocks) uses lighter flowers, pots and ironwork.
  const FLOWER = new THREE.OctahedronGeometry(0.5, 0);
  const POT_S = new THREE.CylinderGeometry(0.5, 0.38, 1, 6, 1, true);
  let hero = false;
  const TUFTS = [
    leafTuft(BLADES, 0x2f5a2c, COLORS.leaf, 3), leafTuft(BLADES, 0x284a26, 0x4f8a40, 7),
    leafTuft(BLADES, 0x2f5a2c, 0x6aa852, 11),
  ];

  /** A box in a facade frame: a = along, y = up, n = out of the wall. Faces against the wall or the ground are never seen, so they are left out. */
  const fbox = (f: Frame, mat: Mat, a0: number, y0: number, n0: number, a1: number, y1: number, n1: number, uv = 1, drop = 0, sh?: ShadeFn) => {
    if (a1 - a0 < 0.005) return;
    const faces = 63 & ~(n0 <= 0 ? 32 : 0) & ~(y0 <= 0 ? 8 : 0) & ~drop;
    const g = boxGeo(a0, y0, n0, a1, y1, n1, uv, faces);
    batch.add(mat, (sh ? shadeGeo(g, sh) : g).applyMatrix4(f.m));
  };
  /** A mesh (unit geometry) in a facade frame. */
  const fmesh = (f: Frame, mat: Mat, geo: THREE.BufferGeometry, a: number, y: number, n: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) => {
    const local = new THREE.Matrix4().compose(new THREE.Vector3(a, y, n), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    batch.addMesh(mat, geo, new THREE.Matrix4().multiplyMatrices(f.m, local));
  };
  /** Geometry already in a facade frame's local coordinates. */
  const fgeo = (f: Frame, mat: Mat, g: THREE.BufferGeometry) => batch.add(mat, g.applyMatrix4(f.m));
  /**
   * Paving lying flush on the ground in a facade frame (along a0..a1, out 0..depth),
   * with the wall's contact shade baked into its vertex colours: darker at
   * the wall, clear from `shade` metres out. World-scale UVs keep one paver size.
   */
  const paving = (f: Frame, a0: number, a1: number, depth: number, shade: number, uvScale: number) => {
    const len = a1 - a0;
    if (len < 0.05) return;
    const g = new THREE.PlaneGeometry(len, depth, 1, 2);
    g.rotateX(-Math.PI / 2);
    g.translate(a0 + len / 2, 0.008, depth / 2);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    // Rows at 0, depth/2, depth: move the middle row to where the shade ends.
    for (let i = 0; i < p.count; i++) if (Math.abs(p.getZ(i) - depth / 2) < 1e-6) p.setZ(i, Math.min(shade, depth));
    const col = new Float32Array(p.count * 3), uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const k = shade > 0 ? 0.62 + 0.38 * Math.min(1, p.getZ(i) / shade) : 1;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.applyMatrix4(f.m);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / uvScale, p.getZ(i) / uvScale);
    batch.add(pavers, g);
  };
  /** Paving on a box's top (a walkable roof), at world scale, no shade. */
  const topPaving = (b: MapBox) => {
    const g = new THREE.PlaneGeometry(b.maxX - b.minX, b.maxZ - b.minZ);
    g.rotateX(-Math.PI / 2);
    g.translate((b.minX + b.maxX) / 2, b.maxY + 0.008, (b.minZ + b.maxZ) / 2);
    const p = g.getAttribute('position') as THREE.BufferAttribute, uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 2.4, p.getZ(i) / 2.4);
    batch.add(pavers, g);
  };
  /**
   * A talavera panel on one side face of a world box, with whole tiles: the
   * UVs are fitted so tile edges meet the panel edges (about 0.3 m tiles).
   */
  const tilePanel = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, face: 1 | 2 | 16 | 32) => {
    const g = boxGeo(minX, minY, minZ, maxX, maxY, maxZ, 1, face);
    const along = face <= 2 ? maxZ - minZ : maxX - minX;
    const nx = Math.max(1, Math.round(along / 0.3)) / 4, ny = Math.max(1, Math.round((maxY - minY) / 0.3)) / 4; // 4 tiles per texture
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const corner = [[0, 0], [nx, 0], [nx, ny], [0, ny]] as const;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, corner[i % 4]![0], corner[i % 4]![1]);
    batch.add(M.talavera, g);
  };
  /** Which side of a prop faces the plaza (the map is point-symmetric about the origin): the face to dress. */
  const plazaFace = (b: MapBox): Side => ((b.minZ + b.maxZ) / 2 < 0 ? 's' : 'n');
  /** A thin world box on one face of b (from the face out by n0..n1), spanning y0..y1 and the face's along range lo..hi. */
  const onFace = (b: MapBox, side: Side, lo: number, hi: number, y0: number, y1: number, n0: number, n1: number): [number, number, number, number, number, number] => {
    const f = faceOf(b, side);
    const p0 = f.plane + f.out * n0, p1 = f.plane + f.out * n1;
    const [q0, q1] = [Math.min(p0, p1), Math.max(p0, p1)];
    return f.axis === 'z' ? [lo, y0, q0, hi, y1, q1] : [q0, y0, lo, q1, y1, hi];
  };

  // ------------------------------------------------------- exposure helpers

  /** The exposed runs of a face in the frame's `a`, over the height band y0..y1, with how each end meets its surroundings. */
  const spansOf = (b: MapBox, side: Side, y0: number, y1: number): Span[] => {
    const len = frameOf(b, side).len;
    // The corner a face shares with the next face round lies, along that next face, at this face's plane.
    const corner = faceOf(b, side).plane;
    const endAt = (a: number, nextSide: Side): End => {
      if (a > 0.01 && a < len - 0.01) return 'i';
      // At a corner: convex when the next face round is exposed right at that corner.
      const seen = exposedSpans(boxes, b, nextSide, y0, y1).some(([l, h]) => Math.abs(l - corner) < 0.05 || Math.abs(h - corner) < 0.05);
      return seen ? 'c' : 'f';
    };
    return exposedSpans(boxes, b, side, y0, y1).map(([lo, hi]) => {
      const p = toAlong(b, side, lo), q = toAlong(b, side, hi), a0 = Math.min(p, q), a1 = Math.max(p, q);
      return { a0, a1, e0: endAt(a0, OPPOSITE[RIGHT_OF[side]]), e1: endAt(a1, RIGHT_OF[side]) };
    });
  };
  /**
   * The along-range for a piece of trim on a span whose own depth is n0..n1:
   * at a convex far end it runs on over the next face's trim (by its depth);
   * at a convex near end it starts behind the previous face's trim; flush
   * ends stop at the corner; interior ends stop short of the neighbour's trim.
   */
  const run = (s: Span, n0: number, n1: number): [number, number] => [
    s.a0 + (s.e0 === 'i' ? n1 + 0.01 : s.e0 === 'c' ? Math.max(0, -n0) : 0),
    s.a1 + (s.e1 === 'c' ? n1 : s.e1 === 'i' ? -(n1 + 0.01) : 0),
  ];
  /** fbox along a span, its along-range adjusted for how the span ends. */
  const sbox = (f: Frame, s: Span, mat: Mat, y0: number, n0: number, y1: number, n1: number, uv = 1, drop = 0, sh?: ShadeFn) => {
    const [a0, a1] = run(s, n0, n1);
    fbox(f, mat, a0, y0, n0, a1, y1, n1, uv, drop, sh);
  };
  /** A box's body: faces fully hidden by neighbours (and the ground face) are left out. */
  const body = (b: MapBox, mat: Mat, uv: number, top = true, y1 = b.maxY, eave = false, bottom = true) => {
    let faces = top ? 4 : 0;
    for (const s of SIDES) if (!faceCovered(boxes, b, s, b.minY, y1)) faces |= FACE_BIT[s];
    if (b.minY > 0 && bottom) faces |= 8;
    // Long walls that run into a crossing wall stop at its face (no coplanar overlap at the corners).
    let { minX, maxX, minZ, maxZ } = b;
    for (const o of boxes) {
      if (o === b || o.maxY < y1 || o.minY > b.minY) continue;
      const alongZ = b.maxZ - b.minZ > b.maxX - b.minX;
      if (alongZ && o.minX <= b.minX && o.maxX >= b.maxX && o.maxZ > minZ && o.minZ < maxZ) {
        if (o.minZ <= minZ) { minZ = Math.max(minZ, o.maxZ); faces &= ~32; } else if (o.maxZ >= maxZ) { maxZ = Math.min(maxZ, o.minZ); faces &= ~16; }
      }
    }
    walls(mat, minX, b.minY, minZ, maxX, y1, maxZ, uv, faces, eave);
    return { minX, maxX, minZ, maxZ };
  };
  /**
   * A wall body box, drawn in rows (weatherRows) whose side faces carry the
   * weathering: the stained foot, the paler top and, under an eave, the
   * darkening toward the roofline. Same UVs throughout.
   */
  const walls = (mat: Mat, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, uv: number, faces: number, eave: boolean) => {
    const rows = weatherRows(minY, maxY, eave), sides = faces & ~12;
    for (let i = 1; i < rows.length; i++) {
      const [y0, k0] = rows[i - 1]!, [y1, k1] = rows[i]!;
      const fc = sides | (i === 1 ? faces & 8 : 0) | (i === rows.length - 1 ? faces & 4 : 0);
      const gr = grade(y0, y1, k0, k1);
      batch.add(mat, shadeGeo(boxGeo(minX, y0, minZ, maxX, y1, maxZ, uv, fc), (x, y, z, nx, ny, nz) => (Math.abs(ny) > 0.5 ? 1 : gr(x, y, z, nx, ny, nz))));
    }
  };
  /**
   * A few patches of wear low on a wall face (0.95 to about 2 m, where the
   * windows never are on these faces): mostly bare masonry where the plaster
   * has spalled off (stone, jagged outline), now and then a paler lime
   * repair. One per ~6 m of exposed wall, the first near a convex corner.
   * Flat shapes 12 mm proud, shaded with the wall's weathering. Seeded by
   * the box, so the arena is the same every time.
   */
  const wallPatches = (b: MapBox, side: Side, col: number) => {
    const f = frameOf(b, side);
    let seed = Math.abs(Math.round(b.minX * 73 + b.minZ * 151 + b.maxX * 11 + b.maxZ * 29)) + side.charCodeAt(0) * 977;
    const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const stone = new THREE.Color().setHex(col).lerp(new THREE.Color().setHex(0x8c7a68), 0.6).getHex();
    const lime = new THREE.Color().setHex(col).lerp(new THREE.Color().setHex(0xfff8ea), 0.14).getHex();
    for (const s of spansOf(b, side, 0.9, 2.2)) {
      const L = s.a1 - s.a0;
      if (L < 2) continue;
      const n = Math.max(1, Math.round(L / 6));
      for (let i = 0; i < n; i++) {
        const bare = r() < 0.7, w = 0.6 + r() * 0.7, h = 0.4 + r() * 0.45, y0 = 0.95 + r() * 0.25;
        let a = s.a0 + (i + 0.2 + r() * 0.6) * (L / n);
        if (i === 0 && s.e0 === 'c') a = s.a0 + 0.35 + w / 2 + r() * 0.3;
        else if (i === n - 1 && s.e1 === 'c' && r() < 0.5) a = s.a1 - 0.35 - w / 2 - r() * 0.3;
        a = Math.min(s.a1 - w / 2 - 0.05, Math.max(s.a0 + w / 2 + 0.05, a));
        // Where a lane-wall piece already sits (a painted advert, a meter), the patch is left out.
        if (taken(b, side).some(([p, q, u, v]) => a - w / 2 < q + 0.1 && a + w / 2 > p - 0.1 && y0 < v && y0 + h > u)) continue;
        // A jagged outline (bare masonry) or a softer, squarer one (a repair).
        const shape = new THREE.Shape(), k = 11;
        for (let j = 0; j < k; j++) {
          const t = (j / k) * Math.PI * 2, jit = bare ? 0.72 + r() * 0.38 : 0.92 + r() * 0.1;
          const cx = Math.cos(t), cy = Math.sin(t), sq = bare ? 1 : 1.35; // repairs bulge toward a rectangle
          const px = a + (w / 2) * jit * Math.sign(cx) * Math.pow(Math.abs(cx), 1 / sq), py = y0 + h / 2 + (h / 2) * jit * Math.sign(cy) * Math.pow(Math.abs(cy), 1 / sq);
          if (j === 0) shape.moveTo(px, py); else shape.lineTo(px, py);
        }
        const g = new THREE.ShapeGeometry(shape);
        g.translate(0, 0, 0.012);
        shadeGeo(g, (_x, y) => weatherAt(y, 0, b.maxY, true) * (bare ? 0.92 : 1));
        g.applyMatrix4(f.m);
        const p = g.getAttribute('position') as THREE.BufferAttribute, nr = g.getAttribute('normal') as THREE.BufferAttribute, uv = g.getAttribute('uv') as THREE.BufferAttribute;
        const sc = bare ? 1 : 2; // stone at the cantera's scale, a repair at the plaster's
        for (let j = 0; j < p.count; j++) uv.setXY(j, (Math.abs(nr.getX(j)) > 0.5 ? p.getZ(j) : p.getX(j)) / sc, p.getY(j) / sc);
        batch.add(bare ? { k: 'cantera', c: stone } : wallMat(lime), g);
      }
    }
  };
  /** The wall a window is being placed on (its colour and height band), for the stain under its sill. */
  let wallOf: { col: number; minY: number; maxY: number; eave: boolean } | null = null;
  /**
   * A faint stain run down the plaster under an upper sill: a flat fan of
   * the wall's own material just proud of the wall, darker under the sill's
   * middle and fading to the wall's exact colour (weathering included) at
   * its edges, with the wall's world UVs so the texture runs through.
   */
  const sillStain = (f: Frame, a: number, y1: number, hw: number) => {
    if (!wallOf) return;
    const w = wallOf, y0 = Math.max(y1 - 1.3, w.minY + 1);
    if (y1 - y0 < 0.4) return;
    const g = new THREE.PlaneGeometry(2 * hw, y1 - y0, 2, 1);
    g.translate(a, (y0 + y1) / 2, 0.006);
    shadeGeo(g, (x, y) => weatherAt(y, w.minY, w.maxY, w.eave) * (Math.abs(x - a) < 0.01 && y > y1 - 0.01 ? 0.86 : 1));
    g.applyMatrix4(f.m);
    const p = g.getAttribute('position') as THREE.BufferAttribute, nr = g.getAttribute('normal') as THREE.BufferAttribute, uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (Math.abs(nr.getX(i)) > 0.5 ? p.getZ(i) : p.getX(i)) / 2, p.getY(i) / 2);
    batch.add(wallMat(w.col), g);
  };

  // -------------------------------------------------------------- components

  function windowUnit(f: Frame, a: number, wy: number, shutter: number, ground: boolean, balcony: boolean): void {
    const hw = 0.45, hh = 0.6, top = wy + hh, bot = wy - hh;
    // Glass, flush with the wall, its texture fitted to the opening (frame, panes, the reveal's shadow).
    const gl = boxGeo(a - hw, bot, 0, a + hw, top, 0.012, 1, 63 & ~32);
    const gp = gl.getAttribute('position') as THREE.BufferAttribute, guv = gl.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < gp.count; i++) guv.setXY(i, ...atlasUV(ATLAS.glass, (gp.getX(i) - (a - hw)) / (2 * hw), (gp.getY(i) - bot) / (top - bot)));
    batch.add(M.glass, shadeGeo(gl, grade(bot, top, 1, 0.9)).applyMatrix4(f.m));
    fbox(f, M.trim, a - hw - 0.1, bot, 0, a - hw, top, 0.17, 1, 0, reveal(1, 0.64));  // jambs: a 0.16 m reveal, the inner faces in shade
    fbox(f, M.trim, a + hw, bot, 0, a + hw + 0.1, top, 0.17, 1, 0, reveal(-1, 0.64));
    fbox(f, M.trim, a - hw - 0.14, top, 0, a + hw + 0.14, top + 0.16, 0.2, 1, 0, HEAD);  // lintel, its underside (the head of the reveal) dark
    fbox(f, M.trimSmall, a - hw - 0.2, top + 0.16, 0, a + hw + 0.2, top + 0.22, 0.26); // its cap
    const small = hero || !lite; // Low drops the keystones and corbels off the hero blocks
    if (small) fbox(f, M.trimSmall, a - 0.08, top - 0.04, 0, a + 0.08, top + 0.2, 0.23, 1, hero ? 0 : 4); // keystone (its top is inside the cap)
    fbox(f, M.cantera, a - hw - 0.16, bot - 0.08, 0, a + hw + 0.16, bot, 0.25, 0.8, 0, SILL); // sill: a lit top, its front and ends a step darker
    if (small) for (const s of [-1, 1]) fbox(f, M.trimSmall, a + s * (hw - 0.02) - 0.05, bot - 0.22, 0, a + s * (hw - 0.02) + 0.05, bot - 0.08, 0.17, 1, hero ? 0 : 4); // corbels, under the sill
    // Louvered shutters folded back against the wall.
    for (const s of [-1, 1]) fbox(f, shutterMat(shutter), a + s * (hw + 0.12) - (s > 0 ? 0 : 0.42), bot + 0.02, 0.02, a + s * (hw + 0.12) + (s > 0 ? 0.42 : 0), top - 0.02, 0.06, 0.6);
    if (ground) {
      // Wrought bars inside the reveal, with a top and bottom rail.
      // Off the hero blocks the bars lose their end faces (hidden in the reveal) and the rails their ends.
      if (!lite) for (let i = -2; i <= 2; i++) fbox(f, M.iron, a + i * 0.17 - 0.013, bot + 0.02, 0.1, a + i * 0.17 + 0.013, top - 0.02, 0.126, 1, hero ? 0 : 12);
      for (const y of [bot + 0.12, top - 0.12]) fbox(f, M.iron, a - hw, y - 0.015, 0.1, a + hw, y + 0.015, 0.13, 1, hero ? 0 : 3);
    } else if (balcony) {
      sillStain(f, a, bot - 0.42, 0.62);
      // Juliet balcony: a molded slab on two corbels, iron railing, flower pots. Above head height.
      const sy = bot - 0.1;
      fbox(f, M.cantera, a - 0.75, sy - 0.08, 0, a + 0.75, sy, 0.34);
      fbox(f, M.trim, a - 0.68, sy - 0.14, 0, a + 0.68, sy - 0.08, 0.28);
      for (const s of [-1, 1]) fbox(f, M.trimSmall, a + s * 0.55 - 0.06, sy - 0.32, 0, a + s * 0.55 + 0.06, sy - 0.14, 0.22);
      for (let i = -6; i <= 6; i += lite ? 2 : 1) fbox(f, M.iron, a + i * 0.115 - 0.012, sy, 0.3, a + i * 0.115 + 0.012, sy + 0.62, 0.324, 1, hero ? 0 : 12);
      for (const y of [sy + 0.05, sy + 0.6]) fbox(f, M.iron, a - 0.74, y - 0.02, 0.29, a + 0.74, y + 0.02, 0.33);
      for (const s of [-0.45, 0, 0.45]) {
        fmesh(f, M.pot, hero ? POT : POT_S, a + s, sy + 0.1, 0.17, 0.2, 0.2, 0.2);
        fmesh(f, s ? M.pink : M.marigold, hero ? BUD : FLOWER, a + s, sy + 0.28, 0.17, 0.26, 0.22, 0.26);
      }
    } else {
      sillStain(f, a, bot - 0.08, 0.56);
      // Window box with a little greenery.
      fbox(f, M.pot, a - 0.44, bot - 0.08, 0.06, a + 0.44, bot + 0.1, 0.24);
      for (const s of [-0.28, 0, 0.28]) fmesh(f, M.leaf, hero ? TUFTS[s ? 0 : 1]! : SPRIG[s ? 0 : 1]!, a + s, bot + 0.08, 0.15, 0.36, 0.28, 0.3, 0, s * 4);
      fmesh(f, M.pink, hero ? BUD : FLOWER, a - 0.15, bot + 0.3, 0.2, 0.12, 0.12, 0.12);
      fmesh(f, M.marigold, hero ? BUD : FLOWER, a + 0.17, bot + 0.29, 0.2, 0.12, 0.12, 0.12);
    }
  }

  function doorUnit(f: Frame, a: number): void {
    const hw = 0.62, top = 2.4;
    // Casing and a molded head; the leaves sit 0.14 m back from the casing face.
    fbox(f, M.trim, a - hw - 0.14, 0, 0, a - hw, top, 0.18, 1, 0, reveal(1, 0.62));
    fbox(f, M.trim, a + hw, 0, 0, a + hw + 0.14, top, 0.18, 1, 0, reveal(-1, 0.62));
    fbox(f, M.trim, a - hw - 0.18, top, 0, a + hw + 0.18, top + 0.2, 0.22, 1, 0, HEAD);
    fbox(f, M.trimSmall, a - hw - 0.26, top + 0.2, 0, a + hw + 0.26, top + 0.27, 0.3);
    // Two closed wooden leaves with raised panels, a center stile and brass handles.
    // In the doorway's shade: darker toward the head, and the raised panels' edges a step darker (the joints).
    const inDoor = grade(0, top, 0.95, 0.76);
    const panel: ShadeFn = (x, y, z, nx, ny, nz) => inDoor(x, y, z, nx, ny, nz) * (Math.abs(nx) > 0.5 ? 0.78 : 1);
    fbox(f, M.wood, a - hw, 0, 0, a + hw, top, 0.03, 0.6, 0, inDoor);
    fbox(f, M.woodDark, a - 0.02, 0.02, 0.03, a + 0.02, top - 0.02, 0.05, 1, 0, panel);
    for (const s of [-1, 1]) for (const [y0, y1] of [[0.18, 0.9], [1.05, 1.65], [1.8, 2.25]] as const) {
      const ax0 = s < 0 ? a - hw + 0.1 : a + 0.1, ax1 = s < 0 ? a - 0.1 : a + hw - 0.1;
      fbox(f, M.woodDark, ax0, y0, 0.03, ax1, y1, 0.045, 1, 0, inDoor);
      fbox(f, M.wood, ax0 + 0.05, y0 + 0.05, 0.045, ax1 - 0.05, y1 - 0.05, 0.06, 0.6, 0, panel);
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
      if (!lite) for (const c of [-1, 1]) for (const d of [0.18, 0.36]) fbox(f, M.iron, la + c * 0.09 - 0.012, 2.06, d - 0.012, la + c * 0.09 + 0.012, 2.3, d + 0.012, 1, hero ? 0 : 12);
    }
  }

  /** Hero blocks: cornice in three steps and a barrel-tile eave (milestone 2). */
  function roofUnit(f: Frame, h: number): void {
    fbox(f, M.trim, -0.02, h - 0.52, 0, f.len + 0.02, h - 0.42, 0.04, 1, 0, () => 0.8);
    fbox(f, M.trim, -0.04, h - 0.42, 0, f.len + 0.04, h - 0.3, 0.1, 1, 0, () => 0.84);
    fbox(f, M.trim, -0.08, h - 0.3, 0, f.len + 0.08, h - 0.18, 0.2, 1, 0, () => 0.9);
    fbox(f, M.trim, -0.12, h - 0.18, 0, f.len + 0.12, h - 0.02, 0.32, 1, 0, () => 0.95);
    eaveBoard(f, null, h);
    const n = Math.round((f.len + 0.2) / 0.24), tl = EAVE_OUT + 0.44;
    for (let i = 0; i < n; i++) {
      const a = -0.1 + (i + 0.5) * ((f.len + 0.2) / n);
      const mat = [M.tileA, M.tileB, M.tileA, M.tileC][i % 4]!;
      // Each barrel tile runs from the roof out over the edge, slightly tilted down.
      fmesh(f, mat, TILE, a, h + 0.1, EAVE_OUT + 0.02 - tl / 2, 0.22, tl, 0.16, Math.PI / 2 - 0.12, 0, 0);
    }
    // Rain spouts (canales) near both ends: a classic detail and a landmark at the roofline.
    for (const a of [0.5, f.len - 0.5]) {
      fbox(f, M.spout, a - 0.07, h - 0.36, 0, a + 0.07, h - 0.24, EAVE_OUT + 0.24);
      fbox(f, M.eave, a - 0.05, h - 0.28, 0.08, a + 0.05, h - 0.24, EAVE_OUT + 0.24);
    }
  }

  /**
   * The same cornice and eave on one exposed run of a face: the tiles are one
   * corrugated strip (a third of the triangles of separate tiles), and the
   * pieces meet the next face cleanly at corners.
   */
  function eaveRun(f: Frame, s: Span, h: number, spouts: boolean): void {
    // A bed moulding, then the cornice's steps under the eave: the deeper the step, the more shade.
    sbox(f, s, M.trim, h - 0.52, 0, h - 0.42, 0.04, 1, 0, () => 0.8);
    sbox(f, s, M.trim, h - 0.42, 0, h - 0.3, 0.1, 1, 0, () => 0.84);
    sbox(f, s, M.trim, h - 0.3, 0, h - 0.18, 0.2, 1, 0, () => 0.9);
    sbox(f, s, M.trim, h - 0.18, 0, h - 0.02, 0.32, 1, 0, () => 0.95);
    eaveBoard(f, s, h);
    const [t0, t1] = run(s, -0.42, EAVE_OUT + 0.02);
    if (t1 - t0 > 0.2) fgeo(f, M.tileA, tileStrip(t0, t1, lite ? 0.32 : 0.24, quality === 'high' ? 3 : 2, h + 0.13, h + 0.03, -0.42, EAVE_OUT + 0.02, 0.08, TILE_COLORS));
    if (spouts && s.a1 - s.a0 > 3) for (const a of [s.a0 + 0.6, s.a1 - 0.6]) {
      fbox(f, M.spout, a - 0.07, h - 0.36, 0, a + 0.07, h - 0.24, EAVE_OUT + 0.24);
      fbox(f, M.eave, a - 0.05, h - 0.28, 0.08, a + 0.05, h - 0.24, EAVE_OUT + 0.24);
    }
  }
  /**
   * The eave board under the tiles, out to EAVE_OUT, its underside (the
   * soffit) dark, with a fascia along its front edge: the profile that reads
   * against the sky.
   */
  function eaveBoard(f: Frame, s: Span | null, h: number): void {
    const soffit: ShadeFn = (_x, _y, _z, _nx, ny) => (ny < -0.5 ? 0.7 : 1);
    const put = (mat: Mat, y0: number, n0: number, y1: number, n1: number, sh: ShadeFn) => (s ? sbox(f, s, mat, y0, n0, y1, n1, 1, 0, sh) : fbox(f, mat, -0.12, y0, n0, f.len + 0.12, y1, n1, 1, 0, sh));
    put(M.eave, h - 0.02, -0.4, h + 0.04, EAVE_OUT, soffit);
    put(M.eave, h - 0.11, EAVE_OUT - 0.05, h - 0.02, EAVE_OUT, (x, y, z, nx, ny, nz) => soffit(x, y, z, nx, ny, nz) * 0.88);
  }

  /** Painted base band with a molded cap on one exposed run, stopping at door casings (`gaps`, along the frame). */
  function bandRun(f: Frame, s: Span, band: number, gaps: ReadonlyArray<readonly [number, number]> = []): void {
    for (const p of cut(s, gaps)) {
      sbox(f, p, wallMat(band), 0, 0, 0.8, 0.03, 1, 0, grade(0, 0.8, 0.8, 1)); // splashed and damp at its foot
      sbox(f, p, M.trim, 0.8, 0, 0.88, 0.07);
    }
  }
  /** A span with the gaps taken out; the new ends stop flush at each gap. */
  const cut = (s: Span, gaps: ReadonlyArray<readonly [number, number]>): Span[] => {
    let out: Span[] = [s];
    for (const [g0, g1] of gaps) {
      out = out.flatMap((p) => {
        if (g1 <= p.a0 || g0 >= p.a1) return [p];
        const r: Span[] = [];
        if (g0 > p.a0 + 0.05) r.push({ a0: p.a0, a1: g0, e0: p.e0, e1: 'f' });
        if (g1 < p.a1 - 0.05) r.push({ a0: g1, a1: p.a1, e0: 'f', e1: p.e1 });
        return r;
      });
    }
    return out;
  };
  /** Where a door's casing interrupts the base band. */
  const doorGap = (a: number): readonly [number, number] => [a - 0.77, a + 0.77];

  /** Hero blocks: painted base band with a molded cap, and pilasters framing the facade (milestone 2). */
  function baseAndPilasters(f: Frame, h: number, band: number, pilasters: boolean, door?: number): void {
    // The band stops at the door casing (it ran across the closed door in milestone 2).
    const pieces: Array<[number, number]> = door === undefined ? [[0, f.len]] : [[0, door - 0.77], [door + 0.77, f.len]];
    for (const [p, q] of pieces) {
      fbox(f, wallMat(band), p, 0, 0, q, 0.8, 0.03, 1, 0, grade(0, 0.8, 0.8, 1));
      fbox(f, M.trim, p === 0 ? -0.02 : p, 0.8, 0, q === f.len ? f.len + 0.02 : q, 0.88, 0.07);
    }
    if (!pilasters) return;
    for (const a of [0, f.len - 0.34]) {
      fbox(f, M.trim, a, 0.88, 0, a + 0.34, h - 0.42, 0.05);
      fbox(f, M.trim, a - 0.03, 0.8, 0, a + 0.37, 0.88, 0.09);
    }
  }

  /** A pilaster at the left (a = 0) or right end of a facade, inside its length. */
  function pilaster(f: Frame, at: number, h: number): void {
    const a = at <= 0 ? 0 : f.len - 0.34;
    fbox(f, M.trim, a, 0.88, 0, a + 0.34, h - 0.42, 0.05);
    fbox(f, M.trim, a, 0.8, 0, a + 0.34, 0.88, 0.09);
  }

  /** Depth of the stone apron along wall feet with no paving. */
  const APRON = 0.34;
  const bandOf = (col: number) => (col === STUCCO.stuccoCream ? 0xc2704f : 0xa45c3e); // a softer, earthier base band
  const shutterOf = (col: number) => (col === STUCCO.stuccoTurquoise ? COLORS.marigold : col === STUCCO.stuccoViolet ? 0xf4e6c8 : COLORS.turquoise);

  // ---------------------------------------------------------------- paving
  // Facade strips are collected first so overlapping strips (at inside
  // corners) can be cut back: two paver planes on one spot would flicker.
  const strips: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> = [];
  /**
   * Paving and kerb along a facade run (out to 1.4 m), cut where an earlier
   * strip already lies. As an apron (`apron` = its depth), a narrow course of
   * the same slabs along a wall foot with no paving, darker at the wall:
   * where any plaster meets the ground it stands on a stone base course.
   */
  function paveFront(b: MapBox, side: Side, a0: number, a1: number, apron = 0): void {
    const f = frameOf(b, side), fc = faceOf(b, side);
    const rect = (p: number, q: number) => {
      const w0 = side === 's' || side === 'w' ? fc.lo + p : fc.hi - q, w1 = side === 's' || side === 'w' ? fc.lo + q : fc.hi - p;
      const n0 = fc.plane, n1 = fc.plane + fc.out * (apron || 1.55);
      return fc.axis === 'z' ? { minX: w0, maxX: w1, minZ: Math.min(n0, n1), maxZ: Math.max(n0, n1) } : { minX: Math.min(n0, n1), maxX: Math.max(n0, n1), minZ: w0, maxZ: w1 };
    };
    let pieces: Array<[number, number]> = [[a0, a1]];
    for (const r of strips) {
      const next: Array<[number, number]> = [];
      for (const [p, q] of pieces) {
        const me = rect(p, q);
        if (me.maxX <= r.minX + 1e-3 || me.minX >= r.maxX - 1e-3 || me.maxZ <= r.minZ + 1e-3 || me.minZ >= r.maxZ - 1e-3) { next.push([p, q]); continue; }
        // The overlap's extent in this frame's `a`, cut out.
        const [lo, hi] = fc.axis === 'z' ? [Math.max(me.minX, r.minX), Math.min(me.maxX, r.maxX)] : [Math.max(me.minZ, r.minZ), Math.min(me.maxZ, r.maxZ)];
        const c0 = Math.min(toAlong(b, side, lo), toAlong(b, side, hi)), c1 = Math.max(toAlong(b, side, lo), toAlong(b, side, hi));
        if (c0 > p + 0.05) next.push([p, c0]);
        if (c1 < q - 0.05) next.push([c1, q]);
      }
      pieces = next;
    }
    for (const [p, q] of pieces) {
      if (apron) paving(f, p, q, apron, apron, 2.4);
      else {
        paving(f, p, q, 1.4, 0.7, 2.4);
        fbox(f, M.cantera, p, 0, 1.4, q, 0.03, 1.55, 0.8);                         // flush curb line
      }
      strips.push(rect(p, q));
    }
  }

  // ---------------------------------------------------------------- the kit

  /** The hero blocks: exactly the milestone 2 dressing. */
  function heroBuilding(b: MapBox): void {
    hero = true;
    const h = b.maxY - b.minY;
    const col = STUCCO[b.mat]!;
    walls(wallMat(col), b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 2, 63, true);
    wallOf = { col, minY: b.minY, maxY: b.maxY, eave: true };
    const fs = b.facade!;
    const f = frameOf(b, fs);
    const side = frameOf(b, RIGHT_OF[fs]);
    const band = bandOf(col);
    const cols = Math.max(1, Math.floor(f.len / 2.7)), spacing = f.len / cols;
    baseAndPilasters(f, h, band, true, spacing * (Math.floor(cols / 2) + 0.5));
    baseAndPilasters(side, h, band, false);
    roofUnit(f, h);
    roofUnit(side, h);
    // The back and the other side keep a plain stepped cornice (seen from the alley and the terrace).
    for (const other of [frameOf(b, OPPOSITE[fs]), frameOf(b, OPPOSITE[RIGHT_OF[fs]])]) {
      fbox(other, M.trim, -0.08, h - 0.3, 0, other.len + 0.08, h - 0.18, 0.12);
      fbox(other, M.trim, -0.12, h - 0.18, 0, other.len + 0.12, h + 0.06, 0.22);
    }
    const shutter = col === STUCCO.stuccoTurquoise ? COLORS.marigold : COLORS.turquoise;
    for (let k = 0; k < cols; k++) {
      const a = spacing * (k + 0.5);
      if (k === Math.floor(cols / 2)) doorUnit(f, a); else windowUnit(f, a, 1.55, shutter, true, false);
      windowUnit(f, a, 4.6, shutter, false, k !== Math.floor(cols / 2));
    }
    wallOf = null;
    signFrame(f);
    paving(f, 0, f.len, 1.4, 0.7, 2.4);
    fbox(f, M.cantera, 0, 0, 1.4, f.len, 0.03, 1.55, 0.8);
    paving(side, 0, side.len, 0.8, 0.7, 2.4);                                      // narrower strip on the side, same contact shade
    strips.push(...[[fs, 1.55], [RIGHT_OF[fs], 0.8]].map(([s, d]) => {
      const fc = faceOf(b, s as Side), n1 = fc.plane + fc.out * (d as number);
      return fc.axis === 'z' ? { minX: fc.lo, maxX: fc.hi, minZ: Math.min(fc.plane, n1), maxZ: Math.max(fc.plane, n1) } : { minX: Math.min(fc.plane, n1), maxX: Math.max(fc.plane, n1), minZ: fc.lo, maxZ: fc.hi };
    }));
  }

  /** The sign gets a painted wooden frame (the sign itself is drawn by the arena, at 3.3 m). */
  function signFrame(f: Frame): void {
    const sw = Math.min(f.len - 0.6, 4.2), sh = sw * 0.21, sa = f.len / 2;
    fbox(f, M.woodDark, sa - sw / 2 - 0.08, 3.3 - sh / 2 - 0.08, 0, sa + sw / 2 + 0.08, 3.3 + sh / 2 + 0.08, 0.05);
  }

  /** A house: plaster walls, a base band, cornice and eave on every seen face, and the facade's windows, door and paving. */
  function building(b: MapBox, col: number): void {
    const h = b.maxY, fs = b.facade!, ff = frameOf(b, fs);
    body(b, wallMat(col), 2, true, b.maxY, true);
    wallOf = { col, minY: b.minY, maxY: b.maxY, eave: true };
    const band = bandOf(col), shutter = shutterOf(col), up = Math.min(4.6, h - 1.34);
    // Bays as in the arena's generic facades: a door in the middle bay, barred
    // windows beside it, shuttered windows above (balconies on alternate bays).
    const cols = Math.max(1, Math.floor(ff.len / 2.7)), spacing = ff.len / cols, mid = Math.floor(cols / 2);
    // Coverage is tested over the band each piece occupies: a lower neighbour hides the ground floor but not the upper one.
    const full = spansOf(b, fs, 0, up + 0.85);
    const bays = ff.len >= 2 ? Array.from({ length: cols }, (_, k) => spacing * (k + 0.5)).filter((a) => full.some((s) => s.a0 <= a - 1.1 && s.a1 >= a + 1.1)) : [];
    const door = bays.find((a) => Math.abs(a - spacing * (mid + 0.5)) < 1e-6);
    for (const side of SIDES) {
      const f = frameOf(b, side);
      for (const s of spansOf(b, side, 0, 0.88)) bandRun(f, s, band, side === fs && door !== undefined ? [doorGap(door)] : []);
      for (const s of spansOf(b, side, h - 0.45, h)) eaveRun(f, s, h, side === fs);
      if (side === fs) continue;
      // Backs and ends seen from an alley get a row of upper windows
      // (no ground floor, no door), kept clear of the team banners.
      // A short end (2.6 m or more, such as a house's flank on an opening) gets a single window, so no tall face is left blank.
      for (const s of spansOf(b, side, up - 0.85, up + 0.85)) {
        if (s.a1 - s.a0 < 2.6) continue;
        const n = Math.max(1, Math.floor((s.a1 - s.a0) / 2.7)), sp = (s.a1 - s.a0) / n;
        for (let k = 0; k < n; k++) {
          const a = s.a0 + sp * (k + 0.5);
          if (!bannerClear(b, side, a)) continue;
          windowUnit(f, a, up, shutter, false, false);
          occupy(b, side, a - 0.75, a + 0.75, up - 0.95, up + 0.85);
        }
      }
    }
    // (Flat trim-colour strips on the other convex corners were tried and removed: in shade
    // they read as pale boards stuck on the arris, as quoins did.)
    // (The wear patches on the other faces go on after the lane-wall pieces: see the assembly.)
    for (const s of spansOf(b, fs, 0, h - 0.42)) {
      // Pilasters at the facade's own corners.
      if (s.a0 < 0.01) pilaster(ff, 0, h);
      if (s.a1 > ff.len - 0.01) pilaster(ff, ff.len, h);
    }
    for (const a of bays) {
      if (a === door) doorUnit(ff, a); else windowUnit(ff, a, 1.55, shutter, true, false);
      windowUnit(ff, a, up, shutter, false, a !== door && Math.round(a / spacing - 0.5) % 2 === 0);
    }
    wallOf = null;
    if (b.sign && ff.len >= 2) signFrame(ff);
    if (ff.len >= 2) for (const s of spansOf(b, fs, 0, 0.1)) paveFront(b, fs, s.a0, s.a1);
  }

  /** True when a window at `a` on this face stays clear of the arena's team banners (1.2 m wide, hung 3.3-5.5 m). */
  const bannerClear = (b: MapBox, side: Side, a: number): boolean => {
    const fc = faceOf(b, side);
    for (const bn of banners) {
      const [n, w] = fc.axis === 'x' ? [bn.x, bn.z] : [bn.z, bn.x];
      if (Math.abs(n - fc.plane) > 0.2 || w < fc.lo - 0.6 || w > fc.hi + 0.6) continue;
      if (Math.abs(toAlong(b, side, w) - a) < 1.45) return false;
    }
    return true;
  };

  /** A wall (no rooms behind it): base band, a plain cornice where tall, and a stone coping. */
  function wall(b: MapBox, col: number): void {
    const h = b.maxY, cap = 0.07;
    body(b, wallMat(col), 2, false, h - cap);
    // The coping: a stone cap over the full top, lipped where a face is seen.
    const { minX, maxX, minZ, maxZ } = clipOf(b);
    batch.add(M.cantera, boxGeo(minX, h - cap, minZ, maxX, h, maxZ, 0.8, 4 | sideBits(b, h - cap, h)));
    const band = bandOf(col);
    for (const side of SIDES) {
      const f = frameOf(b, side);
      if (b.minY === 0) for (const s of spansOf(b, side, 0, 0.88)) bandRun(f, s, band);
      for (const s of spansOf(b, side, h - 0.3, h)) {
        sbox(f, s, M.cantera, h - cap - 0.02, 0, h, 0.05, 0.8);
        if (h >= 4) sbox(f, s, M.trim, h - 0.34, 0, h - 0.22, 0.07);                // a slim string course under the coping
      }
    }
  }
  /** The drawn footprint of a box after cutting it back at crossing walls (see body). */
  const clipOf = (b: MapBox) => {
    let { minZ, maxZ } = b;
    for (const o of boxes) {
      if (o === b || o.maxY < b.maxY || o.minY > b.minY) continue;
      if (b.maxZ - b.minZ > b.maxX - b.minX && o.minX <= b.minX && o.maxX >= b.maxX && o.maxZ > minZ && o.minZ < maxZ) {
        if (o.minZ <= minZ) minZ = Math.max(minZ, o.maxZ); else if (o.maxZ >= maxZ) maxZ = Math.min(maxZ, o.minZ);
      }
    }
    return { minX: b.minX, maxX: b.maxX, minZ, maxZ };
  };
  const sideBits = (b: MapBox, y0: number, y1: number) => {
    let bits = 0;
    for (const s of SIDES) if (!faceCovered(boxes, b, s, y0, y1)) bits |= FACE_BIT[s];
    return bits;
  };

  /** The colour of the stucco box a lintel spans between. */
  const neighbourColour = (b: MapBox): number => {
    for (const o of boxes) {
      if (!(o.mat in STUCCO)) continue;
      const touch = o.minX <= b.maxX + 0.02 && o.maxX >= b.minX - 0.02 && o.minZ <= b.maxZ + 0.02 && o.maxZ >= b.minZ - 0.02 && o.maxY >= b.maxY - 0.01;
      if (touch) return STUCCO[o.mat]!;
    }
    return STUCCO.stuccoCream!;
  };

  /** A lintel: a timber beam over a gate, or (tall) the wall over a passage with a beam at its foot. */
  function lintel(b: MapBox): void {
    const h = b.maxY - b.minY;
    if (h < 1.5) {
      batch.add(M.wood, boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY - 0.07, b.maxZ, 1.2, 8 | sideBits(b, b.minY, b.maxY - 0.07)));
      batch.add(M.cantera, boxGeo(b.minX, b.maxY - 0.07, b.minZ, b.maxX, b.maxY, b.maxZ, 0.8, 4 | sideBits(b, b.maxY - 0.07, b.maxY)));
      for (const side of SIDES) for (const s of spansOf(b, side, b.maxY - 0.3, b.maxY)) sbox(frameOf(b, side), s, M.cantera, b.maxY - 0.09, 0, b.maxY, 0.05, 0.8);
      return;
    }
    // The wall over the passage continues the house: same plaster, cornice and eave.
    const col = neighbourColour(b);
    body(b, wallMat(col), 2, true, b.maxY, true, false); // no underside: the timber ceiling is drawn instead
    passageCeiling(b);
    for (const side of SIDES) {
      const f = frameOf(b, side);
      for (const s of spansOf(b, side, b.minY, b.minY + 0.3)) sbox(f, s, M.wood, b.minY, 0, b.minY + 0.3, 0.06, 1.2);
      for (const s of spansOf(b, side, b.maxY - 0.45, b.maxY)) eaveRun(f, s, b.maxY, false);
    }
    // The passage floor is paved, out to the front of the houses either side.
    const g = new THREE.PlaneGeometry(b.maxX - b.minX, b.maxZ - b.minZ);
    g.rotateX(-Math.PI / 2);
    g.translate((b.minX + b.maxX) / 2, 0.008, (b.minZ + b.maxZ) / 2);
    const p = g.getAttribute('position') as THREE.BufferAttribute, uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 2.4, p.getZ(i) / 2.4);
    batch.add(pavers, g);
    strips.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ });
    // In front of the passage, the houses' paved strip carries on across it.
    for (const o of boxes) {
      if (!(o.mat in STUCCO) || !o.facade || faceOf(o, o.facade).plane !== faceOf(b, o.facade).plane) continue;
      const fl = frameOf(b, o.facade).len;
      if (o.minY === 0 && Math.abs(o.maxY - b.maxY) < 0.01) { paveFront(b, o.facade, 0, fl); break; }
    }
  }

  /**
   * A timber ceiling over a passage: beams (vigas) across it with their
   * soffits at the box's underside and the boards recessed between them, up
   * inside the box (nothing hangs lower than the collision ceiling). The
   * boards darken toward each beam; the two end beams close the recess at
   * the passage mouths.
   */
  function passageCeiling(b: MapBox): void {
    const alongX = b.maxX - b.minX >= b.maxZ - b.minZ;
    const L = alongX ? b.maxX - b.minX : b.maxZ - b.minZ, y = b.minY, deep = 0.16, bw = 0.16;
    const n = Math.max(2, Math.round(L / 0.62)), sp = (L - bw) / n;
    // In passage coordinates: t along the passage, w across it (0..W).
    const [t0, w0, w1] = alongX ? [b.minX, b.minZ, b.maxZ] : [b.minZ, b.minX, b.maxX];
    const tbox = (ta: number, ya: number, tb: number, yb: number, faces: number, sh?: ShadeFn) => {
      const g = alongX ? boxGeo(t0 + ta, ya, w0 + 0.001, t0 + tb, yb, w1 - 0.001, 1.2, faces) : boxGeo(w0 + 0.001, ya, t0 + ta, w1 - 0.001, yb, t0 + tb, 1.2, faces);
      return sh ? shadeGeo(g, sh) : g;
    };
    // The beam faces that look along the passage (±x when it runs along x, else ±z); the mouths' are left out.
    const [tPlus, tMinus] = alongX ? [1, 2] : [16, 32];
    // The box's underside, just above the boards and hidden by them: it is what casts the passage's shadow (the shadow map draws back faces).
    batch.add(wallMat(neighbourColour(b)), boxGeo(b.minX, y + deep + 0.01, b.minZ, b.maxX, y + deep + 0.02, b.maxZ, 2, 8));
    for (let i = 0; i <= n; i++) {
      const ta = i * sp, faces = 8 | (i > 0 ? tMinus : 0) | (i < n ? tPlus : 0);
      batch.add(M.wood, tbox(ta, y, ta + bw, y + deep, faces, (_x, yy, _z, _nx, ny) => (ny < -0.5 ? 1 : 0.7 + 0.25 * (yy - y) / deep)));
    }
    // The boards between the beams, a step darker toward each beam (the bay's own shade).
    for (let i = 0; i < n; i++) {
      const ta = i * sp + bw, tb = (i + 1) * sp;
      const g = new THREE.PlaneGeometry(tb - ta, w1 - w0, 2, 1);
      g.rotateX(Math.PI / 2); // facing down; x runs along the passage
      shadeGeo(g, (x) => (Math.abs(x) < 0.01 ? 1 : 0.8));
      const uv = g.getAttribute('uv') as THREE.BufferAttribute, p = g.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) uv.setXY(k, p.getZ(k) / 1.2, (p.getX(k) + ta) / 1.2); // the grain runs along the passage, board by board
      if (!alongX) g.rotateY(-Math.PI / 2);
      const c = t0 + (ta + tb) / 2, m = (w0 + w1) / 2;
      g.translate(alongX ? c : m, y + deep, alongX ? m : c);
      batch.add(M.wood, g);
    }
  }

  /** The terrace and stone blocks: stone plaster, base band, a cantera fascia, a paved top, and a blind arcade on the facade. */
  function terrace(b: MapBox): void {
    const h = b.maxY;
    body(b, wallMat(STONE), 2);
    topPaving(b);
    const band = 0xa45c3e;
    for (const side of SIDES) {
      const f = frameOf(b, side);
      for (const s of spansOf(b, side, 0, 0.88)) bandRun(f, s, band);
      for (const s of spansOf(b, side, h - 0.25, h)) {
        sbox(f, s, M.cantera, h - 0.14, 0, h, 0.06, 0.8);
        sbox(f, s, M.trim, h - 0.22, 0, h - 0.14, 0.04);
      }
    }
    if (!b.facade) return;
    const f = frameOf(b, b.facade);
    for (const s of spansOf(b, b.facade, 0, h)) arcade(f, s, h, STONE);
  }

  /**
   * A blind arcade on one run of a wall: piers proud of the wall, molded
   * arch rings and keystones, and inside each arch a plaster panel a shade
   * deeper than the wall. Nothing dark: it never reads as an opening.
   */
  function arcade(f: Frame, s: Span, h: number, wallCol: number): void {
    const [a0, a1] = run(s, 0, 0.1);
    const len = a1 - a0;
    if (len < 1.4) return;
    const n = Math.max(1, Math.round(len / 1.9)), bw = len / n, pier = 0.32;
    const r = Math.min(0.72, (bw - pier) / 2 - 0.1), ys = Math.min(1.55, h - 0.36 - r - 0.12);
    const segs = lite ? 6 : 10, panel = new THREE.Color().setHex(wallCol).multiplyScalar(0.86).getHex();
    for (let i = 0; i <= n; i++) {
      // Piers: half-width at the run's ends.
      const pa = a0 + i * bw, p0 = i === 0 ? pa : pa - pier / 2, p1 = i === n ? pa : pa + pier / 2;
      fbox(f, M.trim, p0, 0.88, 0, p1, h - 0.22, 0.1);
    }
    for (let i = 0; i < n; i++) {
      const ac = a0 + (i + 0.5) * bw;
      fgeo(f, wallMat(panel), archPanel(ac, 0.88, ys, r, 0.006, segs));
      fgeo(f, M.trim, archRing(ac, ys, r, r + 0.12, 0.07, segs));
      for (const sg of [-1, 1]) {
        fbox(f, M.trim, ac + sg * r - (sg > 0 ? 0 : 0.12), 0.88, 0, ac + sg * r + (sg > 0 ? 0.12 : 0), ys, 0.07); // jambs under the springing
        fbox(f, M.trimSmall, ac + sg * (r + 0.06) - 0.1, ys - 0.06, 0, ac + sg * (r + 0.06) + 0.1, ys, 0.11); // imposts
      }
      fbox(f, M.trimSmall, ac - 0.07, ys + r - 0.04, 0, ac + 0.07, ys + r + 0.16, 0.1);           // keystone
    }
  }

  /** A parapet on the terrace: plaster with a stone cap, one course of tiles on its outer face. */
  function parapet(b: MapBox): void {
    const cap = 0.07;
    body(b, wallMat(STONE), 2, false, b.maxY - cap);
    batch.add(M.cantera, boxGeo(b.minX, b.maxY - cap, b.minZ, b.maxX, b.maxY, b.maxZ, 0.8, 4 | sideBits(b, b.maxY - cap, b.maxY)));
    const under = boxes.find((o) => o.mat === 'stone' && Math.abs(o.maxY - b.minY) < 0.01 && o.minX <= b.minX && o.maxX >= b.maxX && o.minZ <= b.minZ && o.maxZ >= b.maxZ);
    for (const side of SIDES) {
      const f = frameOf(b, side);
      for (const s of spansOf(b, side, b.maxY - cap, b.maxY)) sbox(f, s, M.cantera, b.maxY - cap - 0.02, 0, b.maxY, 0.04, 0.8);
      // The outer face is the one flush with the terrace's edge.
      if (under && Math.abs(faceOf(b, side).plane - faceOf(under, side).plane) < 0.01 && f.len > 1) {
        const e = 0.004;
        for (const [lo, hi] of exposedSpans(boxes, b, side, b.minY, b.maxY)) {
          tilePanel(...onFace(b, side, lo + 0.12, hi - 0.12, b.minY + 0.3, b.minY + 0.6, 0, e), FACE_BIT[side]);
        }
      }
    }
  }

  /** The step's dressed (riser) face: towards the adjacent lower step, or for the lowest step away from the taller one. */
  function riserOf(b: MapBox): Side {
    let away: Side | null = null;
    for (const side of SIDES) {
      const fc = faceOf(b, side);
      for (const o of boxes) {
        if (o === b || o.mat !== 'step') continue;
        const [oMin, oMax] = fc.axis === 'z' ? [o.minZ, o.maxZ] : [o.minX, o.maxX];
        const [aMin, aMax] = fc.axis === 'z' ? [o.minX, o.maxX] : [o.minZ, o.maxZ];
        const touches = (fc.out > 0 ? Math.abs(oMin - fc.plane) < 0.02 : Math.abs(oMax - fc.plane) < 0.02) && Math.min(fc.hi, aMax) - Math.max(fc.lo, aMin) > 0.1;
        if (!touches) continue;
        if (o.maxY < b.maxY - 0.01) return side;
        if (o.maxY > b.maxY + 0.01) away = OPPOSITE[side];
      }
    }
    return away ?? plazaFace(b);
  }

  /** Stone steps: a cantera tread with a slight nosing, one course of whole tiles on the riser, plaster stringers. */
  function step(b: MapBox): void {
    const rf = riserOf(b), bit = FACE_BIT[rf], fc = faceOf(b, rf);
    batch.add(M.cantera, boxGeo(b.minX, b.maxY - 0.06, b.minZ, b.maxX, b.maxY, b.maxZ, 0.8, 63 & ~8));
    batch.add(M.trim, boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY - 0.06, b.maxZ, 2, 1 | 2 | 16 | 32));
    // Just proud of the riser, so the tiles never fight it for depth.
    tilePanel(...onFace(b, rf, fc.lo, fc.hi, Math.max(0.02, b.maxY - 0.36), b.maxY - 0.06, 0, 0.004), bit);
    const nose = onFace(b, rf, fc.lo, fc.hi, b.maxY - 0.04, b.maxY, 0, 0.03);
    const sideBitsN = fc.axis === 'z' ? 1 | 2 : 16 | 32;
    batch.add(M.cantera, boxGeo(...nose, 0.8, 4 | 8 | sideBitsN | bit));
  }

  /** A bench: plaster body, one tiled panel of whole tiles on the plaza side, a stone cap with a small overhang, a plinth. */
  function bench(b: MapBox): void {
    const rf = plazaFace(b), fc = faceOf(b, rf);
    batch.add(M.trim, boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY - 0.08, b.maxZ, 1, 1 | 2 | 16 | 32));
    const long = fc.hi - fc.lo;
    if (long > 0.8) tilePanel(...onFace(b, rf, fc.lo + 0.1, fc.hi - 0.1, 0.18, 0.78, 0, 0.004), FACE_BIT[rf]);
    batch.add(M.cantera, boxGeo(b.minX - 0.03, b.maxY - 0.08, b.minZ - 0.03, b.maxX + 0.03, b.maxY, b.maxZ + 0.03, 0.8));
    batch.add(M.cantera, boxGeo(b.minX - 0.01, 0, b.minZ - 0.01, b.maxX + 0.01, 0.1, b.maxZ + 0.01, 0.8, 1 | 2 | 16 | 32));
  }

  /**
   * A planter: terracotta body with one course of whole tiles on each side,
   * an open top (soil 6 cm down) and a stone rim. The rim's four pieces do
   * not overlap, and nothing shares the rim's top plane, so no flicker. The
   * plants are leaf tufts, no larger than the arena's planter bushes.
   */
  function planter(b: MapBox): void {
    const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
    const e = 0.004, ty0 = b.maxY - 0.42, ty1 = b.maxY - 0.12;
    batch.add(M.pot, boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY - 0.06, b.maxZ, 1, 1 | 2 | 16 | 32));
    tilePanel(b.maxX, ty0, b.minZ + 0.06, b.maxX + e, ty1, b.maxZ - 0.06, 1);
    tilePanel(b.minX - e, ty0, b.minZ + 0.06, b.minX, ty1, b.maxZ - 0.06, 2);
    tilePanel(b.minX + 0.06, ty0, b.maxZ, b.maxX - 0.06, ty1, b.maxZ + e, 16);
    tilePanel(b.minX + 0.06, ty0, b.minZ - e, b.maxX - 0.06, ty1, b.minZ, 32);
    const r0 = b.maxY - 0.06, o = 0.04, t = 0.12;
    batch.add(M.cantera, boxGeo(b.minX - o, r0, b.minZ - o, b.maxX + o, b.maxY, b.minZ - o + t, 0.8));
    batch.add(M.cantera, boxGeo(b.minX - o, r0, b.maxZ + o - t, b.maxX + o, b.maxY, b.maxZ + o, 0.8));
    batch.add(M.cantera, boxGeo(b.minX - o, r0, b.minZ - o + t, b.minX - o + t, b.maxY, b.maxZ + o - t, 0.8));
    batch.add(M.cantera, boxGeo(b.maxX + o - t, r0, b.minZ - o + t, b.maxX + o, b.maxY, b.maxZ + o - t, 0.8));
    batch.add(M.soil, boxGeo(b.minX - o + t, r0 - 0.01, b.minZ - o + t, b.maxX + o - t, r0, b.maxZ + o - t, 1, 4));
    // Same spacing as the arena's planter bushes, and no taller than milestone 2's foliage
    // (its top at the rim + 0.72 s), so the plants never hide more of the line of sight.
    const alongX = w >= d, long = Math.max(w, d), n = Math.max(2, Math.round(long / 0.5));
    for (let i = 0; i < n; i++) {
      const tt = (i + 0.5) / n;
      const x = alongX ? b.minX + w * tt : (b.minX + b.maxX) / 2, z = alongX ? (b.minZ + b.maxZ) / 2 : b.minZ + d * tt;
      const s = 0.46 + (i % 3) * 0.06, y = r0 - 0.01;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, i * 1.7, 0));
      batch.addMesh(M.leaf, TUFTS[i % 3]!, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, 0.72 * s + 0.03, s)));
      if (i % 2 === 0) batch.addMesh(i % 4 ? M.marigold : M.pink, BUD, new THREE.Matrix4().compose(new THREE.Vector3(x + 0.08, y + 0.62 * s, z + 0.05), new THREE.Quaternion(), new THREE.Vector3(0.15, 0.15, 0.15)));
    }
  }

  /** A crate: boards framing each seen face, a diagonal brace, all inside the footprint. */
  function crate(b: MapBox): void {
    const i = 0.02, h = b.maxY;
    // The body shows between the boards, set back from them: a step darker on its sides.
    batch.add(M.crate, shadeGeo(boxGeo(b.minX + i, 0, b.minZ + i, b.maxX - i, h - i, b.maxZ - i, 1, 63 & ~8), (_x, _y, _z, _nx, ny) => (ny > 0.5 ? 1 : 0.84)));
    for (const side of SIDES) {
      const f = frameOf({ ...b, minX: b.minX + i, maxX: b.maxX - i, minZ: b.minZ + i, maxZ: b.maxZ - i }, side);
      const L = f.len, bw = 0.09;
      fbox(f, M.wood, 0, 0, 0, bw, h - i, i, 1);
      fbox(f, M.wood, L - bw, 0, 0, L, h - i, i, 1);
      fbox(f, M.wood, bw, 0, 0, L - bw, bw, i, 1);
      fbox(f, M.wood, bw, h - i - bw, 0, L - bw, h - i, i, 1);
      if (!lite) {
        const dl = Math.hypot(L - 2 * bw, h - i - 2 * bw), ang = Math.atan2(h - i - 2 * bw, L - 2 * bw);
        const g = boxGeo(-dl / 2, -bw / 2, 0, dl / 2, bw / 2, i * 0.8, 1, 63 & ~32);
        g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(L / 2, (h - i) / 2, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, side === 'n' || side === 'e' ? ang : -ang)), new THREE.Vector3(1, 1, 1)));
        // The brace sits just behind the boards' faces, its ends tucked under the frame.
        fgeo(f, M.wood, g);
      }
    }
    batch.add(M.wood, boxGeo(b.minX + i, h - i, b.minZ + i, b.maxX - i, h, b.maxZ - i, 1, 4));
  }

  /** A litter bin: a green drum inside the footprint, with a darker lid. */
  function bin(b: MapBox): void {
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, h = b.maxY - b.minY;
    const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
    batch.addMesh(M.bin, BIN, new THREE.Matrix4().compose(new THREE.Vector3(cx, (h - 0.1) / 2, cz), new THREE.Quaternion(), new THREE.Vector3(w * 0.94, h - 0.1, d * 0.94)));
    batch.add(M.binLid, boxGeo(b.minX, h - 0.1, b.minZ, b.maxX, h, b.maxZ, 1, 63 & ~8));
  }

  // ------------------------------------------------------------ lane walls
  // Large plain faces that look onto ground a player can stand on (the backs
  // and flanks of houses, garden and boundary walls, the arcade's back) get
  // what a lived-in street puts on them: a downpipe from the eaves, a cable
  // run dropping to a meter box, a shuttered blind window up high, a painted
  // shop sign, a wall advert or mural, pasted posters, and on a long run a
  // pilaster with its own downpipe dividing it. Two to four per face, placed
  // by a seed taken from the face's position, clear of the windows and wear
  // patches already there and of the team banners. Visual only, like the
  // rest of the kit: painted pieces lie flush (12 to 16 mm), pipes, conduit
  // and the meter box stand off at most 8 cm, and anything deeper (a
  // rainwater head, a blind window's sill) is above 2.6 m. Nothing is shaped
  // like a door, a ladder or a ledge. The painted pieces use the kit atlas
  // on the glass material, the rest the detail, plaster, cantera and louver
  // kinds: no new draw call. Low keeps every piece's silhouette and drops the
  // small parts (clips, clamps, the meter's window, the posters).

  /** Rectangles (frame a0, a1, y0, y1) taken on a face: windows, wear patches, placed pieces. */
  const occ = new Map<string, Array<[number, number, number, number]>>();
  function taken(b: MapBox, side: Side): Array<[number, number, number, number]> {
    const k = `${b.minX},${b.minY},${b.minZ},${b.maxX},${b.maxY},${b.maxZ}:${side}`;
    let l = occ.get(k);
    if (!l) { l = []; occ.set(k, l); }
    return l;
  }
  function occupy(b: MapBox, side: Side, a0: number, a1: number, y0: number, y1: number): void { taken(b, side).push([a0, a1, y0, y1]); }

  /** The arena's extent (the boundary walls), and whether a point at chest height is open ground inside it. */
  const env = boxes.reduce((e, o) => ({ minX: Math.min(e.minX, o.minX), maxX: Math.max(e.maxX, o.maxX), minZ: Math.min(e.minZ, o.minZ), maxZ: Math.max(e.maxZ, o.maxZ) }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
  // Steps, the terrace, crates and planters are lane too (stood on or beside); houses and walls are not.
  const openAt = (x: number, z: number) => x > env.minX && x < env.maxX && z > env.minZ && z < env.maxZ &&
    !boxes.some((o) => o.minY < 1.4 && o.maxY > 2.4 && o.mat !== 'stone' && x > o.minX && x < o.maxX && z > o.minZ && z < o.maxZ);
  /** True when most of a run looks onto open ground (sampled 0.9 m out). */
  const facesLane = (f: Frame, s: Span): boolean => {
    let n = 0;
    const p = new THREE.Vector3();
    for (let i = 0; i < 5; i++) {
      p.set(s.a0 + (s.a1 - s.a0) * (i + 0.5) / 5, 1, 0.9).applyMatrix4(f.m);
      if (openAt(p.x, p.z)) n++;
    }
    return n >= 3;
  };
  /** True when a team banner hangs on this face near a0..a1. */
  const bannerNear = (b: MapBox, side: Side, a0: number, a1: number): boolean => {
    const fc = faceOf(b, side);
    for (const bn of banners) {
      const [n, w] = fc.axis === 'x' ? [bn.x, bn.z] : [bn.z, bn.x];
      if (Math.abs(n - fc.plane) > 0.3 || w < fc.lo - 1 || w > fc.hi + 1) continue;
      const a = toAlong(b, side, w);
      if (a > a0 - 0.9 && a < a1 + 0.9) return true;
    }
    return false;
  };

  /** Pipes and boxes: the faces along the wall a step darker than the front, so they read round and proud. */
  const SIDE_DARK: ShadeFn = (_x, _y, _z, nx) => (Math.abs(nx) > 0.5 ? 0.8 : 1);
  /** Paint and paper on the plaster take the wall's own weathering (and a touch of dust). */
  interface WallShade { minY: number; maxY: number; eave: boolean }

  /** A downpipe from a rainwater head under the cornice (when there is one) to a shoe at the foot. */
  function downpipe(f: Frame, a: number, yTop: number, col: number, head: boolean): void {
    const m: Mat = { k: 'detail', c: col }, r = 0.034;
    fbox(f, m, a - r, 0.16, 0.012, a + r, yTop, 0.076, 1, 0, SIDE_DARK);
    fbox(f, m, a - r - 0.012, 0, 0.012, a + r + 0.012, 0.16, 0.08, 1, 0, SIDE_DARK); // the shoe
    if (head && yTop >= 2.6) fbox(f, m, a - 0.1, yTop, 0, a + 0.1, yTop + 0.2, 0.18, 1, 0, SIDE_DARK);
    if (!lite) {
      const clip: Mat = { k: 'detail', c: new THREE.Color().setHex(col).multiplyScalar(0.7).getHex() };
      for (let y = 1.15; y < yTop - 0.4; y += 1.4) fbox(f, clip, a - r - 0.012, y, 0, a + r + 0.012, y + 0.045, 0.08, 1, 0, SIDE_DARK);
    }
  }

  /** A meter box at chest height, its conduit up to a run along the wall under the eave (to a2), and a cable down into the ground. */
  function meterRun(f: Frame, a: number, yRun: number, a2: number): void {
    const box: Mat = { k: 'detail', c: 0xa3a19a }, pipe: Mat = { k: 'detail', c: 0x77726a };
    fbox(f, box, a - 0.17, 1.42, 0, a + 0.17, 1.9, 0.075, 1, 0, SIDE_DARK);
    fbox(f, pipe, a - 0.02, 0, 0.012, a + 0.02, 1.42, 0.052, 1, 0, SIDE_DARK);
    fbox(f, pipe, a - 0.02, 1.9, 0.012, a + 0.02, yRun - 0.02, 0.052, 1, 0, SIDE_DARK);
    const [p, q] = a2 > a ? [a - 0.02, a2] : [a2, a + 0.02];
    fbox(f, pipe, p, yRun - 0.02, 0.012, q, yRun + 0.02, 0.052, 1, 0, (_x, _y, _z, _nx, ny) => (ny < -0.5 ? 0.7 : 1));
    fbox(f, box, a - 0.07, yRun - 0.07, 0, a + 0.07, yRun + 0.07, 0.07, 1, 0, SIDE_DARK); // junction box at the bend
    if (lite) return;
    fbox(f, { k: 'detail', c: 0x2c2a30 }, a - 0.08, 1.68, 0.075, a + 0.08, 1.78, 0.079); // the reading window
    const clamp: Mat = { k: 'detail', c: 0x5e5a54 };
    for (let t = 0.9; t < Math.abs(q - p) - 0.3; t += 0.9) {
      const x = a2 > a ? a + t : a - t;
      fbox(f, clamp, x - 0.02, yRun - 0.035, 0, x + 0.02, yRun + 0.035, 0.06);
    }
  }

  /** A blind window up high: the surround of the house's windows round two closed louvered shutters. */
  function blindWindow(f: Frame, a: number, wy: number, shutter: number): void {
    const hw = 0.45, top = wy + 0.6, bot = wy - 0.6;
    fbox(f, M.trim, a - hw - 0.1, bot, 0, a - hw, top, 0.12, 1, 0, reveal(1, 0.64));
    fbox(f, M.trim, a + hw, bot, 0, a + hw + 0.1, top, 0.12, 1, 0, reveal(-1, 0.64));
    fbox(f, M.trim, a - hw - 0.14, top, 0, a + hw + 0.14, top + 0.16, 0.16, 1, 0, HEAD);
    fbox(f, M.cantera, a - hw - 0.16, bot - 0.08, 0, a + hw + 0.16, bot, 0.2, 0.8, 0, SILL);
    // The leaves closed in the reveal, a step into its shade toward the head.
    for (const [p, q] of [[a - hw, a], [a, a + hw]] as const) fbox(f, shutterMat(shutter), p, bot, 0.02, q, top, 0.05, 0.6, 0, grade(bot, top, 0.95, 0.82));
    if (!lite) fbox(f, M.iron, a - 0.015, wy - 0.05, 0.05, a + 0.015, wy + 0.05, 0.065); // the latch
  }

  /** A painted piece (a region of the kit atlas) flat on the wall, `out` proud of it, turned `rz` in its plane. */
  function painted(f: Frame, r: AtlasRegion, a: number, yc: number, w: number, h: number, out: number, ws: WallShade, rz = 0): void {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, ...atlasUV(r, uv.getX(i), uv.getY(i)));
    if (rz) g.rotateZ(rz);
    g.translate(a, yc, out);
    shadeGeo(g, (_x, y) => weatherAt(y, ws.minY, ws.maxY, ws.eave) * 0.94);
    batch.add(M.glass, g.applyMatrix4(f.m));
  }

  /** A pilaster dividing a long run: the house's pilaster, standing on the base band where there is one. */
  function pilasterBreak(f: Frame, a: number, topY: number, band: boolean): void {
    fbox(f, M.trim, a - 0.17, band ? 0.88 : 0, 0, a + 0.17, topY, 0.05);
    if (band) fbox(f, M.trim, a - 0.19, 0.8, 0, a + 0.19, 0.88, 0.08);
  }

  type LaneKind = 'hero' | 'house' | 'wall' | 'terrace';
  /** Downpipe paints: zinc grey, oxide red, bottle green, dark grey. */
  const PIPE_COLS = [0x8b8d88, 0x9c4a32, 0x3f5e4c, 0x6a6560];
  /** Places the lane-wall pieces on every plain face of a box that looks onto the lanes. */
  function laneWalls(b: MapBox, kind: LaneKind, col: number): void {
    const H = b.maxY;
    if (b.minY > 0.01 || H < 2.4) return;
    const eave = kind === 'hero' || kind === 'house';
    const topY = eave ? H - 0.55 : kind === 'terrace' ? H - 0.24 : H - (H >= 4 ? 0.36 : 0.1);
    const ws: WallShade = { minY: 0, maxY: kind === 'wall' ? H - 0.07 : H, eave };
    const up = Math.min(4.6, H - 1.34);
    for (const side of SIDES) {
      // Facades are dressed already (windows, doors, signs, the terrace's arcade); a plain wall's facade only when it carries no sign.
      if (side === b.facade && (kind !== 'wall' || b.sign)) continue;
      const f = frameOf(b, side), tk = taken(b, side);
      // Whatever stands against the face (steps, a landing, a crate) keeps the pieces off it.
      const fc = faceOf(b, side);
      for (const o of boxes) {
        if (o === b || o.minY > topY) continue;
        const [oMin, oMax] = fc.axis === 'z' ? [o.minZ, o.maxZ] : [o.minX, o.maxX];
        if (!(fc.out > 0 ? oMin <= fc.plane + 0.05 && oMax >= fc.plane + 0.05 : oMax >= fc.plane - 0.05 && oMin <= fc.plane - 0.05)) continue;
        const [lo, hi] = fc.axis === 'z' ? [o.minX, o.maxX] : [o.minZ, o.maxZ];
        if (Math.min(hi, fc.hi) <= Math.max(lo, fc.lo)) continue;
        const p = toAlong(b, side, Math.max(lo, fc.lo)), q = toAlong(b, side, Math.min(hi, fc.hi));
        tk.push([Math.min(p, q), Math.max(p, q), o.minY, o.maxY + 0.15]);
      }
      for (const s of spansOf(b, side, 0.9, Math.min(topY, 3.2))) {
        const L = s.a1 - s.a0;
        if (L < 2.2 || L * Math.min(topY, 4) < 6.5 || !facesLane(f, s)) continue;
        let seed = Math.abs(Math.round(b.minX * 131 + b.minZ * 197 + b.maxX * 17 + b.maxZ * 41 + s.a0 * 59)) + side.charCodeAt(0) * 733;
        const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
        const m0 = s.e0 === 'i' ? 0.3 : 0.15, m1 = s.e1 === 'i' ? 0.3 : 0.15;
        const free = (a0: number, a1: number, y0: number, y1: number) => a0 >= s.a0 + m0 && a1 <= s.a1 - m1 &&
          !tk.some(([p, q, u, v]) => a0 < q + 0.12 && a1 > p - 0.12 && y0 < v + 0.08 && y1 > u - 0.08) && !bannerNear(b, side, a0, a1);
        const take = (a0: number, a1: number, y0: number, y1: number) => tk.push([a0, a1, y0, y1]);
        const order = [0.5, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6, 0.12, 0.88].map((t) => [t, r()] as const).sort((p, q) => p[1] - q[1]).map(([t]) => t);
        const spot = (w: number, y0: number, y1: number): number | null => {
          for (const t of order) { const a = s.a0 + L * t; if (free(a - w / 2, a + w / 2, y0, y1)) return a; }
          return null;
        };
        const target = Math.min(4, Math.max(2, Math.round(L / 3)));
        let placed = 0;
        const pipeCol = PIPE_COLS[Math.floor(r() * PIPE_COLS.length)]!, pipes = eave || H >= 4;
        const pipeTop = eave ? H - 0.75 : topY - 0.05;
        // A downpipe near one end of the run (the corner end when one is seen), from the eave to the ground.
        if (pipes) {
          const atEnd = s.e1 === 'c' && (s.e0 !== 'c' || r() < 0.5);
          const a = atEnd ? s.a1 - m1 - 0.16 : s.a0 + m0 + 0.16;
          if (free(a - 0.1, a + 0.1, 0, pipeTop)) { downpipe(f, a, pipeTop, pipeCol, eave); take(a - 0.12, a + 0.12, 0, H); placed++; }
        }
        // A long run is divided by a pilaster (with a second downpipe beside it under an eave).
        if (L >= 9) {
          const a = s.a0 + L * (0.42 + r() * 0.16), pa = a + 0.42;
          if (free(a - 0.2, (pipes ? pa : a) + 0.12, 0, topY)) {
            pilasterBreak(f, a, topY, kind !== 'wall' || b.minY === 0);
            if (pipes) downpipe(f, pa, pipeTop, pipeCol, eave);
            take(a - 0.2, (pipes ? pa : a) + 0.12, 0, H); placed++;
          }
        }
        // Then the rest, in an order seeded by the face.
        const kinds = ['sign', 'ad', 'meter', 'blind', 'posters'].map((k) => [k, r()] as const).sort((p, q) => p[1] - q[1]).map(([k]) => k);
        for (const k of kinds) {
          if (placed >= target) break;
          if (k === 'blind') {
            if (!eave || up - 0.68 < 2.6) continue;
            const a = spot(1.3, up - 0.75, up + 0.85);
            if (a === null) continue;
            blindWindow(f, a, up, shutterOf(col)); take(a - 0.65, a + 0.65, up - 0.75, up + 0.85); placed++;
          } else if (k === 'sign') {
            // High under the eave, or (under an upper window) just above head height.
            const w = Math.min(2.2, L - 0.9), hh = w / 4;
            let yTop = 0, a: number | null = null;
            for (const yt of [Math.min(topY - 0.25, 3.4), 2.68]) {
              if (w < 1.3 || yt - hh < 1.7 || yt > topY - 0.2) continue;
              a = spot(w, yt - hh, yt);
              if (a !== null) { yTop = yt; break; }
            }
            if (a === null) continue;
            painted(f, ATLAS.signs[Math.floor(r() * ATLAS.signs.length)]!, a, yTop - hh / 2, w, hh, 0.012, ws); take(a - w / 2, a + w / 2, yTop - hh, yTop); placed++;
          } else if (k === 'ad') {
            const wide = L >= 3.4, reg = wide ? ATLAS.ads[2]! : ATLAS.ads[Math.floor(r() * 2)]!;
            const w = wide ? 1.9 : 1.3, hh = w * reg[3] / reg[2], y0 = 1.05;
            if (y0 + hh > topY - 0.15) continue;
            const a = spot(w, y0, y0 + hh);
            if (a === null) continue;
            painted(f, reg, a, y0 + hh / 2, w, hh, 0.012, ws); take(a - w / 2, a + w / 2, y0, y0 + hh); placed++;
          } else if (k === 'meter') {
            if (topY < 2.5) continue;
            const yRun = Math.min(topY - 0.12, 3.6), a = spot(0.4, 0, yRun + 0.1);
            if (a === null) continue;
            // The run heads for the nearer end, as far as it is clear.
            const dir = a - s.a0 < s.a1 - a ? -1 : 1;
            let a2 = a;
            while (Math.abs(a2 - a) < 3.5 && free(Math.min(a, a2 + dir * 0.3) - 0.01, Math.max(a, a2 + dir * 0.3) + 0.01, yRun - 0.05, yRun + 0.05)) a2 += dir * 0.3;
            meterRun(f, a, yRun, a2);
            take(a - 0.2, a + 0.2, 0, yRun + 0.08); take(Math.min(a, a2), Math.max(a, a2), yRun - 0.05, yRun + 0.08); placed++;
          } else if (k === 'posters') {
            if (lite) continue;
            const n = L >= 4 ? 3 : 2, w = n * 0.5, a = spot(w, 1.2, 1.9);
            if (a === null) continue;
            for (let i = 0; i < n; i++) {
              painted(f, ATLAS.posters[Math.floor(r() * ATLAS.posters.length)]!, a - w / 2 + 0.25 + i * 0.5, 1.53 + (r() - 0.5) * 0.08, 0.4, 0.58, 0.016, ws, (r() - 0.5) * 0.08);
            }
            take(a - w / 2, a + w / 2, 1.2, 1.9); placed++;
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- assembly
  // Facades first, so their paving strips win at inside corners.
  const order = [...boxes].sort((p, q) => Number(!!q.facade) - Number(!!p.facade));
  for (const b of order) {
    batch.chunk = chunkOf(b);
    const h = b.maxY - b.minY;
    if (b.mat in STUCCO) {
      const col = STUCCO[b.mat]!;
      const fl = b.facade ? frameOf(b, b.facade).len : 0;
      if (b.facade && heroZone && inZone(b)) { heroBuilding(b); hero = false; laneWalls(b, 'hero', col); }
      else if (b.facade && fl >= 2 && h >= 4) { building(b, col); laneWalls(b, 'house', col); for (const side of SIDES) if (side !== b.facade) wallPatches(b, side, col); }
      else { wall(b, col); laneWalls(b, 'wall', col); }
      continue;
    }
    switch (b.mat) {
      case 'step': step(b); break;
      case 'stone': if (h > 1.5) { terrace(b); laneWalls(b, 'terrace', STONE); } else bench(b); break;
      case 'parapet': parapet(b); break;
      case 'lintel': lintel(b); break;
      case 'planter': planter(b); break;
      case 'crate': crate(b); break;
      case 'bin': bin(b); break;
      default: batch.add(M.cantera, boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 1));
    }
  }

  // Stone aprons along every other wall foot, once all the facade paving is down.
  for (const b of order) {
    if (!(b.mat in STUCCO || b.mat === 'stone') || b.minY > 0 || b.maxY < 1.5) continue;
    batch.chunk = chunkOf(b);
    for (const side of SIDES) for (const sp of spansOf(b, side, 0, 0.1)) if (sp.a1 - sp.a0 > 0.3) paveFront(b, side, sp.a0, sp.a1, APRON);
  }

  const calls = batch.build(group, materials);
  return { group, calls };
}
