// Chancla Duty's scene. The Warfare page never imports this.
// Static maps are one merged mesh plus a handful of instanced props.
// Characters, chanclas, and impacts are pooled. Nothing in sync() allocates.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EL_PATIO, type MapData } from '../../shared/map';
import type { WorldOptions } from '../../src/fps/render/world';
import { THEMES } from '../../src/fps/render/world';
import { buildCourtyard } from './courtyard';
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


interface Actor {
  root: THREE.Group;
  hip: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  arm: THREE.Group;
  leg: THREE.Group;
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
  private readonly skin: THREE.Material;
  private readonly actors: Actor[] = [];
  private shots: THREE.InstancedMesh | null = null;
  private sparks: THREE.InstancedMesh | null = null;
  private pinata: THREE.Object3D | null = null;
  private clouds: THREE.Object3D | null = null;
  private wall: THREE.MeshLambertMaterial | null = null;
  private pinSpin = 0;
  private hemi: THREE.HemisphereLight | null = null;
  private seenEnd = '';
  private gpuTier = false;

  constructor(gpu: boolean) {
    this.gpuTier = gpu;
    this.stats.tier = gpu ? 'high' : 'fast';
    this.root.name = 'duty-scene';
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
    const hip = new THREE.Group();
    const torso = new THREE.Group();
    const head = new THREE.Group();
    const arm = new THREE.Group();
    const leg = new THREE.Group();
    const dress = team === 0 ? 0xe8871e : 0x1aa0a8;
    const skinHex = 0xd08a5c;
    const upper = mergeGeometries([
      tinted(new THREE.BoxGeometry(0.36, 0.4, 0.2), dress, 0, 0.16, 0),
      tinted(new THREE.BoxGeometry(0.46, 0.12, 0.24), team === 0 ? 0xf5c542 : 0xfff0d4, 0, 0.32, 0),
      tinted(new THREE.SphereGeometry(0.15, 10, 8), skinHex, 0, 0.5, 0),
      tinted(new THREE.SphereGeometry(0.08, 8, 6), 0x2a160f, 0, 0.66, -0.02),
      tinted(new THREE.SphereGeometry(0.035, 6, 5), 0xf5c542, 0.1, 0.6, 0.06),
    ], false)!;
    torso.add(new THREE.Mesh(upper, this.skin));
    torso.position.y = 0.86;
    arm.position.set(0.24, 0.28, 0.02);
    arm.add(new THREE.Mesh(tinted(new THREE.BoxGeometry(0.08, 0.34, 0.08), skinHex, 0, -0.16, 0), this.skin));
    leg.add(new THREE.Mesh(mergeGeometries([
      tinted(new THREE.BoxGeometry(0.1, 0.34, 0.1), skinHex, -0.08, -0.16, 0),
      tinted(new THREE.BoxGeometry(0.1, 0.34, 0.1), skinHex, 0.08, -0.16, 0),
    ], false)!, this.skin));
    hip.add(new THREE.Mesh(tinted(new THREE.ConeGeometry(0.34, 0.72, 8), dress, 0, 0.4, 0), this.skin));
    torso.add(head, arm);
    hip.add(torso);
    root.add(hip, leg);
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.42, 12), new THREE.MeshBasicMaterial({ color: 0x2a160f, transparent: true, opacity: 0.28, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.02;
    root.add(blob);
    root.visible = false;
    this.root.add(root);
    return { root, hip, torso, head, arm, leg, team };
  }

  private buildViewmodels(): void {
    const specs: Array<[number, boolean]> = [[0x2bb5b0, false], [0x6a3d86, true], [0xc48a52, false], [0xf2c14e, false], [0x2a160f, true]];
    for (const [hex, heel] of specs) {
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(chanclaGeometry(hex, heel), this.skin);
      mesh.scale.setScalar(1.35);
      mesh.position.set(0.02, 0.04, -0.12);
      if (heel) mesh.rotation.z = -0.35;
      g.add(handMesh(0xd08a5c), mesh);
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

    this.hemi = new THREE.HemisphereLight(theme.hemi[0], theme.hemi[1], theme.hemi[2] * 1.05);
    this.root.add(new THREE.AmbientLight(0xfff1e0, 0.42));
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
    const yard = buildCourtyard(map, boxes, opts.theme ?? 'afternoon', opts.teamDecor !== false);
    this.root.add(yard.root);
    this.pinata = yard.pinata;
    this.clouds = yard.clouds;
    this.wall = yard.wall;
  }

  /** Swap the wall grain for the shipped KTX2 file when the GPU can transcode it. */
  async useCompressedGrain(renderer: THREE.WebGLRenderer): Promise<void> {
    if (!this.wall) return;
    try {
      const { KTX2Loader } = await import('three/examples/jsm/loaders/KTX2Loader.js');
      const loader = new KTX2Loader();
      loader.setTranscoderPath('/basis/');
      loader.detectSupport(renderer);
      const tex = await loader.loadAsync('/chancla-duty/grain.ktx2');
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 4;
      this.wall.map = tex;
      this.wall.needsUpdate = true;
      loader.dispose();
    } catch { /* the canvas grain stays on the material */ }
  }

  setBrightness(k: number): void {
    if (this.hemi) this.hemi.intensity = 0.45 + k * 0.7;
  }

  spinPinata(): void { this.pinSpin = 1; }

  /** Poses pooled actors, projectiles, and impacts. No allocations. */
  sync(engine: Engine, now: number): void {
    const t0 = performance.now();
    const mode = engine.mode;
    const session = (engine as unknown as { session: { remotes: Map<number, Remote>; body: { x: number; y: number; z: number }; alive: boolean; team: 0 | 1 | null; weapon: WeaponId; cooldownMs: number; projectiles: Map<string, Shot> } | null }).session;
    let used = 0;
    if (mode === 'menu') {
      for (const actor of this.actors) actor.root.visible = false;
      pose(this.actors[0]!, -1.7, 0, 3.2, 0.6, 0, true, false, true, (now * 0.001) % 3.2, 9, now);
      pose(this.actors[3]!, 1.7, 0, 3.2, -0.6, 0, true, false, true, 9, 9, now);
      used = this.actors.length;
    } else if (mode === 'match' && session) {
      for (const remote of session.remotes.values()) {
        if (used >= this.actors.length) continue;
        const speed = Math.hypot(remote.vx, remote.vz);
        pose(this.actors[used]!, remote.x, remote.y, remote.z, remote.yaw + Math.PI, speed, remote.onGround, remote.crouched, remote.alive, remote.msSinceThrow / 1000, remote.msSinceHit / 1000, now);
        used++;
      }
    } else if (mode === 'controller') {
      const rt = (engine as unknown as { controller?: { sim?: { state?: { player?: { x: number; y: number; z: number; yaw: number }; actors?: Array<{ x: number; y: number; z: number; yaw: number; enabled: boolean }> } } } }).controller;
      const actors = rt?.sim?.state?.actors ?? [];
      for (const a of actors) {
        if (!a.enabled || used >= this.actors.length) continue;
        pose(this.actors[used]!, a.x, a.y, a.z, a.yaw, 0, true, false, true, 9, 9, now);
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
    if (this.clouds) this.clouds.rotation.y = now * 0.00002;
    const weapon = session?.weapon ?? 0;
    const showHand = mode !== 'menu';
    const cd = session?.cooldownMs ?? 0;
    for (let i = 0; i < this.viewmodels.length; i++) {
      const vm = this.viewmodels[i]!;
      vm.visible = showHand && i === Math.min(4, weapon);
      if (!vm.visible) continue;
      const wind = cd > 280 ? Math.min(1, (cd - 280) / 500) : 0;
      vm.rotation.x = 0.15 - wind * 1.1;
      vm.position.y = -0.24 + Math.sin(now * 0.004) * 0.008;
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

interface Remote {
  id: number; x: number; y: number; z: number; yaw: number; vx: number; vz: number;
  alive: boolean; crouched: boolean; onGround: boolean; msSinceThrow: number; msSinceHit: number;
}
interface Shot { id: string; done: boolean; endAt: number; pr: { x: number; y: number; z: number } }

function pose(actor: Actor, x: number, y: number, z: number, yaw: number, speed: number, onGround: boolean, crouched: boolean, alive: boolean, throwAge: number, hitAge: number, now: number): void {
  actor.root.visible = true;
  actor.root.position.set(x, y, z);
  actor.root.rotation.set(alive ? 0 : 1.15, yaw, 0);
  actor.root.scale.set(1, crouched ? 0.62 : 1, 1);
  const run = speed > 5.5;
  const moving = onGround && speed > 0.35;
  const step = moving ? Math.sin(now * (run ? 0.014 : 0.008)) : 0;
  actor.leg.rotation.x = onGround ? step * (run ? 0.7 : 0.4) : 0.65;
  actor.hip.position.y = moving ? Math.abs(step) * 0.04 : Math.sin(now * 0.003) * 0.015;
  actor.torso.rotation.x = hitAge < 0.28 ? -0.45 : (run ? 0.18 : 0);
  actor.head.rotation.x = hitAge < 0.28 ? 0.3 : Math.sin(now * 0.002) * 0.05;
  const wind = throwAge < 0.16 ? throwAge / 0.16 : throwAge < 0.42 ? 1 - (throwAge - 0.16) / 0.26 : 0;
  actor.arm.rotation.x = -0.35 - wind * 1.7 + (moving ? -step * 0.35 : 0);
}

function tinted(geo: THREE.BufferGeometry, hex: number, x: number, y: number, z: number): THREE.BufferGeometry {
  geo.translate(x, y, z);
  const n = geo.attributes.position!.count;
  const cols = new Float32Array(n * 3);
  _c.setHex(hex);
  for (let i = 0; i < n; i++) { cols[i * 3] = _c.r; cols[i * 3 + 1] = _c.g; cols[i * 3 + 2] = _c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}

function handMesh(hex: number): THREE.Mesh {
  const geo = mergeGeometries([
    tinted(new THREE.BoxGeometry(0.14, 0.045, 0.16), hex, 0, 0, 0.02),
    tinted(new THREE.BoxGeometry(0.035, 0.035, 0.1), hex, -0.07, 0.01, -0.08),
    tinted(new THREE.BoxGeometry(0.028, 0.03, 0.1), hex, -0.02, 0.015, -0.1),
    tinted(new THREE.BoxGeometry(0.028, 0.03, 0.11), hex, 0.02, 0.015, -0.11),
    tinted(new THREE.BoxGeometry(0.026, 0.028, 0.09), hex, 0.055, 0.01, -0.08),
  ], false)!;
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.rotation.x = 0.45;
  mesh.position.set(-0.02, -0.01, 0.04);
  return mesh;
}

