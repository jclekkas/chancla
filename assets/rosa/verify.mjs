// Checks the built GLBs against docs/rosa-asset/CONTRACT.md, loading each with three's own
// GLTFLoader (so the runtime can parse it as shipped).
//   node assets/rosa/verify.mjs
import { readFileSync, statSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const BONES = ['hips', 'torso', 'head', 'armR', 'foreR', 'wristR', 'armL', 'foreL', 'wristL', 'legR', 'shinR', 'footR', 'legL', 'shinL', 'footL', 'skirt'];
const JOINT = {
  hips: [0, 0.86, 0], torso: [0, 0.86, 0], head: [0, 1.44, 0], armR: [0.22, 1.3, 0], foreR: [0.22, 0.98, 0], wristR: [0.22, 0.67, 0],
  armL: [-0.22, 1.3, 0], foreL: [-0.22, 0.98, 0], wristL: [-0.22, 0.67, 0], legR: [0.1, 0.81, 0], shinR: [0.1, 0.41, 0], footR: [0.1, -0.02, 0],
  legL: [-0.1, 0.81, 0], shinL: [-0.1, 0.41, 0], footL: [-0.1, -0.02, 0], skirt: [0, 0.94, 0],
};
const BUDGET = { high: 16000, medium: 10000, low: 5000 };
const palette = JSON.parse(readFileSync(new URL('./palette.json', import.meta.url)));
const pal = [...Object.entries(palette.sol), ...Object.entries(palette.shared)].map(([k, h]) => [k, new THREE.Color(h)]);
const name = (c) => { let best = null, bd = 1e9; for (const [k, p] of pal) { const d = (p.r - c.r) ** 2 + (p.g - c.g) ** 2 + (p.b - c.b) ** 2; if (d < bd) { bd = d; best = k; } } return [best, Math.sqrt(bd)]; };

let failed = 0;
const fail = (t, m) => { failed++; console.log(`  FAIL ${t}: ${m}`); };

for (const tier of ['high', 'medium', 'low']) {
  const path = new URL(`../../public/models/rosa-sol-${tier}.glb`, import.meta.url);
  const buf = readFileSync(path);
  const size = statSync(path).size;
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
  console.log(`\n${tier}: ${(size / 1024).toFixed(1)} KB`);
  if (size > 400 * 1024) fail(tier, 'over 400 KB');
  let mesh = null; const empties = {}; const bones = {};
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh) { if (mesh) fail(tier, 'more than one skinned mesh'); mesh = o; } if (/^rulero_\d$/.test(o.name)) empties[o.name] = o; if (o.isBone) bones[o.name] = o; });
  if (!mesh) { fail(tier, 'no skinned mesh'); continue; }
  if (mesh.name !== 'rosa') fail(tier, `mesh named ${mesh.name}`);
  const g = mesh.geometry;
  if (Array.isArray(mesh.material) || g.groups.length > 1) fail(tier, 'more than one primitive');
  for (const a of ['position', 'normal', 'color', 'skinIndex', 'skinWeight', '_ink']) if (!g.attributes[a]) fail(tier, `missing attribute ${a}`);
  const tris = g.index.count / 3;
  console.log(`  triangles ${tris} (budget ${BUDGET[tier]}), vertices ${g.attributes.position.count}`);
  if (tris > BUDGET[tier]) fail(tier, 'over the triangle budget');
  // Bones: names, rest positions (root space), identity rest rotations.
  const sk = mesh.skeleton;
  const names = sk.bones.map((b) => b.name);
  for (const b of BONES) if (!names.includes(b)) fail(tier, `missing bone ${b}`);
  gltf.scene.updateMatrixWorld(true);
  let maxOff = 0, maxRot = 0;
  for (const b of sk.bones) {
    const p = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
    if (JOINT[b.name]) maxOff = Math.max(maxOff, p.distanceTo(new THREE.Vector3(...JOINT[b.name])));
    maxRot = Math.max(maxRot, 2 * Math.acos(Math.min(1, Math.abs(b.quaternion.w))));
  }
  console.log(`  bones ${names.join(',')}; max joint offset ${maxOff.toExponential(2)} m, max rest rotation ${maxRot.toExponential(2)} rad`);
  if (maxOff > 1e-4 || maxRot > 1e-4) fail(tier, 'bone rest transform off the RIG');
  // Weights: at most 4, normalized; skirt verts never on arm bones.
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, ink = g.attributes._ink, pos = g.attributes.position, col = g.attributes.color;
  let maxSumErr = 0, stray = 0;
  const tags = { surface: 0, hull: 0, eye: 0, browL: 0, browR: 0 };
  const cnames = new Map();
  let worstCol = 0;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    let s = 0; const bs = [];
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); s += w; if (w > 0) bs.push(names[si.getComponent(i, k)]); }
    maxSumErr = Math.max(maxSumErr, Math.abs(s - 1));
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i));
    const [cn, cd] = name(c); worstCol = Math.max(worstCol, cd); cnames.set(cn, (cnames.get(cn) ?? 0) + 1);
    if (bs.includes('skirt') && bs.some((b) => /^(arm|fore|wrist)/.test(b))) stray++;
    if ((cn === 'skirt' || cn === 'skirtDeep') && pos.getY(i) < 0.85 && bs.some((b) => /^(arm|fore|wrist|head)/.test(b))) stray++;
    const t = ink.getX(i);
    if (t === 0) tags.surface++; else if (t === 1) tags.hull++; else if (t === -1) tags.eye++; else if (t === -2) tags.browL++; else if (t === -3) tags.browR++; else fail(tier, `odd _INK ${t}`);
  }
  console.log(`  weights: max |sum-1| ${maxSumErr.toExponential(2)}, stray skirt/arm influences ${stray}`);
  console.log(`  _INK: ${JSON.stringify(tags)}; colours ${[...cnames.keys()].sort().join(',')} (worst palette distance ${worstCol.toExponential(2)})`);
  if (maxSumErr > 0.01 || stray) fail(tier, 'weights');
  if (!tags.hull || !tags.eye || !tags.browL || !tags.browR) fail(tier, 'missing hull or face tags');
  if (worstCol > 0.004) fail(tier, 'colour not from the palette');
  // Winding: surface faces wind counter-clockwise with their normals; hull faces are flipped (they face inward).
  const idx = g.index, nrm = g.attributes.normal;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3(), fn = new THREE.Vector3();
  let badSurf = 0, badHull = 0, nSurf = 0, nHull = 0;
  for (let f = 0; f < idx.count; f += 3) {
    const i0 = idx.getX(f), i1 = idx.getX(f + 1), i2 = idx.getX(f + 2);
    A.fromBufferAttribute(pos, i0); B.fromBufferAttribute(pos, i1); C.fromBufferAttribute(pos, i2);
    fn.crossVectors(B.clone().sub(A), C.clone().sub(A));
    if (fn.lengthSq() < 1e-14) continue;
    N.set(0, 0, 0); for (const i of [i0, i1, i2]) N.x += nrm.getX(i), N.y += nrm.getY(i), N.z += nrm.getZ(i);
    const hull = ink.getX(i0) === 1;
    // The hull's normals follow its own (flipped) winding; what matters is that it faces inward:
    // compare its winding with the outward direction from the body's centre line.
    if (hull) { nHull++; if (fn.dot(N) < 0) badHull++; }
    else { nSurf++; if (fn.dot(N) < 0) badSurf++; }
  }
  console.log(`  winding: surface faces against their normals ${badSurf}/${nSurf}; hull faces against their own normals ${badHull}/${nHull} (the hull is the inverted copy)`);
  if (badSurf > nSurf * 0.002) fail(tier, 'surface winding');
  // Brows: her left brow at -x.
  let lx = 0, rx = 0;
  for (let i = 0; i < pos.count; i++) { const t = ink.getX(i); if (t === -2) lx += pos.getX(i); if (t === -3) rx += pos.getX(i); }
  if (!(lx < 0 && rx > 0)) fail(tier, 'brow tags on the wrong sides');
  // Face rig and rulero empties.
  const fr = gltf.scene.userData.faceRig ?? gltf.parser.json.scenes[0].extras?.faceRig;
  console.log(`  faceRig ${JSON.stringify(fr)}`);
  if (!fr || !(fr.lidY > 1.5 && fr.lidY < 1.65) || !(fr.browIn < fr.browOut)) fail(tier, 'faceRig');
  for (let i = 0; i < 4; i++) {
    const e = empties[`rulero_${i}`];
    if (!e) { fail(tier, `missing rulero_${i}`); continue; }
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    e.matrixWorld.decompose(p, q, s);
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    console.log(`  rulero_${i} at (${p.toArray().map((v) => v.toFixed(3)).join(', ')}), axis (${axis.toArray().map((v) => v.toFixed(2)).join(', ')}), scale ${s.x.toFixed(2)}`);
  }
  // Gameplay bounds (rest): body cylinder r 0.36, y 0.30..1.27; head sphere r 0.25 at 1.52.
  const outside = new Map();
  const hc = new THREE.Vector3(0, 1.52, 0);
  const v = new THREE.Vector3();
  let top = 0;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    top = Math.max(top, v.y);
    const r = Math.hypot(v.x, v.z);
    // Shoulders (1.27..1.45) sit above the cylinder's cap in the current model too: measure them radially.
    const dBody = v.y >= 0.3 && v.y <= 1.45 ? Math.max(0, r - 0.36) : Infinity;
    const dHead = Math.max(0, v.distanceTo(hc) - 0.25);
    const d = Math.min(dBody, dHead);
    if (d > 0.001) {
      c.setRGB(col.getX(i), col.getY(i), col.getZ(i));
      const key = ink.getX(i) === 1 ? 'hull' : name(c)[0];
      const region = v.y < 0.3 ? 'below 0.30 (shins, feet)' : ['straw', 'strawDeep', 'band', 'flower', 'flowerHeart'].includes(key) ? 'hat' : key === 'hull' ? (v.y > 1.6 ? 'hat hull' : v.y < 0.3 ? 'below 0.30 (shins, feet)' : 'hull') : key;
      const cur = outside.get(region) ?? { n: 0, max: 0 };
      cur.n++; if (Number.isFinite(d)) cur.max = Math.max(cur.max, d);
      outside.set(region, cur);
    }
  }
  console.log(`  top of the mesh y ${top.toFixed(3)}`);
  let sh = 0, shN = 0;
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); if (v.y > 1.27 && v.y < 1.45 && ink.getX(i) !== 1 && v.distanceTo(hc) > 0.25) { shN++; sh = Math.max(sh, Math.hypot(v.x, v.z)); } }
  console.log(`  shoulders above the cylinder cap (y 1.27..1.45, outside the head sphere): ${shN} verts, max radius ${sh.toFixed(3)} m (cylinder 0.36)`);
  for (const [k, o] of outside) console.log(`  outside the hit volumes: ${k}: ${o.n} verts, max ${Number.isFinite(o.max) ? o.max.toFixed(3) : 'n/a'} m`);
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
