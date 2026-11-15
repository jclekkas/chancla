// CC0 look: Poly Haven PBR maps and HDRI, Quaternius characters.
// Loaded after the courtyard exists so a missing file falls back to the procedural scene.
import * as THREE from 'three';
import type { AnimationAction, AnimationClip, Object3D, SkinnedMesh } from 'three';

export interface Puppet {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<string, AnimationAction>;
  current: string;
}

const REPEAT = 4;

function prep(tex: THREE.Texture, color: boolean): THREE.Texture {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(REPEAT, REPEAT);
  tex.anisotropy = 8;
  tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
  return tex;
}

async function map(url: string, color: boolean, renderer: THREE.WebGLRenderer): Promise<THREE.Texture> {
  if (url.endsWith('.ktx2')) {
    try {
      const { KTX2Loader } = await import('three/examples/jsm/loaders/KTX2Loader.js');
      const loader = new KTX2Loader();
      loader.setTranscoderPath('/basis/');
      loader.detectSupport(renderer);
      const tex = await loader.loadAsync(url);
      loader.dispose();
      return prep(tex, color);
    } catch { /* jpg below */ }
  }
  const tex = await new THREE.TextureLoader().loadAsync(url.replace('.ktx2', '.jpg'));
  return prep(tex, color);
}

function standard(diff: THREE.Texture, nor: THREE.Texture, rough: THREE.Texture, tint = 0xffffff): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: diff, normalMap: nor, roughnessMap: rough, color: tint,
    roughness: 1, metalness: 0.02,
  });
}

export async function applyCc0Look(renderer: THREE.WebGLRenderer, scene: THREE.Scene, root: THREE.Object3D, shadows: boolean): Promise<void> {
  const base = '/chancla-duty/cc0';
  const [plasterD, plasterN, plasterR, tileD, tileN, tileR, woodD, woodN, woodR] = await Promise.all([
    map(`${base}/tex/plaster/diff.ktx2`, true, renderer),
    map(`${base}/tex/plaster/nor.ktx2`, false, renderer),
    map(`${base}/tex/plaster/rough.ktx2`, false, renderer),
    map(`${base}/tex/tiles/diff.ktx2`, true, renderer),
    map(`${base}/tex/tiles/nor.ktx2`, false, renderer),
    map(`${base}/tex/tiles/rough.ktx2`, false, renderer),
    map(`${base}/tex/wood/diff.ktx2`, true, renderer),
    map(`${base}/tex/wood/nor.ktx2`, false, renderer),
    map(`${base}/tex/wood/rough.ktx2`, false, renderer),
  ]);
  const plaster = standard(plasterD, plasterN, plasterR);
  plaster.vertexColors = true;
  const tiles = standard(tileD, tileN, tileR);
  tiles.map!.repeat.set(10, 8);
  tiles.normalMap!.repeat.set(10, 8);
  tiles.roughnessMap!.repeat.set(10, 8);
  const wood = standard(woodD, woodN, woodR);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.name === 'duty-walls') { mesh.material = plaster; mesh.castShadow = shadows; mesh.receiveShadow = true; }
    if (mesh.name === 'duty-skin') {
      mesh.material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    }
    if (mesh.name === 'duty-floor') { mesh.material = tiles; mesh.receiveShadow = true; }
    if (mesh.name === 'duty-wood') { mesh.material = wood; mesh.castShadow = shadows; mesh.receiveShadow = true; }
  });
  try {
    const { RGBELoader } = await import('three/examples/jsm/loaders/RGBELoader.js');
    const hdr = await new RGBELoader().loadAsync(`${base}/hdri/kloofendal_48d_partly_cloudy_1k.hdr`);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(hdr).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.5;
    scene.background = hdr;
    scene.backgroundBlurriness = 0;
    renderer.toneMappingExposure = 1.02;
    pmrem.dispose();
    root.traverse((o) => { if (o.name === 'duty-sky') o.visible = false; });
  } catch { /* keep the gradient sky */ }
  const fog = scene.fog as THREE.Fog | null;
  if (fog) { fog.color.set(0xe4c4a0); fog.near = 18; fog.far = 72; }
}

let armGeo: THREE.BufferGeometry | null = null;
export function forearmGeometry(): THREE.BufferGeometry | null { return armGeo; }

const ARM = new Set(['Shoulder.R', 'UpperArm.R', 'LowerArm.R', 'Fist.R']);

function sculptArm(root: THREE.Object3D): THREE.BufferGeometry | null {
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
  if (!meshes.length) return null;
  root.getObjectByName('UpperArm.R')?.rotateX(-1.2);
  root.getObjectByName('LowerArm.R')?.rotateX(-0.45);
  root.updateMatrixWorld(true);
  for (const mesh of meshes) mesh.skeleton.update();
  const fist = new THREE.Vector3();
  root.getObjectByName('Fist.R')?.getWorldPosition(fist);
  const arr: number[] = [];
  const indices: number[] = [];
  const v = new THREE.Vector3();
  const comp = (attr: THREE.BufferAttribute, i: number, k: number) => k === 0 ? attr.getX(i) : k === 1 ? attr.getY(i) : k === 2 ? attr.getZ(i) : attr.getW(i);
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute | undefined;
    const skinI = mesh.geometry.attributes.skinIndex as THREE.BufferAttribute | undefined;
    const skinW = mesh.geometry.attributes.skinWeight as THREE.BufferAttribute | undefined;
    if (!pos || !skinI || !skinW) continue;
    const bones = mesh.skeleton.bones;
    const arm = new Uint8Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      let best = 0, bw = -1;
      for (let k = 0; k < 4; k++) {
        const w = comp(skinW, i, k);
        if (w > bw) { bw = w; best = Math.round(comp(skinI, i, k)); }
      }
      if (ARM.has(bones[best]?.name ?? '')) arm[i] = 1;
    }
    const map = new Int32Array(pos.count).fill(-1);
    const add = (i: number) => {
      if (map[i]! >= 0) return map[i]!;
      v.fromBufferAttribute(pos, i);
      mesh.applyBoneTransform(i, v);
      v.applyMatrix4(mesh.matrixWorld).sub(fist);
      const id = arr.length / 3;
      arr.push(v.x, v.y, v.z);
      map[i] = id;
      return id;
    };
    const src = mesh.geometry.index;
    const tri = (a: number, b: number, c: number) => {
      if ((arm[a]! + arm[b]! + arm[c]!) >= 2) indices.push(add(a), add(b), add(c));
    };
    if (src) for (let t = 0; t < src.count; t += 3) tri(src.getX(t), src.getX(t + 1), src.getX(t + 2));
    else for (let t = 0; t < pos.count; t += 3) tri(t, t + 1, t + 2);
  }
  if (indices.length < 12) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export async function loadPuppets(parent: THREE.Object3D): Promise<Puppet[]> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
  const { clone } = await import('three/examples/jsm/utils/SkeletonUtils.js');
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const files = ['rosa.glb', 'luna.glb', 'kid.glb', 'npc.glb'];
  const gltfs = await Promise.all(files.map((f) => loader.loadAsync(`/chancla-duty/cc0/characters/${f}`)));
  try {
    if (gltfs[0]) armGeo = sculptArm(clone(gltfs[0].scene) as Object3D);
  } catch { armGeo = null; }
  const out: Puppet[] = [];
  for (const gltf of gltfs) {
    const root = clone(gltf.scene) as Object3D;
    fit(root);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) { mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = true; }
      if (o.name === 'Fist.R') {
        const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.16), new THREE.MeshStandardMaterial({ color: 0x2bb5b0, roughness: 0.6 }));
        shoe.position.set(0, 0.04, 0.06);
        shoe.castShadow = true;
        o.add(shoe);
      }
    });
    root.visible = false;
    root.userData['keep'] = true;
    parent.add(root);
    const mixer = new THREE.AnimationMixer(root);
    const actions = new Map<string, AnimationAction>();
    for (const clip of gltf.animations as AnimationClip[]) actions.set(clip.name, mixer.clipAction(clip));
    out.push({ root, mixer, actions, current: '' });
  }
  return out;
}

function fit(root: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(root);
  const h = Math.max(0.001, box.max.y - box.min.y);
  const s = 1.75 / h;
  root.scale.setScalar(s);
  root.position.y = -box.min.y * s;
}

export function playClip(p: Puppet, name: string): void {
  if (p.current === name) return;
  const next = p.actions.get(name) ?? p.actions.get('Idle');
  if (!next) return;
  const prev = p.actions.get(p.current);
  next.reset().fadeIn(0.15).play();
  prev?.fadeOut(0.15);
  p.current = next.getClip().name;
}

void (0 as unknown as SkinnedMesh);
