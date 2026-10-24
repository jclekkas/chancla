// Bot players. A bot produces the same PlayerInput a human client sends and
// goes through the same queue, cooldowns and validation, so it fights by the
// same rules. Reaction time and aim error are deliberately imperfect.

import { BOTS, MELEE, WEAPONS, type BotDifficulty, type WeaponId } from './config';
import { lineOfSight } from './collision';
import { eyeHeight, bodyHeight } from './physics';
import { BTN, type MatchSim, type PlayerInput, type SimPlayer } from './sim';
import { buildNavGraph, findPath, nearestNode, type NavGraph } from './navgraph';

const TWO_PI = Math.PI * 2;

function wrap(a: number): number {
  a = a % TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  if (a < -Math.PI) a += TWO_PI;
  return a;
}

export class BotBrain {
  readonly id: number;
  readonly skill: (typeof BOTS)[BotDifficulty];
  private graph: NavGraph;
  private seq = 0;
  private target = -1;
  private seenMs = 0; // how long the current target has been visible
  private lastSeen: { x: number; y: number; z: number } | null = null;
  private lastSeenAt = -1e9;
  private path: number[] = [];
  private goal = -1;
  private replanAt = 0;
  private strafe = 1;
  private strafeUntil = 0;
  private stuckCheckAt = 0;
  private stuckPos = { x: 0, z: 0 };
  private jumpNext = false;
  private aimErrYaw = 0;
  private aimErrPitch = 0;
  private aimErrUntil = 0;
  private yaw = 0;
  private pitch = 0;
  private weapon: WeaponId = 0;
  private lastAlive = false;
  /** Decided per opponent: close in and use melee rather than keep the range, and with which chancla. */
  private brawl = false;
  private brawlWeapon: WeaponId = 0;

  constructor(sim: MatchSim, id: number, difficulty: BotDifficulty = 'normal') {
    this.id = id;
    this.skill = BOTS[difficulty];
    this.graph = buildNavGraph(sim.map, sim.world);
  }

  think(sim: MatchSim): PlayerInput | null {
    const me = sim.players.get(this.id);
    if (!me) return null;
    const now = sim.timeMs;
    const dtMs = 1000 / 60;
    if (!me.alive) {
      this.lastAlive = false;
      return this.emit(me, 0, 0, 0);
    }
    if (!this.lastAlive) {
      // Fresh spawn: forget everything.
      this.lastAlive = true;
      this.yaw = me.yaw;
      this.pitch = 0;
      this.target = -1;
      this.path = [];
      this.replanAt = 0;
    }

    const eye = { x: me.body.x, y: me.body.y + eyeHeight(me.body), z: me.body.z };
    // --- Perception ---------------------------------------------------------
    let best: SimPlayer | null = null, bestD = Infinity;
    for (const q of sim.players.values()) {
      if (!q.alive || q.team === me.team) continue;
      const chest = { x: q.body.x, y: q.body.y + bodyHeight(q.body) * 0.6, z: q.body.z };
      const d = Math.hypot(chest.x - eye.x, chest.z - eye.z);
      if (d > 55) continue;
      const ang = Math.abs(wrap(Math.atan2(-(chest.x - eye.x), -(chest.z - eye.z)) - this.yaw));
      const hurtByThem = now - me.lastHitAt < 1500;
      if (ang > 1.1 && !hurtByThem && q.id !== this.target) continue;
      if (!lineOfSight(eye, chest, sim.world.near(eye.x, eye.z, chest.x, chest.z, 1))) continue;
      if (d < bestD) { bestD = d; best = q; }
    }
    if (best) {
      if (best.id !== this.target) {
        this.target = best.id; this.seenMs = 0;
        // Under melee-only rules every encounter is a brawl (the roll is still made, so Classic's sequence is unchanged).
        this.brawl = sim.rng.next() < this.skill.brawlChance || sim.rules === 'melee';
        // Alternate the chancla from one brawl to the next, so both attacks show up.
        if (this.brawl) this.brawlWeapon = this.brawlWeapon === 0 ? 1 : 0;
      }
      this.seenMs += dtMs;
      this.lastSeen = { x: best.body.x, y: best.body.y, z: best.body.z };
      this.lastSeenAt = now;
    } else {
      this.seenMs = 0;
      if (now - this.lastSeenAt > 3000) this.target = -1;
    }
    const engaged = best !== null && this.seenMs >= this.skill.reactionMs;

    let mx = 0, mz = 0, buttons = 0;
    let wantYaw = this.yaw, wantPitch = 0;

    if (best && engaged) {
      // --- Aim with lead and a slowly wandering error ----------------------
      const def = WEAPONS[this.weapon]!;
      const tx = best.body.x, ty = best.body.y + bodyHeight(best.body) * 0.55, tz = best.body.z;
      const flight = Math.hypot(tx - eye.x, tz - eye.z) / def.speed;
      const lx = tx + best.body.vx * flight * this.skill.leadSkill;
      const lz = tz + best.body.vz * flight * this.skill.leadSkill;
      if (now > this.aimErrUntil) {
        this.aimErrUntil = now + 500 + sim.rng.next() * 700;
        this.aimErrYaw = (sim.rng.next() - 0.5) * 2 * this.skill.aimErrorRad;
        this.aimErrPitch = (sim.rng.next() - 0.5) * this.skill.aimErrorRad;
      }
      wantYaw = Math.atan2(-(lx - eye.x), -(lz - eye.z)) + this.aimErrYaw;
      wantPitch = Math.atan2(ty - eye.y, Math.hypot(lx - eye.x, lz - eye.z)) + this.aimErrPitch;
      // Up close a swing goes for the face about half the time, the body otherwise.
      const close = bestD < 2.6;
      if (close) {
        const faceY = best.body.y + bodyHeight(best.body) - (this.aimErrUntil % 2 < 1 ? 0.2 : 0.7);
        wantPitch = Math.atan2(faceY - eye.y, Math.max(0.5, bestD)) + this.aimErrPitch;
      }
      // Weapon choice: the heavy one for close fights now and then. A brawler
      // picks its chancla as it closes in (so both attacks get used).
      if (this.brawl && bestD < 9) {
        if (me.meleeMs <= 0 && me.cooldownMs <= 0 && me.switchMs <= 0) this.weapon = this.brawlWeapon;
      } else if (me.cooldownMs <= 0 && me.switchMs <= 0 && me.meleeMs <= 0 && !(this.brawl && bestD < 9)) {
        const wantHeavy = bestD < 11 && sim.rng.next() < this.skill.heavyChance * 0.05;
        const wantStd = this.weapon === 1 && (bestD > 14 || sim.rng.next() < 0.01);
        if (wantHeavy && this.weapon === 0) this.weapon = 1;
        else if (wantStd) this.weapon = 0;
      }
      const err = Math.abs(wrap(wantYaw - this.yaw)) + Math.abs(wantPitch - this.pitch);
      // In reach and roughly facing them: melee (a press, like a player's).
      // Otherwise throw when lined up, as before.
      const meleeReady = me.meleeMs <= 0 && me.cooldownMs <= 0 && me.switchMs <= 0;
      const inReach = bestD < MELEE[this.weapon]!.reach + 0.3 && Math.abs(wrap(wantYaw - this.yaw)) < 0.45;
      if (inReach && meleeReady && sim.phase === 'playing' && (this.brawl || sim.rng.next() < 0.08)) buttons |= BTN.melee;
      else if (sim.rules !== 'melee' && !(this.brawl && bestD < 4) && err < this.skill.fireConeRad && me.cooldownMs <= 0 && me.switchMs <= 0 && me.meleeMs <= 0 && sim.phase === 'playing') buttons |= BTN.fire;
      // Strafe and hold a comfortable range.
      if (now > this.strafeUntil) {
        this.strafeUntil = now + 600 + sim.rng.next() * 900;
        this.strafe = sim.rng.next() < 0.5 ? -1 : 1;
        if (sim.rng.next() < 0.12) this.jumpNext = true;
      }
      mx = this.strafe;
      mz = bestD > 15 ? 1 : bestD < 6 ? -1 : 0;
      // A brawler walks straight in and stops at arm's length (from any range when nobody can throw).
      if (this.brawl && (bestD < 12 || sim.rules === 'melee')) { mz = bestD > 1.2 ? 1 : 0; mx = bestD < 3 ? 0 : this.strafe * 0.4; }
    } else {
      // --- Navigate: towards the last sighting, a cafecito, or the plaza ----
      if (now >= this.replanAt || this.path.length === 0) this.replan(sim, me, now);
      const node = this.path[0] !== undefined ? this.graph.nodes[this.path[0]] : undefined;
      if (node) {
        const dx = node.x - me.body.x, dz = node.z - me.body.z;
        if (Math.hypot(dx, dz) < 0.7 && Math.abs(node.y - me.body.y) < 0.8) {
          this.path.shift();
        } else {
          wantYaw = Math.atan2(-dx, -dz);
          mz = Math.abs(wrap(wantYaw - this.yaw)) < 1.2 ? 1 : 0.3;
        }
      }
      wantPitch = 0;
      if (best) wantYaw = Math.atan2(-(best.body.x - eye.x), -(best.body.z - eye.z)); // turning to react
    }

    // --- Stuck recovery ------------------------------------------------------
    if (now >= this.stuckCheckAt) {
      const moved = Math.hypot(me.body.x - this.stuckPos.x, me.body.z - this.stuckPos.z);
      if ((mz !== 0 || mx !== 0) && moved < 0.35 && this.stuckCheckAt > 0) {
        this.jumpNext = true;
        this.path = [];
        this.replanAt = 0;
        this.strafe = -this.strafe;
      }
      this.stuckPos = { x: me.body.x, z: me.body.z };
      this.stuckCheckAt = now + 1200;
    }
    if (this.jumpNext) { buttons |= BTN.jump; this.jumpNext = false; }

    // Turn at a limited rate, like a hand on a mouse.
    const maxTurn = this.skill.turnRate * (dtMs / 1000);
    const dy = wrap(wantYaw - this.yaw);
    this.yaw = wrap(this.yaw + Math.max(-maxTurn, Math.min(maxTurn, dy)));
    const dp = wantPitch - this.pitch;
    this.pitch += Math.max(-maxTurn, Math.min(maxTurn, dp));
    return this.emit(me, mx, mz, buttons);
  }

  private replan(sim: MatchSim, me: SimPlayer, now: number): void {
    this.replanAt = now + 2500 + sim.rng.next() * 1500;
    const g = this.graph;
    const start = nearestNode(g, sim.world, me.body);
    let goal = -1;
    if (this.lastSeen && now - this.lastSeenAt < 6000) {
      goal = closestNode(g, this.lastSeen);
    } else if (me.hp < 50) {
      const pk = sim.pickups.find((p) => sim.timeMs >= p.availableAt);
      if (pk) goal = closestNode(g, pk);
    }
    if (goal < 0) {
      // Wander, biased towards the contested middle and enemy side.
      const enemySide = me.team === 0 ? 1 : -1;
      let bestScore = -Infinity;
      for (let i = 0; i < g.nodes.length; i++) {
        const n = g.nodes[i]!;
        const s = -Math.abs(n.x) * 0.15 + n.x * enemySide * 0.05 + sim.rng.next() * 6 - (i === this.goal ? 10 : 0);
        if (s > bestScore) { bestScore = s; goal = i; }
      }
    }
    this.goal = goal;
    this.path = findPath(g, start, goal);
    if (this.path.length === 0) this.path = g.links[start]!.length ? [g.links[start]![0]!] : [];
  }

  private emit(_me: SimPlayer, mx: number, mz: number, buttons: number): PlayerInput {
    return { seq: ++this.seq, mx, mz, yaw: this.yaw, pitch: this.pitch, buttons, weapon: this.weapon };
  }
}

function closestNode(g: NavGraph, p: { x: number; y: number; z: number }): number {
  let best = 0, bd = Infinity;
  g.nodes.forEach((n, i) => {
    const d = Math.hypot(n.x - p.x, n.z - p.z) + Math.abs(n.y - p.y) * 2;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
