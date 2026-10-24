// Visual build of a map from its authoritative data (El Patio by default). Solid boxes become
// houses, stairs, planters and props with the same footprint; decoration is
// either flush with walls (<0.1 m) or above head height, so it never blocks
// movement or hides an opponent unexpectedly.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EL_PATIO, type MapBox, type MapData } from '../../../shared/map';
import { COLORS, GeoBatch, boxGeo, flat, groundTexture, signTexture, stuccoTexture, toon, toonRamp, woodTexture } from './materials';
import { buildSandal, GOLD_SKIN } from '../../models/sandal';
import { buildSection, inSection, sectionEnabled } from './section';
import { FOCAL_MATS, buildFocal } from './patio-focal';
import { patioGround, patioLight } from './patio-materials';
import type { Quality } from '../settings';

export interface WorldView {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  update(t: number): void;
  drawCalls: number;
  // Campaign: lift the ambient light (the patio brightening as it is cleaned).
  setBrightness(k: number): void;
  /** La Fiesta's piñata: where it hangs, and a playful reaction when a chancla hits it. */
  pinata?: { x: number; y: number; z: number; r: number; hit(): void };
}

export type ThemeName = 'afternoon' | 'morning' | 'noon' | 'dusk';

interface Theme {
  sky: [number, number, number]; // top, middle, horizon
  sunDisk: number; sunDiskPos: [number, number, number];
  hemi: [number, number, number]; // sky, ground, intensity
  sun: [number, number]; sunPos: [number, number, number];
  fog: number;
  bulbsGlow: boolean;
}

export const THEMES: Record<ThemeName, Theme> = {
  afternoon: { sky: [0x5a3a8c, 0xf4a56c, 0xffd9a0], sunDisk: 0xffe6a8, sunDiskPos: [-120, 30, 50], hemi: [0xffe4c4, 0x9a5a48, 1.35], sun: [0xffc890, 2.4], sunPos: [-28, 30, 16], fog: 0xf3b07a, bulbsGlow: false },
  morning: { sky: [0x6fa6dc, 0xffd6b0, 0xfff0d8], sunDisk: 0xfff6dc, sunDiskPos: [120, 26, -40], hemi: [0xeaf2ff, 0xa07a62, 1.45], sun: [0xfff0d6, 2.1], sunPos: [30, 26, -12], fog: 0xf2dcc8, bulbsGlow: false },
  noon: { sky: [0x4f9fe6, 0x9fd3f2, 0xf2f0dc], sunDisk: 0xffffff, sunDiskPos: [-20, 120, 20], hemi: [0xfff6e6, 0xb08a66, 1.6], sun: [0xfffaf0, 2.7], sunPos: [-6, 42, 10], fog: 0xe8e4d4, bulbsGlow: false },
  dusk: { sky: [0x24104a, 0xb8467a, 0xff9a5a], sunDisk: 0xff7a4a, sunDiskPos: [-130, 10, 40], hemi: [0xa88ad8, 0x4a2a3a, 1.05], sun: [0xff9a6a, 1.25], sunPos: [-40, 12, 12], fog: 0x6a3a6a, bulbsGlow: true },
};

export interface WorldOptions {
  map?: MapData; // which arena (El Patio when omitted)
  boxes?: readonly MapBox[]; // a campaign layout instead of the map's own boxes
  theme?: ThemeName;
  teamDecor?: boolean; // Sol/Luna banners and emblems (multiplayer only)
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

export function buildWorld(quality: Quality, opts: WorldOptions = {}): WorldView {
  const map = opts.map ?? EL_PATIO;
  // Graphics experiment: the El Patio arena itself (not a campaign layout,
  // which also builds on El Patio's map) is drawn with the patio kit.
  const patioKit = map === EL_PATIO && !opts.boxes && sectionEnabled();
  const th0 = THEMES[opts.theme ?? 'afternoon'];
  const th: Theme = patioKit ? { ...th0, ...patioLight({ hemi: th0.hemi, sun: th0.sun }) } : th0;
  const decor = map.decor ?? EL_PATIO.decor!;
  const bd = map.bounds;
  const group = new THREE.Group();
  group.name = `map-${map.id ?? 'patio'}`;
  const batch = new GeoBatch();
  const stucco = stuccoTexture();
  const wood = woodTexture();
  const mat = (c: number) => toon(c, { map: stucco });
  const woodMat = toon(0xffffff, { map: wood });

  // ---------------------------------------------------------------- sky
  const skyGeo = new THREE.SphereGeometry(160, 24, 12);
  const top = new THREE.Color(th.sky[0]), mid = new THREE.Color(th.sky[1]), hor = new THREE.Color(th.sky[2]);
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
  const sunDisk = new THREE.Mesh(new THREE.CircleGeometry(10, 24), new THREE.MeshBasicMaterial({ color: th.sunDisk, fog: false }));
  sunDisk.position.set(...th.sunDiskPos);
  sunDisk.lookAt(0, 0, 0);
  group.add(sunDisk);

  // ------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight(th.hemi[0], th.hemi[1], th.hemi[2]);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(th.sun[0], th.sun[1]);
  sun.position.set(...th.sunPos);
  sun.target.position.set(0, 0, 0);
  const sc = sun.shadow.camera;
  sc.left = bd.minX - 5; sc.right = bd.maxX + 5; sc.top = bd.maxZ + 7; sc.bottom = bd.minZ - 7; sc.near = 1; sc.far = 100;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  const shadowSize = quality === 'high' ? 2048 : 1024;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.castShadow = quality !== 'low';
  group.add(sun, sun.target);

  // ------------------------------------------------------------- ground
  // El Patio: one repeating paving texture, with production's ground zones
  // (streets, team courts) kept as vertex tints, and the fountain's path
  // rings as a flat mesh (they were painted into production's ground canvas).
  const pg = patioKit ? patioGround(quality, decor.ground, true) : null;
  const ground = pg
    ? new THREE.Mesh(pg.geometry, pg.material)
    : new THREE.Mesh(new THREE.PlaneGeometry(decor.ground.w, decor.ground.d), toon(0xffffff, { map: groundTexture(quality === 'high' ? 40 : quality === 'medium' ? 28 : 18) }));
  if (!pg) ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  if (pg) group.add(fountainRings());
  const beyond = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), toon(0xc9a27a));
  beyond.rotation.x = -Math.PI / 2;
  beyond.position.y = -0.02;
  group.add(beyond);

  // Instanced details.
  const glass = new Inst(), frames = new Inst(), shutters = new Inst(), sills = new Inst(), rails = new Inst();
  const pots = new Inst(), flowers = new Inst(), bushes = new Inst(), roofTiles = new Inst(), trims = new Inst();
  const doors = new Inst(), slabs = new Inst();

  const signs: Array<{ text: string; x: number; y: number; z: number; ry: number; w: number; bg: string; fg: string }> = [];

  // Graphics experiment: the café section gets the detailed kit (section.ts);
  // its boxes skip the generic dressing below. Collision is unchanged.
  const sectionBoxes: MapBox[] = [], focalBoxes: MapBox[] = [];
  for (const bx of opts.boxes ?? map.boxes) {
    if (patioKit && inSection(bx)) { sectionBoxes.push(bx); if (bx.sign) signs.push(signFor(bx)); continue; }
    // El Patio's fountain, statue and kiosks at the kit's quality (patio-focal.ts); the kiosks keep their signs.
    if (patioKit && FOCAL_MATS.has(bx.mat)) { focalBoxes.push(bx); if (bx.mat === 'kiosk') kioskSigns(bx); continue; }
    addBox(bx);
  }

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
      case 'wood':
        batch.add(woodMat, boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 1.5));
        return;
      case 'stall':
        // Furniture and market tables: painted wood with a tiled top.
        batch.add(toon(COLORS.turquoise, { map: wood }), boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY - 0.06, b.maxZ, 1));
        batch.add(toon(COLORS.cream), boxGeo(b.minX - 0.03, b.maxY - 0.06, b.minZ - 0.03, b.maxX + 0.03, b.maxY, b.maxZ + 0.03, 1));
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
        kioskSigns(b);
        return;
      case 'crate':
        batch.add(woodMat, boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 0.8));
        batch.add(toon(COLORS.woodDark), boxGeo(b.minX - 0.01, b.maxY * 0.45, b.minZ - 0.01, b.maxX + 0.01, b.maxY * 0.55, b.maxZ + 0.01, 1, 63 & ~12));
        return;
      case 'table': {
        // Party table: a long cloth in alternating colours, a white top.
        const cloth = Math.round(cx + cz) % 2 ? COLORS.pink : COLORS.turquoise;
        batch.add(toon(cloth), boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY - 0.04, b.maxZ, 1));
        batch.add(toon(0xffffff), boxGeo(b.minX - 0.04, b.maxY - 0.04, b.minZ - 0.04, b.maxX + 0.04, b.maxY, b.maxZ + 0.04, 1));
        for (let x = b.minX + 0.5; x < b.maxX - 0.2; x += 0.9) if (w >= d) pots.add(x, b.maxY + 0.08, cz, 0.18, 0.16, 0.18, 0, COLORS.gold);
        for (let z = b.minZ + 0.5; z < b.maxZ - 0.2; z += 0.9) if (d > w) pots.add(cx, b.maxY + 0.08, z, 0.18, 0.16, 0.18, 0, COLORS.gold);
        return;
      }
      case 'hedge': {
        batch.add(toon(COLORS.leafDark), boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY - 0.15, b.maxZ, 1));
        const long = Math.max(w, d), alongX = w >= d;
        for (let i = 0, n = Math.max(2, Math.round(long / 0.55)); i < n; i++) {
          const tt = (i + 0.5) / n;
          bushes.add(alongX ? b.minX + w * tt : cx, b.maxY - 0.2, alongX ? cz : b.minZ + d * tt, alongX ? 0.62 : Math.min(d, 0.7), 0.42, alongX ? Math.min(d, 0.7) : 0.62, i, i % 2 ? COLORS.leaf : COLORS.leafDark);
          if (i % 3 === 1) flowers.add(alongX ? b.minX + w * tt : cx, b.maxY + 0.02, alongX ? cz : b.minZ + d * tt, 0.16, 0.16, 0.16, i, i % 2 ? COLORS.pink : COLORS.marigold);
        }
        return;
      }
      case 'gift': {
        // A stack of presents with ribbons, inside the box's footprint.
        const cs = [COLORS.pink, COLORS.turquoise, COLORS.marigold, COLORS.violet];
        const k = Math.abs(Math.round(cx * 3 + cz * 7));
        const h1 = h * 0.58;
        batch.add(toon(cs[k % 4]!), boxGeo(b.minX, 0, b.minZ, b.maxX, h1, b.maxZ, 1));
        batch.add(toon(cs[(k + 1) % 4]!), boxGeo(b.minX + w * 0.15, h1, b.minZ + d * 0.15, b.maxX - w * 0.15, b.maxY, b.maxZ - d * 0.15, 1));
        trims.add(cx, h1 / 2, cz, w + 0.02, h1, 0.12, 0, COLORS.gold);
        trims.add(cx, h1 / 2, cz, 0.12, h1, d + 0.02, 0, COLORS.gold);
        trims.add(cx, h1 + (b.maxY - h1) / 2, cz, w * 0.7 + 0.02, b.maxY - h1, 0.1, 0, 0xffffff);
        return;
      }
      case 'stage':
        batch.add(toon(COLORS.violet, { map: wood }), boxGeo(b.minX, b.minY, b.minZ, b.maxX, b.maxY - 0.05, b.maxZ, 1));
        batch.add(toon(COLORS.gold), boxGeo(b.minX - 0.03, b.maxY - 0.05, b.minZ - 0.03, b.maxX + 0.03, b.maxY, b.maxZ + 0.03, 1));
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

  function kioskSigns(b: MapBox): void {
    if (!b.sign) return;
    const cx = (b.minX + b.maxX) / 2, w = b.maxX - b.minX;
    signs.push({ text: b.sign, x: cx, y: b.maxY - 0.7, z: b.maxZ + 0.02, ry: 0, w: w * 0.9, bg: '#f4e6c8', fg: '#4b2a6b' });
    signs.push({ text: b.sign, x: cx, y: b.maxY - 0.7, z: b.minZ - 0.02, ry: Math.PI, w: w * 0.9, bg: '#f4e6c8', fg: '#4b2a6b' });
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
  if (opts.teamDecor !== false) {
    // Banners on the spawn-side walls, and a big emblem over each spawn exit.
    for (const bn of decor.banners ?? []) banner(bn.x, bn.z, bn.ry, bn.team === 0 ? COLORS.sol : COLORS.luna, map === EL_PATIO ? 4.4 : 2.2);
    for (const em of decor.emblems ?? []) {
      const sol = em.team === 0;
      const emblem = new THREE.Mesh(sol ? new THREE.CircleGeometry(0.9, 20) : crescentGeometry(), toon(sol ? COLORS.sol : COLORS.luna, { emissive: sol ? 0x3a1c00 : 0x002a30 }));
      emblem.position.set(em.x, em.y, em.z);
      emblem.rotation.y = em.ry;
      group.add(emblem);
    }
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
  // Laundry from roof line to roof line, papel picado over the open ground.
  for (const [ax, az, bx2, bz, y] of decor.laundry ?? []) line(ax, az, bx2, bz, y, true);
  for (const [ax, az, bx2, bz, y] of decor.papel ?? []) line(ax, az, bx2, bz, y, false);
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
  for (const [ax, az, bx2, bz, y] of decor.lights ?? []) string(ax, az, bx2, bz, y);
  group.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(bulbPts, 3)), new THREE.LineBasicMaterial({ color: COLORS.ink })));
  const bulbMesh = bulbs.build(new THREE.SphereGeometry(0.5, 6, 4), flat(0xffffff));
  if (bulbMesh && th.bulbsGlow) bulbMesh.scale.setScalar(1);
  if (bulbMesh) group.add(bulbMesh);

  // ---------------------------------------------- skyline landmark: church
  const church = new THREE.Group();
  const ch = decor.church;
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
  if (ch) { church.position.set(ch.x, 0, ch.z + 24); group.add(church); }
  // Distant rooftops so the horizon is not empty.
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const r = Math.max(38, Math.hypot(bd.maxX, bd.maxZ) + 6) + (i % 3) * 5;
    const hgt = 6 + ((i * 7) % 5) * 1.6;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * r, hgt / 2, Math.sin(a) * r), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0)), new THREE.Vector3(9, hgt, 6));
    batch.addMesh(toon([0xd8765a, 0xf1dfbc, 0x7cc7bb, 0xf0b45a, 0x8a6aa8][i % 5]!, { map: stucco }), UNIT, m);
    if (patioKit) {
      // El Patio: the skyline gets the same roofline as the arena's houses
      // (a cream cornice and a terracotta tile slab), instanced: no new draws.
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      trims.add(x, hgt + 0.1, z, 9.3, 0.2, 6.3, -a, COLORS.cream);
      trims.add(x, hgt + 0.32, z, 9.6, 0.24, 6.6, -a, i % 2 ? COLORS.terracotta : COLORS.terracottaDark);
    }
  }

  // ------------------------------------------------------------- signs
  for (const s of signs) {
    const tex = signTexture(s.text, s.bg, s.fg, 768, 160);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.w * 0.21), tex ? new THREE.MeshBasicMaterial({ map: tex }) : flat(0xf4e6c8));
    m.position.set(s.x, s.y, s.z);
    m.rotation.y = s.ry;
    group.add(m);
  }

  // ---------------------------------------------------- map-specific dressing
  // Awnings over market stalls: the poles stand inside the stall's own footprint.
  for (const a of decor.awnings ?? []) {
    const stall = (opts.boxes ?? map.boxes).find((q) => q.mat === 'stall' && q.minX < a.maxX && q.maxX > a.minX && q.minZ < a.maxZ && q.maxZ > a.minZ);
    const aw = a.maxX - a.minX;
    for (let i = 0; i < 4; i++) batch.add(toon(i % 2 ? 0xffffff : a.color), boxGeo(a.minX + (aw / 4) * i, a.y, a.minZ, a.minX + (aw / 4) * (i + 1), a.y + 0.08, a.maxZ, 1));
    trims.add((a.minX + a.maxX) / 2, a.y - 0.08, a.minZ + 0.02, aw, 0.16, 0.04, 0, a.color);
    if (stall) {
      for (const [px, pz] of [[stall.minX + 0.08, stall.minZ + 0.08], [stall.maxX - 0.08, stall.minZ + 0.08], [stall.minX + 0.08, stall.maxZ - 0.08], [stall.maxX - 0.08, stall.maxZ - 0.08]] as const) {
        rails.add(px, (stall.maxY + a.y) / 2, pz, 0.06, a.y - stall.maxY, 0.06, 0);
      }
    }
  }
  // Trees growing out of planters: trunk inside the planter, canopy above head height.
  for (const tr of decor.trees ?? []) {
    batch.add(toon(COLORS.woodDark), boxGeo(tr.x - 0.12, tr.y, tr.z - 0.12, tr.x + 0.12, 3.3, tr.z + 0.12, 1));
    for (const [dx, dy, dz, r] of [[0, 4.1, 0, 1.15], [0.7, 3.8, 0.3, 0.8], [-0.6, 3.9, -0.4, 0.85], [0.1, 4.6, -0.2, 0.75]] as const) {
      bushes.add(tr.x + dx, dy, tr.z + dz, r * 2, r * 1.6, r * 2, dx, dy > 4.2 ? COLORS.leaf : COLORS.leafDark);
    }
  }
  // Dance floor tiles, painted flush with the ground.
  if (decor.danceFloor) {
    const df = decor.danceFloor;
    const n = 8, step = (df.r / n) * 1.2;
    for (let i = -n; i < n; i++) for (let j = -n; j < n; j++) {
      const x = df.x + (i + 0.5) * step, z = df.z + (j + 0.5) * step;
      if (Math.hypot(x - df.x, z - df.z) > df.r) continue;
      const tile = new THREE.Matrix4().compose(new THREE.Vector3(x, 0.012, z), new THREE.Quaternion(), new THREE.Vector3(step * 0.96, 0.02, step * 0.96));
      batch.addMesh(toon([COLORS.pink, COLORS.turquoise, COLORS.marigold, COLORS.violet][(i + j + 2 * n) % 4]!), UNIT, tile);
    }
  }
  // The piñata: a seven-point star on a rope, hung well above everyone.
  const pinata = decor.pinata ? buildPinata(decor.pinata, group) : null;

  // ------------------------------------------------------ bake and finish
  let calls = batch.build(group, (gs) => mergeGeometries(gs, false));
  if (sectionBoxes.length) { const sec = buildSection(sectionBoxes, quality); group.add(sec.group); calls += sec.calls; }
  const focal = focalBoxes.length ? buildFocal(focalBoxes, quality) : null;
  if (focal) { group.add(focal.group); calls += focal.calls; }
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
  let lastT = 0;
  return {
    group,
    sun,
    drawCalls: calls,
    pinata: pinata?.view,
    setBrightness(k: number) {
      hemi.intensity = th.hemi[2] * k;
      sun.intensity = th.sun[1] * (0.85 + 0.15 * k);
    },
    update(t: number) {
      lines.children.forEach((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) o.position.y = Math.sin(t * 1.3) * 0.03; });
      if (water) (water.material as THREE.MeshToonMaterial).emissive.setHSL(0.52, 0.6, 0.08 + Math.sin(t * 2) * 0.02);
      if (statue) statue.rotation.y = 0.4 + Math.sin(t * 0.3) * 0.1;
      focal?.update(t);
      const dt = Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      pinata?.step(dt, t);
    },
  };
}

/** The cream path ring and thin violet ring around El Patio's fountain, flush with the ground. */
function fountainRings(): THREE.Mesh {
  const part = (r0: number, r1: number, hex: number) => {
    const g = new THREE.RingGeometry(r0, r1, 64, 1);
    g.rotateX(-Math.PI / 2);
    const col = new THREE.Color(hex), n = g.getAttribute('position').count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  };
  const geo = mergeGeometries([part(3.9, 4.5, 0xe6d3ad), part(4.625, 4.875, 0x6e4a80)], false)!;
  const m = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ gradientMap: toonRamp(), vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.position.y = 0.004;
  m.receiveShadow = true;
  m.name = 'fountain-rings';
  return m;
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

// La Fiesta's piñata. Hitting it is just for fun: it spins and showers
// confetti from a fixed pool (nothing is allocated while playing).
function buildPinata(pp: { x: number; y: number; z: number }, group: THREE.Group): { view: NonNullable<WorldView['pinata']>; step(dt: number, t: number): void } {
  const pin = new THREE.Group();
  pin.name = 'pinata';
  pin.add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), toon(COLORS.marigold)));
  const coneGeo = new THREE.ConeGeometry(0.16, 0.62, 10);
  const cols = [COLORS.pink, COLORS.turquoise, COLORS.violet, COLORS.terracotta, COLORS.gold, COLORS.pink, COLORS.turquoise];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const c = new THREE.Mesh(coneGeo, toon(cols[i]!));
    c.position.set(Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0);
    c.rotation.z = a - Math.PI / 2;
    pin.add(c);
    const tail = new THREE.Mesh(UNIT, toon(cols[(i + 3) % 7]!));
    tail.scale.set(0.04, 0.5, 0.01);
    tail.position.set(Math.cos(a) * 0.95, Math.sin(a) * 0.95 - 0.3, 0);
    pin.add(tail);
  }
  pin.position.set(pp.x, pp.y, pp.z);
  group.add(pin);
  const top = 6.6;
  const rope = new THREE.Mesh(CYL, toon(COLORS.ink));
  rope.scale.set(0.03, top - (pp.y + 0.42), 0.03);
  rope.position.set(pp.x, (top + pp.y + 0.42) / 2, pp.z);
  group.add(rope);
  const N = 60;
  const confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.12, 0.08), toon(0xffffff, { side: THREE.DoubleSide }), N);
  confetti.frustumCulled = false;
  for (let i = 0; i < N; i++) confetti.setColorAt(i, new THREE.Color(cols[i % 7]!));
  confetti.count = 0;
  group.add(confetti);
  const vel = new Float32Array(N * 3), pos = new Float32Array(N * 3);
  const tmp = new THREE.Object3D();
  let spin = 0, burst = 0;
  return {
    view: {
      x: pp.x, y: pp.y, z: pp.z, r: 0.95,
      hit() {
        spin = Math.min(spin + 9, 16);
        burst = 1.6;
        for (let i = 0; i < N; i++) {
          pos[i * 3] = pp.x; pos[i * 3 + 1] = pp.y; pos[i * 3 + 2] = pp.z;
          vel[i * 3] = (Math.random() - 0.5) * 5; vel[i * 3 + 1] = Math.random() * 3; vel[i * 3 + 2] = (Math.random() - 0.5) * 5;
        }
        confetti.count = N;
      },
    },
    step(dt: number, t: number) {
      pin.rotation.z = Math.sin(t * 1.1) * 0.12;
      pin.rotation.y += spin * dt;
      spin = Math.max(0, spin - dt * 7);
      if (burst <= 0) return;
      burst -= dt;
      for (let i = 0; i < N; i++) {
        vel[i * 3 + 1] -= 6 * dt;
        pos[i * 3] += vel[i * 3]! * dt;
        pos[i * 3 + 1] = Math.max(0.02, pos[i * 3 + 1]! + vel[i * 3 + 1]! * dt);
        pos[i * 3 + 2] += vel[i * 3 + 2]! * dt;
        tmp.position.set(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
        tmp.rotation.set(t * 7 + i, t * 5 + i * 0.3, 0);
        tmp.updateMatrix();
        confetti.setMatrixAt(i, tmp.matrix);
      }
      confetti.instanceMatrix.needsUpdate = true;
      if (burst <= 0) confetti.count = 0;
    },
  };
}
