import { describe, expect, it } from 'vitest';
import { EL_PATIO, regionAt } from '../shared/map';
import { World, newBody, settle, stepMove, bodyOverlaps } from '../shared/physics';
import { lineOfSight } from '../shared/collision';
import { NET, MOVE } from '../shared/config';

const world = new World(EL_PATIO.boxes);
const DT = 1 / NET.tickRate;

describe('El Patio map', () => {
  it('has five safe spawns per team, on the floor and inside their compound', () => {
    for (const team of [0, 1] as const) {
      const spawns = EL_PATIO.spawns[team];
      expect(spawns.length).toBe(5);
      for (const s of spawns) {
        const b = newBody(s.x, s.y, s.z);
        expect(bodyOverlaps(world, b)).toBe(false);
        expect(regionAt(EL_PATIO, s.x, 0, s.z)).toBe(team === 0 ? 'casaSol' : 'casaLuna');
      }
    }
  });

  it('has no line of sight between the two spawn compounds', () => {
    const near = world.boxes;
    let checked = 0;
    for (let ax = -25.6; ax <= -21.4; ax += 0.7) {
      for (let az = -6; az <= 6; az += 0.75) {
        for (const ey of [1.0, 1.6]) {
          for (let bx = 21.4; bx <= 25.6; bx += 1.4) {
            for (let bz = -6; bz <= 6; bz += 1.5) {
              checked++;
              expect(lineOfSight({ x: ax, y: ey, z: az }, { x: bx, y: 1.2, z: bz }, near), `${ax},${az} -> ${bx},${bz}`).toBe(false);
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('waypoints are in free space and standing on something', () => {
    for (const p of EL_PATIO.waypoints) {
      const b = newBody(p.x, p.y + 0.05, p.z);
      expect(bodyOverlaps(world, b), `${p.x},${p.y},${p.z}`).toBe(false);
      settle(world, b);
      expect(Math.abs(b.y - p.y), `${p.x},${p.y},${p.z} settled at ${b.y}`).toBeLessThan(0.06);
    }
  });

  it('both terraces are reachable by stairs from the plaza and from the street side', () => {
    const climb = (x: number, z: number, yaw: number, secs: number) => {
      const b = newBody(x, 0, z);
      for (let i = 0; i < secs / DT; i++) stepMove(world, b, { mx: 0, mz: 1, yaw, jump: false, crouch: false }, DT);
      return b;
    };
    expect(climb(-7.1, -4.1, 0, 0.75).y).toBeCloseTo(2.7, 2); // plaza stairs heading north
    expect(climb(-15.9, -11.8, -Math.PI / 2, 0.8).y).toBeCloseTo(2.7, 2); // alley stairs heading east
    expect(climb(7.1, 4.1, Math.PI, 0.75).y).toBeCloseTo(2.7, 2); // the rotated copy
    expect(climb(15.9, 11.8, Math.PI / 2, 0.8).y).toBeCloseTo(2.7, 2);
  });

  it('the doorway corridor between spawn and plaza has a ceiling you cannot jump through', () => {
    const b = newBody(-19, 0, -2.75);
    stepMove(world, b, { mx: 0, mz: 0, yaw: 0, jump: true, crouch: false }, DT);
    let maxHead = 0;
    for (let i = 0; i < 60; i++) { stepMove(world, b, { mx: 0, mz: 0, yaw: 0, jump: false, crouch: false }, DT); maxHead = Math.max(maxHead, b.y + MOVE.standHeight); }
    expect(maxHead).toBeLessThanOrEqual(2.4 + 1e-3);
  });

  it('players cannot leave the playable bounds', () => {
    for (const [x, z, yaw] of [[0, 0, 0], [0, 0, Math.PI], [0, 0, Math.PI / 2], [0, 0, -Math.PI / 2], [-24, -13, Math.PI / 2], [24, 13, -Math.PI / 2]] as const) {
      const b = newBody(x, 0, z);
      for (let i = 0; i < 20 / DT; i++) stepMove(world, b, { mx: 0.3, mz: 1, yaw: yaw + Math.sin(i * 0.01), jump: i % 40 === 0, crouch: false }, DT);
      expect(Math.abs(b.x)).toBeLessThan(27);
      expect(Math.abs(b.z)).toBeLessThan(19);
    }
  });

  it('is point-symmetric so neither team has an advantage', () => {
    const key = (b: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }) =>
      [b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ].map((v) => v.toFixed(3)).join(',');
    const set = new Set(EL_PATIO.boxes.map(key));
    for (const b of EL_PATIO.boxes) {
      const r = { minX: -b.maxX, maxX: -b.minX, minY: b.minY, maxY: b.maxY, minZ: -b.maxZ, maxZ: -b.minZ };
      expect(set.has(key(r)), key(b)).toBe(true);
    }
  });
});
