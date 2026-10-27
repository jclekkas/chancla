// Combat effects: melee contact, misses and shielded blows, plus the small
// instanced sprite system the projectile impacts and the flying ruleros
// share. Purely cosmetic and driven only by authoritative events the engine
// has already deduplicated.
//
// Everything is drawn as flat, ink-rimmed cartoon shapes (a slap star, speed
// lines, rings, dust puffs and a curved air swoosh) in a handful of
// instanced meshes, one per shape. Effects are a fixed pool of records; each
// frame the live ones write their shapes into the instance buffers, so there
// is no allocation after construction and a pool full of effects still
// costs one draw call per shape.
import * as THREE from 'three';
import type { WeaponId } from '../../../shared/config';
import type { Quality } from '../settings';
import { COLORS } from './materials';

type P3 = { x: number; y: number; z: number };

/**
 * Effect settings shared by CombatFx, ProjectileView and RuleroFx. The
 * engine only tells CombatFx about quality and reduced motion and only gives
 * it the camera, so CombatFx publishes them here for the other two.
 */
export interface FxSettings { quality: Quality; reduced: boolean; camera: THREE.Camera | null }
export const FX_SETTINGS: FxSettings = { quality: 'high', reduced: false, camera: null };

// ---------------------------------------------------------------- shapes

export type SpriteKind = 'star' | 'ring' | 'streak' | 'puff' | 'arc' | 'swing' | 'word';

// Every shape carries `aT`: x = tone (0 cream core, 1 the instance tint,
// 2 ink rim) and y = alpha. Bands of ink use duplicated vertices so the rim
// stays crisp instead of blending into the fill.
function build(pos: number[], tone: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(tone, 2));
  g.setIndex(idx);
  return g;
}

// A closed outline (radius per angle) filled from a cream centre, with an
// ink band from `inner` to 1 of the outline.
function blob(n: number, radius: (a: number, i: number) => number, inner: number, rimAlpha: number): THREE.BufferGeometry {
  const pos = [0, 0, 0], t = [0, 1], idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, r = radius(a, i), c = Math.cos(a), s = Math.sin(a);
    pos.push(c * r * inner, s * r * inner, 0, c * r * inner, s * r * inner, 0, c * r, s * r, 0);
    t.push(1, 1, 2, rimAlpha, 2, rimAlpha);
  }
  for (let i = 0; i < n; i++) {
    const a = 1 + i * 3, b = 1 + ((i + 1) % n) * 3;
    idx.push(0, a, b, a + 1, a + 2, b + 2, a + 1, b + 2, b + 1);
  }
  return build(pos, t, idx);
}

const SPIKES = [1, 0.8, 0.96, 0.72, 1, 0.84, 0.9, 0.76];
function starGeo(): THREE.BufferGeometry {
  // A hand-drawn slap burst: eight uneven spikes.
  return blob(16, (_a, i) => (i % 2 ? 0.46 : SPIKES[i >> 1]!), 0.8, 1);
}
function puffGeo(): THREE.BufferGeometry {
  // A cartoon dust cloud: a bumpy circle with a soft ink rim.
  return blob(28, (a) => 0.86 + 0.14 * Math.abs(Math.sin(a * 3.5)), 0.86, 0.45);
}
function ringGeo(): THREE.BufferGeometry {
  const n = 28, pos: number[] = [], t: number[] = [], idx: number[] = [];
  const rows: Array<[number, number, number]> = [[0.78, 1, 0.5], [0.9, 1, 1], [0.9, 2, 0.8], [1, 2, 0.8]];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    for (const [r, tone, al] of rows) { pos.push(c * r, s * r, 0); t.push(tone, al); }
  }
  for (let i = 0; i < n; i++) {
    const a = i * 4, b = ((i + 1) % n) * 4;
    idx.push(a, b, a + 1, b, b + 1, a + 1, a + 2, b + 2, a + 3, b + 2, b + 3, a + 3);
  }
  return build(pos, t, idx);
}
function streakGeo(): THREE.BufferGeometry {
  // A speed line along +x from 0 (faint tail) to 1 (tip), unit half-width.
  const n = 8, pos: number[] = [], t: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const x = i / n, w = Math.pow(Math.sin(Math.PI * Math.min(1, x * 1.15)), 0.6) * 0.5 + 0.02;
    const al = Math.min(1, 0.15 + x * 1.4);
    pos.push(x, -w, 0, x, w, 0);
    t.push(1, al, 1, al);
  }
  for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  return build(pos, t, idx);
}
export const ARC_SPAN = 1.05; // radians either side of straight ahead (the miss swish)
export const SWING_SPAN = 0.5; // the shorter swing streaks on a hit
function arcGeo(span: number): THREE.BufferGeometry {
  // A curved band of air around her at unit radius (forward -z, right +x):
  // a faint tail on her right (u = 0) and a full head on her left (u = 1),
  // so a forehand moving right to left leads with the head. A pale core
  // between two crisp cool-blue edges, like a drawn swish.
  const n = 22, pos: number[] = [], t: number[] = [], idx: number[] = [];
  const rows: Array<[number, number, number]> = [[-1, 1, 0], [-0.78, 1, 0.95], [-0.45, 0.25, 0.9], [0.45, 0.25, 0.9], [0.78, 1, 0.95], [1, 1, 0]];
  for (let i = 0; i <= n; i++) {
    const u = i / n, th = span * (1 - 2 * u);
    const h = 0.5 * (0.25 + 0.75 * Math.pow(u, 0.7)) * Math.min(1, (1 - u) / 0.1 + 0.12);
    const x = Math.sin(th), z = -Math.cos(th), al = Math.pow(u, 0.9);
    for (const [y, tone, a] of rows) { pos.push(x, y * h, z); t.push(tone, a * al); }
  }
  const R = rows.length;
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < R - 1; r++) { const a = i * R + r, b = a + R; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  }
  return build(pos, t, idx);
}

const templates = new Map<SpriteKind, THREE.BufferGeometry>();
function template(k: SpriteKind): THREE.BufferGeometry {
  let g = templates.get(k);
  if (!g) {
    g = k === 'star' ? starGeo() : k === 'ring' ? ringGeo() : k === 'streak' ? streakGeo() : k === 'puff' ? puffGeo() : k === 'word' ? new THREE.PlaneGeometry(2, 1) : k === 'swing' ? arcGeo(SWING_SPAN) : arcGeo(ARC_SPAN);
    templates.set(k, g); // CPU-side templates only: each layer draws its own clone
  }
  return g;
}

const VERT = /* glsl */ `
attribute vec2 aT;
attribute float iAlpha;
varying vec2 vT;
varying float vA;
varying vec3 vC;
#include <common>
#include <fog_pars_vertex>
void main() {
  vT = aT; vA = iAlpha; vC = vec3(1.0);
#ifdef USE_INSTANCING_COLOR
  vC = instanceColor;
#endif
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = /* glsl */ `
uniform vec3 uInk;
uniform vec3 uCore;
varying vec2 vT;
varying float vA;
varying vec3 vC;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec3 c = vT.x < 1.0 ? mix(uCore, vC, vT.x) : mix(vC, uInk, vT.x - 1.0);
  gl_FragColor = vec4(c, vT.y * vA);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function spriteMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uInk: { value: new THREE.Color(COLORS.ink) }, uCore: { value: new THREE.Color(0xfffaf0) } }]),
    vertexShader: VERT, fragmentShader: FRAG, fog: true,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

// Comic words for confirmed hits, one per row of a small shared canvas:
// "¡PAF!" (El Revés) and "¡ZAS!" (El Chanclazo). Cream letters, ink outline,
// a marigold drop. 128 x 128, made once per CombatFx; none without a DOM.
export const WORDS = ['¡PAF!', '¡ZAS!'] as const;
function wordTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const el = document.createElement('canvas');
  el.width = 128; el.height = 128;
  const c = el.getContext('2d');
  if (!c) return null;
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
  WORDS.forEach((w, i) => {
    const y = 32 + i * 64;
    c.save();
    c.translate(64, y); c.rotate(-0.12);
    c.font = 'italic 900 40px "Trebuchet MS", system-ui, sans-serif';
    c.fillStyle = '#e8871e'; c.fillText(w, 3, 4);
    c.lineWidth = 7; c.strokeStyle = '#241626'; c.strokeText(w, 0, 0);
    c.fillStyle = '#fff4dc'; c.fillText(w, 0, 0);
    c.restore();
  });
  const t = new THREE.CanvasTexture(el);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return t;
}

// The word shader: the row is packed into the instance alpha (alpha + 2 * row).
const WORD_VERT = /* glsl */ `
attribute float iAlpha;
varying vec2 vUv;
varying float vA;
varying float vRow;
#include <common>
#include <fog_pars_vertex>
void main() {
  vRow = floor(iAlpha * 0.5); vA = iAlpha - 2.0 * vRow; vUv = uv;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const WORD_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vA;
varying float vRow;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uMap, vec2(vUv.x, (vUv.y + 1.0 - vRow) * 0.5));
  gl_FragColor = vec4(t.rgb, t.a * vA);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
function wordMaterial(map: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), uMap: { value: map } },
    vertexShader: WORD_VERT, fragmentShader: WORD_FRAG, fog: true,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

interface Layer { mesh: THREE.InstancedMesh; alpha: THREE.InstancedBufferAttribute; n: number; cap: number }

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * One instanced mesh per shape, written from scratch every frame:
 * begin(), add() each visible piece, end(). Hidden when empty, so an idle
 * layer costs no draw call. Over capacity, extra pieces are dropped.
 */
export class FxSprites {
  readonly group = new THREE.Group();
  private layers = new Map<SpriteKind, Layer>();
  private mat = spriteMaterial();
  private wordMat: THREE.ShaderMaterial | null = null;
  private wordTex: THREE.Texture | null = null;

  constructor(caps: Partial<Record<SpriteKind, number>>, renderOrder = 3) {
    for (const k of Object.keys(caps) as SpriteKind[]) {
      const cap = caps[k]!;
      let mat: THREE.Material = this.mat;
      if (k === 'word') {
        // Only with a canvas to draw the words on (not in Node).
        this.wordTex = wordTexture();
        if (!this.wordTex) continue;
        this.wordMat = wordMaterial(this.wordTex);
        mat = this.wordMat;
      }
      const geo = template(k).clone();
      const alpha = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('iAlpha', alpha);
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false; // instances move every frame
      mesh.renderOrder = renderOrder;
      mesh.count = 0;
      mesh.visible = false;
      this.group.add(mesh);
      this.layers.set(k, { mesh, alpha, n: 0, cap });
    }
  }

  begin(): void { for (const l of this.layers.values()) l.n = 0; }

  /** One piece; returns false when that layer is full (or absent). */
  add(kind: SpriteKind, x: number, y: number, z: number, q: THREE.Quaternion, sx: number, sy: number, sz: number, color: THREE.Color, alpha: number): boolean {
    if (sx === 0) return false;
    _m.compose(_p.set(x, y, z), q, _s.set(sx, sy, sz));
    return this.addMatrix(kind, _m, color, alpha);
  }

  /** A piece with a full matrix (already oriented and scaled). */
  addMatrix(kind: SpriteKind, m: THREE.Matrix4, color: THREE.Color, alpha: number): boolean {
    const l = this.layers.get(kind);
    if (!l || l.n >= l.cap || !(alpha > 0.003)) return false;
    l.mesh.setMatrixAt(l.n, m);
    l.mesh.setColorAt(l.n, color);
    l.alpha.array[l.n] = Math.min(1, alpha);
    l.n++;
    return true;
  }

  /** A comic word (row of WORDS), `h` high, facing `q`. */
  addWord(row: number, x: number, y: number, z: number, q: THREE.Quaternion, h: number, alpha: number): boolean {
    const l = this.layers.get('word');
    if (!l || l.n >= l.cap || !(alpha > 0.003) || h <= 0) return false;
    _m.compose(_p.set(x, y, z), q, _s.set(h, h, h));
    l.mesh.setMatrixAt(l.n, _m);
    l.alpha.array[l.n] = Math.min(1, alpha) + 2 * row;
    l.n++;
    return true;
  }

  end(): void {
    for (const l of this.layers.values()) {
      const was = l.mesh.count;
      l.mesh.count = l.n;
      l.mesh.visible = l.n > 0;
      if (l.n > 0 || was > 0) {
        l.mesh.instanceMatrix.needsUpdate = true;
        l.mesh.instanceColor!.needsUpdate = true;
        l.alpha.needsUpdate = true;
      }
    }
  }

  /** Pieces drawn last frame. */
  get pieces(): number { let n = 0; for (const l of this.layers.values()) n += l.n; return n; }
  /** Draw calls the layers cost (one per non-empty shape). */
  get drawCalls(): number { let n = 0; for (const l of this.layers.values()) if (l.mesh.visible) n++; return n; }
  /** Triangles drawn (for the budget report). */
  get triangles(): number { let n = 0; for (const l of this.layers.values()) n += (l.mesh.geometry.index!.count / 3) * l.n; return n; }
  capacity(kind: SpriteKind): number { return this.layers.get(kind)?.cap ?? 0; }

  clear(): void { this.begin(); this.end(); }

  dispose(): void {
    for (const l of this.layers.values()) { l.mesh.geometry.dispose(); l.mesh.dispose(); }
    this.layers.clear();
    this.mat.dispose();
    this.wordMat?.dispose();
    this.wordTex?.dispose();
  }
}

// ---------------------------------------------------------------- helpers

/** Deterministic noise per effect and piece, so pieces keep their places frame to frame. */
export function hash(seed: number, i: number): number {
  const s = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (a: number, b: number, v: number): number => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
/** A quick pop: from under half size to a little over 1 and back (no overshoot when reduced). */
export function pop(t: number, reduced: boolean): number {
  if (reduced) return 0.55 + 0.45 * smooth(0, 0.35, t);
  return t < 0.22 ? 0.45 + 0.75 * (t / 0.22) : 1.2 - 0.2 * smooth(0.22, 0.5, t);
}

/**
 * View safety for a piece at world distance `d` from the camera: fades and
 * shrinks it inside about 1.2 m, and caps its size so it never spans more
 * than about a tenth of the view (hollow rings may pass a larger `cap`).
 * Returns [alpha factor, size].
 */
export function nearSafe(d: number, size: number, out: [number, number], cap = 0.14): [number, number] {
  const k = smooth(0.45, 1.25, d);
  out[0] = k;
  out[1] = Math.min(size * (0.55 + 0.45 * k), cap * d);
  return out;
}

const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);

/** Camera pose for billboards, read once per frame. */
export class ViewBasis {
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  readonly right = new THREE.Vector3(1, 0, 0);
  readonly up = new THREE.Vector3(0, 1, 0);
  private q = new THREE.Quaternion();
  read(camera: THREE.Camera | null): void {
    if (!camera) return;
    camera.updateMatrixWorld();
    this.pos.setFromMatrixPosition(camera.matrixWorld);
    camera.getWorldQuaternion(this.quat);
    this.right.set(1, 0, 0).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
  }
  dist(x: number, y: number, z: number): number { return Math.hypot(x - this.pos.x, y - this.pos.y, z - this.pos.z); }
  /** A camera-facing orientation turned by `angle` in the view plane. */
  billboard(angle: number, out: THREE.Quaternion): THREE.Quaternion {
    return out.copy(this.quat).multiply(this.q.setFromAxisAngle(Z, angle));
  }
  /** Screen angle of a world direction (to align a burst with a blow). */
  angleOf(dx: number, dy: number, dz: number): number {
    return Math.atan2(dx * this.up.x + dy * this.up.y + dz * this.up.z, dx * this.right.x + dy * this.right.y + dz * this.right.z);
  }
}

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
/**
 * A speed line from (x, y, z) along unit (dx, dy, dz), `len` long and `w`
 * wide, turned about its own axis to face the camera.
 */
export function streakMatrix(view: ViewBasis, x: number, y: number, z: number, dx: number, dy: number, dz: number, len: number, w: number, out: THREE.Matrix4): THREE.Matrix4 {
  _x.set(dx, dy, dz);
  _z.set(view.pos.x - x, view.pos.y - y, view.pos.z - z);
  _y.crossVectors(_z, _x);
  if (_y.lengthSq() < 1e-8) _y.copy(view.up);
  _y.normalize();
  _z.crossVectors(_x, _y);
  out.makeBasis(_x.multiplyScalar(len), _y.multiplyScalar(w), _z);
  out.setPosition(x, y, z);
  return out;
}

// ---------------------------------------------------------------- CombatFx

const enum Kind { None, Hit, Whiff, Shield }

interface Fx {
  kind: Kind;
  weapon: WeaponId;
  head: boolean;
  x: number; y: number; z: number;
  dx: number; dz: number;
  yaw: number;
  age: number;
  life: number;
  seed: number;
  born: number;
}

/** Live melee effects at once; the oldest is reused beyond this. */
export const COMBAT_FX_POOL = 16;
// Base lifetimes (s). Reduced motion plays them at 0.75x speed: never past 0.6 s.
export const FX_LIFE = { light: 0.2, heavy: 0.3, whiffLight: 0.26, whiffHeavy: 0.32, shield: 0.42 } as const;
export const REDUCED_SPEED = 0.75;
const EYE = 1.58;

const C = {
  lightBody: new THREE.Color(0xffeab0), lightHead: new THREE.Color(0xffd36a),
  heavyBody: new THREE.Color(0xf2a032), heavyHead: new THREE.Color(0xf08a24),
  speed: new THREE.Color(0xfff2cf), shock: new THREE.Color(0xfff0d0), lilac: new THREE.Color(0xc9a6ee),
  air: new THREE.Color(0x6cb8e8), airHeavy: new THREE.Color(0x8e98ea),
  shield: new THREE.Color(0x58c8e0), shieldFill: new THREE.Color(0xd8f6ff),
  sparkle: new THREE.Color(0xfff6c8), swing: new THREE.Color(0xffc27a),
};

export class CombatFx {
  readonly group = new THREE.Group();
  private sprites = new FxSprites({ star: 64, ring: 32, streak: 80, puff: 16, arc: 32, swing: 48, word: 16 });
  private pool: Fx[] = [];
  private seq = 0;
  private view = new ViewBasis();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private m = new THREE.Matrix4();
  private e = new THREE.Euler();
  private safe: [number, number] = [1, 1];
  private settings: FxSettings;
  /** Effects started since creation (tests). */
  spawned = 0;

  constructor(settings: FxSettings = FX_SETTINGS) {
    this.settings = settings;
    this.group.add(this.sprites.group);
    for (let i = 0; i < COMBAT_FX_POOL; i++) this.pool.push({ kind: Kind.None, weapon: 0, head: false, x: 0, y: 0, z: 0, dx: 1, dz: 0, yaw: 0, age: 0, life: 0, seed: 0, born: 0 });
  }

  setQuality(q: Quality): void { this.settings.quality = q; }
  setReducedMotion(on: boolean): void { this.settings.reduced = on; }

  // A free record, or the oldest live one.
  private take(kind: Kind, weapon: WeaponId, life: number): Fx {
    let f = this.pool[0]!;
    for (const x of this.pool) {
      if (x.kind === Kind.None) { f = x; break; }
      if (x.born < f.born) f = x;
    }
    f.kind = kind; f.weapon = weapon; f.age = 0; f.life = life; f.born = ++this.seq; f.seed = (this.seq * 7.31) % 97;
    f.head = false; f.dx = 1; f.dz = 0; f.yaw = 0;
    this.spawned++;
    return f;
  }

  /** Confirmed melee contact (authoritative 'hit' with m). p: contact point; dir: unit blow direction (x, z). */
  meleeHit(weapon: WeaponId, p: P3, dir: { x: number; z: number }, head: boolean): void {
    const f = this.take(Kind.Hit, weapon, weapon === 1 ? FX_LIFE.heavy : FX_LIFE.light);
    const l = Math.hypot(dir.x, dir.z) || 1;
    f.x = p.x; f.y = p.y; f.z = p.z; f.dx = dir.x / l; f.dz = dir.z / l; f.head = head;
  }

  /** Confirmed miss (authoritative 'whiff'): the attacker's position and facing. */
  meleeWhiff(weapon: WeaponId, at: P3, yaw: number): void {
    const f = this.take(Kind.Whiff, weapon, weapon === 1 ? FX_LIFE.whiffHeavy : FX_LIFE.whiffLight);
    f.x = at.x; f.y = at.y; f.z = at.z; f.yaw = yaw;
  }

  /** Blow absorbed by spawn protection. */
  shielded(p: P3): void {
    const f = this.take(Kind.Shield, 0, FX_LIFE.shield);
    f.x = p.x; f.y = p.y; f.z = p.z;
  }

  update(dt: number, camera: THREE.Camera): void {
    this.settings.camera = camera;
    this.view.read(camera);
    const speed = this.settings.reduced ? REDUCED_SPEED : 1;
    const s = this.sprites;
    s.begin();
    for (const f of this.pool) {
      if (f.kind === Kind.None) continue;
      f.age += dt * speed;
      if (f.age >= f.life) { f.kind = Kind.None; continue; }
      const t = f.age / f.life;
      if (f.kind === Kind.Hit) this.drawHit(f, t);
      else if (f.kind === Kind.Whiff) this.drawWhiff(f, t);
      else this.drawShield(f, t);
    }
    s.end();
  }

  // El Chanclazo: a small crisp cream star and short speed lines along the
  // blow. El Revés: a bigger marigold star, a shock ring and longer lines.
  // Head hits are a touch brighter, with a few sparkles popping up.
  private drawHit(f: Fx, t: number): void {
    const q = this.settings.quality, reduced = this.settings.reduced, heavy = f.weapon === 1, v = this.view, s = this.sprites;
    // Sit just in front of the body so the burst is not buried in it.
    let d = v.dist(f.x, f.y, f.z);
    const push = Math.min(0.28, d * 0.3) / (d || 1);
    const x = f.x + (v.pos.x - f.x) * push, y = f.y + (v.pos.y - f.y) * push, z = f.z + (v.pos.z - f.z) * push;
    d = v.dist(x, y, z);
    const fade = 1 - smooth(heavy ? 0.5 : 0.45, 1, t);
    // A little larger far away so a slap still reads at 5-10 m.
    const k = (reduced ? 0.85 : 1) * Math.min(1.6, Math.max(1, Math.sqrt(d / 3)));
    const ang = v.angleOf(f.dx, 0, f.dz);
    // The star.
    const base = (heavy ? (f.head ? 0.44 : 0.38) : (f.head ? 0.25 : 0.21)) * k;
    const [na, size] = nearSafe(d, base * pop(t, reduced), this.safe);
    const col = heavy ? (f.head ? C.heavyHead : C.heavyBody) : (f.head ? C.lightHead : C.lightBody);
    s.add('star', x, y, z, v.billboard(ang + (reduced ? 0 : t * (heavy ? -0.5 : 0.8)), this.q), size, size * (heavy ? 0.92 : 0.86), size, col, fade * na);
    // Low: the star alone carries it.
    if (q === 'low') return;
    if (heavy) {
      const r = (0.16 + 0.5 * smooth(0, 0.8, t) * (reduced ? 0.7 : 1)) * (f.head ? 1.1 : 1);
      const [ra, rs] = nearSafe(d, r, this.safe, 0.22);
      s.add('ring', x, y, z, v.billboard(0, this.q), rs, rs * 0.85, rs, C.shock, (1 - t) * 0.85 * ra);
    }
    const lines = heavy ? (q === 'high' ? 5 : 3) : (q === 'high' ? 3 : 2);
    const travel = (heavy ? 0.42 : 0.26) * (reduced ? 0.5 : 1) * smooth(0, 0.7, t);
    for (let i = 0; i < lines; i++) {
      // Fanned around the blow direction, a little up and down.
      const spread = ((i / Math.max(1, lines - 1)) - 0.5) * (heavy ? 1.1 : 0.9) + (hash(f.seed, i) - 0.5) * 0.2;
      const c = Math.cos(spread), sn = Math.sin(spread);
      const ddx = f.dx * c - f.dz * sn, ddz = f.dx * sn + f.dz * c, ddy = (hash(f.seed, i + 9) - 0.5) * 0.7;
      const nl = Math.hypot(ddx, ddy, ddz);
      const start = (heavy ? 0.16 : 0.1) + travel;
      const px = x + (ddx / nl) * start, py = y + (ddy / nl) * start, pz = z + (ddz / nl) * start;
      const len = (heavy ? 0.3 : 0.18) * (1 - 0.5 * t) * k;
      const [la, ls] = nearSafe(v.dist(px, py, pz), len, this.safe);
      s.addMatrix('streak', streakMatrix(v, px, py, pz, ddx / nl, ddy / nl, ddz / nl, ls, ls * 0.16, this.m), heavy && i % 2 ? C.lilac : C.speed, fade * la);
    }
    this.drawSwing(f, t);
    // The comic word: ¡PAF! for El Revés (High and Medium), a smaller ¡ZAS!
    // for El Chanclazo (High), up and to the side the blow travels, so it
    // never sits on the target.
    if (heavy || q === 'high') {
      const side = Math.cos(ang) >= 0 ? -1 : 1; // on the side the blow came from, as in a comic panel
      const off = (heavy ? 0.36 : 0.3) * Math.min(1.6, Math.max(1, Math.sqrt(d / 3)));
      const wx = x + v.right.x * side * off, wy = y + (heavy ? 0.26 : 0.24) + (reduced ? 0 : 0.06 * t), wz = z + v.right.z * side * off;
      const [wa, wh] = nearSafe(v.dist(wx, wy, wz), (heavy ? 0.15 : 0.1) * k * pop(t, reduced), this.safe);
      s.addWord(heavy ? 0 : 1, wx, wy, wz, v.billboard(0, this.q), wh, (1 - smooth(heavy ? 0.6 : 0.5, 1, t)) * wa);
    }
    if (f.head && q === 'high') {
      for (let i = 0; i < 3; i++) {
        const a = (i - 1) * 0.9 + (hash(f.seed, i + 20) - 0.5) * 0.4;
        const rise = 0.12 + 0.28 * smooth(0, 0.9, t) * (reduced ? 0.5 : 1);
        const sx = x + v.right.x * Math.sin(a) * rise, sy = y + 0.1 + Math.cos(a) * rise, sz = z + v.right.z * Math.sin(a) * rise;
        const [sa, ss] = nearSafe(v.dist(sx, sy, sz), 0.07 * (1 - 0.4 * t) * k, this.safe);
        s.add('star', sx, sy, sz, v.billboard(a + t * 3, this.q), ss, ss, ss, C.sparkle, (1 - smooth(0.6, 1, t)) * sa);
      }
    }
  }

  // Curved swing streaks on a confirmed hit: two or three thin warm bands
  // along the arc the blow came in on, ending at the contact point, so the
  // swing reads from any side (forehand from her right, backhand from her
  // left). Not on Low.
  private drawSwing(f: Fx, t: number): void {
    const q = this.settings.quality, reduced = this.settings.reduced, heavy = f.weapon === 1, v = this.view;
    if (q === 'low') return;
    // Centre of the swing: toward the attacker, square to the blow
    // (forehand: the blow turned left; backhand: turned right).
    const turn = heavy ? -1 : 1;
    const R = heavy ? 0.95 : 0.85;
    const px = -f.dz * turn, pz = f.dx * turn; // (dx, dz) turned 90 degrees
    const cx = f.x + px * R, cz = f.z + pz * R;
    const wx = -px, wz = -pz; // centre to contact
    // Pick the mirror whose head points along the blow.
    let mirror = 1, yaw = 0;
    for (const m of [1, -1]) {
      const hx = -m * Math.sin(SWING_SPAN), hz = -Math.cos(SWING_SPAN);
      const a = Math.atan2(wx, wz) - Math.atan2(hx, hz);
      const tx0 = -m * Math.cos(SWING_SPAN), tz0 = Math.sin(SWING_SPAN);
      const tx = tx0 * Math.cos(a) + tz0 * Math.sin(a), tz = -tx0 * Math.sin(a) + tz0 * Math.cos(a);
      if (tx * f.dx + tz * f.dz > 0) { mirror = m; yaw = a; break; }
    }
    const fade = smooth(0, 0.1, t) * (1 - smooth(0.35, 0.9, t));
    const [na] = nearSafe(v.dist(f.x, f.y, f.z), 1, this.safe);
    const bands = q === 'high' ? 3 : 2;
    for (let i = 0; i < bands; i++) {
      const tilt = (i - (bands - 1) / 2) * 0.22 + (hash(f.seed, i + 30) - 0.5) * 0.1;
      this.q.setFromAxisAngle(_x.set(wx, 0, wz), tilt);
      this.q2.setFromAxisAngle(Y, yaw);
      this.q.multiply(this.q2);
      const r = R * (1 + (i - 1) * 0.05);
      _s.set(r * mirror, (heavy ? 0.11 : 0.08) * (reduced ? 0.8 : 1), r);
      this.m.compose(_p.set(cx, f.y + (i - 1) * 0.04, cz), this.q, _s);
      this.sprites.addMatrix('swing', this.m, C.swing, (heavy ? 1 : 0.9) * fade * na * (1 - i * 0.2));
    }
  }

  // A miss: a pale, cool band of air sweeping through the space in front of
  // her (forehand right to left, backhand left to right). No star, no warm
  // colour, nothing that lands: it must never read as damage.
  private drawWhiff(f: Fx, t: number): void {
    const q = this.settings.quality, reduced = this.settings.reduced, heavy = f.weapon === 1, v = this.view;
    // Through the space her blow would have hit, just under her face so it never hides it.
    const px = f.x, py = f.y + EYE - (heavy ? 0.36 : 0.3), pz = f.z;
    const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw);
    const R = heavy ? 1.15 : 1.05;
    const [na] = nearSafe(v.dist(px + fx * R, py, pz + fz * R), 1, this.safe);
    const alpha = smooth(0, 0.15, t) * (1 - smooth(0.5, 1, t)) * (heavy ? 0.9 : 0.85) * na;
    // Rotating about her while it fades, from her right to her left for the
    // forehand (positive turns are to her left), mirrored for the backhand.
    const mirror = heavy ? -1 : 1; // the band's head is on her left; the backhand mirrors it
    const sweep = (-0.55 + 1.1 * smooth(0, 1, t)) * (reduced ? 0.5 : 1);
    const tilt = 0.28; // right side high: a downward forehand, a rising backhand
    const h = (heavy ? 0.36 : 0.26) * (reduced ? 0.85 : 1);
    const bands = q === 'high' ? 2 : 1;
    for (let i = 0; i < bands; i++) {
      const r = R * (1 - i * 0.14);
      this.e.set(0, f.yaw, 0, 'YXZ');
      this.q.setFromEuler(this.e);
      this.q2.setFromAxisAngle(Z, tilt);
      this.q.multiply(this.q2);
      this.q2.setFromAxisAngle(Y, (sweep - i * 0.12) * mirror);
      this.q.multiply(this.q2);
      _s.set(r * mirror, h * (1 - i * 0.35), r);
      this.m.compose(_p.set(px, py - i * 0.08, pz), this.q, _s);
      this.sprites.addMatrix('arc', this.m, heavy ? C.airHeavy : C.air, alpha * (1 - i * 0.45));
    }
  }

  // Spawn protection: a soft aqua ripple on an invisible bubble, the
  // team-neutral bubble look; no star, so no damage.
  private drawShield(f: Fx, t: number): void {
    const q = this.settings.quality, reduced = this.settings.reduced, v = this.view, s = this.sprites;
    // On the near side of her bubble, so her body does not hide it.
    let d = v.dist(f.x, f.y, f.z);
    const push = Math.min(0.4, d * 0.3) / (d || 1);
    const x = f.x + (v.pos.x - f.x) * push, y = f.y + (v.pos.y - f.y) * push, z = f.z + (v.pos.z - f.z) * push;
    d = v.dist(x, y, z);
    const grow = reduced ? 0.6 : 1;
    const rings = q === 'low' ? 1 : 2;
    for (let i = 0; i < rings; i++) {
      const ti = clamp01((t - i * 0.22) / 0.78);
      if (ti <= 0) continue;
      const [a, r] = nearSafe(d, 0.16 + 0.34 * smooth(0, 1, ti) * grow, this.safe, 0.18);
      s.add('ring', x, y, z, v.billboard(0, this.q), r, r * 1.25, r, i ? C.shieldFill : C.shield, (1 - smooth(0.3, 1, ti)) * 0.8 * a);
    }
    if (q !== 'low') {
      const [a, r] = nearSafe(d, 0.3 + 0.15 * smooth(0, 0.5, t), this.safe, 0.16);
      s.add('puff', x, y, z, v.billboard(0, this.q), r, r * 1.25, r, C.shieldFill, 0.2 * (1 - smooth(0.3, 0.9, t)) * a);
    }
  }

  clear(): void {
    for (const f of this.pool) f.kind = Kind.None;
    this.sprites.clear();
  }

  dispose(): void {
    this.clear();
    this.sprites.dispose();
    this.group.clear();
  }

  /** Live and pooled counts, for tests and the benchmark. */
  stats(): { active: number; pooled: number; drawCalls: number } {
    let active = 0;
    for (const f of this.pool) if (f.kind !== Kind.None) active++;
    return { active, pooled: this.pool.length, drawCalls: this.sprites.drawCalls };
  }

  /** Pieces and triangles drawn last frame (budget report). */
  cost(): { pieces: number; triangles: number } { return { pieces: this.sprites.pieces, triangles: this.sprites.triangles }; }
}
