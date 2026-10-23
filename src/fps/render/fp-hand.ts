// Rosa's first-person right hand for the shooter: a rounded palm, fingers
// that wrap the held sole, a thumb pressed on the footbed, red nails, a
// wrist with gold bangles, a cream cuff and a team-coloured sleeve. Each
// material is one merged mesh plus a thin ink hull, so the whole arm costs a
// handful of draw calls. Shooter only (the Arcade hand is src/models/hand.ts).
//
// Hierarchy: root (placed by the view model in camera space) -> arm (wrist
// at the origin, forearm along +Z) -> hand (wrist pivot for the flick) ->
// one grip per weapon, each holding its own item in the item's local frame.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PALETTE } from '../../world/palette';
import { INK, inkHull, merge, painted, segment, trs, vertexToon } from './fp-geo';
import { chanclaGrip, fpChanclaGeometry, fpPesadaGeometry, pesadaGrip } from './fp-chancla';

const SKIN = PALETTE.skin1;
const NAIL = 0xc0142f;

interface Grip { z: number; xl: number; xr: number; yb: number; yt: number }

interface GripOpts {
  /** Where the knuckles sit under the item, as a fraction of its width from the left edge. */
  knuckle: number;
  /** Finger length multiplier. */
  reach: number;
  /** Extra clearance between the hand and the item. */
  clear: number;
  /** Direction from the wrist to the elbow, in the item frame. */
  forearm: [number, number, number];
  /** 'across': the thumb crosses the top face (thin items); 'along': it lies up the right face (thick items). */
  thumb: 'across' | 'along';
}

/**
 * The fingers' path round the grip cross-section: from the knuckles under the
 * item, round its left edge and back over the top face (offset by `o`).
 */
function wrapPath(g: Grip, o: number, kx: number): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [new THREE.Vector2(kx, g.yb - o)];
  const corner = (cx: number, cy: number, a0: number, a1: number) => {
    for (let i = 0; i <= 4; i++) { const a = a0 + ((a1 - a0) * i) / 4; pts.push(new THREE.Vector2(cx + Math.cos(a) * o, cy + Math.sin(a) * o)); }
  };
  corner(g.xl, g.yb, -Math.PI / 2, -Math.PI);
  corner(g.xl, g.yt, Math.PI, Math.PI / 2);
  pts.push(new THREE.Vector2(g.xr, g.yt + o));
  return pts;
}

function along(path: THREE.Vector2[], dist: number): THREE.Vector2 {
  let d = dist;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!, b = path[i + 1]!, l = a.distanceTo(b);
    if (d <= l) return a.clone().lerp(b, d / l);
    d -= l;
  }
  return path[path.length - 1]!.clone();
}

function nailAt(tip: THREE.Vector3, dir: THREE.Vector3, out: THREE.Vector3, r: number): THREE.BufferGeometry {
  const side = new THREE.Vector3().crossVectors(dir, out).normalize();
  const up = new THREE.Vector3().crossVectors(side, dir).normalize();
  const np = tip.clone().addScaledVector(dir, -r * 0.45).addScaledVector(up, r * 0.8);
  const nail = new THREE.SphereGeometry(1, 6, 3);
  const m = new THREE.Matrix4().makeTranslation(np.x, np.y, np.z).multiply(new THREE.Matrix4().makeBasis(side, up, dir)).multiply(new THREE.Matrix4().makeScale(r * 0.82, r * 0.38, r * 0.95));
  const g = painted(nail, NAIL, m);
  nail.dispose();
  return g;
}

export interface GripBuild { skin: THREE.BufferGeometry; wrist: THREE.Vector3; forearm: THREE.Vector3 }

/**
 * Hand skin (with nails) holding an item like a phone: palm under its heel
 * half, fingers curled round the left edge with the tips on the top face,
 * thumb up the right edge and across the top. Built in the item's frame.
 */
function gripSkin(g: Grip, opt: GripOpts): GripBuild {
  const parts: THREE.BufferGeometry[] = [];
  const kx = g.xl + (g.xr - g.xl) * opt.knuckle;
  const palmT = 0.026, palmW = 0.08;
  const px0 = kx - 0.006, px1 = g.xr + 0.016;
  const py = g.yb - opt.clear - palmT / 2;
  const palm = new RoundedBoxGeometry(px1 - px0, palmT, palmW, 2, 0.011);
  parts.push(painted(palm, SKIN, trs((px0 + px1) / 2, py, g.z + 0.004)));
  palm.dispose();

  // Fingers: index toward the toe (-Z), pinky toward the heel.
  const fingers = [
    { dz: -0.029, len: [0.042, 0.027, 0.021], r: 0.0102, k: 0.004 },
    { dz: -0.0095, len: [0.045, 0.029, 0.022], r: 0.0105, k: 0 },
    { dz: 0.0105, len: [0.042, 0.027, 0.021], r: 0.01, k: 0.003 },
    { dz: 0.0295, len: [0.034, 0.022, 0.018], r: 0.0088, k: 0.01 },
  ];
  for (const f of fingers) {
    const o = f.r * 1.15 + opt.clear;
    const path = wrapPath(g, o, kx + f.k);
    const z = g.z + f.dz;
    let d = 0;
    const joints = [along(path, 0)];
    for (const l of f.len) { d += l * opt.reach; joints.push(along(path, d)); }
    const j3 = joints.map((v, i) => new THREE.Vector3(v.x, v.y, z + f.dz * 0.1 * i));
    for (let i = 0; i < 3; i++) {
      const ra = f.r * (1 - i * 0.07), rb = f.r * (1 - (i + 1) * 0.07);
      parts.push(painted(segment(j3[i]!, j3[i + 1]!, ra, rb), SKIN));
    }
    // Knuckle bump where the finger leaves the palm.
    const kb = new THREE.SphereGeometry(f.r * 1.08, 6, 4);
    parts.push(painted(kb, SKIN, trs(j3[0]!.x + 0.002, j3[0]!.y - 0.002, z)));
    kb.dispose();
    const tip = j3[3]!, dir = tip.clone().sub(j3[2]!).normalize();
    // Outward: away from the nearest point of the cross-section.
    const out = new THREE.Vector3(tip.x - THREE.MathUtils.clamp(tip.x, g.xl, g.xr), tip.y - THREE.MathUtils.clamp(tip.y, g.yb, g.yt), 0).normalize();
    parts.push(nailAt(tip, dir, out, f.r * (1 - 3 * 0.07)));
  }

  // Thumb: from the heel of the palm, up the right edge and across the top
  // (thin items), or flat up the right face (thick items).
  const zt = g.z - 0.006;
  const th = opt.thumb === 'across'
    ? [new THREE.Vector3(g.xr + 0.012, g.yb - 0.012, zt + 0.02), new THREE.Vector3(g.xr + 0.014, g.yt - 0.002, zt + 0.002), new THREE.Vector3(g.xr - 0.006, g.yt + 0.0122, zt - 0.014), new THREE.Vector3(g.xr - 0.024, g.yt + 0.0102, zt - 0.024)]
    : [new THREE.Vector3(g.xr + 0.012, g.yb - 0.008, zt + 0.02), new THREE.Vector3(g.xr + 0.0135, g.yb + 0.026, zt + 0.004), new THREE.Vector3(g.xr + 0.0125, g.yb + 0.052, zt - 0.008), new THREE.Vector3(g.xr + 0.0115, g.yb + 0.073, zt - 0.014)];
  const [t0, t1, t2, t3] = th as [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
  parts.push(painted(segment(t0, t1, 0.0155, 0.0128), SKIN));
  parts.push(painted(segment(t1, t2, 0.0128, 0.0118), SKIN));
  parts.push(painted(segment(t2, t3, 0.0118, 0.0108), SKIN));
  parts.push(nailAt(t3, t3.clone().sub(t2).normalize(), opt.thumb === 'across' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0), 0.0108));
  // Fleshy base of the thumb.
  const thenar = new THREE.SphereGeometry(1, 7, 5);
  parts.push(painted(thenar, SKIN, trs(g.xr + 0.006, g.yb - 0.012, zt + 0.018, 0, 0, 0, 0.02, 0.017, 0.026)));
  thenar.dispose();

  // Wrist: an oval column from the heel of the palm toward the elbow.
  const forearm = new THREE.Vector3(...opt.forearm).normalize();
  const w0 = new THREE.Vector3(px1 - 0.016, py, g.z + 0.006);
  const wrist = w0.clone().addScaledVector(forearm, 0.03);
  const w = segment(w0, wrist.clone().addScaledVector(forearm, 0.05), 0.029, 0.03, 10);
  // Flatten across the thickness of the hand.
  const flat = new THREE.Matrix4().makeTranslation(w0.x, w0.y, w0.z)
    .multiply(new THREE.Matrix4().makeScale(1, 0.7, 1))
    .multiply(new THREE.Matrix4().makeTranslation(-w0.x, -w0.y, -w0.z));
  parts.push(painted(w, SKIN, flat));
  w.dispose();

  return { skin: merge(parts), wrist, forearm };
}

/**
 * La Pesada is too thick to wrap: the palm goes on its right side, the
 * thumb lies on the footbed at the heel and the fingers curl under the heel
 * block. Built as the phone grip in a frame turned a quarter turn about the
 * item's length, then turned back.
 */
function sideGrip(g: Grip): GripBuild {
  // Item (x, y) -> turned (y, -x).
  const t: Grip = { z: g.z, xl: g.yb, xr: g.yt, yb: -g.xr, yt: -g.xl };
  const b = gripSkin(t, { knuckle: 0.25, reach: 1.0, clear: 0.002, forearm: [0.55, -0.55, 0.62], thumb: 'along' });
  const back = new THREE.Matrix4().makeRotationZ(Math.PI / 2); // turned (x, y) -> item (-y, x)
  b.skin.applyMatrix4(back);
  b.wrist.applyMatrix4(back);
  b.forearm.applyMatrix4(back);
  return b;
}

let gripCache: { light: GripBuild; heavy: GripBuild } | null = null;
function grips(): { light: GripBuild; heavy: GripBuild } {
  if (!gripCache) {
    gripCache = {
      light: gripSkin(chanclaGrip(), { knuckle: 0.42, reach: 1.2, clear: 0.0015, forearm: [0.75, 0.2, 0.6], thumb: 'across' }),
      heavy: sideGrip(pesadaGrip()),
    };
  }
  return gripCache;
}

let armCache: { sleeve: THREE.BufferGeometry; trim: THREE.BufferGeometry } | null = null;
function armGeometry(): { sleeve: THREE.BufferGeometry; trim: THREE.BufferGeometry } {
  if (armCache) return armCache;
  // Forearm along +Z from the wrist (origin) toward the elbow.
  const along = (g: THREE.BufferGeometry, z: number) => { g.rotateX(Math.PI / 2); g.translate(0, 0, z); return g; };
  const sleeve = new THREE.CylinderGeometry(0.068, 0.05, 0.42, 14, 1, true);
  const sleeveG = painted(along(sleeve, 0.29), 0xffffff, new THREE.Matrix4().makeScale(1, 0.86, 1));
  sleeve.dispose();
  const trims: THREE.BufferGeometry[] = [];
  // Cream cuff: a turned-back band with a rolled lip.
  const cuff = new THREE.CylinderGeometry(0.056, 0.05, 0.045, 14, 1, true);
  trims.push(painted(along(cuff, 0.09), PALETTE.cream, new THREE.Matrix4().makeScale(1, 0.86, 1)));
  const lip = new THREE.TorusGeometry(0.051, 0.0075, 4, 14);
  trims.push(painted(lip.translate(0, 0, 0.068), PALETTE.cream, new THREE.Matrix4().makeScale(1, 0.86, 1)));
  cuff.dispose(); lip.dispose();
  // Two gold bangles round the wrist.
  for (const [z, r] of [[0.034, 0.0055], [0.05, 0.0045]] as const) {
    const b = new THREE.TorusGeometry(0.031, r, 4, 12);
    trims.push(painted(b, PALETTE.gold, new THREE.Matrix4().makeTranslation(0, 0, z).multiply(new THREE.Matrix4().makeScale(1, 0.8, 1))));
    b.dispose();
  }
  armCache = { sleeve: sleeveG, trim: merge(trims) };
  return armCache;
}

export interface FpRig {
  root: THREE.Group;
  arm: THREE.Group;
  hand: THREE.Group;
  /** One grip per weapon (0 light chancla, 1 La Pesada); the item is `items[i]`. */
  grips: [THREE.Group, THREE.Group];
  items: [THREE.Group, THREE.Group];
  /** The hand skin of each grip (squeezed into a fist once the chancla has left). */
  skins: [THREE.Mesh, THREE.Mesh];
  sleeve: THREE.MeshToonMaterial;
  dispose(): void;
}

export interface FpPose {
  /** Direction from the wrist to the elbow, in root space. */
  elbow: [number, number, number];
  /** Where each item's toe points (root space; made perpendicular to the forearm). */
  toe: [[number, number, number], [number, number, number]];
  /** Wrist bend of each grip about its palm normal (tips the toe away from the camera). */
  bend: [number, number];
  /** Extra twist of each grip about the forearm. */
  twist: [number, number];
}

export const FP_REST: FpPose = { elbow: [0.55, -0.5, 0.66], toe: [[-0.75, 1, -0.8], [-0.7, 1, -1.3]], bend: [0, 0], twist: [0, 0] };

function mesh(g: THREE.BufferGeometry, m: THREE.Material, hull?: number): THREE.Mesh {
  const me = new THREE.Mesh(g, m);
  if (hull) { const h = new THREE.Mesh(inkHull(g, hull), INK); me.add(h); }
  return me;
}

export function buildFpHand(): FpRig {
  const root = new THREE.Group();
  const arm = new THREE.Group();
  const hand = new THREE.Group();
  root.add(arm);
  arm.add(hand);
  const skinMat = vertexToon();
  const trimMat = vertexToon({ emissive: 0x140c00 });
  const sleeve = new THREE.MeshToonMaterial({ color: 0xf29a2e, gradientMap: skinMat.gradientMap });
  const itemMat = vertexToon();
  const flowerMat = vertexToon({ emissive: 0x3a1c00 });
  const owned: THREE.BufferGeometry[] = [];
  const track = <T extends THREE.Object3D>(o: T) => { o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh && m.material === INK) owned.push(m.geometry); }); return o; };

  const a = armGeometry();
  arm.add(track(mesh(a.sleeve, sleeve, 0.0032)), track(mesh(a.trim, trimMat)));

  const gb = grips();
  const c = fpChanclaGeometry();
  const light = new THREE.Group();
  light.add(new THREE.Mesh(c.body, itemMat), new THREE.Mesh(c.flower, flowerMat));
  track(light.children[0]!.add(new THREE.Mesh(inkHull(c.body, 0.0028), INK)));
  const heavy = new THREE.Group();
  const pg = fpPesadaGeometry();
  heavy.add(track(mesh(pg, itemMat, 0.0032)));

  const gripGroups: THREE.Group[] = [];
  const skins: THREE.Mesh[] = [];
  for (const [i, b, item] of [[0, gb.light, light], [1, gb.heavy, heavy]] as const) {
    const grip = new THREE.Group();
    const inner = new THREE.Group(); // item frame, shifted so the wrist sits at the grip origin
    inner.position.copy(b.wrist).multiplyScalar(-1);
    const skin = track(mesh(b.skin, skinMat, 0.0024));
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
    dispose() { for (const g of owned) g.dispose(); for (const m of [skinMat, trimMat, sleeve, itemMat, flowerMat]) m.dispose(); },
  };
}

const Z = new THREE.Vector3(0, 0, 1);
function basis(a: THREE.Vector3, b: THREE.Vector3): THREE.Matrix4 {
  const x = a.clone().normalize();
  const y = b.clone().addScaledVector(x, -b.dot(x)).normalize();
  return new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y));
}
/** Places the arm and both grips for a rest pose (called once, and again when tuning). */
export function applyRest(rig: FpRig, pose: FpPose): void {
  const e = new THREE.Vector3(...pose.elbow).normalize();
  rig.arm.quaternion.setFromUnitVectors(Z, e);
  const inv = rig.arm.quaternion.clone().invert();
  for (const grip of rig.grips) {
    const i = grip.userData.index as number;
    const f = grip.userData.forearm as THREE.Vector3;
    // Item frame (forearm, toe) onto arm frame (+Z, wanted toe direction).
    const toe = new THREE.Vector3(...pose.toe[i]!).applyQuaternion(inv);
    const m = basis(Z, toe).multiply(basis(f, new THREE.Vector3(0, 0, -1)).invert());
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const twist = new THREE.Quaternion().setFromAxisAngle(Z, pose.twist[i]!);
    const bend = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pose.bend[i]!);
    grip.quaternion.copy(twist).multiply(q).multiply(bend);
    // Flick axis in hand space: the palm normal (item +X) after the rest rotation.
    grip.userData.flickAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(grip.quaternion).normalize();
  }
}
