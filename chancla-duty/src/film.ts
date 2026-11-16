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

const roofMat = new THREE.MeshStandardMaterial({ color: 0xc45a32, roughness: 0.78, metalness: 0, map: barrelTiles() });
const stoneTrim = new THREE.MeshStandardMaterial({ color: 0xe7d7c4, roughness: 0.9, metalness: 0 });
const mountainMat = new THREE.MeshStandardMaterial({ color: 0x8d6a78, roughness: 1, metalness: 0 });
const vineMat = new THREE.MeshStandardMaterial({ color: 0xc43b78, roughness: 0.6, metalness: 0, side: THREE.DoubleSide });

function barrelTiles(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#a84828';
  g.fillRect(0, 0, 128, 64);
  for (let x = 0; x < 128; x += 16) {
    const grd = g.createLinearGradient(x, 0, x + 16, 0);
    grd.addColorStop(0, '#7a3018');
    grd.addColorStop(0.5, '#e07a48');
    grd.addColorStop(1, '#7a3018');
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(x + 8, 32, 7, 28, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 2);
  return t;
}

function talavera(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    const x = i * 64;
    g.fillStyle = '#f6f1e6';
    g.fillRect(x, 0, 64, 128);
    g.fillStyle = '#163e8c';
    g.fillRect(x + 5, 10, 54, 108);
    g.fillStyle = '#f6f1e6';
    g.beginPath();
    g.moveTo(x + 32, 22);
    g.lineTo(x + 52, 64);
    g.lineTo(x + 32, 106);
    g.lineTo(x + 12, 64);
    g.fill();
    g.fillStyle = '#163e8c';
    g.beginPath();
    g.arc(x + 32, 64, 7, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
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

  const fountainBox = boxes.find((b) => b.mat === 'fountain' && b.minY < 0.2);
  const fx = fountainBox ? (fountainBox.minX + fountainBox.maxX) / 2 : 0;
  const fz = fountainBox ? (fountainBox.minZ + fountainBox.maxZ) / 2 : 0;
  const glaze = talavera();
  const tileMat = new THREE.MeshStandardMaterial({ map: glaze, roughness: 0.4, metalness: 0.02, color: 0xffffff });
  const cream = new THREE.MeshStandardMaterial({ color: 0xf7f1e6, roughness: 0.55, metalness: 0.02 });
  const base = new THREE.CylinderGeometry(2.7, 2.9, 0.95, 8);
  const stem = new THREE.CylinderGeometry(0.38, 0.5, 1.35, 8);
  stem.translate(0, 1.15, 0);
  const bowl = new THREE.CylinderGeometry(1.25, 0.85, 0.48, 8);
  bowl.translate(0, 1.9, 0);
  const body = new THREE.Mesh(merge([base, stem, bowl]), tileMat);
  const lip = new THREE.TorusGeometry(2.6, 0.14, 6, 8);
  lip.rotateX(Math.PI / 2);
  lip.translate(0, 0.42, 0);
  const upperLip = new THREE.TorusGeometry(1.15, 0.08, 6, 8);
  upperLip.rotateX(Math.PI / 2);
  upperLip.translate(0, 2.12, 0);
  const rims = new THREE.Mesh(merge([lip, upperLip]), cream);
  const stream = new THREE.CylinderGeometry(0.1, 0.16, 1.15, 8);
  stream.translate(0, 1.35, 0);
  const fall = new THREE.Mesh(stream, new THREE.MeshStandardMaterial({ color: 0x7ec8e8, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.9 }));
  const fountain = new THREE.Group();
  fountain.name = 'duty-basin';
  fountain.position.set(fx, 0.15, fz);
  fountain.add(body, rims, fall);
  parent.add(fountain);

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
  mixers: THREE.AnimationMixer[];
  actions: Map<string, THREE.AnimationAction>;
  tracks: Map<string, THREE.AnimationAction>[];
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
const CAST = '/chancla-duty/cc0/cast';

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

/** Rigged MPFB women. LOD0 is the skinned mesh; LOD1 and LOD2 are the same clip at lower cost. */
export async function loadFilmCast(parent: THREE.Object3D): Promise<FilmPuppet[]> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const names = ['rosa', 'luna', 'abuela', 'abuela-patio'] as const;
  const heights: Record<string, number> = { rosa: 1.6, luna: 1.58, abuela: 1.5, 'abuela-patio': 1.48 };
  const out: FilmPuppet[] = [];
  for (const name of names) {
    const gltfs = await Promise.all([0, 1, 2].map((i) => loader.loadAsync(`${CAST}/${name}-lod${i}.glb`)));
    const root = new THREE.Group();
    root.name = `hero-${name}`;
    const lods: THREE.Object3D[] = [];
    const mixers: THREE.AnimationMixer[] = [];
    const tracks: Map<string, THREE.AnimationAction>[] = [];
    gltfs.forEach((gltf, i) => {
      const lod = gltf.scene;
      prepCast(lod);
      if (i === 0) fitHeight(lod, heights[name] ?? 1.58);
      else {
        lod.scale.copy(gltfs[0]!.scene.scale);
        lod.position.copy(gltfs[0]!.scene.position);
      }
      lod.visible = i === 0;
      root.add(lod);
      lods.push(lod);
      const mixer = new THREE.AnimationMixer(lod);
      const actions = new Map<string, THREE.AnimationAction>();
      for (const clip of gltf.animations) {
        const key = clip.name.split('_')[0] ?? clip.name;
        if (!['Idle', 'Walk', 'Run', 'SwordSlash', 'RecieveHit', 'Death'].includes(key)) continue;
        if (!actions.has(key)) actions.set(key, mixer.clipAction(clip));
      }
      if (!actions.has('Idle') && actions.has('Walk')) actions.set('Idle', actions.get('Walk')!);
      mixers.push(mixer);
      tracks.push(actions);
    });
    const proxy = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.7, 2, 6), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    proxy.position.y = 0.85;
    proxy.castShadow = true;
    // Soft fill from above the face, and a warm rim from behind. Local +Z is the face.
    const faceFill = new THREE.PointLight(0xfff6ee, 0.28, 3.2, 2);
    faceFill.position.set(0, 1.55, 1.05);
    const rim = new THREE.PointLight(0xffc98a, 0.16, 2.4, 2);
    rim.position.set(0, 1.75, -0.65);
    root.add(proxy, faceFill, rim);
    root.visible = false;
    root.userData['keep'] = true;
    root.userData['foot'] = 0;
    parent.add(root);
    const actions = tracks[0] ?? new Map<string, THREE.AnimationAction>();
    const mixer = mixers[0] ?? new THREE.AnimationMixer(root);
    out.push({ root, lods, mixer, mixers, actions, tracks, current: '' });
  }
  return out;
}

function prepCast(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const src = mesh.material as THREE.MeshStandardMaterial;
    if (!src || !src.isMaterial) return;
    const painted = !!mesh.geometry.getAttribute('color');
    const mat = new THREE.MeshStandardMaterial({
      color: painted ? new THREE.Color(0xffffff) : (src.color ? src.color.clone() : new THREE.Color(0xffffff)),
      map: src.map ?? null,
      roughness: 0.72,
      metalness: 0,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0,
    });
    mat.transparent = false;
    mat.opacity = 1;
    mat.depthWrite = true;
    mat.depthTest = true;
    mat.alphaTest = 0;
    mat.side = THREE.FrontSide;
    mat.vertexColors = painted;
    mesh.material = mat;
  });
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
  const layers = p.tracks?.length ? p.tracks : [p.actions];
  let played = false;
  for (const actions of layers) {
    const next = actions.get(name) ?? actions.get('Idle');
    if (!next) continue;
    actions.get(p.current)?.fadeOut(0.15);
    next.reset().fadeIn(0.15).play();
    played = true;
  }
  if (played) p.current = name;
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
