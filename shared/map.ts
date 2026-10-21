// El Patio: the authoritative layout. Every solid box here is gameplay
// collision AND the footprint the client renders, so what you see is what
// you collide with. Decoration added by the client never protrudes into
// walkable space.
//
// Layout (top view, x east, z south), point-symmetric about the origin so
// both teams get the same map:
//
//   z -19 ┌──────────── north houses ─────────────────────┐
//   z -15 │ CALLEJÓN (alley, chokepoint at the centre)     │
//   z -11 │ ▢open  [house][TERRAZA SOL][ café ]▢open[house]│
//   z  -8 │ CASA   ═══════════ LA PLAZA ════════════  CASA │
//         │ SOL  ▷door      fountain + statue     door◁ LUNA│
//   z   8 │ [house]▢open[panadería][TERRAZA LUNA][house]▢   │
//   z  11 │ EL MERCADO (market, chokepoint at the centre)   │
//   z  15 └──────────── south houses ─────────────────────┘

import { box, type AABB } from './collision';

export type Team = 0 | 1;

export type MatKey =
  | 'stuccoTerracotta' | 'stuccoCream' | 'stuccoTurquoise' | 'stuccoMarigold' | 'stuccoViolet' | 'stuccoPink'
  | 'stone' | 'wood' | 'planter' | 'fountain' | 'statue' | 'stall' | 'crate' | 'kiosk' | 'step' | 'parapet' | 'lintel' | 'bin';

export interface MapBox extends AABB {
  mat: MatKey;
  // Facade dressing hint for the renderer: which side faces public space.
  facade?: 'n' | 's' | 'e' | 'w';
  sign?: string;
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface Region {
  key: string; // i18n key suffix, e.g. 'plaza'
  minX: number; minZ: number; maxX: number; maxZ: number; minY?: number;
}

export interface PickupSpot {
  x: number;
  y: number;
  z: number;
}

export interface MapData {
  name: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  boxes: MapBox[];
  spawns: Record<Team, SpawnPoint[]>;
  waypoints: Array<{ x: number; y: number; z: number }>;
  regions: Region[];
  pickups: PickupSpot[];
}

const HALF_PI = Math.PI / 2;

function b(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, mat: MatKey, extra: Partial<MapBox> = {}): MapBox {
  return { ...box(minX, minY, minZ, maxX, maxY, maxZ, mat, true, true), mat, ...extra };
}

// Point reflection through the origin (180° rotation about the y axis).
function rot(m: MapBox, mat?: MatKey, sign?: string): MapBox {
  const flip: Record<string, 'n' | 's' | 'e' | 'w'> = { n: 's', s: 'n', e: 'w', w: 'e' };
  return {
    ...m,
    minX: -m.maxX, maxX: -m.minX, minZ: -m.maxZ, maxZ: -m.minZ,
    mat: mat ?? m.mat,
    facade: m.facade ? flip[m.facade] : undefined,
    sign: sign ?? m.sign,
  };
}

// Six steps of 0.45 m rising to a 2.7 m terrace. `dir` is the direction of
// travel going up; `at` is the coordinate of the top edge.
function stairs(axis: 'x' | 'z', dir: 1 | -1, at: number, from: number, to: number, mat: MatKey = 'step'): MapBox[] {
  const out: MapBox[] = [];
  const depth = 0.55;
  for (let k = 1; k <= 6; k++) {
    const h = 0.45 * k;
    // Step k sits (6 - k) treads below the top edge, against the travel direction.
    const far = at - dir * depth * (6 - k);
    const near = far - dir * depth;
    const a = Math.min(near, far), c = Math.max(near, far);
    out.push(axis === 'x' ? b(a, 0, from, c, h, to, mat) : b(from, 0, a, to, h, c, mat));
  }
  return out;
}

function build(): MapData {
  const half: MapBox[] = [];
  const centre: MapBox[] = [];

  // --- North houses (backdrop) and the alley chokepoint -------------------
  half.push(b(-27, 0, -19, -14, 8, -15, 'stuccoTurquoise', { facade: 's' }));
  half.push(b(-14, 0, -19, -1.5, 7, -15, 'stuccoCream', { facade: 's' }));
  half.push(b(-1.5, 0, -19, 1.5, 7.5, -13, 'stuccoPink', { facade: 's', sign: 'FARMACIA' }));
  half.push(b(1.5, 0, -19, 14, 7, -15, 'stuccoMarigold', { facade: 's' }));
  half.push(b(14, 0, -19, 27, 8.5, -15, 'stuccoViolet', { facade: 's' }));
  // The south backdrop is these boxes rotated 180° about the origin.

  // --- West spawn compound: Casa Sol --------------------------------------
  half.push(b(-27, 0, -15, -26, 6, 15, 'stuccoMarigold')); // outer west wall
  // Courtyard walls with doorways x∈[-24.5,-22.5].
  half.push(b(-26, 0, -6.8, -24.5, 3.2, -6.4, 'stuccoMarigold', { facade: 's' }));
  half.push(b(-22.5, 0, -6.8, -21, 3.2, -6.4, 'stuccoMarigold', { facade: 's' }));
  half.push(b(-24.5, 2.5, -6.8, -22.5, 3.2, -6.4, 'lintel'));
  half.push(b(-26, 0, 6.4, -24.5, 3.2, 6.8, 'stuccoMarigold', { facade: 'n' }));
  half.push(b(-22.5, 0, 6.4, -21, 3.2, 6.8, 'stuccoMarigold', { facade: 'n' }));
  half.push(b(-24.5, 2.5, 6.4, -22.5, 3.2, 6.8, 'lintel'));

  // Screen wall inside the compound so nobody can see into spawn through the door.
  half.push(b(-22.6, 0, -4.7, -22.2, 3.0, -0.8, 'stuccoMarigold'));

  // --- West separation (spawn to plaza) with a covered doorway ------------
  half.push(b(-21, 0, -11, -17, 6, -4, 'stuccoTerracotta', { facade: 'e', sign: 'CASA SOL' }));
  half.push(b(-21, 0, -1.5, -17, 6, 11, 'stuccoTerracotta', { facade: 'e' }));
  half.push(b(-21, 2.4, -4, -17, 6, -1.5, 'lintel')); // corridor ceiling

  // --- North row between the alley and the plaza --------------------------
  // Opening x∈[-17,-14.5] (alley to plaza, west).
  half.push(b(-14.5, 0, -11, -12, 5, -8, 'stuccoViolet', { facade: 's' }));
  // Terraza Sol: a 2.7 m terrace with a parapet, stairs from the plaza and from the alley.
  half.push(b(-12, 0, -11, -6, 2.7, -8, 'stone', { facade: 's' }));
  half.push(b(-12, 2.7, -8.25, -8.2, 3.6, -8, 'parapet'));
  half.push(...stairs('z', -1, -8, -8.2, -6)); // plaza stairs, going north (−z) up to z=-8
  half.push(b(-12, 0, -12.6, -10.4, 2.7, -11, 'stone')); // alley-side landing
  half.push(...stairs('x', 1, -12, -12.6, -11)); // alley stairs, going east (+x) up to x=-12
  half.push(b(-6, 0, -11, 3, 6, -8, 'stuccoCream', { facade: 's', sign: 'CAFÉ CHANCLA' }));
  // Opening x∈[3,5.5].
  half.push(b(5.5, 0, -11, 17, 5.5, -8, 'stuccoTurquoise', { facade: 's' }));

  // --- Alley dressing: cover that breaks up the long sightline -------------
  half.push(b(-19.5, 0, -14.6, -18.3, 1.1, -13.4, 'crate'));
  half.push(b(-8, 0, -15, -6.8, 1.3, -14.2, 'bin'));
  half.push(b(7.5, 0, -12.2, 9, 1.0, -11, 'crate'));

  // --- Plaza cover ---------------------------------------------------------
  half.push(b(-11, 0, 1.5, -8, 1.0, 2.5, 'planter'));
  half.push(b(-5.5, 0, -5.2, -3.5, 0.9, -4.5, 'stone')); // bench
  half.push(b(-13.6, 0, 3.6, -12, 2.6, 5.4, 'kiosk', { sign: 'PERIÓDICOS' }));
  half.push(b(-15.2, 0, -6.4, -14.2, 1.0, -5.0, 'crate'));
  half.push(b(-3.5, 0, 5.2, -1.9, 0.9, 6.6, 'planter'));

  // --- Fountain (self-symmetric) ------------------------------------------
  centre.push(b(-2.5, 0, -2.5, 2.5, 0.85, 2.5, 'fountain'));
  centre.push(b(-1.1, 0.85, -1.1, 1.1, 4.4, 1.1, 'statue'));

  // Rotate the half map to produce the east/south half.
  const variants: Partial<Record<MatKey, MatKey>> = {
    stuccoTurquoise: 'stuccoTerracotta', stuccoCream: 'stuccoMarigold', stuccoPink: 'stuccoViolet',
    stuccoMarigold: 'stuccoTurquoise', stuccoTerracotta: 'stuccoTurquoise', stuccoViolet: 'stuccoPink',
  };
  const signs: Record<string, string> = { 'CASA SOL': 'CASA LUNA', 'CAFÉ CHANCLA': 'PANADERÍA ROSA', FARMACIA: 'TIENDA', 'PERIÓDICOS': 'ELOTES' };
  const other = half.map((m) => rot(m, variants[m.mat], m.sign ? signs[m.sign] ?? m.sign : undefined));

  // Outer north/south boundary (also covers the far corners).
  const bounds: MapBox[] = [
    b(-28, 0, -20, 28, 9, -19, 'stuccoCream'),
    b(-28, 0, 19, 28, 9, 20, 'stuccoCream'),
    b(-28, 0, -20, -27, 9, 20, 'stuccoCream'),
    b(27, 0, -20, 28, 9, 20, 'stuccoCream'),
  ];

  const boxes = [...half, ...other, ...centre, ...bounds];

  const solSpawns: SpawnPoint[] = [
    { x: -24.6, y: 0, z: -4.2, yaw: -HALF_PI },
    { x: -24.6, y: 0, z: 0, yaw: -HALF_PI },
    { x: -24.6, y: 0, z: 4.2, yaw: -HALF_PI },
    { x: -23.4, y: 0, z: -2.6, yaw: -HALF_PI },
    { x: -22.6, y: 0, z: 2.4, yaw: -HALF_PI },
  ];
  const lunaSpawns = solSpawns.map((s) => ({ x: -s.x, y: 0, z: -s.z, yaw: HALF_PI }));

  // Bot navigation nodes for one half; the other half is rotated. Links are
  // computed by actually simulating a walk between nodes (see nav.ts).
  const wpHalf: Array<[number, number, number]> = [
    // Casa Sol courtyard and its exits
    [-24.6, 0, -4], [-24.6, 0, 0], [-24.6, 0, 4], [-23.4, 0, -2.6], [-21.6, 0, -5.3], [-21.6, 0, -0.2],
    [-23.5, 0, -8.5], [-23.5, 0, -12.8], [-23.5, 0, 8.5],
    [-19, 0, -2.75], [-15.8, 0, -2.75],
    // Alley (west half)
    [-20.5, 0, -12.2], [-16, 0, -14], [-15.8, 0, -9.5], [-13.5, 0, -13.8], [-9.5, 0, -13.5],
    [-5, 0, -12.2], [-2.6, 0, -12], [0, 0, -12],
    // Terraza Sol (top) and its stairs
    [-9.2, 2.7, -9.6], [-11, 2.7, -9.6], [-7.1, 2.7, -9.4], [-11.2, 2.7, -11.8],
    [-7.1, 0, -4.1], [-15.9, 0, -11.8],
    // Plaza (west half)
    [-14.8, 0, -1.5], [-14.5, 0, 6.5], [-11.5, 0, -3.5], [-9.5, 0, -6.5], [-9.5, 0, 0], [-10, 0, 4.2],
    [-6.5, 0, -2.5], [-6, 0, 3.5], [-4.2, 0, -6.6], [-4, 0, 0], [-3.8, 0, 3.6], [0, 0, -4.2], [-1, 0, 7.2],
    [-15.6, 0, 7.5], [4.25, 0, -9.5],
  ];
  const waypoints = [...wpHalf, ...wpHalf.map(([x, y, z]) => [-x, y, -z] as [number, number, number])]
    .map(([x, y, z]) => ({ x, y, z }));

  const regions: Region[] = [
    { key: 'terrazaSol', minX: -12, maxX: -6, minZ: -11, maxZ: -8, minY: 2 },
    { key: 'terrazaLuna', minX: 6, maxX: 12, minZ: 8, maxZ: 11, minY: 2 },
    { key: 'casaSol', minX: -27, maxX: -17, minZ: -6.8, maxZ: 6.8 },
    { key: 'casaLuna', minX: 17, maxX: 27, minZ: -6.8, maxZ: 6.8 },
    { key: 'fuente', minX: -4, maxX: 4, minZ: -4, maxZ: 4 },
    { key: 'callejon', minX: -27, maxX: 27, minZ: -19, maxZ: -11 },
    { key: 'mercado', minX: -27, maxX: 27, minZ: 11, maxZ: 19 },
    { key: 'plaza', minX: -17, maxX: 17, minZ: -11, maxZ: 11 },
  ];

  return {
    name: 'El Patio',
    bounds: { minX: -27, maxX: 27, minZ: -19, maxZ: 19 },
    boxes,
    spawns: { 0: solSpawns, 1: lunaSpawns },
    waypoints,
    regions,
    pickups: [{ x: -13, y: 0, z: -6.6 }, { x: 13, y: 0, z: 6.6 }],
  };
}

export const EL_PATIO: MapData = build();

export function regionAt(map: MapData, x: number, y: number, z: number): string {
  for (const r of map.regions) {
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ && (r.minY === undefined || y >= r.minY)) return r.key;
  }
  return 'plaza';
}
