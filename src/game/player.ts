import * as THREE from 'three';
import { ARENA, PLAYER } from '../config';
import { clamp } from '../core/math';
import { resolveCircle, type AABB } from '../physics/collision';

export class Player {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly knock = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  hp = PLAYER.maxHp;
  invuln = 0;
  alive = true;
  distanceMoved = 0;
  private tmp = { x: 0, z: 0 };

  reset(x: number, z: number, yaw: number): void {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.knock.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.hp = PLAYER.maxHp;
    this.invuln = 0;
    this.alive = true;
    this.distanceMoved = 0;
  }

  look(dYaw: number, dPitch: number): void {
    this.yaw -= dYaw;
    this.pitch = clamp(this.pitch - dPitch, -1.35, 1.35);
  }

  forward(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  flatForward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  right(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  eye(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, PLAYER.eye, this.pos.z);
  }

  // Where returning chanclas fly to: just below and right of the eye.
  hand(out: THREE.Vector3): THREE.Vector3 {
    const r = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    return out.set(this.pos.x + r * 0.25, PLAYER.eye - 0.3, this.pos.z + rz * 0.25);
  }

  update(dt: number, moveX: number, moveZ: number, colliders: readonly AABB[]): void {
    const len = Math.hypot(moveX, moveZ);
    if (len > 1) { moveX /= len; moveZ /= len; }
    if (!this.alive) { moveX = 0; moveZ = 0; }
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // moveZ > 0 is forward.
    const wx = moveX * cos - moveZ * sin;
    const wz = -moveX * sin - moveZ * cos;
    const tx = wx * PLAYER.speed, tz = wz * PLAYER.speed;
    const a = Math.min(1, (len > 0.01 ? PLAYER.accel : PLAYER.friction) * dt);
    this.vel.x += (tx - this.vel.x) * a;
    this.vel.z += (tz - this.vel.z) * a;
    const kd = Math.exp(-PLAYER.knockDecay * dt);
    this.knock.multiplyScalar(kd);
    const nx = this.pos.x + (this.vel.x + this.knock.x) * dt;
    const nz = this.pos.z + (this.vel.z + this.knock.z) * dt;
    resolveCircle(nx, nz, PLAYER.radius, colliders, this.tmp);
    const lim = ARENA.outer - 1;
    this.tmp.x = clamp(this.tmp.x, -lim, lim);
    this.tmp.z = clamp(this.tmp.z, -lim, lim);
    this.distanceMoved += Math.hypot(this.tmp.x - this.pos.x, this.tmp.z - this.pos.z);
    this.pos.x = this.tmp.x;
    this.pos.z = this.tmp.z;
    if (this.invuln > 0) this.invuln -= dt;
  }

  // Returns the damage actually applied (0 while invulnerable).
  damage(amount: number, pushX = 0, pushZ = 0): number {
    if (!this.alive || this.invuln > 0) return 0;
    this.hp = Math.max(0, this.hp - amount);
    this.invuln = PLAYER.invulnTime;
    this.knock.x += pushX;
    this.knock.z += pushZ;
    if (this.hp <= 0) this.alive = false;
    return amount;
  }

  push(x: number, z: number): void {
    this.knock.x += x;
    this.knock.z += z;
  }

  heal(amount: number): number {
    const before = this.hp;
    this.hp = Math.min(PLAYER.maxHp, this.hp + amount);
    return this.hp - before;
  }
}
