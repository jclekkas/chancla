// Chancla Warfare remaster client. Speaks the same protocol as the original
// server and the in-browser practice host, and draws the match from above.

import { mapData, type MapId } from '../../shared/maps/index';
import { PROTOCOL_VERSION, type ClientMsg, type InputTuple, type MemberView, type Results, type RoomView, type ServerMsg, type Snapshot } from '../../shared/protocol';
import { BTN, type SimEvent } from '../../shared/sim';
import { LocalHost } from '../../src/net/local';
import type { AudioBus } from './audio';
import type { Controls } from './input';

const PRODUCTION_SERVER = 'wss://chanclawarfare-game-server.onrender.com/ws';
const PRODUCTION_HOSTS = /^(www\.)?chanclawarfare\.fun$|^chancla(warfare)?\.vercel\.app$|^chancla-git-multiplayer-jclekkas\.vercel\.app$/;

export function warfareServerUrl(): string | null {
  const env = import.meta.env.VITE_GAME_SERVER_URL as string | undefined;
  if (env) return env;
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return `ws://${h}:8787/ws`;
  if (PRODUCTION_HOSTS.test(h)) return PRODUCTION_SERVER;
  return null;
}

interface Proj { x: number; z: number; vx: number; vz: number; life: number; w: number; team: number; }

export interface WarHooks {
  room: (room: RoomView, me: number) => void;
  phase: (phase: string) => void;
  error: (code: string) => void;
  left: () => void;
}

export class Warfare {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private audio: AudioBus;
  private controls: Controls;
  private hooks: WarHooks;
  private host: LocalHost | null = null;
  private ws: WebSocket | null = null;
  private sendFn: ((m: ClientMsg) => void) | null = null;
  private raf = 0;
  private running = false;
  private myId = -1;
  private room: RoomView | null = null;
  private snap: Snapshot | null = null;
  private projs: Proj[] = [];
  private seq = 1;
  private weapon = 0;
  private last = 0;
  private fireEdge = false;
  private jumpEdge = false;
  private crouch = false;
  private aimX = 0;
  private aimZ = 0;
  private hasAim = false;
  private feed: { text: string; life: number }[] = [];
  private music: HTMLAudioElement | null = null;
  private ping = 0;
  private pingAt = 0;
  results: Results | null = null;
  mapId: MapId = 'patio';

  constructor(canvas: HTMLCanvasElement, controls: Controls, audio: AudioBus, hooks: WarHooks) {
    this.canvas = canvas;
    this.audio = audio;
    this.controls = controls;
    this.hooks = hooks;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2d');
    this.ctx = ctx;
  }

  practice(opts: { difficulty: 'easy' | 'normal' | 'hard'; allies: number; enemies: number; map: MapId; name: string }): void {
    this.shutdown();
    this.mapId = opts.map;
    this.host = new LocalHost();
    const t = this.host.transport()();
    this.sendFn = (m) => t.send(m);
    t.onMessage = (m) => this.onMsg(m);
    t.onOpen = () => {
      this.send({ t: 'hello', v: PROTOCOL_VERSION, name: opts.name });
    };
    this.pendingCreate = { t: 'create', practice: { difficulty: opts.difficulty, allies: opts.allies, enemies: opts.enemies }, map: opts.map };
    this.startMusic();
    this.startLoop();
  }

  online(opts: { name: string; create: boolean; code?: string; map: MapId }): void {
    const url = warfareServerUrl();
    if (!url) { this.hooks.error('no_server'); return; }
    this.shutdown();
    this.mapId = opts.map;
    const ws = new WebSocket(url);
    this.ws = ws;
    this.sendFn = (m) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
    ws.onmessage = (e) => {
      try { this.onMsg(JSON.parse(String(e.data)) as ServerMsg); } catch { /* ignore junk */ }
    };
    ws.onopen = () => this.send({ t: 'hello', v: PROTOCOL_VERSION, name: opts.name });
    ws.onclose = () => this.hooks.left();
    this.pendingCreate = opts.create ? { t: 'create', map: opts.map } : null;
    this.pendingJoin = opts.create ? null : (opts.code ?? null);
    this.startMusic();
    this.startLoop();
  }

  private startMusic(): void {
    const base = import.meta.env.BASE_URL || '/';
    const music = new Audio(`${base}music/rosa-theme.mp3`);
    music.loop = true;
    music.volume = 0.35;
    this.music = music;
    void music.play().catch(() => { /* needs a gesture; the menu click usually counts */ });
  }

  private pendingCreate: ClientMsg | null = null;
  private pendingJoin: string | null = null;

  act(msg: ClientMsg): void { this.send(msg); }

  stop(): void { this.shutdown(); }

  private shutdown(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.music?.pause();
    this.music = null;
    this.host?.dispose();
    this.host = null;
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; }
    this.sendFn = null;
    this.room = null;
    this.snap = null;
    this.projs = [];
  }

  private send(m: ClientMsg): void { this.sendFn?.(m); }

  private onMsg(m: ServerMsg): void {
    if (m.t === 'welcome') {
      this.myId = m.id;
      if (this.pendingCreate) { this.send(this.pendingCreate); this.pendingCreate = null; }
      else if (this.pendingJoin) { this.send({ t: 'join', code: this.pendingJoin }); this.pendingJoin = null; }
    } else if (m.t === 'room') {
      this.room = m.room;
      this.mapId = m.room.map;
      this.results = m.room.results;
      this.hooks.room(m.room, this.myId);
      this.hooks.phase(m.room.phase);
    } else if (m.t === 'snap') {
      this.snap = m;
      this.mapId = this.room?.map ?? this.mapId;
      for (const ev of m.ev as SimEvent[]) this.onEvent(ev);
    } else if (m.t === 'error') {
      this.hooks.error(m.code);
    } else if (m.t === 'pong') {
      this.ping = Math.round(performance.now() - this.pingAt);
    } else if (m.t === 'left' || m.t === 'bye') {
      this.hooks.left();
    }
  }

  private onEvent(ev: SimEvent): void {
    if (ev.k === 'throw') {
      const team = this.teamOf(ev.o);
      this.projs.push({ x: ev.p[0], z: ev.p[2], vx: ev.v[0], vz: ev.v[2], life: 1.4, w: ev.w, team });
      if (ev.o === this.myId) this.audio.throw(ev.w === 1);
    } else if (ev.k === 'hit') {
      this.audio.slap(ev.head || ev.splash);
      this.projs = this.projs.filter((p) => Math.hypot(p.x - ev.p[0], p.z - ev.p[2]) > 0.35);
    } else if (ev.k === 'elim') {
      this.audio.slap(true);
      const a = this.member(ev.a)?.name ?? 'Rosa';
      const v = this.member(ev.v)?.name ?? 'Rosa';
      this.feed.unshift({ text: `${a} sent ${v} home`, life: 3 });
    } else if (ev.k === 'bounce') {
      this.audio.tick();
    } else if (ev.k === 'pend') {
      this.projs = this.projs.filter((p) => Math.hypot(p.x - ev.p[0], p.z - ev.p[2]) > 0.4);
    }
  }

  private teamOf(id: number): number {
    return this.room?.members.find((m) => m.id === id)?.team ?? 0;
  }

  private member(id: number): MemberView | undefined {
    return this.room?.members.find((m) => m.id === id);
  }

  private startLoop(): void {
    this.running = true;
    this.last = performance.now();
    this.controls.enabled = false;
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000 || 0);
      this.last = now;
      this.resize();
      if (this.room?.phase === 'playing' || this.room?.phase === 'countdown') this.controls.enabled = true;
      else this.controls.enabled = false;
      if (this.room?.phase === 'playing') this.sendInput();
      if (now - this.pingAt > 2000) { this.pingAt = now; this.send({ t: 'ping', c: now }); }
      for (const p of this.projs) { p.x += p.vx * dt; p.z += p.vz * dt; p.life -= dt; }
      this.projs = this.projs.filter((p) => p.life > 0);
      for (const f of this.feed) f.life -= dt;
      this.feed = this.feed.filter((f) => f.life > 0);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private sendInput(): void {
    const axis = this.controls.axis();
    const edges = this.controls.takeEdges();
    if (edges.firePressed) this.fireEdge = true;
    if (edges.dash) this.jumpEdge = true;
    if (edges.slot === 0 || edges.slot === 1) this.weapon = edges.slot;
    if (edges.cycle) this.weapon = this.weapon === 0 ? 1 : 0;
    const me = this.mePos();
    let yaw = 0;
    if (me && this.hasAim) yaw = Math.atan2(-(this.aimX - me.x), -(this.aimZ - me.z));
    let buttons = 0;
    if (this.fireEdge) buttons |= BTN.fire;
    if (this.jumpEdge) buttons |= BTN.jump;
    if (this.crouch) buttons |= BTN.crouch;
    this.fireEdge = false;
    this.jumpEdge = false;
    const msg: InputTuple = [this.seq++, axis.x, -axis.y, yaw, 0, buttons, this.weapon];
    this.send({ t: 'i', d: [msg] });
  }

  pointer(clientX: number, clientY: number): void {
    const w = this.worldAt(clientX, clientY);
    this.aimX = w.x;
    this.aimZ = w.z;
    this.hasAim = true;
  }

  setCrouch(on: boolean): void { this.crouch = on; }

  private mePos(): { x: number; z: number } | null {
    const s = this.snap;
    if (!s?.me) {
      const p = s?.p.find((t) => t[0] === this.myId);
      return p ? { x: p[1], z: p[3] } : null;
    }
    return { x: s.me[0], z: s.me[2] };
  }

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(innerWidth * dpr));
    const h = Math.max(1, Math.round(innerHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  private cam(): { cx: number; cz: number; ppm: number } {
    const me = this.mePos();
    const map = mapData(this.mapId);
    const cx = me?.x ?? (map.bounds.minX + map.bounds.maxX) / 2;
    const cz = me?.z ?? (map.bounds.minZ + map.bounds.maxZ) / 2;
    const ppm = Math.min(this.canvas.width, this.canvas.height) / 36;
    return { cx, cz, ppm };
  }

  private worldAt(clientX: number, clientY: number): { x: number; z: number } {
    const rect = this.canvas.getBoundingClientRect();
    const nx = (clientX - rect.left) / Math.max(1, rect.width);
    const ny = (clientY - rect.top) / Math.max(1, rect.height);
    const { cx, cz, ppm } = this.cam();
    const viewW = this.canvas.width / ppm;
    const viewH = this.canvas.height / ppm;
    return { x: cx - viewW / 2 + nx * viewW, z: cz - viewH / 2 + ny * viewH };
  }

  private draw(): void {
    const ctx = this.ctx;
    const { cx, cz, ppm } = this.cam();
    const map = mapData(this.mapId);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#2a1630';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(ppm, 0, 0, ppm, this.canvas.width / 2 - cx * ppm, this.canvas.height / 2 - cz * ppm);
    const bnds = map.bounds;
    const gx = bnds.minX - 2;
    const gz = bnds.minZ - 2;
    const gw = bnds.maxX - bnds.minX + 4;
    const gd = bnds.maxZ - bnds.minZ + 4;
    ctx.fillStyle = '#e2a36e';
    ctx.fillRect(gx, gz, gw, gd);
    const tile = 2;
    for (let z = Math.floor(gz); z < gz + gd; z += tile) {
      for (let x = Math.floor(gx); x < gx + gw; x += tile) {
        const h = ((x * 13 + z * 7) & 3) / 3;
        ctx.globalAlpha = 0.18 + h * 0.15;
        ctx.fillStyle = h > 0.5 ? '#d4845a' : '#efd0a4';
        ctx.fillRect(x + 0.05, z + 0.05, tile - 0.1, tile - 0.1);
      }
    }
    ctx.globalAlpha = 1;
    for (const b of map.boxes) {
      if (b.maxY < 0.4) continue;
      ctx.fillStyle = matColor(b.mat);
      ctx.fillRect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
      ctx.strokeStyle = '#24141f';
      ctx.lineWidth = 0.06;
      ctx.strokeRect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
    }
    const spots = map.pickups;
    const pk = this.snap?.pk ?? [];
    spots.forEach((s, i) => {
      if ((pk[i] ?? 0) > 0) return;
      ctx.fillStyle = '#6b3a22';
      ctx.beginPath();
      ctx.arc(s.x, s.z, 0.28, 0, Math.PI * 2);
      ctx.fill();
    });
    for (const pr of this.projs) {
      ctx.save();
      ctx.translate(pr.x, pr.z);
      ctx.fillStyle = pr.w === 1 ? '#6b4634' : pr.team === 1 ? '#4fb3a9' : '#4b2a6b';
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.28, 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    const players = this.snap?.p ?? [];
    for (const p of players) {
      const id = p[0];
      const x = p[1];
      const z = p[3];
      const yaw = p[4];
      const flags = p[8];
      const hp = p[9];
      const alive = (flags & 1) !== 0;
      const team = this.teamOf(id);
      ctx.save();
      ctx.translate(x, z);
      ctx.rotate(yaw);
      ctx.globalAlpha = alive ? 1 : 0.35;
      ctx.fillStyle = team === 1 ? '#4fb3a9' : '#f2a33a';
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.62, 0.48, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = id === this.myId ? '#f5c542' : '#24141f';
      ctx.lineWidth = id === this.myId ? 0.08 : 0.05;
      ctx.stroke();
      ctx.fillStyle = '#c68a5e';
      ctx.beginPath();
      ctx.arc(-0.15, 0, 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#24141f';
      ctx.fillRect(x - 0.4, z - 0.7, 0.8, 0.08);
      ctx.fillStyle = hp > 30 ? '#f4e6c8' : '#c8553d';
      ctx.fillRect(x - 0.4, z - 0.7, 0.8 * Math.max(0, hp) / 100, 0.08);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawHud();
  }

  private drawHud(): void {
    const ctx = this.ctx;
    const s = this.snap;
    ctx.fillStyle = '#f4e6c8';
    ctx.font = '700 28px "Lilita One", system-ui, sans-serif';
    ctx.textAlign = 'center';
    const sc = s?.sc ?? [0, 0];
    ctx.fillText(`${sc[0]}  –  ${sc[1]}`, this.canvas.width / 2, 48);
    ctx.font = '600 16px system-ui, sans-serif';
    if (s) {
      const sec = Math.ceil(s.tl / 1000);
      ctx.fillText(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, this.canvas.width / 2, 72);
    }
    if (this.room?.phase === 'countdown' && s) {
      ctx.font = '700 64px "Lilita One", system-ui';
      ctx.fillText(s.cd > 0 ? String(Math.ceil(s.cd / 1000)) : '¡A la chancla!', this.canvas.width / 2, this.canvas.height / 2);
    }
    ctx.textAlign = 'left';
    ctx.font = '600 14px system-ui, sans-serif';
    this.feed.slice(0, 4).forEach((f, i) => {
      ctx.globalAlpha = Math.min(1, f.life);
      ctx.fillText(f.text, 16, 40 + i * 20);
    });
    ctx.globalAlpha = 1;
    ctx.textAlign = 'right';
    ctx.fillText(this.weapon === 1 ? 'La Pesada' : 'La Chancla', this.canvas.width - 16, this.canvas.height - 24);
    if (this.ping) ctx.fillText(`${this.ping} ms`, this.canvas.width - 16, 28);
    ctx.textAlign = 'left';
  }
}

function matColor(mat: string): string {
  switch (mat) {
    case 'stuccoTerracotta': return '#c8553d';
    case 'stuccoCream': return '#f4e6c8';
    case 'stuccoTurquoise': return '#4fb3a9';
    case 'stuccoMarigold': return '#f2a33a';
    case 'stuccoViolet': return '#4b2a6b';
    case 'stuccoPink': return '#e86a8d';
    case 'fountain': return '#3aa6d0';
    case 'planter': return '#3e8f4a';
    case 'wood': return '#8a4b2a';
    case 'stone': return '#cbb8a0';
    case 'stall': return '#e07a3d';
    case 'statue': return '#d9d0c4';
    default: return '#d7a07a';
  }
}
