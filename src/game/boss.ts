import * as THREE from 'three';
import { buildBoss, type Rig } from '../models/characters';
import type { HazardSystem } from './hazards';
import type { Rng } from '../core/rng';
import type { HitTarget } from './chanclas';
import { damp } from '../core/math';
import { PALETTE } from '../world/palette';

// EL REY DEL ESCÁNDALO. A readable three-attack cycle, each followed by a
// vulnerable window when his sound shield drops:
//   1. Bass Drop:   expanding ring walls with a safe gap (turquoise lane)
//   2. Sound Sweep: three wide cones fired left, centre, right in sequence
//   3. Vinyl Volley: fans of spinning records
// Below half health he gets faster and calls in hype-crew minions.

export type BossState = 'idle' | 'intro' | 'attack' | 'vulnerable' | 'dying' | 'dead';
export type BossAttack = 'bassDrop' | 'sweep' | 'vinyl';

export const BOSS_ID = 9000;
export const BOSS_MAX_HP = 34;

export interface BossContext {
  player: THREE.Vector3;
  hazards: HazardSystem;
  rng: Rng;
  onAttackStart(a: BossAttack): void;
  onVulnerable(): void;
  onShieldUp(): void;
  onSummon(count: number): void;
  onBeat(kind: 'ring' | 'cone' | 'vinyl'): void;
  say(line: string | null): void;
}

interface Scheduled {
  at: number;
  fn: () => void;
  done: boolean;
}

const ORDER: BossAttack[] = ['bassDrop', 'sweep', 'vinyl'];

export class Boss {
  readonly rig: Rig;
  readonly shield: THREE.Mesh;
  readonly group = new THREE.Group();
  state: BossState = 'idle';
  stateT = 0;
  hp = BOSS_MAX_HP;
  attackIndex = 0;
  cycles = 0;
  currentAttack: BossAttack | null = null;
  phase2 = false;
  private schedule: Scheduled[] = [];
  private attackLength = 0;
  readonly pos = new THREE.Vector3();
  readonly waveOrigin = new THREE.Vector3();
  private flinch = 0;
  private fall = 0;
  private tmpA = new THREE.Vector3();
  private tmpV = new THREE.Vector3();

  constructor(pos: THREE.Vector3, waveOrigin: THREE.Vector3) {
    this.pos.copy(pos);
    this.waveOrigin.copy(waveOrigin);
    this.rig = buildBoss();
    this.group.add(this.rig.root);
    // Sound shield: a translucent bubble with a bright lattice so it reads
    // against the dark stage.
    this.shield = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 2),
      new THREE.MeshBasicMaterial({ color: PALETTE.turquoise, transparent: true, opacity: 0.2, depthWrite: false }),
    );
    const lattice = new THREE.Mesh(
      this.shield.geometry,
      new THREE.MeshBasicMaterial({ color: 0xbff4f6, wireframe: true, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    lattice.scale.setScalar(1.01);
    this.shield.add(lattice);
    this.shield.scale.setScalar(this.shieldRadius);
    this.group.add(this.shield);
    this.group.visible = false;
  }

  get shieldRadius(): number {
    return 2.3;
  }

  get shieldUp(): boolean {
    return this.state === 'attack' || this.state === 'intro';
  }

  get alive(): boolean {
    return this.state === 'intro' || this.state === 'attack' || this.state === 'vulnerable';
  }

  reset(): void {
    this.state = 'idle';
    this.stateT = 0;
    this.hp = BOSS_MAX_HP;
    this.attackIndex = 0;
    this.cycles = 0;
    this.currentAttack = null;
    this.phase2 = false;
    this.schedule.length = 0;
    this.flinch = 0;
    this.fall = 0;
    this.group.visible = false;
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.set(0, Math.PI, 0);
    this.rig.body.rotation.set(0, 0, 0);
    this.rig.stars.visible = false;
  }

  start(): void {
    this.reset();
    this.state = 'intro';
    this.group.visible = true;
  }

  target(out: HitTarget): HitTarget {
    const s = this.rig.scale;
    out.id = 9000;
    out.kind = 'boss';
    out.x = this.pos.x;
    out.z = this.pos.z;
    out.y0 = this.pos.y + 0.4 * s;
    out.y1 = this.pos.y + 1.9 * s;
    out.r = 0.55 * s;
    out.shield = this.shieldUp ? { x: this.pos.x, y: this.pos.y + 1.9, z: this.pos.z, r: this.shieldRadius } : null;
    return out;
  }

  // Returns true when the hit was accepted.
  takeHit(damage: number): { valid: boolean; killed: boolean } {
    if (this.state !== 'vulnerable') return { valid: false, killed: false };
    this.hp = Math.max(0, this.hp - damage);
    this.flinch = 1;
    if (this.hp <= 0) {
      this.state = 'dying';
      this.stateT = 0;
      return { valid: true, killed: true };
    }
    if (!this.phase2 && this.hp <= BOSS_MAX_HP / 2) this.phase2 = true;
    return { valid: true, killed: false };
  }

  update(dt: number, ctx: BossContext): void {
    if (this.state === 'idle' || this.state === 'dead') return;
    this.stateT += dt;
    this.flinch = Math.max(0, this.flinch - dt * 3);
    switch (this.state) {
      case 'intro':
        if (this.stateT > 2.2) this.beginAttack(ctx);
        break;
      case 'attack':
        for (const s of this.schedule) {
          if (!s.done && this.stateT >= s.at) {
            s.done = true;
            s.fn();
          }
        }
        if (this.stateT >= this.attackLength) {
          this.state = 'vulnerable';
          this.stateT = 0;
          ctx.onVulnerable();
        }
        break;
      case 'vulnerable':
        if (this.stateT >= (this.phase2 ? 3.8 : 4.4)) this.beginAttack(ctx);
        break;
      case 'dying':
        if (this.stateT > 2.6) this.state = 'dead';
        break;
    }
    this.animate(dt);
  }

  private beginAttack(ctx: BossContext): void {
    const atk = ORDER[this.attackIndex % ORDER.length]!;
    this.attackIndex++;
    if (this.attackIndex % ORDER.length === 0) this.cycles++;
    this.currentAttack = atk;
    this.state = 'attack';
    this.stateT = 0;
    this.schedule.length = 0;
    ctx.onShieldUp();
    ctx.onAttackStart(atk);
    if (ctx.rng.chance(0.6)) ctx.say(null);
    const p2 = this.phase2;
    const o = this.waveOrigin;
    const bearing = (): number => Math.atan2(ctx.player.x - o.x, ctx.player.z - o.z);
    const at = (t: number, fn: () => void): void => {
      this.schedule.push({ at: t, fn, done: false });
    };
    if (atk === 'bassDrop') {
      const count = p2 ? 3 : 2;
      for (let i = 0; i < count; i++) {
        at(i * (p2 ? 1.5 : 1.9), () => {
          const gap = bearing() + ctx.rng.range(-0.55, 0.55);
          ctx.hazards.ring({
            owner: BOSS_ID, source: 'boss', x: o.x, z: o.z, telegraph: 1.3, speed: p2 ? 9 : 7.5, maxR: 34,
            gapDir: gap, gapHalf: 0.34, damage: 14, push: 7,
          });
          ctx.onBeat('ring');
        });
      }
      this.attackLength = (count - 1) * (p2 ? 1.5 : 1.9) + 1.3 + 3.2;
    } else if (atk === 'sweep') {
      const offsets = ctx.rng.chance(0.5) ? [-0.5, 0, 0.5] : [0.5, 0, -0.5];
      const tele = p2 ? 0.8 : 1.0;
      const gap = p2 ? 0.55 : 0.75;
      offsets.forEach((off, i) => {
        at(i * gap, () => {
          ctx.hazards.cone({
            owner: BOSS_ID, source: 'boss', x: o.x, z: o.z, y: 1.4, dir: bearing() + off, range: 30, half: 0.2,
            telegraph: tele, live: 0.45, damage: 13, push: 6,
          });
          ctx.onBeat('cone');
        });
      });
      this.attackLength = offsets.length * gap + tele + 0.8;
    } else {
      const volleys = p2 ? 4 : 3;
      const spacing = p2 ? 0.75 : 0.95;
      for (let v = 0; v < volleys; v++) {
        at(0.6 + v * spacing, () => {
          const b = bearing();
          const n = 5;
          const spread = 0.9;
          const offset = (v % 2) * (spread / (n - 1)) * 0.5;
          for (let k = 0; k < n; k++) {
            const a = b - spread / 2 + (spread * k) / (n - 1) + offset;
            this.tmpA.set(o.x, 1.3, o.z);
            this.tmpV.set(Math.sin(a), 0, Math.cos(a)).multiplyScalar(p2 ? 12 : 10.5);
            ctx.hazards.orb({ owner: BOSS_ID, source: 'boss', style: 'vinyl', from: this.tmpA, vel: this.tmpV, damage: 11, push: 0.6, life: 4.5 });
          }
          ctx.onBeat('vinyl');
        });
      }
      this.attackLength = 0.6 + volleys * spacing + 1.4;
      if (p2) ctx.onSummon(2);
    }
  }

  private animate(dt: number): void {
    const r = this.rig;
    const t = this.stateT;
    r.root.position.copy(this.pos);
    if (this.state === 'dying') {
      // Stumbles back off the stage behind the booth.
      this.fall = Math.min(1, t / 1.2);
      r.body.rotation.x = damp(r.body.rotation.x, 1.5, 4, dt);
      r.root.position.y = this.pos.y - this.fall * 1.4;
      r.root.position.z = this.pos.z - this.fall * 1.2;
      r.root.rotation.z = this.fall * 0.3;
      r.armL.rotation.z = -2.5 * this.fall;
      r.armR.rotation.z = 2.5 * this.fall;
      r.stars.visible = t > 0.8;
      r.stars.rotation.y += dt * 5;
      this.shield.visible = false;
      return;
    }
    const vulnerable = this.state === 'vulnerable';
    this.shield.visible = this.shieldUp;
    this.shield.position.set(this.pos.x, this.pos.y + 1.9, this.pos.z);
    const sm = this.shield.material as THREE.MeshBasicMaterial;
    sm.opacity = 0.16 + Math.sin(t * 8) * 0.05;
    this.shield.rotation.y += dt * 0.6;
    if (vulnerable) {
      // Out of breath: hunched, hands on knees, head bobbing.
      r.body.rotation.x = damp(r.body.rotation.x, -0.45 + this.flinch * 0.5, 8, dt);
      r.armL.rotation.x = damp(r.armL.rotation.x, -0.6, 8, dt);
      r.armR.rotation.x = damp(r.armR.rotation.x, -0.6, 8, dt);
      r.head.rotation.x = Math.sin(t * 7) * 0.15;
      r.stars.visible = true;
      r.stars.rotation.y += dt * 4;
      r.mouth.scale.y = 0.09;
    } else {
      // Hyped DJ: fist pumps and head nods on the beat.
      const beat = Math.sin(t * Math.PI * 2 * 1.6);
      r.body.rotation.x = damp(r.body.rotation.x, -0.08 + beat * 0.04, 10, dt);
      r.armR.rotation.x = damp(r.armR.rotation.x, -2.4 + beat * 0.5, 10, dt);
      r.armL.rotation.x = damp(r.armL.rotation.x, -0.9 - beat * 0.3, 10, dt);
      r.head.rotation.x = beat * 0.12;
      r.stars.visible = false;
      r.mouth.scale.y = 0.06 + Math.max(0, beat) * 0.05;
    }
  }
}
