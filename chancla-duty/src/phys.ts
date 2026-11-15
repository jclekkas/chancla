// Tiny collision helpers. No allocations on the hot path beyond the result object
// the caller already owns when it cares; the MTV helpers return a small object
// only on overlap, which is rare compared to the rejected tests.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function wrapAngle(a: number): number {
  const t = Math.PI * 2;
  a = a % t;
  if (a > Math.PI) a -= t;
  else if (a < -Math.PI) a += t;
  return a;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Minimum translation to push a circle out of a rect. Null when separated. */
export function circleMtv(
  cx: number,
  cy: number,
  rad: number,
  rect: Rect,
): { x: number; y: number } | null {
  const nearestX = clamp(cx, rect.x, rect.x + rect.w);
  const nearestY = clamp(cy, rect.y, rect.y + rect.h);
  let dx = cx - nearestX;
  let dy = cy - nearestY;
  const d2 = dx * dx + dy * dy;
  if (d2 > rad * rad) return null;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    const push = (rad - d) / d;
    return { x: dx * push, y: dy * push };
  }
  const left = cx - rect.x;
  const right = rect.x + rect.w - cx;
  const top = cy - rect.y;
  const bot = rect.y + rect.h - cy;
  const min = Math.min(left, right, top, bot);
  if (min === left) return { x: -(left + rad), y: 0 };
  if (min === right) return { x: right + rad, y: 0 };
  if (min === top) return { x: 0, y: -(top + rad) };
  return { x: 0, y: bot + rad };
}

export interface MoveBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

/**
 * Axis-separated slide. Zeroes only the velocity component that ran into a wall
 * so grazing a surface keeps the rest of the motion.
 */
export function moveCircle(b: MoveBody, dt: number, rects: readonly Rect[], boundsW: number, boundsH: number): void {
  b.x += b.vx * dt;
  for (let pass = 0; pass < 2; pass++) {
    for (const r of rects) {
      const m = circleMtv(b.x, b.y, b.r, r);
      if (!m) continue;
      if (Math.abs(m.x) >= Math.abs(m.y)) {
        b.x += m.x;
        b.vx = 0;
      }
    }
  }
  b.y += b.vy * dt;
  for (let pass = 0; pass < 2; pass++) {
    for (const r of rects) {
      const m = circleMtv(b.x, b.y, b.r, r);
      if (!m) continue;
      if (Math.abs(m.y) >= Math.abs(m.x)) {
        b.y += m.y;
        b.vy = 0;
      }
    }
  }
  if (b.x < b.r) { b.x = b.r; b.vx = 0; }
  if (b.y < b.r) { b.y = b.r; b.vy = 0; }
  if (b.x > boundsW - b.r) { b.x = boundsW - b.r; b.vx = 0; }
  if (b.y > boundsH - b.r) { b.y = boundsH - b.r; b.vy = 0; }
}

export function reflect(vx: number, vy: number, nx: number, ny: number, rest = 0.86): { vx: number; vy: number } {
  const dot = vx * nx + vy * ny;
  return { vx: (vx - 2 * dot * nx) * rest, vy: (vy - 2 * dot * ny) * rest };
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
}

function segSeg(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

export function segHitsRect(x0: number, y0: number, x1: number, y1: number, r: Rect): boolean {
  if (x0 >= r.x && x0 <= r.x + r.w && y0 >= r.y && y0 <= r.y + r.h) return true;
  if (x1 >= r.x && x1 <= r.x + r.w && y1 >= r.y && y1 <= r.y + r.h) return true;
  const x2 = r.x + r.w;
  const y2 = r.y + r.h;
  return (
    segSeg(x0, y0, x1, y1, r.x, r.y, x2, r.y) ||
    segSeg(x0, y0, x1, y1, x2, r.y, x2, y2) ||
    segSeg(x0, y0, x1, y1, x2, y2, r.x, y2) ||
    segSeg(x0, y0, x1, y1, r.x, y2, r.x, r.y)
  );
}

export function blocked(x0: number, y0: number, x1: number, y1: number, rects: readonly Rect[]): boolean {
  for (const r of rects) if (segHitsRect(x0, y0, x1, y1, r)) return true;
  return false;
}
