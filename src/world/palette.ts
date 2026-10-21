import * as THREE from 'three';

export const PALETTE = {
  terracotta: 0xc8553d,
  terracottaDark: 0x9c3d2c,
  turquoise: 0x4fb3a9,
  turquoiseFaded: 0x7cc4b8,
  marigold: 0xf2a33a,
  marigoldDeep: 0xe8871e,
  cream: 0xf4e6c8,
  creamDark: 0xe2cfa6,
  violet: 0x4b2a6b,
  violetDeep: 0x2e1846,
  pink: 0xe86a8d,
  leaf: 0x5c9a4a,
  leafDark: 0x3f7537,
  skin1: 0xc68a5e,
  skin2: 0x9b6740,
  skin3: 0xe0ad84,
  wood: 0x8a5a3b,
  ink: 0x241626,
  gold: 0xf5c542,
  white: 0xffffff,
  grey: 0x6d6a72,
  water: 0x58c2c9,
};

// Shared material cache. Every mesh with the same colour and flags reuses
// one material, which keeps state changes and memory low.
const cache = new Map<string, THREE.Material>();

export function lambert(color: number, opts: { emissive?: number; flat?: boolean; side?: THREE.Side } = {}): THREE.MeshLambertMaterial {
  const key = `l:${color}:${opts.emissive ?? 0}:${opts.flat ? 1 : 0}:${opts.side ?? 0}`;
  let m = cache.get(key) as THREE.MeshLambertMaterial | undefined;
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color,
      emissive: opts.emissive ?? 0x000000,
      flatShading: !!opts.flat,
      side: opts.side ?? THREE.FrontSide,
    });
    cache.set(key, m);
  }
  return m;
}

export function basic(color: number, opts: { transparent?: boolean; opacity?: number; additive?: boolean; side?: THREE.Side; depthWrite?: boolean } = {}): THREE.MeshBasicMaterial {
  const key = `b:${color}:${opts.transparent ? 1 : 0}:${opts.opacity ?? 1}:${opts.additive ? 1 : 0}:${opts.side ?? 0}:${opts.depthWrite ?? 'd'}`;
  let m = cache.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color,
      transparent: !!opts.transparent,
      opacity: opts.opacity ?? 1,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: opts.side ?? THREE.FrontSide,
      depthWrite: opts.depthWrite ?? !opts.transparent,
    });
    cache.set(key, m);
  }
  return m;
}

// Shared unit geometries. Meshes scale these rather than allocating new ones.
export const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(0.5, 10, 8),
  sphereLo: new THREE.IcosahedronGeometry(0.5, 0),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
  cylLo: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
  cone: new THREE.ConeGeometry(0.5, 1, 8),
  plane: new THREE.PlaneGeometry(1, 1),
};

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, sx = 1, sy = 1, sz = 1, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  return m;
}

export function boxMesh(color: number, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0): THREE.Mesh {
  return mesh(GEO.box, lambert(color), sx, sy, sz, x, y, z);
}
