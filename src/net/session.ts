// Client side of the multiplayer protocol, independent of rendering and the
// DOM so it runs in the browser and in Node tests alike.
//
//   * Local player: predicted every 60 Hz tick with the shared movement code,
//     reconciled against the server's acknowledged state by replaying the
//     inputs the server has not processed yet. Visible corrections are
//     blended out over a few frames.
//   * Remote players: interpolated between snapshots, rendered
//     NET.interpDelayMs behind the estimated server clock.
//   * Projectiles: your own throws appear immediately as predicted visuals;
//     everyone else's are simulated from the server's throw/bounce/end
//     events on the same delayed timeline as the players they come from.
//     Damage and hits are only ever shown when the server confirms them.

import { MOVE, NET, PROTOCOL_VERSION, WEAPONS, WEAPON_SWITCH_MS, type WeaponId } from '../../shared/config';
import type { Team } from '../../shared/map';
import { DEFAULT_MAP, mapData, type MapId } from '../../shared/maps';
import { World, newBody, stepMove, type Body } from '../../shared/physics';
import { BTN, hitboxOf, launch, stepProjectileWorld, type Hitbox, type Projectile, type SimEvent } from '../../shared/sim';
import { segmentCapsule } from '../../shared/collision';
import type { ClientMsg, ErrorCode, InputTuple, RoomView, ServerMsg, Snapshot } from '../../shared/protocol';

export interface Transport {
  send(msg: ClientMsg): void;
  close(): void;
  onMessage: ((msg: ServerMsg) => void) | null;
  onClose: ((code: number) => void) | null;
  onOpen: (() => void) | null;
}

export type TransportFactory = () => Transport;

export type ConnState = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'lost' | 'closed';

export interface RemotePlayer {
  id: number;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  vx: number; vz: number;
  alive: boolean; crouched: boolean; onGround: boolean; protected: boolean; connected: boolean;
  hp: number; weapon: WeaponId;
  msSinceThrow: number; msSinceHit: number;
}

export interface ClientProjectile {
  id: string;
  weapon: WeaponId;
  pr: Projectile;
  owner: number;
  predicted: boolean;
  startAt: number; // server time it was thrown
  endAt: number; // server time it ended, if known
  endPos: [number, number, number] | null;
  done: boolean;
  trail: Array<[number, number, number]>;
}

export interface LocalInput {
  mx: number;
  mz: number;
  yaw: number;
  pitch: number;
  fire: boolean;
  jump: boolean;
  crouch: boolean;
  weapon: WeaponId;
}

export interface SessionEvents {
  state?(s: ConnState, detail?: string): void;
  room?(room: RoomView): void;
  error?(code: ErrorCode): void;
  event?(e: SimEvent, mine: boolean): void;
  localThrow?(weapon: WeaponId): void;
  impact?(p: ClientProjectile, pos: [number, number, number], reason: string): void;
  left?(): void;
}

const DT = 1 / NET.tickRate;
const DT_MS = 1000 / NET.tickRate;

interface SnapRecord {
  st: number;
  players: Map<number, RemotePlayer>;
}

interface Pending {
  seq: number;
  inp: LocalInput;
}

export class GameSession {
  /** Collision for prediction: the room's map, swapped when the room changes it. */
  world = new World(mapData(DEFAULT_MAP).boxes);
  mapId: MapId = DEFAULT_MAP;
  state: ConnState = 'idle';
  id = -1;
  name = '';
  resume = '';
  room: RoomView | null = null;
  snap: Snapshot | null = null;
  rtt = 0;
  lastSnapAt = 0;
  serverOffset = 0; // estimated serverTime - localTime
  private offsetInit = false;
  private transport: Transport | null = null;
  private factory: TransportFactory;
  private handlers: SessionEvents;
  private now: () => number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private reconnectDeadline = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private intentionalClose = false;
  private pendingJoin: ClientMsg | null = null;

  // Prediction
  readonly body: Body = newBody(0, 0, 0);
  yaw = 0;
  pitch = 0;
  alive = false;
  hp = 100;
  weapon: WeaponId = 0;
  cooldownMs = 0;
  switchMs = 0;
  respawnInMs = 0;
  protectedMs = 0;
  private seq = 0;
  private pending: Pending[] = [];
  private outbox: InputTuple[] = [];
  readonly correction = { x: 0, y: 0, z: 0 };
  lastCorrection = 0;
  maxCorrection = 0;
  corrections = 0;
  private wantWeapon: WeaponId = 0;

  // Interpolation
  private history: SnapRecord[] = [];
  readonly remotes = new Map<number, RemotePlayer>();
  readonly projectiles = new Map<string, ClientProjectile>();
  private localShot = 0;

  debugLog: Array<Record<string, unknown>> | null = null;
  bytesIn = 0;
  msgsIn = 0;

  constructor(factory: TransportFactory, handlers: SessionEvents = {}, now: () => number = () => performance.now()) {
    this.factory = factory;
    this.handlers = handlers;
    this.now = now;
  }

  get team(): Team | null {
    return this.room?.members.find((m) => m.id === this.id)?.team ?? null;
  }

  get isOwner(): boolean {
    return !!this.room && this.room.owner === this.id;
  }

  get phase(): string {
    return this.snap?.ph ?? this.room?.phase ?? 'lobby';
  }

  serverNow(): number {
    return this.now() + this.serverOffset;
  }

  renderTime(): number {
    return this.serverNow() - NET.interpDelayMs;
  }

  private setState(s: ConnState, detail?: string): void {
    this.state = s;
    this.handlers.state?.(s, detail);
  }

  connect(name: string, resume?: string): void {
    this.name = name;
    if (resume) this.resume = resume;
    this.intentionalClose = false;
    this.open(false);
  }

  private open(reconnecting: boolean): void {
    this.setState(reconnecting ? 'reconnecting' : 'connecting');
    const t = this.factory();
    this.transport = t;
    t.onOpen = () => t.send({ t: 'hello', v: PROTOCOL_VERSION, name: this.name, resume: this.resume || undefined });
    t.onMessage = (m) => this.receive(m);
    t.onClose = (code) => this.handleClose(t, code);
  }

  private handleClose(t: Transport, code: number): void {
    if (t !== this.transport) return;
    this.stopPing();
    this.transport = null;
    if (this.intentionalClose || this.state === 'lost' || this.state === 'closed') {
      if (this.state !== 'lost') this.setState('closed');
      return;
    }
    if (code === 4002) { this.setState('lost', 'version'); return; }
    if (!this.room) { this.setState('lost', 'unreachable'); return; }
    // Try to get back into the same room within the server's grace period.
    if (this.state !== 'reconnecting') {
      this.reconnectAttempts = 0;
      this.reconnectDeadline = this.now() + NET.reconnectGraceMs - 2000;
      this.setState('reconnecting');
    }
    if (this.now() > this.reconnectDeadline) { this.setState('lost', 'timeout'); return; }
    const delay = Math.min(4000, 400 * 2 ** this.reconnectAttempts++);
    this.reconnectTimer = setTimeout(() => this.open(true), delay);
  }

  private receive(m: ServerMsg): void {
    this.msgsIn++;
    this.lastMsgAt = this.now();
    switch (m.t) {
      case 'welcome': {
        const wasRoom = this.room;
        this.id = m.id;
        this.resume = m.resume;
        this.startPing();
        if (this.state === 'reconnecting' && !m.rejoined && wasRoom) {
          this.room = null;
          this.setState('lost', 'room_gone');
          return;
        }
        this.setState('online');
        if (this.pendingJoin) { this.transport?.send(this.pendingJoin); this.pendingJoin = null; }
        return;
      }
      case 'room':
        this.room = m.room;
        if (m.room.map !== this.mapId) { this.mapId = m.room.map; this.world = new World(mapData(m.room.map).boxes); }
        if (m.room.phase === 'lobby' || m.room.phase === 'results') {
          this.projectiles.clear();
        }
        this.handlers.room?.(m.room);
        return;
      case 'snap':
        this.onSnapshot(m);
        return;
      case 'pong': {
        const rtt = this.now() - m.c;
        this.rtt = this.rtt === 0 ? rtt : this.rtt * 0.8 + rtt * 0.2;
        return;
      }
      case 'error':
        this.handlers.error?.(m.code);
        if (m.fatal) { this.intentionalClose = true; this.setState('lost', m.code); }
        return;
      case 'left':
        this.room = null;
        this.handlers.left?.();
        return;
      case 'bye':
        if (m.reason === 'replaced') { this.intentionalClose = true; this.setState('lost', 'replaced'); }
        if (m.reason === 'shutdown') this.handlers.error?.('shutdown');
        return;
    }
  }

  /** When the last message of any kind arrived (pongs come every 2 s). */
  private lastMsgAt = 0;

  /**
   * A phone can freeze a backgrounded page and leave its socket open but
   * dead, with no close event. If nothing has arrived for a while, treat the
   * connection as dropped and use the normal reconnect path (the server holds
   * the slot for NET.reconnectGraceMs). Called on return to the page, and by
   * the ping timer.
   */
  checkAlive(silentMs = 6000): void {
    const t = this.transport;
    if (!t || this.state !== 'online' || !this.room) return;
    if (this.now() - this.lastMsgAt < silentMs) return;
    t.onClose = null;
    t.onMessage = null;
    t.close();
    this.handleClose(t, 4000);
  }

  private startPing(): void {
    this.stopPing();
    this.lastMsgAt = this.now();
    const ping = () => { this.checkAlive(); this.transport?.send({ t: 'ping', c: this.now(), ...(this.rtt > 0 ? { r: Math.round(this.rtt) } : {}) }); };
    ping();
    this.pingTimer = setInterval(ping, 2000);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  send(msg: ClientMsg): void {
    if (this.state !== 'online') {
      if (msg.t === 'create' || msg.t === 'join') this.pendingJoin = msg;
      return;
    }
    this.transport?.send(msg);
  }

  leave(): void {
    this.send({ t: 'leave' });
    this.room = null;
    this.snap = null;
    this.history = [];
    this.remotes.clear();
    this.projectiles.clear();
    this.pending = [];
  }

  close(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopPing();
    this.transport?.close();
    this.transport = null;
    this.setState('closed');
  }

  // ---------------------------------------------------------------------
  // Snapshots, reconciliation and interpolation

  private onSnapshot(s: Snapshot): void {
    const local = this.now();
    // Clock sync: the snapshot was produced about rtt/2 ago.
    const sample = s.st + this.rtt / 2 - local;
    if (!this.offsetInit || Math.abs(sample - this.serverOffset) > 250) { this.serverOffset = sample; this.offsetInit = true; }
    else this.serverOffset += (sample - this.serverOffset) * 0.05;
    this.lastSnapAt = local;
    const prevPhase = this.snap?.ph;
    this.snap = s;

    const players = new Map<number, RemotePlayer>();
    for (const t of s.p) {
      players.set(t[0], {
        id: t[0], x: t[1], y: t[2], z: t[3], yaw: t[4], pitch: t[5], vx: t[6], vz: t[7],
        alive: (t[8] & 1) !== 0, crouched: (t[8] & 2) !== 0, onGround: (t[8] & 4) !== 0, protected: (t[8] & 8) !== 0, connected: (t[8] & 16) !== 0,
        hp: t[9], weapon: t[10] === 1 ? 1 : 0, msSinceThrow: t[11], msSinceHit: t[12],
      });
    }
    this.history.push({ st: s.st, players });
    while (this.history.length > 40) this.history.shift();
    for (const id of [...this.remotes.keys()]) if (!players.has(id)) this.remotes.delete(id);

    for (const e of s.ev as SimEvent[]) this.onEvent(e);

    if (s.me) this.reconcile(s, prevPhase !== s.ph);
  }

  private reconcile(s: Snapshot, phaseChanged: boolean): void {
    const me = s.me!;
    const wasAlive = this.alive;
    const before = { x: this.body.x, y: this.body.y, z: this.body.z };
    this.body.x = me[0]; this.body.y = me[1]; this.body.z = me[2];
    this.body.vx = me[3]; this.body.vy = me[4]; this.body.vz = me[5];
    this.alive = (me[6] & 1) !== 0;
    this.body.crouched = (me[6] & 2) !== 0;
    this.body.onGround = (me[6] & 4) !== 0;
    this.hp = me[7];
    this.respawnInMs = me[11];
    this.protectedMs = me[12];
    // Cooldowns: trust the server, minus the time our pending inputs represent.
    this.cooldownMs = me[8];
    this.switchMs = me[9];
    this.weapon = me[10] === 1 ? 1 : 0;
    this.pending = this.pending.filter((p) => p.seq > s.ack);
    const frozen = s.ph !== 'playing';
    for (const p of this.pending) this.simulate(p.inp, frozen, false);
    if (!this.alive || !wasAlive || phaseChanged) {
      // Spawns and deaths are teleports, not errors.
      this.correction.x = this.correction.y = this.correction.z = 0;
      if (!wasAlive && this.alive) { this.yaw = s.p.find((t) => t[0] === this.id)?.[4] ?? this.yaw; this.pitch = 0; }
      return;
    }
    const ex = before.x - this.body.x, ey = before.y - this.body.y, ez = before.z - this.body.z;
    const err = Math.hypot(ex, ey, ez);
    this.lastCorrection = err;
    if (this.debugLog && err > 1e-3) this.debugLog.push({ ack: s.ack, pending: this.pending.length, err, ph: s.ph, k: s.k, y: this.body.y, by: before.y });
    if (err > 1e-3) this.corrections++;
    this.maxCorrection = Math.max(this.maxCorrection, err);
    if (err > 2.5) { this.correction.x = this.correction.y = this.correction.z = 0; return; }
    this.correction.x += ex; this.correction.y += ey; this.correction.z += ez;
  }

  // One step of local movement plus local cooldown bookkeeping.
  private simulate(inp: LocalInput, frozen: boolean, live: boolean): boolean {
    let fired = false;
    if (this.cooldownMs > 0) this.cooldownMs = Math.max(0, this.cooldownMs - DT_MS);
    if (this.switchMs > 0) this.switchMs = Math.max(0, this.switchMs - DT_MS);
    if (!this.alive) return false;
    if (inp.weapon !== this.weapon) { this.weapon = inp.weapon; this.switchMs = WEAPON_SWITCH_MS; }
    stepMove(this.world, this.body, {
      mx: frozen ? 0 : inp.mx, mz: frozen ? 0 : inp.mz, yaw: inp.yaw, jump: !frozen && inp.jump, crouch: inp.crouch,
    }, DT);
    if (!frozen && inp.fire && this.cooldownMs <= 0 && this.switchMs <= 0) {
      this.cooldownMs = WEAPONS[this.weapon]!.cooldownMs;
      fired = true;
      if (live) this.predictThrow(inp);
    }
    return fired;
  }

  // Called by the game loop at NET.tickRate with the current controls.
  tick(inp: LocalInput): void {
    this.yaw = inp.yaw;
    this.pitch = inp.pitch;
    this.wantWeapon = inp.weapon;
    if (!this.snap || (this.phase !== 'playing' && this.phase !== 'countdown')) return;
    const seq = ++this.seq;
    const frozen = this.phase !== 'playing';
    // Simulate exactly what the server will receive (the wire rounds values).
    const q: LocalInput = { ...inp, mx: round(inp.mx), mz: round(inp.mz), yaw: round4(inp.yaw), pitch: round4(inp.pitch) };
    this.simulate(q, frozen, true);
    this.pending.push({ seq, inp: q });
    if (this.pending.length > 240) this.pending.shift();
    const buttons = (q.fire ? BTN.fire : 0) | (q.jump ? BTN.jump : 0) | (q.crouch ? BTN.crouch : 0);
    this.outbox.push([seq, q.mx, q.mz, q.yaw, q.pitch, buttons, q.weapon]);
    // Blend out reconciliation corrections over about 100 ms.
    const k = Math.exp(-DT * 18);
    this.correction.x *= k; this.correction.y *= k; this.correction.z *= k;
  }

  // Sends queued inputs. Call once per rendered frame (or tick).
  flush(): void {
    // Inputs produced while disconnected are dropped; the server never sees
    // them and later acknowledgements retire them from the replay buffer.
    if (!this.transport || this.state !== 'online') { this.outbox.length = 0; return; }
    while (this.outbox.length) {
      const d = this.outbox.splice(0, 8);
      this.transport?.send({ t: 'i', d });
    }
  }

  get desiredWeapon(): WeaponId {
    return this.wantWeapon;
  }

  // Interpolated state of remote players at the render time.
  updateRemotes(): void {
    const rt = this.renderTime();
    const h = this.history;
    if (h.length === 0) return;
    let a = h[0]!, b = h[0]!;
    for (let i = h.length - 1; i >= 0; i--) {
      if (h[i]!.st <= rt) { a = h[i]!; b = h[Math.min(i + 1, h.length - 1)]!; break; }
    }
    const span = b.st - a.st;
    let t = span > 0 ? (rt - a.st) / span : 0;
    if (b === a) t = Math.min(0.1, (rt - a.st) / 1000) * 10; // brief extrapolation
    t = Math.max(0, Math.min(1.2, t));
    for (const [id, pb] of b.players) {
      if (id === this.id) continue;
      const pa = a.players.get(id) ?? pb;
      const teleport = pa.alive !== pb.alive || Math.hypot(pb.x - pa.x, pb.z - pa.z) > 4;
      const r: RemotePlayer = this.remotes.get(id) ?? { ...pb };
      const tt = teleport ? 1 : t;
      if (b === a) {
        r.x = pb.x + pb.vx * Math.min(0.1, (rt - a.st) / 1000);
        r.z = pb.z + pb.vz * Math.min(0.1, (rt - a.st) / 1000);
        r.y = pb.y;
      } else {
        r.x = pa.x + (pb.x - pa.x) * tt;
        r.y = pa.y + (pb.y - pa.y) * tt;
        r.z = pa.z + (pb.z - pa.z) * tt;
      }
      r.yaw = lerpAngle(pa.yaw, pb.yaw, Math.min(1, tt));
      r.pitch = pa.pitch + (pb.pitch - pa.pitch) * Math.min(1, tt);
      r.vx = pb.vx; r.vz = pb.vz;
      const src = tt < 0.5 ? pa : pb;
      r.alive = src.alive; r.crouched = src.crouched; r.onGround = src.onGround; r.protected = src.protected; r.connected = pb.connected;
      r.hp = src.hp; r.weapon = src.weapon;
      r.msSinceThrow = src.msSinceThrow + (rt - (tt < 0.5 ? a.st : b.st));
      r.msSinceHit = src.msSinceHit + (rt - (tt < 0.5 ? a.st : b.st));
      r.id = id;
      this.remotes.set(id, r);
    }
  }

  // Hitboxes of enemies as currently displayed, for predicted visuals.
  displayedEnemyHitboxes(): Hitbox[] {
    const out: Hitbox[] = [];
    const myTeam = this.team;
    for (const r of this.remotes.values()) {
      if (!r.alive) continue;
      const team = this.room?.members.find((m) => m.id === r.id)?.team;
      if (team === myTeam) continue;
      const b = newBody(r.x, r.y, r.z);
      b.crouched = r.crouched;
      out.push(hitboxOf(b));
    }
    return out;
  }

  private predictThrow(inp: LocalInput): void {
    const { p, v } = launch(this.world, this.body, inp.yaw, inp.pitch, this.weapon, this.displayedEnemyHitboxes());
    const id = `local-${++this.localShot}`;
    const pr: Projectile = { id: -1, owner: this.id, team: this.team ?? 0, weapon: this.weapon, x: p[0], y: p[1], z: p[2], vx: v[0], vy: v[1], vz: v[2], ageMs: 0, traveled: 0, bounces: 0, fireSeq: this.seq };
    this.projectiles.set(id, { id, weapon: this.weapon, pr, owner: this.id, predicted: true, startAt: this.serverNow(), endAt: Infinity, endPos: null, done: false, trail: [] });
    this.handlers.localThrow?.(this.weapon);
  }

  private onEvent(e: SimEvent): void {
    const mine = 'o' in e ? e.o === this.id : 'a' in e ? e.a === this.id || ('v' in e && e.v === this.id) : 'id' in e && e.id === this.id;
    switch (e.k) {
      case 'throw':
        if (e.o !== this.id) {
          const pr: Projectile = { id: e.id, owner: e.o, team: 0, weapon: e.w, x: e.p[0], y: e.p[1], z: e.p[2], vx: e.v[0], vy: e.v[1], vz: e.v[2], ageMs: 0, traveled: 0, bounces: 0, fireSeq: e.s };
          this.projectiles.set(`s${e.id}`, { id: `s${e.id}`, weapon: e.w, pr, owner: e.o, predicted: false, startAt: e.tm, endAt: Infinity, endPos: null, done: false, trail: [] });
        }
        break;
      case 'bounce': {
        const cp = this.projectiles.get(`s${e.id}`);
        if (cp) { cp.pr.x = e.p[0]; cp.pr.y = e.p[1]; cp.pr.z = e.p[2]; cp.pr.vx = e.v[0]; cp.pr.vy = e.v[1]; cp.pr.vz = e.v[2]; cp.startAt = e.tm; cp.pr.ageMs = 0; }
        break;
      }
      case 'pend': {
        const cp = this.projectiles.get(`s${e.id}`);
        if (cp) { cp.endAt = e.tm; cp.endPos = e.p; }
        break;
      }
    }
    this.handlers.event?.(e, mine);
  }

  // Advances projectile visuals. Remote ones follow the delayed timeline.
  updateProjectiles(dt: number): void {
    const rt = this.renderTime();
    const targets = this.displayedEnemyHitboxes();
    for (const [key, cp] of this.projectiles) {
      if (cp.done) { this.projectiles.delete(key); continue; }
      if (cp.predicted) {
        const before = { x: cp.pr.x, y: cp.pr.y, z: cp.pr.z };
        const res = stepProjectileWorld(this.world, cp.pr, dt);
        // Stop visually at a displayed enemy; the server decides the damage.
        let hitPlayer = false;
        for (const t of targets) {
          if (segmentCapsule(before, cp.pr, WEAPONS[cp.weapon]!.radius, t.x, t.z, t.y0, t.y1 + 0.4, t.r) >= 0) { hitPlayer = true; break; }
        }
        cp.trail.push([cp.pr.x, cp.pr.y, cp.pr.z]);
        if (cp.trail.length > 10) cp.trail.shift();
        if (res === 'end' || hitPlayer) {
          cp.done = true;
          this.handlers.impact?.(cp, [cp.pr.x, cp.pr.y, cp.pr.z], hitPlayer ? 'player' : 'world');
        }
        continue;
      }
      // Remote projectile: simulate up to the render time.
      const target = Math.min(rt, cp.endAt);
      let simT = cp.startAt + cp.pr.ageMs;
      let guard = 0;
      while (simT + DT_MS <= target && guard++ < 30) {
        stepProjectileWorld(this.world, cp.pr, DT);
        simT += DT_MS;
      }
      if (target > simT) { /* partial step skipped; next frame catches up */ }
      if (rt >= cp.startAt) {
        cp.trail.push([cp.pr.x, cp.pr.y, cp.pr.z]);
        if (cp.trail.length > 10) cp.trail.shift();
      }
      if (rt >= cp.endAt || cp.pr.ageMs > WEAPONS[cp.weapon]!.lifeMs + 500) {
        cp.done = true;
        const at = cp.endPos ?? [cp.pr.x, cp.pr.y, cp.pr.z];
        cp.pr.x = at[0]; cp.pr.y = at[1]; cp.pr.z = at[2];
        this.handlers.impact?.(cp, at, 'world');
      }
    }
  }

  // Render position of the local player's eye (prediction + smoothing).
  eye(out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    out.x = this.body.x + this.correction.x;
    out.y = this.body.y + this.correction.y + (this.body.crouched ? MOVE.eyeCrouch : MOVE.eyeStand);
    out.z = this.body.z + this.correction.z;
    return out;
  }

  get connectionQuality(): 'good' | 'ok' | 'poor' | 'stalled' {
    if (this.state !== 'online') return 'stalled';
    const gap = this.now() - this.lastSnapAt;
    if (this.snap && (this.phase === 'playing' || this.phase === 'countdown') && gap > 600) return 'stalled';
    if (this.rtt > 180 || gap > 300) return 'poor';
    if (this.rtt > 90) return 'ok';
    return 'good';
  }
}

function round(v: number): number { return Math.round(v * 1000) / 1000; }
function round4(v: number): number { return Math.round(v * 10000) / 10000; }

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// WebSocket transport (browser WebSocket or a compatible constructor).
export function wsTransport(url: string, Ctor: { new (url: string): WebSocket } = WebSocket): TransportFactory {
  return () => {
    const ws = new Ctor(url);
    const t: Transport = {
      onMessage: null, onClose: null, onOpen: null,
      send(msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); },
      close() { try { ws.close(1000); } catch { /* closed */ } },
    };
    ws.onopen = () => t.onOpen?.();
    ws.onmessage = (ev: MessageEvent) => {
      let m: ServerMsg;
      try { m = JSON.parse(String(ev.data)) as ServerMsg; } catch { return; }
      t.onMessage?.(m);
    };
    ws.onclose = (ev: CloseEvent) => t.onClose?.(ev.code);
    ws.onerror = () => { /* close follows */ };
    return t;
  };
}
