// Complete Arcade rounds on every map, played by the balance bot through the
// real simulation: enemies come in from the map's entrances, collision and
// navigation hold, scoring counts, the boss can be beaten, and the run ends
// with results. El Patio's own pacing is covered by tests/balance.test.ts.
import { describe, expect, it } from 'vitest';
import { Game, emptyInput, type RunResult } from '../src/game/game';
import { SIM_DT } from '../src/config';
import { playArcadeBot } from './helpers/arcadeBot';
import { mapData, type MapId } from '../shared/maps';
import { provideMapArena } from '../src/game/game';
import { buildMapArena } from '../src/world/mapArena';
provideMapArena(buildMapArena);

describe('Arcade on La Plaza and La Fiesta', () => {
  for (const map of ['plaza', 'fiesta'] as MapId[]) {
    it(`${map}: a skilled bot wins full runs, enemies use the entrances, results are produced`, () => {
      const runs = [21, 22, 23, 24, 25].map((s) => playArcadeBot(map, s, { skill: 0.8, maxMinutes: 9 }));
      for (const r of runs) console.log(`${map}: ${r.result ? (r.result.victory ? 'WIN' : 'LOSS') : 'TIMEOUT'} in ${(r.seconds / 60).toFixed(2)} min, score ${r.result?.score}, min hp ${Math.round(r.minHp)}, enemies ${r.enemiesSeen} from ${r.spawnsUsed} spots`);
      const wins = runs.filter((r) => r.result?.victory);
      expect(wins.length).toBeGreaterThanOrEqual(3);
      for (const r of runs) {
        expect(r.result, 'every run ends with results').not.toBeNull();
        expect(r.result!.score).toBeGreaterThan(0);
      }
      // Enemies arrive from several of the map's entrances, not one spot.
      expect(Math.max(...runs.map((r) => r.spawnsUsed))).toBeGreaterThanOrEqual(3);
      for (const w of wins) expect(w.seconds).toBeLessThan(9 * 60);
    }, 240000);

    it(`${map}: a player who does nothing is defeated, and the player stays inside the arena`, () => {
      const g = new Game(5);
      g.setMap(map, 'low');
      let result: RunResult | null = null;
      g.events.on('runEnd', (r) => { result = r; });
      g.startRun(true);
      const bd = mapData(map).bounds;
      const input = emptyInput();
      for (let i = 0; i < 60 * 60 * 6 && !result; i++) {
        input.moveZ = 1; input.moveX = Math.sin(i * 0.01); g.player.yaw += 0.003;
        g.update(SIM_DT, input);
        const p = g.player.pos;
        expect(p.x > bd.minX && p.x < bd.maxX && p.z > bd.minZ && p.z < bd.maxZ).toBe(true);
      }
      expect(result).not.toBeNull();
      expect(result!.victory).toBe(false);
    }, 120000);
  }

  it('switching maps back and forth leaves one arena in the scene and restores El Patio exactly', () => {
    const g = new Game(3);
    const patioColliders = g.arena.colliders.length;
    const before = g.scene.children.length;
    for (const m of ['plaza', 'fiesta', 'patio', 'fiesta', 'plaza', 'patio'] as MapId[]) g.setMap(m, 'low');
    expect(g.scene.children.length).toBe(before);
    expect(g.arena.colliders.length).toBe(patioColliders);
    expect(g.player.bounds).toBeNull();
  });
});
