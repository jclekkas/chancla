// Reusable colonial facade pieces. One InstancedMesh per material, so a street
// of arches, doors, and balconies is a handful of draws.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapBox } from '../../shared/map';

interface Spot { x: number; y: number; z: number; ry: number; rx?: number; rz?: number; s?: number; color: number }

const _o = new THREE.Object3D();
const _c = new THREE.Color();

function archShape(outer: number, rise: number, inner: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-outer, 0);
  s.lineTo(-outer, rise);
  s.absarc(0, rise, outer, Math.PI, 0, true);
  s.lineTo(outer, 0);
  s.lineTo(-outer, 0);
  const hole = new THREE.Path();
  hole.moveTo(-inner, 0);
  hole.lineTo(inner, 0);
  hole.lineTo(inner, rise);
  hole.absarc(0, rise, inner, 0, Math.PI, false);
  hole.lineTo(-inner, 0);
  s.holes.push(hole);
  return s;
}

function extrude(shape: THREE.Shape, depth: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 1, curveSegments: 7,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

function box(w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function plain(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name);
  }
  return out;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts.map(plain), false) ?? parts[0]!;
}

function doorFrame(): THREE.BufferGeometry {
  const frame = extrude(archShape(0.7, 1.7, 0.46), 0.62);
  const reveal = box(0.86, 2.05, 0.06, 0, 1.02, -0.28);
  return merge([frame, reveal]);
}

function doorLeaf(): THREE.BufferGeometry {
  const leaf = box(0.74, 1.9, 0.07, 0, 0.96, 0.02);
  const rail1 = box(0.66, 0.07, 0.04, 0, 0.5, 0.07);
  const rail2 = box(0.66, 0.07, 0.04, 0, 1.3, 0.07);
  const stile = box(0.07, 1.75, 0.04, 0, 0.96, 0.07);
  return merge([leaf, rail1, rail2, stile]);
}

function windowFrame(): THREE.BufferGeometry {
  const frame = extrude(archShape(0.52, 1.2, 0.34), 0.55);
  frame.translate(0, 0.2, 0);
  const reveal = box(0.62, 1.45, 0.05, 0, 0.9, -0.24);
  const lintel = box(1.2, 0.09, 0.14, 0, 1.95, 0.04);
  const sill = box(1.25, 0.08, 0.24, 0, 0.16, 0.1);
  return merge([frame, reveal, lintel, sill]);
}

function windowGrille(): THREE.BufferGeometry {
  const bars = [-0.18, 0, 0.18].map((x) => box(0.03, 1.25, 0.04, x, 0.85, 0.06));
  const cross = box(0.5, 0.03, 0.04, 0, 1.15, 0.06);
  return merge([...bars, cross]);
}

function balconyModule(): THREE.BufferGeometry {
  const slab = box(1.55, 0.07, 0.62, 0, 0, 0.28);
  const top = box(1.5, 0.035, 0.035, 0, 0.48, 0.52);
  const posts = [];
  for (let i = 0; i < 6; i++) posts.push(box(0.028, 0.46, 0.028, -0.62 + i * 0.25, 0.24, 0.52));
  const bracketL = box(0.08, 0.28, 0.08, -0.55, -0.12, 0.22);
  const bracketR = box(0.08, 0.28, 0.08, 0.55, -0.12, 0.22);
  return merge([slab, top, ...posts, bracketL, bracketR]);
}

function corniceModule(): THREE.BufferGeometry {
  const band = box(1.15, 0.16, 0.22, 0, 0.1, 0.08);
  const lip = box(1.15, 0.06, 0.34, 0, 0.2, 0.12);
  const parapet = box(1.05, 0.28, 0.1, 0, 0.42, 0.02);
  return merge([band, lip, parapet]);
}

function card(w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, 1, 3);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setZ(i, Math.min(0, y) * 0.35);
  }
  g.computeVertexNormals();
  return g;
}

function petalTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = '#e2186a';
  g.beginPath(); g.ellipse(32, 36, 13, 22, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ff6aa8';
  g.beginPath(); g.ellipse(32, 28, 7, 12, 0, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function leafTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = '#1f7a32';
  g.beginPath(); g.ellipse(32, 34, 10, 24, 0.4, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#0e4a1c';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(32, 12); g.lineTo(32, 56); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function stamp(geo: THREE.BufferGeometry, mat: THREE.Material, spots: Spot[], shadow: boolean): THREE.InstancedMesh | null {
  if (!spots.length) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(spots.length * 3), 3);
  spots.forEach((s, i) => {
    _o.position.set(s.x, s.y, s.z);
    _o.rotation.set(s.rx ?? 0, s.ry, s.rz ?? 0);
    _o.scale.setScalar(s.s ?? 1);
    _o.updateMatrix();
    mesh.setMatrixAt(i, _o.matrix);
    _c.setHex(s.color);
    mesh.setColorAt(i, _c);
  });
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

interface Face { fx: number; fz: number; ux: number; uz: number; nx: number; nz: number; len: number; ry: number }

function faceOf(b: MapBox): Face {
  switch (b.facade) {
    case 's': return { fx: b.minX, fz: b.maxZ, ux: 1, uz: 0, nx: 0, nz: 1, len: b.maxX - b.minX, ry: 0 };
    case 'n': return { fx: b.maxX, fz: b.minZ, ux: -1, uz: 0, nx: 0, nz: -1, len: b.maxX - b.minX, ry: Math.PI };
    case 'e': return { fx: b.maxX, fz: b.maxZ, ux: 0, uz: -1, nx: 1, nz: 0, len: b.maxZ - b.minZ, ry: Math.PI / 2 };
    default: return { fx: b.minX, fz: b.minZ, ux: 0, uz: 1, nx: -1, nz: 0, len: b.maxZ - b.minZ, ry: -Math.PI / 2 };
  }
}

const stuccoMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0 });
const woodMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0 });
const ironMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.65 });
const petalMat = new THREE.MeshStandardMaterial({ map: petalTex(), color: 0xffffff, roughness: 0.6, metalness: 0, alphaTest: 0.35, side: THREE.DoubleSide });
const leafMat = new THREE.MeshStandardMaterial({ map: leafTex(), color: 0xffffff, roughness: 0.7, metalness: 0, alphaTest: 0.35, side: THREE.DoubleSide });

/** Arches, panelled doors, iron balconies, a cornice line, and draped flowers. */
export function placeFacadeModules(parent: THREE.Object3D, boxes: readonly MapBox[]): void {
  const doors: Spot[] = [];
  const doorFrames: Spot[] = [];
  const windows: Spot[] = [];
  const grilles: Spot[] = [];
  const balconies: Spot[] = [];
  const cornices: Spot[] = [];
  const petals: Spot[] = [];
  const leaves: Spot[] = [];
  const drape = (x: number, y: number, z: number, ry: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const hang = 0.15 + (i % 4) * 0.22;
      const spread = (i - n / 2) * 0.16;
      const rx = -0.7 - (i % 3) * 0.25;
      petals.push({ x: x + Math.cos(ry) * spread, y: y - hang, z: z + Math.sin(ry) * spread, ry: ry + i * 0.4, rx, s: 1.8 + (i % 3) * 0.35, color: i % 2 ? 0xff4d94 : 0xd41468 });
      if (i % 2 === 0) leaves.push({ x, y: y - hang * 0.6, z, ry: ry + 0.5, rx: rx * 0.5, s: 1.6, color: 0x1f7a32 });
    }
  };
  for (const b of boxes) {
    const stone = b.mat === 'stone';
    if (!b.facade || (!b.mat.startsWith('stucco') && !stone) || b.maxY < 3.2 || b.minY > 0.4) continue;
    const f = faceOf(b);
    if (f.len < 2.8) continue;
    // Houses sit behind the arcade, so their openings have to clear that wall.
    const upper = b.maxY > 5.5;
    const cols = Math.min(3, Math.max(1, Math.floor(f.len / 3.4)));
    for (let k = 0; k < cols; k++) {
      const along = f.len * ((k + 0.5) / cols);
      const x = f.fx + f.ux * along + f.nx * 0.16;
      const z = f.fz + f.uz * along + f.nz * 0.16;
      if (!upper) {
        doorFrames.push({ x, y: 0, z, ry: f.ry, color: 0xf4ead8 });
        doors.push({ x, y: 0, z, ry: f.ry, color: 0x6a3a22 });
        const bx = x + f.nx * 0.28;
        const bz = z + f.nz * 0.28;
        balconies.push({ x: bx, y: 2.25, z: bz, ry: f.ry, color: 0x2a2622 });
        drape(bx + f.nx * 0.4, 2.7, bz + f.nz * 0.4, f.ry, 8);
      } else {
        const y = 4.35;
        windows.push({ x, y, z, ry: f.ry, color: 0xf4ead8 });
        grilles.push({ x, y, z, ry: f.ry, color: 0x2c2926 });
        if (k === cols - 1) {
          const bx = x + f.nx * 0.28;
          const bz = z + f.nz * 0.28;
          balconies.push({ x: bx, y: 4.05, z: bz, ry: f.ry, color: 0x2a2622 });
          drape(bx + f.nx * 0.45, 4.55, bz + f.nz * 0.45, f.ry, 8);
        }
      }
    }
    const segments = Math.max(2, Math.floor(f.len / 1.15));
    for (let i = 0; i < segments; i++) {
      const along = f.len * ((i + 0.5) / segments);
      const x = f.fx + f.ux * along + f.nx * 0.05;
      const z = f.fz + f.uz * along + f.nz * 0.05;
      cornices.push({ x, y: b.maxY - 0.35, z, ry: f.ry, color: 0xf6efe4 });
      if (i % 2 === 0) drape(x + f.nx * 0.4, b.maxY - 0.1, z + f.nz * 0.4, f.ry, 5);
    }
  }
  const pieces: Array<[THREE.BufferGeometry, THREE.Material, Spot[], boolean]> = [
    [doorFrame(), stuccoMat, doorFrames, true],
    [doorLeaf(), woodMat, doors, true],
    [windowFrame(), stuccoMat, windows, true],
    [windowGrille(), ironMat, grilles, true],
    [balconyModule(), ironMat, balconies, true],
    [corniceModule(), stuccoMat, cornices, true],
    [card(0.7, 1.05), petalMat, petals, false],
    [card(0.45, 0.85), leafMat, leaves, false],
  ];
  for (const [geo, mat, spots, shadow] of pieces) {
    const mesh = stamp(geo, mat, spots, shadow);
    if (mesh) parent.add(mesh);
  }
}
