// Deterministic first-person movement in a world of axis-aligned boxes.
// The same function runs on the server (authoritative), in the client
// (prediction and replay) and in tests, so identical inputs give identical
// results everywhere.

import { MOVE } from './config';
import type { AABB } from './collision';

const SKIN = 1e-4;
const CELL = 4;

// Uniform-grid broadphase over the static boxes.
export class World {
  readonly boxes: readonly AABB[];
  private grid = new Map<number, number[]>();
  private stamp: Uint32Array;
  private gen = 1;

  constructor(boxes: readonly AABB[]) {
    // A floor slab under everything keeps ground handling uniform.
    this.boxes = [...boxes, { minX: -200, minY: -2, minZ: -200, maxX: 200, maxY: 0, maxZ: 200, bounce: false, blocksSound: true, tag: 'floor' }];
    this.stamp = new Uint32Array(this.boxes.length);
    this.boxes.forEach((b, i) => {
      if (b.tag === 'floor') return;
      for (let gx = Math.floor(b.minX / CELL); gx <= Math.floor(b.maxX / CELL); gx++) {
        for (let gz = Math.floor(b.minZ / CELL); gz <= Math.floor(b.maxZ / CELL); gz++) {
          const k = key(gx, gz);
          let list = this.grid.get(k);
          if (!list) { list = []; this.grid.set(k, list); }
          list.push(i);
        }
      }
    });
  }

  // Calls fn for every box whose footprint may touch the given XZ rectangle.
  query(minX: number, minZ: number, maxX: number, maxZ: number, fn: (b: AABB) => void): void {
    const gen = ++this.gen;
    if (gen > 0xfffffff0) { this.gen = 1; this.stamp.fill(0); }
    fn(this.boxes[this.boxes.length - 1]!);
    for (let gx = Math.floor(minX / CELL); gx <= Math.floor(maxX / CELL); gx++) {
      for (let gz = Math.floor(minZ / CELL); gz <= Math.floor(maxZ / CELL); gz++) {
        const list = this.grid.get(key(gx, gz));
        if (!list) continue;
        for (const i of list) {
          if (this.stamp[i] === this.gen) continue;
          this.stamp[i] = this.gen;
          fn(this.boxes[i]!);
        }
      }
    }
  }

  // Boxes near a segment, for projectile sweeps and line-of-sight checks.
  near(x0: number, z0: number, x1: number, z1: number, pad: number): AABB[] {
    const out: AABB[] = [];
    this.query(Math.min(x0, x1) - pad, Math.min(z0, z1) - pad, Math.max(x0, x1) + pad, Math.max(z0, z1) + pad, (b) => out.push(b));
    return out;
  }
}

function key(gx: number, gz: number): number {
  return (gx + 512) * 1024 + (gz + 512);
}

export interface Body {
  x: number;
  y: number; // feet
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  crouched: boolean;
}

export interface MoveInput {
  mx: number; // strafe, -1..1 (right positive)
  mz: number; // forward, -1..1
  yaw: number;
  jump: boolean;
  crouch: boolean;
}

export function newBody(x: number, y: number, z: number): Body {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: true, crouched: false };
}

export function bodyHeight(b: Body): number {
  return b.crouched ? MOVE.crouchHeight : MOVE.standHeight;
}

export function eyeHeight(b: Body): number {
  return b.crouched ? MOVE.eyeCrouch : MOVE.eyeStand;
}

function overlaps(w: World, x: number, y: number, z: number, h: number): boolean {
  const hw = MOVE.halfWidth;
  let hit = false;
  w.query(x - hw, z - hw, x + hw, z + hw, (bx) => {
    if (hit) return;
    if (x + hw > bx.minX + SKIN && x - hw < bx.maxX - SKIN && z + hw > bx.minZ + SKIN && z - hw < bx.maxZ - SKIN && y + h > bx.minY + SKIN && y < bx.maxY - SKIN) hit = true;
  });
  return hit;
}

// How far the body can move along one axis before touching a box.
function sweepAxis(w: World, b: Body, h: number, axis: 0 | 1 | 2, d: number): number {
  if (d === 0) return 0;
  const hw = MOVE.halfWidth;
  const minX = b.x - hw, maxX = b.x + hw, minY = b.y, maxY = b.y + h, minZ = b.z - hw, maxZ = b.z + hw;
  let allowed = d;
  const qx0 = axis === 0 ? Math.min(minX, minX + d) : minX;
  const qx1 = axis === 0 ? Math.max(maxX, maxX + d) : maxX;
  const qz0 = axis === 2 ? Math.min(minZ, minZ + d) : minZ;
  const qz1 = axis === 2 ? Math.max(maxZ, maxZ + d) : maxZ;
  w.query(qx0, qz0, qx1, qz1, (bx) => {
    if (axis !== 0 && !(maxX > bx.minX + SKIN && minX < bx.maxX - SKIN)) return;
    if (axis !== 1 && !(maxY > bx.minY + SKIN && minY < bx.maxY - SKIN)) return;
    if (axis !== 2 && !(maxZ > bx.minZ + SKIN && minZ < bx.maxZ - SKIN)) return;
    const lo = axis === 0 ? minX : axis === 1 ? minY : minZ;
    const hi = axis === 0 ? maxX : axis === 1 ? maxY : maxZ;
    const bLo = axis === 0 ? bx.minX : axis === 1 ? bx.minY : bx.minZ;
    const bHi = axis === 0 ? bx.maxX : axis === 1 ? bx.maxY : bx.maxZ;
    if (d > 0 && bLo >= hi - SKIN * 2) allowed = Math.min(allowed, Math.max(0, bLo - hi - SKIN));
    else if (d < 0 && bHi <= lo + SKIN * 2) allowed = Math.max(allowed, Math.min(0, bHi - lo + SKIN));
  });
  return allowed;
}

// Advances a body by one fixed step. `speedScale` lets the server apply
// gameplay modifiers without changing the shared rules.
export function stepMove(w: World, b: Body, inp: MoveInput, dt: number): void {
  // Crouch, and only stand back up if there is headroom.
  if (inp.crouch) b.crouched = true;
  else if (b.crouched && !overlaps(w, b.x, b.y, b.z, MOVE.standHeight)) b.crouched = false;
  const h = bodyHeight(b);

  // Wish direction from strafe/forward and yaw (yaw 0 looks toward -z).
  let mx = clampUnit(inp.mx), mz = clampUnit(inp.mz);
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const sin = Math.sin(inp.yaw), cos = Math.cos(inp.yaw);
  const wx = mx * cos - mz * sin;
  const wz = -mx * sin - mz * cos;
  const speed = b.crouched ? MOVE.crouchSpeed : MOVE.walkSpeed;
  const tx = wx * speed, tz = wz * speed;

  // Horizontal acceleration: snappy on the ground, limited in the air.
  const moving = len > 0.01;
  const accel = b.onGround ? (moving ? MOVE.groundAccel : MOVE.groundDecel) : MOVE.airAccel;
  const dvx = tx - b.vx, dvz = tz - b.vz;
  const dl = Math.hypot(dvx, dvz);
  const maxDv = accel * dt;
  if (dl <= maxDv) { b.vx = tx; b.vz = tz; } else { b.vx += (dvx / dl) * maxDv; b.vz += (dvz / dl) * maxDv; }

  let jumped = false;
  if (inp.jump && b.onGround) {
    b.vy = MOVE.jumpSpeed;
    b.onGround = false;
    jumped = true;
  }
  b.vy = Math.max(-MOVE.maxFallSpeed, b.vy - MOVE.gravity * dt);
  const wasGround = b.onGround;

  // Horizontal motion, one axis at a time, with step-up for stairs.
  for (const axis of [0, 2] as const) {
    const d = (axis === 0 ? b.vx : b.vz) * dt;
    if (d === 0) continue;
    const allowed = sweepAxis(w, b, h, axis, d);
    if (Math.abs(allowed - d) < 1e-7) {
      if (axis === 0) b.x += d; else b.z += d;
      continue;
    }
    let done = false;
    if (wasGround) {
      const up = sweepAxis(w, b, h, 1, MOVE.stepHeight);
      if (up > 0.05) {
        const savedY = b.y;
        b.y += up;
        const raised = sweepAxis(w, b, h, axis, d);
        if (Math.abs(raised) > Math.abs(allowed) + 0.01) {
          if (axis === 0) b.x += raised; else b.z += raised;
          // Settle onto the step immediately.
          const down = sweepAxis(w, b, h, 1, -up);
          b.y += down;
          done = true;
        } else {
          b.y = savedY;
        }
      }
    }
    if (!done) {
      if (axis === 0) { b.x += allowed; b.vx = 0; } else { b.z += allowed; b.vz = 0; }
    }
  }

  // Vertical motion: land on floors, bump ceilings.
  const dy = b.vy * dt;
  const ay = sweepAxis(w, b, h, 1, dy);
  b.y += ay;
  if (Math.abs(ay - dy) > 1e-7) {
    if (dy < 0) { b.onGround = true; b.vy = 0; } else { b.vy = 0; }
  } else {
    b.onGround = false;
    // Stick to the ground when walking down stairs or off small ledges.
    if (wasGround && !jumped && b.vy <= 0) {
      const snap = sweepAxis(w, b, h, 1, -MOVE.stepHeight);
      if (snap > -MOVE.stepHeight + 1e-6) {
        b.y += snap;
        b.onGround = true;
        b.vy = 0;
      }
    }
  }
  if (b.onGround && b.vy < 0) b.vy = 0;
}

function clampUnit(v: number): number {
  return Number.isFinite(v) ? (v < -1 ? -1 : v > 1 ? 1 : v) : 0;
}

// Moves a body out of anything it overlaps (used after spawning or teleports).
export function settle(w: World, b: Body): void {
  for (let i = 0; i < 12 && overlaps(w, b.x, b.y, b.z, bodyHeight(b)); i++) b.y += 0.25;
  const down = sweepAxis(w, b, bodyHeight(b), 1, -50);
  b.y += down;
  b.onGround = true;
  b.vy = 0;
}

export function bodyOverlaps(w: World, b: Body): boolean {
  return overlaps(w, b.x, b.y, b.z, bodyHeight(b));
}
