// Geometry kit for Rosa's model: lofted rings (bodice, skirt, sleeves, hat,
// hood, shoes), a part list that bakes vertex-coloured pieces and their ink
// hulls into one geometry per joint, and small shapes (cat-eye frames, the
// crescent). Everything is built once per look and cached by rosa-model.ts.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROSA_SHARED } from './rosa-materials';

/**
 * One cross-section of a loft, around the vertical axis: centre (x, z) at
 * height y, half-width r, half-depth rz to the front (-z) and rzB to the
 * back (both default to r). c: its colour. Two rings at the same place with
 * different colours give a crisp colour edge.
 */
export interface Ring { y: number; r: number; rz?: number; rzB?: number; x?: number; z?: number; c: number }

export interface LoftOpts {
  /** Column angles (radians, 0 = front -z, pi/2 = her right +x); default: seg evenly spaced, offset half a step. */
  angles?: number[];
  /** Radial scale per vertex (folds, scallops). i: ring index. */
  mod?: (a: number, i: number, ring: Ring) => number;
  /** Remaps a column's angle per ring (the hood's face opening). */
  angle?: (a: number, i: number, ring: Ring) => number;
  /** Overrides a vertex colour. */
  color?: (a: number, i: number, ring: Ring) => number | undefined;
  /** Leaves out the quad between columns a0..a1 and rings r0..r1 (an opening). */
  skip?: (a0: number, a1: number, r0: Ring, r1: Ring) => boolean;
}

/**
 * A closed solid swept through rings listed top to bottom on the outside
 * (and back up the inside for shells such as a brim or a hood): the profile
 * runs clockwise in (radius, height), so faces point outwards. Rings of
 * radius 0 are poles. Indexed, with smooth normals and vertex colours.
 */
export function loft(rings: Ring[], seg: number, o: LoftOpts = {}): THREE.BufferGeometry {
  const angles = o.angles ?? Array.from({ length: seg }, (_, j) => ((j + 0.5) / seg) * Math.PI * 2);
  const n = angles.length;
  const pos: number[] = [], col: number[] = [];
  const c = new THREE.Color();
  rings.forEach((ring, i) => {
    for (const a0 of angles) {
      const a = o.angle ? o.angle(a0, i, ring) : a0;
      const k = o.mod ? o.mod(a0, i, ring) : 1;
      const s = Math.sin(a), co = Math.cos(a);
      const rz = co > 0 ? (ring.rz ?? ring.r) : (ring.rzB ?? ring.rz ?? ring.r);
      pos.push((ring.x ?? 0) + ring.r * k * s, ring.y, (ring.z ?? 0) - co * rz * k);
      c.setHex(o.color?.(a0, i, ring) ?? ring.c);
      col.push(c.r, c.g, c.b);
    }
  });
  const idx: number[] = [];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      if (o.skip?.(angles[j]!, angles[(j + 1) % n]!, rings[i]!, rings[i + 1]!)) continue;
      const a = i * n + j, b = i * n + ((j + 1) % n), cc = (i + 1) * n + j, d = (i + 1) * n + ((j + 1) % n);
      idx.push(a, d, cc, a, b, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Rings for an ellipsoid (pole to pole), for lofting with the same tools. */
export function ellipsoidRings(rx: number, ry: number, rz: number, rows: number, c: number, cy = 0): Ring[] {
  return Array.from({ length: rows + 1 }, (_, k) => {
    const t = (k / rows) * Math.PI;
    return { y: cy + Math.cos(t) * ry, r: Math.sin(t) * rx, rz: Math.sin(t) * rz, c };
  });
}

/** An ellipsoid (radii rx, ry, rz) as an indexed sphere with smooth normals. */
export function blob(rx: number, ry: number, rz: number, w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.deleteAttribute('uv');
  g.scale(rx, ry, rz);
  g.computeVertexNormals();
  return g;
}

/** A capsule from a to b with radii ra and rb (indexed-free; normals included). */
export function limb(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, radial: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const rows = Math.max(2, Math.round(radial / 3));
  const rings: Ring[] = [];
  for (let k = 0; k <= rows; k++) { const t = (k / rows) * (Math.PI / 2); rings.push({ y: len / 2 + Math.cos(t) * rb, r: Math.sin(t) * rb, c: 0 }); }
  for (let k = 0; k <= rows; k++) { const t = Math.PI / 2 + (k / rows) * (Math.PI / 2); rings.push({ y: -len / 2 + Math.cos(t) * ra, r: Math.sin(t) * ra, c: 0 }); }
  const g = loft(rings, radial);
  g.deleteAttribute('color');
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** Matrix from position, Euler rotation (XYZ) and scale. */
export function trs(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
}

const inkColor = new THREE.Color(ROSA_SHARED.ink);

/**
 * Pieces of one rigid joint, baked into a single geometry: every piece in
 * vertex colours, plus (when asked) its inverted hull, pushed out along
 * welded smooth normals, winding flipped so it draws like a back face,
 * flagged ink = 1 for the material. A hull may come from a coarser proxy
 * of the piece: the outline only needs the silhouette.
 */
export class Parts {
  private list: THREE.BufferGeometry[] = [];
  tris = 0;

  /**
   * g: the piece (not consumed). color: flat colour, or null to keep g's
   * vertex colours. ink: hull width in metres (0: none). proxy: what the
   * hull is made from (default g; consumed).
   */
  add(g: THREE.BufferGeometry, color: number | null, m?: THREE.Matrix4, ink = 0, proxy?: THREE.BufferGeometry): this {
    const src = g.clone();
    if (m) src.applyMatrix4(m);
    if (!src.attributes.normal) src.computeVertexNormals();
    const body = solid(src.index ? src.toNonIndexed() : src.clone());
    for (const k of Object.keys(body.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') body.deleteAttribute(k);
    const n = body.attributes.position!.count;
    if (color !== null || !body.attributes.color) {
      const cc = new THREE.Color(color ?? 0xff00ff);
      const a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) a.set([cc.r, cc.g, cc.b], i * 3);
      body.setAttribute('color', new THREE.BufferAttribute(a, 3));
    }
    body.setAttribute('ink', new THREE.BufferAttribute(new Float32Array(n), 1));
    body.morphAttributes = {};
    this.list.push(body);
    this.tris += n / 3;
    if (ink > 0) {
      let hs = src;
      if (proxy) { hs = proxy; if (m) hs.applyMatrix4(m); }
      const h = hull(hs, ink);
      this.list.push(h);
      this.tris += h.attributes.position!.count / 3;
    }
    if (proxy) proxy.dispose();
    src.dispose();
    return this;
  }

  /**
   * A loft (see loft) and its hull, made from the same rings without their
   * colour-edge duplicates (every h.step-th ring, poles kept) at h.seg
   * columns, shaped by h.opts (index-based mods would not line up). h.m places both.
   */
  loft(rings: Ring[], seg: number, o: LoftOpts, ink: number, h: { seg?: number; step?: number; opts?: LoftOpts; m?: THREE.Matrix4 } = {}): this {
    const g = loft(rings, seg, o);
    let proxy: THREE.BufferGeometry | undefined;
    if (ink > 0) {
      const uniq = rings.filter((r, i) => i === 0 || r.y !== rings[i - 1]!.y || r.r !== rings[i - 1]!.r);
      const step = h.step ?? 1;
      const kept = uniq.filter((_r, i) => i === 0 || i === uniq.length - 1 || i % step === 0);
      proxy = loft(kept, h.seg ?? Math.max(6, Math.round(seg * 0.6)), h.opts ?? {});
    }
    this.add(g, null, h.m, ink, proxy);
    g.dispose();
    return this;
  }

  get empty(): boolean { return this.list.length === 0; }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.list, false)!;
    this.list.forEach((p) => p.dispose());
    this.list = [];
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Drops zero-area triangles (lofts' poles, folded columns) from a non-indexed geometry. */
function solid(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = g.attributes.position!;
  const keep: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < p.count; t += 3) {
    a.fromBufferAttribute(p, t); b.fromBufferAttribute(p, t + 1); c.fromBufferAttribute(p, t + 2);
    if (b.sub(a).cross(c.sub(a)).lengthSq() > 1e-14) keep.push(t);
  }
  if (keep.length * 3 === p.count) return g;
  const out = new THREE.BufferGeometry();
  for (const [k, attr] of Object.entries(g.attributes)) {
    const s = attr.itemSize, src = attr.array as Float32Array;
    const dst = new Float32Array(keep.length * 3 * s);
    keep.forEach((t, i) => dst.set(src.subarray(t * s, (t + 3) * s), i * 3 * s));
    out.setAttribute(k, new THREE.BufferAttribute(dst, s));
  }
  g.dispose();
  return out;
}

function hull(g: THREE.BufferGeometry, width: number): THREE.BufferGeometry {
  const p0 = new THREE.BufferGeometry();
  p0.setAttribute('position', g.attributes.position!.clone());
  if (g.index) p0.setIndex(g.index.clone());
  const welded = mergeVertices(p0, 1e-4);
  p0.dispose();
  welded.computeVertexNormals();
  const p = welded.attributes.position!, nn = welded.attributes.normal!;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + nn.getX(i) * width, p.getY(i) + nn.getY(i) * width, p.getZ(i) + nn.getZ(i) * width);
  const flat = solid(welded.toNonIndexed());
  welded.dispose();
  flat.deleteAttribute('normal');
  const a = flat.attributes.position!.array as Float32Array;
  for (let t = 0; t < a.length; t += 9) for (let k = 0; k < 3; k++) { const s = a[t + 3 + k]!; a[t + 3 + k] = a[t + 6 + k]!; a[t + 6 + k] = s; }
  flat.computeVertexNormals();
  const n = flat.attributes.position!.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([inkColor.r, inkColor.g, inkColor.b], i * 3);
  flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
  flat.setAttribute('ink', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  return flat;
}

/** Cat-eye frame (a rim facing -z, centred on the eye), the outer corner swept up toward +x (her right); side -1 mirrors it for her left eye. */
export function catEyeFrame(side: number, curve: number): THREE.BufferGeometry {
  const outer = new THREE.Shape();
  outer.moveTo(-0.040, -0.004);
  outer.quadraticCurveTo(-0.038, -0.03, -0.004, -0.028);
  outer.quadraticCurveTo(0.036, -0.026, 0.044, 0.004);
  outer.quadraticCurveTo(0.054, 0.03, 0.062, 0.038); // the upswept flick
  outer.quadraticCurveTo(0.02, 0.03, -0.006, 0.026);
  outer.quadraticCurveTo(-0.042, 0.022, -0.040, -0.004);
  const hole = new THREE.Path();
  hole.moveTo(-0.031, -0.003);
  hole.quadraticCurveTo(-0.03, -0.021, -0.003, -0.02);
  hole.quadraticCurveTo(0.03, -0.019, 0.035, 0.003);
  hole.quadraticCurveTo(0.03, 0.019, -0.004, 0.018);
  hole.quadraticCurveTo(-0.032, 0.016, -0.031, -0.003);
  outer.holes.push(hole);
  const ex = new THREE.ExtrudeGeometry(outer, { depth: 0.006, bevelEnabled: false, curveSegments: curve });
  ex.deleteAttribute('uv');
  ex.translate(0, 0, -0.003);
  // Seen from the front (-z), +x is on the viewer's left: the flick must point away from the nose.
  if (side < 0) return mirrorX(ex);
  ex.computeVertexNormals();
  return ex;
}

/** Mirrors a geometry in x (keeping faces pointing outwards); consumes g. */
export function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = g.index ? g.toNonIndexed() : g.clone();
  g.dispose();
  p.scale(-1, 1, 1);
  const a = p.attributes.position!.array as Float32Array;
  for (let t = 0; t < a.length; t += 9) for (let k = 0; k < 3; k++) { const v = a[t + 3 + k]!; a[t + 3 + k] = a[t + 6 + k]!; a[t + 6 + k] = v; }
  if (p.attributes.color) {
    const c = p.attributes.color.array as Float32Array;
    for (let t = 0; t < c.length; t += 9) for (let k = 0; k < 3; k++) { const v = c[t + 3 + k]!; c[t + 3 + k] = c[t + 6 + k]!; c[t + 6 + k] = v; }
  }
  p.computeVertexNormals();
  return p;
}

/** A crescent moon (facing -z after extrusion along -z), radius r. */
export function crescentShape(r: number, depth: number, curve: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.absarc(0, 0, r, Math.PI * 0.28, Math.PI * 1.72, false);
  s.absarc(r * 0.42, r * 0.06, r * 0.8, Math.PI * 1.6, Math.PI * 0.42, true);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: curve });
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}
