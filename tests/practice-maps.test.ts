// A complete Practice match on every map: four bots under the real match
// rules until the match ends, plus the room flow a player goes through
// (create on a map, restart on the same map, the owner changing it).
import { describe, expect, it } from 'vitest';
import { MatchSim } from '../shared/sim';
import { BotBrain } from '../shared/bots';
import { MAPS } from '../shared/maps';
import { Room } from '../shared/room';
import { parseClientMsg } from '../shared/protocol';
import { lineOfSight } from '../shared/collision';

describe('Practice on every map', () => {
  for (const entry of MAPS) {
    it(`${entry.id}: a full 2v2 bot match ends with results, kills on both sides, and nobody stuck`, () => {
      const sim = new MatchSim(entry.data, { countdownMs: 0, seed: 11 });
      const brains: BotBrain[] = [];
      for (let id = 1; id <= 4; id++) { sim.addPlayer(id, id <= 2 ? 0 : 1, true); brains.push(new BotBrain(sim, id, 'normal')); }
      const travel = new Map<number, number>();
      const last = new Map<number, { x: number; z: number }>();
      let exposedSpawns = 0, spawns = 0;
      let ticks = 0;
      while (sim.phase !== 'ended' && ticks < 60 * 60 * 6) {
        for (const b of brains) { const inp = b.think(sim); if (inp) sim.queueInput(b.id, inp); }
        sim.step();
        for (const e of sim.drainEvents()) {
          if (e.k !== 'spawn') continue;
          // Was the spawn point in plain sight of a living opponent?
          spawns++;
          const p = sim.players.get(e.id)!;
          for (const q of sim.players.values()) {
            if (q.team === p.team || !q.alive) continue;
            if (lineOfSight({ x: q.body.x, y: q.body.y + 1.58, z: q.body.z }, { x: p.body.x, y: 1.2, z: p.body.z }, entry.data.boxes)) { exposedSpawns++; break; }
          }
        }
        for (const p of sim.players.values()) {
          const l = last.get(p.id);
          if (l && p.alive) travel.set(p.id, (travel.get(p.id) ?? 0) + Math.hypot(p.body.x - l.x, p.body.z - l.z));
          last.set(p.id, { x: p.body.x, z: p.body.z });
          const bd = entry.data.bounds;
          expect(p.body.x > bd.minX && p.body.x < bd.maxX && p.body.z > bd.minZ && p.body.z < bd.maxZ, `player ${p.id} inside the arena`).toBe(true);
        }
        ticks++;
      }
      const kills = [...sim.players.values()].reduce((s, p) => s + p.stats.kills, 0);
      console.log(`${entry.id}: ${(ticks / 60).toFixed(0)} s, score ${sim.scores[0]}-${sim.scores[1]}, kills ${kills}, spawns ${spawns} (${exposedSpawns} in an opponent's sight)`);
      expect(sim.phase).toBe('ended');
      expect(sim.scores[0]).toBeGreaterThan(0);
      expect(sim.scores[1]).toBeGreaterThan(0);
      for (const [id, d] of travel) expect(d, `bot ${id} travelled`).toBeGreaterThan(60);
      expect(exposedSpawns).toBeLessThanOrEqual(Math.ceil(spawns * 0.1));
    }, 180000);
  }

  it('the room keeps the map it was created on; Restart (a new room) can keep it; only the owner changes it', () => {
    const create = parseClientMsg({ t: 'create', practice: { difficulty: 'normal', allies: 1, enemies: 2 }, map: 'fiesta' });
    expect(create).toMatchObject({ t: 'create', map: 'fiesta' });
    expect(parseClientMsg({ t: 'create', map: 'campaign' })).toBeNull();
    expect(parseClientMsg({ t: 'map', map: 'plaza' })).toEqual({ t: 'map', map: 'plaza' });
    const room = new Room('ABCDEFGH', 0, { practice: false, countdownMs: 0 });
    room.map = 'fiesta';
    const sent: unknown[] = [];
    const conn = { send: (m: unknown) => sent.push(m), close: () => {} };
    const a = room.addHuman(1, 'Ana', 'resume-token-ana-0001', conn as never, 0);
    const b = room.addHuman(2, 'Bea', 'resume-token-bea-0002', conn as never, 0);
    expect(room.view().map).toBe('fiesta');
    expect(room.handle(b!.id, { t: 'map', map: 'plaza' }, 0)).toBe('not_owner');
    expect(room.handle(a!.id, { t: 'map', map: 'plaza' }, 0)).toBeNull();
    expect(room.view().map).toBe('plaza');
  });
});
