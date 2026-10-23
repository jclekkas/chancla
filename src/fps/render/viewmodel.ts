// First-person hands. Timing comes straight from the predicted weapon state,
// so the throw animation always lines up with when the chancla leaves.
//
// The arm is a shooter-only rig (fp-hand.ts): a hand that wraps the held
// chancla or La Pesada, a team-coloured sleeve, toon shading with ink
// outlines. The throw is keyframed on the weapon's own clock: a short
// wind-up, a snap forward with a wrist flick peaking at release (90 ms light,
// 160 ms heavy), a follow-through, the empty hand dropping away and a fresh
// item rising into it before the cooldown ends.
import * as THREE from 'three';
import { WEAPONS, WEAPON_SWITCH_MS, type WeaponId } from '../../../shared/config';
import type { Team } from '../../../shared/map';
import { applyRest, buildFpHand, FP_REST, type FpPose, type FpRig } from './fp-hand';
import { COLORS } from './materials';

export interface ViewState {
  weapon: WeaponId;
  cooldownMs: number;
  switchMs: number;
  speed: number;
  onGround: boolean;
  crouched: boolean;
  alive: boolean;
  msSinceThrow: number;
}

/** Offsets from the rest pose: position (camera space), root rotation, wrist flick. */
interface Pose { x: number; y: number; z: number; pitch: number; yaw: number; roll: number; flick: number }
type Ease = (k: number) => number;
interface Key { t: number; p: Partial<Pose>; ease: Ease }

const easeOut2: Ease = (k) => 1 - (1 - k) * (1 - k);
const easeOut3: Ease = (k) => 1 - (1 - k) ** 3;
const easeIn3: Ease = (k) => k * k * k;
const easeInOut: Ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
/** Ease out with a small overshoot, so the fresh item settles into the hand. */
const settle: Ease = (k) => { const c = 1.25; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2; };

const FIELDS = ['x', 'y', 'z', 'pitch', 'yaw', 'roll', 'flick'] as const;
const REST_POS = new THREE.Vector3(0.36, -0.27, -0.62);
const REST_ROT = new THREE.Euler(0.12, -0.08, 0.18);
/** Distance from the wrist back along the forearm to the swing pivot (the elbow). */
const PIVOT = 0.36;

/**
 * Keyframes for one weapon. `release` and `show` are the fixed moments of the
 * timeline (item leaves the hand; fresh item appears), `end` the cooldown.
 */
function throwKeys(weapon: WeaponId, release: number, show: number, end: number): Key[] {
  if (weapon === 1) {
    // Heavier: a longer, deeper wind-up, a heave and a slower drop.
    return [
      { t: 0, p: {}, ease: easeOut2 },
      { t: 75, p: { x: 0.02, y: 0.02, z: 0.02, pitch: 0.32, yaw: 0.08, roll: 0.1, flick: -0.55 }, ease: easeOut2 },
      { t: release, p: { x: -0.03, y: 0.0, z: -0.1, pitch: -0.25, yaw: -0.4, roll: -0.05, flick: 0.75 }, ease: easeIn3 },
      { t: release + 110, p: { x: -0.04, y: -0.04, z: -0.1, pitch: -0.42, yaw: -0.55, roll: -0.1, flick: 0.95 }, ease: easeOut3 },
      { t: release + 300, p: { x: -0.02, y: -0.14, z: -0.03, pitch: -0.4, yaw: -0.2, flick: 0.4 }, ease: easeInOut },
      { t: show, p: { x: 0, y: -0.2, z: 0, pitch: -0.35, flick: 0.2 }, ease: easeInOut },
      { t: end, p: {}, ease: settle },
    ];
  }
  return [
    { t: 0, p: {}, ease: easeOut2 },
    { t: 32, p: { x: 0.01, y: 0.02, z: 0.04, pitch: 0.34, yaw: 0.06, roll: 0.08, flick: -0.6 }, ease: easeOut2 },
    { t: release, p: { x: -0.03, y: 0.0, z: -0.09, pitch: -0.22, yaw: -0.38, roll: -0.04, flick: 0.8 }, ease: easeIn3 },
    { t: release + 60, p: { x: -0.04, y: -0.035, z: -0.09, pitch: -0.4, yaw: -0.5, roll: -0.08, flick: 1.0 }, ease: easeOut3 },
    { t: show, p: { x: -0.01, y: -0.17, z: -0.02, pitch: -0.35, yaw: -0.15, flick: 0.3 }, ease: easeInOut },
    { t: end, p: {}, ease: settle },
  ];
}

function sample(keys: Key[], t: number, out: Pose): void {
  for (const f of FIELDS) out[f] = 0;
  if (t <= keys[0]!.t || t >= keys[keys.length - 1]!.t) return;
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1]!.t) i++;
  const a = keys[i]!, b = keys[i + 1]!;
  const k = b.ease(THREE.MathUtils.clamp((t - a.t) / Math.max(1, b.t - a.t), 0, 1));
  for (const f of FIELDS) { const va = a.p[f] ?? 0, vb = b.p[f] ?? 0; out[f] = va + (vb - va) * k; }
}

export class ViewModel {
  readonly root = new THREE.Group();
  private rig: FpRig;
  private phase = 0;
  private landing = 0;
  private wasGround = true;
  private team: Team | null = null;
  private pose: Pose = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0, flick: 0 };
  private keys = new Map<string, Key[]>();
  private q = new THREE.Quaternion();
  private restPos = REST_POS.clone();
  private restRot = REST_ROT.clone();
  private qRest = new THREE.Quaternion();
  private qOff = new THREE.Quaternion();
  private e = new THREE.Euler();
  private pivot = new THREE.Vector3();
  /** Rest pose of the arm and grips (kept on the instance so it can be tuned live while reviewing). */
  private rest: FpPose = JSON.parse(JSON.stringify(FP_REST)) as FpPose;

  constructor() {
    this.rig = buildFpHand();
    this.root.add(this.rig.root);
    applyRest(this.rig, this.rest);
    this.setTeam(0);
  }

  /** Re-applies `rest` after it was changed (review and tuning only). */
  applyRest(): void { applyRest(this.rig, this.rest); }

  setTeam(team: Team): void {
    if (team === this.team) return;
    this.team = team;
    this.rig.sleeve.color.setHex(team === 0 ? COLORS.sol : COLORS.luna);
  }

  private timeline(weapon: WeaponId, release: number, cooldown: number): Key[] {
    const id = `${weapon}:${cooldown}`;
    let k = this.keys.get(id);
    if (!k) {
      // Same moment as before: the fresh item shows once 45% of the time between release and the end of the cooldown has passed.
      k = throwKeys(weapon, release, release + 0.45 * (cooldown - release), cooldown);
      this.keys.set(id, k);
    }
    return k;
  }

  update(s: ViewState, dt: number, reducedMotion: boolean): void {
    this.root.visible = s.alive;
    if (!s.alive) return;
    const def = WEAPONS[s.weapon]!;
    if (!this.wasGround && s.onGround) this.landing = 1;
    this.wasGround = s.onGround;
    this.landing = Math.max(0, this.landing - dt * 5);
    const moving = s.speed > 0.5 && s.onGround;
    this.phase += dt * (moving ? 7 + s.speed : 0);
    const motion = reducedMotion ? 0.25 : 1;
    const bobX = moving ? Math.sin(this.phase) * 0.012 * motion : 0;
    const bobY = moving ? Math.abs(Math.cos(this.phase)) * 0.012 * motion : Math.sin(performance.now() * 0.0018) * 0.003 * motion;
    const sway = moving ? Math.sin(this.phase) * 0.03 * motion : 0;

    // Throw timeline.
    const release = s.weapon === 1 ? 160 : 90;
    const t = s.msSinceThrow;
    let visible = true;
    const p = this.pose;
    if (t < def.cooldownMs) {
      if (t >= release) {
        const k = (t - release) / Math.max(1, def.cooldownMs - release);
        // Empty hand comes back down, then a fresh chancla rises into it.
        visible = k > 0.45;
      }
      sample(this.timeline(s.weapon, release, def.cooldownMs), t, p);
      if (reducedMotion) {
        // Smaller swing; the drop that hides the swap stays deep enough to read.
        const drop = p.y;
        for (const f of FIELDS) p[f] *= 0.4;
        if (t >= release) p.y = Math.min(p.y, drop * 0.75);
      }
    } else {
      for (const f of FIELDS) p[f] = 0;
    }
    // Weapon switch: lower out, raise in (eased, with a small tilt).
    let sw = 0;
    if (s.switchMs > 0) {
      const k = 1 - s.switchMs / WEAPON_SWITCH_MS;
      sw = k < 0.5 ? k * 2 : (1 - k) * 2;
      sw = sw * sw * (3 - 2 * sw);
    }
    // Swings turn about the elbow (behind and below the wrist), so a forward
    // pitch sends the hand forward and down instead of lifting the elbow.
    const r = this.rig.root;
    this.qRest.setFromEuler(this.restRot);
    this.pivot.set(...this.rest.elbow).normalize().applyQuaternion(this.qRest).multiplyScalar(PIVOT).add(this.restPos);
    this.e.set(p.pitch - sw * 0.35 * (reducedMotion ? 0.5 : 1) - this.landing * 0.05 * motion, p.yaw, p.roll + sway - sw * 0.2);
    this.qOff.setFromEuler(this.e);
    r.quaternion.copy(this.qOff).multiply(this.qRest);
    r.position.copy(this.restPos).sub(this.pivot).applyQuaternion(this.qOff).add(this.pivot);
    r.position.x += bobX + p.x + sw * 0.03;
    r.position.y += bobY + p.y - sw * 0.26 - this.landing * 0.03 * motion - (s.crouched ? 0.02 : 0);
    r.position.z += p.z;
    const grip = this.rig.grips[s.weapon];
    this.rig.hand.quaternion.copy(this.q.setFromAxisAngle(grip.userData.flickAxis as THREE.Vector3, p.flick));
    this.rig.grips[0].visible = s.weapon === 0;
    this.rig.grips[1].visible = s.weapon === 1;
    // Without the chancla the fingers close into a loose fist instead of
    // gripping air (the hand is built round the sole).
    this.rig.skins[0].scale.set(visible ? 1 : 0.86, visible ? 1 : 0.55, 1);
    this.rig.items[0].visible = visible && s.weapon === 0;
    this.rig.items[1].visible = visible && s.weapon === 1;
  }
}
