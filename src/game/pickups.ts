import * as THREE from 'three';
import { buildCafecito } from '../models/characters';

// Cafecito health pickups. Pooled, bobbing, and capped.
export interface Pickup {
  active: boolean;
  x: number;
  z: number;
  t: number;
  heal: number;
  model: THREE.Group;
}

export class PickupSystem {
  readonly group = new THREE.Group();
  readonly items: Pickup[] = [];

  constructor(capacity = 4) {
    for (let i = 0; i < capacity; i++) {
      const model = buildCafecito();
      model.visible = false;
      model.scale.setScalar(1.6);
      this.group.add(model);
      this.items.push({ active: false, x: 0, z: 0, t: 0, heal: 25, model });
    }
  }

  reset(): void {
    for (const p of this.items) {
      p.active = false;
      p.model.visible = false;
    }
  }

  activeCount(): number {
    return this.items.filter((p) => p.active).length;
  }

  spawn(x: number, z: number, heal = 25): boolean {
    if (this.items.some((p) => p.active && Math.hypot(p.x - x, p.z - z) < 1)) return false;
    const p = this.items.find((i) => !i.active);
    if (!p) return false;
    p.active = true;
    p.x = x;
    p.z = z;
    p.t = 0;
    p.heal = heal;
    p.model.position.set(x, 0, z);
    p.model.visible = true;
    return true;
  }

  // Returns the heal amount if the player collected something this step.
  step(dt: number, px: number, pz: number, canHeal: boolean): { heal: number; x: number; z: number } | null {
    let got: { heal: number; x: number; z: number } | null = null;
    for (const p of this.items) {
      if (!p.active) continue;
      p.t += dt;
      p.model.position.y = 0.25 + Math.sin(p.t * 3) * 0.12;
      p.model.rotation.y += dt * 1.6;
      if (canHeal && !got && Math.hypot(px - p.x, pz - p.z) < 1.2) {
        p.active = false;
        p.model.visible = false;
        got = { heal: p.heal, x: p.x, z: p.z };
      }
    }
    return got;
  }
}
