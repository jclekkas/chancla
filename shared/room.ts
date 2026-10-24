// A room: lobby, team assignment, readiness, the match itself and results.
// Transport-agnostic: members talk through a Conn, so the WebSocket server
// and the in-browser practice host run exactly this code.

import { MATCH, NET, type BotDifficulty } from './config';
import { MatchSim, BTN, type SimEvent } from './sim';
import type { Team } from './map';
import { DEFAULT_MAP, mapData, type MapId } from './maps';
import { BotBrain } from './bots';
import type { ClientMsg, MemberView, PlayerTuple, Results, RoomPhase, RoomView, SelfTuple, ServerMsg, Snapshot } from './protocol';
import { weaponOf } from './protocol';

export interface Conn {
  send(msg: ServerMsg): void;
  close(code?: number, reason?: string): void;
}

export interface Member {
  id: number;
  name: string;
  team: Team;
  ready: boolean;
  bot: boolean;
  conn: Conn | null;
  resume: string;
  joinedAt: number;
  disconnectedAt: number;
  ping: number;
  brain: BotBrain | null;
  snapPending: boolean;
}

const BOT_NAMES = ['Lupita', 'Chayo', 'Conchita', 'Doña Mago', 'Tía Chela', 'Nena', 'Doña Pili', 'Cuca'];
const TICK_MS = 1000 / NET.tickRate;
/** A knockback this recent is still under way when practice pauses: its momentum is kept. */
const PAUSE_KNOCK_KEEP_MS = 250;
const SNAP_EVERY = Math.round(NET.tickRate / NET.snapshotRate);

export interface RoomOptions {
  practice?: boolean;
  seed?: number;
  durationMs?: number;
  scoreToWin?: number;
  countdownMs?: number;
}

export class Room {
  readonly code: string;
  readonly practice: boolean;
  readonly members = new Map<number, Member>();
  owner = -1;
  phase: RoomPhase = 'lobby';
  sim: MatchSim | null = null;
  results: Results | null = null;
  bots: { enabled: boolean; difficulty: BotDifficulty } = { enabled: false, difficulty: 'normal' };
  map: MapId = DEFAULT_MAP;
  emptySince: number;
  private acc = 0;
  private lastUpdate = -1;
  private tickCount = 0;
  private eventBuf: SimEvent[] = [];
  private nextBotId = 1000;
  private botNameIdx = 0;
  private roomDirty = true;
  private opts: RoomOptions;
  maxTickMs = 0;
  totalTicks = 0;

  constructor(code: string, now: number, opts: RoomOptions = {}) {
    this.code = code;
    this.practice = !!opts.practice;
    this.emptySince = now;
    this.opts = opts;
  }

  get humans(): Member[] {
    return [...this.members.values()].filter((m) => !m.bot);
  }

  get connectedHumans(): number {
    return this.humans.filter((m) => m.conn).length;
  }

  get isFull(): boolean {
    return this.humans.length >= MATCH.maxPlayers;
  }

  teamCount(team: Team): number {
    let n = 0;
    for (const m of this.members.values()) if (m.team === team) n++;
    return n;
  }

  // Adds a human. Returns null when there is no free slot.
  addHuman(id: number, name: string, resume: string, conn: Conn, now: number): Member | null {
    if (this.isFull) return null;
    // A bot gives up its seat to a real player.
    if (this.members.size >= MATCH.maxPlayers) {
      const bot = [...this.members.values()].reverse().find((m) => m.bot);
      if (!bot) return null;
      this.removeMember(bot.id);
    }
    const team: Team = this.teamCount(0) <= this.teamCount(1) ? 0 : 1;
    const m: Member = {
      id, name, team, ready: false, bot: false, conn, resume, joinedAt: now, disconnectedAt: 0, ping: 0, brain: null, snapPending: true,
    };
    this.members.set(id, m);
    if (this.owner < 0 || !this.members.has(this.owner)) this.owner = id;
    if (this.sim) { this.sim.addPlayer(id, team); this.sim.setViewDelay(id, viewDelay(0)); }
    this.fillBots();
    this.roomDirty = true;
    return m;
  }

  addBot(team?: Team): Member | null {
    if (this.members.size >= MATCH.maxPlayers) return null;
    const t: Team = team ?? (this.teamCount(0) <= this.teamCount(1) ? 0 : 1);
    if (this.teamCount(t) >= MATCH.teamSize) return null;
    const id = this.nextBotId++;
    const name = `${BOT_NAMES[this.botNameIdx++ % BOT_NAMES.length]}`;
    const m: Member = {
      id, name, team: t, ready: true, bot: true, conn: null, resume: '', joinedAt: 0, disconnectedAt: 0, ping: 0, brain: null, snapPending: false,
    };
    this.members.set(id, m);
    if (this.sim) {
      this.sim.addPlayer(id, t, true);
      m.brain = new BotBrain(this.sim, id, this.bots.difficulty);
    }
    this.roomDirty = true;
    return m;
  }

  private fillBots(): void {
    if (!this.bots.enabled) return;
    while (this.members.size < MATCH.maxPlayers) if (!this.addBot()) break;
  }

  removeMember(id: number): void {
    const m = this.members.get(id);
    if (!m) return;
    this.members.delete(id);
    this.sim?.removePlayer(id);
    if (this.owner === id) this.transferOwner();
    this.roomDirty = true;
  }

  private transferOwner(): void {
    // The longest-present connected human becomes the owner.
    const next = this.humans.filter((m) => m.conn).sort((a, b) => a.joinedAt - b.joinedAt)[0] ?? this.humans[0];
    this.owner = next ? next.id : -1;
  }

  disconnect(id: number, now: number): void {
    const m = this.members.get(id);
    if (!m || m.bot) return;
    m.conn = null;
    m.disconnectedAt = now;
    const sp = this.sim?.players.get(id);
    if (sp) { sp.active = false; sp.queue.length = 0; }
    // A connected human takes over; if nobody else is here the owner keeps it.
    if (this.owner === id) this.transferOwner();
    this.roomDirty = true;
  }

  reconnect(id: number, conn: Conn): boolean {
    const m = this.members.get(id);
    if (!m || m.bot) return false;
    const old = m.conn;
    m.conn = conn;
    m.disconnectedAt = 0;
    m.snapPending = true;
    if (old && old !== conn) {
      old.send({ t: 'bye', reason: 'replaced' });
      old.close(4001, 'replaced');
    }
    const sp = this.sim?.players.get(id);
    if (sp) sp.active = true;
    if (!this.members.get(this.owner)?.conn) this.owner = id;
    this.roomDirty = true;
    return true;
  }

  view(): RoomView {
    const members: MemberView[] = [...this.members.values()]
      .sort((a, b) => a.team - b.team || Number(a.bot) - Number(b.bot) || a.id - b.id)
      .map((m) => ({ id: m.id, name: m.name, team: m.team, ready: m.bot || m.ready || m.id === this.owner, connected: m.bot || !!m.conn, bot: m.bot, ping: m.ping }));
    return {
      code: this.code, owner: this.owner, phase: this.phase, practice: this.practice, members,
      bots: { ...this.bots }, results: this.results, maxPlayers: MATCH.maxPlayers, teamSize: MATCH.teamSize, map: this.map,
    };
  }

  private broadcast(msg: ServerMsg): void {
    for (const m of this.members.values()) m.conn?.send(msg);
  }

  // Handles a message from a member. Returns an error code or null.
  handle(id: number, msg: ClientMsg, now: number): string | null {
    const m = this.members.get(id);
    if (!m) return 'no_room';
    const isOwner = id === this.owner;
    switch (msg.t) {
      case 'team': {
        if (this.phase !== 'lobby' && this.phase !== 'results') return 'bad_message';
        if (m.team === msg.team) return null;
        if (this.teamCount(msg.team) >= MATCH.teamSize) {
          // Swap with a bot on the other team if there is one.
          const bot = [...this.members.values()].find((x) => x.bot && x.team === msg.team);
          if (!bot) return 'team_full';
          bot.team = m.team;
        }
        m.team = msg.team;
        m.ready = false;
        this.roomDirty = true;
        return null;
      }
      case 'ready':
        m.ready = msg.ready;
        this.roomDirty = true;
        return null;
      case 'bots':
        if (!isOwner) return 'not_owner';
        if (this.phase !== 'lobby' && this.phase !== 'results') return 'bad_message';
        this.bots = { enabled: msg.enabled, difficulty: msg.difficulty };
        for (const b of [...this.members.values()].filter((x) => x.bot)) this.removeMember(b.id);
        this.fillBots();
        this.roomDirty = true;
        return null;
      case 'map':
        // The owner picks the arena between matches; everyone loads it from the room view.
        if (!isOwner) return 'not_owner';
        if (this.phase !== 'lobby' && this.phase !== 'results') return 'bad_message';
        if (this.map !== msg.map) { this.map = msg.map; this.roomDirty = true; }
        return null;
      case 'start':
        if (!isOwner) return 'not_owner';
        if (this.phase !== 'lobby') return 'bad_message';
        return this.startMatch(now);
      case 'rematch':
        if (!isOwner) return 'not_owner';
        if (this.phase !== 'results') return 'bad_message';
        // Rematch: same teams, straight into the countdown for everyone.
        return this.startMatch(now, true);
      case 'lobby':
        if (!isOwner) return 'not_owner';
        if (this.phase !== 'results') return 'bad_message';
        this.phase = 'lobby';
        this.sim = null;
        this.results = null;
        for (const x of this.members.values()) if (!x.bot) x.ready = false;
        this.roomDirty = true;
        return null;
      case 'i': {
        const sp = this.sim?.players.get(id);
        if (!sp) return null;
        for (const d of msg.d) {
          this.sim!.queueInput(id, { seq: d[0], mx: d[1], mz: d[2], yaw: d[3], pitch: d[4], buttons: d[5] & 15, weapon: weaponOf(d[6]) });
        }
        return null;
      }
      default:
        return null;
    }
  }

  // Client-reported round trip, shown on the scoreboard. Only rebroadcast
  // when it moves noticeably, so pings do not flood the room channel.
  reportPing(id: number, ms: number): void {
    const m = this.members.get(id);
    if (!m || m.bot) return;
    if (Math.abs(m.ping - ms) >= 15 || (m.ping === 0) !== (ms === 0)) { m.ping = ms; this.roomDirty = true; }
    this.sim?.setViewDelay(id, viewDelay(ms));
  }

  // Everyone but the owner must be ready; at least two participants.
  canStart(skipReady = false): string | null {
    const participants = [...this.members.values()].filter((m) => m.bot || m.conn).length;
    if (participants < MATCH.minParticipants && !this.practice) return 'too_few';
    if (skipReady) return null;
    for (const m of this.members.values()) if (!m.bot && m.conn && m.id !== this.owner && !m.ready) return 'not_ready';
    return null;
  }

  private startMatch(now: number, skipReady = false): string | null {
    const err = this.canStart(skipReady);
    if (err) return err;
    // Rebalance if one team is over capacity (people may have left).
    const sim = new MatchSim(mapData(this.map), {
      seed: this.opts.seed ?? Math.floor(Math.random() * 1e9),
      durationMs: this.opts.durationMs, scoreToWin: this.opts.scoreToWin, countdownMs: this.opts.countdownMs,
    });
    this.sim = sim;
    for (const m of this.members.values()) {
      const p = sim.addPlayer(m.id, m.team, m.bot);
      if (!m.bot && !m.conn) p.active = false;
      if (!m.bot) sim.setViewDelay(m.id, viewDelay(m.ping));
      if (m.bot) m.brain = new BotBrain(sim, m.id, this.bots.difficulty);
      m.snapPending = true;
    }
    this.results = null;
    this.phase = sim.phase === 'countdown' ? 'countdown' : 'playing';
    this.acc = 0;
    this.lastUpdate = now;
    this.eventBuf = [];
    this.roomDirty = true;
    return null;
  }

  // Advances the room to `now`. Runs fixed simulation ticks and sends
  // snapshots at the snapshot rate. Returns false when the room should be
  // deleted.
  update(now: number): boolean {
    // Drop members whose reconnection grace ran out.
    for (const m of [...this.members.values()]) {
      if (!m.bot && !m.conn && m.disconnectedAt > 0 && now - m.disconnectedAt > NET.reconnectGraceMs) this.removeMember(m.id);
    }
    if (this.connectedHumans === 0) {
      if (this.emptySince === 0) this.emptySince = now;
      if (this.humans.length === 0 || now - this.emptySince > NET.emptyRoomTtlMs) return false;
    } else {
      this.emptySince = 0;
    }
    if (this.sim && (this.phase === 'countdown' || this.phase === 'playing')) {
      if (this.lastUpdate < 0) this.lastUpdate = now;
      this.acc += Math.min(250, now - this.lastUpdate);
      this.lastUpdate = now;
      let ticks = 0;
      while (this.acc >= TICK_MS && ticks < 8) {
        const t0 = performanceNow();
        this.tick();
        const t1 = performanceNow();
        this.maxTickMs = Math.max(this.maxTickMs, t1 - t0);
        this.acc -= TICK_MS;
        ticks++;
        if ((this.phase as RoomPhase) === 'results') break;
      }
      if (ticks === 8) this.acc = 0;
    }
    if (this.roomDirty) {
      this.roomDirty = false;
      this.broadcast({ t: 'room', room: this.view() });
    }
    return true;
  }

  /**
   * The practice pause transition. Nothing is simulated: the match clock,
   * bots, projectiles, swings and cooldowns stay exactly where they are.
   * For each connected player:
   *   - inputs sent but not yet simulated are discarded and counted as
   *     acknowledged, so the client drops them instead of replaying them;
   *   - a buffered melee press is dropped (it was intent, not an action);
   *   - walking momentum on the ground goes with the intent that produced
   *     it; a jump arc or a knockback taken in the last PAUSE_KNOCK_KEEP_MS
   *     is left as it is and carries on after Resume.
   * A snapshot goes out at once so the client's prediction matches.
   */
  pauseSync(): Array<{ id: number; ackBefore: number; discarded: number; keptVelocity: boolean }> {
    const out: Array<{ id: number; ackBefore: number; discarded: number; keptVelocity: boolean }> = [];
    const sim = this.sim;
    if (!sim || (this.phase !== 'countdown' && this.phase !== 'playing')) return out;
    for (const m of this.members.values()) {
      if (m.bot || !m.conn) continue;
      const p = sim.players.get(m.id);
      if (!p) continue;
      const ackBefore = p.lastSeq, discarded = p.queue.length;
      if (discarded) { p.lastSeq = p.queue[discarded - 1]!.seq; p.queue.length = 0; }
      p.meleeQueued = false;
      const keptVelocity = !p.alive || !p.body.onGround || sim.timeMs - p.lastHitAt < PAUSE_KNOCK_KEEP_MS;
      if (!keptVelocity) { p.body.vx = 0; p.body.vz = 0; }
      out.push({ id: m.id, ackBefore, discarded, keptVelocity });
    }
    this.sendSnapshots();
    return out;
  }

  private tick(): void {
    const sim = this.sim!;
    for (const m of this.members.values()) {
      if (m.brain) {
        const inp = m.brain.think(sim);
        if (inp) sim.queueInput(m.id, inp);
      }
    }
    sim.step();
    this.totalTicks++;
    this.eventBuf.push(...sim.drainEvents());
    if (this.phase === 'countdown' && sim.phase === 'playing') { this.phase = 'playing'; this.roomDirty = true; }
    this.tickCount++;
    const ended = sim.phase === 'ended';
    if (this.tickCount % SNAP_EVERY === 0 || ended) this.sendSnapshots();
    if (ended) this.finish();
  }

  private finish(): void {
    const sim = this.sim!;
    const rows = [...this.members.values()].map((m) => {
      const s = sim.players.get(m.id)?.stats ?? { kills: 0, deaths: 0, damage: 0, throws: 0, hits: 0 };
      return { id: m.id, name: m.name, team: m.team, bot: m.bot, kills: s.kills, deaths: s.deaths, damage: s.damage, accuracy: s.throws ? s.hits / s.throws : 0 };
    }).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.damage - a.damage);
    this.results = { winner: sim.winner ?? -1, reason: sim.endReason ?? 'time', scores: [sim.scores[0], sim.scores[1]], rows };
    this.phase = 'results';
    for (const m of this.members.values()) if (!m.bot) m.ready = false;
    this.roomDirty = true;
  }

  private sendSnapshots(): void {
    const sim = this.sim!;
    const players: PlayerTuple[] = [];
    for (const p of sim.players.values()) {
      const m = this.members.get(p.id);
      const flags = (p.alive ? 1 : 0) | (p.body.crouched ? 2 : 0) | (p.body.onGround ? 4 : 0) |
        (sim.timeMs < p.protectedUntil ? 8 : 0) | (m?.bot || m?.conn ? 16 : 0);
      players.push([
        p.id, r2(p.body.x), r2(p.body.y), r2(p.body.z), r3(p.yaw), r3(p.pitch), r2(p.body.vx), r2(p.body.vz), flags, p.hp, p.weapon,
        Math.min(9999, Math.round(sim.timeMs - p.lastThrowAt)), Math.min(9999, Math.round(sim.timeMs - p.lastHitAt)),
        Math.min(9999, Math.round(sim.timeMs - p.lastMeleeAt)), p.ruleros,
      ]);
    }
    const ev = this.eventBuf;
    this.eventBuf = [];
    const pk = sim.pickups.map((p) => Math.max(0, Math.round(p.availableAt - sim.timeMs)));
    for (const m of this.members.values()) {
      if (!m.conn) continue;
      const p = sim.players.get(m.id);
      const me: SelfTuple | null = p ? [
        p.body.x, p.body.y, p.body.z, p.body.vx, p.body.vy, p.body.vz,
        (p.alive ? 1 : 0) | (p.body.crouched ? 2 : 0) | (p.body.onGround ? 4 : 0) | (p.meleeQueued ? 8 : 0), p.hp, Math.round(p.cooldownMs), Math.round(p.switchMs), p.weapon,
        p.alive ? 0 : Math.max(0, Math.round(p.respawnAt - sim.timeMs)), Math.max(0, Math.round(p.protectedUntil - sim.timeMs)),
        Math.round(p.meleeMs),
      ] : null;
      const snap: Snapshot = {
        t: 'snap', k: sim.tick, st: Math.round(sim.timeMs), ack: p?.lastSeq ?? 0, ph: this.phase,
        tl: Math.round(sim.timeLeftMs), cd: Math.max(0, Math.round(sim.countdownLeft)), sc: [sim.scores[0], sim.scores[1]],
        me, p: players, ev, pk,
      };
      m.conn.send(snap);
    }
  }
}

function r2(v: number): number { return Math.round(v * 100) / 100; }

// How far behind the server a client draws the other players: the
// interpolation delay plus half its round trip. Melee contact is judged there.
function viewDelay(pingMs: number): number { return NET.interpDelayMs + pingMs / 2; }
function r3(v: number): number { return Math.round(v * 1000) / 1000; }

function performanceNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export { BTN };
