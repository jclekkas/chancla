// CC0 props (Kenney fantasy town, nature, suburban, pirate) fitted to the
// map's collision boxes. Geometries are shared across rebuilds.
import * as THREE from 'three';
import type { MapBox, MapData } from '../../shared/map';

interface Piece { geo: THREE.BufferGeometry; mat: THREE.Material }
interface Model {
  size: THREE.Vector3;
  geo?: THREE.BufferGeometry;
  mat?: THREE.Material;
  template?: THREE.Object3D;
  pieces?: Piece[];
}

const models = new Map<string, Model>();
let ready = false;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
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
  const pieces: Piece[] = [];
  for (const mesh of meshes) {
    const g = mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    g.translate(ox, oy, oz);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (mats[0]) pieces.push({ geo: g, mat: mats[0] });
  }
  const first = pieces[0];
  return { template: root, size, pieces, ...(pieces.length === 1 && first ? { geo: first.geo, mat: first.mat } : {}) };
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

const piles = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();

function pushGeo(key: string, mat: THREE.Material, geo: THREE.BufferGeometry, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, tilt = 0): void {
  let pile = piles.get(key);
  if (!pile) { pile = { mat, geos: [] }; piles.set(key, pile); }
  const g = geo.clone();
  _p.set(x, y, z);
  _e.set(tilt, yaw, 0, 'YXZ');
  _q.setFromEuler(_e);
  _s.set(sx, sy, sz);
  g.applyMatrix4(_m.compose(_p, _q, _s));
  pile.geos.push(g);
}

function pileOf(name: string, mat: THREE.Material): string {
  const n = (mat.name || '').toLowerCase();
  if (name.startsWith('house')) return 'house';
  if (name === 'crate' || name === 'barrel') return 'pirate';
  if (name === 'flower') return 'flower';
  if (n.includes('leaf') || n.includes('grass') || name === 'bush') return 'leaf';
  if (n.includes('bark') || n.includes('wood')) return 'bark';
  return 'town';
}

function flushPiles(parent: THREE.Object3D): void {
  for (const [key, pile] of piles) {
    const merged = mergeFn ? mergeFn(pile.geos, false) : pile.geos[0];
    for (const g of pile.geos) if (g !== merged) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, pile.mat);
    mesh.name = `kit-${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
  }
  piles.clear();
}

function put(name: string, x: number, y: number, z: number, yaw: number, depth: number, height: number, width: number, tilt = 0): void {
  const model = models.get(name);
  if (!model?.geo || !model.mat || !model.size) return;
  pushGeo('town', model.mat, model.geo, x, y, z, depth / model.size.x, height / model.size.y, width / model.size.z, yaw, tilt);
}

function dressBuilding(b: MapBox): void {
  const h = b.maxY - b.minY;
  for (const f of faces(b)) {
    if (!onFacade(b, f) || f.len < 2 || h < 3.2) continue;
    const cols = Math.min(3, Math.max(1, Math.round(f.len / 4.2)));
    const bay = f.len / cols;
    const yaw = yawOf(f.nx, f.nz);
    const doorAt = Math.floor(cols / 2);
    for (let k = 0; k < cols; k++) {
      const along = bay * (k + 0.5);
      const x = f.fx + f.ux * along + f.nx * 0.04;
      const z = f.fz + f.uz * along + f.nz * 0.04;
      if (k === doorAt && h >= 4) {
        put('door', x, 0, z, yaw, 0.14, Math.min(2.2, h - 0.5), Math.min(1.15, bay * 0.62));
        put('lantern', x + f.ux * 0.85 + f.nx * 0.22, 2.05, z + f.uz * 0.85 + f.nz * 0.22, yaw, 0.22, 0.55, 0.22);
      } else {
        put('window', x, 0.85, z, yaw, 0.12, 1.35, Math.min(1.2, bay * 0.62));
      }
      if (h >= 5.4 && k === 0) put('balcony', x, Math.min(3.15, h - 1.55), z, yaw, 0.2, 1.25, Math.min(1.3, bay * 0.7));
    }
    const n = Math.min(4, Math.max(2, Math.round(f.len / 2.4)));
    for (let i = 0; i < n; i++) {
      const along = (i + 0.5) * (f.len / n);
      put('roof', f.fx + f.ux * along + f.nx * 0.35, b.maxY - 0.02, f.fz + f.uz * along + f.nz * 0.35, yaw, 0.85, 0.55, f.len / n, 0.4);
    }
  }
}

function frameDress(boxes: readonly MapBox[]): void {
  const camX = 5.2, camZ = 8.6;
  for (const b of boxes) {
    if (!b.facade || !b.mat.startsWith('stucco') || b.maxY < 2.4) continue;
    if (!(b.minX <= camX && camX <= b.maxX && b.minZ <= camZ && camZ <= b.maxZ)) continue;
    const f = faces(b).find((face) => onFacade(b, face));
    if (!f) continue;
    const alongCam = (camX - f.fx) * f.ux + (camZ - f.fz) * f.uz;
    const span = 2.3;
    const a0 = Math.max(0, Math.min(f.len - span, alongCam - span * 0.35));
    const yaw = yawOf(f.nx, f.nz);
    const h = b.maxY - b.minY;
    [0.2, 0.55, 0.82].forEach((t, i) => {
      const along = a0 + span * t;
      const x = f.fx + f.ux * along + f.nx * -0.1;
      const z = f.fz + f.uz * along + f.nz * -0.1;
      if (i === 1) put('door', x, 0, z, yaw, 0.16, Math.min(2.15, h - 0.35), 1.05);
      else put('window', x, 1.05, z, yaw, 0.14, 1.35, 1.1);
    });
    const along = a0 + span * 0.2;
    put('balcony', f.fx + f.ux * along + f.nx * -0.12, Math.min(3.2, h - 1.45), f.fz + f.uz * along + f.nz * -0.12, yaw, 0.22, 1.2, 1.25);
  }
}

function spawnClone(parent: THREE.Object3D, name: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0): void {
  void parent;
  const model = models.get(name);
  for (const piece of model?.pieces ?? []) pushGeo(pileOf(name, piece.mat), piece.mat, piece.geo, x, y, z, sx, sy, sz, yaw);
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
  piles.clear();
  if (!models.get('window')?.geo || !models.get('door')?.geo) return;
  const tall = boxes.filter((b) => b.mat.startsWith('stucco') && b.maxY - b.minY >= 3 && b.minY < 0.4);
  tall.sort((a, b) => (b.maxX - b.minX) * (b.maxZ - b.minZ) - (a.maxX - a.minX) * (a.maxZ - a.minZ));
  for (const b of tall) dressBuilding(b);
  frameDress(boxes);

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
    else if (b.mat === 'hedge') hedgeRow(parent, b);
  }

  const bd = map.bounds;
  const reach = Math.max(36, Math.hypot(bd.maxX, bd.maxZ) + 4);
  // Far skyline: four simplified houses and two trees. The mesh is the decimated
  // house, and the batch is culled when the whole ring leaves the frustum.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.5;
    const r = reach + 1.5;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const house = models.get('house-a');
    if (house) {
      const s = 5.5 / house.size.y;
      spawnClone(parent, 'house-a', x, 0, z, s, s, s, a + Math.PI);
    }
    if (i % 2 === 0) {
      const tree = i === 0 ? 'tree-palm' : 'tree-oak';
      const t = models.get(tree);
      if (t) {
        const s = 4.6 / t.size.y;
        spawnClone(parent, tree, x + Math.cos(a + 0.5) * 2.4, 0, z + Math.sin(a + 0.5) * 2.4, s, s, s, i);
      }
    }
  }
  for (const tr of map.decor?.trees ?? []) {
    const t = models.get('tree-round');
    if (!t) continue;
    const s = 4.2 / t.size.y;
    spawnClone(parent, 'tree-round', tr.x, tr.y, tr.z, s, s, s, 0.3);
  }
  flushPiles(parent);
}

const hedgeMat = new THREE.MeshStandardMaterial({ color: 0x1c6a30, roughness: 0.86, metalness: 0 });
const hedgeGeo = new THREE.IcosahedronGeometry(0.45, 0);
hedgeGeo.scale(1.15, 0.7, 1);
hedgeGeo.translate(0, 0.32, 0);

function hedgeRow(parent: THREE.Object3D, b: MapBox): void {
  const w = b.maxX - b.minX, h = b.maxY - b.minY, d = b.maxZ - b.minZ;
  const alongX = w >= d;
  const n = Math.min(4, Math.max(2, Math.round(Math.max(w, d) / 1.1)));
  const sy = h / 0.64;
  const sx = (Math.max(w, d) / n) / 0.9;
  const sz = Math.min(w, d) / 0.8;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = alongX ? b.minX + w * t : (b.minX + b.maxX) / 2;
    const z = alongX ? (b.minZ + b.maxZ) / 2 : b.minZ + d * t;
    pushGeo('hedge', hedgeMat, hedgeGeo, x, 0, z, alongX ? sx : sz, sy, alongX ? sz : sx, 0);
  }
  void parent;
}

function plantsOn(parent: THREE.Object3D, b: MapBox, tree: boolean): void {
  const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const alongX = w >= d;
  const n = tree ? 1 : Math.min(3, Math.max(1, Math.round(Math.max(w, d) / 1.8)));
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
