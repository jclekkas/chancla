// Two real client sessions (prediction, reconciliation, interpolation)
// playing through a simulated ~150 ms RTT network with jitter and a brief
// connection drop, against the real server process.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import WS from 'ws';
import type { ChildProcess } from 'node:child_process';
import { ORIGIN, startServer, until } from './helpers/netclient';
import { LatencyProxy } from './helpers/latency-proxy';
import { GameSession, wsTransport, type LocalInput } from '../src/net/session';
import { NET } from '../shared/config';

const PORT = 19200 + Math.floor(Math.random() * 300);
const PROXY = PORT + 1000;
const ONE_WAY = 75, JITTER = 20;
let server: ChildProcess;
let proxy: LatencyProxy;

class OriginWS extends WS {
  constructor(url: string) { super(url, { origin: ORIGIN }); }
}

beforeAll(async () => {
  server = await startServer(PORT, { MATCH_COUNTDOWN_MS: '300' });
  proxy = new LatencyProxy(PROXY, `ws://127.0.0.1:${PORT}/ws`, ONE_WAY, JITTER);
}, 20000);

afterAll(() => { proxy?.close(); server?.kill('SIGTERM'); });

function session(): GameSession {
  return new GameSession(wsTransport(`ws://127.0.0.1:${PROXY}/ws`, OriginWS as unknown as { new (url: string): WebSocket }));
}

describe('multiplayer under latency', () => {
  it('stays consistent at ~150 ms RTT with jitter, and survives a connection drop', async () => {
    const a = session(), b = session();
    a.debugLog = [];
    a.connect('Alpha'); b.connect('Bravo');
    await until(() => a.state === 'online' && b.state === 'online', 5000, 'online');
    a.send({ t: 'create' });
    await until(() => !!a.room, 5000, 'room');
    b.send({ t: 'join', code: a.room!.code });
    await until(() => a.room!.members.length === 2 && !!b.room, 5000, 'joined');
    b.send({ t: 'ready', ready: true });
    await until(() => a.room!.members.every((m) => m.ready), 5000, 'ready');
    a.send({ t: 'start' });
    await until(() => a.phase === 'playing' && b.phase === 'playing', 8000, 'playing');

    // Drive both at the simulation rate. A runs a zig-zag; B tracks A on
    // its own (interpolated) screen and throws.
    let t = 0;
    const jumps: number[] = [];
    let lastRemote: { x: number; z: number } | null = null;
    const quiet: number[] = []; // corrections while nobody is hitting A
    let hitsOnA = 0, lastHitOnA = -1e9;
    (a as unknown as { handlers: { event: (e: { k: string; v?: unknown }) => void } }).handlers.event = (e) => { if (e.k === 'hit' && e.v === a.id) { hitsOnA++; lastHitOnA = t; } };
    // Real-time accumulator at exactly 60 Hz, as the browser game loop does.
    let acc = 0, last = performance.now();
    const step = () => {
      t++;
      const ia: LocalInput = { mx: Math.sin(t / 40), mz: t % 240 < 120 ? 1 : -1, yaw: -Math.PI / 2, pitch: 0, fire: false, jump: t % 90 === 0, crouch: false, weapon: 0 };
      a.tick(ia); a.flush();
      if (t - lastHitOnA > 30) quiet.push(a.lastCorrection);
      a.lastCorrection = 0;
      b.updateRemotes();
      const ra = b.remotes.get(a.id);
      let yaw = Math.PI / 2, pitch = 0;
      if (ra) {
        const dx = ra.x - b.body.x, dz = ra.z - b.body.z;
        yaw = Math.atan2(-dx, -dz);
        pitch = Math.atan2(ra.y + 1 - (b.body.y + 1.58), Math.hypot(dx, dz));
        if (lastRemote) jumps.push(Math.hypot(ra.x - lastRemote.x, ra.z - lastRemote.z));
        lastRemote = { x: ra.x, z: ra.z };
      }
      b.tick({ mx: 0, mz: 0, yaw, pitch, fire: t > 240, jump: false, crouch: false, weapon: 0 }); b.flush();
      b.updateProjectiles(1 / NET.tickRate);
      a.updateProjectiles(1 / NET.tickRate);
    };
    const tick = setInterval(() => {
      const now = performance.now();
      acc += now - last;
      last = now;
      while (acc >= 1000 / NET.tickRate) { acc -= 1000 / NET.tickRate; step(); }
    }, 4);

    await new Promise((r) => setTimeout(r, 8000));
    const rttA = a.rtt, rttB = b.rtt;

    // Brief interruption of every connection.
    const idA = a.id;
    const quietBefore = [...quiet];
    const dropSeq = (a as unknown as { seq: number }).seq;
    const dropAt = Date.now();
    proxy.interrupt();
    await until(() => a.state === 'reconnecting', 3000, 'noticed drop');
    await until(() => a.state === 'online' && b.state === 'online' && a.room?.members.every((m) => m.connected) === true, 15000, 'reconnected');
    const recoverMs = Date.now() - dropAt;
    expect(a.id).toBe(idA);
    await new Promise((r) => setTimeout(r, 1500));
    clearInterval(tick);

    const scoreA = a.snap!.sc, scoreB = b.snap!.sc;
    await new Promise((r) => setTimeout(r, 400));
    const sorted = [...quietBefore].sort((x, y) => x - y);
    const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
    const maxStep = Math.max(...jumps);
    const report = {
      conditions: { oneWayMs: ONE_WAY, jitterMs: JITTER, approxRttMs: ONE_WAY * 2, transport: 'local WebSocket relay, same machine', snapshotsPerSec: NET.snapshotRate, tickRate: NET.tickRate },
      measured: {
        rttA: Math.round(rttA), rttB: Math.round(rttB),
        predictionCorrections: a.corrections, quietSamples: quiet.length, correctionP95m: +p95.toFixed(3), correctionMaxM: +a.maxCorrection.toFixed(3),
        remoteMaxStepPerTickM: +maxStep.toFixed(3), reconnectMs: recoverMs,
        hitsOnA, scoresA: scoreA, scoresB: scoreB,
        downlinkKbPerSecPerClient: +((proxy.stats.bytesDown / 2 / 1024) / 10).toFixed(1),
      },
    };
    fs.mkdirSync('artifacts', { recursive: true });
    fs.writeFileSync('artifacts/latency-report.json', JSON.stringify(report, null, 2));
    fs.writeFileSync('artifacts/latency-debug.json', JSON.stringify({ dropSeq, log: a.debugLog }, null, 1));

    expect(rttA).toBeGreaterThan(110);
    expect(rttA).toBeLessThan(260);
    // Deterministic prediction: corrections stay tiny except after knockback.
    expect(p95).toBeLessThan(0.05);
    // Interpolation never teleports a moving remote player between frames.
    expect(maxStep).toBeLessThan(0.6);
    expect(a.snap!.sc).toEqual(b.snap!.sc);
    a.close(); b.close();
  }, 60000);
});
