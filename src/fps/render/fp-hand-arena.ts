// The sculpted first-person hand for the shooter's arena maps (opt-in: the
// ViewModel's `arena` option and setArena; the campaign keeps fp-hand.ts).
//
// Same rig, frames, wrist point and rest pose as fp-hand.ts, so the swings,
// throws, switch and look lag are untouched; only the surfaces change. Every
// digit is one smooth lofted tube (knuckle, joints and a fleshy pad in one
// contour) instead of capsules, the palm is a single soft mass that narrows
// into the wrist, the thumb rises from a thenar pad and presses its pad on
// the item opposite the fingertips, and the forearm runs on under the
// bangles to the cuff. Nails stay painted into the skin mesh; the bangles,
// cuff and forearm share one mesh with the skin's material.
import * as THREE from 'three';
import { PALETTE } from '../../world/palette';
import { INK, inkHull, merge, painted, profile, trs, tube, vertexToon } from './fp-geo';
import { chanclaGrip, fpChanclaGeometry, fpPesadaGeometry, pesadaGrip, soleEdges } from './fp-chancla';
import { along, FP_REST, wrapPath, type FpPose, type FpRig, type Grip, type GripBuild } from './fp-hand';

const SKIN = PALETTE.skin1;
const NAIL = 0xc0142f;
/** Trim colours lifted a touch: they share the skin material (no warm emissive like the original trim's). */
const CREAM = 0xf8ecd2;
const GOLD = 0xfbcf4c;
const Z = new THREE.Vector3(0, 0, 1);

/** Rest pose: the same as the original hand (the swing pivot and every keyframe depend on it). */
export const FP_REST_ARENA: FpPose = FP_REST;

interface ArenaGripOpts {
  knuckle: number;
  reach: number;
  clear: number;
  forearm: [number, number, number];
  thumb: 'across' | 'along';
  /** How far the top face really is below `yt` (fingertips and thumb rest on it). */
  sink: number;
  /** The item's left and right edges at a given z, where it is not a straight bar (the chancla's outline). */
  edgeAt?: (z: number) => [number, number];
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const TIP = new THREE.Color(0xd8846a);

/** Warms a digit's colour toward its tip (flushed fingertips), in place. */
function flushTip(g: THREE.BufferGeometry, tip: THREE.Vector3, reach: number): THREE.BufferGeometry {
  const p = g.attributes.position!, c = g.attributes.color!;
  const v = new THREE.Vector3(), col = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const k = 1 - THREE.MathUtils.smoothstep(v.fromBufferAttribute(p, i).distanceTo(tip), 0, reach);
    col.setRGB(c.getX(i), c.getY(i), c.getZ(i)).lerp(TIP, 0.55 * k);
    c.setXYZ(i, col.r, col.g, col.b);
  }
  return g;
}

/** A painted nail on the back of a digit's tip: `w` its half-width, `h` the digit's half-thickness there. */
function nail(tip: THREE.Vector3, dir: THREE.Vector3, out: THREE.Vector3, w: number, h: number): THREE.BufferGeometry {
  const side = new THREE.Vector3().crossVectors(dir, out).normalize();
  const up = new THREE.Vector3().crossVectors(side, dir).normalize();
  const np = tip.clone().addScaledVector(dir, -w * 0.15).addScaledVector(up, h * 0.78);
  const g = new THREE.SphereGeometry(1, 7, 4);
  const m = new THREE.Matrix4().makeTranslation(np.x, np.y, np.z).multiply(new THREE.Matrix4().makeBasis(side, up, dir)).multiply(new THREE.Matrix4().makeScale(w * 0.8, w * 0.34, w * 1.0));
  const out2 = painted(g, NAIL, m);
  g.dispose();
  return out2;
}

/**
 * Hand skin round an item cross-section (the phone grip of fp-hand.ts):
 * palm under it, fingers wrapping its left edge with the tips on the top
 * face, thumb up the right edge pressing on the top (or lying along the right
 * face for thick items). Built in the item's frame.
 */
function gripSkin(g0: Grip, opt: ArenaGripOpts): GripBuild {
  const g: Grip = { ...g0, yt: g0.yt - opt.sink };
  const parts: THREE.BufferGeometry[] = [];
  const kx = g.xl + (g.xr - g.xl) * opt.knuckle;
  const py = g.yb - opt.clear - 0.013;
  const forearm = new THREE.Vector3(...opt.forearm).normalize();
  // Same wrist point as the original hand, so the arm and swings line up.
  const w0 = v3(g.xr, py, g.z + 0.006);
  const wrist = w0.clone().addScaledVector(forearm, 0.03);

  // Palm and wrist: one loft from the knuckle line, through the heel of the
  // hand, narrowing and rounding into the wrist past the pivot.
  {
    const K = v3(kx + 0.004, py + 0.0005, g.z + 0.001);
    const M = v3((kx + g.xr) / 2 + 0.004, py, g.z + 0.003);
    // It ends in a ball round the wrist pivot, matching the forearm's, so a
    // wrist flick bends there without a seam or a hump.
    const prof = profile([
      [0, 0.039, 0.0118, 2.7],
      [0.32, 0.0395, 0.0128, 2.6],
      [0.6, 0.0335, 0.0138, 2.4],
      [0.86, 0.0285, 0.0176, 2.1],
      [1, 0.0256, 0.0228, 2],
    ]);
    parts.push(painted(tube([K, M, w0, wrist], prof, { side: Z, radial: 14, steps: 12, capStart: 4, capEnd: 4, capLen: 1 }), SKIN));
  }

  // Fingers: index toward the toe (-Z), pinky toward the heel. Each is one
  // tube through its joints (proximal, middle, distal phalanx), its base
  // buried in the palm so the knuckle rises out of it.
  const fingers = [
    { dz: -0.0285, len: [0.043, 0.027, 0.021], r: 0.0102, k: 0.004 },
    { dz: -0.0093, len: [0.046, 0.0295, 0.022], r: 0.0106, k: 0 },
    { dz: 0.0103, len: [0.043, 0.0275, 0.0212], r: 0.0101, k: 0.003 },
    { dz: 0.0285, len: [0.035, 0.0225, 0.0185], r: 0.0089, k: 0.009 },
  ];
  for (const f of fingers) {
    const o = f.r * 1.08 + opt.clear;
    const z = g.z + f.dz;
    // Round the edge where this finger is (the outline widens toward the toe).
    const xl = opt.edgeAt ? Math.min(g.xl, opt.edgeAt(z + f.dz * 0.2)[0]) : g.xl;
    const path = wrapPath({ ...g, xl }, o, kx + f.k);
    let d = 0;
    const joints = [along(path, 0)];
    for (const l of f.len) { d += l * opt.reach; joints.push(along(path, d)); }
    const j3 = joints.map((v, i) => v3(v.x, v.y, z + f.dz * 0.12 * i));
    const base = v3(j3[0]!.x + 0.014, j3[0]!.y - 0.003, z * 0.85 + g.z * 0.15);
    // The finger follows the wrap closely (the pads conform to the edge),
    // its joints marked by the swellings of the profile.
    const pts = [base];
    const n = Math.max(6, Math.round(d / 0.007));
    for (let i = 0; i <= n; i++) {
      const q = along(path, (d * i) / n);
      pts.push(v3(q.x, q.y, z + f.dz * 0.12 * (3 * i / n)));
    }
    // Arc fractions of the joints, for the knuckle swellings.
    const lens = [base.distanceTo(j3[0]!), ...f.len.map((l) => l * opt.reach)];
    const tot = lens.reduce((a, b) => a + b, 0);
    let acc = 0;
    const at = lens.map((l) => (acc += l) / tot);
    const r = f.r;
    const prof = profile([
      [0, r * 1.14, r * 1.0],
      [at[0]!, r * 1.1, r * 1.04],
      [(at[0]! + at[1]!) / 2, r * 0.97, r * 0.86],
      [at[1]!, r * 1.02, r * 0.93],
      [(at[1]! + at[2]!) / 2, r * 0.92, r * 0.8],
      [at[2]!, r * 0.94, r * 0.84],
      [0.94, r * 0.9, r * 0.78],
      [1, r * 0.82, r * 0.72],
    ]);
    // Knuckle on the back of the hand, where the finger leaves the palm.
    {
      const kb = new THREE.SphereGeometry(1, 10, 6);
      const kp = j3[0]!;
      parts.push(painted(kb, SKIN, trs(kp.x + 0.003, kp.y - r * 0.4, z, 0, 0, 0, r * 1.05, r * 0.82, r * 0.92)));
      kb.dispose();
    }
    parts.push(flushTip(painted(tube(pts, prof, { side: Z, radial: 8, steps: 13, capStart: 2, capEnd: 3, capLen: 0.95 }), SKIN), j3[3]!, 0.03));
    const tip = j3[3]!, dir = tip.clone().sub(j3[2]!).normalize();
    const out = v3(tip.x - THREE.MathUtils.clamp(tip.x, g.xl, g.xr), tip.y - THREE.MathUtils.clamp(tip.y, g.yb, g.yt), 0);
    if (out.lengthSq() < 1e-10) out.set(0, 1, 0);
    out.normalize();
    // Nail face: off the tip toward the back of the finger (away from the item).
    out.addScaledVector(dir, -out.dot(dir)).normalize();
    parts.push(nail(tip, dir, out, r * 0.82, r * 0.72));
  }

  // Thumb: from a thenar pad on the radial (index) side of the heel of the
  // palm, round the right edge, its pad pressed on the top face opposite the
  // fingertips (thin items); for thick items it lies along the right face.
  const zt = g.z - 0.006;
  // The right edge where the thumb rounds it.
  const txr = opt.edgeAt ? Math.max(g.xr, opt.edgeAt(zt - 0.02)[1]) : g.xr;
  const th = opt.thumb === 'across'
    ? [v3(g.xr - 0.004, g.yb - 0.018, zt + 0.004), v3(txr + 0.013, g.yb - 0.008, zt - 0.008), v3(txr + 0.0145, g.yt - 0.006, zt - 0.019), v3(txr + 0.001, g.yt + 0.0118, zt - 0.026), v3(txr - 0.021, g.yt + 0.0098, zt - 0.031)]
    : [v3(g.xr - 0.008, g.yb - 0.016, zt + 0.024), v3(g.xr + 0.009, g.yb - 0.009, zt + 0.018), v3(g.xr + 0.0165, g.yb + 0.016, zt + 0.007), v3(g.xr + 0.0192, g.yb + 0.036, zt - 0.002), v3(g.xr + 0.0118, g.yb + 0.053, zt - 0.008)];
  {
    const thumbSide = opt.thumb === 'across' ? v3(0.3, 0, 1).normalize() : v3(0, 0.25, 1).normalize();
    const prof = profile([
      [0, 0.0162, 0.014],
      [0.3, 0.0146, 0.0132],
      [0.5, 0.0136, 0.0124],
      [0.62, 0.0124, 0.0112],
      [0.75, 0.0129, 0.0112],
      [0.88, 0.012, 0.0096],
      [1, 0.0106, 0.0086],
    ]);
    parts.push(flushTip(painted(tube(th, prof, { side: thumbSide, radial: 9, steps: 13, capStart: 2, capEnd: 3, capLen: 0.95 }), SKIN), th[4]!, 0.03));
    const t3 = th[3]!, t4 = th[4]!;
    const out = opt.thumb === 'across' ? v3(0, 1, 0) : v3(1, 0, 0);
    const dir = t4.clone().sub(t3).normalize();
    out.addScaledVector(dir, -out.dot(dir)).normalize();
    parts.push(nail(t4, dir, out, 0.0102, 0.0088));
  }
  // Thenar pad: the fleshy base of the thumb, bridging palm and thumb.
  const thenar = new THREE.SphereGeometry(1, 12, 8);
  const tp = opt.thumb === 'across' ? [g.xr + 0.004, g.yb - 0.017, zt - 0.002] : [g.xr - 0.002, g.yb - 0.017, zt + 0.02];
  if (opt.thumb === 'across') parts.push(painted(thenar, SKIN, trs(tp[0]!, tp[1]!, tp[2]!, 0, 0.5, 0, 0.0155, 0.011, 0.022)));
  else {
    // Thick items: a long pad along the thumb's metacarpal, filling the
    // hollow between the thumb's base and the heel of the hand.
    const a = th[2]!.clone().sub(th[0]!).normalize();
    const c = th[0]!.clone().lerp(th[2]!, 0.4);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), a);
    parts.push(painted(thenar, SKIN, new THREE.Matrix4().compose(c, q, new THREE.Vector3(0.0135, 0.0135, 0.026))));
  }
  thenar.dispose();

  const skin = merge(parts);
  palmar(skin, g);
  return { skin, wrist, forearm };
}

const PALM = new THREE.Color(0xe2a985);
/**
 * Lighter palm side: where the skin faces the held item and is close to it
 * (palm, finger and thumb pads) it takes the paler palm colour, so the grip
 * reads as pads pressed on the chancla. Nails keep their colour.
 */
function palmar(skin: THREE.BufferGeometry, g: Grip): void {
  const p = skin.attributes.position!, n = skin.attributes.normal!, c = skin.attributes.color!;
  const v = new THREE.Vector3(), nn = new THREE.Vector3(), to = new THREE.Vector3(), col = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    if (c.getY(i) < 0.05) continue; // nail
    v.fromBufferAttribute(p, i);
    nn.fromBufferAttribute(n, i);
    to.set(THREE.MathUtils.clamp(v.x, g.xl, g.xr) - v.x, THREE.MathUtils.clamp(v.y, g.yb, g.yt) - v.y, 0);
    const d = to.length();
    if (d < 1e-6) continue;
    const facing = nn.dot(to.multiplyScalar(1 / d));
    const k = THREE.MathUtils.smoothstep(facing, 0.15, 0.75) * (1 - THREE.MathUtils.smoothstep(d, 0.012, 0.03));
    if (k <= 0) continue;
    col.setRGB(c.getX(i), c.getY(i), c.getZ(i)).lerp(PALM, 0.7 * k);
    c.setXYZ(i, col.r, col.g, col.b);
  }
}

/** La Pesada: the phone grip turned a quarter turn about the item's length, as in fp-hand.ts. */
function sideGrip(g: Grip): GripBuild {
  const t: Grip = { z: g.z, xl: g.yb, xr: g.yt, yb: -g.xr, yt: -g.xl };
  const b = gripSkin(t, { knuckle: 0.34, reach: 1.0, clear: 0.0032, forearm: [0.55, -0.55, 0.62], thumb: 'along', sink: 0 });
  const back = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
  b.skin.applyMatrix4(back);
  b.wrist.applyMatrix4(back);
  b.forearm.applyMatrix4(back);
  return b;
}

let gripCache: { light: GripBuild; heavy: GripBuild } | null = null;
export function arenaGrips(): { light: GripBuild; heavy: GripBuild } {
  if (!gripCache) {
    gripCache = {
      light: gripSkin(chanclaGrip(), { knuckle: 0.42, reach: 1.28, clear: 0.0015, forearm: [0.75, 0.2, 0.6], thumb: 'across', sink: 0.0055, edgeAt: (z) => { const [l, r] = soleEdges(z); return [l - 0.0045, r + 0.0045]; } }),
      heavy: sideGrip(pesadaGrip()),
    };
  }
  return gripCache;
}

let armCache: { sleeve: THREE.BufferGeometry; trim: THREE.BufferGeometry } | null = null;
/** Sleeve (team colour), and one mesh for the forearm, bangles and cuff (skin material, vertex colours). */
export function arenaArm(): { sleeve: THREE.BufferGeometry; trim: THREE.BufferGeometry } {
  if (armCache) return armCache;
  const flat = new THREE.Matrix4().makeScale(1, 0.86, 1);
  // Sleeve: the same extent as the original, with soft folds near the cuff.
  const sl = new THREE.CylinderGeometry(0.068, 0.05, 0.42, 22, 8, true);
  sl.rotateX(Math.PI / 2); sl.translate(0, 0, 0.29);
  {
    const p = sl.attributes.position!;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(y, x), k = THREE.MathUtils.smoothstep(z, 0.15, 0.22) * THREE.MathUtils.smoothstep(0.42 - z, 0, 0.15);
      const s = 1 + (0.035 * Math.sin(a * 3 + z * 18) + 0.02 * Math.sin(a * 5 - z * 31)) * k + 0.03 * Math.sin(((z - 0.08) / 0.42) * Math.PI);
      p.setXY(i, x * s, y * s);
    }
    sl.deleteAttribute('normal');
    sl.computeVertexNormals();
  }
  const sleeve = painted(sl, 0xffffff, flat);
  sl.dispose();

  const trims: THREE.BufferGeometry[] = [];
  // Forearm: on from the wrist pivot under the bangles into the cuff, round
  // where it meets the hand's wrist so a flick bends without a seam.
  const fa = tube([v3(0, 0, 0), v3(0, 0, 0.05), v3(0, 0, 0.12)], profile([[0, 0.0244, 0.0244], [0.3, 0.0278, 0.025], [1, 0.033, 0.029]]), { side: v3(1, 0, 0), radial: 14, steps: 8, capStart: 4, capLen: 1 });
  trims.push(painted(fa, SKIN));
  fa.dispose();
  // Cream cuff: a turned-back band with a rolled lip.
  const cuff = new THREE.CylinderGeometry(0.056, 0.05, 0.045, 22, 1, true);
  cuff.rotateX(Math.PI / 2); cuff.translate(0, 0, 0.09);
  trims.push(painted(cuff, CREAM, flat));
  const lip = new THREE.TorusGeometry(0.0515, 0.0085, 5, 22);
  trims.push(painted(lip.translate(0, 0, 0.068), CREAM, flat));
  cuff.dispose(); lip.dispose();
  // Gold bangles, loose on the wrist and tipped a little, as they hang.
  for (const [z, R, r, tilt] of [[0.03, 0.0322, 0.0047, 0.12], [0.045, 0.0332, 0.0039, -0.08]] as const) {
    const b = new THREE.TorusGeometry(R, r, 6, 20);
    trims.push(painted(b, GOLD, trs(0, -0.0025, z, tilt, 0, 0, 1, 0.84, 1)));
    b.dispose();
  }
  armCache = { sleeve, trim: merge(trims) };
  return armCache;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, hull?: number): THREE.Mesh {
  const me = new THREE.Mesh(g, m);
  if (hull) me.add(new THREE.Mesh(inkHull(g, hull), INK));
  return me;
}

export function buildFpHandArena(): FpRig {
  const root = new THREE.Group();
  const arm = new THREE.Group();
  const hand = new THREE.Group();
  root.add(arm);
  arm.add(hand);
  const skinMat = vertexToon();
  const sleeve = new THREE.MeshToonMaterial({ color: 0xf29a2e, gradientMap: skinMat.gradientMap });
  const itemMat = vertexToon();
  const flowerMat = vertexToon({ emissive: 0x3a1c00 });
  const owned: THREE.BufferGeometry[] = [];
  const track = <T extends THREE.Object3D>(o: T) => { o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh && m.material === INK) owned.push(m.geometry); }); return o; };

  const a = arenaArm();
  arm.add(track(mesh(a.sleeve, sleeve, 0.0032)), track(mesh(a.trim, skinMat, 0.0018)));

  const gb = arenaGrips();
  const c = fpChanclaGeometry();
  const light = new THREE.Group();
  light.add(new THREE.Mesh(c.body, itemMat), new THREE.Mesh(c.flower, flowerMat));
  track(light.children[0]!.add(new THREE.Mesh(inkHull(c.body, 0.0028), INK)));
  const heavy = new THREE.Group();
  heavy.add(track(mesh(fpPesadaGeometry(), itemMat, 0.0032)));

  const gripGroups: THREE.Group[] = [];
  const skins: THREE.Mesh[] = [];
  for (const [i, b, item] of [[0, gb.light, light], [1, gb.heavy, heavy]] as const) {
    const grip = new THREE.Group();
    const inner = new THREE.Group();
    inner.position.copy(b.wrist).multiplyScalar(-1);
    const skin = track(mesh(b.skin, skinMat, 0.0022));
    skins.push(skin);
    inner.add(skin, item);
    grip.add(inner);
    grip.userData.forearm = b.forearm;
    grip.userData.index = i;
    hand.add(grip);
    gripGroups.push(grip);
  }
  root.traverse((o) => { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; });
  return {
    root, arm, hand, grips: [gripGroups[0]!, gripGroups[1]!], items: [light, heavy], skins: [skins[0]!, skins[1]!], sleeve,
    dispose() { for (const g of owned) g.dispose(); for (const m of [skinMat, sleeve, itemMat, flowerMat]) m.dispose(); },
  };
}
