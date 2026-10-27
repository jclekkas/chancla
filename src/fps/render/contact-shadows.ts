// Soft contact shadows under the characters: a small dark disc on the
// ground at each Rosa's feet, so she stands on the paving on every quality
// (Low has no shadow map at all; on High and Medium it grounds the feet
// where the sun's shadow is a thin sliver at midday). One instanced draw.
// Mid-air it stays on the ground below her and fades, so it never floats.
import * as THREE from 'three';

const MAX = 24;

let tex: THREE.Texture | null = null;
function discTexture(): THREE.Texture | null {
  if (tex || typeof document === 'undefined') return tex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.75)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export class ContactShadows {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  /** Ground height last seen under each character, kept while she is in the air. */
  private ground = new Map<object, number>();

  /** `strength`: the disc's darkness at its centre (lighter where a shadow map also grounds her). */
  constructor(strength = 0.4) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x2a1a22, alphaMap: discTexture(), transparent: true, depthWrite: false, opacity: strength,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'contact-shadows';
    this.mesh.count = 0;
  }

  begin(): void { this.n = 0; }

  /**
   * A character at (x, y, z). `onGround`: standing on something (y is the
   * ground); in the air the disc stays at the last ground height under her,
   * shrinking with the height until it is gone.
   */
  add(key: object, x: number, y: number, z: number, onGround: boolean): void {
    if (this.n >= MAX) return;
    let gy = this.ground.get(key);
    if (onGround || gy === undefined || y < gy) { gy = y; this.ground.set(key, y); }
    const h = Math.max(0, y - gy);
    const k = Math.max(0, 1 - h / 1.6);
    if (k <= 0.02) return;
    const r = 0.95 * (0.6 + 0.4 * k);
    this.p.set(x, gy + 0.012, z);
    this.s.set(r, r, 1);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(this.n, this.m);
    this.n++;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setStrength(a: number): void { (this.mesh.material as THREE.MeshBasicMaterial).opacity = a; }

  /** Forget a character (removed or rebuilt). */
  forget(key: object): void { this.ground.delete(key); }

  clear(): void { this.n = 0; this.mesh.count = 0; this.ground.clear(); }
}
