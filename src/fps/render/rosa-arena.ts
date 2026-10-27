// The arena look of Doña Rosa (the shooter's avatar, `arena: true`): the
// same joints, palette, ruleros, hat and rebozo as the campaign look
// (rosa-model.ts), with the body re-shaped to read as one designed
// character at combat distance:
//   - the head is a profiled shell (forehead, brow, round cheeks, soft
//     jowls, a small chin) instead of an ellipsoid, and every facial
//     feature is laid on that surface: a stronger nose, fuller lips, bold
//     arched brows, larger cat-eye frames that clear the brows through any
//     expression;
//   - the bodice is an hourglass with a sloping neck-to-shoulder line, a
//     full bust and a cinched, sashed waist; the sleeves are gathered puffs
//     that sit on the shoulder ends; plumper arms and larger hands;
//   - the skirt is a bell with folds deepening to a ruffled flounce in the
//     team colour, a cream petticoat edge peeking under it.
// Everything is baked per look into the same one-mesh-per-joint geometry
// (no new draw calls, no new materials) and cached by rosa-model.ts.
import * as THREE from 'three';
import type { Team } from '../../../shared/map';
import type { Quality } from '../settings';
import { sweep } from './fp-geo';
import { Parts, blob, crescentShape, limb, loft, mirrorX, trs, type Ring } from './rosa-geo';
import { FACE_TAG, ROSA_COLORS, ROSA_SHARED as S, type FaceRig } from './rosa-materials';

/** What the arena builders read from rosa-model's per-quality detail. */
export interface ArenaDetail {
  body: number; folds: number; limb: number; small: [number, number]; tiny: [number, number];
  ink: number; inkLimb: number; inkSmall: number; fine: boolean; mid: boolean;
}

/** Arena-only resolution per quality: head columns and rows, skirt columns, and the flounce's ruffles (0: none). */
const RES: Record<Quality, { headSeg: number; headRows: number; hair: [number, number]; body: number; skirt: number; ruffle: number; sleeve: number }> = {
  high: { headSeg: 22, headRows: 16, hair: [16, 11], body: 18, skirt: 42, ruffle: 14, sleeve: 20 },
  medium: { headSeg: 16, headRows: 12, hair: [12, 8], body: 12, skirt: 30, ruffle: 10, sleeve: 12 },
  low: { headSeg: 11, headRows: 8, hair: [9, 6], body: 8, skirt: 10, ruffle: 0, sleeve: 7 },
};
/** Hair cap columns and rows for the arena head. */
export function arenaHairRes(q: Quality): [number, number] { return RES[q].hair; }

const NEG_Z = new THREE.Vector3(0, 0, -1);
const wrap = (a: number): number => { let w = a % (Math.PI * 2); if (w > Math.PI) w -= Math.PI * 2; if (w < -Math.PI) w += Math.PI * 2; return w; };
const gauss = (x: number): number => Math.exp(-x * x);
const lerpHex = (a: number, b: number, k: number): number => new THREE.Color(a).lerp(new THREE.Color(b), k).getHex();

// ------------------------------------------------------------ the head
// Head-local, before the head's 1.12 scale (rosa-model applies it to the
// baked geometry). The pivot is the top of the neck. Keyframes top to
// bottom: y, half-width, front depth, back depth, centre z.

type Prof = [number, number, number, number, number];
const HEAD_KEYS: Prof[] = [
  [0.266, 0, 0, 0, 0.006],
  [0.254, 0.07, 0.066, 0.08, 0.006],
  [0.228, 0.11, 0.104, 0.124, 0.006],
  [0.19, 0.131, 0.128, 0.146, 0.005], // forehead (inside the hair cap)
  [0.148, 0.139, 0.142, 0.152, 0.003], // brow
  [0.108, 0.141, 0.146, 0.148, 0], // eyes, cheekbones
  [0.07, 0.146, 0.145, 0.136, -0.002], // the round cheeks
  [0.034, 0.139, 0.141, 0.114, -0.004], // mouth, jowls
  [0.002, 0.118, 0.131, 0.088, -0.006], // jaw
  [-0.026, 0.082, 0.117, 0.062, -0.008], // chin
  [-0.043, 0.04, 0.094, 0.034, -0.012],
  [-0.05, 0, 0, 0, -0.048],
];

function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
/** The head profile at parameter u (0 crown .. 1 under the chin), Catmull-Rom through the keys. */
function profAt(u: number): Prof {
  const n = HEAD_KEYS.length - 1, f = Math.min(n - 1e-9, Math.max(0, u * n)), i = Math.floor(f), t = f - i;
  const k = (j: number) => HEAD_KEYS[Math.min(n, Math.max(0, j))]!;
  const out = [0, 0, 0, 0, 0] as Prof;
  for (let c = 0; c < 5; c++) out[c] = cr(k(i - 1)[c]!, k(i)[c]!, k(i + 1)[c]!, k(i + 2)[c]!, t);
  for (let c = 1; c < 4; c++) out[c] = Math.max(0, out[c]!);
  if (i === 0 && t === 0) out[1] = out[2] = out[3] = 0;
  return out;
}
/** Round cheeks: a swell low on the front-sides of the face. */
function cheek(a: number, y: number): number {
  return 1 + 0.055 * gauss((y - 0.064) / 0.042) * gauss((Math.abs(wrap(a)) - 0.95) / 0.42);
}
function headPoint(a: number, u: number, out = new THREE.Vector3()): THREE.Vector3 {
  const [y, r, rz, rzB, z] = profAt(u);
  const k = cheek(a, y), co = Math.cos(a);
  return out.set(r * k * Math.sin(a), y, z - co * (co > 0 ? rz : rzB) * k);
}
function uAtY(y: number): number {
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (profAt(m)[0] > y) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
/** A frame on the face: at (x, y) on the head's front, lifted along its normal, -z turned to face out (as rosa-model's face()). */
export function onFace(x: number, y: number, lift: number, tilt = 0): THREE.Matrix4 {
  const u = uAtY(y);
  let a = 0;
  for (let i = 0; i < 6; i++) { const [yy, r] = profAt(u); a = Math.asin(Math.max(-1, Math.min(1, x / Math.max(1e-4, r * cheek(a, yy))))); }
  const p = headPoint(a, u);
  const e = 1e-3;
  const da = headPoint(a + e, u).sub(headPoint(a - e, u));
  const du = headPoint(a, Math.min(1, u + e)).sub(headPoint(a, Math.max(0, u - e)));
  const n = new THREE.Vector3().crossVectors(da, du).normalize();
  if (n.z > 0) n.negate();
  p.addScaledVector(n, lift);
  const q = new THREE.Quaternion().setFromUnitVectors(NEG_Z, n).multiply(new THREE.Quaternion().setFromAxisAngle(NEG_Z, -tilt));
  return new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
}
const at = (m: THREE.Matrix4): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(m);

/** Eyes: centre height and x; brows: inner and outer x (head-local, unscaled). */
const EYE = { x: 0.052, y: 0.122 };
const BROW = { inX: 0.02, outX: 0.096, inY: 0.173, topY: 0.198, outY: 0.187 };

/** The face rig for the shader (the head drawn at `scale`). */
export function arenaFaceRig(scale: number): FaceRig {
  return { lidY: (at(onFace(EYE.x, EYE.y, 0.002)).y - 0.003) * scale, browIn: BROW.inX * scale, browOut: BROW.outX * scale };
}

/** A cat-eye frame with a bold rim, facing -z, the flick toward +x (side -1 mirrors it). */
function boldFrame(side: number, curve: number): THREE.BufferGeometry {
  const o = new THREE.Shape();
  o.moveTo(-0.043, -0.004);
  o.quadraticCurveTo(-0.042, -0.033, -0.004, -0.031);
  o.quadraticCurveTo(0.039, -0.029, 0.047, 0.004);
  o.quadraticCurveTo(0.056, 0.03, 0.068, 0.043); // the flick
  o.quadraticCurveTo(0.022, 0.034, -0.006, 0.03);
  o.quadraticCurveTo(-0.045, 0.026, -0.043, -0.004);
  const h = new THREE.Path();
  h.moveTo(-0.034, -0.003);
  h.quadraticCurveTo(-0.033, -0.024, -0.003, -0.023);
  h.quadraticCurveTo(0.033, -0.022, 0.038, 0.003);
  h.quadraticCurveTo(0.033, 0.023, -0.004, 0.022);
  h.quadraticCurveTo(-0.035, 0.02, -0.034, -0.003);
  o.holes.push(h);
  const g = new THREE.ExtrudeGeometry(o, { depth: 0.008, bevelEnabled: false, curveSegments: curve });
  g.deleteAttribute('uv');
  g.translate(0, 0, -0.004);
  if (side < 0) return mirrorX(g);
  g.computeVertexNormals();
  return g;
}

export interface HeadHooks {
  /** The hair cap (rosa-model's, so the ruleros still sit on it). */
  hair: (p: Parts, extraBack: boolean) => void;
  /** Hat (Sol) or rebozo hood (Luna). */
  headwear: (p: Parts) => void;
}

/** Head and face (and, through the hooks, the hair cap and hat or hood). */
export function arenaHead(team: Team, q: Quality, d: ArenaDetail, p: Parts, hooks: HeadHooks): void {
  const c = ROSA_COLORS[team];
  const res = RES[q];
  const [sw, sh] = d.small, [tw, th] = d.tiny;
  const rings: Ring[] = [];
  for (let k = 0; k <= res.headRows; k++) {
    const [y, r, rz, rzB, z] = profAt(k / res.headRows);
    rings.push({ y, r, rz, rzB, z, c: S.skin });
  }
  const mod = (a: number, _i: number, r: Ring) => cheek(a, r.y);
  p.loft(rings, res.headSeg, { mod }, d.ink, { step: 2, seg: Math.max(10, Math.round(res.headSeg * 0.6)), opts: { mod } });
  hooks.hair(p, team === 0);
  if (team === 0) {
    // A low bun wrapped by a ribbon in the team trim, and ears with gold hoops.
    p.add(blob(0.078, 0.068, 0.064, sw, sh), S.hair, trs(0, 0.07, 0.172), d.ink, blob(0.078, 0.068, 0.064, 6, 4));
    if (d.mid) { const band = new THREE.TorusGeometry(0.06, 0.009, 4, Math.max(8, sw)); band.deleteAttribute('uv'); p.add(band, c.trim, trs(0, 0.07, 0.14)); band.dispose(); }
    for (const s of [-1, 1]) {
      const m = trs(s * 0.141, 0.098, 0.014, 0, 0, -s * 0.15);
      p.add(blob(0.016, 0.03, 0.022, tw, th), S.skin, m, d.inkSmall);
      if (d.fine) { const ring = new THREE.TorusGeometry(0.013, 0.0038, 3, 8); ring.deleteAttribute('uv'); p.add(ring, S.gold, trs(s * 0.149, 0.056, 0.014, 0, Math.PI / 2, 0)); ring.dispose(); }
    }
  }
  // Nose: a rounded, slightly drooping grandmother's nose, its bridge rising to the frames.
  const tip = onFace(0, 0.08, 0.018);
  p.add(blob(0.023, 0.021, 0.022, tw + 1, th + 1), S.skin, tip, d.inkSmall, blob(0.023, 0.021, 0.022, 5, 3));
  const bridge = limb(at(onFace(0, 0.118, 0.004)), at(onFace(0, 0.086, 0.014)), 0.011, 0.014, Math.max(5, tw));
  p.add(bridge, S.skin);
  bridge.dispose();
  if (d.mid) for (const s of [-1, 1]) p.add(blob(0.012, 0.011, 0.012, tw, th), S.skin, onFace(s * 0.016, 0.072, 0.008));
  for (const s of [-1, 1]) {
    const ex = s * EYE.x, ey = EYE.y;
    // The eyes and brows are tagged for the shader (blinks, expressions).
    p.add(blob(0.029, 0.022, 0.012, sw, sh), S.eyeWhite, onFace(ex, ey, 0.002), 0, undefined, FACE_TAG.eye);
    p.add(blob(0.0145, 0.017, 0.006, tw, th), S.iris, onFace(ex - s * 0.004, ey - 0.002, 0.0115), 0, undefined, FACE_TAG.eye);
    if (d.fine) p.add(blob(0.0048, 0.0048, 0.002, 4, 3), 0xffffff, onFace(ex - s * 0.009, ey + 0.005, 0.0172), 0, undefined, FACE_TAG.eye);
    const f = boldFrame(s, d.fine ? 3 : 2);
    f.applyMatrix4(onFace(ex, ey + 0.001, 0.019));
    p.add(f, S.frames); // no hull: inside the lens it would eat into the eye
    f.dispose();
    // Brows: bold arches, the inner ends lower; high enough that fully knitted they stay above the frames.
    const pts = [onFace(s * BROW.inX, BROW.inY, 0.005), onFace(s * 0.056, BROW.topY, 0.005), onFace(s * BROW.outX, BROW.outY, 0.005)].map(at);
    const brow = sweep(new THREE.QuadraticBezierCurve3(pts[0]!, pts[1]!, pts[2]!), new THREE.Vector3(0, 0.15, -1).normalize(), [[-0.011, 0], [0, 0.0065], [0.011, 0], [0, -0.002]], [S.hair], d.fine ? 7 : d.mid ? 5 : 3);
    p.add(brow, null, undefined, 0, undefined, s < 0 ? FACE_TAG.browL : FACE_TAG.browR);
    brow.dispose();
    if (d.mid) p.add(blob(0.027, 0.017, 0.004, tw, th), S.blush, onFace(s * 0.092, 0.066, 0.002));
  }
  const fb = limb(at(onFace(-0.013, 0.128, 0.019)), at(onFace(0.013, 0.128, 0.019)), 0.005, 0.005, 4);
  p.add(fb, S.frames);
  fb.dispose();
  if (d.mid && team === 0) {
    for (const s of [-1, 1]) { const t = limb(at(onFace(s * 0.11, 0.134, 0.012)), new THREE.Vector3(s * 0.143, 0.124, 0.02), 0.004, 0.004, 4); p.add(t, S.frames); t.dispose(); }
  }
  // Lips: full and red, the corners turned up in a knowing smirk.
  p.add(blob(0.034, 0.0105, 0.011, tw + 2, th), S.lips, onFace(0.003, 0.044, 0.001, 0.1));
  p.add(blob(0.028, 0.012, 0.011, tw + 2, th), S.lips, onFace(0.002, 0.03, 0.001, 0.08));
  hooks.headwear(p);
}

// ------------------------------------------------------------ the torso

/** The bodice cross-sections (torso-local y, half-width, front depth, back depth), shoulders to waist. */
const BODICE: Array<[number, number, number, number]> = [
  [0.552, 0.07, 0.058, 0.064], [0.532, 0.128, 0.084, 0.094], [0.498, 0.186, 0.108, 0.118], [0.452, 0.212, 0.128, 0.138],
  [0.4, 0.21, 0.158, 0.152], [0.33, 0.204, 0.188, 0.156], [0.27, 0.196, 0.183, 0.15], [0.21, 0.172, 0.15, 0.138], [0.15, 0.152, 0.128, 0.124], [0.11, 0.145, 0.122, 0.12],
];
function bodiceAt(y: number): [number, number, number] {
  for (let i = 0; i < BODICE.length - 1; i++) {
    const a = BODICE[i]!, b = BODICE[i + 1]!;
    if (y <= a[0] && y >= b[0]) { const t = (a[0] - y) / (a[0] - b[0]); return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]; }
  }
  const l = BODICE[BODICE.length - 1]!;
  return [l[1], l[2], l[3]];
}

export function arenaTorso(team: Team, q: Quality, d: ArenaDetail, p: Parts): void {
  const c = ROSA_COLORS[team];
  const seg = RES[q].body;
  const R = (y: number, r: number, rz: number, rzB: number, col: number = c.dress): Ring => ({ y, r, rz, rzB, c: col });
  const bodice: Ring[] = [{ y: 0.562, r: 0, c: c.dress }, ...BODICE.map(([y, r, rz, rzB]) => R(y, r, rz, rzB)),
    R(0.11, 0.152, 0.129, 0.127, c.sash), R(0.04, 0.158, 0.132, 0.131, c.sash), R(0.04, 0.15, 0.126, 0.125),
    R(-0.04, 0.152, 0.128, 0.128), R(-0.07, 0.12, 0.1, 0.1), { y: -0.075, r: 0, c: c.dress }];
  // A gentle bust: two soft swells on the front, none at the back.
  const bust = (a: number, _i: number, r: Ring) => 1 + 0.035 * gauss((r.y - 0.315) / 0.06) * gauss((Math.abs(wrap(a)) - 0.5) / 0.32);
  p.loft(bodice, seg, { mod: d.mid ? bust : undefined }, d.ink, { step: 2 });
  // The neck: wider at its base, where it meets the shoulders' slope.
  const neck = loft([{ y: 0.655, r: 0, c: S.skin }, { y: 0.645, r: 0.045, c: S.skin }, { y: 0.6, r: 0.05, c: S.skin }, { y: 0.55, r: 0.058, rz: 0.056, c: S.skin }, { y: 0.52, r: 0.075, rz: 0.062, c: S.skin }, { y: 0.51, r: 0, c: S.skin }], Math.min(10, d.limb));
  p.add(neck, null, trs(0, 0, 0.008));
  neck.dispose();
  if (team === 0) {
    // A scalloped linen collar following the shoulders' slope.
    const col: Ring[] = [{ y: 0.578, r: 0, c: c.collar }, { y: 0.574, r: 0.064, rz: 0.06, c: c.collar }, { y: 0.548, r: 0.13, rz: 0.1, rzB: 0.106, c: c.collar },
      { y: 0.508, r: 0.205, rz: 0.14, rzB: 0.138, c: c.collar }, { y: 0.474, r: 0.238, rz: 0.17, rzB: 0.158, c: c.collar },
      { y: 0.464, r: 0.234, rz: 0.166, rzB: 0.154, c: c.collar }, { y: 0.51, r: 0.16, rz: 0.11, c: c.collar }, { y: 0.54, r: 0.09, c: c.collar }, { y: 0.55, r: 0, c: c.collar }];
    p.loft(col, seg, { mod: d.mid ? (a, i) => (i >= 4 && i <= 5 ? 1 + 0.04 * Math.cos(10 * a) : 1) : undefined }, d.ink);
  } else {
    // The rebozo's shoulders: a capelet with a pale stripe near its edge.
    const k = (y: number, r: number, col: number = c.rebozo): Ring => ({ y, r, rz: r * 0.86, rzB: r * 0.96, z: 0.01, c: col });
    const cape: Ring[] = [{ y: 0.585, r: 0, c: c.rebozo }, k(0.58, 0.07), k(0.555, 0.13), k(0.515, 0.2), k(0.465, 0.245), k(0.41, 0.268), k(0.38, 0.274), k(0.38, 0.275, c.rebozoStripe),
      k(0.36, 0.279, c.rebozoStripe), k(0.36, 0.279), k(0.335, 0.283), k(0.32, 0.275), k(0.34, 0.258), k(0.41, 0.25), k(0.47, 0.218), k(0.53, 0.13), { y: 0.56, r: 0, c: c.rebozo }];
    p.loft(cape, seg, { mod: (a, i) => (i >= 9 && i <= 11 ? 1 + 0.025 * Math.cos(12 * a) : 1) }, d.ink, { step: 2 });
    const fall = new THREE.CatmullRomCurve3([new THREE.Vector3(0.12, 0.57, -0.03), new THREE.Vector3(0.145, 0.45, -0.21), new THREE.Vector3(0.14, 0.3, -0.235), new THREE.Vector3(0.128, 0.1, -0.212)]);
    const bands: Array<[number, number, number]> = [[0, 0.62, c.rebozo], [0.62, 0.67, c.rebozoStripe], [0.67, 0.71, c.rebozoStripe2], [0.71, 0.76, c.rebozoStripe], [0.76, 0.88, c.rebozo], [0.88, 1, c.rebozoStripe]];
    const band: Array<[number, number]> = [[-0.048, 0], [0.048, 0], [0.048, 0.012], [-0.048, 0.012]];
    for (const [t0, t1, colr] of d.mid ? bands : [[0, 0.88, c.rebozo], [0.88, 1, c.rebozoStripe]] as Array<[number, number, number]>) {
      const piece = new THREE.CatmullRomCurve3(Array.from({ length: 5 }, (_, j) => fall.getPoint(t0 + ((t1 - t0) * j) / 4)));
      const g = sweep(piece, new THREE.Vector3(0, 0, -1), band, [colr], Math.max(1, Math.round((t1 - t0) * (d.mid ? 12 : 6))));
      p.add(g, null, undefined, t0 === 0 ? d.inkLimb : 0);
      g.dispose();
    }
  }
  // Team badge on the back: a round patch, then a sun (Sol) or a crescent (Luna).
  const ey = 0.25;
  const [ebx, , ebz] = bodiceAt(ey);
  const lay = (g: THREE.BufferGeometry, lift: number): THREE.BufferGeometry => {
    const pa = g.attributes.position!;
    for (let i = 0; i < pa.count; i++) pa.setZ(i, pa.getZ(i) + ebz * Math.sqrt(Math.max(0, 1 - (pa.getX(i) / ebx) ** 2)) + lift);
    g.computeVertexNormals();
    return g;
  };
  const disc = (r: number, depth: number, seg: number) => { const g = new THREE.CylinderGeometry(r, r, depth, seg); g.deleteAttribute('uv'); g.rotateX(Math.PI / 2); g.translate(0, ey, 0); const n = g.toNonIndexed(); g.dispose(); return n; };
  p.add(lay(disc(0.092, 0.01, d.body), 0), c.patch);
  if (team === 0) {
    const sun: THREE.BufferGeometry[] = [disc(0.041, 0.012, d.small[0])];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const ray = new THREE.CylinderGeometry(0, 0.016, 0.03, 3);
      ray.deleteAttribute('uv');
      ray.scale(1, 1, 0.45);
      ray.applyMatrix4(trs(Math.sin(a) * 0.06, ey + Math.cos(a) * 0.06, 0, 0, 0, -a));
      sun.push(ray.toNonIndexed());
      ray.dispose();
    }
    for (const g of sun) p.add(lay(g, 0.006), c.emblem);
  } else {
    const moon = crescentShape(0.068, 0.01, d.fine ? 8 : 5);
    moon.applyMatrix4(trs(-0.008, ey, -0.006, 0, 0, 0.35));
    const flat = moon.toNonIndexed(); moon.dispose();
    p.add(lay(flat, 0.004), c.emblem);
  }
  if (d.mid) {
    // The sash tied in a bow at the back (it shows from the side at combat range).
    p.add(blob(0.05, 0.032, 0.018, 6, 4), c.sash, trs(-0.042, 0.072, 0.15, 0, 0, -0.35));
    p.add(blob(0.05, 0.032, 0.018, 6, 4), c.sash, trs(0.042, 0.072, 0.15, 0, 0, 0.35));
    p.add(blob(0.018, 0.02, 0.016, 5, 3), c.sash, trs(0, 0.07, 0.153));
    for (const s of [-1, 1]) { const tail = limb(new THREE.Vector3(s * 0.01, 0.06, 0.155), new THREE.Vector3(s * 0.035, -0.04, 0.17), 0.011, 0.008, 5); p.add(tail, c.sash); tail.dispose(); }
  }
  if (d.fine) {
    // A row of embroidered flowers across the blouse front.
    const ey2 = team === 0 ? 0.37 : 0.24;
    const [br, bz] = bodiceAt(ey2);
    for (const x of [-0.11, -0.055, 0, 0.055, 0.11]) {
      const z = -bz * Math.sqrt(1 - (x / br) ** 2) - 0.004;
      p.add(blob(0.013, 0.013, 0.005, 5, 3), x === 0 ? S.blossom2 : c.button, new THREE.Matrix4().compose(new THREE.Vector3(x, ey2 - Math.abs(x) * 0.25, z), new THREE.Quaternion().setFromUnitVectors(NEG_Z, new THREE.Vector3(x / br, 0, z / bz).normalize()), new THREE.Vector3(1, 1, 1)));
    }
  }
}

// ------------------------------------------------------------ arms and hands

/** A gathered puff sleeve over the shoulder end, a cream cuff, then a plump upper arm. */
export function arenaArm(team: Team, q: Quality, d: ArenaDetail, p: Parts): void {
  const c = ROSA_COLORS[team];
  const rings: Ring[] = [{ y: 0.092, r: 0, c: c.dress }, { y: 0.086, r: 0.052, c: c.dress }, { y: 0.064, r: 0.086, c: c.dress }, { y: 0.028, r: 0.098, c: c.dress }, { y: -0.02, r: 0.097, c: c.dress },
    { y: -0.07, r: 0.087, c: c.dress }, { y: -0.106, r: 0.07, c: c.dress }, { y: -0.106, r: 0.072, c: c.button }, { y: -0.14, r: 0.068, c: c.button }, { y: -0.146, r: 0.06, c: c.button },
    { y: -0.146, r: 0.058, c: S.skin }, { y: -0.2, r: 0.06, c: S.skin }, { y: -0.28, r: 0.052, c: S.skin }, { y: -0.335, r: 0.046, c: S.skin }, { y: -0.364, r: 0.032, c: S.skin }, { y: -0.375, r: 0, c: S.skin }];
  const pleats = d.mid ? (a: number, i: number) => (i >= 2 && i <= 6 ? 1 + 0.055 * Math.cos(9 * a) * (i === 6 ? 0.5 : 1) : 1) : undefined;
  p.loft(rings, RES[q].sleeve, { mod: pleats }, d.inkLimb, { step: 2, seg: Math.max(6, d.limb) });
}

/** Forearm: a soft swell below the elbow, a gold bangle at the wrist. */
export function arenaFore(d: ArenaDetail, p: Parts): void {
  const rings: Ring[] = [{ y: 0.05, r: 0, c: S.skin }, { y: 0.04, r: 0.04, c: S.skin }, { y: 0, r: 0.05, c: S.skin }, { y: -0.07, r: 0.055, c: S.skin }, { y: -0.19, r: 0.043, c: S.skin },
    { y: -0.262, r: 0.035, c: S.skin }, { y: -0.262, r: 0.045, c: S.bangle }, { y: -0.298, r: 0.045, c: S.bangle }, { y: -0.298, r: 0.034, c: S.skin }, { y: -0.318, r: 0.029, c: S.skin }, { y: -0.325, r: 0, c: S.skin }];
  p.loft(rings, d.limb, {}, d.inkLimb, { step: 2 });
}

/** Hands a size up (they read at range). Right: a fist on the weapon's heel; left: a relaxed mitten. m places it. */
export function arenaHand(right: boolean, d: ArenaDetail, p: Parts, gripY: number, m = new THREE.Matrix4()): void {
  const [sw, sh] = d.small;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(m);
  if (right) {
    const pm = m.clone().multiply(trs(0, -gripY, 0));
    p.add(blob(0.055, 0.056, 0.053, sw, sh), S.skin, pm, d.inkSmall, d.inkSmall ? blob(0.055, 0.056, 0.053, 6, 4) : undefined);
    const thumb = limb(V(-0.044, -0.03, -0.036), V(-0.014, -0.062, -0.06), 0.019, 0.017, 5);
    p.add(thumb, S.skin, undefined, d.inkSmall);
    thumb.dispose();
  } else {
    const pm = m.clone().multiply(trs(0, -0.06, -0.004, 0, 0, 0.08));
    p.add(blob(0.036, 0.062, 0.05, sw, sh), S.skin, pm, d.inkSmall, d.inkSmall ? blob(0.036, 0.062, 0.05, 6, 4) : undefined);
    const thumb = limb(V(0.026, -0.03, -0.03), V(0.03, -0.072, -0.046), 0.016, 0.014, 5);
    p.add(thumb, S.skin, undefined, d.inkSmall);
    thumb.dispose();
    if (d.mid) {
      // Fingertips curled a little under: a soft ridge at the bottom of the mitten.
      const tips = limb(V(-0.022, -0.112, -0.012), V(0.02, -0.11, -0.018), 0.017, 0.017, 5);
      p.add(tips, S.skin);
      tips.dispose();
    }
  }
}

// ------------------------------------------------------------ the skirt

/** Skirt outline (hips-local y, half-width, half-depth): a bell over the hips, flaring to the hem. */
const SKIRT: Array<[number, number, number]> = [[0.112, 0.138, 0.116], [0.06, 0.15, 0.128], [0.0, 0.192, 0.172], [-0.06, 0.218, 0.204], [-0.14, 0.24, 0.228], [-0.2, 0.251, 0.24], [-0.26, 0.262, 0.252], [-0.32, 0.272, 0.261], [-0.38, 0.282, 0.27]];
const FLOUNCE_Y = -0.44, HEM_Y = -0.555;
/** Fold depth: none at the waist, deepening to the hem (deeper than the campaign skirt's, so the hem's silhouette waves). */
const FOLD = 0.072;
const foldAmp = (y: number): number => FOLD * Math.min(1, Math.max(0, -y / 0.55)) ** 1.3;

/**
 * The skirt: folds deepening to the hem; below the knee a flounce in the
 * team colour, ruffled (High, Medium) and a touch fuller; a cream petticoat
 * edge peeking under it; dark lining inside.
 */
export function arenaHips(team: Team, q: Quality, d: ArenaDetail, p: Parts): void {
  const c = ROSA_COLORS[team];
  const res = RES[q];
  const out: Ring[] = [{ y: 0.112, r: 0, c: S.skirt }, ...SKIRT.map(([y, r, rz]) => ({ y, r, rz, c: S.skirt })),
    { y: FLOUNCE_Y, r: 0.292, rz: 0.279, c: S.skirt }, { y: FLOUNCE_Y, r: 0.293, rz: 0.28, c: c.dress }, { y: -0.5, r: 0.304, rz: 0.291, c: c.dress },
    { y: HEM_Y, r: 0.312, rz: 0.299, c: c.dress }, { y: HEM_Y, r: 0.311, rz: 0.298, c: S.blossom }, { y: HEM_Y - 0.012, r: 0.306, rz: 0.293, c: S.blossom },
    { y: HEM_Y - 0.012, r: 0.296, rz: 0.283, c: S.skirtDeep }, { y: -0.4, r: 0.258, rz: 0.246, c: S.skirtDeep }, { y: -0.3, r: 0, c: S.skirtDeep }];
  const fl = (y: number) => Math.min(1, Math.max(0, (FLOUNCE_Y + 0.005 - y) / 0.06));
  const ruffle = (a: number, y: number) => (res.ruffle ? 0.022 * fl(y) * Math.cos(res.ruffle * a) : 0);
  const mod = (a: number, _i: number, r: Ring) => (1 + foldAmp(r.y) * Math.cos(d.folds * a)) * (1 + ruffle(a, r.y));
  const color = (a: number, _i: number, r: Ring) => (r.c === S.skirt ? lerpHex(S.skirt, S.skirtDeep, Math.max(0, -Math.cos(d.folds * a)) * (foldAmp(r.y) / FOLD) * 0.9) : undefined);
  const g = loft(out, res.skirt, { mod, color });
  // The flounce's ruffles also lift and drop the hem a little: a scalloped edge.
  if (res.ruffle) {
    const pa = g.attributes.position!;
    for (let i = 0; i < pa.count; i++) {
      const y = pa.getY(i);
      if (y > -0.49) continue;
      const a = Math.atan2(pa.getX(i), -pa.getZ(i));
      pa.setY(i, y + 0.008 * Math.cos(res.ruffle * a) * Math.min(1, (-0.49 - y) / 0.06));
    }
    g.computeVertexNormals();
  }
  const hm = (a: number, _i: number, r: Ring) => 1 + foldAmp(r.y) * Math.cos(d.folds * a);
  // The hull: every other ring, without colour-edge duplicates (the outline only needs the silhouette).
  const hullRings = out.filter((r, i) => i === 0 || i === out.length - 1 || (i % 2 === 1 && Math.abs(r.r - out[i - 1]!.r) > 0.002));
  p.add(g, null, undefined, d.ink, d.ink > 0 ? loft(hullRings, d.folds * 2, { mod: hm }) : undefined);
  g.dispose();
  if (d.mid) {
    // Little cream and pink flowers around the flounce, on the fold crests.
    const n = d.fine ? d.folds * 2 : d.folds;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, y = -0.5;
      const k = (1 + foldAmp(y) * Math.cos(d.folds * a)) * (1 + Math.abs(ruffle(a, y))) + 0.014;
      const r = 0.304 * k, rz = 0.291 * k;
      const pos = new THREE.Vector3(Math.sin(a) * r, y, -Math.cos(a) * rz);
      const m = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromUnitVectors(NEG_Z, new THREE.Vector3(Math.sin(a), 0, -Math.cos(a))), new THREE.Vector3(1, 1, 1));
      p.add(blob(0.022, 0.022, 0.006, d.tiny[0], d.tiny[1]), i % 2 ? S.blossom : S.blossom2, m);
      if (d.fine) p.add(blob(0.007, 0.007, 0.004, 4, 3), c.emblem, m.clone().multiply(trs(0, 0, -0.005)));
    }
  }
}
