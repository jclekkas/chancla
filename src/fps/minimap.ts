// The arena minimap: a compact fixed-orientation overview in the HUD and the
// full-size map behind the pause menu's Map button. Fixed orientation (+x
// right, -z up, see minimap-layout.ts), drawn on 2D canvases: the map itself
// (walls, low cover, raised floors, overhead outlines) is generated from the
// map's boxes once per map and size and cached offscreen; each update only
// blits it and draws a handful of markers (you, living teammates, cafecitos).
// Opponents are never drawn. Arena maps only: Campaign and Arcade do not use it.
import './minimap.css';
import type { MapData } from '../../shared/map';
import { arrowDir, layoutOf, miniAspect, miniScale, toMini, type MiniKind, type MiniLayout } from './minimap-layout';

export { arrowDir, classifyBox, layoutOf, miniAspect, teammateMarkers, toMini, LOW_TOP, OVER_BOTTOM } from './minimap-layout';
export type { MiniKind, MiniLayout, MiniRect } from './minimap-layout';

export interface MiniMarkers {
  /** team: your team (0 Sol, 1 Luna) for the arrow's colour; Sol's when unknown. */
  me: { x: number; z: number; yaw: number; alive: boolean; team?: number | null };
  mates: Array<{ id: number; x: number; z: number }>; // living teammates only (never enemies)
  pickups: Array<{ x: number; z: number; ready: boolean }>;
}

export interface MiniLegend { you: string; mate: string; cafe: string; cafeOff: string; wall: string; low: string; over: string; raised?: string }

export const TEAM_COLORS = ['#f29a2e', '#36b9c9'] as const;
const INK = '#241626';
const PAL = {
  bg: 'rgba(36, 22, 38, 0.72)',
  floor: '#c9a27a',
  floorEdge: 'rgba(244, 230, 200, 0.55)',
  wall: '#4b2a6b',
  wallEdge: '#2e1846',
  low: '#e8d3a6',
  lowEdge: 'rgba(36, 22, 38, 0.55)',
  raised: '#a87c55',
  raisedEdge: 'rgba(244, 230, 200, 0.55)',
  over: 'rgba(244, 230, 200, 0.85)',
  cafe: '#f2a33a',
  cafeOff: 'rgba(255, 255, 255, 0.85)',
  cafeOffFill: 'rgba(36, 22, 38, 0.45)',
};
/** Compact markers redraw at most this often (ms): about 15 Hz. */
const FRAME_MS = 66;
const MAX_DPR = 2;

/** Draws the static layer for a layout into ctx at w x h css px (ctx already scaled to device pixels). */
function drawStatic(ctx: CanvasRenderingContext2D, L: MiniLayout, w: number, h: number, big: boolean): void {
  const { k } = miniScale(L, w, h);
  const rect = (r: { minX: number; minZ: number; maxX: number; maxZ: number }) => {
    const a = toMini(L, r.minX, r.minZ, w, h), b = toMini(L, r.maxX, r.maxZ, w, h);
    return [a.u, a.v, b.u - a.u, b.v - a.v] as const;
  };
  ctx.clearRect(0, 0, w, h);
  const [fx, fy, fw, fh] = rect(L.bounds);
  ctx.fillStyle = PAL.floor;
  ctx.fillRect(fx, fy, fw, fh);
  const line = Math.max(0.75, k * (big ? 0.08 : 0.12));
  const style: Record<MiniKind, [string, string]> = {
    raised: [PAL.raised, PAL.raisedEdge], low: [PAL.low, PAL.lowEdge], wall: [PAL.wall, PAL.wallEdge], over: ['', PAL.over],
  };
  for (const r of L.rects) {
    const [x, y, rw, rh] = rect(r);
    const [fill, edge] = style[r.kind];
    if (r.kind === 'over') {
      // Walk-under geometry: a dashed outline, never a solid wall.
      ctx.save();
      ctx.setLineDash([Math.max(2, k * 0.5), Math.max(1.5, k * 0.35)]);
      ctx.strokeStyle = edge;
      ctx.lineWidth = line;
      ctx.strokeRect(x + line / 2, y + line / 2, Math.max(0, rw - line), Math.max(0, rh - line));
      ctx.restore();
      continue;
    }
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, rw, rh);
    if (big || r.kind !== 'wall') {
      ctx.strokeStyle = edge;
      ctx.lineWidth = line * 0.8;
      ctx.strokeRect(x, y, rw, rh);
    }
  }
  ctx.strokeStyle = PAL.floorEdge;
  ctx.lineWidth = 1;
  ctx.strokeRect(fx + 0.5, fy + 0.5, fw - 1, fh - 1);
}

function cupMarker(ctx: CanvasRenderingContext2D, u: number, v: number, r: number, ready: boolean): void {
  ctx.beginPath();
  ctx.arc(u, v, r, 0, Math.PI * 2);
  if (ready) {
    ctx.fillStyle = PAL.cafe;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.35);
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    // A tiny cup: body and handle.
    ctx.fillStyle = INK;
    ctx.fillRect(u - r * 0.42, v - r * 0.3, r * 0.7, r * 0.6);
    ctx.fillRect(u + r * 0.28, v - r * 0.15, r * 0.22, r * 0.3);
  } else {
    ctx.fillStyle = PAL.cafeOffFill;
    ctx.fill();
    ctx.save();
    ctx.setLineDash([Math.max(1.5, r * 0.5), Math.max(1.5, r * 0.45)]);
    ctx.lineWidth = Math.max(1, r * 0.3);
    ctx.strokeStyle = PAL.cafeOff;
    ctx.stroke();
    ctx.restore();
  }
}

function mateMarker(ctx: CanvasRenderingContext2D, u: number, v: number, r: number, color: string): void {
  ctx.beginPath();
  ctx.arc(u, v, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.4);
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function meMarker(ctx: CanvasRenderingContext2D, u: number, v: number, s: number, yaw: number, color: string, alive: boolean): void {
  const { du, dv } = arrowDir(yaw);
  // Perpendicular, for the arrow's back corners.
  const pu = -dv, pv = du;
  ctx.save();
  ctx.globalAlpha = alive ? 1 : 0.45;
  ctx.beginPath();
  ctx.moveTo(u + du * s * 1.25, v + dv * s * 1.25);
  ctx.lineTo(u - du * s * 0.8 + pu * s * 0.85, v - dv * s * 0.8 + pv * s * 0.85);
  ctx.lineTo(u - du * s * 0.35, v - dv * s * 0.35);
  ctx.lineTo(u - du * s * 0.8 - pu * s * 0.85, v - dv * s * 0.8 - pv * s * 0.85);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, s * 0.45);
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(0.75, s * 0.12);
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
}

/** Markers on top of a static layer. Sizes in css px; `unit` scales them. */
function drawMarkers(ctx: CanvasRenderingContext2D, L: MiniLayout, w: number, h: number, m: MiniMarkers, unit: number): void {
  const team = m.me.team === 1 ? 1 : 0;
  const color = TEAM_COLORS[team];
  for (const p of m.pickups) { const q = toMini(L, p.x, p.z, w, h); cupMarker(ctx, q.u, q.v, 3.6 * unit, p.ready); }
  for (const p of m.mates) { const q = toMini(L, p.x, p.z, w, h); mateMarker(ctx, q.u, q.v, 2.8 * unit, color); }
  const q = toMini(L, m.me.x, m.me.z, w, h);
  meMarker(ctx, q.u, q.v, 4.4 * unit, m.me.yaw, color, m.me.alive);
}

interface Layer { canvas: HTMLCanvasElement; key: string }

function sizeCanvas(c: HTMLCanvasElement, w: number, h: number): number {
  const dpr = Math.min(MAX_DPR, Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
  const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
  if (c.width !== pw) c.width = pw;
  if (c.height !== ph) c.height = ph;
  return dpr;
}

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private layout: MiniLayout | null = null;
  private title = '';
  private compact: Layer | null = null;
  private expanded: Layer | null = null;
  private visible = false;
  private last: MiniMarkers | null = null;
  private lastDraw = -1e9;
  private dirty = true;
  private size = { w: 0, h: 0 };
  private ro: ResizeObserver | null = null;
  private tapId = -1;
  private off: Array<() => void> = [];

  constructor(private root: HTMLElement, private opts: { onTap?: () => void } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'mm-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    root.hidden = true;
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => { this.dirty = true; this.redraw(); });
      this.ro.observe(root);
    }
    const on = <E extends Event>(el: EventTarget, ev: string, f: (e: E) => void, o?: AddEventListenerOptions) => {
      el.addEventListener(ev, f as EventListener, o);
      this.off.push(() => el.removeEventListener(ev, f as EventListener, o));
    };
    const onResize = () => { this.dirty = true; };
    on(window, 'resize', onResize);
    on(window, 'orientationchange', onResize);
    if (opts.onTap) {
      root.classList.add('tappable');
      root.setAttribute('role', 'button');
      // A finger on the map opens it: it never also attacks, aims or moves.
      on<PointerEvent>(root, 'pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (this.tapId !== -1) return;
        this.tapId = e.pointerId;
        try { root.setPointerCapture(e.pointerId); } catch { /* not capturable: up still arrives here */ }
      }, { passive: false });
      on<PointerEvent>(root, 'pointerup', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (e.pointerId !== this.tapId) return;
        this.tapId = -1;
        if (this.visible) this.opts.onTap?.();
      });
      const cancel = (e: PointerEvent) => { if (e.pointerId === this.tapId) this.tapId = -1; };
      on<PointerEvent>(root, 'pointercancel', cancel);
      on<PointerEvent>(root, 'lostpointercapture', cancel);
      // Long press and double tap: no callout, no zoom, no selection.
      for (const ev of ['touchstart', 'touchend', 'contextmenu', 'click']) on<Event>(root, ev, (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
    }
  }

  /** Builds the map's static layer (cached per map and canvas size). */
  setMap(map: MapData, title: string): void {
    this.layout = layoutOf(map);
    this.title = title;
    this.root.style.setProperty('--mm-ar', miniAspect(this.layout).toFixed(4));
    this.root.dataset.map = this.layout.id;
    this.compact = null;
    this.expanded = null;
    this.dirty = true;
    this.lastDraw = -1e9;
  }

  /** Cheap: keeps the newest markers and redraws them at about 15 Hz while visible. */
  update(m: MiniMarkers): void {
    this.last = m;
    if (!this.visible || !this.layout) return;
    const now = performance.now();
    if (now - this.lastDraw < FRAME_MS) return;
    this.lastDraw = now;
    this.redraw();
  }

  setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    this.root.hidden = !on;
    this.root.closest('.hud')?.classList.toggle('has-minimap', on);
    if (on) { this.dirty = true; this.lastDraw = -1e9; this.redraw(); }
    else this.tapId = -1;
  }

  private redraw(): void {
    const ctx = this.ctx, L = this.layout;
    if (!ctx || !L || !this.visible) return;
    if (this.dirty) {
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      if (!w || !h) return;
      this.size = { w, h };
      this.dirty = false;
    }
    const { w, h } = this.size;
    const dpr = sizeCanvas(this.canvas, w, h);
    const key = `${L.id}:${this.canvas.width}x${this.canvas.height}`;
    if (!this.compact || this.compact.key !== key) this.compact = this.bake(L, w, h, dpr, key, false, this.compact?.canvas);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.compact.canvas, 0, 0);
    if (!this.last) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMarkers(ctx, L, w, h, this.last, w < 130 ? 0.85 : 1);
  }

  private bake(L: MiniLayout, w: number, h: number, dpr: number, key: string, big: boolean, reuse?: HTMLCanvasElement): Layer {
    const c = reuse ?? document.createElement('canvas');
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    if (g) { g.setTransform(dpr, 0, 0, dpr, 0, 0); drawStatic(g, L, w, h, big); }
    return { canvas: c, key };
  }

  /**
   * The full map (pause menu): sizes `canvas` to its css box, draws the map,
   * the markers and a legend strip along the bottom, and names the map in
   * the enclosing section's `.map-name`, if there is one.
   */
  drawExpanded(canvas: HTMLCanvasElement, m: MiniMarkers, legend: MiniLegend): void {
    const L = this.layout;
    if (!L) return;
    const section = canvas.closest('section');
    const name = section?.querySelector<HTMLElement>('.map-name');
    if (name && name.textContent !== this.title) name.textContent = this.title;
    const ar = miniAspect(L).toFixed(4);
    if (canvas.style.getPropertyValue('--mm-ar') !== ar) {
      canvas.style.setProperty('--mm-ar', ar);
      canvas.style.aspectRatio = (Number(ar) * 0.86).toFixed(4);
    }
    const w = canvas.clientWidth, totalH = canvas.clientHeight;
    const ctx = canvas.getContext('2d');
    if (!w || !totalH || !ctx) return;
    const legendH = Math.min(64, Math.max(30, totalH * 0.14));
    const h = totalH - legendH;
    const dpr = sizeCanvas(canvas, w, totalH);
    const key = `${L.id}:${Math.round(w * dpr)}x${Math.round(h * dpr)}`;
    if (!this.expanded || this.expanded.key !== key) this.expanded = this.bake(L, w, h, dpr, key, true, this.expanded?.canvas);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.expanded.canvas, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const unit = Math.max(1.6, Math.min(3, w / 260));
    drawMarkers(ctx, L, w, h, m, unit);
    this.drawLegend(ctx, 0, h, w, legendH, legend, m.me.team === 1 ? 1 : 0, unit);
  }

  private drawLegend(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, lg: MiniLegend, team: 0 | 1, unit: number): void {
    const color = TEAM_COLORS[team];
    const font = Math.round(Math.max(11, Math.min(15, h * 0.32)));
    ctx.font = `800 ${font}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textBaseline = 'middle';
    const sw = font * 1.1;
    const items: Array<[string, (u: number, v: number) => void]> = [
      [lg.you, (u, v) => meMarker(ctx, u, v, Math.min(4.4 * unit, sw * 0.42), -Math.PI / 2, color, true)],
      [lg.mate, (u, v) => mateMarker(ctx, u, v, Math.min(2.8 * unit, sw * 0.32), color)],
      [lg.cafe, (u, v) => cupMarker(ctx, u, v, Math.min(3.6 * unit, sw * 0.42), true)],
      [lg.cafeOff, (u, v) => cupMarker(ctx, u, v, Math.min(3.6 * unit, sw * 0.42), false)],
      [lg.wall, (u, v) => { ctx.fillStyle = PAL.wall; ctx.fillRect(u - sw / 2, v - sw / 3, sw, sw * 0.66); }],
      [lg.low, (u, v) => { ctx.fillStyle = PAL.low; ctx.fillRect(u - sw / 2, v - sw / 3, sw, sw * 0.66); ctx.strokeStyle = PAL.lowEdge; ctx.lineWidth = 1; ctx.strokeRect(u - sw / 2, v - sw / 3, sw, sw * 0.66); }],
      ...(lg.raised ? [[lg.raised, (u: number, v: number) => { ctx.fillStyle = PAL.raised; ctx.fillRect(u - sw / 2, v - sw / 3, sw, sw * 0.66); }] as [string, (u: number, v: number) => void]] : []),
      [lg.over, (u, v) => { ctx.save(); ctx.setLineDash([3, 2]); ctx.strokeStyle = PAL.over; ctx.lineWidth = 1.5; ctx.strokeRect(u - sw / 2, v - sw / 3, sw, sw * 0.66); ctx.restore(); }],
    ];
    const gap = font * 0.9, pad = 6;
    const widths = items.map(([label]) => sw + 6 + ctx.measureText(label).width);
    // Rows: as many items as fit, centred.
    const rows: number[][] = [[]];
    let used = 0;
    widths.forEach((iw, i) => {
      const row = rows[rows.length - 1]!;
      if (row.length && used + gap + iw > w - pad * 2) { rows.push([i]); used = iw; } else { row.push(i); used += (row.length > 1 ? gap : 0) + iw; }
    });
    const rh = Math.min(h / rows.length, font * 1.7);
    const top = y0 + (h - rh * rows.length) / 2;
    rows.forEach((row, r) => {
      const rowW = row.reduce((s, i, k) => s + widths[i]! + (k ? gap : 0), 0);
      let u = x0 + (w - rowW) / 2;
      const v = top + rh * (r + 0.5);
      for (const i of row) {
        const [label, icon] = items[i]!;
        icon(u + sw / 2, v);
        ctx.fillStyle = '#f4e6c8';
        ctx.fillText(label, u + sw + 6, v + 0.5);
        u += widths[i]! + gap;
      }
    });
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off = [];
    this.ro?.disconnect();
    this.ro = null;
    this.root.closest('.hud')?.classList.remove('has-minimap');
    this.canvas.remove();
    // Release the backing stores now rather than at collection.
    for (const l of [this.compact, this.expanded]) if (l) { l.canvas.width = 0; l.canvas.height = 0; }
    this.canvas.width = 0; this.canvas.height = 0;
    this.compact = this.expanded = null;
    this.layout = null;
    this.last = null;
  }
}
