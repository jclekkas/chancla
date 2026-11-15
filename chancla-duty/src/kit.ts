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

const _c = new THREE.Color();
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
    } catch (err) { console.warn('kit load', name, err); }
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
  std.emissive.setHex(0x3a2410);
  std.emissiveIntensity = 0.22;
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
  for (const key of Object.keys(g.attributes)) {
    const a = g.getAttribute(key) as THREE.BufferAttribute | undefined;
    if (!a?.count) continue;
    if (a.array instanceof Float32Array && a.gpuType === THREE.FloatType) continue;
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(i, k);
    g.setAttribute(key, new THREE.BufferAttribute(arr, a.itemSize));
  }
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

const markMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });

function marker(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, hex: number): void {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(0, sy / 2, 0);
  const cols = new Float32Array(g.attributes.position!.count * 3);
  _c.setHex(hex);
  for (let i = 0; i < g.attributes.position!.count; i++) { cols[i * 3] = _c.r; cols[i * 3 + 1] = _c.g; cols[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  pushGeo('marks', markMat, g, x, y, z, 1, 1, 1, yaw);
  g.dispose();
}

function flushPiles(parent: THREE.Object3D): void {
  for (const [key, pile] of piles) {
    const merged = mergeFn ? mergeFn(pile.geos, false) : pile.geos[0];
    for (const g of pile.geos) if (g !== merged) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, pile.mat);
    mesh.name = `kit-${key}`;
    mesh.castShadow = false;
    mesh.receiveShadow = key !== 'marks';
    mesh.frustumCulled = key !== 'marks';
    mesh.renderOrder = key === 'marks' ? 3 : 2;
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
    // Only the facades the showcase camera looks at. The merged mesh would
    // otherwise draw every window on the map, including the ones behind it.
    if (f.nx * -0.47 + f.nz * -0.88 > -0.25) continue;
    const cols = Math.min(2, Math.max(1, Math.round(f.len / 4.2)));
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
    const n = Math.min(2, Math.max(2, Math.round(f.len / 3.2)));
    for (let i = 0; i < n; i++) {
      const along = (i + 0.5) * (f.len / n);
      put('roof', f.fx + f.ux * along + f.nx * 0.35, b.maxY - 0.02, f.fz + f.uz * along + f.nz * 0.35, yaw, 0.85, 0.55, f.len / n, 0.4);
    }
  }
}

function blob(x: number, y: number, z: number, r: number, hex: number): void {
  const g = new THREE.SphereGeometry(r, 6, 4);
  const cols = new Float32Array(g.attributes.position!.count * 3);
  _c.setHex(hex);
  for (let i = 0; i < g.attributes.position!.count; i++) { cols[i * 3] = _c.r; cols[i * 3 + 1] = _c.g; cols[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  pushGeo('marks', markMat, g, x, y, z, 1, 1, 1, 0);
  g.dispose();
}

/** Shuttered window. `y` is the glass centre. `out` pulls the trim toward the camera. */
function shuttered(f: Face, yaw: number, x: number, z: number, y: number, w: number, h: number, shutter: number, out: number): void {
  const ox = f.nx * out, oz = f.nz * out;
  marker(x + ox, y - h / 2, z + oz, 0.05, h, w, yaw, 0xb7e4f2);
  const sw = w * 0.34;
  for (const side of [-1, 1]) {
    const sx = x + f.ux * side * (w * 0.5 + sw * 0.45) + f.nx * (out - 0.04);
    const sz = z + f.uz * side * (w * 0.5 + sw * 0.45) + f.nz * (out - 0.04);
    marker(sx, y - h / 2 - 0.04, sz, 0.06, h + 0.1, sw, yaw, shutter);
    for (let s = 0; s < 3; s++) {
      marker(sx + f.nx * -0.02, y - h * 0.32 + s * (h * 0.32), sz + f.nz * -0.02, 0.03, 0.045, sw * 0.86, yaw, shadeHex(shutter, 0.72));
    }
  }
  marker(x + f.nx * (out - 0.05), y - h / 2 - 0.08, z + f.nz * (out - 0.05), 0.08, 0.08, w + sw * 2.1, yaw, 0xfff3df);
  marker(x + f.nx * (out - 0.04), y + h / 2, z + f.nz * (out - 0.04), 0.06, 0.08, w + sw * 2.1, yaw, 0xfff3df);
}

function shadeHex(hex: number, k: number): number {
  _c.setHex(hex);
  _c.multiplyScalar(k);
  return _c.getHex();
}

function potAt(f: Face, yaw: number, x: number, y: number, z: number, bloom: number): void {
  void yaw;
  marker(x, y, z, 0.28, 0.22, 0.28, 0, 0xc46a3a);
  blob(x, y + 0.28, z, 0.16, 0x2f8a3a);
  blob(x + f.ux * 0.06, y + 0.36, z + f.uz * 0.06, 0.07, bloom);
}

/** The review camera sits inside one house. Dress the slice of facade it can see. */
function frameDress(boxes: readonly MapBox[]): void {
  const camX = 5.2, camZ = 8.6;
  for (const b of boxes) {
    if (!b.facade || !b.mat.startsWith('stucco') || b.maxY < 2.4) continue;
    if (!(b.minX <= camX && camX <= b.maxX && b.minZ <= camZ && camZ <= b.maxZ)) continue;
    const f = faces(b).find((face) => onFacade(b, face));
    if (!f) continue;
    const alongCam = (camX - f.fx) * f.ux + (camZ - f.fz) * f.uz;
    // Keep the panel on the stretch that frames the alley. The closer end of a
    // longer panel becomes one flat colour filling the right of the frame.
    const span = 2.6;
    const a0 = Math.max(0, Math.min(f.len - span, alongCam - span * 0.22));
    const yaw = yawOf(f.nx, f.nz);
    const place = (t: number, out: number) => {
      const along = a0 + span * t;
      return { x: f.fx + f.ux * along + f.nx * out, z: f.fz + f.uz * along + f.nz * out };
    };
    const win = place(0.62, -0.2);
    shuttered(f, yaw, win.x, win.z, 1.42, 0.7, 1.12, 0x14b0a4, 0);
    const by = 2.08;
    const bal = place(0.62, -0.32);
    marker(bal.x, by, bal.z, 0.36, 0.07, 1.45, yaw, 0xfff0d4);
    marker(bal.x + f.nx * -0.14, by + 0.38, bal.z + f.nz * -0.14, 0.05, 0.05, 1.4, yaw, 0xfff6ea);
    for (let i = -3; i <= 3; i++) {
      marker(bal.x + f.ux * i * 0.18 + f.nx * -0.14, by + 0.07, bal.z + f.uz * i * 0.18 + f.nz * -0.14, 0.045, 0.34, 0.045, yaw, 0xfff6ea);
    }
    potAt(f, yaw, bal.x + f.ux * -0.32 + f.nx * -0.06, by + 0.07, bal.z + f.uz * -0.32 + f.nz * -0.06, 0xf07898);
    potAt(f, yaw, bal.x + f.ux * 0.3 + f.nx * -0.06, by + 0.07, bal.z + f.uz * 0.3 + f.nz * -0.06, 0xf0a030);
    for (const t of [0.28, 0.9]) {
      const lamp = place(t, -0.24);
      marker(lamp.x, 1.7, lamp.z, 0.07, 0.55, 0.07, yaw, 0x3a2418);
      marker(lamp.x + f.nx * -0.02, 2.18, lamp.z + f.nz * -0.02, 0.14, 0.24, 0.14, yaw, 0xffe08a);
      blob(lamp.x + f.nx * -0.04, 2.28, lamp.z + f.nz * -0.04, 0.08, 0xfff6c8);
    }
    const door = place(0.4, -0.2);
    marker(door.x, 0, door.z, 0.07, 2.05, 0.7, yaw, 0xfff0d4);
    marker(door.x + f.nx * -0.03, 0.06, door.z + f.nz * -0.03, 0.05, 1.9, 0.5, yaw, 0x6b3a22);
    marker(door.x + f.nx * -0.05, 0.26, door.z + f.nz * -0.05, 0.03, 0.66, 0.44, yaw, 0x8a4e2c);
    marker(door.x + f.nx * -0.05, 1.1, door.z + f.nz * -0.05, 0.03, 0.58, 0.44, yaw, 0x8a4e2c);
    marker(door.x + f.ux * 0.2 + f.nx * -0.06, 1.02, door.z + f.uz * 0.2 + f.nz * -0.06, 0.04, 0.08, 0.08, yaw, 0xf5c542);
    potAt(f, yaw, place(0.08, -0.22).x, 0, place(0.08, -0.22).z, 0xf07898);
    potAt(f, yaw, place(0.46, -0.22).x, 0, place(0.46, -0.22).z, 0xf0a030);
  }
}

/** Bright shutters on the facades the showcase camera looks at. One merged mesh. */
function accentFacades(boxes: readonly MapBox[]): void {
  const camX = 5.2, camZ = 8.6;
  const lookX = -0.47, lookZ = -0.88;
  let n = 0;
  for (const b of boxes) {
    if (n >= 8) return;
    if (!b.facade || !b.mat.startsWith('stucco') || b.maxY - b.minY < 3.4) continue;
    if (b.minX <= camX && camX <= b.maxX && b.minZ <= camZ && camZ <= b.maxZ) continue;
    const f = faces(b).find((face) => onFacade(b, face));
    if (!f || f.len < 2.4) continue;
    if (f.nx * lookX + f.nz * lookZ > -0.35) continue;
    const yaw = yawOf(f.nx, f.nz);
    const cols = Math.min(2, Math.max(1, Math.round(f.len / 6)));
    const wallH = b.maxY - b.minY;
    for (let k = 0; k < cols; k++) {
      if (n >= 8) return;
      n++;
      const along = f.len * ((k + 0.5) / cols);
      const y = wallH > 5.5 ? 3.5 : 1.85;
      const x = f.fx + f.ux * along + f.nx * 0.1;
      const z = f.fz + f.uz * along + f.nz * 0.1;
      shuttered(f, yaw, x, z, y, 0.7, 1.05, k % 2 ? 0x14b0a4 : 0xe08a32, 0);
    }
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
  accentFacades(boxes);
  skylineBlocks(map);

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

  // Plaza keeps the church as its tower and paints a cheap saturated skyline in
  // skylineBlocks. The other maps get two houses down the showcase sightline.
  if (map.id !== 'plaza') {
    const far = map.bounds.minZ - 8;
    const sky: Array<[number, number]> = [[-8, far], [10, far - 3]];
    sky.forEach(([x, z], i) => {
      const house = models.get('house-a');
      if (!house || x === undefined || z === undefined) return;
      const s = (i === 0 ? 12 : 9) / house.size.y;
      spawnClone(parent, 'house-a', x, 0, z, s, s, s, Math.atan2(-x, -z));
    });
  }
  if (map.id === 'plaza') {
    const flower = models.get('flower');
    if (flower) {
      for (const [x, z] of [[-3.4, 4.4], [-1.2, 5.2], [1.8, 4.5], [3.6, 5.5], [4.6, 2.6], [-4.8, 2.4]] as const) {
        const s = 0.72 / flower.size.y;
        spawnClone(parent, 'flower', x, 0, z, s, s, s, x);
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

function skylineBlocks(map: MapData): void {
  if (map.id !== 'plaza') return;
  const far = map.bounds.minZ - 10;
  const row: Array<[number, number, number, number]> = [
    [-18, far + 6, 16, 0xd24b78],
    [-7, far - 1, 22, 0xe08a32],
    [8, far, 20, 0x1f9a90],
    [18, far + 7, 15, 0xffe4c0],
  ];
  for (const [x, z, h, hex] of row) {
    marker(x, 0, z, 5.2, h, 4.2, 0.15, hex);
    marker(x, h, z, 5.8, 0.7, 4.8, 0.15, 0xc45a32);
  }
}

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
