import { clamp } from './phys';
import type { Block, MapDef, Theme } from './content';
import type { Enemy, Pickup, Player, Shot, Sim } from './sim';

export type Quality = 'low' | 'med' | 'high';

interface P {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number;
  color: string; kind: 'spark' | 'dust' | 'confetti' | 'ring';
  grav: number; rot: number; vr: number; grow: number;
  lit: boolean;
}

interface Floater { x: number; y: number; text: string; life: number; color: string; }

const FLAGS = ['#e86a8d', '#f4e6c8', '#c8553d', '#4b2a6b', '#f2a33a', '#4fb3a9'];

function hash(x: number, y: number): number {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function ink(ctx: CanvasRenderingContext2D, w = 2.2): void {
  ctx.lineWidth = w;
  ctx.strokeStyle = '#24141f';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function themeInk(theme: Theme): { base: string; a: string; b: string; c: string; wall: string } {
  switch (theme) {
    case 'patio': return { base: '#e2a36e', a: '#d4845a', b: '#efd0a4', c: '#c96a45', wall: '#c98462' };
    case 'cocina': return { base: '#ead6b8', a: '#f4e6c8', b: '#d7ebe3', c: '#e4c49a', wall: '#cbb89a' };
    case 'plaza': return { base: '#d7a07a', a: '#c98462', b: '#e8c4a2', c: '#b86b4a', wall: '#c17a58' };
    case 'mercado': return { base: '#d8b48a', a: '#c99668', b: '#ead3b0', c: '#b88860', wall: '#a87858' };
    case 'azotea': return { base: '#c9b8a8', a: '#bfaea0', b: '#ddd2c6', c: '#a89888', wall: '#7d6e64' };
    case 'fiesta': return { base: '#5c3278', a: '#f2a33a', b: '#4b2a6b', c: '#c8553d', wall: '#3a2048' };
  }
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private light: HTMLCanvasElement;
  quality: Quality = 'high';
  private bakedId = '';
  cx = 0;
  cy = 0;
  viewW = 800;
  viewH = 500;
  private snapped = false;
  private time = 0;
  private cssW = 1;
  private cssH = 1;
  private live: P[] = [];
  private free: P[] = [];
  private floaters: Floater[] = [];
  private flashes: { x: number; y: number; life: number }[] = [];
  private ghosts: { x: number; y: number; life: number }[] = [];
  private mote = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2d');
    this.ctx = ctx;
    this.light = document.createElement('canvas');
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.bakedId = '';
  }

  snap(x: number, y: number): void {
    this.cx = x;
    this.cy = y;
    this.snapped = true;
  }

  resize(): void {
    const d = window.devicePixelRatio || 1;
    const cap = this.quality === 'low' ? 1 : this.quality === 'med' ? 1.5 : 2;
    const dpr = Math.min(cap, d);
    const w = Math.max(1, Math.round(window.innerWidth * dpr));
    const h = Math.max(1, Math.round(window.innerHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.cssW = window.innerWidth;
    this.cssH = window.innerHeight;
    const zoom = Math.min(this.cssW, this.cssH) < 520 ? 1.85 : 2.35;
    this.viewH = this.cssH / zoom;
    this.viewW = this.cssW / zoom;
  }

  screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const nx = (clientX - rect.left) / Math.max(1, rect.width);
    const ny = (clientY - rect.top) / Math.max(1, rect.height);
    return { x: this.cx - this.viewW / 2 + nx * this.viewW, y: this.cy - this.viewH / 2 + ny * this.viewH };
  }

  burst(x: number, y: number, n: number, color: string, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.65);
      this.spawn({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.35 + Math.random() * 0.3, max: 0.6, size: 2.2 + Math.random() * 2.4,
        color, kind: 'spark', grav: 0, rot: 0, vr: 0, grow: 0, lit: false,
      });
    }
  }

  confetti(x: number, y: number): void {
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 40 + Math.random() * 160;
      this.spawn({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40,
        life: 0.7, max: 0.7, size: 3 + Math.random() * 3,
        color: FLAGS[i % FLAGS.length]!, kind: 'confetti', grav: 280, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 8, grow: 0, lit: false,
      });
    }
  }

  ring(x: number, y: number, color: string, grow: number): void {
    this.spawn({
      x, y, vx: 0, vy: 0, life: 0.32, max: 0.32, size: 8, color, kind: 'ring', grav: 0, rot: 0, vr: 0, grow, lit: false,
    });
  }

  floater(x: number, y: number, text: string, color: string): void {
    if (this.floaters.length > 28) this.floaters.shift();
    this.floaters.push({ x, y, text, life: 0.75, color });
  }

  flash(x: number, y: number): void {
    if (this.flashes.length < 8) this.flashes.push({ x, y, life: 0.12 });
  }

  render(sim: Sim, dt: number, shake: number, reduce: boolean): void {
    this.time += dt;
    if (this.bakedId !== sim.map.id) {
      this.bakedId = sim.map.id;
      this.cx = sim.player.x;
      this.cy = sim.player.y;
      this.snapped = true;
    }
    this.follow(sim, dt);
    this.stepFx(dt, sim, reduce);
    const ctx = this.ctx;
    const s = this.canvas.width / this.viewW;
    const sh = reduce ? 0 : shake;
    const ox = Math.sin(this.time * 53) * sh;
    const oy = Math.cos(this.time * 47) * sh * 0.65;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#140a18';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(s, 0, 0, s, this.canvas.width / 2 - this.cx * s + ox, this.canvas.height / 2 - this.cy * s + oy);
    ctx.imageSmoothingEnabled = true;
    this.drawVisibleMap(ctx, sim.map);
    this.dynamicGround(ctx, sim);
    this.telegraphs(ctx, sim);
    this.shadows(ctx, sim);
    this.ghostsDraw(ctx, sim);
    this.pickups(ctx, sim);
    this.shots(ctx, sim, true);
    this.bodies(ctx, sim);
    this.shots(ctx, sim, false);
    this.particles(ctx, true);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.lights(sim, shake, reduce);
    ctx.setTransform(s, 0, 0, s, this.canvas.width / 2 - this.cx * s + ox, this.canvas.height / 2 - this.cy * s + oy);
    this.particles(ctx, false);
    this.texts(ctx);
    this.reticle(ctx, sim);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private cap(): number {
    return this.quality === 'low' ? 90 : this.quality === 'med' ? 220 : 420;
  }

  private spawn(src: P): void {
    if (this.live.length >= this.cap()) return;
    const p = this.free.pop();
    if (p) Object.assign(p, src);
    this.live.push(p ?? src);
  }

  private stepFx(dt: number, sim: Sim, reduce: boolean): void {
    if (dt <= 0) return;
    const sp = Math.hypot(sim.player.vx, sim.player.vy);
    if (sim.player.dashT > 0) this.ghosts.push({ x: sim.player.x, y: sim.player.y, life: 0.16 });
    for (const g of this.ghosts) g.life -= dt;
    this.ghosts = this.ghosts.filter((g) => g.life > 0);
    if (!reduce && sp > 40) {
      this.mote -= dt;
      if (this.mote <= 0) {
        this.mote = 0.12;
        this.spawn({
          x: sim.player.x, y: sim.player.y + 8, vx: (Math.random() - 0.5) * 20, vy: -10,
          life: 0.3, max: 0.3, size: 2.4, color: 'rgba(90,50,30,0.45)', kind: 'dust', grav: 0, rot: 0, vr: 0, grow: 0, lit: true,
        });
      }
    }
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        this.free.push(p);
        this.live.splice(i, 1);
        continue;
      }
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.kind === 'ring') p.size += p.grow * dt;
    }
    for (const f of this.floaters) { f.life -= dt; f.y -= 28 * dt; }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    for (const f of this.flashes) f.life -= dt;
    this.flashes = this.flashes.filter((f) => f.life > 0);
  }

  private follow(sim: Sim, dt: number): void {
    const look = 48;
    const tx = sim.player.x + Math.cos(sim.player.facing) * look;
    const ty = sim.player.y + Math.sin(sim.player.facing) * look;
    const k = 1 - Math.exp(-Math.max(0, dt) * 7);
    if (!this.snapped) { this.cx = tx; this.cy = ty; this.snapped = true; }
    else { this.cx += (tx - this.cx) * k; this.cy += (ty - this.cy) * k; }
    const hw = this.viewW / 2;
    const hh = this.viewH / 2;
    if (sim.map.w > this.viewW) this.cx = clamp(this.cx, hw - 40, sim.map.w - hw + 40);
    else this.cx = sim.map.w / 2;
    if (sim.map.h > this.viewH) this.cy = clamp(this.cy, hh - 40, sim.map.h - hh + 40);
    else this.cy = sim.map.h / 2;
  }

  private drawVisibleMap(ctx: CanvasRenderingContext2D, map: MapDef): void {
    const pal = themeInk(map.theme);
    const pad = 64;
    const x0 = Math.max(0, this.cx - this.viewW / 2 - pad);
    const y0 = Math.max(0, this.cy - this.viewH / 2 - pad);
    const x1 = Math.min(map.w, this.cx + this.viewW / 2 + pad);
    const y1 = Math.min(map.h, this.cy + this.viewH / 2 + pad);
    ctx.fillStyle = pal.base;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    const tile = 48;
    const startX = Math.floor(x0 / tile) * tile;
    const startY = Math.floor(y0 / tile) * tile;
    for (let y = startY; y < y1; y += tile) {
      for (let x = startX; x < x1; x += tile) {
        const h = hash(x, y);
        ctx.globalAlpha = 0.28 + h * 0.35;
        ctx.fillStyle = h > 0.66 ? pal.a : h > 0.33 ? pal.b : pal.c;
        ctx.fillRect(x + 2, y + 2, tile - 4, tile - 4);
      }
    }
    ctx.globalAlpha = 1;
    if ((map.theme === 'patio' || map.theme === 'plaza') && x0 < map.w / 2 + 160 && x1 > map.w / 2 - 160) {
      ctx.fillStyle = 'rgba(120, 40, 40, 0.28)';
      ctx.beginPath();
      ctx.ellipse(map.w / 2, map.h * 0.72, 150, 70, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (x0 < 40 || y0 < 40 || x1 > map.w - 40 || y1 > map.h - 40) this.drawBorder(ctx, map, pal.wall);
    for (const b of map.blocks) {
      if (b.x + b.w < x0 || b.x > x1 || b.y + b.h < y0 || b.y > y1) continue;
      this.drawBlock(ctx, b);
    }
    for (const z of map.hazards) this.drawStove(ctx, z.x, z.y, z.w, z.h, 0);
    for (const z of map.pits) {
      if (z.x + z.w < x0 || z.x > x1 || z.y + z.h < y0 || z.y > y1) continue;
      ctx.fillStyle = '#1a120c';
      roundRect(ctx, z.x, z.y, z.w, z.h, 10);
      ctx.fill();
      ctx.strokeStyle = '#f5c542';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (map.stall) this.drawStall(ctx, map.stall.x, map.stall.y, map.stall.w, map.stall.h, '#f5c542', true);
  }

  private drawBorder(ctx: CanvasRenderingContext2D, map: MapDef, wall: string): void {
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, map.w, 36);
    ctx.fillRect(0, map.h - 36, map.w, 36);
    ctx.fillRect(0, 0, 36, map.h);
    ctx.fillRect(map.w - 36, 0, 36, map.h);
    ctx.fillStyle = '#f4e6c8';
    ctx.fillRect(0, 30, map.w, 6);
    ctx.fillRect(0, map.h - 36, map.w, 6);
    ctx.fillRect(30, 0, 6, map.h);
    ctx.fillRect(map.w - 36, 0, 6, map.h);
    ctx.fillStyle = '#ffd59a';
    for (let x = 90; x < map.w - 90; x += 200) {
      ctx.fillRect(x, 8, 26, 16);
      ctx.fillStyle = '#2a1630';
      ctx.fillRect(x + 12, 8, 2, 16);
      ctx.fillStyle = '#ffd59a';
    }
  }

  private drawBlock(ctx: CanvasRenderingContext2D, b: Block): void {
    switch (b.k) {
      case 'fountain': {
        ctx.fillStyle = '#d7c3a4';
        roundRect(ctx, b.x, b.y, b.w, b.h, 18);
        ctx.fill(); ink(ctx, 2);
        ctx.fillStyle = '#2f8fba';
        ctx.beginPath();
        ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w * 0.32, b.h * 0.26, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'planter': {
        ctx.fillStyle = '#c8553d';
        roundRect(ctx, b.x, b.y, b.w, b.h, 8);
        ctx.fill(); ink(ctx);
        ctx.fillStyle = '#3e8f4a';
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(b.x + 22 + i * 30, b.y + 18, 12, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'bench': {
        ctx.fillStyle = '#8a4b2a';
        roundRect(ctx, b.x, b.y, b.w, b.h, 5);
        ctx.fill(); ink(ctx);
        ctx.strokeStyle = '#5c3018';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(b.x + 8, b.y + b.h / 2);
        ctx.lineTo(b.x + b.w - 8, b.y + b.h / 2);
        ctx.stroke();
        break;
      }
      case 'wall': {
        ctx.fillStyle = '#d7a07a';
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = '#f4e6c8';
        ctx.fillRect(b.x, b.y, b.w, 6);
        ink(ctx, 1.5);
        break;
      }
      case 'counter':
      case 'island': {
        ctx.fillStyle = b.k === 'island' ? '#e7c48a' : '#f4e6c8';
        roundRect(ctx, b.x, b.y, b.w, b.h, 6);
        ctx.fill(); ink(ctx);
        ctx.fillStyle = '#6b4634';
        ctx.fillRect(b.x + 4, b.y + 4, b.w - 8, 8);
        break;
      }
      case 'fridge': {
        ctx.fillStyle = '#4fb3a9';
        roundRect(ctx, b.x, b.y, b.w, b.h, 6);
        ctx.fill(); ink(ctx);
        ctx.fillStyle = '#f4e6c8';
        ctx.fillRect(b.x + b.w - 10, b.y + 16, 4, 18);
        break;
      }
      case 'stall':
        this.drawStall(ctx, b.x, b.y, b.w, b.h, b.hue ?? '#e86a8d', false);
        break;
      case 'kiosk': {
        ctx.fillStyle = '#f4e6c8';
        roundRect(ctx, b.x, b.y + 20, b.w, b.h - 20, 4);
        ctx.fill(); ink(ctx);
        ctx.fillStyle = '#c8553d';
        ctx.beginPath();
        ctx.moveTo(b.x - 8, b.y + 24);
        ctx.lineTo(b.x + b.w / 2, b.y);
        ctx.lineTo(b.x + b.w + 8, b.y + 24);
        ctx.closePath();
        ctx.fill(); ink(ctx);
        break;
      }
      case 'tank': {
        ctx.fillStyle = '#8aa0a8';
        roundRect(ctx, b.x, b.y + 16, b.w, b.h - 16, 8);
        ctx.fill(); ink(ctx);
        ctx.fillStyle = '#b7c6cc';
        ctx.beginPath();
        ctx.ellipse(b.x + b.w / 2, b.y + 16, b.w / 2, 14, 0, 0, Math.PI * 2);
        ctx.fill(); ink(ctx);
        break;
      }
      case 'house': {
        ctx.fillStyle = '#d7b08a';
        roundRect(ctx, b.x, b.y, b.w, b.h, 4);
        ctx.fill(); ink(ctx);
        ctx.fillStyle = '#4b2a6b';
        ctx.fillRect(b.x + b.w / 2 - 16, b.y + b.h - 46, 32, 46);
        ctx.fillStyle = '#ffd59a';
        ctx.fillRect(b.x + 16, b.y + 18, 22, 18);
        ctx.fillRect(b.x + b.w - 38, b.y + 18, 22, 18);
        break;
      }
      case 'speaker': {
        ctx.fillStyle = '#1c1220';
        roundRect(ctx, b.x, b.y, b.w, b.h, 6);
        ctx.fill(); ink(ctx);
        ctx.fillStyle = '#3a3044';
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(b.x + b.w / 2, b.y + 36 + i * 64, 22, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#f2a33a';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        break;
      }
      case 'table': {
        ctx.fillStyle = '#f4e6c8';
        roundRect(ctx, b.x, b.y, b.w, b.h, 6);
        ctx.fill(); ink(ctx);
        ctx.fillStyle = '#c8553d';
        ctx.fillRect(b.x + 10, b.y + 8, b.w - 20, 8);
        break;
      }
      case 'statue': {
        ctx.fillStyle = '#d9d0c4';
        roundRect(ctx, b.x, b.y + b.h * 0.45, b.w, b.h * 0.55, 3);
        ctx.fill(); ink(ctx);
        ctx.beginPath();
        ctx.arc(b.x + b.w / 2, b.y + b.h * 0.32, b.w * 0.28, 0, Math.PI * 2);
        ctx.fill(); ink(ctx);
        break;
      }
      default:
        break;
    }
  }

  private drawStall(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, hue: string, star: boolean): void {
    ctx.fillStyle = '#6b4634';
    roundRect(ctx, x, y + 16, w, h - 16, 4);
    ctx.fill();
    ctx.fillStyle = hue;
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 20);
    ctx.lineTo(x + 10, y + 4);
    ctx.lineTo(x + w / 2, y + 18);
    ctx.lineTo(x + w - 10, y + 4);
    ctx.lineTo(x + w + 6, y + 20);
    ctx.closePath();
    ctx.fill(); ink(ctx, 1.6);
    if (star) {
      ctx.fillStyle = '#fff';
      ctx.font = '700 14px "Lilita One", system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('PUESTO', x + w / 2, y + h / 2 + 10);
    }
  }

  private drawStove(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, pulse: number): void {
    ctx.fillStyle = '#2a241f';
    roundRect(ctx, x, y, w, h, 6);
    ctx.fill(); ink(ctx);
    ctx.fillStyle = `rgba(255, ${90 + pulse * 80}, 30, ${0.75 + pulse * 0.2})`;
    ctx.beginPath();
    ctx.arc(x + w * 0.32, y + h * 0.5, 10, 0, Math.PI * 2);
    ctx.arc(x + w * 0.68, y + h * 0.5, 10, 0, Math.PI * 2);
    ctx.fill();
  }

  private dynamicGround(ctx: CanvasRenderingContext2D, sim: Sim): void {
    const map = sim.map;
    ctx.strokeStyle = '#2a1630';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(48, 52);
    ctx.lineTo(map.w - 48, 52);
    ctx.stroke();
    for (let i = 0, x = 64; x < map.w - 48; x += 36, i++) {
      const sway = Math.sin(this.time * 2.2 + i * 0.6) * 3;
      ctx.save();
      ctx.translate(x, 52 + sway);
      ctx.fillStyle = FLAGS[i % FLAGS.length]!;
      ctx.beginPath();
      ctx.moveTo(-11, 0);
      ctx.lineTo(11, 0);
      ctx.lineTo(7, 18);
      ctx.lineTo(0, 12);
      ctx.lineTo(-7, 18);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
    for (const z of map.hazards) this.drawStove(ctx, z.x, z.y, z.w, z.h, pulse);
    const fountain = map.blocks.find((b) => b.k === 'fountain');
    if (fountain) {
      const cx = fountain.x + fountain.w / 2;
      const cy = fountain.y + fountain.h / 2;
      ctx.fillStyle = '#3aa6d0';
      ctx.beginPath();
      ctx.ellipse(cx, cy + Math.sin(this.time * 2) * 1.5, fountain.w * 0.28, fountain.h * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.ellipse(cx - 8, cy - 4, 12, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (map.theme === 'azotea') {
      ctx.strokeStyle = 'rgba(244,230,200,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(360, 240);
      ctx.lineTo(620, 250);
      ctx.moveTo(860, 240);
      ctx.lineTo(1100, 230);
      ctx.stroke();
    }
  }

  private telegraphs(ctx: CanvasRenderingContext2D, sim: Sim): void {
    for (const e of sim.enemies) {
      if (e.dying !== null) continue;
      if (e.kind === 'rey' && e.ring > 0) {
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.ring, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(190, 90, 255, 0.9)';
        ctx.lineWidth = 12;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.arc(e.x, e.y, e.ring + 18, e.safe - 0.52, e.safe + 0.52);
        ctx.closePath();
        ctx.fillStyle = 'rgba(90, 220, 190, 0.32)';
        ctx.fill();
      }
      if (e.breath) {
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r + 16 + Math.sin(this.time * 10) * 3, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(245, 197, 66, 0.9)';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      if (e.state === 'pose') {
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r + 12, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(232, 106, 141, 0.85)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      if (e.state !== 'tele' && e.state !== 'charge') continue;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.aim);
      const alpha = 0.15 + Math.min(1, e.tele) * 0.4;
      if (e.kind === 'repartidor' || e.state === 'charge') {
        ctx.strokeStyle = `rgba(255, 80, 40, ${0.45 + e.tele * 0.5})`;
        ctx.setLineDash([8, 8]);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(e.r, 0);
        ctx.lineTo(260, 0);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        const reach = e.kind === 'soplador' || e.kind === 'pinata' ? 100 : e.kind === 'bocinas' ? 210 : 150;
        const arc = e.kind === 'bocinas' ? 0.48 : 0.65;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, reach, -arc, arc);
        ctx.closePath();
        ctx.fillStyle = `rgba(255, 140, 40, ${alpha})`;
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private shadows(ctx: CanvasRenderingContext2D, sim: Sim): void {
    ctx.fillStyle = 'rgba(30, 12, 20, 0.28)';
    const blob = (x: number, y: number, r: number) => {
      ctx.beginPath();
      ctx.ellipse(x, y + r * 0.75, r * 0.9, r * 0.38, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    blob(sim.player.x, sim.player.y, 16);
    for (const e of sim.enemies) if (e.dying === null || e.dying > 0) blob(e.x, e.y, e.r);
  }

  private ghostsDraw(ctx: CanvasRenderingContext2D, sim: Sim): void {
    for (const g of this.ghosts) {
      ctx.save();
      ctx.globalAlpha = g.life * 2.2;
      drawRosa(ctx, { ...sim.player, x: g.x, y: g.y, swing: 0, charge: 0 }, false);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  private pickups(ctx: CanvasRenderingContext2D, sim: Sim): void {
    for (const p of sim.pickups) {
      const y = p.y + Math.sin(p.bob) * 3;
      const blink = p.life < 3 && Math.sin(this.time * 14) > 0 ? 0.45 : 1;
      ctx.globalAlpha = blink;
      ctx.beginPath();
      ctx.fillStyle = pickupColor(p);
      ctx.arc(p.x, y, 8, 0, Math.PI * 2);
      ctx.fill(); ink(ctx, 1.6);
      ctx.fillStyle = '#fff';
      ctx.font = '700 9px "Lilita One", system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(pickupMark(p), p.x, y + 3);
      ctx.globalAlpha = 1;
    }
  }

  private bodies(ctx: CanvasRenderingContext2D, sim: Sim): void {
    const list: { y: number; draw: () => void }[] = [];
    for (const e of sim.enemies) {
      list.push({ y: e.y, draw: () => drawEnemy(ctx, e, this.time) });
    }
    const chanclas = sim.shots.filter((s) => s.alive && s.kind === 'chancla' && s.team === 'player').length;
    list.push({
      y: sim.player.y,
      draw: () => {
        ctx.strokeStyle = 'rgba(245, 197, 66, 0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sim.player.x, sim.player.y, 26, 0, Math.PI * 2);
        ctx.stroke();
        drawRosa(ctx, sim.player, chanclas < 2 || this.weaponOf(sim) !== 'chancla');
      },
    });
    list.sort((a, b) => a.y - b.y);
    for (const item of list) item.draw();
  }

  private weaponOf(sim: Sim): string {
    return sim.weapons[sim.player.weapon] ?? 'chancla';
  }

  private shots(ctx: CanvasRenderingContext2D, sim: Sim, trails: boolean): void {
    for (const s of sim.shots) {
      if (!s.alive) continue;
      if (trails) this.trail(ctx, s);
      else drawProjectile(ctx, s);
    }
  }

  private trail(ctx: CanvasRenderingContext2D, s: Shot): void {
    if (s.hc < 2) return;
    ctx.beginPath();
    for (let i = s.hc - 1; i >= 0; i--) {
      const idx = (s.hi - i + 8) % 8;
      const x = s.hx[idx] ?? s.x;
      const y = s.hy[idx] ?? s.y;
      if (i === s.hc - 1) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = s.team === 'enemy' ? 'rgba(232,106,141,0.55)' : 'rgba(244,230,200,0.7)';
    ctx.lineWidth = s.kind === 'pesada' ? 7 : 3.5;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  private particles(ctx: CanvasRenderingContext2D, lit: boolean): void {
    for (const p of this.live) {
      if (p.lit !== lit) continue;
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      if (p.kind === 'ring') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.stroke();
      } else if (p.kind === 'confetti') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private texts(ctx: CanvasRenderingContext2D): void {
    ctx.textAlign = 'center';
    ctx.font = '700 16px "Lilita One", system-ui, sans-serif';
    for (const f of this.floaters) {
      ctx.globalAlpha = Math.max(0, f.life / 0.75);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#24141f';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  private reticle(ctx: CanvasRenderingContext2D, sim: Sim): void {
    const x = sim.aimX;
    const y = sim.aimY;
    ctx.strokeStyle = '#f4e6c8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.moveTo(x - 12, y);
    ctx.lineTo(x - 5, y);
    ctx.moveTo(x + 5, y);
    ctx.lineTo(x + 12, y);
    ctx.moveTo(x, y - 12);
    ctx.lineTo(x, y - 5);
    ctx.moveTo(x, y + 5);
    ctx.lineTo(x, y + 12);
    ctx.stroke();
    const c = sim.player.charge;
    if (c > 0.04) {
      ctx.beginPath();
      ctx.strokeStyle = c > 0.92 ? '#f5c542' : '#f2a33a';
      ctx.lineWidth = 3;
      ctx.arc(x, y, 14 + c * 6, -Math.PI / 2, -Math.PI / 2 + c * Math.PI * 2);
      ctx.stroke();
    }
  }

  private lights(sim: Sim, _shake: number, reduce: boolean): void {
    if (reduce && this.quality === 'low') return;
    const down = this.quality === 'high' ? 2 : 3;
    const w = Math.max(1, this.canvas.width >> down);
    const h = Math.max(1, this.canvas.height >> down);
    if (this.light.width !== w || this.light.height !== h) {
      this.light.width = w;
      this.light.height = h;
    }
    const l = this.light.getContext('2d');
    if (!l) return;
    const amb = ambient(sim.map.darkness);
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.fillStyle = amb;
    l.fillRect(0, 0, w, h);
    const sx = w / this.canvas.width;
    const sy = h / this.canvas.height;
    const worldScale = this.canvas.width / this.viewW;
    const toL = (wx: number, wy: number) => {
      const px = this.canvas.width / 2 + (wx - this.cx) * worldScale;
      const py = this.canvas.height / 2 + (wy - this.cy) * worldScale;
      return { x: px * sx, y: py * sy, k: worldScale * sx };
    };
    const lamps = this.quality === 'high' ? sim.map.lights : sim.map.lights.slice(0, this.quality === 'med' ? 4 : 2);
    for (const lamp of lamps) {
      const p = toL(lamp.x, lamp.y);
      const flicker = 0.92 + Math.sin(this.time * 3 + lamp.x) * 0.08;
      wash(l, p.x, p.y, lamp.r * p.k * flicker, lamp.color);
    }
    const pl = toL(sim.player.x, sim.player.y);
    wash(l, pl.x, pl.y, 170 * pl.k, '#fff1d0');
    for (const f of this.flashes) {
      const p = toL(f.x, f.y);
      wash(l, p.x, p.y, 90 * p.k, '#fff');
    }
    this.ctx.globalCompositeOperation = 'multiply';
    this.ctx.drawImage(this.light, 0, 0, this.canvas.width, this.canvas.height);
    this.ctx.globalCompositeOperation = 'source-over';
  }
}

function ambient(darkness: number): string {
  const v = Math.round(214 - darkness * 150);
  return `rgb(${Math.round(v * 0.86)},${Math.round(v * 0.64)},${Math.round(v * 0.98)})`;
}

function wash(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, r));
  g.addColorStop(0, '#fff6e4');
  g.addColorStop(0.42, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function pickupColor(p: Pickup): string {
  switch (p.kind) {
    case 'cafe': return '#6b3a22';
    case 'chile': return '#c8553d';
    case 'agua': return '#4fb3a9';
    case 'rebozo': return '#e86a8d';
    case 'micro': return '#f5c542';
  }
}

function pickupMark(p: Pickup): string {
  switch (p.kind) {
    case 'cafe': return 'C';
    case 'chile': return '+';
    case 'agua': return 'A';
    case 'rebozo': return 'R';
    case 'micro': return 'M';
  }
}

function drawRosa(ctx: CanvasRenderingContext2D, p: Player, shoe: boolean): void {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(1.45, 1.45);
  const bob = Math.sin(p.phase) * 1.4;
  ctx.rotate(p.facing);
  ctx.translate(bob * 0.2, 0);
  if (p.invuln > 0 && Math.sin(p.invuln * 40) > 0) ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#4b2a6b';
  ctx.beginPath();
  ctx.ellipse(-2, 0, 16, 12.5, 0, 0, Math.PI * 2);
  ctx.fill(); ink(ctx);
  ctx.fillStyle = '#f4e6c8';
  for (const [dx, dy] of [[-8, -4], [-2, 2], [4, -3], [6, 4], [-6, 5]] as const) {
    ctx.beginPath();
    ctx.arc(dx, dy, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#c68a5e';
  ctx.beginPath();
  ctx.arc(10, 0, 9, 0, Math.PI * 2);
  ctx.fill(); ink(ctx, 1.8);
  ctx.fillStyle = '#2a1630';
  ctx.beginPath();
  ctx.arc(3, -1, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f2a33a';
  ctx.beginPath();
  ctx.arc(5, -7, 3.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#241626';
  ctx.fillRect(12, -3.2, 6.5, 3.4);
  ctx.strokeStyle = '#4fb3a9';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(8, -1);
  ctx.lineTo(12, -1);
  ctx.stroke();
  ctx.save();
  ctx.translate(4, 7);
  ctx.rotate(p.swing * 0.8);
  ctx.strokeStyle = '#c68a5e';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(12, 6);
  ctx.stroke();
  if (shoe) drawChancla(ctx, 14, 8, -0.4 + p.charge, 0.55, p.charge > 0.92 ? '#f5c542' : '#4b2a6b');
  ctx.restore();
  ctx.restore();
}

function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, time: number): void {
  const face = Math.hypot(e.vx, e.vy) > 8 && e.state === 'move' ? Math.atan2(e.vy, e.vx) : e.aim;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.scale(e.kind === 'rey' ? 1.05 : 1.4, e.kind === 'rey' ? 1.05 : 1.4);
  if (e.dying !== null) {
    const t = Math.max(0.05, e.dying / 0.42);
    ctx.scale(t, t);
    ctx.rotate((1 - t) * 3);
  }
  ctx.rotate(face);
  if (e.hurt > 0) ctx.globalAlpha = 0.75;
  switch (e.kind) {
    case 'bocinas':
      body(ctx, '#5b3d8a');
      ctx.fillStyle = '#1c1220';
      roundRect(ctx, 2, -10, 18, 20, 4);
      ctx.fill(); ink(ctx, 1.5);
      ctx.fillStyle = '#c9b6ff';
      ctx.beginPath();
      ctx.arc(12, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'influencer':
      body(ctx, '#e86a8d');
      head(ctx, '#f2c1a0');
      ctx.fillStyle = '#241626';
      ctx.fillRect(12, -3, 7, 3);
      if (e.state === 'pose') {
        ctx.fillStyle = '#d7dde6';
        roundRect(ctx, 8, -16, 8, 12, 2);
        ctx.fill();
      }
      break;
    case 'soplador':
      body(ctx, '#f2a33a');
      head(ctx, '#c68a5e');
      ctx.fillStyle = '#6b4634';
      ctx.beginPath();
      ctx.moveTo(12, -4);
      ctx.lineTo(28, 0);
      ctx.lineTo(12, 4);
      ctx.closePath();
      ctx.fill();
      break;
    case 'chismosa':
      body(ctx, '#4fb3a9');
      ctx.fillStyle = '#1d6e68';
      ctx.beginPath();
      ctx.arc(6, -2, 12, 0, Math.PI * 2);
      ctx.fill();
      head(ctx, '#e0b090');
      break;
    case 'repartidor':
      ctx.fillStyle = '#e07030';
      roundRect(ctx, -16, -8, 22, 16, 4);
      ctx.fill(); ink(ctx, 1.5);
      ctx.fillStyle = '#24141f';
      ctx.beginPath();
      ctx.arc(-8, 8, 5, 0, Math.PI * 2);
      ctx.arc(10, 8, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f5c542';
      ctx.fillRect(-4, -14, 12, 10);
      break;
    case 'pinata': {
      ctx.fillStyle = '#f5c542';
      ctx.beginPath();
      ctx.ellipse(0, 2, 16, 18, 0, 0, Math.PI * 2);
      ctx.fill(); ink(ctx);
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = FLAGS[i]!;
        ctx.fillRect(-12 + i * 4, 8, 3, 8 + Math.sin(time * 8 + i) * 2);
      }
      break;
    }
    case 'vecina':
      body(ctx, '#7eb6ff');
      head(ctx, '#c68a5e');
      ctx.strokeStyle = '#4fb3a9';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(8, 4);
      ctx.quadraticCurveTo(20, 10, 26, 2);
      ctx.stroke();
      break;
    case 'rumor':
      ctx.fillStyle = '#f0a0cc';
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill(); ink(ctx, 1.4);
      break;
    case 'rey':
      ctx.fillStyle = '#1c1220';
      roundRect(ctx, -30, -34, 60, 68, 8);
      ctx.fill(); ink(ctx, 2.5);
      ctx.strokeStyle = '#f2a33a';
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(0, -18 + i * 20, 10, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#f5c542';
      ctx.beginPath();
      ctx.moveTo(-16, -40);
      ctx.lineTo(-10, -28);
      ctx.lineTo(-4, -40);
      ctx.lineTo(2, -28);
      ctx.lineTo(8, -40);
      ctx.lineTo(14, -28);
      ctx.lineTo(18, -40);
      ctx.lineTo(18, -26);
      ctx.lineTo(-16, -26);
      ctx.closePath();
      ctx.fill();
      if (e.breath) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(-8, 8, 16, 8);
      }
      break;
    default:
      break;
  }
  ctx.restore();
  if (e.dying === null && e.hp < e.maxHp && e.kind !== 'rumor') {
    const w = e.kind === 'rey' ? 46 : 26;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(e.x - w / 2, e.y - e.r - 14, w, 4);
    ctx.fillStyle = e.breath ? '#f5c542' : '#f4e6c8';
    ctx.fillRect(e.x - w / 2, e.y - e.r - 14, w * clamp(e.hp / e.maxHp, 0, 1), 4);
  }
}

function body(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(-2, 0, 13, 11, 0, 0, Math.PI * 2);
  ctx.fill(); ink(ctx, 1.7);
}

function head(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(8, -1, 7, 0, Math.PI * 2);
  ctx.fill(); ink(ctx, 1.5);
  ctx.fillStyle = '#2a1630';
  ctx.beginPath();
  ctx.arc(4, -3, 4.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawChancla(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number, scale: number, sole: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(scale, scale);
  ctx.fillStyle = sole;
  ctx.beginPath();
  ctx.ellipse(0, 0, 16, 8, 0, 0, Math.PI * 2);
  ctx.fill(); ink(ctx, 1.4);
  ctx.fillStyle = '#4fb3a9';
  ctx.fillRect(-2, -7, 5, 14);
  ctx.restore();
}

function drawProjectile(ctx: CanvasRenderingContext2D, s: Shot): void {
  if (s.kind === 'heart') {
    ctx.fillStyle = '#e86a8d';
    ctx.beginPath();
    ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (s.kind === 'vinyl') {
    ctx.fillStyle = '#161018';
    ctx.beginPath();
    ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f2a33a';
    ctx.beginPath();
    ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (s.kind === 'hose') {
    ctx.fillStyle = '#7ec8ff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const sole = s.kind === 'legend' ? '#f5c542' : s.kind === 'pesada' ? '#6b4634' : s.kind === 'huarache' ? '#c9844a' : s.kind === 'tacon' ? '#c8553d' : '#4b2a6b';
  const sc = s.kind === 'pesada' ? 0.95 : s.kind === 'legend' ? 0.7 : 0.62;
  drawChancla(ctx, s.x, s.y, s.spin, sc, sole);
}
