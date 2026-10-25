import { describe, expect, it } from 'vitest';
import { EL_PATIO, type MapBox, type MapData } from '../shared/map';
import { LA_PLAZA } from '../shared/maps/plaza';
import { LA_FIESTA } from '../shared/maps/fiesta';
import { MAPS } from '../shared/maps';
import { arrowDir, classifyBox, layoutOf, miniAspect, teammateMarkers, toMini, LOW_TOP, OVER_BOTTOM } from '../src/fps/minimap-layout';

const find = (map: MapData, f: (b: MapBox) => boolean): MapBox => {
  const b = map.boxes.find(f);
  if (!b) throw new Error('box not found');
  return b;
};
const kindOf = (map: MapData, b: MapBox) => classifyBox(b, map.boxes, map.waypoints);
const at = (b: MapBox, minX: number, minZ: number) => Math.abs(b.minX - minX) < 1e-6 && Math.abs(b.minZ - minZ) < 1e-6;

describe('minimap layout', () => {
  it('classifies every arena with sane counts', () => {
    for (const e of MAPS) {
      const L = layoutOf(e.data);
      const total = L.counts.wall + L.counts.low + L.counts.raised + L.counts.over;
      expect(total, e.id).toBe(L.rects.length);
      expect(total, e.id).toBeLessThanOrEqual(e.data.boxes.length);
      expect(L.counts.wall, e.id).toBeGreaterThanOrEqual(15);
      expect(L.counts.low, e.id).toBeGreaterThanOrEqual(10);
      // Walls never outnumber everything else by an absurd margin, and nothing is lost.
      expect(L.counts.wall, e.id).toBeLessThan(total);
      expect(L.pickups).toHaveLength(e.data.pickups.length);
      // Rects stay inside the view.
      for (const r of L.rects) {
        expect(r.minX).toBeGreaterThanOrEqual(L.view.minX - 1e-9);
        expect(r.maxX).toBeLessThanOrEqual(L.view.maxX + 1e-9);
        expect(r.minZ).toBeGreaterThanOrEqual(L.view.minZ - 1e-9);
        expect(r.maxZ).toBeLessThanOrEqual(L.view.maxZ + 1e-9);
      }
    }
    expect(layoutOf(EL_PATIO).counts).toMatchObject({ over: 6 });
    expect(layoutOf(LA_PLAZA).counts).toMatchObject({ over: 14, raised: 4 });
    expect(layoutOf(LA_FIESTA).counts.over).toBe(0);
  });

  it('caches one layout per map', () => {
    expect(layoutOf(LA_PLAZA)).toBe(layoutOf(LA_PLAZA));
  });

  it('El Patio: houses, the statue and the kiosk are walls; cover is low; lintels are overhead', () => {
    const M = EL_PATIO;
    expect(kindOf(M, find(M, (b) => b.sign === 'CASA SOL'))).toBe('wall');
    expect(kindOf(M, find(M, (b) => b.sign === 'FARMACIA'))).toBe('wall');
    expect(kindOf(M, find(M, (b) => b.mat === 'statue'))).toBe('wall');
    expect(kindOf(M, find(M, (b) => b.mat === 'kiosk'))).toBe('wall');
    expect(kindOf(M, find(M, (b) => b.mat === 'fountain'))).toBe('low');
    expect(kindOf(M, find(M, (b) => b.mat === 'planter'))).toBe('low');
    expect(kindOf(M, find(M, (b) => b.mat === 'crate'))).toBe('low');
    expect(kindOf(M, find(M, (b) => b.mat === 'bin'))).toBe('low');
    // The corridor ceiling over Casa Sol's covered door: walked under, never a wall.
    expect(kindOf(M, find(M, (b) => b.mat === 'lintel' && at(b, -21, -4)))).toBe('over');
    for (const b of M.boxes.filter((x) => x.mat === 'lintel')) expect(kindOf(M, b)).toBe('over');
    // The terrace and its stairs are floors; its parapet is low cover on top.
    expect(kindOf(M, find(M, (b) => b.mat === 'stone' && at(b, -12, -11)))).toBe('raised');
    for (const b of M.boxes.filter((x) => x.mat === 'step')) expect(kindOf(M, b)).toBe('raised');
    expect(kindOf(M, find(M, (b) => b.mat === 'parapet'))).toBe('low');
  });

  it('La Plaza: arcade walls and pillars are walls, stalls and the fountain low, lintels overhead', () => {
    const M = LA_PLAZA;
    expect(kindOf(M, find(M, (b) => b.mat === 'stone' && at(b, -15.5, -10.6)))).toBe('wall');
    expect(kindOf(M, find(M, (b) => b.mat === 'stuccoCream' && Math.abs(b.minX - -20.3) < 1e-6))).toBe('wall');
    expect(kindOf(M, find(M, (b) => b.mat === 'kiosk'))).toBe('wall');
    for (const b of M.boxes.filter((x) => x.mat === 'stall')) expect(kindOf(M, b)).toBe('low');
    for (const b of M.boxes.filter((x) => x.mat === 'fountain')) expect(kindOf(M, b)).toBe('low');
    for (const b of M.boxes.filter((x) => x.mat === 'lintel')) expect(kindOf(M, b)).toBe('over');
    expect(kindOf(M, find(M, (b) => b.mat === 'stage'))).toBe('raised');
  });

  it('La Fiesta: tall hedges and gifts block, low hedges and tables are low', () => {
    const M = LA_FIESTA;
    for (const b of M.boxes.filter((x) => x.mat === 'hedge')) expect(kindOf(M, b)).toBe(b.maxY > LOW_TOP ? 'wall' : 'low');
    expect(M.boxes.filter((x) => x.mat === 'hedge' && kindOf(M, x) === 'wall')).toHaveLength(2);
    expect(M.boxes.filter((x) => x.mat === 'hedge' && kindOf(M, x) === 'low')).toHaveLength(2);
    for (const b of M.boxes.filter((x) => x.mat === 'table')) expect(kindOf(M, b)).toBe('low');
    expect(kindOf(M, find(M, (b) => b.mat === 'gift' && b.maxY > 1.5))).toBe('wall');
    expect(kindOf(M, find(M, (b) => b.sign === 'SALÓN DE FIESTAS'))).toBe('wall');
  });

  it('overhead geometry is never counted as a wall', () => {
    for (const e of MAPS) for (const b of e.data.boxes) {
      const supported = e.data.boxes.some((o) => o !== b && Math.abs(o.maxY - b.minY) < 0.05 && o.minX < b.maxX && o.maxX > b.minX && o.minZ < b.maxZ && o.maxZ > b.minZ);
      if (b.minY >= OVER_BOTTOM && !supported) expect(kindOf(e.data, b), `${e.id} ${b.mat}`).toBe('over');
    }
  });
});

describe('minimap projection', () => {
  const L = layoutOf(EL_PATIO);
  const w = 160, h = 160 / miniAspect(L);

  it('maps the view corners onto the canvas corners: +x right, -z up', () => {
    const nw = toMini(L, L.view.minX, L.view.minZ, w, h);
    const se = toMini(L, L.view.maxX, L.view.maxZ, w, h);
    expect(nw.u).toBeCloseTo(0, 6); expect(nw.v).toBeCloseTo(0, 6);
    expect(se.u).toBeCloseTo(w, 6); expect(se.v).toBeCloseTo(h, 6);
    const east = toMini(L, 10, 0, w, h), west = toMini(L, -10, 0, w, h);
    const north = toMini(L, 0, -10, w, h), south = toMini(L, 0, 10, w, h);
    expect(east.u).toBeGreaterThan(west.u);
    expect(north.v).toBeLessThan(south.v);
    // Casa Sol (west) is on the left, Casa Luna on the right.
    expect(toMini(L, EL_PATIO.spawns[0][0]!.x, 0, w, h).u).toBeLessThan(w / 2);
    expect(toMini(L, EL_PATIO.spawns[1][0]!.x, 0, w, h).u).toBeGreaterThan(w / 2);
  });

  it('letterboxes without distortion in a square canvas', () => {
    const a = toMini(L, 0, 0, 200, 200), b = toMini(L, 10, 10, 200, 200);
    expect(b.u - a.u).toBeCloseTo(b.v - a.v, 6);
    const top = toMini(L, 0, L.view.minZ, 200, 200).v;
    expect(top).toBeGreaterThan(0);
    expect(200 - toMini(L, 0, L.view.maxZ, 200, 200).v).toBeCloseTo(top, 6);
  });

  it('points the facing arrow the way the player looks', () => {
    const near = (d: { du: number; dv: number }, du: number, dv: number) => { expect(d.du).toBeCloseTo(du, 6); expect(d.dv).toBeCloseTo(dv, 6); };
    near(arrowDir(0), 0, -1); // north: up
    near(arrowDir(Math.PI / 2), -1, 0); // west: left
    near(arrowDir(Math.PI), 0, 1); // south: down
    near(arrowDir(-Math.PI / 2), 1, 0); // east: right
    // Sol's spawns face the plaza (east): the arrow points right.
    expect(arrowDir(EL_PATIO.spawns[0][0]!.yaw).du).toBeCloseTo(1, 6);
    // And matches the game's facing (-sin yaw, -cos yaw) in world space.
    for (const yaw of [0.3, 1.2, -2.5]) near(arrowDir(yaw), -Math.sin(yaw), -Math.cos(yaw));
  });
});

describe('teammate markers', () => {
  const teams = new Map<number, number>([[1, 0], [2, 0], [3, 1], [4, 1], [5, 0]]);
  const teamOf = (id: number) => teams.get(id) ?? null;
  const remotes = [
    { id: 1, x: 1, z: 1, alive: true }, // me
    { id: 2, x: 2, z: 2, alive: true }, // mate
    { id: 3, x: 3, z: 3, alive: true }, // enemy
    { id: 4, x: 4, z: 4, alive: false }, // dead enemy
    { id: 5, x: 5, z: 5, alive: false }, // dead mate
    { id: 9, x: 9, z: 9, alive: true }, // unknown team
  ];

  it('returns living teammates only, never enemies, the dead or yourself', () => {
    expect(teammateMarkers(remotes, teamOf, 1, 0)).toEqual([{ id: 2, x: 2, z: 2 }]);
    expect(teammateMarkers(remotes, teamOf, 3, 1)).toEqual([]);
  });

  it('shows nobody when your team is unknown', () => {
    expect(teammateMarkers(remotes, teamOf, 1, null)).toEqual([]);
  });

  it('takes any iterable (a Map of remotes)', () => {
    const m = new Map(remotes.map((r) => [r.id, r]));
    expect(teammateMarkers(m.values(), teamOf, 1, 0).map((r) => r.id)).toEqual([2]);
  });
});
