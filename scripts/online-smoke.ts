// Exercises an actual deployed server; creates only private temporary rooms.
// GAME_SERVER_URL=wss://.../ws GAME_SITE_ORIGIN=https://chanclawarfare.fun npm run smoke:online
// Also supports ws://localhost for verification before deploying.
import assert from 'node:assert/strict';
import { NetClient, until } from '../tests/helpers/netclient';
import type { MapId } from '../shared/maps';

const url = process.env.GAME_SERVER_URL;
const origin = process.env.GAME_SITE_ORIGIN;
if (!url || !origin) throw new Error('Set GAME_SERVER_URL and GAME_SITE_ORIGIN explicitly.');
const parsed = new URL(url);
assert(['ws:', 'wss:'].includes(parsed.protocol), 'Expected a WebSocket URL');
assert.equal(new URL(origin).origin, origin, 'Use a site origin without a trailing slash');
const health = new URL('/healthz', url.replace(/^ws/, 'http'));
const response = await fetch(health, { headers: { Origin: origin }, signal: AbortSignal.timeout(15_000) });
assert.equal(response.status, 200, 'health HTTP status');
assert.equal(response.headers.get('access-control-allow-origin'), origin, 'health CORS');
assert.equal((await response.json()).ok, true, 'health body');
console.log('PASS health and production-origin CORS');

async function connect(c: NetClient, resume?: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([
      c.connect({ origin, resume }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('WebSocket handshake timeout')), 15_000); }),
    ]);
    assert(c.id > 0, 'server accepted protocol');
  } finally { clearTimeout(timer!); }
}

for (const map of ['patio', 'plaza', 'fiesta'] as MapId[]) {
  const clients: NetClient[] = [];
  try {
    const cs = Array.from({ length: 4 }, (_, i) => new NetClient(url, `Smoke${i + 1}`));
    clients.push(...cs);
    const host = cs[0]!;
    await connect(host);
    host.send({ t: 'create', map });
    await until(() => !!host.room, 8000, 'create');
    for (const c of cs.slice(1)) {
      await connect(c);
      c.send({ t: 'join', code: host.room!.code });
    }
    await until(() => cs.every(c => c.room?.members.length === 4 && c.room.map === map), 8000, 'four-player map agreement');
    assert.deepEqual(host.room!.members.map(m => m.team).sort(), [0, 0, 1, 1]);
    for (const c of cs.slice(1)) c.send({ t: 'ready', ready: true });
    await until(() => host.room!.members.every(m => m.ready), 8000, 'ready');
    host.send({ t: 'start' });
    await until(() => cs.every(c => c.snap?.ph === 'playing' && c.snap.p.length === 4), 15_000, 'four synchronized players');
    host.startInputs();
    await until(() => (host.snap?.ack ?? 0) > 5, 8000, 'authoritative input acknowledgments');
    host.stopInputs();
    const guest = cs[3]!;
    const id = guest.id;
    guest.kill();
    await until(() => host.room!.members.find(m => m.id === id)?.connected === false, 8000, 'disconnect');
    const resumed = new NetClient(url, 'Smoke4');
    clients.push(resumed);
    await connect(resumed, guest.resume);
    assert.equal(resumed.id, id, 'reconnect identity');
    await until(() => resumed.snap?.ph === 'playing' && !!resumed.snap.me, 8000, 'reconnect snapshots');
    host.send({ t: 'leave' });
    await until(() => resumed.room?.owner !== host.id && resumed.room?.phase === 'playing', 8000, 'owner migration');
    assert(clients.every(c => c.errors.length === 0), 'no protocol errors');
    console.log(`PASS ${map}: 2v2, snapshots, inputs, reconnect, owner migration`);
  } finally {
    for (const c of clients) if (c.ws) c.send({ t: 'leave' });
    await new Promise(resolve => setTimeout(resolve, 200));
    for (const c of clients) if (c.ws) c.kill();
  }
}
console.log('PASS online smoke (protocol clients; not browser or device verification)');
