// A phone that freezes a backgrounded page can leave its WebSocket open but
// dead: no messages, and no close event. The session notices the silence and
// takes the normal reconnect path, back into the same room and slot, within
// the server's grace period. Real server, real sessions.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WS from 'ws';
import type { ChildProcess } from 'node:child_process';
import { ORIGIN, startServer, until } from './helpers/netclient';
import { LatencyProxy } from './helpers/latency-proxy';
import { GameSession, wsTransport } from '../src/net/session';

const PORT = 19600 + Math.floor(Math.random() * 300);
const PROXY = PORT + 1000;
let server: ChildProcess;
let proxy: LatencyProxy;

class OriginWS extends WS {
  constructor(url: string) { super(url, { origin: ORIGIN }); }
}
const viaProxy = () => new GameSession(wsTransport(`ws://127.0.0.1:${PROXY}/ws`, OriginWS as unknown as { new (url: string): WebSocket }));
const direct = () => new GameSession(wsTransport(`ws://127.0.0.1:${PORT}/ws`, OriginWS as unknown as { new (url: string): WebSocket }));

beforeAll(async () => {
  server = await startServer(PORT, { MATCH_COUNTDOWN_MS: '300' });
  proxy = new LatencyProxy(PROXY, `ws://127.0.0.1:${PORT}/ws`, 5, 0);
}, 20000);
afterAll(() => { proxy?.close(); server?.kill('SIGTERM'); });

describe('mobile connection lifecycle', () => {
  it('a silent (frozen) connection is detected and rejoins the same room and slot', async () => {
    const phone = viaProxy(), desk = direct();
    const states: string[] = [];
    (phone as unknown as { handlers: { state: (s: string) => void } }).handlers.state = (s) => states.push(s);
    phone.connect('Phone'); desk.connect('Desk');
    await until(() => phone.state === 'online' && desk.state === 'online', 5000, 'online');
    desk.send({ t: 'create' });
    await until(() => !!desk.room, 5000, 'room');
    phone.send({ t: 'join', code: desk.room!.code });
    await until(() => !!phone.room && desk.room!.members.length === 2, 5000, 'joined');
    const id = phone.id, code = phone.room!.code, team = phone.team;
    proxy.freeze();
    // Pongs stop; within ~6-8 s the ping timer notices and reconnects.
    await until(() => states.includes('reconnecting'), 10000, 'noticed the silence');
    await until(() => phone.state === 'online' && !!phone.room, 10000, 'back online');
    expect(phone.room!.code).toBe(code);
    expect(phone.id).toBe(id);
    expect(phone.team).toBe(team);
    expect(desk.room!.members.filter((m) => !m.bot).length).toBe(2);
    phone.close(); desk.close();
  }, 30000);

  it('checkAlive() on return to the page only acts after real silence', async () => {
    const s = direct();
    s.connect('Fresh');
    await until(() => s.state === 'online', 5000, 'online');
    s.send({ t: 'create' });
    await until(() => !!s.room, 5000, 'room');
    s.checkAlive(); // messages arrived moments ago: nothing happens
    expect(s.state).toBe('online');
    s.close();
  }, 15000);
});
