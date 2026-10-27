// Rosa's procedural animation, driven by real game timing: locomotion,
// jumps, throws, melee swings, hit reactions, elimination and respawn. It
// only poses the joints in rosa-rig.ts, so it works on any model built to
// that contract. Purely visual: nothing here feeds back into the game.
//
// Locomotion is foot-planted: each foot is pinned to the ground in world
// space while it carries her and steps to a predicted landing spot while it
// swings, with two-bone IK from the hip, so the stride follows the distance
// she really travels (the root's motion, which the engine sets before each
// update) and planted feet do not slide. The gait phase only times the
// steps. Standing, a foot that ends up out of place (a stop, a turn of the
// aim, a stumble) takes a small settling step.
//
// Everything else is layered on with critically damped springs (a lightly
// underdamped one for the comic wobble of a hit), and the rare hard cuts (a
// weapon change mid-action, the pratfall) are blended out by
// inertialization, so the pose never pops. Cloth (the skirt) swings on
// lightly underdamped pendulums, and the face blinks and reacts through the
// material (rosa-materials.ts). Every spring is solved exactly for the
// frame's dt, so the motion is the same at 30, 60 or 144 fps, and all of it
// lives on the instance: reset() (or a teleport) starts her afresh.
import * as THREE from 'three';
import { MELEE, WEAPONS, type WeaponId } from '../../../shared/config';
import { RIG, type AvatarState, type RosaRig } from './rosa-rig';

// Third-person melee: keyframes for the right arm on the attack's own clock,
// in Rosa's body coordinates (she faces -z; her right is +x):
//   ax  shoulder lift (pi/2: the upper arm level, pointing ahead)
//   ay  shoulder sweep about the vertical (+ across to her left, - out to her right)
//   ez  elbow bend across the body (- folds the hand to her left, + to her right)
//   fx  elbow bend up and down
//   wy  wrist roll about the forearm (turns the sandal's sole to face the travel)
//   tw  torso twist (+ shoulders turned to her left)
// The striking phase sits inside the attack's real contact window (config.ts).
export interface ArmKey { t: number; ax: number; ay: number; ez: number; fx: number; wy: number; tw: number }
const REST: Omit<ArmKey, 't'> = { ax: -0.5, ay: 0, ez: 0, fx: -0.6, wy: 0, tw: 0 };
// Where the weapon arm hangs outside an action (idle, walking): the sandal
// held low at her side, elbow softly bent forward. The keys start and end
// at REST and blend from and back to this.
const CARRY = { ax: -0.18, fx: 0.4 };
export const MELEE_KEYS: Record<WeaponId, ArmKey[]> = {
  // El Chanclazo: a quick forehand. The hand is cocked back out to her right,
  // the palm leads across her body to the left, a short follow-through.
  0: [
    { t: 0, ...REST },
    { t: 85, ax: 1.35, ay: -0.85, ez: 0.85, fx: -0.15, wy: 1.2, tw: -0.3 },
    { t: 120, ax: 1.5, ay: -0.45, ez: 0.45, fx: -0.05, wy: 1.4, tw: -0.15 },
    { t: 190, ax: 1.55, ay: 0.55, ez: -0.15, fx: 0, wy: 1.5, tw: 0.25 },
    { t: 320, ax: 1.25, ay: 0.95, ez: -0.45, fx: -0.2, wy: 1.2, tw: 0.35 },
    { t: 700, ...REST },
  ],
  // El Revés: a big backhand. Wind-up: the arm comes across her chest to her
  // left, elbow folded so the hand is at her left shoulder, shoulders turned.
  // Strike (the contact window, 300-390 ms): the arm sweeps out from left to
  // right at face height, the elbow opening, the back of the hand leading and
  // the sole turned to face the way it travels. Follow-through: out to her
  // right, extended; then a natural recovery.
  1: [
    { t: 0, ...REST },
    { t: 150, ax: 1.3, ay: 0.7, ez: -1.0, fx: -0.25, wy: -0.6, tw: 0.3 },
    { t: 285, ax: 1.6, ay: 1.05, ez: -1.5, fx: -0.15, wy: -1.25, tw: 0.6 },
    { t: 300, ax: 1.62, ay: 1.0, ez: -1.45, fx: -0.12, wy: -1.35, tw: 0.58 },
    { t: 345, ax: 1.72, ay: 0.05, ez: -0.35, fx: 0, wy: -1.55, tw: 0.05 },
    { t: 390, ax: 1.7, ay: -0.6, ez: 0.0, fx: 0, wy: -1.55, tw: -0.3 },
    { t: 560, ax: 1.55, ay: -1.35, ez: 0.12, fx: -0.05, wy: -1.3, tw: -0.62 },
    { t: 760, ax: 1.0, ay: -0.95, ez: -0.1, fx: -0.3, wy: -0.6, tw: -0.3 },
    { t: 1100, ...REST },
  ],
};

// The rest of her body during a swing, on the same clock: the hips lead the
// shoulders (the arm keys' tw stays the shoulders' own turn), the weight
// drops into the wind-up and transfers through the strike, and the free
// left arm counterbalances.
//   hy  hips yaw (+ to her left)     hd  hips drop (m)
//   lx  torso lean (- forward)       lz  torso roll (- toward her right)
//   lax left arm lift (+ forward)    lao left arm out to her left    lfx left elbow bend
export interface BodyKey { t: number; hy: number; hd: number; lx: number; lz: number; lax: number; lao: number; lfx: number }
const STILL: Omit<BodyKey, 't'> = { hy: 0, hd: 0, lx: 0, lz: 0, lax: 0, lao: 0, lfx: 0 };
export const MELEE_BODY: Record<WeaponId, BodyKey[]> = {
  0: [
    { t: 0, ...STILL },
    { t: 85, hy: -0.16, hd: 0.03, lx: 0.02, lz: -0.05, lax: 0.45, lao: 0.3, lfx: 0.5 },
    { t: 120, hy: 0.08, hd: 0.04, lx: -0.07, lz: -0.01, lax: 0.15, lao: 0.25, lfx: 0.75 },
    { t: 190, hy: 0.3, hd: 0.035, lx: -0.12, lz: 0.05, lax: -0.35, lao: 0.3, lfx: 0.9 },
    { t: 320, hy: 0.3, hd: 0.025, lx: -0.08, lz: 0.04, lax: -0.3, lao: 0.25, lfx: 0.8 },
    { t: 700, ...STILL },
  ],
  1: [
    { t: 0, ...STILL },
    { t: 150, hy: 0.14, hd: 0.03, lx: 0.03, lz: 0.04, lax: -0.25, lao: 0.45, lfx: 0.9 },
    { t: 285, hy: 0.3, hd: 0.06, lx: 0.05, lz: 0.06, lax: -0.35, lao: 0.55, lfx: 1.0 },
    { t: 300, hy: 0.22, hd: 0.06, lx: 0.02, lz: 0.05, lax: -0.35, lao: 0.6, lfx: 0.95 },
    { t: 345, hy: -0.16, hd: 0.045, lx: -0.06, lz: -0.02, lax: 0.0, lao: 0.75, lfx: 0.6 },
    { t: 390, hy: -0.34, hd: 0.03, lx: -0.1, lz: -0.06, lax: 0.2, lao: 0.85, lfx: 0.5 },
    { t: 560, hy: -0.42, hd: 0.025, lx: -0.08, lz: -0.07, lax: 0.15, lao: 0.6, lfx: 0.6 },
    { t: 760, hy: -0.2, hd: 0.012, lx: -0.03, lz: -0.03, lax: 0.0, lao: 0.3, lfx: 0.5 },
    { t: 1100, ...STILL },
  ],
};

// Throws: the game releases the chancla the moment it is thrown, so there is
// no wind-up to show before it. The arm starts from rest, flicks up beside
// her head (two or three frames of anticipation, read as part of the throw),
// whips over and forward to the release pose along the aim, and follows
// through down and across her body while the hips lead and the left arm
// pulls in. THROW_KEYS times are fractions of the release (90 ms La Chancla,
// 160 ms La Pesada), linear so the whip has an even speed; THROW_AFTER is
// in ms after the release.
interface ThrowKey extends ArmKey, BodyKey {}
const RELEASE: ThrowKey = { t: 1, ax: 1.15, ay: 0.05, ez: 0, fx: 0.1, wy: 0.35, tw: 0.32, hy: 0.2, hd: 0.035, lx: -0.15, lz: 0.03, lax: -0.35, lao: 0.25, lfx: 0.9 };
const THROW_KEYS: ThrowKey[] = [
  { t: 0, ...REST, ...CARRY, ...STILL },
  { t: 0.4, ax: -1.3, ay: -0.2, ez: 0, fx: 1.0, wy: 0, tw: -0.28, hy: -0.12, hd: 0.01, lx: 0.05, lz: -0.03, lax: 0.9, lao: 0.15, lfx: 0.4 },
  RELEASE,
];
const THROW_AFTER: ThrowKey[] = [
  { ...RELEASE, t: 0 },
  { t: 120, ax: 0.55, ay: 0.4, ez: 0, fx: 0.35, wy: 0.2, tw: 0.36, hy: 0.22, hd: 0.03, lx: -0.12, lz: 0.03, lax: -0.3, lao: 0.2, lfx: 0.8 },
];
const ARM_FIELDS = ['ax', 'ay', 'ez', 'fx', 'wy', 'tw'] as const;
const BODY_FIELDS = ['hy', 'hd', 'lx', 'lz', 'lax', 'lao', 'lfx'] as const;
const ALL_FIELDS = [...ARM_FIELDS, ...BODY_FIELDS] as const;

/** Samples keyframes at t into `out` (no allocation). `linear` skips the easing between keys. */
function sampleKeys<K extends { t: number }>(keys: readonly K[], t: number, fields: readonly (keyof K)[], out: K, linear = false): K {
  let a = keys[keys.length - 1]!, b = a, k = 0;
  if (t <= keys[0]!.t) { a = b = keys[0]!; }
  else {
    for (let i = 0; i < keys.length - 1; i++) {
      if (t <= keys[i + 1]!.t) { a = keys[i]!; b = keys[i + 1]!; k = (t - a.t) / Math.max(1e-6, b.t - a.t); break; }
    }
  }
  const e = linear ? k : ease(k);
  for (let fi = 0; fi < fields.length; fi++) { const f = fields[fi]!; (out[f] as number) = (a[f] as number) + ((b[f] as number) - (a[f] as number)) * e; }
  out.t = t;
  return out;
}

/** The arm keys of a swing at `t` ms (the tests check the contact window with it). */
export function meleeArmAt(weapon: WeaponId, t: number): ArmKey {
  return sampleKeys(MELEE_KEYS[weapon], t, ARM_FIELDS, { t: 0, ...REST });
}

// Leg geometry. GROUND is where the model's rest pose puts the ankle: her
// soles meet the paving there. Feet stand a little wider than the hips.
const A = RIG.thigh, B = RIG.shin, REACH = A + B;
const GROUND = RIG.hipY + RIG.legY - REACH;
const STANCE_W = RIG.legX + 0.015;
/** Planted legs never straighten past this (keeps the knee off its lock). */
const SOFT_REACH = REACH * 0.995;
const TOE_OUT = 0.12;
/** Fastest an upper-body joint may turn (rad/s): the throw's own whip is just under it. */
const SLEW = 48;
/** Fastest a swinging leg's joints turn (rad/s): well above a run's own swing. */
const LEG_SLEW = 36;
/** Fastest the feet's pull on the hips lets go (m/s): above the walk's own bob. */
const HIP_RISE = 1.6;

/** A critically damped spring toward a target (exact, so stable at any dt). */
class Spring {
  x = 0; v = 0;
  to(target: number, omega: number, dt: number): number {
    const x0 = this.x - target, j = this.v + omega * x0, e = Math.exp(-omega * dt);
    this.x = target + (x0 + j * dt) * e;
    this.v = (this.v - omega * j * dt) * e;
    return this.x;
  }
  set(x: number): void { this.x = x; this.v = 0; }
}

/** A damped spring with damping ratio z < 1 (a pendulum that overshoots a little), also exact. */
class Pend {
  x = 0; v = 0;
  to(target: number, omega: number, z: number, dt: number): number {
    const wd = omega * Math.sqrt(1 - z * z), x0 = this.x - target, e = Math.exp(-z * omega * dt);
    const c = Math.cos(wd * dt), sn = Math.sin(wd * dt), k = (this.v + z * omega * x0) / wd;
    this.x = target + e * (x0 * c + k * sn);
    this.v = e * (this.v * c - sn * (z * omega * k + wd * x0));
    return this.x;
  }
  set(x: number): void { this.x = x; this.v = 0; }
}

// The hit wobble: lightly underdamped springs resting at zero that take
// velocity kicks (reduced motion: critically damped and smaller).
const WOB_W = 17, WOB_Z = 0.5;
const R_HEADY = 0, R_HEADZ = 1, R_HEADX = 2, R_TORY = 3, R_TORZ = 4, R_TORX = 5, R_ARMS = 6, R_DROP = 7, R_N = 8;

interface Foot {
  side: number; // -1 left, +1 right
  planted: boolean;
  wx: number; wz: number; yaw: number; // world position and yaw (pinned while planted)
  sx: number; sz: number; syaw: number; // where the swing started, relative to her (the swing runs in her frame)
  s: number; q0: number; dur: number; // swing progress; gait phase at lift-off; settling-step duration (0: gait-timed)
  stx: number; stz: number; // a stumble's offset from the rest spot (world)
  lift: number; pitch: number;
  l0: number; p0: number; // a raised heel's lift and pitch at lift-off (the swing carries on from them)
  down: boolean; // the swing has reached its spot
  err: number; // standing: how far out of place it was last frame (1: enough for a settling step)
  yOff: Spring; // a foot set down above the paving settles onto it
  ax: Spring; ay: Spring; az: Spring; // airborne: root-local position
  lx: number; ly: number; lz: number; // root-local result
}

// Output channels: each joint's Euler angles and the hips' height. The raw
// pose is written first, then a decaying inertialization offset is added.
const HY = 0, HRX = 1, HRY = 2, HRZ = 3, TX = 4, TY = 5, TZ = 6, NX = 7, NY = 8, NZ = 9;
const ALX = 10, ALY = 11, ALZ = 12, FLX = 13, FLY = 14, FLZ = 15, WLX = 16, WLY = 17, WLZ = 18;
const ARX = 19, ARY = 20, ARZ = 21, FRX = 22, FRY = 23, FRZ = 24, WRX = 25, WRY = 26, WRZ = 27;
const LLX = 28, LLY = 29, LLZ = 30, SLX = 31, LRX = 32, LRY = 33, LRZ = 34, SRX = 35, CH_N = 36;

let seedCounter = 0;

/** How far a crouch drapes the skirt: forward tilt (rad), side, front-to-back and vertical scale. */
export const CROUCH_SKIRT = { tilt: 0.34, wide: 0.36, deep: 0.72, drop: 0.1 } as const;

export class RosaAnimator {
  private time = 0;
  private readonly seed: number;
  private rm = false;
  private deadT = -1;
  private spawnT = 1;
  private wasAlive = true;
  // Root motion, measured from where the engine put the root.
  private init = false;
  private px = 0; private py = 0; private pz = 0;
  private rootMoved = false;
  private ox = 0; private oz = 0; // walking on the spot (a caller that never moves the root)
  private vx = new Spring(); private vz = new Spring();
  private vy = 0; private airVy = 0;
  private lean = new Spring(); private roll = new Spring();
  // Gait.
  private walking = false;
  private prevSpeed = 0;
  /** The part of this frame since the walk began (a step that starts between frames starts part way in). */
  private walkFrac = 1;
  private gaitIdle = true;
  private splay = 0;
  private bx = 0; private bz = 0; // her ground position this frame (world, plus any walk-on-the-spot offset)
  private gait = new Spring();
  private run = new Spring();
  /** This frame's run weight (0 walk, 1 run), for the swing's lift profile. */
  private runW = 0;
  /** How much of a forward run this is (no heel peel strafing or backpedalling). */
  private heelW = 0;
  private phase = 0;
  private backMode = false;
  private hipWorld = 0; private hipWorldV = 0;
  private hipDef = 0;
  private sideness = new Spring();
  private crouch = new Spring();
  private onGround = true;
  private air = new Spring();
  private tuck = new Spring();
  private squash = new Spring();
  private settleHold = 0;
  private feet: [Foot, Foot];
  // Actions and reactions.
  private prevMelee = 1e9; private prevHit = 1e9;
  private prevWeapon: WeaponId = 0;
  private whiffT = 1e9; private whiffW: WeaponId = 0;
  private sinceReact = 1e9; private sinceHit = 1e9;
  // The startled flinch of a hit: hands up and splayed, leaning away from the blow.
  private flinchT = 1e9; private flinchK = 1; private flinchSide = 0; private flinchDur = 0.42;
  /** How far a flinch leans her back (+1) or forward (-1, a blow from behind). */
  private flinchBack = 1;
  // A thrown chancla's direction (world, unit), told by the engine when the
  // hit is confirmed; the recoil it shapes plays when the hit reaches her
  // (msSinceHit), which can come a little before or after.
  private hitDirX = 0; private hitDirZ = 0; private hitDirAt = -1e9;
  private recoilAt = -1e9; private recoilBack = 1; private recoilSide = 0;
  private wob = new Float64Array(R_N); private wobV = new Float64Array(R_N);
  // The skirt: pitch and roll pendulums, and a lag behind the hips' turn and roll (the swish).
  private extX = new Pend(); private extZ = new Pend();
  private skirtYaw = new Pend(); private skirtRoll = new Pend(); private skirtInit = false;
  // The face: blinks on her own clock, and the expression's springs.
  private blinkAt = 0; private blinkN = 0;
  private lid = new Spring(); private browUp = new Spring(); private browKnit = new Spring();
  private readonly simple: boolean;
  // Inertialization.
  private raw = new Float64Array(CH_N);
  private out = new Float64Array(CH_N);
  private off = new Float64Array(CH_N);
  private offV = new Float64Array(CH_N);
  private offOmega = 20;
  private offActive = false;
  private pendingCapture = 0; // 1: upper body, 2: everything
  private snap = true; // the next pose is shown as is (a fresh start: nothing to blend or slew from)
  // Scratch (no allocation per frame).
  private arm: ThrowKey = { t: 0, ...REST, ...STILL };
  private body: BodyKey = { t: 0, ...STILL };
  private qa = new THREE.Quaternion(); private qb = new THREE.Quaternion();
  private eu = new THREE.Euler();
  private extrasBase: Array<{ o: THREE.Object3D; g: number; skirt: boolean; rx: number; ry: number; rz: number; sx: number; sy: number; sz: number }> = [];

  /**
   * `seed`: the idle's (and the blinks') phase (default: a new one per
   * avatar, so Rosas side by side do not breathe or blink in step).
   * `simple`: lighter secondary motion (Low quality): no skirt swish.
   */
  constructor(private readonly rig: RosaRig, opts: { seed?: number; simple?: boolean } = {}) {
    const seed = opts.seed ?? seedCounter++;
    this.seed = (seed * 2.399) % (Math.PI * 2);
    this.simple = !!opts.simple;
    this.blinkAt = 0.6 + 2 * hash(this.seed, 0);
    const mk = (side: number): Foot => ({
      side, planted: true, wx: 0, wz: 0, yaw: 0, sx: 0, sz: 0, syaw: 0, s: 1, q0: 0, dur: 0, stx: 0, stz: 0, lift: 0, pitch: 0, l0: 0, p0: 0, down: false, err: 0,
      yOff: new Spring(), ax: new Spring(), ay: new Spring(), az: new Spring(), lx: side * STANCE_W, ly: GROUND, lz: 0,
    });
    this.feet = [mk(-1), mk(1)];
    rig.hips.rotation.order = 'YXZ';
    rig.head.rotation.order = 'YXZ';
    rig.armL.rotation.order = 'YXZ';
    rig.armR.rotation.order = 'YXZ'; // the sweep turns about the vertical, outside the arm's lift
    rig.legL.rotation.order = 'YZX'; // the IK: yaw, then out to the side, then forward
    rig.legR.rotation.order = 'YZX';
    const gains = { skirt: 1, shawlTail: 3.2, hatBrim: 0.7, bun: 1.2 } as const;
    for (const key of Object.keys(gains) as Array<keyof typeof gains>) {
      const o = rig.extras[key];
      if (o) this.extrasBase.push({ o, g: gains[key], skirt: key === 'skirt', rx: o.rotation.x, ry: o.rotation.y, rz: o.rotation.z, sx: o.scale.x, sy: o.scale.y, sz: o.scale.z });
    }
    this.out[HY] = RIG.hipY;
  }

  /**
   * A cartoon flinch from a melee hit: the head snaps aside and the upper
   * body twists, with a little wobble. `side`: +1 knocked to her left, -1 to her right.
   * `push` (optional): how much the blow travels toward her back (the blow
   * direction on her facing, reversed: about +0.4 for a swing from in front
   * of her, negative from behind). A blow from behind snaps the head and
   * shoulders forward instead of back; from in front it is as before.
   */
  react(head: boolean, side: number, push = 1): void {
    const sd = side >= 0 ? 1 : -1;
    // The snapshot side of the same blow may have recoiled her already: add less.
    const k = this.sinceHit < 0.25 ? 0.7 : 1;
    const pb = clamp(push / 0.2, -1, 1);
    this.sinceReact = 0;
    this.flinchT = 0; this.flinchK = k * (head ? 1 : 0.75); this.flinchSide = sd; this.flinchDur = head ? 0.46 : 0.38; this.flinchBack = pb;
    if (head) this.kick(k, sd * 13, sd * 7, 6 * pb, sd * 3.5, sd * 2.2, 3.2 * pb, 9, 0.35);
    else this.kick(k, sd * 6, sd * 3, -2, sd * 5, sd * 1.5, -3.5, 6, 0.45);
  }

  /**
   * A confirmed throw hit on her: the direction the chancla travelled
   * (world x, z). Her recoil goes with it: knocked back from in front,
   * forward from behind, twisted aside from the side. Without one (or if it
   * comes late) the recoil is straight back, as before.
   */
  hitFrom(dx: number, dz: number): void {
    const l = Math.hypot(dx, dz);
    if (!(l > 1e-6)) return;
    this.hitDirX = dx / l; this.hitDirZ = dz / l; this.hitDirAt = this.time;
    // The recoil has just played undirected (the hit reached her first): turn it the right way.
    if (this.time - this.recoilAt < 0.15 && this.recoilBack === 1 && this.recoilSide === 0) {
      this.recoil(-1, 1, 0);
      this.aimRecoil();
    }
  }

  /** The recoil of a throw hit, along the last told direction if it is fresh. */
  private aimRecoil(): void {
    let back = 1, side = 0;
    if (this.time - this.hitDirAt < 1) {
      const yaw = this.rig.root.rotation.y, sn = Math.sin(yaw), cs = Math.cos(yaw);
      // Her forward is (-sin, -cos), her left (-cos, sin).
      back = clamp((this.hitDirX * sn + this.hitDirZ * cs) / 0.5, -1, 1);
      side = this.hitDirX * -cs + this.hitDirZ * sn;
      this.hitDirAt = -1e9;
    }
    this.recoil(1, back, side);
  }

  private recoil(k: number, back: number, side: number): void {
    this.kick(k, side * 5, side * 2.5, 5 * back, side * 3, side * 1.2, 4.5 * back, 7, 0.3);
    if (k > 0) { this.recoilAt = this.time; this.recoilBack = back; this.recoilSide = side; this.flinchBack = back; }
  }

  /**
   * Forgets everything carried from earlier frames (pose smoothing, cloth,
   * gait, reactions, the action history): the next update poses her afresh
   * wherever the root is, as a new avatar would. For an avatar reused for
   * another character or moment (a replay, a seek, a new match).
   */
  reset(): void {
    this.deadT = -1; this.spawnT = 1; this.wasAlive = true;
    this.clearMotion();
    this.rootMoved = false; this.ox = this.oz = 0;
    this.prevMelee = this.prevHit = 1e9; this.prevWeapon = 0;
    this.sinceReact = this.sinceHit = 1e9;
    this.blinkAt = this.time + 0.6 + 2 * hash(this.seed, ++this.blinkN);
    this.rig.root.scale.setScalar(1);
  }

  /** The transient motion (shared by reset, respawn and a teleport's restart). */
  private clearMotion(): void {
    this.off.fill(0); this.offV.fill(0); this.offActive = false; this.pendingCapture = 0;
    this.wob.fill(0); this.wobV.fill(0);
    for (const sp of [this.squash, this.crouch, this.air, this.tuck, this.lean, this.roll, this.vx, this.vz, this.gait, this.run, this.sideness, this.lid, this.browUp, this.browKnit]) sp.set(0);
    this.clearCloth();
    this.whiffT = 1e9; this.flinchT = 1e9; this.flinchBack = 1;
    this.hitDirAt = this.recoilAt = -1e9;
    this.vy = this.airVy = 0;
    this.walking = false; this.prevSpeed = 0; this.walkFrac = 1; this.backMode = false; this.phase = 0; this.settleHold = 0;
    this.onGround = true;
    this.init = false; // planted afresh wherever she appears
    this.snap = true;
  }

  private clearCloth(): void {
    this.extX.set(0); this.extZ.set(0); this.skirtInit = false;
    this.hipDef = 0;
  }

  /** A confirmed miss: a short off-balance overrun of the follow-through. */
  whiff(weapon: WeaponId): void {
    this.whiffT = 0;
    this.whiffW = weapon;
  }

  private kick(k: number, hy: number, hz: number, hx: number, ty: number, tz: number, tx: number, arms: number, drop: number): void {
    const m = k * (this.rm ? 0.45 : 1), v = this.wobV;
    v[R_HEADY] = v[R_HEADY]! + hy * m; v[R_HEADZ] = v[R_HEADZ]! + hz * m; v[R_HEADX] = v[R_HEADX]! + hx * m;
    v[R_TORY] = v[R_TORY]! + ty * m; v[R_TORZ] = v[R_TORZ]! + tz * m; v[R_TORX] = v[R_TORX]! + tx * m;
    v[R_ARMS] = v[R_ARMS]! + arms * m; v[R_DROP] = v[R_DROP]! + drop * m;
    this.extX.v += tx * 0.5 * m; this.extZ.v += tz * 0.8 * m;
  }

  update(s: AvatarState, dt: number, reducedMotion: boolean): void {
    const r = this.rig;
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.time += dt;
    const rm = this.rm = reducedMotion;
    // Death and respawn transitions.
    if (this.wasAlive && !s.alive) { this.deadT = 0; this.capture(14, false); }
    if (!this.wasAlive && s.alive) { this.deadT = -1; this.spawnT = 0; this.respawn(); }
    this.wasAlive = s.alive;
    r.root.visible = true;
    this.stepOffsets(dt);
    this.stepWobble(dt);
    if (this.deadT >= 0) { this.deadT += dt; this.pratfall(dt, rm); this.trackRoot(dt, null); return; }
    r.stars.visible = false;

    // ---- Root motion ----
    this.trackRoot(dt, s);
    this.bx = r.root.position.x + this.ox; this.bz = r.root.position.z + this.oz;
    const yaw = r.root.rotation.y, sin = Math.sin(yaw), cos = Math.cos(yaw);
    const vxw = this.vx.x, vzw = this.vz.x;
    const speed = Math.hypot(vxw, vzw);
    const vF = -(vxw * sin + vzw * cos), vR = vxw * cos - vzw * sin;
    // The velocity springs' rate of change is her acceleration.
    const aF = -(this.vx.v * sin + this.vz.v * cos), aR = this.vx.v * cos - this.vz.v * sin;

    // ---- Ground, air, crouch ----
    if (this.onGround && !s.onGround) this.takeOff();
    if (!this.onGround && s.onGround) this.land(Math.max(0, -this.airVy), rm);
    this.onGround = s.onGround;
    if (!s.onGround) this.airVy = this.vy;
    const cr = this.crouch.to(s.crouched ? 1 : 0, 16, dt);
    const airW = this.air.to(s.onGround ? 0 : 1, 14, dt);
    const wasWalking = this.walking;
    this.walking = s.onGround && (this.walking ? speed > 0.2 : speed > 0.35);
    this.walkFrac = !wasWalking && this.walking ? clamp((speed - 0.35) / Math.max(1e-6, speed - this.prevSpeed), 0, 1) : 1;
    this.prevSpeed = speed;
    const gw = this.gait.to(this.walking ? Math.min(1, speed / 1.2) : 0, 9, dt);
    const run = this.runW = this.run.to(clamp((speed - 2.2) / 2.8, 0, 1) * (1 - cr), 6, dt);

    // Motion direction and the pelvis. Strafing turns the hips (and the
    // stride) part way toward the motion while the shoulders and head stay
    // on the aim; going backwards keeps the hips forward and steps back.
    let hipRel = 0;
    if (this.walking) {
      const alpha = Math.atan2(vR, vF); // 0 ahead, +pi/2 to her right
      const aa = Math.abs(alpha);
      if (this.backMode ? aa < Math.PI / 2 - 0.3 : aa > Math.PI / 2 + 0.3) this.backMode = !this.backMode;
      const a2 = this.backMode ? alpha - Math.sign(alpha) * Math.PI : alpha;
      hipRel = clamp(-a2 * 0.6, -0.8, 0.8);
    }
    // The pelvis's world yaw follows with a lag: a quick turn of the aim
    // turns the shoulders first, the hips follow and the feet step after.
    {
      const target = yaw + hipRel, om = this.walking ? 11 : 7;
      const x0 = wrapAngle(this.hipWorld - target), j = this.hipWorldV + om * x0, e = Math.exp(-om * dt);
      this.hipWorldV = (this.hipWorldV - om * j * dt) * e;
      let rel = wrapAngle(target + (x0 + j * dt) * e - yaw);
      if (Math.abs(rel) > 1) { rel = Math.sign(rel); this.hipWorldV = 0; }
      this.hipWorld = yaw + rel;
    }
    const hipYawLoco = wrapAngle(this.hipWorld - yaw);
    // How sideways the motion runs to the pelvis: narrower strides, a wider stance (no crossed feet).
    const side = this.sideness.to(this.walking ? Math.abs(Math.sin(Math.atan2(vR, vF) + hipYawLoco)) : 0, 8, dt);

    // Gait from speed: the stride (two steps) grows with speed, and each
    // foot's share on the ground shrinks into a run. Matched to her 0.83 m
    // legs: about 2.6 to 3 steps a second at 1.5 m/s and 4.3 to 4.7 at the game's 6 m/s
    // run (2.8 m strides with a flight phase; never more than 2.6 strides a
    // second); the earlier 6 steps a second in the run read as a patter, the
    // feet out of step with the ground going by. Crouched she keeps short
    // quick steps (at most 3.3 strides a second): longer ones push the
    // knees out through the skirt.
    const dirK = (1 - 0.3 * side) * (this.backMode ? 0.8 : 1);
    const Dstand = Math.max((0.62 + 0.36 * speed) * dirK, speed / 2.6), Dcrouch = Math.max((0.55 + 0.27 * speed) * 0.7 * dirK, speed / 3.3);
    const D = Dstand + (Dcrouch - Dstand) * cr;
    const beta = clamp((0.56 + 0.04 * Math.min(speed, 2) * (1 - cr) + 0.15 * cr) / D, 0.3 - 0.04 * run, 0.64);
    const E = beta * D;
    const freq = Math.max(speed / D, 1.1);
    const W = STANCE_W + 0.04 * cr + 0.07 * side;
    this.heelW = run * (1 - side) * (this.backMode ? 0 : 1);
    // Running, the heel kicks up higher behind her (still under the hem's swing).
    const H = (Math.min(0.17, 0.06 + 0.02 * speed) + 0.04 * run) * (1 - 0.7 * cr); // crouched: short, low steps that stay under the skirt

    // ---- Actions, each on its own clock ----
    const def = WEAPONS[s.weapon]!, mdef = MELEE[s.weapon]!;
    const tm = s.msSinceMelee ?? 1e9, tThrow = s.msSinceThrow;
    if (s.weapon !== this.prevWeapon && (tm < mdef.cycleMs || tThrow < def.cooldownMs)) this.capture(22, true);
    this.prevWeapon = s.weapon;
    if (tm < this.prevMelee - 30 && tm < mdef.cycleMs) this.whiffT = 1e9; // a new swing ends an overrun
    this.prevMelee = tm;
    if (s.msSinceHit < this.prevHit - 30 && s.msSinceHit < 300) {
      // A hit (a throw, or the snapshot side of a melee blow): a recoil back,
      // unless react() already gave this blow its own.
      if (this.sinceReact > 0.25) {
        this.aimRecoil();
        // On the hit's own clock (it may have landed between frames).
        this.flinchT = clamp(s.msSinceHit / 1000, 0, dt) - dt; this.flinchK = 0.55; this.flinchSide = 0; this.flinchDur = 0.34;
      }
      this.sinceHit = 0;
    }
    this.prevHit = s.msSinceHit;
    this.sinceReact += dt; this.sinceHit += dt;
    const swinging = tm < mdef.cycleMs;
    const throwing = !swinging && tThrow < def.cooldownMs;
    const mAmp = rm ? 0.6 : 1; // reduced motion: the same action, smaller (closer to rest)
    const arm = this.arm, body = this.body;
    let act = 0; // weight of the action over the arms' locomotion pose
    if (swinging) {
      sampleKeys(MELEE_KEYS[s.weapon], tm, ARM_FIELDS, arm);
      sampleKeys(MELEE_BODY[s.weapon], tm, BODY_FIELDS, body);
      act = smooth(tm / 45) * (1 - smooth((tm - mdef.cycleMs * 0.75) / (mdef.cycleMs * 0.25)));
    } else if (throwing) {
      const rel = s.weapon === 1 ? 160 : 90, end = def.cooldownMs * 0.6;
      if (tThrow < rel) sampleKeys(THROW_KEYS, tThrow / rel, ALL_FIELDS, arm, true);
      else if (tThrow < rel + 120) sampleKeys(THROW_AFTER, tThrow - rel, ALL_FIELDS, arm);
      else {
        // Back to rest by 60% of the cooldown.
        const k = ease(Math.min(1, (tThrow - rel - 120) / Math.max(1, end - rel - 120))), from = THROW_AFTER[1]!;
        for (let fi = 0; fi < ARM_FIELDS.length; fi++) { const f = ARM_FIELDS[fi]!; arm[f] = from[f] + (REST[f] - from[f]) * k; }
        for (let fi = 0; fi < BODY_FIELDS.length; fi++) { const f = BODY_FIELDS[fi]!; arm[f] = from[f] * (1 - k); }
      }
      const big = s.weapon === 1 ? 1.15 : 1; // La Pesada: more body in it
      for (let fi = 0; fi < BODY_FIELDS.length; fi++) { const f = BODY_FIELDS[fi]!; body[f] = arm[f] * big; }
      // The release follows the aim up or down.
      arm.ax += s.pitch * 0.8 * Math.sin(Math.PI * Math.min(1, tThrow / (rel + 200)));
      act = smooth(tThrow / 50) * (1 - smooth((tThrow - end * 0.75) / (end * 0.25)));
    } else {
      for (let fi = 0; fi < BODY_FIELDS.length; fi++) { const f = BODY_FIELDS[fi]!; body[f] = 0; }
    }
    // A miss: the follow-through overruns, off balance, then she recovers.
    let wf = 0;
    if (this.whiffT < 5) {
      const t0 = this.whiffT;
      this.whiffT += dt;
      const t = this.whiffT, dur = this.whiffW === 1 ? 0.62 : 0.4;
      wf = t < 0.07 ? smooth(t / 0.07) : 1 - smooth((t - 0.07) / (dur - 0.07));
      if (t >= dur) { wf = 0; this.whiffT = 1e9; }
      wf *= rm ? 0.6 : 1;
      if (t0 < 0.06 && t >= 0.06 && !this.walking && s.onGround) this.stumble(this.whiffW);
    }
    let fl = 0;
    if (this.flinchT < 5) {
      this.flinchT += dt;
      const t = this.flinchT, d = this.flinchDur;
      fl = t < 0.05 ? smooth(t / 0.05) : t < 0.13 ? 1 : 1 - smooth((t - 0.13) / (d - 0.13));
      if (t >= d) { fl = 0; this.flinchT = 1e9; }
      fl *= this.flinchK * (rm ? 0.45 : 1);
    }
    const fs = this.flinchSide;
    // ---- Face: blinks; a narrowed, knitted look of effort through a swing or
    // a throw's wind-up; eyes squeezed shut and brows up when she is hit.
    if (r.face) {
      let effort = 0;
      if (swinging) { const c1 = mdef.windupMs + mdef.activeMs; effort = tm < c1 ? smooth(tm / 70) : 1 - smooth((tm - c1) / 220); }
      else if (throwing) effort = 0.8 * (1 - smooth(tThrow / 260));
      const wince = Math.min(1, fl * 1.5), fk = rm ? 0.7 : 1;
      const lid = this.lid.to((0.3 * effort + 0.62 * wince) * fk, 32, dt);
      const up = this.browUp.to((0.007 * wince - 0.0025 * effort) * fk, 26, dt);
      const knit = this.browKnit.to((0.9 * effort + 0.35 * wince) * fk, 26, dt);
      r.face.set(Math.min(1, Math.max(this.blink(), lid)), up, knit, 0);
    }
    const wsgn = this.whiffW === 1 ? -1 : 1; // the Revés overruns to her right, the Chanclazo to her left
    const bodyW = swinging || throwing ? 1 - 0.4 * gw : 0;

    // ---- Feet ----
    const bx = this.bx, bz = this.bz;
    const sc = Math.max(0.05, r.root.scale.x);
    if (s.onGround) this.stepFeet(dt, bx, bz, speed, vxw, vzw, beta, E, freq, W, H, rm);
    else this.airFeet(dt, speed, airW);
    const ft = this.feet;
    // The lowest the hips may go to reach a foot; a planted foot further out
    // than that (only after a violent change of direction) is dragged along.
    const hipFloor = RIG.hipY - 0.4 * cr - 0.05 * run - 0.12;
    const maxR = Math.sqrt(SOFT_REACH * SOFT_REACH - (hipFloor + RIG.legY - GROUND) ** 2) - 0.02;
    for (let fi = 0; fi < ft.length; fi++) { const f = ft[fi]!;
      if (s.onGround) {
        let dx = (f.wx - bx) / sc, dz = (f.wz - bz) / sc;
        if (f.planted) {
          const d = Math.hypot(dx, dz);
          if (d > maxR + RIG.legX) { const k = (maxR + RIG.legX) / d; dx *= k; dz *= k; f.wx = bx + dx * sc; f.wz = bz + dz * sc; }
        }
        f.lx = dx * cos - dz * sin;
        f.lz = dx * sin + dz * cos;
        f.ly = GROUND + f.lift + f.yOff.to(0, 26, dt);
        f.ax.set(f.lx); f.ay.set(f.ly); f.az.set(f.lz);
      } else { f.lx = f.ax.x; f.ly = f.ay.x; f.lz = f.az.x; }
    }

    // ---- Hips ----
    const wob = this.wob, raw = this.raw, o = this.out;
    const breath = Math.sin(this.time * 1.75 + this.seed);
    const sway = Math.sin(this.time * 0.7 + this.seed * 1.3);
    const idleW = (1 - gw) * (1 - airW) * (rm ? 0.4 : 1);
    const sec = rm ? 0.5 : 1;
    // Lean into acceleration (starts, stops, turns), springy.
    const leanF = this.lean.to(clamp(-aF * 0.011, -0.22, 0.2) * sec, 9, dt);
    const leanR = this.roll.to(clamp(-aR * 0.009, -0.16, 0.16) * sec, 9, dt);
    // The stride, from where the feet are: the pelvis turns toward the leg in front.
    const pc = Math.cos(hipYawLoco), ps = Math.sin(hipYawLoco);
    const fwdL = -(ft[0].lz * pc + ft[0].lx * ps), fwdR = -(ft[1].lz * pc + ft[1].lx * ps);
    const stride = clamp((fwdL - fwdR) / Math.max(E, 0.3), -1.2, 1.2) * gw * (1 - airW);
    const strideTw = -stride * (0.1 + 0.06 * run) * sec;
    let hipsY = RIG.hipY - 0.4 * cr - 0.05 * run * gw - this.squash.x + 0.004 * breath * idleW - wob[R_DROP]! * 0.12;
    // Weight on a bent leg: running and crouch-walking, the hips sink a
    // little through each foot's stance (lowest as she passes over it) and
    // rise again into the next step, so the weight visibly goes onto each
    // foot. (A straight-legged walk gets its bob from the reach to the feet.)
    if (this.walking && s.onGround) {
      let comp = 0;
      for (let i = 0; i < 2; i++) { const ph = (this.phase + 0.5 * i) % 1; if (ph < beta && ft[i]!.planted) comp = Math.max(comp, Math.sin(Math.PI * ph / beta)); }
      hipsY -= (0.035 * run + 0.015 * cr) * gw * comp * sec;
    }
    hipsY -= (body.hd * bodyW + 0.05 * wf) * mAmp;
    const hipYaw = hipYawLoco + strideTw + (body.hy * bodyW - 0.18 * wsgn * wf) * mAmp;
    // Waddle: the hip over the swinging leg drops; standing, a slow weight shift.
    const waddle = this.walking ? 0.05 * Math.sin(this.phase * Math.PI * 2) * gw * (1 - run * 0.6) * sec : 0;
    const hipRoll = waddle + 0.03 * sway * idleW + leanR * 0.4;
    // The legs must reach the feet: the hips come down as far as needed (a
    // smooth minimum, so the bob of the walk comes from the feet themselves).
    if (airW < 0.5) {
      const base = hipsY;
      for (let fi = 0; fi < ft.length; fi++) { const f = ft[fi]!;
        const hx = f.side * RIG.legX * Math.cos(hipYaw), hz = -f.side * RIG.legX * Math.sin(hipYaw);
        const dx = f.lx - hx, dz = f.lz - hz;
        const rr = Math.min(dx * dx + dz * dz, SOFT_REACH * SOFT_REACH * 0.92);
        let cap = f.ly - RIG.legY + Math.sqrt(SOFT_REACH * SOFT_REACH - rr) - Math.abs(RIG.legX * Math.sin(hipRoll));
        // Running, a swinging leg folds instead of pulling her down: only a
        // foot about to land (or still on the ground) holds the hips, so she
        // is highest between steps, not lowest.
        if (!f.planted && !f.down) cap += 0.5 * run * (1 - smooth((f.s - 0.6) / 0.36));
        hipsY = smin(hipsY, cap, 0.03);
      }
      hipsY = Math.max(hipsY, hipFloor - (body.hd * bodyW + 0.05 * wf) * mAmp - this.squash.x - 0.03 * fl);
      // How far the feet pull the hips down: at once (a leg must reach), but
      // let go no faster than HIP_RISE, so a foot leaving a long reach does
      // not pop the hips (and every knee) up in one frame.
      const def = Math.max(base - hipsY, this.hipDef - HIP_RISE * dt);
      this.hipDef = Math.min(def, Math.max(0, base - (hipFloor - (body.hd * bodyW + 0.05 * wf) * mAmp - this.squash.x - 0.03 * fl)));
      hipsY = base - this.hipDef;
    } else this.hipDef = 0;
    // A flinch drops the weight back onto the leg away from the blow.
    raw[HY] = hipsY - 0.03 * fl; raw[HRX] = 0; raw[HRY] = hipYaw + fs * 0.1 * fl; raw[HRZ] = hipRoll + fs * 0.06 * fl;
    for (let i = HY; i <= HRZ; i++) o[i] = raw[i]! + this.off[i]!;

    // ---- Legs: IK to the feet ----
    this.splay = 0.22 * cr; // more and the knees push out through the sides of the skirt
    this.solveLeg(ft[0], o[HY]!, o[HRX]!, o[HRY]!, o[HRZ]!, yaw, LLX);
    this.solveLeg(ft[1], o[HY]!, o[HRX]!, o[HRY]!, o[HRZ]!, yaw, LRX);
    // A swinging foot has no spot to hold until it comes down: its leg is
    // slew-limited there, so a foot leaving a long reach (a crouch-walk, a
    // dragged foot) folds up quickly but not in one frame.
    for (let fi = 0; fi < 2; fi++) {
      const f = ft[fi]!, c0 = fi === 0 ? LLX : LRX, lim = !this.snap && s.onGround && !f.planted && f.s < 0.75 ? LEG_SLEW * dt : Infinity;
      for (let i = c0; i < c0 + 4; i++) { const v = raw[i]! + this.off[i]!, p = o[i]!; o[i] = v > p + lim ? p + lim : v < p - lim ? p - lim : v; }
    }

    // ---- Torso and head ----
    const tw = (act * arm.tw - 0.3 * wsgn * wf) * mAmp;
    const pitch = s.pitch;
    let torsoX = leanF - 0.075 * run * gw - 0.2 * cr + 0.012 * breath * idleW + pitch * 0.18 + (body.lx * bodyW - 0.14 * wf) * mAmp;
    if (this.backMode && this.walking) torsoX += 0.07 * gw;
    torsoX += -this.squash.x * 1.4 + airW * (this.tuck.x * 0.12 - 0.06);
    raw[TX] = torsoX + wob[R_TORX]! + 0.2 * fl * this.flinchBack;
    // Shoulders: the pelvis's turn mostly undone, the stride countered, the action's own twist.
    raw[TY] = -hipYawLoco * 0.8 - strideTw * 1.6 - (body.hy * bodyW - 0.18 * wsgn * wf) * mAmp + tw + wob[R_TORY]! + fs * 0.22 * fl;
    raw[TZ] = -hipRoll * 0.6 + leanR * 0.6 + (body.lz * bodyW + 0.1 * wsgn * wf) * mAmp - 0.02 * sway * idleW + wob[R_TORZ]!;
    // The head stays on the aim: it takes back the rest of the pelvis's turn and some of the shoulders'.
    raw[NX] = pitch * 0.55 - torsoX * 0.5 + 0.008 * breath * idleW + wob[R_HEADX]!;
    raw[NY] = -hipYawLoco * 0.2 - tw * 0.4 + wob[R_HEADY]! + fs * 0.3 * fl;
    raw[NZ] = -(raw[TZ]! - wob[R_TORZ]!) * 0.4 + 0.015 * sway * idleW + wob[R_HEADZ]!;

    // ---- Arms ----
    // Swing opposite the legs (from where the feet really are), pumped in a run.
    const swing = stride * (0.3 + 0.32 * run) * (1 - 0.5 * side) * (rm ? 0.7 : 1);
    const flail = wob[R_ARMS]!;
    const airArms = airW * (0.35 + 0.25 * this.tuck.x);
    const breathOut = 0.015 * breath * idleW;
    const sq = this.squash.x;
    // Left arm: free; it counterbalances throws and swings.
    // Flinch: both hands come up in front of her, splayed (the one on the side of the blow higher).
    const flL = fl * (1 + 0.25 * Math.max(0, -fs)), flR = fl * (1 + 0.25 * Math.max(0, fs));
    raw[ALX] = -swing + airArms * 0.6 + (body.lax * bodyW + 0.45 * wf) * mAmp - flail * 0.06 - sq * 1.5 + 0.95 * flL;
    raw[ALY] = 0;
    raw[ALZ] = -(0.12 + 0.06 * run + airArms + breathOut + (body.lao * bodyW + 0.2 * wf) * mAmp + flail * 0.12 + sq * 1.2 + 0.3 * flL);
    raw[FLX] = 0.3 + 0.75 * run * gw + airW * 0.3 + body.lfx * bodyW * mAmp + flail * 0.05 + 1.25 * flL;
    raw[FLX] = Math.min(raw[FLX]!, 2.3); // elbows: a tight fold at most
    raw[FLY] = 0; raw[FLZ] = 0; raw[WLX] = 0; raw[WLY] = 0; raw[WLZ] = 0;
    // Right arm: the weapon arm. The action keys over the locomotion swing.
    // It carries the sandal: a smaller swing and pump, so it never jabs forward.
    const locoAx = CARRY.ax + swing * 0.6 + airArms * 0.5 - sq * 1.5 - flail * 0.06 + 0.95 * flR;
    const locoFx = CARRY.fx + 0.4 * run * gw + airW * 0.3 + 1.25 * flR;
    let ax = locoAx, ay = 0, ez = 0, fx = locoFx, wy = 0;
    if (swinging || throwing) {
      ax = (REST.ax + (arm.ax - REST.ax) * mAmp) * act + locoAx * (1 - act);
      fx = (REST.fx + (arm.fx - REST.fx) * mAmp) * act + locoFx * (1 - act);
      ay = arm.ay * mAmp * act; ez = arm.ez * mAmp * act; wy = arm.wy * mAmp * act;
    }
    // A miss: the arm carries on past the end of its sweep.
    ay -= 0.4 * wsgn * wf * mAmp; ez += 0.12 * wsgn * wf * mAmp; ax -= 0.15 * wf * mAmp;
    raw[ARX] = ax; raw[ARY] = ay;
    raw[ARZ] = 0.1 + 0.06 * run + airArms + breathOut + flail * 0.12 + sq * 1.2 + 0.3 * flR * (1 - act);
    raw[FRX] = Math.min(fx, 2.3); raw[FRY] = 0; raw[FRZ] = ez;
    raw[WRX] = 0; raw[WRY] = wy; raw[WRZ] = 0;
    this.resolveCapture();
    // A slew limit on the upper body: where two fast things meet (a throw
    // starting out of a flinch) no joint turns faster than a whip.
    const lim = this.snap ? Infinity : SLEW * dt;
    for (let i = TX; i <= WRZ; i++) { const v = raw[i]! + this.off[i]!, p = o[i]!; o[i] = v > p + lim ? p + lim : v < p - lim ? p - lim : v; }
    this.snap = false;

    this.apply(true, yaw);
    this.secondary(dt, aF, aR, vF, vR, cr, rm);

    // Weapons: the chancla in hand reappears when the weapon is ready.
    const inHand = swinging || tThrow > def.cooldownMs * 0.55 || tThrow < (s.weapon === 1 ? 160 : 90);
    r.weapons[0]!.visible = s.weapon === 0 && inHand;
    r.weapons[1]!.visible = s.weapon === 1 && inHand;
    // Hit flash (playful, brief, not graphic): a warm brightening. The model
    // has one material for the whole body, so added (emissive) light would
    // wash the dark skirt and hair out to grey; scaling the colour keeps
    // every hue and keeps dark cloth dark. The contact effect and the flinch
    // carry the hit.
    // msSinceHit can be slightly negative for remotes (the delayed render
    // timeline has not reached the hit yet): no flash until it has.
    const hk = s.msSinceHit >= 0 && s.msSinceHit < 140 ? 1 - s.msSinceHit / 140 : 0, hitK = hk * hk;
    for (let mi = 0; mi < r.flashMats.length; mi++) { const m = r.flashMats[mi]!; m.color.setRGB(1 + hitK * 0.5, 1 + hitK * 0.38, 1 + hitK * 0.24); }
    r.bubble.visible = s.protected;
    if (s.protected) (r.bubble.material as THREE.MeshBasicMaterial).opacity = 0.14 + Math.sin(this.time * 10) * 0.05;
    // Respawn pop: a springy grow with a little stretch.
    if (this.spawnT < 1) this.spawnT = Math.min(1, this.spawnT + dt / 0.3);
    if (rm || this.spawnT >= 1) r.root.scale.setScalar(1);
    else {
      const g = 0.7 + 0.3 * easeOutBack(this.spawnT), st = Math.sin(Math.PI * this.spawnT) * 0.1;
      r.root.scale.set(g * (1 - st * 0.5), g * (1 + st), g * (1 - st * 0.5));
    }
  }

  /**
   * How closed a blink has her eyes now (0..1): one every 2 to 5 s on her
   * own clock, now and then two in a row, each 0.16 s (fast down, slower up).
   */
  private blink(): number {
    const D = 0.16;
    while (this.time > this.blinkAt + D) {
      const n = ++this.blinkN;
      this.blinkAt += D + (hash(this.seed, n * 2) < 0.15 ? 0.1 : 2 + 3 * hash(this.seed, n * 2 + 1));
    }
    const u = (this.time - this.blinkAt) / D;
    if (u < 0) return 0;
    return u < 0.35 ? smooth(u / 0.35) : 1 - smooth((u - 0.35) / 0.65);
  }

  // ---------------------------------------------------------------- root

  /** Velocity from the root's motion since last frame (`s` null: only keep track). */
  private trackRoot(dt: number, s: AvatarState | null): void {
    const p = this.rig.root.position;
    if (!this.init) { this.init = true; this.px = p.x; this.py = p.y; this.pz = p.z; this.resetFeet(); }
    let dx = p.x - this.px, dz = p.z - this.pz;
    const dy = p.y - this.py;
    this.px = p.x; this.py = p.y; this.pz = p.z;
    if (!s || dt <= 0) return;
    if (dx * dx + dz * dz > 2.5 * 2.5 || Math.abs(dy) > 3) {
      // A teleport (a snapshot jump): start again under her, cloth and lean at rest.
      this.vx.set(0); this.vz.set(0); this.vy = 0;
      this.lean.set(0); this.roll.set(0); this.squash.set(0);
      this.clearCloth();
      this.resetFeet();
      return;
    }
    if (dx * dx + dz * dz > 1e-10) this.rootMoved = true;
    else if (!this.rootMoved && s.speed > 0.3) {
      // A caller that never moves the root (a menu figure, a test) but says
      // she walks: walk on the spot, as if the ground slid under her.
      const yaw = this.rig.root.rotation.y, sn = Math.sin(yaw), cs = Math.cos(yaw);
      const vf = -s.back * s.speed, vr = s.strafe * s.speed;
      dx = (-vf * sn + vr * cs) * dt; dz = (-vf * cs - vr * sn) * dt;
      this.ox += dx; this.oz += dz;
    }
    this.vx.to(dx / dt, 30, dt);
    this.vz.to(dz / dt, 30, dt);
    this.vy += (dy / dt - this.vy) * (1 - Math.exp(-40 * dt));
  }

  private respawn(): void {
    this.clearMotion();
    this.blinkAt = this.time + 0.12; // she blinks as she appears
  }

  // ---------------------------------------------------------------- feet

  private resetFeet(): void {
    const p = this.rig.root.position, yaw = this.rig.root.rotation.y;
    this.hipWorld = yaw; this.hipWorldV = 0;
    this.gaitIdle = true;
    for (let fi = 0; fi < this.feet.length; fi++) { const f = this.feet[fi]!;
      f.planted = true; f.s = 1; f.lift = 0; f.pitch = 0; f.yOff.set(0); f.stx = f.stz = 0;
      f.wx = p.x + this.ox + f.side * STANCE_W * Math.cos(yaw);
      f.wz = p.z + this.oz - f.side * STANCE_W * Math.sin(yaw);
      f.yaw = yaw + f.side * TOE_OUT;
    }
  }

  private lift(f: Foot, q0: number, dur: number): void {
    f.planted = false; f.down = false; f.sx = f.wx - this.bx; f.sz = f.wz - this.bz; f.syaw = f.yaw; f.s = 0; f.q0 = q0; f.dur = dur;
    f.l0 = f.lift; f.p0 = f.pitch;
  }

  private plant(f: Foot): void {
    f.planted = true; f.s = 1;
    f.yOff.x += f.lift; f.yOff.v = 0; // set down from wherever the swing was
    f.lift = 0; f.pitch = 0; f.l0 = f.p0 = 0; f.stx = f.stz = 0;
  }

  /** Steps the feet on the ground: timed by the gait while she moves, settling steps when she stands. */
  private stepFeet(dt: number, bx: number, bz: number, speed: number, vx: number, vz: number, beta: number, E: number, freq: number, W: number, H: number, rm: boolean): void {
    const hc = Math.cos(this.hipWorld), hs = Math.sin(this.hipWorld);
    const ux = speed > 1e-3 ? vx / speed : 0, uz = speed > 1e-3 ? vz / speed : 0;
    const ft = this.feet;
    if (this.walking) {
      let adv = dt;
      if (this.gaitIdle) {
        // Setting off: the foot that trails goes first; feet side by side,
        // the one on the side she heads to (else the right), so the choice
        // never hangs on a millimetre (or on the frame rate).
        const trailL = (ft[0].wx - bx) * ux + (ft[0].wz - bz) * uz, trailR = (ft[1].wx - bx) * ux + (ft[1].wz - bz) * uz;
        const lat = ux * hc - uz * hs; // her heading's component to the pelvis's right
        const first = Math.abs(trailL - trailR) > 0.03 ? (trailL < trailR ? 0 : 1) : lat < -0.3 ? 0 : 1;
        this.phase = beta - 0.5 * first + 0.001;
        this.phase -= Math.floor(this.phase);
        this.gaitIdle = false;
        adv = dt * this.walkFrac;
      }
      this.phase = (this.phase + freq * adv) % 1;
      for (let i = 0; i < 2; i++) {
        const f = ft[i]!;
        const ph = (this.phase + 0.5 * i) % 1;
        const stance = ph < beta;
        const q = stance ? 0 : (ph - beta) / (1 - beta);
        if (f.planted) {
          if (!stance) this.lift(f, q, 0);
          else {
            // Running, the heel peels off the paving late in the stance (the
            // toes stay where they are): the leg pushes off rather than
            // dragging the hips down to reach a foot far behind.
            const hr = 0.07 * this.heelW * smooth((ph / beta - 0.5) / 0.5);
            f.lift = hr; f.pitch = -6 * hr;
            continue;
          }
        }
        else if (stance) { this.plant(f); continue; }
        else if (f.dur > 0) { f.q0 = Math.min(0.95, (q - f.s) / Math.max(0.05, 1 - f.s)); f.dur = 0; } // a settling step caught by the gait
        f.s = clamp((q - f.q0) / Math.max(0.05, 1 - f.q0), 0, 1);
        // Land half a stance ahead of where the hip will be by then.
        // (Running, a little less far ahead: a runner lands nearer under herself and pushes off further back.)
        const tLeft = (1 - ph) / freq, ahead = E * (0.5 - 0.14 * this.runW);
        this.swingTo(f, vx * tLeft + ux * ahead, vz * tLeft + uz * ahead, hc, hs, W, H);
      }
      return;
    }
    // Standing: finish any step, then settle a foot that is out of place.
    this.gaitIdle = true;
    for (let fi = 0; fi < ft.length; fi++) { const f = ft[fi]!; if (f.planted && f.lift > 0) { f.yOff.x += f.lift; f.lift = 0; f.pitch = 0; } } // a raised heel settles back down
    this.settleHold -= dt;
    let busy = false;
    for (let fi = 0; fi < ft.length; fi++) { const f = ft[fi]!;
      if (f.planted) continue;
      busy = true;
      f.s = Math.min(1, f.s + dt / Math.max(0.05, f.dur || 0.16));
      this.swingTo(f, f.stx, f.stz, hc, hs, W, 0.075 * (rm ? 0.7 : 1));
      if (f.s >= 1) this.plant(f);
    }
    let worst: Foot | null = null, worstE = 1, frac = 1;
    for (let fi = 0; fi < ft.length; fi++) { const f = ft[fi]!;
      const rx = bx + f.side * W * hc, rz = bz - f.side * W * hs;
      const e = Math.max(Math.hypot(f.wx - rx, f.wz - rz) / 0.09, Math.abs(wrapAngle(f.yaw - this.hipWorld - f.side * TOE_OUT)) / 0.5);
      // The part of this frame since the foot went out of place (or the hold ran out).
      if (e > worstE) { worst = f; worstE = e; frac = Math.min(f.err < 1 ? (e - 1) / Math.max(1e-6, e - f.err) : 1, this.settleHold < 0 ? -this.settleHold / dt : 1); }
      f.err = e;
    }
    if (busy || this.settleHold > 0 || !worst) return;
    // The step starts between frames: it is already that far along.
    const dur = rm ? 0.26 : 0.2;
    this.lift(worst, 0, dur);
    worst.s = clamp(frac, 0, 1) * dt / dur;
    this.swingTo(worst, worst.stx, worst.stz, hc, hs, W, 0.075 * (rm ? 0.7 : 1));
  }

  /**
   * Moves a swinging foot toward its spot (cx, cz relative to her now, plus
   * the stance width), with lift and toe pitch. The swing is eased in her
   * own frame, so the foot travels forward past her smoothly however fast she goes.
   */
  private swingTo(f: Foot, cx: number, cz: number, hc: number, hs: number, W: number, H: number): void {
    const tx = cx + f.side * W * hc, tz = cz - f.side * W * hs;
    // The foot is down on its spot a moment before the beat, so it is set down flat, not dropped.
    // (A gait step comes down closer to the beat: hovering over its spot, the
    // foot would turn in place; running, it lands on the beat, no time to hover.)
    const u = Math.min(1, f.s / (f.dur > 0 ? 0.88 : 0.94 + 0.06 * this.runW)), k = smooth(f.dur > 0 ? u : u / ((1 - 0.1 * this.runW) * 0.95)); // (over its spot a moment before it touches)
    if (u < 1 || !f.down) {
      f.wx = this.bx + f.sx + (tx - f.sx) * k;
      f.wz = this.bz + f.sz + (tz - f.sz) * k;
      f.down = u >= 1; // once down it stays put until the beat plants it
    }
    f.yaw = f.syaw + wrapAngle(this.hipWorld + f.side * TOE_OUT - f.syaw) * k;
    // Walking, the foot rises and falls evenly; running, the heel comes up
    // quickly behind her as the foot leaves, and the leg reaches forward and
    // down into the next step.
    const r = this.runW;
    f.lift = H * ((1 - r) * Math.sin(Math.PI * u) + r * 6.75 * u * (1 - u) * (1 - u)); // (run: highest a third of the way, coming down flat)
    // Toe down as it leaves, toe up as it reaches.
    f.pitch = Math.sin(Math.PI * u) * (-0.55 * (1 - u) + 0.35 * u);
    // From a raised heel (running), the swing starts where the push-off left the foot.
    if (f.l0 > 0 || f.p0 !== 0) { const h = 1 - smooth(u / 0.35); f.lift = Math.max(f.lift, f.l0 * h); f.pitch += f.p0 * h; }
  }

  /** A miss throws her weight over: one foot steps out the way the swing went. */
  private stumble(w: WeaponId): void {
    const f = this.feet[w === 1 ? 1 : 0];
    if (!f.planted) return;
    const yaw = this.rig.root.rotation.y, sn = Math.sin(yaw), cs = Math.cos(yaw);
    // Body frame: the Revés overruns forward and to her right, the Chanclazo to her left.
    const rx = w === 1 ? 0.12 : -0.08, fw = 0.14;
    this.lift(f, 0, 0.2);
    f.stx = rx * cs - fw * sn;
    f.stz = -rx * sn - fw * cs;
    this.settleHold = 0.45;
  }

  private takeOff(): void {
    for (let fi = 0; fi < this.feet.length; fi++) { const f = this.feet[fi]!;
      f.ax.set(f.lx); f.ay.set(f.ly); f.az.set(f.lz);
      f.planted = false; f.s = 1; f.lift = 0; f.dur = 0;
    }
    this.tuck.set(0);
  }

  private land(impact: number, rm: boolean): void {
    const p = this.rig.root.position, yaw = this.rig.root.rotation.y, sn = Math.sin(yaw), cs = Math.cos(yaw);
    for (let fi = 0; fi < this.feet.length; fi++) { const f = this.feet[fi]!;
      // Down where the air pose had it, settling onto the paving.
      f.wx = p.x + this.ox + f.lx * cs + f.lz * sn;
      f.wz = p.z + this.oz - f.lx * sn + f.lz * cs;
      f.yaw = this.hipWorld + f.side * TOE_OUT;
      f.planted = true; f.s = 1; f.lift = 0; f.pitch = 0; f.stx = f.stz = 0;
      f.yOff.set(Math.max(0, f.ly - GROUND));
    }
    this.gaitIdle = true;
    // Squash by impact speed (a plain jump lands at 7 m/s), then recover.
    this.squash.v += Math.min(impact, 14) * 0.5 * (rm ? 0.5 : 1);
    this.extX.v -= impact * 0.4;
    this.settleHold = 0.15;
  }

  /** In the air: a quick tuck, then the legs reach for the ground as she falls. */
  private airFeet(dt: number, speed: number, airW: number): void {
    const tk = this.tuck.to(this.vy > -1.5 ? 1 : 0, 12, dt);
    const fw = Math.min(1, speed / 6);
    const [L, R] = this.feet;
    // Left knee up, right leg trailing; extended and a little apart when reaching.
    L.ax.to(-STANCE_W - 0.01, 18, dt);
    L.ay.to(GROUND + (0.04 + 0.3 * tk) * airW, 18, dt);
    L.az.to(-0.06 - (0.08 + 0.14 * fw) * tk, 18, dt);
    R.ax.to(STANCE_W + 0.02, 18, dt);
    R.ay.to(GROUND + (0.06 + 0.12 * tk) * airW, 18, dt);
    R.az.to(0.06 + (0.06 + 0.14 * fw) * tk, 18, dt);
    L.pitch = R.pitch = -0.25 * tk;
    L.yaw = this.hipWorld - TOE_OUT; R.yaw = this.hipWorld + TOE_OUT;
    this.squash.to(0, 11, dt);
  }

  // ---------------------------------------------------------------- IK

  /**
   * Two-bone IK from the hip to a root-local foot target: the leg turns
   * toward the foot's yaw, swings out and forward to aim at it, and the
   * knee bends forward only (shin rotation.x <= 0).
   */
  private solveLeg(f: Foot, hy: number, hrx: number, hry: number, hrz: number, rootYaw: number, ch: number): void {
    // Into the hips' frame (YXZ: undo Y, then X, then Z), then the leg's.
    let x = f.lx, y = f.ly - hy, z = f.lz, t: number;
    let c = Math.cos(hry), s = Math.sin(hry);
    t = x * c - z * s; z = x * s + z * c; x = t;
    c = Math.cos(hrx); s = Math.sin(hrx);
    t = y * c + z * s; z = -y * s + z * c; y = t;
    c = Math.cos(hrz); s = Math.sin(hrz);
    t = x * c + y * s; y = -x * s + y * c; x = t;
    x -= f.side * RIG.legX; y -= RIG.legY;
    // The knee points the way the foot does (a foot still planted after a turn).
    // Crouched, the knees splay out a little (a granny squat that keeps them inside the skirt).
    const psi = clamp(wrapAngle(f.yaw - rootYaw - hry) * 0.8, -0.6, 0.6) - f.side * this.splay;
    c = Math.cos(psi); s = Math.sin(psi);
    t = x * c - z * s; z = x * s + z * c; x = t;
    const l = clamp(Math.hypot(x, y, z), 0.25, REACH * 0.9999);
    const phi = Math.atan2(x, -y);
    const theta = Math.atan2(-z, Math.hypot(x, y));
    const alpha = Math.acos(clamp((A * A + l * l - B * B) / (2 * A * l), -1, 1));
    const knee = Math.PI - Math.acos(clamp((A * A + B * B - l * l) / (2 * A * B), -1, 1));
    const raw = this.raw;
    raw[ch] = theta + alpha; raw[ch + 1] = psi; raw[ch + 2] = phi; raw[ch + 3] = -knee;
  }

  // ---------------------------------------------------------------- output

  /** Writes the channels to the joints; `feet`: also set the feet flat along their yaw (else they follow the shins). */
  private apply(feet: boolean, rootYaw: number): void {
    const r = this.rig, o = this.out;
    r.hips.position.y = o[HY]!;
    r.hips.rotation.set(o[HRX]!, o[HRY]!, o[HRZ]!);
    r.torso.rotation.set(o[TX]!, o[TY]!, o[TZ]!);
    r.head.rotation.set(o[NX]!, o[NY]!, o[NZ]!);
    r.armL.rotation.set(o[ALX]!, o[ALY]!, o[ALZ]!);
    r.foreL.rotation.set(o[FLX]!, o[FLY]!, o[FLZ]!);
    r.wristL.rotation.set(o[WLX]!, o[WLY]!, o[WLZ]!);
    r.armR.rotation.set(o[ARX]!, o[ARY]!, o[ARZ]!);
    r.foreR.rotation.set(o[FRX]!, o[FRY]!, o[FRZ]!);
    r.wristR.rotation.set(o[WRX]!, o[WRY]!, o[WRZ]!);
    r.legL.rotation.set(o[LLX]!, o[LLY]!, o[LLZ]!);
    r.shinL.rotation.set(o[SLX]!, 0, 0);
    r.legR.rotation.set(o[LRX]!, o[LRY]!, o[LRZ]!);
    r.shinR.rotation.set(o[SRX]!, 0, 0);
    if (!feet) { r.footL.rotation.set(0, 0, 0); r.footR.rotation.set(0, 0, 0); return; }
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i]!, leg = i === 0 ? r.legL : r.legR, shin = i === 0 ? r.shinL : r.shinR;
      // The chain above the foot (hips, leg, shin) is undone, then her yaw and the toe pitch applied.
      const q = this.qa.copy(r.hips.quaternion).multiply(leg.quaternion).multiply(shin.quaternion).invert();
      this.eu.set(f.pitch, wrapAngle(f.yaw - rootYaw), 0, 'YXZ');
      (i === 0 ? r.footL : r.footR).quaternion.copy(q.multiply(this.qb.setFromEuler(this.eu)));
    }
  }

  /** Blends out a hard cut: the next raw pose is offset to match the last shown one, and the offset decays. */
  private capture(omega: number, upperOnly: boolean): void {
    this.pendingCapture = upperOnly ? 1 : 2;
    this.offOmega = omega;
  }

  private resolveCapture(): void {
    if (!this.pendingCapture) return;
    const all = this.pendingCapture === 2;
    for (let i = 0; i < CH_N; i++) {
      if (!all && (i < TX || i > WRZ)) continue;
      this.off[i] = this.out[i]! - this.raw[i]!;
      this.offV[i] = 0;
    }
    this.offActive = true;
    this.pendingCapture = 0;
  }

  private stepOffsets(dt: number): void {
    if (!this.offActive) return;
    const om = this.offOmega, e = Math.exp(-om * dt);
    let any = false;
    for (let i = 0; i < CH_N; i++) {
      const x0 = this.off[i]!, v0 = this.offV[i]!;
      if (x0 === 0 && v0 === 0) continue;
      const j = v0 + om * x0, x = (x0 + j * dt) * e, v = (v0 - om * j * dt) * e;
      if (Math.abs(x) < 1e-4 && Math.abs(v) < 1e-3) { this.off[i] = 0; this.offV[i] = 0; continue; }
      this.off[i] = x; this.offV[i] = v; any = true;
    }
    this.offActive = any;
  }

  // ---------------------------------------------------------------- secondary

  private stepWobble(dt: number): void {
    const z = this.rm ? 1 : WOB_Z, wd = WOB_W * Math.sqrt(Math.max(1e-3, 1 - z * z));
    const e = Math.exp(-z * WOB_W * dt), c = Math.cos(wd * dt), sn = Math.sin(wd * dt);
    for (let i = 0; i < R_N; i++) {
      const x = this.wob[i]!, v = this.wobV[i]!;
      if (x === 0 && v === 0) continue;
      const k = (v + z * WOB_W * x) / wd;
      let nx = e * (x * c + k * sn), nv = e * (v * c - sn * (z * WOB_W * k + wd * x));
      if (Math.abs(nx) < 1e-4 && Math.abs(nv) < 1e-3) { nx = 0; nv = 0; }
      this.wob[i] = nx; this.wobV[i] = nv;
    }
  }

  /**
   * Cloth and hair (rig.extras, when the model has them): a pendulum that
   * trails her motion (the hem lags behind a start, swings on past a stop,
   * flares on a landing or a blow), and the skirt swishes a beat behind the
   * hips' turn and roll. Crouched, the hem stays over the knees.
   */
  private secondary(dt: number, aF: number, aR: number, vF: number, vR: number, cr: number, rm: boolean): void {
    if (this.extrasBase.length === 0) return;
    const k = rm ? 0.4 : 1, z = rm ? 0.9 : 0.42, free = 1 - 0.8 * cr;
    const px = this.extX.to(clamp(-aF * 0.0032 - vF * 0.011 * free, -0.14, 0.12) * k, 8.5, z, dt);
    const pz = this.extZ.to(clamp(aR * 0.0032 - vR * 0.009 * free, -0.12, 0.12) * k, 8.5, z, dt);
    let sy = 0, sr = 0;
    if (!this.simple) {
      const hy = this.out[HRY]!, hr = this.out[HRZ]!;
      if (!this.skirtInit) { this.skirtInit = true; this.skirtYaw.set(hy); this.skirtRoll.set(hr); }
      const sw = (rm ? 0.3 : 0.6) * (1 - 0.7 * cr);
      sy = clamp(this.skirtYaw.to(hy, 9, rm ? 0.9 : 0.5, dt) - hy, -0.3, 0.3) * sw;
      sr = clamp(this.skirtRoll.to(hr, 10, rm ? 0.9 : 0.5, dt) - hr, -0.12, 0.12) * sw;
    }
    for (let bi = 0; bi < this.extrasBase.length; bi++) { const b = this.extrasBase[bi]!;
      // A crouch drapes the skirt forward over the knees (they travel about
      // 0.4 m ahead of the hips) instead of pushing it into the paving.
      b.o.rotation.set(b.rx + px * b.g + (b.skirt ? CROUCH_SKIRT.tilt * cr : 0), b.ry + (b.skirt ? sy : 0), b.rz + pz * b.g + (b.skirt ? sr : 0));
      if (b.skirt) b.o.scale.set(b.sx * (1 + CROUCH_SKIRT.wide * cr), b.sy * (1 - CROUCH_SKIRT.drop * cr), b.sz * (1 + CROUCH_SKIRT.deep * cr));
    }
  }

  // ---------------------------------------------------------------- elimination

  /** Comic pratfall: a hop of surprise, a spin, a sit-down with the legs out, dizzy stars, then a puff out. */
  private pratfall(dt: number, rm: boolean): void {
    const r = this.rig, raw = this.raw, o = this.out, t = this.deadT;
    const k = Math.min(1, t / 0.45), e = easeOut(k);
    const hop = t < 0.14 ? Math.sin(Math.PI * t / 0.14) : 0;
    const bump = t > 0.45 ? Math.sin((t - 0.45) * 14) * Math.exp(-(t - 0.45) * 6) : 0;
    const dizzy = clamp((t - 0.5) / 0.4, 0, 1) * (rm ? 0.5 : 1);
    raw[HY] = RIG.hipY + 0.06 * hop - 0.56 * e + 0.03 * bump;
    raw[HRX] = 0; raw[HRY] = 0; raw[HRZ] = 0.08 * Math.sin(t * 3.1) * dizzy;
    raw[TX] = 0.8 * e - 0.25 * bump;
    raw[TY] = (rm ? 0 : 1) * (1 - k) * 6;
    raw[TZ] = 0.1 * Math.sin(t * 2.6) * dizzy;
    raw[NX] = -0.35 * e + 0.12 * Math.sin(t * 2.2) * dizzy;
    raw[NY] = 0.25 * Math.sin(t * 1.7) * dizzy;
    raw[NZ] = 0.22 * Math.sin(t * 3.1 + 1) * dizzy;
    // Arms flung up, then down behind her to prop her up.
    const up = t < 0.5 ? Math.min(1, t / 0.12) : Math.max(0, 1 - (t - 0.5) / 0.35);
    raw[ALX] = raw[ARX] = -2.6 * up - 0.5 * (1 - up) * e;
    raw[ALY] = raw[ARY] = 0;
    raw[ALZ] = -0.35 - 0.3 * up; raw[ARZ] = 0.35 + 0.3 * up;
    raw[FLX] = raw[FRX] = 0.3;
    raw[FLY] = raw[FLZ] = raw[FRY] = raw[FRZ] = 0;
    raw[WLX] = raw[WLY] = raw[WLZ] = raw[WRX] = raw[WRY] = raw[WRZ] = 0;
    // Legs out in front, a little apart; a kick as she bumps down.
    const kick = t > 0.45 ? 0.35 * Math.sin((t - 0.45) * 9) * Math.exp(-(t - 0.45) * 4) : 0;
    raw[LLX] = 1.45 * e + kick; raw[LLY] = 0; raw[LLZ] = -0.25 * e; raw[SLX] = -0.2 * e;
    raw[LRX] = 1.25 * e - kick; raw[LRY] = 0; raw[LRZ] = 0.25 * e; raw[SRX] = -0.35 * e;
    this.resolveCapture();
    for (let i = 0; i < CH_N; i++) o[i] = raw[i]! + this.off[i]!;
    this.apply(false, 0);
    r.stars.visible = t > 0.4;
    r.stars.rotation.y += dt * 5;
    // Startled wide, then dazed: eyes half shut under the stars.
    if (r.face) r.face.set(t < 0.4 ? 0 : 0.55 * dizzy / (rm ? 0.5 : 1), t < 0.4 ? 0.008 : 0.004, 0, 0);
    for (let wi = 0; wi < r.weapons.length; wi++) { const w = r.weapons[wi]!; w.visible = false; }
    const fade = t > 2.2 ? Math.max(0, 1 - (t - 2.2) / 0.3) : 1;
    r.root.scale.setScalar(Math.max(0.001, fade));
    r.bubble.visible = false;
    for (let mi = 0; mi < r.flashMats.length; mi++) { const m = r.flashMats[mi]!; m.color.setRGB(1, 1, 1); }
  }
}

/** A fixed pseudo-random number in [0, 1) for (seed, n). */
function hash(seed: number, n: number): number { const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); }
function clamp(x: number, a: number, b: number): number { return x < a ? a : x > b ? b : x; }
function ease(k: number): number { return k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; }
function smooth(k: number): number { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); }
/** Smooth minimum (polynomial): never above min(a, b), and no kink. */
function smin(a: number, b: number, k: number): number {
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
}
function wrapAngle(a: number): number { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; }
function easeOut(t: number): number { return 1 - (1 - t) * (1 - t); }
function easeOutBack(t: number): number { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
