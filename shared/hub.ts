// The room registry and connection protocol: hello, create, join, resume.
// Used by the WebSocket server and by the in-browser practice host.

import { NET, PROTOCOL_VERSION } from './config';
import { Room, type Conn } from './room';
import { parseClientMsg, randomCode, randomToken, sanitizeName, isValidCode, type ClientMsg, type ErrorCode } from './protocol';
import { MATCH } from './config';

export interface Session {
  id: number;
  conn: Conn;
  name: string;
  resume: string;
  room: Room | null;
  helloDone: boolean;
}

export interface HubOptions {
  allowPractice: boolean;
  maxRooms?: number;
  now(): number;
  log?(event: string, data?: Record<string, unknown>): void;
  roomOptions?: ConstructorParameters<typeof Room>[2];
}

let nextPlayerId = 1;

export class Hub {
  readonly rooms = new Map<string, Room>();
  private byResume = new Map<string, { room: Room; id: number }>();
  private opts: HubOptions;

  constructor(opts: HubOptions) {
    this.opts = opts;
  }

  open(conn: Conn): Session {
    return { id: nextPlayerId++, conn, name: '', resume: '', room: null, helloDone: false };
  }

  private err(s: Session, code: ErrorCode, fatal = false): void {
    s.conn.send({ t: 'error', code, fatal });
  }

  // Raw message entry point. `raw` is already JSON-parsed.
  message(s: Session, raw: unknown): void {
    const msg = parseClientMsg(raw);
    if (!msg) { this.err(s, 'bad_message'); return; }
    this.handle(s, msg);
  }

  handle(s: Session, msg: ClientMsg): void {
    const now = this.opts.now();
    if (!s.helloDone) {
      if (msg.t !== 'hello') { this.err(s, 'bad_message', true); s.conn.close(4000, 'hello first'); return; }
      if (msg.v !== PROTOCOL_VERSION) { this.err(s, 'version', true); s.conn.close(4002, 'version'); return; }
      s.helloDone = true;
      s.name = sanitizeName(msg.name, `Rosa ${100 + (s.id % 900)}`);
      // Reconnection: take over the held slot.
      const held = msg.resume ? this.byResume.get(msg.resume) : undefined;
      if (held && this.rooms.get(held.room.code) === held.room && held.room.members.has(held.id)) {
        s.id = held.id;
        s.resume = msg.resume!;
        s.room = held.room;
        const m = held.room.members.get(held.id)!;
        m.name = s.name;
        held.room.reconnect(held.id, s.conn);
        s.conn.send({ t: 'welcome', v: PROTOCOL_VERSION, id: s.id, resume: s.resume, rejoined: true });
        this.opts.log?.('rejoin', { room: roomTag(held.room) });
        return;
      }
      s.resume = randomToken(24);
      s.conn.send({ t: 'welcome', v: PROTOCOL_VERSION, id: s.id, resume: s.resume, rejoined: false });
      return;
    }
    switch (msg.t) {
      case 'hello':
        this.err(s, 'bad_message');
        return;
      case 'ping':
        s.conn.send({ t: 'pong', c: msg.c, s: Math.round(now) });
        return;
      case 'create': {
        if (s.room) this.leave(s);
        if (msg.practice && !this.opts.allowPractice) { this.err(s, 'bad_message'); return; }
        if (this.rooms.size >= (this.opts.maxRooms ?? NET.maxRooms)) { this.err(s, 'server_full'); return; }
        let code = randomCode();
        while (this.rooms.has(code)) code = randomCode();
        const room = new Room(code, now, { ...this.opts.roomOptions, practice: !!msg.practice });
        this.rooms.set(code, room);
        this.attach(s, room, now);
        if (msg.practice) {
          room.bots = { enabled: false, difficulty: msg.practice.difficulty };
          const me = room.members.get(s.id)!;
          me.team = 0;
          for (let i = 0; i < msg.practice.allies; i++) room.addBot(0);
          for (let i = 0; i < msg.practice.enemies; i++) room.addBot(1);
        }
        this.opts.log?.('create', { room: roomTag(room), practice: !!msg.practice, rooms: this.rooms.size });
        return;
      }
      case 'join': {
        if (!isValidCode(msg.code)) { this.err(s, 'room_not_found'); return; }
        const room = this.rooms.get(msg.code);
        if (!room || room.practice) { this.err(s, 'room_not_found'); return; }
        if (s.room === room) return;
        if (room.isFull) { this.err(s, 'room_full'); return; }
        if (s.room) this.leave(s);
        this.attach(s, room, now);
        this.opts.log?.('join', { room: roomTag(room), players: room.humans.length });
        return;
      }
      case 'leave':
        this.leave(s);
        s.conn.send({ t: 'left' });
        return;
      default: {
        if (!s.room) { this.err(s, 'no_room'); return; }
        const e = s.room.handle(s.id, msg, now);
        if (e) this.err(s, e as ErrorCode);
      }
    }
  }

  private attach(s: Session, room: Room, now: number): void {
    const m = room.addHuman(s.id, s.name, s.resume, s.conn, now);
    if (!m) { this.err(s, 'room_full'); return; }
    s.room = room;
    this.byResume.set(s.resume, { room, id: s.id });
  }

  leave(s: Session): void {
    const room = s.room;
    if (!room) return;
    room.removeMember(s.id);
    this.byResume.delete(s.resume);
    s.room = null;
  }

  // The transport closed. The slot is held for the grace period.
  closed(s: Session): void {
    const room = s.room;
    if (!room) return;
    const m = room.members.get(s.id);
    if (m && m.conn === s.conn) room.disconnect(s.id, this.opts.now());
  }

  update(): void {
    const now = this.opts.now();
    for (const [code, room] of this.rooms) {
      if (!room.update(now)) {
        this.rooms.delete(code);
        for (const [k, v] of this.byResume) if (v.room === room) this.byResume.delete(k);
        this.opts.log?.('expire', { room: roomTag(room), rooms: this.rooms.size });
      }
    }
    // Forget resume tokens whose member is gone.
    for (const [k, v] of this.byResume) if (!v.room.members.has(v.id)) this.byResume.delete(k);
  }

  shutdown(): void {
    for (const room of this.rooms.values()) {
      for (const m of room.members.values()) {
        m.conn?.send({ t: 'bye', reason: 'shutdown' });
        m.conn?.close(1012, 'restart');
      }
    }
    this.rooms.clear();
    this.byResume.clear();
  }

  stats(): { rooms: number; players: number; maxTickMs: number } {
    let players = 0, maxTickMs = 0;
    for (const r of this.rooms.values()) { players += r.connectedHumans; maxTickMs = Math.max(maxTickMs, r.maxTickMs); }
    return { rooms: this.rooms.size, players, maxTickMs };
  }
}

// Logs never contain room codes (they are access tokens): only a short hash.
export function roomTag(room: Room): string {
  let h = 2166136261;
  for (const ch of room.code) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16).slice(0, 6);
}

export { MATCH };
