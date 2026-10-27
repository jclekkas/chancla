// The Rosa candidate runtime (src/fps/render/rosa-candidate.ts), without
// WebGL: a tiny contract-shaped GLB is written here byte by byte (the real
// tiers come from assets/rosa/build.py), parsed with the game's loader path,
// skinned on the CPU and compared with the rigid transforms it must follow.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Avatar } from '../src/fps/render/rosa';
import { buildRosaModel, ROSA_JOINTS } from '../src/fps/render/rosa-model';
import { ROSA_COLORS, ROSA_SHARED } from '../src/fps/render/rosa-materials';
import {
  CANDIDATE_BONES, buildRosaCandidate, candidateAsset, candidateReady, candidateUrl, clearRosaCandidates,
  loadRosaCandidate, parseRosaCandidate, rigRestPositions, setCandidateAsset,
} from '../src/fps/render/rosa-candidate';
import { FpsSettingsStore, defaults, type Quality } from '../src/fps/settings';
import { SafeStorage, type KV } from '../src/persistence/storage';

const QUALITIES: Quality[] = ['high', 'medium', 'low'];
const REST = rigRestPositions();

// ------------------------------------------------------------ a GLB by hand

interface Vtx { p: [number, number, number]; c: number; ink?: number; j: string[]; w: number[] }
/** Slightly off the palette, as an exporter's 16-bit colours would be. */
const off = (hex: number): [number, number, number] => { const c = new THREE.Color(hex); return [c.r + 0.004, c.g - 0.003, c.b + 0.002]; };

/** Test vertices (root space at rest). */
const VERTS: Vtx[] = [
  { p: [0.27, 1.14, 0], c: ROSA_COLORS[0].dress, j: ['armR'], w: [1] }, // 0 upper arm
  { p: [0.27, 0.98, 0.02], c: ROSA_SHARED.skin, j: ['armR', 'foreR'], w: [0.5, 0.5] }, // 1 elbow, blended
  { p: [0.26, 0.75, -0.01], c: ROSA_SHARED.skin, j: ['foreR'], w: [1] }, // 2 forearm
  { p: [0.26, 0.8, 0.01], c: ROSA_SHARED.skin, j: ['twistR'], w: [1] }, // 3 a bone the contract does not list
  { p: [0.2, 0.6, 0], c: ROSA_SHARED.skirt, j: ['skirt'], w: [1] }, // 4 skirt hem
  { p: [0.05, 1.585, -0.13], c: ROSA_SHARED.eyeWhite, ink: -1, j: ['head'], w: [1] }, // 5 eye (tag)
  { p: [0.05, 1.6, -0.14], c: ROSA_SHARED.ink, ink: 1, j: ['head'], w: [1] }, // 6 hull
  { p: [0, 1.73, 0.3], c: ROSA_COLORS[0].straw, j: ['hatBrim'], w: [1] }, // 7 brim edge
  { p: [-0.1, 0.2, 0], c: ROSA_SHARED.skin, j: ['shinL', 'footL'], w: [0.3, 0.1] }, // 8 unnormalized weights
];
const RULEROS: Array<{ t: [number, number, number]; r: [number, number, number, number]; s: number }> = [
  { t: [-0.06, 1.7, -0.11], r: [0, 0, -Math.SQRT1_2, Math.SQRT1_2], s: 1.1 },
  { t: [0.06, 1.7, -0.11], r: [0, 0, -Math.SQRT1_2, Math.SQRT1_2], s: 1.1 },
  { t: [-0.15, 1.62, -0.02], r: [Math.SQRT1_2, 0, 0, Math.SQRT1_2], s: 1 },
  { t: [0.15, 1.62, -0.02], r: [Math.SQRT1_2, 0, 0, Math.SQRT1_2], s: 1 },
];
const FACE = { lidY: 1.585, browIn: 0.025, browOut: 0.085 };

function makeGlb(flip = false): ArrayBuffer {
  // Bone tree: the joints, the skirt, the brim and one unlisted twist bone under foreR.
  const parentOf: Record<string, string | null> = {
    hips: null, torso: 'hips', head: 'torso', armL: 'torso', armR: 'torso', foreL: 'armL', foreR: 'armR', wristL: 'foreL', wristR: 'foreR',
    legL: 'hips', legR: 'hips', shinL: 'legL', shinR: 'legR', footL: 'shinL', footR: 'shinR', skirt: 'hips', hatBrim: 'head', twistR: 'foreR',
  };
  const world: Record<string, number[]> = { ...Object.fromEntries(ROSA_JOINTS.map((j) => [j, REST[j].toArray()])), skirt: [0, 0.94, 0], hatBrim: [0, 1.73, 0], twistR: [0.22, 0.8, 0] };
  // Shuffled order (the file's skin order is not ours).
  const names = ['twistR', 'skirt', 'footL', 'hatBrim', ...ROSA_JOINTS.filter((j) => j !== 'footL')];
  const idx = new Map(names.map((n, i) => [n, i]));
  const nodes: Array<Record<string, unknown>> = names.map((n) => {
    const p = parentOf[n];
    const w = world[n]!, pw = p ? world[p]! : [0, 0, 0];
    return { name: n, translation: [w[0]! - pw[0]!, w[1]! - pw[1]!, w[2]! - pw[2]!], children: names.filter((c) => parentOf[c] === n).map((c) => idx.get(c)!) };
  });
  const meshNode = nodes.length; nodes.push({ name: 'rosa', mesh: 0, skin: 0 });
  const rul0 = nodes.length;
  RULEROS.forEach((r, i) => nodes.push({ name: `rulero_${i}`, translation: r.t, rotation: r.r, scale: [r.s, r.s, r.s] }));

  const n = VERTS.length;
  const f32 = (a: number[]) => new Float32Array(a);
  const index = new Uint16Array(flip ? [0, 2, 1, 2, 4, 3, 5, 7, 6, 6, 8, 7] : [0, 1, 2, 2, 3, 4, 5, 6, 7, 6, 7, 8]);
  // Normals that agree with the (unflipped) winding: each vertex's faces, summed.
  const acc = VERTS.map(() => new THREE.Vector3());
  const base = [0, 1, 2, 2, 3, 4, 5, 6, 7, 6, 7, 8];
  for (let t = 0; t < base.length; t += 3) {
    const [a, b, c] = [base[t]!, base[t + 1]!, base[t + 2]!].map((i) => new THREE.Vector3(...VERTS[i]!.p));
    const fn = b!.clone().sub(a!).cross(c!.clone().sub(a!)).normalize();
    for (let k = 0; k < 3; k++) acc[base[t + k]!]!.add(fn);
  }
  const pos = f32(VERTS.flatMap((v) => v.p)), nor = f32(acc.flatMap((v) => v.normalize().toArray())), col = f32(VERTS.flatMap((v) => off(v.c)));
  const ink = f32(VERTS.map((v) => v.ink ?? 0));
  const jnt = new Uint8Array(VERTS.flatMap((v) => [0, 1, 2, 3].map((k) => (v.j[k] ? idx.get(v.j[k]!)! : 0))));
  const wgt = f32(VERTS.flatMap((v) => [0, 1, 2, 3].map((k) => v.w[k] ?? 0)));
  const ibm = f32(names.flatMap((nm) => new THREE.Matrix4().makeTranslation(-world[nm]![0]!, -world[nm]![1]!, -world[nm]![2]!).toArray()));
  const parts: ArrayBufferView[] = [pos, nor, col, ink, jnt, wgt, ibm, index];
  const views: Array<{ buffer: 0; byteOffset: number; byteLength: number }> = [];
  let off0 = 0;
  for (const p of parts) { views.push({ buffer: 0, byteOffset: off0, byteLength: p.byteLength }); off0 += Math.ceil(p.byteLength / 4) * 4; }
  const bin = new Uint8Array(off0);
  parts.forEach((p, i) => bin.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), views[i]!.byteOffset));
  const mn = [0, 1, 2].map((k) => Math.min(...VERTS.map((v) => v.p[k]!))), mx = [0, 1, 2].map((k) => Math.max(...VERTS.map((v) => v.p[k]!)));
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [idx.get('hips')!, meshNode, ...RULEROS.map((_, i) => rul0 + i)], extras: { faceRig: FACE } }],
    nodes,
    meshes: [{ name: 'rosa', primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2, _INK: 3, JOINTS_0: 4, WEIGHTS_0: 5 }, indices: 7 }] }],
    skins: [{ joints: names.map((nm) => idx.get(nm)!), inverseBindMatrices: 6 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: n, type: 'VEC3', min: mn, max: mx },
      { bufferView: 1, componentType: 5126, count: n, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: n, type: 'VEC3' },
      { bufferView: 3, componentType: 5126, count: n, type: 'SCALAR' },
      { bufferView: 4, componentType: 5121, count: n, type: 'VEC4' },
      { bufferView: 5, componentType: 5126, count: n, type: 'VEC4' },
      { bufferView: 6, componentType: 5126, count: names.length, type: 'MAT4' },
      { bufferView: 7, componentType: 5123, count: index.length, type: 'SCALAR' },
    ],
    bufferViews: views,
    buffers: [{ byteLength: bin.byteLength }],
  };
  let js = new TextEncoder().encode(JSON.stringify(json));
  const pad = Math.ceil(js.byteLength / 4) * 4;
  const jsp = new Uint8Array(pad).fill(0x20); jsp.set(js); js = jsp;
  const total = 12 + 8 + js.byteLength + 8 + bin.byteLength;
  const out = new ArrayBuffer(total), dv = new DataView(out), u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.byteLength, true); dv.setUint32(16, 0x4e4f534a, true); u8.set(js, 20);
  const b0 = 20 + js.byteLength;
  dv.setUint32(b0, bin.byteLength, true); dv.setUint32(b0 + 4, 0x004e4942, true); u8.set(bin, b0 + 8);
  return out;
}

async function loadAll(): Promise<void> {
  for (const q of QUALITIES) setCandidateAsset(await parseRosaCandidate(makeGlb(), q));
}

afterEach(() => { clearRosaCandidates(); vi.unstubAllGlobals(); });

const boneIndex = (name: string) => CANDIDATE_BONES.indexOf(name as never);

// ------------------------------------------------------------ parsing

describe('Rosa candidate: parsing the GLB', () => {
  it('renames _INK, snaps COLOR_0 to the palette, remaps and normalizes the skin, reads the face rig and the ruleros', async () => {
    const a = await parseRosaCandidate(makeGlb(), 'high');
    expect(a.warnings).toEqual([]);
    const g = a.geometry;
    expect(g.attributes.ink).toBeDefined();
    expect(g.attributes._ink).toBeUndefined();
    expect(Array.from(g.attributes.ink!.array)).toEqual(VERTS.map((v) => v.ink ?? 0));
    expect(g.attributes.color!.itemSize).toBe(3);
    VERTS.forEach((v, i) => {
      const want = new THREE.Color(v.c);
      expect([g.attributes.color!.getX(i), g.attributes.color!.getY(i), g.attributes.color!.getZ(i)]).toEqual([want.r, want.g, want.b].map((x) => Math.fround(x)));
    });
    // Skin indices in our bone order; the unlisted twist bone hands its weight to foreR.
    const si = g.attributes.skinIndex!, sw = g.attributes.skinWeight!;
    expect(si.getX(0)).toBe(boneIndex('armR'));
    expect([si.getX(1), si.getY(1)]).toEqual([boneIndex('armR'), boneIndex('foreR')]);
    expect(si.getX(3)).toBe(boneIndex('foreR'));
    expect(si.getX(4)).toBe(boneIndex('skirt'));
    expect(si.getX(7)).toBe(boneIndex('hatBrim'));
    expect(sw.getX(8) + sw.getY(8)).toBeCloseTo(1, 6);
    expect(sw.getX(8)).toBeCloseTo(0.75, 6);
    expect(a.faceRig).toEqual(FACE);
    expect(a.tris).toBe(4);
    expect(a.extras.hatBrim?.toArray()).toEqual([0, 1.73, 0].map(Math.fround));
    expect(a.extras.bun).toBeUndefined();
    // Ruleros: root space in the file, head-local (minus the neck base, 1.44) in the game.
    expect(a.rulPlace).toHaveLength(4);
    a.rulPlace.forEach((m, i) => {
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      m.decompose(p, q, s);
      const r = RULEROS[i]!;
      expect(p.x).toBeCloseTo(r.t[0], 5); expect(p.y).toBeCloseTo(r.t[1] - 1.44, 5); expect(p.z).toBeCloseTo(r.t[2], 5);
      expect(s.x).toBeCloseTo(r.s, 5);
      expect(Math.abs(q.dot(new THREE.Quaternion(...r.r)))).toBeCloseTo(1, 5);
    });
    expect(g.userData.shared).toBe(true);
  });

  it('flags a joint off its RIG position', async () => {
    const buf = makeGlb();
    // Move every inverse bind matrix's translation by 5 cm: all joints off.
    const a = await parseRosaCandidate(buf, 'low');
    expect(a.warnings).toEqual([]);
    const g = await parseRosaCandidate(makeGlbShifted(), 'low');
    expect(g.warnings.some((w) => w.startsWith('head at'))).toBe(true);
  });

  it('flags a surface wound against its normals (it would draw inside out)', async () => {
    const a = await parseRosaCandidate(makeGlb(true), 'low');
    expect(a.warnings.some((w) => w.startsWith('surface winding'))).toBe(true);
  });
});

/** The same GLB with every inverse bind matrix moved down 5 cm. */
function makeGlbShifted(): ArrayBuffer {
  const buf = makeGlb();
  const dv = new DataView(buf);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const view = json.bufferViews[json.accessors[6].bufferView];
  const bin = 20 + jsonLen + 8;
  for (let i = 0; i < json.accessors[6].count; i++) {
    const o = bin + view.byteOffset + i * 64 + 13 * 4;
    dv.setFloat32(o, dv.getFloat32(o, true) + 0.05, true);
  }
  return buf;
}

// ------------------------------------------------------------ loading

describe('Rosa candidate: loading', () => {
  it('maps each quality tier to its file', () => {
    for (const q of QUALITIES) expect(candidateUrl(q)).toBe(`/models/rosa-sol-${q}.glb`);
  });

  it('fetches a tier once, caches it, and reports size and time', async () => {
    const glb = makeGlb();
    const fetch = vi.fn(async (_u: string) => new Response(glb.slice(0), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect(candidateReady('medium')).toBe(false);
    await Promise.all([loadRosaCandidate('medium'), loadRosaCandidate('medium')]);
    await loadRosaCandidate('medium');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe('/models/rosa-sol-medium.glb');
    expect(candidateReady('medium')).toBe(true);
    expect(candidateReady('high')).toBe(false);
    expect(candidateAsset('medium')!.bytes).toBe(glb.byteLength);
  });

  it('a missing file rejects, stays not ready, and can be tried again', async () => {
    const fetch = vi.fn(async () => new Response('nope', { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    await expect(loadRosaCandidate('low')).rejects.toThrow(/404/);
    expect(candidateReady('low')).toBe(false);
    await expect(loadRosaCandidate('low')).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

// ------------------------------------------------------------ building

describe('Rosa candidate: the rig', () => {
  it('builds the same joints at the same positions as the current model', async () => {
    await loadAll();
    for (const q of QUALITIES) {
      const c = buildRosaCandidate(0, q), m = buildRosaModel(0, { quality: q, arena: true });
      c.root.updateMatrixWorld(true); m.root.updateMatrixWorld(true);
      for (const j of ROSA_JOINTS) {
        expect(c[j].position.toArray()).toEqual(m[j].position.toArray());
        expect(c[j].rotation.toArray()).toEqual(m[j].rotation.toArray());
        const parent = (r: typeof c) => ROSA_JOINTS.find((k) => r[k] === r[j].parent) ?? (r[j].parent === r.root ? 'root' : '?');
        expect(parent(c)).toBe(parent(m));
      }
    }
  });

  it('one skinned mesh, a bone at identity under each joint, the skirt and brim as extras', async () => {
    await loadAll();
    const c = buildRosaCandidate(0, 'high');
    const skinned: THREE.SkinnedMesh[] = [];
    c.root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh); });
    expect(skinned).toHaveLength(1);
    const sk = skinned[0]!;
    expect(sk.parent).toBe(c.root);
    expect(sk.geometry).toBe(candidateAsset('high')!.geometry);
    expect(sk.skeleton.bones.map((b) => b.name)).toEqual([...CANDIDATE_BONES]);
    for (const j of ROSA_JOINTS) {
      const b = sk.skeleton.bones[boneIndex(j)]!;
      expect(b.parent).toBe(c[j]);
      expect(b.matrix.equals(new THREE.Matrix4())).toBe(true);
    }
    expect(c.extras.skirt!.parent).toBe(c.hips);
    expect(c.extras.skirt!.position.y).toBeCloseTo(0.08, 9);
    expect(c.extras.hatBrim!.parent).toBe(c.head);
    expect(c.extras.hatBrim!.position.y).toBeCloseTo(1.73 - 1.44, 6);
    expect(c.extras.bun).toBeUndefined(); // not in this file
    expect(c.flashMats).toHaveLength(1);
    expect(sk.material).toBe(c.flashMats[0]);
    expect(c.face).toBeDefined();
  });

  it('skins on the CPU exactly like the rigid joints (a raised and bent arm, the root moved)', async () => {
    await loadAll();
    const c = buildRosaCandidate(0, 'medium');
    const sk = c.root.children.find((o) => (o as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh;
    const rest = (i: number) => new THREE.Vector3(...VERTS[i]!.p);
    // At rest every vertex stays put.
    c.root.updateMatrixWorld(true);
    for (let i = 0; i < VERTS.length; i++) expect(sk.applyBoneTransform(i, rest(i)).distanceTo(rest(i))).toBeLessThan(1e-6);
    // Pose: arm raised forward, elbow bent, torso twisted, the skirt tilted, root moved and turned.
    c.armR.rotation.set(-1.2, 0, 0.3);
    c.foreR.rotation.set(-0.9, 0, 0);
    c.torso.rotation.y = 0.4;
    c.extras.skirt!.rotation.x = 0.25;
    c.extras.skirt!.scale.set(1.1, 0.8, 1.1);
    c.root.position.set(3, 0.5, -2); c.root.rotation.y = 1.1;
    c.root.updateMatrixWorld(true);
    // What a rigid point fixed to joint `o` at rest would do, in root space.
    const toRoot = new THREE.Matrix4().copy(c.root.matrixWorld).invert();
    const rigid = (o: THREE.Object3D, p: THREE.Vector3) => {
      const at = o === c.extras.skirt ? new THREE.Vector3(0, 0.94, 0) : REST[ROSA_JOINTS.find((j) => c[j] === o)!];
      const restWorld = new THREE.Matrix4().makeTranslation(at.x, at.y, at.z);
      return p.clone().applyMatrix4(restWorld.invert()).applyMatrix4(o.matrixWorld).applyMatrix4(toRoot);
    };
    const near = (a: THREE.Vector3, b: THREE.Vector3) => expect(a.distanceTo(b)).toBeLessThan(1e-5);
    near(sk.applyBoneTransform(0, rest(0)), rigid(c.armR, rest(0)));
    near(sk.applyBoneTransform(2, rest(2)), rigid(c.foreR, rest(2)));
    near(sk.applyBoneTransform(3, rest(3)), rigid(c.foreR, rest(3)));
    near(sk.applyBoneTransform(1, rest(1)), rigid(c.armR, rest(1)).multiplyScalar(0.5).add(rigid(c.foreR, rest(1)).multiplyScalar(0.5)));
    near(sk.applyBoneTransform(4, rest(4)), rigid(c.extras.skirt!, rest(4)));
    // The bent elbow really moves the forearm (not a trivially passing test).
    expect(sk.applyBoneTransform(2, rest(2)).distanceTo(rest(2))).toBeGreaterThan(0.2);
    // And the forearm vertex ends where the wrist joint's frame carries it.
    const wristRoot = c.wristR.getWorldPosition(new THREE.Vector3()).applyMatrix4(toRoot);
    near(rigid(c.foreR, REST.wristR.clone()), wristRoot);
  });

  it('weapons on wristR, ruleros on the head at the file placements, props like the current model', async () => {
    await loadAll();
    for (const q of QUALITIES) {
      const c = buildRosaCandidate(0, q), m = buildRosaModel(0, { quality: q, arena: true });
      expect(c.weapons[0].parent).toBe(c.wristR);
      expect(c.weapons[1].parent).toBe(c.wristR);
      for (const k of [0, 1] as const) {
        expect(c.weapons[k].position.toArray()).toEqual(m.weapons[k].position.toArray());
        expect(c.weapons[k].quaternion.toArray()).toEqual(m.weapons[k].quaternion.toArray());
        expect((c.weapons[k] as THREE.Mesh).geometry ?? null).toBe((m.weapons[k] as THREE.Mesh).geometry ?? null);
      }
      expect(c.rulMesh!.parent).toBe(c.head);
      expect(c.rulMesh!.count).toBe(4);
      expect(!!c.rulOutline).toBe(q !== 'low');
      expect(c.rulPlace.map((x) => x.toArray())).toEqual(candidateAsset(q)!.rulPlace.map((x) => x.toArray()));
      const im = new THREE.Matrix4();
      c.rulMesh!.getMatrixAt(2, im);
      im.toArray().forEach((x, k) => expect(x).toBeCloseTo(c.rulPlace[2]!.elements[k]!, 6));
      expect(c.stars.parent).toBe(c.head);
      expect(c.bubble.parent).toBe(c.root);
      const sk = c.root.children.find((o) => (o as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh;
      expect(sk.castShadow).toBe(q !== 'low');
      expect(sk.receiveShadow).toBe(q !== 'low');
      expect(sk.boundingSphere!.radius).toBeGreaterThan(1.2);
    }
  });
});

// ------------------------------------------------------------ the avatar

describe('Rosa candidate: the avatar and its fallback', () => {
  it('falls back to the current model until the tier is loaded', async () => {
    const before = new Avatar(0, { quality: 'high', arena: true, candidate: true });
    expect(before.isCandidate).toBe(false);
    before.dispose();
    await loadAll();
    const after = new Avatar(0, { quality: 'high', arena: true, candidate: true });
    expect(after.isCandidate).toBe(true);
    after.update({ speed: 3, strafe: 0, back: 0, onGround: true, crouched: true, alive: true, protected: true, pitch: 0, weapon: 1, msSinceThrow: 100, msSinceHit: 50, connected: true, msSinceMelee: 120, ruleros: 5 }, 1 / 60, false);
    after.dispose();
  });

  it('only Sol in the arena look: Luna, the campaign home look and the non-arena look keep the current model', async () => {
    await loadAll();
    for (const q of QUALITIES) {
      for (const opts of [{ team: 1 as const, arena: true }, { team: 0 as const, arena: false }, { team: 0 as const, arena: true, home: true }]) {
        const a = new Avatar(opts.team, { quality: q, arena: opts.arena, home: opts.home, candidate: true });
        expect(a.isCandidate).toBe(false);
        const ref = buildRosaModel(opts.team, { quality: q, arena: opts.arena, home: opts.home });
        const geos = (r: THREE.Object3D) => { const s: THREE.BufferGeometry[] = []; r.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh) s.push(m.geometry); }); return s; };
        expect(geos(a.root)).toEqual(geos(ref.root));
        let skinned = 0; a.root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned++; });
        expect(skinned).toBe(0);
        a.dispose();
      }
      const off = new Avatar(0, { quality: q, arena: true });
      expect(off.isCandidate).toBe(false);
      off.dispose();
    }
  });

  it('dispose frees the per-avatar material, roller instances and skeleton, never the shared geometry', async () => {
    await loadAll();
    const a = new Avatar(0, { quality: 'medium', arena: true, candidate: true });
    const shared = candidateAsset('medium')!.geometry;
    let sharedFreed = 0, matFreed = 0, skelFreed = 0;
    shared.addEventListener('dispose', () => sharedFreed++);
    let sk: THREE.SkinnedMesh | null = null;
    a.root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) sk = o as THREE.SkinnedMesh; });
    (sk!.material as THREE.Material).addEventListener('dispose', () => matFreed++);
    const skel = (sk as unknown as THREE.SkinnedMesh).skeleton;
    const orig = skel.dispose.bind(skel);
    skel.dispose = () => { skelFreed++; orig(); };
    a.dispose();
    expect([sharedFreed, matFreed, skelFreed]).toEqual([0, 1, 1]);
  });

  it('repeated build and dispose shares the same pieces and leaves nothing behind', async () => {
    await loadAll();
    const sharedSeen = new Set<THREE.BufferGeometry>();
    const perAvatar = new Set<THREE.BufferGeometry>();
    let freed = 0;
    for (let round = 0; round < 6; round++) {
      for (const q of QUALITIES) {
        const a = new Avatar(0, { quality: q, arena: true, candidate: true });
        expect(a.isCandidate).toBe(true);
        a.root.traverse((o) => {
          const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
          if (!g) return;
          if (g.userData.shared) sharedSeen.add(g);
          else { perAvatar.add(g); g.addEventListener('dispose', () => freed++); }
        });
        a.dispose();
      }
    }
    // The shared set is the same after the first round (no new geometry per build); anything else was freed.
    expect(sharedSeen.size).toBeLessThanOrEqual(QUALITIES.length * 8);
    expect(freed).toBe(perAvatar.size);
    const sizeAfter = sharedSeen.size;
    const a = new Avatar(0, { quality: 'high', arena: true, candidate: true });
    a.root.traverse((o) => { const g = (o as THREE.Mesh).geometry; if (g?.userData.shared) sharedSeen.add(g); });
    a.dispose();
    expect(sharedSeen.size).toBe(sizeAfter);
  });
});

// ------------------------------------------------------------ the setting

describe('Rosa candidate: the preview setting', () => {
  const memKV = (init: Record<string, string> = {}): KV => {
    const m = new Map(Object.entries(init));
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
  };
  it('defaults off, is sanitized and persists', () => {
    const d = defaults('en', false, false);
    expect(d.rosaCandidate).toBe(false);
    expect(new FpsSettingsStore(new SafeStorage(memKV()), d).value.rosaCandidate).toBe(false);
    expect(new FpsSettingsStore(new SafeStorage(memKV({ 'chancla.mp.settings.v1': JSON.stringify({ rosaCandidate: 'yes' }) })), d).value.rosaCandidate).toBe(false);
    const kv = memKV();
    new FpsSettingsStore(new SafeStorage(kv), d).update({ rosaCandidate: true });
    expect(new FpsSettingsStore(new SafeStorage(kv), d).value.rosaCandidate).toBe(true);
  });
});
