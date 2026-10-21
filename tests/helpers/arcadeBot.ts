// The balance bot from tests/balance.test.ts, generalised to any Arcade map
// (its boss repositioning used the original courtyard's coordinates). It
// plays the real simulation with aim noise and reaction delay.
import { Game, emptyInput, type InputFrame, type RunResult } from '../../src/game/game';
import { SIM_DT } from '../../src/config';
import { wrapAngle } from '../../src/core/math';
import { Rng } from '../../src/core/rng';
import { lineOfSight } from '../../src/physics/collision';
import type { MapId } from '../../shared/maps';

export interface BotOutcome { result: RunResult | null; seconds: number; minHp: number; spawnsUsed: number; enemiesSeen: number }

export function playArcadeBot(map: MapId, seed: number, opts: { skill: number; maxMinutes?: number }): BotOutcome {
  const g = new Game(seed);
  g.setMap(map, 'low');
  const botRng = new Rng(seed);
  const path: number[] = [];
  let result: RunResult | null = null;
  g.events.on('runEnd', (r) => { result = r; });
  const spawnSpots = new Set<string>();
  let enemiesSeen = 0;
  const live = new Set<object>();
  g.startRun(true);
  const input: InputFrame = emptyInput();
  let t = 0, throwCd = 0, minHp = 100, dodgeDir = 1, dodgeT = 0;
  const noise = (1 - opts.skill) * 0.08;
  const limit = (opts.maxMinutes ?? 8) * 60;
  while (!result && t < limit) {
    t += SIM_DT;
    // Enemies are pooled: a new arrival is an alive one we haven't seen since it last died.
    for (const e of g.enemies.pool) {
      if (e.alive && !live.has(e)) { live.add(e); enemiesSeen++; spawnSpots.add(`${Math.round(e.pos.x)},${Math.round(e.pos.z)}`); }
      else if (!e.alive) live.delete(e);
    }
    const p = g.player.pos;
    minHp = Math.min(minHp, g.player.hp);
    input.moveX = 0; input.moveZ = 0;
    input.throwDown = input.throwUp = false;
    input.throwHeld = false;
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
      const d = Math.hypot(dx, dz);
      if (d < 6) input.moveZ = -0.6; else if (d > 12 && g.phase !== 'boss') input.moveZ = 0.6;
    }
    if (g.hazards.pendingTelegraphs() > 0) {
      dodgeT += SIM_DT;
      if (dodgeT > 0.35 / opts.skill) input.moveX = dodgeDir;
    } else {
      dodgeT = 0;
      if (botRng.next() < 0.01) dodgeDir *= -1;
    }
    // With no clear shot at the boss (or at anything for a while), walk back
    // into the open in front of the stage through the real navigation grid.
    const bx = g.boss.pos.x, bz = g.boss.pos.z;
    const blocked = g.phase === 'boss' && !lineOfSight({ x: p.x, y: 1.6, z: p.z }, { x: bx, y: g.boss.pos.y + 2.6, z: bz }, g.arena.colliders, () => true);
    if (blocked && g.arena.nav.findPath(p.x, p.z, bx + (p.x >= bx ? 5 : -5), bz + 6.5, path) && path.length >= 2) {
      const yawTo = Math.atan2(-(path[0]! - p.x), -(path[1]! - p.z));
      const rel = wrapAngle(yawTo - g.player.yaw);
      input.moveZ = Math.cos(rel); input.moveX = -Math.sin(rel);
    }
    if (g.player.hp < 55) {
      const pk = g.pickups.items.find((i) => i.active);
      if (pk) {
        const yawTo = Math.atan2(-(pk.x - p.x), -(pk.z - p.z));
        const rel = wrapAngle(yawTo - g.player.yaw);
        input.moveZ = Math.cos(rel); input.moveX = -Math.sin(rel);
      }
    }
    if (g.legendaryActive) input.throwHeld = true;
    input.special = g.meter >= 1 && has;
    g.update(SIM_DT, input);
  }
  return { result, seconds: t, minHp, spawnsUsed: spawnSpots.size, enemiesSeen };
}
