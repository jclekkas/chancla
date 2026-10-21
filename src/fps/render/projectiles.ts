// Pooled projectile visuals with restrained trails, plus impact effects.
import * as THREE from 'three';
import type { WeaponId } from '../../../shared/config';
import { buildSandal } from '../../models/sandal';
import { buildPesada } from './rosa';
import { Trail, trailMaterial } from '../../fx/trail';
import { Particles } from '../../fx/particles';
import type { ClientProjectile } from '../../net/session';

interface Slot {
  mesh: THREE.Group;
  trail: Trail;
  key: string | null;
  spin: number;
}

export class ProjectileView {
  readonly group = new THREE.Group();
  readonly particles = new Particles(360);
  private pools: Record<WeaponId, Slot[]> = { 0: [], 1: [] };
  private rings: Array<{ mesh: THREE.Mesh; t: number }> = [];

  constructor() {
    const mat = [trailMaterial(false), trailMaterial(false)];
    for (const w of [0, 1] as const) {
      for (let i = 0; i < (w === 0 ? 16 : 8); i++) {
        const mesh = w === 0 ? buildSandal() : buildPesada();
        mesh.scale.setScalar(w === 0 ? 1.7 : 1.6);
        mesh.visible = false;
        const trail = new Trail(mat[w]!, w === 0 ? 0.06 : 0.09);
        trail.setColor(w === 0 ? 0xfff2d8 : 0xb98ad8);
        this.group.add(mesh, trail.mesh);
        this.pools[w].push({ mesh, trail, key: null, spin: Math.random() * 6 });
      }
    }
    this.group.add(this.particles.mesh);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32), new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.group.add(m);
      this.rings.push({ mesh: m, t: 1 });
    }
  }

  clear(): void {
    for (const w of [0, 1] as const) for (const s of this.pools[w]) { s.key = null; s.mesh.visible = false; s.trail.hide(); }
    this.particles.clear();
  }

  impact(weapon: WeaponId, pos: [number, number, number], player: boolean): void {
    this.particles.burst('thwap', pos[0], pos[1], pos[2], player ? 14 : 8);
    if (weapon === 1) {
      this.particles.burst('dust', pos[0], Math.max(0.05, pos[1] - 0.3), pos[2], 10);
      const r = this.rings.find((x) => x.t >= 1) ?? this.rings[0]!;
      r.t = 0;
      r.mesh.position.set(pos[0], Math.max(0.05, pos[1] - 0.25), pos[2]);
      r.mesh.visible = true;
    }
  }

  sync(projectiles: Map<string, ClientProjectile>, renderTime: number, camera: THREE.Camera, dt: number): void {
    const live = new Set<string>();
    for (const cp of projectiles.values()) {
      if (cp.done) continue;
      if (!cp.predicted && renderTime < cp.startAt) continue;
      live.add(cp.id);
      const pool = this.pools[cp.weapon];
      let slot = pool.find((s) => s.key === cp.id);
      if (!slot) {
        slot = pool.find((s) => s.key === null);
        if (!slot) continue;
        slot.key = cp.id;
        slot.mesh.visible = true;
        slot.mesh.position.set(cp.pr.x, cp.pr.y, cp.pr.z);
        slot.trail.reset(slot.mesh.position);
      }
      slot.mesh.position.set(cp.pr.x, cp.pr.y, cp.pr.z);
      if (cp.weapon === 0) {
        slot.spin += dt * 26;
        slot.mesh.rotation.set(0.3 * Math.sin(slot.spin * 0.25), slot.spin, 0.2);
      } else {
        slot.spin += dt * 9;
        slot.mesh.rotation.set(slot.spin, 0.3, 0.2);
      }
      slot.trail.push(slot.mesh.position, dt);
      slot.trail.update(camera);
    }
    for (const w of [0, 1] as const) {
      for (const s of this.pools[w]) {
        if (s.key && !live.has(s.key)) { s.key = null; s.mesh.visible = false; s.trail.hide(); }
      }
    }
    for (const r of this.rings) {
      if (r.t >= 1) continue;
      r.t = Math.min(1, r.t + dt / 0.35);
      const sc = 0.3 + r.t * 2.2;
      r.mesh.scale.set(sc, sc, sc);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - r.t);
      if (r.t >= 1) r.mesh.visible = false;
    }
    this.particles.update(dt);
  }
}
