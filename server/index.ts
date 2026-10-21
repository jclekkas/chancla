// Chancla Warfare game server: an authoritative WebSocket room host.
//
//   GET /healthz  liveness, plus room/player counts and tick timing
//   GET /readyz   503 while shutting down
//   WS  /ws       game protocol (see shared/protocol.ts)
//
// Environment: see server/.env.example.

import http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { Hub, type Session } from '../shared/hub';
import { NET } from '../shared/config';
import type { ServerMsg } from '../shared/protocol';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const PROD = process.env.NODE_ENV === 'production';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const MAX_CONN_PER_IP = Number(process.env.MAX_CONN_PER_IP || NET.maxConnectionsPerIp);
const MAX_ROOMS = Number(process.env.MAX_ROOMS || NET.maxRooms);
const ORIGINS = (process.env.ALLOWED_ORIGINS || (PROD ? '' : 'http://localhost:5173,http://localhost:4173,http://127.0.0.1:5173,http://127.0.0.1:4173'))
  .split(',').map((s) => s.trim()).filter(Boolean);

function log(event: string, data: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), event, ...data })}\n`);
}

if (PROD && ORIGINS.length === 0) {
  log('fatal', { msg: 'ALLOWED_ORIGINS must list the site origins in production (e.g. https://chancla.vercel.app)' });
  process.exit(1);
}

const t0 = performance.now();
// Optional overrides for automated tests (shorter matches); unset in production.
const envNum = (k: string): number | undefined => (process.env[k] ? Number(process.env[k]) : undefined);
const roomOptions = {
  durationMs: envNum('MATCH_DURATION_MS'), scoreToWin: envNum('MATCH_SCORE_TO_WIN'), countdownMs: envNum('MATCH_COUNTDOWN_MS'),
};
const hub = new Hub({ allowPractice: false, maxRooms: MAX_ROOMS, now: () => performance.now() - t0, log, roomOptions });
let ready = true;
const perIp = new Map<string, number>();
let bytesOut = 0, msgsOut = 0;

const server = http.createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];
  if (path === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, ...hub.stats(), uptimeS: Math.round(process.uptime()) }));
  } else if (path === '/readyz') {
    res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ready }));
  } else {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: NET.maxMessageBytes, perMessageDeflate: false });

function clientIp(req: http.IncomingMessage): string {
  const fwd = TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0]!.trim() : '';
  return fwd || req.socket.remoteAddress || 'unknown';
}

server.on('upgrade', (req, socket, head) => {
  const path = (req.url || '/').split('?')[0];
  const origin = String(req.headers.origin || '');
  const ip = clientIp(req);
  const reject = (code: number, why: string) => {
    log('reject', { why, origin: origin.slice(0, 80) });
    socket.write(`HTTP/1.1 ${code} ${why}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  if (path !== '/ws') return reject(404, 'Not Found');
  if (!ready) return reject(503, 'Service Unavailable');
  if (!ORIGINS.includes('*') && !ORIGINS.includes(origin)) return reject(403, 'Forbidden');
  if ((perIp.get(ip) ?? 0) >= MAX_CONN_PER_IP) return reject(429, 'Too Many Requests');
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, ip));
});

interface Bucket { tokens: number; last: number; strikes: number }

function take(b: Bucket, rate: number, burst: number, now: number): boolean {
  b.tokens = Math.min(burst, b.tokens + ((now - b.last) / 1000) * rate);
  b.last = now;
  if (b.tokens >= 1) { b.tokens -= 1; return true; }
  b.strikes++;
  return false;
}

wss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, ip: string) => {
  perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
  let alive = true;
  const conn = {
    send(msg: ServerMsg) {
      if (ws.readyState !== ws.OPEN) return;
      const s = JSON.stringify(msg);
      bytesOut += s.length;
      msgsOut++;
      ws.send(s);
    },
    close(code?: number, reason?: string) {
      try { ws.close(code ?? 1000, reason); } catch { /* already closed */ }
    },
  };
  const session: Session = hub.open(conn);
  const now = () => performance.now();
  const inputs: Bucket = { tokens: 60, last: now(), strikes: 0 };
  const control: Bucket = { tokens: 20, last: now(), strikes: 0 };

  ws.on('pong', () => { alive = true; });
  ws.on('message', (data, isBinary) => {
    if (isBinary) { conn.close(1003, 'text only'); return; }
    let raw: unknown;
    try { raw = JSON.parse(String(data)); } catch { conn.send({ t: 'error', code: 'bad_message' }); return; }
    const isInput = !!raw && typeof raw === 'object' && (raw as { t?: unknown }).t === 'i';
    const ok = isInput ? take(inputs, 90, 60, now()) : take(control, NET.maxControlPerSecond, 20, now());
    if (!ok) {
      if (!isInput) conn.send({ t: 'error', code: 'rate_limited' });
      if (inputs.strikes + control.strikes > 600) { log('kick', { why: 'rate' }); conn.close(4008, 'rate limited'); }
      return;
    }
    hub.message(session, raw);
  });
  ws.on('close', () => {
    perIp.set(ip, Math.max(0, (perIp.get(ip) ?? 1) - 1));
    if ((perIp.get(ip) ?? 0) === 0) perIp.delete(ip);
    hub.closed(session);
    clearInterval(beat);
  });
  ws.on('error', () => { /* close follows */ });
  const beat = setInterval(() => {
    if (!alive) { ws.terminate(); return; }
    alive = false;
    try { ws.ping(); } catch { /* closing */ }
  }, NET.heartbeatMs);
});

// Fixed-rate loop. Each room runs as many 60 Hz ticks as real time requires.
const loop = setInterval(() => hub.update(), 1000 / NET.tickRate / 2);

const statsTimer = setInterval(() => {
  const s = hub.stats();
  if (s.rooms > 0) log('stats', { ...s, kbOutPerS: Math.round(bytesOut / 1024 / 60), msgsOutPerS: Math.round(msgsOut / 60) });
  bytesOut = 0;
  msgsOut = 0;
}, 60_000);

server.listen(PORT, HOST, () => log('listening', { port: PORT, origins: ORIGINS.length, prod: PROD }));

function shutdown(signal: string): void {
  if (!ready) return;
  ready = false;
  log('shutdown', { signal, ...hub.stats() });
  hub.shutdown();
  clearInterval(loop);
  clearInterval(statsTimer);
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
