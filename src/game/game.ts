import * as THREE from 'three';
import { CHANCLA, LEGEND, PLAYER, SCORE } from '../config';
import { Emitter } from '../core/emitter';
import { Rng } from '../core/rng';
import { clamp } from '../core/math';
import { buildArena, type Arena } from '../world/arena';
import { Player } from './player';
import { ChanclaSystem, type Chancla, type HitTarget } from './chanclas';
import { EnemySystem, type Enemy, type EnemyContext, type EnemyKind } from './enemies';
import { Boss, BOSS_MAX_HP, type BossContext } from './boss';
import { HazardSystem, type HazardHit } from './hazards';
import { PickupSystem } from './pickups';
import { Scoring, type BonusLabel } from './scoring';
import { WaveDirector, WAVES } from './waves';
import { Tutorial, type TutorialStep } from './tutorial';
import { Particles } from '../fx/particles';
import { buildDummy } from '../models/characters';
import { lineOfSight, segmentCapsule, sweepWorld, type WorldHit } from '../physics/collision';
import { ENEMY_LINES, SHOUTS, type QuipKey } from '../i18n/strings';

export type Phase = 'title' | 'tutorial' | 'wave' | 'boss' | 'victory' | 'defeat';

export interface InputFrame {
  moveX: number;
  moveZ: number;
  throwDown: boolean;
  throwHeld: boolean;
  throwUp: boolean;
  cancelCharge: boolean;
  recall: boolean;
  special: boolean;
}

export function emptyInput(): InputFrame {
  return { moveX: 0, moveZ: 0, throwDown: false, throwHeld: false, throwUp: false, cancelCharge: false, recall: false, special: false };
}

export interface RunResult {
  victory: boolean;
  score: number;
  bestCombo: number;
  accuracy: number;
  ricochetHits: number;
  kills: number;
  time: number;
  reached: number; // 0-2 wave index, 3 = boss
}

export type ShoutTone = 'hit' | 'bonus' | 'kill' | 'heal' | 'info' | 'block';

export interface GameEvents {
  phase: { phase: Phase };
  wave: { index: number; state: 'intro' | 'clear' };
  throw: { charge: number; golden: boolean };
  emptyHand: Record<string, never>;
  hit: { x: number; y: number; z: number; points: number; multiplier: number; bonuses: BonusLabel[]; kill: boolean; kind: 'enemy' | 'boss' | 'dummy'; ricochet: boolean; golden: boolean };
  shout: { text: string; x: number; y: number; z: number; tone: ShoutTone };
  bounce: { x: number; y: number; z: number };
  blocked: { x: number; y: number; z: number };
  land: { x: number; y: number; z: number };
  catch: { slot: number };
  recall: { count: number };
  hurt: { amount: number; hp: number; source: string };
  heal: { amount: number; hp: number };
  quip: { key: QuipKey };
  speech: { text: string; x: number; y: number; z: number };
  attack: { source: string; kind: string; x: number; z: number };
  legendary: { active: boolean };
  meterFull: Record<string, never>;
  bossState: { state: 'intro' | 'attack' | 'vulnerable' | 'dying'; attack?: string };
  bossHp: { hp: number; max: number };
  tutorial: { step: TutorialStep };
  runEnd: RunResult;
  hitstop: { strength: number };
  splash: { x: number; y: number; z: number };
  poof: { x: number; y: number; z: number };
  hazardFire: { kind: string; source: string; x: number; z: number };
}

interface Dummy {
  id: number;
  group: THREE.Group;
  x: number;
  z: number;
  active: boolean;
  wobble: number;
  wobbleV: number;
}

const DUMMY_BASE = 8000;
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const eye = new THREE.Vector3();
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const hand = new THREE.Vector3();
const aimTmp = new THREE.Vector3();
const aimTmp2 = new THREE.Vector3();
const aimEnd = new THREE.Vector3();
const aimPoint = new THREE.Vector3();
const worldHit: WorldHit = { t: 0, nx: 0, ny: 0, nz: 0, box: null, ground: false };

export class Game {
  readonly scene = new THREE.Scene();
  readonly events = new Emitter<GameEvents>();
  readonly rng: Rng;
  readonly arena: Arena;
  readonly player = new Player();
  readonly chanclas: ChanclaSystem;
  readonly enemies = new EnemySystem();
  readonly boss: Boss;
  readonly hazards = new HazardSystem();
  readonly pickups = new PickupSystem();
  readonly particles = new Particles();
  readonly scoring = new Scoring();
  readonly director = new WaveDirector();
  readonly tutorial = new Tutorial();
  readonly dummies: Dummy[] = [];

  phase: Phase = 'title';
  runTime = 0;
  time = 0;
  charging = false;
  chargeT = 0;
  meter = 0;
  legendaryT = 0;
  private goldenCd = 0;
  hitstop = 0;
  aimAssist = false;
  private ending: { victory: boolean; t: number } | null = null;
  private ended = false;
  private targets: HitTarget[] = [];
  private targetPool: HitTarget[] = [];
  private reached = 0;
  private meterAnnounced = false;
  private lastQuip = -10;
  private enemyCtx: EnemyContext;
  private bossCtx: BossContext;

  constructor(seed?: number) {
    this.rng = new Rng(seed);
    this.arena = buildArena();
    this.scene.add(this.arena.group);
    this.scene.fog = new THREE.Fog(0xf2b98a, 40, 110);
    this.scene.background = new THREE.Color(0xf6a76b);

    this.chanclas = new ChanclaSystem({
      onHit: (c, t, p) => this.onChanclaHit(c, t, p),
      onBounce: (_c, p) => {
        this.particles.burst('thwap', p.x, p.y, p.z, 5);
        this.events.emit('bounce', { x: p.x, y: p.y, z: p.z });
      },
      onBlocked: (_c, p) => {
        this.particles.burst('gold', p.x, p.y, p.z, 6);
        this.events.emit('blocked', { x: p.x, y: p.y, z: p.z });
        this.events.emit('shout', { text: SHOUTS.blocked, x: p.x, y: p.y + 0.5, z: p.z, tone: 'block' });
      },
      onLand: (_c, p) => {
        this.particles.burst('dust', p.x, Math.max(0.05, p.y), p.z, 5);
        this.events.emit('land', { x: p.x, y: p.y, z: p.z });
      },
      onFlightEnd: (c) => {
        if (!c.golden) this.scoring.resolveThrow(c.hitAny);
      },
      onCatch: (c) => this.events.emit('catch', { slot: c.slot }),
      onSplash: (c, p) => this.onSplash(c, p),
    });
    this.scene.add(this.chanclas.group);
    this.scene.add(this.enemies.group);
    this.boss = new Boss(this.arena.bossPos, this.arena.bossWaveOrigin);
    this.scene.add(this.boss.group);
    this.scene.add(this.hazards.group);
    this.scene.add(this.pickups.group);
    this.scene.add(this.particles.mesh);
    this.enemies.prewarm();
    this.hazards.onFire = (kind, source, x, z) => this.events.emit('hazardFire', { kind, source, x, z });

    for (let i = 0; i < 2; i++) {
      const spot = this.arena.dummySpots[i]!;
      const g = buildDummy();
      g.position.set(spot.x, 0, spot.z);
      g.visible = false;
      this.scene.add(g);
      this.dummies.push({ id: DUMMY_BASE + i, group: g, x: spot.x, z: spot.z, active: false, wobble: 0, wobbleV: 0 });
    }
    for (let i = 0; i < 16; i++) this.targetPool.push({ id: 0, kind: 'enemy', x: 0, z: 0, y0: 0, y1: 0, r: 0, shield: null });

    this.enemyCtx = {
      player: this.player.pos,
      colliders: this.arena.colliders,
      nav: this.arena.nav,
      hazards: this.hazards,
      rng: this.rng,
      telegraphScale: 1,
      say: (e, line) => {
        const lines = ENEMY_LINES[e.kind];
        this.events.emit('speech', { text: line ?? this.rng.pick(lines), x: e.pos.x, y: 2.4, z: e.pos.z });
      },
      onAttack: (e, kind) => {
        this.events.emit('attack', { source: e.kind, kind, x: e.pos.x, z: e.pos.z });
        if (kind === 'gust') this.particles.burst('leaves', e.pos.x, 0.8, e.pos.z, 10, Math.sin(Math.atan2(this.player.pos.x - e.pos.x, this.player.pos.z - e.pos.z)), 0, Math.cos(Math.atan2(this.player.pos.x - e.pos.x, this.player.pos.z - e.pos.z)));
      },
    };
    this.bossCtx = {
      player: this.player.pos,
      hazards: this.hazards,
      rng: this.rng,
      onAttackStart: (a) => this.events.emit('bossState', { state: 'attack', attack: a }),
      onVulnerable: () => {
        this.events.emit('bossState', { state: 'vulnerable' });
        const p = this.boss.pos;
        this.events.emit('shout', { text: SHOUTS.open, x: p.x, y: p.y + 3.6, z: p.z, tone: 'bonus' });
        this.maybeQuip('bossOpen', 0.5);
      },
      onShieldUp: () => {},
      onSummon: (n) => this.summonMinions(n),
      onBeat: (kind) => this.events.emit('attack', { source: 'boss', kind, x: this.boss.pos.x, z: this.boss.pos.z }),
      say: (line) => {
        const p = this.boss.pos;
        this.events.emit('speech', { text: line ?? this.rng.pick(ENEMY_LINES.boss), x: p.x, y: p.y + 4.2, z: p.z });
      },
    };

    this.resetRun();
    this.phase = 'title';
  }

  // Clears every piece of run state. Called by restart and return-to-title.
  resetRun(): void {
    const s = this.arena.playerStart;
    this.player.reset(s.x, s.z, s.yaw);
    this.chanclas.reset();
    this.enemies.reset();
    this.boss.reset();
    this.hazards.reset();
    this.pickups.reset();
    this.particles.clear();
    this.scoring.reset();
    this.director.reset();
    this.tutorial.reset();
    for (const d of this.dummies) {
      d.active = false;
      d.group.visible = false;
      d.wobble = 0;
      d.wobbleV = 0;
    }
    this.runTime = 0;
    this.charging = false;
    this.chargeT = 0;
    this.meter = 0;
    this.legendaryT = 0;
    this.goldenCd = 0;
    this.hitstop = 0;
    this.ending = null;
    this.ended = false;
    this.reached = 0;
    this.meterAnnounced = false;
    this.lastQuip = -10;
    this.enemyCtx.telegraphScale = 1;
  }

  toTitle(): void {
    this.resetRun();
    this.setPhase('title');
  }

  startRun(skipTutorial: boolean): void {
    this.resetRun();
    if (skipTutorial) {
      this.beginWave(0);
    } else {
      this.setPhase('tutorial');
      this.tutorial.start();
      for (const d of this.dummies) {
        d.active = true;
        d.group.visible = true;
      }
      this.events.emit('tutorial', { step: this.tutorial.step });
    }
    this.events.emit('quip', { key: 'start' });
    this.lastQuip = this.time;
  }

  skipTutorial(): void {
    if (this.phase !== 'tutorial') return;
    this.finishTutorial();
  }

  private finishTutorial(): void {
    this.tutorial.reset();
    for (const d of this.dummies) {
      if (d.active) this.particles.burst('confetti', d.x, 1.2, d.z, 14);
      d.active = false;
      d.group.visible = false;
    }
    this.chanclas.recallAll();
    this.beginWave(0);
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.events.emit('phase', { phase: p });
  }

  private beginWave(i: number): void {
    this.director.begin(i);
    this.reached = i;
    this.enemyCtx.telegraphScale = WAVES[i]!.telegraphScale;
    this.setPhase('wave');
    this.events.emit('wave', { index: i, state: 'intro' });
  }

  private beginBoss(): void {
    this.reached = 3;
    this.enemyCtx.telegraphScale = 1;
    this.boss.start();
    this.setPhase('boss');
    this.events.emit('bossState', { state: 'intro' });
    this.events.emit('bossHp', { hp: this.boss.hp, max: BOSS_MAX_HP });
    this.events.emit('quip', { key: 'boss' });
    this.lastQuip = this.time;
    // A cafecito on the way in.
    this.spawnPickupFar();
  }

  get legendaryActive(): boolean {
    return this.legendaryT > 0;
  }

  get chargeAmount(): number {
    if (!this.charging) return 0;
    return clamp((this.chargeT - CHANCLA.chargeStart) / (CHANCLA.chargeFull - CHANCLA.chargeStart), 0, 1);
  }

  get inRun(): boolean {
    return this.phase === 'tutorial' || this.phase === 'wave' || this.phase === 'boss';
  }

  update(dt: number, input: InputFrame): void {
    this.time += dt;
    if (!this.inRun) {
      this.arena.update(this.time, this.beat());
      this.particles.update(dt);
      return;
    }
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      dt *= 0.2;
    }
    if (!this.ending) this.runTime += dt;

    const before = this.player.distanceMoved;
    this.player.update(dt, this.ending ? 0 : input.moveX, this.ending ? 0 : input.moveZ, this.arena.colliders);
    const stepChanged = this.tutorial.noteMove(this.player.distanceMoved - before);
    if (stepChanged) this.events.emit('tutorial', { step: stepChanged });

    if (!this.ending) this.handleThrowInput(dt, input);

    this.buildTargets();
    this.player.hand(hand);
    this.chanclas.step(dt, hand, this.arena.colliders, this.targets);

    for (const e of this.enemies.pool) {
      if (!e.active) continue;
      e.update(dt, this.enemyCtx, this.enemies.pool);
      if (e.dyingDone) {
        this.particles.burst('confetti', e.pos.x, 1.0, e.pos.z, 26);
        this.particles.burst('smoke', e.pos.x, 0.6, e.pos.z, 6);
        this.events.emit('poof', { x: e.pos.x, y: 1, z: e.pos.z });
        if (this.player.hp < 70 && this.rng.chance(0.18)) this.pickups.spawn(e.pos.x, e.pos.z, 20);
        e.deactivate();
      }
    }

    this.boss.update(dt, this.bossCtx);

    this.hazards.step(dt, { x: this.player.pos.x, z: this.player.pos.z, eyeY: PLAYER.eye, radius: PLAYER.radius }, this.arena.colliders, (h) => this.onHazardHit(h));

    const got = this.pickups.step(dt, this.player.pos.x, this.player.pos.z, this.player.hp < PLAYER.maxHp && !this.ending);
    if (got) {
      const amt = this.player.heal(got.heal);
      this.events.emit('heal', { amount: amt, hp: this.player.hp });
      this.events.emit('shout', { text: SHOUTS.heal.replace('{n}', String(Math.round(amt))), x: got.x, y: 1.6, z: got.z, tone: 'heal' });
      this.particles.burst('confetti', got.x, 0.8, got.z, 10);
      this.maybeQuip('cafe', 0.7);
    }

    this.scoring.update(dt);
    if (this.legendaryT > 0) {
      this.legendaryT -= dt;
      if (this.legendaryT <= 0) {
        this.legendaryT = 0;
        this.events.emit('legendary', { active: false });
      }
    }

    for (const d of this.dummies) {
      if (!d.active) continue;
      d.wobbleV += (-d.wobble * 60 - d.wobbleV * 6) * dt;
      d.wobble += d.wobbleV * dt;
      d.group.rotation.x = d.wobble;
    }

    if (this.phase === 'tutorial' && this.tutorial.update(dt)) this.finishTutorial();
    if (this.phase === 'wave' && !this.ending) this.stepDirector(dt);

    this.arena.update(this.time, this.beat());
    this.particles.update(dt);

    if (!this.ending) {
      if (!this.player.alive) {
        this.ending = { victory: false, t: 0 };
        this.charging = false;
        this.events.emit('quip', { key: 'defeat' });
      } else if (this.phase === 'boss' && this.boss.state === 'dead') {
        this.ending = { victory: true, t: 0 };
      }
    } else {
      this.ending.t += dt;
      if (!this.ended && this.ending.t > (this.ending.victory ? 1.2 : 1.8)) this.finishRun(this.ending.victory);
    }
  }

  private beat(): number {
    const t = this.time * 1.6;
    return Math.pow(1 - (t - Math.floor(t)), 3);
  }

  private stepDirector(dt: number): void {
    const prev = this.director.phase;
    const kind = this.director.step(dt, this.enemies.aliveCount(), this.rng);
    if (kind) this.spawnEnemy(kind);
    if (prev !== 'clear' && this.director.phase === 'clear') {
      this.events.emit('wave', { index: this.director.index, state: 'clear' });
      this.scoring.addFlat(SCORE.waveClear);
      this.chanclas.recallAll();
      this.spawnPickupFar();
      this.maybeQuip(this.rng.pick(['respeta', 'advierto', 'noFalla'] as const), 1);
    }
    if (this.director.phase === 'done') {
      const next = this.director.index + 1;
      if (next < WAVES.length) this.beginWave(next);
      else this.beginBoss();
    }
  }

  private spawnPickupFar(): void {
    let best = this.arena.pickupSpots[0]!, bestD = -1;
    for (const s of this.arena.pickupSpots) {
      const d = Math.hypot(s.x - this.player.pos.x, s.z - this.player.pos.z);
      // Not on top of the player, not across the map either.
      const score = d > 4 ? 20 - Math.abs(d - 9) : -1;
      if (score > bestD) { bestD = score; best = s; }
    }
    this.pickups.spawn(best.x, best.z, 30);
  }

  spawnEnemy(kind: EnemyKind): Enemy | null {
    const e = this.enemies.acquire(kind);
    if (!e) return null;
    const sp = this.director.pickSpawn(this.arena.spawns, this.player.pos.x, this.player.pos.z, this.rng);
    e.spawn(sp, this.rng);
    return e;
  }

  private summonMinions(n: number): void {
    for (let i = 0; i < n; i++) {
      if (this.enemies.aliveCount() >= 3) break;
      this.spawnEnemy(this.rng.chance(0.5) ? 'bocinas' : 'influencer');
    }
  }

  private buildTargets(): void {
    this.targets.length = 0;
    let k = 0;
    const take = (): HitTarget => {
      if (k >= this.targetPool.length) this.targetPool.push({ id: 0, kind: 'enemy', x: 0, z: 0, y0: 0, y1: 0, r: 0, shield: null });
      return this.targetPool[k++]!;
    };
    for (const e of this.enemies.pool) if (e.alive) this.targets.push(e.target(take()));
    if (this.boss.alive) this.targets.push(this.boss.target(take()));
    for (const d of this.dummies) {
      if (!d.active) continue;
      const t = take();
      t.id = d.id; t.kind = 'dummy'; t.x = d.x; t.z = d.z; t.y0 = 0.4; t.y1 = 1.85; t.r = 0.4; t.shield = null;
      this.targets.push(t);
    }
  }

  private handleThrowInput(dt: number, input: InputFrame): void {
    if (input.special) this.tryLegendary();
    if (input.recall) {
      const n = this.chanclas.recallAll();
      this.events.emit('recall', { count: n });
      const st = this.tutorial.noteRecall(n);
      if (st) this.events.emit('tutorial', { step: st });
    }
    if (this.legendaryActive) {
      this.charging = false;
      if (this.goldenCd > 0) this.goldenCd -= dt;
      if ((input.throwDown || input.throwHeld) && this.goldenCd <= 0) {
        this.goldenCd = LEGEND.fireInterval;
        this.fireGolden();
      }
      return;
    }
    if (input.cancelCharge) {
      this.charging = false;
      this.chargeT = 0;
    }
    if (input.throwDown) {
      this.charging = true;
      this.chargeT = 0;
    }
    if (this.charging && input.throwHeld) this.chargeT += dt;
    if (this.charging && (input.throwUp || !input.throwHeld)) {
      const charge = this.chargeAmount;
      this.charging = false;
      this.chargeT = 0;
      this.throwReal(charge);
    }
  }

  tryLegendary(): boolean {
    if (!this.inRun || this.ending || this.meter < 1 || this.legendaryActive) return false;
    this.meter = 0;
    this.meterAnnounced = false;
    this.legendaryT = LEGEND.duration;
    this.goldenCd = 0;
    this.events.emit('legendary', { active: true });
    this.events.emit('quip', { key: 'legendaria' });
    this.lastQuip = this.time;
    return true;
  }

  private throwReal(charge: number): void {
    const speed = THREE.MathUtils.lerp(CHANCLA.quickSpeed, CHANCLA.chargedSpeed, charge);
    const g = THREE.MathUtils.lerp(CHANCLA.quickGravity, CHANCLA.chargedGravity, charge);
    if (this.chanclas.heldCount() === 0) {
      this.events.emit('emptyHand', {});
      return;
    }
    if (!this.chanclas.canThrow()) return;
    this.aimVelocity(speed, g, v1, v2);
    const c = this.chanclas.throwReal(v1, v2, charge);
    if (!c) {
      this.events.emit('emptyHand', {});
      return;
    }
    this.scoring.registerThrow();
    this.tutorial.noteThrow();
    this.events.emit('throw', { charge, golden: false });
  }

  private fireGolden(): void {
    this.aimVelocity(LEGEND.speed, 2, v1, v2);
    // Slight random spread keeps the barrage lively but readable.
    v2.x += (this.rng.next() - 0.5) * 1.2;
    v2.y += (this.rng.next() - 0.5) * 0.8;
    const c = this.chanclas.throwGolden(v1, v2);
    if (c) this.events.emit('throw', { charge: 1, golden: true });
  }

  // Computes launch origin and velocity so the chancla lands where the
  // crosshair points, compensating for its arc.
  aimVelocity(speed: number, gravity: number, origin: THREE.Vector3, vel: THREE.Vector3): void {
    this.player.eye(eye);
    this.player.forward(fwd);
    this.player.right(right);
    const maxD = 60;
    aimEnd.copy(eye).addScaledVector(fwd, maxD);
    let dist = maxD;
    if (sweepWorld(eye, aimEnd, 0.05, this.arena.colliders, worldHit)) dist = worldHit.t * maxD;
    for (const t of this.targets) {
      const th = segmentCapsule(eye, aimEnd, 0.05, t.x, t.z, t.y0, t.y1, t.r);
      if (th >= 0 && th * maxD < dist) dist = th * maxD;
    }
    let assisted = false;
    if (this.aimAssist) {
      let best = Infinity;
      for (const t of this.targets) {
        const cy = (t.y0 + t.y1) / 2;
        aimTmp.set(t.x - eye.x, cy - eye.y, t.z - eye.z);
        const d = aimTmp.length();
        if (d > 32 || d < 1) continue;
        const ang = Math.acos(Math.min(1, aimTmp.dot(fwd) / d));
        if (ang > 0.14 || ang >= best) continue;
        aimTmp2.set(t.x, cy, t.z);
        if (!lineOfSight(eye, aimTmp2, this.arena.colliders, () => true)) continue;
        best = ang;
        aimPoint.copy(aimTmp2);
        assisted = true;
      }
    }
    if (!assisted) aimPoint.copy(eye).addScaledVector(fwd, Math.max(2, dist));
    // Launch from the right hand, unless that point is inside a wall.
    origin.copy(eye).addScaledVector(right, 0.22).addScaledVector(fwd, 0.25);
    origin.y -= 0.12;
    if (!lineOfSight(eye, origin, this.arena.colliders, () => true)) origin.copy(eye);
    vel.subVectors(aimPoint, origin);
    const d = vel.length() || 1;
    const tf = d / speed;
    vel.multiplyScalar(speed / d);
    vel.y += 0.5 * gravity * tf;
  }

  private addMeter(v: number): void {
    if (this.legendaryActive) return;
    this.meter = Math.min(1, this.meter + v);
    if (this.meter >= 1 && !this.meterAnnounced) {
      this.meterAnnounced = true;
      this.events.emit('meterFull', {});
    }
  }

  private onChanclaHit(c: Chancla, t: HitTarget, p: THREE.Vector3): boolean {
    const charged = !c.golden && c.charge >= 0.5;
    if (t.kind === 'dummy') {
      const d = this.dummies.find((x) => x.id === t.id);
      if (!d || !d.active) return false;
      d.wobbleV += charged ? 9 : 5;
      this.particles.burst('thwap', p.x, p.y, p.z, 10);
      const step = this.tutorial.noteDummyHit(charged);
      if (step) this.events.emit('tutorial', { step });
      this.events.emit('hit', { x: p.x, y: p.y, z: p.z, points: 0, multiplier: 1, bonuses: [], kill: false, kind: 'dummy', ricochet: c.ricocheted, golden: c.golden });
      this.events.emit('shout', { text: this.rng.pick(SHOUTS.hit), x: d.x, y: 2.3, z: d.z, tone: 'hit' });
      this.hitstop = 0.04;
      this.events.emit('hitstop', { strength: charged ? 1 : 0.6 });
      return true;
    }
    if (t.kind === 'boss') {
      const out = this.boss.takeHit(c.damage);
      if (!out.valid) return false;
      if (!c.hitAny) this.scoring.noteThrowConnected();
      const res = this.scoring.hit({ ricochet: c.ricocheted, charged, interrupt: false, posing: false, legendary: c.golden, boss: true, kill: out.killed });
      this.addMeter(LEGEND.perHit * 0.6);
      this.particles.burst('thwap', p.x, p.y, p.z, 14);
      this.events.emit('bossHp', { hp: this.boss.hp, max: BOSS_MAX_HP });
      this.events.emit('hit', { x: p.x, y: p.y, z: p.z, points: res.points, multiplier: res.multiplier, bonuses: res.bonuses, kill: out.killed, kind: 'boss', ricochet: c.ricocheted, golden: c.golden });
      this.shoutBonuses(res.bonuses, p, out.killed);
      this.hitstop = out.killed ? 0.2 : 0.05;
      this.events.emit('hitstop', { strength: out.killed ? 2 : 1 });
      if (out.killed) {
        this.events.emit('bossState', { state: 'dying' });
        this.particles.burst('confetti', this.boss.pos.x, 3, this.boss.pos.z, 60);
        this.particles.burst('smoke', -5, 4, -15.5, 10);
        this.particles.burst('smoke', 5, 4, -15.5, 10);
        this.hazards.reset();
        for (const e of this.enemies.pool) {
          if (e.alive) e.takeHit(99, e.pos.x, e.pos.z - 30, 6, true, this.hazards);
        }
        this.events.emit('quip', { key: 'paz' });
        this.lastQuip = this.time;
      }
      return true;
    }
    const e = this.enemies.pool.find((x) => x.id === t.id);
    if (!e) return false;
    const out = e.takeHit(c.damage, c.vel.x, c.vel.z, c.knock, charged, this.hazards);
    if (!out.valid) return false;
    if (!c.hitAny) this.scoring.noteThrowConnected();
    this.scoreEnemyHit(c, e, p, out.killed, out.interrupted, out.posing, charged);
    return true;
  }

  private scoreEnemyHit(c: Chancla, e: Enemy, p: THREE.Vector3, killed: boolean, interrupted: boolean, posing: boolean, charged: boolean): void {
    const res = this.scoring.hit({ ricochet: c.ricocheted, charged, interrupt: interrupted, posing, legendary: c.golden, boss: false, kill: killed });
    this.addMeter(LEGEND.perHit + (c.ricocheted ? LEGEND.perRicochet : 0) + (killed ? LEGEND.perKill : 0));
    this.particles.burst(c.golden ? 'gold' : 'thwap', p.x, p.y, p.z, killed ? 16 : 10);
    this.events.emit('hit', { x: p.x, y: p.y, z: p.z, points: res.points, multiplier: res.multiplier, bonuses: res.bonuses, kill: killed, kind: 'enemy', ricochet: c.ricocheted, golden: c.golden });
    this.shoutBonuses(res.bonuses, v1.set(e.pos.x, 2.2, e.pos.z), killed);
    this.hitstop = killed ? 0.08 : 0.045;
    this.events.emit('hitstop', { strength: killed ? 1.4 : charged ? 1 : 0.6 });
    if (c.ricocheted) this.maybeQuip('rebote', 0.6);
    else if (killed) {
      const k: QuipKey = e.kind === 'bocinas' ? 'volumen' : e.kind === 'influencer' ? 'selfie' : 'hojas';
      this.maybeQuip(this.rng.chance(0.5) ? k : this.rng.pick(['noFalla', 'advierto', 'respeta'] as const), 0.45);
    } else if (this.scoring.combo >= 8 && this.scoring.combo % 4 === 0) this.maybeQuip('combo', 1);
  }

  private shoutBonuses(bonuses: BonusLabel[], p: THREE.Vector3, killed: boolean): void {
    let text: string = killed ? this.rng.pick(SHOUTS.kill) : this.rng.pick(SHOUTS.hit);
    let tone: ShoutTone = killed ? 'kill' : 'hit';
    if (bonuses.includes('ricochet')) { text = SHOUTS.ricochet; tone = 'bonus'; }
    else if (bonuses.includes('interrupt')) { text = SHOUTS.interrupt; tone = 'bonus'; }
    else if (bonuses.includes('posing')) { text = SHOUTS.posing; tone = 'bonus'; }
    else if (bonuses.includes('streak') && this.scoring.streak % 3 === 0) { text = SHOUTS.streak; tone = 'bonus'; }
    this.events.emit('shout', { text, x: p.x, y: p.y, z: p.z, tone });
  }

  private onSplash(c: Chancla, p: THREE.Vector3): void {
    this.particles.burst('gold', p.x, p.y, p.z, 16);
    this.events.emit('splash', { x: p.x, y: p.y, z: p.z });
    for (const e of this.enemies.pool) {
      if (!e.alive || c.hits.has(e.id)) continue;
      const d = Math.hypot(e.pos.x - p.x, e.pos.z - p.z);
      if (d > LEGEND.splashRadius) continue;
      c.hits.add(e.id);
      const out = e.takeHit(1, e.pos.x - p.x, e.pos.z - p.z, 8, false, this.hazards);
      if (out.valid) this.scoreEnemyHit(c, e, v3.set(e.pos.x, 1.2, e.pos.z), out.killed, out.interrupted, out.posing, false);
    }
  }

  private onHazardHit(h: HazardHit): void {
    if (this.ending) return;
    const amt = this.player.damage(h.damage, h.pushX, h.pushZ);
    if (amt <= 0) {
      if (h.pushX !== 0 || h.pushZ !== 0) this.player.push(h.pushX * 0.5, h.pushZ * 0.5);
      return;
    }
    this.scoring.playerHurt(amt);
    this.events.emit('hurt', { amount: amt, hp: this.player.hp, source: h.source });
    if (this.player.hp > 0) this.maybeQuip('ouch', 0.35);
  }

  private maybeQuip(key: QuipKey, chance: number): void {
    if (this.time - this.lastQuip < 6) return;
    if (!this.rng.chance(chance)) return;
    this.lastQuip = this.time;
    this.events.emit('quip', { key });
  }

  private finishRun(victory: boolean): void {
    this.ended = true;
    if (victory) this.scoring.addFlat(this.player.hp * SCORE.healthBonusPerHp);
    const st = this.scoring.stats();
    const result: RunResult = {
      victory,
      score: st.score,
      bestCombo: st.bestCombo,
      accuracy: this.scoring.accuracy,
      ricochetHits: st.ricochetHits,
      kills: st.kills,
      time: this.runTime,
      reached: this.reached,
    };
    this.charging = false;
    this.legendaryT = 0;
    this.setPhase(victory ? 'victory' : 'defeat');
    this.events.emit('runEnd', result);
  }

  // Verification hooks: counts of live entities, used by tests and e2e checks.
  debugCounts(): Record<string, number> {
    return {
      enemiesActive: this.enemies.activeCount(),
      enemyPool: this.enemies.pool.length,
      chanclasHeld: this.chanclas.heldCount(),
      chanclasActive: this.chanclas.activeCount(),
      hazards: this.hazards.activeCount(),
      pickups: this.pickups.activeCount(),
      particles: this.particles.active,
      bossVisible: this.boss.group.visible ? 1 : 0,
      dummies: this.dummies.filter((d) => d.active).length,
      sceneChildren: this.scene.children.length,
      eventHandlers: this.events.count(),
    };
  }

  // Test and automation helpers.
  debugJumpToWave(i: number): void {
    if (!this.inRun) this.startRun(true);
    this.enemies.reset();
    this.hazards.reset();
    this.tutorial.reset();
    for (const d of this.dummies) { d.active = false; d.group.visible = false; }
    if (i >= WAVES.length) this.beginBoss();
    else this.beginWave(i);
  }

  debugKillAll(): void {
    for (const e of this.enemies.pool) if (e.alive) e.takeHit(99, 0, 1, 2, false, this.hazards);
  }

  debugFillMeter(): void {
    this.addMeter(1);
  }
}
