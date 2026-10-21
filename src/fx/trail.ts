import * as THREE from 'three';

// Camera-facing ribbon that follows a moving point. Fixed vertex count and
// a single shared material per colour keep it cheap.
const SEGMENTS = 10;

export class Trail {
  readonly mesh: THREE.Mesh;
  private points: THREE.Vector3[] = [];
  private positions: Float32Array;
  private colors: Float32Array;
  private geo: THREE.BufferGeometry;
  private head = 0;
  private filled = 0;
  private width: number;
  private color = new THREE.Color();
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpC = new THREE.Vector3();
  private sampleT = 0;

  constructor(material: THREE.Material, width = 0.14) {
    this.width = width;
    for (let i = 0; i < SEGMENTS; i++) this.points.push(new THREE.Vector3());
    this.positions = new Float32Array(SEGMENTS * 2 * 3);
    this.colors = new Float32Array(SEGMENTS * 2 * 4);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < SEGMENTS - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  setColor(hex: number): void {
    this.color.setHex(hex);
  }

  reset(p: THREE.Vector3): void {
    for (const pt of this.points) pt.copy(p);
    this.filled = 1;
    this.head = 0;
    this.sampleT = 0;
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
    this.filled = 0;
  }

  push(p: THREE.Vector3, dt: number): void {
    this.sampleT += dt;
    if (this.sampleT < 1 / 90 && this.filled > 1) {
      this.points[this.head]!.copy(p);
      return;
    }
    this.sampleT = 0;
    this.head = (this.head + 1) % SEGMENTS;
    this.points[this.head]!.copy(p);
    if (this.filled < SEGMENTS) this.filled++;
  }

  update(camera: THREE.Camera): void {
    if (!this.mesh.visible) return;
    const camPos = this.tmpC.setFromMatrixPosition(camera.matrixWorld);
    const n = this.filled;
    for (let i = 0; i < SEGMENTS; i++) {
      const k = Math.min(i, n - 1);
      const idx = (this.head - k + SEGMENTS * 2) % SEGMENTS;
      const nextIdx = (this.head - Math.min(k + 1, n - 1) + SEGMENTS * 2) % SEGMENTS;
      const p = this.points[idx]!;
      const q = this.points[nextIdx]!;
      const dir = this.tmpA.subVectors(p, q);
      if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
      const toCam = this.tmpB.subVectors(camPos, p);
      const side = dir.cross(toCam).normalize();
      const f = 1 - i / (SEGMENTS - 1);
      const w = this.width * f;
      const o = i * 6;
      this.positions[o] = p.x + side.x * w;
      this.positions[o + 1] = p.y + side.y * w;
      this.positions[o + 2] = p.z + side.z * w;
      this.positions[o + 3] = p.x - side.x * w;
      this.positions[o + 4] = p.y - side.y * w;
      this.positions[o + 5] = p.z - side.z * w;
      const a = f * f * 0.75;
      const co = i * 8;
      for (let s = 0; s < 2; s++) {
        this.colors[co + s * 4] = this.color.r;
        this.colors[co + s * 4 + 1] = this.color.g;
        this.colors[co + s * 4 + 2] = this.color.b;
        this.colors[co + s * 4 + 3] = a;
      }
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

export function trailMaterial(additive: boolean): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}
