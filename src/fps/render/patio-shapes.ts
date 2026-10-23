// El Patio kit: small procedural shapes (leaf tufts, barrel-tile strips,
// blind arches) and the face-coverage test the kit uses to dress only the
// sides of a box that can actually be seen. Geometry only: placement lives
// in section.ts, surfaces in patio-materials.ts.
import * as THREE from 'three';
import type { MapBox } from '../../../shared/map';

export type Side = 'n' | 's' | 'e' | 'w';
export const SIDES: readonly Side[] = ['n', 's', 'e', 'w'];

// ------------------------------------------------------------- coverage

/** A face of a box in world terms: the plane it lies in, which way it points, and its extent along the wall. */
interface Face { axis: 'x' | 'z'; plane: number; out: 1 | -1; lo: number; hi: number }

export function faceOf(b: MapBox, side: Side): Face {
  switch (side) {
    case 's': return { axis: 'z', plane: b.maxZ, out: 1, lo: b.minX, hi: b.maxX };
    case 'n': return { axis: 'z', plane: b.minZ, out: -1, lo: b.minX, hi: b.maxX };
    case 'e': return { axis: 'x', plane: b.maxX, out: 1, lo: b.minZ, hi: b.maxZ };
    default: return { axis: 'x', plane: b.minX, out: -1, lo: b.minZ, hi: b.maxZ };
  }
}

/**
 * The intervals (world coordinates along the face) of a box's side that are
 * not hidden by a neighbouring box over the whole height band y0..y1. A
 * neighbour hides a face where it touches the face's plane (within 2 cm)
 * and extends outward from it.
 */
export function exposedSpans(boxes: readonly MapBox[], b: MapBox, side: Side, y0: number, y1: number): Array<[number, number]> {
  const f = faceOf(b, side);
  const cover: Array<[number, number]> = [];
  for (const o of boxes) {
    if (o === b || o.minY > y0 + 0.01 || o.maxY < y1 - 0.01) continue;
    const [oMin, oMax] = f.axis === 'z' ? [o.minZ, o.maxZ] : [o.minX, o.maxX];
    const touches = f.out > 0 ? oMin <= f.plane + 0.02 && oMax >= f.plane + 0.05 : oMax >= f.plane - 0.02 && oMin <= f.plane - 0.05;
    if (!touches) continue;
    const [aMin, aMax] = f.axis === 'z' ? [o.minX, o.maxX] : [o.minZ, o.maxZ];
    const lo = Math.max(f.lo, aMin), hi = Math.min(f.hi, aMax);
    if (hi > lo) cover.push([lo, hi]);
  }
  cover.sort((p, q) => p[0] - q[0]);
  const out: Array<[number, number]> = [];
  let at = f.lo;
  for (const [lo, hi] of cover) {
    if (lo > at + 0.05) out.push([at, lo]);
    at = Math.max(at, hi);
  }
  if (f.hi > at + 0.05) out.push([at, f.hi]);
  return out;
}

/** True when the whole face (or the given height band of it) is hidden by neighbours. */
export function faceCovered(boxes: readonly MapBox[], b: MapBox, side: Side, y0 = b.minY, y1 = b.maxY): boolean {
  return exposedSpans(boxes, b, side, y0, y1).length === 0;
}

/** World coordinate along a face to the facade frame's `a` (0 at the frame's left end). */
export function toAlong(b: MapBox, side: Side, w: number): number {
  switch (side) {
    case 's': return w - b.minX;
    case 'n': return b.maxX - w;
    case 'e': return b.maxZ - w;
    default: return w - b.minZ;
  }
}

// ------------------------------------------------------------- triangles

class Tris {
  pos: number[] = []; nor: number[] = []; col: number[] = []; uv: number[] = [];
  tri(a: number[], b: number[], c: number[], na: number[], nb: number[], nc: number[], ca: THREE.Color, cb: THREE.Color, cc: THREE.Color): void {
    this.pos.push(...a, ...b, ...c);
    this.nor.push(...na, ...nb, ...nc);
    this.col.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
    this.uv.push(a[0]!, a[1]!, b[0]!, b[1]!, c[0]!, c[1]!);
  }
  geo(colors: boolean): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const norm = (x: number, y: number, z: number): number[] => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };

/**
 * A stylized leaf tuft: blades radiating from a base point, each a creased
 * kite (two triangles), leaning out and up. Unit size: base at the origin,
 * about 1 high and 0.5 in radius. Colours go into the vertices (dark at the
 * base, light at the tips); normals lean outward so the toon ramp reads it
 * as a soft rounded clump. Drawn double-sided ('leaf' kind).
 */
export function leafTuft(blades: number, base: number, tip: number, seed: number, tiers = 3): THREE.BufferGeometry {
  const t = new Tris(), r = rng(seed);
  const cb = new THREE.Color().setHex(base), ct = new THREE.Color().setHex(tip), cm = cb.clone().lerp(ct, 0.55);
  const ring = (n: number, lean: number, height: number, width: number, phase: number) => {
    for (let i = 0; i < n; i++) {
      const th = phase + (i / n) * Math.PI * 2 + (r() - 0.5) * 0.5;
      const ux = Math.cos(th), uz = Math.sin(th), sx = -uz, sz = ux; // outward, and across the blade
      const rt = lean * (0.85 + r() * 0.3), ht = height * (0.85 + r() * 0.3), w = width * (0.85 + r() * 0.3);
      const B = [ux * 0.04, 0, uz * 0.04];
      const M = [ux * rt * 0.5, ht * 0.62, uz * rt * 0.5]; // the crease is raised: a convex blade
      const T = [ux * rt, ht * (0.8 + r() * 0.2), uz * rt];
      const L = [M[0]! + sx * w / 2, M[1]! - 0.06, M[2]! + sz * w / 2], R = [M[0]! - sx * w / 2, M[1]! - 0.06, M[2]! - sz * w / 2];
      const nB = norm(ux * 0.3, 1, uz * 0.3), nM = norm(ux * 0.8, 0.7, uz * 0.8), nT = norm(ux, 0.45, uz);
      t.tri(B, L, T, nB, nM, nT, cb, cm, ct);
      t.tri(B, T, R, nB, nT, nM, cb, ct, cm);
    }
  };
  // Broad, overlapping blades in three tiers read as a leafy clump rather than spikes.
  ring(blades, 0.5, 0.55, 0.46, 0);
  if (tiers > 1) ring(Math.max(3, Math.round(blades * 0.65)), 0.32, 0.85, 0.4, 0.5);
  if (tiers > 2) ring(Math.max(2, Math.round(blades * 0.4)), 0.12, 1.0, 0.32, 1.1);
  // Normalise to exactly 1 high and 0.5 in radius, so callers can size it like the old foliage.
  let top = 0, rad = 0;
  for (let i = 0; i < t.pos.length; i += 3) { top = Math.max(top, t.pos[i + 1]!); rad = Math.max(rad, Math.hypot(t.pos[i]!, t.pos[i + 2]!)); }
  for (let i = 0; i < t.pos.length; i += 3) { t.pos[i]! *= 0.5 / rad; t.pos[i + 1]! *= 1 / top; t.pos[i + 2]! *= 0.5 / rad; }
  return t.geo(true);
}

/**
 * A strip of barrel roof tiles along a facade frame (a = along, y = up,
 * n = out): one corrugated sheet whose humps are the tiles, with a half-disc
 * end cap per tile at the eave. About a third of the triangles of separate
 * capped half-cylinders. Tile colours cycle through `colors` (sRGB hex).
 */
export function tileStrip(a0: number, a1: number, pitch: number, segs: number, yBack: number, yFront: number, nBack: number, nFront: number, rise: number, colors: readonly number[]): THREE.BufferGeometry {
  const t = new Tris();
  const n = Math.max(1, Math.round((a1 - a0) / pitch)), p = (a1 - a0) / n, rw = p / 2;
  const cs = colors.map((c) => new THREE.Color().setHex(c));
  for (let i = 0; i < n; i++) {
    const c = cs[i % cs.length]!, ac = a0 + (i + 0.5) * p;
    const prof = (k: number) => { const ph = Math.PI * k / segs; return { a: ac - rw * Math.cos(ph), y: rise * Math.sin(ph), nn: norm(-rise * Math.cos(ph), rw * Math.sin(ph), 0) }; };
    for (let k = 0; k < segs; k++) {
      const P = prof(k), Q = prof(k + 1);
      const pb = [P.a, yBack + P.y, nBack], pf = [P.a, yFront + P.y, nFront], qb = [Q.a, yBack + Q.y, nBack], qf = [Q.a, yFront + Q.y, nFront];
      t.tri(pb, pf, qf, P.nn, P.nn, Q.nn, c, c, c);
      t.tri(pb, qf, qb, P.nn, Q.nn, Q.nn, c, c, c);
      // End cap at the eave: a fan from the tile's centre line.
      t.tri([ac, yFront, nFront], qf, pf, [0, 0, 1], [0, 0, 1], [0, 0, 1], c, c, c);
    }
  }
  return t.geo(true);
}

/**
 * A blind arch's molded ring standing proud of a wall, in a facade frame:
 * a half annulus centred at (ac, ys), radii r0..r1, from the wall (n = 0) to
 * n = depth, with its front, inner (intrados) and outer faces.
 */
export function archRing(ac: number, ys: number, r0: number, r1: number, depth: number, segs: number): THREE.BufferGeometry {
  const t = new Tris(), w = new THREE.Color(1, 1, 1);
  const pt = (r: number, k: number, n: number) => { const ph = Math.PI * k / segs; return [ac + r * Math.cos(ph), ys + r * Math.sin(ph), n]; };
  const dir = (k: number, s: number) => { const ph = Math.PI * k / segs; return [s * Math.cos(ph), s * Math.sin(ph), 0]; };
  for (let k = 0; k < segs; k++) {
    const f = [0, 0, 1];
    t.tri(pt(r0, k, depth), pt(r1, k, depth), pt(r1, k + 1, depth), f, f, f, w, w, w);
    t.tri(pt(r0, k, depth), pt(r1, k + 1, depth), pt(r0, k + 1, depth), f, f, f, w, w, w);
    // Intrados faces the arch's centre; extrados faces away from it.
    t.tri(pt(r0, k, 0), pt(r0, k, depth), pt(r0, k + 1, depth), dir(k, -1), dir(k, -1), dir(k + 1, -1), w, w, w);
    t.tri(pt(r0, k, 0), pt(r0, k + 1, depth), pt(r0, k + 1, 0), dir(k, -1), dir(k + 1, -1), dir(k + 1, -1), w, w, w);
    t.tri(pt(r1, k, 0), pt(r1, k + 1, depth), pt(r1, k, depth), dir(k, 1), dir(k + 1, 1), dir(k, 1), w, w, w);
    t.tri(pt(r1, k, 0), pt(r1, k + 1, 0), pt(r1, k + 1, depth), dir(k, 1), dir(k + 1, 1), dir(k + 1, 1), w, w, w);
  }
  const g = t.geo(false);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 2);
  return g;
}

/** The flat panel inside a blind arch (a rectangle with a round head), lying `n` in front of the wall. */
export function archPanel(ac: number, y0: number, ys: number, r: number, n: number, segs: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(ac - r, y0); s.lineTo(ac + r, y0); s.lineTo(ac + r, ys);
  s.absarc(ac, ys, r, 0, Math.PI, false);
  s.lineTo(ac - r, y0);
  const g = new THREE.ShapeGeometry(s, Math.max(2, Math.round(segs / 2)));
  g.translate(0, 0, n);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 2);
  return g;
}
