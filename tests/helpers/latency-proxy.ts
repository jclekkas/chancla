// WebSocket relay that delays every message to simulate a real network:
// a fixed one-way delay plus random jitter, with ordering preserved (as TCP
// would), and the ability to cut all connections to test reconnection.
import WebSocket, { WebSocketServer } from 'ws';
import { ORIGIN } from './netclient';

export interface ProxyStats { up: number; down: number; bytesDown: number }

export class LatencyProxy {
  private wss: WebSocketServer;
  private pairs = new Set<{ a: WebSocket; b: WebSocket; frozen?: boolean }>();
  readonly stats: ProxyStats = { up: 0, down: 0, bytesDown: 0 };

  constructor(port: number, upstream: string, public oneWayMs: number, public jitterMs: number) {
    this.wss = new WebSocketServer({ port });
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

  // Cuts every live connection (both directions), like a network drop.
  interrupt(): void {
    for (const p of [...this.pairs]) { p.a.terminate(); p.b.terminate(); }
  }

  close(): void {
    this.interrupt();
    this.wss.close();
  }
}
