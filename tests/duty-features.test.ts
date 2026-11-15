import { describe, expect, it } from 'vitest';
import { MatchSim, BTN, type PlayerInput, type SimPlayer } from '../shared/sim';
import { EL_PATIO } from '../shared/map';
import { WEAPONS } from '../shared/config';
import { newBody } from '../shared/physics';
import { parseClientMsg, weaponOf } from '../shared/protocol';

function duel() {
  const sim = new MatchSim(EL_PATIO, { countdownMs: 0, seed: 3, scoreToWin: 2, durationMs: 60_000 });
  const a = sim.addPlayer(1, 0);
  const b = sim.addPlayer(2, 1);
  a.body = newBody(-5, 0, 3.4);
  b.body = newBody(5, 0, 3.4);
  a.yaw = -Math.PI / 2;
  b.yaw = Math.PI / 2;
  a.protectedUntil = b.protectedUntil = 0;
  return { sim, a, b };
}

let seq = 0;
function press(p: SimPlayer, buttons: number, extra: Partial<PlayerInput> = {}): PlayerInput {
  return { seq: ++seq, mx: 0, mz: 0, yaw: p.yaw, pitch: -0.06, buttons, weapon: p.weapon, ...extra };
}

describe('duty features stay in the shared sim', () => {
  it('still accepts a 7-number input from the original client', () => {
    const msg = parseClientMsg({ t: 'i', d: [[1, 0, 1, 0, 0, 1, 0]] });
    expect(msg?.t).toBe('i');
    expect(weaponOf(9)).toBe(0);
    expect(weaponOf(4)).toBe(4);
  });

  it('dashes along the look direction and then cools down', () => {
    const { sim, a } = duel();
    const before = a.body.vx;
    sim.queueInput(a.id, press(a, BTN.dash));
    sim.step();
    expect(Math.abs(a.body.vx)).toBeGreaterThan(Math.abs(before) + 10);
    sim.queueInput(a.id, press(a, BTN.dash));
    sim.step();
    expect(a.dashCd).toBeGreaterThan(900);
  });

  it('throws two pellets for Las Gemelas and a faster charged chancla', () => {
    const { sim, a } = duel();
    a.weapon = 3;
    a.switchMs = 0;
    sim.queueInput(a.id, press(a, BTN.fire, { charge: 1 }));
    sim.step();
    const throws = sim.drainEvents().filter((e) => e.k === 'throw');
    expect(throws).toHaveLength(2);
    const shot = throws[0];
    expect(shot && shot.k === 'throw').toBe(true);
    if (shot && shot.k === 'throw') expect(Math.hypot(shot.v[0], shot.v[2])).toBeGreaterThan(WEAPONS[0]!.speed);
  });

  it('resets the score instead of ending when endless is on', () => {
    const sim = new MatchSim(EL_PATIO, { countdownMs: 0, seed: 1, scoreToWin: 1, durationMs: 60_000, endless: true });
    sim.addPlayer(1, 0);
    sim.scores[0] = 1;
    sim.step();
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.k === 'wave')).toBe(true);
    expect(sim.phase).toBe('playing');
    expect(sim.scores[0]).toBe(0);
  });
});
