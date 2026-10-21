// Lightweight collision: axis-aligned boxes for the world, capsules and
// spheres for characters, and swept segments for anything that moves fast.

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  // Chanclas ricochet off boxes that allow it.
  bounce: boolean;
  // Blocks sound-wave attacks and line of sight.
  blocksSound: boolean;
  tag: string;
}

export function box(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  tag = 'solid',
  bounce = true,
  blocksSound = true,
): AABB {
  return { minX, minY, minZ, maxX, maxY, maxZ, tag, bounce, blocksSound };
}

export interface SegmentHit {
  t: number;
  nx: number;
  ny: number;
  nz: number;
}

const EPS = 1e-9;

// Swept segment p0->p1 against a box inflated by `r`. Returns the first
// entry time in [0,1] with the face normal. Segments that start inside the
// box are ignored so a projectile can always leave a surface.
export function segmentAABB(p0: Vec3Like, p1: Vec3Like, b: AABB, r: number, out: SegmentHit): boolean {
  const minX = b.minX - r, minY = b.minY - r, minZ = b.minZ - r;
  const maxX = b.maxX + r, maxY = b.maxY + r, maxZ = b.maxZ + r;
  if (
    p0.x > minX && p0.x < maxX &&
    p0.y > minY && p0.y < maxY &&
    p0.z > minZ && p0.z < maxZ
  ) {
    return false;
  }
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  let tmin = 0, tmax = 1;
  let nx = 0, ny = 0, nz = 0;

  // X slab
  if (Math.abs(dx) < EPS) {
    if (p0.x < minX || p0.x > maxX) return false;
  } else {
    const inv = 1 / dx;
    let t1 = (minX - p0.x) * inv, t2 = (maxX - p0.x) * inv;
    let n = -1;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = n; ny = 0; nz = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  // Y slab
  if (Math.abs(dy) < EPS) {
    if (p0.y < minY || p0.y > maxY) return false;
  } else {
    const inv = 1 / dy;
    let t1 = (minY - p0.y) * inv, t2 = (maxY - p0.y) * inv;
    let n = -1;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = n; nz = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  // Z slab
  if (Math.abs(dz) < EPS) {
    if (p0.z < minZ || p0.z > maxZ) return false;
  } else {
    const inv = 1 / dz;
    let t1 = (minZ - p0.z) * inv, t2 = (maxZ - p0.z) * inv;
    let n = -1;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = 0; nz = n; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  if (nx === 0 && ny === 0 && nz === 0) return false;
  out.t = tmin;
  out.nx = nx;
  out.ny = ny;
  out.nz = nz;
  return true;
}

// Closest points between segments p1q1 and p2q2 (Ericson, RTCD 5.1.9).
// Returns squared distance; s and t are written to `st`.
export function closestSegSeg(
  p1: Vec3Like, q1: Vec3Like, p2: Vec3Like, q2: Vec3Like, st: { s: number; t: number },
): number {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s = 0, t = 0;
  if (a <= EPS && e <= EPS) {
    s = 0; t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); }
      else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  st.s = s;
  st.t = t;
  const cx = p1.x + d1x * s - (p2.x + d2x * t);
  const cy = p1.y + d1y * s - (p2.y + d2y * t);
  const cz = p1.z + d1z * s - (p2.z + d2z * t);
  return cx * cx + cy * cy + cz * cz;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

const stTmp = { s: 0, t: 0 };
const capA = { x: 0, y: 0, z: 0 };
const capB = { x: 0, y: 0, z: 0 };

// Swept sphere (radius r) along p0->p1 against a vertical capsule standing at
// (cx, cz) between heights y0 and y1 with radius cr. Returns hit time or -1.
export function segmentCapsule(
  p0: Vec3Like, p1: Vec3Like, r: number,
  cx: number, cz: number, y0: number, y1: number, cr: number,
): number {
  capA.x = cx; capA.y = y0; capA.z = cz;
  capB.x = cx; capB.y = y1; capB.z = cz;
  const d2 = closestSegSeg(p0, p1, capA, capB, stTmp);
  const rr = r + cr;
  if (d2 > rr * rr) return -1;
  return stTmp.s;
}

// Swept sphere against a sphere: returns first contact time in [0,1] or -1.
export function segmentSphere(p0: Vec3Like, p1: Vec3Like, r: number, c: Vec3Like, cr: number): number {
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const fx = p0.x - c.x, fy = p0.y - c.y, fz = p0.z - c.z;
  const R = r + cr;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const cc = fx * fx + fy * fy + fz * fz - R * R;
  if (cc <= 0) return -1; // starting inside: let it leave
  if (a < EPS) return -1;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

// Pushes a circle (x,z,radius) out of every box that reaches ground level.
// Returns the corrected position in `out`. Used by the player and enemies.
export function resolveCircle(
  x: number, z: number, radius: number, boxes: readonly AABB[], out: { x: number; z: number },
  maxStepHeight = 0.35,
): void {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const b of boxes) {
      if (b.maxY <= maxStepHeight || b.minY > 1.8) continue;
      const qx = x < b.minX ? b.minX : x > b.maxX ? b.maxX : x;
      const qz = z < b.minZ ? b.minZ : z > b.maxZ ? b.maxZ : z;
      const dx = x - qx, dz = z - qz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > EPS) {
        const d = Math.sqrt(d2);
        const push = radius - d;
        x += (dx / d) * push;
        z += (dz / d) * push;
      } else {
        // Centre inside the box: leave by the shortest exit.
        const left = x - b.minX + radius, right = b.maxX - x + radius;
        const back = z - b.minZ + radius, front = b.maxZ - z + radius;
        const m = Math.min(left, right, back, front);
        if (m === left) x = b.minX - radius;
        else if (m === right) x = b.maxX + radius;
        else if (m === back) z = b.minZ - radius;
        else z = b.maxZ + radius;
      }
      moved = true;
    }
    if (!moved) break;
  }
  out.x = x;
  out.z = z;
}

const losHit: SegmentHit = { t: 0, nx: 0, ny: 0, nz: 0 };

// True when nothing in `boxes` (matching the filter) blocks a->b.
export function lineOfSight(
  a: Vec3Like, b: Vec3Like, boxes: readonly AABB[], filter: (bx: AABB) => boolean = (bx) => bx.blocksSound,
): boolean {
  for (const bx of boxes) {
    if (!filter(bx)) continue;
    if (segmentAABB(a, b, bx, 0, losHit) && losHit.t < 1) return false;
  }
  return true;
}

// Returns earliest world hit along a segment against boxes and the ground.
export interface WorldHit extends SegmentHit {
  box: AABB | null;
  ground: boolean;
}

export function sweepWorld(
  p0: Vec3Like, p1: Vec3Like, r: number, boxes: readonly AABB[], out: WorldHit, groundY = 0,
): boolean {
  let best = 2;
  const tmp = losHit;
  out.box = null;
  out.ground = false;
  for (const bx of boxes) {
    if (segmentAABB(p0, p1, bx, r, tmp) && tmp.t < best) {
      best = tmp.t;
      out.t = tmp.t; out.nx = tmp.nx; out.ny = tmp.ny; out.nz = tmp.nz;
      out.box = bx;
    }
  }
  const floor = groundY + r;
  if (p0.y >= floor && p1.y < floor) {
    const t = (p0.y - floor) / (p0.y - p1.y);
    if (t < best) {
      best = t;
      out.t = t; out.nx = 0; out.ny = 1; out.nz = 0;
      out.box = null;
      out.ground = true;
    }
  }
  return best <= 1;
}
