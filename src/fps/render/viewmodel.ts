// First-person hands. Timing comes straight from the predicted weapon state,
// so the throw animation always lines up with when the chancla leaves.
//
// The arm is a shooter-only rig (fp-hand.ts): a hand that wraps the held
// chancla or La Pesada, a team-coloured sleeve, toon shading with ink
// outlines. The throw is keyframed on the weapon's own clock: a short
// wind-up, a snap forward with a wrist flick peaking at release (90 ms light,
// 160 ms heavy), a follow-through, the empty hand dropping away and a fresh
// item rising into it before the cooldown ends.
//
// Melee keeps the item in the hand: El Chanclazo is a forehand from the
// right across the view, El Revés a backhand drawn across the chest and
// swung out to the right. The strike passes the centre of the view inside
// each attack's contact window (config.ts MELEE).
import * as THREE from 'three';
import { MELEE, WEAPONS, WEAPON_SWITCH_MS, type WeaponId } from '../../../shared/config';
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
  /** Your swing in progress (predicted): time since it started, and the chancla it uses. */
  msSinceMelee?: number;
  meleeWeapon?: WeaponId | null;
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

function meleeKeys(weapon: WeaponId): Key[] {
  const d = MELEE[weapon]!;
  const hit0 = d.windupMs, hit1 = d.windupMs + d.activeMs, mid = (hit0 + hit1) / 2;
  // Signs in camera space: +x right, +y up, -z ahead; a positive yaw turns the
  // hand about the elbow toward the LEFT of the view, a negative one to the right.
  if (weapon === 1) {
    // El Revés: the hand is drawn across to the left of the view at face
    // height, wrist cocked (wind-up); through the contact window it sweeps
    // out to the right, crossing the centre of the view where the face is,
    // the back of the hand leading; then it carries on out to the right.
    // The path is mostly position; the small rotations only orient the hand.
    return [
      { t: 0, p: {}, ease: easeOut2 },
      { t: hit0 * 0.55, p: { x: -0.3, y: 0.12, z: 0.05, pitch: 0.2, yaw: 0.25, roll: 0.1, flick: -0.55 }, ease: easeOut2 },
      { t: hit0, p: { x: -0.48, y: 0.17, z: 0.04, pitch: 0.25, yaw: 0.35, roll: 0.15, flick: -0.85 }, ease: easeInOut },
      { t: mid, p: { x: -0.3, y: 0.26, z: -0.12, pitch: 0.18, yaw: 0.05, roll: 0, flick: 0.2 }, ease: easeIn3 },
      { t: hit1, p: { x: -0.04, y: 0.2, z: -0.12, pitch: 0.1, yaw: -0.35, roll: -0.2, flick: 0.9 }, ease: easeOut3 },
      { t: hit1 + 220, p: { x: 0.16, y: 0.0, z: -0.05, pitch: -0.12, yaw: -0.8, roll: -0.35, flick: 1.0 }, ease: easeOut3 },
      { t: d.cycleMs, p: {}, ease: settle },
    ];
  }
  // El Chanclazo: a quick forehand, cocked back to the right, then across to
  // the left, palm leading, with a short follow-through.
  return [
    { t: 0, p: {}, ease: easeOut2 },
    { t: hit0 * 0.6, p: { x: 0.08, y: 0.08, z: 0.06, pitch: 0.12, yaw: -0.6, roll: -0.3, flick: -0.7 }, ease: easeOut2 },
    { t: hit0, p: { x: -0.04, y: 0.12, z: -0.12, pitch: 0.1, yaw: -0.1, roll: -0.05, flick: 0.3 }, ease: easeIn3 },
    { t: hit1, p: { x: -0.26, y: 0.08, z: -0.12, pitch: 0.02, yaw: 0.6, roll: 0.25, flick: 1.0 }, ease: easeOut3 },
    { t: hit1 + 140, p: { x: -0.34, y: -0.04, z: -0.06, pitch: -0.25, yaw: 0.85, roll: 0.3, flick: 0.6 }, ease: easeOut2 },
    { t: d.cycleMs, p: {}, ease: settle },
  ];
}
const MELEE_KEYS: Record<WeaponId, Key[]> = { 0: meleeKeys(0), 1: meleeKeys(1) };

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
  /** A confirmed miss: the hand overruns the way the swing was going, then settles (seconds since, strength, weapon). */
  private miss = { t: 1e9, k: 0, weapon: 0 as WeaponId };
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

  /**
   * Your swing missed (confirmed by the server): the hand carries on past
   * the end of the swing and settles back, layered on the pose it is in, so
   * a late event never replays the swing. `strength` 0..1 (lateness).
   */
  whiff(weapon: WeaponId, strength: number): void {
    if (strength <= 0) return;
    this.miss.t = 0; this.miss.k = Math.min(1, strength); this.miss.weapon = weapon;
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
    // A melee swing overrides the throw pose, and the item never leaves the hand.
    const mt = s.msSinceMelee ?? 1e9, mw = s.meleeWeapon;
    if (mw !== undefined && mw !== null && mt < MELEE[mw]!.cycleMs) {
      sample(MELEE_KEYS[mw], mt, p);
      if (reducedMotion) for (const f of FIELDS) p[f] *= 0.5;
      visible = true;
    }
    // A confirmed miss. Both swings end with the hand at the edge of the
    // view (El Revés to the right, El Chanclazo low to the left), so going
    // further would not be seen: it gives a short push past the end, then
    // the arm swings back into view toward the middle, off balance, the
    // chancla wobbling, as if it met nothing. Added to the pose in progress,
    // so nothing restarts; a late miss arrives weaker (strength).
    this.miss.t += dt;
    const md = this.miss.weapon === 1 ? 0.5 : 0.4;
    if (this.miss.t < md) {
      const u = this.miss.t / md;
      const push = u < 0.22 ? Math.sin((u / 0.22) * Math.PI) : 0;
      const back = u > 0.15 ? Math.sin(((u - 0.15) / 0.85) * Math.PI) * (1 - 0.35 * u) : 0;
      const wob = Math.sin(u * Math.PI * 5) * (1 - u) * (u > 0.15 ? 1 : 0);
      const dir = this.miss.weapon === 1 ? 1 : -1, k = this.miss.k * (reducedMotion ? 0.4 : 1) * (this.miss.weapon === 1 ? 1 : 0.85);
      const lobe = 0.6 * push - back; // + past the end, - back toward the middle
      p.x += dir * 0.11 * lobe * k; p.yaw -= dir * 0.3 * lobe * k;
      p.y += (0.07 * back - 0.02 * push) * k; p.pitch -= 0.1 * back * k;
      p.roll += dir * 0.22 * wob * k; p.flick += 0.45 * wob * k;
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
