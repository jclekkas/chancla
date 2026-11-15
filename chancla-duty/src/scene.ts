// Chancla Duty's scene. The Warfare page never imports this.
// Static maps are one merged mesh plus a handful of instanced props.
// Characters, chanclas, and impacts are pooled. Nothing in sync() allocates.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EL_PATIO, type MapBox, type MapData, type MapDecor } from '../../shared/map';
import type { WorldOptions } from '../../src/fps/render/world';
import { THEMES } from '../../src/fps/render/world';
import type { Engine } from '../../src/fps/engine';
import type { WeaponId } from '../../shared/config';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

export interface DutyStats {
  cpuMs: number;
  syncMs: number;
  frames: number;
  calls: number;
  triangles: number;
  gpu: string;
  tier: 'fast' | 'high';
}

const TILE: Record<string, number> = {
  stone: 1, fountain: 1, statue: 1, step: 1, parapet: 1, planter: 1,
  wood: 2, stall: 2, crate: 2, kiosk: 2, table: 2, lintel: 2, bin: 2,
  hedge: 0, gift: 0, stage: 0,
};

const TINT: Record<string, number> = {
  stuccoTerracotta: 0xd8765a, stuccoCream: 0xf1dfbc, stuccoTurquoise: 0x7cc7bb,
  stuccoMarigold: 0xf0b45a, stuccoViolet: 0x8a6aa8, stuccoPink: 0xeb9aac,
  stone: 0xe4d7c2, fountain: 0xd5e4ea, statue: 0xf4efe4, step: 0xcdb892, parapet: 0xefe6d4, planter: 0x6f8f55,
  wood: 0xc48a52, stall: 0xd7a15a, crate: 0xb5814a, kiosk: 0xcc8d4e, table: 0xe6d2a4, lintel: 0xf7f1e4, bin: 0x8d9094,
  hedge: 0x3f8f45, gift: 0xde5d8a, stage: 0x6a4a86,
};

function atlasTexture(): THREE.CanvasTexture {
  const cnv = document.createElement('canvas');
  cnv.width = 512; cnv.height = 512;
  const g = cnv.getContext('2d')!;
  const tile = (ox: number, oy: number, paint: (c: CanvasRenderingContext2D) => void) => {
    g.save();
    g.beginPath();
    g.rect(ox, oy, 256, 256);
    g.clip();
    g.translate(ox, oy);
    paint(g);
    g.restore();
  };
  tile(0, 0, (c) => {
    c.fillStyle = '#fff7ee';
    c.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 16) {
      c.fillStyle = 'rgba(90,48,28,0.2)';
      c.fillRect(0, y, 256, 2);
      for (let x = (y / 16) % 2 ? 0 : 32; x < 256; x += 64) {
        c.fillStyle = 'rgba(120,70,40,0.08)';
        c.fillRect(x + 1, y + 3, 60, 11);
      }
    }
    c.fillStyle = 'rgba(70,36,20,0.28)';
    c.fillRect(0, 214, 256, 42);
    c.fillStyle = '#fff3d8';
    c.fillRect(0, 204, 256, 8);
  });
  tile(256, 0, (c) => {
    c.fillStyle = '#f4ecdf';
    c.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 28) for (let x = 0; x < 256; x += 22) {
      const n = ((x * 13 + y * 7) % 36) - 18;
      c.fillStyle = `rgb(${186 + n},${174 + n},${154 + n})`;
      c.fillRect(x + 1, y + 1, 19, 24);
    }
  });
  tile(0, 256, (c) => {
    c.fillStyle = '#e8b27a';
    c.fillRect(0, 0, 256, 256);
    c.strokeStyle = 'rgba(110,62,28,0.35)';
    for (let y = 0; y < 256; y += 10) { c.beginPath(); c.moveTo(0, y); c.lineTo(256, y + 2); c.stroke(); }
  });
  tile(256, 256, (c) => {
    const colors = ['#e23b4a', '#f2c14e', '#2aa8a0', '#7a4ea3', '#f28b3c'];
    for (let i = 0; i < 5; i++) {
      c.fillStyle = colors[i]!;
      c.beginPath();
      c.moveTo(i * 51, 0);
      c.lineTo((i + 1) * 51, 0);
      c.lineTo(i * 51 + 25, 256);
      c.closePath();
      c.fill();
    }
  });
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  return tex;
}

function groundTexture(): THREE.CanvasTexture {
  const cnv = document.createElement('canvas');
  cnv.width = 256; cnv.height = 256;
  const g = cnv.getContext('2d')!;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const warm = (x + y) % 2 === 0 ? 196 : 168;
    g.fillStyle = `rgb(${warm + 28},${warm - 10},${warm - 48})`;
    g.fillRect(x * 64, y * 64, 64, 64);
    g.strokeStyle = 'rgba(92,58,32,0.65)';
    g.lineWidth = 3;
    g.strokeRect(x * 64 + 2, y * 64 + 2, 60, 60);
    g.fillStyle = 'rgba(255,236,200,0.18)';
    g.fillRect(x * 64 + 6, y * 64 + 6, 18, 8);
  }
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 8);
  tex.anisotropy = 4;
  return tex;
}

function paintBox(geo: THREE.BufferGeometry, hex: number, tile: number): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const cols = new Float32Array(pos.count * 3);
  _c.setHex(hex);
  const u0 = (tile % 2) * 0.5;
  const v0 = tile > 1 ? 0.5 : 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ny = nrm.getY(i);
    let ao = ny > 0.55 ? 1.12 : ny < -0.55 ? 0.42 : 0.9;
    if (y < 0.55) ao *= 0.7;
    else if (y < 1.3) ao *= 0.88;
    cols[i * 3] = Math.min(1, _c.r * ao);
    cols[i * 3 + 1] = Math.min(1, _c.g * ao);
    cols[i * 3 + 2] = Math.min(1, _c.b * ao);
    const fu = (((x + z) * 0.45) % 1 + 1) % 1;
    const fv = ((y * 0.55) % 1 + 1) % 1;
    uv.setXY(i, u0 + fu * 0.5, v0 + fv * 0.5);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
}

function chanclaGeometry(hex: number, heel: boolean): THREE.BufferGeometry {
  const sole = new THREE.BoxGeometry(heel ? 0.22 : 0.3, heel ? 0.06 : 0.045, 0.12);
  const strap = new THREE.TorusGeometry(0.065, 0.014, 5, 10);
  strap.rotateX(Math.PI / 2);
  strap.translate(0, 0.05, heel ? 0.01 : 0.02);
  const flower = new THREE.SphereGeometry(0.028, 6, 5);
  flower.translate(0, 0.08, 0.03);
  const heelBox = heel ? new THREE.BoxGeometry(0.1, 0.1, 0.08) : null;
  heelBox?.translate(-0.06, 0.02, 0);
  const parts: THREE.BufferGeometry[] = [sole, strap, flower];
  if (heelBox) parts.push(heelBox);
  for (const geo of parts) {
    const n = geo.attributes.position!.count;
    const cols = new Float32Array(n * 3);
    _c.setHex(geo === flower ? 0xf2c14e : hex);
    for (let i = 0; i < n; i++) { cols[i * 3] = _c.r; cols[i * 3 + 1] = _c.g; cols[i * 3 + 2] = _c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  return mergeGeometries(parts, false)!;
}

function bodyGeometry(team: 0 | 1): THREE.BufferGeometry {
  const dress = new THREE.Color(team === 0 ? 0xe8871e : 0x1aa0a8);
  const skin = new THREE.Color(0xd08a5c);
  const hair = new THREE.Color(0x2a160f);
  const gold = new THREE.Color(0xf5c542);
  const skirt = new THREE.ConeGeometry(0.36, 0.78, 8);
  skirt.translate(0, 0.48, 0);
  const torso = new THREE.BoxGeometry(0.38, 0.4, 0.22);
  torso.translate(0, 0.98, 0);
  const shawl = new THREE.BoxGeometry(0.46, 0.16, 0.26);
  shawl.translate(0, 1.12, 0);
  const head = new THREE.SphereGeometry(0.16, 10, 8);
  head.translate(0, 1.36, 0);
  const bun = new THREE.SphereGeometry(0.09, 8, 6);
  bun.translate(0, 1.52, -0.03);
  const flower = new THREE.SphereGeometry(0.035, 6, 5);
  flower.translate(0.1, 1.5, 0.06);
  const parts: Array<[THREE.BufferGeometry, THREE.Color]> = [[skirt, dress], [torso, dress], [shawl, team === 0 ? gold : new THREE.Color(0xf4e6c8)], [head, skin], [bun, hair], [flower, gold]];
  for (const [geo, color] of parts) {
    const n = geo.attributes.position!.count;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { cols[i * 3] = color.r; cols[i * 3 + 1] = color.g; cols[i * 3 + 2] = color.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  return mergeGeometries(parts.map((p) => p[0]), false)!;
}

function armGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(0.08, 0.36, 0.08);
  geo.translate(0, -0.16, 0);
  const n = geo.attributes.position!.count;
  const cols = new Float32Array(n * 3);
  _c.setHex(0xd08a5c);
  for (let i = 0; i < n; i++) { cols[i * 3] = _c.r; cols[i * 3 + 1] = _c.g; cols[i * 3 + 2] = _c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}

interface Actor {
  root: THREE.Group;
  arm: THREE.Mesh;
  team: 0 | 1;
}

const BURST = 48;
const burstP = new Float32Array(BURST * 3);
const burstV = new Float32Array(BURST * 3);
const burstL = new Float32Array(BURST);

export class DutyScene {
  readonly root = new THREE.Group();
  readonly stats: DutyStats = { cpuMs: 0, syncMs: 0, frames: 0, calls: 0, triangles: 0, gpu: '', tier: 'fast' };
  readonly viewmodels: THREE.Object3D[] = [];
  private readonly lit: THREE.Material;
  private readonly skin: THREE.Material;
  private readonly actors: Actor[] = [];
  private readonly body = [bodyGeometry(0), bodyGeometry(1)];
  private readonly armGeo = armGeometry();
  private shots: THREE.InstancedMesh | null = null;
  private sparks: THREE.InstancedMesh | null = null;
  private pinata: THREE.Mesh | null = null;
  private pinSpin = 0;
  private hemi: THREE.HemisphereLight | null = null;
  private seenEnd = '';
  private gpuTier = false;

  constructor(gpu: boolean) {
    this.gpuTier = gpu;
    this.stats.tier = gpu ? 'high' : 'fast';
    this.root.name = 'duty-scene';
    const atlas = atlasTexture();
    this.lit = gpu
      ? new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.62, metalness: 0.04 })
      : new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true });
    this.skin = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (let i = 0; i < 6; i++) this.actors.push(this.makeActor(i < 3 ? 0 : 1));
    const shot = new THREE.InstancedMesh(chanclaGeometry(0x2bb5b0, false), this.skin, 24);
    shot.count = 0;
    shot.frustumCulled = false;
    this.shots = shot;
    this.root.add(shot);
    const spark = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.08, 0), new THREE.MeshBasicMaterial({ color: 0xffe08a }), BURST);
    spark.count = 0;
    spark.frustumCulled = false;
    this.sparks = spark;
    this.root.add(spark);
    this.buildViewmodels();
  }

  private makeActor(team: 0 | 1): Actor {
    const root = new THREE.Group();
    const body = new THREE.Mesh(this.body[team]!, this.skin);
    const arm = new THREE.Mesh(this.armGeo, this.skin);
    arm.position.set(team === 0 ? 0.22 : -0.22, 1.15, 0.04);
    root.add(body, arm);
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.38, 10), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.03;
    root.add(blob);
    root.visible = false;
    this.root.add(root);
    return { root, arm, team };
  }

  private buildViewmodels(): void {
    const specs: Array<[number, boolean]> = [[0x2bb5b0, false], [0x6a3d86, true], [0xc48a52, false], [0xf2c14e, false], [0x2a160f, true]];
    for (const [hex, heel] of specs) {
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(chanclaGeometry(hex, heel), this.skin);
      mesh.scale.setScalar(1.8);
      if (heel) mesh.rotation.z = -0.4;
      g.add(mesh);
      if (hex === 0xf2c14e) {
        const twin = mesh.clone();
        twin.position.x = 0.16;
        g.add(twin);
      }
      g.position.set(0.28, -0.22, -0.42);
      g.rotation.set(0.3, -0.6, 0.15);
      g.visible = false;
      this.viewmodels.push(g);
    }
  }

  rebuild(opts: WorldOptions = {}): void {
    const map: MapData = opts.map ?? EL_PATIO;
    const boxes = opts.boxes ?? map.boxes;
    const theme = THEMES[opts.theme ?? 'afternoon'];
    for (const child of [...this.root.children]) {
      if (child.userData['keep']) continue;
      this.root.remove(child);
      const mesh = child as THREE.Mesh;
      if (mesh.geometry && child !== this.shots && child !== this.sparks && !this.actors.some((a) => a.root === child)) mesh.geometry.dispose();
    }
    for (const actor of this.actors) this.root.add(actor.root);
    if (this.shots) this.root.add(this.shots);
    if (this.sparks) this.root.add(this.sparks);

    this.root.add(skyMesh(theme.sky));

    this.hemi = new THREE.HemisphereLight(theme.hemi[0], theme.hemi[1], this.gpuTier ? theme.hemi[2] : theme.hemi[2]);
    this.root.add(new THREE.AmbientLight(0xfff4e8, 0.55));
    const sun = new THREE.DirectionalLight(theme.sun[0], theme.sun[1]);
    sun.position.set(...theme.sunPos);
    if (this.gpuTier) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      const bd = map.bounds;
      const sc = sun.shadow.camera;
      sc.left = bd.minX; sc.right = bd.maxX; sc.top = bd.maxZ; sc.bottom = bd.minZ; sc.near = 1; sc.far = 80;
    }
    this.root.add(this.hemi, sun);

    const decor = map.decor;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(decor?.ground.w ?? 70, decor?.ground.d ?? 50), new THREE.MeshLambertMaterial({ map: groundTexture() }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = this.gpuTier;
    this.root.add(ground);

    const pieces: THREE.BufferGeometry[] = [];
    for (const b of boxes) pushBox(pieces, b);
    if (pieces.length) {
      const merged = mergeGeometries(pieces, false);
      if (merged) {
        const mesh = new THREE.Mesh(merged, this.lit);
        mesh.castShadow = this.gpuTier;
        mesh.receiveShadow = this.gpuTier;
        this.root.add(mesh);
      }
      for (const p of pieces) p.dispose();
    }
    if (decor && !opts.boxes) this.addDressing(decor, theme.bulbsGlow);
    this.pinata = null;
    if (decor?.pinata && !opts.boxes) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), new THREE.MeshLambertMaterial({ color: 0xf2a33a }));
      mesh.position.set(decor.pinata.x, decor.pinata.y, decor.pinata.z);
      this.pinata = mesh;
      this.root.add(mesh);
    }
  }

  private addDressing(decor: MapDecor, glow: boolean): void {
    const flag = new THREE.PlaneGeometry(0.34, 0.48);
    const flags = new THREE.InstancedMesh(flag, new THREE.MeshBasicMaterial({ vertexColors: false, side: THREE.DoubleSide, color: 0xffffff }), 180);
    flags.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(180 * 3), 3);
    let n = 0;
    const colors = [0xe23b4a, 0xf2c14e, 0x2aa8a0, 0x7a4ea3, 0xf28b3c];
    for (const line of decor.papel ?? []) n = sprinkle(flags, n, line, 0.85, 0, colors);
    flags.count = n;
    if (n) this.root.add(flags);

    const bulbGeo = new THREE.SphereGeometry(0.06, 6, 5);
    const bulbs = new THREE.InstancedMesh(bulbGeo, new THREE.MeshBasicMaterial({ color: glow ? 0xfff1c9 : 0xffe08a }), 100);
    n = 0;
    for (const line of decor.lights ?? []) n = sprinkle(bulbs, n, line, 1.3, 0, null);
    bulbs.count = n;
    if (n) this.root.add(bulbs);

    const pot = new THREE.InstancedMesh(new THREE.ConeGeometry(0.55, 1.6, 7), new THREE.MeshLambertMaterial({ color: 0x3f8f45 }), 40);
    n = 0;
    for (const t of decor.trees ?? []) {
      if (n >= 40) break;
      _p.set(t.x, t.y + 0.7, t.z);
      _q.identity();
      _s.set(1, 1, 1);
      pot.setMatrixAt(n++, _m.compose(_p, _q, _s));
    }
    pot.count = n;
    if (n) this.root.add(pot);

    const awnings = decor.awnings ?? [];
    if (awnings.length) {
      const cloth = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), awnings.length);
      cloth.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(awnings.length * 3), 3);
      awnings.forEach((a, i) => {
        _p.set((a.minX + a.maxX) / 2, a.y, (a.minZ + a.maxZ) / 2);
        _q.identity();
        _s.set(Math.max(0.2, a.maxX - a.minX), 0.08, Math.max(0.2, a.maxZ - a.minZ));
        cloth.setMatrixAt(i, _m.compose(_p, _q, _s));
        _c.setHex(a.color);
        cloth.instanceColor!.setXYZ(i, _c.r, _c.g, _c.b);
      });
      cloth.count = awnings.length;
      cloth.instanceMatrix.needsUpdate = true;
      cloth.instanceColor.needsUpdate = true;
      this.root.add(cloth);
    }
  }

  setBrightness(k: number): void {
    if (this.hemi) this.hemi.intensity = 0.45 + k * 0.7;
  }

  spinPinata(): void { this.pinSpin = 1; }

  /** Poses pooled actors, projectiles, and impacts. No allocations. */
  sync(engine: Engine, now: number): void {
    const t0 = performance.now();
    const mode = engine.mode;
    const session = (engine as unknown as { session: { remotes: Map<number, Remote>; body: { x: number; y: number; z: number }; alive: boolean; team: 0 | 1 | null; weapon: WeaponId; projectiles: Map<string, Shot> } | null }).session;
    let used = 0;
    if (mode === 'menu') {
      for (const actor of this.actors) actor.root.visible = false;
      pose(this.actors[0]!, -1.7, 0, 3.2, 0.5, now, 0);
      pose(this.actors[3]!, 1.7, 0, 3.2, -0.5, now, 1.4);
      used = this.actors.length;
    } else if (mode === 'match' && session) {
      for (const remote of session.remotes.values()) {
        if (!remote.alive || used >= this.actors.length) continue;
        const actor = this.actors[used]!;
        pose(actor, remote.x, remote.y, remote.z, remote.yaw + Math.PI, now, remote.msSinceThrow / 1000);
        if (remote.crouched) actor.root.scale.set(1, 0.72, 1);
        else actor.root.scale.set(1, 1, 1);
        const dx = remote.x - engine.camera.position.x;
        const dz = remote.z - engine.camera.position.z;
        actor.arm.visible = dx * dx + dz * dz < 28 * 28;
        used++;
      }
    } else if (mode === 'controller') {
      const rt = (engine as unknown as { controller?: { sim?: { state?: { player?: { x: number; y: number; z: number; yaw: number }; actors?: Array<{ x: number; y: number; z: number; yaw: number; enabled: boolean }> } } } }).controller;
      const actors = rt?.sim?.state?.actors ?? [];
      for (const a of actors) {
        if (!a.enabled || used >= this.actors.length) continue;
        pose(this.actors[used]!, a.x, a.y, a.z, a.yaw, now, 2);
        used++;
      }
    }
    for (let i = used; i < this.actors.length; i++) this.actors[i]!.root.visible = false;

    const shots = this.shots;
    if (shots) {
      let n = 0;
      if (session && mode === 'match') {
        for (const shot of session.projectiles.values()) {
          if (shot.done || n >= 24) continue;
          const pr = shot.pr;
          _p.set(pr.x, pr.y, pr.z);
          _e.set(now * 0.01, now * 0.008, 0.3);
          _q.setFromEuler(_e);
          _s.set(1.4, 1.4, 1.4);
          shots.setMatrixAt(n++, _m.compose(_p, _q, _s));
          if (shot.endAt > 0 && this.seenEnd !== shot.id) {
            this.seenEnd = shot.id;
            this.burst(pr.x, pr.y, pr.z);
          }
        }
      }
      shots.count = n;
      if (n) shots.instanceMatrix.needsUpdate = true;
    }
    this.stepBursts(now);
    if (this.pinata && this.pinSpin > 0) {
      this.pinSpin = Math.max(0, this.pinSpin - 0.02);
      this.pinata.rotation.y += 0.4;
    }
    const weapon = session?.weapon ?? 0;
    const showHand = mode !== 'menu';
    for (let i = 0; i < this.viewmodels.length; i++) {
      const vm = this.viewmodels[i]!;
      vm.visible = showHand && i === Math.min(4, weapon);
      if (vm.visible) vm.rotation.x = 0.3 + Math.sin(now * 0.006) * 0.03;
    }
    this.stats.syncMs = performance.now() - t0;
  }

  private burst(x: number, y: number, z: number): void {
    for (let k = 0; k < 6; k++) {
      let slot = -1;
      for (let i = 0; i < BURST; i++) if (burstL[i]! <= 0) { slot = i; break; }
      if (slot < 0) return;
      burstP[slot * 3] = x; burstP[slot * 3 + 1] = y; burstP[slot * 3 + 2] = z;
      burstV[slot * 3] = (k - 2.5) * 0.8;
      burstV[slot * 3 + 1] = 2 + (k % 3);
      burstV[slot * 3 + 2] = (k % 2 ? -1 : 1) * 0.9;
      burstL[slot] = 0.45;
    }
  }

  private stepBursts(now: number): void {
    const sparks = this.sparks;
    if (!sparks) return;
    const dt = 0.016;
    let n = 0;
    for (let i = 0; i < BURST; i++) {
      if (burstL[i]! <= 0) continue;
      burstL[i] = burstL[i]! - dt;
      burstP[i * 3 + 1] = burstP[i * 3 + 1]! + burstV[i * 3 + 1]! * dt;
      burstV[i * 3 + 1] = burstV[i * 3 + 1]! - 6 * dt;
      burstP[i * 3] = burstP[i * 3]! + burstV[i * 3]! * dt;
      burstP[i * 3 + 2] = burstP[i * 3 + 2]! + burstV[i * 3 + 2]! * dt;
      _p.set(burstP[i * 3]!, burstP[i * 3 + 1]!, burstP[i * 3 + 2]!);
      _q.setFromEuler(_e.set(0, now * 0.004, 0));
      const s = Math.max(0.2, burstL[i]! * 2);
      _s.set(s, s, s);
      sparks.setMatrixAt(n++, _m.compose(_p, _q, _s));
    }
    sparks.count = n;
    if (n) sparks.instanceMatrix.needsUpdate = true;
  }

  async enableHigh(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<((scene: THREE.Scene, camera: THREE.Camera) => void) | null> {
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { GTAOPass }, { OutputPass }, { FXAAPass }] = await Promise.all([
        import('three/examples/jsm/postprocessing/EffectComposer.js'),
        import('three/examples/jsm/postprocessing/RenderPass.js'),
        import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
        import('three/examples/jsm/postprocessing/GTAOPass.js'),
        import('three/examples/jsm/postprocessing/OutputPass.js'),
        import('three/examples/jsm/postprocessing/FXAAPass.js'),
      ]);
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      const gtao = new GTAOPass(scene, camera, renderer.domElement.width, renderer.domElement.height);
      gtao.output = GTAOPass.OUTPUT.Default;
      composer.addPass(gtao);
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(renderer.domElement.width, renderer.domElement.height), 0.18, 0.4, 0.85));
      composer.addPass(new FXAAPass());
      composer.addPass(new OutputPass());
      try {
        const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js');
        const pmrem = new THREE.PMREMGenerator(renderer);
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        pmrem.dispose();
      } catch { /* environment is optional */ }
      return () => composer.render();
    } catch {
      return null;
    }
  }
}

interface Remote { id: number; x: number; y: number; z: number; yaw: number; alive: boolean; crouched: boolean; msSinceThrow: number }
interface Shot { id: string; done: boolean; endAt: number; pr: { x: number; y: number; z: number } }

function pose(actor: Actor, x: number, y: number, z: number, yaw: number, now: number, throwT: number): void {
  actor.root.visible = true;
  actor.root.position.set(x, y, z);
  actor.root.rotation.y = yaw;
  const swing = throwT < 0.35 ? Math.sin((throwT / 0.35) * Math.PI) : Math.sin(now * 0.002) * 0.08;
  actor.arm.rotation.x = -0.4 - swing * 1.4;
}

function skyMesh(stops: [number, number, number]): THREE.Mesh {
  const geo = new THREE.SphereGeometry(140, 18, 10);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const cols = new Float32Array(pos.count * 3);
  const top = new THREE.Color(stops[0]);
  const mid = new THREE.Color(stops[1]);
  const hor = new THREE.Color(stops[2]);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 140;
    _c.copy(y > 0.15 ? mid : hor).lerp(y > 0.15 ? top : mid, Math.min(1, Math.abs(y)));
    cols[i * 3] = _c.r; cols[i * 3 + 1] = _c.g; cols[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

function pushBox(pieces: THREE.BufferGeometry[], b: MapBox): void {
  const w = b.maxX - b.minX, h = b.maxY - b.minY, d = b.maxZ - b.minZ;
  if (w < 0.04 || h < 0.04 || d < 0.04) return;
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
  paintBox(geo, TINT[b.mat] ?? 0xf1dfbc, TILE[b.mat] ?? 0);
  pieces.push(geo);
  if (h > 2.2 && b.minY === 0) {
    const face = b.facade ?? 's';
    const win = new THREE.BoxGeometry(Math.min(0.7, w * 0.45), Math.min(1.1, h * 0.35), 0.06);
    const cx = (b.minX + b.maxX) / 2, cy = b.minY + h * 0.55, cz = (b.minZ + b.maxZ) / 2;
    if (face === 'n') win.translate(cx, cy, b.minZ - 0.02);
    else if (face === 's') win.translate(cx, cy, b.maxZ + 0.02);
    else if (face === 'e') win.translate(b.maxX + 0.02, cy, cz);
    else win.translate(b.minX - 0.02, cy, cz);
    paintBox(win, 0x2a3148, 1);
    pieces.push(win);
    const sill = new THREE.BoxGeometry(Math.min(0.9, w * 0.55), 0.06, 0.16);
    sill.translate(cx, cy - 0.58, face === 'n' ? b.minZ - 0.06 : face === 's' ? b.maxZ + 0.06 : cz);
    if (face === 'e' || face === 'w') sill.translate(face === 'e' ? b.maxX + 0.04 - cx : b.minX - 0.04 - cx, 0, 0);
    paintBox(sill, 0xf7f1e4, 1);
    pieces.push(sill);
  }
}

function sprinkle(mesh: THREE.InstancedMesh, n: number, line: [number, number, number, number, number], step: number, yOff: number, colors: number[] | null): number {
  const [ax, az, bx, bz, y] = line;
  const len = Math.hypot(bx - ax, bz - az) || 1;
  const steps = Math.max(1, Math.floor(len / step));
  for (let i = 0; i <= steps && n < mesh.instanceMatrix.count; i++) {
    const t = i / steps;
    _p.set(ax + (bx - ax) * t, y + yOff, az + (bz - az) * t);
    _e.set(0, Math.atan2(bx - ax, bz - az), (i % 2 ? 0.15 : -0.15));
    _q.setFromEuler(_e);
    _s.set(1, 1, 1);
    mesh.setMatrixAt(n, _m.compose(_p, _q, _s));
    if (colors && mesh.instanceColor) {
      _c.setHex(colors[i % colors.length]!);
      mesh.instanceColor.setXYZ(n, _c.r, _c.g, _c.b);
    }
    n++;
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.instanceMatrix.needsUpdate = true;
  return n;
}
