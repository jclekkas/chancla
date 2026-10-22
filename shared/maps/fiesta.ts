// La Fiesta: a party courtyard. Small and close-range: hedge-lined lanes on
// the north and south, the party floor in between with long tables and
// stacks of presents, and the piñata hanging high over the dance floor in
// the middle. Hedges are 1.3 m (cover when crouched, see-over when standing)
// or 1.9 m (full cover), so fights stay readable. Point-symmetric.
//
//   z -14 ┌────────────── salón (north houses) ─────────────┐
//   z -12 │ CARRIL NORTE   crates   [tarima]          bin    │
//   z  -7 │ ▓hedge▓▓▓▓▓     gap      ▓▓▓▓tall hedge▓▓        │
//         │ SOL ▯ tables   gifts    (piñata)   gifts  tables ▯ LUNA
//   z   7 │        ▓▓tall hedge▓▓▓▓    gap     ▓▓▓▓▓hedge▓   │
//   z  12 │ bin          [tarima]   crates     CARRIL SUR    │
//   z  14 └──────────────────────────────────────────────────┘
import { b, rot, type MapBox, type MapData, type SpawnPoint, type Region, type Team } from '../map';

const HALF_PI = Math.PI / 2;

function build(): MapData {
  const half: MapBox[] = [];

  // --- North houses -----------------------------------------------------------
  half.push(b(-21, 0, -14, -8, 6, -12, 'stuccoViolet', { facade: 's' }));
  half.push(b(-8, 0, -14, 8, 6.5, -12, 'stuccoPink', { facade: 's', sign: 'SALÓN DE FIESTAS' }));
  half.push(b(8, 0, -14, 21, 6, -12, 'stuccoTurquoise', { facade: 's' }));

  // --- Sol spawn nook (west) --------------------------------------------------
  // Side walls run past the screen, so the nook only opens to the east.
  half.push(b(-21, 0, -7, -14.8, 2.6, -6.4, 'stuccoMarigold'));
  half.push(b(-21, 0, 6.4, -14.8, 2.6, 7, 'stuccoMarigold'));
  half.push(b(-16.4, 0, -4.2, -15.8, 2.6, 4.2, 'stuccoMarigold', { facade: 'e' })); // screen with the team banner

  // --- North lane ---------------------------------------------------------------
  half.push(b(-11, 0, -11.8, -10, 1.0, -10.8, 'crate'));
  half.push(b(-9.6, 0, -11.8, -8.6, 1.0, -10.8, 'crate'));
  half.push(b(6, 0, -9.2, 6.8, 1.1, -8.4, 'bin'));
  // Tarima: the band's low stage, one step up from the lane (1 m).
  half.push(b(-3, 0, -12, 3, 1.0, -10, 'stage'));
  half.push(b(-3, 0, -10, 3, 0.5, -9.4, 'step'));

  // --- Hedges between the lane and the party floor (gaps at the ends and middle) --
  half.push(b(-13.2, 0, -7.6, -6.5, 1.3, -7, 'hedge'));
  half.push(b(-2, 0, -7.6, 6, 1.9, -7, 'hedge'));

  // --- Party floor (west half) ---------------------------------------------------
  half.push(b(-12, 0, -4.5, -9.2, 0.78, -3.5, 'table'));
  half.push(b(-12, 0, 2, -9.2, 0.78, 3, 'table'));
  half.push(b(-6.5, 0, -1.5, -3.7, 0.78, -0.5, 'table'));
  half.push(b(-7.6, 0, 3.8, -6.6, 0.78, 6.4, 'table'));
  half.push(b(-9, 0, -1, -8, 1.7, 0, 'gift'));
  half.push(b(-3, 0, 3.5, -2, 1.7, 4.5, 'gift'));
  half.push(b(-14.2, 0, -1.2, -13.2, 1.2, 1.2, 'gift'));

  const variants: Partial<Record<string, MapBox['mat']>> = { stuccoViolet: 'stuccoTerracotta', stuccoPink: 'stuccoCream', stuccoTurquoise: 'stuccoMarigold', stuccoMarigold: 'stuccoTurquoise' };
  const signs: Record<string, string> = { 'SALÓN DE FIESTAS': 'DULCERÍA' };
  const other = half.map((m) => rot(m, variants[m.mat], m.sign ? signs[m.sign] ?? m.sign : undefined));

  const bounds: MapBox[] = [
    b(-22, 0, -15, 22, 8, -14, 'stuccoCream'),
    b(-22, 0, 14, 22, 8, 15, 'stuccoCream'),
    b(-22, 0, -15, -21, 8, 15, 'stuccoCream'),
    b(21, 0, -15, 22, 8, 15, 'stuccoCream'),
  ];

  const solSpawns: SpawnPoint[] = [-1.8, -0.9, 0, 0.9, 1.8].map((z) => ({ x: -19.4, y: 0, z, yaw: -HALF_PI }));
  const lunaSpawns = solSpawns.map((s) => ({ x: -s.x, y: 0, z: -s.z, yaw: HALF_PI }));

  const wpHalf: Array<[number, number, number]> = [
    // Sol nook and its two exits round the screen
    [-19.4, 0, -1.8], [-19.4, 0, 0], [-19.4, 0, 1.8], [-18.5, 0, -5.2], [-18.5, 0, 5.2], [-15, 0, -5.4], [-15, 0, 5.4],
    // North lane
    [-19.5, 0, -9.5], [-15.5, 0, -9.5], [-12.5, 0, -9.5], [-10, 0, -9.4], [-7, 0, -10.5], [-4.2, 0, -10.8], [-4, 0, -8.6],
    [0, 0, -8.6], [4, 0, -8.6], [4.2, 0, -10.8], [8, 0, -10.5], [11, 0, -9.5], [15, 0, -9.5], [19.5, 0, -9.5],
    [0, 1.0, -11], [-2, 1.0, -11], [2, 1.0, -11],
    // Gaps through the hedges
    [-14, 0, -7.3], [-4.2, 0, -7.3], [10, 0, -7.3],
    // Party floor (west half)
    [-13, 0, -5.5], [-12.5, 0, -2], [-12.5, 0, 4.5], [-10.5, 0, -0.5], [-10.5, 0, 5.5], [-7.5, 0, -5.5], [-7.5, 0, -2.6],
    [-7.5, 0, 1.6], [-5, 0, 2], [-4.5, 0, 5.8], [-3, 0, -3.6], [-1.5, 0, 0], [0, 0, -2.6], [-9.6, 0, 1.2],
  ];
  const waypoints = [...wpHalf, ...wpHalf.map(([x, y, z]) => [-x, y, -z] as [number, number, number])].map(([x, y, z]) => ({ x, y, z }));

  const regions: Region[] = [
    { key: 'casaSol', minX: -21, maxX: -15.8, minZ: -6.4, maxZ: 6.4 },
    { key: 'casaLuna', minX: 15.8, maxX: 21, minZ: -6.4, maxZ: 6.4 },
    { key: 'tarima', minX: -3, maxX: 3, minZ: -12, maxZ: -9.4 },
    { key: 'tarima', minX: -3, maxX: 3, minZ: 9.4, maxZ: 12 },
    { key: 'carrilNorte', minX: -21, maxX: 21, minZ: -12, maxZ: -7 },
    { key: 'carrilSur', minX: -21, maxX: 21, minZ: 7, maxZ: 12 },
    { key: 'pista', minX: -3.5, maxX: 3.5, minZ: -3.5, maxZ: 3.5 },
    { key: 'fiesta', minX: -21, maxX: 21, minZ: -7, maxZ: 7 },
  ];

  return {
    id: 'fiesta',
    name: 'La Fiesta',
    bounds: { minX: -21, maxX: 21, minZ: -14, maxZ: 14 },
    boxes: [...half, ...other, ...bounds],
    spawns: { 0: solSpawns, 1: lunaSpawns } as Record<Team, SpawnPoint[]>,
    waypoints,
    regions,
    pickups: [{ x: -12.5, y: 0, z: -9.5 }, { x: 12.5, y: 0, z: 9.5 }],
    decor: {
      ground: { w: 44, d: 30 },
      papel: [-5, 0, 5].map((z) => [-20, z - 1, 20, z + 1, 5.2] as [number, number, number, number, number]),
      lights: [[-20, -11.6, 20, 11.6, 6.6], [-20, 11.6, 20, -11.6, 6.6], [-20, -9.5, 20, -9.5, 5.6], [-20, 9.5, 20, 9.5, 5.6]],
      banners: [-1, 1].flatMap((s) => [-2.4, 2.4].map((z) => ({ x: s * 15.76, z: s * z, ry: Math.PI / 2, team: (s < 0 ? 0 : 1) as Team }))),
      emblems: [-1, 1].map((s) => ({ x: s * 15.74, y: 2.0, z: 0, ry: s < 0 ? Math.PI / 2 : -Math.PI / 2, team: (s < 0 ? 0 : 1) as Team })),
      pinata: { x: 0, y: 3.9, z: 0 },
      danceFloor: { x: 0, z: 0, r: 3.2 },
    },
    arcade: {
      playerStart: { x: 0, z: 4.5, yaw: 0 },
      entrances: [
        { x: -19.4, z: 0, entryX: -15, entryZ: -5.4 },
        { x: 19.4, z: 0, entryX: 15, entryZ: 5.4 },
        { x: -19.5, z: -9.5, entryX: -14, entryZ: -7.3 },
        { x: 19.5, z: 9.5, entryX: 14, entryZ: 7.3 },
        { x: 19.5, z: -9.5, entryX: 10, entryZ: -7.3 },
        { x: -19.5, z: 9.5, entryX: -10, entryZ: 7.3 },
      ],
      boss: { x: 0, y: 1.0, z: -11.2, waveX: 0, waveZ: -9 },
      pickups: [{ x: -12.5, z: -2 }, { x: 12.5, z: 2 }, { x: -7.5, z: 1.6 }, { x: 7.5, z: -1.6 }],
      dummies: [{ x: -2, z: 1.5 }, { x: 2.5, z: 0.5 }, { x: 0, z: 2.5 }],
    },
  };
}

export const LA_FIESTA: MapData = build();
