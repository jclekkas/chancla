// Chancla Duty's scene. The Warfare page never imports this.
// Static maps are one merged mesh plus a handful of instanced props.
// Characters, chanclas, and impacts are pooled. Nothing in sync() allocates.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EL_PATIO, type MapData } from '../../shared/map';
import type { WorldOptions } from '../../src/fps/render/world';
import { THEMES } from '../../src/fps/render/world';
import { buildCourtyard, scrollWater } from './courtyard';
import { applyCc0Look, forearmGeometry } from './cc0';
import { chanclaShotGeometry, dressKit, kitReady, loadKit } from './kit';
import { addFilmTown, buildFilmWoman, loadFilmCast, loadHeroProps, playFilm, poseFilm, styleViewmodels, type FilmPuppet, type FilmWoman, type HeroProps } from './film';
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
  tier: 'fast' | 'medium' | 'high';
}

let tread: THREE.CanvasTexture | null = null;
function treadMap(): THREE.CanvasTexture {
  if (tread) return tread;
  const cnv = document.createElement('canvas');
  cnv.width = 128; cnv.height = 256;
  const g = cnv.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 256);
  g.strokeStyle = '#1a120c';
  g.lineWidth = 7;
  for (let y = 14; y < 256; y += 18) {
    g.beginPath();
    g.moveTo(10, y);
    for (let x = 10; x <= 118; x += 16) g.lineTo(x, y + (x % 32 ? 6 : -6));
    g.stroke();
  }
  g.fillStyle = '#8a6244';
  for (let y = 8; y < 256; y += 36) for (let x = 18; x < 118; x += 28) g.fillRect(x, y, 8, 4);
  tread = new THREE.CanvasTexture(cnv);
  tread.colorSpace = THREE.SRGBColorSpace;
  tread.anisotropy = 8;
  return tread;
}

/** A flip-flop whose sole faces the camera, with a Y-strap and a grooved tread. */
function viewChancla(hex: number, heel: boolean): THREE.Group {
  const g = new THREE.Group();
  const soleMat = new THREE.MeshStandardMaterial({
    color: hex, map: treadMap(), roughness: 0.42, metalness: 0.04,
    emissive: hex, emissiveIntensity: 0.12,
  });
  const strapMat = new THREE.MeshStandardMaterial({
    color: 0xfff6d8, roughness: 0.28, emissive: 0xffe29a, emissiveIntensity: 0.7,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xfff1c2, emissive: 0xfff1c2, emissiveIntensity: 0.85, roughness: 0.3,
  });
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.11);
  shape.bezierCurveTo(0.09, -0.11, 0.11, 0.02, 0.05, 0.1);
  shape.bezierCurveTo(0, 0.14, -0.05, 0.1, -0.11, 0.02);
  shape.bezierCurveTo(-0.12, -0.04, -0.08, -0.11, 0, -0.11);
  const sole = new THREE.ExtrudeGeometry(shape, { depth: heel ? 0.07 : 0.034, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 2 });
  sole.rotateX(-Math.PI / 2);
  const soleMesh = new THREE.Mesh(sole, soleMat);
  const rim = sole.clone();
  rim.scale(1.06, 0.35, 1.06);
  const rimMesh = new THREE.Mesh(rim, rimMat);
  rimMesh.position.y = -0.01;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.015, 0.08, 8), strapMat);
  post.position.set(0, 0.04, 0.055);
  const toe = new THREE.Vector3(0, 0.075, 0.05);
  const strapBar = (end: THREE.Vector3) => {
    const mid = toe.clone().add(end).multiplyScalar(0.5);
    const dir = end.clone().sub(toe);
    const len = dir.length();
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, len, 6), strapMat);
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return mesh;
  };
  const groove = new THREE.MeshStandardMaterial({ color: 0x08332f, roughness: 0.72 });
  for (let i = -3; i <= 3; i++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.16 - Math.abs(i) * 0.012, 0.01, 0.012), groove);
    rib.position.set(0, 0.042, i * 0.026);
    rib.rotation.y = i % 2 ? 0.08 : -0.08;
    g.add(rib);
  }
  g.add(rimMesh, soleMesh, post, strapBar(new THREE.Vector3(-0.085, 0.02, -0.03)), strapBar(new THREE.Vector3(0.085, 0.02, -0.03)));
  if (heel) {
    const block = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.048, 0.08, 8), soleMat);
    block.position.set(0, 0.01, -0.06);
    g.add(block);
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).frustumCulled = false; });
  return g;
}

function chanclaGeometry(hex: number, heel: boolean): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.07);
  shape.bezierCurveTo(0.075, -0.075, 0.09, 0.02, 0.04, 0.075);
  shape.bezierCurveTo(0, 0.1, -0.04, 0.075, -0.075, 0.02);
  shape.bezierCurveTo(-0.09, -0.03, -0.06, -0.075, 0, -0.07);
  const sole = new THREE.ExtrudeGeometry(shape, { depth: heel ? 0.055 : 0.028, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 2 });
  sole.rotateX(-Math.PI / 2);
  const strap = new THREE.TorusGeometry(0.045, 0.008, 8, 14, Math.PI);
  strap.rotateX(Math.PI / 2);
  strap.translate(0, 0.03, 0.02);
  const flower = new THREE.SphereGeometry(0.016, 8, 6);
  flower.translate(0, 0.045, 0.03);
  const parts: THREE.BufferGeometry[] = [sole, strap, flower];
  if (heel) {
    const heelGeo = new THREE.CylinderGeometry(0.028, 0.034, 0.07, 8);
    heelGeo.translate(-0.02, 0.01, -0.03);
    parts.push(heelGeo);
  }
  for (const geo of parts) {
    const n = geo.attributes.position!.count;
    const cols = new Float32Array(n * 3);
    _c.setHex(geo === flower ? 0xf2c14e : hex);
    for (let i = 0; i < n; i++) { cols[i * 3] = _c.r; cols[i * 3 + 1] = _c.g; cols[i * 3 + 2] = _c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  return mergeGeometries(parts.map(asPlain), false) ?? sole;
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
  /** Review shots keep the chancla in frame while the camera is on the menu. */
  handForShot = false;
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
  private tier: 'fast' | 'medium' | 'high' = 'fast';
  private women: FilmWoman[] = [];
  private cast: FilmPuppet[] = [];
  private heroes: HeroProps | null = null;
  private lastAnim = 0;
  private gl: THREE.WebGLRenderer | null = null;
  private worldScene: THREE.Scene | null = null;
  private worldOpts: WorldOptions = {};

  constructor(tier: 'fast' | 'medium' | 'high') {
    this.tier = tier;
    this.gpuTier = tier !== 'fast';
    this.stats.tier = tier;
    this.root.name = 'duty-scene';
    this.skin = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (let i = 0; i < 6; i++) this.actors.push(this.makeActor(i < 3 ? 0 : 1));
    if (tier === 'high') {
      this.women = [buildFilmWoman('sol'), buildFilmWoman('luna'), buildFilmWoman('abuela'), buildFilmWoman('sol')];
      for (const w of this.women) {
        w.root.visible = false;
        w.root.userData['keep'] = true;
        this.root.add(w.root);
      }
    }
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
    if (tier === 'high') styleViewmodels(this.viewmodels);
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
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.18), new THREE.MeshBasicMaterial({ map: faceTex(), transparent: true }));
    face.position.set(0, 0.5, 0.14);
    torso.add(face);
    root.add(blob);
    root.scale.setScalar(1.22);
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
    this.worldOpts = opts;
    const map: MapData = opts.map ?? EL_PATIO;
    const boxes = opts.boxes ?? map.boxes;
    const asked = opts.theme ?? 'afternoon';
    const theme = THEMES[this.tier === 'high' && asked === 'noon' ? 'afternoon' : asked];
    const detailed = this.tier === 'high' && kitReady();
    for (const child of [...this.root.children]) {
      if (child.userData['keep']) continue;
      this.root.remove(child);
      const mesh = child as THREE.Mesh;
      if (mesh.geometry && !mesh.userData['keepGeo'] && child !== this.shots && child !== this.sparks && !this.actors.some((a) => a.root === child)) mesh.geometry.dispose();
    }
    for (const actor of this.actors) this.root.add(actor.root);
    if (this.shots) this.root.add(this.shots);
    if (this.sparks) this.root.add(this.sparks);

    this.hemi = new THREE.HemisphereLight(0xffd2a4, 0x8a4030, this.tier === 'high' ? 0.48 : 0.8);
    this.root.add(new THREE.AmbientLight(0xfff1dc, this.tier === 'high' ? 0.22 : 0.28));
    const sun = new THREE.DirectionalLight(this.tier === 'high' ? 0xffb15a : 0xfff3d8, this.tier === 'high' ? 2.6 : 2.0);
    sun.position.set(...theme.sunPos);
    if (this.tier === 'high') sun.position.y *= 0.42;
    if (this.gpuTier) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(this.tier === 'high' ? 2048 : 1024, this.tier === 'high' ? 2048 : 1024);
      sun.shadow.radius = this.tier === 'high' ? 2.5 : 1;
      sun.shadow.bias = -0.00025;
      sun.shadow.normalBias = 0.02;
      const sc = sun.shadow.camera;
      // A tight shadow box keeps the map's far corners out of the shadow pass.
      sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 0.5; sc.far = 70;
    }
    const fill = new THREE.DirectionalLight(0xffe0b8, this.tier === 'high' ? 0.38 : 0.35);
    fill.position.set(0, 6, 10);
    this.root.add(this.hemi, sun, fill);
    const yard = buildCourtyard(map, boxes, opts.theme ?? 'afternoon', opts.teamDecor !== false, detailed);
    if (detailed) {
      dressKit(yard.root, boxes, map);
      try { addFilmTown(yard.root, boxes); }
      catch (err) { console.error('film town', err); }
      this.placeGenerated(yard.root);
    }
    this.root.add(yard.root);
    this.pinata = yard.pinata;
    this.clouds = yard.clouds;
    this.wall = yard.wall;
    if (this.tier !== 'fast' && this.gl && this.worldScene) void applyCc0Look(this.gl, this.worldScene, this.root, true, this.tier === 'high');
  }

  bind(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    this.gl = renderer;
    this.worldScene = scene;
    if (this.tier === 'fast') {
      (window as unknown as { __duty?: { assets?: boolean } }).__duty && ((window as unknown as { __duty: { assets?: boolean } }).__duty.assets = true);
      return;
    }
    const jobs: Promise<unknown>[] = [];
    if (this.tier === 'high') {
      jobs.push(loadKit());
      jobs.push(loadFilmCast(this.root).then((cast) => { this.cast = cast; }));
      jobs.push(loadHeroProps().then((heroes) => { this.heroes = heroes; }));
    }
    void Promise.all(jobs).then(async () => {
      this.rebuild(this.worldOpts);
      this.upgradeHands();
      styleViewmodels(this.viewmodels);
      this.applyHeldChancla();
      const shot = chanclaShotGeometry();
      if (shot && this.shots) {
        this.shots.geometry = shot;
        this.shots.material = new THREE.MeshStandardMaterial({ color: 0x2bb5b0, roughness: 0.7, metalness: 0 });
      }
      const box = (window as unknown as { __duty?: { assets?: boolean } }).__duty;
      if (box) box.assets = true;
      if (this.gl && this.worldScene) await applyCc0Look(this.gl, this.worldScene, this.root, true, this.tier === 'high');
    }).catch((err) => { console.warn('duty bind', err); });
  }

  private placeGenerated(yard: THREE.Object3D): void {
    const heroes = this.heroes;
    if (!heroes) return;
    if (heroes.fountain && !yard.getObjectByName('duty-basin')) {
      const fountain = heroes.fountain.clone(true);
      fountain.position.set(0, 0, 0);
      fountain.name = 'hero-fountain';
      yard.add(fountain);
    }
    if (heroes.door) {
      const spots: Array<[number, number, number]> = [[-6.2, 3.2, 0], [5.4, -2.4, Math.PI], [-1.5, 6.2, Math.PI / 2], [7.2, 1.2, -Math.PI / 2]];
      for (const [x, z, ry] of spots) {
        const door = heroes.door.clone(true);
        door.position.set(x, 0, z);
        door.rotation.y = ry;
        yard.add(door);
      }
    }
    // Concept 2 and 3 dressing: shrine, tiled steps, laundry, and a Cafecito.
    const tile = new THREE.MeshStandardMaterial({ color: 0x1f6f9a, roughness: 0.4, metalness: 0.05 });
    const stepMat = new THREE.MeshStandardMaterial({ color: 0xf4efe4, roughness: 0.55 });
    for (let i = 0; i < 5; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 0.7), i % 2 ? tile : stepMat);
      step.position.set(-8.5, 0.1 + i * 0.18, -6 + i * 0.55);
      yard.add(step);
    }
    const shrine = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.05), new THREE.MeshStandardMaterial({ color: 0xf7f1e4, roughness: 0.5 }));
    shrine.position.set(-8.2, 1.35, -3.2);
    yard.add(shrine);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.12, 12), new THREE.MeshStandardMaterial({ color: 0xf4efe8, roughness: 0.4 }));
    cup.position.set(2.4, 0.86, 1.5);
    const table = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.5), new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.7 }));
    table.position.set(2.4, 0.35, 1.5);
    yard.add(table, cup);
    const rosa = this.cast[0];
    if (rosa?.lods[2]) {
      const kid = rosa.lods[2].clone(true);
      kid.scale.multiplyScalar(0.62);
      kid.position.set(3.6, 0, -1.1);
      kid.rotation.y = 0.6;
      kid.visible = true;
      yard.add(kid);
    }
  }

  private applyHeldChancla(): void {
    const heroes = this.heroes;
    const src = heroes?.chancla;
    if (!src) return;
    for (const g of this.viewmodels) {
      for (const child of [...g.children]) {
        if (child.name === 'reach' || child === g.children[0]) continue;
        g.remove(child);
      }
      const shoe = src.clone();
      shoe.name = 'hero-chancla';
      shoe.position.set(0.04, -0.16, -0.04);
      shoe.rotation.set(1.05, 0.35, 0.15);
      g.add(shoe);
      if (heroes?.arms) {
        const arms = heroes.arms.clone(true);
        arms.name = 'hero-arms';
        arms.position.set(0.02, -0.08, 0.0);
        arms.rotation.set(0.4, Math.PI, 0.1);
        arms.scale.multiplyScalar(0.85);
        g.add(arms);
      }
    }
    if (this.shots && heroes?.chanclaShot && heroes.chanclaMat) {
      this.shots.geometry = heroes.chanclaShot;
      this.shots.material = heroes.chanclaMat;
    }
  }

  private upgradeHands(): void {
    if (!kitReady()) return;
    const specs: Array<[number, boolean, boolean]> = [[0x2bb5b0, false, false], [0x6a3d86, true, false], [0xc48a52, false, false], [0xf2c14e, false, true], [0x2a160f, true, false]];
    this.viewmodels.forEach((g, i) => {
      const [hex, heel, twin] = specs[i] ?? [0x2bb5b0, false, false];
      const hand = g.children[0] as THREE.Mesh;
      const baked = forearmGeometry();
      const arm = baked ?? fallbackForearm();
      if (hand.isMesh) {
        hand.geometry = arm;
        hand.material = new THREE.MeshStandardMaterial({ color: 0xe0a070, roughness: 0.48, metalness: 0, emissive: 0x4a2814, emissiveIntensity: 0.18 });
        if (baked) aimForearm(hand, arm);
        else { hand.scale.setScalar(1.25); hand.position.set(0.02, -0.02, 0); hand.rotation.set(0, 0.15, 0); }
      }
      for (const child of [...g.children]) if (child !== hand) g.remove(child);
      hand.position.set(0.16, -0.18, 0.05);
      hand.rotation.set(0.55, 0.15, -0.35);
      hand.scale.setScalar(1.15);
      const shoe = viewChancla(hex, heel);
      // Sole faces the camera; the Y-strap stands up off the tread.
      shoe.scale.setScalar(0.42);
      shoe.position.set(0.04, 0.02, -0.05);
      shoe.rotation.order = 'YXZ';
      shoe.rotation.set(0.95, 0.45, 0.1);
      g.add(shoe);
      if (twin) {
        const other = shoe.clone(true);
        other.position.x = 0.2;
        g.add(other);
      }
    });
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
    const dt = this.lastAnim ? Math.min(0.05, (now - this.lastAnim) / 1000) : 0;
    this.lastAnim = now;
    if (this.cast.length) {
      for (const actor of this.actors) actor.root.visible = false;
      for (const w of this.women) w.root.visible = false;
      const spots: Array<[number, number, number, number, number, boolean, number, number]> = [];
      if (mode === 'menu') {
        const face = (x: number, z: number) => Math.atan2(5.2 - x, 8.6 - z);
        const shot = new URLSearchParams(location.search).get('shot');
        if (shot === 'abuela') {
          spots.push([7, 0, 14, 0, 0, true, 9, 9]);
          spots.push([-7, 0, 14, 0, 0, true, 9, 9]);
          spots.push([0, 0, 4.5, 0.08, 0, true, 9, 9]);
        } else if (shot === 'cast') {
          spots.push([-1.05, 0, 4.5, 0.12, 0, true, 9, 9]);
          spots.push([0.05, 0, 4.45, 0, 0, true, 9, 9]);
          spots.push([1.15, 0, 4.5, -0.12, 0, true, 9, 9]);
        } else {
          spots.push([-1.7, 0, 4.4, face(-1.7, 4.4), 0, true, 9, 9]);
          spots.push([1.6, 0, 4.2, face(1.6, 4.2), 0, true, (now * 0.001) % 3.2, 9]);
          spots.push([0.05, 0, 5.2, face(0.05, 5.2), 0, true, 9, 9]);
        }
      } else if (mode === 'match' && session) {
        for (const remote of session.remotes.values()) {
          spots.push([remote.x, remote.y, remote.z, remote.yaw + Math.PI, Math.hypot(remote.vx, remote.vz), remote.alive, remote.msSinceThrow / 1000, remote.msSinceHit / 1000]);
        }
      }
      for (let i = 0; i < this.cast.length; i++) {
        const p = this.cast[i]!;
        const spot = spots[i];
        if (!spot) { p.root.visible = false; continue; }
        const [x, y, z, yaw, speed, alive, throwAge, hitAge] = spot;
        p.root.visible = true;
        p.root.position.set(x, y + (Number(p.root.userData['foot']) || 0), z);
        p.root.rotation.y = yaw;
        const dist = Math.hypot(engine.camera.position.x - x, engine.camera.position.z - z);
        const lod = dist > 20 ? 2 : dist > 8 ? 1 : 0;
        p.lods.forEach((mesh, k) => { mesh.visible = k === lod; });
        const clip = !alive ? 'Death' : throwAge < 0.45 ? 'SwordSlash' : hitAge < 0.35 ? 'RecieveHit' : speed > 6 ? 'Run' : speed > 0.4 ? 'Walk' : 'Idle';
        playFilm(p, clip);
        for (const mixer of p.mixers) mixer.update(dt);
      }
      used = this.actors.length;
    } else if (this.women.length) {
      for (const actor of this.actors) actor.root.visible = false;
      const spots: Array<[number, number, number, number, number, boolean, number, number]> = [];
      if (mode === 'menu') {
        const face = (x: number, z: number) => Math.atan2(5.2 - x, 8.6 - z);
        spots.push([-2.2, 0, 1.8, face(-2.2, 1.8), 0, true, (now * 0.001) % 3.2, 9]);
        spots.push([0.6, 0, 2.4, face(0.6, 2.4), 0, true, 9, 9]);
        spots.push([2.4, 0, 0.6, face(2.4, 0.6), 0, true, 9, 9]);
      } else if (mode === 'match' && session) {
        for (const remote of session.remotes.values()) {
          spots.push([remote.x, remote.y, remote.z, remote.yaw + Math.PI, Math.hypot(remote.vx, remote.vz), remote.alive, remote.msSinceThrow / 1000, remote.msSinceHit / 1000]);
        }
      }
      for (let i = 0; i < this.women.length; i++) {
        const w = this.women[i]!;
        const spot = spots[i];
        if (!spot) { w.root.visible = false; continue; }
        const [x, y, z, yaw, speed, alive, throwAge, hitAge] = spot;
        w.root.visible = true;
        w.root.position.set(x, y, z);
        w.root.rotation.y = yaw;
        poseFilm(w, speed, throwAge, hitAge, alive, now);
      }
      used = this.actors.length;
    } else if (mode === 'menu') {
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
    if (this.clouds) this.clouds.rotation.y = now * 0.000015;
    scrollWater(now);
    const weapon = session?.weapon ?? 0;
    const showHand = mode !== 'menu' || this.handForShot;
    const cd = session?.cooldownMs ?? 0;
    for (let i = 0; i < this.viewmodels.length; i++) {
      const vm = this.viewmodels[i]!;
      vm.visible = showHand && i === Math.min(4, weapon);
      if (!vm.visible) continue;
      const wind = cd > 280 ? Math.min(1, (cd - 280) / 500) : 0;
      const bar = document.getElementById('duty-charge');
      const held = bar ? Number(/scaleX\(([\d.]+)\)/.exec(bar.style.transform)?.[1] ?? 0) : 0;
      const cock = Math.max(held, wind * 0.7);
      const arms = vm.getObjectByName('hero-arms');
      if (arms) arms.visible = !this.handForShot;
      const shoe = vm.getObjectByName('hero-chancla');
      if (shoe) shoe.scale.setScalar(this.handForShot ? 2.6 : 1);
      const palm = vm.children[0];
      if (palm && this.handForShot) palm.scale.setScalar(0.42);
      if (this.handForShot) vm.scale.setScalar(0.72);
      else vm.scale.setScalar(1);
      const bob = Math.sin(now * 0.0032) * 0.016;
      const sway = Math.sin(now * 0.0021) * 0.05;
      vm.position.set(this.handForShot ? 0.38 : 0.32, (this.handForShot ? -0.34 : -0.28) + bob + cock * 0.06, (this.handForShot ? -0.78 : -0.46) + cock * 0.08);
      vm.rotation.set(0.2 - cock * 0.7, -0.35 - sway * 0.4, 0.12 + cock * 0.25);
      const reach = vm.getObjectByName('reach');
      if (reach) reach.visible = cock > 0.22;
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
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { GTAOPass }, { OutputPass }, { FXAAPass }, { ShaderPass }] = await Promise.all([
        import('three/examples/jsm/postprocessing/EffectComposer.js'),
        import('three/examples/jsm/postprocessing/RenderPass.js'),
        import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
        import('three/examples/jsm/postprocessing/GTAOPass.js'),
        import('three/examples/jsm/postprocessing/OutputPass.js'),
        import('three/examples/jsm/postprocessing/FXAAPass.js'),
        import('three/examples/jsm/postprocessing/ShaderPass.js'),
      ]);
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      const gtao = new GTAOPass(scene, camera, renderer.domElement.width, renderer.domElement.height);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = 0.35;
      composer.addPass(gtao);
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(renderer.domElement.width, renderer.domElement.height), 0.11, 0.4, 0.92));
      composer.addPass(new ShaderPass({
        uniforms: { tDiffuse: { value: null }, lift: { value: new THREE.Vector3(0.045, 0.02, 0.0) }, contrast: { value: 1.08 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform sampler2D tDiffuse; uniform vec3 lift; uniform float contrast; varying vec2 vUv; void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; c = (c - 0.5) * contrast + 0.5; c += lift * (1.0 - c); gl_FragColor = vec4(c, 1.0); }',
      }));
      composer.addPass(new FXAAPass());
      composer.addPass(new OutputPass());
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

function asPlain(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = geo.index ? geo.toNonIndexed() : geo;
  for (const key of Object.keys(n.attributes)) {
    if (key !== 'position' && key !== 'normal' && key !== 'uv' && key !== 'color') n.deleteAttribute(key);
  }
  return n;
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

/** Point the baked elbow at the lower right and scale the forearm so it stays in frame. */
function fallbackForearm(): THREE.BufferGeometry {
  const fore = new THREE.CapsuleGeometry(0.042, 0.2, 4, 8);
  fore.rotateZ(-0.55);
  fore.translate(0.06, -0.03, 0);
  return fore;
}

function aimForearm(hand: THREE.Mesh, arm: THREE.BufferGeometry): void {
  const pos = arm.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  let maxD = 0;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    maxD = Math.max(maxD, v.length());
  }
  const acc = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) acc.add(v.fromBufferAttribute(pos, i));
  if (pos.count < 3 || maxD < 0.02) return;
  const from = acc.multiplyScalar(1 / pos.count);
  const reach = Math.max(0.05, from.length());
  from.normalize();
  const want = new THREE.Vector3(0.82, -0.48, 0.3).normalize();
  hand.quaternion.setFromUnitVectors(from, want);
  hand.scale.setScalar(Math.min(2.6, 0.32 / Math.max(reach, maxD * 0.45)));
  hand.position.set(0, 0, 0);
}

function handMesh(hex: number): THREE.Mesh {
  const palm = new THREE.SphereGeometry(0.055, 10, 8);
  palm.scale(1.3, 0.55, 1.6);
  const bits: THREE.BufferGeometry[] = [palm];
  for (let i = 0; i < 4; i++) {
    const finger = new THREE.CylinderGeometry(0.012, 0.01, 0.07, 6);
    finger.rotateX(Math.PI / 2);
    finger.translate(-0.03 + i * 0.02, 0.01, -0.07);
    bits.push(finger);
  }
  const thumb = new THREE.CylinderGeometry(0.013, 0.011, 0.05, 6);
  thumb.rotateZ(0.8);
  thumb.translate(-0.06, 0.01, -0.01);
  bits.push(thumb);
  const geo = mergeGeometries(bits.map((g) => asPlain(tinted(g, hex, 0, 0, 0))), false) ?? bits[0]!;
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.rotation.x = 0.35;
  mesh.position.set(0, -0.02, 0.05);
  return mesh;
}

function faceTex(): THREE.CanvasTexture {
  const cnv = document.createElement('canvas');
  cnv.width = 64; cnv.height = 64;
  const g = cnv.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = '#1a120c';
  g.beginPath(); g.ellipse(22, 28, 4, 5, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(42, 28, 4, 5, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#1a120c';
  g.lineWidth = 2;
  g.beginPath(); g.arc(32, 40, 8, 0.2, Math.PI - 0.2); g.stroke();
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

