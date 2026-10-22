// Integration tests against the real server process over real WebSockets.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { NetClient, startServer, until, walkThenFight } from './helpers/netclient';

const PORT = 18700 + Math.floor(Math.random() * 500);
const URL_ = `ws://127.0.0.1:${PORT}/ws`;
let server: ChildProcess;
const clients: NetClient[] = [];

function client(name: string): NetClient {
  const c = new NetClient(URL_, name);
  clients.push(c);
  return c;
}

async function lobby(n: number): Promise<NetClient[]> {
  const cs = Array.from({ length: n }, (_, i) => client(`P${i + 1}`));
  await cs[0]!.connect();
  cs[0]!.send({ t: 'create' });
  await until(() => !!cs[0]!.room, 4000, 'room');
  for (const c of cs.slice(1)) {
    await c.connect();
    c.send({ t: 'join', code: cs[0]!.room!.code });
  }
  await until(() => cs.every((c) => c.room?.members.length === n), 4000, 'everyone in the room');
  return cs;
}

async function startMatch(cs: NetClient[]): Promise<void> {
  for (const c of cs.slice(1)) c.send({ t: 'ready', ready: true });
  await until(() => cs[0]!.room!.members.every((m) => m.ready), 4000, 'ready');
  cs[0]!.send({ t: 'start' });
  await until(() => cs.every((c) => c.room?.phase === 'playing'), 6000, 'playing');
}

beforeAll(async () => {
  server = await startServer(PORT, { MATCH_COUNTDOWN_MS: '300' });
}, 20000);

afterAll(() => {
  for (const c of clients) { try { c.kill(); } catch { /* closed */ } }
  server?.kill('SIGTERM');
});

describe('game server', () => {
  it('the host picks the map; everyone in the room sees it, and only the host can change it', async () => {
    const host = client('Host');
    await host.connect();
    host.send({ t: 'create', map: 'fiesta' });
    await until(() => !!host.room, 4000, 'room');
    expect(host.room!.map).toBe('fiesta');
    const guest = client('Guest');
    await guest.connect();
    guest.send({ t: 'join', code: host.room!.code });
    await until(() => guest.room?.map === 'fiesta', 4000, 'guest sees the host\'s map');
    guest.send({ t: 'map', map: 'patio' });
    await until(() => guest.errors.includes('not_owner'), 4000, 'guest refused');
    host.send({ t: 'map', map: 'plaza' });
    await until(() => guest.room?.map === 'plaza' && host.room?.map === 'plaza', 4000, 'both see the new map');
    guest.send({ t: 'ready', ready: true });
    await until(() => host.room!.members.every((m) => m.ready), 4000, 'ready');
    host.send({ t: 'start' });
    await until(() => guest.room?.phase === 'playing' || guest.room?.phase === 'countdown', 6000, 'match on the chosen map');
    expect(guest.room!.map).toBe('plaza');
    host.send({ t: 'leave' }); guest.send({ t: 'leave' });
  }, 20000);

  it('serves health and readiness', async () => {
    const h = await (await fetch(`http://127.0.0.1:${PORT}/healthz`)).json();
    expect(h.ok).toBe(true);
    expect((await fetch(`http://127.0.0.1:${PORT}/readyz`)).status).toBe(200);
  });

  it('rejects a disallowed origin, a protocol mismatch and garbage', async () => {
    const bad = client('X');
    await expect(bad.connect({ origin: 'https://evil.example' })).rejects.toBeTruthy();
    const old = client('Old');
    await old.connect({ version: 1 });
    expect(old.errors).toContain('version');
    await until(() => old.closed, 2000, 'close after version error');
    const g = client('G');
    await g.connect();
    g.send({ t: 'score', team: 0, points: 999 });
    g.send({ t: 'i', d: [[1, 99, 0, 0, 0, 0, 0]] });
    await until(() => g.errors.filter((e) => e === 'bad_message').length >= 2, 2000, 'bad_message');
  });

  it('rejects oversized messages by closing the socket', async () => {
    const c = client('Big');
    await c.connect();
    c.ws.send('x'.repeat(10_000));
    await until(() => c.closed, 3000, 'closed');
    expect(c.closeCode).toBe(1009);
  });

  it('create, join by code, invalid code and full room', async () => {
    const cs = await lobby(4);
    expect(new Set(cs.map((c) => c.id)).size).toBe(4);
    const lost = client('Lost');
    await lost.connect();
    lost.send({ t: 'join', code: 'ZZZZ2222' });
    await until(() => lost.errors.includes('room_not_found'), 2000, 'not found');
    const fifth = client('Fifth');
    await fifth.connect();
    fifth.send({ t: 'join', code: cs[0]!.room!.code });
    await until(() => fifth.errors.includes('room_full'), 2000, 'full');
    for (const c of cs) c.close();
  });

  it('only the owner starts, and only when everyone else is ready', async () => {
    const [a, b] = await lobby(2);
    b!.send({ t: 'start' });
    await until(() => b!.errors.includes('not_owner'), 2000, 'not_owner');
    a!.send({ t: 'start' });
    await until(() => a!.errors.includes('not_ready'), 2000, 'not_ready');
    await startMatch([a!, b!]);
    a!.close(); b!.close();
  });

  it('two clients see each other move, agree on hits and scores, and cannot award themselves points', async () => {
    const [a, b] = await lobby(2);
    await startMatch([a!, b!]);
    a!.steer = walkThenFight({ x: -6, z: 3.5 });
    b!.steer = walkThenFight({ x: 6.5, z: 2.5 });
    a!.startInputs(); b!.startInputs();
    // B sees A move.
    const a0 = b!.player(a!.id)!;
    await until(() => { const p = b!.player(a!.id); return !!p && Math.hypot(p[1] - a0[1], p[3] - a0[3]) > 3; }, 8000, 'B sees A move');
    // Wait for a hit, then compare health as seen by both clients.
    await until(() => a!.events.some((e) => e.k === 'hit') || b!.events.some((e) => e.k === 'hit'), 20000, 'a hit');
    await new Promise((r) => setTimeout(r, 200));
    const hpA = a!.player(b!.id)![9], hpB = b!.snap!.me![7];
    expect(Math.abs(hpA - hpB)).toBeLessThanOrEqual(0); // same tick ordering: identical after one snapshot
    // Fight until someone scores; both clients must agree.
    await until(() => (a!.snap!.sc[0] + a!.snap!.sc[1]) > 0, 30000, 'an elimination');
    await new Promise((r) => setTimeout(r, 150));
    expect(a!.snap!.sc).toEqual(b!.snap!.sc);
    // Forged score messages are rejected and change nothing.
    const before = [...a!.snap!.sc];
    a!.send({ t: 'elim', v: b!.id });
    a!.send({ t: 'room', room: { phase: 'results' } });
    await new Promise((r) => setTimeout(r, 300));
    expect(a!.errors).toContain('bad_message');
    expect(a!.snap!.sc[0]).toBeGreaterThanOrEqual(before[0]!);
    expect(a!.snap!.sc[0] - before[0]! + a!.snap!.sc[1] - before[1]!).toBeLessThanOrEqual(2);
    a!.close(); b!.close();
  }, 60000);

  it('a dropped player is held, shown as disconnected, and rejoins with the same identity', async () => {
    const [a, b] = await lobby(2);
    await startMatch([a!, b!]);
    const id = b!.id, token = b!.resume;
    b!.kill();
    await until(() => a!.room!.members.find((m) => m.id === id)?.connected === false, 4000, 'shown disconnected');
    const b2 = client('P2-again');
    await b2.connect({ resume: token });
    expect(b2.id).toBe(id);
    await until(() => a!.room!.members.find((m) => m.id === id)?.connected === true, 4000, 'shown reconnected');
    await until(() => !!b2.snap?.me, 4000, 'snapshots resume');
    // A duplicate connection with the same token replaces the old one.
    const b3 = client('P2-dup');
    await b3.connect({ resume: token });
    await until(() => b2.closed, 3000, 'old socket replaced');
    expect(b3.id).toBe(id);
    a!.close(); b3.close();
  }, 20000);

  it('the match survives the owner leaving: ownership moves to the next player', async () => {
    const [a, b, c] = await lobby(3);
    await startMatch([a!, b!, c!]);
    const ownerBefore = b!.room!.owner;
    expect(ownerBefore).toBe(a!.id);
    a!.send({ t: 'leave' });
    await until(() => b!.room!.owner !== ownerBefore, 4000, 'owner transfer');
    expect([b!.id, c!.id]).toContain(b!.room!.owner);
    const snaps = b!.snaps;
    await until(() => b!.snaps > snaps + 5, 3000, 'match keeps running');
    expect(b!.room!.phase).toBe('playing');
    b!.close(); c!.close(); a!.close();
  }, 20000);
});
