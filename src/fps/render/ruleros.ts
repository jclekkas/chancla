// Flying ruleros: the hair rollers that pop off a Rosa hit in the face by
// El Revés. Purely cosmetic: no collision with players, no pickups, no
// effect on the game. A fixed pool of small meshes (one shared geometry, a
// few cached materials) with hand-rolled motion: an arc, a spin, a short
// bounce on the paving and a shrink out. Never more than POOL alive; the
// oldest is reused if more are asked for.
import * as THREE from 'three';
import { COLORS, OUTLINE, toon } from './materials';
import { markShared } from '../../models/sandal';

/**
 * Roller colours by slot, shared with the ones drawn on the avatars: pink,
 * mint, lilac and coral, chosen to stand apart from both team colours and
 * Team Sol's straw hat.
 */
export const RULERO_COLORS = [COLORS.pink, 0x86e0c8, 0xb48ad8, 0xff8a6b] as const;

let geo: THREE.CylinderGeometry | null = null;
const mats = new Map<number, THREE.MeshToonMaterial>();

export function ruleroGeometry(): THREE.CylinderGeometry {
  if (!geo) { geo = new THREE.CylinderGeometry(0.034, 0.034, 0.1, 10); markShared(geo); }
  return geo;
}

export function ruleroMaterial(slot: number): THREE.MeshToonMaterial {
  const c = RULERO_COLORS[slot % RULERO_COLORS.length]!;
  let m = mats.get(c);
  if (!m) { m = toon(c, { emissive: 0x1a1010 }); mats.set(c, m); }
  return m;
}

/** One roller mesh with its ink outline (for avatars and the pool). */
export function ruleroMesh(slot: number): THREE.Mesh {
  const m = new THREE.Mesh(ruleroGeometry(), ruleroMaterial(slot));
  const o = new THREE.Mesh(ruleroGeometry(), OUTLINE);
  o.scale.setScalar(1.14);
  m.add(o);
  return m;
}

interface Flyer {
  mesh: THREE.Mesh;
  slot: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  ground: number;
  age: number;
  life: number;
  bounces: number;
  simple: boolean;
  bornAt: number;
}

export const RULERO_POOL = 12;
const GRAVITY = 14;

export class RuleroFx {
  readonly group = new THREE.Group();
  private flyers: Flyer[] = [];
  private seq = 0;
  /** Spawned since creation (tests). */
  spawned = 0;

  constructor() {
    for (let i = 0; i < RULERO_POOL; i++) {
      const mesh = ruleroMesh(0);
      mesh.visible = false;
      this.group.add(mesh);
      this.flyers.push({ mesh, slot: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), ground: 0, age: 0, life: 0, bounces: 0, simple: false, bornAt: -1 });
    }
  }

  get active(): number { return this.flyers.filter((f) => f.mesh.visible).length; }

  /**
   * Launches one roller from `from` (world position), pushed along `dir`
   * (horizontal, roughly unit) with a pop upward. `ground`: the paving height
   * under the character. `simple`: Low quality (no bounce, shorter life).
   */
  spawn(slot: number, from: THREE.Vector3, dir: THREE.Vector3, ground: number, opts: { simple?: boolean; strength?: number; rand?: () => number } = {}): void {
    const rand = opts.rand ?? Math.random;
    // A free mesh, or the oldest one in flight.
    let f = this.flyers.find((x) => !x.mesh.visible);
    if (!f) f = this.flyers.reduce((a, b) => (a.bornAt <= b.bornAt ? a : b));
    const k = opts.strength ?? 1;
    f.slot = slot;
    f.mesh.material = ruleroMaterial(slot);
    f.pos.copy(from);
    f.vel.set(dir.x * (2.6 + rand() * 0.8) * k, 3.2 + rand() * 1.0, dir.z * (2.6 + rand() * 0.8) * k);
    // A little sideways scatter so several from one hit fan out.
    f.vel.x += (rand() - 0.5) * 1.2;
    f.vel.z += (rand() - 0.5) * 1.2;
    f.spin.set((rand() - 0.5) * 24, (rand() - 0.5) * 10, 14 + rand() * 10);
    f.ground = ground;
    f.age = 0;
    f.simple = !!opts.simple;
    f.life = f.simple ? 0.9 : 1.6;
    f.bounces = 0;
    f.bornAt = ++this.seq;
    f.mesh.visible = true;
    f.mesh.scale.setScalar(1);
    f.mesh.position.copy(from);
    this.spawned++;
  }

  update(dt: number): void {
    for (const f of this.flyers) {
      if (!f.mesh.visible) continue;
      f.age += dt;
      if (f.age >= f.life) { f.mesh.visible = false; continue; }
      f.vel.y -= GRAVITY * dt;
      f.pos.addScaledVector(f.vel, dt);
      const floor = f.ground + 0.035;
      if (f.pos.y < floor) {
        f.pos.y = floor;
        if (!f.simple && f.bounces < 2 && f.vel.y < -1) {
          // A short rubbery bounce, losing most of its energy.
          f.bounces++;
          f.vel.y = -f.vel.y * 0.38;
          f.vel.x *= 0.55; f.vel.z *= 0.55;
          f.spin.multiplyScalar(0.5);
        } else {
          f.vel.set(f.vel.x * 0.9, 0, f.vel.z * 0.9);
          f.spin.multiplyScalar(0.9);
        }
      }
      f.mesh.position.copy(f.pos);
      f.mesh.rotation.x += f.spin.x * dt;
      f.mesh.rotation.y += f.spin.y * dt;
      f.mesh.rotation.z += f.spin.z * dt;
      // Shrink out over the last quarter of its life.
      const tail = f.life * 0.75;
      f.mesh.scale.setScalar(f.age > tail ? Math.max(0.01, 1 - (f.age - tail) / (f.life - tail)) : 1);
    }
  }

  clear(): void {
    for (const f of this.flyers) f.mesh.visible = false;
  }
}
