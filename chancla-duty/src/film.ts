// Stylized animated-film cast and town dressing for the high tier.
// Original shapes, team colors, and roles. No scanned soldiers.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapBox } from '../../shared/map';

export type FilmKind = 'sol' | 'luna' | 'abuela';

export interface FilmWoman {
  root: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  foreR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  kind: FilmKind;
}

const skinMat = new THREE.MeshStandardMaterial({ color: 0xd9a07a, roughness: 0.55, metalness: 0 });
const goldMat = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.35, metalness: 0.4 });

function cloth(hex: number, map?: THREE.Texture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: hex, map: map ?? null, roughness: 0.62, metalness: 0 });
}

const headGeo = new THREE.SphereGeometry(0.15, 22, 16);
const curlGeo = new THREE.TorusGeometry(0.045, 0.02, 6, 10);
const dressPts = [0.16, 0.05, 0.2, -0.12, 0.28, -0.32, 0.38, -0.58, 0.34, -0.64].reduce<THREE.Vector2[]>((acc, n, i, arr) => {
  if (i % 2 === 0) acc.push(new THREE.Vector2(n, arr[i + 1]!));
  return acc;
}, []);
const dressGeo = new THREE.LatheGeometry(dressPts, 22);
const limbGeo = new THREE.CapsuleGeometry(0.045, 0.22, 4, 8);
const thighGeo = new THREE.CapsuleGeometry(0.06, 0.24, 4, 8);

const filmMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.66, metalness: 0 });

function painted(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const n = geo.attributes.position!.count;
  const cols = new Float32Array(n * 3);
  const c = new THREE.Color(hex);
  for (let i = 0; i < n; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}

function chunk(parent: THREE.Object3D, parts: Array<[THREE.BufferGeometry, number]>): void {
  const geos = parts.map(([g, hex]) => painted(g, hex));
  const merged = merge(geos);
  const m = new THREE.Mesh(merged, filmMat);
  m.castShadow = false;
  m.receiveShadow = true;
  parent.add(m);
}

export function buildFilmWoman(kind: FilmKind): FilmWoman {
  const root = new THREE.Group();
  root.name = `film-${kind}`;
  const hips = new THREE.Group();
  hips.position.y = 0.92;
  root.add(hips);
  const sol = kind === 'sol';
  const luna = kind === 'luna';
  const dressHex = sol ? 0xe8942a : luna ? 0x1f9aa8 : 0x3a6eb8;
  const torso = new THREE.Group();
  hips.add(torso);
  const skirt = dressGeo.clone();
  skirt.translate(0, 0.02, 0);
  const hem = new THREE.TorusGeometry(0.36, 0.02, 6, 18);
  hem.rotateX(Math.PI / 2);
  hem.translate(0, -0.6, 0);
  chunk(hips, [[skirt, dressHex], [hem, sol ? 0xfff1c4 : luna ? 0xf4e6c8 : 0xf7f1e6]]);
  const bodice = new THREE.CapsuleGeometry(0.16, 0.2, 5, 10);
  bodice.scale(1.05, 1, 0.8);
  bodice.translate(0, 0.24, 0);
  const shawlHex = luna ? 0x5a3480 : kind === 'abuela' ? 0x146e84 : 0xf6ead2;
  const shawl = new THREE.TorusGeometry(0.2, 0.04, 6, 14, Math.PI * 1.3);
  shawl.rotateX(1.2);
  shawl.translate(0, 0.4, 0.02);
  const torsoParts: Array<[THREE.BufferGeometry, number]> = [[bodice, dressHex], [shawl, shawlHex]];
  if (kind !== 'luna') {
    const apron = new THREE.BoxGeometry(0.22, 0.32, 0.03);
    apron.translate(0, 0.1, 0.16);
    torsoParts.push([apron, 0xe7d3bc]);
  }
  chunk(torso, torsoParts);

  const legL = new THREE.Group();
  const legR = new THREE.Group();
  legL.position.set(-0.09, -0.02, 0);
  legR.position.set(0.09, -0.02, 0);
  hips.add(legL, legR);
  const thigh = thighGeo.clone();
  thigh.translate(0, -0.18, 0);
  const shoe = new THREE.BoxGeometry(0.1, 0.05, 0.16);
  shoe.translate(0, -0.4, 0.02);
  chunk(legL, [[thigh, 0xd9a07a], [shoe, 0x6b3a22]]);
  chunk(legR, [[thigh.clone(), 0xd9a07a], [shoe.clone(), 0x6b3a22]]);

  const head = new THREE.Group();
  head.position.y = 0.5;
  torso.add(head);
  const face = headGeo.clone();
  face.translate(0, 0.08, 0);
  const headParts: Array<[THREE.BufferGeometry, number]> = [[face, 0xd9a07a]];
  for (const x of [-0.05, 0.05]) {
    const white = new THREE.SphereGeometry(0.026, 8, 6);
    white.translate(x, 0.1, 0.125);
    const iris = new THREE.SphereGeometry(0.012, 6, 5);
    iris.translate(x, 0.1, 0.146);
    const brow = new THREE.CapsuleGeometry(0.008, 0.04, 2, 5);
    brow.rotateZ(x < 0 ? 0.4 : -0.4);
    brow.translate(x, 0.145, 0.13);
    headParts.push([white, 0xfff8f2], [iris, 0x4a2a16], [brow, 0x3a2418]);
  }
  const smile = new THREE.TorusGeometry(0.028, 0.006, 4, 8, Math.PI);
  smile.rotateX(Math.PI / 2);
  smile.rotateZ(Math.PI);
  smile.translate(0, 0.03, 0.14);
  headParts.push([smile, 0xc23b4a]);
  const cap = new THREE.SphereGeometry(0.155, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.1);
  cap.translate(0, 0.12, -0.01);
  headParts.push([cap, 0x3a2418]);
  if (kind === 'abuela') {
    [0xf07898, 0x3ec4b8, 0xf0a030, 0x8d5cb0].forEach((hex, i) => {
      const r = new THREE.CylinderGeometry(0.032, 0.032, 0.1, 8);
      r.rotateZ(Math.PI / 2);
      r.translate((i - 1.5) * 0.07, 0.24, i % 2 ? 0.02 : -0.02);
      headParts.push([r, hex]);
    });
    for (const x of [-0.05, 0.05]) {
      const g = new THREE.TorusGeometry(0.038, 0.006, 5, 10);
      g.rotateY(Math.PI / 2);
      g.translate(x, 0.1, 0.14);
      headParts.push([g, 0x2a2118]);
    }
  } else {
    for (let i = 0; i < 5; i++) {
      const a = -1.1 + (i / 4) * 2.2;
      const curl = curlGeo.clone();
      curl.rotateY(a);
      curl.translate(Math.sin(a) * 0.13, 0.14, -0.06 + Math.cos(a) * 0.04);
      headParts.push([curl, 0x3a2418]);
    }
    if (sol) {
      const brim = new THREE.CylinderGeometry(0.24, 0.26, 0.018, 14);
      brim.translate(0, 0.26, 0);
      const crown = new THREE.CylinderGeometry(0.09, 0.11, 0.09, 10);
      crown.translate(0, 0.31, 0);
      headParts.push([brim, 0xe6c56a], [crown, 0xe6c56a]);
    } else {
      const hood = new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
      hood.translate(0, 0.12, 0.02);
      headParts.push([hood, 0x36b9c9]);
    }
  }
  chunk(head, headParts);

  const armL = new THREE.Group();
  const armR = new THREE.Group();
  armL.position.set(-0.22, 0.34, 0);
  armR.position.set(0.22, 0.34, 0);
  torso.add(armL, armR);
  const foreL = new THREE.Group();
  const foreR = new THREE.Group();
  foreL.position.y = -0.3;
  foreR.position.y = -0.3;
  armL.add(foreL);
  armR.add(foreR);
  const upper = limbGeo.clone();
  upper.translate(0, -0.14, 0);
  chunk(armL, [[upper, dressHex]]);
  chunk(armR, [[upper.clone(), dressHex]]);
  const fore = limbGeo.clone();
  fore.translate(0, -0.12, 0);
  const hand = new THREE.SphereGeometry(0.048, 8, 6);
  hand.translate(0, -0.28, 0);
  chunk(foreL, [[fore, 0xd9a07a], [hand, 0xd9a07a]]);
  chunk(foreR, [[fore.clone(), 0xd9a07a], [hand.clone(), 0xd9a07a]]);

  const proxy = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.7, 2, 6), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  proxy.position.y = 0.85;
  proxy.castShadow = true;
  root.add(proxy);

  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m !== proxy) m.castShadow = false;
  });
  return { root, hips, torso, head, armL, armR, foreR, legL, legR, kind };
}

/** Idle, walk, run, throw wind-up, and hit. Driven by the same timings as the match. */
export function poseFilm(w: FilmWoman, speed: number, throwAge: number, hitAge: number, alive: boolean, now: number): void {
  const run = speed > 6;
  const walk = speed > 0.4;
  const amp = run ? 0.7 : walk ? 0.4 : 0.04;
  const phase = now * 0.001 * (run ? 9 : walk ? 5.5 : 1.6);
  const s = Math.sin(phase);
  w.legL.rotation.x = s * amp;
  w.legR.rotation.x = -s * amp;
  w.armL.rotation.x = -s * amp * 0.8;
  w.armR.rotation.x = s * amp * 0.6;
  w.hips.position.y = 0.92 + Math.abs(s) * (run ? 0.04 : 0.02);
  w.hips.rotation.y = s * (walk ? 0.06 : 0.02);
  w.torso.rotation.x = walk ? 0.06 : Math.sin(now * 0.0015) * 0.02;
  w.head.rotation.z = s * 0.04;
  w.head.rotation.x = 0;
  w.foreR.rotation.x = 0;
  if (throwAge < 0.45) {
    const t = throwAge / 0.45;
    const wind = t < 0.45 ? t / 0.45 : 1 - (t - 0.45) / 0.55;
    w.armR.rotation.x = -1.15 * (t < 0.45 ? wind : 0.2);
    w.foreR.rotation.x = -0.8 * wind;
    w.torso.rotation.x = -0.15 * wind;
  }
  if (hitAge < 0.35) {
    const k = 1 - hitAge / 0.35;
    w.torso.rotation.x = 0.35 * k;
    w.head.rotation.x = 0.4 * k;
    w.hips.position.y = 0.92 - 0.06 * k;
  }
  if (!alive) {
    w.hips.rotation.x = 1.2;
    w.hips.position.y = 0.35;
  } else {
    w.hips.rotation.x = 0;
  }
}

const roofMat = new THREE.MeshStandardMaterial({ color: 0xc45a32, roughness: 0.82, metalness: 0 });
const stoneTrim = new THREE.MeshStandardMaterial({ color: 0xe7d7c4, roughness: 0.9, metalness: 0 });
const mountainMat = new THREE.MeshStandardMaterial({ color: 0x8d6a78, roughness: 1, metalness: 0 });
const vineMat = new THREE.MeshStandardMaterial({ color: 0xc43b78, roughness: 0.6, metalness: 0, side: THREE.DoubleSide });

function talavera(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4efe4';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#1f6f86';
  g.lineWidth = 6;
  g.strokeRect(8, 8, 112, 112);
  g.fillStyle = '#f0a030';
  g.beginPath();
  g.arc(64, 64, 28, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#3d6fbf';
  g.lineWidth = 4;
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  return t;
}

function shrineArt(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 192;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1f6f86';
  g.fillRect(0, 0, 128, 192);
  g.fillStyle = '#f4efe4';
  g.fillRect(10, 10, 108, 172);
  g.fillStyle = '#f0a030';
  g.beginPath();
  g.arc(64, 58, 22, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3d6fbf';
  g.beginPath();
  g.moveTo(64, 78);
  g.lineTo(96, 160);
  g.lineTo(32, 160);
  g.fill();
  g.fillStyle = '#c43b78';
  for (const x of [28, 100]) {
    g.beginPath();
    g.arc(x, 150, 8, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Roofs, mountains, a tiled fountain face, vines, and a small shrine. One draw each. */
export function addFilmTown(parent: THREE.Object3D, boxes: readonly MapBox[]): void {
  const roofs: THREE.BufferGeometry[] = [];
  const trims: THREE.BufferGeometry[] = [];
  let vines = 0;
  const vine = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.7, 0.9), vineMat, 24);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (const b of boxes) {
    if (!b.mat.startsWith('stucco') || b.maxY - b.minY < 3 || b.minY > 0.4) continue;
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const roof = new THREE.BoxGeometry(w + 0.45, 0.22, d + 0.45);
    roof.translate((b.minX + b.maxX) / 2, b.maxY + 0.12, (b.minZ + b.maxZ) / 2);
    roofs.push(roof);
    const eave = new THREE.BoxGeometry(w + 0.7, 0.08, d + 0.7);
    eave.translate((b.minX + b.maxX) / 2, b.maxY + 0.02, (b.minZ + b.maxZ) / 2);
    trims.push(eave);
    if (vines < 24 && w > 3) {
      q.setFromEuler(new THREE.Euler(0, Math.atan2(d, w), 0));
      m.compose(new THREE.Vector3(b.minX + w * 0.3, b.maxY * 0.55, b.maxZ + 0.08), q, new THREE.Vector3(1, 1, 1));
      vine.setMatrixAt(vines, m);
      vine.setColorAt(vines, new THREE.Color(vines % 2 ? 0xc43b78 : 0x6a2a88));
      vines++;
    }
  }
  vine.count = vines;
  vine.instanceMatrix.needsUpdate = true;
  if (vine.instanceColor) vine.instanceColor.needsUpdate = true;
  if (roofs.length) parent.add(new THREE.Mesh(merge(roofs), roofMat));
  if (trims.length) parent.add(new THREE.Mesh(merge(trims), stoneTrim));
  if (vines) parent.add(vine);

  const peaks: THREE.BufferGeometry[] = [];
  for (const [x, z, s] of [[-46, -40, 1], [10, -62, 1.35], [48, -36, 0.85]] as const) {
    const g = new THREE.ConeGeometry(22 * s, 14 * s, 6);
    g.translate(x, 4 * s, z);
    peaks.push(g);
  }
  const mountains = new THREE.Mesh(merge(peaks), mountainMat);
  mountains.castShadow = false;
  mountains.receiveShadow = false;
  parent.add(mountains);

  const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.45, 0.5, 18), new THREE.MeshStandardMaterial({ map: talavera(), roughness: 0.45, metalness: 0.05 }));
  basin.name = 'duty-basin';
  basin.position.set(0, 0.28, 0);
  parent.add(basin);

  const niche = new THREE.Group();
  niche.position.set(7.2, 0, -4.6);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.7, 0.18), stoneTrim);
  frame.position.y = 1.15;
  const tile = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 1.1), new THREE.MeshStandardMaterial({ map: shrineArt(), roughness: 0.5 }));
  tile.position.set(0, 1.2, 0.1);
  niche.add(frame, tile);
  parent.add(niche);
}

function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return geos.length === 1 ? geos[0]! : (mergeGeometries(geos, false) ?? geos[0]!);
}

export interface FilmPuppet {
  root: THREE.Object3D;
  lods: THREE.Object3D[];
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  current: string;
}

export interface HeroProps {
  chancla: THREE.Mesh | null;
  chanclaShot: THREE.BufferGeometry | null;
  chanclaMat: THREE.Material | null;
  fountain: THREE.Object3D | null;
  door: THREE.Object3D | null;
  arms: THREE.Object3D | null;
}

const HERO = '/chancla-duty/cc0/heroes';

function prepMesh(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (mat && mat.isMeshStandardMaterial) {
      const cloth = new THREE.MeshPhysicalMaterial({
        map: mat.map ?? null,
        color: mat.color,
        roughness: 0.55,
        metalness: 0,
        sheen: 0.35,
        sheenRoughness: 0.55,
        sheenColor: new THREE.Color(0xffe4c8),
      });
      mesh.material = cloth;
      mesh.geometry.computeVertexNormals();
    }
  });
}

function fitHeight(root: THREE.Object3D, meters: number): number {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const h = Math.max(0.001, box.max.y - box.min.y);
  const s = meters / h;
  root.scale.setScalar(s);
  const foot = -box.min.y * s;
  root.position.y = foot;
  return foot;
}

/** Textured TripoSR / Hunyuan meshes. LOD0 is the detailed mesh. */
export async function loadFilmCast(parent: THREE.Object3D): Promise<FilmPuppet[]> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const names = ['rosa', 'luna', 'abuela', 'abuela-patio'] as const;
  const heights: Record<string, number> = { rosa: 1.6, luna: 1.58, abuela: 1.5, 'abuela-patio': 1.48 };
  const out: FilmPuppet[] = [];
  for (const name of names) {
    const gltfs = await Promise.all([0, 1, 2].map((i) => loader.loadAsync(`${HERO}/${name}-lod${i}.glb`)));
    const root = new THREE.Group();
    root.name = `hero-${name}`;
    const lods: THREE.Object3D[] = [];
    gltfs.forEach((gltf, i) => {
      const lod = gltf.scene;
      prepMesh(lod);
      dropStackedTop(lod);
      if (i === 0) fitHeight(lod, heights[name] ?? 1.58);
      else {
        lod.scale.copy(gltfs[0].scene.scale);
        lod.position.copy(gltfs[0].scene.position);
      }
      sculptFriendlyHead(lod, name);
      lod.visible = i === 0;
      root.add(lod);
      lods.push(lod);
    });
    const proxy = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.7, 2, 6), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    proxy.position.y = 0.85;
    proxy.castShadow = true;
    // Soft fill from above the face, and a warm rim from behind. Local +Z is the face.
  const faceFill = new THREE.PointLight(0xfff6ee, 2.4, 3.4, 2);
  faceFill.position.set(0, 1.6, 1.25);
  const rim = new THREE.PointLight(0xffc98a, 1.2, 2.8, 2);
  rim.position.set(0, 1.75, -0.65);
    root.add(proxy, faceFill, rim);
    root.visible = false;
    root.userData['keep'] = true;
    root.userData['foot'] = 0;
    parent.add(root);
    out.push({ root, lods, mixer: new THREE.AnimationMixer(root), actions: new Map(), current: '' });
  }
  return out;
}

export async function loadHeroProps(): Promise<HeroProps> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const [chancla, fountain, door, arms] = await Promise.all([
    loader.loadAsync(`${HERO}/chancla-lod0.glb`),
    loader.loadAsync(`${HERO}/fountain.glb`),
    loader.loadAsync(`${HERO}/door.glb`),
    loader.loadAsync(`${HERO}/arms.glb`),
  ]);
  const shotGltf = await loader.loadAsync(`${HERO}/chancla-lod1.glb`);
  prepMesh(chancla.scene);
  prepMesh(fountain.scene);
  prepMesh(door.scene);
  prepMesh(arms.scene);
  prepMesh(shotGltf.scene);
  const mesh = firstMesh(chancla.scene);
  const shotMesh = firstMesh(shotGltf.scene);
  scaleLongest(mesh, 0.28);
  scaleLongest(shotMesh, 0.22);
  fitHeight(fountain.scene, 1.15);
  capWidth(fountain.scene, 2.1);
  fitHeight(door.scene, 2.15);
  fitHeight(arms.scene, 0.55);
  return {
    chancla: mesh,
    chanclaShot: shotMesh ? shotMesh.geometry : null,
    chanclaMat: mesh ? (mesh.material as THREE.Material) : null,
    fountain: fountain.scene,
    door: door.scene,
    arms: arms.scene,
  };
}

/** Legs grafted above a bust sit entirely in the top half. Drop them so the real head is the top. */
function dropStackedTop(lod: THREE.Object3D): void {
  const meshes: THREE.Mesh[] = [];
  lod.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && (mesh.geometry?.getAttribute('position')?.count ?? 0) > 200) meshes.push(mesh);
  });
  if (meshes.length < 2) return;
  const boxes = meshes.map((mesh) => {
    mesh.geometry.computeBoundingBox();
    return mesh.geometry.boundingBox!;
  });
  const minY = Math.min(...boxes.map((b) => b.min.y));
  const maxY = Math.max(...boxes.map((b) => b.max.y));
  const mid = (minY + maxY) / 2;
  meshes.forEach((mesh, i) => {
    if (boxes[i]!.min.y > mid) mesh.parent?.remove(mesh);
  });
}

/** Remove the generated head so only the body and clothing silhouette remain. */
function dropOldHead(geo: THREE.BufferGeometry, cx: number, cy: number, cz: number, r: number): THREE.BufferGeometry {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  const uv = src.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const kept: number[] = [];
  const sphere = r * 1.28;
  const sphere2 = sphere * sphere;
  const column = r * 1.55;
  const column2 = column * column;
  const yLo = cy - r * 0.5;
  const yHi = cy + r * 1.35;
  for (let i = 0; i < pos.count; i += 3) {
    let x = 0; let y = 0; let z = 0;
    for (let k = 0; k < 3; k++) { x += pos.getX(i + k); y += pos.getY(i + k); z += pos.getZ(i + k); }
    x /= 3; y /= 3; z /= 3;
    const dx = x - cx; const dy = y - cy; const dz = z - cz;
    const inSkull = dx * dx + dy * dy + dz * dz < sphere2;
    const inHair = y > yLo && y < yHi && dx * dx + dz * dz < column2;
    const inFace = y > cy - r * 1.2 && y < cy + r && Math.abs(dx) < r * 1.05 && dz > -r * 0.35;
    const inBrim = y > cy - r * 0.85 && y < cy + r * 0.55 && Math.abs(dx) < r * 2.4 && dz > -r * 0.05;
    const inChin = y > cy - r * 1.65 && y < cy - r * 0.35 && dx * dx + dz * dz < (r * 1.35) * (r * 1.35);
    if (inSkull || inHair || inFace || inBrim || inChin) continue;
    kept.push(i, i + 1, i + 2);
  }
  if (kept.length < 90 || kept.length > pos.count * 0.98) return geo;
  const n = kept.length;
  const nextPos = new Float32Array(n * 3);
  const nextUv = uv ? new Float32Array(n * 2) : null;
  for (let i = 0; i < n; i++) {
    const s = kept[i]!;
    nextPos[i * 3] = pos.getX(s);
    nextPos[i * 3 + 1] = pos.getY(s);
    nextPos[i * 3 + 2] = pos.getZ(s);
    if (uv && nextUv) { nextUv[i * 2] = uv.getX(s); nextUv[i * 2 + 1] = uv.getY(s); }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(nextPos, 3));
  if (nextUv) out.setAttribute('uv', new THREE.BufferAttribute(nextUv, 2));
  out.computeVertexNormals();
  return out;
}

function percentile(values: number[], t: number): number {
  if (!values.length) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor(t * (s.length - 1))));
  return s[i]!;
}

/**
 * Replace the generated face with a clean stylized one.
 * Large glossy eyes, a lid over the top of each iris, soft cheeks, and a smile whose corners turn up.
 * Local +Z is the face the gameplay camera looks at.
 */
function sculptFriendlyHead(lod: THREE.Object3D, name: string): void {
  const meshes: THREE.Mesh[] = [];
  lod.updateMatrixWorld(true);
  lod.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData['friendly']) return;
    const count = mesh.geometry?.getAttribute('position')?.count ?? 0;
    if (count > 80) meshes.push(mesh);
  });
  if (!meshes.length) return;
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  for (const mesh of meshes) {
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox!;
    minX = Math.min(minX, bb.min.x); maxX = Math.max(maxX, bb.max.x);
    minY = Math.min(minY, bb.min.y); maxY = Math.max(maxY, bb.max.y);
    minZ = Math.min(minZ, bb.min.z); maxZ = Math.max(maxZ, bb.max.z);
  }
  const height = Math.max(0.001, maxY - minY);
  const width = Math.max(0.001, maxX - minX);
  const torsoX: number[] = [];
  const torsoZ: number[] = [];
  const crown: Array<[number, number, number]> = [];
  const yTorso0 = minY + height * 0.4;
  const yTorso1 = minY + height * 0.68;
  const yCrown0 = minY + height * 0.74;
  const yCrown1 = minY + height * 0.94;
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i += 2) {
      const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
      if (y >= yTorso0 && y <= yTorso1) { torsoX.push(x); torsoZ.push(z); }
      else if (y >= yCrown0 && y <= yCrown1) crown.push([x, y, z]);
    }
  }
  const cx = percentile(torsoX, 0.5) || (minX + maxX) / 2;
  const mid = crown.filter((p) => Math.abs(p[0] - cx) < width * 0.2);
  const pool = mid.length > 30 ? mid : crown;
  const faceZ = percentile(pool.map((p) => p[2]), 0.94);
  const r = height * 0.118;
  const hx = cx;
  const hy = minY + height * 0.8;
  const hz = (Number.isFinite(faceZ) ? faceZ : maxZ) - r * 0.42;
  for (const mesh of meshes) mesh.geometry = dropOldHead(mesh.geometry, hx, hy, hz, r);

  const grey = name.startsWith('abuela');
  const skin = new THREE.MeshPhysicalMaterial({
    color: grey ? 0xe7a484 : 0xf2b394,
    roughness: 0.55,
    metalness: 0,
    sheen: 0.22,
    sheenRoughness: 0.45,
    sheenColor: new THREE.Color(0xffd0b4),
    emissive: 0x7a4530,
    emissiveIntensity: 0.04,
  });
  const cheekMat = new THREE.MeshPhysicalMaterial({
    color: 0xf09a86, roughness: 0.58, metalness: 0, emissive: 0x9a4038, emissiveIntensity: 0.05,
  });
  const hair = new THREE.MeshPhysicalMaterial({ color: grey ? 0xc8c4be : 0x3a2418, roughness: 0.72, metalness: 0 });
  const whiteMat = new THREE.MeshPhysicalMaterial({ color: 0xfffbf8, roughness: 0.22, metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.08 });
  const irisMat = new THREE.MeshPhysicalMaterial({ color: 0x4a2810, roughness: 0.22, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06 });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x120a06 });
  const catchMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const browMat = new THREE.MeshPhysicalMaterial({ color: grey ? 0x7a7364 : 0x4a3020, roughness: 0.62, metalness: 0 });
  const smileMat = new THREE.MeshPhysicalMaterial({ color: 0xc45c66, roughness: 0.42, metalness: 0, emissive: 0x6a2430, emissiveIntensity: 0.06 });
  const group = new THREE.Group();
  group.name = 'friendly-head';
  group.position.set(hx, hy, hz);
  group.userData['friendly'] = true;

  const skull = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), skin);
  skull.scale.set(1.06, 1.12, 0.96);
  skull.userData['friendly'] = true;
  const neck = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.36, r * 0.28, 3, 10), skin);
  neck.position.y = -r * 0.92;
  neck.userData['friendly'] = true;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 0.96, 22, 16), hair);
  cap.position.set(0, r * 0.26, -r * 0.04);
  cap.scale.set(1.04, 0.58, 0.92);
  cap.userData['friendly'] = true;
  group.add(skull, neck, cap);

  const eyeR = r * 0.22;
  const ex = r * 0.32;
  const ey = r * 0.06;
  const ez = r * 0.8;
  for (const side of [-1, 1] as const) {
    const white = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 16, 12), whiteMat);
    white.scale.set(1.02, 1.05, 0.7);
    white.position.set(side * ex, ey, ez);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.5, 14, 10), irisMat);
    iris.position.set(side * ex, ey - eyeR * 0.02, ez + eyeR * 0.38);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.28, 10, 8), pupilMat);
    pupil.position.set(side * ex, ey - eyeR * 0.02, ez + eyeR * 0.62);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.09, 8, 6), catchMat);
    glint.position.set(side * ex + side * eyeR * 0.1, ey + eyeR * 0.08, ez + eyeR * 0.78);
    const lid = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.88, 12, 8), skin);
    lid.scale.set(1.12, 0.26, 0.42);
    lid.position.set(side * ex, ey + eyeR * 0.58, ez + eyeR * 0.46);
    const brow = new THREE.Mesh(new THREE.TorusGeometry(r * 0.13, r * 0.016, 6, 12, Math.PI * 0.7), browMat);
    brow.rotation.z = Math.PI * 0.15 + side * -0.1;
    brow.position.set(side * ex, ey + eyeR * 1.42, ez + eyeR * 0.22);
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(r * 0.15, 12, 8), cheekMat);
    cheek.scale.set(1.15, 0.7, 0.5);
    cheek.position.set(side * r * 0.42, -r * 0.1, r * 0.5);
    const ear = new THREE.Mesh(new THREE.SphereGeometry(r * 0.14, 10, 8), skin);
    ear.scale.set(0.38, 0.72, 0.42);
    ear.position.set(side * r * 1.02, 0, -r * 0.05);
    for (const part of [white, iris, pupil, glint, lid, brow, cheek, ear]) part.userData['friendly'] = true;
    group.add(white, iris, pupil, glint, lid, brow, cheek, ear);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(r * 0.075, 10, 8), skin);
  nose.scale.set(1, 0.8, 0.85);
  nose.position.set(0, -r * 0.05, r * 0.94);
  const smile = new THREE.Mesh(new THREE.TorusGeometry(r * 0.2, r * 0.034, 8, 18, Math.PI), smileMat);
  smile.rotation.z = Math.PI;
  smile.position.set(0, -r * 0.3, r * 0.9);
  nose.userData['friendly'] = true;
  smile.userData['friendly'] = true;
  group.add(nose, smile);
  if (name === 'rosa') {
    const straw = new THREE.MeshPhysicalMaterial({ color: 0xe6c56a, roughness: 0.62, metalness: 0 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.45, r * 1.55, r * 0.07, 22), straw);
    brim.position.set(0, r * 0.7, -r * 0.02);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.7, r * 0.42, 16), straw);
    crown.position.set(0, r * 0.94, -r * 0.02);
    brim.userData['friendly'] = true;
    crown.userData['friendly'] = true;
    group.add(brim, crown);
  }
  if (grey) {
    const frameMat = new THREE.MeshPhysicalMaterial({ color: 0x6a3e2c, roughness: 0.35, metalness: 0.35 });
    for (const side of [-1, 1] as const) {
      const glass = new THREE.Mesh(new THREE.TorusGeometry(eyeR * 1.38, r * 0.011, 6, 18), frameMat);
      glass.position.set(side * ex, ey, ez + eyeR * 0.72);
      glass.userData['friendly'] = true;
      group.add(glass);
    }
    const bridge = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.012, ex * 0.55, 2, 5), frameMat);
    bridge.rotation.z = Math.PI / 2;
    bridge.position.set(0, ey + eyeR * 0.15, ez + eyeR * 0.15);
    bridge.userData['friendly'] = true;
    group.add(bridge);
    const bun = new THREE.Mesh(new THREE.SphereGeometry(r * 0.42, 14, 10), hair);
    bun.position.set(0, r * 0.78, -r * 0.18);
    bun.userData['friendly'] = true;
    group.add(bun);
    [0xf07898, 0x3ec4b8, 0xf0a030, 0x8d6ad4].forEach((hex, i) => {
      const roller = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.07, r * 0.07, r * 0.22, 8), new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.45, metalness: 0 }));
      roller.rotation.z = Math.PI / 2;
      roller.rotation.y = (i - 1.5) * 0.35;
      roller.position.set((i - 1.5) * r * 0.22, r * 0.95, -r * 0.05 + (i % 2 ? r * 0.06 : 0));
      roller.userData['friendly'] = true;
      group.add(roller);
    });
  }
  const anchor = meshes[0]!;
  group.position.applyMatrix4(anchor.matrix);
  anchor.parent?.add(group);
}

function firstMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((o) => { if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh; });
  return found;
}

function capWidth(root: THREE.Object3D, maxWidth: number): void {
  root.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const w = Math.max(size.x, size.z);
  if (w > maxWidth) {
    const k = maxWidth / w;
    root.scale.multiplyScalar(k);
    root.position.y *= k;
  }
}

function scaleLongest(mesh: THREE.Mesh | null, meters: number): void {
  if (!mesh) return;
  mesh.geometry.computeBoundingBox();
  const size = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z, 0.001);
  mesh.geometry.scale(meters / longest, meters / longest, meters / longest);
  mesh.geometry.computeBoundingBox();
  const c = mesh.geometry.boundingBox!.getCenter(new THREE.Vector3());
  mesh.geometry.translate(-c.x, -mesh.geometry.boundingBox!.min.y, -c.z);
  mesh.geometry.computeVertexNormals();
}

export function playFilm(p: FilmPuppet, name: string): void {
  if (p.current === name) return;
  const next = p.actions.get(name) ?? p.actions.get('Idle');
  if (!next) return;
  p.actions.get(p.current)?.fadeOut(0.15);
  next.reset().fadeIn(0.15).play();
  p.current = name;
}

const floralMat = cloth(0xf29a2e);

function floralSleeve(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4e6c8';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#e07048';
  g.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.arc(20 + (i % 3) * 40, 30 + Math.floor(i / 3) * 50, 12, 0, Math.PI * 2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Forearm in a floral sleeve, bracelets, and a second hand that reaches in on the wind-up. */
export function styleViewmodels(groups: THREE.Object3D[]): void {
  floralMat.map = floralSleeve();
  for (const g of groups) {
    const hand = g.children[0] as THREE.Mesh | undefined;
    if (!hand?.isMesh) continue;
    hand.geometry = new THREE.CapsuleGeometry(0.045, 0.28, 4, 8);
    hand.material = floralMat;
    hand.position.set(0.05, -0.02, 0.02);
    hand.rotation.set(0.4, 0.2, -0.6);
    hand.scale.setScalar(1);
    const skin = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), skinMat);
    skin.position.set(0.02, -0.2, 0.02);
    hand.add(skin);
    const b1 = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.008, 6, 12), goldMat);
    b1.rotation.x = Math.PI / 2;
    b1.position.y = 0.02;
    const b2 = b1.clone();
    b2.material = cloth(0x36b9c9);
    b2.position.y = 0.05;
    hand.add(b1, b2);
    let reach = g.getObjectByName('reach');
    if (!reach) {
      reach = new THREE.Group();
      reach.name = 'reach';
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.22, 3, 8), floralMat);
      arm.rotation.z = 0.9;
      const palm = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), skinMat);
      palm.position.set(0.12, 0.08, 0);
      reach.add(arm, palm);
      reach.position.set(-0.28, 0.05, 0.05);
      g.add(reach);
    }
    reach.visible = false;
  }
}
