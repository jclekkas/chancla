// Rosa's procedural animation, driven by real game timing: locomotion,
// jumps, throws, melee swings, hit reactions, elimination and respawn. It
// only poses the joints in rosa-rig.ts, so it works on any model built to
// that contract. Purely visual: nothing here feeds back into the game.
import type * as THREE from 'three';
import { MELEE, WEAPONS, type WeaponId } from '../../../shared/config';
import type { AvatarState, RosaRig } from './rosa-rig';

// Third-person melee: keyframes for the right arm on the attack's own clock,
// in Rosa's body coordinates (she faces -z; her right is +x):
//   ax  shoulder lift (pi/2: the upper arm level, pointing ahead)
//   ay  shoulder sweep about the vertical (+ across to her left, - out to her right)
//   ez  elbow bend across the body (- folds the hand to her left, + to her right)
//   fx  elbow bend up and down
//   wy  wrist roll about the forearm (turns the sandal's sole to face the travel)
//   tw  torso twist (+ shoulders turned to her left)
// The striking phase sits inside the attack's real contact window (config.ts).
interface ArmKey { t: number; ax: number; ay: number; ez: number; fx: number; wy: number; tw: number }
const REST: Omit<ArmKey, 't'> = { ax: -0.5, ay: 0, ez: 0, fx: -0.6, wy: 0, tw: 0 };
const MELEE_KEYS: Record<WeaponId, ArmKey[]> = {
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

const ARM_FIELDS = ['ax', 'ay', 'ez', 'fx', 'wy', 'tw'] as const;
function sampleArm(keys: ArmKey[], t: number): ArmKey {
  if (t <= keys[0]!.t) return keys[0]!;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!, b = keys[i + 1]!;
    if (t <= b.t) {
      const k = (t - a.t) / Math.max(1, b.t - a.t);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const out = { t } as ArmKey;
      for (const f of ARM_FIELDS) out[f] = a[f] + (b[f] - a[f]) * e;
      return out;
    }
  }
  return keys[keys.length - 1]!;
}

export class RosaAnimator {
  private phase = 0;
  private deadT = -1;
  private spawnT = 1;
  private wasAlive = true;
  private smooth = { lean: 0, hips: 0, crouch: 0 };
  private reactT = 1;
  private reactSide = 1;
  private reactHead = false;

  constructor(private readonly rig: RosaRig) {}

  /**
   * A cartoon flinch from a melee hit: the head snaps aside and the upper
   * body twists, for a third of a second. `side`: +1 knocked to her left, -1 to her right.
   */
  react(head: boolean, side: number): void {
    this.reactT = 0;
    this.reactHead = head;
    this.reactSide = side >= 0 ? 1 : -1;
  }

  /** A confirmed miss (placeholder: the animation pass adds the off-balance follow-through). */
  whiff(_weapon: WeaponId): void { /* placeholder */ }

  update(s: AvatarState, dt: number, reducedMotion: boolean): void {
    const r = this.rig;
    const def = WEAPONS[s.weapon]!;
    // Death and respawn transitions.
    if (this.wasAlive && !s.alive) this.deadT = 0;
    if (!this.wasAlive && s.alive) { this.deadT = -1; this.spawnT = 0; }
    this.wasAlive = s.alive;
    r.root.visible = true;

    if (this.deadT >= 0) {
      // Comic pratfall: a spin, a sit-down, dizzy stars, then a puff out.
      this.deadT += dt;
      const k = Math.min(1, this.deadT / 0.5);
      r.hips.rotation.set(0, 0, 0);
      r.root.rotation.z = 0;
      r.hips.position.y = 0.86 - 0.55 * easeOut(k);
      r.torso.rotation.x = 0.9 * easeOut(k);
      r.torso.rotation.y = (reducedMotion ? 0 : 1) * (1 - k) * 6;
      r.legL.rotation.x = -1.4 * k;
      r.legR.rotation.x = -1.2 * k;
      r.shinL.rotation.x = 0.2 * k;
      r.shinR.rotation.x = 0.2 * k;
      r.armL.rotation.set(-2.6 * k, 0, -0.6 * k);
      r.armR.rotation.set(-2.6 * k, 0, 0.6 * k);
      r.stars.visible = this.deadT > 0.4;
      r.stars.rotation.y += dt * 5;
      for (const w of r.weapons) w.visible = false;
      const fade = this.deadT > 2.2 ? Math.max(0, 1 - (this.deadT - 2.2) / 0.3) : 1;
      r.root.scale.setScalar(Math.max(0.001, fade));
      r.bubble.visible = false;
      return;
    }
    r.stars.visible = false;
    if (this.spawnT < 1) this.spawnT = Math.min(1, this.spawnT + dt / 0.25);
    r.root.scale.setScalar(reducedMotion ? 1 : 0.7 + 0.3 * easeOutBack(this.spawnT));

    // Locomotion.
    const moving = s.speed > 0.4 && s.onGround;
    this.phase += dt * (moving ? 2.4 + s.speed * 1.35 : 0);
    const amp = moving ? Math.min(0.7, 0.18 + s.speed * 0.09) : 0;
    const sw = Math.sin(this.phase) * amp * (s.back > 0.3 ? -1 : 1);
    const crouch = s.crouched ? 1 : 0;
    this.smooth.crouch += (crouch - this.smooth.crouch) * Math.min(1, dt * 14);
    const cr = this.smooth.crouch;
    // Strafing twists the hips toward the motion.
    this.smooth.hips += (s.strafe * 0.55 - this.smooth.hips) * Math.min(1, dt * 8);
    r.hips.rotation.y = this.smooth.hips;
    r.torso.rotation.y = -this.smooth.hips * 0.8;
    const bob = moving && !reducedMotion ? Math.abs(Math.cos(this.phase)) * 0.04 : Math.sin(performance.now() * 0.002) * 0.006;
    r.hips.position.y = 0.86 - cr * 0.42 + bob;
    let legL = sw, legR = -sw, shinL = Math.max(0, -sw) * 0.8, shinR = Math.max(0, sw) * 0.8;
    if (!s.onGround) { legL = -0.7; legR = -0.25; shinL = 0.9; shinR = 0.5; }
    if (cr > 0.01) { legL = legL * (1 - cr) - 1.25 * cr; legR = legR * (1 - cr) - 1.25 * cr; shinL = shinL * (1 - cr) + 1.6 * cr; shinR = shinR * (1 - cr) + 1.6 * cr; }
    r.legL.rotation.x = legL; r.legR.rotation.x = legR;
    r.shinL.rotation.x = shinL; r.shinR.rotation.x = shinR;
    this.smooth.lean += ((moving ? -0.08 : 0) + cr * 0.25 - this.smooth.lean) * Math.min(1, dt * 8);
    r.torso.rotation.x = this.smooth.lean - s.pitch * 0.25;
    r.head.rotation.x = -s.pitch * 0.55;
    r.armL.rotation.set(-sw * 0.9, 0, -0.12);
    r.foreL.rotation.x = -0.4;

    // Throw: a fast wind-up and release, then recovery for the rest of the
    // cooldown. The chancla in hand reappears when the weapon is ready.
    const tThrow = s.msSinceThrow;
    let ax = -0.5 + sw * 0.3, fx = -0.6, twist = 0;
    if (tThrow < def.cooldownMs) {
      const release = s.weapon === 1 ? 160 : 90;
      if (tThrow < release) {
        const k = tThrow / release;
        ax = -2.7 + 3.3 * easeOut(k);
        fx = -0.2;
        twist = (1 - k) * (s.weapon === 1 ? 0.5 : 0.3);
      } else {
        const k = Math.min(1, (tThrow - release) / Math.max(1, def.cooldownMs - release));
        ax = 0.6 + (-0.5 - 0.6) * easeOut(k);
        fx = -0.2 - 0.4 * k;
      }
    }
    let ay = 0, ez = 0, wy = 0;
    // Melee swing: overrides the throw pose; the sandal stays in her hand.
    const tm = s.msSinceMelee ?? 1e9;
    const mdef = MELEE[s.weapon]!;
    const swinging = tm < mdef.cycleMs;
    if (swinging) {
      const k = sampleArm(MELEE_KEYS[s.weapon], tm);
      // Reduced motion: the same swing, smaller (closer to the rest pose).
      const m = reducedMotion ? 0.6 : 1;
      ax = REST.ax + (k.ax - REST.ax) * m; ay = k.ay * m; ez = k.ez * m; fx = REST.fx + (k.fx - REST.fx) * m; wy = k.wy * m; twist = k.tw * m;
    }
    r.armR.rotation.order = 'YXZ'; // the sweep turns about the vertical, outside the arm's lift
    r.armR.rotation.set(ax, ay, 0.1);
    r.foreR.rotation.set(fx, 0, ez);
    r.wristR.rotation.set(0, wy, 0);
    r.torso.rotation.y += twist;
    const inHand = swinging || tThrow > def.cooldownMs * 0.55 || tThrow < (s.weapon === 1 ? 160 : 90);
    r.weapons[0]!.visible = s.weapon === 0 && inHand;
    r.weapons[1]!.visible = s.weapon === 1 && inHand;

    // Melee flinch: the head snaps aside and the shoulders follow.
    if (this.reactT < 1) {
      this.reactT = Math.min(1, this.reactT + dt / 0.34);
      const k = Math.sin(Math.PI * Math.min(1, this.reactT * 1.6)) * (1 - this.reactT) * (reducedMotion ? 0.4 : 1);
      const big = this.reactHead ? 1 : 0.55;
      r.head.rotation.y = this.reactSide * 0.75 * k * big;
      r.head.rotation.z = this.reactSide * 0.3 * k * big;
      r.torso.rotation.y += this.reactSide * 0.28 * k * big;
      r.torso.rotation.z = -this.reactSide * 0.1 * k * big;
    } else {
      r.head.rotation.y = 0;
      r.head.rotation.z = 0;
      r.torso.rotation.z = 0;
    }

    // Hit flinch and flash (playful, brief, not graphic).
    const hitK = s.msSinceHit < 220 ? 1 - s.msSinceHit / 220 : 0;
    r.torso.rotation.x += hitK * 0.35;
    for (const m of r.flashMats) m.emissive.setRGB(hitK * 0.6, hitK * 0.55, hitK * 0.5);

    r.bubble.visible = s.protected;
    if (s.protected) (r.bubble.material as THREE.MeshBasicMaterial).opacity = 0.14 + Math.sin(performance.now() * 0.01) * 0.05;
  }
}

function easeOut(t: number): number { return 1 - (1 - t) * (1 - t); }
function easeOutBack(t: number): number { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
