import { describe, expect, it } from 'vitest';
import { WaveDirector, WAVES } from '../src/game/waves';
import { Rng } from '../src/core/rng';
import { NavGrid } from '../src/world/nav';
import { box } from '../src/physics/collision';
import { buildArena } from '../src/world/arena';
import { ARENA } from '../src/config';

describe('wave director', () => {
  it('staggers spawns and never exceeds the active cap', () => {
    const d = new WaveDirector();
    const rng = new Rng(1);
    d.begin(2);
    let alive = 0, spawned = 0, lastSpawnT = -10, t = 0, minGap = Infinity;
    for (let i = 0; i < 60 * 120 && d.phase !== 'done'; i++) {
      t += 1 / 60;
      const k = d.step(1 / 60, alive, rng);
      if (k) {
        alive++; spawned++;
        minGap = Math.min(minGap, t - lastSpawnT);
        lastSpawnT = t;
        expect(alive).toBeLessThanOrEqual(WAVES[2]!.maxActive);
      }
      if (alive > 0 && i % 150 === 0) alive--; // something dies now and then
      if (d.remainingToSpawn === 0 && i % 30 === 0) alive = Math.max(0, alive - 1);
    }
    expect(spawned).toBe(WAVES[2]!.spawns.length);
    expect(minGap).toBeGreaterThanOrEqual(WAVES[2]!.interval[0] - 0.02);
    expect(d.phase).toBe('done');
  });

  it('picks spawn points away from the player', () => {
    const arena = buildArena();
    const d = new WaveDirector();
    const rng = new Rng(2);
    for (const p of [{ x: -15, z: -20 }, { x: 14, z: 18 }, { x: 0, z: 0 }, { x: -20, z: 3 }]) {
      for (let i = 0; i < 20; i++) {
        const s = d.pickSpawn(arena.spawns, p.x, p.z, rng);
        expect(Math.hypot(s.entryX - p.x, s.entryZ - p.z)).toBeGreaterThanOrEqual(ARENA.spawnMinDist);
      }
    }
  });

  it('every spawn point and pickup spot is reachable on the nav grid', () => {
    const arena = buildArena();
    const path: number[] = [];
    for (const s of arena.spawns) {
      expect(arena.nav.findPath(s.x, s.z, arena.playerStart.x, arena.playerStart.z, path)).toBe(true);
    }
    for (const p of arena.pickupSpots) expect(arena.nav.isFree(p.x, p.z)).toBe(true);
  });
});

describe('navigation', () => {
  it('routes around an obstacle', () => {
    const wall = box(-0.5, 0, -5, 0.5, 2, 5);
    const nav = new NavGrid(-10, -10, 10, 10, 0.5, [wall], 0.4);
    const out: number[] = [];
    expect(nav.walkable(-5, 0, 5, 0)).toBe(false);
    expect(nav.findPath(-5, 0, 5, 0, out)).toBe(true);
    let x = -5, z = 0;
    for (let i = 0; i < out.length; i += 2) {
      expect(nav.walkable(x, z, out[i]!, out[i + 1]!)).toBe(true);
      x = out[i]!; z = out[i + 1]!;
    }
    expect(x).toBeCloseTo(5);
  });
});
