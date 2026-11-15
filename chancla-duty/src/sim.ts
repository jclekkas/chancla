import {
  blocked,
  circleMtv,
  moveCircle,
  mulberry32,
  reflect,
  wrapAngle,
  type MoveBody,
  type Rect,
} from './phys';
import { POINTS, multiplier } from './rules';
import {
  DIFFS,
  ENEMIES,
  MAPS,
  WEAPONS,
  ENDLESS_MAPS,
  makeEndlessWave,
  solidBlocks,
  type Diff,
  type EnemyKind,
  type MapDef,
  type PickupKind,
  type Ranks,
  type WaveDef,
  type WeaponId,
} from './content';

export const STEP = 1 / 60;
const CHANCLA_POOL = 2;
const LEGEND_TIME = 5.2;

export interface FrameIn {
  mx: number;
  my: number;
  aimX: number;
  aimY: number;
  fireDown: boolean;
  firePressed: boolean;
  fireReleased: boolean;
  dash: boolean;
  recall: boolean;
  legend: boolean;
  slot: number;
  cycle: number;
  assist: boolean;
}

export function blankInput(p: Partial<FrameIn> = {}): FrameIn {
  return {
    mx: 0, my: 0, aimX: 0, aimY: 0,
    fireDown: false, firePressed: false, fireReleased: false,
    dash: false, recall: false, legend: false,
    slot: -1, cycle: 0, assist: false,
    ...p,
  };
}

export type Phase = 'intro' | 'fight' | 'clear' | 'won' | 'lost';
export type EState = 'move' | 'tele' | 'pose' | 'charge' | 'flinch' | 'recover' | 'breath' | 'ring';

export interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kx: number;
  ky: number;
  r: number;
  hp: number;
  maxHp: number;
  facing: number;
  invuln: number;
  dashT: number;
  dashCd: number;
  charge: number;
  weapon: number;
  cd: number;
  cdMax: number;
  legend: number;
  legendT: number;
  cafe: number;
  chile: number;
  rebozo: number;
  phase: number;
  swing: number;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  kx: number;
  ky: number;
  r: number;
  hp: number;
  maxHp: number;
  speed: number;
  dmg: number;
  state: EState;
  stT: number;
  tele: number;
  teleDur: number;
  aim: number;
  cd: number;
  touchCd: number;
  hurt: number;
  phase: number;
  dying: number | null;
  goal: 'player' | 'stall';
  strafe: number;
  pattern: number;
  ring: number;
  safe: number;
  breath: boolean;
  chargeT: number;
}

export type ShotKind = WeaponId | 'legend' | 'heart' | 'vinyl' | 'hose';

export interface Shot {
  id: number;
  kind: ShotKind;
  team: 'player' | 'enemy';
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  dmg: number;
  life: number;
  bounce: number;
  pierce: number;
  splash: number;
  homing: number;
  knock: number;
  spin: number;
  returning: boolean;
  returnT: number;
  charged: boolean;
  bounced: boolean;
  connected: boolean;
  alive: boolean;
  hx: number[];
  hy: number[];
  hi: number;
  hc: number;
  hits: number[];
}

export interface Pickup {
  kind: PickupKind;
  x: number;
  y: number;
  life: number;
  bob: number;
}

export interface Stats {
  throws: number;
  connected: number;
  hits: number;
  kills: number;
  bestCombo: number;
  damageTaken: number;
  time: number;
}

export type Ev =
  | { t: 'hit'; x: number; y: number; n: number; crit: boolean; banner: string | null; kind: EnemyKind }
  | { t: 'kill'; x: number; y: number; kind: EnemyKind; banner: string | null }
  | { t: 'hurt'; x: number; y: number }
  | { t: 'throw'; x: number; y: number; charged: boolean }
  | { t: 'bounce'; x: number; y: number }
  | { t: 'splash'; x: number; y: number; r: number }
  | { t: 'pickup'; x: number; y: number; kind: PickupKind }
  | { t: 'catch' }
  | { t: 'dash' }
  | { t: 'legend' }
  | { t: 'dry' }
  | { t: 'block' }
  | { t: 'map' }
  | { t: 'banner'; id: string };

export interface SimOpts {
  map: MapDef;
  waves: WaveDef[];
  diff: Diff;
  ranks: Ranks;
  weapons: WeaponId[];
  seed: number;
  loop: boolean;
  god: boolean;
  endless: boolean;
  finale: boolean;
  defend: boolean;
}

export class Sim {
  readonly rng: () => number;
  map: MapDef;
  blocks: Rect[];
  player: Player;
  enemies: Enemy[] = [];
  shots: Shot[] = [];
  pickups: Pickup[] = [];
  events: Ev[] = [];
  waves: WaveDef[];
  wave = 0;
  spawned = 0;
  spawnT = 0.25;
  phase: Phase = 'intro';
  phaseT = 0;
  score = 0;
  combo = 0;
  comboT = 0;
  stats: Stats = { throws: 0, connected: 0, hits: 0, kills: 0, bestCombo: 0, damageTaken: 0, time: 0 };
  stallHp = 120;
  stallMax = 120;
  defend: boolean;
  finale: boolean;
  endless: boolean;
  loop: boolean;
  god: boolean;
  diff: Diff;
  weapons: WeaponId[];
  ranks: Ranks;
  aimX = 0;
  aimY = 0;
  private nextId = 1;
  private bossSpawned = false;
  private dryLatch = false;
  private legendAcc = 0;
  private shieldMsg = 0;
  private introDur: number;

  constructor(opts: SimOpts) {
    this.rng = mulberry32(opts.seed);
    this.map = opts.map;
    this.blocks = solidBlocks(opts.map);
    this.waves = opts.waves;
    this.diff = opts.diff;
    this.ranks = opts.ranks;
    this.weapons = opts.weapons.length > 0 ? opts.weapons.slice() : ['chancla'];
    this.loop = opts.loop;
    this.god = opts.god;
    this.endless = opts.endless;
    this.finale = opts.finale;
    this.defend = opts.defend;
    this.introDur = opts.loop ? 0.15 : 1.05;
    const maxHp = 100 + this.ranks.hp * 20;
    this.player = {
      x: opts.map.start.x,
      y: opts.map.start.y,
      vx: 0, vy: 0, kx: 0, ky: 0,
      r: 15,
      hp: maxHp,
      maxHp,
      facing: -Math.PI / 2,
      invuln: 0,
      dashT: 0,
      dashCd: 0,
      charge: 0,
      weapon: 0,
      cd: 0,
      cdMax: 0.1,
      legend: 0,
      legendT: 0,
      cafe: 0,
      chile: 0,
      rebozo: 0,
      phase: 0,
      swing: 0,
    };
    if (opts.loop) {
      this.phase = 'fight';
      const spots = [
        { x: this.map.w / 2 - 190, y: this.map.h / 2 - 30 },
        { x: this.map.w / 2 + 210, y: this.map.h / 2 + 20 },
        { x: this.map.w / 2 - 30, y: this.map.h / 2 - 210 },
        { x: this.map.w / 2 + 60, y: this.map.h / 2 + 200 },
      ];
      const kinds: EnemyKind[] = ['bocinas', 'influencer', 'soplador', 'pinata'];
      kinds.forEach((k, i) => {
        const e = this.spawnEnemy(k);
        const s = spots[i];
        if (s && e) { e.x = s.x; e.y = s.y; }
      });
      this.spawned = 4;
      this.player.x = this.map.w / 2;
      this.player.y = this.map.h / 2 + 130;
    }
    this.aimX = this.player.x;
    this.aimY = this.player.y - 80;
  }

  get dmgMul(): number {
    return (1 + this.ranks.damage * 0.18) * (this.player.chile > 0 ? 1.5 : 1);
  }

  get moveSpeed(): number {
    return 248 * (1 + this.ranks.speed * 0.08) * (this.player.cafe > 0 ? 1.36 : 1);
  }

  get dashCooldown(): number {
    return 1.18 * Math.pow(0.8, this.ranks.dash);
  }

  living(): Enemy[] {
    const out: Enemy[] = [];
    for (const e of this.enemies) if (e.dying === null) out.push(e);
    return out;
  }

  chanclasOut(): number {
    let n = 0;
    for (const s of this.shots) if (s.alive && s.kind === 'chancla' && s.team === 'player') n++;
    return n;
  }

  step(dt: number, input: FrameIn): void {
    const phase = this.phase;
    if (phase === 'won' || phase === 'lost') return;
    this.stats.time += dt;
    this.shieldMsg = Math.max(0, this.shieldMsg - dt);
    if (this.combo > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) { this.combo = 0; this.comboT = 0; }
    }
    this.aimX = input.aimX;
    this.aimY = input.aimY;
    this.player.facing = Math.atan2(input.aimY - this.player.y, input.aimX - this.player.x);
    this.decayPlayer(dt);
    this.movePlayer(dt, input);
    this.switchWeapon(input);
    this.tryFire(dt, input);
    this.tickLegend(dt, input);
    if (input.recall) this.recall();
    this.tickShots(dt);
    this.tickEnemies(dt);
    this.tickPickups(dt);
    this.tickDirector(dt);
    this.hazards(dt);
    this.enemies = this.enemies.filter((e) => e.dying === null || e.dying > 0);
    this.shots = this.shots.filter((s) => s.alive);
    if (this.god) {
      this.player.hp = this.player.maxHp;
      if (this.phase === 'lost') this.phase = 'fight';
    }
  }

  private decayPlayer(dt: number): void {
    const p = this.player;
    p.invuln = Math.max(0, p.invuln - dt);
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.cd = Math.max(0, p.cd - dt);
    p.cafe = Math.max(0, p.cafe - dt);
    p.chile = Math.max(0, p.chile - dt);
    p.kx *= Math.exp(-dt * 7);
    p.ky *= Math.exp(-dt * 7);
    if (p.swing < 0) p.swing = Math.min(0, p.swing + dt * 5.5);
    const sp = Math.hypot(p.vx, p.vy);
    p.phase += dt * (sp > 30 ? 11 : 2);
  }

  private movePlayer(dt: number, input: FrameIn): void {
    const p = this.player;
    let mx = input.mx;
    let my = input.my;
    const mag = Math.hypot(mx, my);
    if (mag > 1) { mx /= mag; my /= mag; }
    if (input.dash && p.dashCd <= 0 && p.dashT <= 0) {
      let dx = mx;
      let dy = my;
      if (Math.hypot(dx, dy) < 0.2) {
        dx = Math.cos(p.facing);
        dy = Math.sin(p.facing);
      }
      const d = Math.hypot(dx, dy) || 1;
      p.vx = (dx / d) * 820;
      p.vy = (dy / d) * 820;
      p.dashT = 0.15;
      p.dashCd = this.dashCooldown;
      p.invuln = Math.max(p.invuln, 0.2);
      this.events.push({ t: 'dash' });
    }
    if (p.dashT > 0) {
      p.dashT -= dt;
    } else if (mag > 0.08) {
      const k = 1 - Math.exp(-dt * 14);
      const sp = this.moveSpeed;
      p.vx += (mx * sp - p.vx) * k;
      p.vy += (my * sp - p.vy) * k;
    } else {
      const k = 1 - Math.exp(-dt * 12);
      p.vx += (0 - p.vx) * k;
      p.vy += (0 - p.vy) * k;
    }
    const body: MoveBody = { x: p.x, y: p.y, vx: p.vx + p.kx, vy: p.vy + p.ky, r: p.r };
    moveCircle(body, dt, this.blocks, this.map.w, this.map.h);
    p.x = body.x;
    p.y = body.y;
    if (body.vx === 0) { p.vx = 0; p.kx = 0; }
    if (body.vy === 0) { p.vy = 0; p.ky = 0; }
  }

  private switchWeapon(input: FrameIn): void {
    const n = this.weapons.length;
    if (n === 0) return;
    if (input.slot >= 0 && input.slot < n && input.slot !== this.player.weapon) {
      this.player.weapon = input.slot;
      this.player.charge = 0;
    } else if (input.cycle !== 0) {
      this.player.weapon = (this.player.weapon + input.cycle + n) % n;
      this.player.charge = 0;
    }
  }

  private weaponId(): WeaponId {
    return this.weapons[this.player.weapon] ?? 'chancla';
  }

  private tryFire(dt: number, input: FrameIn): void {
    const id = this.weaponId();
    const spec = WEAPONS[id];
    if (spec.charge) {
      const blockedPool = id === 'chancla' && this.chanclasOut() >= CHANCLA_POOL;
      if (input.fireDown && !blockedPool && this.player.cd <= 0) {
        this.player.charge = Math.min(1, this.player.charge + dt / spec.chargeTime);
      }
      if (input.firePressed && blockedPool && !this.dryLatch) {
        this.dryLatch = true;
        this.events.push({ t: 'dry' });
      }
      if (!input.fireDown) this.dryLatch = false;
      if (input.fireReleased) {
        this.dryLatch = false;
        if (blockedPool || (id !== 'chancla' && this.player.cd > 0)) {
          this.player.charge = 0;
          return;
        }
        const full = this.player.charge >= 0.92;
        this.player.charge = 0;
        this.spawnPlayerShot(id, full, input);
      }
    } else if (input.firePressed && this.player.cd <= 0) {
      this.spawnPlayerShot(id, false, input);
    }
  }

  private aimAngle(input: FrameIn): number {
    let aim = Math.atan2(input.aimY - this.player.y, input.aimX - this.player.x);
    if (!input.assist) return aim;
    let best = aim;
    let bestDiff = 0.16;
    for (const e of this.enemies) {
      if (e.dying !== null) continue;
      const a = Math.atan2(e.y - this.player.y, e.x - this.player.x);
      const d = Math.abs(wrapAngle(a - aim));
      const dist = Math.hypot(e.x - this.player.x, e.y - this.player.y);
      if (d < bestDiff && dist < 400) { best = a; bestDiff = d; }
    }
    return best;
  }

  private spawnPlayerShot(id: WeaponId, charged: boolean, input: FrameIn): void {
    const spec = WEAPONS[id];
    const aim = this.aimAngle(input);
    const dmg = (charged ? spec.chargeDmg : spec.dmg) * this.dmgMul;
    const speed = spec.speed * (charged ? 1.16 : 1);
    const pellets = spec.pellets;
    for (let i = 0; i < pellets; i++) {
      const a = aim + (i - (pellets - 1) / 2) * spec.spread;
      this.makeShot({
        kind: id,
        team: 'player',
        x: this.player.x + Math.cos(a) * 22,
        y: this.player.y + Math.sin(a) * 22,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        r: spec.r,
        dmg,
        life: spec.life,
        bounce: spec.bounce + (id === 'chancla' ? this.ranks.bounce : 0),
        pierce: spec.pierce,
        splash: charged ? spec.splash * 1.28 : spec.splash,
        homing: spec.homing,
        knock: spec.knock * (charged ? 1.35 : 1),
        charged,
      });
    }
    this.player.cd = spec.cooldown;
    this.player.cdMax = spec.cooldown;
    this.player.swing = -1.05;
    this.stats.throws++;
    this.events.push({ t: 'throw', x: this.player.x, y: this.player.y, charged });
  }

  private tickLegend(dt: number, input: FrameIn): void {
    const p = this.player;
    if (input.legend && p.legend >= 1 && p.legendT <= 0) {
      p.legendT = LEGEND_TIME;
      p.legend = 0;
      this.legendAcc = 0;
      this.events.push({ t: 'legend' });
      this.events.push({ t: 'banner', id: 'legend' });
    }
    if (p.legendT > 0) {
      p.legendT -= dt;
      this.legendAcc += dt;
      if (this.legendAcc >= 0.11) {
        this.legendAcc = 0;
        const a = Math.atan2(this.aimY - p.y, this.aimX - p.x);
        this.makeShot({
          kind: 'legend',
          team: 'player',
          x: p.x + Math.cos(a) * 22,
          y: p.y + Math.sin(a) * 22,
          vx: Math.cos(a) * 880,
          vy: Math.sin(a) * 880,
          r: 7,
          dmg: 0.55 * this.dmgMul,
          life: 0.48,
          bounce: 0,
          pierce: 2,
          splash: 0,
          homing: 0,
          knock: 80,
          charged: false,
        });
      }
      if (p.legendT < 0) p.legendT = 0;
    }
  }

  private makeShot(s: Omit<Shot, 'id' | 'spin' | 'returning' | 'returnT' | 'bounced' | 'connected' | 'alive' | 'hx' | 'hy' | 'hi' | 'hc' | 'hits'>): Shot {
    const shot: Shot = {
      ...s,
      id: this.nextId++,
      spin: this.rng() * Math.PI,
      returning: false,
      returnT: 0,
      bounced: false,
      connected: false,
      alive: true,
      hx: Array.from({ length: 8 }, () => s.x),
      hy: Array.from({ length: 8 }, () => s.y),
      hi: 0,
      hc: 1,
      hits: [],
    };
    this.shots.push(shot);
    return shot;
  }

  private recall(): void {
    for (const s of this.shots) {
      if (s.alive && s.kind === 'chancla' && s.team === 'player' && !s.returning) s.returning = true;
    }
  }

  private tickShots(dt: number): void {
    for (const s of this.shots) {
      if (!s.alive) continue;
      s.life -= dt;
      s.spin += dt * (s.returning ? 18 : 12);
      if (s.returning) {
        s.returnT += dt;
        const dx = this.player.x - s.x;
        const dy = this.player.y - s.y;
        const d = Math.hypot(dx, dy) || 1;
        const sp = 420 + this.ranks.magnet * 150 + s.returnT * 280;
        s.vx = (dx / d) * sp;
        s.vy = (dy / d) * sp;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        this.pushHist(s);
        if (d < this.player.r + 14 || s.returnT > 2.5) {
          s.alive = false;
          this.events.push({ t: 'catch' });
        }
        continue;
      }
      if (s.homing > 0 && s.team === 'player') this.home(s, dt);
      const dist = Math.hypot(s.vx, s.vy) * dt;
      const sub = dist > 14 ? 2 : 1;
      const sdt = dt / sub;
      for (let i = 0; i < sub && s.alive && !s.returning; i++) this.advanceShot(s, sdt);
      if (s.alive && s.life <= 0) {
        if (s.splash > 0) this.explode(s);
        else if (s.kind === 'chancla') s.returning = true;
        else s.alive = false;
      }
    }
  }

  private home(s: Shot, dt: number): void {
    let best: Enemy | null = null;
    let bestD = 280 * 280;
    for (const e of this.enemies) {
      if (e.dying !== null) continue;
      const d = (e.x - s.x) ** 2 + (e.y - s.y) ** 2;
      if (d < bestD) { bestD = d; best = e; }
    }
    if (!best) return;
    const desired = Math.atan2(best.y - s.y, best.x - s.x);
    const current = Math.atan2(s.vy, s.vx);
    const turn = Math.max(-s.homing * dt, Math.min(s.homing * dt, wrapAngle(desired - current)));
    const sp = Math.hypot(s.vx, s.vy);
    const a = current + turn;
    s.vx = Math.cos(a) * sp;
    s.vy = Math.sin(a) * sp;
  }

  private advanceShot(s: Shot, dt: number): void {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    this.pushHist(s);
    if (s.x < -20 || s.y < -20 || s.x > this.map.w + 20 || s.y > this.map.h + 20) {
      if (s.kind === 'chancla') s.returning = true;
      else s.alive = false;
      return;
    }
    if (s.team === 'player') {
      for (const e of this.enemies) {
        if (!s.alive || s.returning || e.dying !== null) continue;
        if (s.hits.includes(e.id)) continue;
        const d = Math.hypot(e.x - s.x, e.y - s.y);
        if (d > e.r + s.r) continue;
        if (e.kind === 'rey' && !e.breath) {
          this.bounceOffCircle(s, e.x, e.y, e.r);
          if (this.shieldMsg <= 0) {
            this.shieldMsg = 0.8;
            this.events.push({ t: 'banner', id: 'shield' });
          }
          continue;
        }
        s.hits.push(e.id);
        if (s.splash > 0) {
          this.explode(s);
          return;
        }
        this.damageEnemy(e, s.dmg, s);
        s.pierce -= 1;
        if (s.pierce <= 0) {
          if (s.kind === 'chancla') s.returning = true;
          else s.alive = false;
          return;
        }
      }
    } else if (this.player.invuln <= 0) {
      const d = Math.hypot(this.player.x - s.x, this.player.y - s.y);
      if (d <= this.player.r + s.r) {
        this.hurt(s.dmg, s.x, s.y);
        s.alive = false;
        return;
      }
    }
    if (!s.alive || s.returning) return;
    for (const r of this.blocks) {
      const m = circleMtv(s.x, s.y, s.r, r);
      if (!m) continue;
      const len = Math.hypot(m.x, m.y) || 1;
      if (s.splash > 0 && s.bounce <= 0) {
        s.x += m.x;
        s.y += m.y;
        this.explode(s);
        return;
      }
      if (s.bounce > 0) {
        const ref = reflect(s.vx, s.vy, m.x / len, m.y / len, 0.9);
        s.vx = ref.vx;
        s.vy = ref.vy;
        s.x += m.x;
        s.y += m.y;
        s.bounce -= 1;
        s.bounced = true;
        this.events.push({ t: 'bounce', x: s.x, y: s.y });
      } else if (s.kind === 'chancla') {
        s.returning = true;
      } else {
        s.alive = false;
      }
      return;
    }
  }

  private bounceOffCircle(s: Shot, cx: number, cy: number, rad: number): void {
    const nx = s.x - cx;
    const ny = s.y - cy;
    const nd = Math.hypot(nx, ny) || 1;
    const ref = reflect(s.vx, s.vy, nx / nd, ny / nd, 0.92);
    s.vx = ref.vx;
    s.vy = ref.vy;
    s.x = cx + (nx / nd) * (rad + s.r + 2);
    s.y = cy + (ny / nd) * (rad + s.r + 2);
    s.bounced = true;
    this.events.push({ t: 'bounce', x: s.x, y: s.y });
  }

  private explode(s: Shot): void {
    if (!s.alive) return;
    s.alive = false;
    for (const e of this.enemies) {
      if (e.dying !== null) continue;
      if (Math.hypot(e.x - s.x, e.y - s.y) <= s.splash + e.r) this.damageEnemy(e, s.dmg, s);
    }
    this.events.push({ t: 'splash', x: s.x, y: s.y, r: s.splash });
  }

  private pushHist(s: Shot): void {
    s.hi = (s.hi + 1) % 8;
    s.hx[s.hi] = s.x;
    s.hy[s.hi] = s.y;
    if (s.hc < 8) s.hc++;
  }

  private addScore(base: number, x: number, y: number, crit: boolean, banner: string | null, kind: EnemyKind): void {
    this.combo += 1;
    this.comboT = 3.15;
    if (this.combo > this.stats.bestCombo) this.stats.bestCombo = this.combo;
    const pts = Math.round(base * multiplier(this.combo));
    this.score += pts;
    this.stats.hits += 1;
    if (this.player.legendT <= 0) this.player.legend = Math.min(1, this.player.legend + 0.045);
    this.events.push({ t: 'hit', x, y, n: pts, crit, banner, kind });
  }

  private damageEnemy(e: Enemy, dmg: number, shot: Shot | null): void {
    if (e.dying !== null) return;
    let mul = 1;
    let banner: string | null = null;
    const fromPlayer = !shot || shot.team === 'player';
    if (!fromPlayer) return;
    if (e.state === 'pose') {
      mul *= 2;
      banner = 'pose';
    } else if ((e.state === 'tele' || e.state === 'charge') && e.kind !== 'rey') {
      banner = 'interrupt';
      e.state = 'flinch';
      e.stT = 0.42;
      e.tele = 0;
    }
    if (e.kind === 'rey' && e.breath) mul *= 2;
    if (e.state === 'pose') {
      e.state = 'flinch';
      e.stT = 0.35;
    }
    const dealt = dmg * mul;
    e.hp -= dealt;
    e.hurt = 0.12;
    if (shot) {
      const a = Math.atan2(e.y - shot.y, e.x - shot.x);
      e.kx += Math.cos(a) * shot.knock * 0.55;
      e.ky += Math.sin(a) * shot.knock * 0.55;
      if (!shot.connected) {
        shot.connected = true;
        this.stats.connected += 1;
      }
    }
    let base: number = shot?.kind === 'legend' ? POINTS.hit * 0.45 : POINTS.hit;
    if (shot?.charged) base += POINTS.charged;
    if (shot?.bounced) {
      base += POINTS.ricochet;
      if (!banner) banner = 'ricochet';
    }
    if (banner === 'interrupt') base += POINTS.interrupt;
    if (banner === 'pose') base += POINTS.pose;
    if (e.kind === 'rey') base += POINTS.bossHit;
    if (e.hp <= 0) {
      const hazard = this.inHazard(e.x, e.y);
      this.kill(e, hazard ? 'hazard' : e.kind === 'rey' ? 'boss' : 'normal', base);
      return;
    }
    this.addScore(base, e.x, e.y, !!shot?.charged, banner, e.kind);
  }

  private kill(e: Enemy, how: 'normal' | 'hazard' | 'boss', extra = 0): void {
    if (e.dying !== null) return;
    e.dying = 0.42;
    e.hp = 0;
    let base = POINTS.kill + extra;
    let banner: string | null = null;
    if (how === 'hazard') { base += POINTS.hazard; banner = 'hazard'; }
    if (how === 'boss') base += POINTS.bossKill;
    this.stats.kills += 1;
    if (this.player.legendT <= 0) this.player.legend = Math.min(1, this.player.legend + 0.1);
    this.addScore(base, e.x, e.y, how !== 'normal', banner, e.kind);
    this.events.push({ t: 'kill', x: e.x, y: e.y, kind: e.kind, banner });
    if (e.kind === 'pinata') {
      this.drop(e.x, e.y, 'agua');
      this.drop(e.x + 16, e.y - 10, 'agua');
      this.drop(e.x - 14, e.y + 8, 'chile');
    } else if (e.kind !== 'rumor' && e.kind !== 'rey' && this.rng() < 0.28) {
      const kinds: PickupKind[] = ['cafe', 'chile', 'agua', 'rebozo', 'micro'];
      this.drop(e.x, e.y, kinds[Math.floor(this.rng() * kinds.length)]!);
    }
  }

  private drop(x: number, y: number, kind: PickupKind): void {
    this.pickups.push({ kind, x, y, life: 14, bob: this.rng() * Math.PI * 2 });
  }

  private hurt(amount: number, srcX: number, srcY: number): void {
    const p = this.player;
    if (p.invuln > 0 || this.phase === 'lost' || this.phase === 'won') return;
    if (p.rebozo > 0) {
      p.rebozo = 0;
      p.invuln = 0.45;
      this.events.push({ t: 'block' });
      this.events.push({ t: 'banner', id: 'rebozo' });
      return;
    }
    const dmg = amount * DIFFS[this.diff].dmg;
    p.hp -= dmg;
    this.stats.damageTaken += dmg;
    p.invuln = 0.72;
    const a = Math.atan2(p.y - srcY, p.x - srcX);
    p.kx += Math.cos(a) * 220;
    p.ky += Math.sin(a) * 220;
    this.events.push({ t: 'hurt', x: p.x, y: p.y });
    if (p.hp <= 0) {
      p.hp = 0;
      this.phase = 'lost';
    }
  }

  private spawnEnemy(kind: EnemyKind, at?: { x: number; y: number }): Enemy {
    const def = ENEMIES[kind];
    const waveScale = this.endless ? 1 + this.wave * 0.08 : 1;
    const hp = Math.max(1, Math.round(def.hp * DIFFS[this.diff].hp * waveScale));
    const pos = at ?? this.pickSpawn();
    const e: Enemy = {
      id: this.nextId++,
      kind,
      x: pos.x,
      y: pos.y,
      vx: 0, vy: 0, kx: 0, ky: 0,
      r: def.r,
      hp,
      maxHp: hp,
      speed: def.speed,
      dmg: def.dmg * (this.endless ? 1 + this.wave * 0.045 : 1),
      state: 'move',
      stT: 0,
      tele: 0,
      teleDur: def.tele * DIFFS[this.diff].tele,
      aim: 0,
      cd: 0.4 + this.rng() * 0.6,
      touchCd: 0,
      hurt: 0,
      phase: this.rng() * 6,
      dying: null,
      goal: this.defend && kind !== 'rumor' && kind !== 'rey' && this.rng() < 0.62 ? 'stall' : 'player',
      strafe: this.rng() < 0.5 ? -1 : 1,
      pattern: 0,
      ring: -1,
      safe: 0,
      breath: false,
      chargeT: 0,
    };
    if (kind === 'rey') {
      e.x = this.map.w / 2;
      e.y = this.map.h / 2 - 20;
      e.cd = 1.15;
      this.bossSpawned = true;
      this.events.push({ t: 'banner', id: 'boss' });
    }
    this.separateSpawn(e);
    this.enemies.push(e);
    return e;
  }

  private separateSpawn(e: Enemy): void {
    for (let n = 0; n < 6; n++) {
      let hit = false;
      for (const r of this.blocks) {
        const m = circleMtv(e.x, e.y, e.r, r);
        if (!m) continue;
        e.x += m.x;
        e.y += m.y;
        hit = true;
      }
      if (!hit) break;
    }
  }

  private pickSpawn(): { x: number; y: number } {
    let best = this.map.spawn[0] ?? { x: this.map.w / 2, y: 120 };
    let bestD = -1;
    for (let i = 0; i < this.map.spawn.length; i++) {
      const s = this.map.spawn[Math.floor(this.rng() * this.map.spawn.length)]!;
      if (this.pointBlocked(s.x, s.y, 18)) continue;
      const d = Math.hypot(s.x - this.player.x, s.y - this.player.y);
      if (d > 240) return s;
      if (d > bestD) { bestD = d; best = s; }
    }
    return best;
  }

  private pointBlocked(x: number, y: number, rad: number): boolean {
    for (const r of this.blocks) if (circleMtv(x, y, rad, r)) return true;
    return false;
  }

  private tickEnemies(dt: number): void {
    let rumors = 0;
    for (const e of this.enemies) if (e.kind === 'rumor' && e.dying === null) rumors++;
    for (const e of this.enemies) {
      e.hurt = Math.max(0, e.hurt - dt);
      e.touchCd = Math.max(0, e.touchCd - dt);
      e.kx *= Math.exp(-dt * 6);
      e.ky *= Math.exp(-dt * 6);
      e.phase += dt * 8;
      if (e.dying !== null) {
        e.dying -= dt;
        continue;
      }
      if (e.kind === 'rey') this.tickRey(e, dt);
      else if (e.kind === 'rumor') this.tickRumor(e, dt);
      else this.tickGrunt(e, dt, rumors);
      if (e.dying !== null) continue;
      if (e.kind !== 'rey' && e.touchCd <= 0 && e.dmg > 0 && Math.hypot(e.x - this.player.x, e.y - this.player.y) < e.r + this.player.r - 2) {
        this.hurt(e.dmg, e.x, e.y);
        e.touchCd = 0.55;
        if (e.kind === 'rumor') e.dying = 0.2;
      }
    }
  }

  private tickRumor(e: Enemy, dt: number): void {
    this.steer(e, this.player.x, this.player.y, dt, false);
    this.slideEnemy(e, dt);
    e.cd -= dt;
    if (e.cd < -8) e.dying = 0.15;
  }

  private tickGrunt(e: Enemy, dt: number, rumors: number): void {
    const def = ENEMIES[e.kind];
    if (e.state === 'flinch') {
      e.stT -= dt;
      this.slideEnemy(e, dt);
      if (e.stT <= 0) e.state = 'move';
      return;
    }
    if (e.state === 'recover') {
      e.stT -= dt;
      this.slideEnemy(e, dt);
      if (e.stT <= 0) { e.state = 'move'; e.cd = def.cd * (0.75 + this.rng() * 0.4); }
      return;
    }
    if (e.state === 'charge') {
      e.chargeT -= dt;
      e.vx = Math.cos(e.aim) * 460;
      e.vy = Math.sin(e.aim) * 460;
      const before = e.x;
      this.slideEnemy(e, dt);
      if (e.chargeT <= 0 || (e.vx === 0 && e.vy === 0 && Math.hypot(e.x - before, 0) >= 0)) {
        // wall stop is detected by vx/vy cleared inside slide when blocked hard
      }
      if (e.chargeT <= 0 || (e.vx === 0 && e.vy === 0)) {
        e.state = 'recover';
        e.stT = 0.45;
      }
      return;
    }
    if (e.state === 'pose') {
      e.stT -= dt;
      e.vx *= Math.exp(-dt * 10);
      e.vy *= Math.exp(-dt * 10);
      this.slideEnemy(e, dt);
      if (e.stT <= 0) {
        this.fireHeart(e);
        e.state = 'recover';
        e.stT = 0.35;
      }
      return;
    }
    if (e.state === 'tele') {
      e.tele += dt / Math.max(0.2, e.teleDur);
      e.vx *= Math.exp(-dt * 14);
      e.vy *= Math.exp(-dt * 14);
      this.slideEnemy(e, dt);
      if (e.tele >= 1) this.releaseAttack(e);
      return;
    }
    const target = this.targetOf(e);
    this.steer(e, target.x, target.y, dt, true);
    this.slideEnemy(e, dt);
    e.cd -= dt;
    const d = Math.hypot(target.x - e.x, target.y - e.y);
    if (e.cd <= 0 && d < def.range * 1.35) this.beginWindup(e, rumors);
  }

  private targetOf(e: Enemy): { x: number; y: number } {
    if (e.goal === 'stall' && this.map.stall) {
      const s = this.map.stall;
      return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
    }
    return { x: this.player.x, y: this.player.y };
  }

  private beginWindup(e: Enemy, rumors: number): void {
    e.aim = Math.atan2(this.player.y - e.y, this.player.x - e.x);
    e.tele = 0;
    e.teleDur = ENEMIES[e.kind].tele * DIFFS[this.diff].tele;
    if (e.kind === 'influencer' && this.rng() < 0.5) {
      e.state = 'pose';
      e.stT = 1.15;
      return;
    }
    if (e.kind === 'chismosa' && rumors >= 5) {
      e.cd = 0.8;
      return;
    }
    e.state = 'tele';
  }

  private releaseAttack(e: Enemy): void {
    const px = this.player.x;
    const py = this.player.y;
    if (e.kind === 'bocinas') {
      const d = Math.hypot(px - e.x, py - e.y);
      const a = Math.atan2(py - e.y, px - e.x);
      if (d < 230 && Math.abs(wrapAngle(a - e.aim)) < 0.48 && !blocked(e.x, e.y, px, py, this.blocks)) {
        this.hurt(e.dmg, e.x, e.y);
      }
    } else if (e.kind === 'influencer') {
      this.fireHeart(e);
    } else if (e.kind === 'soplador') {
      const d = Math.hypot(px - e.x, py - e.y);
      const a = Math.atan2(py - e.y, px - e.x);
      if (d < 110 && Math.abs(wrapAngle(a - e.aim)) < 0.7) {
        this.hurt(e.dmg, e.x, e.y);
        this.player.kx += Math.cos(e.aim) * 340;
        this.player.ky += Math.sin(e.aim) * 340;
      }
    } else if (e.kind === 'chismosa') {
      this.spawnEnemy('rumor', { x: e.x + Math.cos(e.aim) * 28, y: e.y + Math.sin(e.aim) * 28 });
    } else if (e.kind === 'repartidor') {
      e.state = 'charge';
      e.chargeT = 0.52;
      return;
    } else if (e.kind === 'vecina') {
      for (let i = -1; i <= 1; i++) {
        const a = e.aim + i * 0.16;
        this.makeShot({
          kind: 'hose', team: 'enemy',
          x: e.x + Math.cos(a) * (e.r + 8), y: e.y + Math.sin(a) * (e.r + 8),
          vx: Math.cos(a) * 340, vy: Math.sin(a) * 340,
          r: 7, dmg: e.dmg, life: 0.85, bounce: 0, pierce: 1, splash: 0, homing: 0, knock: 40, charged: false,
        });
      }
    } else if (e.kind === 'pinata') {
      if (Math.hypot(px - e.x, py - e.y) < 78) this.hurt(e.dmg, e.x, e.y);
    }
    e.state = 'recover';
    e.stT = 0.38;
  }

  private fireHeart(e: Enemy): void {
    const a = Math.atan2(this.player.y - e.y, this.player.x - e.x);
    this.makeShot({
      kind: 'heart', team: 'enemy',
      x: e.x + Math.cos(a) * (e.r + 6), y: e.y + Math.sin(a) * (e.r + 6),
      vx: Math.cos(a) * 250, vy: Math.sin(a) * 250,
      r: 8, dmg: e.dmg, life: 2.1, bounce: 0, pierce: 1, splash: 0, homing: 0, knock: 30, charged: false,
    });
  }

  private tickRey(e: Enemy, dt: number): void {
    const cx = this.map.w / 2;
    const cy = this.map.h / 2 - 30;
    e.vx += (cx - e.x) * dt * 0.35;
    e.vy += (cy - e.y) * dt * 0.35;
    e.vx *= Math.exp(-dt * 2.2);
    e.vy *= Math.exp(-dt * 2.2);
    this.slideEnemy(e, dt);
    if (e.state === 'flinch') {
      e.stT -= dt;
      if (e.stT <= 0) e.state = 'move';
      return;
    }
    if (e.breath) {
      e.stT -= dt;
      e.ring = -1;
      if (e.stT <= 0) {
        e.breath = false;
        e.state = 'move';
        e.cd = 0.7;
        e.pattern = 0;
      }
      return;
    }
    if (e.state === 'ring') {
      e.ring += dt * 300;
      if (this.player.invuln <= 0) {
        const d = Math.hypot(this.player.x - e.x, this.player.y - e.y);
        if (Math.abs(d - e.ring) < 24) {
          const a = Math.atan2(this.player.y - e.y, this.player.x - e.x);
          if (Math.abs(wrapAngle(a - e.safe)) > 0.52) this.hurt(14, e.x, e.y);
        }
      }
      if (e.ring > 400) {
        e.ring = -1;
        e.state = 'recover';
        e.stT = 0.55;
      }
      return;
    }
    if (e.state === 'recover') {
      e.stT -= dt;
      if (e.stT <= 0) {
        e.pattern = (e.pattern + 1) % 3;
        if (e.pattern === 2) {
          e.breath = true;
          e.state = 'breath';
          e.stT = 3.25;
          this.events.push({ t: 'banner', id: 'breath' });
        } else if (e.pattern === 0) {
          e.state = 'ring';
          e.ring = 36;
          e.safe = this.rng() * Math.PI * 2;
        } else {
          this.vinyl(e);
          e.state = 'recover';
          e.stT = 0.7;
        }
      }
      return;
    }
    e.cd -= dt;
    if (e.cd <= 0 && e.state === 'move') {
      e.state = 'ring';
      e.ring = 36;
      e.safe = Math.atan2(this.player.y - e.y, this.player.x - e.x) + (this.rng() < 0.5 ? 0.9 : -0.9);
      e.pattern = 0;
    }
  }

  private vinyl(e: Enemy): void {
    const base = Math.atan2(this.player.y - e.y, this.player.x - e.x);
    for (let i = -2; i <= 2; i++) {
      const a = base + i * 0.22;
      this.makeShot({
        kind: 'vinyl', team: 'enemy',
        x: e.x + Math.cos(a) * (e.r + 8), y: e.y + Math.sin(a) * (e.r + 8),
        vx: Math.cos(a) * 280, vy: Math.sin(a) * 280,
        r: 10, dmg: 13, life: 2.4, bounce: 0, pierce: 1, splash: 0, homing: 0, knock: 60, charged: false,
      });
    }
  }

  private steer(e: Enemy, tx: number, ty: number, dt: number, smart: boolean): void {
    let dx = tx - e.x;
    let dy = ty - e.y;
    const d = Math.hypot(dx, dy) || 1;
    let dirx = dx / d;
    let diry = dy / d;
    const prefer = ENEMIES[e.kind].range;
    if (smart && (e.kind === 'bocinas' || e.kind === 'influencer' || e.kind === 'chismosa' || e.kind === 'vecina')) {
      if (d < prefer * 0.72) { dirx = -dirx; diry = -diry; }
      else if (d < prefer) {
        dirx = (-dy / d) * e.strafe;
        diry = (dx / d) * e.strafe;
      }
    }
    for (const o of this.enemies) {
      if (o === e || o.dying !== null) continue;
      const sx = e.x - o.x;
      const sy = e.y - o.y;
      const sd = Math.hypot(sx, sy);
      if (sd > 0 && sd < e.r + o.r + 14) {
        dirx += (sx / sd) * 1.5;
        diry += (sy / sd) * 1.5;
      }
    }
    const mag = Math.hypot(dirx, diry) || 1;
    const sp = e.speed * (e.kind === 'pinata' ? 0.65 + 0.45 * (0.5 + 0.5 * Math.sin(e.phase)) : 1);
    const k = 1 - Math.exp(-dt * 6);
    e.vx += ((dirx / mag) * sp - e.vx) * k;
    e.vy += ((diry / mag) * sp - e.vy) * k;
  }

  private slideEnemy(e: Enemy, dt: number): void {
    const body: MoveBody = { x: e.x, y: e.y, vx: e.vx + e.kx, vy: e.vy + e.ky, r: e.r };
    moveCircle(body, dt, this.blocks, this.map.w, this.map.h);
    e.x = body.x;
    e.y = body.y;
    if (body.vx === 0) { e.vx = 0; e.kx = 0; }
    if (body.vy === 0) { e.vy = 0; e.ky = 0; }
    if (e.dying === null && e.hp > 0 && this.inHazard(e.x, e.y)) {
      e.hp -= (e.kind === 'rumor' ? 4 : 32) * dt;
      e.hurt = 0.08;
      if (e.hp <= 0) this.kill(e, 'hazard', 0);
    }
  }

  private inHazard(x: number, y: number): boolean {
    for (const z of this.map.hazards) {
      if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return true;
    }
    for (const z of this.map.pits) {
      if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return true;
    }
    return false;
  }

  private hazards(dt: number): void {
    const p = this.player;
    if (p.invuln <= 0 && this.inHazard(p.x, p.y)) {
      this.hurt(14, p.x, p.y - 10);
      const cx = this.map.w / 2;
      const cy = this.map.h / 2;
      const a = Math.atan2(cy - p.y, cx - p.x);
      p.kx += Math.cos(a) * 80;
      p.ky += Math.sin(a) * 80;
    }
    if (this.defend && this.map.stall && this.stallHp > 0) {
      const s = this.map.stall;
      const cx = s.x + s.w / 2;
      const cy = s.y + s.h / 2;
      for (const e of this.enemies) {
        if (e.dying !== null || e.kind === 'rumor') continue;
        if (Math.hypot(e.x - cx, e.y - cy) < 78) this.stallHp -= 9 * dt;
      }
      if (this.stallHp <= 0) {
        this.stallHp = 0;
        this.phase = 'lost';
      }
    }
  }

  private tickPickups(dt: number): void {
    const reach = 78 + this.ranks.magnet * 95;
    const pull = 120 + this.ranks.magnet * 90;
    for (const p of this.pickups) {
      p.life -= dt;
      p.bob += dt * 3;
      const dx = this.player.x - p.x;
      const dy = this.player.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < reach && d > 1) {
        p.x += (dx / d) * pull * dt;
        p.y += (dy / d) * pull * dt;
      }
      if (d < this.player.r + 16) this.collect(p);
    }
    this.pickups = this.pickups.filter((p) => p.life > 0);
  }

  private collect(p: Pickup): void {
    p.life = 0;
    const pl = this.player;
    if (p.kind === 'cafe') pl.cafe = 6.6;
    else if (p.kind === 'chile') pl.chile = 6.6;
    else if (p.kind === 'agua') pl.hp = Math.min(pl.maxHp, pl.hp + 30);
    else if (p.kind === 'rebozo') pl.rebozo = 1;
    else pl.legend = Math.min(1, pl.legend + 0.45);
    this.events.push({ t: 'pickup', x: p.x, y: p.y, kind: p.kind });
  }

  private tickDirector(dt: number): void {
    if (this.phase === 'intro') {
      this.phaseT += dt;
      if (this.phaseT >= this.introDur) {
        this.phase = 'fight';
        this.phaseT = 0;
        this.events.push({ t: 'banner', id: 'ready' });
      }
      return;
    }
    if (this.phase === 'clear') {
      this.phaseT += dt;
      if (this.phaseT >= 0.95) this.advance();
      return;
    }
    if (this.finale && this.bossSpawned && !this.enemies.some((e) => e.kind === 'rey' && e.dying === null)) {
      this.phase = 'won';
      for (const e of this.enemies) if (e.dying === null) e.dying = 0.35;
      return;
    }
    const wave = this.waves[this.wave];
    if (!wave) {
      this.phase = 'won';
      return;
    }
    const alive = this.living().length;
    if (this.spawned < wave.kinds.length && alive < wave.max) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        const kind = wave.kinds[this.spawned]!;
        this.spawnEnemy(kind);
        this.spawned += 1;
        this.spawnT = wave.gap * DIFFS[this.diff].gap * (0.82 + this.rng() * 0.36);
      }
    } else if (this.spawned >= wave.kinds.length && alive === 0 && !(this.finale && this.bossSpawned)) {
      if (this.loop) {
        this.spawned = 0;
        this.spawnT = 0.7;
      } else {
        this.phase = 'clear';
        this.phaseT = 0;
        this.score += POINTS.wave * (this.wave + 1);
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 12);
        this.events.push({ t: 'banner', id: 'wave' });
      }
    }
  }

  private advance(): void {
    this.wave += 1;
    if (this.endless) {
      if (this.wave >= this.waves.length) this.waves.push(makeEndlessWave(this.wave + 1));
      if (this.wave > 0 && this.wave % 3 === 0) {
        const id = ENDLESS_MAPS[(this.wave / 3) % ENDLESS_MAPS.length]!;
        const next = MAPS[id];
        if (next && next.id !== this.map.id) {
          this.map = next;
          this.blocks = solidBlocks(next);
          this.player.x = next.start.x;
          this.player.y = next.start.y;
          this.player.vx = 0;
          this.player.vy = 0;
          this.shots.length = 0;
          this.pickups.length = 0;
          this.events.push({ t: 'map' });
        }
      }
    } else if (this.wave >= this.waves.length) {
      this.phase = 'won';
      return;
    }
    this.phase = 'intro';
    this.phaseT = 0;
    this.spawned = 0;
    this.spawnT = 0.35;
    this.introDur = 0.85;
  }
}

export function clearedWaves(sim: Sim): number {
  if (sim.endless) return sim.phase === 'won' ? sim.wave + 1 : sim.wave;
  if (sim.phase === 'won') return sim.waves.length;
  return sim.wave;
}
