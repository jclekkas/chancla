import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { box, type AABB } from '../physics/collision';
import { NavGrid } from './nav';
import { GEO, PALETTE, basic, lambert, mesh } from './palette';
import { buildSandal, GOLD_SKIN } from '../models/sandal';
import { ARENA } from '../config';

// Builds the courtyard: a square plaza ringed by stucco houses with six
// alley entrances, a fountain landmark in the middle (the Monumento a la
// Chancla), a café on the west side, a parked scooter east, the DJ stage
// to the north and Rosa's porch to the south. Every solid prop is a box so
// visuals and collision volumes agree.

export interface SpawnPoint {
  x: number;
  z: number;
  // First waypoint inside the plaza so enemies walk in through the alley.
  entryX: number;
  entryZ: number;
}

export interface Arena {
  group: THREE.Group;
  colliders: AABB[];
  nav: NavGrid;
  spawns: SpawnPoint[];
  pickupSpots: Array<{ x: number; z: number }>;
  playerStart: { x: number; z: number; yaw: number };
  bossPos: THREE.Vector3;
  bossWaveOrigin: THREE.Vector3;
  dummySpots: Array<{ x: number; z: number }>;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  speakerCones: THREE.Object3D[];
  update(t: number, beat: number): void;
  setShadows(on: boolean, size: number): void;
}

class Batch {
  readonly matrices: THREE.Matrix4[] = [];
  readonly colors: THREE.Color[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();

  add(x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, color?: number, rx = 0, rz = 0): void {
    this.e.set(rx, ry, rz);
    this.q.setFromEuler(this.e);
    this.p.set(x, y, z);
    this.s.set(sx, sy, sz);
    this.matrices.push(this.m.compose(this.p, this.q, this.s).clone());
    if (color !== undefined) this.colors.push(new THREE.Color(color));
  }

  build(geo: THREE.BufferGeometry, mat: THREE.Material, shadows = false): THREE.InstancedMesh {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, this.matrices.length));
    this.matrices.forEach((m, i) => im.setMatrixAt(i, m));
    if (this.colors.length === this.matrices.length && this.colors.length > 0) {
      this.colors.forEach((c, i) => im.setColorAt(i, c));
    }
    im.count = this.matrices.length;
    im.castShadow = shadows;
    im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    return im;
  }
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  draw(ctx);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

function signTexture(text: string, bg: number, fg: number, w = 512, h = 128): THREE.Texture | null {
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = hex(bg);
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = hex(fg);
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = hex(fg);
    ctx.font = `bold ${Math.floor(h * 0.48)}px "Lilita One", "Arial Black", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 4);
  });
}

// Bakes every static, non-instanced mesh into one mesh per material, so the
// whole courtyard draws in a few dozen calls instead of a few hundred.
function mergeStatic(group: THREE.Group): void {
  group.updateMatrixWorld(true);
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] }>();
  const remove: THREE.Object3D[] = [];
  for (const child of group.children) {
    if (child.userData.dynamic || (child as THREE.InstancedMesh).isInstancedMesh) continue;
    if (!(child as THREE.Mesh).isMesh && child.type !== 'Group') continue;
    let ok = true;
    child.traverse((o) => {
      if (o.userData.dynamic || (o as THREE.InstancedMesh).isInstancedMesh) ok = false;
      if ((o as THREE.Mesh).isMesh && Array.isArray((o as THREE.Mesh).material)) ok = false;
    });
    if (!ok) continue;
    child.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.Material;
      if (mat.transparent) { ok = false; return; }
      const key = `${mat.uuid}:${m.castShadow ? 1 : 0}`;
      let b = buckets.get(key);
      if (!b) { b = { mat, cast: m.castShadow, geos: [] }; buckets.set(key, b); }
      const g = m.geometry.index ? m.geometry.clone() : m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
      if (!g.index) {
        const idx: number[] = [];
        for (let i = 0; i < (g.attributes.position as THREE.BufferAttribute).count; i++) idx.push(i);
        g.setIndex(idx);
      }
      b.geos.push(g);
    });
    remove.push(child);
  }
  for (const o of remove) group.remove(o);
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false);
    for (const g of b.geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

type Face = 'n' | 's' | 'e' | 'w';

interface HouseDef {
  x0: number; z0: number; x1: number; z1: number;
  h: number; color: number; face: Face; balcony?: boolean; trim?: number; sign?: string;
}

export function buildArena(): Arena {
  const group = new THREE.Group();
  group.name = 'arena';
  const colliders: AABB[] = [];

  // Sky dome with a golden-hour gradient.
  const skyGeo = new THREE.SphereGeometry(140, 24, 12);
  const skyColors: number[] = [];
  const top = new THREE.Color(0x5b3b8c), mid = new THREE.Color(0xf6a76b), hor = new THREE.Color(0xffd89a);
  const pos = skyGeo.attributes.position as THREE.BufferAttribute;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 140;
    if (y > 0.25) c.copy(mid).lerp(top, Math.min(1, (y - 0.25) / 0.6));
    else c.copy(hor).lerp(mid, Math.max(0, (y + 0.05) / 0.3));
    skyColors.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(skyColors, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  sky.userData.dynamic = true;
  group.add(sky);
  const sunDisk = new THREE.Mesh(new THREE.CircleGeometry(9, 24), new THREE.MeshBasicMaterial({ color: 0xffe2a0, fog: false, transparent: true, opacity: 0.95 }));
  sunDisk.position.set(-110, 22, 50);
  sunDisk.lookAt(0, 0, 0);
  group.add(sunDisk);

  // Lights: warm low sun from the west plus a sky/ground fill.
  const hemi = new THREE.HemisphereLight(0xffe0b8, 0x9a5240, 1.5);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc488, 2.6);
  sun.position.set(-26, 24, 12);
  sun.target.position.set(0, 0, 0);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.03;
  group.add(sun, sun.target);

  // Ground: terracotta pavers with cream grout.
  const groundTex = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = hex(0xe6c9a0);
    ctx.fillRect(0, 0, 256, 256);
    const tones = [0xd47a5a, 0xc96a4d, 0xdb8a66, 0xcf7354];
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = hex(tones[(i * 3 + j * 5) % tones.length]!);
        ctx.fillRect(i * 64 + 3, j * 64 + 3, 58, 58);
        ctx.fillStyle = 'rgba(255,240,210,0.12)';
        ctx.fillRect(i * 64 + 6, j * 64 + 6, 52, 8);
      }
    }
  });
  const groundMat = new THREE.MeshLambertMaterial({ color: groundTex ? 0xffffff : 0xd47a5a, map: groundTex });
  if (groundTex) {
    groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(30, 30);
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  // A cream path ring around the fountain for orientation.
  const ring = new THREE.Mesh(new THREE.RingGeometry(4.2, 5.2, 4, 1), lambert(PALETTE.cream));
  ring.rotation.x = -Math.PI / 2;
  ring.rotation.z = Math.PI / 4;
  ring.position.y = 0.01;
  ring.receiveShadow = true;
  group.add(ring);

  const windows = new Batch(), shutters = new Batch(), sills = new Batch(), slabs = new Batch();
  const rails = new Batch(), planterBoxes = new Batch(), plants = new Batch(), doors = new Batch(), flowers = new Batch();
  const trims = new Batch();

  const houses: HouseDef[] = [
    // North band (faces +z / south into the plaza)
    { x0: -26, z0: -26, x1: -17, z1: -20, h: 8, color: PALETTE.turquoiseFaded, face: 's', balcony: true },
    { x0: -14, z0: -26, x1: -7, z1: -20, h: 7, color: PALETTE.cream, face: 's' },
    { x0: -7, z0: -26, x1: 7, z1: -20, h: 10, color: PALETTE.violet, face: 's', trim: PALETTE.gold },
    { x0: 7, z0: -26, x1: 13, z1: -20, h: 7.5, color: PALETTE.marigold, face: 's', balcony: true },
    { x0: 16, z0: -26, x1: 26, z1: -20, h: 9, color: PALETTE.terracotta, face: 's' },
    // South band (faces -z / north)
    { x0: -26, z0: 20, x1: -14, z1: 26, h: 8.5, color: PALETTE.marigold, face: 'n', balcony: true },
    { x0: -11, z0: 20, x1: -3, z1: 26, h: 7, color: PALETTE.terracotta, face: 'n' },
    { x0: -3, z0: 20, x1: 4, z1: 26, h: 7.5, color: PALETTE.turquoise, face: 'n', balcony: true, sign: 'CASA DE ROSA' },
    { x0: 4, z0: 20, x1: 11, z1: 26, h: 8, color: PALETTE.cream, face: 'n' },
    { x0: 14, z0: 20, x1: 26, z1: 26, h: 9, color: PALETTE.violet, face: 'n', balcony: true, trim: PALETTE.marigold },
    // West band (faces +x / east)
    { x0: -26, z0: -20, x1: -20, z1: -9, h: 7, color: PALETTE.terracotta, face: 'e', sign: 'CAFÉ LA ESQUINA' },
    { x0: -26, z0: -9, x1: -20, z1: 1, h: 8.5, color: PALETTE.cream, face: 'e', balcony: true },
    { x0: -26, z0: 4, x1: -20, z1: 20, h: 7.5, color: PALETTE.turquoiseFaded, face: 'e', balcony: true },
    // East band (faces -x / west)
    { x0: 20, z0: -20, x1: 26, z1: -12, h: 8, color: PALETTE.cream, face: 'w' },
    { x0: 20, z0: -12, x1: 26, z1: -5, h: 9.5, color: PALETTE.marigoldDeep, face: 'w', balcony: true },
    { x0: 20, z0: -2, x1: 26, z1: 8, h: 7, color: PALETTE.turquoise, face: 'w' },
    { x0: 20, z0: 8, x1: 26, z1: 20, h: 8.5, color: PALETTE.terracotta, face: 'w', balcony: true },
  ];

  const signs: Array<{ text: string; x: number; y: number; z: number; ry: number; w: number }> = [];

  for (const hd of houses) {
    const w = hd.x1 - hd.x0, d = hd.z1 - hd.z0;
    const body = mesh(GEO.box, lambert(hd.color), w, hd.h, d, (hd.x0 + hd.x1) / 2, hd.h / 2, (hd.z0 + hd.z1) / 2);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    trims.add((hd.x0 + hd.x1) / 2, hd.h + 0.15, (hd.z0 + hd.z1) / 2, w + 0.3, 0.3, d + 0.3, 0, hd.trim ?? PALETTE.creamDark);
    colliders.push(box(hd.x0, 0, hd.z0, hd.x1, hd.h, hd.z1, 'house'));

    // Facade frame: u runs along the face, n points into the plaza.
    let fx: number, fz: number, ux: number, uz: number, nx: number, nz: number, len: number;
    switch (hd.face) {
      case 's': fx = hd.x0; fz = hd.z1; ux = 1; uz = 0; nx = 0; nz = 1; len = w; break;
      case 'n': fx = hd.x0; fz = hd.z0; ux = 1; uz = 0; nx = 0; nz = -1; len = w; break;
      case 'e': fx = hd.x1; fz = hd.z0; ux = 0; uz = 1; nx = 1; nz = 0; len = d; break;
      default: fx = hd.x0; fz = hd.z0; ux = 0; uz = 1; nx = -1; nz = 0; len = d; break;
    }
    const ry = Math.atan2(nx, nz);
    const floors = Math.max(2, Math.floor(hd.h / 3));
    const cols = Math.max(1, Math.floor(len / 2.6));
    const spacing = len / cols;
    for (let f = 0; f < floors; f++) {
      const y = 1.6 + f * 2.9;
      if (y + 1 > hd.h) break;
      for (let k = 0; k < cols; k++) {
        const along = spacing * (k + 0.5);
        const px = fx + ux * along, pz = fz + uz * along;
        const ox = px + nx * 0.02, oz = pz + nz * 0.02;
        if (f === 0 && k === Math.floor(cols / 2)) {
          doors.add(ox, 1.1, oz, 1.1, 2.2, 0.08, ry, k % 2 ? PALETTE.wood : PALETTE.violetDeep);
          trims.add(ox + nx * 0.03, 2.3, oz + nz * 0.03, 1.4, 0.18, 0.1, ry, PALETTE.cream);
          continue;
        }
        windows.add(ox, y, oz, 0.9, 1.25, 0.06, ry);
        sills.add(ox + nx * 0.06, y - 0.7, oz + nz * 0.06, 1.15, 0.1, 0.18, ry);
        sills.add(ox + nx * 0.04, y + 0.72, oz + nz * 0.04, 1.05, 0.12, 0.1, ry);
        const sideX = ux * 0.62, sideZ = uz * 0.62;
        const shutterColor = hd.color === PALETTE.turquoise || hd.color === PALETTE.turquoiseFaded ? PALETTE.marigold : PALETTE.turquoise;
        shutters.add(ox - sideX + nx * 0.05, y, oz - sideZ + nz * 0.05, 0.36, 1.3, 0.05, ry, shutterColor);
        shutters.add(ox + sideX + nx * 0.05, y, oz + sideZ + nz * 0.05, 0.36, 1.3, 0.05, ry, shutterColor);
        if (hd.balcony && f === 1 && k % 2 === 0) {
          slabs.add(ox + nx * 0.45, y - 0.75, oz + nz * 0.45, 1.8, 0.12, 0.9, ry);
          for (let b = 0; b < 7; b++) {
            const a = -0.85 + b * (1.7 / 6);
            rails.add(ox + ux * a + nx * 0.86, y - 0.4, oz + uz * a + nz * 0.86, 0.04, 0.7, 0.04, ry);
          }
          rails.add(ox + nx * 0.86, y - 0.05, oz + nz * 0.86, 1.8, 0.05, 0.06, ry);
          for (let p = 0; p < 3; p++) {
            const a = -0.55 + p * 0.55;
            plants.add(ox + ux * a + nx * 0.6, y - 0.45, oz + uz * a + nz * 0.6, 0.42, 0.42, 0.42, p, p % 2 ? PALETTE.leaf : PALETTE.leafDark);
          }
        } else if (f >= 1 && (k + f) % 3 === 0) {
          planterBoxes.add(ox + nx * 0.18, y - 0.66, oz + nz * 0.18, 0.95, 0.22, 0.22, ry, PALETTE.terracottaDark);
          for (let p = 0; p < 3; p++) {
            const a = -0.3 + p * 0.3;
            flowers.add(ox + ux * a + nx * 0.2, y - 0.46, oz + uz * a + nz * 0.2, 0.2, 0.2, 0.2, p, [PALETTE.pink, PALETTE.marigold, 0xffffff][p]);
          }
        }
      }
    }
    if (hd.sign) {
      const mid = len / 2;
      signs.push({ text: hd.sign, x: fx + ux * mid + nx * 0.06, y: 3.6, z: fz + uz * mid + nz * 0.06, ry, w: Math.min(len - 1, 5) });
    }
  }

  // Alley end walls, so alleys are dead ends where enemies enter from.
  const alleyWalls: Array<[number, number, number, number]> = [
    [-17, -27, -14, -26], [13, -27, 16, -26], [-14, 26, -11, 27], [11, 26, 14, 27], [-27, 1, -26, 4], [26, -5, 27, -2],
  ];
  for (const [x0, z0, x1, z1] of alleyWalls) {
    const m = mesh(GEO.box, lambert(PALETTE.creamDark), x1 - x0, 4, z1 - z0, (x0 + x1) / 2, 2, (z0 + z1) / 2);
    m.castShadow = true;
    group.add(m);
    colliders.push(box(x0, 0, z0, x1, 4, z1, 'alley'));
  }
  // Arches over alley mouths: decorative beams high above, not solid.
  const arches: Array<[number, number, number, number]> = [
    [-17, -20.3, -14, -19.9], [13, -20.3, 16, -19.9], [-14, 19.9, -11, 20.3], [11, 19.9, 14, 20.3], [-20.3, 1, -19.9, 4], [19.9, -5, 20.3, -2],
  ];
  for (const [x0, z0, x1, z1] of arches) {
    const m = mesh(GEO.box, lambert(PALETTE.terracottaDark), x1 - x0 + 0.4, 0.5, z1 - z0 + 0.4, (x0 + x1) / 2, 4.6, (z0 + z1) / 2);
    group.add(m);
  }

  // Fountain: the Monumento a la Chancla.
  const basin = mesh(GEO.box, lambert(PALETTE.cream), 4, 0.8, 4, 0, 0.4, 0);
  basin.castShadow = true;
  basin.receiveShadow = true;
  group.add(basin);
  group.add(mesh(GEO.box, lambert(PALETTE.terracotta), 4.2, 0.14, 4.2, 0, 0.84, 0));
  const water = mesh(GEO.box, new THREE.MeshLambertMaterial({ color: PALETTE.water, transparent: true, opacity: 0.85, emissive: 0x0d3a40 }), 3.5, 0.05, 3.5, 0, 0.78, 0);
  group.add(water);
  const pillar = mesh(GEO.box, lambert(PALETTE.turquoise), 0.8, 2.4, 0.8, 0, 1.2, 0);
  pillar.castShadow = true;
  group.add(pillar);
  group.add(mesh(GEO.box, lambert(PALETTE.gold, { emissive: 0x332200 }), 1.1, 0.2, 1.1, 0, 2.45, 0));
  colliders.push(box(-2.1, 0, -2.1, 2.1, 0.92, 2.1, 'fountain'));
  colliders.push(box(-0.45, 0.9, -0.45, 0.45, 2.55, 0.45, 'pillar'));
  const statue = buildSandal(GOLD_SKIN, true);
  statue.scale.setScalar(5.5);
  statue.position.set(0, 3.6, 0);
  statue.rotation.set(-0.75, 0, 0.35);
  const statuePivot = new THREE.Group();
  statuePivot.userData.dynamic = true;
  statuePivot.add(statue);
  group.add(statuePivot);
  // Water spouts.
  const spoutMat = basic(0xbff4f6, { transparent: true, opacity: 0.6 });
  const spouts: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const s = mesh(GEO.cylLo, spoutMat, 0.08, 0.6, 0.08, Math.cos(a) * 0.7, 1.0, Math.sin(a) * 0.7);
    s.rotation.z = Math.cos(a) * 0.6;
    s.rotation.x = -Math.sin(a) * 0.6;
    s.userData.dynamic = true;
    spouts.push(s);
    group.add(s);
  }

  // Cover planters around the fountain.
  const planters: Array<[number, number, number, number]> = [
    [-9, 5.5, -6, 6.5], [6, 5.5, 9, 6.5], [-9, -8.5, -6, -7.5], [6, -8.5, 9, -7.5],
    [-12.5, 10, -11.5, 13], [11.5, 10, 12.5, 13],
  ];
  for (const [x0, z0, x1, z1] of planters) {
    const p = mesh(GEO.box, lambert(PALETTE.terracottaDark), x1 - x0, 1.0, z1 - z0, (x0 + x1) / 2, 0.5, (z0 + z1) / 2);
    p.castShadow = true;
    p.receiveShadow = true;
    group.add(p);
    group.add(mesh(GEO.box, lambert(PALETTE.cream), x1 - x0 + 0.12, 0.1, z1 - z0 + 0.12, (x0 + x1) / 2, 1.02, (z0 + z1) / 2));
    colliders.push(box(x0, 0, z0, x1, 1.05, z1, 'planter'));
    const long = Math.max(x1 - x0, z1 - z0);
    const n = Math.round(long / 0.6);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const px = x1 - x0 > z1 - z0 ? x0 + (x1 - x0) * t : (x0 + x1) / 2;
      const pz = x1 - x0 > z1 - z0 ? (z0 + z1) / 2 : z0 + (z1 - z0) * t;
      plants.add(px, 1.25, pz, 0.55, 0.5 + (i % 3) * 0.1, 0.55, i, i % 2 ? PALETTE.leaf : PALETTE.leafDark);
      if (i % 2 === 0) flowers.add(px, 1.5, pz, 0.18, 0.18, 0.18, i, i % 4 ? PALETTE.marigold : PALETTE.pink);
    }
  }

  // Café La Esquina: square tables with chairs and square umbrellas.
  const tables: Array<[number, number, number]> = [[-16, -15, 0], [-13, -11.5, 1], [-16.2, -8, 2]];
  for (const [tx, tz, v] of tables) {
    group.add(mesh(GEO.box, lambert(PALETTE.cream), 1.0, 0.06, 1.0, tx, 0.75, tz));
    group.add(mesh(GEO.box, lambert(PALETTE.ink), 0.1, 0.72, 0.1, tx, 0.36, tz));
    for (const side of [-1, 1]) {
      const cx = tx + side * 0.8;
      group.add(mesh(GEO.box, lambert(PALETTE.turquoise), 0.45, 0.06, 0.45, cx, 0.45, tz));
      group.add(mesh(GEO.box, lambert(PALETTE.turquoise), 0.06, 0.55, 0.45, cx + side * 0.2, 0.75, tz));
      for (const lx of [-0.18, 0.18]) for (const lz of [-0.18, 0.18]) group.add(mesh(GEO.box, lambert(PALETTE.ink), 0.04, 0.45, 0.04, cx + lx, 0.22, tz + lz));
    }
    colliders.push(box(tx - 1.05, 0, tz - 0.5, tx + 1.05, 0.8, tz + 0.5, 'table'));
    group.add(mesh(GEO.cylLo, lambert(PALETTE.cream), 0.05, 2.2, 0.05, tx, 1.9, tz));
    const umbrella = mesh(GEO.cone, lambert(v % 2 ? PALETTE.marigold : PALETTE.terracotta, { side: THREE.DoubleSide }), 2.6, 0.6, 2.6, tx, 2.75, tz);
    umbrella.geometry = new THREE.ConeGeometry(0.5 * Math.SQRT2, 1, 4, 1, true);
    umbrella.rotation.y = Math.PI / 4;
    umbrella.castShadow = true;
    group.add(umbrella);
    colliders.push(box(tx - 1.3, 2.45, tz - 1.3, tx + 1.3, 2.75, tz + 1.3, 'umbrella', true, false));
    // Little coffee cups on the table.
    group.add(mesh(GEO.cylLo, lambert(PALETTE.cream), 0.1, 0.1, 0.1, tx + 0.2, 0.83, tz - 0.15));
  }

  // Parked scooter, east side.
  const scooter = new THREE.Group();
  scooter.position.set(14.5, 0, 4);
  scooter.add(mesh(GEO.box, lambert(PALETTE.turquoise), 0.7, 0.55, 1.4, 0, 0.55, 0.15));
  scooter.add(mesh(GEO.box, lambert(PALETTE.cream), 0.55, 0.14, 0.8, 0, 0.9, 0.3));
  scooter.add(mesh(GEO.box, lambert(PALETTE.turquoise), 0.55, 0.9, 0.18, 0, 0.75, -0.62));
  scooter.add(mesh(GEO.cyl, lambert(PALETTE.grey), 0.05, 0.4, 0.05, 0, 1.3, -0.65));
  scooter.add(mesh(GEO.box, lambert(PALETTE.ink), 0.8, 0.06, 0.06, 0, 1.48, -0.65));
  scooter.add(mesh(GEO.sphere, lambert(0xfff4c0, { emissive: 0x554411 }), 0.2, 0.2, 0.12, 0, 1.25, -0.76));
  for (const wz of [-0.7, 0.75]) {
    const wheel = mesh(GEO.cyl, lambert(PALETTE.ink), 0.5, 0.18, 0.5, 0, 0.25, wz);
    wheel.rotation.z = Math.PI / 2;
    scooter.add(wheel);
  }
  scooter.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  group.add(scooter);
  colliders.push(box(14.05, 0, 3.05, 14.95, 1.2, 5.05, 'scooter'));

  // Crates and cooler.
  const crateDefs: Array<[number, number, number, number, number]> = [
    [15, -10, 16.4, -8.6, 1.2], [15.2, -8.6, 16.2, -7.6, 0.9], [-10.5, -14.2, -9.5, -13.4, 0.7], [9.4, -14.4, 10.6, -13.4, 0.9],
  ];
  for (const [x0, z0, x1, z1, h] of crateDefs) {
    const m = mesh(GEO.box, lambert(PALETTE.wood), x1 - x0, h, z1 - z0, (x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    m.castShadow = true;
    group.add(m);
    group.add(mesh(GEO.box, lambert(0x6e452b), x1 - x0 + 0.02, 0.08, z1 - z0 + 0.02, (x0 + x1) / 2, h * 0.5, (z0 + z1) / 2));
    colliders.push(box(x0, 0, z0, x1, h, z1, 'crate'));
  }

  // Party stage, DJ booth and the enormous speaker setup.
  const stage = mesh(GEO.box, lambert(PALETTE.violet), 14, 1.2, 6, 0, 0.6, -17);
  stage.receiveShadow = true;
  stage.castShadow = true;
  group.add(stage);
  for (let i = 0; i < 7; i++) {
    group.add(mesh(GEO.box, lambert(i % 2 ? PALETTE.marigold : PALETTE.pink), 2, 0.25, 0.04, -6 + i * 2, 0.95, -13.98));
  }
  colliders.push(box(-7, 0, -20, 7, 1.2, -14, 'stage'));
  // DJ booth sits behind the boss so he is in full view.
  const booth = mesh(GEO.box, lambert(PALETTE.ink), 4.4, 1.1, 0.8, 0, 1.75, -17.6);
  booth.castShadow = true;
  group.add(booth);
  group.add(mesh(GEO.box, lambert(PALETTE.gold, { emissive: 0x553300 }), 4.2, 0.12, 0.05, 0, 1.95, -17.18));
  for (const tx of [-1.2, 1.2]) {
    const plate = mesh(GEO.cyl, lambert(0x1a1a1a), 0.8, 0.06, 0.8, tx, 2.33, -17.6);
    group.add(plate);
  }
  colliders.push(box(-2.2, 1.2, -18.0, 2.2, 2.3, -17.2, 'booth'));
  // Warm party light on the stage.
  const stageLight = new THREE.PointLight(0xffb0c8, 40, 16, 1.6);
  stageLight.position.set(0, 6, -11.5);
  group.add(stageLight);
  const speakerCones: THREE.Object3D[] = [];
  for (const sx of [-5, 5]) {
    const stack = mesh(GEO.box, lambert(PALETTE.ink), 2.6, 3.8, 1.8, sx, 3.1, -16.4);
    stack.castShadow = true;
    group.add(stack);
    group.add(mesh(GEO.box, lambert(PALETTE.gold), 2.7, 0.08, 1.9, sx, 5.03, -16.4));
    for (const cy of [2.1, 3.4, 4.5]) {
      const r = cy === 4.5 ? 0.35 : 0.8;
      const cone = mesh(GEO.cyl, lambert(0x2f2f3a), r * 2, 0.1, r * 2, sx, cy, -15.48);
      cone.rotation.x = Math.PI / 2;
      group.add(cone);
      const cap = mesh(GEO.cyl, lambert(PALETTE.pink, { emissive: 0x440022 }), r * 0.7, 0.14, r * 0.7, sx, cy, -15.44);
      cap.rotation.x = Math.PI / 2;
      group.add(cap);
      cone.userData.dynamic = true;
      cap.userData.dynamic = true;
      speakerCones.push(cone, cap);
    }
    colliders.push(box(sx - 1.3, 1.2, -17.3, sx + 1.3, 5.0, -15.5, 'speaker'));
  }
  signs.push({ text: 'EL REY DEL ESCÁNDALO', x: 0, y: 7.2, z: -19.95, ry: 0, w: 10 });

  // Rosa's porch: rocking chair, side table, potted plants.
  const chair = new THREE.Group();
  chair.position.set(1.2, 0, 18.6);
  chair.add(mesh(GEO.box, lambert(PALETTE.wood), 0.7, 0.08, 0.7, 0, 0.5, 0));
  chair.add(mesh(GEO.box, lambert(PALETTE.wood), 0.7, 0.9, 0.08, 0, 0.95, 0.33));
  chair.add(mesh(GEO.box, lambert(PALETTE.terracotta), 0.6, 0.06, 0.6, 0, 0.56, 0));
  for (const lx of [-0.32, 0.32]) {
    chair.add(mesh(GEO.box, lambert(PALETTE.wood), 0.05, 0.5, 0.05, lx, 0.27, 0));
    const rocker = mesh(GEO.box, lambert(PALETTE.wood), 0.05, 0.05, 1.0, lx, 0.04, 0);
    chair.add(rocker);
  }
  chair.rotation.y = Math.PI * 0.95;
  chair.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  group.add(chair);
  colliders.push(box(0.8, 0, 18.1, 1.6, 1.4, 19.1, 'chair'));
  group.add(mesh(GEO.box, lambert(PALETTE.cream), 0.5, 0.6, 0.5, 2.3, 0.3, 19.2));
  colliders.push(box(2.05, 0, 18.95, 2.55, 0.62, 19.45, 'sidetable'));
  group.add(mesh(GEO.cylLo, lambert(PALETTE.terracotta), 0.12, 0.12, 0.12, 2.3, 0.66, 19.2));
  group.add(mesh(GEO.box, lambert(PALETTE.marigold), 2.2, 0.03, 1.2, 0.5, 0.015, 19.3));
  for (const px of [-2.4, 3.4]) {
    group.add(mesh(GEO.cylLo, lambert(PALETTE.terracottaDark), 0.6, 0.6, 0.6, px, 0.3, 19.5));
    plants.add(px, 0.9, 19.5, 0.8, 0.8, 0.8, px, PALETTE.leaf);
    colliders.push(box(px - 0.3, 0, 19.2, px + 0.3, 0.6, 19.8, 'pot'));
  }

  // Instanced facade details.
  group.add(windows.build(GEO.box, lambert(PALETTE.violetDeep)));
  group.add(shutters.build(GEO.box, lambert(0xffffff)));
  group.add(sills.build(GEO.box, lambert(PALETTE.cream)));
  group.add(slabs.build(GEO.box, lambert(PALETTE.cream), true));
  group.add(rails.build(GEO.box, lambert(PALETTE.ink)));
  group.add(planterBoxes.build(GEO.box, lambert(0xffffff)));
  group.add(plants.build(GEO.sphereLo, lambert(0xffffff, { flat: true }), true));
  group.add(flowers.build(GEO.sphereLo, lambert(0xffffff)));
  group.add(doors.build(GEO.box, lambert(0xffffff)));
  group.add(trims.build(GEO.box, lambert(0xffffff)));

  // Signs.
  for (const s of signs) {
    const tex = signTexture(s.text, PALETTE.cream, PALETTE.violet, 1024, 160);
    const m = new THREE.Mesh(GEO.plane, tex ? new THREE.MeshBasicMaterial({ map: tex }) : lambert(PALETTE.cream));
    m.scale.set(s.w, s.w * 0.156, 1);
    m.position.set(s.x, s.y, s.z);
    m.rotation.y = s.ry;
    group.add(m);
  }

  // Laundry lines, string lights and papel picado.
  const swayGroups: THREE.Group[] = [];
  const lineMat = lambert(PALETTE.ink);
  const clothColors = [PALETTE.white, PALETTE.pink, PALETTE.turquoise, PALETTE.marigold, PALETTE.cream, PALETTE.violet];
  function laundry(ax: number, az: number, bx: number, bz: number, y: number): void {
    const g = new THREE.Group();
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    g.position.set(ax, y, az);
    g.rotation.y = Math.atan2(-dz, dx);
    const line = mesh(GEO.cylLo, lineMat, 0.025, len, 0.025, len / 2, 0, 0);
    line.rotation.z = Math.PI / 2;
    g.add(line);
    const n = Math.floor(len / 1.1);
    const local = new Batch();
    for (let i = 1; i < n; i++) {
      const x = (i / n) * len;
      const sag = -Math.sin((i / n) * Math.PI) * 0.35;
      const big = i % 3 === 0;
      local.add(x, sag - (big ? 0.45 : 0.32), 0, big ? 0.7 : 0.5, big ? 0.85 : 0.6, 0.02, 0, clothColors[(i * 7 + Math.round(ax)) % clothColors.length]);
    }
    const im = local.build(GEO.box, lambert(0xffffff, { side: THREE.DoubleSide }));
    g.add(im);
    g.userData.dynamic = true;
    group.add(g);
    swayGroups.push(g);
  }
  laundry(-20, -13, -13.5, -20, 5.6);
  laundry(20, 13, 13.5, 20, 5.4);
  laundry(-20, 12, -14, 20, 5.8);
  laundry(16, -20, 20, -14, 5.2);

  const bulbs = new Batch();
  const wirePts: number[] = [];
  function lights(ax: number, ay: number, az: number, bx: number, by: number, bz: number, count: number): void {
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const sag = Math.sin(t * Math.PI) * 1.2;
      if (i > 0) {
        const t0 = (i - 1) / count;
        const sag0 = Math.sin(t0 * Math.PI) * 1.2;
        wirePts.push(ax + (bx - ax) * t0, ay + (by - ay) * t0 - sag0 + 0.1, az + (bz - az) * t0);
        wirePts.push(ax + (bx - ax) * t, ay + (by - ay) * t - sag + 0.1, az + (bz - az) * t);
      }
      bulbs.add(ax + (bx - ax) * t, ay + (by - ay) * t - sag, az + (bz - az) * t, 0.16, 0.2, 0.16, 0, i % 3 === 0 ? PALETTE.pink : i % 3 === 1 ? 0xfff0b0 : PALETTE.turquoiseFaded);
    }
  }
  lights(-20, 6.5, -6, 20, 6.5, 6, 26);
  lights(-20, 6.5, 8, 20, 6.5, -8, 26);
  group.add(bulbs.build(GEO.sphereLo, basic(0xffffff)));
  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
  const wires = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: PALETTE.ink }));
  wires.userData.dynamic = true;
  group.add(wires);

  const flags = new Batch();
  const flagColors = [PALETTE.pink, PALETTE.marigold, PALETTE.turquoise, PALETTE.violet, PALETTE.terracotta, PALETTE.cream];
  for (const [z, y] of [[-14.2, 6.2], [-11.5, 6.6]] as const) {
    for (let i = 0; i < 22; i++) {
      const x = -10.5 + i;
      const sag = Math.sin((i / 21) * Math.PI) * 0.6;
      flags.add(x, y - sag, z, 0.7, 0.85, 0.02, 0, flagColors[i % flagColors.length]);
    }
  }
  const flagMesh = flags.build(GEO.plane, lambert(0xffffff, { side: THREE.DoubleSide }));
  group.add(flagMesh);

  // Balloons by the stage.
  for (const [bx, bz] of [[-7.6, -13.6], [7.6, -13.6]] as const) {
    for (let i = 0; i < 4; i++) {
      const b = mesh(GEO.sphere, lambert([PALETTE.pink, PALETTE.marigold, PALETTE.turquoise, PALETTE.violet][i]!), 0.5, 0.6, 0.5, bx + (i % 2) * 0.35 - 0.17, 2.6 + i * 0.3, bz + (i > 1 ? 0.3 : -0.1));
      group.add(b);
    }
    group.add(mesh(GEO.cylLo, lineMat, 0.015, 2.2, 0.015, bx, 1.3, bz));
  }

  mergeStatic(group);

  // Navigation grid.
  const nav = new NavGrid(-ARENA.outer, -ARENA.outer, ARENA.outer, ARENA.outer, ARENA.navCell, colliders, 0.45);

  const spawns: SpawnPoint[] = [
    { x: -15.5, z: -24, entryX: -15.5, entryZ: -18 },
    { x: 14.5, z: -24, entryX: 14.5, entryZ: -18 },
    { x: -12.5, z: 24, entryX: -12.5, entryZ: 18 },
    { x: 12.5, z: 24, entryX: 12.5, entryZ: 18 },
    { x: -24, z: 2.5, entryX: -18, entryZ: 2.5 },
    { x: 24, z: -3.5, entryX: 18, entryZ: -3.5 },
  ];

  let elapsed = 0;
  const update = (t: number, beat: number): void => {
    elapsed = t;
    statuePivot.rotation.y = elapsed * 0.6;
    statue.position.y = 3.6 + Math.sin(elapsed * 1.5) * 0.08;
    for (let i = 0; i < swayGroups.length; i++) {
      const g = swayGroups[i]!;
      g.rotation.x = Math.sin(elapsed * 1.3 + i * 1.7) * 0.06;
    }
    const pulse = 1 + beat * 0.12;
    for (const cone of speakerCones) cone.scale.y = 0.1 * pulse;
    for (let i = 0; i < spouts.length; i++) spouts[i]!.scale.y = 0.6 + Math.sin(elapsed * 6 + i) * 0.05;
  };

  const setShadows = (on: boolean, size: number): void => {
    sun.castShadow = on;
    sun.shadow.mapSize.set(size, size);
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
  };

  const playerStart = { x: 0, z: 15, yaw: 0 };
  return {
    group,
    colliders,
    nav,
    spawns,
    pickupSpots: [{ x: -13, z: -3.5 }, { x: 13, z: 12 }, { x: -6, z: 13 }, { x: 9, z: -4 }],
    playerStart,
    bossPos: new THREE.Vector3(0, 1.2, -15.6),
    bossWaveOrigin: new THREE.Vector3(0, 0, -13.6),
    dummySpots: [{ x: -3, z: 6 }, { x: 4, z: 4.5 }, { x: 0, z: 7.5 }],
    sun,
    hemi,
    speakerCones,
    update,
    setShadows,
  };
}
