import * as THREE from 'three';
import { lineOfSight, segmentSphere, sweepWorld, type AABB, type WorldHit } from '../physics/collision';
import { PALETTE } from '../world/palette';
import { heartGeometry } from '../models/characters';
import { wrapAngle } from '../core/math';

// Telegraphed attacks. Every hazard shows a readable warning first, then
// becomes dangerous for a short window, and is blocked by solid cover.
//   cone: a sound blast or leaf-blower gust from a point in a direction
//   ring: the boss's expanding bass-drop wall with a safe gap
//   orb:  a slow projectile (influencer hearts, boss vinyl records)

export type HazardKind = 'cone' | 'ring' | 'orb';
export type OrbStyle = 'heart' | 'vinyl';

export interface PlayerProbe {
  x: number;
  z: number;
  eyeY: number;
  radius: number;
}

export interface HazardHit {
  damage: number;
  pushX: number;
  pushZ: number;
  kind: HazardKind;
  source: string;
}

interface Base {
  active: boolean;
  owner: number;
  source: string;
  t: number;
  telegraph: number;
  live: number;
  damage: number;
  push: number;
  applied: boolean;
}

interface Cone extends Base {
  x: number; z: number; y: number;
  dir: number; // yaw angle of the blast direction (atan2(dx, dz))
  range: number;
  half: number;
  color: number;
  fill: THREE.Mesh;
  outline: THREE.Mesh;
  edges: THREE.Mesh;
  wave: THREE.Mesh;
  root: THREE.Group;
}

interface Ring extends Base {
  x: number; z: number;
  radius: number;
  speed: number;
  maxR: number;
  gapDir: number;
  gapHalf: number;
  root: THREE.Group;
  wall: THREE.Mesh;
  wallGeo: THREE.BufferGeometry;
  marker: THREE.Mesh;
  hitDone: boolean;
}

interface Orb extends Base {
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  style: OrbStyle;
  mesh: THREE.Object3D;
  r: number;
}

const RING_SEG = 72;
// Hot pink reads clearly against the terracotta pavers at golden hour.
const DANGER = 0xff2f86;
const hitTmp: WorldHit = { t: 0, nx: 0, ny: 0, nz: 0, box: null, ground: false };
const pA = new THREE.Vector3();
const pB = new THREE.Vector3();
const tmpV = new THREE.Vector3();

interface FanGeos { fill: THREE.BufferGeometry; outline: THREE.BufferGeometry; wave: THREE.BufferGeometry; edges: THREE.BufferGeometry }
const fanCache = new Map<number, FanGeos>();
function fanGeometries(half: number): FanGeos {
  const key = Math.round(half * 1000);
  let g = fanCache.get(key);
  if (!g) {
    // Fan in XZ: apex at origin, opening toward +Z.
    const fill = new THREE.CircleGeometry(1, 20, Math.PI / 2 - half, half * 2);
    fill.rotateX(-Math.PI / 2);
    fill.rotateY(Math.PI);
    const outline = new THREE.RingGeometry(0.96, 1, 20, 1, Math.PI / 2 - half, half * 2);
    outline.rotateX(-Math.PI / 2);
    outline.rotateY(Math.PI);
    // Vertical arc of the travelling sound wall.
    const wave = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true, -half, half * 2);
    wave.translate(0, 0.5, 0);
    // Bright strips along both straight edges so the cone shape reads from afar.
    const w = 0.035;
    const pos: number[] = [];
    for (const a of [-half, half]) {
      const dx = Math.sin(a), dz = Math.cos(a);
      const px = Math.cos(a) * w, pz = -Math.sin(a) * w;
      pos.push(-px, 0, -pz, px, 0, pz, dx + px, 0, dz + pz, -px, 0, -pz, dx + px, 0, dz + pz, dx - px, 0, dz - pz);
    }
    const edges = new THREE.BufferGeometry();
    edges.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g = { fill, outline, wave, edges };
    fanCache.set(key, g);
  }
  return g;
}

export class HazardSystem {
  readonly group = new THREE.Group();
  private cones: Cone[] = [];
  private rings: Ring[] = [];
  private orbs: Orb[] = [];
  private heartMat = new THREE.MeshLambertMaterial({ color: 0xff4d8d, emissive: 0x551133 });
  private vinylGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.07, 18);
  private vinylMat = new THREE.MeshLambertMaterial({ color: 0x1d1424, emissive: 0x4a1640 });
  private labelMat = new THREE.MeshBasicMaterial({ color: PALETTE.marigold });
  private rimGeo = new THREE.TorusGeometry(0.46, 0.035, 4, 24);
  private rimMat = new THREE.MeshBasicMaterial({ color: DANGER });
  reducedMotion = false;

  constructor() {
    for (let i = 0; i < 10; i++) this.cones.push(this.makeCone());
    for (let i = 0; i < 4; i++) this.rings.push(this.makeRing());
    for (let i = 0; i < 24; i++) this.orbs.push(this.makeOrb());
  }

  private makeCone(): Cone {
    const root = new THREE.Group();
    const fill = new THREE.Mesh(fanGeometries(0.5).fill, new THREE.MeshBasicMaterial({ color: DANGER, transparent: true, opacity: 0.35, depthWrite: false }));
    const outline = new THREE.Mesh(fanGeometries(0.5).outline, new THREE.MeshBasicMaterial({ color: 0xffd6e8, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }));
    const edges = new THREE.Mesh(fanGeometries(0.5).edges, outline.material);
    edges.renderOrder = 3;
    const wave = new THREE.Mesh(fanGeometries(0.5).wave, new THREE.MeshBasicMaterial({ color: PALETTE.marigold, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    fill.renderOrder = 2;
    outline.renderOrder = 3;
    wave.renderOrder = 4;
    root.add(fill, outline, edges, wave);
    root.visible = false;
    this.group.add(root);
    return {
      active: false, owner: -1, source: '', t: 0, telegraph: 1, live: 0.3, damage: 0, push: 0, applied: false,
      x: 0, z: 0, y: 0, dir: 0, range: 1, half: 0.5, color: DANGER, fill, outline, edges, wave, root,
    };
  }

  private makeRing(): Ring {
    const root = new THREE.Group();
    const wallGeo = new THREE.BufferGeometry();
    wallGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((RING_SEG + 1) * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < RING_SEG; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    wallGeo.setIndex(idx);
    const wall = new THREE.Mesh(wallGeo, new THREE.MeshBasicMaterial({ color: PALETTE.pink, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    wall.frustumCulled = false;
    const marker = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: PALETTE.turquoise, transparent: true, opacity: 0.45, depthWrite: false }));
    marker.rotation.x = -Math.PI / 2;
    root.add(wall, marker);
    root.visible = false;
    this.group.add(root);
    return {
      active: false, owner: -1, source: '', t: 0, telegraph: 1, live: 4, damage: 0, push: 0, applied: false,
      x: 0, z: 0, radius: 0, speed: 8, maxR: 32, gapDir: 0, gapHalf: 0.4, root, wall, wallGeo, marker, hitDone: false,
    };
  }

  private makeOrb(): Orb {
    const holder = new THREE.Group();
    holder.visible = false;
    this.group.add(holder);
    return {
      active: false, owner: -1, source: '', t: 0, telegraph: 0, live: 4, damage: 0, push: 0, applied: false,
      pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), style: 'heart', mesh: holder, r: 0.3,
    };
  }

  reset(): void {
    for (const c of this.cones) { c.active = false; c.root.visible = false; }
    for (const r of this.rings) { r.active = false; r.root.visible = false; }
    for (const o of this.orbs) { o.active = false; o.mesh.visible = false; }
  }

  activeCount(): number {
    let n = 0;
    for (const c of this.cones) if (c.active) n++;
    for (const r of this.rings) if (r.active) n++;
    for (const o of this.orbs) if (o.active) n++;
    return n;
  }

  cancelOwner(owner: number): number {
    let n = 0;
    for (const c of this.cones) {
      if (c.active && c.owner === owner && c.t < c.telegraph) { c.active = false; c.root.visible = false; n++; }
    }
    return n;
  }

  // Telegraphed cone. Returns false if the pool is exhausted.
  cone(opts: { owner: number; source: string; x: number; z: number; y?: number; dir: number; range: number; half: number; telegraph: number; live?: number; damage: number; push: number; color?: number }): boolean {
    const c = this.cones.find((k) => !k.active);
    if (!c) return false;
    c.active = true;
    c.owner = opts.owner;
    c.source = opts.source;
    c.t = 0;
    c.telegraph = opts.telegraph;
    c.live = opts.live ?? 0.3;
    c.damage = opts.damage;
    c.push = opts.push;
    c.applied = false;
    c.x = opts.x; c.z = opts.z; c.y = opts.y ?? 1.0;
    c.dir = opts.dir;
    c.range = opts.range;
    c.half = opts.half;
    c.color = opts.color ?? DANGER;
    const g = fanGeometries(opts.half);
    c.fill.geometry = g.fill;
    c.outline.geometry = g.outline;
    c.edges.geometry = g.edges;
    c.wave.geometry = g.wave;
    (c.fill.material as THREE.MeshBasicMaterial).color.setHex(c.color);
    c.root.position.set(opts.x, 0.04, opts.z);
    c.root.rotation.y = opts.dir;
    c.outline.scale.setScalar(opts.range);
    c.edges.scale.setScalar(opts.range);
    c.fill.scale.setScalar(0.01);
    c.wave.visible = false;
    c.root.visible = true;
    return true;
  }

  ring(opts: { owner: number; source: string; x: number; z: number; telegraph: number; speed: number; maxR: number; gapDir: number; gapHalf: number; damage: number; push: number }): boolean {
    const r = this.rings.find((k) => !k.active);
    if (!r) return false;
    r.active = true;
    r.owner = opts.owner;
    r.source = opts.source;
    r.t = 0;
    r.telegraph = opts.telegraph;
    r.speed = opts.speed;
    r.maxR = opts.maxR;
    r.gapDir = opts.gapDir;
    r.gapHalf = opts.gapHalf;
    r.damage = opts.damage;
    r.push = opts.push;
    r.applied = false;
    r.hitDone = false;
    r.x = opts.x; r.z = opts.z;
    r.radius = 0.5;
    r.root.position.set(opts.x, 0, opts.z);
    // Safe-lane marker: a turquoise strip pointing along the gap.
    r.marker.scale.set(Math.tan(opts.gapHalf) * 2 * 12, 24, 1);
    r.marker.position.set(Math.sin(opts.gapDir) * 12.5, 0.05, Math.cos(opts.gapDir) * 12.5);
    r.marker.rotation.set(-Math.PI / 2, 0, opts.gapDir);
    r.wall.visible = false;
    r.root.visible = true;
    return true;
  }

  orb(opts: { owner: number; source: string; style: OrbStyle; from: THREE.Vector3; vel: THREE.Vector3; damage: number; push: number; life?: number }): boolean {
    const o = this.orbs.find((k) => !k.active);
    if (!o) return false;
    o.active = true;
    o.owner = opts.owner;
    o.source = opts.source;
    o.style = opts.style;
    o.t = 0;
    o.live = opts.life ?? 4;
    o.damage = opts.damage;
    o.push = opts.push;
    o.applied = false;
    o.pos.copy(opts.from);
    o.prev.copy(opts.from);
    o.vel.copy(opts.vel);
    o.r = opts.style === 'heart' ? 0.3 : 0.46;
    const holder = o.mesh as THREE.Group;
    holder.clear();
    if (opts.style === 'heart') {
      const m = new THREE.Mesh(heartGeometry(), this.heartMat);
      m.scale.setScalar(0.55);
      holder.add(m);
    } else {
      const disc = new THREE.Mesh(this.vinylGeo, this.vinylMat);
      const label = new THREE.Mesh(this.vinylGeo, this.labelMat);
      label.scale.set(0.38, 1.2, 0.38);
      const rim = new THREE.Mesh(this.rimGeo, this.rimMat);
      rim.rotation.x = Math.PI / 2;
      holder.add(disc, label, rim);
      holder.rotation.set(0.25, 0, 0.15);
    }
    holder.position.copy(o.pos);
    holder.visible = true;
    return true;
  }

  onFire: ((kind: HazardKind, source: string, x: number, z: number) => void) | null = null;

  step(dt: number, player: PlayerProbe, colliders: readonly AABB[], onHit: (h: HazardHit) => void): void {
    for (const c of this.cones) if (c.active) this.stepCone(c, dt, player, colliders, onHit);
    for (const r of this.rings) if (r.active) this.stepRing(r, dt, player, colliders, onHit);
    for (const o of this.orbs) if (o.active) this.stepOrb(o, dt, player, colliders, onHit);
  }

  private stepCone(c: Cone, dt: number, p: PlayerProbe, colliders: readonly AABB[], onHit: (h: HazardHit) => void): void {
    c.t += dt;
    if (c.t < c.telegraph) {
      // Fill grows toward the edge: when it reaches the outline, it fires.
      const k = c.t / c.telegraph;
      c.fill.scale.setScalar(Math.max(0.01, k * c.range));
      const pulse = 0.32 + 0.14 * Math.sin(c.t * 18) * (this.reducedMotion ? 0.3 : 1);
      (c.fill.material as THREE.MeshBasicMaterial).opacity = pulse + k * 0.22;
      return;
    }
    const lt = c.t - c.telegraph;
    if (!c.applied) {
      c.applied = true;
      this.onFire?.('cone', c.source, c.x, c.z);
      c.fill.scale.setScalar(c.range);
      (c.fill.material as THREE.MeshBasicMaterial).color.setHex(PALETTE.marigold);
      c.wave.visible = true;
      const hit = this.inCone(c, p, colliders);
      if (hit) {
        const dx = Math.sin(c.dir), dz = Math.cos(c.dir);
        onHit({ damage: c.damage, pushX: dx * c.push, pushZ: dz * c.push, kind: 'cone', source: c.source });
      }
    }
    const k = Math.min(1, lt / c.live);
    c.wave.scale.set(Math.max(0.3, k * c.range), 2.2, Math.max(0.3, k * c.range));
    (c.wave.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - k);
    (c.fill.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - k);
    if (lt >= c.live) {
      c.active = false;
      c.root.visible = false;
      (c.fill.material as THREE.MeshBasicMaterial).color.setHex(c.color);
    }
  }

  inCone(c: { x: number; z: number; y: number; dir: number; range: number; half: number }, p: PlayerProbe, colliders: readonly AABB[]): boolean {
    const dx = p.x - c.x, dz = p.z - c.z;
    const d = Math.hypot(dx, dz);
    if (d > c.range + p.radius) return false;
    if (d > 0.3) {
      const ang = Math.abs(wrapAngle(Math.atan2(dx, dz) - c.dir));
      const slack = Math.atan2(p.radius, d);
      if (ang > c.half + slack) return false;
    }
    pA.set(c.x, c.y, c.z);
    pB.set(p.x, 1.0, p.z);
    return lineOfSight(pA, pB, colliders);
  }

  private stepRing(r: Ring, dt: number, p: PlayerProbe, colliders: readonly AABB[], onHit: (h: HazardHit) => void): void {
    r.t += dt;
    const mm = r.marker.material as THREE.MeshBasicMaterial;
    if (r.t < r.telegraph) {
      mm.opacity = 0.25 + 0.25 * Math.abs(Math.sin(r.t * 6));
      return;
    }
    if (!r.applied) {
      r.applied = true;
      this.onFire?.('ring', r.source, r.x, r.z);
    }
    r.wall.visible = true;
    r.radius += r.speed * dt;
    mm.opacity = 0.3;
    this.writeRing(r);
    const dx = p.x - r.x, dz = p.z - r.z;
    const d = Math.hypot(dx, dz);
    if (!r.hitDone && Math.abs(d - r.radius) < 0.55 + p.radius) {
      const ang = Math.abs(wrapAngle(Math.atan2(dx, dz) - r.gapDir));
      const inGap = ang < r.gapHalf - Math.atan2(p.radius * 0.5, Math.max(d, 0.5));
      pA.set(r.x, 0.6, r.z);
      pB.set(p.x, 0.6, p.z);
      if (!inGap && lineOfSight(pA, pB, colliders)) {
        r.hitDone = true;
        const nx = dx / (d || 1), nz = dz / (d || 1);
        onHit({ damage: r.damage, pushX: nx * r.push, pushZ: nz * r.push, kind: 'ring', source: r.source });
      }
    }
    if (r.radius > r.maxR) {
      r.active = false;
      r.root.visible = false;
    }
  }

  private writeRing(r: Ring): void {
    const pos = r.wallGeo.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const start = r.gapDir + r.gapHalf;
    const span = Math.PI * 2 - r.gapHalf * 2;
    const h = 1.3;
    for (let i = 0; i <= RING_SEG; i++) {
      const a = start + (i / RING_SEG) * span;
      const x = Math.sin(a) * r.radius, z = Math.cos(a) * r.radius;
      const o = i * 6;
      arr[o] = x; arr[o + 1] = 0.02; arr[o + 2] = z;
      arr[o + 3] = x; arr[o + 4] = h; arr[o + 5] = z;
    }
    pos.needsUpdate = true;
    const fade = 1 - Math.min(1, r.radius / r.maxR) * 0.6;
    (r.wall.material as THREE.MeshBasicMaterial).opacity = 0.7 * fade;
  }

  private stepOrb(o: Orb, dt: number, p: PlayerProbe, colliders: readonly AABB[], onHit: (h: HazardHit) => void): void {
    o.t += dt;
    o.prev.copy(o.pos);
    tmpV.copy(o.pos).addScaledVector(o.vel, dt);
    // Player first, then world.
    pB.set(p.x, 1.1, p.z);
    const tp = segmentSphere(o.pos, tmpV, o.r, pB, p.radius + 0.2);
    const hw = sweepWorld(o.pos, tmpV, o.r * 0.6, colliders, hitTmp);
    if (tp >= 0 && (!hw || tp <= hitTmp.t)) {
      onHit({ damage: o.damage, pushX: o.vel.x * 0.3 * o.push, pushZ: o.vel.z * 0.3 * o.push, kind: 'orb', source: o.source });
      this.killOrb(o);
      return;
    }
    if (hw) {
      this.killOrb(o);
      return;
    }
    o.pos.copy(tmpV);
    o.mesh.position.copy(o.pos);
    if (o.style === 'heart') {
      o.mesh.rotation.y += dt * 4;
      o.mesh.position.y += Math.sin(o.t * 10) * 0.05;
    } else {
      o.mesh.rotation.y += dt * 12;
    }
    if (o.t > o.live) this.killOrb(o);
  }

  private killOrb(o: Orb): void {
    o.active = false;
    o.mesh.visible = false;
  }

  // Exposed for tests and the boss: time until the earliest telegraph fires.
  pendingTelegraphs(): number {
    let n = 0;
    for (const c of this.cones) if (c.active && c.t < c.telegraph) n++;
    for (const r of this.rings) if (r.active && r.t < r.telegraph) n++;
    return n;
  }
}
