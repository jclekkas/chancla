// La Plaza: a neighbourhood square. Long sightlines across the low central
// fountain, market stalls and a kiosk for cover in the open, and covered
// arcade walkways along the north and south edges as protected flanking
// routes. Point-symmetric about the origin like El Patio, so both teams get
// the same map.
//
//   z -18 ┌──────────────── north houses ───────────────────────┐
//   z -15 │ PORTAL NORTE (covered walkway, pillars)  ▓▓ (closed) │
//   z -10 │ ═══╡open╞═════╡open╞═══[tarima]═══╡open╞═══╡open╞═══ │
//         │ CASA ▯          stalls   fountain   stalls      CASA │
//         │ SOL  ▯door                                 door▯ LUNA│
//   z  10 │ ═══ (mirror) ══════════════════════════════════════  │
//   z  15 │ (closed) ▓▓   PORTAL SUR                             │
//   z  18 └──────────────── south houses ───────────────────────┘
//
// No spawn faces the other: each compound hides its spawn points behind a
// screen wall, and its exits open onto stalls, not onto the far spawn.
import { b, rot, type MapBox, type MapData, type SpawnPoint, type Region, type Team } from '../map';

const HALF_PI = Math.PI / 2;
const WALL = 3.4; // arcade and compound walls
const LINTEL = 2.6; // underside of the lintels over openings (above any jump)

function build(): MapData {
  const half: MapBox[] = [];
  const centre: MapBox[] = [];

  // --- North backdrop -------------------------------------------------------
  half.push(b(-30, 0, -18, -18, 8, -15, 'stuccoTurquoise', { facade: 's' }));
  half.push(b(-18, 0, -18, -6, 7, -15, 'stuccoCream', { facade: 's', sign: 'PANADERÍA' }));
  half.push(b(-6, 0, -18, 6, 7.5, -15, 'stuccoPink', { facade: 's', sign: 'CAFÉ LA PLAZA' }));
  half.push(b(6, 0, -18, 18, 7, -15, 'stuccoMarigold', { facade: 's' }));
  half.push(b(18, 0, -18, 30, 8.5, -15, 'stuccoViolet', { facade: 's' }));
  // The walkway's east end is closed by a house (no dead-end pocket).
  half.push(b(23, 0, -15, 30, 6.5, -10, 'stuccoViolet', { facade: 'w' }));

  // --- Portal Norte: the arcade wall with four openings, lintels above them --
  const arcadeWall: Array<[number, number]> = [[-23, -18], [-15.5, -7], [-4.5, 7], [9.5, 16.5], [19, 23]];
  for (const [x0, x1] of arcadeWall) half.push(b(x0, 0, -10.6, x1, WALL, -10, 'stone', { facade: 's' }));
  for (const [x0, x1] of [[-18, -15.5], [-7, -4.5], [7, 9.5], [16.5, 19]] as const) half.push(b(x0, LINTEL, -10.6, x1, WALL, -10, 'lintel'));
  // Pillars down the walkway: cover, with two clear lanes either side.
  for (const x of [-20, -11, -2, 6, 14]) half.push(b(x - 0.3, 0, -13.1, x + 0.3, WALL, -12.5, 'stuccoCream'));
  half.push(b(-15, 0, -14.9, -13.8, 1.0, -13.9, 'crate'));
  half.push(b(1, 0, -14.9, 1.8, 1.1, -14.1, 'bin'));

  // --- Casa Sol (west spawn compound) ----------------------------------------
  // North wall with a door at its east end, into the corridor behind the screen.
  half.push(b(-30, 0, -10.6, -25.2, WALL, -10, 'stuccoMarigold'));
  half.push(b(-25.2, LINTEL, -10.6, -23.6, WALL, -10, 'lintel'));
  half.push(b(-30, 0, 10, -23, WALL, 10.6, 'stuccoMarigold')); // south wall, closed
  // Inner wall onto the square, two exits.
  half.push(b(-23.6, 0, -10, -23, WALL, -7.5, 'stuccoMarigold'));
  half.push(b(-23.6, 0, -5, -23, WALL, 5, 'stuccoMarigold', { facade: 'e', sign: 'CASA SOL' }));
  half.push(b(-23.6, 0, 7.5, -23, WALL, 10, 'stuccoMarigold'));
  half.push(b(-23.6, LINTEL, -7.5, -23, WALL, -5, 'lintel'));
  half.push(b(-23.6, LINTEL, 5, -23, WALL, 7.5, 'lintel'));
  // Screen wall: nobody sees the spawn points through any exit.
  half.push(b(-25.6, 0, -4.4, -25.2, 2.8, 4.4, 'stuccoMarigold'));
  // ...and a short wall north of the spawn points, so the walkway door sees only the corridor.
  half.push(b(-30, 0, -6, -25.6, 2.8, -5.6, 'stuccoMarigold'));

  // --- The square (west half) -------------------------------------------------
  half.push(b(-19, 0, -6.8, -16.6, 1.1, -5.6, 'stall'));
  half.push(b(-12.5, 0, 5.2, -10.1, 1.1, 6.4, 'stall'));
  half.push(b(-7.5, 0, -6.6, -5.1, 1.1, -5.4, 'stall'));
  half.push(b(-13.5, 0, -2.4, -12, 2.6, -0.6, 'kiosk', { sign: 'PERIÓDICOS' }));
  half.push(b(-6, 0, 2, -4.8, 0.9, 3.2, 'planter'));
  half.push(b(-18, 0, 1.8, -16, 0.5, 2.3, 'stone')); // bench
  half.push(b(-20.5, 0, 7.6, -19.5, 1.0, 8.6, 'crate'));
  // Tarima Norte: a low stage against the arcade wall, two steps up (1 m).
  half.push(b(-4, 0, -10, 4, 1.0, -7.5, 'stage'));
  half.push(b(-4, 0, -7.5, 4, 0.5, -6.9, 'step'));

  // --- Fountain (self-symmetric): low enough to see over when standing -------
  centre.push(b(-2.6, 0, -2.6, 2.6, 0.85, 2.6, 'fountain'));
  centre.push(b(-0.8, 0.85, -0.8, 0.8, 1.45, 0.8, 'fountain'));

  const variants: Partial<Record<string, MapBox['mat']>> = {
    stuccoTurquoise: 'stuccoTerracotta', stuccoCream: 'stuccoCream', stuccoPink: 'stuccoViolet',
    stuccoMarigold: 'stuccoTurquoise', stuccoViolet: 'stuccoPink',
  };
  const signs: Record<string, string> = { 'CASA SOL': 'CASA LUNA', 'CAFÉ LA PLAZA': 'MERCADITO', 'PANADERÍA': 'TORTILLERÍA', 'PERIÓDICOS': 'AGUAS FRESCAS' };
  const other = half.map((m) => rot(m, variants[m.mat], m.sign ? signs[m.sign] ?? m.sign : undefined));

  const bounds: MapBox[] = [
    b(-31, 0, -19, 31, 9, -18, 'stuccoCream'),
    b(-31, 0, 18, 31, 9, 19, 'stuccoCream'),
    b(-31, 0, -19, -30, 9, 19, 'stuccoCream'),
    b(30, 0, -19, 31, 9, 19, 'stuccoCream'),
  ];

  const solSpawns: SpawnPoint[] = [-3, -1.5, 0, 1.5, 3].map((z) => ({ x: -28.2, y: 0, z, yaw: -HALF_PI }));
  const lunaSpawns = solSpawns.map((s) => ({ x: -s.x, y: 0, z: -s.z, yaw: HALF_PI }));

  const wpHalf: Array<[number, number, number]> = [
    // Casa Sol
    [-28.2, 0, -3], [-28.2, 0, 0], [-28.2, 0, 3], [-26.2, 0, -5], [-27.2, 0, 6.2], [-24.4, 0, -6.2], [-24.4, 0, 6.2],
    [-24.4, 0, -8.7], [-24.4, 0, 0], [-21.5, 0, -6.2], [-21.5, 0, 6.2], [-24.4, 0, -11.8],
    // Portal Norte, two lanes either side of the pillars
    [-27.5, 0, -11.6], [-27.5, 0, -14], [-22, 0, -11.6], [-16.8, 0, -11.6], [-13, 0, -11.6], [-8, 0, -11.6], [-5.8, 0, -11.6],
    [-2, 0, -11.6], [2, 0, -11.6], [5, 0, -11.6], [8.3, 0, -11.6], [11, 0, -11.6], [17.7, 0, -11.6], [21.5, 0, -11.6],
    [-24, 0, -14], [-16, 0, -14], [-7, 0, -14], [4, 0, -14], [10, 0, -14], [18, 0, -14], [21.5, 0, -14],
    // Openings onto the square
    [-16.8, 0, -9], [-5.8, 0, -9], [8.3, 0, -9], [17.7, 0, -9],
    // The square (west half), the tarima and its steps
    [-19.5, 0, -3], [-19.5, 0, 3], [-15.5, 0, -8.5], [-15, 0, -3.5], [-15, 0, 1.5], [-15.5, 0, 8.5], [-11, 0, -6.5],
    [-9, 0, -3.5], [-9, 0, 1.5], [-8.5, 0, 8.5], [-4, 0, -4.5], [-4, 0, 0], [-3.5, 0, 4.5],
    [-2, 0, -6.2], [0, 0, -4.2], [0, 1.0, -8.7], [-2.8, 1.0, -8.7], [2.8, 1.0, -8.7],
  ];
  const waypoints = [...wpHalf, ...wpHalf.map(([x, y, z]) => [-x, y, -z] as [number, number, number])].map(([x, y, z]) => ({ x, y, z }));

  const regions: Region[] = [
    { key: 'casaSol', minX: -30, maxX: -23, minZ: -10, maxZ: 10 },
    { key: 'casaLuna', minX: 23, maxX: 30, minZ: -10, maxZ: 10 },
    { key: 'portalNorte', minX: -30, maxX: 30, minZ: -15, maxZ: -10 },
    { key: 'portalSur', minX: -30, maxX: 30, minZ: 10, maxZ: 15 },
    { key: 'tarima', minX: -4, maxX: 4, minZ: -10, maxZ: -6.9 },
    { key: 'tarima', minX: -4, maxX: 4, minZ: 6.9, maxZ: 10 },
    { key: 'fuente', minX: -3.5, maxX: 3.5, minZ: -3.5, maxZ: 3.5 },
    { key: 'plaza', minX: -23, maxX: 23, minZ: -10, maxZ: 10 },
  ];

  const awnings = [
    { minX: -19.2, minZ: -7.4, maxX: -16.4, maxZ: -5, y: 2.9, color: 0xe85a7a },
    { minX: -12.7, minZ: 4.6, maxX: -9.9, maxZ: 7, y: 2.9, color: 0x36b9c9 },
    { minX: -7.7, minZ: -7.2, maxX: -4.9, maxZ: -4.8, y: 2.9, color: 0xf2a33a },
  ];
  const mirrorAwning = (a: (typeof awnings)[number]) => ({ minX: -a.maxX, maxX: -a.minX, minZ: -a.maxZ, maxZ: -a.minZ, y: a.y, color: a.color });

  return {
    id: 'plaza',
    name: 'La Plaza',
    bounds: { minX: -30, maxX: 30, minZ: -18, maxZ: 18 },
    boxes: [...half, ...other, ...centre, ...bounds],
    spawns: { 0: solSpawns, 1: lunaSpawns } as Record<Team, SpawnPoint[]>,
    waypoints,
    regions,
    pickups: [{ x: -8, y: 0, z: -12.8 }, { x: 8, y: 0, z: 12.8 }],
    decor: {
      ground: { w: 62, d: 38 },
      papel: [[-22, -9.8, 22, -9.8, 5.4], [-22, 9.8, 22, 9.8, 5.4], [-14, -9.6, 14, 9.6, 6.2]],
      lights: [[-22, -9.6, 22, 9.6, 7.4], [-22, 9.6, 22, -9.6, 7.4]],
      banners: [-1, 1].flatMap((s) => [-8.6, 8.6].map((z) => ({ x: s * 23.66, z: s * z, ry: Math.PI / 2, team: (s < 0 ? 0 : 1) as Team }))),
      emblems: [-1, 1].map((s) => ({ x: s * 22.94, y: 3.0, z: 0, ry: s < 0 ? Math.PI / 2 : -Math.PI / 2, team: (s < 0 ? 0 : 1) as Team })),
      church: { x: 0, z: -26 },
      awnings: [...awnings, ...awnings.map(mirrorAwning)],
      trees: [{ x: -5.4, z: 2.6, y: 0.9 }, { x: 5.4, z: -2.6, y: 0.9 }],
    },
    arcade: {
      playerStart: { x: 0, z: 6, yaw: 0 },
      entrances: [
        { x: -28.2, z: -2, entryX: -21, entryZ: -6.2 },
        { x: 28.2, z: 2, entryX: 21, entryZ: 6.2 },
        { x: -24.4, z: -12.8, entryX: -16.8, entryZ: -9 },
        { x: 24.4, z: 12.8, entryX: 16.8, entryZ: 9 },
        { x: 8.3, z: -13.5, entryX: 8.3, entryZ: -9 },
        { x: -8.3, z: 13.5, entryX: -8.3, entryZ: 9 },
      ],
      boss: { x: 0, y: 1.0, z: -8.9, waveX: 0, waveZ: -6.4 },
      pickups: [{ x: -15, z: 1.5 }, { x: 15, z: -1.5 }, { x: -9, z: -3.5 }, { x: 9, z: 3.5 }],
      dummies: [{ x: -7, z: 4 }, { x: 7, z: 3 }, { x: -2, z: 5.5 }],
    },
  };
}

export const LA_PLAZA: MapData = build();
