// The connection-attempt timeout must not create its own problems: no two
// live sockets at once, no stale callbacks from an abandoned attempt, the
// same player identity after a reconnect, no room created by a late reply,
// and correct behaviour on both sides of the reconnect grace boundary.
// Fake transports and fake timers: every event is placed exactly.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameSession, CONNECT_TIMEOUT_MS, type Transport } from '../src/net/session';
import { NET } from '../shared/config';
import type { ClientMsg, ServerMsg } from '../shared/protocol';

interface FakeT extends Transport { sent: ClientMsg[]; closed: boolean; n: number }

function rig() {
  const ts: FakeT[] = [];
  const states: string[] = [];
  const factory = () => {
    const t: FakeT = {
      n: ts.length + 1, sent: [], closed: false, onOpen: null, onMessage: null, onClose: null,
      send(m) {
        if (this.closed) return;
        this.sent.push(m);
        if (m.t === 'ping') this.onMessage?.({ t: 'pong', c: m.c } as ServerMsg); // a live server answers pings
      },
      close() { this.closed = true; },
    };
    ts.push(t);
    return t;
  };
  const s = new GameSession(factory, { state: (st, d) => states.push(d ? `${st}:${d}` : st) }, () => Date.now());
  const live = () => ts.filter((t) => !t.closed);
  const welcome = (t: FakeT, rejoined: boolean, id = 7) => t.onMessage?.({ t: 'welcome', v: 1, id, resume: 'tok-7', rejoined } as ServerMsg);
  const room = (t: FakeT) => t.onMessage?.({ t: 'room', room: { code: 'ABCDEFGH', phase: 'playing', map: 'patio', owner: 7, practice: false, members: [{ id: 7, name: 'Rosa', team: 1, ready: true, connected: true, bot: false }], bots: { enabled: false, difficulty: 'normal' } } } as unknown as ServerMsg);
  return { s, ts, states, live, welcome, room };
}

/** Puts a session into a room, as after a successful create. */
function inRoom(r: ReturnType<typeof rig>) {
  r.s.connect('Rosa');
  const t1 = r.ts[0]!;
  t1.onOpen?.();
  r.welcome(t1, false);
  r.s.send({ t: 'create' });
  r.room(t1);
  return t1;
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
afterEach(() => { vi.useRealTimers(); });

describe('connection attempt timeout', () => {
  it('a slow but successful welcome (just under the timeout) connects once, with no second socket', () => {
    const r = rig();
    r.s.connect('Rosa');
    r.s.send({ t: 'create' });
    r.ts[0]!.onOpen?.();
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS - 100);
    r.welcome(r.ts[0]!, false);
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS * 2);
    expect(r.s.state).toBe('online');
    expect(r.ts).toHaveLength(1);
    expect(r.ts[0]!.sent.filter((m) => m.t === 'create')).toHaveLength(1);
    r.s.close();
  });

  it('a first connection that never answers ends "unreachable"; a late reply on it is ignored and creates no room', () => {
    const r = rig();
    r.s.connect('Rosa');
    r.s.send({ t: 'create' });
    const t1 = r.ts[0]!;
    const lateOnMessage = t1.onMessage; // what a late reply would still have reached without the fix
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS + 10);
    expect(r.s.state).toBe('lost');
    expect(r.states.at(-1)).toBe('lost:unreachable');
    expect(t1.closed).toBe(true);
    expect(t1.onMessage).toBeNull(); // stale callbacks detached
    expect(t1.sent.some((m) => m.t === 'create')).toBe(false); // nothing was ever sent that could make a room
    expect(lateOnMessage).toBeTypeOf('function');
    vi.advanceTimersByTime(60_000);
    expect(r.ts).toHaveLength(1); // no retries for a first connection: the player decides
  });

  it('a hung reconnect attempt is dropped, the next attempt rejoins with the same identity, and at most one socket is ever live', () => {
    const r = rig();
    const t1 = inRoom(r);
    let maxLive = 1;
    const tick = (ms: number) => { for (let i = 0; i < ms; i += 50) { vi.advanceTimersByTime(50); maxLive = Math.max(maxLive, r.live().length); } };
    t1.closed = true; t1.onClose?.(1006); // network drop
    expect(r.s.state).toBe('reconnecting');
    tick(500); // backoff 400 ms, then attempt 2
    const t2 = r.ts[1]!;
    expect(t2).toBeDefined();
    tick(CONNECT_TIMEOUT_MS + 100); // attempt 2 hangs and is dropped
    expect(t2.closed).toBe(true);
    expect(t2.onMessage).toBeNull();
    tick(1000); // backoff 800 ms, then attempt 3
    const t3 = r.ts[2]!;
    expect(t3).toBeDefined();
    t3.onOpen?.();
    expect(t3.sent[0]).toMatchObject({ t: 'hello', resume: 'tok-7' }); // the same identity is presented
    r.welcome(t3, true);
    r.room(t3);
    expect(r.s.state).toBe('online');
    expect(r.s.id).toBe(7);
    expect(r.s.team).toBe(1);
    expect(maxLive).toBe(1);
    expect(r.ts.flatMap((t) => t.sent).filter((m) => m.t === 'create')).toHaveLength(1); // only the original create
    tick(20_000);
    expect(r.ts).toHaveLength(3); // no more attempts once back
    r.s.close();
  });

  it('near the grace boundary: a reply just before the client deadline still gets back in', () => {
    const r = rig();
    const t1 = inRoom(r);
    t1.closed = true; t1.onClose?.(1006);
    const start = Date.now();
    const deadline = start + NET.reconnectGraceMs - 2000;
    // Every attempt hangs; the first one open within 3 s of the deadline answers.
    while (!(Date.now() >= deadline - 3000 && r.live().length === 1)) vi.advanceTimersByTime(100);
    expect(Date.now()).toBeLessThan(deadline);
    const t = r.live()[0]!;
    t.onOpen?.();
    r.welcome(t, true);
    r.room(t);
    expect(r.s.state).toBe('online');
    expect(r.s.id).toBe(7);
    r.s.close();
  });

  it('past the grace boundary: the player is told the connection was lost, and nothing keeps retrying', () => {
    const r = rig();
    const t1 = inRoom(r);
    t1.closed = true; t1.onClose?.(1006);
    vi.advanceTimersByTime(NET.reconnectGraceMs + CONNECT_TIMEOUT_MS + 5000);
    expect(r.s.state).toBe('lost');
    expect(r.states.at(-1)).toBe('lost:timeout');
    const n = r.ts.length;
    expect(r.live()).toHaveLength(0);
    vi.advanceTimersByTime(60_000);
    expect(r.ts.length).toBe(n);
  });

  it('a server that says the room is gone after a reconnect is reported, not silently rejoined elsewhere', () => {
    const r = rig();
    const t1 = inRoom(r);
    t1.closed = true; t1.onClose?.(1006);
    vi.advanceTimersByTime(500);
    const t2 = r.ts[1]!;
    t2.onOpen?.();
    r.welcome(t2, false, 9);
    expect(r.states.at(-1)).toBe('lost:room_gone');
    expect(t2.sent.some((m) => m.t === 'create' || m.t === 'join')).toBe(false);
  });

  it('"network is back" (retryNow) replaces a hung attempt at once, detaching it, with one live socket', () => {
    const r = rig();
    const t1 = inRoom(r);
    t1.closed = true; t1.onClose?.(1006);
    vi.advanceTimersByTime(1000); // attempt 2 started and is hanging
    const t2 = r.ts[1]!;
    r.s.retryNow();
    expect(t2.closed).toBe(true);
    expect(t2.onMessage).toBeNull();
    const t3 = r.ts[2]!;
    expect(r.live()).toEqual([t3]);
    t3.onOpen?.();
    r.welcome(t3, true);
    expect(r.s.state).toBe('online');
    r.s.retryNow(); // when online it does nothing
    expect(r.ts).toHaveLength(3);
    r.s.close();
  });

  it('retryNow does nothing for a session that is not reconnecting, or after the deadline', () => {
    const r = rig();
    r.s.retryNow();
    expect(r.ts).toHaveLength(0);
    const t1 = inRoom(r);
    t1.closed = true; t1.onClose?.(1006);
    vi.advanceTimersByTime(NET.reconnectGraceMs + 10_000);
    const n = r.ts.length;
    r.s.retryNow();
    expect(r.ts).toHaveLength(n);
  });

  it('closing the session during an attempt leaves no timer behind', () => {
    const r = rig();
    r.s.connect('Rosa');
    r.s.close();
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS * 3);
    expect(r.states.at(-1)).toBe('closed');
    expect(r.ts).toHaveLength(1);
  });
});
