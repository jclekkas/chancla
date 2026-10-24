// Doña Rosa's model for the shooter: geometry and materials only, built
// around the joints in rosa-rig.ts (rosa-anim.ts poses them). Team Sol
// wears a wide straw sun hat and a marigold dress with a sun on the back;
// Team Luna wears a deep-teal rebozo pulled over her head and a crescent
// moon on the back. Both wear a short-sleeved blouse in the team colour, a
// full dark skirt with a team-colour floral hem, flip-flops, her cat-eye
// glasses and red lips, and the four match ruleros on her hair.
//
// Each rigid joint is one mesh: its pieces lofted or shaped, painted in
// vertex colours and baked together with their ink hulls (rosa-geo.ts),
// drawn with one toon material per avatar (rosa-materials.ts; it carries
// the hit flash). The baked geometry is cached per look (team, quality,
// home) and shared by every avatar, so building a Rosa only allocates her
// material, her roller instances and her bubble material.
import * as THREE from 'three';
import type { Team } from '../../../shared/map';
import type { Quality } from '../settings';
import { OUTLINE, toon } from './materials';
import { markShared } from '../../models/sandal';
import { chanclaModel, fpPesadaGeometry, PESADA_SCALE } from './fp-chancla';
import { sweep } from './fp-geo';
import { RULERO_COLORS, ruleroGeometry } from './ruleros';
import { RIG, type RosaRig } from './rosa-rig';
import { Parts, blob, catEyeFrame, crescentShape, ellipsoidRings, limb, loft, trs, type Ring } from './rosa-geo';
import { ROSA_COLORS, ROSA_SHARED as S, propMaterial, rosaMaterial } from './rosa-materials';

/** The team accent colour (the protection bubble, and anything else that names her team). */
export function teamAccent(team: Team): number { return team === 0 ? 0xf2a33a : 0x36b9c9; }

// Detail per quality. High is the full design; Medium keeps every piece with
// fewer segments and outlines on the large forms only; Low keeps the
// silhouettes, team colours, face and ruleros with the lightest geometry.
interface Detail {
  body: number; skirt: number; folds: number; limb: number; head: [number, number]; small: [number, number]; tiny: [number, number];
  /** Hull widths: large forms (body, head, hat), limbs and shoes, small forms (0: none). */
  ink: number; inkLimb: number; inkSmall: number;
  /** Optional pieces: fine (earrings, embroidery, highlights, toes, bow), mid (hem flowers, blush, temples, pleats). */
  fine: boolean; mid: boolean;
  /** Joints that cast shadows. */
  shadows: ReadonlySet<string>;
  /** Low: the left hand rides on the forearm (one draw fewer); the rollers draw without their outline. */
  lean: boolean;
}
const CASTERS_HIGH = new Set(['hips', 'torso', 'head', 'armL', 'armR', 'foreL', 'foreR', 'legL', 'legR', 'shinL', 'shinR', 'footL', 'footR']);
const CASTERS_MED = new Set(['hips', 'torso', 'head', 'armL', 'armR', 'foreL', 'foreR', 'shinL', 'shinR']);
const DETAIL: Record<Quality, Detail> = {
  high: { body: 18, skirt: 28, folds: 7, limb: 10, head: [16, 11], small: [8, 6], tiny: [6, 4], ink: 0.0085, inkLimb: 0.0085, inkSmall: 0.006, fine: true, mid: true, shadows: CASTERS_HIGH, lean: false },
  medium: { body: 12, skirt: 18, folds: 6, limb: 8, head: [12, 8], small: [6, 5], tiny: [5, 4], ink: 0.0085, inkLimb: 0.0085, inkSmall: 0, fine: false, mid: true, shadows: CASTERS_MED, lean: false },
  low: { body: 8, skirt: 10, folds: 5, limb: 6, head: [9, 6], small: [6, 4], tiny: [4, 3], ink: 0.01, inkLimb: 0, inkSmall: 0, fine: false, mid: false, shadows: new Set(), lean: true },
};

// ------------------------------------------------------------ head frame
// The skull and the hair are ellipsoids in head-local space (the head pivot
// is the top of the neck); the face's features sit on the skull's front and
// the ruleros on the hair.

const SKULL = { c: new THREE.Vector3(0, 0.11, 0), r: new THREE.Vector3(0.142, 0.152, 0.146) };
const HAIR = { c: new THREE.Vector3(0, 0.122, 0.008), r: new THREE.Vector3(0.155, 0.163, 0.158) };
/** The hair cap is tilted back: high on the forehead, low at the nape. */
const HAIR_TILT = 0.583, HAIR_CAP = Math.acos(-0.06);
const NEG_Z = new THREE.Vector3(0, 0, -1), UP = new THREE.Vector3(0, 1, 0);

/** Point and outward normal on an ellipsoid along direction d from its centre. */
function onEllipsoid(e: { c: THREE.Vector3; r: THREE.Vector3 }, d: THREE.Vector3): { p: THREE.Vector3; n: THREE.Vector3 } {
  const u = d.clone().normalize();
  const t = 1 / Math.sqrt((u.x / e.r.x) ** 2 + (u.y / e.r.y) ** 2 + (u.z / e.r.z) ** 2);
  const q = u.multiplyScalar(t);
  const n = new THREE.Vector3(q.x / e.r.x ** 2, q.y / e.r.y ** 2, q.z / e.r.z ** 2).normalize();
  return { p: q.add(e.c), n };
}

/** A frame on the face: at (x, y) on the skull's front, lifted along the normal, -z turned to face out. */
function face(x: number, y: number, lift: number, tilt = 0): THREE.Matrix4 {
  const ny = (y - SKULL.c.y) / SKULL.r.y, nx = x / SKULL.r.x;
  const z = SKULL.c.z - SKULL.r.z * Math.sqrt(Math.max(0.02, 1 - nx * nx - ny * ny));
  const p = new THREE.Vector3(x, y, z);
  const n = new THREE.Vector3(x / SKULL.r.x ** 2, (y - SKULL.c.y) / SKULL.r.y ** 2, (z - SKULL.c.z) / SKULL.r.z ** 2).normalize();
  p.addScaledVector(n, lift);
  const q = new THREE.Quaternion().setFromUnitVectors(NEG_Z, n).multiply(new THREE.Quaternion().setFromAxisAngle(NEG_Z, -tilt));
  return new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
}
const at = (m: THREE.Matrix4): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(m);

const ROLLER_R = 0.034;
/** A roller lying on the hair: along direction d from the hair's centre, its axis as close to `axis` as the scalp allows, sunk a little. */
function onHair(d: THREE.Vector3, axis: THREE.Vector3, r = ROLLER_R, sink = 0.012): THREE.Matrix4 {
  const { p, n } = onEllipsoid(HAIR, d);
  const ax = axis.clone().addScaledVector(n, -axis.dot(n)).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, ax);
  return new THREE.Matrix4().compose(p.addScaledVector(n, r - sink), q, new THREE.Vector3(1, 1, 1));
}

const X = new THREE.Vector3(1, 0, 0);
/** Temple rollers lie along the hairline, rising toward the back (end-on they read as pom-poms). */
const TEMPLE = new THREE.Vector3(0, 0.55, 0.84);
/** The head is drawn a size up (a cartoon's big head), about the neck, still inside its hitbox sphere. */
const HEAD_SCALE = 1.12;
/** Luna's rebozo sits back on her head, so the hair and rollers show at the front and top. */
const HOOD_TILT = trs(0, 0.05, 0.03, 0.16).multiply(trs(0, -0.05, -0.03));
const bigHead = (m: THREE.Matrix4): THREE.Matrix4 => { const p = new THREE.Vector3().setFromMatrixPosition(m).multiplyScalar(HEAD_SCALE); return m.clone().setPosition(p); };

// The four match ruleros (head-local), in roller-index order: two across
// the front hairline, then one at each temple. Under the brim for Sol; for
// Luna all four at the front, out of the rebozo's face opening.
function rulSpots(team: Team): THREE.Matrix4[] {
  const front = [onHair(new THREE.Vector3(-0.3, 0.62, -0.75), X), onHair(new THREE.Vector3(0.3, 0.62, -0.75), X)];
  if (team === 0) return [...front, onHair(new THREE.Vector3(-0.95, 0.42, -0.02), TEMPLE), onHair(new THREE.Vector3(0.95, 0.42, -0.02), TEMPLE)];
  // Luna: two on top of her head ahead of the rebozo's edge, two at the front of the hairline.
  return [onHair(new THREE.Vector3(-0.3, 0.88, -0.38), X), onHair(new THREE.Vector3(0.3, 0.88, -0.38), X), onHair(new THREE.Vector3(-0.55, 0.55, -0.65), new THREE.Vector3(0.6, -0.25, 0.75)), onHair(new THREE.Vector3(0.55, 0.55, -0.65), new THREE.Vector3(0.6, 0.25, -0.75))];
}

// ------------------------------------------------------------ the parts

type Joint = 'hips' | 'torso' | 'head' | 'armL' | 'armR' | 'foreL' | 'foreR' | 'wristL' | 'wristR' | 'legL' | 'legR' | 'shinL' | 'shinR' | 'footL' | 'footR';
type Look = Partial<Record<Joint, THREE.BufferGeometry>> & { tris: number };

const lerpHex = (a: number, b: number, k: number): number => new THREE.Color(a).lerp(new THREE.Color(b), k).getHex();

// Skirt profile (hips-local y, half-width, half-depth).
const SKIRT_OUT: Array<[number, number, number]> = [[0.11, 0.15, 0.125], [0.02, 0.18, 0.155], [-0.07, 0.212, 0.185], [-0.18, 0.24, 0.212], [-0.32, 0.265, 0.238], [-0.46, 0.29, 0.262]];
const foldAmp = (y: number): number => 0.055 * Math.min(1, Math.max(0, -y / 0.55)) ** 1.2;

/** A full dark skirt with restrained folds and a team-colour hem band embroidered with flowers. */
function buildHips(team: Team, d: Detail, p: Parts): void {
  const c = ROSA_COLORS[team];
  const out: Ring[] = [{ y: 0.11, r: 0, c: S.skirt }, ...SKIRT_OUT.map(([y, r, rz]) => ({ y, r, rz, c: S.skirt }))];
  out.push({ y: -0.475, r: 0.293, rz: 0.265, c: S.skirt }, { y: -0.475, r: 0.294, rz: 0.266, c: c.dress }, { y: -0.555, r: 0.305, rz: 0.278, c: c.dress },
    { y: -0.565, r: 0.298, rz: 0.271, c: c.dress }, { y: -0.565, r: 0.285, rz: 0.26, c: S.skirtDeep }, { y: -0.4, r: 0.255, rz: 0.23, c: S.skirtDeep }, { y: -0.3, r: 0, c: S.skirtDeep });
  // Folds: none at the waist, deepening to the hem, the valleys a shade deeper.
  const mod = (a: number, _i: number, r: Ring) => 1 + foldAmp(r.y) * Math.cos(d.folds * a);
  const color = (a: number, _i: number, r: Ring) => (r.c === S.skirt ? lerpHex(S.skirt, S.skirtDeep, Math.max(0, -Math.cos(d.folds * a)) * (foldAmp(r.y) / 0.055) * 0.7) : undefined);
  p.loft(out, d.skirt, { mod, color }, d.ink, { seg: d.folds * 2, step: 2, opts: { mod } });
  if (d.mid) {
    // Little cream and pink flowers around the band, on the fold crests.
    const n = d.fine ? d.folds * 2 : d.folds;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, y = -0.515;
      const k = 1 + foldAmp(y) * Math.cos(d.folds * a) + 0.012;
      const r = 0.3 * k, rz = 0.272 * k;
      const at = new THREE.Vector3(Math.sin(a) * r, y, -Math.cos(a) * rz);
      const m = new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromUnitVectors(NEG_Z, new THREE.Vector3(Math.sin(a), 0, -Math.cos(a))), new THREE.Vector3(1, 1, 1));
      p.add(blob(0.021, 0.021, 0.006, d.tiny[0], d.tiny[1]), i % 2 ? S.blossom : S.blossom2, m);
      if (d.fine) p.add(blob(0.007, 0.007, 0.004, 4, 3), c.emblem, m.clone().multiply(trs(0, 0, -0.005)));
    }
  }
}

/** Back of the bodice (z) across-offset x, for laying the badge on it. */
function bodiceBack(x: number, rx: number, rzB: number): number { return rzB * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2)); }

function buildTorso(team: Team, d: Detail, p: Parts, home: boolean): void {
  const c = ROSA_COLORS[team];
  const R = (y: number, r: number, rz: number, rzB: number, col: number = c.dress): Ring => ({ y, r, rz, rzB, c: col });
  // Bodice: a full bust, a rounded upper back, a sash at the waist.
  const bodice: Ring[] = [
    { y: 0.535, r: 0, c: c.dress }, R(0.515, 0.09, 0.07, 0.08), R(0.47, 0.15, 0.11, 0.125), R(0.41, 0.19, 0.14, 0.16), R(0.34, 0.208, 0.165, 0.172),
    R(0.26, 0.212, 0.178, 0.165), R(0.17, 0.2, 0.165, 0.158), R(0.1, 0.18, 0.146, 0.148),
    R(0.1, 0.186, 0.152, 0.154, c.sash), R(0.035, 0.184, 0.15, 0.152, c.sash), R(0.035, 0.175, 0.142, 0.145),
    R(-0.04, 0.168, 0.138, 0.14), R(-0.07, 0.12, 0.1, 0.1), { y: -0.075, r: 0, c: c.dress },
  ];
  p.loft(bodice, d.body, {}, d.ink, { step: 2 });
  p.add(limb(new THREE.Vector3(0, 0.44, 0.005), new THREE.Vector3(0, 0.64, 0.012), 0.05, 0.047, Math.min(8, d.limb)), S.skin);
  if (team === 0 || home) {
    // A scalloped linen collar over the shoulders.
    const collar: Ring[] = [{ y: 0.556, r: 0, c: c.collar }, { y: 0.55, r: 0.06, c: c.collar }, { y: 0.52, r: 0.125, rz: 0.11, c: c.collar }, { y: 0.47, r: 0.195, rz: 0.15, rzB: 0.16, c: c.collar },
      { y: 0.458, r: 0.192, rz: 0.148, rzB: 0.158, c: c.collar }, { y: 0.49, r: 0.15, rz: 0.12, c: c.collar }, { y: 0.52, r: 0.08, c: c.collar }, { y: 0.53, r: 0, c: c.collar }];
    p.loft(collar, d.body, { mod: d.mid ? (a, i) => (i >= 3 && i <= 4 ? 1 + 0.035 * Math.cos(9 * a) : 1) : undefined }, d.ink);
  } else {
    // The rebozo's shoulders: a capelet with a pale stripe near its edge, the hood (on the head) continuing it.
    const k = (y: number, r: number, col: number = c.rebozo): Ring => ({ y, r, rz: r * 0.86, rzB: r * 0.96, z: 0.01, c: col });
    const cape: Ring[] = [{ y: 0.57, r: 0, c: c.rebozo }, k(0.565, 0.065), k(0.54, 0.12), k(0.5, 0.185), k(0.45, 0.235), k(0.4, 0.262), k(0.37, 0.27), k(0.37, 0.271, c.rebozoStripe),
      k(0.35, 0.275, c.rebozoStripe), k(0.35, 0.275), k(0.325, 0.279), k(0.31, 0.271), k(0.33, 0.256), k(0.4, 0.246), k(0.46, 0.21), k(0.52, 0.12), { y: 0.55, r: 0, c: c.rebozo }];
    p.loft(cape, d.body, { mod: (a, i) => (i >= 9 && i <= 11 ? 1 + 0.02 * Math.cos(12 * a) : 1) }, d.ink, { step: 2 });
    // One end of the rebozo thrown forward over her right shoulder: bands of stripes and a pale fringe.
    const fall = new THREE.CatmullRomCurve3([new THREE.Vector3(0.12, 0.56, -0.03), new THREE.Vector3(0.14, 0.45, -0.2), new THREE.Vector3(0.135, 0.3, -0.225), new THREE.Vector3(0.125, 0.1, -0.205)]);
    const bands: Array<[number, number, number]> = [[0, 0.62, c.rebozo], [0.62, 0.67, c.rebozoStripe], [0.67, 0.71, c.rebozoStripe2], [0.71, 0.76, c.rebozoStripe], [0.76, 0.88, c.rebozo], [0.88, 1, c.rebozoStripe]];
    const band: Array<[number, number]> = [[-0.045, 0], [0.045, 0], [0.045, 0.012], [-0.045, 0.012]];
    for (const [t0, t1, col] of d.mid ? bands : [[0, 0.88, c.rebozo], [0.88, 1, c.rebozoStripe]] as Array<[number, number, number]>) {
      const piece = new THREE.CatmullRomCurve3(Array.from({ length: 5 }, (_, k) => fall.getPoint(t0 + ((t1 - t0) * k) / 4)));
      const g = sweep(piece, new THREE.Vector3(0, 0, -1), band, [col], Math.max(1, Math.round((t1 - t0) * (d.mid ? 12 : 6))));
      p.add(g, null, undefined, t0 === 0 ? d.inkLimb : 0);
      g.dispose();
    }
  }
  // Team badge on the back: a round embroidered patch, then a sun (Sol) or a crescent (Luna) on it.
  const ey = 0.25, ebx = 0.208, ebz = 0.168;
  const lay = (g: THREE.BufferGeometry, lift: number): THREE.BufferGeometry => {
    const pa = g.attributes.position!;
    for (let i = 0; i < pa.count; i++) pa.setZ(i, pa.getZ(i) + bodiceBack(pa.getX(i), ebx, ebz) + lift);
    g.computeVertexNormals();
    return g;
  };
  const disc = (r: number, depth: number, seg: number) => { const g = new THREE.CylinderGeometry(r, r, depth, seg); g.deleteAttribute('uv'); g.rotateX(Math.PI / 2); g.translate(0, ey, 0); const n = g.toNonIndexed(); g.dispose(); return n; };
  p.add(lay(disc(0.095, 0.01, d.body), 0), c.patch);
  if (team === 0 || home) {
    const sun: THREE.BufferGeometry[] = [disc(0.042, 0.012, d.small[0])];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const ray = new THREE.CylinderGeometry(0, 0.016, 0.03, 3);
      ray.deleteAttribute('uv');
      ray.scale(1, 1, 0.45);
      ray.applyMatrix4(trs(Math.sin(a) * 0.062, ey + Math.cos(a) * 0.062, 0, 0, 0, -a));
      sun.push(ray.toNonIndexed());
      ray.dispose();
    }
    for (const g of sun) p.add(lay(g, 0.006), c.emblem);
  } else {
    const moon = crescentShape(0.07, 0.01, d.fine ? 8 : 5);
    moon.applyMatrix4(trs(-0.008, ey, -0.006, 0, 0, 0.35));
    const flat = moon.toNonIndexed(); moon.dispose();
    p.add(lay(flat, 0.004), c.emblem);
  }
  if (d.fine) {
    // A row of embroidered flowers across the blouse front, and the sash tied in a bow at the back.
    const ey2 = team === 0 || home ? 0.36 : 0.24;
    for (const x of [-0.11, -0.055, 0, 0.055, 0.11]) {
      const z = -(team === 0 || home ? 0.168 : 0.18) * Math.sqrt(1 - (x / 0.212) ** 2) - 0.002;
      p.add(blob(0.013, 0.013, 0.005, 5, 3), x === 0 ? S.blossom2 : c.button, new THREE.Matrix4().compose(new THREE.Vector3(x, ey2 - Math.abs(x) * 0.25, z), new THREE.Quaternion().setFromUnitVectors(NEG_Z, new THREE.Vector3(x / 0.212, 0, z / 0.17).normalize()), new THREE.Vector3(1, 1, 1)));
    }
    p.add(blob(0.042, 0.028, 0.016, 5, 4), c.sash, trs(-0.036, 0.075, 0.158, 0, 0, -0.35));
    p.add(blob(0.042, 0.028, 0.016, 5, 4), c.sash, trs(0.036, 0.075, 0.158, 0, 0, 0.35));
    p.add(blob(0.016, 0.018, 0.014, 5, 3), c.sash, trs(0, 0.072, 0.16));
  }
}

function buildHead(team: Team, d: Detail, p: Parts, home: boolean): void {
  const c = ROSA_COLORS[team];
  const [hw, hh] = d.head, [sw, sh] = d.small, [tw, th] = d.tiny;
  // Skull with fuller cheeks: the lower half widens a little to the sides.
  const skull = ellipsoidRings(SKULL.r.x, SKULL.r.y, SKULL.r.z, hh, S.skin, SKULL.c.y);
  const cheeks = (a: number, _i: number, r: Ring) => 1 + 0.07 * Math.min(1, Math.max(0, (SKULL.c.y - r.y) / 0.1)) * Math.abs(Math.sin(a));
  p.loft(skull, hw, { mod: cheeks }, d.ink, { step: 2, opts: { mod: cheeks } });
  // Hair: a cap tilted back (its rim is the hairline), tucked inside the skull below it.
  const hair: Ring[] = [];
  const rows = Math.max(4, Math.round(hh * 0.75));
  for (let k = 0; k <= rows; k++) {
    const t = (k / rows) * HAIR_CAP;
    hair.push({ y: Math.cos(t) * HAIR.r.y, r: Math.sin(t) * HAIR.r.x, rz: Math.sin(t) * HAIR.r.z, c: S.hair });
  }
  hair.push({ y: Math.cos(HAIR_CAP) * HAIR.r.y * 0.78, r: Math.sin(HAIR_CAP) * HAIR.r.x * 0.78, c: S.hair }, { y: -HAIR.r.y * 0.6, r: 0, c: S.hair });
  p.loft(hair, hw, { mod: d.fine ? (a, i) => (i > 1 && i < rows ? 1 + 0.012 * Math.cos(7 * a) : 1) : undefined }, d.ink, { step: 2, m: trs(HAIR.c.x, HAIR.c.y, HAIR.c.z, HAIR_TILT) });
  if (team === 0 || home) p.add(blob(0.07, 0.062, 0.058, sw, sh), S.hair, trs(0, 0.075, 0.165), d.ink, blob(0.07, 0.062, 0.058, 6, 4)); // the low bun (hidden under Luna's hood)
  // Face: nose, ears, eyes behind cat-eye frames, stern brows, a red smirk.
  p.add(blob(0.02, 0.024, 0.022, tw, th), S.skin, face(0, 0.083, 0.006), d.inkSmall, blob(0.02, 0.024, 0.022, 5, 3));
  if (team === 0 || home) {
    for (const s of [-1, 1]) {
      p.add(blob(0.014, 0.028, 0.02, tw, th), S.skin, trs(s * 0.141, 0.098, 0.012, 0, 0, -s * 0.15));
      if (d.fine) { const ring = new THREE.TorusGeometry(0.012, 0.0035, 3, 8); ring.deleteAttribute('uv'); p.add(ring, S.gold, trs(s * 0.148, 0.058, 0.012, 0, Math.PI / 2, 0)); ring.dispose(); }
    }
  }
  for (const s of [-1, 1]) {
    const ex = s * 0.05, ey = 0.125;
    p.add(blob(0.028, 0.021, 0.012, sw, sh), S.eyeWhite, face(ex, ey, 0.002));
    p.add(blob(0.0135, 0.0155, 0.006, tw, th), S.iris, face(ex - s * 0.004, ey - 0.002, 0.0115));
    if (d.fine) p.add(blob(0.0045, 0.0045, 0.002, 4, 3), 0xffffff, face(ex - s * 0.009, ey + 0.005, 0.0172));
    const f = catEyeFrame(s, d.fine ? 3 : 2);
    f.applyMatrix4(face(ex, ey + 0.001, 0.0178).multiply(new THREE.Matrix4().makeScale(1.08, 1.08, 1)));
    p.add(f, S.frames);
    f.dispose();
    // Brows: thick, the inner ends lower (she means business).
    const pts = [face(s * 0.018, 0.168, 0.004), face(s * 0.05, 0.192, 0.004), face(s * 0.09, 0.184, 0.004)].map(at);
    const brow = sweep(new THREE.QuadraticBezierCurve3(pts[0]!, pts[1]!, pts[2]!), new THREE.Vector3(0, 0.15, -1).normalize(), [[-0.009, 0], [0, 0.005], [0.009, 0], [0, -0.002]], [S.hair], d.fine ? 6 : 3);
    p.add(brow, null);
    brow.dispose();
    if (d.mid) p.add(blob(0.021, 0.013, 0.004, tw, th), S.blush, face(s * 0.09, 0.07, 0.001));
  }
  const bridge = limb(at(face(-0.013, 0.128, 0.017)), at(face(0.013, 0.128, 0.017)), 0.004, 0.004, 4);
  p.add(bridge, S.frames);
  bridge.dispose();
  if (d.mid && (team === 0 || home)) {
    for (const s of [-1, 1]) { const t = limb(at(face(s * 0.105, 0.135, 0.01)), new THREE.Vector3(s * 0.142, 0.125, 0.015), 0.0035, 0.0035, 4); p.add(t, S.frames); t.dispose(); }
  }
  p.add(blob(0.032, 0.009, 0.01, tw + 1, th), S.lips, face(0.003, 0.043, 0, 0.1));
  p.add(blob(0.026, 0.01, 0.01, tw + 1, th), S.lips, face(0.002, 0.03, 0, 0.08));

  if (home) return;
  if (team === 0) {
    // Wide straw sun hat, tipped back: woven bands on a soft, wavy brim, a terracotta band and a pink flower.
    const tilt = trs(0, 0.255, 0, 0.1).multiply(trs(0, -0.255, 0));
    const brimY = (r: number) => 0.272 - 0.7 * (r - 0.14) ** 2;
    const top: Ring[] = [{ y: 0.272, r: 0, c: c.straw }];
    const bands = d.mid ? [0.14, 0.19, 0.24, 0.29, 0.34] : [0.14, 0.24, 0.34];
    bands.forEach((r, i) => {
      if (i > 0) top.push({ y: brimY(r), r, c: (i - 1) % 2 === 0 ? c.straw : c.strawDeep });
      top.push({ y: brimY(r), r, c: i % 2 === 0 ? c.straw : c.strawDeep });
    });
    top.push({ y: 0.236, r: 0.352, c: c.straw }, { y: 0.228, r: 0.34, c: c.strawDeep }, { y: 0.248, r: 0.25, c: c.strawDeep }, { y: 0.256, r: 0.14, c: c.strawDeep }, { y: 0.256, r: 0, c: c.strawDeep });
    const wave = d.mid ? (a: number, _i: number, r: Ring) => 1 + 0.03 * Math.cos(5 * a + 0.6) * Math.max(0, (r.r - 0.18) / 0.17) : undefined;
    p.loft(top, d.body + 2, { mod: wave }, d.ink, { seg: Math.round(d.body * 0.7), opts: { mod: wave }, m: tilt });
    const crown: Ring[] = [{ y: 0.37, r: 0, c: c.straw }, { y: 0.367, r: 0.05, c: c.straw }, { y: 0.357, r: 0.105, c: c.straw }, { y: 0.337, r: 0.135, c: c.straw }, { y: 0.31, r: 0.148, c: c.straw },
      { y: 0.31, r: 0.152, c: c.band }, { y: 0.266, r: 0.157, c: c.band }, { y: 0.266, r: 0.154, c: c.straw }, { y: 0.25, r: 0.152, c: c.straw }, { y: 0.25, r: 0, c: c.straw }]
      .map((r) => ({ ...r, rz: r.r * 1.06 }));
    p.loft(crown, d.body - 2, {}, d.ink, { seg: Math.round(d.body * 0.55), m: tilt });
    const fa = 1.05;
    const fm = new THREE.Matrix4().compose(new THREE.Vector3(Math.sin(fa) * 0.16, 0.29, -Math.cos(fa) * 0.168), new THREE.Quaternion().setFromUnitVectors(NEG_Z, new THREE.Vector3(Math.sin(fa), 0.25, -Math.cos(fa)).normalize()), new THREE.Vector3(1, 1, 1));
    fm.premultiply(tilt);
    const petals = d.mid ? 5 : 4;
    for (let i = 0; i < petals; i++) {
      const t = (i / petals) * Math.PI * 2;
      p.add(blob(0.022, 0.014, 0.008, tw, th), c.flower, fm.clone().multiply(trs(Math.cos(t) * 0.02, Math.sin(t) * 0.02, 0, 0, 0, t)));
    }
    p.add(blob(0.011, 0.011, 0.008, tw, th), c.flowerHeart, fm.clone().multiply(trs(0, 0, -0.006)));
  } else {
    // Rebozo over the head: a hood whose front opens around the face (the
    // columns inside the opening fold onto its edges below the forehead),
    // a pale border framing the face and a stripe near the hem.
    const A = 0.95, dA = 0.09, yTop = 0.25;
    const h = (y: number, r0: number, col: number = c.rebozo, r = r0 * 0.95): Ring => ({ y, r, rz: r * 1.05, rzB: r * 1.0, z: y < 0 ? 0.02 : 0, c: col });
    const rings: Ring[] = [
      h(0.315, 0), h(0.31, 0.08), h(0.292, 0.138), h(0.268, 0.178), h(0.255, 0.19), h(0.215, 0.208), h(0.15, 0.214), h(0.08, 0.206), h(0.01, 0.19), h(-0.05, 0.205),
      h(-0.09, 0.222), h(-0.09, 0.222, c.rebozoStripe), h(-0.112, 0.234, c.rebozoStripe), h(-0.112, 0.234), h(-0.13, 0.245),
      h(-0.13, 0.226), h(-0.05, 0.186), h(0.08, 0.185), h(0.215, 0.186), h(0.258, 0.168), h(0.29, 0.13), h(0.302, 0.05), h(0.304, 0),
    ];
    const m = Math.max(8, d.body - 4);
    const span = Math.PI * 2 - 2 * (A + dA + 0.01);
    const angles = [A, A + dA, A + dA + 0.01];
    for (let j = 1; j < m; j++) angles.push(A + dA + 0.01 + (j / m) * span);
    angles.push(Math.PI * 2 - A - dA - 0.01, Math.PI * 2 - A - dA, Math.PI * 2 - A);
    for (const a of d.mid ? [-0.62, -0.2, 0.2, 0.62] : [-0.4, 0.4]) angles.push((a + Math.PI * 2) % (Math.PI * 2));
    angles.sort((a, b) => a - b);
    const wrap = (a: number) => (a > Math.PI ? a - Math.PI * 2 : a);
    const angle = (a: number, _i: number, r: Ring) => { const w = wrap(a); return r.y < yTop && Math.abs(w) < A ? Math.sign(w) * A : a; };
    const skip = (a0: number, a1: number, r0: Ring, r1: Ring) => (r0.y < yTop || r1.y < yTop) && Math.abs(wrap(a0)) < A && Math.abs(wrap(a1)) < A;
    const hullAngles = [A, ...Array.from({ length: 9 }, (_, j) => A + ((j + 1) / 10) * (Math.PI * 2 - 2 * A)), Math.PI * 2 - A, Math.PI * 2 - 0.4, 0.4].sort((a, b) => a - b);
    p.loft(rings, 0, {
      angles, angle, skip,
      // Soft drape folds on the lower hood, none over the crown.
      mod: (a, _i, r) => 1 + 0.035 * Math.max(0, Math.min(1, (0.06 - r.y) / 0.19)) * Math.cos(7 * a),
      color: (a, _i, r) => (r.y < yTop + 0.035 && Math.abs(wrap(a)) < A + dA + 0.005 && r.c === c.rebozo ? c.rebozoStripe : undefined),
    }, d.ink, { step: 2, opts: { angles: hullAngles, angle, skip }, m: HOOD_TILT });
  }
}

function buildArm(team: Team, d: Detail, p: Parts): void {
  const c = ROSA_COLORS[team];
  // A short puffed sleeve (covering the shoulder joint in every pose) with an embroidered band, then the bare arm.
  const rings: Ring[] = [{ y: 0.075, r: 0, c: c.dress }, { y: 0.068, r: 0.045, c: c.dress }, { y: 0.045, r: 0.074, c: c.dress }, { y: 0.005, r: 0.084, c: c.dress }, { y: -0.06, r: 0.08, c: c.dress },
    { y: -0.12, r: 0.072, c: c.dress }, { y: -0.12, r: 0.073, c: c.button }, { y: -0.145, r: 0.069, c: c.button }, { y: -0.155, r: 0.06, c: c.button },
    { y: -0.155, r: 0.05, c: S.skin }, { y: -0.25, r: 0.05, c: S.skin }, { y: -0.33, r: 0.048, c: S.skin }, { y: -0.36, r: 0.03, c: S.skin }, { y: -0.37, r: 0, c: S.skin }];
  p.loft(rings, d.limb, { mod: d.mid ? (a, i) => (i >= 2 && i <= 5 ? 1 + 0.05 * Math.cos(8 * a) : 1) : undefined }, d.inkLimb, { step: 2 });
}

function buildFore(_team: Team, d: Detail, p: Parts): void {
  // Bare forearm; a gold bangle at the wrist hides where the hand turns.
  const rings: Ring[] = [{ y: 0.05, r: 0, c: S.skin }, { y: 0.038, r: 0.036, c: S.skin }, { y: 0, r: 0.05, c: S.skin }, { y: -0.12, r: 0.047, c: S.skin }, { y: -0.27, r: 0.04, c: S.skin },
    { y: -0.27, r: 0.047, c: S.bangle }, { y: -0.3, r: 0.047, c: S.bangle }, { y: -0.3, r: 0.038, c: S.skin }, { y: -0.318, r: 0.03, c: S.skin }, { y: -0.325, r: 0, c: S.skin }];
  p.loft(rings, d.limb, {}, d.inkLimb);
}

/** Right: a fist closed on the weapon's heel. Left: a relaxed mitten, thumb forward. m places it (on the forearm on Low). */
function buildHand(right: boolean, d: Detail, p: Parts, m = new THREE.Matrix4()): void {
  const [sw, sh] = d.small;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(m);
  const thumb = right ? limb(V(-0.04, -0.03, -0.034), V(-0.012, -0.06, -0.056), 0.018, 0.016, 5) : limb(V(0.024, -0.028, -0.028), V(0.027, -0.068, -0.043), 0.015, 0.013, 5);
  const palm = right ? [0.05, 0.052, 0.05] as const : [0.033, 0.058, 0.047] as const;
  const pm = m.clone().multiply(right ? trs(0, -GRIP_Y, 0) : trs(0, -0.058, -0.004, 0, 0, 0.08));
  p.add(blob(palm[0], palm[1], palm[2], sw, sh), S.skin, pm, d.inkSmall, d.inkSmall ? blob(palm[0], palm[1], palm[2], 6, 4) : undefined);
  p.add(thumb, S.skin, undefined, d.inkSmall);
  thumb.dispose();
}

// The thigh and the knee cap are only ever seen under or against the skirt
// (standing, the knee is about 0.1 m above the hem), so they wear the
// skirt's lining colour: a knee that meets the hem in a crouch-walk reads
// as cloth pushed forward, not as a hole in the skirt.
function buildLeg(d: Detail, p: Parts): void {
  const g = limb(new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0, -0.41, 0), 0.072, 0.058, Math.min(8, d.limb));
  p.add(g, S.skirtDeep);
  g.dispose();
}

function buildShin(d: Detail, p: Parts): void {
  const rings: Ring[] = [{ y: 0.045, r: 0, c: S.skirtDeep }, { y: 0.035, r: 0.045, c: S.skirtDeep }, { y: 0, r: 0.058, c: S.skirtDeep }, { y: -0.06, r: 0.06, c: S.skin }, { y: -0.1, r: 0.06, c: S.skin }, { y: -0.2, r: 0.052, c: S.skin }, { y: -0.29, r: 0.043, c: S.skin },
    { y: -0.36, r: 0.039, c: S.skin }, { y: -0.39, r: 0.04, c: S.skin }, { y: -0.408, r: 0, c: S.skin }];
  p.loft(rings, d.limb, {}, d.inkLimb, { step: 2 });
}

/** Her bare foot in a flip-flop: a violet sole with a turquoise footbed, a terracotta V strap, toes (High). */
function buildShoe(_team: Team, d: Detail, p: Parts, right: boolean): void {
  // Lofted along the foot (loft y becomes -z, loft z becomes up): each ring a
  // cross-section, rz its depth below the centre and rzB above.
  const sec = (y: number, w: number, cz: number, down: number, up: number, col: number): Ring => ({ y, r: w, z: cz, rz: down, rzB: up, c: col });
  const toOut = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  const splay = trs(0, 0, 0, 0, right ? -0.08 : 0.08, 0); // toes a touch outwards
  const k = S.skin;
  const foot = [sec(0.15, 0, 0.052, 0, 0, k), sec(0.14, 0.03, 0.052, 0.012, 0.012, k), sec(0.11, 0.044, 0.054, 0.014, 0.016, k), sec(0.06, 0.047, 0.056, 0.016, 0.022, k),
    sec(0.0, 0.043, 0.06, 0.02, 0.03, k), sec(-0.04, 0.04, 0.065, 0.025, 0.035, k), sec(-0.06, 0.032, 0.065, 0.025, 0.03, k), sec(-0.07, 0, 0.065, 0, 0, k)];
  p.loft(foot, d.limb, {}, d.inkLimb, { seg: 6, m: splay.clone().multiply(toOut) });
  const sole = loft([sec(0.178, 0, 0.03, 0, 0, S.flipSole), sec(0.165, 0.035, 0.03, 0.01, 0.01, S.flipSole), sec(0.125, 0.054, 0.03, 0.01, 0.01, S.flipSole), sec(0.07, 0.057, 0.03, 0.01, 0.01, S.flipSole),
    sec(0, 0.05, 0.03, 0.01, 0.01, S.flipSole), sec(-0.05, 0.047, 0.03, 0.01, 0.01, S.flipSole), sec(-0.078, 0, 0.03, 0, 0, S.flipSole)], d.limb, {
    // The top face is the footbed.
    color: (a) => (Math.cos(a) < -0.3 ? S.flipBed : undefined),
  });
  sole.applyMatrix4(toOut);
  p.add(sole, null, splay, d.inkLimb);
  sole.dispose();
  for (const x of [-0.047, 0.047]) {
    const st = limb(new THREE.Vector3(0.006, 0.058, -0.115), new THREE.Vector3(x, 0.046, -0.02), 0.0065, 0.0065, 4);
    p.add(st, S.flipStrap, splay);
    st.dispose();
  }
  if (d.fine) for (let i = 0; i < 4; i++) p.add(blob(0.011, 0.009, 0.012, 4, 3), S.skin, splay.clone().multiply(trs((right ? -1 : 1) * (0.026 - i * 0.017), 0.05 - i * 0.002, -0.143 + i * i * 0.004, 0, 0, 0, i === 0 ? 1.3 : 1)));
}

const SKIRT_PIVOT = 0.08;
const looks = new Map<string, Look>();

function lookFor(team: Team, q: Quality, home: boolean): Look {
  const key = `${team}:${q}:${home ? 1 : 0}`;
  const hit = looks.get(key);
  if (hit) return hit;
  const d = DETAIL[q];
  const look: Look = { tris: 0 };
  const bake = (j: Joint, f: (p: Parts) => void) => {
    const p = new Parts();
    f(p);
    if (p.empty) return;
    look.tris += p.tris;
    const g = p.build();
    markShared(g);
    look[j] = g;
  };
  bake('hips', (p) => buildHips(team, d, p));
  bake('torso', (p) => buildTorso(team, d, p, home));
  bake('head', (p) => buildHead(team, d, p, home));
  look.head!.scale(HEAD_SCALE, HEAD_SCALE, HEAD_SCALE);
  look.head!.computeBoundingSphere();
  bake('armL', (p) => buildArm(team, d, p));
  bake('armR', (p) => buildArm(team, d, p));
  bake('foreL', (p) => { buildFore(team, d, p); if (d.lean) buildHand(false, d, p, trs(0, -RIG.foreArm, 0)); });
  bake('foreR', (p) => buildFore(team, d, p));
  if (!d.lean) bake('wristL', (p) => buildHand(false, d, p));
  bake('wristR', (p) => buildHand(true, d, p));
  bake('legL', (p) => buildLeg(d, p));
  bake('legR', (p) => buildLeg(d, p));
  bake('shinL', (p) => buildShin(d, p));
  bake('shinR', (p) => buildShin(d, p));
  bake('footL', (p) => buildShoe(team, d, p, false));
  bake('footR', (p) => buildShoe(team, d, p, true));
  // The skirt mesh hangs from the waist (the animation may sway it there).
  look.hips!.translate(0, -SKIRT_PIVOT, 0);
  looks.set(key, look);
  return look;
}

// ------------------------------------------------------------ shared props

let curlerGeo: THREE.BufferGeometry[] | null = null;
/** The campaign's six curlers: a roller with its ink and a pale band, a colour per slot. */
function curlerGeometry(i: number): THREE.BufferGeometry {
  if (!curlerGeo) {
    curlerGeo = [0xe9789a, 0x4fb3a9, 0xf2a33a, 0x8a5ab8, 0xf4e6c8, 0xf5c542].map((col) => {
      const p = new Parts();
      const g = limb(new THREE.Vector3(0, -0.045, 0), new THREE.Vector3(0, 0.045, 0), 0.042, 0.042, 10);
      p.add(g, col, undefined, 0.006);
      g.dispose();
      const band = new THREE.TorusGeometry(0.043, 0.006, 4, 10);
      band.deleteAttribute('uv');
      p.add(band, 0xffffff, trs(0, 0, 0, Math.PI / 2));
      band.dispose();
      const out = p.build();
      markShared(out);
      return out;
    });
  }
  return curlerGeo[i]!;
}
// Two rows of three across the crown, plainly visible from any side (directions from the hair's centre).
const CURLER_SPOTS: Array<[number, number, number]> = [[-0.55, 0.75, -0.35], [0, 0.85, -0.5], [0.55, 0.75, -0.35], [-0.55, 0.8, 0.2], [0, 0.95, 0.15], [0.55, 0.8, 0.2]];

// The weapons are held by the heel: its end sits in the middle of the fist
// and the rest runs out past the knuckles (wrist -y), the footbed facing +z
// as before, so the swing's wrist roll still turns the sole toward the travel.
const HOLD_SCALE = 1.15;
/** The fist's centre below the wrist, where the weapon's heel ends. */
const GRIP_Y = 0.058;
const HOLD = new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));

let lowGeo: { chancla: THREE.BufferGeometry; pesada: THREE.BufferGeometry } | null = null;
/**
 * Low quality's weapons: the same chancla and clog in a few hundred
 * triangles (lofted sole, footbed, strap and flower; wooden sole, heel and
 * violet upper), in the lite chancla's frame (toe -z, footbed +y, sole on y = 0).
 */
function lowWeapons(): { chancla: THREE.BufferGeometry; pesada: THREE.BufferGeometry } {
  if (lowGeo) return lowGeo;
  const toOut = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  const plan: Array<[number, number]> = [[0.182, 0], [0.165, 0.045], [0.12, 0.075], [0.06, 0.072], [0, 0.06], [-0.08, 0.055], [-0.135, 0.045], [-0.165, 0]];
  const slab = (k: number, cz: number, h: number, col: number) => { const g = loft(plan.map(([y, w]) => ({ y, r: w * k, z: cz, rz: h, rzB: h, c: col })), 6); g.applyMatrix4(toOut); return g; };
  const c = new Parts();
  for (const g of [slab(1, 0.01, 0.01, 0x4b2a6b), slab(0.94, 0.026, 0.006, 0x4fb3a9)]) { c.add(g, null); g.dispose(); }
  for (const x of [-0.056, 0.056]) { const s = limb(new THREE.Vector3(0.018, 0.058, -0.112), new THREE.Vector3(x, 0.03, 0), 0.006, 0.006, 4); c.add(s, 0xc8553d); s.dispose(); }
  c.add(blob(0.02, 0.008, 0.02, 5, 3), 0xf2a33a, trs(0.018, 0.064, -0.112));
  const pz = new Parts();
  const wood = slab(1.15, 0.03, 0.03, 0x9a6a3e);
  pz.add(wood, null); wood.dispose();
  pz.add(blob(0.07, 0.03, 0.045, 6, 4), 0x5e3b25, trs(0, 0.0, 0.11));
  pz.add(blob(0.085, 0.07, 0.1, 6, 4), 0x6a3a8c, trs(0, 0.06, -0.07));
  lowGeo = { chancla: c.build(), pesada: pz.build() };
  markShared(lowGeo.chancla, lowGeo.pesada);
  return lowGeo;
}

function heldChancla(low: boolean): THREE.Object3D {
  const m = low ? new THREE.Mesh(lowWeapons().chancla, propMaterial()) : chanclaModel();
  m.quaternion.setFromRotationMatrix(HOLD);
  m.scale.setScalar(HOLD_SCALE);
  // Heel (model +z 0.1655) at the top of the fist, the sole centred in its depth.
  m.position.set(0, -GRIP_Y - 0.1655 * HOLD_SCALE, -0.022);
  return m;
}

let pesadaHeld: THREE.BufferGeometry | null = null;
let pesadaLow: THREE.BufferGeometry | null = null;
function heldPesada(low: boolean): THREE.Object3D {
  if (low) {
    if (!pesadaLow) {
      const g = lowWeapons().pesada.clone();
      g.scale(HOLD_SCALE, HOLD_SCALE, HOLD_SCALE);
      g.applyMatrix4(HOLD);
      g.translate(0, -GRIP_Y - 0.03 - 0.165 * HOLD_SCALE, -0.02);
      markShared(g);
      pesadaLow = g;
    }
    return new THREE.Mesh(pesadaLow, propMaterial());
  }
  if (!pesadaHeld) {
    // The first-person clog, already one vertex-coloured mesh (a copy: that one belongs to the view model).
    const g = fpPesadaGeometry().clone();
    const k = HOLD_SCALE / PESADA_SCALE;
    g.scale(k, k, k);
    g.computeBoundingBox();
    const b = g.boundingBox!;
    // Centre the heel's own thickness (not the toe's upper) in the fist.
    const pa = g.attributes.position!;
    let y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < pa.count; i++) if (pa.getZ(i) > b.max.z - 0.06) { y0 = Math.min(y0, pa.getY(i)); y1 = Math.max(y1, pa.getY(i)); }
    g.applyMatrix4(HOLD);
    g.translate(0, -GRIP_Y - 0.03 - b.max.z, -(y0 + y1) / 2); // the clog's heel is wider than the fist: only its back edge goes in
    g.computeBoundingSphere();
    markShared(g);
    pesadaHeld = g;
  }
  return new THREE.Mesh(pesadaHeld, propMaterial());
}

let starGeo: THREE.BufferGeometry | null = null;
function starsGeometry(): THREE.BufferGeometry {
  if (!starGeo) {
    const p = new Parts();
    const o = new THREE.OctahedronGeometry(0.07, 0);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; p.add(o, 0xf7cf4a, trs(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3)); }
    o.dispose();
    starGeo = p.build();
    markShared(starGeo);
  }
  return starGeo;
}
let bubbleGeo: THREE.SphereGeometry | null = null;

/** What the model hands the avatar: the rig, plus the ruleros it carries. */
export interface RosaModel extends RosaRig {
  /** The four match ruleros as one instanced mesh and its outline (null for the campaign look; no outline on Low). */
  rulMesh: THREE.InstancedMesh | null;
  rulOutline: THREE.InstancedMesh | null;
  /** Each roller's head-local placement (instance matrix when shown). */
  rulPlace: THREE.Matrix4[];
  /** Outline scale for a roller instance. */
  rulOutlineScale: number;
  /** The campaign's recoverable curlers (home look only). */
  curlers: THREE.Mesh[];
}

/** Triangles of one look's body (without weapons and ruleros), for tests and the cost notes. */
export function rosaLookTriangles(team: Team, quality: Quality, home = false): number { return lookFor(team, quality, home).tris; }

/**
 * Builds a Rosa. `home`: the campaign look (no hat or hood), so her ruleros
 * show. `quality` sets the detail; team colours, silhouettes, the face and
 * the ruleros stay at every level.
 */
export function buildRosaModel(team: Team, opts: { home?: boolean; quality?: Quality } = {}): RosaModel {
  const q = opts.quality ?? 'high';
  const d = DETAIL[q];
  const home = !!opts.home;
  const look = lookFor(team, q, home);
  const mat = rosaMaterial();
  const G = () => new THREE.Group();
  const root = G(), hips = G(), torso = G(), head = G();
  const armL = G(), armR = G(), foreL = G(), foreR = G(), wristL = G(), wristR = G();
  const legL = G(), legR = G(), shinL = G(), shinR = G(), footL = G(), footR = G();
  const joints: Record<Joint, THREE.Group> = { hips, torso, head, armL, armR, foreL, foreR, wristL, wristR, legL, legR, shinL, shinR, footL, footR };

  // The joint tree at the RIG positions, rest rotation zero.
  root.add(hips);
  hips.position.y = RIG.hipY;
  hips.add(torso);
  head.position.y = RIG.headY;
  torso.add(head);
  for (const [arm, fore, wrist, s] of [[armL, foreL, wristL, -1], [armR, foreR, wristR, 1]] as const) {
    arm.position.set(s * RIG.shoulderX, RIG.shoulderY, 0);
    torso.add(arm);
    fore.position.y = -RIG.upperArm;
    arm.add(fore);
    wrist.position.y = -RIG.foreArm;
    fore.add(wrist);
  }
  for (const [leg, shin, foot, s] of [[legL, shinL, footL, -1], [legR, shinR, footR, 1]] as const) {
    leg.position.set(s * RIG.legX, RIG.legY, 0);
    hips.add(leg);
    shin.position.y = -RIG.thigh;
    leg.add(shin);
    foot.position.y = -RIG.shin;
    shin.add(foot);
  }
  const extras: RosaRig['extras'] = {};
  for (const j of Object.keys(joints) as Joint[]) {
    const g = look[j];
    if (!g) continue;
    const m = new THREE.Mesh(g, mat);
    m.castShadow = d.shadows.has(j);
    m.receiveShadow = q !== 'low';
    if (j === 'hips') { m.position.y = SKIRT_PIVOT; extras.skirt = m; }
    joints[j].add(m);
  }

  const curlers: THREE.Mesh[] = [];
  let rulMesh: THREE.InstancedMesh | null = null, rulOutline: THREE.InstancedMesh | null = null;
  const rulPlace: THREE.Matrix4[] = [];
  if (home) {
    // Six curler slots across the crown, filled as ruleros are recovered.
    CURLER_SPOTS.forEach(([x, y, z], i) => {
      const m = new THREE.Mesh(curlerGeometry(i), mat);
      bigHead(onHair(new THREE.Vector3(x, y, z), X, 0.042, 0.016)).decompose(m.position, m.quaternion, m.scale);
      m.visible = false;
      head.add(m);
      curlers.push(m);
    });
  } else {
    // Four ruleros: the ones a backhand to the face can knock off.
    const spots = rulSpots(team).map(bigHead);
    rulMesh = new THREE.InstancedMesh(ruleroGeometry(), rulMaterial(), spots.length);
    if (!d.lean) rulOutline = new THREE.InstancedMesh(ruleroGeometry(), OUTLINE, spots.length);
    const p = new THREE.Vector3(), r = new THREE.Quaternion(), s = new THREE.Vector3();
    spots.forEach((m, i) => {
      rulPlace.push(m);
      rulMesh!.setMatrixAt(i, m);
      m.decompose(p, r, s);
      rulOutline?.setMatrixAt(i, new THREE.Matrix4().compose(p, r, s.multiplyScalar(1.14)));
      rulMesh!.setColorAt(i, new THREE.Color(RULERO_COLORS[i % RULERO_COLORS.length]!));
    });
    // Bounds would come from the bare geometry, not the instances: never cull (four tiny pieces).
    rulMesh.frustumCulled = false;
    head.add(rulMesh);
    if (rulOutline) { rulOutline.frustumCulled = false; head.add(rulOutline); }
  }

  const std = heldChancla(q === 'low'), heavy = heldPesada(q === 'low');
  std.castShadow = heavy.castShadow = q !== 'low';
  wristR.add(std, heavy);
  const weapons: [THREE.Object3D, THREE.Object3D] = [std, heavy];

  if (!bubbleGeo) { bubbleGeo = new THREE.SphereGeometry(1, 18, 12); markShared(bubbleGeo); }
  const bubble = new THREE.Mesh(bubbleGeo, new THREE.MeshBasicMaterial({ color: teamAccent(team), transparent: true, opacity: 0.18, depthWrite: false }));
  bubble.scale.set(0.6, 1.0, 0.6);
  bubble.position.y = 0.9;
  root.add(bubble);
  const stars = G();
  stars.add(new THREE.Mesh(starsGeometry(), propMaterial()));
  stars.visible = false;
  stars.position.y = 0.45;
  head.add(stars);

  return { root, hips, torso, head, armL, armR, foreL, foreR, wristL, wristR, legL, legR, shinL, shinR, footL, footR, weapons, stars, bubble, flashMats: [mat], extras, rulMesh, rulOutline, rulPlace, rulOutlineScale: 1.14, curlers };
}

let rulMat: THREE.MeshToonMaterial | null = null;
/** One material for every avatar's rollers; the colour comes per instance. */
function rulMaterial(): THREE.MeshToonMaterial {
  if (!rulMat) rulMat = toon(0xffffff, { emissive: 0x1a1010 });
  return rulMat;
}
