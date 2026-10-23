// Mission simulation: interprets a MissionDef at a fixed 60 Hz.
//
// It reuses the multiplayer rules wholesale: the same movement and
// collision (physics.ts), the same throw solver (launch) and the same
// ricochet stepping (stepProjectileWorld), the same weapon table. What it
// adds is mission state: pickups, targets, actors, blockers, hazards,
// stages and goals.
//
// All state lives in one plain-data object (MState) so a checkpoint is a
// structuredClone and a retry is an exact restore. Nothing here touches the
// DOM, audio or rendering; the client reads `state` and drains `events`.

import { MOVE, NET, WEAPONS, WEAPON_SWITCH_MS, type WeaponId } from '../config';
import { EL_PATIO, type MapBox, type MapData } from '../map';
import { World, bodyHeight, eyeHeight, newBody, settle, stepMove, type Body } from '../physics';
import { launch, stepProjectileWorld, type Hitbox, type Projectile } from '../sim';
import { lineOfSight, segmentCapsule, segmentSphere, type AABB } from '../collision';
import type {
  Action, ActorSpec, BlockerSpec, EntitySpec, GoalSpec, ItemKind, MissionDef, PickupSpec, PlayerInputM, TargetSpec, V3,
} from './types';
import { PinataSim, type PinataState } from './pinata';

export const DT = 1 / NET.tickRate;
export const DT_MS = 1000 / NET.tickRate;

// Tuning shared by every mission (balance values live here, not in logic).
export const CAMPAIGN = {
  maxHealth: 100,
  regenDelayMs: 4000,
  regenPerSec: 6,
  koMs: 2500,
  respawnInvulnMs: 2000,
  collectRadius: 1.15,
  carrySpeed: 0.85,
  hitRadiusActor: 0.55,
  hintAfterMs: 20000, // no progress for this long: the client may offer a hint
};

// ------------------------------------------------------------------ state

export interface PlayerS extends Body {
  yaw: number; pitch: number;
  hp: number; alive: boolean; koMs: number; invulnMs: number; sinceHurtMs: number;
  weapon: WeaponId; cooldownMs: number; switchMs: number; lastFire: boolean;
  carrying: string | null;
}

export interface PickupS {
  id: string; item: ItemKind; variant: string;
  x: number; y: number; z: number;
  state: 'hidden' | 'falling' | 'free' | 'held' | 'carried' | 'collected' | 'delivered';
  fall: { from: V3; to: V3; t: number } | null;
  lockUntil: number; // a just-spilled item cannot be grabbed again instantly
}

export interface TargetS { id: string; hitsLeft: number; done: boolean; enabled: boolean; enabledAt: number; flashMs: number }

export interface ActorS {
  id: string; x: number; y: number; z: number; yaw: number; vx: number; vz: number;
  idx: number; mode: string; modeMs: number; hits: number; holds: string | null;
  enabled: boolean; done: boolean; speedMul: number; cycles: number;
}

export interface HazardS {
  id: number; kind: 'circle' | 'cone'; x: number; y: number; z: number; r: number; yaw: number; half: number;
  warnMs: number; activeMs: number; t: number; dmg: number; push: number; hitPlayer: boolean; src: string;
}

export interface ProjS extends Projectile {
  bankTag: string | null; // the marked surface it last bounced off
  hitSomething: boolean;
  hostile: boolean; // thrown at Rosa (piñata decoys)
}

export interface GoalS {
  id: string; done: boolean; count: number; total: number;
  progress: number; disruptedMs: number; malfunctioned: boolean;
}

export interface Stats {
  throws: number; hits: number; banks: number; kos: number;
  cartThrows: number; cartActive: boolean; segmentsLost: number; scatters: number;
  scattersAtBlowerOff: number; blowerOff: boolean; finishRicochet: boolean;
}

export interface MState {
  mission: string;
  timeMs: number;
  stage: number;
  stageStartMs: number;
  lastProgressMs: number;
  goals: GoalS[];
  flags: string[];
  player: PlayerS;
  pickups: PickupS[];
  targets: TargetS[];
  actors: ActorS[];
  blockers: Array<{ id: string; present: boolean }>;
  decos: Array<{ id: string; fixed: boolean }>;
  pinata: PinataState | null;
  projs: ProjS[];
  hazards: HazardS[];
  nextId: number;
  rng: number;
  stats: Stats;
  complete: boolean;
  completeMs: number;
}

export type MEvent =
  | { k: 'throw'; id: number; w: WeaponId; p: V3; v: V3; hostile: boolean }
  | { k: 'bounce'; id: number; p: V3; tag: string | null }
  | { k: 'pend'; id: number; p: V3; hit: boolean; w: WeaponId; hostile: boolean }
  | { k: 'miss' }
  | { k: 'hit'; what: 'target' | 'actor' | 'pinata'; id: string; part?: string; bank: boolean; heavy: boolean; p: V3 }
  | { k: 'reject'; id: string; why: 'bank' | 'heavy' | 'timing' | 'dodge' | 'armor' }
  | { k: 'collect'; id: string; item: ItemKind; n: number; total: number }
  | { k: 'carry'; id: string } | { k: 'deliver'; id: string } | { k: 'spill'; id: string }
  | { k: 'knocked'; id: string } | { k: 'reveal'; id: string } | { k: 'drop'; id: string }
  | { k: 'goal'; id: string } | { k: 'stage'; idx: number; id: string } | { k: 'checkpoint' }
  | { k: 'say'; line: string } | { k: 'flag'; flag: string; on: boolean }
  | { k: 'hurt'; dmg: number; from: [number, number] } | { k: 'ko' } | { k: 'respawn' }
  | { k: 'telegraph'; hz: number; kind: 'circle' | 'cone'; ms: number; src: string } | { k: 'hazard'; hz: number; src: string }
  | { k: 'scatter'; id: string } | { k: 'setback'; goal: string } | { k: 'segment'; goal: string; n: number }
  | { k: 'actor'; id: string; mode: string } | { k: 'remove'; id: string } | { k: 'restore'; id: string } | { k: 'fix'; id: string }
  | { k: 'phase'; n: number } | { k: 'complete' };

export interface MissionResult {
  timeMs: number; kos: number; throws: number; hits: number; accuracy: number;
  challenges: Record<'complete' | 'time' | 'skill', boolean>;
}

// ----------------------------------------------------------------- layout

export function missionMap(def: MissionDef): MapData {
  const signs = def.layout.signs ?? {};
  const base = EL_PATIO.boxes.filter((b) => !def.layout.remove?.(b)).map((b) => (b.sign && signs[b.sign] ? { ...b, sign: signs[b.sign] } : b));
  const boxes = [...base, ...def.layout.add];
  const world = new World(boxes);
  // Navigation nodes: the base map's, minus any now inside solid props.
  const extra = (def.layout.waypoints ?? []).map(([x, y, z]) => ({ x, y, z }));
  const waypoints = [...EL_PATIO.waypoints, ...extra].filter((w) => {
    const b = newBody(w.x, w.y + 0.02, w.z);
    return !world.near(b.x, b.z, b.x, b.z, 0.3).some((x) => x.tag !== 'floor' && w.y + 0.3 < x.maxY && w.y + 1.6 > x.minY && w.x > x.minX - 0.3 && w.x < x.maxX + 0.3 && w.z > x.minZ - 0.3 && w.z < x.maxZ + 0.3);
  });
  return { ...EL_PATIO, name: `El Patio (${def.id})`, boxes, waypoints };
}

function blockerBox(b: BlockerSpec): MapBox {
  const [x0, y0, z0, x1, y1, z1] = b.box;
  return { minX: x0, minY: y0, minZ: z0, maxX: x1, maxY: y1, maxZ: z1, bounce: false, blocksSound: true, tag: `blocker:${b.id}`, mat: 'crate' };
}

// --------------------------------------------------------------- the sim

export class MissionSim {
  readonly def: MissionDef;
  readonly map: MapData;
  state: MState;
  world: World;
  events: MEvent[] = [];
  private specs = new Map<string, EntitySpec>();
  private checkpoint: MState | null = null;
  pinata: PinataSim | null = null;
  private worldKey = '';

  constructor(def: MissionDef, seed = 1) {
    this.def = def;
    this.map = missionMap(def);
    for (const e of def.entities) this.specs.set(e.id, e);
    this.state = this.fresh(seed);
    this.world = this.buildWorld();
    this.enterStage(0);
  }

  // ------------------------------------------------------------ set-up

  private fresh(seed: number): MState {
    const d = this.def;
    const p = newBody(d.start.at[0], d.start.at[1], d.start.at[2]) as PlayerS;
    Object.assign(p, {
      yaw: d.start.yaw, pitch: 0, hp: CAMPAIGN.maxHealth, alive: true, koMs: 0, invulnMs: 0, sinceHurtMs: 1e9,
      weapon: 0 as WeaponId, cooldownMs: 0, switchMs: 0, lastFire: false, carrying: null,
    });
    const st: MState = {
      mission: d.id, timeMs: 0, stage: -1, stageStartMs: 0, lastProgressMs: 0, goals: [], flags: [], player: p,
      pickups: [], targets: [], actors: [], blockers: [], decos: [], pinata: null, projs: [], hazards: [], nextId: 1, rng: seed,
      stats: { throws: 0, hits: 0, banks: 0, kos: 0, cartThrows: 0, cartActive: false, segmentsLost: 0, scatters: 0, scattersAtBlowerOff: -1, blowerOff: false, finishRicochet: false },
      complete: false, completeMs: 0,
    };
    for (const e of d.entities) {
      switch (e.kind) {
        case 'pickup':
          st.pickups.push({ id: e.id, item: e.item, variant: e.variant ?? '', x: e.at[0], y: e.at[1], z: e.at[2], state: e.hidden ? 'hidden' : 'free', fall: null, lockUntil: 0 });
          break;
        case 'target':
          st.targets.push({ id: e.id, hitsLeft: e.hits ?? 1, done: false, enabled: !e.disabled, enabledAt: 0, flashMs: 0 });
          break;
        case 'actor': {
          const holds = 'holds' in e.behavior ? e.behavior.holds : null;
          st.actors.push({
            id: e.id, x: e.path[0]![0], y: e.path[0]![1], z: e.path[0]![2], yaw: 0, vx: 0, vz: 0, idx: 0, mode: initialMode(e), modeMs: 0,
            hits: 0, holds, enabled: !e.disabled, done: false, speedMul: 1, cycles: 0,
          });
          if (holds) { const pk = st.pickups.find((x) => x.id === holds); if (pk) pk.state = 'held'; }
          break;
        }
        case 'blocker':
          st.blockers.push({ id: e.id, present: !e.absent });
          break;
        case 'deco':
          st.decos.push({ id: e.id, fixed: false });
          break;
        case 'pinata':
          this.pinata = new PinataSim(e);
          st.pinata = this.pinata.initial();
          break;
        default:
          break;
      }
    }
    return st;
  }

  private buildWorld(): World {
    const extra = this.def.entities.filter((e): e is BlockerSpec => e.kind === 'blocker')
      .filter((b) => this.state.blockers.find((x) => x.id === b.id)?.present)
      .map(blockerBox);
    this.worldKey = this.state.blockers.map((b) => (b.present ? '1' : '0')).join('');
    return new World([...this.map.boxes, ...extra]);
  }

  private refreshWorld(): void {
    const key = this.state.blockers.map((b) => (b.present ? '1' : '0')).join('');
    if (key !== this.worldKey) {
      this.world = this.buildWorld();
      // Nobody ends up inside a pile that came back.
      settle(this.world, this.state.player);
    }
  }

  /** Blocker presence signature: changes whenever collision changes. */
  get collisionKey(): string { return this.worldKey; }

  spec<T extends EntitySpec>(id: string): T | undefined { return this.specs.get(id) as T | undefined; }

  get stageDef() { return this.def.stages[this.state.stage]!; }

  private emit(e: MEvent): void { this.events.push(e); }

  drainEvents(): MEvent[] { const e = this.events; this.events = []; return e; }

  private inStage(e: { stages?: string[] }): boolean {
    return !e.stages || e.stages.includes(this.stageDef.id);
  }

  // ---------------------------------------------------- stages & goals

  private enterStage(idx: number): void {
    const st = this.state;
    st.stage = idx;
    st.stageStartMs = st.timeMs;
    st.lastProgressMs = st.timeMs;
    const sd = this.def.stages[idx]!;
    st.goals = sd.goals.map((g) => ({ id: g.id, done: false, count: 0, total: goalTotal(g), progress: 0, disruptedMs: 0, malfunctioned: false }));
    this.emit({ k: 'stage', idx, id: sd.id });
    for (const a of sd.onEnter ?? []) this.act(a);
    this.evaluateGoals();
    // Checkpoint: a snapshot at the start of every stage, minus transient things.
    const snap = structuredClone(st);
    snap.projs = []; snap.hazards = [];
    this.checkpoint = snap;
    this.emit({ k: 'checkpoint' });
  }

  private evaluateGoals(): void {
    const st = this.state;
    if (st.complete) return;
    const sd = this.stageDef;
    sd.goals.forEach((g, i) => {
      const gs = st.goals[i]!;
      if (gs.done) return;
      const before = gs.count;
      switch (g.kind) {
        case 'collect':
          gs.count = st.pickups.filter((p) => p.item === g.item && p.state === 'collected').length;
          if (gs.count >= g.count) this.goalDone(gs);
          break;
        case 'flags':
          gs.count = g.flags.filter((f) => st.flags.includes(f)).length;
          if (gs.count >= g.flags.length) this.goalDone(gs);
          break;
        case 'reach': {
          const z = this.spec(g.zone) as { at: V3; r: number } | undefined;
          if (z && Math.hypot(st.player.x - z.at[0], st.player.z - z.at[2]) < z.r && st.player.alive) this.goalDone(gs);
          break;
        }
        case 'deliver':
          if (st.pickups.some((p) => p.item === g.item && p.state === 'delivered')) this.goalDone(gs);
          break;
        case 'boss':
          if (st.pinata?.defeated) this.goalDone(gs);
          break;
        case 'defend':
          if (gs.progress >= 1) this.goalDone(gs);
          break;
      }
      if (gs.count > before) st.lastProgressMs = st.timeMs;
    });
    if (st.goals.every((g) => g.done)) {
      for (const a of sd.onDone ?? []) this.act(a);
      if (st.stage + 1 < this.def.stages.length) this.enterStage(st.stage + 1);
      else this.finish();
    }
  }

  private goalDone(gs: GoalS): void {
    if (gs.done) return; // objectives complete once
    gs.done = true;
    gs.count = gs.total;
    this.state.lastProgressMs = this.state.timeMs;
    this.emit({ k: 'goal', id: gs.id });
  }

  private finish(): void {
    const st = this.state;
    st.complete = true;
    st.completeMs = st.timeMs;
    this.emit({ k: 'complete' });
  }

  // --------------------------------------------------------- actions

  act(a: Action): void {
    const st = this.state;
    switch (a.do) {
      case 'reveal': {
        const p = st.pickups.find((x) => x.id === a.id);
        if (p && p.state === 'hidden') { p.state = 'free'; this.emit({ k: 'reveal', id: p.id }); }
        break;
      }
      case 'drop': {
        const p = st.pickups.find((x) => x.id === a.id);
        if (p && (p.state === 'hidden' || p.state === 'held')) this.dropPickup(p, a.to);
        break;
      }
      case 'flag':
        this.setFlag(a.flag, true);
        break;
      case 'say':
        this.emit({ k: 'say', line: a.line });
        break;
      case 'remove': case 'restore': {
        const b = st.blockers.find((x) => x.id === a.id);
        const on = a.do === 'restore';
        if (b && b.present !== on) { b.present = on; this.emit(on ? { k: 'restore', id: a.id } : { k: 'remove', id: a.id }); this.refreshWorld(); }
        break;
      }
      case 'fix': {
        const d = st.decos.find((x) => x.id === a.id);
        if (d && !d.fixed) { d.fixed = true; this.emit({ k: 'fix', id: a.id }); }
        break;
      }
      case 'enable': case 'disable': {
        const on = a.do === 'enable';
        const t = st.targets.find((x) => x.id === a.id);
        if (t) { if (on && !t.enabled) t.enabledAt = st.timeMs; t.enabled = on; }
        const ac = st.actors.find((x) => x.id === a.id);
        if (ac && ac.enabled !== on) { ac.enabled = on; if (on && ac.id.startsWith('cart')) st.stats.cartActive = true; }
        break;
      }
    }
  }

  private setFlag(flag: string, on: boolean): void {
    const st = this.state;
    const has = st.flags.includes(flag);
    if (on && !has) { st.flags.push(flag); this.emit({ k: 'flag', flag, on }); st.lastProgressMs = st.timeMs; }
    if (!on && has) { st.flags = st.flags.filter((f) => f !== flag); this.emit({ k: 'flag', flag, on }); }
  }

  private dropPickup(p: PickupS, to: V3): void {
    p.fall = { from: [p.x, p.y, p.z], to, t: 0 };
    p.state = 'falling';
    this.emit({ k: 'drop', id: p.id });
  }

  // -------------------------------------------------------------- step

  step(inp: PlayerInputM): void {
    const st = this.state;
    if (st.complete) { st.projs = []; st.hazards = []; return; }
    st.timeMs += DT_MS;
    this.stepPlayer(inp);
    this.stepPickups();
    this.stepTargets();
    for (const a of st.actors) this.stepActor(a);
    if (this.pinata && st.pinata) this.pinata.step(st.pinata, this.pinataCtx());
    this.stepHazards();
    this.stepProjectiles();
    this.stepGoals();
    this.evaluateGoals();
  }

  private stepPlayer(inp: PlayerInputM): void {
    const st = this.state;
    const p = st.player;
    if (p.cooldownMs > 0) p.cooldownMs = Math.max(0, p.cooldownMs - DT_MS);
    if (p.switchMs > 0) p.switchMs = Math.max(0, p.switchMs - DT_MS);
    if (p.invulnMs > 0) p.invulnMs = Math.max(0, p.invulnMs - DT_MS);
    p.sinceHurtMs += DT_MS;
    if (!p.alive) {
      p.koMs -= DT_MS;
      if (p.koMs <= 0) this.respawnPlayer();
      return;
    }
    if (p.sinceHurtMs > CAMPAIGN.regenDelayMs && p.hp < CAMPAIGN.maxHealth) p.hp = Math.min(CAMPAIGN.maxHealth, p.hp + CAMPAIGN.regenPerSec * DT);
    p.yaw = inp.yaw;
    p.pitch = Math.max(-MOVE.maxPitch, Math.min(MOVE.maxPitch, inp.pitch));
    if (inp.weapon !== p.weapon) { p.weapon = inp.weapon; p.switchMs = WEAPON_SWITCH_MS; }
    const k = p.carrying ? CAMPAIGN.carrySpeed : 1;
    stepMove(this.world, p, { mx: inp.mx * k, mz: inp.mz * k, yaw: p.yaw, jump: inp.jump, crouch: inp.crouch }, DT);
    if (p.y < -5) { p.x = this.stageDef.respawn.at[0]; p.y = this.stageDef.respawn.at[1]; p.z = this.stageDef.respawn.at[2]; settle(this.world, p); }
    if (inp.fire && p.cooldownMs <= 0 && p.switchMs <= 0) {
      const def = WEAPONS[p.weapon]!;
      p.cooldownMs = def.cooldownMs;
      const { p: o, v } = launch(this.world, p, p.yaw, p.pitch, p.weapon, this.aimTargets());
      this.spawnProj(o, v, p.weapon, false);
      st.stats.throws++;
      if (st.stats.cartActive) st.stats.cartThrows++;
    }
    p.lastFire = inp.fire;
  }

  spawnProj(o: V3, v: V3, weapon: WeaponId, hostile: boolean): void {
    const st = this.state;
    const id = st.nextId++;
    st.projs.push({ id, owner: hostile ? -1 : 0, team: 0, weapon, x: o[0], y: o[1], z: o[2], vx: v[0], vy: v[1], vz: v[2], ageMs: 0, traveled: 0, bounces: 0, fireSeq: 0, bankTag: null, hitSomething: false, hostile });
    this.emit({ k: 'throw', id, w: weapon, p: o, v, hostile });
  }

  // What the crosshair can snap onto when solving the throw arc.
  private aimTargets(): Hitbox[] {
    const out: Hitbox[] = [];
    for (const a of this.state.actors) {
      if (!a.enabled || a.done) continue;
      const [y0, y1, r] = actorShape(this.spec<ActorSpec>(a.id)!);
      out.push({ x: a.x, z: a.z, y0: a.y + y0, y1: a.y + y1, r, hx: a.x, hy: a.y + y1, hz: a.z, hr: 0.01 });
    }
    return out;
  }

  private respawnPlayer(): void {
    const p = this.state.player;
    const r = this.stageDef.respawn;
    p.x = r.at[0]; p.y = r.at[1]; p.z = r.at[2]; p.vx = p.vy = p.vz = 0;
    settle(this.world, p);
    p.yaw = r.yaw; p.pitch = 0;
    p.hp = CAMPAIGN.maxHealth; p.alive = true; p.invulnMs = CAMPAIGN.respawnInvulnMs; p.sinceHurtMs = 1e9;
    this.emit({ k: 'respawn' });
  }

  hurt(dmg: number, fromX: number, fromZ: number): void {
    const p = this.state.player;
    if (!p.alive || p.invulnMs > 0 || this.state.complete) return;
    p.hp -= dmg;
    p.sinceHurtMs = 0;
    this.emit({ k: 'hurt', dmg, from: [fromX, fromZ] });
    if (p.hp <= 0) {
      p.hp = 0; p.alive = false; p.koMs = CAMPAIGN.koMs;
      this.state.stats.kos++;
      if (p.carrying) {
        const c = this.state.pickups.find((x) => x.id === p.carrying);
        if (c) { c.state = 'free'; c.x = p.x; c.y = p.y; c.z = p.z; this.emit({ k: 'spill', id: c.id }); }
        p.carrying = null;
      }
      this.emit({ k: 'ko' });
    }
  }

  push(dx: number, dz: number): void {
    const p = this.state.player;
    if (!p.alive) return;
    p.vx += dx; p.vz += dz;
  }

  // ----------------------------------------------------------- pickups

  private stepPickups(): void {
    const st = this.state;
    const p = st.player;
    for (const pk of st.pickups) {
      if (pk.state === 'falling' && pk.fall) {
        pk.fall.t = Math.min(1, pk.fall.t + DT / 0.7);
        const t = pk.fall.t;
        const [a, b] = [pk.fall.from, pk.fall.to];
        pk.x = a[0] + (b[0] - a[0]) * t; pk.z = a[2] + (b[2] - a[2]) * t;
        pk.y = a[1] + (b[1] - a[1]) * t + Math.sin(t * Math.PI) * 0.8;
        if (t >= 1) { pk.state = 'free'; pk.fall = null; }
      }
      if (pk.state === 'carried') { pk.x = p.x; pk.y = p.y + 1.1; pk.z = p.z; continue; }
      if (pk.state !== 'free' || !p.alive || st.timeMs < pk.lockUntil) continue;
      const spec = this.spec<PickupSpec>(pk.id)!;
      if (!this.inStage(spec)) continue;
      const near = Math.hypot(p.x - pk.x, p.z - pk.z) < CAMPAIGN.collectRadius && pk.y - p.y < 1.9 && p.y - pk.y < 1.2;
      if (!near) continue;
      if (spec.carry) {
        if (p.carrying) continue;
        pk.state = 'carried';
        p.carrying = pk.id;
        this.emit({ k: 'carry', id: pk.id });
      } else {
        pk.state = 'collected';
        const total = st.pickups.filter((x) => x.item === pk.item).length;
        const n = st.pickups.filter((x) => x.item === pk.item && x.state === 'collected').length;
        this.emit({ k: 'collect', id: pk.id, item: pk.item, n, total });
      }
      st.lastProgressMs = st.timeMs;
    }
    // Storing a carried prop: a zone named `<id>_zone` flags `<id>_stored`.
    if (p.carrying) {
      const c = st.pickups.find((x) => x.id === p.carrying);
      const z = c ? this.spec(`${c.id}_zone`) as { at: V3; r: number } | undefined : undefined;
      if (c && z && Math.hypot(p.x - z.at[0], p.z - z.at[2]) < z.r && Math.abs(p.y - z.at[1]) < 1.5) {
        c.state = 'delivered';
        c.x = z.at[0] + (this.nextRand() - 0.5) * 0.8; c.y = z.at[1]; c.z = z.at[2] + (this.nextRand() - 0.5) * 0.8;
        p.carrying = null;
        this.emit({ k: 'deliver', id: c.id });
        this.setFlag(`${c.id}_stored`, true);
      }
    }
    // Deliveries.
    if (p.carrying) {
      const sd = this.stageDef;
      for (const g of sd.goals) {
        if (g.kind !== 'deliver') continue;
        const c = st.pickups.find((x) => x.id === p.carrying);
        const z = this.spec(g.zone) as { at: V3; r: number } | undefined;
        if (c && z && c.item === g.item && Math.hypot(p.x - z.at[0], p.z - z.at[2]) < z.r) {
          c.state = 'delivered';
          c.x = z.at[0]; c.y = z.at[1] + 1.0; c.z = z.at[2];
          p.carrying = null;
          this.emit({ k: 'deliver', id: c.id });
        }
      }
    }
  }

  // ----------------------------------------------------------- targets

  private stepTargets(): void {
    for (const t of this.state.targets) if (t.flashMs > 0) t.flashMs -= DT_MS;
  }

  targetOpen(t: TargetS, spec: TargetSpec): boolean {
    if (!spec.window) return true;
    const ph = (this.state.timeMs - t.enabledAt) % spec.window.periodMs;
    return ph < spec.window.openMs;
  }

  private hitTarget(t: TargetS, spec: TargetSpec, pr: ProjS, splash: boolean): boolean {
    if (spec.need === 'bank' && pr.bounces === 0) { this.emit({ k: 'reject', id: t.id, why: 'bank' }); return false; }
    if (spec.need === 'heavy' && pr.weapon !== 1) { this.emit({ k: 'reject', id: t.id, why: 'heavy' }); return false; }
    if (!this.targetOpen(t, spec)) { this.emit({ k: 'reject', id: t.id, why: 'timing' }); return false; }
    t.hitsLeft--;
    t.flashMs = 200;
    this.state.stats.hits++;
    if (pr.bounces > 0) this.state.stats.banks++;
    this.emit({ k: 'hit', what: 'target', id: t.id, bank: pr.bounces > 0, heavy: pr.weapon === 1 || splash, p: [pr.x, pr.y, pr.z] });
    if (t.hitsLeft <= 0 && !t.done) {
      t.done = true;
      for (const a of spec.on) this.act(a);
    }
    return true;
  }

  // ------------------------------------------------------------ actors

  private stepActor(a: ActorS): void {
    const spec = this.spec<ActorSpec>(a.id)!;
    if (!a.enabled || a.done) { a.vx = a.vz = 0; return; }
    if (!this.inStage(spec)) { a.vx = a.vz = 0; return; }
    a.modeMs += DT_MS;
    const b = spec.behavior;
    const st = this.state;
    const p = st.player;
    const setMode = (m: string) => { if (a.mode !== m) { a.mode = m; a.modeMs = 0; this.emit({ k: 'actor', id: a.id, mode: m }); } };
    const walkTo = (x: number, z: number, speed: number): boolean => {
      const dx = x - a.x, dz = z - a.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.15) { a.vx = a.vz = 0; return true; }
      const s = Math.min(d / DT, speed);
      a.vx = (dx / d) * s; a.vz = (dz / d) * s;
      a.x += a.vx * DT; a.z += a.vz * DT;
      a.yaw = Math.atan2(-dx, -dz);
      return false;
    };
    const follow = (speed: number) => {
      const n = spec.path[(a.idx + 1) % spec.path.length]!;
      a.y = n[1];
      if (walkTo(n[0], n[2], speed)) { a.idx = (a.idx + 1) % spec.path.length; if (a.idx === 0) a.cycles++; return true; }
      return false;
    };
    const face = () => { a.yaw = Math.atan2(-(p.x - a.x), -(p.z - a.z)); };
    // Walk the path forward (dir 1, toward the last point) or back home (dir -1),
    // following its heights (stairs). Returns true at the end.
    const route = (dir: 1 | -1, speed: number): boolean => {
      const last = spec.path.length - 1;
      const target = dir === 1 ? Math.min(last, a.idx + 1) : Math.max(0, a.idx - 1);
      if ((dir === 1 && a.idx >= last) || (dir === -1 && a.idx <= 0)) { a.vx = a.vz = 0; return true; }
      const from = spec.path[a.idx]!, to = spec.path[target]!;
      const seg = Math.hypot(to[0] - from[0], to[2] - from[2]) || 1;
      const arrived = walkTo(to[0], to[2], speed);
      const k = Math.min(1, 1 - Math.hypot(to[0] - a.x, to[2] - a.z) / seg);
      a.y = from[1] + (to[1] - from[1]) * Math.max(0, k);
      if (arrived) { a.idx = target; a.y = to[1]; }
      return false;
    };
    switch (b.type) {
      case 'poser':
        if (a.mode === 'walk') { if (follow(spec.speed)) setMode('pose'); }
        else if (a.mode === 'pose') { a.vx = a.vz = 0; face(); if (a.modeMs > b.poseMs) setMode('walk'); }
        else if (a.mode === 'dizzy') { a.vx = a.vz = 0; if (a.modeMs > 2500) setMode('walk'); }
        break;
      case 'runner':
        if (a.mode === 'drive') follow(spec.speed * a.speedMul);
        else if (a.mode === 'spin') { a.vx = a.vz = 0; a.yaw += DT * 12; if (a.modeMs > 900) setMode('drive'); }
        break;
      case 'filmer': {
        if (a.mode === 'away') { a.vx = a.vz = 0; if (a.modeMs > (a.cycles === 0 ? b.firstMs : b.everyMs)) setMode('walkin'); }
        else if (a.mode === 'walkin') { if (route(1, spec.speed)) setMode('film'); }
        else if (a.mode === 'film') { a.vx = a.vz = 0; face(); }
        else if (a.mode === 'leave') { if (route(-1, spec.speed * 1.6)) { a.cycles++; setMode('away'); } }
        break;
      }
      case 'shaker': {
        if (a.mode === 'away') { a.vx = a.vz = 0; if (a.modeMs > (a.cycles === 0 ? b.firstMs : b.everyMs)) { a.hits = 0; setMode('roll'); } }
        else if (a.mode === 'roll') { if (route(1, spec.speed)) setMode('warn'); }
        else if (a.mode === 'warn') {
          a.vx = a.vz = 0;
          if (a.modeMs > b.warnMs) {
            // Knock one ingredient off the shelf to its recovery spot.
            const pk = b.drops.map((id) => st.pickups.find((x) => x.id === id)).find((x) => x && x.state === 'collected');
            if (pk) {
              const to = this.spec<PickupSpec>(pk.id)!.recoverAt ?? [a.x, 0, a.z];
              pk.x = b.shelf[0]; pk.y = b.shelf[1]; pk.z = b.shelf[2];
              this.dropPickup(pk, to);
              this.emit({ k: 'knocked', id: pk.id });
            }
            setMode('shake');
          }
        } else if (a.mode === 'shake') { if (a.modeMs > 900) setMode('leave'); }
        else if (a.mode === 'leave') { if (route(-1, spec.speed * 1.5)) { a.cycles++; setMode('away'); } }
        break;
      }
      case 'thief': {
        const home = spec.path[0]!;
        const carrying = p.carrying && st.pickups.find((x) => x.id === p.carrying)?.item === b.item;
        if (a.mode === 'idle') { a.vx = a.vz = 0; if (carrying && a.modeMs > b.delayMs) setMode('chase'); }
        else if (a.mode === 'chase') {
          if (!carrying) setMode('return');
          else {
            walkTo(p.x, p.z, spec.speed);
            // Carts roll on the ground: no bumping Rosa on a terrace or stairs above them.
            if (Math.hypot(p.x - a.x, p.z - a.z) < 0.95 && Math.abs(p.y - a.y) < 0.6 && p.alive) {
              const c = st.pickups.find((x) => x.id === p.carrying)!;
              c.state = 'free';
              c.x = p.x; c.y = p.y; c.z = p.z;
              settleItem(this.world, c);
              c.lockUntil = st.timeMs + 1500;
              p.carrying = null;
              this.emit({ k: 'spill', id: c.id });
              setMode('return');
            }
          }
        } else if (a.mode === 'stunned') { a.vx = a.vz = 0; a.yaw += DT * 9; if (a.modeMs > 4000) setMode('return'); }
        else if (a.mode === 'return') { if (walkTo(home[0], home[2], spec.speed)) setMode('idle'); }
        break;
      }
      case 'blower': {
        const dist = Math.hypot(p.x - a.x, p.z - a.z);
        if (a.mode === 'patrol') {
          follow(spec.speed);
          if (a.modeMs > b.restMs && dist < b.range * 1.5 && p.alive) { face(); setMode('windup'); this.spawnHazard('cone', a, b.windupMs, b.gustMs, b.range, b.halfAngle, 8, 9); }
        } else if (a.mode === 'windup') { a.vx = a.vz = 0; if (a.modeMs > b.windupMs) { setMode('gust'); this.scatter(a, b.range, b.halfAngle); } }
        else if (a.mode === 'gust') { a.vx = a.vz = 0; if (a.modeMs > b.gustMs) setMode('vent'); }
        else if (a.mode === 'vent') { a.vx = a.vz = 0; if (a.modeMs > b.ventMs) setMode('patrol'); }
        else if (a.mode === 'stunned') { a.vx = a.vz = 0; if (a.modeMs > 1200) setMode('patrol'); }
        break;
      }
    }
  }

  private hitActor(a: ActorS, pr: ProjS): boolean {
    const spec = this.spec<ActorSpec>(a.id)!;
    const b = spec.behavior;
    const st = this.state;
    const ok = (counts = true) => {
      if (counts) st.stats.hits++;
      if (pr.bounces > 0) st.stats.banks++;
      this.emit({ k: 'hit', what: 'actor', id: a.id, bank: pr.bounces > 0, heavy: pr.weapon === 1, p: [pr.x, pr.y, pr.z] });
    };
    const setMode = (m: string) => { a.mode = m; a.modeMs = 0; this.emit({ k: 'actor', id: a.id, mode: m }); };
    switch (b.type) {
      case 'poser':
        if (a.mode === 'pose' && a.holds) {
          ok();
          const pk = st.pickups.find((x) => x.id === a.holds)!;
          pk.x = a.x; pk.y = a.y + 1.7; pk.z = a.z;
          this.dropPickup(pk, groundNear(this.world, a.x, a.z, a.y));
          a.holds = null;
          setMode('dizzy');
          return true;
        }
        if (a.mode === 'pose' || a.mode === 'dizzy') { ok(false); return true; }
        this.emit({ k: 'reject', id: a.id, why: 'dodge' });
        return true; // still stops the chancla
      case 'runner':
        if (a.mode === 'spin') { this.emit({ k: 'reject', id: a.id, why: 'armor' }); return true; }
        ok();
        a.hits++;
        if (a.hits >= b.hits) {
          a.done = true; a.vx = a.vz = 0;
          st.stats.cartActive = false;
          if (a.holds) {
            const pk = st.pickups.find((x) => x.id === a.holds)!;
            pk.x = a.x; pk.y = a.y + 0.8; pk.z = a.z;
            this.dropPickup(pk, groundNear(this.world, a.x, a.z, a.y));
            a.holds = null;
          }
          setMode('stopped');
        } else { a.speedMul = Math.min(1.6, a.speedMul * 1.12); setMode('spin'); } // it panics and speeds up
        return true;
      case 'filmer':
        if (a.mode === 'film' || a.mode === 'walkin') { ok(); setMode('leave'); }
        else ok(false);
        return true;
      case 'shaker':
        if (a.mode === 'roll' || a.mode === 'warn') {
          ok(); a.hits++;
          if (a.hits >= b.hits) setMode('leave');
        } else ok(false);
        return true;
      case 'thief':
        ok();
        if (a.mode !== 'stunned') {
          const d = Math.hypot(a.x - st.player.x, a.z - st.player.z) || 1;
          a.x += ((a.x - st.player.x) / d) * 1.5; a.z += ((a.z - st.player.z) / d) * 1.5;
          setMode('stunned');
        }
        return true;
      case 'blower':
        // Readable rule: hits count while he winds up (which also cancels the
        // gust) or while the machine vents steam.
        if (a.mode === 'windup' || a.mode === 'vent') {
          ok(); a.hits++;
          if (a.mode === 'windup') st.hazards = st.hazards.filter((h) => h.src !== a.id);
          if (a.hits >= b.hits) {
            a.done = true; a.vx = a.vz = 0;
            st.stats.blowerOff = true;
            st.stats.scattersAtBlowerOff = st.stats.scatters;
            this.setFlag(`${a.id}_off`, true);
            setMode('off');
          } else if (a.mode === 'windup') setMode('stunned');
          return true;
        }
        this.emit({ k: 'reject', id: a.id, why: 'armor' });
        return true;
    }
  }

  // Blower gust: piles in the cone whose zone is still open come back.
  private scatter(a: ActorS, range: number, half: number): void {
    const st = this.state;
    const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    for (const bl of this.def.entities) {
      if (bl.kind !== 'blocker' || !bl.id.startsWith('pile')) continue;
      const s = st.blockers.find((x) => x.id === bl.id)!;
      if (s.present) continue;
      // Locked once its zone goal is done.
      const zoneGoal = this.stageDef.goals.find((g) => g.kind === 'flags' && g.flags.includes(`${bl.id}_clear`));
      const gs = zoneGoal ? st.goals.find((g) => g.id === zoneGoal.id) : undefined;
      if (!gs || gs.done) continue;
      const cx = (bl.box[0] + bl.box[3]) / 2, cz = (bl.box[2] + bl.box[5]) / 2;
      const dx = cx - a.x, dz = cz - a.z, d = Math.hypot(dx, dz);
      if (d > range + 2 || (dx * fx + dz * fz) / (d || 1) < Math.cos(half + 0.25)) continue;
      if (!lineOfSight({ x: a.x, y: 0.8, z: a.z }, { x: cx, y: 0.8, z: cz }, this.world.near(a.x, a.z, cx, cz, 1), (bx) => bx.tag !== 'floor' && !bx.tag.startsWith('blocker'))) continue; // not through walls
      // Not onto the player.
      const p = st.player;
      if (p.x > bl.box[0] - 0.4 && p.x < bl.box[3] + 0.4 && p.z > bl.box[2] - 0.4 && p.z < bl.box[5] + 0.4) continue;
      s.present = true;
      this.setFlag(`${bl.id}_clear`, false);
      // The switch that cleared it works again.
      for (const t of st.targets) {
        const ts = this.spec<TargetSpec>(t.id)!;
        if (ts.on.some((x) => x.do === 'remove' && x.id === bl.id)) { t.done = false; t.hitsLeft = ts.hits ?? 1; }
      }
      st.stats.scatters++;
      this.emit({ k: 'scatter', id: bl.id });
      this.emit({ k: 'restore', id: bl.id });
    }
    this.refreshWorld();
  }

  // ----------------------------------------------------------- hazards

  spawnHazard(kind: 'circle' | 'cone', src: { x: number; y?: number; z: number; yaw?: number; id?: string }, warnMs: number, activeMs: number, r: number, half: number, dmg: number, push: number): void {
    const st = this.state;
    const id = st.nextId++;
    st.hazards.push({ id, kind, x: src.x, y: src.y ?? 0, z: src.z, r, yaw: src.yaw ?? 0, half, warnMs, activeMs, t: 0, dmg, push, hitPlayer: false, src: src.id ?? '' });
    this.emit({ k: 'telegraph', hz: id, kind, ms: warnMs, src: src.id ?? '' });
  }

  inHazard(h: HazardS, x: number, z: number): boolean {
    const dx = x - h.x, dz = z - h.z, d = Math.hypot(dx, dz);
    if (h.kind === 'circle') return d < h.r;
    if (d > h.r || d < 0.01) return d <= 0.01;
    const fx = -Math.sin(h.yaw), fz = -Math.cos(h.yaw);
    return (dx * fx + dz * fz) / d > Math.cos(h.half);
  }

  private stepHazards(): void {
    const st = this.state;
    const p = st.player;
    const keep: HazardS[] = [];
    for (const h of st.hazards) {
      const wasWarn = h.t < h.warnMs;
      h.t += DT_MS;
      if (wasWarn && h.t >= h.warnMs) this.emit({ k: 'hazard', hz: h.id, src: h.src });
      const active = h.t >= h.warnMs && h.t < h.warnMs + h.activeMs;
      if (active && p.alive && this.inHazard(h, p.x, p.z) && Math.abs(p.y - h.y) < 3) {
        if (h.push > 0) {
          const dx = p.x - h.x, dz = p.z - h.z, d = Math.hypot(dx, dz) || 1;
          const k = h.kind === 'cone' ? h.push * DT * 6 : h.push;
          this.push((dx / d) * k, (dz / d) * k);
          if (h.kind === 'circle') h.push = 0; // a burst pushes once
        }
        if (!h.hitPlayer && h.dmg > 0) { h.hitPlayer = true; this.hurt(h.dmg, h.x, h.z); }
      }
      if (h.t < h.warnMs + h.activeMs) keep.push(h);
    }
    st.hazards = keep;
  }

  // ------------------------------------------------------- projectiles

  private stepProjectiles(): void {
    const st = this.state;
    const keep: ProjS[] = [];
    const hit: { box: AABB | null } = { box: null };
    for (const pr of st.projs) {
      const bx = pr.x, by = pr.y, bz = pr.z;
      hit.box = null;
      const res = stepProjectileWorld(this.world, pr, DT, hit);
      const a = { x: bx, y: by, z: bz }, b = { x: pr.x, y: pr.y, z: pr.z };
      const def = WEAPONS[pr.weapon]!;
      let ended = res === 'end';
      if (pr.hostile) {
        // Thrown at Rosa: a generous capsule around her.
        const pl = st.player;
        if (pl.alive && segmentCapsule(a, b, def.radius, pl.x, pl.z, pl.y + 0.2, pl.y + bodyHeight(pl) - 0.2, 0.4) >= 0) {
          this.hurt(10, bx, bz);
          ended = true;
          pr.hitSomething = true;
        }
      } else if (this.projectileHits(pr, a, b, def.radius)) {
        ended = true;
        pr.hitSomething = true;
      }
      if (res === 'bounce' && !ended) {
        const tag = (hit.box as AABB | null)?.tag;
        pr.bankTag = tag?.startsWith('bank') ? tag : pr.bankTag;
        this.emit({ k: 'bounce', id: pr.id, p: [pr.x, pr.y, pr.z], tag: pr.bankTag });
      }
      if (ended) {
        if (!pr.hostile && pr.weapon === 1) this.splash(pr);
        this.emit({ k: 'pend', id: pr.id, p: [pr.x, pr.y, pr.z], hit: pr.hitSomething, w: pr.weapon, hostile: pr.hostile });
        if (!pr.hitSomething && !pr.hostile) this.emit({ k: 'miss' });
      } else keep.push(pr);
    }
    st.projs = keep;
  }

  private projectileHits(pr: ProjS, a: V3Like, b: V3Like, r: number): boolean {
    const st = this.state;
    let best = 2;
    let fn: (() => boolean) | null = null;
    for (const t of st.targets) {
      if (!t.enabled || t.done) continue;
      const spec = this.spec<TargetSpec>(t.id)!;
      if (!this.inStage(spec)) continue;
      const k = segmentSphere(a, b, r, { x: spec.at[0], y: spec.at[1], z: spec.at[2] }, spec.r);
      if (k >= 0 && k < best) { best = k; fn = () => this.hitTarget(t, spec, pr, false); }
    }
    for (const ac of st.actors) {
      if (!ac.enabled || ac.done) continue;
      const spec = this.spec<ActorSpec>(ac.id)!;
      if (!this.inStage(spec)) continue;
      const [y0, y1, rr] = actorShape(spec);
      const k = segmentCapsule(a, b, r, ac.x, ac.z, ac.y + y0, ac.y + y1, rr);
      if (k >= 0 && k < best) { best = k; fn = () => this.hitActor(ac, pr); }
    }
    if (this.pinata && st.pinata) {
      const ph = this.pinata.test(st.pinata, a, b, r);
      if (ph && ph.t < best) { best = ph.t; fn = () => this.pinata!.hit(st.pinata!, ph.part, pr, this.pinataCtx()); }
    }
    if (!fn) return false;
    // Place the chancla at the contact point for effects.
    pr.x = a.x + (b.x - a.x) * best; pr.y = a.y + (b.y - a.y) * best; pr.z = a.z + (b.z - a.z) * best;
    return fn();
  }

  // La Pesada's splash also counts for heavy-only targets near the impact.
  private splash(pr: ProjS): void {
    const st = this.state;
    const def = WEAPONS[1]!;
    for (const t of st.targets) {
      if (!t.enabled || t.done) continue;
      const spec = this.spec<TargetSpec>(t.id)!;
      if (spec.need !== 'heavy' || !this.inStage(spec)) continue;
      const d = Math.hypot(spec.at[0] - pr.x, spec.at[1] - pr.y, spec.at[2] - pr.z);
      if (d > def.splashRadius + spec.r || pr.hitSomething && d < 0.01) continue;
      if (!lineOfSight({ x: pr.x, y: pr.y + 0.1, z: pr.z }, { x: spec.at[0], y: spec.at[1], z: spec.at[2] }, this.world.near(pr.x, pr.z, spec.at[0], spec.at[2], 1), (bx) => !bx.tag.startsWith('blocker') && bx.tag !== 'floor' && !isTargetBox(bx, spec))) continue;
      if (this.hitTarget(t, spec, pr, true)) pr.hitSomething = true;
    }
  }

  // ------------------------------------------------------ goal updates

  private stepGoals(): void {
    const st = this.state;
    const sd = this.stageDef;
    sd.goals.forEach((g, i) => {
      const gs = st.goals[i]!;
      if (gs.done || g.kind !== 'defend') return;
      // Malfunction: the timer target switches on once, at the given fraction.
      if (g.malfunction && !gs.malfunctioned && gs.progress >= g.malfunction.at) {
        gs.malfunctioned = true;
        this.act({ do: 'enable', id: g.malfunction.target });
        this.emit({ k: 'say', line: 'timer_haywire' });
      }
      const reasons = this.disruptions(g);
      if (reasons.length === 0) {
        const before = Math.floor(gs.progress * g.segments);
        gs.progress = Math.min(1, gs.progress + DT_MS / g.ms);
        gs.disruptedMs = 0;
        const after = Math.floor(gs.progress * g.segments);
        if (after > before && after < g.segments) { this.emit({ k: 'segment', goal: g.id, n: after }); st.lastProgressMs = st.timeMs; }
      } else {
        gs.disruptedMs += DT_MS;
        if (gs.disruptedMs > g.graceMs) {
          // The current preparation segment is lost; earlier ones are kept.
          const floor = Math.floor(gs.progress * g.segments) / g.segments;
          if (gs.progress > floor + 1e-6) { gs.progress = floor; st.stats.segmentsLost++; this.emit({ k: 'setback', goal: g.id }); }
          gs.disruptedMs = 0;
        }
      }
      gs.count = Math.floor(gs.progress * 100);
    });
  }

  /** Why a defend goal is not progressing right now (empty: it is). */
  disruptions(g: Extract<GoalSpec, { kind: 'defend' }>): string[] {
    const st = this.state;
    const out: string[] = [];
    const zone = this.spec(g.zone) as { at: V3; r: number };
    for (const a of st.actors) {
      const spec = this.spec<ActorSpec>(a.id)!;
      if (!a.enabled || a.done || !this.inStage(spec)) continue;
      if (spec.behavior.type === 'filmer' && a.mode === 'film') out.push(`film:${a.id}`);
      if (spec.behavior.type === 'shaker' && a.mode === 'shake') out.push(`shake:${a.id}`);
    }
    for (const pk of st.pickups) if (pk.item === 'ingredient' && (pk.state === 'free' || pk.state === 'falling')) out.push(`spilled:${pk.id}`);
    if (g.malfunction) {
      const t = st.targets.find((x) => x.id === g.malfunction!.target);
      if (t && t.enabled && !t.done) out.push('timer');
    }
    void zone;
    return out;
  }

  // ----------------------------------------------------------- pinata

  private pinataCtx() {
    return {
      timeMs: this.state.timeMs,
      rng: () => this.nextRand(),
      player: this.state.player,
      emit: (e: MEvent) => this.emit(e),
      hazard: (x: number, z: number, warnMs: number, r: number, dmg: number) => this.spawnHazard('circle', { x, z, id: 'pinata' }, warnMs, 250, r, 0, dmg, 5),
      shoot: (o: V3, v: V3) => this.spawnProj(o, v, 0, true),
      stats: this.state.stats,
      world: this.world,
    };
  }

  // Deterministic random numbers whose state lives in MState (so a
  // checkpoint restore replays the same sequence).
  nextRand(): number {
    this.state.rng = (Math.imul(this.state.rng, 1664525) + 1013904223) >>> 0;
    return this.state.rng / 4294967296;
  }

  // ---------------------------------------------------- retry & results

  /** Back to the start of the current stage (exact snapshot). */
  retryCheckpoint(): void {
    if (!this.checkpoint) return;
    this.state = structuredClone(this.checkpoint);
    this.events = [];
    this.world = this.buildWorld();
    const p = this.state.player;
    const r = this.stageDef.respawn;
    p.x = r.at[0]; p.y = r.at[1]; p.z = r.at[2]; p.vx = p.vy = p.vz = 0; p.yaw = r.yaw; p.pitch = 0;
    p.alive = true; p.hp = CAMPAIGN.maxHealth; p.invulnMs = CAMPAIGN.respawnInvulnMs;
    settle(this.world, p);
    this.emit({ k: 'checkpoint' });
  }

  result(): MissionResult {
    const st = this.state;
    const s = st.stats;
    const skill = this.def.challenges.find((c) => c.id === 'skill');
    return {
      timeMs: st.completeMs || st.timeMs, kos: s.kos, throws: s.throws, hits: s.hits, accuracy: s.throws ? s.hits / s.throws : 0,
      challenges: {
        complete: st.complete,
        time: st.complete && st.completeMs <= this.def.timeTargetMs,
        skill: st.complete && !!skill && skillMet(skill.skill!, s, skill.limit),
      },
    };
  }

  /** Eye position (for the camera and the helper bot). */
  eye(): V3 { const p = this.state.player; return [p.x, p.y + eyeHeight(p), p.z]; }
}

// ------------------------------------------------------------- helpers

type V3Like = { x: number; y: number; z: number };

export function skillMet(skill: string, s: Stats, limit = 0): boolean {
  switch (skill) {
    case 'cartThrows': return s.cartThrows <= limit;
    case 'noSegmentLost': return s.segmentsLost === 0;
    case 'blowerBeforeSecondScatter': return s.blowerOff && s.scattersAtBlowerOff <= 1;
    case 'ricochetFinish': return s.finishRicochet;
    default: return false;
  }
}

function initialMode(e: ActorSpec): string {
  switch (e.behavior.type) {
    case 'poser': return 'walk';
    case 'runner': return 'drive';
    case 'filmer': case 'shaker': return 'away';
    case 'thief': return 'idle';
    case 'blower': return 'patrol';
  }
}

// Capsule [y0, y1, r] relative to the actor's feet.
export function actorShape(spec: ActorSpec): [number, number, number] {
  switch (spec.archetype) {
    case 'cart': case 'rollcart': return [0.05, 0.75, 0.62];
    default: return [0.2, 1.75, CAMPAIGN.hitRadiusActor];
  }
}

function goalTotal(g: GoalSpec): number {
  switch (g.kind) {
    case 'collect': return g.count;
    case 'flags': return g.flags.length;
    case 'defend': return 100;
    default: return 1;
  }
}

// The walkable surface under (x, fromY, z). The search starts at the item's
// own height (never from high up, which could land it on a roof).
function groundNear(world: World, x: number, z: number, fromY: number): V3 {
  const b = newBody(x, fromY + 0.05, z);
  settle(world, b);
  return [x, b.y, z];
}

function settleItem(world: World, p: { x: number; y: number; z: number }): void {
  const g = groundNear(world, p.x, p.z, p.y);
  p.y = g[1];
}

function isTargetBox(bx: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }, spec: TargetSpec): boolean {
  const [x, y, z] = spec.at;
  return x >= bx.minX - spec.r && x <= bx.maxX + spec.r && y >= bx.minY - spec.r && y <= bx.maxY + spec.r && z >= bx.minZ - spec.r && z <= bx.maxZ + spec.r;
}

