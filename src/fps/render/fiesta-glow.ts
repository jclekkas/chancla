// La Fiesta's party light at dusk, baked (no dynamic lights). Owned by the
// La Fiesta workstream; used by fiesta-dressing.ts.
//
// The fixtures are the string-light bulbs (the same catenaries world.ts
// draws from decor.lights), footlights along each tarima's front and a
// little farolito on every party table. Their light is evaluated once at
// build time:
//  - on the paving, as one flat additive mesh of soft warm pools (a grid
//    on the ground, only where the light is worth drawing);
//  - on the props' own vertex colours (leaves, cloth, paper, cantera), a
//    gentle warm lift on the faces that look towards a fixture.
// Nothing here moves, flickers or adds collision: the pools lie on the ground.
import * as THREE from 'three';
import type { MapBox, MapDecor } from '../../../shared/map';
import type { Quality } from '../settings';

export interface Fixture {
  x: number; y: number; z: number;
  /** Reach in metres (the light falls smoothly to nothing there). */
  r: number;
  /** Linear-ish strength per channel at the fixture (before the per-use scale). */
  c: readonly [number, number, number];
}

/** Warm bulb light, a touch of rose (the strings mix pink, cream and turquoise bulbs). */
const BULB: readonly [number, number, number] = [1, 0.66, 0.36];
/** Footlights and farolitos: candle amber. */
const AMBER: readonly [number, number, number] = [1, 0.6, 0.24];

/** The bulb positions world.ts draws for decor.lights (same catenary: 23 bulbs, 1.1 m sag). */
export function bulbPositions(lights: MapDecor['lights']): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (const [ax, az, bx, bz, y] of lights ?? []) {
    const n = 22;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      out.push([ax + (bx - ax) * t, y - Math.sin(t * Math.PI) * 1.1 - 0.1, az + (bz - az) * t]);
    }
  }
  return out;
}

/** Where a tarima's footlights sit: along the front (the side facing the arena's middle). */
export function stageFront(b: MapBox): { side: 'n' | 's' | 'e' | 'w'; y: number } {
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, alongX = b.maxX - b.minX >= b.maxZ - b.minZ;
  const side = alongX ? (cz < 0 ? 's' : 'n') : (cx < 0 ? 'e' : 'w');
  return { side, y: b.maxY - 0.1 };
}

export function fiestaFixtures(boxes: readonly MapBox[], decor: Pick<MapDecor, 'lights'>): Fixture[] {
  const fx: Fixture[] = bulbPositions(decor.lights).map(([x, y, z]) => ({ x, y, z, r: 7.5, c: BULB }));
  for (const b of boxes) {
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    if (b.mat === 'stage') {
      // The footlight row as three soft sources along the front, a little out from it.
      const { side, y } = stageFront(b);
      for (const u of [0.2, 0.5, 0.8]) {
        const x = side === 'e' ? b.maxX + 0.3 : side === 'w' ? b.minX - 0.3 : b.minX + (b.maxX - b.minX) * u;
        const z = side === 's' ? b.maxZ + 0.3 : side === 'n' ? b.minZ - 0.3 : b.minZ + (b.maxZ - b.minZ) * u;
        fx.push({ x, y, z, r: 4.2, c: AMBER });
      }
    } else if (b.mat === 'table') {
      fx.push({ x: cx, y: b.maxY - 0.02, z: cz, r: 2.6, c: AMBER });
    }
  }
  return fx;
}

/**
 * Light reaching a point with normal n from the fixtures. `ground` weights
 * (scales) the bulbs and the low fixtures separately, so the paving pools
 * and the props' lift can be tuned apart.
 */
export function lightAt(fx: readonly Fixture[], x: number, y: number, z: number, nx: number, ny: number, nz: number, wBulb: number, wLow: number, out: [number, number, number]): [number, number, number] {
  out[0] = out[1] = out[2] = 0;
  for (const f of fx) {
    const dx = f.x - x, dy = f.y - y, dz = f.z - z, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= f.r * f.r) continue;
    const d = Math.sqrt(d2) || 1e-3, fall = (1 - d2 / (f.r * f.r)) ** 2;
    // Half-wrapped Lambert, so faces turned a little away still pick up some.
    const cos = Math.max(0, 0.3 + 0.7 * ((nx * dx + ny * dy + nz * dz) / d));
    const k = fall * cos * (f.c === BULB ? wBulb : wLow);
    out[0] += f.c[0] * k; out[1] += f.c[1] * k; out[2] += f.c[2] * k;
  }
  return out;
}

/** Ground pool strength (sRGB-space add at the brightest point under a lone string). */
const POOL_BULB = 0.17, POOL_LOW = 0.3, POOL_MAX = 0.26;

/**
 * The warm pools on the paving: a grid over the arena floor (cells of 0.5 m
 * on High and Medium, 1 m on Low), colours = the fixtures' light, kept only
 * where some light falls. Flat at y = 0.01, normals up. Drawn additively in
 * the output's sRGB space (the colours are stored linear so the output
 * conversion returns the sRGB add).
 */
/** Paving pools from the bulbs: one soft round pool under each bulb (reach in metres), merging into a scalloped band. */
const BULB_POOL_R = 1.9;

/** Light on the paving at (x, z): the bulbs as pools straight under them, the low fixtures as lights. */
function poolAt(fx: readonly Fixture[], x: number, z: number, out: [number, number, number]): [number, number, number] {
  lightAt(fx, x, 0, z, 0, 1, 0, 0, POOL_LOW, out);
  for (const f of fx) {
    if (f.c !== BULB) continue;
    const d2 = (f.x - x) ** 2 + (f.z - z) ** 2;
    if (d2 >= BULB_POOL_R * BULB_POOL_R) continue;
    const k = (1 - d2 / (BULB_POOL_R * BULB_POOL_R)) ** 2 * POOL_BULB;
    out[0] += f.c[0] * k; out[1] += f.c[1] * k; out[2] += f.c[2] * k;
  }
  return out;
}

export function groundGlow(fx: readonly Fixture[], bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, quality: Quality): THREE.BufferGeometry | null {
  const cell = quality === 'low' ? 1 : 0.5, y = 0.01;
  const nx = Math.round((bounds.maxX - bounds.minX) / cell), nz = Math.round((bounds.maxZ - bounds.minZ) / cell);
  const L: Array<[number, number, number]> = [], tmp: [number, number, number] = [0, 0, 0];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = bounds.minX + i * cell, z = bounds.minZ + j * cell;
    poolAt(fx, x, z, tmp);
    const m = Math.max(tmp[0], tmp[1], tmp[2]), s = m > POOL_MAX ? POOL_MAX / m : 1;
    L.push([tmp[0] * s, tmp[1] * s, tmp[2] * s]);
  }
  const pos: number[] = [], col: number[] = [], idx: number[] = [], map = new Map<number, number>();
  const c = new THREE.Color();
  const vert = (i: number, j: number) => {
    const key = j * (nx + 1) + i;
    let v = map.get(key);
    if (v === undefined) {
      v = pos.length / 3; map.set(key, v);
      const l = L[key]!;
      pos.push(bounds.minX + i * cell, y, bounds.minZ + j * cell);
      c.setRGB(l[0], l[1], l[2], THREE.SRGBColorSpace);
      col.push(c.r, c.g, c.b);
    }
    return v;
  };
  const lit = (i: number, j: number) => { const l = L[j * (nx + 1) + i]!; return l[0] > 0.012; };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (!lit(i, j) && !lit(i + 1, j) && !lit(i, j + 1) && !lit(i + 1, j + 1)) continue;
    const a = vert(i, j), b = vert(i + 1, j), cc = vert(i + 1, j + 1), d = vert(i, j + 1);
    idx.push(a, d, cc, a, cc, b);
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const n = new Float32Array(pos.length);
  for (let i = 1; i < n.length; i += 3) n[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  g.setIndex(idx);
  return g;
}

/** Prop lift: how much the fixtures brighten a prop's vertex colours (multiplier - 1, per channel). */
const LIFT_BULB = 0.09, LIFT_LOW = 0.5, LIFT_MAX = 0.6;

/**
 * Brightens a geometry's vertex colours by the fixtures' light: colour *=
 * 1 + light, warmer where the light is warmer. Acts like extra warm light on
 * the faces that look at a fixture, in sun and in shade alike.
 */
export function bakeLift(g: THREE.BufferGeometry, fx: readonly Fixture[], scale = 1): void {
  const p = g.getAttribute('position'), n = g.getAttribute('normal'), col = g.getAttribute('color');
  if (!p || !n || !col) return;
  const tmp: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < p.count; i++) {
    lightAt(fx, p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i), LIFT_BULB * scale, LIFT_LOW * scale, tmp);
    const m = Math.max(tmp[0], tmp[1], tmp[2]), s = m > LIFT_MAX ? LIFT_MAX / m : 1;
    col.setXYZ(i, col.getX(i) * (1 + tmp[0] * s), col.getY(i) * (1 + tmp[1] * s), col.getZ(i) * (1 + tmp[2] * s));
  }
  col.needsUpdate = true;
}

/** Materials: the additive pools and the lit fixtures (bulb glass, unlit and bright). */
export function glowMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
}

export function lampMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
}

/** Lamp colours: warm glass, its hot core. */
export const LAMP = { glass: 0xffc46a, core: 0xfff1c4, tin: 0x5a4636 } as const;
