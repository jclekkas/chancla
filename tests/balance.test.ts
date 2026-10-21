import { describe, expect, it, vi } from 'vitest';
import { Game, emptyInput, type InputFrame, type RunResult } from '../src/game/game';
import { SIM_DT } from '../src/config';
import { wrapAngle } from '../src/core/math';
import { Rng } from '../src/core/rng';
import { lineOfSight } from '../src/physics/collision';

// A simple bot that plays the real simulation: it aims at the nearest
// threat, throws when it has a chancla, sidesteps telegraphed attacks and
// grabs cafecitos when hurt. It is deliberately imperfect (aim noise,
// reaction delay) so the numbers approximate an attentive new player.

interface Outcome { result: RunResult | null; seconds: number; minHp: number; splits: string }

function playBot(seed: number, opts: { skill: number; maxMinutes?: number }): Outcome {
  const g = new Game(seed);
  // Independent from both game randomness and cosmetic Math.random calls.
  const botRng = new Rng(seed);
  const path: number[] = [];
  let result: RunResult | null = null;
  g.events.on('runEnd', (r) => { result = r; });
  const splits: string[] = [];
  let mark = 0;
  g.events.on('wave', (e) => { if (e.state === 'clear') { splits.push(`w${e.index + 1}:${Math.round(t - mark)}s`); mark = t; } });
  g.events.on('bossState', (e) => { if (e.state === 'dying') splits.push(`boss:${Math.round(t - mark)}s`); });
  g.startRun(true);
  const input: InputFrame = emptyInput();
  let t = 0, throwCd = 0, minHp = 100, dodgeDir = 1, dodgeT = 0;
  const noise = (1 - opts.skill) * 0.08;
  const limit = (opts.maxMinutes ?? 8) * 60;
  while (!result && t < limit) {
    t += SIM_DT;
    const p = g.player.pos;
    minHp = Math.min(minHp, g.player.hp);
    input.moveX = 0; input.moveZ = 0;
    input.throwDown = input.throwUp = false;
    input.throwHeld = false;
    // Choose a target.
    let tx = 0, ty = 1.2, tz = -10, has = false;
    let best = Infinity;
    for (const e of g.enemies.pool) {
      if (!e.alive || e.state === 'enter') continue;
      const d = Math.hypot(e.pos.x - p.x, e.pos.z - p.z);
      if (d < best) { best = d; tx = e.pos.x; tz = e.pos.z; ty = 1.2; has = true; }
    }
    if (!has && g.phase === 'boss' && g.boss.state === 'vulnerable') { tx = g.boss.pos.x; ty = g.boss.pos.y + 2.6; tz = g.boss.pos.z; has = true; }
    if (has) {
      const dx = tx - p.x, dz = tz - p.z;
      const wantYaw = Math.atan2(-dx, -dz) + (botRng.next() - 0.5) * noise;
      const wantPitch = Math.atan2(ty - 1.6, Math.hypot(dx, dz)) + (botRng.next() - 0.5) * noise * 0.5;
      g.player.yaw += wrapAngle(wantYaw - g.player.yaw) * Math.min(1, SIM_DT * 10 * opts.skill);
      g.player.pitch += (wantPitch - g.player.pitch) * Math.min(1, SIM_DT * 10);
      throwCd -= SIM_DT;
      if (throwCd <= 0 && g.chanclas.heldCount() > 0 && Math.abs(wrapAngle(wantYaw - g.player.yaw)) < 0.08) {
        input.throwDown = true; input.throwUp = true;
        throwCd = 0.35 + (1 - opts.skill) * 0.4;
      }
      // Keep a comfortable distance.
      const d = Math.hypot(dx, dz);
      if (d < 6) input.moveZ = -0.6; else if (d > 12 && g.phase !== 'boss') input.moveZ = 0.6;
    }
    // Sidestep while anything is telegraphed (after a reaction delay).
    if (g.hazards.pendingTelegraphs() > 0) {
      dodgeT += SIM_DT;
      if (dodgeT > 0.35 / opts.skill) input.moveX = dodgeDir;
    } else {
      dodgeT = 0;
      if (botRng.next() < 0.01) dodgeDir *= -1;
    }
    // Boss: stand off-axis so the fountain is not in the way.
    if (g.phase === 'boss' && Math.abs(p.x) < 5) input.moveX = p.x >= 0 ? 1 : -1;
    // Dodging can carry the bot behind the stage/speakers. An attentive
    // player repositions instead of throwing into cover for minutes.
    // Walk back to the courtyard through the real navigation/collision map.
    if (g.phase === 'boss' && !lineOfSight(
      { x: p.x, y: 1.6, z: p.z },
      { x: g.boss.pos.x, y: g.boss.pos.y + 2.6, z: g.boss.pos.z },
      g.arena.colliders, () => true,
    )) {
      if (g.arena.nav.findPath(p.x, p.z, p.x >= 0 ? 5 : -5, -7, path) && path.length >= 2) {
        const yawTo = Math.atan2(-(path[0]! - p.x), -(path[1]! - p.z));
        const rel = wrapAngle(yawTo - g.player.yaw);
        input.moveZ = Math.cos(rel); input.moveX = -Math.sin(rel);
      }
    }
    // Cafecito when hurt.
    if (g.player.hp < 55) {
      const pk = g.pickups.items.find((i) => i.active);
      if (pk) {
        const yawTo = Math.atan2(-(pk.x - p.x), -(pk.z - p.z));
        const rel = wrapAngle(yawTo - g.player.yaw);
        input.moveZ = Math.cos(rel); input.moveX = -Math.sin(rel);
      }
    }
    if (g.legendaryActive) input.throwHeld = true;
    if (g.meter >= 1 && has) input.special = true; else input.special = false;
    g.update(SIM_DT, input);
  }
  return { result, seconds: t, minHp, splits: splits.join(' ') };
}

describe('balance (bot playthroughs of the real simulation)', () => {
  it('a skilled bot wins within the 105–300 second pacing window', () => {
    const runs = [11, 12, 13, 14, 15].map((s) => playBot(s, { skill: 0.8 }));
    for (const r of runs) console.log(`skill 0.8: ${r.result ? (r.result.victory ? 'WIN' : 'LOSS') : 'TIMEOUT'} in ${(r.seconds / 60).toFixed(2)} min, score ${r.result?.score}, min hp ${Math.round(r.minHp)}, acc ${(r.result?.accuracy ?? 0).toFixed(2)} [${r.splits}]`);
    const wins = runs.filter((r) => r.result?.victory);
    expect(wins.length).toBeGreaterThanOrEqual(3);
    for (const w of wins) {
      // The bot skips the tutorial. Human pacing still needs playtesting.
      expect(w.seconds).toBeGreaterThan(105);
      expect(w.seconds).toBeLessThan(300);
    }
  }, 120000);

  it('replays the obstructed-boss regression independently of earlier games and cosmetic randomness', () => {
    // Seed 55 timed out after 480 seconds: dodging put the bot behind
    // scenery, where it kept throwing without finding a clear shot.
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.1);
    try {
      const first = playBot(55, { skill: 0.8 });
      expect(first.result?.victory).toBe(true);
      expect(first.seconds).toBeGreaterThan(105);
      expect(first.seconds).toBeLessThan(300);
      playBot(12, { skill: 0.8 });
      random.mockReturnValue(0.9);
      expect(playBot(55, { skill: 0.8 })).toEqual(first);
    } finally {
      random.mockRestore();
    }
  }, 120000);

  it('a player who does nothing is defeated', () => {
    const g = new Game(5);
    let result: RunResult | null = null;
    g.events.on('runEnd', (r) => { result = r; });
    g.startRun(true);
    for (let i = 0; i < 60 * 60 * 6 && !result; i++) g.update(SIM_DT, emptyInput());
    expect(result).not.toBeNull();
    expect(result!.victory).toBe(false);
  }, 60000);
});
