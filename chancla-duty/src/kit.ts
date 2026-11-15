// CC0 props (Kenney fantasy town, nature, suburban, pirate) fitted to the
// map's collision boxes. Geometries are shared across rebuilds.
import * as THREE from 'three';
import type { MapBox, MapData } from '../../shared/map';

interface Model {
  size: THREE.Vector3;
  geo?: THREE.BufferGeometry;
  mat?: THREE.Material;
  template?: THREE.Object3D;
}

const models = new Map<string, Model>();
let ready = false;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

const FACADE = ['window', 'door', 'balcony', 'roof', 'lantern'] as const;
const CLONE = ['fountain', 'spout', 'stall', 'bench', 'barrel', 'crate', 'tree-oak', 'tree-palm', 'tree-round', 'bush', 'flower', 'house-a', 'house-b', 'house-c', 'house-d', 'chancla', 'chancla-heel'] as const;

export function kitReady(): boolean {
  return ready;
}

export async function loadKit(): Promise<void> {
  if (ready) return;
  await prepareMerge();
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const front = new Set<string>(FACADE);
  const names = [...FACADE, ...CLONE];
  await Promise.all(names.map(async (name) => {
    try {
      const gltf = await loader.loadAsync(`/chancla-duty/cc0/kit/${name}.glb`);
      models.set(name, front.has(name) ? bakeFront(gltf.scene) : bakeTemplate(gltf.scene));
    } catch { /* that prop stays procedural */ }
  }));
  ready = models.has('window') && models.has('door');
}

function bakeFront(root: THREE.Object3D): Model {
  root.updateMatrixWorld(true);
  const geos: THREE.BufferGeometry[] = [];
  let mat: THREE.Material | null = null;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    geos.push(g);
    mat ??= (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) ?? null;
  });
  const geo = geos.length > 1 ? (mergeFn!(geos, false) ?? geos[0]!) : geos[0]!;
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  geo.translate(-box.max.x, -box.min.y, -(box.min.z + box.max.z) / 2);
  const size = new THREE.Vector3(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
  prepMat(mat);
  return { geo, mat: mat ?? new THREE.MeshStandardMaterial(), size };
}

function bakeTemplate(root: THREE.Object3D): Model {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const ox = -(box.min.x + box.max.x) / 2;
  const oy = -box.min.y;
  const oz = -(box.min.z + box.max.z) / 2;
  root.position.set(ox, oy, oz);
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes.push(mesh);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) prepMat(m);
  });
  let geo: THREE.BufferGeometry | undefined;
  let mat: THREE.Material | undefined;
  const only = meshes.length === 1 ? meshes[0] : undefined;
  if (only && !Array.isArray(only.material)) {
    geo = only.geometry.clone();
    geo.applyMatrix4(only.matrixWorld);
    geo.translate(ox, oy, oz);
    mat = only.material;
  }
  return { template: root, size, ...(geo && mat ? { geo, mat } : {}) };
}

function prepMat(mat: THREE.Material | null): void {
  if (!mat) return;
  const std = mat as THREE.MeshStandardMaterial;
  std.metalness = 0;
  if (std.roughness == null || std.roughness > 0.98) std.roughness = 0.86;
  std.side = THREE.DoubleSide;
  std.polygonOffset = true;
  std.polygonOffsetFactor = -2;
  std.polygonOffsetUnits = -2;
  const n = (std.name || '').toLowerCase();
  if (n.includes('leaf') || n.includes('grass')) std.color.setHex(0x2f7d38);
  if (n.includes('bark') || n.includes('wood')) std.color.setHex(0x7a4e2d);
}

let mergeFn: typeof import('three/examples/jsm/utils/BufferGeometryUtils.js').mergeGeometries | null = null;

class Bucket {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  constructor(model: Model, cap: number) {
    this.mesh = new THREE.InstancedMesh(model.geo!, model.mat!, cap);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.userData['keepGeo'] = true;
  }
  add(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, tilt: number, hex: number): void {
    const cap = this.mesh.instanceColor!.count;
    if (this.n >= cap) return;
    _p.set(x, y, z);
    _e.set(tilt, yaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    _s.set(sx, sy, sz);
    this.mesh.setMatrixAt(this.n, _m.compose(_p, _q, _s));
    _c.setHex(hex);
    this.mesh.instanceColor!.setXYZ(this.n, _c.r, _c.g, _c.b);
    this.n++;
  }
  finish(parent: THREE.Object3D): void {
    if (!this.n) return;
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    parent.add(this.mesh);
  }
}

function yawOf(nx: number, nz: number): number {
  return Math.atan2(-nz, nx);
}

interface Face { nx: number; nz: number; fx: number; fz: number; ux: number; uz: number; len: number }

function faces(b: MapBox): Face[] {
  const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
  return [
    { nx: 0, nz: 1, fx: b.minX, fz: b.maxZ, ux: 1, uz: 0, len: w },
    { nx: 0, nz: -1, fx: b.maxX, fz: b.minZ, ux: -1, uz: 0, len: w },
    { nx: 1, nz: 0, fx: b.maxX, fz: b.maxZ, ux: 0, uz: -1, len: d },
    { nx: -1, nz: 0, fx: b.minX, fz: b.minZ, ux: 0, uz: 1, len: d },
  ];
}

function onFacade(b: MapBox, f: Face): boolean {
  if (b.facade === 's') return f.nz === 1;
  if (b.facade === 'n') return f.nz === -1;
  if (b.facade === 'e') return f.nx === 1;
  if (b.facade === 'w') return f.nx === -1;
  return f.len >= 4;
}

function put(bucket: Bucket, name: string, x: number, y: number, z: number, yaw: number, depth: number, height: number, width: number, tilt = 0, hex = 0xffffff): void {
  const model = models.get(name);
  if (!model?.size) return;
  bucket.add(x, y, z, depth / model.size.x, height / model.size.y, width / model.size.z, yaw, tilt, hex);
}

function dressBuilding(b: MapBox, windows: Bucket, doors: Bucket, balconies: Bucket | null, roofs: Bucket | null, lanterns: Bucket | null): void {
  const h = b.maxY - b.minY;
  for (const f of faces(b)) {
    if (f.len < 1.4) continue;
    const facade = onFacade(b, f);
    const cols = Math.max(1, Math.round(f.len / (facade ? 2.3 : 3.2)));
    const bay = f.len / cols;
    const yaw = yawOf(f.nx, f.nz);
    const signs = facade ? [1, -1] : [1];
    for (let k = 0; k < cols; k++) {
      const along = bay * (k + 0.5);
      for (const sign of signs) {
        const dist = sign > 0 ? 0.025 : -0.09;
        const x = f.fx + f.ux * along + f.nx * dist;
        const z = f.fz + f.uz * along + f.nz * dist;
        const door = facade && k === Math.floor(cols / 2) && h >= 3.6;
        if (door) {
          put(doors, 'door', x, 0, z, yaw, 0.16, Math.min(2.25, h - 0.4), Math.min(1.2, bay * 0.7));
          if (lanterns && sign > 0) put(lanterns, 'lantern', x + f.ux * 0.7 + f.nx * 0.28, 2.15, z + f.uz * 0.7 + f.nz * 0.28, yaw, 0.28, 0.7, 0.28);
        } else if (facade || h >= 4) {
          put(windows, 'window', x, 0.72, z, yaw, 0.14, 1.28, Math.min(1.15, bay * 0.72));
        }
        if (h >= 5.2 && (facade || k % 2 === 0)) {
          const kind = facade && k % 2 === 0 ? 'balcony' : 'window';
          const bucket = kind === 'balcony' ? balconies : windows;
          if (bucket) put(bucket, kind, x, Math.min(3.05, h - 1.7), z, yaw, kind === 'balcony' ? 0.22 : 0.14, 1.3, Math.min(1.25, bay * 0.78));
        }
      }
    }
    if (h >= 3.4 && facade) {
      const n = Math.max(2, Math.round(f.len / 1.15));
      for (let i = 0; i < n; i++) {
        const along = (i + 0.5) * (f.len / n);
        const x = f.fx + f.ux * along + f.nx * 0.42;
        const z = f.fz + f.uz * along + f.nz * 0.42;
        if (roofs) put(roofs, 'roof', x, b.maxY - 0.02, z, yaw, 0.95, 0.62, f.len / n, 0.42);
      }
    }
  }
}

const liveBatches = new Map<string, Bucket>();

function spawnClone(parent: THREE.Object3D, name: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0): void {
  const model = models.get(name);
  if (!model) return;
  if (model.geo && model.mat) {
    let bucket = liveBatches.get(name);
    if (!bucket) { bucket = new Bucket(model, 280); liveBatches.set(name, bucket); }
    bucket.add(x, y, z, sx, sy, sz, yaw, 0, 0xffffff);
    return;
  }
  if (!model.template) return;
  const obj = model.template.clone(true);
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.userData['keepGeo'] = true;
  });
  obj.scale.set(sx, sy, sz);
  obj.position.set(x, y, z);
  obj.rotation.y = yaw;
  parent.add(obj);
}

function fitBox(parent: THREE.Object3D, name: string, b: MapBox): void {
  const model = models.get(name);
  if (!model) return;
  const w = b.maxX - b.minX, h = b.maxY - b.minY, d = b.maxZ - b.minZ;
  const alongX = w >= d;
  const sx = (alongX ? d : w) / model.size.x;
  const sz = (alongX ? w : d) / model.size.z;
  spawnClone(parent, name, (b.minX + b.maxX) / 2, b.minY, (b.minZ + b.maxZ) / 2, sx, h / model.size.y, sz, alongX ? Math.PI / 2 : 0);
}

export function dressKit(parent: THREE.Object3D, boxes: readonly MapBox[], map: MapData): void {
  if (!ready) return;
  liveBatches.clear();
  const windowModel = models.get('window');
  const doorModel = models.get('door');
  if (!windowModel?.geo || !doorModel?.geo) return;
  const windows = new Bucket(windowModel, 720);
  const doors = new Bucket(doorModel, 160);
  const balconyModel = models.get('balcony');
  const roofModel = models.get('roof');
  const lanternModel = models.get('lantern');
  const balconies = balconyModel?.geo ? new Bucket(balconyModel, 320) : null;
  const roofs = roofModel?.geo ? new Bucket(roofModel, 280) : null;
  const lanterns = lanternModel?.geo ? new Bucket(lanternModel, 80) : null;
  const tall = boxes.filter((b) => b.mat.startsWith('stucco') && b.maxY - b.minY >= 3 && b.minY < 0.4);
  tall.sort((a, b) => (b.maxX - b.minX) * (b.maxZ - b.minZ) - (a.maxX - a.minX) * (a.maxZ - a.minZ));
  for (const b of tall) dressBuilding(b, windows, doors, balconies, roofs, lanterns);
  for (const bucket of [windows, doors, balconies, roofs, lanterns]) bucket?.finish(parent);

  for (const b of boxes) {
    if (b.mat === 'fountain' && b.minY < 0.2 && b.maxY < 2) {
      const model = models.get('fountain');
      if (model) {
        const s = Math.min(b.maxX - b.minX, b.maxZ - b.minZ) / model.size.x;
        spawnClone(parent, 'fountain', (b.minX + b.maxX) / 2, b.minY, (b.minZ + b.maxZ) / 2, s, s, s);
        spawnClone(parent, 'spout', (b.minX + b.maxX) / 2, b.minY + model.size.y * s * 0.9, (b.minZ + b.maxZ) / 2, s * 0.55, s * 0.55, s * 0.55, 0.4);
      }
    } else if (b.mat === 'stall') fitBox(parent, 'stall', b);
    else if (b.mat === 'crate') fitBox(parent, 'crate', b);
    else if (b.mat === 'bin') fitBox(parent, 'barrel', b);
    else if (b.mat === 'stone' && b.maxY - b.minY < 1.25 && !b.facade) fitBox(parent, 'bench', b);
    else if (b.mat === 'planter') plantsOn(parent, b, true);
    else if (b.mat === 'hedge') plantsOn(parent, b, false);
  }

  const bd = map.bounds;
  const reach = Math.max(36, Math.hypot(bd.maxX, bd.maxZ) + 4);
  const houses = ['house-a', 'house-b', 'house-c', 'house-d'];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = reach + (i % 3) * 2.5;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const house = models.get(houses[i % 4]!);
    if (house) {
      const s = 6.5 / house.size.y;
      spawnClone(parent, houses[i % 4]!, x, 0, z, s, s, s, a + Math.PI);
    }
    const tree = i % 2 ? 'tree-palm' : 'tree-oak';
    const t = models.get(tree);
    if (t) {
      const s = (i % 2 ? 6.2 : 4.8) / t.size.y;
      spawnClone(parent, tree, x + Math.cos(a + 0.4) * 3.2, 0, z + Math.sin(a + 0.4) * 3.2, s, s, s, i);
    }
  }
  for (const tr of map.decor?.trees ?? []) {
    const t = models.get('tree-round');
    if (!t) continue;
    const s = 4.2 / t.size.y;
    spawnClone(parent, 'tree-round', tr.x, tr.y, tr.z, s, s, s, 0.3);
  }
  for (const bucket of liveBatches.values()) bucket.finish(parent);
  liveBatches.clear();
}

function plantsOn(parent: THREE.Object3D, b: MapBox, tree: boolean): void {
  const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const alongX = w >= d;
  const n = Math.max(tree ? 1 : 3, Math.round(Math.max(w, d) / (tree ? 1.4 : 0.55)));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = alongX ? b.minX + w * t : cx;
    const z = alongX ? cz : b.minZ + d * t;
    if (tree && i === Math.floor(n / 2)) {
      const model = models.get(i % 2 ? 'tree-palm' : 'tree-oak');
      if (!model) continue;
      const s = 3.6 / model.size.y;
      spawnClone(parent, i % 2 ? 'tree-palm' : 'tree-oak', x, b.maxY, z, s, s, s, i);
    } else {
      const bush = models.get('bush');
      const flower = models.get('flower');
      if (bush) {
        const s = 0.42 / bush.size.y;
        spawnClone(parent, 'bush', x, b.maxY, z, s, s, s, i);
      }
      if (flower && i % 2 === 0) {
        const s = 0.45 / flower.size.y;
        spawnClone(parent, 'flower', x + 0.15, b.maxY, z, s, s, s, i);
      }
    }
  }
}

export function chanclaObject(hex: number, heel: boolean): THREE.Object3D {
  const name = heel ? 'chancla-heel' : 'chancla';
  const model = models.get(name) ?? models.get('chancla');
  const obj = model?.template ? model.template.clone(true) : new THREE.Object3D();
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.userData['keepGeo'] = true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mesh.material = mats.map((m) => {
      const c = m.clone();
      const std = c as THREE.MeshStandardMaterial;
      if (std.color && std.name !== 'strap') std.color.setHex(hex);
      return c;
    });
  });
  obj.scale.setScalar(0.9);
  return obj;
}

export function chanclaShotGeometry(): THREE.BufferGeometry | null {
  const model = models.get('chancla');
  if (!model?.template) return null;
  const geos: THREE.BufferGeometry[] = [];
  model.template.updateMatrixWorld(true);
  model.template.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    geos.push(g);
  });
  if (!geos.length) return null;
  if (!mergeFn) return geos[0]!;
  return mergeFn(geos, false) ?? geos[0]!;
}

export async function prepareMerge(): Promise<void> {
  if (mergeFn) return;
  const mod = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
  mergeFn = mod.mergeGeometries;
}
