// Four independent clients play a full (short) 2v2 to the results screen and
// a rematch, against the real server.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { NetClient, startServer, until, walkThenFight } from './helpers/netclient';

const PORT = 18300 + Math.floor(Math.random() * 300);
const URL_ = `ws://127.0.0.1:${PORT}/ws`;
let server: ChildProcess;
const all: NetClient[] = [];

beforeAll(async () => {
  server = await startServer(PORT, { MATCH_COUNTDOWN_MS: '300', MATCH_SCORE_TO_WIN: '3', MATCH_DURATION_MS: '90000' });
}, 20000);
afterAll(() => { for (const c of all) { try { c.kill(); } catch { /**/ } } server?.kill('SIGTERM'); });

describe('four-player match', () => {
  it('2v2 to results, everyone agrees, then a synchronized rematch', async () => {
    const cs = ['Ana', 'Beto', 'Carmen', 'Dani'].map((n) => { const c = new NetClient(URL_, n); all.push(c); return c; });
    await cs[0]!.connect();
    cs[0]!.send({ t: 'create' });
    await until(() => !!cs[0]!.room, 4000, 'room');
    for (const c of cs.slice(1)) { await c.connect(); c.send({ t: 'join', code: cs[0]!.room!.code }); }
    await until(() => cs.every((c) => c.room?.members.length === 4), 5000, 'four in room');
    const teams = cs[0]!.room!.members.map((m) => m.team).sort();
    expect(teams).toEqual([0, 0, 1, 1]);
    for (const c of cs.slice(1)) c.send({ t: 'ready', ready: true });
    await until(() => cs[0]!.room!.members.every((m) => m.ready), 4000, 'ready');
    cs[0]!.send({ t: 'start' });
    await until(() => cs.every((c) => c.room?.phase === 'playing'), 6000, 'playing');
    // Every client sees all four players.
    await until(() => cs.every((c) => c.snap?.p.length === 4), 4000, 'four players in snapshots');
    const spots: Record<number, Array<{ x: number; z: number }>> = { 0: [{ x: -6, z: 3.5 }, { x: -6.5, z: -2.5 }], 1: [{ x: 6.5, z: 2.5 }, { x: 6, z: -3.5 }] };
    const used = { 0: 0, 1: 0 } as Record<number, number>;
    for (const c of cs) {
      const team = cs[0]!.room!.members.find((m) => m.id === c.id)!.team;
      c.steer = walkThenFight(spots[team]![used[team]!++]!);
      c.startInputs();
    }
    await until(() => cs.every((c) => c.room?.phase === 'results'), 80000, 'results');
    const r0 = JSON.stringify(cs[0]!.room!.results);
    for (const c of cs) expect(JSON.stringify(c.room!.results)).toBe(r0);
    const res = cs[0]!.room!.results!;
    expect(Math.max(...res.scores)).toBe(3);
    expect(res.winner, JSON.stringify(res.scores)).toBe(res.scores[0] === res.scores[1] ? -1 : res.scores[0] > res.scores[1] ? 0 : 1);
    const kills = res.rows.reduce((s, r) => s + r.kills, 0);
    expect(kills).toBe(res.scores[0] + res.scores[1]);
    // Only the owner can call the rematch; it starts for everyone at once.
    cs[2]!.send({ t: 'rematch' });
    await until(() => cs[2]!.errors.includes('not_owner'), 3000, 'not_owner');
    cs[0]!.send({ t: 'rematch' });
    await until(() => cs.every((c) => c.room?.phase === 'playing' || c.room?.phase === 'countdown'), 5000, 'rematch');
    await until(() => cs.every((c) => c.snap?.sc[0] === 0 && c.snap?.sc[1] === 0), 4000, 'scores reset');
    for (const c of cs) c.close();
  }, 120000);
});
