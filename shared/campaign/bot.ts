// Helper bot for missions: plays a mission from the same hints the HUD
// shows. Used by tests (completion from a fresh save, soft-lock checks,
// time targets) and by the browser end-to-end run. It aims with a small
// deliberate error and reacts with a delay, like the multiplayer bots.

import { WEAPONS, type WeaponId } from '../config';
import { lineOfSight } from '../collision';
import { buildNavGraph, findPath, nearestNode, walkReaches, type NavGraph } from '../navgraph';
import type { MapData } from '../map';
import { missionHints, type MHint } from './hints';
import type { MissionSim } from './mission';
import type { PlayerInputM, V3 } from './types';

export interface BotOptions { seed?: number; aimErrorRad?: number; reactMs?: number }

export class MissionBot {
  private graph: NavGraph | null = null;
  private graphKey = '';
  private navMap: MapData | null = null;
  private path: number[] = [];
  private pathFor = '';
  private pathAt = 0;
  private seed: number;
  private aimErr: number;
  private reactMs: number;
  private focus = '';
  private focusSince = 0;
  private lastPos: [number, number] = [0, 0];
  private stuckMs = 0;
  private jumpMs = 0;
  private strafe = 1;
  hint: MHint | null = null;

  constructor(opts: BotOptions = {}) {
    this.seed = (opts.seed ?? 7) >>> 0;
    this.aimErr = opts.aimErrorRad ?? 0.012;
    this.reactMs = opts.reactMs ?? 260;
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private nav(sim: MissionSim): NavGraph {
    if (!this.graph || this.graphKey !== sim.collisionKey) {
      this.navMap = { ...sim.map, boxes: [...sim.world.boxes] as MapData['boxes'] };
      this.graph = buildNavGraph(this.navMap, sim.world);
      this.graphKey = sim.collisionKey;
      this.path = [];
    }
    return this.graph;
  }

  think(sim: MissionSim): PlayerInputM {
    const st = sim.state;
    const p = st.player;
    const idle: PlayerInputM = { mx: 0, mz: 0, yaw: p.yaw, pitch: p.pitch, fire: false, jump: false, crouch: false, weapon: p.weapon };
    if (!p.alive || st.complete) return idle;
    const now = st.timeMs;

    // Get out of marked danger first.
    for (const h of st.hazards) {
      if (h.t > h.warnMs + h.activeMs * 0.8) continue;
      if (!sim.inHazard(h, p.x, p.z)) continue;
      let ax = p.x - h.x, az = p.z - h.z;
      if (h.kind === 'cone') { const fx = -Math.sin(h.yaw), fz = -Math.cos(h.yaw); ax = -fz * this.strafe; az = fx * this.strafe; }
      const d = Math.hypot(ax, az) || 1;
      return this.move(sim, { ...idle }, [ax / d, az / d], true);
    }

    const hints = missionHints(sim);
    const actionable = hints.filter((h) => h.kind !== 'wait' && h.kind !== 'stay');
    const pool = actionable.length ? actionable : hints;
    if (!pool.length) return idle;
    // Nearest first, but stick with a focus for a while to avoid dithering.
    let pick = pool.find((h) => h.id === this.focus && now - this.focusSince < 9000);
    if (!pick) {
      pick = [...pool].sort((a, b) => this.cost(p, a) - this.cost(p, b))[0]!;
      this.focus = pick.id;
      this.focusSince = now;
    }
    this.hint = pick;
    const inp = { ...idle };
    switch (pick.kind) {
      case 'pickup': case 'go': return this.goTo(sim, inp, pick.pos, 0.3);
      case 'stay': return this.goTo(sim, inp, pick.pos, 1.5);
      case 'wait': return this.watch(sim, inp, pick);
      case 'shoot': return this.shoot(sim, inp, pick);
    }
  }

  private cost(p: { x: number; y: number; z: number }, h: MHint): number {
    const at = h.stand ?? h.pos;
    return Math.hypot(at[0] - p.x, at[2] - p.z) + Math.abs(at[1] - p.y) * 4 + (h.kind === 'shoot' ? -3 : 0);
  }

  private shoot(sim: MissionSim, inp: PlayerInputM, h: MHint): PlayerInputM {
    const p = sim.state.player;
    const weapon: WeaponId = h.need === 'heavy' ? 1 : 0;
    inp.weapon = weapon;
    const eye = sim.eye();
    if (h.stand) {
      if (Math.hypot(h.stand[0] - p.x, h.stand[2] - p.z) > 0.6 || Math.abs(h.stand[1] - p.y) > 1) return this.goTo(sim, inp, h.stand, 0.35, h.aim ?? h.pos);
      return this.fireAt(sim, inp, h.aim ?? h.pos, h);
    }
    // Lead moving targets by the flight time.
    const speed = WEAPONS[weapon]!.speed;
    const d = Math.hypot(h.pos[0] - eye[0], h.pos[1] - eye[1], h.pos[2] - eye[2]);
    const tf = d / speed + 0.03;
    const aim: V3 = h.vel ? [h.pos[0] + h.vel[0] * tf, h.pos[1], h.pos[2] + h.vel[2] * tf] : h.pos;
    const los = lineOfSight({ x: eye[0], y: eye[1], z: eye[2] }, { x: aim[0], y: aim[1], z: aim[2] }, sim.world.near(eye[0], eye[2], aim[0], aim[2], 1), (b) => b.tag !== 'floor' && !this.containsPoint(b, h.pos));
    if (los && d < (h.vel && Math.hypot(h.vel[0], h.vel[2]) > 0.5 ? 13 : 22)) {
      // Keep a sensible distance and strafe a little while throwing.
      const out = this.fireAt(sim, inp, aim, h);
      const dx = h.pos[0] - p.x, dz = h.pos[2] - p.z, dd = Math.hypot(dx, dz) || 1;
      const dir: [number, number] = dd > 12 ? [dx / dd, dz / dd] : dd < 4 ? [-dx / dd, -dz / dd] : [0, 0];
      return dir[0] || dir[1] ? this.move(sim, out, dir, false) : out;
    }
    return this.goTo(sim, inp, [h.pos[0], 0, h.pos[2]], 6, h.pos);
  }

  private containsPoint(b: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }, p: V3): boolean {
    return p[0] > b.minX - 0.7 && p[0] < b.maxX + 0.7 && p[1] > b.minY - 0.7 && p[1] < b.maxY + 0.7 && p[2] > b.minZ - 0.7 && p[2] < b.maxZ + 0.7;
  }

  private fireAt(sim: MissionSim, inp: PlayerInputM, at: V3, h: MHint): PlayerInputM {
    const eye = sim.eye();
    const dx = at[0] - eye[0], dy = at[1] - eye[1], dz = at[2] - eye[2];
    const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const e = this.aimErr;
    inp.yaw = yaw + (this.rand() - 0.5) * 2 * e;
    inp.pitch = pitch + (this.rand() - 0.5) * 2 * e;
    const p = sim.state.player;
    const settled = sim.state.timeMs - this.focusSince > this.reactMs;
    const ready = p.cooldownMs <= 0 && p.switchMs <= 0 && p.weapon === inp.weapon;
    inp.fire = settled && ready && (h.open ?? true);
    return inp;
  }

  private watch(sim: MissionSim, inp: PlayerInputM, h: MHint): PlayerInputM {
    const p = sim.state.player;
    const d = Math.hypot(h.pos[0] - p.x, h.pos[2] - p.z);
    const eye = sim.eye();
    inp.yaw = Math.atan2(-(h.pos[0] - eye[0]), -(h.pos[2] - eye[2]));
    inp.pitch = Math.atan2(h.pos[1] - eye[1], d);
    if (d > 9) return this.goTo(sim, inp, h.pos, 8, h.pos);
    return inp;
  }

  // Walk toward `to` (straight if possible, else along the waypoint graph),
  // optionally keeping the view on `look`.
  private goTo(sim: MissionSim, inp: PlayerInputM, to: V3, within: number, look?: V3): PlayerInputM {
    const p = sim.state.player;
    const dist = Math.hypot(to[0] - p.x, to[2] - p.z);
    if (dist < within && Math.abs(to[1] - p.y) < 1.2) {
      if (look) this.face(sim, inp, look);
      return inp;
    }
    let tx = to[0], tz = to[2];
    const g = this.nav(sim);
    const key = `${to[0].toFixed(0)},${to[1].toFixed(0)},${to[2].toFixed(0)}`;
    const direct = dist < 9 && Math.abs(to[1] - p.y) < 0.6 && walkReaches(sim.world, p, { x: to[0], y: to[1], z: to[2] });
    if (!direct) {
      if (this.pathFor !== key || sim.state.timeMs - this.pathAt > 4000) {
        const a = nearestNode(g, sim.world, p);
        const b = destNode(g, to);
        this.path = findPath(g, a, b);
        this.pathFor = key;
        this.pathAt = sim.state.timeMs;
      }
      // Consume reached nodes; once the last one is reached, go straight.
      while (this.path.length && Math.hypot(g.nodes[this.path[0]!]!.x - p.x, g.nodes[this.path[0]!]!.z - p.z) < 0.6 && Math.abs(g.nodes[this.path[0]!]!.y - p.y) < 0.8) this.path.shift();
      const n = this.path[0] !== undefined ? g.nodes[this.path[0]!]! : null;
      if (n) { tx = n.x; tz = n.z; }
    }
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz) || 1;
    if (look) this.face(sim, inp, look); else { inp.yaw = Math.atan2(-dx, -dz); inp.pitch = 0; }
    return this.move(sim, inp, [dx / d, dz / d], false);
  }

  private face(sim: MissionSim, inp: PlayerInputM, look: V3): void {
    const eye = sim.eye();
    const dx = look[0] - eye[0], dz = look[2] - eye[2];
    inp.yaw = Math.atan2(-dx, -dz);
    inp.pitch = Math.atan2(look[1] - eye[1], Math.hypot(dx, dz));
  }

  // World-space direction to movement axes for the current yaw.
  private move(sim: MissionSim, inp: PlayerInputM, dir: [number, number], keepYaw: boolean): PlayerInputM {
    const p = sim.state.player;
    if (keepYaw && !inp.fire) inp.yaw = Math.atan2(-dir[0], -dir[1]);
    const s = Math.sin(inp.yaw), c = Math.cos(inp.yaw);
    // forward = (-s, -c), right = (c, -s)
    inp.mz = dir[0] * -s + dir[1] * -c;
    inp.mx = dir[0] * c + dir[1] * -s;
    // Stuck: jump and pick a new side to strafe.
    const moved = Math.hypot(p.x - this.lastPos[0], p.z - this.lastPos[1]);
    this.lastPos = [p.x, p.z];
    if (moved < 0.02) this.stuckMs += 1000 / 60; else this.stuckMs = Math.max(0, this.stuckMs - 50);
    if (this.stuckMs > 900) { this.jumpMs = 300; this.stuckMs = 0; this.strafe = -this.strafe; this.path = []; this.pathFor = ''; this.focusSince -= 2000; }
    if (this.jumpMs > 0) { this.jumpMs -= 1000 / 60; inp.jump = true; inp.mx += this.strafe * 0.6; }
    return inp;
  }
}

// The node to path to for a destination that may sit on a prop (a vanity,
// a terrace): the closest node at or below it, by plain distance.
function destNode(g: NavGraph, to: V3): number {
  let best = 0, bd = Infinity;
  g.nodes.forEach((n, i) => {
    if (n.y > to[1] + 0.6) return;
    const d = Math.hypot(n.x - to[0], n.z - to[2]) + Math.max(0, to[1] - n.y - 1.5) * 4;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
