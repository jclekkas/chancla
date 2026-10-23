// Close combat between real client sessions (prediction, reconciliation,
// interpolation, event handling) and the real server process, through
// simulated latency. A walks up to B along the bots' navigation graph and
// lands El Revés to the face until B is eliminated; C watches through a
// second, slower link. Checks that every client agrees on each hit, the
// damage, the head hits, the ruleros that came off, the elimination and the
// score; that a resent snapshot (every one, twice, to C) and C's reconnect
// never replay an outcome; and that respawn restores the hairstyle everywhere.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WS from 'ws';
import type { ChildProcess } from 'node:child_process';
import { ORIGIN, startServer, until } from './helpers/netclient';
import { LatencyProxy } from './helpers/latency-proxy';
import { GameSession, wsTransport, type LocalInput, type Transport } from '../src/net/session';
import { MELEE, NET } from '../shared/config';
import { mapData } from '../shared/maps';
import { World } from '../shared/physics';
import { buildNavGraph, findPath, nearestNode } from '../shared/navgraph';
import type { SimEvent } from '../shared/sim';

const PORT = 19600 + Math.floor(Math.random() * 300);
const PROXY_AB = PORT + 1000, PROXY_C = PORT + 1100;
let server: ChildProcess;
let proxyAB: LatencyProxy, proxyC: LatencyProxy;

class OriginWS extends WS {
  constructor(url: string) { super(url, { origin: ORIGIN }); }
}

beforeAll(async () => {
  server = await startServer(PORT, { MATCH_COUNTDOWN_MS: '300', MATCH_DURATION_MS: '240000', MATCH_SCORE_TO_WIN: '50' });
  proxyAB = new LatencyProxy(PROXY_AB, `ws://127.0.0.1:${PORT}/ws`, 60, 15);
  proxyC = new LatencyProxy(PROXY_C, `ws://127.0.0.1:${PORT}/ws`, 90, 25);
}, 20000);

afterAll(() => { proxyAB?.close(); proxyC?.close(); server?.kill('SIGTERM'); });

type Seen = { hits: Map<number, Extract<SimEvent, { k: 'hit' }>>; elims: Map<number, Extract<SimEvent, { k: 'elim' }>>; handled: number };

function session(port: number, seen: Seen, duplicateSnapshots = false): GameSession {
  const base = wsTransport(`ws://127.0.0.1:${port}/ws`, OriginWS as unknown as { new (url: string): WebSocket });
  // Optionally hand every snapshot to the client twice, as a resend would.
  const factory = duplicateSnapshots ? (): Transport => {
    const t = base();
    const wrapped: Transport = { ...t, send: (m) => t.send(m), close: () => t.close(), onMessage: null, onClose: null, onOpen: null };
    t.onOpen = () => wrapped.onOpen?.();
    t.onClose = (c) => wrapped.onClose?.(c);
    t.onMessage = (m) => { wrapped.onMessage?.(m); if (m.t === 'snap' && (m.ev as unknown[]).length) wrapped.onMessage?.(m); };
    return wrapped;
  } : base;
  return new GameSession(factory, {
    event: (e) => {
      seen.handled++;
      if (e.k === 'hit' && e.m !== undefined) {
        if (seen.hits.has(e.m)) throw new Error(`melee hit ${e.m} handled twice`);
        seen.hits.set(e.m, e);
      }
      if (e.k === 'elim' && e.m !== undefined) {
        if (seen.elims.has(e.m)) throw new Error(`melee elimination ${e.m} handled twice`);
        seen.elims.set(e.m, e);
      }
    },
  });
}

const newSeen = (): Seen => ({ hits: new Map(), elims: new Map(), handled: 0 });

describe('multiplayer close combat', () => {
  it('every client agrees on melee hits, ruleros and eliminations, through latency, resends and a reconnect', async () => {
    const sa = newSeen(), sb = newSeen(), sc = newSeen();
    const a = session(PROXY_AB, sa), b = session(PROXY_AB, sb), c = session(PROXY_C, sc, true);
    a.connect('Alpha'); b.connect('Bravo'); c.connect('Charlie');
    await until(() => [a, b, c].every((s) => s.state === 'online'), 5000, 'online');
    a.send({ t: 'create', map: 'patio' });
    await until(() => !!a.room, 5000, 'room');
    b.send({ t: 'join', code: a.room!.code });
    c.send({ t: 'join', code: a.room!.code });
    await until(() => a.room!.members.length === 3 && !!b.room && !!c.room, 5000, 'joined');
    // A and B on opposite teams; C watches from A's team.
    if (a.team === b.team) b.send({ t: 'team', team: a.team === 0 ? 1 : 0 });
    await until(() => a.room!.members.find((m) => m.id === b.id)?.team !== a.room!.members.find((m) => m.id === a.id)?.team, 5000, 'teams');
    b.send({ t: 'ready', ready: true }); c.send({ t: 'ready', ready: true });
    await until(() => a.room!.members.every((m) => m.ready), 5000, 'ready');
    a.send({ t: 'start' });
    await until(() => [a, b, c].every((s) => s.phase === 'playing'), 8000, 'playing');

    const map = mapData('patio');
    const world = new World(map.boxes);
    const graph = buildNavGraph(map, world);
    let path: number[] = [];
    let replanAt = 0;
    let stuckAt = { x: 0, z: 0 };
    let bPath: number[] = [];
    let bParked = false;
    let t = 0;
    let swingsA = 0;
    let lastPress = -1e9;
    const idle: LocalInput = { mx: 0, mz: 0, yaw: 0, pitch: 0, fire: false, jump: false, crouch: false, weapon: 1 };
    let acc = 0, last = performance.now();
    const step = () => {
      t++;
      // A: walk to where B is drawn on A's screen, then El Revés to the face.
      const r = a.remotes.get(b.id);
      let inp: LocalInput = { ...idle, yaw: a.yaw };
      if (r && r.alive && a.alive && bParked) {
        const dx = r.x - a.body.x, dz = r.z - a.body.z, d = Math.hypot(dx, dz);
        let tx = r.x, tz = r.z;
        if (d > 3) {
          // B stands still, so one plan does (made again only if it runs out).
          if (!path.length && t >= replanAt) {
            path = findPath(graph, nearestNode(graph, world, a.body), nearestNode(graph, world, { x: r.x, y: r.y, z: r.z }));
            replanAt = t + 30;
          }
          // Next node, skipping one that is reached or that she cannot get closer to (as the bots do).
          if (t % 60 === 0) { if (Math.hypot(a.body.x - stuckAt.x, a.body.z - stuckAt.z) < 0.3) path.shift(); stuckAt = { x: a.body.x, z: a.body.z }; }
          const n = path[0] !== undefined ? graph.nodes[path[0]] : undefined;
          if (n) { if (Math.hypot(n.x - a.body.x, n.z - a.body.z) < 1.2) path.shift(); else { tx = n.x; tz = n.z; } }
        }
        const yaw = Math.atan2(-(tx - a.body.x), -(tz - a.body.z));
        const eyeY = a.body.y + 1.58, headY = r.y + 1.52;
        const pitch = Math.atan2(headY - eyeY, Math.max(0.6, d - 0.25));
        const inReach = d < 1.35;
        const press = inReach && a.meleeMs <= 0 && a.switchMs <= 0 && t - lastPress > 10;
        if (press) { lastPress = t; swingsA++; }
        inp = { ...idle, yaw, pitch: inReach ? pitch : 0, mz: d > 1.1 ? 1 : 0, melee: press };
      }
      a.tick(inp);
      // B walks out to the open plaza, then stands still; C stays home.
      if (!bParked) {
        if (!bPath.length) bPath = findPath(graph, nearestNode(graph, world, b.body), nearestNode(graph, world, { x: 7, y: 0, z: 4 }));
        const n = bPath[0] !== undefined ? graph.nodes[bPath[0]] : undefined;
        if (n && Math.hypot(n.x - b.body.x, n.z - b.body.z) < 1.0) bPath.shift();
        if (!bPath.length) bParked = true;
        b.tick({ ...idle, yaw: n ? Math.atan2(-(n.x - b.body.x), -(n.z - b.body.z)) : b.yaw, mz: n ? 1 : 0, weapon: 0 });
      } else b.tick({ ...idle, yaw: b.yaw, weapon: 0 });
      c.tick({ ...idle, yaw: c.yaw, weapon: 0 });
      for (const s of [a, b, c]) { s.flush(); s.updateRemotes(); }
    };
    const tick = setInterval(() => {
      const now = performance.now();
      acc += now - last; last = now;
      let n = 0;
      while (acc >= 1000 / NET.tickRate && n++ < 6) { acc -= 1000 / NET.tickRate; step(); }
    }, 4);

    try {
      // Hit B until the first elimination by El Revés to the face.
      const diag = setInterval(() => { const r = a.remotes.get(b.id); if (process.env.MELEE_DEBUG) console.log(JSON.stringify({ t, a: [a.body.x.toFixed(1), a.body.z.toFixed(1)], b: r && [r.x.toFixed(1), r.z.toFixed(1), r.alive, r.hp, r.protected], swingsA, hits: sa.hits.size, meleeMs: a.meleeMs, w: a.weapon, path: path.length })); }, 2000);
      try { await until(() => sa.elims.size >= 1, 60000, 'A eliminates B with El Revés'); } finally { clearInterval(diag); }
      const elim = [...sa.elims.values()][0]!;
      expect(elim.w).toBe(1);
      expect(elim.head).toBe(true);
      // Everyone saw the same hits, once each: same damage, head, ruleros.
      await until(() => sb.elims.size >= 1 && sc.elims.size >= 1, 5000, 'all saw it');
      const pick = (s: Seen) => [...s.hits.values()].filter((h) => h.v === b.id).map((h) => [h.m, h.d, h.head, (h.ru ?? []).join(',')]).sort();
      expect(pick(sb)).toEqual(pick(sa));
      expect(pick(sc)).toEqual(pick(sa));
      expect([...sb.elims.keys()]).toEqual([...sa.elims.keys()]);
      expect([...sc.elims.keys()]).toEqual([...sa.elims.keys()]);
      const hitsOnB = [...sa.hits.values()].filter((h) => h.v === b.id);
      expect(hitsOnB.every((h) => h.d === MELEE[1]!.damage && h.head)).toBe(true);
      expect(hitsOnB.length).toBe(3); // 45 + 45 + 45 > 100
      // Each roller came off once: one per head hit, the rest scattered at the end.
      const gone = [...hitsOnB.flatMap((h) => h.ru ?? []), ...(elim.ru ?? [])];
      expect(new Set(gone).size).toBe(gone.length);
      expect(gone.length).toBe(4);
      // The duplicated snapshots to C were dropped before any handler.
      expect(c.duplicatesDropped).toBeGreaterThan(0);
      // What every client shows of B's hair: none left while she is down.
      await until(() => a.remotes.get(b.id)?.ruleros === 0 && c.remotes.get(b.id)?.ruleros === 0, 3000, 'hair agrees');

      // C drops and comes back: no outcome is replayed, and C shows the same state.
      const handledBefore = sc.handled;
      const hitsBefore = sc.hits.size;
      proxyC.interrupt();
      await until(() => c.state === 'reconnecting', 4000, 'C noticed the drop');
      await until(() => c.state === 'online' && !!c.snap, 15000, 'C reconnected');
      await new Promise((r) => setTimeout(r, 800));
      expect(sc.hits.size).toBe(hitsBefore);
      expect(sc.handled).toBeGreaterThanOrEqual(handledBefore);
      expect(c.snap!.sc).toEqual(a.snap!.sc);

      // B respawns with a full head of rollers, on every screen.
      await until(() => !!a.remotes.get(b.id)?.alive && a.remotes.get(b.id)?.ruleros === 15 && c.remotes.get(b.id)?.ruleros === 15, 8000, 'respawn restores');
      expect(a.snap!.sc).toEqual(b.snap!.sc);
      expect(swingsA).toBeGreaterThanOrEqual(3);
    } finally {
      clearInterval(tick);
      for (const s of [a, b, c]) s.close();
    }
  }, 120000);
});
