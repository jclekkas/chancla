// Pooled projectile visuals with restrained trails, plus impact effects.
// All trails are one merged ribbon mesh and all impact shapes share a few
// instanced layers, so six chanclas landing at once cost the same few draw
// calls as one.
import * as THREE from 'three';
import type { WeaponId } from '../../../shared/config';
import { chanclaModel } from './fp-chancla';
import { buildPesada } from './pesada';
import { Particles } from '../../fx/particles';
import type { ClientProjectile } from '../../net/session';
import { FX_SETTINGS, FxSprites, ViewBasis, hash, nearSafe, pop, smooth, streakMatrix, REDUCED_SPEED, type FxSettings } from './combat-fx';

interface Slot {
  mesh: THREE.Object3D;
  trail: number; // ribbon index in the merged trail mesh
  key: string | null;
  spin: number;
  seen: boolean;
}

const SEG = 10;

/**
 * Every projectile's trail in one mesh: a camera-facing ribbon per slot,
 * written each frame into one buffer, live ribbons packed first.
 */
class Ribbons {
  readonly mesh: THREE.Mesh;
  private pts: Float32Array;
  private head: Int32Array;
  private filled: Int32Array;
  private sampleT: Float32Array;
  private color: THREE.Color[] = [];
  private width: Float32Array;
  private live: Uint8Array;
  private pos: Float32Array;
  private col: Float32Array;
  private geo = new THREE.BufferGeometry();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  drawn = 0;

  constructor(readonly cap: number) {
    this.pts = new Float32Array(cap * SEG * 3);
    this.head = new Int32Array(cap); this.filled = new Int32Array(cap); this.sampleT = new Float32Array(cap);
    this.width = new Float32Array(cap); this.live = new Uint8Array(cap);
    for (let i = 0; i < cap; i++) this.color.push(new THREE.Color());
    this.pos = new Float32Array(cap * SEG * 2 * 3);
    this.col = new Float32Array(cap * SEG * 2 * 4);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let r = 0; r < cap; r++) for (let i = 0; i < SEG - 1; i++) { const a = (r * SEG + i) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo.setIndex(idx);
    this.geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
  }

  setStyle(i: number, hex: number, width: number): void { this.color[i]!.setHex(hex); this.width[i] = width; }

  reset(i: number, p: THREE.Vector3): void {
    for (let k = 0; k < SEG; k++) { const o = (i * SEG + k) * 3; this.pts[o] = p.x; this.pts[o + 1] = p.y; this.pts[o + 2] = p.z; }
    this.head[i] = 0; this.filled[i] = 1; this.sampleT[i] = 0; this.live[i] = 1;
  }

  hide(i: number): void { this.live[i] = 0; this.filled[i] = 0; }

  push(i: number, p: THREE.Vector3, dt: number): void {
    this.sampleT[i] = this.sampleT[i]! + dt;
    if (this.sampleT[i]! >= 1 / 90 || this.filled[i]! <= 1) {
      this.sampleT[i] = 0;
      this.head[i] = (this.head[i]! + 1) % SEG;
      if (this.filled[i]! < SEG) this.filled[i] = this.filled[i]! + 1;
    }
    const o = (i * SEG + this.head[i]!) * 3;
    this.pts[o] = p.x; this.pts[o + 1] = p.y; this.pts[o + 2] = p.z;
  }

  private pt(i: number, k: number, out: THREE.Vector3): THREE.Vector3 {
    const n = this.filled[i]!, kk = Math.min(k, n - 1);
    const o = (i * SEG + ((this.head[i]! - kk + SEG * 2) % SEG)) * 3;
    return out.set(this.pts[o]!, this.pts[o + 1]!, this.pts[o + 2]!);
  }

  update(view: ViewBasis, reduced: boolean): void {
    let r = 0;
    for (let i = 0; i < this.cap; i++) {
      if (!this.live[i] || this.filled[i]! < 2) continue;
      const c = this.color[i]!;
      for (let k = 0; k < SEG; k++) {
        const p = this.pt(i, k, this.a), q = this.pt(i, k + 1, this.b);
        let dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
        if (dx * dx + dy * dy + dz * dz < 1e-8) { dx = 0; dy = 1; dz = 0; }
        const tx = view.pos.x - p.x, ty = view.pos.y - p.y, tz = view.pos.z - p.z;
        let sx = dy * tz - dz * ty, sy = dz * tx - dx * tz, sz = dx * ty - dy * tx;
        const sl = Math.hypot(sx, sy, sz) || 1;
        sx /= sl; sy /= sl; sz /= sl;
        const f = 1 - k / (SEG - 1);
        const camD = Math.hypot(tx, ty, tz);
        // Close to the camera it fades; far away it widens a little so the
        // direction still reads at 15-20 m.
        const near = smooth(1.2, 3.5, camD);
        const w = this.width[i]! * Math.max(0.25, f) * Math.min(2.2, Math.max(1, camD / 7)) * (reduced ? 0.8 : 1);
        const o = (r * SEG + k) * 6;
        this.pos[o] = p.x + sx * w; this.pos[o + 1] = p.y + sy * w; this.pos[o + 2] = p.z + sz * w;
        this.pos[o + 3] = p.x - sx * w; this.pos[o + 4] = p.y - sy * w; this.pos[o + 5] = p.z - sz * w;
        const al = Math.pow(f, 1.4) * 0.75 * near;
        const co = (r * SEG + k) * 8;
        for (let s = 0; s < 2; s++) { this.col[co + s * 4] = c.r; this.col[co + s * 4 + 1] = c.g; this.col[co + s * 4 + 2] = c.b; this.col[co + s * 4 + 3] = al; }
      }
      r++;
    }
    this.drawn = r;
    this.geo.setDrawRange(0, r * (SEG - 1) * 6);
    this.mesh.visible = r > 0;
    if (r > 0) {
      (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  clear(): void { this.live.fill(0); this.filled.fill(0); this.drawn = 0; this.geo.setDrawRange(0, 0); this.mesh.visible = false; }

  dispose(): void { this.geo.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

interface Impact { weapon: WeaponId; player: boolean; ground: boolean; x: number; y: number; z: number; age: number; life: number; born: number; seed: number }

/** Impact effects alive at once; the oldest is reused beyond this. */
export const IMPACT_POOL = 12;
export const IMPACT_LIFE = { light: 0.32, heavy: 0.45 } as const;

const IC = {
  dust: new THREE.Color(0xe9d3a6), dustDark: new THREE.Color(0xcdb083), scuff: new THREE.Color(0xb89870),
  slap: new THREE.Color(0xffe2a0), slapHeavy: new THREE.Color(0xf5ae3c), speed: new THREE.Color(0xfff2cf),
};
const FLAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

export class ProjectileView {
  readonly group = new THREE.Group();
  readonly particles = new Particles(360);
  private pools: Record<WeaponId, Slot[]> = { 0: [], 1: [] };
  private ribbons: Ribbons;
  private sprites = new FxSprites({ star: 24, ring: 24, puff: 48, streak: 48 });
  private impacts: Impact[] = [];
  private seq = 0;
  private view = new ViewBasis();
  private q = new THREE.Quaternion();
  private m = new THREE.Matrix4();
  private safe: [number, number] = [1, 1];
  private settings: FxSettings;

  constructor(settings: FxSettings = FX_SETTINGS) {
    this.settings = settings;
    this.ribbons = new Ribbons(24);
    let r = 0;
    for (const w of [0, 1] as const) {
      for (let i = 0; i < (w === 0 ? 16 : 8); i++) {
        const mesh: THREE.Object3D = w === 0 ? chanclaModel() : buildPesada(); // the same chancla design the hand and characters hold
        mesh.scale.setScalar(w === 0 ? 1.7 : 1.6);
        mesh.visible = false;
        this.ribbons.setStyle(r, w === 0 ? 0xffe4b4 : 0xb48ae0, w === 0 ? 0.065 : 0.09);
        this.group.add(mesh);
        this.pools[w].push({ mesh, trail: r, key: null, spin: hash(r, 1) * 6, seen: false });
        r++;
      }
    }
    this.group.add(this.ribbons.mesh, this.sprites.group, this.particles.mesh);
    for (let i = 0; i < IMPACT_POOL; i++) this.impacts.push({ weapon: 0, player: false, ground: false, x: 0, y: 0, z: 0, age: 1, life: 0, born: 0, seed: 0 });
  }

  clear(): void {
    for (const w of [0, 1] as const) for (const s of this.pools[w]) { s.key = null; s.mesh.visible = false; }
    this.ribbons.clear();
    for (const im of this.impacts) im.life = 0;
    this.sprites.clear();
    this.particles.clear();
  }

  /**
   * A projectile landed. Surfaces: a dust puff (with a scuff ring on the
   * paving); a player: a slap star, warm and brighter, so the two never
   * look alike.
   */
  impact(weapon: WeaponId, pos: [number, number, number], player: boolean): void {
    let im = this.impacts[0]!;
    for (const x of this.impacts) {
      if (x.age >= x.life) { im = x; break; }
      if (x.born < im.born) im = x;
    }
    im.weapon = weapon; im.player = player; im.x = pos[0]; im.y = pos[1]; im.z = pos[2];
    im.ground = !player && pos[1] < 0.35;
    im.age = 0; im.life = weapon === 1 ? IMPACT_LIFE.heavy : IMPACT_LIFE.light; im.born = ++this.seq; im.seed = (this.seq * 3.7) % 89;
    // A few real bits on High and Medium (Low: the shapes alone).
    const q = this.settings.quality;
    if (q !== 'low') {
      const n = q === 'high' ? 1 : 0.5;
      if (player) this.particles.burst('thwap', pos[0], pos[1], pos[2], (weapon === 1 ? 10 : 7) * n);
      // Surfaces: a few small chips (the big 'dust' squares read as paper next to the puffs).
      else if (q === 'high') this.particles.burst('thwap', pos[0], pos[1] + 0.03, pos[2], weapon === 1 ? 4 : 2);
    }
  }

  sync(projectiles: Map<string, ClientProjectile>, renderTime: number, camera: THREE.Camera, dt: number): void {
    const reduced = this.settings.reduced;
    this.view.read(camera);
    for (const w of [0, 1] as const) for (const s of this.pools[w]) s.seen = false;
    for (const cp of projectiles.values()) {
      if (cp.done) continue;
      if (!cp.predicted && renderTime < cp.startAt) continue;
      const pool = this.pools[cp.weapon];
      let slot: Slot | undefined;
      for (const s of pool) if (s.key === cp.id) { slot = s; break; }
      if (!slot) {
        for (const s of pool) if (s.key === null) { slot = s; break; }
        if (!slot) continue;
        slot.key = cp.id;
        slot.mesh.visible = true;
        slot.mesh.position.set(cp.pr.x, cp.pr.y, cp.pr.z);
        this.ribbons.reset(slot.trail, slot.mesh.position);
      }
      slot.seen = true;
      slot.mesh.position.set(cp.pr.x, cp.pr.y, cp.pr.z);
      // La Chancla spins flat like a frisbee with a little wobble; La Pesada
      // tumbles end over end. Reduced motion: slower.
      const k = reduced ? 0.5 : 1;
      if (cp.weapon === 0) {
        slot.spin += dt * 26 * k;
        slot.mesh.rotation.set(0.3 * Math.sin(slot.spin * 0.25), slot.spin, 0.2);
      } else {
        slot.spin += dt * 9 * k;
        slot.mesh.rotation.set(slot.spin, 0.3, 0.2);
      }
      this.ribbons.push(slot.trail, slot.mesh.position, dt);
    }
    for (const w of [0, 1] as const) {
      for (const s of this.pools[w]) {
        if (s.key && !s.seen) { s.key = null; s.mesh.visible = false; this.ribbons.hide(s.trail); }
      }
    }
    this.ribbons.update(this.view, reduced);
    this.drawImpacts(dt);
    this.particles.update(dt);
  }

  private drawImpacts(dt: number): void {
    const q = this.settings.quality, reduced = this.settings.reduced, v = this.view, s = this.sprites;
    const speed = reduced ? REDUCED_SPEED : 1;
    s.begin();
    for (const im of this.impacts) {
      if (im.age >= im.life) continue;
      im.age += dt * speed;
      if (im.age >= im.life) continue;
      const t = im.age / im.life, heavy = im.weapon === 1, k = reduced ? 0.85 : 1;
      const d = v.dist(im.x, im.y, im.z);
      if (im.player) {
        // A slap star, like a melee contact but rounder and quicker.
        const [a, sz] = nearSafe(d, (heavy ? 0.36 : 0.24) * k * pop(t, reduced), this.safe);
        s.add('star', im.x, im.y, im.z, v.billboard(im.seed + (reduced ? 0 : t), this.q), sz, sz, sz, heavy ? IC.slapHeavy : IC.slap, (1 - smooth(0.45, 1, t)) * a);
        if (q !== 'low') {
          for (let i = 0; i < (heavy ? 4 : 3); i++) {
            const an = hash(im.seed, i) * 6.283, dx = Math.cos(an), dy = Math.sin(an);
            const wx = v.right.x * dx + v.up.x * dy, wy = v.right.y * dx + v.up.y * dy, wz = v.right.z * dx + v.up.z * dy;
            const st = (heavy ? 0.18 : 0.12) + 0.25 * smooth(0, 0.7, t) * (reduced ? 0.5 : 1);
            const px = im.x + wx * st, py = im.y + wy * st, pz = im.z + wz * st;
            const [la, ls] = nearSafe(v.dist(px, py, pz), (heavy ? 0.22 : 0.15) * (1 - 0.5 * t), this.safe);
            s.addMatrix('streak', streakMatrix(v, px, py, pz, wx, wy, wz, ls, ls * 0.16, this.m), IC.speed, (1 - smooth(0.4, 1, t)) * la);
          }
        }
        continue;
      }
      // Surfaces: dust puffs drifting up and out, warm and dusty with a soft ink rim.
      const puffs = q === 'low' ? 1 : q === 'medium' ? 2 : 3;
      for (let i = 0; i < puffs; i++) {
        const an = (i / puffs) * 6.283 + im.seed;
        const out = (heavy ? 0.22 : 0.14) * smooth(0, 1, t) * (reduced ? 0.6 : 1) * (i ? 1 : 0.3);
        const px = im.x + Math.cos(an) * out, py = im.y + (im.ground ? 0.06 : 0) + 0.18 * smooth(0, 1, t) * (reduced ? 0.6 : 1) + i * 0.03, pz = im.z + Math.sin(an) * out;
        const grow = (heavy ? 0.24 : 0.16) * (i ? 0.75 : 1) * (0.55 + 0.6 * smooth(0, 0.6, t)) * k;
        const [a, sz] = nearSafe(v.dist(px, py, pz), grow, this.safe);
        s.add('puff', px, py, pz, v.billboard(an, this.q), sz, sz * 0.9, sz, i ? IC.dustDark : IC.dust, 0.95 * (1 - smooth(0.35, 1, t)) * a);
      }
      // A scuff ring: flat on the paving, facing the view on a wall.
      if (q !== 'low' || heavy) {
        const r = ((heavy ? 0.22 : 0.12) + (heavy ? 0.55 : 0.3) * smooth(0, 0.8, t) * (reduced ? 0.6 : 1));
        const [a, rs] = nearSafe(d, r, this.safe);
        if (im.ground) s.add('ring', im.x, im.y + 0.03, im.z, FLAT, rs, rs, rs, IC.scuff, 0.75 * (1 - t) * a);
        else s.add('ring', im.x, im.y, im.z, v.billboard(0, this.q), rs * 0.8, rs * 0.8, rs, IC.scuff, 0.6 * (1 - t) * a);
      }
    }
    s.end();
  }

  /** Live and pooled counts and draw calls (tests and the budget report). */
  stats(): { active: number; pooled: number; drawCalls: number; flying: number; trails: number; pieces: number; triangles: number } {
    let active = 0, flying = 0;
    for (const im of this.impacts) if (im.age < im.life) active++;
    for (const w of [0, 1] as const) for (const s of this.pools[w]) if (s.key) flying++;
    return {
      active, pooled: this.impacts.length, flying, trails: this.ribbons.drawn,
      drawCalls: this.sprites.drawCalls + (this.ribbons.mesh.visible ? 1 : 0) + (this.particles.active > 0 ? 1 : 0),
      pieces: this.sprites.pieces, triangles: this.sprites.triangles + this.ribbons.drawn * (SEG - 1) * 2,
    };
  }

  dispose(): void {
    this.clear();
    this.sprites.dispose();
    this.ribbons.dispose();
    this.particles.mesh.geometry.dispose();
    (this.particles.mesh.material as THREE.Material).dispose();
    this.particles.mesh.dispose();
    this.group.clear();
  }
}
