// Visual build of El Patio from the authoritative map. Solid boxes become
// houses, stairs, planters and props with the same footprint; decoration is
// either flush with walls (<0.1 m) or above head height, so it never blocks
// movement or hides an opponent unexpectedly.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EL_PATIO, type MapBox } from '../../../shared/map';
import { COLORS, GeoBatch, boxGeo, flat, groundTexture, signTexture, stuccoTexture, toon, woodTexture } from './materials';
import { buildSandal, GOLD_SKIN } from '../../models/sandal';
import type { Quality } from '../settings';

export interface WorldView {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  update(t: number): void;
  drawCalls: number;
}

const STUCCO: Record<string, number> = {
  stuccoTerracotta: 0xd8765a, stuccoCream: 0xf1dfbc, stuccoTurquoise: 0x7cc7bb, stuccoMarigold: 0xf0b45a,
  stuccoViolet: 0x8a6aa8, stuccoPink: 0xeb9aac,
};

class Inst {
  m: THREE.Matrix4[] = [];
  c: THREE.Color[] = [];
  private tmp = new THREE.Object3D();
  add(x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, color?: number, rx = 0, rz = 0): void {
    this.tmp.position.set(x, y, z);
    this.tmp.rotation.set(rx, ry, rz);
    this.tmp.scale.set(sx, sy, sz);
    this.tmp.updateMatrix();
    this.m.push(this.tmp.matrix.clone());
    if (color !== undefined) this.c.push(new THREE.Color(color));
  }
  build(geo: THREE.BufferGeometry, mat: THREE.Material, shadow = false): THREE.InstancedMesh | null {
    if (!this.m.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, this.m.length);
    this.m.forEach((m, i) => im.setMatrixAt(i, m));
    if (this.c.length === this.m.length) this.c.forEach((c, i) => im.setColorAt(i, c));
    im.castShadow = shadow;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    return im;
  }
}

const UNIT = new THREE.BoxGeometry(1, 1, 1);
const LEAF = new THREE.IcosahedronGeometry(0.5, 0);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);

export function buildWorld(quality: Quality): WorldView {
  const group = new THREE.Group();
  group.name = 'el-patio';
  const batch = new GeoBatch();
  const stucco = stuccoTexture();
  const wood = woodTexture();
  const mat = (c: number) => toon(c, { map: stucco });
  const woodMat = toon(0xffffff, { map: wood });

  // ---------------------------------------------------------------- sky
  const skyGeo = new THREE.SphereGeometry(160, 24, 12);
  const top = new THREE.Color(0x5a3a8c), mid = new THREE.Color(0xf4a56c), hor = new THREE.Color(0xffd9a0);
  const pos = skyGeo.attributes.position as THREE.BufferAttribute;
  const cols: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 160;
    if (y > 0.2) c.copy(mid).lerp(top, Math.min(1, (y - 0.2) / 0.6)); else c.copy(hor).lerp(mid, Math.max(0, (y + 0.05) / 0.25));
    cols.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  group.add(sky);
  const sunDisk = new THREE.Mesh(new THREE.CircleGeometry(10, 24), new THREE.MeshBasicMaterial({ color: 0xffe6a8, fog: false }));
  sunDisk.position.set(-120, 30, 50);
  sunDisk.lookAt(0, 0, 0);
  group.add(sunDisk);

  // ------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight(0xffe4c4, 0x9a5a48, 1.35);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc890, 2.4);
  sun.position.set(-28, 30, 16);
  sun.target.position.set(0, 0, 0);
  const sc = sun.shadow.camera;
  sc.left = -32; sc.right = 32; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 100;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  const shadowSize = quality === 'high' ? 2048 : 1024;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.castShadow = quality !== 'low';
  group.add(sun, sun.target);

  // ------------------------------------------------------------- ground
  const gtex = groundTexture(quality === 'high' ? 40 : quality === 'medium' ? 28 : 18);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(54, 38), toon(0xffffff, { map: gtex }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  const beyond = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), toon(0xc9a27a));
  beyond.rotation.x = -Math.PI / 2;
  beyond.position.y = -0.02;
  group.add(beyond);

  // Instanced details.
  const glass = new Inst(), frames = new Inst(), shutters = new Inst(), sills = new Inst(), rails = new Inst();
  const pots = new Inst(), flowers = new Inst(), bushes = new Inst(), roofTiles = new Inst(), trims = new Inst();
  const doors = new Inst(), slabs = new Inst();

  const signs: Array<{ text: string; x: number; y: number; z: number; ry: number; w: number; bg: string; fg: string }> = [];

  for (const bx of EL_PATIO.boxes) addBox(bx);

  function addBox(b: MapBox): void {
    const w = b.maxX - b.minX, h = b.maxY - b.minY, d = b.maxZ - b.minZ;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    if (b.mat in STUCCO) {
      const col = STUCCO[b.mat]!;
      batch.add(mat(col), boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 3));
      // Darker plinth band and a cream cornice.
      if (h >= 2.5 && b.minY === 0) {
        batch.add(toon(shade(col, 0.72)), boxGeo(b.minX - 0.03, 0, b.minZ - 0.03, b.maxX + 0.03, 0.55, b.maxZ + 0.03, 3, 63 & ~12));
      }
      if (h >= 4) {
        trims.add(cx, b.maxY + 0.12, cz, w + 0.3, 0.24, d + 0.3, 0, COLORS.cream);
        // Terracotta tile roof edge on the public side.
        roofEdge(b);
      }
      if (b.facade && h >= 3) facade(b, col);
      if (b.sign) signs.push(signFor(b));
      return;
    }
    switch (b.mat) {
      case 'stone':
      case 'step':
        batch.add(toon(b.mat === 'step' ? 0xe6d6b4 : COLORS.stone, { map: stucco }), boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 2));
        if (b.mat === 'step') batch.add(toon(COLORS.terracotta), boxGeo(b.minX, b.maxY - 0.05, b.minZ, b.maxX, b.maxY + 0.005, b.maxZ, 2, 4 | 16 | 32 | 1 | 2));
        if (b.mat === 'stone' && h > 2) {
          // Terrace: arches painted on its plaza face.
          trims.add(cx, b.maxY + 0.04, cz, w + 0.1, 0.08, d + 0.1, 0, COLORS.creamDark);
          archDecor(b);
        }
        return;
      case 'parapet':
        batch.add(toon(COLORS.cream, { map: stucco }), boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 2));
        trims.add(cx, b.maxY + 0.04, cz, w + 0.08, 0.08, d + 0.12, 0, COLORS.terracotta);
        for (let x = b.minX + 0.4; x < b.maxX; x += 0.8) pots.add(x, b.maxY + 0.15, cz, 0.28, 0.3, 0.28, 0, COLORS.terracottaDark);
        return;
      case 'lintel':
        batch.add(woodMat, boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 1.5));
        return;
      case 'planter':
        batch.add(toon(COLORS.terracottaDark, { map: stucco }), boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 2));
        batch.add(toon(0x5b3a22), boxGeo(b.minX + 0.08, b.maxY - 0.02, b.minZ + 0.08, b.maxX - 0.08, b.maxY + 0.01, b.maxZ - 0.08, 2, 4));
        trims.add(cx, b.maxY, cz, w + 0.12, 0.1, d + 0.12, 0, COLORS.cream);
        plantRow(b);
        return;
      case 'fountain':
        batch.add(toon(COLORS.cream, { map: stucco }), boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 2));
        trims.add(cx, b.maxY, cz, w + 0.2, 0.14, d + 0.2, 0, COLORS.turquoise);
        {
          const water = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.5, d - 0.5), new THREE.MeshToonMaterial({ color: COLORS.water, transparent: true, opacity: 0.85, emissive: 0x0b3d44 }));
          water.rotation.x = -Math.PI / 2;
          water.position.set(cx, b.maxY - 0.04, cz);
          water.name = 'water';
          group.add(water);
        }
        return;
      case 'statue': {
        // Pedestal with tiles, then the golden chancla monument inside the box.
        batch.add(toon(COLORS.turquoise, { map: stucco }), boxGeo(b.minX + 0.25, b.minY, b.minZ + 0.25, b.maxX - 0.25, 2.5, b.maxZ - 0.25, 1));
        trims.add(cx, 2.55, cz, w - 0.2, 0.14, d - 0.2, 0, COLORS.gold);
        const statue = buildSandal(GOLD_SKIN, true);
        statue.scale.setScalar(6.2);
        statue.position.set(cx, 3.45, cz);
        statue.rotation.set(-1.2, 0.4, 0);
        statue.name = 'statue';
        group.add(statue);
        return;
      }
      case 'kiosk':
        batch.add(toon(b.sign === 'ELOTES' ? 0xf5d35a : 0x3f8f6a, { map: stucco }), boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY - 0.3, b.maxZ, 2));
        batch.add(toon(COLORS.terracotta), boxGeo(b.minX - 0.15, b.maxY - 0.3, b.minZ - 0.15, b.maxX + 0.15, b.maxY, b.maxZ + 0.15, 2));
        if (b.sign) signs.push({ text: b.sign, x: cx, y: b.maxY - 0.7, z: b.maxZ + 0.02, ry: 0, w: w * 0.9, bg: '#f4e6c8', fg: '#4b2a6b' });
        if (b.sign) signs.push({ text: b.sign, x: cx, y: b.maxY - 0.7, z: b.minZ - 0.02, ry: Math.PI, w: w * 0.9, bg: '#f4e6c8', fg: '#4b2a6b' });
        return;
      case 'crate':
        batch.add(woodMat, boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 0.8));
        batch.add(toon(COLORS.woodDark), boxGeo(b.minX - 0.01, b.maxY * 0.45, b.minZ - 0.01, b.maxX + 0.01, b.maxY * 0.55, b.maxZ + 0.01, 1, 63 & ~12));
        return;
      case 'bin': {
        const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, h / 2, cz), new THREE.Quaternion(), new THREE.Vector3(w * 0.95, h, d * 0.95));
        batch.addMesh(toon(0x3d7d5a), CYL, m);
        batch.add(toon(0x2f5f45), boxGeo(b.minX, b.maxY - 0.08, b.minZ, b.maxX, b.maxY + 0.02, b.maxZ, 1));
        return;
      }
      default:
        batch.add(mat(COLORS.creamDark), boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 3));
    }
  }

  function faceFrame(b: MapBox): { fx: number; fz: number; ux: number; uz: number; nx: number; nz: number; len: number; ry: number } {
    switch (b.facade) {
      case 's': return { fx: b.minX, fz: b.maxZ, ux: 1, uz: 0, nx: 0, nz: 1, len: b.maxX - b.minX, ry: 0 };
      case 'n': return { fx: b.maxX, fz: b.minZ, ux: -1, uz: 0, nx: 0, nz: -1, len: b.maxX - b.minX, ry: Math.PI };
      case 'e': return { fx: b.maxX, fz: b.maxZ, ux: 0, uz: -1, nx: 1, nz: 0, len: b.maxZ - b.minZ, ry: Math.PI / 2 };
      default: return { fx: b.minX, fz: b.minZ, ux: 0, uz: 1, nx: -1, nz: 0, len: b.maxZ - b.minZ, ry: -Math.PI / 2 };
    }
  }

  function facade(b: MapBox, wallColor: number): void {
    const f = faceFrame(b);
    const h = b.maxY;
    const cols = Math.max(1, Math.floor(f.len / 2.7));
    const spacing = f.len / cols;
    const shutterColor = wallColor === STUCCO.stuccoTurquoise ? COLORS.marigold : wallColor === STUCCO.stuccoViolet ? COLORS.cream : COLORS.turquoise;
    for (let k = 0; k < cols; k++) {
      const along = spacing * (k + 0.5);
      const px = f.fx + f.ux * along, pz = f.fz + f.uz * along;
      // Ground floor: a door in the middle bay, otherwise barred windows.
      // Upper floors: windows with shutters, some with Juliet balconies.
      for (let y = 1.5; y + 1.2 < h; y += 2.9) {
        const ground = y < 2;
        if (ground && k === Math.floor(cols / 2) && h >= 4) {
          doors.add(px + f.nx * 0.03, 1.15, pz + f.nz * 0.03, 1.1, 2.3, 0.06, f.ry, k % 2 ? COLORS.woodDark : COLORS.violet);
          trims.add(px + f.nx * 0.04, 2.38, pz + f.nz * 0.04, 1.4, 0.16, 0.06, f.ry, COLORS.cream);
          continue;
        }
        const wy = ground ? 1.55 : y + 0.2;
        glass.add(px + f.nx * 0.02, wy, pz + f.nz * 0.02, 0.9, 1.2, 0.04, f.ry);
        frames.add(px + f.nx * 0.03, wy + 0.66, pz + f.nz * 0.03, 1.1, 0.12, 0.06, f.ry, COLORS.cream);
        sills.add(px + f.nx * 0.05, wy - 0.66, pz + f.nz * 0.05, 1.15, 0.1, 0.1, f.ry, COLORS.cream);
        const sx = f.ux * 0.63, sz = f.uz * 0.63;
        shutters.add(px - sx + f.nx * 0.04, wy, pz - sz + f.nz * 0.04, 0.36, 1.25, 0.04, f.ry, shutterColor);
        shutters.add(px + sx + f.nx * 0.04, wy, pz + sz + f.nz * 0.04, 0.36, 1.25, 0.04, f.ry, shutterColor);
        if (ground) {
          for (let i = -2; i <= 2; i++) rails.add(px + f.ux * i * 0.18 + f.nx * 0.07, wy, pz + f.uz * i * 0.18 + f.nz * 0.07, 0.035, 1.2, 0.035, f.ry);
        } else if ((k + Math.round(y)) % 2 === 0 && y >= 3) {
          // Juliet balcony: shallow, above head height.
          slabs.add(px + f.nx * 0.16, wy - 0.72, pz + f.nz * 0.16, 1.4, 0.08, 0.32, f.ry, COLORS.creamDark);
          for (let i = -3; i <= 3; i++) rails.add(px + f.ux * i * 0.2 + f.nx * 0.3, wy - 0.4, pz + f.uz * i * 0.2 + f.nz * 0.3, 0.03, 0.6, 0.03, f.ry);
          rails.add(px + f.nx * 0.3, wy - 0.1, pz + f.nz * 0.3, 1.4, 0.04, 0.04, f.ry);
          for (let i = -1; i <= 1; i++) flowers.add(px + f.ux * i * 0.4 + f.nx * 0.2, wy - 0.55, pz + f.uz * i * 0.4 + f.nz * 0.2, 0.22, 0.22, 0.22, i, [COLORS.pink, COLORS.marigold, 0xffffff][i + 1]);
        } else {
          pots.add(px + f.nx * 0.1, wy - 0.58, pz + f.nz * 0.1, 0.9, 0.16, 0.14, f.ry, COLORS.terracottaDark);
          for (let i = -1; i <= 1; i++) bushes.add(px + f.ux * i * 0.28 + f.nx * 0.1, wy - 0.42, pz + f.uz * i * 0.28 + f.nz * 0.1, 0.26, 0.24, 0.2, i, i ? COLORS.leaf : COLORS.leafDark);
        }
      }
    }
  }

  function roofEdge(b: MapBox): void {
    if (!b.facade) return;
    const f = faceFrame(b);
    const n = Math.max(2, Math.round(f.len / 0.42));
    for (let i = 0; i < n; i++) {
      const a = (i + 0.5) * (f.len / n);
      roofTiles.add(f.fx + f.ux * a + f.nx * 0.22, b.maxY + 0.32, f.fz + f.uz * a + f.nz * 0.22, 0.4, 0.2, 0.7, f.ry, i % 3 ? COLORS.terracotta : COLORS.terracottaDark, -0.35, 0);
    }
  }

  function archDecor(b: MapBox): void {
    if (!b.facade) return;
    const f = faceFrame(b);
    const n = Math.max(1, Math.floor(f.len / 2));
    for (let i = 0; i < n; i++) {
      const a = (i + 0.5) * (f.len / n);
      const x = f.fx + f.ux * a + f.nx * 0.01, z = f.fz + f.uz * a + f.nz * 0.01;
      glass.add(x, 1.0, z, 1.2, 1.7, 0.02, f.ry);
      frames.add(x + f.nx * 0.01, 1.95, z + f.nz * 0.01, 1.5, 0.18, 0.04, f.ry, COLORS.terracotta);
    }
  }

  function plantRow(b: MapBox): void {
    const long = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    const alongX = b.maxX - b.minX >= b.maxZ - b.minZ;
    const n = Math.max(2, Math.round(long / 0.5));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = alongX ? b.minX + (b.maxX - b.minX) * t : (b.minX + b.maxX) / 2;
      const z = alongX ? (b.minZ + b.maxZ) / 2 : b.minZ + (b.maxZ - b.minZ) * t;
      bushes.add(x, b.maxY + 0.2, z, 0.5, 0.42 + (i % 3) * 0.08, 0.5, i, i % 2 ? COLORS.leaf : COLORS.leafDark);
      if (i % 2 === 0) flowers.add(x, b.maxY + 0.42, z, 0.16, 0.16, 0.16, i, i % 4 ? COLORS.marigold : COLORS.pink);
    }
  }

  function signFor(b: MapBox): { text: string; x: number; y: number; z: number; ry: number; w: number; bg: string; fg: string } {
    const f = faceFrame(b);
    const mid = f.len / 2;
    const team = b.sign === 'CASA SOL' ? 'sol' : b.sign === 'CASA LUNA' ? 'luna' : '';
    return {
      text: b.sign!, x: f.fx + f.ux * mid + f.nx * 0.06, y: 3.3, z: f.fz + f.uz * mid + f.nz * 0.06, ry: f.ry, w: Math.min(f.len - 0.6, 4.2),
      bg: team === 'sol' ? '#f29a2e' : team === 'luna' ? '#36b9c9' : '#f4e6c8', fg: team ? '#2e1846' : '#5a3480',
    };
  }

  // ------------------------------------------------------- team identity
  // Casa Sol: marigold banners and a sun; Casa Luna: turquoise and a moon.
  const banner = (x: number, z: number, ry: number, color: number, y = 4.4) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1.2, 2.2, 0.04));
    batch.addMesh(toon(color), UNIT, m);
  };
  for (const s of [-1, 1] as const) {
    const color = s < 0 ? COLORS.sol : COLORS.luna;
    // Banners on the spawn-side face of the separation houses.
    for (const z of [-8.5, -5.5, 3.5, 7.5]) banner(s * 21.06, s < 0 ? z : -z, Math.PI / 2, color);
    // A big emblem above each plaza doorway.
    const emblem = new THREE.Mesh(s < 0 ? new THREE.CircleGeometry(0.9, 20) : crescentGeometry(), toon(color, { emissive: s < 0 ? 0x3a1c00 : 0x002a30 }));
    emblem.position.set(s * 16.96, 4.3, s * 2.75);
    emblem.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2;
    group.add(emblem);
  }

  // --------------------------------------------------- overhead dressing
  const lines = new THREE.Group();
  const clothes = new Inst();
  const clothColors = [0xffffff, COLORS.pink, COLORS.turquoise, COLORS.marigold, COLORS.cream, COLORS.violet];
  const wirePts: number[] = [];
  const line = (ax: number, az: number, bx: number, bz: number, y: number, laundry: boolean) => {
    const n = Math.max(3, Math.floor(Math.hypot(bx - ax, bz - az) / (laundry ? 0.9 : 0.8)));
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const s0 = Math.sin(t0 * Math.PI) * 0.45, s1 = Math.sin(t1 * Math.PI) * 0.45;
      wirePts.push(ax + (bx - ax) * t0, y - s0, az + (bz - az) * t0, ax + (bx - ax) * t1, y - s1, az + (bz - az) * t1);
      if (i === 0) continue;
      const x = ax + (bx - ax) * t0, z = az + (bz - az) * t0;
      const ry = Math.atan2(-(bz - az), bx - ax);
      if (laundry) {
        const big = i % 3 === 0;
        clothes.add(x, y - s0 - (big ? 0.42 : 0.3), z, big ? 0.62 : 0.45, big ? 0.78 : 0.55, 0.02, ry, clothColors[(i * 5 + Math.round(ax)) % clothColors.length]);
      } else {
        clothes.add(x, y - s0 - 0.33, z, 0.5, 0.62, 0.01, ry, clothColors[i % clothColors.length]);
      }
    }
  };
  // Laundry across the alley and the market (from roof line to roof line).
  for (const x of [-19, -9, 6, 18]) { line(x, -15, x + 1.2, -11, 4.6, true); line(-x, 15, -x - 1.2, 11, 4.6, true); }
  // Papel picado over the plaza.
  for (const z of [-6, 0, 6]) line(-17, z - 1.5, 17, z + 1.5, 6.4, false);
  const wires = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3)), new THREE.LineBasicMaterial({ color: COLORS.ink }));
  lines.add(wires);
  const clothMesh = clothes.build(new THREE.PlaneGeometry(1, 1), toon(0xffffff, { side: THREE.DoubleSide }));
  if (clothMesh) lines.add(clothMesh);
  group.add(lines);

  // String lights criss-crossing the plaza.
  const bulbs = new Inst();
  const bulbPts: number[] = [];
  const string = (ax: number, az: number, bx: number, bz: number, y: number) => {
    const n = 22;
    for (let i = 0; i <= n; i++) {
      const t0 = i / n;
      const sag = Math.sin(t0 * Math.PI) * 1.1;
      const x = ax + (bx - ax) * t0, z = az + (bz - az) * t0;
      bulbs.add(x, y - sag - 0.1, z, 0.14, 0.18, 0.14, 0, i % 3 === 0 ? COLORS.pink : i % 3 === 1 ? 0xfff0b0 : COLORS.turquoiseFaded);
      if (i < n) {
        const t1 = (i + 1) / n, sag1 = Math.sin(t1 * Math.PI) * 1.1;
        bulbPts.push(x, y - sag, z, ax + (bx - ax) * t1, y - sag1, az + (bz - az) * t1);
      }
    }
  };
  string(-17, -8, 17, 8, 7.2);
  string(-17, 8, 17, -8, 7.2);
  group.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(bulbPts, 3)), new THREE.LineBasicMaterial({ color: COLORS.ink })));
  const bulbMesh = bulbs.build(new THREE.SphereGeometry(0.5, 6, 4), flat(0xffffff));
  if (bulbMesh) group.add(bulbMesh);

  // ---------------------------------------------- skyline landmark: church
  const church = new THREE.Group();
  const cm = (c2: number) => toon(c2, { map: stucco });
  const tower = new THREE.Mesh(UNIT, cm(0xf1dfbc));
  tower.scale.set(4, 16, 4); tower.position.set(0, 8, -24);
  const belfry = new THREE.Mesh(UNIT, cm(COLORS.terracotta));
  belfry.scale.set(4.4, 0.6, 4.4); belfry.position.set(0, 16.3, -24);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(2.6, 3.2, 8), cm(COLORS.turquoise));
  cap.position.set(0, 18.2, -24);
  const cross = new THREE.Mesh(UNIT, toon(COLORS.gold));
  cross.scale.set(0.2, 1.4, 0.2); cross.position.set(0, 20.4, -24);
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), toon(COLORS.gold));
  bell.rotation.x = Math.PI; bell.position.set(0, 14.6, -21.95);
  const arch = new THREE.Mesh(UNIT, flat(COLORS.violetDeep));
  arch.scale.set(1.8, 2.4, 0.05); arch.position.set(0, 14.4, -21.98);
  church.add(tower, belfry, cap, cross, arch, bell);
  church.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = false; });
  group.add(church);
  // Distant rooftops so the horizon is not empty.
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const r = 38 + (i % 3) * 5;
    const hgt = 6 + ((i * 7) % 5) * 1.6;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * r, hgt / 2, Math.sin(a) * r), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0)), new THREE.Vector3(9, hgt, 6));
    batch.addMesh(toon([0xd8765a, 0xf1dfbc, 0x7cc7bb, 0xf0b45a, 0x8a6aa8][i % 5]!, { map: stucco }), UNIT, m);
  }

  // ------------------------------------------------------------- signs
  for (const s of signs) {
    const tex = signTexture(s.text, s.bg, s.fg, 768, 160);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.w * 0.21), tex ? new THREE.MeshBasicMaterial({ map: tex }) : flat(0xf4e6c8));
    m.position.set(s.x, s.y, s.z);
    m.rotation.y = s.ry;
    group.add(m);
  }

  // ------------------------------------------------------ bake and finish
  let calls = batch.build(group, (gs) => mergeGeometries(gs, false));
  const add = (im: THREE.InstancedMesh | null) => { if (im) { group.add(im); calls++; } };
  add(glass.build(UNIT, toon(0x3a2a52, { emissive: 0x120a20 })));
  add(frames.build(UNIT, toon(0xffffff)));
  add(shutters.build(UNIT, toon(0xffffff, { map: wood })));
  add(sills.build(UNIT, toon(0xffffff)));
  add(rails.build(UNIT, toon(COLORS.ink)));
  add(pots.build(UNIT, toon(0xffffff)));
  add(flowers.build(LEAF, toon(0xffffff)));
  add(bushes.build(LEAF, toon(0xffffff), true));
  add(roofTiles.build(new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1, false, 0, Math.PI), toon(0xffffff)));
  add(trims.build(UNIT, toon(0xffffff)));
  add(doors.build(UNIT, toon(0xffffff, { map: wood })));
  add(slabs.build(UNIT, toon(0xffffff)));

  const water = group.getObjectByName('water') as THREE.Mesh | undefined;
  const statue = group.getObjectByName('statue');
  return {
    group,
    sun,
    drawCalls: calls,
    update(t: number) {
      lines.children.forEach((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) o.position.y = Math.sin(t * 1.3) * 0.03; });
      if (water) (water.material as THREE.MeshToonMaterial).emissive.setHSL(0.52, 0.6, 0.08 + Math.sin(t * 2) * 0.02);
      if (statue) statue.rotation.y = 0.4 + Math.sin(t * 0.3) * 0.1;
    },
  };
}

function shade(hex: number, k: number): number {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return c.getHex();
}

let crescent: THREE.ShapeGeometry | null = null;
function crescentGeometry(): THREE.ShapeGeometry {
  if (crescent) return crescent;
  const s = new THREE.Shape();
  s.absarc(0, 0, 0.9, Math.PI * 0.25, Math.PI * 1.75, false);
  s.absarc(0.38, 0, 0.72, Math.PI * 1.62, Math.PI * 0.38, true);
  crescent = new THREE.ShapeGeometry(s, 16);
  return crescent;
}
