// ¡Puro Chanclazo! online, between real client sessions and the real server
// process through simulated latency. The host creates a melee-only room; the
// others join by code and take the host's rules (they never send their own).
// A fights with the primary button only: El Revés to the face until B is out.
// C, a forged client, sends throw inputs past its session the whole time: the
// server never launches one. Every client agrees on the rules, hits, damage,
// elimination and score. The owner's rule change between matches reaches
// everyone; a rematch keeps the rules; a reconnect and a late join by code
// get them from the room.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WS from 'ws';
import type { ChildProcess } from 'node:child_process';
import { ORIGIN, startServer, until } from './helpers/netclient';
import { LatencyProxy } from './helpers/latency-proxy';
import { GameSession, wsTransport, type LocalInput } from '../src/net/session';
import { MELEE, NET } from '../shared/config';
import { mapData } from '../shared/maps';
import { World } from '../shared/physics';
import { buildNavGraph, findPath, nearestNode } from '../shared/navgraph';
import { BTN, type SimEvent } from '../shared/sim';

const PORT = 20600 + Math.floor(Math.random() * 300);
const PROXY = PORT + 1000;
let server: ChildProcess;
let proxy: LatencyProxy;

class OriginWS extends WS {
  constructor(url: string) { super(url, { origin: ORIGIN }); }
}

beforeAll(async () => {
  server = await startServer(PORT, { MATCH_COUNTDOWN_MS: '300', MATCH_DURATION_MS: '240000', MATCH_SCORE_TO_WIN: '1' });
  proxy = new LatencyProxy(PROXY, `ws://127.0.0.1:${PORT}/ws`, 60, 15);
}, 20000);

afterAll(() => { proxy?.close(); server?.kill('SIGTERM'); });

type Seen = { events: SimEvent[] };
function session(seen: Seen): GameSession {
  return new GameSession(wsTransport(`ws://127.0.0.1:${PROXY}/ws`, OriginWS as unknown as { new (url: string): WebSocket }), { event: (e) => seen.events.push(e) });
}

describe('¡Puro Chanclazo! online', () => {
  it('the host sets the rules; clients agree on melee eliminations; forged throws, rule changes, rematch, reconnect and join', async () => {
    const sa: Seen = { events: [] }, sb: Seen = { events: [] }, sc: Seen = { events: [] }, sd: Seen = { events: [] };
    const a = session(sa), b = session(sb), c = session(sc);
    a.connect('Alpha'); b.connect('Bravo'); c.connect('Charlie');
    await until(() => [a, b, c].every((s) => s.state === 'online'), 5000, 'online');
    a.send({ t: 'create', map: 'patio', rules: 'melee' });
    await until(() => !!a.room, 5000, 'room');
    expect(a.room!.rules).toBe('melee');
    // Joiners send no rules at all: they get the host's.
    b.send({ t: 'join', code: a.room!.code });
    c.send({ t: 'join', code: a.room!.code });
    await until(() => a.room!.members.length === 3 && !!b.room && !!c.room, 5000, 'joined');
    expect([b.rules, c.rules]).toEqual(['melee', 'melee']);
    if (a.team === b.team) b.send({ t: 'team', team: a.team === 0 ? 1 : 0 });
    await until(() => a.room!.members.find((m) => m.id === b.id)?.team !== a.room!.members.find((m) => m.id === a.id)?.team, 5000, 'teams');
    b.send({ t: 'ready', ready: true }); c.send({ t: 'ready', ready: true });
    await until(() => a.room!.members.every((m) => m.ready), 5000, 'ready');
    // A non-owner cannot change the rules.
    b.send({ t: 'rules', rules: 'classic' });
    a.send({ t: 'start' });
    await until(() => [a, b, c].every((s) => s.phase === 'playing'), 8000, 'playing');
    expect(a.room!.rules).toBe('melee');

    const map = mapData('patio');
    const world = new World(map.boxes);
    const graph = buildNavGraph(map, world);
    let path: number[] = [], replanAt = 0, stuckAt = { x: 0, z: 0 };
    let bPath: number[] = [], bParked = false;
    let t = 0, pressAt = -1e9, presses = 0, forged = 0, forgedSeq = 1_000_000;
    const idle: LocalInput = { mx: 0, mz: 0, yaw: 0, pitch: 0, fire: false, jump: false, crouch: false, weapon: 1 };
    let acc = 0, last = performance.now();
    const step = () => {
      t++;
      // A: walk up to B and swing with the primary button only (held 4 ticks per press, as a click is).
      const r = a.remotes.get(b.id);
      let inp: LocalInput = { ...idle, yaw: a.yaw };
      if (r && r.alive && a.alive && bParked) {
        const dx = r.x - a.body.x, dz = r.z - a.body.z, d = Math.hypot(dx, dz);
        let tx = r.x, tz = r.z;
        if (d > 3) {
          if (!path.length && t >= replanAt) {
            path = findPath(graph, nearestNode(graph, world, a.body), nearestNode(graph, world, { x: r.x, y: r.y, z: r.z }));
            replanAt = t + 30;
          }
          if (t % 60 === 0) { if (Math.hypot(a.body.x - stuckAt.x, a.body.z - stuckAt.z) < 0.3) path.shift(); stuckAt = { x: a.body.x, z: a.body.z }; }
          const n = path[0] !== undefined ? graph.nodes[path[0]] : undefined;
          if (n) { if (Math.hypot(n.x - a.body.x, n.z - a.body.z) < 1.2) path.shift(); else { tx = n.x; tz = n.z; } }
        }
        const yaw = Math.atan2(-(tx - a.body.x), -(tz - a.body.z));
        const pitch = Math.atan2(r.y + 1.52 - (a.body.y + 1.58), Math.max(0.6, d - 0.25));
        const inReach = d < 1.35;
        if (inReach && a.meleeMs <= 0 && a.switchMs <= 0 && t - pressAt > 12) { pressAt = t; presses++; }
        inp = { ...idle, yaw, pitch: inReach ? pitch : 0, mz: d > 1.1 ? 1 : 0, fire: t - pressAt < 4 };
      }
      a.tick(inp);
      if (!bParked) {
        if (!bPath.length) bPath = findPath(graph, nearestNode(graph, world, b.body), nearestNode(graph, world, { x: 7, y: 0, z: 4 }));
        const n = bPath[0] !== undefined ? graph.nodes[bPath[0]] : undefined;
        if (n && Math.hypot(n.x - b.body.x, n.z - b.body.z) < 1.0) bPath.shift();
        if (!bPath.length) bParked = true;
        b.tick({ ...idle, yaw: n ? Math.atan2(-(n.x - b.body.x), -(n.z - b.body.z)) : b.yaw, mz: n ? 1 : 0, weapon: 0 });
      } else b.tick({ ...idle, yaw: b.yaw, weapon: 0 });
      // C: a forged client, sending raw throw inputs straight to the server.
      if (c.phase === 'playing' && t % 2 === 0) { c.send({ t: 'i', d: [[++forgedSeq, 0, 0, 0, 0, BTN.fire, t % 4 ? 0 : 1]] }); forged++; }
      for (const s of [a, b]) { s.flush(); s.updateRemotes(); }
      c.updateRemotes();
    };
    const tick = setInterval(() => {
      const now = performance.now();
      acc += now - last; last = now;
      let n = 0;
      while (acc >= 1000 / NET.tickRate && n++ < 6) { acc -= 1000 / NET.tickRate; step(); }
    }, 4);

    try {
      const elimsOf = (s: Seen) => s.events.filter((e) => e.k === 'elim') as Array<Extract<SimEvent, { k: 'elim' }>>;
      await until(() => elimsOf(sa).length >= 1, 60000, 'A eliminates B with the primary button');
      await until(() => elimsOf(sb).length >= 1 && elimsOf(sc).length >= 1, 5000, 'all saw it');
      const elim = elimsOf(sa)[0]!;
      expect(elim.a).toBe(a.id);
      expect(elim.w).toBe(1); // El Revés: attributed to the melee attack of the chancla in hand
      expect(elim.m).toBeDefined();
      // Same hits everywhere, all El Revés to the head; nobody threw anything.
      const hits = (s: Seen) => s.events.filter((e): e is Extract<SimEvent, { k: 'hit' }> => e.k === 'hit' && e.v === b.id).map((h) => [h.m, h.d, h.head, h.w]).sort();
      expect(hits(sb)).toEqual(hits(sa));
      expect(hits(sc)).toEqual(hits(sa));
      expect(hits(sa).every(([, d, , w]) => d === MELEE[1]!.damage && w === 1)).toBe(true);
      for (const s of [sa, sb, sc]) expect(s.events.filter((e) => e.k === 'throw').length).toBe(0);
      expect(forged).toBeGreaterThan(20);
      expect(presses).toBeGreaterThanOrEqual(3);
      // First to 1: the match is over, with the same score on every client.
      await until(() => [a, b, c].every((s) => s.room?.phase === 'results'), 8000, 'results');
      expect(a.room!.results!.scores).toEqual(b.room!.results!.scores);
      expect(c.room!.results!.scores).toEqual(a.room!.results!.scores);

      // Between matches the owner may change the rules: everyone hears; then back to melee-only.
      a.send({ t: 'rules', rules: 'classic' });
      await until(() => [a, b, c].every((s) => s.rules === 'classic'), 5000, 'classic everywhere');
      a.send({ t: 'rules', rules: 'melee' });
      await until(() => [a, b, c].every((s) => s.rules === 'melee'), 5000, 'melee everywhere');

      // Rematch keeps the rules.
      a.send({ t: 'rematch' });
      await until(() => [a, b, c].every((s) => s.phase === 'playing' || s.phase === 'countdown'), 8000, 'rematch');
      expect([a, b, c].map((s) => s.rules)).toEqual(['melee', 'melee', 'melee']);

      // C drops and comes back: the room still says melee-only.
      proxy.interrupt();
      await until(() => [a, b, c].some((s) => s.state === 'reconnecting'), 4000, 'drop noticed');
      await until(() => [a, b, c].every((s) => s.state === 'online' && !!s.room), 15000, 'reconnected');
      expect([a, b, c].map((s) => s.rules)).toEqual(['melee', 'melee', 'melee']);

      // A late join by code: the host's rules again.
      const d = session(sd);
      d.connect('Delta');
      await until(() => d.state === 'online', 5000, 'D online');
      d.send({ t: 'join', code: a.room!.code });
      await until(() => !!d.room, 5000, 'D joined');
      expect(d.rules).toBe('melee');
      d.close();
    } finally {
      clearInterval(tick);
      for (const s of [a, b, c]) s.close();
    }
  }, 120000);
});
