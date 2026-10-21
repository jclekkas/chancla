// First-person hands. Timing comes straight from the predicted weapon state,
// so the throw animation always lines up with when the chancla leaves.
import * as THREE from 'three';
import { WEAPONS, WEAPON_SWITCH_MS, type WeaponId } from '../../../shared/config';
import type { Team } from '../../../shared/map';
import { buildHand, type HandRig } from '../../models/hand';
import { buildPesada } from './rosa';
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
}

export class ViewModel {
  readonly root = new THREE.Group();
  private rig: HandRig;
  private heavy: THREE.Group;
  private phase = 0;
  private landing = 0;
  private wasGround = true;
  private team: Team = 0;

  constructor() {
    this.rig = buildHand();
    this.root.add(this.rig.root);
    this.heavy = buildPesada();
    this.heavy.scale.setScalar(0.9);
    this.heavy.position.copy(this.rig.sandal.position);
    this.heavy.rotation.copy(this.rig.sandal.rotation);
    this.rig.arm.add(this.heavy);
    this.rig.leftHand.visible = false;
    // Own the sleeve materials so they can take the team colour.
    this.rig.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.MeshLambertMaterial).color?.getHex() === 0x4b2a6b) m.material = (m.material as THREE.Material).clone();
    });
  }

  setTeam(team: Team): void {
    if (team === this.team) return;
    this.team = team;
    const color = team === 0 ? COLORS.sol : COLORS.luna;
    this.rig.root.traverse((o) => {
      const m = o as THREE.Mesh;
      const mat = m.material as THREE.MeshLambertMaterial | undefined;
      if (m.isMesh && mat && (mat.userData.sleeve || mat.color.getHex() === 0x4b2a6b)) { mat.userData.sleeve = true; mat.color.setHex(color); }
    });
  }

  update(s: ViewState, dt: number, reducedMotion: boolean): void {
    this.root.visible = s.alive;
    if (!s.alive) return;
    const def = WEAPONS[s.weapon]!;
    if (!this.wasGround && s.onGround) this.landing = 1;
    this.wasGround = s.onGround;
    this.landing = Math.max(0, this.landing - dt * 5);
    const moving = s.speed > 0.5 && s.onGround;
    this.phase += dt * (moving ? 7 + s.speed : 0);
    const motion = reducedMotion ? 0.25 : 1;
    const bobX = moving ? Math.sin(this.phase) * 0.012 * motion : 0;
    const bobY = moving ? Math.abs(Math.cos(this.phase)) * 0.012 * motion : Math.sin(performance.now() * 0.0018) * 0.003 * motion;

    // Throw timeline.
    const release = s.weapon === 1 ? 160 : 90;
    const t = s.msSinceThrow;
    let push = 0, lift = 0, rot = 0, visible = true;
    if (t < def.cooldownMs) {
      if (t < release) {
        const k = t / release;
        push = -0.22 * Math.sin(k * Math.PI * 0.5);
        lift = 0.05 * k;
        rot = -0.9 * k;
      } else {
        const k = (t - release) / Math.max(1, def.cooldownMs - release);
        // Empty hand comes back down, then a fresh chancla rises into it.
        visible = k > 0.45;
        push = -0.22 * (1 - Math.min(1, k * 2.2));
        lift = visible ? -0.18 * (1 - (k - 0.45) / 0.55) : -0.18;
        rot = -0.9 * (1 - Math.min(1, k * 2.2));
      }
    }
    // Weapon switch: lower out, raise in.
    let sw = 0;
    if (s.switchMs > 0) {
      const k = 1 - s.switchMs / WEAPON_SWITCH_MS;
      sw = k < 0.5 ? k * 2 : (1 - k) * 2;
    }
    const arm = this.rig.root;
    arm.position.set(0.34 + bobX, -0.36 + bobY + lift - sw * 0.32 - this.landing * 0.03 * motion - (s.crouched ? 0.02 : 0), -0.6 + push);
    arm.rotation.set(0.15 + rot, -0.1, -0.06);
    this.rig.sandal.visible = visible && s.weapon === 0;
    this.heavy.visible = visible && s.weapon === 1;
  }
}
