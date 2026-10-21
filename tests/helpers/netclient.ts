// Headless game client for integration tests: a real WebSocket connection
// speaking the real protocol. It can steer and throw using snapshot data.
import WebSocket from 'ws';
import { spawn, type ChildProcess } from 'node:child_process';
import { PROTOCOL_VERSION } from '../../shared/config';
import type { RoomView, ServerMsg, Snapshot, PlayerTuple } from '../../shared/protocol';

export const ORIGIN = 'http://test.local';

export async function startServer(port: number, env: Record<string, string> = {}): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: new URL('../..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(port), ALLOWED_ORIGINS: ORIGIN, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 15000);
    child.stdout!.on('data', (d: Buffer) => { if (String(d).includes('listening')) { clearTimeout(t); resolve(); } });
    child.on('exit', (c) => reject(new Error(`server exited ${c}`)));
  });
  return child;
}

export class NetClient {
  ws!: WebSocket;
  id = -1;
  resume = '';
  room: RoomView | null = null;
  snap: Snapshot | null = null;
  snaps = 0;
  errors: string[] = [];
  events: Array<Record<string, unknown>> = [];
  closed = false;
  closeCode = 0;
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  steer: ((c: NetClient) => { mx: number; mz: number; yaw: number; pitch: number; buttons: number; weapon: number }) | null = null;

  constructor(public url: string, public name: string) {}

  connect(opts: { resume?: string; version?: number; origin?: string } = {}): Promise<void> {
    this.closed = false;
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url, { origin: opts.origin ?? ORIGIN });
      this.ws.on('open', () => {
        this.send({ t: 'hello', v: opts.version ?? PROTOCOL_VERSION, name: this.name, resume: opts.resume });
      });
      this.ws.on('message', (d) => {
        const m = JSON.parse(String(d)) as ServerMsg;
        if (m.t === 'welcome') { this.id = m.id; this.resume = m.resume; resolve(); }
        else if (m.t === 'room') this.room = m.room;
        else if (m.t === 'snap') { this.snap = m; this.snaps++; this.events.push(...(m.ev as Array<Record<string, unknown>>)); }
        else if (m.t === 'error') { this.errors.push(m.code); if (m.fatal) resolve(); }
      });
      this.ws.on('close', (code) => { this.closed = true; this.closeCode = code; this.stopInputs(); });
      this.ws.on('error', (e) => reject(e));
    });
  }

  send(msg: unknown): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  startInputs(): void {
    this.stopInputs();
    this.timer = setInterval(() => {
      const s = this.steer ? this.steer(this) : { mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, weapon: 0 };
      this.send({ t: 'i', d: [[++this.seq, s.mx, s.mz, s.yaw, s.pitch, s.buttons, s.weapon]] });
    }, 1000 / 60);
  }

  stopInputs(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  player(id = this.id): PlayerTuple | undefined {
    return this.snap?.p.find((p) => p[0] === id);
  }

  close(): void {
    this.stopInputs();
    this.ws.close();
  }

  kill(): void {
    this.stopInputs();
    this.ws.terminate();
  }
}

export async function until(cond: () => boolean, ms = 8000, what = 'condition'): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

// Aim at the nearest living enemy and throw: a crude but real player.
export function aimbot(c: NetClient) {
  const me = c.snap?.me, room = c.room;
  if (!me || !room || !c.snap) return { mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, weapon: 0 };
  const myTeam = room.members.find((m) => m.id === c.id)?.team;
  let best: PlayerTuple | null = null, bd = Infinity;
  for (const p of c.snap.p) {
    const team = room.members.find((m) => m.id === p[0])?.team;
    if (p[0] === c.id || team === myTeam || !(p[8] & 1)) continue;
    const d = Math.hypot(p[1] - me[0], p[3] - me[2]);
    if (d < bd) { bd = d; best = p; }
  }
  if (!best) return { mx: 0, mz: 1, yaw: 0, pitch: 0, buttons: 0, weapon: 0 };
  const dx = best[1] - me[0], dz = best[3] - me[2];
  return { mx: 0, mz: bd > 8 ? 1 : 0, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(best[2] + 1.0 - (me[1] + 1.58), bd), buttons: 1, weapon: 0 };
}

import { EL_PATIO } from '../../shared/map';
import { World } from '../../shared/physics';
import { buildNavGraph, findPath } from '../../shared/navgraph';

const navWorld = new World(EL_PATIO.boxes);
const graph = buildNavGraph(EL_PATIO, navWorld);

function nearest(x: number, y: number, z: number): number {
  let best = 0, bd = Infinity;
  graph.nodes.forEach((n, i) => { const d = Math.hypot(n.x - x, n.z - z) + Math.abs(n.y - y) * 3; if (d < bd) { bd = d; best = i; } });
  return best;
}

// Walks to a destination along the shared waypoint graph, then fights.
export function walkThenFight(dest: { x: number; z: number }) {
  let path: number[] | null = null;
  return (c: NetClient) => {
    const me = c.snap?.me;
    if (!me || !(me[6] & 1)) { path = null; return { mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, weapon: 0 }; }
    if (!path) path = findPath(graph, nearest(me[0], me[1], me[2]), nearest(dest.x, 0, dest.z));
    while (path.length && Math.hypot(graph.nodes[path[0]!]!.x - me[0], graph.nodes[path[0]!]!.z - me[2]) < 0.6) path.shift();
    if (path.length) {
      const n = graph.nodes[path[0]!]!;
      return { mx: 0, mz: 1, yaw: Math.atan2(-(n.x - me[0]), -(n.z - me[2])), pitch: 0, buttons: 0, weapon: 0 };
    }
    const a = aimbot(c);
    return { ...a, mz: 0 };
  };
}
