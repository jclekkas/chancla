// The Rosa candidate (docs/rosa-asset/CONTRACT.md): a Blender-built Sol,
// one connected mesh per quality tier, skinned at runtime to the same joints
// the current model is built on. The animation (rosa-anim.ts) keeps rotating
// the joint Groups at the RIG positions; a THREE.Bone at identity under each
// joint carries the skin, so nothing in the animation, hit detection or
// gameplay changes. Loading is asynchronous and cached per tier; building an
// Avatar stays synchronous and falls back to the current model while a tier
// is not loaded (rosa.ts decides).
//
// What the GLB gives: one skinned primitive (POSITION, NORMAL, COLOR_0,
// JOINTS_0/WEIGHTS_0, `_INK`), the face rig in the scene extras, and the
// four rulero placements as empties. What the game adds, as for the current
// model: the per-avatar toon material (flash, face, ink hull, arena skin),
// the held weapons, the instanced ruleros, the bubble and the stars.
import * as THREE from 'three';
import type { Team } from '../../../shared/map';
import type { Quality } from '../settings';
import { RIG, type RosaRig } from './rosa-rig';
import { ROSA_COLORS, ROSA_SHARED, rosaMaterial, type FaceRig } from './rosa-materials';
import { ROSA_JOINTS, ROSA_SKIRT_PIVOT, attachRosaProps, buildRosaJoints, matchRuleros, type RosaJoint, type RosaModel } from './rosa-model';

/** The extra bones (secondary motion) the contract allows. */
export const CANDIDATE_EXTRAS = ['skirt', 'hatBrim', 'bun'] as const;
type Extra = (typeof CANDIDATE_EXTRAS)[number];
/** Every bone of the candidate's skeleton, in skin-index order. */
export const CANDIDATE_BONES: ReadonlyArray<RosaJoint | Extra> = [...ROSA_JOINTS, ...CANDIDATE_EXTRAS];

/** The head joint's rest height above the root (the neck base). */
const HEAD_Y = RIG.hipY + RIG.headY;
/** Bounds for culling, in root space: generous enough for every pose (a jump, a crouch, lying down). */
const BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.6);

/** A parsed tier: shared by every candidate avatar of that tier. */
export interface CandidateAsset {
  quality: Quality;
  /** Root space at rest; skinIndex refers to CANDIDATE_BONES. Shared (never disposed by an avatar). */
  geometry: THREE.BufferGeometry;
  /** Root space (head-local + HEAD_Y), as the GLB stores it. */
  faceRig: FaceRig;
  /** Head-local roller placements (instance matrices). */
  rulPlace: THREE.Matrix4[];
  /** Root-space rest positions of the optional extra bones the GLB has. */
  extras: Partial<Record<Extra, THREE.Vector3>>;
  /** Triangles of the body (surface and hull). */
  tris: number;
  /** Download size (bytes) and fetch plus parse time (ms). */
  bytes: number;
  loadMs: number;
  /** Contract mismatches found while parsing (joint off its RIG position, missing data). */
  warnings: string[];
}

const assets = new Map<Quality, CandidateAsset>();
const pending = new Map<Quality, Promise<void>>();

/** The GLB of a tier. */
export function candidateUrl(q: Quality): string {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return `${base}models/rosa-sol-${q}.glb`;
}

/** True once the tier is loaded and parsed. */
export function candidateReady(q: Quality): boolean { return assets.has(q); }

/** The parsed tier (or undefined), for the cost notes and tests. */
export function candidateAsset(q: Quality): CandidateAsset | undefined { return assets.get(q); }

/**
 * Fetches and parses a tier once (cached; a second call shares the first).
 * Rejects when the file is missing or breaks the contract; a later call tries again.
 */
export function loadRosaCandidate(q: Quality): Promise<void> {
  if (assets.has(q)) return Promise.resolve();
  const busy = pending.get(q);
  if (busy) return busy;
  const t0 = performance.now();
  const p = (async () => {
    const res = await fetch(candidateUrl(q));
    if (!res.ok) throw new Error(`rosa candidate ${q}: HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const a = await parseRosaCandidate(buf, q);
    a.loadMs = Math.round(performance.now() - t0);
    assets.set(q, a);
  })().finally(() => pending.delete(q));
  pending.set(q, p);
  return p;
}

/** Installs an already parsed tier (tests, tools). */
export function setCandidateAsset(a: CandidateAsset): void { assets.set(a.quality, a); }

/** Forgets every parsed tier (tests). Avatars already built keep their geometry. */
export function clearRosaCandidates(): void {
  for (const a of assets.values()) a.geometry.dispose();
  assets.clear();
}

// The palette the runtime snaps COLOR_0 to (linear, as three keeps vertex colours).
let palette: THREE.Color[] | null = null;
function paletteColors(): THREE.Color[] {
  if (!palette) {
    const hex = new Set<number>([...Object.values(ROSA_COLORS[0]), ...Object.values(ROSA_SHARED)].filter((h) => h !== 0));
    palette = [...hex].map((h) => new THREE.Color(h));
  }
  return palette;
}

function nearest(r: number, g: number, b: number): THREE.Color {
  let best = paletteColors()[0]!, d = Infinity;
  for (const c of paletteColors()) {
    const e = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
    if (e < d) { d = e; best = c; }
  }
  return best;
}

function readFaceRig(v: unknown): FaceRig | null {
  const o = typeof v === 'string' ? (() => { try { return JSON.parse(v) as unknown; } catch { return null; } })() : v;
  if (!o || typeof o !== 'object') return null;
  const { lidY, browIn, browOut } = o as Record<string, unknown>;
  return typeof lidY === 'number' && typeof browIn === 'number' && typeof browOut === 'number' ? { lidY, browIn, browOut } : null;
}

/** Where each joint sits at rest in root space (RIG). */
export function rigRestPositions(): Record<RosaJoint, THREE.Vector3> {
  const { root, joints } = buildRosaJoints();
  root.updateMatrixWorld(true);
  const out = {} as Record<RosaJoint, THREE.Vector3>;
  for (const j of ROSA_JOINTS) out[j] = joints[j].getWorldPosition(new THREE.Vector3());
  return out;
}

/**
 * Parses a tier's GLB into the shared geometry: positions and normals in
 * root space at rest, COLOR_0 snapped to the palette (RGB), `_INK` renamed
 * `ink`, skin indices remapped to CANDIDATE_BONES (a bone the contract does
 * not list hands its weight to its nearest listed ancestor).
 */
export async function parseRosaCandidate(buf: ArrayBuffer, q: Quality): Promise<CandidateAsset> {
  // The loader is fetched only when the candidate is switched on (it stays out of the main bundle).
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().parseAsync(buf, '');
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  let mesh: THREE.SkinnedMesh | null = null;
  scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && (!mesh || o.name === 'rosa')) mesh = o as THREE.SkinnedMesh; });
  if (!mesh) throw new Error(`rosa candidate ${q}: no skinned mesh`);
  const sm = mesh as THREE.SkinnedMesh;
  const src = sm.geometry;
  const warnings: string[] = [];
  const pos = src.attributes.position, nor = src.attributes.normal, col = src.attributes.color;
  const inkSrc = src.attributes._ink ?? src.attributes.ink ?? src.attributes._INK;
  const si = src.attributes.skinIndex, sw = src.attributes.skinWeight;
  if (!pos || !si || !sw) throw new Error(`rosa candidate ${q}: missing POSITION or skin attributes`);
  const n = pos.count;

  // Bind space to root space: the skinned mesh's bind matrix (its world matrix in the file).
  const toRoot = sm.bindMatrix.clone();
  const nm = new THREE.Matrix3().getNormalMatrix(toRoot);
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3), I = new Float32Array(n);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(toRoot); v.toArray(P, i * 3);
    if (nor) { v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); v.toArray(N, i * 3); }
    const c = col ? nearest(col.getX(i), col.getY(i), col.getZ(i)) : paletteColors()[0]!;
    C[i * 3] = c.r; C[i * 3 + 1] = c.g; C[i * 3 + 2] = c.b;
    I[i] = inkSrc ? inkSrc.getX(i) : 0;
  }
  if (!col) warnings.push('no COLOR_0');
  if (!inkSrc) warnings.push('no _INK');

  // Skin indices: the file's bone order to ours, by name.
  const bones = sm.skeleton.bones;
  const ours = new Map(CANDIDATE_BONES.map((b, i) => [b as string, i]));
  const remap = bones.map((b) => {
    for (let o: THREE.Object3D | null = b; o; o = o.parent) { const k = ours.get(o.name); if (k !== undefined) return k; }
    return 0; // nothing listed above it: the hips
  });
  const SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    let t = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      SI[i * 4 + k] = remap[si.getComponent(i, k)] ?? 0;
      SW[i * 4 + k] = w; t += w;
    }
    if (t > 0 && Math.abs(t - 1) > 1e-4) for (let k = 0; k < 4; k++) SW[i * 4 + k]! /= t;
    if (t <= 0) { SI[i * 4] = 0; SW[i * 4] = 1; }
  }

  // The bones' bind positions (the inverse of each inverse bind matrix: root space) against the RIG,
  // and the extras' rest positions.
  const rest = rigRestPositions();
  const extras: CandidateAsset['extras'] = {};
  const inv = new THREE.Matrix4();
  bones.forEach((b, i) => {
    const bind = new THREE.Vector3().setFromMatrixPosition(inv.copy(sm.skeleton.boneInverses[i]!).invert());
    if ((ROSA_JOINTS as readonly string[]).includes(b.name)) {
      const want = rest[b.name as RosaJoint];
      if (bind.distanceTo(want) > 0.01) warnings.push(`${b.name} at ${bind.toArray().map((x) => x.toFixed(3)).join(',')} (RIG ${want.toArray().map((x) => x.toFixed(3)).join(',')})`);
    } else if ((CANDIDATE_EXTRAS as readonly string[]).includes(b.name)) {
      extras[b.name as Extra] = bind;
    }
  });
  for (const j of ROSA_JOINTS) if (!bones.some((b) => b.name === j)) warnings.push(`no bone ${j}`);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(P, 3));
  if (src.index) geometry.setIndex(Array.from(src.index.array as ArrayLike<number>));
  if (nor) geometry.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  else { geometry.computeVertexNormals(); warnings.push('no NORMAL'); }
  geometry.setAttribute('color', new THREE.BufferAttribute(C, 3));
  geometry.setAttribute('ink', new THREE.BufferAttribute(I, 1));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
  geometry.boundingSphere = BOUNDS.clone();
  geometry.userData.shared = true;
  const tris = (src.index ? src.index.count : n) / 3;
  // Winding check on the surface (ink 0): its faces must turn the way its normals do
  // (otherwise the toon pass culls the body and only the hull shows).
  if (nor) {
    const ix = geometry.index, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3();
    let surf = 0, wrong = 0;
    for (let t = 0; t < tris; t++) {
      const i0 = ix ? ix.getX(t * 3) : t * 3, i1 = ix ? ix.getX(t * 3 + 1) : t * 3 + 1, i2 = ix ? ix.getX(t * 3 + 2) : t * 3 + 2;
      if (I[i0] !== 0) continue;
      a.fromArray(P, i0 * 3); b.fromArray(P, i1 * 3).sub(a); c.fromArray(P, i2 * 3).sub(a);
      nn.fromArray(N, i0 * 3).add(a.fromArray(N, i1 * 3)).add(a.fromArray(N, i2 * 3));
      surf++;
      if (b.cross(c).dot(nn) < 0) wrong++;
    }
    if (surf && wrong / surf > 0.2) warnings.push(`surface winding: ${wrong} of ${surf} triangles face against their normals`);
  }

  const faceRig = readFaceRig(scene.userData.faceRig) ?? readFaceRig((gltf.parser.json as { scenes?: Array<{ extras?: Record<string, unknown> }> }).scenes?.[0]?.extras?.faceRig);
  if (!faceRig) warnings.push('no faceRig in the scene extras');

  // Rulero empties (root space) to head-local.
  const rulPlace: THREE.Matrix4[] = [];
  const toHead = new THREE.Matrix4().makeTranslation(0, -HEAD_Y, 0);
  for (let i = 0; i < 4; i++) {
    const e = scene.getObjectByName(`rulero_${i}`);
    if (!e) { warnings.push(`no rulero_${i}`); continue; }
    rulPlace.push(toHead.clone().multiply(e.matrixWorld));
  }

  // Free what the loader made (never uploaded, but keep the heap clean).
  scene.traverse((o) => { const g = (o as THREE.Mesh).geometry; if (g) g.dispose(); });
  return { quality: q, geometry, faceRig: faceRig ?? { lidY: HEAD_Y + 0.14, browIn: 0.02, browOut: 0.1 }, rulPlace, extras, tris, bytes: buf.byteLength, loadMs: 0, warnings };
}

/**
 * Builds a candidate Sol from a loaded tier (candidateReady(q) must be true):
 * the same joint Groups at the RIG positions, a Bone at identity under each,
 * one SkinnedMesh bound at the rest pose, and the game's own pieces (weapons
 * on wristR, instanced ruleros on the head, bubble and stars) as in
 * rosa-model.ts. Only the material, the bones and the props are per avatar.
 */
export function buildRosaCandidate(team: Team, q: Quality): RosaModel {
  const a = assets.get(q);
  if (!a) throw new Error(`rosa candidate ${q} is not loaded`);
  const { root, joints } = buildRosaJoints();
  const { hips, torso, head, armL, armR, foreL, foreR, wristL, wristR, legL, legR, shinL, shinR, footL, footR } = joints;
  const bones: THREE.Bone[] = [];
  for (const j of ROSA_JOINTS) {
    joints[j].name = j;
    const b = new THREE.Bone();
    b.name = j;
    joints[j].add(b);
    bones.push(b);
  }
  // Extra bones: a Group the animation drives (its rest rotation zero), the bone at identity in it.
  const extras: RosaRig['extras'] = {};
  for (const x of CANDIDATE_EXTRAS) {
    const g = new THREE.Group();
    g.name = x;
    const b = new THREE.Bone();
    b.name = x;
    g.add(b);
    bones.push(b);
    if (x === 'skirt') { g.position.y = ROSA_SKIRT_PIVOT; hips.add(g); extras.skirt = g; continue; }
    head.add(g);
    const p = a.extras[x];
    if (p) { g.position.set(p.x, p.y - HEAD_Y, p.z); extras[x] = g; }
  }
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones); // inverses from the rest pose

  const faceState = new THREE.Vector4();
  const mat = rosaMaterial(a.faceRig, faceState, { arena: true });
  const mesh = new THREE.SkinnedMesh(a.geometry, mat);
  mesh.name = 'rosa';
  root.add(mesh);
  mesh.bind(skeleton, new THREE.Matrix4());
  mesh.boundingSphere = BOUNDS.clone();
  mesh.castShadow = q !== 'low';
  mesh.receiveShadow = q !== 'low';

  const rulPlace: THREE.Matrix4[] = [];
  const { rulMesh, rulOutline } = matchRuleros(a.rulPlace.map((m) => m.clone()), q === 'low', rulPlace);
  head.add(rulMesh);
  if (rulOutline) head.add(rulOutline);
  const { weapons, bubble, stars } = attachRosaProps(team, q, root, head, wristR);

  return { root, hips, torso, head, armL, armR, foreL, foreR, wristL, wristR, legL, legR, shinL, shinR, footL, footR, weapons, stars, bubble, flashMats: [mat], face: faceState, extras, rulMesh, rulOutline, rulPlace, rulOutlineScale: 1.14, curlers: [] };
}
