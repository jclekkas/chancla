import { describe, expect, it } from 'vitest';
import { MatchSim } from '../shared/sim';
import { EL_PATIO } from '../shared/map';
import { BotBrain } from '../shared/bots';
import { buildNavGraph, findPath } from '../shared/navgraph';
import { newBody } from '../shared/physics';

describe('bot navigation graph', () => {
  const sim = new MatchSim(EL_PATIO, { countdownMs: 0 });
  const g = buildNavGraph(EL_PATIO, sim.world);

  it('every waypoint can reach every other waypoint (no traps, terraces included)', () => {
    const bad: string[] = [];
    for (let i = 0; i < g.nodes.length; i++) {
      for (const j of [0, Math.floor(g.nodes.length / 2), g.nodes.length - 1, 18, 19]) {
        if (i !== j && findPath(g, i, j).length === 0) bad.push(`${i}->${j}`);
        if (i !== j && findPath(g, j, i).length === 0) bad.push(`${j}->${i}`);
      }
    }
    expect(bad).toEqual([]);
    expect(g.nodes.filter((n) => n.y > 2).length).toBeGreaterThanOrEqual(8);
  });
});

describe('bots', () => {
  it('a 2v2 bot match produces eliminations from both teams and nobody stays stuck', () => {
    const sim = new MatchSim(EL_PATIO, { countdownMs: 0, seed: 7 });
    const brains: BotBrain[] = [];
    for (let id = 1; id <= 4; id++) {
      sim.addPlayer(id, id <= 2 ? 0 : 1, true);
      brains.push(new BotBrain(sim, id, 'normal'));
    }
    const travel = new Map<number, number>();
    const last = new Map<number, { x: number; z: number }>();
    for (let t = 0; t < 60 * 90; t++) {
      for (const b of brains) { const inp = b.think(sim); if (inp) sim.queueInput(b.id, inp); }
      sim.step();
      sim.drainEvents();
      for (const p of sim.players.values()) {
        const l = last.get(p.id);
        if (l && p.alive) travel.set(p.id, (travel.get(p.id) ?? 0) + Math.hypot(p.body.x - l.x, p.body.z - l.z));
        last.set(p.id, { x: p.body.x, z: p.body.z });
      }
    }
    const kills = [...sim.players.values()].reduce((s, p) => s + p.stats.kills, 0);
    expect(kills).toBeGreaterThan(4);
    expect(sim.scores[0]).toBeGreaterThan(0);
    expect(sim.scores[1]).toBeGreaterThan(0);
    for (const [id, d] of travel) expect(d, `bot ${id} travelled`).toBeGreaterThan(40);
  }, 60000);

  it('reacts with a delay instead of firing the instant an enemy appears', () => {
    const sim = new MatchSim(EL_PATIO, { countdownMs: 0, seed: 2 });
    const bot = sim.addPlayer(1, 0, true);
    const human = sim.addPlayer(2, 1);
    bot.body = newBody(-6, 0, 3.4);
    human.body = newBody(6, 0, 3.4);
    bot.yaw = -Math.PI / 2;
    const brain = new BotBrain(sim, 1, 'hard');
    let firstThrowTick = -1;
    for (let t = 0; t < 120 && firstThrowTick < 0; t++) {
      const inp = brain.think(sim);
      if (inp) sim.queueInput(1, inp);
      sim.step();
      if (bot.stats.throws > 0) firstThrowTick = t;
    }
    expect(firstThrowTick * (1000 / 60)).toBeGreaterThanOrEqual(280);
  });
});
