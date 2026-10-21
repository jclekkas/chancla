import * as THREE from 'three';
import { resolveCircle, lineOfSight, type AABB } from '../physics/collision';
import type { NavGrid } from '../world/nav';
import type { HazardSystem } from './hazards';
import { buildBocinas, buildInfluencer, buildSoplador, type Rig } from '../models/characters';
import type { Rng } from '../core/rng';
import { clamp, damp, wrapAngle } from '../core/math';
import type { HitTarget } from './chanclas';
import type { SpawnPoint } from '../world/arena';

export type EnemyKind = 'bocinas' | 'influencer' | 'soplador';

export type EnemyState = 'enter' | 'move' | 'telegraph' | 'attack' | 'recover' | 'pose' | 'hurt' | 'dying' | 'inactive';

interface KindDef {
  hp: number;
  speed: number;
  radius: number;
  capR: number;
  capTop: number;
  rangeMin: number;
  rangeMax: number;
  cooldown: [number, number];
}

export const ENEMY_DEFS: Record<EnemyKind, KindDef> = {
  bocinas: { hp: 3, speed: 2.7, radius: 0.45, capR: 0.48, capTop: 1.85, rangeMin: 5.5, rangeMax: 9.5, cooldown: [3.0, 4.2] },
  influencer: { hp: 2, speed: 5.0, radius: 0.4, capR: 0.42, capTop: 1.85, rangeMin: 6, rangeMax: 11, cooldown: [2.6, 3.8] },
  soplador: { hp: 4, speed: 3.5, radius: 0.5, capR: 0.55, capTop: 1.85, rangeMin: 2.2, rangeMax: 4.2, cooldown: [2.4, 3.2] },
};

export interface EnemyContext {
  player: THREE.Vector3;
  colliders: readonly AABB[];
  nav: NavGrid;
  hazards: HazardSystem;
  rng: Rng;
  // Scales telegraph durations: >1 is more forgiving (early waves).
  telegraphScale: number;
  say(e: Enemy, line: string | null): void;
  onAttack(e: Enemy, kind: 'cone' | 'gust' | 'heart'): void;
}

export interface HitOutcome {
  valid: boolean;
  killed: boolean;
  interrupted: boolean;
  posing: boolean;
}

const tmp = { x: 0, z: 0 };
const pA = new THREE.Vector3();
const pB = new THREE.Vector3();
const vTmp = new THREE.Vector3();

let nextId = 1;

export class Enemy {
  readonly id = nextId++;
  readonly kind: EnemyKind;
  readonly def: KindDef;
  readonly rig: Rig;
  state: EnemyState = 'inactive';
  stateT = 0;
  hp = 0;
  readonly pos = new THREE.Vector3();
  readonly knock = new THREE.Vector3();
  facing = 0;
  attackCd = 0;
  poseCd = 0;
  path: number[] = [];
  pathI = 0;
  repath = 0;
  strafe = 1;
  walkPhase = 0;
  flinch = 0;
  entryX = 0;
  entryZ = 0;
  hurtTime = 0;
  firedThisPose = false;
  deathSpin = 0;
  lift = 0;
  liftVel = 0;
  sayCd = 0;

  constructor(kind: EnemyKind) {
    this.kind = kind;
    this.def = ENEMY_DEFS[kind];
    this.rig = kind === 'bocinas' ? buildBocinas() : kind === 'influencer' ? buildInfluencer() : buildSoplador();
    this.rig.root.visible = false;
  }

  get active(): boolean {
    return this.state !== 'inactive';
  }

  get alive(): boolean {
    return this.state !== 'inactive' && this.state !== 'dying';
  }

  get posing(): boolean {
    return this.state === 'pose';
  }

  spawn(sp: SpawnPoint, rng: Rng): void {
    this.state = 'enter';
    this.stateT = 0;
    this.hp = this.def.hp;
    this.pos.set(sp.x, 0, sp.z);
    this.knock.set(0, 0, 0);
    this.entryX = sp.entryX + rng.range(-0.8, 0.8);
    this.entryZ = sp.entryZ + rng.range(-0.8, 0.8);
    this.attackCd = rng.range(1.2, 2.2);
    this.poseCd = rng.range(1.5, 2.5);
    this.path.length = 0;
    this.pathI = 0;
    this.repath = 0;
    this.strafe = rng.chance(0.5) ? 1 : -1;
    this.flinch = 0;
    this.lift = 0;
    this.liftVel = 0;
    this.deathSpin = 0;
    this.sayCd = rng.range(0.5, 2);
    this.facing = Math.atan2(-(this.entryX - sp.x), -(this.entryZ - sp.z));
    this.rig.root.visible = true;
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.set(0, this.facing, 0);
    this.rig.body.rotation.set(0, 0, 0);
    this.rig.body.position.set(0, 0.95, 0);
    this.rig.stars.visible = false;
    if (this.rig.flash) this.rig.flash.visible = false;
  }

  deactivate(): void {
    this.state = 'inactive';
    this.rig.root.visible = false;
  }

  target(out: HitTarget): HitTarget {
    out.id = this.id;
    out.kind = 'enemy';
    out.x = this.pos.x;
    out.z = this.pos.z;
    out.y0 = 0.3 + this.lift;
    out.y1 = this.def.capTop + this.lift;
    out.r = this.def.capR;
    out.shield = null;
    return out;
  }

  // Applies one chancla hit. Each throw calls this at most once per enemy.
  takeHit(damage: number, dirX: number, dirZ: number, knock: number, charged: boolean, hazards: HazardSystem): HitOutcome {
    if (!this.alive) return { valid: false, killed: false, interrupted: false, posing: false };
    const posing = this.state === 'pose';
    const interrupted = this.state === 'telegraph' && hazards.cancelOwner(this.id) > 0;
    const dmg = posing ? damage * 2 : damage;
    this.hp -= dmg;
    const len = Math.hypot(dirX, dirZ) || 1;
    this.knock.x += (dirX / len) * knock;
    this.knock.z += (dirZ / len) * knock;
    this.flinch = 1;
    if (this.hp <= 0) {
      this.state = 'dying';
      this.stateT = 0;
      this.liftVel = 3.5 + knock * 0.15;
      this.deathSpin = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 2);
      hazards.cancelOwner(this.id);
      return { valid: true, killed: true, interrupted, posing };
    }
    this.state = 'hurt';
    this.stateT = 0;
    this.hurtTime = charged ? 0.6 : 0.35;
    this.attackCd = Math.max(this.attackCd, interrupted ? 1.6 : 0.8);
    if (this.rig.flash) this.rig.flash.visible = false;
    return { valid: true, killed: false, interrupted, posing };
  }

  update(dt: number, ctx: EnemyContext, others: readonly Enemy[]): void {
    if (this.state === 'inactive') return;
    this.stateT += dt;
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.sayCd > 0) this.sayCd -= dt;
    this.flinch = Math.max(0, this.flinch - dt * 3);

    if (this.state === 'dying') {
      this.updateDying(dt, ctx);
      this.animate(dt, 0);
      return;
    }

    const px = ctx.player.x, pz = ctx.player.z;
    const dx = px - this.pos.x, dz = pz - this.pos.z;
    const dist = Math.hypot(dx, dz);
    let moveX = 0, moveZ = 0;
    let speed = this.def.speed;
    let faceTarget = true;

    switch (this.state) {
      case 'enter': {
        const ex = this.entryX - this.pos.x, ez = this.entryZ - this.pos.z;
        const ed = Math.hypot(ex, ez);
        if (ed < 0.6 || this.stateT > 6) {
          this.setState('move');
          if (this.sayCd <= 0) { ctx.say(this, null); this.sayCd = 6; }
        } else {
          moveX = ex / ed; moveZ = ez / ed;
        }
        faceTarget = false;
        break;
      }
      case 'move': {
        const los = this.hasLos(ctx);
        if (this.kind === 'bocinas') {
          if (dist > this.def.rangeMax || !los) [moveX, moveZ] = this.follow(ctx, px, pz, dt);
          else if (dist < this.def.rangeMin) { moveX = -dx / dist; moveZ = -dz / dist; speed *= 0.7; }
          else if (this.attackCd <= 0) this.startTelegraph(ctx, dx, dz);
        } else if (this.kind === 'soplador') {
          if (dist > this.def.rangeMax || !los) [moveX, moveZ] = this.follow(ctx, px, pz, dt);
          else if (this.attackCd <= 0) this.startTelegraph(ctx, dx, dz);
          else if (dist < this.def.rangeMin) { moveX = -dx / dist; moveZ = -dz / dist; speed *= 0.5; }
        } else {
          // Influencer: circle the player at mid range, then stop to pose.
          this.poseCd -= dt;
          if (this.poseCd <= 0 && los && dist < 15) {
            this.setState('pose');
            this.firedThisPose = false;
            if (this.sayCd <= 0) { ctx.say(this, null); this.sayCd = 4; }
            break;
          }
          if (dist > this.def.rangeMax + 2 || !los) {
            [moveX, moveZ] = this.follow(ctx, px, pz, dt);
          } else {
            const desired = (this.def.rangeMin + this.def.rangeMax) / 2;
            const radial = clamp((dist - desired) / 3, -1, 1);
            const tx = -dz / dist * this.strafe, tz = dx / dist * this.strafe;
            moveX = (dx / dist) * radial + tx;
            moveZ = (dz / dist) * radial + tz;
            const ml = Math.hypot(moveX, moveZ) || 1;
            moveX /= ml; moveZ /= ml;
            // Swap orbit direction if the way ahead is blocked.
            if (!ctx.nav.isFree(this.pos.x + moveX * 1.2, this.pos.z + moveZ * 1.2)) this.strafe *= -1;
          }
        }
        break;
      }
      case 'telegraph': {
        faceTarget = false;
        const tele = this.kind === 'soplador' ? 0.85 : 1.25;
        if (this.stateT >= tele * ctx.telegraphScale) {
          this.setState('attack');
        }
        break;
      }
      case 'attack': {
        faceTarget = false;
        if (this.stateT >= (this.kind === 'soplador' ? 0.5 : 0.35)) this.setState('recover');
        break;
      }
      case 'recover': {
        if (this.stateT >= 0.7) {
          this.setState('move');
          this.attackCd = ctx.rng.range(this.def.cooldown[0], this.def.cooldown[1]);
        }
        break;
      }
      case 'pose': {
        const poseTime = 1.9 * Math.min(1.2, ctx.telegraphScale);
        if (!this.firedThisPose && this.stateT >= poseTime) {
          this.firedThisPose = true;
          this.rig.root.updateMatrixWorld(true);
          pA.set(this.pos.x, 1.6, this.pos.z);
          pB.set(px, 1.2, pz);
          vTmp.subVectors(pB, pA).normalize().multiplyScalar(8.5);
          ctx.hazards.orb({ owner: this.id, source: 'influencer', style: 'heart', from: pA, vel: vTmp, damage: 9, push: 0.6 });
          ctx.onAttack(this, 'heart');
        }
        if (this.stateT >= poseTime + 0.35) {
          this.setState('move');
          this.poseCd = ctx.rng.range(this.def.cooldown[0], this.def.cooldown[1]);
          this.strafe = ctx.rng.chance(0.5) ? 1 : -1;
          if (this.rig.flash) this.rig.flash.visible = false;
        }
        break;
      }
      case 'hurt': {
        if (this.stateT >= this.hurtTime) this.setState('move');
        faceTarget = true;
        break;
      }
    }

    // Separation from other enemies and the player.
    let sx = 0, sz = 0;
    for (const o of others) {
      if (o === this || !o.alive) continue;
      const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z;
      const d2 = ox * ox + oz * oz;
      if (d2 < 1.6 && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        sx += (ox / d) * (1.3 - d);
        sz += (oz / d) * (1.3 - d);
      }
    }
    if (dist < 1.4 && dist > 1e-3) {
      sx -= (dx / dist) * (1.4 - dist) * 2;
      sz -= (dz / dist) * (1.4 - dist) * 2;
    }

    const kd = Math.exp(-5 * dt);
    this.knock.multiplyScalar(kd);
    const vx = moveX * speed + sx * 3 + this.knock.x;
    const vz = moveZ * speed + sz * 3 + this.knock.z;
    const ox = this.pos.x, oz = this.pos.z;
    resolveCircle(this.pos.x + vx * dt, this.pos.z + vz * dt, this.def.radius, ctx.colliders, tmp);
    this.pos.x = tmp.x;
    this.pos.z = tmp.z;
    const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);

    // Facing.
    let want = this.facing;
    if (faceTarget && dist > 0.1) want = Math.atan2(-dx, -dz);
    else if (moved > 1e-3 && this.state === 'enter') want = Math.atan2(-(this.pos.x - ox), -(this.pos.z - oz));
    this.facing += wrapAngle(want - this.facing) * Math.min(1, dt * 8);
    this.animate(dt, moved / Math.max(dt, 1e-4));
  }

  private hasLos(ctx: EnemyContext): boolean {
    pA.set(this.pos.x, 1.2, this.pos.z);
    pB.set(ctx.player.x, 1.2, ctx.player.z);
    return lineOfSight(pA, pB, ctx.colliders);
  }

  private follow(ctx: EnemyContext, tx: number, tz: number, dt: number): [number, number] {
    this.repath -= dt;
    if (this.repath <= 0 || this.pathI >= this.path.length) {
      this.repath = 0.5 + (this.id % 5) * 0.05;
      ctx.nav.findPath(this.pos.x, this.pos.z, tx, tz, this.path);
      this.pathI = 0;
    }
    while (this.pathI < this.path.length) {
      const wx = this.path[this.pathI]! - this.pos.x;
      const wz = this.path[this.pathI + 1]! - this.pos.z;
      const d = Math.hypot(wx, wz);
      if (d < 0.45) { this.pathI += 2; continue; }
      return [wx / d, wz / d];
    }
    return [0, 0];
  }

  private startTelegraph(ctx: EnemyContext, dx: number, dz: number): void {
    const dir = Math.atan2(dx, dz);
    this.facing = Math.atan2(-dx, -dz);
    this.setState('telegraph');
    const scale = ctx.telegraphScale;
    if (this.kind === 'bocinas') {
      ctx.hazards.cone({
        owner: this.id, source: 'bocinas', x: this.pos.x, z: this.pos.z, y: 1.3, dir, range: 10, half: 0.42,
        telegraph: 1.25 * scale, live: 0.35, damage: 14, push: 5,
      });
      ctx.onAttack(this, 'cone');
    } else {
      ctx.hazards.cone({
        owner: this.id, source: 'soplador', x: this.pos.x, z: this.pos.z, y: 1.0, dir, range: 5.5, half: 0.62,
        telegraph: 0.85 * scale, live: 0.5, damage: 7, push: 14, color: 0x3f7537,
      });
      ctx.onAttack(this, 'gust');
    }
    if (this.sayCd <= 0 && ctx.rng.chance(0.5)) { ctx.say(this, null); this.sayCd = 5; }
  }

  private setState(s: EnemyState): void {
    this.state = s;
    this.stateT = 0;
  }

  private updateDying(dt: number, ctx: EnemyContext): void {
    // Cartoon pratfall: launched up and back, flop, see stars, then poof.
    this.liftVel -= 14 * dt;
    this.lift += this.liftVel * dt;
    if (this.lift < 0) {
      this.lift = 0;
      this.liftVel = Math.abs(this.liftVel) > 2 ? -this.liftVel * 0.35 : 0;
    }
    this.knock.multiplyScalar(Math.exp(-3 * dt));
    resolveCircle(this.pos.x + this.knock.x * dt, this.pos.z + this.knock.z * dt, this.def.radius, ctx.colliders, tmp);
    this.pos.x = tmp.x;
    this.pos.z = tmp.z;
  }

  get dyingDone(): boolean {
    return this.state === 'dying' && this.stateT > 1.9;
  }

  private animate(dt: number, speed: number): void {
    const r = this.rig;
    r.root.position.set(this.pos.x, this.lift, this.pos.z);
    r.root.rotation.y = this.facing;
    if (this.state === 'dying') {
      const k = Math.min(1, this.stateT / 0.45);
      r.body.rotation.x = damp(r.body.rotation.x, 1.45, 10, dt) * 1;
      r.body.rotation.z += this.deathSpin * dt * (1 - k * 0.8);
      r.body.position.y = 0.95 - k * 0.7;
      r.legL.rotation.x = -1.2 * k;
      r.legR.rotation.x = -0.6 * k;
      r.armL.rotation.z = -2.2 * k;
      r.armR.rotation.z = 2.2 * k;
      r.stars.visible = this.stateT > 0.5;
      r.stars.rotation.y += dt * 6;
      r.mouth.scale.set(0.12, 0.09, 0.02);
      return;
    }
    // Walk cycle driven by actual movement speed.
    const moving = speed > 0.3 && this.state !== 'hurt';
    this.walkPhase += dt * (moving ? 3 + speed * 1.6 : 0);
    const swing = moving ? Math.sin(this.walkPhase) * Math.min(0.75, 0.25 + speed * 0.12) : 0;
    r.legL.rotation.x = damp(r.legL.rotation.x, swing, 14, dt);
    r.legR.rotation.x = damp(r.legR.rotation.x, -swing, 14, dt);
    r.body.position.y = 0.95 + (moving ? Math.abs(Math.cos(this.walkPhase)) * 0.05 : 0);
    let armLx = -swing * 0.8, armRx = swing * 0.8, armRz = 0, bodyX = 0, bodyZ = 0, headX = 0, headZ = 0;
    let mouth = 0.04;
    const shake = this.state === 'telegraph' ? Math.sin(this.stateT * 60) * 0.03 : 0;
    if (this.kind === 'bocinas') {
      armRx = -0.5;
      if (this.state === 'telegraph' || this.state === 'attack') { armRx = -1.5; mouth = 0.1; bodyX = -0.12; }
    } else if (this.kind === 'soplador') {
      armRx = -1.2;
      armLx = -1.0;
      if (this.state === 'telegraph') { bodyX = 0.12; mouth = 0.08; }
      if (this.state === 'attack') { bodyX = 0.2 + Math.sin(this.stateT * 80) * 0.05; }
    } else {
      if (this.state === 'pose') {
        armRx = -2.7; armRz = 0.25; bodyZ = 0.15; headZ = -0.2; headX = -0.15; mouth = 0.06;
        if (r.flash) {
          const poseTime = 1.9;
          r.flash.visible = this.stateT > poseTime - 0.6 ? Math.sin(this.stateT * 40) > 0 : Math.sin(this.stateT * 9) > 0.85;
        }
      }
    }
    if (this.state === 'hurt') {
      bodyX = 0.45 * Math.max(0, 1 - this.stateT / this.hurtTime);
      mouth = 0.1;
      armLx = -1.5; armRx = -1.5;
    }
    r.armL.rotation.x = damp(r.armL.rotation.x, armLx, 12, dt);
    r.armR.rotation.x = damp(r.armR.rotation.x, armRx, 12, dt);
    r.armR.rotation.z = damp(r.armR.rotation.z, armRz, 12, dt);
    r.armL.rotation.z = damp(r.armL.rotation.z, 0, 12, dt);
    r.body.rotation.x = damp(r.body.rotation.x, bodyX + this.flinch * 0.3, 14, dt);
    r.body.rotation.z = damp(r.body.rotation.z, bodyZ + shake, 14, dt);
    r.head.rotation.x = damp(r.head.rotation.x, headX, 10, dt);
    r.head.rotation.z = damp(r.head.rotation.z, headZ, 10, dt);
    r.mouth.scale.y = damp(r.mouth.scale.y, mouth, 16, dt);
    const squash = 1 + this.flinch * 0.12;
    r.body.scale.set(squash, 1 / squash, squash);
  }
}

export class EnemySystem {
  readonly group = new THREE.Group();
  readonly pool: Enemy[] = [];
  readonly maxPerKind = 6;

  acquire(kind: EnemyKind): Enemy | null {
    let e = this.pool.find((p) => p.kind === kind && p.state === 'inactive');
    if (!e) {
      const count = this.pool.filter((p) => p.kind === kind).length;
      if (count >= this.maxPerKind) return null;
      e = new Enemy(kind);
      this.pool.push(e);
      this.group.add(e.rig.root);
    }
    return e;
  }

  // Build a few rigs up front so the first wave never stutters.
  prewarm(): void {
    const kinds: EnemyKind[] = ['bocinas', 'influencer', 'soplador'];
    for (const k of kinds) {
      for (let i = 0; i < 3; i++) {
        const e = new Enemy(k);
        this.pool.push(e);
        this.group.add(e.rig.root);
      }
    }
  }

  reset(): void {
    for (const e of this.pool) e.deactivate();
  }

  get active(): Enemy[] {
    return this.pool.filter((e) => e.active);
  }

  aliveCount(): number {
    let n = 0;
    for (const e of this.pool) if (e.alive) n++;
    return n;
  }

  activeCount(): number {
    let n = 0;
    for (const e of this.pool) if (e.active) n++;
    return n;
  }
}
