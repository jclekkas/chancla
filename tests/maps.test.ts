// Every standalone map must be a complete, fair arena: safe spawns, no
// spawn-to-spawn sightlines, waypoints bots can actually walk between,
// closed bounds, point symmetry, decoration that never gets in the way, and
// an Arcade layout whose enemies can reach the player from every entrance.
import { describe, expect, it } from 'vitest';
import { MAPS, mapData, randomMapId, isMapId } from '../shared/maps';
import { regionAt, type MapData } from '../shared/map';
import { World, newBody, settle, stepMove, bodyOverlaps } from '../shared/physics';
import { lineOfSight } from '../shared/collision';
import { buildNavGraph, findPath } from '../shared/navgraph';
import { NET, MOVE } from '../shared/config';
import { NavGrid } from '../src/world/nav';

const DT = 1 / NET.tickRate;

// Where players stand at spawn: the spawn points' bounding box plus 1.2 m.
function spawnArea(map: MapData, team: 0 | 1) {
  const s = map.spawns[team];
  return {
    minX: Math.min(...s.map((p) => p.x)) - 1.2, maxX: Math.max(...s.map((p) => p.x)) + 1.2,
    minZ: Math.min(...s.map((p) => p.z)) - 1.2, maxZ: Math.max(...s.map((p) => p.z)) + 1.2,
  };
}

for (const entry of MAPS) {
  const map = entry.data;
  const world = new World(map.boxes);
  describe(`map ${entry.id} (${map.name})`, () => {
    it('has five free spawns per team, on the floor, inside their own compound', () => {
      for (const team of [0, 1] as const) {
        expect(map.spawns[team].length).toBe(5);
        for (const s of map.spawns[team]) {
          const body = newBody(s.x, s.y, s.z);
          expect(bodyOverlaps(world, body), `${s.x},${s.z}`).toBe(false);
          settle(world, body);
          expect(body.y).toBeCloseTo(0, 3);
          expect(regionAt(map, s.x, 0, s.z)).toBe(team === 0 ? 'casaSol' : 'casaLuna');
        }
      }
    });

    it('has no line of sight between the two spawn compounds', () => {
      const a = spawnArea(map, 0), z = spawnArea(map, 1);
      let checked = 0;
      for (let ax = a.minX; ax <= a.maxX + 1e-6; ax += 0.6) {
        for (let az = a.minZ; az <= a.maxZ + 1e-6; az += 0.75) {
          for (let bx = z.minX; bx <= z.maxX + 1e-6; bx += 1.2) {
            for (let bz = z.minZ; bz <= z.maxZ + 1e-6; bz += 1.5) {
              checked++;
              expect(lineOfSight({ x: ax, y: 1.6, z: az }, { x: bx, y: 1.2, z: bz }, map.boxes), `${ax},${az} -> ${bx},${bz}`).toBe(false);
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(300);
    });

    it('no spawn point can be seen from the opponents\' half, and near a spawn a hidden spawn point always exists', () => {
      // El Patio as shipped (online and the campaign are built on it): from the
      // alley you can see into each compound through its doorway. Pinned here so
      // it can't get worse; the new maps have no such spot.
      const known = map.id === 'patio' ? new Set(['-23.5,-12.8', '23.5,12.8']) : new Set<string>();
      // The sim picks, at each respawn, a spawn point no living opponent can see
      // (shared/sim.ts). This checks the layout always gives it one.
      for (const team of [0, 1] as const) {
        const side = team === 0 ? -1 : 1;
        const own = spawnArea(map, team);
        const seen = (w: { x: number; y: number; z: number }, s: { x: number; z: number }) => lineOfSight({ x: w.x, y: w.y + MOVE.eyeStand, z: w.z }, { x: s.x, y: 1.2, z: s.z }, map.boxes);
        // Standing inside the other team's compound sees in, on any map.
        const compound = map.regions.find((r) => r.key === (team === 0 ? 'casaSol' : 'casaLuna'))!;
        const inside = (w: { x: number; z: number }, r: { minX: number; maxX: number; minZ: number; maxZ: number }) => w.x >= r.minX && w.x <= r.maxX && w.z >= r.minZ && w.z <= r.maxZ;
        // So does standing on its doorstep (within 6 m): that is spawn camping, which
        // the runtime spawn choice answers. Everywhere else a hidden point must exist.
        const near = (w: { x: number; z: number }) => map.spawns[team].some((s) => Math.hypot(s.x - w.x, s.z - w.z) < 6);
        for (const w of map.waypoints) {
          if (inside(w, own) || inside(w, compound) || near(w) || known.has(`${w.x},${w.z}`)) continue;
          const visible = map.spawns[team].filter((s) => seen(w, s));
          if (w.x * side < 0) expect(visible.length, `spawn seen from the far half at ${w.x},${w.z}`).toBe(0);
          expect(map.spawns[team].length - visible.length, `from ${w.x},${w.z} only ${map.spawns[team].length - visible.length} spawn points hidden`).toBeGreaterThanOrEqual(2);
        }
      }
    });

    it('waypoints are in free space and standing on something', () => {
      for (const p of map.waypoints) {
        const body = newBody(p.x, p.y + 0.05, p.z);
        expect(bodyOverlaps(world, body), `${p.x},${p.y},${p.z}`).toBe(false);
        settle(world, body);
        expect(Math.abs(body.y - p.y), `${p.x},${p.y},${p.z} settled at ${body.y}`).toBeLessThan(0.06);
      }
    });

    it('bots can walk from every waypoint to every other (one connected route network)', () => {
      const g = buildNavGraph(map, world);
      const from = 0;
      const unreachable: string[] = [];
      for (let i = 0; i < g.nodes.length; i++) {
        if (findPath(g, from, i).length === 0 || findPath(g, i, from).length === 0) unreachable.push(`${g.nodes[i]!.x},${g.nodes[i]!.y},${g.nodes[i]!.z}`);
      }
      expect(unreachable).toEqual([]);
    });

    it('players cannot leave the playable bounds', () => {
      const bd = map.bounds;
      for (const yaw of [0, Math.PI, Math.PI / 2, -Math.PI / 2, 0.7, 2.4, -2.2]) {
        const body = newBody(0, 0, map.id === 'patio' ? 0 : 5);
        for (let i = 0; i < 20 / DT; i++) stepMove(world, body, { mx: 0.3, mz: 1, yaw: yaw + Math.sin(i * 0.01), jump: i % 40 === 0, crouch: false }, DT);
        expect(body.x).toBeGreaterThan(bd.minX); expect(body.x).toBeLessThan(bd.maxX);
        expect(body.z).toBeGreaterThan(bd.minZ); expect(body.z).toBeLessThan(bd.maxZ);
      }
    });

    it('is point-symmetric so neither team has an advantage', () => {
      const key = (q: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }) => [q.minX, q.minY, q.minZ, q.maxX, q.maxY, q.maxZ].map((v) => v.toFixed(3)).join(',');
      const set = new Set(map.boxes.map(key));
      for (const q of map.boxes) expect(set.has(key({ minX: -q.maxX, maxX: -q.minX, minY: q.minY, maxY: q.maxY, minZ: -q.maxZ, maxZ: -q.minZ })), key(q)).toBe(true);
    });

    it('decoration is above head height (never blocks movement or hides a player)', () => {
      const d = map.decor!;
      expect(d).toBeTruthy();
      for (const a of d.awnings ?? []) expect(a.y).toBeGreaterThanOrEqual(2.9);
      for (const l of [...(d.lights ?? []), ...(d.papel ?? [])]) expect(l[4]).toBeGreaterThanOrEqual(4.5);
      if (d.pinata) expect(d.pinata.y - 0.7).toBeGreaterThanOrEqual(3); // its lowest point
      for (const t of d.trees ?? []) {
        const planter = map.boxes.find((q) => q.mat === 'planter' && t.x > q.minX && t.x < q.maxX && t.z > q.minZ && t.z < q.maxZ);
        expect(planter, `tree ${t.x},${t.z} stands in a planter`).toBeTruthy();
      }
    });

    it('pickups are reachable and free', () => {
      for (const p of map.pickups) expect(bodyOverlaps(world, newBody(p.x, p.y, p.z)), `${p.x},${p.z}`).toBe(false);
    });

    if (map.arcade) {
      it('Arcade: entrances, the player start and pickups are free, and every entrance can reach the player', () => {
        const a = map.arcade!;
        const nav = new NavGrid(map.bounds.minX, map.bounds.minZ, map.bounds.maxX, map.bounds.maxZ, 0.5, map.boxes, 0.45);
        const free = (x: number, z: number) => nav.isFree(x, z);
        expect(free(a.playerStart.x, a.playerStart.z)).toBe(true);
        expect(a.entrances.length).toBeGreaterThanOrEqual(4);
        const path: number[] = [];
        for (const e of a.entrances) {
          expect(free(e.x, e.z), `entrance ${e.x},${e.z}`).toBe(true);
          expect(free(e.entryX, e.entryZ), `entry ${e.entryX},${e.entryZ}`).toBe(true);
          expect(nav.findPath(e.x, e.z, a.playerStart.x, a.playerStart.z, path, 20000), `path from ${e.x},${e.z}`).toBe(true);
        }
        for (const p of [...a.pickups, ...a.dummies]) expect(free(p.x, p.z), `${p.x},${p.z}`).toBe(true);
        // The boss stands on a stage at its height.
        const stage = map.boxes.find((q) => q.mat === 'stage' && a.boss.x > q.minX && a.boss.x < q.maxX && a.boss.z > q.minZ && a.boss.z < q.maxZ);
        expect(stage?.maxY).toBeCloseTo(a.boss.y, 3);
      });
    }
  });
}

describe('map registry', () => {
  it('has the three standalone maps, all unlocked, El Patio first', () => {
    expect(MAPS.map((m) => m.id)).toEqual(['patio', 'plaza', 'fiesta']);
    expect(mapData('nope').id).toBe('patio');
    expect(isMapId('fiesta')).toBe(true);
    expect(isMapId('campaign')).toBe(false);
  });

  it('random picks every map', () => {
    const seen = new Set([0, 0.4, 0.9].map((r) => randomMapId(() => r)));
    expect(seen.size).toBe(3);
  });

  it('the layouts are meaningfully different: sizes, cover and sightlines', () => {
    const area = (m: MapData) => (m.bounds.maxX - m.bounds.minX) * (m.bounds.maxZ - m.bounds.minZ);
    const [patio, plaza, fiesta] = MAPS.map((m) => m.data) as [MapData, MapData, MapData];
    expect(area(plaza)).toBeGreaterThan(area(patio));
    expect(area(fiesta)).toBeLessThan(area(patio) * 0.7);
    // Longest clear sightline at eye height across the middle of each map.
    const longest = (m: MapData) => {
      let best = 0;
      for (let z = m.bounds.minZ + 4; z < m.bounds.maxZ - 4; z += 1) {
        for (let x = m.bounds.minX + 6; x < 0; x += 1) {
          for (let x2 = -x; x2 > x; x2 -= 1) {
            if (lineOfSight({ x, y: 1.58, z }, { x: x2, y: 1.58, z }, m.boxes)) { best = Math.max(best, x2 - x); break; }
          }
        }
      }
      return best;
    };
    const lp = longest(plaza), lf = longest(fiesta);
    expect(lp).toBeGreaterThan(30); // long central lines
    expect(lf).toBeLessThan(lp * 0.75); // close-range map
  });
});
