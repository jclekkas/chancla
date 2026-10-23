// Combat effects: melee contact, misses, shielded blows (placeholder; the
// effects pass fills this in). Purely cosmetic and driven only by
// authoritative events the engine has already deduplicated.
import * as THREE from 'three';
import type { WeaponId } from '../../../shared/config';
import type { Quality } from '../settings';

type P3 = { x: number; y: number; z: number };

export class CombatFx {
  readonly group = new THREE.Group();
  setQuality(_q: Quality): void { /* placeholder */ }
  setReducedMotion(_on: boolean): void { /* placeholder */ }
  /** Confirmed melee contact (authoritative 'hit' with m). p: contact point; dir: unit blow direction (x, z). */
  meleeHit(_weapon: WeaponId, _p: P3, _dir: { x: number; z: number }, _head: boolean): void { /* placeholder */ }
  /** Confirmed miss (authoritative 'whiff'): the attacker's position and facing. */
  meleeWhiff(_weapon: WeaponId, _at: P3, _yaw: number): void { /* placeholder */ }
  /** Blow absorbed by spawn protection. */
  shielded(_p: P3): void { /* placeholder */ }
  update(_dt: number, _camera: THREE.Camera): void { /* placeholder */ }
  clear(): void { /* placeholder */ }
  dispose(): void { /* placeholder */ }
  /** Live and pooled counts, for tests and the benchmark. */
  stats(): { active: number; pooled: number; drawCalls: number } { return { active: 0, pooled: 0, drawCalls: 0 }; }
}
