import * as THREE from 'three';
import { CHANCLA, LEGEND } from '../config';
import { sweepWorld, segmentCapsule, segmentSphere, type AABB, type WorldHit } from '../physics/collision';
import { buildSandal, GOLD_SKIN } from '../models/sandal';
import { Trail, trailMaterial } from '../fx/trail';
import { PALETTE } from '../world/palette';

// Every chancla has a clear lifecycle:
//   held -> flying -> returning -> held      (Rosa's two real chanclas)
//   idle -> flying -> idle                    (golden Legendaria copies)
// A flying chancla can damage each target at most once, ricochets off one
// solid surface at most, and always ends its flight by range, time, impact
// or recall. Returning chanclas ignore collisions and home in on the hand,
// with a timeout that snaps them back, so ammunition can never be lost.

export type ChanclaState = 'held' | 'flying' | 'returning' | 'idle';

export interface HitTarget {
  id: number;
  kind: 'enemy' | 'boss' | 'dummy';
  x: number;
  z: number;
  y0: number;
  y1: number;
  r: number;
  // Optional protective sphere (the boss's sound shield).
  shield?: { x: number; y: number; z: number; r: number } | null;
}

export interface Chancla {
  slot: number;
  golden: boolean;
  state: ChanclaState;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  gravity: number;
  charge: number;
  damage: number;
  knock: number;
  traveled: number;
  flightT: number;
  returnT: number;
  bounces: number;
  ricocheted: boolean;
  hits: Set<number>;
  hitAny: boolean;
  pierceLeft: number;
  throwId: number;
  spin: number;
  model: THREE.Group;
  trail: Trail;
}

export interface ChanclaEvents {
  // Return true when the hit was valid (target alive and damageable).
  onHit(c: Chancla, target: HitTarget, point: THREE.Vector3): boolean;
  onBounce(c: Chancla, point: THREE.Vector3, normal: THREE.Vector3): void;
  onBlocked(c: Chancla, point: THREE.Vector3): void;
  onLand(c: Chancla, point: THREE.Vector3): void;
  onFlightEnd(c: Chancla): void;
  onCatch(c: Chancla): void;
  onSplash(c: Chancla, point: THREE.Vector3): void;
}

const hitTmp: WorldHit = { t: 0, nx: 0, ny: 0, nz: 0, box: null, ground: false };
const next = new THREE.Vector3();
const point = new THREE.Vector3();
const normal = new THREE.Vector3();
const toHand = new THREE.Vector3();
const shieldC = new THREE.Vector3();

let throwCounter = 0;

export class ChanclaSystem {
  readonly real: Chancla[] = [];
  readonly golden: Chancla[] = [];
  readonly group = new THREE.Group();
  private cooldown = 0;
  private events: ChanclaEvents;

  constructor(events: ChanclaEvents) {
    this.events = events;
    const realMat = trailMaterial(false);
    const goldMat = trailMaterial(true);
    for (let i = 0; i < CHANCLA.count; i++) this.real.push(this.make(i, false, realMat));
    for (let i = 0; i < LEGEND.pool; i++) this.golden.push(this.make(100 + i, true, goldMat));
  }

  private make(slot: number, golden: boolean, mat: THREE.Material): Chancla {
    const model = buildSandal(golden ? GOLD_SKIN : undefined, golden);
    model.scale.setScalar(golden ? 1.9 : 1.7);
    model.visible = false;
    const trail = new Trail(mat, golden ? 0.13 : 0.07);
    trail.setColor(golden ? PALETTE.gold : PALETTE.cream);
    this.group.add(model, trail.mesh);
    return {
      slot, golden, state: golden ? 'idle' : 'held',
      pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(),
      gravity: 0, charge: 0, damage: 0, knock: 0, traveled: 0, flightT: 0, returnT: 0,
      bounces: 0, ricocheted: false, hits: new Set(), hitAny: false, pierceLeft: 0,
      throwId: 0, spin: 0, model, trail,
    };
  }

  reset(): void {
    for (const c of this.real) this.toHeld(c);
    for (const c of this.golden) this.toIdle(c);
    this.cooldown = 0;
  }

  heldCount(): number {
    let n = 0;
    for (const c of this.real) if (c.state === 'held') n++;
    return n;
  }

  activeCount(): number {
    let n = 0;
    for (const c of this.real) if (c.state !== 'held') n++;
    for (const c of this.golden) if (c.state !== 'idle') n++;
    return n;
  }

  canThrow(): boolean {
    return this.cooldown <= 0 && this.heldCount() > 0;
  }

  // Launch a real chancla. `vel` is the full launch velocity.
  throwReal(origin: THREE.Vector3, vel: THREE.Vector3, charge: number): Chancla | null {
    if (this.cooldown > 0) return null;
    const c = this.real.find((r) => r.state === 'held');
    if (!c) return null;
    this.launch(c, origin, vel, charge);
    c.gravity = THREE.MathUtils.lerp(CHANCLA.quickGravity, CHANCLA.chargedGravity, charge);
    c.damage = charge >= 0.5 ? CHANCLA.chargedDamage : CHANCLA.quickDamage;
    c.knock = THREE.MathUtils.lerp(CHANCLA.quickKnock, CHANCLA.chargedKnock, charge);
    c.pierceLeft = 0;
    this.cooldown = CHANCLA.minRethrow;
    return c;
  }

  throwGolden(origin: THREE.Vector3, vel: THREE.Vector3): Chancla | null {
    const c = this.golden.find((g) => g.state === 'idle');
    if (!c) return null;
    this.launch(c, origin, vel, 1);
    c.gravity = 2;
    c.damage = LEGEND.damage;
    c.knock = CHANCLA.chargedKnock;
    c.pierceLeft = LEGEND.pierce;
    return c;
  }

  private launch(c: Chancla, origin: THREE.Vector3, vel: THREE.Vector3, charge: number): void {
    c.state = 'flying';
    c.pos.copy(origin);
    c.prev.copy(origin);
    c.vel.copy(vel);
    c.charge = charge;
    c.traveled = 0;
    c.flightT = 0;
    c.returnT = 0;
    c.bounces = 0;
    c.ricocheted = false;
    c.hits.clear();
    c.hitAny = false;
    c.throwId = ++throwCounter;
    c.spin = Math.random() * Math.PI * 2;
    c.model.visible = true;
    c.model.position.copy(origin);
    c.trail.reset(origin);
  }

  recallAll(): number {
    let n = 0;
    for (const c of this.real) {
      if (c.state === 'flying') {
        this.endFlight(c);
        n++;
      }
    }
    return n;
  }

  private endFlight(c: Chancla): void {
    if (c.state !== 'flying') return;
    this.events.onFlightEnd(c);
    if (c.golden) {
      this.toIdle(c);
    } else {
      c.state = 'returning';
      c.returnT = 0;
    }
  }

  private toHeld(c: Chancla): void {
    c.state = 'held';
    c.model.visible = false;
    c.trail.hide();
    c.hits.clear();
    c.vel.set(0, 0, 0);
  }

  private toIdle(c: Chancla): void {
    c.state = 'idle';
    c.model.visible = false;
    c.trail.hide();
    c.hits.clear();
  }

  step(dt: number, hand: THREE.Vector3, colliders: readonly AABB[], targets: readonly HitTarget[]): void {
    if (this.cooldown > 0) this.cooldown -= dt;
    for (const c of this.real) this.stepOne(c, dt, hand, colliders, targets);
    for (const c of this.golden) this.stepOne(c, dt, hand, colliders, targets);
  }

  private stepOne(c: Chancla, dt: number, hand: THREE.Vector3, colliders: readonly AABB[], targets: readonly HitTarget[]): void {
    if (c.state === 'flying') this.stepFlying(c, dt, colliders, targets);
    else if (c.state === 'returning') this.stepReturning(c, dt, hand);
  }

  private stepFlying(c: Chancla, dt: number, colliders: readonly AABB[], targets: readonly HitTarget[]): void {
    c.flightT += dt;
    c.vel.y -= c.gravity * dt;
    c.prev.copy(c.pos);
    next.copy(c.pos).addScaledVector(c.vel, dt);

    // Find the earliest contact along this step's segment.
    let bestT = 2;
    let bestKind: 'none' | 'target' | 'shield' | 'world' = 'none';
    let bestTarget: HitTarget | null = null;
    for (const tg of targets) {
      if (tg.shield) {
        shieldC.set(tg.shield.x, tg.shield.y, tg.shield.z);
        const ts = segmentSphere(c.pos, next, CHANCLA.radius, shieldC, tg.shield.r);
        if (ts >= 0 && ts < bestT) { bestT = ts; bestKind = 'shield'; bestTarget = tg; }
        continue;
      }
      if (c.hits.has(tg.id)) continue;
      const t = segmentCapsule(c.pos, next, CHANCLA.radius, tg.x, tg.z, tg.y0, tg.y1, tg.r);
      if (t >= 0 && t < bestT) { bestT = t; bestKind = 'target'; bestTarget = tg; }
    }
    if (sweepWorld(c.pos, next, CHANCLA.radius, colliders, hitTmp) && hitTmp.t < bestT) {
      bestT = hitTmp.t;
      bestKind = 'world';
    }

    if (bestKind === 'none') {
      c.traveled += c.pos.distanceTo(next);
      c.pos.copy(next);
    } else {
      point.copy(c.pos).lerp(next, Math.max(0, bestT));
      c.traveled += c.pos.distanceTo(point);
      if (bestKind === 'target' && bestTarget) {
        c.hits.add(bestTarget.id);
        const valid = this.events.onHit(c, bestTarget, point);
        c.pos.copy(point);
        if (valid) {
          c.hitAny = true;
          if (c.golden) {
            this.events.onSplash(c, point);
            if (c.pierceLeft > 0) {
              c.pierceLeft--;
            } else {
              this.endFlight(c);
              return;
            }
          } else {
            // Pop up off the target, then head home.
            c.vel.multiplyScalar(-0.15);
            c.vel.y = 3;
            this.endFlight(c);
            return;
          }
        }
      } else if (bestKind === 'shield' && bestTarget?.shield) {
        const s = bestTarget.shield;
        normal.set(point.x - s.x, point.y - s.y, point.z - s.z).normalize();
        c.pos.copy(point).addScaledVector(normal, 0.02);
        this.events.onBlocked(c, point);
        if (c.golden || c.bounces >= 1) {
          this.endFlight(c);
          return;
        }
        c.vel.reflect(normal).multiplyScalar(CHANCLA.restitution);
        c.bounces++;
        c.ricocheted = true;
      } else {
        normal.set(hitTmp.nx, hitTmp.ny, hitTmp.nz);
        c.pos.copy(point).addScaledVector(normal, 0.02);
        const canBounce = !hitTmp.ground && hitTmp.box !== null && hitTmp.box.bounce && c.bounces < 1 && !c.golden;
        if (canBounce) {
          c.vel.reflect(normal).multiplyScalar(CHANCLA.restitution);
          c.bounces++;
          c.ricocheted = true;
          this.events.onBounce(c, point, normal);
        } else {
          if (c.golden) this.events.onSplash(c, point);
          else this.events.onLand(c, point);
          this.endFlight(c);
          return;
        }
      }
    }

    if (c.traveled > CHANCLA.maxRange || c.flightT > (c.golden ? LEGEND.life : CHANCLA.maxFlight)) {
      this.endFlight(c);
    }
  }

  private stepReturning(c: Chancla, dt: number, hand: THREE.Vector3): void {
    c.returnT += dt;
    const speed = Math.min(CHANCLA.returnSpeedMax, CHANCLA.returnSpeedMin + CHANCLA.returnAccel * c.returnT);
    toHand.subVectors(hand, c.pos);
    const d = toHand.length();
    c.prev.copy(c.pos);
    if (d <= CHANCLA.catchRadius || c.returnT >= CHANCLA.returnTimeout) {
      this.toHeld(c);
      this.events.onCatch(c);
      return;
    }
    const stepLen = Math.min(speed * dt, d);
    // Blend the pop-up velocity into a homing direction for a nice arc.
    const blend = Math.min(1, c.returnT * 6);
    toHand.multiplyScalar(1 / d);
    c.vel.lerp(toHand.multiplyScalar(speed), blend);
    const vlen = c.vel.length();
    if (vlen > 0) c.pos.addScaledVector(c.vel, stepLen / vlen);
    if (c.pos.y < 0.15) c.pos.y = 0.15;
  }

  // Visual update: spin, orientation and trails. Runs once per render frame.
  render(dt: number, camera: THREE.Camera, alpha: number): void {
    const all = [this.real, this.golden];
    for (const list of all) {
      for (const c of list) {
        if (c.state !== 'flying' && c.state !== 'returning') continue;
        const m = c.model;
        m.position.copy(c.prev).lerp(c.pos, alpha);
        const spinRate = c.state === 'flying' ? 24 + c.charge * 16 : 30;
        c.spin += spinRate * dt;
        // Lie roughly flat and spin like a frisbee around the travel axis.
        m.rotation.set(0.35 * Math.sin(c.spin * 0.25), c.spin, 0.25);
        c.trail.push(m.position, dt);
        c.trail.update(camera);
      }
    }
  }
}
