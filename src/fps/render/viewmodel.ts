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
//
// Around the attacks, everything is stepped on dt (exponential smoothing,
// dt clamped) so it reads the same at any frame rate: the walk bob eases in
// and out, a landing dips and recovers, the hand trails a turn slightly
// (off with reduced motion, and it steps aside during an attack), and a
// switch lowers the chancla in hand, swaps it out of sight and raises the
// other one on its own clock.
import * as THREE from 'three';
import { MELEE, WEAPONS, WEAPON_SWITCH_MS, type WeaponId } from '../../../shared/config';
import type { Team } from '../../../shared/map';
import { applyRest, buildFpHand, FP_REST, type FpPose, type FpRig } from './fp-hand';
import { buildFpHandArena, FP_REST_ARENA, type HandQuality } from './fp-hand-arena';
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
  /** Your look direction (radians, as the camera's yaw and pitch): the hand trails a turn slightly. Optional. */
  lookYaw?: number;
  lookPitch?: number;
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

const ZERO: Pose = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0, flick: 0 };
/** Longest frame the motion is stepped over (a stall must not fling the hand). */
const DT_MAX = 0.1;
/** Fraction left of a gap after `dt` seconds of exponential smoothing with time constant `tau`. */
const keep = (dt: number, tau: number) => Math.exp(-dt / tau);
const clamp = THREE.MathUtils.clamp;
const smooth = (k: number) => { const c = clamp(k, 0, 1); return c * c * (3 - 2 * c); };

/** Layer of the timeline that drives the hand this frame. */
const enum Layer { Idle, Throw, Melee }

export interface ViewModelOptions {
  /** Build the sculpted arena hand instead of the original one (opt-in; the campaign leaves it off). */
  arena?: boolean;
  /** Tessellation tier of the arena hand (default 'high'); the original hand has one tier and ignores it. */
  quality?: HandQuality;
}

export class ViewModel {
  readonly root = new THREE.Group();
  private rig: FpRig;
  /** Both hands, each built on first use. */
  private rigs: { base?: FpRig; arena?: FpRig } = {};
  private handQuality: HandQuality = 'high';
  private phase = 0;
  private team: Team | null = null;
  private pose: Pose = { ...ZERO };
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
  private restBase: FpPose = JSON.parse(JSON.stringify(FP_REST)) as FpPose;
  private restArena: FpPose = JSON.parse(JSON.stringify(FP_REST_ARENA)) as FpPose;
  private rest: FpPose = this.restBase;

  // Secondary motion, all stepped on dt so it reads the same at any frame rate.
  private clock = 0;
  /** Walk amount 0..1 (eased in and out, so the bob never starts or stops at once). */
  private walk = 0;
  private crouch = 0;
  private wasGround = true;
  private sinceLand = 1e9;
  /** Smoothed look rate (rad/s), for the hand's lag behind a turn. */
  private look = { yaw: 0, pitch: 0, vy: 0, vp: 0, known: false };
  /** How engaged the hand is in an attack 0..1 (secondary motion steps aside). */
  private engaged = 0;

  // Weapon switch on the view model's own clock: lower the chancla in hand,
  // swap at the bottom, raise the other one.
  /** The chancla the hand holds on screen, and the one asked for. */
  private shown: WeaponId = 0;
  private target: WeaponId | -1 = -1;
  private swOn = false;
  private swMs = 0;
  private swFrom = 0;
  private swBack = false;
  private sw = 0;

  // A throw belongs to the chancla thrown; switching away ends its animation.
  private throwWeapon: WeaponId = 0;
  private throwCut = false;
  private lastThrowT = Infinity;

  /** What the last frame's timeline left behind when it changed layer, fading out. */
  private layer = Layer.Idle;
  private layerPose: Pose = { ...ZERO };
  private missPose: Pose = { ...ZERO };
  private missOn = false;
  private carry: Pose = { ...ZERO };

  /**
   * `arena`: the shooter's arena view builds the sculpted hand (fp-hand-arena.ts).
   * Without it (the campaign) the original hand is built exactly as before.
   */
  constructor(opts: ViewModelOptions = {}) {
    this.handQuality = opts.quality ?? 'high';
    this.rig = this.rigFor(opts.arena === true);
    this.root.add(this.rig.root);
    this.setTeam(0);
  }

  /** Built with the sculpted arena hand (the constructor option, then setArena). */
  get arena(): boolean { return this.rig === this.rigs.arena; }

  /**
   * Swaps between the original hand and the sculpted arena hand. Each is
   * built once, on first use, and kept; switching only swaps which one is in
   * the scene (the pose is recomputed from the same state on the next update).
   */
  setArena(on: boolean): void {
    const next = this.rigFor(on);
    if (next === this.rig) return;
    this.root.remove(this.rig.root);
    this.rig = next;
    this.rest = on ? this.restArena : this.restBase;
    this.root.add(next.root);
    const team = this.team;
    this.team = null;
    if (team !== null) this.setTeam(team);
  }

  /** The arena hand's tier (kept while the original hand is shown, and used when the arena hand is next built). */
  get quality(): HandQuality { return this.handQuality; }

  /**
   * Rebuilds the arena hand at another tessellation tier. The new rig takes
   * over the old one's transforms, sleeve colour and visibility at once, and
   * everything else (weapon shown, switch, attack timelines, smoothing) lives
   * on the view model, so the hand carries on mid-swing without a reset.
   * The old rig is disposed (its skin, sleeve, trim and ink geometry and its
   * materials; the chanclas' geometry, ink material and toon ramp are shared
   * and stay). While the original hand is shown it is left alone: the arena
   * hand, if built, is dropped and rebuilt at the new tier when next shown.
   */
  setQuality(q: HandQuality): void {
    if (q === this.handQuality) return;
    this.handQuality = q;
    const old = this.rigs.arena;
    if (!old) return;
    if (this.rig !== old) { old.dispose(); delete this.rigs.arena; return; }
    const next = buildFpHandArena(q);
    applyRest(next, this.restArena);
    const copy = (a: THREE.Object3D, b: THREE.Object3D) => { b.position.copy(a.position); b.quaternion.copy(a.quaternion); b.scale.copy(a.scale); b.visible = a.visible; };
    copy(old.root, next.root);
    copy(old.hand, next.hand);
    for (const i of [0, 1] as const) {
      copy(old.grips[i], next.grips[i]);
      next.grips[i].userData.flickAxis = old.grips[i].userData.flickAxis;
      copy(old.items[i], next.items[i]);
      copy(old.skins[i], next.skins[i]);
    }
    next.sleeve.color.copy(old.sleeve.color);
    this.root.remove(old.root);
    this.root.add(next.root);
    this.rigs.arena = next;
    this.rig = next;
    old.dispose();
  }

  private rigFor(arena: boolean): FpRig {
    const key = arena ? 'arena' : 'base';
    let rig = this.rigs[key];
    if (!rig) {
      rig = arena ? buildFpHandArena(this.handQuality) : buildFpHand();
      applyRest(rig, arena ? this.restArena : this.restBase);
      this.rigs[key] = rig;
    }
    this.rest = arena ? this.restArena : this.restBase;
    return rig;
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

  /** Ends a miss cue at once (death, respawn, a new round). */
  cancelMiss(): void { this.miss.t = 1e9; }

  /** Back to a still hand holding `weapon` (while dead, so a respawn starts clean). */
  private settleAt(weapon: WeaponId): void {
    this.walk = 0; this.crouch = 0; this.engaged = 0; this.sinceLand = 1e9; this.wasGround = true;
    this.look.known = false; this.look.vy = this.look.vp = 0;
    this.shown = weapon; this.target = weapon; this.swOn = false; this.sw = 0;
    this.throwCut = true; this.layer = Layer.Idle; this.missOn = false;
    for (const f of FIELDS) this.carry[f] = this.layerPose[f] = this.missPose[f] = 0;
  }

  /** The switch drop 0..1 this frame (and which chancla is in hand). */
  private switching(s: ViewState, dt: number): number {
    if (this.swOn) this.swMs += dt * 1000;
    if (s.weapon !== this.target) {
      const first = this.target === -1;
      this.target = s.weapon;
      if (first || s.switchMs <= 0) {
        // Not a switch (spawn, a correction): take it as it is.
        this.shown = s.weapon; this.swOn = false; this.sw = 0;
      } else {
        // Starts from wherever the hand is, so a quick switch back never pops.
        // Its clock starts where the simulation's is (it began during this frame).
        this.swOn = true; this.swMs = Math.max(0, WEAPON_SWITCH_MS - s.switchMs); this.swFrom = this.sw; this.swBack = s.weapon === this.shown;
      }
    }
    if (!this.swOn) return (this.sw = 0);
    // Own clock (smooth at any frame rate), never far behind the simulation's.
    const simK = s.switchMs > 0 ? 1 - s.switchMs / WEAPON_SWITCH_MS : 1;
    const k = Math.min(1, Math.max(this.swMs / WEAPON_SWITCH_MS, simK - 0.08));
    let sw: number;
    if (this.swBack) sw = this.swFrom * (1 - smooth(k));
    else if (k < 0.5) sw = this.swFrom + (1 - this.swFrom) * smooth(k * 2);
    else { this.shown = this.target as WeaponId; sw = 1 - smooth(k * 2 - 1); }
    if (k >= 1) { this.swOn = false; this.shown = this.target as WeaponId; sw = 0; }
    return (this.sw = sw);
  }

  update(s: ViewState, dt: number, reducedMotion: boolean): void {
    this.root.visible = s.alive;
    if (!s.alive) { this.cancelMiss(); this.settleAt(s.weapon); return; }
    dt = clamp(dt, 0, DT_MAX);
    this.clock += dt;
    // A miss cue belongs to the chancla that missed: switching ends it.
    if (s.weapon !== this.miss.weapon) this.cancelMiss();
    const motion = reducedMotion ? 0.25 : 1;

    // Walk bob and idle breathing, crossfaded on the walk amount.
    const moving = s.speed > 0.5 && s.onGround;
    this.walk += ((moving ? 1 : 0) - this.walk) * (1 - keep(dt, 0.12));
    this.phase += dt * (7 + s.speed) * (this.walk > 0.01 ? 1 : 0);
    const w = this.walk * motion;
    const bobX = Math.sin(this.phase) * 0.012 * w;
    const bobY = Math.abs(Math.cos(this.phase)) * 0.012 * w + Math.sin(this.clock * 1.8) * 0.003 * motion * (1 - this.walk);
    const sway = Math.sin(this.phase) * 0.03 * w;
    // Landing: a dip that eases in and out over a few tenths of a second.
    if (!this.wasGround && s.onGround) this.sinceLand = 0;
    this.wasGround = s.onGround;
    this.sinceLand += dt;
    const u = this.sinceLand / 0.06;
    const landing = u < 12 ? u * Math.exp(1 - u) : 0;
    this.crouch += ((s.crouched ? 1 : 0) - this.crouch) * (1 - keep(dt, 0.08));

    const sw = this.switching(s, dt);

    // Throw timeline, on the chancla that was thrown.
    const t = s.msSinceThrow;
    if (t < this.lastThrowT) { this.throwWeapon = s.weapon; this.throwCut = false; }
    this.lastThrowT = t;
    if (this.shown !== this.throwWeapon) this.throwCut = true;
    const tw = this.throwWeapon, cooldown = WEAPONS[tw]!.cooldownMs;
    const release = tw === 1 ? 160 : 90;
    let visible = true;
    let layer = Layer.Idle;
    const p = this.pose;
    for (const f of FIELDS) p[f] = 0;
    if (t < cooldown && !this.throwCut) {
      layer = Layer.Throw;
      if (t >= release) {
        const k = (t - release) / Math.max(1, cooldown - release);
        // Empty hand comes back down, then a fresh chancla rises into it.
        visible = k > 0.45;
      }
      sample(this.timeline(tw, release, cooldown), t, p);
      if (reducedMotion) {
        // Smaller swing; the drop that hides the swap stays deep enough to read.
        const drop = p.y;
        for (const f of FIELDS) p[f] *= 0.4;
        if (t >= release) p.y = Math.min(p.y, drop * 0.75);
      }
      // Switching away mid-throw: the throw fades as the hand goes down.
      if (this.swOn && this.target !== tw) for (const f of FIELDS) p[f] *= 1 - sw;
    }
    // A melee swing overrides the throw pose, and the item never leaves the hand.
    const mt = s.msSinceMelee ?? 1e9, mw = s.meleeWeapon;
    if (mw !== undefined && mw !== null && mt < MELEE[mw]!.cycleMs) {
      layer = Layer.Melee;
      sample(MELEE_KEYS[mw], mt, p);
      if (reducedMotion) for (const f of FIELDS) p[f] *= 0.5;
      visible = true;
    }
    // Every layer starts and ends at rest, so a change of layer is smooth;
    // only one cut short (a swing over a throw's last moments) leaves a gap,
    // which fades out from where the hand was instead of jumping.
    const ck = keep(dt, 0.07);
    for (const f of FIELDS) this.carry[f] *= ck;
    if (layer !== this.layer) for (const f of FIELDS) this.carry[f] += this.layerPose[f] * ck;
    this.layer = layer;
    for (const f of FIELDS) this.layerPose[f] = p[f];

    // A confirmed miss. Both swings end with the hand at the edge of the
    // view (El Revés to the right, El Chanclazo low to the left), so going
    // further would not be seen: it gives a short push past the end, then
    // the arm swings back into view toward the middle, off balance, the
    // chancla wobbling, as if it met nothing. Added to the pose in progress,
    // so nothing restarts; a late miss arrives weaker (strength).
    const m = this.missPose;
    this.miss.t += dt;
    const md = this.miss.weapon === 1 ? 0.5 : 0.4;
    const missing = this.miss.t < md;
    // Cut short (a switch, a new round): ease out of it instead.
    if (!missing && this.missOn) for (const f of FIELDS) this.carry[f] += m[f] * ck;
    this.missOn = missing;
    for (const f of FIELDS) m[f] = 0;
    if (missing) {
      const u = this.miss.t / md;
      const push = u < 0.22 ? Math.sin((u / 0.22) * Math.PI) : 0;
      const back = u > 0.15 ? Math.sin(((u - 0.15) / 0.85) * Math.PI) * (1 - 0.35 * u) : 0;
      const wob = Math.sin(u * Math.PI * 5) * (1 - u) * (u > 0.15 ? 1 : 0);
      const dir = this.miss.weapon === 1 ? 1 : -1, k = this.miss.k * (reducedMotion ? 0.4 : 1) * (this.miss.weapon === 1 ? 1 : 0.85);
      const lobe = 0.6 * push - back; // + past the end, - back toward the middle
      m.x = dir * 0.11 * lobe * k; m.yaw = -dir * 0.3 * lobe * k;
      m.y = (0.07 * back - 0.02 * push) * k; m.pitch = -0.1 * back * k;
      m.roll = dir * 0.22 * wob * k; m.flick = 0.45 * wob * k;
    }
    for (const f of FIELDS) p[f] += m[f] + this.carry[f];

    // Look lag: the hand trails a turn slightly and catches up. Kept small
    // and mostly away from the crosshair; off with reduced motion, and it
    // steps aside during an attack so the swing reads as authored.
    this.engaged += ((layer !== Layer.Idle || missing ? 1 : 0) - this.engaged) * (1 - keep(dt, 0.1));
    const L = this.look;
    if (s.lookYaw !== undefined && s.lookPitch !== undefined) {
      if (L.known && dt > 0) {
        const dy = Math.atan2(Math.sin(s.lookYaw - L.yaw), Math.cos(s.lookYaw - L.yaw));
        const a = 1 - keep(dt, 0.09);
        L.vy += (clamp(dy / dt, -8, 8) - L.vy) * a;
        L.vp += (clamp((s.lookPitch - L.pitch) / dt, -8, 8) - L.vp) * a;
      }
      L.yaw = s.lookYaw; L.pitch = s.lookPitch; L.known = true;
    } else {
      L.known = false; L.vy *= keep(dt, 0.09); L.vp *= keep(dt, 0.09);
    }
    const lag = reducedMotion ? 0 : 1 - 0.7 * this.engaged;
    const lagX = clamp(L.vy * 0.0035, -0.008, 0.016) * lag;
    const lagY = clamp(-L.vp * 0.003, -0.01, 0.01) * lag;
    const lagYaw = clamp(-L.vy * 0.01, -0.035, 0.035) * lag;
    const lagPitch = clamp(-L.vp * 0.008, -0.025, 0.025) * lag;

    // Swings turn about the elbow (behind and below the wrist), so a forward
    // pitch sends the hand forward and down instead of lifting the elbow.
    const r = this.rig.root;
    this.qRest.setFromEuler(this.restRot);
    this.pivot.set(...this.rest.elbow).normalize().applyQuaternion(this.qRest).multiplyScalar(PIVOT).add(this.restPos);
    this.e.set(p.pitch - sw * 0.35 * (reducedMotion ? 0.5 : 1) - landing * 0.05 * motion + lagPitch, p.yaw + lagYaw, p.roll + sway - sw * 0.2);
    this.qOff.setFromEuler(this.e);
    r.quaternion.copy(this.qOff).multiply(this.qRest);
    r.position.copy(this.restPos).sub(this.pivot).applyQuaternion(this.qOff).add(this.pivot);
    r.position.x += bobX + p.x + sw * 0.03 + lagX;
    r.position.y += bobY + p.y - sw * 0.26 - landing * 0.03 * motion - this.crouch * 0.02 + lagY;
    r.position.z += p.z;
    const held = this.shown;
    const grip = this.rig.grips[held];
    this.rig.hand.quaternion.copy(this.q.setFromAxisAngle(grip.userData.flickAxis as THREE.Vector3, p.flick));
    this.rig.grips[0].visible = held === 0;
    this.rig.grips[1].visible = held === 1;
    // Without the chancla the fingers close into a loose fist instead of
    // gripping air (the hand is built round the sole).
    this.rig.skins[0].scale.set(visible ? 1 : 0.86, visible ? 1 : 0.55, 1);
    this.rig.items[0].visible = visible && held === 0;
    this.rig.items[1].visible = visible && held === 1;
  }
}
