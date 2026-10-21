import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Game, emptyInput, type InputFrame, type RunResult } from '../src/game/game';
import { SIM_DT, ARENA, LEGEND } from '../src/config';
import { WAVES } from '../src/game/waves';

function step(g: Game, seconds: number, input: InputFrame = emptyInput(), each?: () => void): void {
  const n = Math.round(seconds / SIM_DT);
  for (let i = 0; i < n; i++) {
    each?.();
    g.update(SIM_DT, input);
    // Edges only last one step.
    input.throwDown = input.throwUp = input.recall = input.special = input.cancelCharge = false;
  }
}

function face(g: Game, x: number, y: number, z: number): void {
  const p = g.player.pos;
  const dx = x - p.x, dz = z - p.z;
  g.player.yaw = Math.atan2(-dx, -dz);
  g.player.pitch = Math.atan2(y - 1.6, Math.hypot(dx, dz));
}

function tap(): InputFrame {
  return { ...emptyInput(), throwDown: true, throwUp: true };
}

function baseline(g: Game): Record<string, number> {
  const c = g.debugCounts();
  return { ...c, particles: 0 };
}

describe('game flow', () => {
  it('a thrown chancla damages an enemy once and scores once', () => {
    const g = new Game(1);
    g.startRun(true);
    const e = g.enemies.acquire('bocinas')!;
    e.spawn({ x: 0, z: 6, entryX: 0, entryZ: 6 }, g.rng);
    e.state = 'move';
    e.attackCd = 99;
    face(g, 0, 1.2, 6);
    step(g, SIM_DT, tap());
    step(g, 3);
    expect(e.hp).toBe(e.def.hp - 1);
    expect(g.scoring.hits).toBe(1);
    expect(g.scoring.throws).toBe(1);
    expect(g.scoring.connectedThrows).toBe(1);
    expect(g.scoring.score).toBeGreaterThan(0);
    expect(g.chanclas.heldCount()).toBe(2);
  });

  it('a charged throw does more damage and knockback', () => {
    const g = new Game(2);
    g.startRun(true);
    const e = g.enemies.acquire('soplador')!;
    e.spawn({ x: 0, z: 5, entryX: 0, entryZ: 5 }, g.rng);
    e.state = 'move';
    e.attackCd = 99;
    face(g, 0, 1.2, 5);
    const hold: InputFrame = { ...emptyInput(), throwDown: true, throwHeld: true };
    step(g, SIM_DT, hold);
    hold.throwHeld = true;
    step(g, 1.0, hold);
    step(g, SIM_DT, { ...emptyInput(), throwUp: true });
    step(g, 0.6);
    expect(e.hp).toBe(e.def.hp - 3);
  });

  it('the tutorial completes through real actions', () => {
    const g = new Game(3);
    const steps: string[] = [];
    g.events.on('tutorial', (e) => steps.push(e.step));
    g.startRun(false);
    expect(g.phase).toBe('tutorial');
    step(g, 1, { ...emptyInput(), moveZ: 1 });
    expect(g.tutorial.step).toBe('throw');
    const d0 = g.dummies[0]!;
    face(g, d0.x, 1.2, d0.z);
    step(g, SIM_DT, tap());
    step(g, 1.5);
    expect(g.tutorial.step).toBe('charge');
    const d1 = g.dummies[1]!;
    face(g, d1.x, 1.2, d1.z);
    const hold: InputFrame = { ...emptyInput(), throwDown: true, throwHeld: true };
    step(g, 1.0, hold);
    step(g, SIM_DT, { ...emptyInput(), throwUp: true });
    step(g, 1.5);
    expect(g.tutorial.step).toBe('recall');
    face(g, 0, 3, -20);
    step(g, SIM_DT, tap());
    step(g, 0.1);
    step(g, SIM_DT, { ...emptyInput(), recall: true });
    expect(g.tutorial.step).toBe('done');
    step(g, 3);
    expect(g.phase).toBe('wave');
    expect(steps).toEqual(['move', 'throw', 'charge', 'recall', 'done']);
  });

  it('runs waves in order with a capped, staggered enemy count and valid spawns', () => {
    const g = new Game(4);
    const waves: number[] = [];
    g.events.on('wave', (e) => { if (e.state === 'intro') waves.push(e.index); });
    g.startRun(true);
    let maxAlive = 0;
    const tooClose: number[] = [];
    const seen = new Set<number>();
    let guard = 0;
    while (g.phase === 'wave' && guard++ < 4000) {
      g.player.invuln = 99;
      step(g, 0.25);
      const idx = g.director.index;
      const alive = g.enemies.aliveCount();
      if (alive > WAVES[idx]!.maxActive) maxAlive = Math.max(maxAlive, alive);
      for (const e of g.enemies.pool) {
        if (e.alive && !seen.has(e.id) && e.state === 'enter') {
          seen.add(e.id);
          if (Math.hypot(e.pos.x - g.player.pos.x, e.pos.z - g.player.pos.z) < ARENA.spawnMinDist) tooClose.push(e.id);
        }
      }
      // Clear the wave once everyone has entered.
      if (g.director.phase === 'spawning' && alive > 0 && g.enemies.pool.every((e) => !e.alive || e.state !== 'enter')) g.debugKillAll();
    }
    expect(maxAlive).toBe(0);
    expect(tooClose).toEqual([]);
    expect(waves).toEqual([0, 1, 2]);
    expect(g.phase).toBe('boss');
  });

  it('boss only takes damage while vulnerable and his defeat wins the run', () => {
    const g = new Game(5);
    const results: RunResult[] = [];
    g.events.on('runEnd', (r) => results.push(r));
    g.debugJumpToWave(3);
    expect(g.phase).toBe('boss');
    let blocked = 0, accepted = 0;
    let guard = 0;
    while (g.boss.alive && guard++ < 20000) {
      g.player.invuln = 99;
      step(g, SIM_DT);
      if (g.boss.state === 'attack' && g.boss.takeHit(3).valid) blocked++;
      if (g.boss.state === 'vulnerable') { if (g.boss.takeHit(1).valid) accepted++; step(g, 0.3); }
    }
    expect(blocked).toBe(0);
    expect(accepted).toBeGreaterThan(0);
    // Every attack type was used at least once before he fell.
    expect(g.boss.attackIndex).toBeGreaterThanOrEqual(3);
    step(g, 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.victory).toBe(true);
    expect(g.phase).toBe('victory');
  });

  it('health reaching zero ends the run in defeat exactly once', () => {
    const g = new Game(6);
    const results: RunResult[] = [];
    g.events.on('runEnd', (r) => results.push(r));
    g.startRun(true);
    step(g, 0.5);
    g.player.damage(1000);
    step(g, 4);
    expect(results).toHaveLength(1);
    expect(results[0]!.victory).toBe(false);
    expect(g.phase).toBe('defeat');
  });

  it('the boss sound waves are blocked by cover', () => {
    const g = new Game(7);
    g.startRun(true);
    // Player hides behind the fountain relative to the wave origin.
    const probe = { x: 0, z: 4, eyeY: 1.6, radius: 0.4 };
    const inCone = g.hazards.inCone({ x: 0, z: -13.6, y: 1.4, dir: 0, range: 30, half: 0.3 }, probe, g.arena.colliders);
    expect(inCone).toBe(false);
    const open = g.hazards.inCone({ x: 0, z: -13.6, y: 1.4, dir: Math.atan2(6, 17.6), range: 30, half: 0.3 }, { ...probe, x: 6 }, g.arena.colliders);
    expect(open).toBe(true);
  });

  it('Legendaria fires golden chanclas without spending the real ones', () => {
    const g = new Game(8);
    g.startRun(true);
    g.debugFillMeter();
    expect(g.meter).toBe(1);
    step(g, SIM_DT, { ...emptyInput(), special: true });
    expect(g.legendaryActive).toBe(true);
    const held: InputFrame = { ...emptyInput(), throwDown: true, throwHeld: true };
    step(g, 0.5, held);
    expect(g.chanclas.golden.some((c) => c.state === 'flying')).toBe(true);
    expect(g.chanclas.heldCount()).toBe(2);
    step(g, LEGEND.duration + 2);
    expect(g.legendaryActive).toBe(false);
    expect(g.chanclas.activeCount()).toBe(0);
  });

  it('restart fully resets after a mid-run, a defeat and a victory', () => {
    const g = new Game(9);
    g.startRun(true);
    const clean = baseline(g);
    const handlers = g.events.count();
    const children = g.scene.children.length;

    const check = (): void => {
      g.startRun(true);
      expect(baseline(g)).toEqual(clean);
      expect(g.scoring.score).toBe(0);
      expect(g.player.hp).toBe(100);
      expect(g.meter).toBe(0);
      expect(g.director.index).toBe(0);
      expect(g.boss.state).toBe('idle');
      expect(g.events.count()).toBe(handlers);
      expect(g.scene.children.length).toBe(children);
    };

    // Mid-run with enemies, hazards and chanclas in flight.
    g.debugJumpToWave(2);
    step(g, 12, emptyInput(), () => { g.player.invuln = 99; });
    step(g, SIM_DT, tap());
    g.debugFillMeter();
    check();

    // Defeat.
    step(g, 4);
    g.player.damage(1000);
    step(g, 4);
    expect(g.phase).toBe('defeat');
    check();

    // Victory.
    g.debugJumpToWave(3);
    let guard = 0;
    while (g.boss.alive && guard++ < 20000) {
      g.player.invuln = 99;
      step(g, SIM_DT);
      if (g.boss.state === 'vulnerable') g.boss.takeHit(6);
    }
    step(g, 5);
    expect(g.phase).toBe('victory');
    check();
    // Repeated restarts do not accumulate entities.
    for (let i = 0; i < 20; i++) { step(g, 0.3); check(); }
    expect(g.enemies.pool.length).toBeLessThanOrEqual(18);
  });

  it('toTitle clears the run', () => {
    const g = new Game(10);
    g.debugJumpToWave(1);
    step(g, 6);
    g.toTitle();
    expect(g.phase).toBe('title');
    expect(g.enemies.activeCount()).toBe(0);
    expect(g.hazards.activeCount()).toBe(0);
  });

  it('aims so that the chancla lands where the crosshair points', () => {
    const g = new Game(11);
    g.startRun(true);
    const origin = new THREE.Vector3(), vel = new THREE.Vector3();
    face(g, 0, 2.5, 2); // aim at the fountain pillar
    g.aimVelocity(30, 7, origin, vel);
    expect(vel.length()).toBeGreaterThan(29);
    expect(vel.z).toBeLessThan(0);
  });
});
