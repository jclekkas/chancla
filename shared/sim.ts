// Authoritative team-deathmatch simulation. Pure logic: no timers, no
// sockets, no rendering. The server room, the in-browser practice host and
// the tests all drive it by calling step() at NET.tickRate.

import { MATCH, MOVE, NET, WEAPONS, WEAPON_SWITCH_MS, type WeaponId } from './config';
import { lineOfSight, segmentCapsule, segmentSphere, sweepWorld, type WorldHit } from './collision';
import { World, bodyHeight, eyeHeight, newBody, settle, stepMove, type Body } from './physics';
import type { MapData, Team } from './map';
import { Rng } from './rng';

export const BTN = { fire: 1, jump: 2, crouch: 4 } as const;

export interface PlayerInput {
  seq: number;
  mx: number;
  mz: number;
  yaw: number;
  pitch: number;
  buttons: number;
  weapon: WeaponId;
}

export interface PlayerStats {
  kills: number;
  deaths: number;
  damage: number;
  throws: number;
  hits: number;
}

export interface SimPlayer {
  id: number;
  team: Team;
  isBot: boolean;
  body: Body;
  yaw: number;
  pitch: number;
  hp: number;
  alive: boolean;
  respawnAt: number;
  protectedUntil: number;
  weapon: WeaponId;
  switchMs: number;
  cooldownMs: number;
  lastSeq: number;
  queue: PlayerInput[];
  tokens: number;
  stats: PlayerStats;
  lastThrowAt: number;
  lastHitAt: number;
  lastSpawnIdx: number;
  active: boolean; // false while disconnected: they stand still
}

export interface Projectile {
  id: number;
  owner: number;
  team: Team;
  weapon: WeaponId;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  ageMs: number;
  traveled: number;
  bounces: number;
  fireSeq: number;
}

export type SimEvent =
  | { k: 'throw'; id: number; o: number; w: WeaponId; p: [number, number, number]; v: [number, number, number]; s: number; tm: number }
  | { k: 'bounce'; id: number; p: [number, number, number]; v: [number, number, number]; tm: number }
  | { k: 'pend'; id: number; p: [number, number, number]; r: 'world' | 'player' | 'expire'; tm: number }
  | { k: 'hit'; a: number; v: number; d: number; hp: number; head: boolean; w: WeaponId; splash: boolean; p: [number, number, number] }
  | { k: 'shielded'; a: number; v: number }
  | { k: 'elim'; a: number; v: number; w: WeaponId }
  | { k: 'spawn'; id: number }
  | { k: 'pickup'; id: number; i: number; hp: number }
  | { k: 'end'; winner: Team | -1; reason: 'score' | 'time' };

export type SimPhase = 'countdown' | 'playing' | 'ended';

const DT_MS = 1000 / NET.tickRate;
const DT = 1 / NET.tickRate;
const hitTmp: WorldHit = { t: 0, nx: 0, ny: 0, nz: 0, box: null, ground: false };
const P0 = { x: 0, y: 0, z: 0 };
const P1 = { x: 0, y: 0, z: 0 };

export interface Hitbox { x: number; z: number; y0: number; y1: number; r: number; hx: number; hy: number; hz: number; hr: number }

// Body capsule plus a head sphere, derived from the movement body.
export function hitboxOf(b: Body, out: Hitbox = { x: 0, z: 0, y0: 0, y1: 0, r: 0, hx: 0, hy: 0, hz: 0, hr: 0 }): Hitbox {
  const h = bodyHeight(b);
  out.x = b.x; out.z = b.z;
  out.y0 = b.y + 0.3; out.y1 = b.y + h - 0.45; out.r = 0.36;
  out.hx = b.x; out.hy = b.y + h - 0.2; out.hz = b.z; out.hr = 0.25;
  return out;
}

export function forwardOf(yaw: number, pitch: number): [number, number, number] {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

// Launch origin and velocity so the throw lands where the crosshair points:
// a ray from the eye finds the aim point (world or a target hitbox), the
// throw leaves from the right hand, and the arc is compensated up to 35 m.
export function launch(
  world: World, b: Body, yaw: number, pitch: number, weapon: WeaponId, targets: readonly Hitbox[],
): { p: [number, number, number]; v: [number, number, number] } {
  const def = WEAPONS[weapon]!;
  const ex = b.x, ey = b.y + eyeHeight(b), ez = b.z;
  const [fx, fy, fz] = forwardOf(yaw, pitch);
  const maxD = 60;
  P0.x = ex; P0.y = ey; P0.z = ez;
  P1.x = ex + fx * maxD; P1.y = ey + fy * maxD; P1.z = ez + fz * maxD;
  let dist = maxD;
  if (sweepWorld(P0, P1, 0.02, world.near(P0.x, P0.z, P1.x, P1.z, 1), hitTmp)) dist = hitTmp.t * maxD;
  for (const t of targets) {
    const tb = segmentCapsule(P0, P1, 0.02, t.x, t.z, t.y0, t.y1, t.r);
    if (tb >= 0 && tb * maxD < dist) dist = tb * maxD;
    P1.x = t.hx; P1.y = t.hy; P1.z = t.hz;
    const th = segmentSphere(P0, { x: ex + fx * maxD, y: ey + fy * maxD, z: ez + fz * maxD }, 0.02, P1, t.hr);
    if (th >= 0 && th * maxD < dist) dist = th * maxD;
    P1.x = ex + fx * maxD; P1.y = ey + fy * maxD; P1.z = ez + fz * maxD;
  }
  dist = Math.max(1.5, dist);
  const ax = ex + fx * dist, ay = ey + fy * dist, az = ez + fz * dist;
  // Right hand, slightly below the eye; fall back to the eye if blocked.
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  let ox = ex + rx * 0.18 + fx * 0.3, oy = ey - 0.12, oz = ez + rz * 0.18 + fz * 0.3;
  P0.x = ex; P0.y = ey; P0.z = ez; P1.x = ox; P1.y = oy; P1.z = oz;
  if (!lineOfSight(P0, P1, world.near(ex, ez, ox, oz, 1), () => true)) { ox = ex; oy = ey; oz = ez; }
  let vx = ax - ox, vy = ay - oy, vz = az - oz;
  const d = Math.hypot(vx, vy, vz) || 1;
  vx = (vx / d) * def.speed; vy = (vy / d) * def.speed; vz = (vz / d) * def.speed;
  const tf = Math.min(d, 35) / def.speed;
  vy += 0.5 * def.gravity * tf;
  return { p: [ox, oy, oz], v: [vx, vy, vz] };
}

// Advances a projectile by dt against the world only. Shared by the server
// and by clients that draw projectiles locally between server events.
export function stepProjectileWorld(world: World, pr: Projectile, dt: number): 'none' | 'bounce' | 'end' {
  const def = WEAPONS[pr.weapon]!;
  pr.ageMs += dt * 1000;
  pr.vy -= def.gravity * dt;
  P0.x = pr.x; P0.y = pr.y; P0.z = pr.z;
  P1.x = pr.x + pr.vx * dt; P1.y = pr.y + pr.vy * dt; P1.z = pr.z + pr.vz * dt;
  if (sweepWorld(P0, P1, def.radius, world.near(P0.x, P0.z, P1.x, P1.z, 1), hitTmp)) {
    pr.x += (P1.x - P0.x) * hitTmp.t + hitTmp.nx * 0.02;
    pr.y += (P1.y - P0.y) * hitTmp.t + hitTmp.ny * 0.02;
    pr.z += (P1.z - P0.z) * hitTmp.t + hitTmp.nz * 0.02;
    if (!hitTmp.ground && pr.bounces < def.bounces) {
      pr.bounces++;
      const dot = pr.vx * hitTmp.nx + pr.vy * hitTmp.ny + pr.vz * hitTmp.nz;
      pr.vx = (pr.vx - 2 * dot * hitTmp.nx) * 0.8;
      pr.vy = (pr.vy - 2 * dot * hitTmp.ny) * 0.8;
      pr.vz = (pr.vz - 2 * dot * hitTmp.nz) * 0.8;
      return 'bounce';
    }
    return 'end';
  }
  pr.traveled += Math.hypot(P1.x - P0.x, P1.y - P0.y, P1.z - P0.z);
  pr.x = P1.x; pr.y = P1.y; pr.z = P1.z;
  if (pr.ageMs > def.lifeMs || pr.traveled > def.maxRange || pr.y < -5) return 'end';
  return 'none';
}

export interface SimOptions {
  seed?: number;
  durationMs?: number;
  scoreToWin?: number;
  countdownMs?: number;
}

export class MatchSim {
  readonly world: World;
  readonly map: MapData;
  readonly rng: Rng;
  readonly players = new Map<number, SimPlayer>();
  projectiles: Projectile[] = [];
  readonly scores: [number, number] = [0, 0];
  phase: SimPhase = 'countdown';
  timeMs = 0; // match clock including the countdown
  playMs = 0; // time spent in 'playing'
  tick = 0;
  winner: Team | -1 | null = null;
  endReason: 'score' | 'time' | null = null;
  events: SimEvent[] = [];
  readonly durationMs: number;
  readonly scoreToWin: number;
  countdownLeft: number;
  pickups: Array<{ x: number; y: number; z: number; availableAt: number }>;
  private nextProjectile = 1;
  private hb: Hitbox = hitboxOf(newBody(0, 0, 0));

  constructor(map: MapData, opts: SimOptions = {}) {
    this.map = map;
    this.world = new World(map.boxes);
    this.rng = new Rng(opts.seed ?? 1);
    this.durationMs = opts.durationMs ?? MATCH.durationMs;
    this.scoreToWin = opts.scoreToWin ?? MATCH.scoreToWin;
    this.countdownLeft = opts.countdownMs ?? MATCH.countdownMs;
    if (this.countdownLeft <= 0) this.phase = 'playing';
    this.pickups = map.pickups.map((p) => ({ ...p, availableAt: 0 }));
  }

  get timeLeftMs(): number {
    return Math.max(0, this.durationMs - this.playMs);
  }

  addPlayer(id: number, team: Team, isBot = false): SimPlayer {
    const p: SimPlayer = {
      id, team, isBot, body: newBody(0, 0, 0), yaw: 0, pitch: 0, hp: MATCH.maxHealth, alive: false,
      respawnAt: 0, protectedUntil: 0, weapon: 0, switchMs: 0, cooldownMs: 0, lastSeq: 0, queue: [],
      tokens: NET.inputBurst, stats: { kills: 0, deaths: 0, damage: 0, throws: 0, hits: 0 },
      lastThrowAt: -1e9, lastHitAt: -1e9, lastSpawnIdx: -1, active: true,
    };
    this.players.set(id, p);
    this.spawn(p);
    return p;
  }

  removePlayer(id: number): void {
    this.players.delete(id);
  }

  // Queues a client input. Returns false when it is rejected.
  queueInput(id: number, inp: PlayerInput): boolean {
    const p = this.players.get(id);
    if (!p) return false;
    if (inp.seq <= p.lastSeq || (p.queue.length > 0 && inp.seq <= p.queue[p.queue.length - 1]!.seq)) return false;
    p.queue.push(inp);
    if (p.queue.length > NET.maxInputQueue) p.queue.splice(0, p.queue.length - NET.maxInputQueue);
    return true;
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  step(): void {
    this.tick++;
    this.timeMs += DT_MS;
    if (this.phase === 'ended') {
      // Keep the world moving visually but nothing scores.
      for (const p of this.players.values()) p.queue.length = 0;
      return;
    }
    if (this.phase === 'countdown') {
      this.countdownLeft -= DT_MS;
      if (this.countdownLeft <= 0) this.phase = 'playing';
    } else {
      this.playMs += DT_MS;
    }

    for (const p of this.players.values()) this.processInputs(p);
    this.stepProjectiles();
    this.stepRespawns();
    this.stepPickups();

    if (this.phase === 'playing') {
      if (this.scores[0] >= this.scoreToWin || this.scores[1] >= this.scoreToWin) this.end('score');
      else if (this.playMs >= this.durationMs) this.end('time');
    }
  }

  private end(reason: 'score' | 'time'): void {
    this.phase = 'ended';
    this.endReason = reason;
    this.winner = this.scores[0] === this.scores[1] ? -1 : this.scores[0] > this.scores[1] ? 0 : 1;
    this.events.push({ k: 'end', winner: this.winner, reason });
    this.projectiles = [];
  }

  private processInputs(p: SimPlayer): void {
    // Timers run on server time, so they never freeze when inputs stall.
    if (p.cooldownMs > 0) p.cooldownMs = Math.max(0, p.cooldownMs - DT_MS);
    if (p.switchMs > 0) p.switchMs = Math.max(0, p.switchMs - DT_MS);
    // 2% headroom tolerates client clocks that run slightly fast.
    p.tokens = Math.min(NET.inputBurst, p.tokens + 1.02);
    let budget = p.queue.length > 4 ? 1 + NET.catchUpPerTick : 1;
    while (budget-- > 0 && p.queue.length > 0 && p.tokens >= 1) {
      p.tokens -= 1;
      this.applyInput(p, p.queue.shift()!);
    }
  }

  private applyInput(p: SimPlayer, inp: PlayerInput): void {
    p.lastSeq = inp.seq;
    p.yaw = Number.isFinite(inp.yaw) ? wrap(inp.yaw) : p.yaw;
    p.pitch = Number.isFinite(inp.pitch) ? Math.max(-MOVE.maxPitch, Math.min(MOVE.maxPitch, inp.pitch)) : p.pitch;
    if (!p.alive) return;
    const frozen = this.phase !== 'playing';
    if (inp.weapon !== p.weapon && (inp.weapon === 0 || inp.weapon === 1)) {
      p.weapon = inp.weapon;
      p.switchMs = WEAPON_SWITCH_MS;
    }
    stepMove(this.world, p.body, {
      mx: frozen ? 0 : inp.mx, mz: frozen ? 0 : inp.mz, yaw: p.yaw,
      jump: !frozen && (inp.buttons & BTN.jump) !== 0, crouch: (inp.buttons & BTN.crouch) !== 0,
    }, DT);
    if (!frozen && (inp.buttons & BTN.fire) !== 0 && p.cooldownMs <= 0 && p.switchMs <= 0) this.fire(p, inp.seq);
  }

  // Targets a thrower can aim at: living enemies.
  enemyHitboxes(team: Team): Hitbox[] {
    const out: Hitbox[] = [];
    for (const q of this.players.values()) if (q.alive && q.team !== team) out.push(hitboxOf(q.body));
    return out;
  }

  private fire(p: SimPlayer, seq: number): void {
    const def = WEAPONS[p.weapon]!;
    const { p: o, v } = launch(this.world, p.body, p.yaw, p.pitch, p.weapon, this.enemyHitboxes(p.team));
    const pr: Projectile = {
      id: this.nextProjectile++, owner: p.id, team: p.team, weapon: p.weapon,
      x: o[0], y: o[1], z: o[2], vx: v[0], vy: v[1], vz: v[2], ageMs: 0, traveled: 0, bounces: 0, fireSeq: seq,
    };
    this.projectiles.push(pr);
    p.cooldownMs = def.cooldownMs;
    p.protectedUntil = 0; // attacking cancels spawn protection
    p.stats.throws++;
    p.lastThrowAt = this.timeMs;
    this.events.push({ k: 'throw', id: pr.id, o: p.id, w: p.weapon, p: round3(o), v: round3(v), s: seq, tm: this.timeMs });
  }

  private stepProjectiles(): void {
    const keep: Projectile[] = [];
    for (const pr of this.projectiles) {
      const def = WEAPONS[pr.weapon]!;
      // Players first: find the earliest enemy hitbox along this step.
      const vyNext = pr.vy - def.gravity * DT;
      P0.x = pr.x; P0.y = pr.y; P0.z = pr.z;
      P1.x = pr.x + pr.vx * DT; P1.y = pr.y + vyNext * DT; P1.z = pr.z + pr.vz * DT;
      let bestT = 2, victim: SimPlayer | null = null, head = false;
      for (const q of this.players.values()) {
        if (!q.alive || q.id === pr.owner || (q.team === pr.team && !MATCH.friendlyFire)) continue;
        const hb = hitboxOf(q.body, this.hb);
        const th = segmentSphere(P0, P1, def.radius, { x: hb.hx, y: hb.hy, z: hb.hz }, hb.hr);
        if (th >= 0 && th < bestT) { bestT = th; victim = q; head = true; }
        const tb = segmentCapsule(P0, P1, def.radius, hb.x, hb.z, hb.y0, hb.y1, hb.r);
        if (tb >= 0 && tb < bestT - 1e-6) { bestT = tb; victim = q; head = false; }
      }
      let worldT = 2;
      if (victim && sweepWorld(P0, P1, def.radius, this.world.near(P0.x, P0.z, P1.x, P1.z, 1), hitTmp)) worldT = hitTmp.t;
      if (victim && bestT <= worldT) {
        const hx = P0.x + (P1.x - P0.x) * bestT, hy = P0.y + (P1.y - P0.y) * bestT, hz = P0.z + (P1.z - P0.z) * bestT;
        const dmg = Math.round(def.damage * (head ? def.headMultiplier : 1));
        this.damage(pr, victim, dmg, head, false, hx, hy, hz);
        if (def.splashRadius > 0) this.splash(pr, hx, hy, hz, victim.id);
        this.events.push({ k: 'pend', id: pr.id, p: round3([hx, hy, hz]), r: 'player', tm: this.timeMs });
        continue;
      }
      const res = stepProjectileWorld(this.world, pr, DT);
      if (res === 'bounce') {
        this.events.push({ k: 'bounce', id: pr.id, p: round3([pr.x, pr.y, pr.z]), v: round3([pr.vx, pr.vy, pr.vz]), tm: this.timeMs });
        keep.push(pr);
      } else if (res === 'end') {
        const expired = pr.ageMs > def.lifeMs || pr.traveled > def.maxRange;
        if (def.splashRadius > 0 && !expired) this.splash(pr, pr.x, pr.y, pr.z, -1);
        this.events.push({ k: 'pend', id: pr.id, p: round3([pr.x, pr.y, pr.z]), r: expired ? 'expire' : 'world', tm: this.timeMs });
      } else {
        keep.push(pr);
      }
    }
    this.projectiles = keep;
  }

  private splash(pr: Projectile, x: number, y: number, z: number, skip: number): void {
    const def = WEAPONS[pr.weapon]!;
    for (const q of this.players.values()) {
      if (!q.alive || q.id === skip || q.id === pr.owner || (q.team === pr.team && !MATCH.friendlyFire)) continue;
      const cy = q.body.y + bodyHeight(q.body) * 0.55;
      const d = Math.hypot(q.body.x - x, cy - y, q.body.z - z);
      if (d > def.splashRadius) continue;
      P0.x = x; P0.y = y + 0.1; P0.z = z; P1.x = q.body.x; P1.y = cy; P1.z = q.body.z;
      if (!lineOfSight(P0, P1, this.world.near(x, z, q.body.x, q.body.z, 1))) continue;
      const dmg = Math.round(def.splashDamage * (1 - 0.5 * (d / def.splashRadius)));
      this.damage(pr, q, dmg, false, true, q.body.x, cy, q.body.z);
    }
  }

  private damage(pr: Projectile, v: SimPlayer, dmg: number, head: boolean, splash: boolean, x: number, y: number, z: number): void {
    const a = this.players.get(pr.owner);
    if (this.phase !== 'playing') return;
    if (this.timeMs < v.protectedUntil) {
      this.events.push({ k: 'shielded', a: pr.owner, v: v.id });
      return;
    }
    v.hp = Math.max(0, v.hp - dmg);
    v.lastHitAt = this.timeMs;
    const def = WEAPONS[pr.weapon]!;
    const len = Math.hypot(pr.vx, pr.vz) || 1;
    v.body.vx += (pr.vx / len) * def.knockback * (splash ? 0.5 : 1);
    v.body.vz += (pr.vz / len) * def.knockback * (splash ? 0.5 : 1);
    if (a) {
      a.stats.damage += dmg;
      if (!splash) a.stats.hits++;
    }
    this.events.push({ k: 'hit', a: pr.owner, v: v.id, d: dmg, hp: v.hp, head, w: pr.weapon, splash, p: round3([x, y, z]) });
    if (v.hp <= 0) {
      v.alive = false;
      v.respawnAt = this.timeMs + MATCH.respawnMs;
      v.stats.deaths++;
      v.queue.length = 0;
      if (a && a.team !== v.team) {
        a.stats.kills++;
        this.scores[a.team]++;
      }
      this.events.push({ k: 'elim', a: pr.owner, v: v.id, w: pr.weapon });
    }
  }

  private stepRespawns(): void {
    for (const p of this.players.values()) {
      if (!p.alive && this.timeMs >= p.respawnAt) this.spawn(p);
    }
  }

  // Chooses the safest spawn for the team: far from living enemies and out
  // of their sight, avoiding the spot used last time.
  spawn(p: SimPlayer): void {
    const spots = this.map.spawns[p.team];
    let best = 0, bestScore = -Infinity;
    spots.forEach((s, i) => {
      let minD = 60, seen = false;
      for (const q of this.players.values()) {
        if (!q.alive || q.team === p.team) continue;
        const d = Math.hypot(q.body.x - s.x, q.body.z - s.z);
        minD = Math.min(minD, d);
        P0.x = q.body.x; P0.y = q.body.y + eyeHeight(q.body); P0.z = q.body.z;
        P1.x = s.x; P1.y = 1.2; P1.z = s.z;
        if (lineOfSight(P0, P1, this.world.near(P0.x, P0.z, s.x, s.z, 1))) seen = true;
      }
      let occupied = false;
      for (const q of this.players.values()) if (q !== p && q.alive && Math.hypot(q.body.x - s.x, q.body.z - s.z) < 1) occupied = true;
      const score = minD - (seen ? 40 : 0) - (i === p.lastSpawnIdx ? 6 : 0) - (occupied ? 30 : 0) + this.rng.next();
      if (score > bestScore) { bestScore = score; best = i; }
    });
    const s = spots[best]!;
    p.lastSpawnIdx = best;
    p.body = newBody(s.x, s.y, s.z);
    settle(this.world, p.body);
    p.yaw = s.yaw;
    p.pitch = 0;
    p.hp = MATCH.maxHealth;
    p.alive = true;
    p.cooldownMs = 0;
    p.switchMs = 0;
    p.protectedUntil = this.timeMs + MATCH.spawnProtectionMs;
    this.events.push({ k: 'spawn', id: p.id });
  }

  private stepPickups(): void {
    this.pickups.forEach((pk, i) => {
      if (this.timeMs < pk.availableAt) return;
      for (const p of this.players.values()) {
        if (!p.alive || p.hp >= MATCH.maxHealth) continue;
        if (Math.hypot(p.body.x - pk.x, p.body.z - pk.z) < 1.1 && Math.abs(p.body.y - pk.y) < 1.2) {
          p.hp = Math.min(MATCH.maxHealth, p.hp + MATCH.pickupHeal);
          pk.availableAt = this.timeMs + MATCH.pickupRespawnMs;
          this.events.push({ k: 'pickup', id: p.id, i, hp: p.hp });
          break;
        }
      }
    });
  }

  // Resets scores and respawns everyone for a rematch.
  restart(opts: { countdownMs?: number } = {}): void {
    this.scores[0] = 0; this.scores[1] = 0;
    this.phase = 'countdown';
    this.countdownLeft = opts.countdownMs ?? MATCH.countdownMs;
    if (this.countdownLeft <= 0) this.phase = 'playing';
    this.playMs = 0;
    this.winner = null;
    this.endReason = null;
    this.projectiles = [];
    this.events = [];
    for (const pk of this.pickups) pk.availableAt = 0;
    for (const p of this.players.values()) {
      p.stats = { kills: 0, deaths: 0, damage: 0, throws: 0, hits: 0 };
      p.queue.length = 0;
      p.lastSpawnIdx = -1;
      this.spawn(p);
    }
  }
}

function wrap(a: number): number {
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function round3(a: readonly number[]): [number, number, number] {
  return [Math.round(a[0]! * 1000) / 1000, Math.round(a[1]! * 1000) / 1000, Math.round(a[2]! * 1000) / 1000];
}
