// WebSocket relay that delays every message to simulate a real network:
// a fixed one-way delay plus random jitter, with ordering preserved (as TCP
// would), and the ability to cut all connections to test reconnection.
import http from 'node:http';
import type { Socket } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import { ORIGIN } from './netclient';

export interface ProxyStats { up: number; down: number; bytesDown: number }

export class LatencyProxy {
  private wss: WebSocketServer;
  private pairs = new Set<{ a: WebSocket; b: WebSocket; frozen?: boolean }>();
  readonly stats: ProxyStats = { up: 0, down: 0, bytesDown: 0 };
  private http: http.Server;
  private stalled = false;
  private held = new Set<Socket>();

  constructor(port: number, upstream: string, public oneWayMs: number, public jitterMs: number) {
    this.wss = new WebSocketServer({ noServer: true });
    // Plain requests (the client's /healthz check) get a simple OK.
    this.http = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end('{"ok":true}'); });
    this.http.on('upgrade', (req, sock: Socket, head) => {
      // Stalled network: the TCP connection is accepted but the handshake
      // never completes, so the browser's socket sits in CONNECTING with no
      // open, error or close event.
      if (this.stalled) { this.held.add(sock); sock.on('close', () => this.held.delete(sock)); return; }
      this.wss.handleUpgrade(req, sock, head, (ws) => this.wss.emit('connection', ws, req));
    });
    this.http.listen(port);
    this.wss.on('connection', (client) => {
      const server = new WebSocket(upstream, { origin: ORIGIN });
      const pair: { a: WebSocket; b: WebSocket; frozen?: boolean } = { a: client, b: server };
      this.pairs.add(pair);
      // One FIFO per direction, drained in order: like TCP, jitter delays
      // messages but never reorders them.
      const fifo = (deliver: (m: string) => void) => {
        const q: Array<{ at: number; m: string }> = [];
        let last = 0;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const pump = () => {
          timer = null;
          while (q.length && q[0]!.at <= Date.now()) deliver(q.shift()!.m);
          if (q.length) timer = setTimeout(pump, Math.max(0, q[0]!.at - Date.now()));
        };
        return (m: string) => {
          last = Math.max(last, Date.now() + this.oneWayMs + (Math.random() * 2 - 1) * this.jitterMs);
          q.push({ at: last, m });
          if (!timer) timer = setTimeout(pump, Math.max(0, q[0]!.at - Date.now()));
        };
      };
      const pendingUp: string[] = [];
      const up = fifo((m) => { if (server.readyState === WebSocket.OPEN) server.send(m); else pendingUp.push(m); });
      const down = fifo((m) => { if (client.readyState === WebSocket.OPEN) client.send(m); });
      client.on('message', (d) => { if (pair.frozen) return; this.stats.up++; up(String(d)); });
      server.on('open', () => { for (const m of pendingUp.splice(0)) server.send(m); });
      server.on('message', (d) => {
        if (pair.frozen) return;
        const m = String(d);
        this.stats.down++;
        this.stats.bytesDown += m.length;
        down(m);
      });
      const end = () => { this.pairs.delete(pair); try { client.terminate(); } catch { /**/ } try { server.terminate(); } catch { /**/ } };
      client.on('close', end);
      server.on('close', end);
      client.on('error', end);
      server.on('error', end);
    });
  }

  // Every live connection goes silent but stays open: no close event reaches
  // either side, as when a phone freezes a backgrounded page. New connections
  // work normally.
  freeze(): void {
    for (const p of this.pairs) p.frozen = true;
  }

  // New connection attempts hang (see the upgrade handler) until unstall().
  stall(): void { this.stalled = true; }

  // New attempts work again. Attempts already hung stay hung, as they do
  // when a real network comes back.
  unstall(): void { this.stalled = false; }

  // Cuts every live connection (both directions), like a network drop.
  interrupt(): void {
    for (const p of [...this.pairs]) { p.a.terminate(); p.b.terminate(); }
  }

  close(): void {
    this.stalled = false;
    for (const s of this.held) s.destroy();
    this.held.clear();
    this.interrupt();
    this.wss.close();
    this.http.close();
  }
}
