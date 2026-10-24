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
import { TINTED, kitMaterials, type Kind, type Mat } from './patio-materials';
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

class KindBatch {
  chunk = '00';
  private b = new Map<string, { k: Kind; gs: THREE.BufferGeometry[] }>();
  private tmp = new THREE.Color();
  add(m: Mat, g: THREE.BufferGeometry): void {
    const keep = TINTED.has(m.k) && g.getAttribute('color') ? 'color' : ''; // a geometry may bring its own shading (pavers, leaves, tiles)
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
  const fbox = (f: Frame, mat: Mat, a0: number, y0: number, n0: number, a1: number, y1: number, n1: number, uv = 1, drop = 0) => {
    if (a1 - a0 < 0.005) return;
    const faces = 63 & ~(n0 <= 0 ? 32 : 0) & ~(y0 <= 0 ? 8 : 0) & ~drop;
    batch.add(mat, boxGeo(a0, y0, n0, a1, y1, n1, uv, faces).applyMatrix4(f.m));
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
  const sbox = (f: Frame, s: Span, mat: Mat, y0: number, n0: number, y1: number, n1: number, uv = 1, drop = 0) => {
    const [a0, a1] = run(s, n0, n1);
    fbox(f, mat, a0, y0, n0, a1, y1, n1, uv, drop);
  };
  /** A box's body: faces fully hidden by neighbours (and the ground face) are left out. */
  const body = (b: MapBox, mat: Mat, uv: number, top = true, y1 = b.maxY) => {
    let faces = top ? 4 : 0;
    for (const s of SIDES) if (!faceCovered(boxes, b, s, b.minY, y1)) faces |= FACE_BIT[s];
    if (b.minY > 0) faces |= 8;
    // Long walls that run into a crossing wall stop at its face (no coplanar overlap at the corners).
    let { minX, maxX, minZ, maxZ } = b;
    for (const o of boxes) {
      if (o === b || o.maxY < y1 || o.minY > b.minY) continue;
      const alongZ = b.maxZ - b.minZ > b.maxX - b.minX;
      if (alongZ && o.minX <= b.minX && o.maxX >= b.maxX && o.maxZ > minZ && o.minZ < maxZ) {
        if (o.minZ <= minZ) { minZ = Math.max(minZ, o.maxZ); faces &= ~32; } else if (o.maxZ >= maxZ) { maxZ = Math.min(maxZ, o.minZ); faces &= ~16; }
      }
    }
    batch.add(mat, boxGeo(minX, b.minY, minZ, maxX, y1, maxZ, uv, faces));
    return { minX, maxX, minZ, maxZ };
  };

  // -------------------------------------------------------------- components

  function windowUnit(f: Frame, a: number, wy: number, shutter: number, ground: boolean, balcony: boolean): void {
    const hw = 0.45, hh = 0.6, top = wy + hh, bot = wy - hh;
    fbox(f, M.glass, a - hw, bot, 0.0, a + hw, top, 0.012);                        // glass, flush with the wall
    fbox(f, M.trim, a - hw - 0.1, bot, 0, a - hw, top, 0.17);                       // jambs: a 0.16 m reveal
    fbox(f, M.trim, a + hw, bot, 0, a + hw + 0.1, top, 0.17);
    fbox(f, M.trim, a - hw - 0.14, top, 0, a + hw + 0.14, top + 0.16, 0.2);         // lintel
    fbox(f, M.trimSmall, a - hw - 0.2, top + 0.16, 0, a + hw + 0.2, top + 0.22, 0.26); // its cap
    const small = hero || !lite; // Low drops the keystones and corbels off the hero blocks
    if (small) fbox(f, M.trimSmall, a - 0.08, top - 0.04, 0, a + 0.08, top + 0.2, 0.23, 1, hero ? 0 : 4); // keystone (its top is inside the cap)
    fbox(f, M.cantera, a - hw - 0.16, bot - 0.08, 0, a + hw + 0.16, bot, 0.25);     // sill
    if (small) for (const s of [-1, 1]) fbox(f, M.trimSmall, a + s * (hw - 0.02) - 0.05, bot - 0.22, 0, a + s * (hw - 0.02) + 0.05, bot - 0.08, 0.17, 1, hero ? 0 : 4); // corbels, under the sill
    // Louvered shutters folded back against the wall.
    for (const s of [-1, 1]) fbox(f, shutterMat(shutter), a + s * (hw + 0.12) - (s > 0 ? 0 : 0.42), bot + 0.02, 0.02, a + s * (hw + 0.12) + (s > 0 ? 0.42 : 0), top - 0.02, 0.06, 0.6);
    if (ground) {
      // Wrought bars inside the reveal, with a top and bottom rail.
      // Off the hero blocks the bars lose their end faces (hidden in the reveal) and the rails their ends.
      if (!lite) for (let i = -2; i <= 2; i++) fbox(f, M.iron, a + i * 0.17 - 0.013, bot + 0.02, 0.1, a + i * 0.17 + 0.013, top - 0.02, 0.126, 1, hero ? 0 : 12);
      for (const y of [bot + 0.12, top - 0.12]) fbox(f, M.iron, a - hw, y - 0.015, 0.1, a + hw, y + 0.015, 0.13, 1, hero ? 0 : 3);
    } else if (balcony) {
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
    fbox(f, M.trim, a - hw - 0.14, 0, 0, a - hw, top, 0.18);
    fbox(f, M.trim, a + hw, 0, 0, a + hw + 0.14, top, 0.18);
    fbox(f, M.trim, a - hw - 0.18, top, 0, a + hw + 0.18, top + 0.2, 0.22);
    fbox(f, M.trimSmall, a - hw - 0.26, top + 0.2, 0, a + hw + 0.26, top + 0.27, 0.3);
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
      if (!lite) for (const c of [-1, 1]) for (const d of [0.18, 0.36]) fbox(f, M.iron, la + c * 0.09 - 0.012, 2.06, d - 0.012, la + c * 0.09 + 0.012, 2.3, d + 0.012, 1, hero ? 0 : 12);
    }
  }

  /** Hero blocks: cornice in three steps and a barrel-tile eave (milestone 2). */
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
      fbox(f, M.spout, a - 0.07, h - 0.36, 0, a + 0.07, h - 0.24, 0.62);
      fbox(f, M.eave, a - 0.05, h - 0.28, 0.08, a + 0.05, h - 0.24, 0.62);
    }
  }

  /**
   * The same cornice and eave on one exposed run of a face: the tiles are one
   * corrugated strip (a third of the triangles of separate tiles), and the
   * pieces meet the next face cleanly at corners.
   */
  function eaveRun(f: Frame, s: Span, h: number, spouts: boolean): void {
    sbox(f, s, M.trim, h - 0.42, 0, h - 0.3, 0.08);
    sbox(f, s, M.trim, h - 0.3, 0, h - 0.18, 0.17);
    sbox(f, s, M.trim, h - 0.18, 0, h - 0.02, 0.27);
    sbox(f, s, M.eave, h - 0.02, -0.4, h + 0.04, 0.4);
    const [t0, t1] = run(s, -0.42, 0.42);
    if (t1 - t0 > 0.2) fgeo(f, M.tileA, tileStrip(t0, t1, lite ? 0.32 : 0.24, quality === 'high' ? 3 : 2, h + 0.13, h + 0.04, -0.42, 0.42, 0.08, TILE_COLORS));
    if (spouts && s.a1 - s.a0 > 3) for (const a of [s.a0 + 0.6, s.a1 - 0.6]) {
      fbox(f, M.spout, a - 0.07, h - 0.36, 0, a + 0.07, h - 0.24, 0.62);
      fbox(f, M.eave, a - 0.05, h - 0.28, 0.08, a + 0.05, h - 0.24, 0.62);
    }
  }

  /** Painted base band with a molded cap on one exposed run, stopping at door casings (`gaps`, along the frame). */
  function bandRun(f: Frame, s: Span, band: number, gaps: ReadonlyArray<readonly [number, number]> = []): void {
    for (const p of cut(s, gaps)) {
      sbox(f, p, wallMat(band), 0, 0, 0.8, 0.03);
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
      fbox(f, wallMat(band), p, 0, 0, q, 0.8, 0.03);
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

  const bandOf = (col: number) => (col === STUCCO.stuccoCream ? 0xc2704f : 0xa45c3e); // a softer, earthier base band
  const shutterOf = (col: number) => (col === STUCCO.stuccoTurquoise ? COLORS.marigold : col === STUCCO.stuccoViolet ? 0xf4e6c8 : COLORS.turquoise);

  // ---------------------------------------------------------------- paving
  // Facade strips are collected first so overlapping strips (at inside
  // corners) can be cut back: two paver planes on one spot would flicker.
  const strips: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> = [];
  /** Paving and kerb along a facade run (out to 1.4 m), cut where an earlier strip already lies. */
  function paveFront(b: MapBox, side: Side, a0: number, a1: number): void {
    const f = frameOf(b, side), fc = faceOf(b, side);
    const rect = (p: number, q: number) => {
      const w0 = side === 's' || side === 'w' ? fc.lo + p : fc.hi - q, w1 = side === 's' || side === 'w' ? fc.lo + q : fc.hi - p;
      const n0 = fc.plane, n1 = fc.plane + fc.out * 1.55;
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
      paving(f, p, q, 1.4, 0.7, 2.4);
      fbox(f, M.cantera, p, 0, 1.4, q, 0.03, 1.55, 0.8);                           // flush curb line
      strips.push(rect(p, q));
    }
  }

  // ---------------------------------------------------------------- the kit

  /** The hero blocks: exactly the milestone 2 dressing. */
  function heroBuilding(b: MapBox): void {
    hero = true;
    const h = b.maxY - b.minY;
    const col = STUCCO[b.mat]!;
    batch.add(wallMat(col), boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 2));
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
    body(b, wallMat(col), 2);
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
      // Long backs and ends seen from an alley get a row of upper windows
      // (no ground floor, no door), kept clear of the team banners.
      for (const s of spansOf(b, side, up - 0.85, up + 0.85)) {
        if (s.a1 - s.a0 < 5) continue;
        const n = Math.floor((s.a1 - s.a0) / 2.7), sp = (s.a1 - s.a0) / n;
        for (let k = 0; k < n; k++) {
          const a = s.a0 + sp * (k + 0.5);
          if (!bannerClear(b, side, a)) continue;
          windowUnit(f, a, up, shutter, false, false);
        }
      }
    }
    for (const s of spansOf(b, fs, 0, h - 0.42)) {
      // Pilasters at the facade's own corners.
      if (s.a0 < 0.01) pilaster(ff, 0, h);
      if (s.a1 > ff.len - 0.01) pilaster(ff, ff.len, h);
    }
    for (const a of bays) {
      if (a === door) doorUnit(ff, a); else windowUnit(ff, a, 1.55, shutter, true, false);
      windowUnit(ff, a, up, shutter, false, a !== door && Math.round(a / spacing - 0.5) % 2 === 0);
    }
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
    body(b, wallMat(col), 2);
    batch.add(M.wood, boxGeo(b.minX + 0.001, b.minY - 0.004, b.minZ + 0.001, b.maxX - 0.001, b.minY, b.maxZ - 0.001, 1.2, 8)); // a timber ceiling over the passage
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
    batch.add(M.crate, boxGeo(b.minX + i, 0, b.minZ + i, b.maxX - i, h - i, b.maxZ - i, 1, 63 & ~8));
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

  // ---------------------------------------------------------------- assembly
  // Facades first, so their paving strips win at inside corners.
  const order = [...boxes].sort((p, q) => Number(!!q.facade) - Number(!!p.facade));
  for (const b of order) {
    batch.chunk = chunkOf(b);
    const h = b.maxY - b.minY;
    if (b.mat in STUCCO) {
      const col = STUCCO[b.mat]!;
      const fl = b.facade ? frameOf(b, b.facade).len : 0;
      if (b.facade && heroZone && inZone(b)) { heroBuilding(b); hero = false; }
      else if (b.facade && fl >= 2 && h >= 4) building(b, col);
      else wall(b, col);
      continue;
    }
    switch (b.mat) {
      case 'step': step(b); break;
      case 'stone': if (h > 1.5) terrace(b); else bench(b); break;
      case 'parapet': parapet(b); break;
      case 'lintel': lintel(b); break;
      case 'planter': planter(b); break;
      case 'crate': crate(b); break;
      case 'bin': bin(b); break;
      default: batch.add(M.cantera, boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 1));
    }
  }

  const calls = batch.build(group, materials);
  return { group, calls };
}
