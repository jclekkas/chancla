import type { AABB } from '../physics/collision';

// Grid navigation with A* and line-of-sight path smoothing. The grid is
// built once per arena; queries reuse typed arrays and never allocate
// beyond the output path.
export class NavGrid {
  readonly cell: number;
  readonly minX: number;
  readonly minZ: number;
  readonly w: number;
  readonly h: number;
  readonly blocked: Uint8Array;
  private g: Float32Array;
  private came: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private gen = 1;
  private heap: Int32Array;
  private heapF: Float32Array;
  private heapSize = 0;

  constructor(minX: number, minZ: number, maxX: number, maxZ: number, cell: number, boxes: readonly AABB[], inflate: number) {
    this.cell = cell;
    this.minX = minX;
    this.minZ = minZ;
    this.w = Math.ceil((maxX - minX) / cell);
    this.h = Math.ceil((maxZ - minZ) / cell);
    const n = this.w * this.h;
    this.blocked = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.came = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Int32Array(n);
    this.heapF = new Float32Array(n);
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const x = minX + (i + 0.5) * cell;
        const z = minZ + (j + 0.5) * cell;
        for (const b of boxes) {
          if (b.maxY <= 0.35 || b.minY > 1.8) continue;
          if (x > b.minX - inflate && x < b.maxX + inflate && z > b.minZ - inflate && z < b.maxZ + inflate) {
            this.blocked[j * this.w + i] = 1;
            break;
          }
        }
      }
    }
  }

  toCell(x: number, z: number): number {
    const i = Math.floor((x - this.minX) / this.cell);
    const j = Math.floor((z - this.minZ) / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }

  isFree(x: number, z: number): boolean {
    const c = this.toCell(x, z);
    return c >= 0 && this.blocked[c] === 0;
  }

  cellX(c: number): number {
    return this.minX + ((c % this.w) + 0.5) * this.cell;
  }

  cellZ(c: number): number {
    return this.minZ + (Math.floor(c / this.w) + 0.5) * this.cell;
  }

  nearestFree(c: number): number {
    if (c >= 0 && this.blocked[c] === 0) return c;
    if (c < 0) return -1;
    const ci = c % this.w, cj = Math.floor(c / this.w);
    for (let r = 1; r < 12; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
          const i = ci + di, j = cj + dj;
          if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
          const k = j * this.w + i;
          if (this.blocked[k] === 0) return k;
        }
      }
    }
    return -1;
  }

  // Walkable straight line between two points, sampled at half-cell steps.
  walkable(x0: number, z0: number, x1: number, z1: number): boolean {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / (this.cell * 0.5)));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const c = this.toCell(x0 + dx * t, z0 + dz * t);
      if (c < 0 || this.blocked[c] === 1) return false;
    }
    return true;
  }

  // Writes [x0,z0,x1,z1,...] waypoints (excluding the start) to `out`.
  findPath(sx: number, sz: number, tx: number, tz: number, out: number[], maxExpand = 6000): boolean {
    out.length = 0;
    if (this.walkable(sx, sz, tx, tz)) {
      out.push(tx, tz);
      return true;
    }
    const start = this.nearestFree(this.toCell(sx, sz));
    const goal = this.nearestFree(this.toCell(tx, tz));
    if (start < 0 || goal < 0) return false;
    this.gen++;
    if (this.gen > 0xfffffff0) {
      this.gen = 1;
      this.stamp.fill(0);
      this.closed.fill(0);
    }
    const gen = this.gen;
    const w = this.w;
    const gx = goal % w, gz = Math.floor(goal / w);
    this.heapSize = 0;
    this.g[start] = 0;
    this.stamp[start] = gen;
    this.came[start] = -1;
    this.push(start, this.heur(start, gx, gz));
    let expanded = 0;
    let found = false;
    while (this.heapSize > 0) {
      const cur = this.pop();
      if (cur === goal) { found = true; break; }
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (++expanded > maxExpand) break;
      const ci = cur % w, cj = Math.floor(cur / w);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= w || nj >= this.h) continue;
          const nb = nj * w + ni;
          if (this.blocked[nb] === 1 || this.closed[nb] === gen) continue;
          if (di !== 0 && dj !== 0) {
            // No corner cutting.
            if (this.blocked[cj * w + ni] === 1 || this.blocked[nj * w + ci] === 1) continue;
          }
          const cost = this.g[cur]! + (di !== 0 && dj !== 0 ? 1.41421356 : 1);
          if (this.stamp[nb] !== gen || cost < this.g[nb]!) {
            this.stamp[nb] = gen;
            this.g[nb] = cost;
            this.came[nb] = cur;
            this.push(nb, cost + this.heur(nb, gx, gz));
          }
        }
      }
    }
    if (!found) return false;
    // Reconstruct, then string-pull.
    const cells: number[] = [];
    for (let c = goal; c !== -1; c = this.came[c]!) cells.push(c);
    cells.reverse();
    let ax = sx, az = sz;
    let k = 0;
    while (k < cells.length) {
      let far = k;
      for (let m = cells.length - 1; m > k; m--) {
        if (this.walkable(ax, az, this.cellX(cells[m]!), this.cellZ(cells[m]!))) { far = m; break; }
      }
      const c = cells[far]!;
      ax = this.cellX(c);
      az = this.cellZ(c);
      out.push(ax, az);
      k = far + 1;
    }
    if (this.walkable(ax, az, tx, tz)) out.push(tx, tz);
    return true;
  }

  private heur(c: number, gx: number, gz: number): number {
    const dx = Math.abs((c % this.w) - gx), dz = Math.abs(Math.floor(c / this.w) - gz);
    return dx + dz + (1.41421356 - 2) * Math.min(dx, dz);
  }

  private push(c: number, f: number): void {
    let i = this.heapSize++;
    this.heap[i] = c;
    this.heapF[i] = f;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heapF[p]! <= this.heapF[i]!) break;
      this.swap(i, p);
      i = p;
    }
  }

  private pop(): number {
    const top = this.heap[0]!;
    const last = --this.heapSize;
    if (last > 0) {
      this.heap[0] = this.heap[last]!;
      this.heapF[0] = this.heapF[last]!;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < last && this.heapF[l]! < this.heapF[m]!) m = l;
        if (r < last && this.heapF[r]! < this.heapF[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const c = this.heap[a]!; this.heap[a] = this.heap[b]!; this.heap[b] = c;
    const f = this.heapF[a]!; this.heapF[a] = this.heapF[b]!; this.heapF[b] = f;
  }
}
