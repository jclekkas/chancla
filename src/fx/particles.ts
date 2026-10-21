import * as THREE from 'three';
import { PALETTE } from '../world/palette';

// One instanced mesh for every small particle (confetti, dust, sparks,
// leaves). Particles live in flat typed arrays and are compacted each frame.
export type BurstKind = 'confetti' | 'dust' | 'gold' | 'leaves' | 'thwap' | 'water' | 'smoke';

const CONFETTI = [PALETTE.pink, PALETTE.marigold, PALETTE.turquoise, PALETTE.violet, PALETTE.cream, PALETTE.terracotta];

export class Particles {
  readonly mesh: THREE.InstancedMesh;
  readonly capacity: number;
  private n = 0;
  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array;
  private life: Float32Array; private maxLife: Float32Array; private size: Float32Array;
  private rot: Float32Array; private spin: Float32Array; private grav: Float32Array;
  private col: Uint32Array;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  density = 1;

  constructor(capacity = 420) {
    this.capacity = capacity;
    const geo = new THREE.BoxGeometry(1, 1, 0.25);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    const f = () => new Float32Array(capacity);
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.life = f(); this.maxLife = f(); this.size = f();
    this.rot = f(); this.spin = f(); this.grav = f();
    this.col = new Uint32Array(capacity);
  }

  get active(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
    this.mesh.count = 0;
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: number, grav: number): void {
    if (this.n >= this.capacity) return;
    const i = this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size;
    this.rot[i] = Math.random() * 6.28; this.spin[i] = (Math.random() - 0.5) * 14;
    this.grav[i] = grav;
    this.col[i] = color;
  }

  burst(kind: BurstKind, x: number, y: number, z: number, count = 12, nx = 0, ny = 1, nz = 0): void {
    const n = Math.max(1, Math.round(count * this.density));
    for (let k = 0; k < n; k++) {
      const r = () => Math.random() - 0.5;
      switch (kind) {
        case 'confetti':
          this.spawn(x, y, z, r() * 7, 3 + Math.random() * 5, r() * 7, 1.2 + Math.random() * 0.8, 0.09 + Math.random() * 0.05, CONFETTI[k % CONFETTI.length]!, 7);
          break;
        case 'dust':
          this.spawn(x + r() * 0.4, y, z + r() * 0.4, r() * 2.5, 0.6 + Math.random() * 1.2, r() * 2.5, 0.5 + Math.random() * 0.3, 0.16 + Math.random() * 0.1, PALETTE.creamDark, 1);
          break;
        case 'gold':
          this.spawn(x, y, z, r() * 8 + nx * 3, r() * 8 + ny * 3, r() * 8 + nz * 3, 0.45 + Math.random() * 0.3, 0.08, k % 2 ? PALETTE.gold : 0xfff3c4, 5);
          break;
        case 'leaves':
          this.spawn(x + r(), y + Math.random(), z + r(), r() * 3 + nx * 6, Math.random() * 2, r() * 3 + nz * 6, 0.8 + Math.random() * 0.5, 0.12, k % 2 ? PALETTE.leaf : PALETTE.marigoldDeep, 2);
          break;
        case 'thwap':
          this.spawn(x, y, z, r() * 5 + nx * 2, r() * 4 + 1.5 + ny, r() * 5 + nz * 2, 0.3 + Math.random() * 0.15, 0.07, k % 3 ? PALETTE.cream : PALETTE.marigold, 9);
          break;
        case 'water':
          this.spawn(x, y, z, r() * 3, 2 + Math.random() * 2, r() * 3, 0.5, 0.06, PALETTE.water, 9);
          break;
        case 'smoke':
          this.spawn(x + r() * 0.6, y + r() * 0.6, z + r() * 0.6, r() * 1.2, 1 + Math.random(), r() * 1.2, 0.8 + Math.random() * 0.4, 0.3 + Math.random() * 0.2, 0x5a5560, -0.5);
          break;
      }
    }
  }

  update(dt: number): void {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const life = this.life[i]! - dt;
      if (life <= 0) continue;
      let vy = this.vy[i]! - this.grav[i]! * dt;
      const drag = Math.exp(-2.2 * dt);
      const vx = this.vx[i]! * drag, vz = this.vz[i]! * drag;
      vy *= drag;
      let py = this.py[i]! + vy * dt;
      if (py < 0.02) { py = 0.02; vy = 0; }
      const pxx = this.px[i]! + vx * dt;
      const pzz = this.pz[i]! + vz * dt;
      this.px[w] = pxx; this.py[w] = py; this.pz[w] = pzz;
      this.vx[w] = vx; this.vy[w] = vy; this.vz[w] = vz;
      this.life[w] = life; this.maxLife[w] = this.maxLife[i]!; this.size[w] = this.size[i]!;
      this.rot[w] = this.rot[i]! + this.spin[i]! * dt; this.spin[w] = this.spin[i]!; this.grav[w] = this.grav[i]!;
      this.col[w] = this.col[i]!;
      w++;
    }
    this.n = w;
    for (let i = 0; i < this.n; i++) {
      const f = Math.min(1, (this.life[i]! / this.maxLife[i]!) * 2.5);
      const s = this.size[i]! * f;
      this.e.set(this.rot[i]!, this.rot[i]! * 0.7, 0);
      this.q.setFromEuler(this.e);
      this.p.set(this.px[i]!, this.py[i]!, this.pz[i]!);
      this.s.set(s, s, s);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      this.c.setHex(this.col[i]!);
      this.mesh.setColorAt(i, this.c);
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
