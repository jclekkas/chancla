// Everything the original courtyard draws, rebuilt for Duty's fast path:
// one merged mesh for solids, a painted floor, and a few instanced batches
// for foliage, cloth, lights, and glow. Colors stay warm without a post pass.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapBox, MapData, MapDecor } from '../../shared/map';
import { groundTexture, signTexture } from '../../src/fps/render/materials';
import { THEMES, type ThemeName } from '../../src/fps/render/world';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

const HUE: Record<string, number> = {
  stuccoTerracotta: 0xe07048, stuccoCream: 0xffe4c0, stuccoTurquoise: 0x3ec4b8,
  stuccoMarigold: 0xf0a030, stuccoViolet: 0x8d5cb0, stuccoPink: 0xf07898,
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
    g.fillStyle = '#2f8a3a';
    for (let i = 0; i < 14; i++) {
      g.save();
      g.translate(20 + (i % 4) * 28, 16 + Math.floor(i / 4) * 30);
      g.rotate(i);
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
    let ao = 0.78 + ny * 0.22;
    if (y < 0.35) ao *= 0.78;
    else if (y < 1.05) ao *= 0.9;
    cols[i * 3] = Math.min(1, _c.r * ao * 1.06);
    cols[i * 3 + 1] = Math.min(1, _c.g * ao);
    cols[i * 3 + 2] = Math.min(1, _c.b * ao * 0.94);
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
      const k = edge > 0.96 ? 0.62 : 0.8;
      col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
    }
  }
  geo.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  parts.push(geo);
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

export function buildCourtyard(map: MapData, boxes: readonly MapBox[], themeName: ThemeName, teamDecor: boolean): Courtyard {
  const theme = THEMES[themeName];
  const decor = map.decor;
  const root = new THREE.Group();
  root.name = 'duty-courtyard';
  const parts: THREE.BufferGeometry[] = [];
  const wall = new THREE.MeshLambertMaterial({ map: plasterTex(), vertexColors: true });
  liveWater.length = 0;
  const a = new THREE.PlaneGeometry(1, 1).toNonIndexed();
  const b = new THREE.PlaneGeometry(1, 1).toNonIndexed();
  b.rotateY(Math.PI / 2);
  const c = new THREE.PlaneGeometry(1, 1).toNonIndexed();
  c.rotateY(Math.PI / 4);
  const leafCard = mergeGeometries([a, b, c], false) ?? a;
  const leaves = new Batch(leafCard, new THREE.MeshLambertMaterial({ map: leafTex(), alphaTest: 0.35, side: THREE.DoubleSide, color: 0xffffff }), 220);
  const shade = new Batch(new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2a160f, transparent: true, opacity: 0.33, depthWrite: false }), 48);
  const blooms = new Batch(new THREE.SphereGeometry(0.12, 6, 5), new THREE.MeshLambertMaterial({ color: 0xffffff }), 120);
  const cloth = new Batch(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), 180);
  const bulbs = new Batch(new THREE.SphereGeometry(0.5, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }), 140);
  const glow = new Batch(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }), 140);

  const add = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: number) => box(parts, x0, y0, z0, x1, y1, z1, hex);

  for (const b of boxes) placeBox(leaves, blooms, b, add);
  dressMap(parts, leaves, blooms, cloth, bulbs, glow, shade, add, map, decor, teamDecor);

  if (parts.length) {
    const merged = mergeGeometries(parts, false);
    if (merged) root.add(new THREE.Mesh(merged, wall));
    for (const p of parts) p.dispose();
  }
  for (const batch of [leaves, blooms, cloth, bulbs, glow, shade]) {
    const mesh = batch.finish();
    if (mesh) root.add(mesh);
  }

  const floor = paintedFloor(decor);
  if (floor) root.add(floor);
  for (const b of boxes) {
    if (b.mat === 'fountain' || b.mat === 'stall') {
      shade.add((b.minX + b.maxX) / 2, 0.03, (b.minZ + b.maxZ) / 2, (b.maxX - b.minX) * 0.55, (b.maxZ - b.minZ) * 0.55, 1, 0, 0x000000);
    }
    if (b.mat === 'fountain') {
      const ripples = waterTex();
      liveWater.push(ripples);
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry((b.maxX - b.minX) - 0.7, (b.maxZ - b.minZ) - 0.7),
        new THREE.MeshBasicMaterial({ map: ripples, transparent: true, opacity: 0.92, color: 0xd8ffff }),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.set((b.minX + b.maxX) / 2, b.maxY - 0.02, (b.minZ + b.maxZ) / 2);
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
    if (b.mat === 'statue') {
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
  root.add(skyDome(theme.sky));
  const clouds = null;
  const pinata = decor?.pinata ? hangPinata(decor.pinata) : null;
  if (pinata) root.add(pinata);
  return { root, pinata, clouds, wall };
}

function placeBox(
  leaves: Batch, blooms: Batch, b: MapBox,
  add: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: number) => void,
): void {
  const w = b.maxX - b.minX, h = b.maxY - b.minY, d = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const hue = HUE[b.mat] ?? 0xffe4c0;
  if (b.mat.startsWith('stucco')) {
    add(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, hue);
    if (h >= 2.5 && b.minY === 0) add(b.minX - 0.04, 0, b.minZ - 0.04, b.maxX + 0.04, 0.55, b.maxZ + 0.04, shade(hue, 0.72));
    if (h >= 4) {
      add(b.minX - 0.12, b.maxY, b.minZ - 0.12, b.maxX + 0.12, b.maxY + 0.22, b.maxZ + 0.12, 0xfff0d4);
      roofEdge(add, b);
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
      add(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 0xc45a38);
      add(b.minX + 0.06, b.maxY - 0.02, b.minZ + 0.06, b.maxX - 0.06, b.maxY + 0.02, b.maxZ - 0.06, 0x5b3a22);
      plantRow(leaves, blooms, b);
      return;
    case 'fountain':
      add(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 0xfff6ea);
      add(b.minX - 0.08, b.maxY - 0.08, b.minZ - 0.08, b.maxX + 0.08, b.maxY + 0.06, b.maxZ + 0.08, 0x3ec4b8);
      return;
    case 'statue':
      add(b.minX + 0.2, b.minY, b.minZ + 0.2, b.maxX - 0.2, 2.4, b.maxZ - 0.2, 0x3ec4b8);
      add(cx - 0.5, 2.4, cz - 0.5, cx + 0.5, 2.6, cz + 0.5, 0xf5c542);
      return;
    case 'stall':
      add(b.minX, b.minY, b.minZ, b.maxX, b.maxY - 0.06, b.maxZ, 0x2fafa6);
      add(b.minX - 0.04, b.maxY - 0.06, b.minZ - 0.04, b.maxX + 0.04, b.maxY, b.maxZ + 0.04, 0xfff6ea);
      return;
    case 'kiosk':
      add(b.minX, b.minY, b.minZ, b.maxX, b.maxY - 0.28, b.maxZ, b.sign === 'ELOTES' ? 0xf0c44a : 0x3f8f6a);
      add(b.minX - 0.12, b.maxY - 0.28, b.minZ - 0.12, b.maxX + 0.12, b.maxY, b.maxZ + 0.12, 0xe07048);
      return;
    case 'hedge': {
      add(b.minX, b.minY, b.minZ, b.maxX, b.maxY - 0.2, b.maxZ, 0x246b30);
      const long = Math.max(w, d), alongX = w >= d;
      const n = Math.max(2, Math.round(long / 0.55));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = alongX ? b.minX + w * t : cx;
        const z = alongX ? cz : b.minZ + d * t;
        leaves.add(x, b.maxY - 0.05, z, 1.1, 0.8, 1.1, 0, i % 2 ? 0x3fa84a : 0x2d7a34);
        if (i % 2 === 0) blooms.add(x, b.maxY + 0.15, z, 1, 1, 1, 0, i % 4 ? 0xf0a030 : 0xf07898);
      }
      return;
    }
    case 'table': {
      const cloth = Math.round(cx + cz) % 2 ? 0xf07898 : 0x3ec4b8;
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
      add(b.minX, b.minY, b.minZ, b.maxX, b.maxY - 0.05, b.maxZ, 0x6a3a86);
      add(b.minX - 0.04, b.maxY - 0.05, b.minZ - 0.04, b.maxX + 0.04, b.maxY, b.maxZ + 0.04, 0xf5c542);
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
      // Ground-floor doors become a slab when the camera is in the alley.
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

function roofEdge(add: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: number) => void, b: MapBox): void {
  const f = faceOf(b);
  const n = Math.max(2, Math.round(f.len / 0.45));
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) * (f.len / n);
    const x = f.fx + f.ux * a + f.nx * 0.28;
    const z = f.fz + f.uz * a + f.nz * 0.28;
    add(x - 0.16, b.maxY + 0.18, z - 0.16, x + 0.16, b.maxY + 0.36, z + 0.16, i % 3 ? 0xd4653c : 0xb84e30);
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

function dressMap(
  parts: THREE.BufferGeometry[], leaves: Batch, blooms: Batch, cloth: Batch, bulbs: Batch, glow: Batch, shade: Batch,
  add: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hex: number) => void,
  map: MapData, decor: MapDecor | undefined, teamDecor: boolean,
): void {
  if (!decor) return;
  for (const tr of decor.trees ?? []) {
    add(tr.x - 0.14, tr.y, tr.z - 0.14, tr.x + 0.14, 3.2, tr.z + 0.14, 0x6a3a22);
    leaves.add(tr.x, 4.05, tr.z, 2.6, 2.2, 2.6, 0, 0xffffff);
    leaves.add(tr.x + 0.85, 3.55, tr.z + 0.3, 1.7, 1.5, 1.7, 0.6, 0xe8ffe8);
    leaves.add(tr.x - 0.7, 3.7, tr.z - 0.4, 1.8, 1.6, 1.8, 1.1, 0xd8f0d0);
    blooms.add(tr.x + 0.4, 4.3, tr.z + 0.2, 1.2, 1.2, 1.2, 0, 0xf07898);
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
  }
  lineProps(cloth, decor.laundry ?? [], true);
  lineProps(cloth, decor.papel ?? [], false);
  stringLights(bulbs, glow, decor.lights ?? []);
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

function stringLights(bulbs: Batch, glow: Batch, lines: Array<[number, number, number, number, number]>): void {
  const colors = [0xf07898, 0xfff0b0, 0x9ee8e4];
  for (const [ax, az, bx, bz, y] of lines) {
    const n = 16;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const sag = Math.sin(t * Math.PI) * 1.05;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const col = colors[i % 3]!;
      bulbs.add(x, y - sag - 0.08, z, 0.16, 0.2, 0.16, 0, col);
      glow.add(x, y - sag - 0.08, z, 0.7, 0.7, 1, 0, col);
    }
  }
}

function paintedFloor(decor: MapDecor | undefined): THREE.Mesh | null {
  const tex = groundTexture(26);
  if (!tex) return null;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(decor?.ground.w ?? 54, decor?.ground.d ?? 38),
    new THREE.MeshLambertMaterial({ map: tex, color: 0xfff3e4 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.012;
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
