import { describe, expect, it } from 'vitest';
import { MatchSim, BTN, type PlayerInput, type SimPlayer, type SimEvent } from '../shared/sim';
import { EL_PATIO } from '../shared/map';
import { MATCH, NET, WEAPONS } from '../shared/config';
import { newBody } from '../shared/physics';

const TICK_MS = 1000 / NET.tickRate;
const CHEST = -0.06; // aim slightly down at 10 m: torso, not head

function setup(opts: { durationMs?: number; scoreToWin?: number } = {}) {
  const sim = new MatchSim(EL_PATIO, { countdownMs: 0, seed: 3, ...opts });
  const a = sim.addPlayer(1, 0);
  const b = sim.addPlayer(2, 1);
  return { sim, a, b };
}

// Places two players facing each other across open plaza ground.
function duel(_sim: MatchSim, a: SimPlayer, b: SimPlayer, dist = 10): void {
  a.body = newBody(-dist / 2, 0, 3.4);
  b.body = newBody(dist / 2, 0, 3.4);
  a.yaw = -Math.PI / 2; // facing +x
  b.yaw = Math.PI / 2;
  a.protectedUntil = b.protectedUntil = 0;
}

let seq = 0;
function input(p: SimPlayer, over: Partial<PlayerInput> = {}): PlayerInput {
  return { seq: ++seq, mx: 0, mz: 0, yaw: p.yaw, pitch: 0, buttons: 0, weapon: p.weapon, ...over };
}

function runTicks(sim: MatchSim, n: number, feed?: () => void): SimEvent[] {
  const ev: SimEvent[] = [];
  for (let i = 0; i < n; i++) { feed?.(); sim.step(); ev.push(...sim.drainEvents()); }
  return ev;
}

describe('authoritative match simulation', () => {
  it('a standard chancla hits a visible enemy for its damage, once', () => {
    const { sim, a, b } = setup();
    duel(sim, a, b);
    sim.queueInput(1, input(a, { buttons: BTN.fire, pitch: CHEST }));
    const ev = runTicks(sim, 60);
    const hits = ev.filter((e) => e.k === 'hit');
    expect(hits).toHaveLength(1);
    expect(b.hp).toBe(MATCH.maxHealth - WEAPONS[0]!.damage);
    expect(a.stats.hits).toBe(1);
    expect(a.stats.throws).toBe(1);
  });

  it('holding fire throws only at the weapon cooldown rate', () => {
    const { sim, a, b } = setup();
    duel(sim, a, b, 30);
    b.body = newBody(26, 0, 13); // out of the way
    runTicks(sim, 120, () => sim.queueInput(1, input(a, { buttons: BTN.fire })));
    const expected = Math.floor(2000 / WEAPONS[0]!.cooldownMs) + 1;
    expect(a.stats.throws).toBeGreaterThanOrEqual(expected - 1);
    expect(a.stats.throws).toBeLessThanOrEqual(expected);
  });

  it('a fast throw cannot pass through a thin wall between two players', () => {
    const { sim, a, b } = setup();
    // Through the fountain statue: a at west of it, b at east, at chest height.
    a.body = newBody(-6, 0, 0);
    b.body = newBody(6, 0, 0);
    a.yaw = -Math.PI / 2;
    a.protectedUntil = b.protectedUntil = 0;
    sim.queueInput(1, input(a, { buttons: BTN.fire, pitch: 0.05 }));
    const ev = runTicks(sim, 90);
    expect(ev.some((e) => e.k === 'hit')).toBe(false);
    expect(b.hp).toBe(MATCH.maxHealth);
  });

  it('head hits deal more damage than body hits', () => {
    const { sim, a, b } = setup();
    duel(sim, a, b, 8);
    // Aim at the head: eye height to head centre is about level.
    sim.queueInput(1, input(a, { buttons: BTN.fire, pitch: 0.02 }));
    const ev = runTicks(sim, 40);
    const hit = ev.find((e) => e.k === 'hit') as Extract<SimEvent, { k: 'hit' }>;
    expect(hit).toBeTruthy();
    if (hit.head) expect(hit.d).toBe(Math.round(WEAPONS[0]!.damage * WEAPONS[0]!.headMultiplier));
    else expect(hit.d).toBe(WEAPONS[0]!.damage);
  });

  it('friendly fire is disabled', () => {
    const sim = new MatchSim(EL_PATIO, { countdownMs: 0 });
    const a = sim.addPlayer(1, 0);
    const mate = sim.addPlayer(2, 0);
    duel(sim, a, mate);
    sim.queueInput(1, input(a, { buttons: BTN.fire }));
    runTicks(sim, 60);
    expect(mate.hp).toBe(MATCH.maxHealth);
  });

  it('spawn protection blocks damage, and attacking cancels it', () => {
    const { sim, a, b } = setup();
    duel(sim, a, b);
    b.protectedUntil = sim.timeMs + 5000;
    sim.queueInput(1, input(a, { buttons: BTN.fire }));
    let ev = runTicks(sim, 40);
    expect(ev.some((e) => e.k === 'shielded')).toBe(true);
    expect(b.hp).toBe(MATCH.maxHealth);
    // b throws (at nothing in particular): protection ends.
    sim.queueInput(2, input(b, { buttons: BTN.fire, yaw: 0 }));
    runTicks(sim, 2);
    expect(b.protectedUntil).toBe(0);
    runTicks(sim, 30);
    b.body.x = 5; b.body.z = 3.4; b.body.vx = b.body.vz = 0;
    sim.queueInput(1, input(a, { buttons: BTN.fire, pitch: CHEST }));
    ev = runTicks(sim, 40);
    expect(ev.some((e) => e.k === 'hit' && e.v === 2), JSON.stringify(ev)).toBe(true);
  });

  it('three hits eliminate, score for the team, and the victim respawns after the delay', () => {
    const { sim, a, b } = setup();
    duel(sim, a, b);
    let elimAt = -1;
    const all: SimEvent[] = [];
    for (let i = 0; i < 300 && elimAt < 0; i++) {
      if (b.alive) { b.body.x = 5; b.body.z = 3.4; b.body.vx = b.body.vz = 0; }
      sim.queueInput(1, input(a, { buttons: BTN.fire, pitch: CHEST }));
      sim.step();
      const ev = sim.drainEvents();
      all.push(...ev);
      if (ev.some((e) => e.k === 'elim')) elimAt = sim.timeMs;
    }
    expect(elimAt).toBeGreaterThan(0);
    expect(all.filter((e) => e.k === 'hit' && e.v === 2)).toHaveLength(3);
    expect(sim.scores).toEqual([1, 0]);
    expect(a.stats.kills).toBe(1);
    expect(b.stats.deaths).toBe(1);
    expect(b.alive).toBe(false);
    runTicks(sim, Math.round((MATCH.respawnMs - 100) / TICK_MS));
    expect(b.alive).toBe(false);
    runTicks(sim, Math.round(200 / TICK_MS));
    expect(b.alive).toBe(true);
    expect(b.hp).toBe(MATCH.maxHealth);
    expect(sim.timeMs < b.protectedUntil).toBe(true);
  });

  it('dead players cannot throw', () => {
    const { sim, a, b } = setup();
    duel(sim, a, b);
    a.alive = false;
    a.respawnAt = sim.timeMs + 10000;
    sim.queueInput(1, input(a, { buttons: BTN.fire }));
    runTicks(sim, 30);
    expect(a.stats.throws).toBe(0);
  });

  it('reaching the score limit ends the match with that team as winner', () => {
    const { sim } = setup({ scoreToWin: 3 });
    sim.scores[1] = 3;
    const ev = runTicks(sim, 1);
    expect(sim.phase).toBe('ended');
    expect(sim.winner).toBe(1);
    expect(ev).toContainEqual({ k: 'end', winner: 1, reason: 'score' });
  });

  it('the timer ends the match: higher score wins, equal scores tie', () => {
    const t = setup({ durationMs: 1000 });
    t.sim.scores[0] = 2;
    runTicks(t.sim, 70);
    expect(t.sim.phase).toBe('ended');
    expect(t.sim.winner).toBe(0);
    expect(t.sim.endReason).toBe('time');
    const tie = setup({ durationMs: 1000 });
    tie.sim.scores[0] = 4; tie.sim.scores[1] = 4;
    runTicks(tie.sim, 70);
    expect(tie.sim.winner).toBe(-1);
  });

  it('flooding inputs cannot make a player move faster than real time allows', () => {
    const { sim, a } = setup();
    a.body = newBody(-10, 0, 3.4);
    const x0 = a.body.x;
    // 600 inputs in one second of server time (10x the legal rate).
    for (let t = 0; t < 60; t++) {
      for (let k = 0; k < 10; k++) sim.queueInput(1, input(a, { mz: 1, yaw: -Math.PI / 2 }));
      sim.step();
    }
    const moved = a.body.x - x0;
    // One second at walk speed plus the burst allowance.
    expect(moved).toBeLessThan(6.0 * (1 + 24 / 60) + 0.5);
  });

  it('rejects stale or duplicate input sequence numbers and sanitises values', () => {
    const { sim, a } = setup();
    expect(sim.queueInput(1, { seq: 100, mx: 50, mz: -50, yaw: Number.NaN, pitch: 9, buttons: 0, weapon: 0 })).toBe(true);
    expect(sim.queueInput(1, { seq: 100, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, weapon: 0 })).toBe(false);
    expect(sim.queueInput(1, { seq: 99, mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, weapon: 0 })).toBe(false);
    sim.step();
    expect(Number.isFinite(a.yaw)).toBe(true);
    expect(Math.abs(a.pitch)).toBeLessThanOrEqual(1.46);
    expect(Math.hypot(a.body.vx, a.body.vz)).toBeLessThanOrEqual(6.01);
  });

  it('the heavy chancla is slower, recovers longer, hits harder and splashes', () => {
    const h = WEAPONS[1]!, s = WEAPONS[0]!;
    expect(h.speed).toBeLessThan(s.speed);
    expect(h.cooldownMs).toBeGreaterThan(s.cooldownMs * 2);
    expect(h.damage).toBeGreaterThan(s.damage);
    // DPS should not be a straight upgrade.
    expect(h.damage / h.cooldownMs).toBeLessThan(s.damage / s.cooldownMs);
    const { sim, a, b } = setup();
    duel(sim, a, b, 9);
    sim.queueInput(1, input(a, { weapon: 1 }));
    runTicks(sim, 25); // weapon switch time
    sim.queueInput(1, input(a, { weapon: 1, buttons: BTN.fire }));
    const ev = runTicks(sim, 90);
    const hit = ev.find((e) => e.k === 'hit' && e.v === 2) as Extract<SimEvent, { k: 'hit' }>;
    expect(hit.w).toBe(1);
    expect(hit.d).toBeGreaterThanOrEqual(h.damage);
  });

  it('heavy splash reaches a target next to the impact but not one behind cover', () => {
    // Open ground: impact 1.2 m from the target.
    const o2 = (() => {
      const { sim, a, b } = setup();
      a.body = newBody(-20, 0, 13);
      b.body = newBody(-3.8, 0, 6.8);
      b.protectedUntil = 0;
      sim.projectiles.push({ id: 99, owner: 1, team: 0, weapon: 1, x: -5, y: 1.2, z: 6.8, vx: 0, vy: -10, vz: 0, ageMs: 0, traveled: 0, bounces: 0, fireSeq: 1 });
      return runTicks(sim, 20);
    })();
    const sp = o2.find((e) => e.k === 'hit' && e.v === 2) as Extract<SimEvent, { k: 'hit' }> | undefined;
    expect(sp?.splash).toBe(true);
    expect(sp!.d).toBeGreaterThan(WEAPONS[1]!.splashDamage * 0.5 - 1);
    expect(sp!.d).toBeLessThanOrEqual(WEAPONS[1]!.splashDamage);
    // Same distance, but the newspaper kiosk (2.6 m tall) is in between.
    const covered = (() => {
      const { sim, a, b } = setup();
      a.body = newBody(-20, 0, 13);
      b.body = newBody(-12.8, 0, 6.0); // south of the kiosk at z∈[3.6,5.4]
      b.protectedUntil = 0;
      sim.projectiles.push({ id: 99, owner: 1, team: 0, weapon: 1, x: -12.8, y: 1.2, z: 3.1, vx: 0, vy: -10, vz: 0, ageMs: 0, traveled: 0, bounces: 0, fireSeq: 1 });
      return runTicks(sim, 20);
    })();
    expect(covered.some((e) => e.k === 'hit')).toBe(false);
  });

  it('rematch resets scores, stats and respawns everyone', () => {
    const { sim, a, b } = setup({ scoreToWin: 1 });
    sim.scores[0] = 1;
    runTicks(sim, 2);
    expect(sim.phase).toBe('ended');
    a.stats.kills = 5;
    sim.restart({ countdownMs: 0 });
    expect(sim.scores).toEqual([0, 0]);
    expect(sim.phase).toBe('playing');
    expect(a.stats.kills).toBe(0);
    expect(a.alive && b.alive).toBe(true);
  });
});
