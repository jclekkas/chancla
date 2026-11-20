// Everything the original courtyard draws, rebuilt for Duty's fast path:
// one merged mesh for solids, a painted floor, and a few instanced batches
// for foliage, cloth, lights, and glow. Colors stay warm without a post pass.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapBox, MapData, MapDecor } from '../../shared/map';
import { groundTexture, signTexture } from '../../src/fps/render/materials';
import { placeFacadeModules } from './facades';
import { THEMES, type ThemeName } from '../../src/fps/render/world';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

const HUE: Record<string, number> = {
  stuccoTerracotta: 0xe39462, stuccoCream: 0xfff3df, stuccoTurquoise: 0x6fbfc4,
  stuccoMarigold: 0xe8a84a, stuccoViolet: 0xc9a4d4, stuccoPink: 0xee9a86,
  stone: 0xf0e2cc, step: 0xf6e7c8, parapet: 0xfff0d8, planter: 0xc45a38,
  wood: 0xc48448, lintel: 0xf7efe0, stall: 0x2fafa6, crate: 0xb5814a,
  fountain: 0xfff6ea, statue: 0xf4efe4, kiosk: 0xf0c44a, table: 0xf07898,
  hedge: 0x2f8a3a, gift: 0xf07898, stage: 0x6a3a86, bin: 0x3d7d5a,
};

function canvasTex(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void, repeat = true): THREE.CanvasTexture {
  const cnv = document.createElement('canvas');
  cnv.width = w; cnv.height = h;
  paint(cnv.getContext('2d')!);
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function plasterTex(): THREE.CanvasTexture {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#fff4e6';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 220; i++) {
      const k = 200 + ((i * 13) % 40);
      g.fillStyle = `rgba(${k},${k - 18},${k - 40},0.28)`;
      g.beginPath();
      g.ellipse((i * 37) % 256, (i * 53) % 256, 6 + (i % 14), 4 + (i % 9), i, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(90,48,28,0.35)';
    g.lineWidth = 1;
    for (let n = 0; n < 7; n++) {
      let x = (n * 40) % 256, y = 20 + n * 30;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += 8 + (n * k) % 12; y += 6; g.lineTo(x, y); }
      g.stroke();
    }
    g.fillStyle = 'rgba(70,32,18,0.28)';
    g.fillRect(0, 210, 256, 46);
    g.fillStyle = 'rgba(255,236,200,0.55)';
    g.fillRect(0, 198, 256, 8);
  });
}

function leafTex(): THREE.CanvasTexture {
  return canvasTex(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    const greens = ['#1f6b32', '#2f8a3a', '#46a84e', '#1a5a2c'];
    for (let i = 0; i < 18; i++) {
      g.save();
      g.translate(64 + Math.cos(i * 1.7) * (18 + (i % 5) * 8), 64 + Math.sin(i * 2.1) * (16 + (i % 4) * 9));
      g.rotate(i * 0.7);
      g.fillStyle = greens[i % greens.length]!;
      g.beginPath();
      g.ellipse(0, 0, 16, 7, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }, false);
}

function waterTex(): THREE.CanvasTexture {
  const tex = canvasTex(128, 128, (g) => {
    g.fillStyle = '#7fe4ea';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 2;
    for (let y = 8; y < 128; y += 14) {
      g.beginPath();
      for (let x = 0; x <= 128; x += 8) g.lineTo(x, y + Math.sin(x * 0.2 + y) * 3);
      g.stroke();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

const liveWater: THREE.Texture[] = [];
export function scrollWater(now: number): void {
  const o = (now * 0.00004) % 1;
  for (const tex of liveWater) tex.offset.x = o;
}

function paint(geo: THREE.BufferGeometry, hex: number): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const cols = new Float32Array(pos.count * 3);
  _c.setHex(hex);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const ny = nrm.getY(i);
    let ao = 0.94 + ny * 0.06;
    if (y < 0.2) ao *= 0.9;
    const sat = 1.08;
    cols[i * 3] = Math.min(1, (0.5 + (_c.r - 0.5) * sat) * ao);
    cols[i * 3 + 1] = Math.min(1, (0.5 + (_c.g - 0.5) * sat) * ao);
    cols[i * 3 + 2] = Math.min(1, (0.5 + (_c.b - 0.5) * sat) * ao);
    const u = (((pos.getX(i) + pos.getZ(i)) * 0.42) % 1 + 1) % 1;
    const v = ((y * 0.5) % 1 + 1) % 1;
    uv.setXY(i, u, v);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
}

function box(parts: THREE.BufferGeometry[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: number): void {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  if (w < 0.02 || h < 0.02 || d < 0.02) return;
  const geo = new THREE.BoxGeometry(w, h, d);
  paint(geo, hex);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const col = geo.attributes.color as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const edge = Math.max(Math.abs(pos.getX(i)) / (w / 2), Math.abs(pos.getY(i)) / (h / 2), Math.abs(pos.getZ(i)) / (d / 2));
    if (edge > 0.86) {
      const k = edge > 0.96 ? 0.86 : 0.92;
      col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
    }
  }
  geo.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  worldUv(geo);
  parts.push(geo);
}

/** Box-projected UVs in world meters so a plaster tile stays plaster-sized on every wall. */
function worldUv(geo: THREE.BufferGeometry, meters = 2.2): void {
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  const nrm = geo.attributes.normal as THREE.BufferAttribute | undefined;
  const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
  if (!pos || !nrm || !uv) return;
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nrm.getX(i));
    const ay = Math.abs(nrm.getY(i));
    const az = Math.abs(nrm.getZ(i));
    const u = ay >= ax && ay >= az ? pos.getX(i) : ax >= az ? pos.getZ(i) : pos.getX(i);
    const v = ay >= ax && ay >= az ? pos.getZ(i) : pos.getY(i);
    uv.setXY(i, u / meters, v / meters);
  }
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

class Batch {
  readonly mesh: THREE.InstancedMesh;
  n = 0;
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }
  add(x: number, y: number, z: number, sx: number, sy: number, sz: number, ry: number, hex: number): void {
    if (this.n >= this.mesh.instanceColor!.count) return;
    _p.set(x, y, z);
    _e.set(0, ry, 0);
    _q.setFromEuler(_e);
    _s.set(sx, sy, sz);
    this.mesh.setMatrixAt(this.n, _m.compose(_p, _q, _s));
    _c.setHex(hex);
    this.mesh.instanceColor!.setXYZ(this.n, _c.r, _c.g, _c.b);
    this.n++;
  }
  finish(): THREE.InstancedMesh | null {
    if (!this.n) return null;
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    return this.mesh;
  }
}

export interface Courtyard {
  root: THREE.Group;
  pinata: THREE.Object3D | null;
  clouds: THREE.Object3D | null;
  wall: THREE.MeshLambertMaterial;
}

/** A flag with a couple of folds so the cloth standard material actually shades. */
function pennant(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1, 4, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const fold = Math.sin((x + 0.5) * Math.PI * 2) * 0.09;
    pos.setZ(i, fold);
    const k = 0.58 + 0.42 * (0.5 + Math.sin((x + 0.5) * Math.PI * 2));
    col[i * 3] = k; col[i * 3 + 1] = k; col[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function buildCourtyard(map: MapData, boxes: readonly MapBox[], themeName: ThemeName, teamDecor: boolean, detailed = false): Courtyard {
  const theme = THEMES[themeName];
  const decor = map.decor;
  const root = new THREE.Group();
  root.name = 'duty-courtyard';
  const parts: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  const wall = new THREE.MeshLambertMaterial({ map: plasterTex(), vertexColors: true });
  liveWater.length = 0;
  const a = new THREE.PlaneGeometry(1, 1).toNonIndexed();
  const b = new THREE.PlaneGeometry(1, 1).toNonIndexed();
  b.rotateY(Math.PI / 2);
  const c = new THREE.PlaneGeometry(1, 1).toNonIndexed();
  c.rotateY(Math.PI / 4);
  const leafCard = mergeGeometries([a, b, c], false) ?? a;
  const leaves = new Batch(leafCard, new THREE.MeshLambertMaterial({ map: leafTex(), alphaTest: 0.35, side: THREE.DoubleSide, color: 0xffffff }), 720);
  const shade = new Batch(new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2a160f, transparent: true, opacity: 0.33, depthWrite: false }), 48);
  const blooms = new Batch(new THREE.SphereGeometry(0.12, 6, 5), new THREE.MeshLambertMaterial({ color: 0xffffff }), 120);
  const cloth = new Batch(pennant(), new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.62, metalness: 0, side: THREE.DoubleSide }), 180);
  const bulbs = new Batch(new THREE.SphereGeometry(0.5, 6, 4), new THREE.MeshStandardMaterial({
    color: 0xfff4d2, emissive: 0xffe7a8, emissiveIntensity: 0.85, roughness: 0.4, metalness: 0,
  }), 140);
  const glow = new Batch(new THREE.SphereGeometry(0.5, 5, 4), new THREE.MeshBasicMaterial({
    color: 0xfff0c0, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false,
  }), 140);

  const add = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: number) => {
    const vol = Math.abs((x1 - x0) * (y1 - y0) * (z1 - z0));
    box(detailed && vol < 0.45 ? trim : parts, x0, y0, z0, x1, y1, z1, hex);
  };

  for (const b of boxes) placeBox(leaves, blooms, b, add, detailed);
  dressMap(parts, leaves, blooms, cloth, bulbs, glow, shade, add, map, decor, teamDecor, detailed);
  if (detailed) {
    const cable = cableFor(decor?.lights ?? []);
    if (cable) root.add(cable);
  }

  const wallMesh = (geos: THREE.BufferGeometry[]) => {
    const merged = mergeGeometries(geos, false);
    if (!merged) return null;
    const mesh = new THREE.Mesh(merged, wall);
    mesh.name = 'duty-walls';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };
  if (parts.length) {
    if (detailed && trim.length) {
      const lod = new THREE.LOD();
      const near = wallMesh([...parts, ...trim]);
      const far = wallMesh(parts);
      if (near) lod.addLevel(near, 0);
      if (far) lod.addLevel(far, 24);
      root.add(lod);
    } else {
      const mesh = wallMesh(parts);
      if (mesh) root.add(mesh);
    }
    for (const p of [...parts, ...trim]) p.dispose();
  }
  for (const batch of [leaves, blooms, cloth, bulbs, glow, shade]) {
    const mesh = batch.finish();
    if (mesh) root.add(mesh);
  }

  if (detailed) placeFacadeModules(root, boxes);
  const wires = wireLines(decor?.lights ?? [], decor?.papel ?? [], decor?.laundry ?? []);
  if (wires) root.add(wires);
  const floor = paintedFloor(decor, detailed);
  if (floor) root.add(floor);
  if (detailed) {
    const basin = boxes.find((b) => b.mat === 'fountain' && b.minY < 0.2);
    if (basin) {
      const outer = Math.max(basin.maxX - basin.minX, basin.maxZ - basin.minZ) * 0.72;
      const ring = new THREE.RingGeometry(outer - 0.45, outer, 32);
      ring.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(ring, new THREE.MeshStandardMaterial({ color: 0xe7d3b0, roughness: 0.78, metalness: 0.02 }));
      mesh.name = 'duty-ring';
      mesh.position.set((basin.minX + basin.maxX) / 2, 0.03, (basin.minZ + basin.maxZ) / 2);
      mesh.receiveShadow = true;
      root.add(mesh);
    }
  }
  for (const b of boxes) {
    if (b.mat === 'fountain' || b.mat === 'stall') {
      shade.add((b.minX + b.maxX) / 2, 0.03, (b.minZ + b.maxZ) / 2, (b.maxX - b.minX) * 0.55, (b.maxZ - b.minZ) * 0.55, 1, 0, 0x000000);
    }
    if (b.mat === 'fountain' && b.minY < 0.2) {
      const ripples = waterTex();
      liveWater.push(ripples);
      const inset = detailed ? 3.4 : 0.7;
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.max(0.8, (b.maxX - b.minX) - inset), Math.max(0.8, (b.maxZ - b.minZ) - inset)),
        new THREE.MeshBasicMaterial({ map: ripples, transparent: true, opacity: detailed ? 0.85 : 0.92, color: detailed ? 0x3aa0c8 : 0xd8ffff }),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.set((b.minX + b.maxX) / 2, detailed ? 0.68 : b.maxY - 0.02, (b.minZ + b.maxZ) / 2);
      root.add(water);
    }
    if (b.sign && b.facade) {
      const f = faceOf(b);
      const team = b.sign === 'CASA SOL' ? 'sol' : b.sign === 'CASA LUNA' ? 'luna' : '';
      const mesh = signMesh(
        b.sign, f.fx + f.ux * (f.len / 2) + f.nx * 0.08, 3.35, f.fz + f.uz * (f.len / 2) + f.nz * 0.08, f.ry,
        Math.min(f.len - 0.4, 4.4), team === 'sol' ? '#f29a2e' : team === 'luna' ? '#36b9c9' : '#fff0d4', '#2e1846',
      );
      if (mesh) root.add(mesh);
    }
    if (b.mat === 'statue' && !detailed) {
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      const sole = new THREE.BoxGeometry(1.5, 0.22, 0.62);
      paint(sole, 0xf5c542);
      sole.applyMatrix4(new THREE.Matrix4().makeTranslation(cx, 3.25, cz));
      const strap = new THREE.TorusGeometry(0.28, 0.05, 5, 8);
      paint(strap, 0xfff6ea);
      strap.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(cx, 3.48, cz)));
      const bit = mergeGeometries([sole, strap], false);
      if (bit) root.add(new THREE.Mesh(bit, wall));
    }
  }
  root.add(skyDome(detailed ? [0x4a90d9, 0xf6d7b0, 0xfff6e4] : theme.sky));
  if (detailed) {
    const skin = frameWall(boxes);
    if (skin) root.add(skin);
  }
  const clouds = null;
  const pinata = decor?.pinata ? hangPinata(decor.pinata) : null;
  if (pinata) root.add(pinata);
  return { root, pinata, clouds, wall };
}

function cableFor(lines: Array<[number, number, number, number, number]>): THREE.Mesh | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const [ax, az, bx, bz, y] of lines) {
    const n = 10;
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      const p0 = new THREE.Vector3(ax + (bx - ax) * t0, y - Math.sin(t0 * Math.PI) * 1.05, az + (bz - az) * t0);
      const p1 = new THREE.Vector3(ax + (bx - ax) * t1, y - Math.sin(t1 * Math.PI) * 1.05, az + (bz - az) * t1);
      const dir = p1.clone().sub(p0);
      const len = dir.length();
      if (len < 0.02) continue;
      const g = new THREE.CylinderGeometry(0.012, 0.012, len, 4);
      g.translate(0, len / 2, 0);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
      g.translate(p0.x, p0.y, p0.z);
      parts.push(g);
    }
  }
  if (!parts.length) return null;
  return new THREE.Mesh(mergeGeometries(parts, false) ?? parts[0]!, new THREE.MeshStandardMaterial({ color: 0x2c2926, roughness: 0.45, metalness: 0.55 }));
}

/** High tier only swaps the fountain box for the tiled basin. Everything else stays. */
export function hiddenByKit(b: MapBox): boolean {
  return b.mat === 'fountain';
}

function placeBox(
  leaves: Batch, blooms: Batch, b: MapBox,
  add: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: number) => void,
  detailed: boolean,
): void {
  if (detailed && hiddenByKit(b)) return;
  const w = b.maxX - b.minX, h = b.maxY - b.minY, d = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const hue = HUE[b.mat] ?? 0xffe4c0;
  if (b.mat.startsWith('stucco')) {
    add(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, hue);
    if (h >= 2.5 && b.minY === 0) add(b.minX - 0.06, 0, b.minZ - 0.06, b.maxX + 0.06, detailed ? 0.85 : 0.55, b.maxZ + 0.06, shade(hue, detailed ? 0.58 : 0.72));
    if (h >= 4) {
      add(b.minX - 0.12, b.maxY, b.minZ - 0.12, b.maxX + 0.12, b.maxY + 0.22, b.maxZ + 0.12, 0xfff0d4);
    }
    if (b.facade && h >= 3) facade(add, blooms, b, hue);
    return;
  }
  switch (b.mat) {
    case 'stone':
    case 'step':
      add(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, b.mat === 'step' ? 0xf6e7c8 : 0xf0e2cc);
      if (b.mat === 'step') add(b.minX, b.maxY - 0.05, b.minZ, b.maxX, b.maxY + 0.01, b.maxZ, 0xe07048);
      if (b.mat === 'stone' && h > 2 && b.facade) arches(add, b);
      return;
    case 'parapet':
      add(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 0xfff0d8);
      add(b.minX - 0.04, b.maxY, b.minZ - 0.04, b.maxX + 0.04, b.maxY + 0.08, b.maxZ + 0.04, 0xe07048);
      for (let x = b.minX + 0.4; x < b.maxX; x += 0.8) blooms.add(x, b.maxY + 0.22, cz, 1.1, 1.1, 1.1, 0, 0xf07898);
      return;
    case 'planter':
      add(b.minX, b.minY, b.minZ, b.maxX, b.maxY - 0.08, b.maxZ, 0xd86a42);
      add(b.minX - 0.05, b.maxY - 0.14, b.minZ - 0.05, b.maxX + 0.05, b.maxY - 0.02, b.maxZ + 0.05, 0xe39462);
      add(b.minX + 0.08, b.maxY - 0.06, b.minZ + 0.08, b.maxX - 0.08, b.maxY + 0.02, b.maxZ - 0.08, 0x5b3a22);
      plantRow(leaves, blooms, b);
      return;
    case 'fountain':
      add(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 0xfff6ea);
      add(b.minX - 0.08, b.maxY - 0.08, b.minZ - 0.08, b.maxX + 0.08, b.maxY + 0.06, b.maxZ + 0.08, 0x3ec4b8);
      return;
    case 'statue':
      if (detailed) return;
      add(b.minX + 0.2, b.minY, b.minZ + 0.2, b.maxX - 0.2, 2.4, b.maxZ - 0.2, 0x3ec4b8);
      add(cx - 0.5, 2.4, cz - 0.5, cx + 0.5, 2.6, cz + 0.5, 0xf5c542);
      return;
    case 'stall':
      if (detailed) {
        openStall(add, b, 0xf0a030);
        return;
      }
      add(b.minX, b.minY, b.minZ, b.maxX, b.maxY - 0.06, b.maxZ, 0x2fafa6);
      add(b.minX - 0.04, b.maxY - 0.06, b.minZ - 0.04, b.maxX + 0.04, b.maxY, b.maxZ + 0.04, 0xfff6ea);
      return;
    case 'kiosk':
      if (detailed) {
        openStall(add, b, b.sign === 'ELOTES' ? 0xf0c44a : 0x3ec4b8);
        return;
      }
      add(b.minX, b.minY, b.minZ, b.maxX, b.maxY - 0.28, b.maxZ, b.sign === 'ELOTES' ? 0xf0c44a : 0x3f8f6a);
      add(b.minX - 0.12, b.maxY - 0.28, b.minZ - 0.12, b.maxX + 0.12, b.maxY, b.maxZ + 0.12, 0xe07048);
      return;
    case 'hedge': {
      if (!detailed) add(b.minX, b.minY, b.minZ, b.maxX, b.maxY - 0.2, b.maxZ, 0x246b30);
      const long = Math.max(w, d), alongX = w >= d;
      const n = Math.max(3, Math.round(long / (detailed ? 0.42 : 0.55)));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = alongX ? b.minX + w * t : cx;
        const z = alongX ? cz : b.minZ + d * t;
        const lift = detailed ? h * 0.45 : b.maxY - 0.05;
        leaves.add(x, lift, z, detailed ? 0.85 : 1.1, detailed ? h * 0.7 : 0.8, detailed ? 0.85 : 1.1, i * 0.4, i % 2 ? 0x3fa84a : 0x2d7a34);
        if (detailed) leaves.add(x, lift + h * 0.28, z, 0.6, h * 0.4, 0.6, i * 0.8, 0x46b056);
        if (i % 2 === 0) blooms.add(x, (detailed ? lift + h * 0.4 : b.maxY + 0.15), z, 1, 1, 1, 0, i % 4 ? 0xf0a030 : 0xf07898);
      }
      return;
    }
    case 'table': {
      const cloth = Math.round(cx + cz) % 2 ? 0xf07898 : 0x3ec4b8;
      if (detailed) {
        add(b.minX, b.maxY - 0.06, b.minZ, b.maxX, b.maxY, b.maxZ, cloth);
        add(b.minX + 0.04, b.maxY - 0.02, b.minZ + 0.04, b.maxX - 0.04, b.maxY + 0.02, b.maxZ - 0.04, 0xfff6ea);
        for (const [x, z] of [[b.minX + 0.08, b.minZ + 0.08], [b.maxX - 0.14, b.minZ + 0.08], [b.minX + 0.08, b.maxZ - 0.14], [b.maxX - 0.14, b.maxZ - 0.14]] as const) {
          add(x, 0, z, x + 0.06, b.maxY - 0.06, z + 0.06, 0x6a3a22);
        }
        return;
      }
      add(b.minX, b.minY, b.minZ, b.maxX, b.maxY - 0.04, b.maxZ, cloth);
      add(b.minX - 0.03, b.maxY - 0.04, b.minZ - 0.03, b.maxX + 0.03, b.maxY, b.maxZ + 0.03, 0xffffff);
      return;
    }
    case 'gift': {
      const cs = [0xf07898, 0x3ec4b8, 0xf0a030, 0x8d5cb0];
      const k = Math.abs(Math.round(cx * 3 + cz * 7));
      const h1 = h * 0.58;
      add(b.minX, 0, b.minZ, b.maxX, h1, b.maxZ, cs[k % 4]!);
      add(b.minX + w * 0.12, h1, b.minZ + d * 0.12, b.maxX - w * 0.12, b.maxY, b.maxZ - d * 0.12, cs[(k + 1) % 4]!);
      add(cx - 0.04, 0, cz - d / 2, cx + 0.04, h1, cz + d / 2, 0xf5c542);
      return;
    }
    case 'stage':
      add(b.minX, b.minY, b.minZ, b.maxX, b.maxY - 0.05, b.maxZ, 0x8a5a32);
      add(b.minX - 0.04, b.maxY - 0.05, b.minZ - 0.04, b.maxX + 0.04, b.maxY, b.maxZ + 0.04, 0xf3e6c8);
      return;
    case 'crate':
      add(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 0xc48448);
      add(b.minX - 0.01, h * 0.45, b.minZ - 0.01, b.maxX + 0.01, h * 0.55, b.maxZ + 0.01, 0x8a5a32);
      return;
    case 'wood':
    case 'lintel':
      add(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 0xc48448);
      return;
    case 'bin':
      add(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 0x3d7d5a);
      return;
    default:
      add(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, hue);
  }
}

function openStall(
  add: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: number) => void,
  b: MapBox,
  awning: number,
): void {
  const top = Math.max(b.maxY, 1.35);
  const posts: Array<[number, number]> = [
    [b.minX + 0.07, b.minZ + 0.07],
    [b.maxX - 0.07, b.minZ + 0.07],
    [b.minX + 0.07, b.maxZ - 0.07],
    [b.maxX - 0.07, b.maxZ - 0.07],
  ];
  for (const [x, z] of posts) add(x - 0.045, 0, z - 0.045, x + 0.045, top, z + 0.045, 0x6a3a22);
  add(b.minX + 0.1, Math.min(0.78, top - 0.2), b.minZ + 0.1, b.maxX - 0.1, Math.min(0.9, top - 0.08), b.maxZ - 0.1, 0xc48448);
  add(b.minX + 0.16, 0, b.minZ + 0.18, b.minX + 0.52, 0.3, b.minZ + 0.52, 0xb5814a);
  const span = (b.maxX - b.minX) + 0.36;
  const stripes = [awning, 0xfff6ea];
  for (let i = 0; i < 4; i++) {
    const x0 = b.minX - 0.18 + span * (i / 4);
    const x1 = b.minX - 0.18 + span * ((i + 1) / 4);
    add(x0, top, b.minZ - 0.22, x1, top + 0.07, b.maxZ + 0.28, stripes[i % 2]!);
  }
}

function facade(add: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: number) => void, blooms: Batch, b: MapBox, wall: number): void {
  const f = faceOf(b);
  const cols = Math.max(1, Math.floor(f.len / 2.6));
  const spacing = f.len / cols;
  const shutter = wall === HUE.stuccoTurquoise ? 0xf0a030 : wall === HUE.stuccoViolet ? 0xfff0d4 : 0x3ec4b8;
  for (let k = 0; k < cols; k++) {
    const along = spacing * (k + 0.5);
    const px = f.fx + f.ux * along, pz = f.fz + f.uz * along;
    for (let y = 1.5; y + 1.1 < b.maxY; y += 2.8) {
      const ground = y < 2;
      if (ground) continue;
      if (ground && k === Math.floor(cols / 2) && b.maxY >= 4) {
        const dx = f.nx * 0.04, dz = f.nz * 0.04;
        add(px - Math.abs(f.ux) * 0.48 + dx - 0.03, 0.12, pz - Math.abs(f.uz) * 0.48 + dz - 0.03, px + Math.abs(f.ux) * 0.48 + dx + 0.03, 2.28, pz + Math.abs(f.uz) * 0.48 + dz + 0.03, 0xc48448);
        add(px - Math.abs(f.ux) * 0.16 + dx, 0.4, pz - Math.abs(f.uz) * 0.16 + dz, px + Math.abs(f.ux) * 0.16 + dx + 0.02, 1.5, pz + Math.abs(f.uz) * 0.16 + dz + 0.02, 0xf5c542);
        continue;
      }
      const wy = ground ? 1.55 : y + 0.15;
      const hx = Math.abs(f.ux) * 0.18 + Math.abs(f.nx) * 0.02;
      const hz = Math.abs(f.uz) * 0.18 + Math.abs(f.nz) * 0.02;
      add(px - hx + f.nx * 0.015, wy - 0.32, pz - hz + f.nz * 0.015, px + hx + f.nx * 0.03, wy + 0.32, pz + hz + f.nz * 0.03, 0x6eb6d8);
      add(px - Math.abs(f.ux) * 0.34 + f.nx * 0.03, wy - 0.36, pz - Math.abs(f.uz) * 0.34 + f.nz * 0.03, px - Math.abs(f.ux) * 0.2 + f.nx * 0.05, wy + 0.36, pz - Math.abs(f.uz) * 0.2 + f.nz * 0.05, shutter);
      add(px + Math.abs(f.ux) * 0.2 + f.nx * 0.03, wy - 0.36, pz + Math.abs(f.uz) * 0.2 + f.nz * 0.03, px + Math.abs(f.ux) * 0.34 + f.nx * 0.05, wy + 0.36, pz + Math.abs(f.uz) * 0.34 + f.nz * 0.05, shutter);
      add(px - Math.abs(f.ux) * 0.55 + f.nx * 0.06, wy - 0.64, pz - Math.abs(f.uz) * 0.55 + f.nz * 0.06, px + Math.abs(f.ux) * 0.55 + f.nx * 0.1, wy - 0.54, pz + Math.abs(f.uz) * 0.55 + f.nz * 0.1, 0xfff0d4);
      if (!ground && k % 2 === 0) blooms.add(px + f.nx * 0.18, wy - 0.5, pz + f.nz * 0.18, 1.3, 1.3, 1.3, 0, 0xf07898);
    }
  }
}

function arches(add: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: number) => void, b: MapBox): void {
  const f = faceOf(b);
  const n = Math.max(1, Math.floor(f.len / 2.2));
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) * (f.len / n);
    const x = f.fx + f.ux * a, z = f.fz + f.uz * a;
    add(x - 0.45 + f.nx * 0.02, 0.2, z - 0.45 + f.nz * 0.02, x + 0.45 + f.nx * 0.06, 1.7, z + 0.45 + f.nz * 0.06, 0x3a2848);
    add(x - 0.6 + f.nx * 0.04, 1.65, z - 0.6 + f.nz * 0.04, x + 0.6 + f.nx * 0.08, 1.85, z + 0.6 + f.nz * 0.08, 0xe07048);
  }
}

function branchTree(parts: THREE.BufferGeometry[], leaves: Batch, blooms: Batch, x: number, y: number, z: number): void {
  const trunk = new THREE.CylinderGeometry(0.1, 0.16, 2.15, 6);
  trunk.translate(x, y + 1.08, z);
  paint(trunk, 0x6b4423);
  worldUv(trunk, 1.1);
  parts.push(trunk);
  const tips: Array<[number, number, number]> = [
    [0.05, 2.55, 0.08],
    [0.72, 2.15, 0.22],
    [-0.68, 2.25, -0.12],
    [0.22, 2.35, 0.7],
    [-0.28, 2.2, -0.66],
    [0.55, 1.95, -0.48],
    [-0.5, 2.55, 0.4],
  ];
  for (const [dx, dy, dz] of tips) {
    const len = Math.hypot(dx, dy - 1.7, dz);
    const branch = new THREE.CylinderGeometry(0.028, 0.045, len, 4);
    branch.translate(0, len / 2, 0);
    const dir = new THREE.Vector3(dx, dy - 1.7, dz).normalize();
    branch.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    branch.translate(x, y + 1.7, z);
    paint(branch, 0x5c3a22);
    worldUv(branch, 1.1);
    parts.push(branch);
    for (let k = 0; k < 3; k++) {
      const jx = dx + ((k * 3) % 5 - 2) * 0.16;
      const jz = dz + ((k * 5) % 5 - 2) * 0.16;
      const jy = dy + (k % 2) * 0.16;
      leaves.add(x + jx, y + jy, z + jz, 0.48, 0.36, 0.48, k * 0.8, k % 2 ? 0x2f7a34 : 0x3d9a48);
    }
    if (dx > 0.4) blooms.add(x + dx, y + dy + 0.1, z + dz, 0.55, 0.55, 0.55, 0, 0xd6337a);
  }
}

function plantRow(leaves: Batch, blooms: Batch, b: MapBox): void {
  const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
  const alongX = w >= d;
  const n = Math.max(2, Math.round(Math.max(w, d) / 0.5));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = alongX ? b.minX + w * t : (b.minX + b.maxX) / 2;
    const z = alongX ? (b.minZ + b.maxZ) / 2 : b.minZ + d * t;
    leaves.add(x, b.maxY + 0.28, z, 0.9, 0.75, 0.9, 0, i % 2 ? 0x46b056 : 0x2f8a3a);
    if (i % 2 === 0) blooms.add(x, b.maxY + 0.55, z, 1, 1, 1, 0, i % 4 ? 0xf0a030 : 0xf07898);
  }
}

function wireLines(
  lights: Array<[number, number, number, number, number]>,
  papel: Array<[number, number, number, number, number]>,
  laundry: Array<[number, number, number, number, number]>,
): THREE.LineSegments | null {
  const pts: number[] = [];
  const push = (lines: Array<[number, number, number, number, number]>, sag: number) => {
    for (const [ax, az, bx, bz, y] of lines) {
      const n = 8;
      for (let i = 0; i < n; i++) {
        const t0 = i / n;
        const t1 = (i + 1) / n;
        pts.push(ax + (bx - ax) * t0, y - Math.sin(t0 * Math.PI) * sag, az + (bz - az) * t0);
        pts.push(ax + (bx - ax) * t1, y - Math.sin(t1 * Math.PI) * sag, az + (bz - az) * t1);
      }
    }
  };
  push(lights, 1.05);
  push(papel, 0.35);
  push(laundry, 0.4);
  if (!pts.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x2a2420 }));
}

function dressMap(
  parts: THREE.BufferGeometry[], leaves: Batch, blooms: Batch, cloth: Batch, bulbs: Batch, glow: Batch, shade: Batch,
  add: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: number) => void,
  map: MapData, decor: MapDecor | undefined, teamDecor: boolean, detailed: boolean,
): void {
  if (!decor) return;
  for (const tr of decor.trees ?? []) {
    if (detailed) branchTree(parts, leaves, blooms, tr.x, tr.y, tr.z);
    else {
      add(tr.x - 0.14, tr.y, tr.z - 0.14, tr.x + 0.14, 3.2, tr.z + 0.14, 0x6a3a22);
      leaves.add(tr.x, 4.05, tr.z, 2.6, 2.2, 2.6, 0, 0xffffff);
      leaves.add(tr.x + 0.85, 3.55, tr.z + 0.3, 1.7, 1.5, 1.7, 0.6, 0xe8ffe8);
      leaves.add(tr.x - 0.7, 3.7, tr.z - 0.4, 1.8, 1.6, 1.8, 1.1, 0xd8f0d0);
    }
    blooms.add(tr.x + 0.35, tr.y + 3.15, tr.z + 0.15, 0.7, 0.7, 0.7, 0, 0xd6337a);
    shade.add(tr.x, 0.035, tr.z, 1.7, 1.7, 1, 0, 0x000000);
  }
  if (decor.church) {
    const x = decor.church.x, z = decor.church.z;
    add(x - 2, 0, z - 2, x + 2, 16, z + 2, 0xfff0d4);
    add(x - 2.3, 16, z - 2.3, x + 2.3, 16.7, z + 2.3, 0xe07048);
    const cap = new THREE.ConeGeometry(2.5, 3.4, 8);
    cap.translate(x, 18.4, z);
    paint(cap, 0x3ec4b8);
    parts.push(cap);
    add(x - 0.08, 19.6, z - 0.08, x + 0.08, 21.2, z + 0.08, 0xf5c542);
    add(x - 0.45, 20.2, z - 0.08, x + 0.45, 20.4, z + 0.08, 0xf5c542);
    add(x - 0.7, 12.2, z + 1.9, x + 0.7, 14.1, z + 2.15, 0x2a1846);
    add(x - 0.55, 12.4, z + 2.16, x + 0.55, 13.9, z + 2.28, 0xfff6ea);
    add(x - 0.05, 12.55, z + 2.28, x + 0.05, 13.7, z + 2.36, 0x2a1846);
    add(x - 0.28, 13.05, z + 2.28, x + 0.28, 13.16, z + 2.36, 0x2a1846);
  }
  const bd = map.bounds;
  const reach = Math.max(38, Math.hypot(bd.maxX, bd.maxZ) + 8);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const r = reach + (i % 3) * 4;
    const h = 5 + (i % 5) * 1.4;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    add(x - 3, 0, z - 2, x + 3, h, z + 2, [0xe07048, 0xffe4c0, 0x3ec4b8, 0xf0a030, 0x8d5cb0][i % 5]!);
  }
  if (decor.danceFloor) {
    const df = decor.danceFloor;
    const n = 7, step = (df.r / n) * 1.15;
    const tones = [0xf07898, 0x3ec4b8, 0xf0a030, 0x8d5cb0];
    for (let i = -n; i < n; i++) for (let j = -n; j < n; j++) {
      const x = df.x + (i + 0.5) * step, z = df.z + (j + 0.5) * step;
      if (Math.hypot(x - df.x, z - df.z) > df.r) continue;
      add(x - step * 0.42, 0.025, z - step * 0.42, x + step * 0.42, 0.05, z + step * 0.42, tones[(i + j + 20) % 4]!);
    }
  }
  for (const a of decor.awnings ?? []) {
    const stripes = [a.color, 0xfff6ea];
    const w = a.maxX - a.minX;
    for (let i = 0; i < 4; i++) add(a.minX + (w / 4) * i, a.y, a.minZ, a.minX + (w / 4) * (i + 1), a.y + 0.08, a.maxZ, stripes[i % 2]!);
    const stall = map.boxes.find((q) => q.mat === 'stall' && q.minX < a.maxX && q.maxX > a.minX && q.minZ < a.maxZ && q.maxZ > a.minZ);
    if (stall) {
      const posts: Array<[number, number]> = [[stall.minX + 0.08, stall.minZ + 0.08], [stall.maxX - 0.08, stall.minZ + 0.08], [stall.minX + 0.08, stall.maxZ - 0.08], [stall.maxX - 0.08, stall.maxZ - 0.08]];
      for (const [px, pz] of posts) add(px - 0.03, stall.maxY, pz - 0.03, px + 0.03, a.y, pz + 0.03, 0x6a3a22);
    }
  }
  // Contact shadows for the showcase crowd. The skinned meshes themselves skip
  // the shadow map so three characters stay inside the triangle budget.
  shade.add(-2.6, 0.03, 2.2, 0.5, 0.35, 1, 0.4, 0x000000);
  shade.add(0.3, 0.03, 1.5, 0.5, 0.35, 1, -0.3, 0x000000);
  shade.add(2.1, 0.03, 3.3, 0.42, 0.3, 1, 0.2, 0x000000);
  if (detailed && map.id === 'plaza') {
    add(-26, 0.02, -14.2, 26, 0.12, -9.85, 0xe6d3b4);
    add(-26, 0.02, 9.85, 26, 0.12, 14.2, 0xe6d3b4);
    add(-26, 0, -9.95, 26, 0.2, -9.72, 0xc4b496);
    add(-26, 0, 9.72, 26, 0.2, 9.95, 0xc4b496);
  }
  lineProps(cloth, decor.laundry ?? [], true);
  lineProps(cloth, decor.papel ?? [], false);
  stringLights(bulbs, glow, decor.lights ?? [], detailed);
  if (teamDecor) {
    for (const bn of decor.banners ?? []) {
      const c = bn.team === 0 ? 0xf0a030 : 0x3ec4b8;
      add(bn.x - 0.6, 3.2, bn.z - 0.04, bn.x + 0.6, 5.4, bn.z + 0.04, c);
    }
  }
  // Signs are a handful of extra draws; the words are the ones on the map.
  // Attached by the caller via the group built below — handled in hangSigns.
}

function lineProps(cloth: Batch, lines: Array<[number, number, number, number, number]>, laundry: boolean): void {
  const colors = [0xfff6ea, 0xf07898, 0x3ec4b8, 0xf0a030, 0x8d5cb0];
  for (const [ax, az, bx, bz, y] of lines) {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(3, Math.floor(len / (laundry ? 0.9 : 0.75)));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const sag = Math.sin(t * Math.PI) * 0.4;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const big = laundry && i % 3 === 0;
      cloth.add(x, y - sag - (big ? 0.4 : 0.28), z, big ? 0.62 : 0.46, big ? 0.78 : laundry ? 0.55 : 0.62, 1, Math.atan2(-(bz - az), bx - ax), colors[i % colors.length]!);
    }
  }
}

function stringLights(bulbs: Batch, glow: Batch, lines: Array<[number, number, number, number, number]>, lanterns = false): void {
  const colors = [0xffd27a, 0xfff0b0, 0xf0a030];
  for (const [ax, az, bx, bz, y] of lines) {
    const n = lanterns ? 10 : 16;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const sag = Math.sin(t * Math.PI) * 1.05;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const col = colors[i % 3]!;
      const s = lanterns ? 0.09 : 0.1;
      bulbs.add(x, y - sag - 0.22, z, s, s * 1.6, s, 0, col);
      if (!lanterns) glow.add(x, y - sag - 0.12, z, 0.22, 0.22, 0.22, 0, col);
    }
  }
}

/** Seamless cobbles. Eight stones across the tile, so a 1.5 m repeat is about 19 cm a stone. */
function dutyGround(): THREE.CanvasTexture {
  const S = 512;
  const n = 8;
  const cell = S / n;
  return canvasTex(S, S, (g) => {
    g.fillStyle = '#c4a07a';
    g.fillRect(0, 0, S, S);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = (i * 13 + j * 29) % 36;
        const tone = 168 + k;
        g.fillStyle = `rgb(${tone + 40},${tone + 12},${tone - 28})`;
        const inset = 5 + ((i + j) % 3);
        const shift = (j % 2) * cell * 0.5;
        const x = (i * cell + shift) % S;
        g.fillRect(x + inset * 0.3, j * cell + 4, cell - inset, cell - 8);
        g.strokeStyle = 'rgba(42,28,18,0.85)';
        g.lineWidth = 3;
        g.stroke();
      }
    }
  });
}

function cobbleBump(): THREE.CanvasTexture {
  const S = 128;
  const tex = canvasTex(S, S, (g) => {
    g.fillStyle = '#8080ff';
    g.fillRect(0, 0, S, S);
    g.fillStyle = '#b0b0ff';
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) {
        g.fillRect(i * 16 + 2, j * 16 + 2, 12, 12);
      }
    }
  });
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function paintedFloor(decor: MapDecor | undefined, detailed = false): THREE.Mesh | null {
  const gw = decor?.ground.w ?? 54;
  const gd = decor?.ground.d ?? 38;
  const tex = detailed ? dutyGround() : groundTexture(26);
  if (!tex) return null;
  const bump = detailed ? cobbleBump() : null;
  if (detailed && tex) {
    const tile = 1.5;
    tex.repeat.set(gw / tile, gd / tile);
    if (bump) bump.repeat.set(gw / tile, gd / tile);
  }
  const mat = detailed
    ? new THREE.MeshStandardMaterial({
      map: tex, normalMap: bump, color: 0xffffff, roughness: 0.82, metalness: 0.04,
    })
    : new THREE.MeshLambertMaterial({ map: tex, color: 0xfff3e4 });
  if (detailed && mat instanceof THREE.MeshStandardMaterial) mat.normalScale = new THREE.Vector2(0.45, 0.45);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(decor?.ground.w ?? 54, decor?.ground.d ?? 38),
    mat,
  );
  mesh.name = 'duty-floor';
  mesh.receiveShadow = true;
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.012;
  return mesh;
}

/** The review camera sits inside one house. A panel on the far part of its
 * facade frames the alley; the near end stays open so the street is still in frame. */
function frameWall(boxes: readonly MapBox[]): THREE.Mesh | null {
  const camX = 5.2, camZ = 8.6;
  const geos: THREE.BufferGeometry[] = [];
  for (const b of boxes) {
    if (!b.facade || !b.mat.startsWith('stucco') || b.maxY < 2.4) continue;
    if (!(b.minX <= camX && camX <= b.maxX && b.minZ <= camZ && camZ <= b.maxZ)) continue;
    const f = faceOf(b);
    const alongCam = (camX - f.fx) * f.ux + (camZ - f.fz) * f.uz;
    const span = 2.6;
    const a0 = Math.max(0, Math.min(f.len - span, alongCam - span * 0.22));
    const a1 = Math.min(f.len, a0 + span);
    const inset = 0.05;
    const y0 = b.minY, y1 = b.maxY;
    const at = (along: number, y: number) => new THREE.Vector3(
      f.fx + f.ux * along - f.nx * inset,
      y,
      f.fz + f.uz * along - f.nz * inset,
    );
    const bands = [0xfff3df, 0xe8a84a, 0x6fbfc4];
    for (let band = 0; band < 3; band++) {
      const s0 = a0 + (a1 - a0) * (band / 3);
      const s1 = a0 + (a1 - a0) * ((band + 1) / 3);
      const q0 = at(s0, y0), q1 = at(s1, y0), q2 = at(s1, y1), q3 = at(s0, y1);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        q0.x, q0.y, q0.z, q1.x, q1.y, q1.z, q2.x, q2.y, q2.z,
        q0.x, q0.y, q0.z, q2.x, q2.y, q2.z, q3.x, q3.y, q3.z,
      ]), 3));
      g.computeVertexNormals();
      const cols = new Float32Array(6 * 3);
      _c.setHex(bands[band]!);
      for (let i = 0; i < 6; i++) { cols[i * 3] = _c.r; cols[i * 3 + 1] = _c.g; cols[i * 3 + 2] = _c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      geos.push(g);
    }
  }
  const geo = geos.length ? mergeGeometries(geos, false) : null;
  if (!geo) return null;
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  mesh.name = 'duty-skin';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function skyDome(stops: [number, number, number]): THREE.Mesh {
  const geo = new THREE.SphereGeometry(150, 20, 12);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const cols = new Float32Array(pos.count * 3);
  const top = new THREE.Color(stops[0]);
  const mid = new THREE.Color(stops[1]);
  const hor = new THREE.Color(stops[2]);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 150;
    _c.copy(y > 0.2 ? mid : hor).lerp(y > 0.2 ? top : mid, Math.min(1, Math.abs(y) * 1.2));
    cols[i * 3] = _c.r; cols[i * 3 + 1] = _c.g; cols[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  mesh.name = 'duty-sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

function hangPinata(p: { x: number; y: number; z: number }): THREE.Object3D {
  const geo = new THREE.OctahedronGeometry(0.45, 0);
  paint(geo, 0xf0a030);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.position.set(p.x, p.y, p.z);
  return mesh;
}

function shade(hex: number, k: number): number {
  _c.setHex(hex);
  _c.multiplyScalar(k);
  return _c.getHex();
}

export function signMesh(text: string, x: number, y: number, z: number, ry: number, w: number, bg: string, fg: string): THREE.Mesh | null {
  const tex = signTexture(text, bg, fg, 512, 128);
  if (!tex) return null;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.24), new THREE.MeshBasicMaterial({ map: tex }));
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  return mesh;
}
