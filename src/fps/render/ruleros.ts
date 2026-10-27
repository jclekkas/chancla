// Flying ruleros: the hair rollers that pop off a Rosa hit in the face by
// El Revés. Purely cosmetic: no collision with players, no pickups, no
// effect on the game. A fixed pool drawn as two instanced meshes (the
// rollers, tinted per slot, and their ink outlines) with hand-rolled motion:
// a little pop where it leaves the head, an arc, a spin, a squashy bounce
// with a dust tick on the paving and a shrink out. Never more than POOL
// alive; the oldest is reused if more are asked for.
import * as THREE from 'three';
import { COLORS, OUTLINE, toon } from './materials';
import { markShared } from '../../models/sandal';
import { FX_SETTINGS, FxSprites, ViewBasis, nearSafe, smooth, type FxSettings } from './combat-fx';

/**
 * Roller colours by slot, shared with the ones drawn on the avatars: pink,
 * mint, lilac and coral, chosen to stand apart from both team colours and
 * Team Sol's straw hat.
 */
export const RULERO_COLORS = [COLORS.pink, 0x86e0c8, 0xb48ad8, 0xff8a6b] as const;

let geo: THREE.CylinderGeometry | null = null;
const mats = new Map<number, THREE.MeshToonMaterial>();

export function ruleroGeometry(): THREE.CylinderGeometry {
  if (!geo) { geo = new THREE.CylinderGeometry(0.034, 0.034, 0.1, 10); markShared(geo); }
  return geo;
}

export function ruleroMaterial(slot: number): THREE.MeshToonMaterial {
  const c = RULERO_COLORS[slot % RULERO_COLORS.length]!;
  let m = mats.get(c);
  if (!m) { m = toon(c, { emissive: 0x1a1010 }); mats.set(c, m); }
  return m;
}

/** One roller mesh with its ink outline (for avatars and the pool). */
export function ruleroMesh(slot: number): THREE.Mesh {
  const m = new THREE.Mesh(ruleroGeometry(), ruleroMaterial(slot));
  const o = new THREE.Mesh(ruleroGeometry(), OUTLINE);
  o.scale.setScalar(1.14);
  m.add(o);
  return m;
}

interface Flyer {
  live: boolean;
  slot: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  rot: THREE.Euler;
  ground: number;
  age: number;
  life: number;
  bounces: number;
  squash: number; // seconds since the last bounce (squash and recover)
  simple: boolean;
  bornAt: number;
}

// Pops where a roller leaves her head and dust ticks where it bounces.
interface Accent { kind: 0 | 1; slot: number; x: number; y: number; z: number; age: number; life: number }

export const RULERO_POOL = 12;
const ACCENTS = 24;
const GRAVITY = 14;
const SQUASH_S = 0.14;
const OUTLINE_SCALE = 1.14;
const WHITE_TOON = () => toon(0xffffff, { emissive: 0x1a1010 }); // tinted per instance: the same look as ruleroMaterial()

const _m = new THREE.Matrix4();
const _r = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _c = new THREE.Color();
const _n = new THREE.Vector3();
const DUST = new THREE.Color(0xe2cda0);
const POP = new THREE.Color(0xfff4d6);

export class RuleroFx {
  readonly group = new THREE.Group();
  private flyers: Flyer[] = [];
  private body: THREE.InstancedMesh;
  private outline: THREE.InstancedMesh;
  private sprites = new FxSprites({ star: ACCENTS, puff: ACCENTS });
  private accents: Accent[] = [];
  private view = new ViewBasis();
  private safe: [number, number] = [1, 1];
  private seq = 0;
  private settings: FxSettings;
  /** Spawned since creation (tests). */
  spawned = 0;

  constructor(settings: FxSettings = FX_SETTINGS) {
    this.settings = settings;
    this.body = new THREE.InstancedMesh(ruleroGeometry(), WHITE_TOON(), RULERO_POOL);
    this.outline = new THREE.InstancedMesh(ruleroGeometry(), OUTLINE, RULERO_POOL);
    for (const m of [this.body, this.outline]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      m.visible = false;
    }
    this.body.setColorAt(0, _c.setHex(RULERO_COLORS[0]));
    this.group.add(this.body, this.outline, this.sprites.group);
    for (let i = 0; i < RULERO_POOL; i++) {
      this.flyers.push({ live: false, slot: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), rot: new THREE.Euler(), ground: 0, age: 0, life: 0, bounces: 0, squash: 1, simple: false, bornAt: -1 });
    }
    for (let i = 0; i < ACCENTS; i++) this.accents.push({ kind: 0, slot: 0, x: 0, y: 0, z: 0, age: 1, life: 0 });
  }

  get active(): number { let n = 0; for (const f of this.flyers) if (f.live) n++; return n; }

  /**
   * Launches one roller from `from` (world position), pushed along `dir`
   * (horizontal, roughly unit) with a pop upward. `ground`: the paving height
   * under the character. `simple`: Low quality (no bounce, shorter life).
   */
  spawn(slot: number, from: THREE.Vector3, dir: THREE.Vector3, ground: number, opts: { simple?: boolean; strength?: number; rand?: () => number } = {}): void {
    const rand = opts.rand ?? Math.random;
    // A free one, or the oldest one in flight.
    let f = this.flyers[0]!;
    for (const x of this.flyers) {
      if (!x.live) { f = x; break; }
      if (x.bornAt < f.bornAt) f = x;
    }
    const k = opts.strength ?? 1;
    f.slot = slot;
    f.pos.copy(from);
    f.vel.set(dir.x * (2.6 + rand() * 0.8) * k, 3.2 + rand() * 1.0, dir.z * (2.6 + rand() * 0.8) * k);
    // A little sideways scatter so several from one hit fan out.
    f.vel.x += (rand() - 0.5) * 1.2;
    f.vel.z += (rand() - 0.5) * 1.2;
    f.spin.set((rand() - 0.5) * 24, (rand() - 0.5) * 10, 14 + rand() * 10);
    f.rot.set(0, 0, 0);
    f.ground = ground;
    f.age = 0;
    f.simple = !!opts.simple;
    f.life = f.simple ? 0.9 : 1.6;
    f.bounces = 0;
    f.squash = 1;
    f.bornAt = ++this.seq;
    f.live = true;
    this.spawned++;
    // The pop where it leaves her head (not when it is your own, right at the camera).
    const cam = this.settings.camera;
    if (cam) { this.view.read(cam); if (this.view.dist(from.x, from.y, from.z) < 1.2) return; }
    this.accent(0, slot, from.x, from.y, from.z, f.simple ? 0.16 : 0.2);
  }

  private accent(kind: 0 | 1, slot: number, x: number, y: number, z: number, life: number): void {
    let a = this.accents[0]!;
    let best = -1;
    for (const c of this.accents) {
      if (c.age >= c.life) { a = c; break; }
      const left = c.life - c.age;
      if (best < 0 || left < best) { best = left; a = c; }
    }
    a.kind = kind; a.slot = slot; a.x = x; a.y = y; a.z = z; a.age = 0; a.life = life;
  }

  update(dt: number): void {
    let n = 0;
    for (const f of this.flyers) {
      if (!f.live) continue;
      f.age += dt;
      if (f.age >= f.life) { f.live = false; continue; }
      f.vel.y -= GRAVITY * dt;
      f.pos.addScaledVector(f.vel, dt);
      f.squash += dt;
      const floor = f.ground + 0.035;
      if (f.pos.y < floor) {
        f.pos.y = floor;
        if (!f.simple && f.bounces < 2 && f.vel.y < -1) {
          // A short rubbery bounce, losing most of its energy, with a squash and a tick of dust.
          f.bounces++;
          f.vel.y = -f.vel.y * 0.38;
          f.vel.x *= 0.55; f.vel.z *= 0.55;
          f.spin.multiplyScalar(0.5);
          f.squash = 0;
          if (this.settings.quality !== 'low') this.accent(1, f.slot, f.pos.x, f.ground + 0.02, f.pos.z, f.bounces === 1 ? 0.32 : 0.24);
        } else {
          f.vel.set(f.vel.x * 0.9, 0, f.vel.z * 0.9);
          f.spin.multiplyScalar(0.9);
        }
      }
      f.rot.x += f.spin.x * dt;
      f.rot.y += f.spin.y * dt;
      f.rot.z += f.spin.z * dt;
      // Shrink out over the last quarter of its life, eased.
      const tail = f.life * 0.75;
      const s = f.age > tail ? Math.max(0.01, 1 - smooth(0, 1, (f.age - tail) / (f.life - tail))) : 1;
      this.write(n++, f, s);
    }
    for (const m of [this.body, this.outline]) {
      m.count = n;
      m.visible = n > 0;
      m.instanceMatrix.needsUpdate = true;
    }
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    this.drawAccents(dt);
  }

  // World-space squash and stretch: squashed flat right after a bounce,
  // stretched a little along its velocity in flight (volume kept).
  private write(i: number, f: Flyer, s: number): void {
    let k = 1;
    if (f.squash < SQUASH_S && !f.simple) {
      const u = f.squash / SQUASH_S;
      k = 1 - 0.42 * Math.sin(Math.PI * Math.min(1, u * 1.2)) * (1 - u * 0.5);
      _n.set(0, 1, 0);
    } else {
      const sp = f.vel.length();
      k = f.simple ? 1 : 1 + Math.min(0.22, sp * 0.03);
      if (sp > 1e-4) _n.copy(f.vel).divideScalar(sp); else _n.set(0, 1, 0);
    }
    // A = a I + (k - a) n n^T, with a = 1 / sqrt(k) across the axis.
    const a = 1 / Math.sqrt(k), b = k - a;
    _m.set(
      a + b * _n.x * _n.x, b * _n.x * _n.y, b * _n.x * _n.z, 0,
      b * _n.y * _n.x, a + b * _n.y * _n.y, b * _n.y * _n.z, 0,
      b * _n.z * _n.x, b * _n.z * _n.y, a + b * _n.z * _n.z, 0,
      0, 0, 0, 1,
    );
    _r.makeRotationFromEuler(f.rot);
    _m.multiply(_r);
    _r.makeScale(s, s, s);
    _m.multiply(_r);
    _m.setPosition(f.pos);
    this.body.setMatrixAt(i, _m);
    this.body.setColorAt(i, _c.setHex(RULERO_COLORS[f.slot % RULERO_COLORS.length]!));
    _r.makeScale(OUTLINE_SCALE, OUTLINE_SCALE, OUTLINE_SCALE);
    _m.multiply(_r);
    _m.setPosition(f.pos);
    this.outline.setMatrixAt(i, _m);
  }

  private drawAccents(dt: number): void {
    const v = this.view, sp = this.sprites;
    v.read(this.settings.camera);
    const reduced = this.settings.reduced;
    sp.begin();
    for (const a of this.accents) {
      if (a.age >= a.life) continue;
      a.age += dt;
      if (a.age >= a.life) continue;
      const t = a.age / a.life;
      const d = v.dist(a.x, a.y, a.z);
      if (a.kind === 0) {
        // A little cream pop, ringed in the roller's colour.
        const [al, sz] = nearSafe(d, (0.08 + 0.1 * smooth(0, 0.5, t)) * (reduced ? 0.8 : 1), this.safe);
        _c.setHex(RULERO_COLORS[a.slot % RULERO_COLORS.length]!).lerp(POP, 0.55);
        sp.add('star', a.x, a.y, a.z, v.billboard(a.slot * 0.7 + (reduced ? 0 : t * 2), _q), sz, sz, sz, _c, (1 - smooth(0.4, 1, t)) * al);
      } else {
        // A tick of dust on the paving.
        const [al, sz] = nearSafe(d, (0.05 + 0.07 * smooth(0, 0.7, t)) * (reduced ? 0.8 : 1), this.safe);
        sp.add('puff', a.x, a.y + 0.02 + 0.04 * t, a.z, v.billboard(a.x * 3, _q), sz * 1.3, sz * 0.8, sz, DUST, 0.85 * (1 - smooth(0.3, 1, t)) * al);
      }
    }
    sp.end();
  }

  clear(): void {
    for (const f of this.flyers) f.live = false;
    for (const a of this.accents) a.life = 0;
    for (const m of [this.body, this.outline]) { m.count = 0; m.visible = false; }
    this.sprites.clear();
  }

  /** Live and pooled counts and draw calls (tests and the budget report). */
  stats(): { active: number; pooled: number; accents: number; drawCalls: number } {
    let accents = 0;
    for (const a of this.accents) if (a.age < a.life) accents++;
    return { active: this.active, pooled: this.flyers.length, accents, drawCalls: (this.body.visible ? 2 : 0) + this.sprites.drawCalls };
  }

  /** Frees what this pool made (the roller geometry and materials are shared and stay). */
  dispose(): void {
    this.clear();
    this.sprites.dispose();
    this.body.dispose();
    this.outline.dispose();
    this.group.clear();
  }
}
