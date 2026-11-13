// Life in the neighbourhood: small, cheap motion that makes the arenas feel inhabited rather than
// posed. All of it is visual and far from play: birds wheeling over the roofs, tiny people on the
// far terraces, flickering candles and windows at dusk, slow dust or petals in the light, and the
// washing and bunting swaying. One InstancedMesh (or Points) per kind; a few dozen matrices a frame.
//
// Reduced motion freezes everything (`calm`), and `?life=0` in the page URL builds none of it.
import * as THREE from 'three';
import type { MapData } from '../../../shared/map';
import type { Quality } from '../settings';

/** Review switch: ?life=0 in the page URL builds the arenas without the motion layer. */
export function lifeWanted(): boolean {
  try { return typeof location === 'undefined' || new URLSearchParams(location.search).get('life') !== '0'; } catch { return true; }
}

/** A short run of terrace front (a place a distant person can stand and walk along). */
export interface WalkPath { x0: number; z0: number; x1: number; z1: number; y: number }

export interface LifeView {
  group: THREE.Group;
  /** Draw calls added. */
  calls: number;
  /** Advance by absolute time (seconds). */
  update(t: number): void;
  /** Reduced motion: freeze everything where it is. */
  setCalm(calm: boolean): void;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** A bird seen from below: a body and two wings that flap by scaling the wing height. */
function birdGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  // x: wing span, y: wing lift (scaled per frame), z: forward (-z)
  const v = [
    0, 0, -0.35, -0.9, 1, 0.1, 0, 0, 0.25, // left wing
    0, 0, -0.35, 0.9, 1, 0.1, 0, 0, 0.25, // right wing
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  return g;
}

/** A soft round dot for the dust and petals (a small canvas gradient; square points read as pixel noise). */
function dotTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  if (!g) return null;
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.7)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
  return t;
}

/** A person from a long way off: a body and a head. */
function personGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.2, 0.26, 1.05, 6);
  body.translate(0, 0.55, 0);
  const head = new THREE.SphereGeometry(0.17, 6, 4);
  head.translate(0, 1.32, 0);
  const merged = new THREE.BufferGeometry();
  const pa = body.getAttribute('position') as THREE.BufferAttribute, pb = head.getAttribute('position') as THREE.BufferAttribute;
  const pos = new Float32Array((pa.count + pb.count) * 3), col = new Float32Array((pa.count + pb.count) * 3);
  pos.set(pa.array as Float32Array, 0); pos.set(pb.array as Float32Array, pa.count * 3);
  // Body takes the instance colour; the head is a fixed warm skin tone (via vertex colour).
  for (let i = 0; i < pa.count; i++) { col[i * 3] = 1; col[i * 3 + 1] = 1; col[i * 3 + 2] = 1; }
  for (let i = pa.count; i < pa.count + pb.count; i++) { col[i * 3] = 0.78; col[i * 3 + 1] = 0.55; col[i * 3 + 2] = 0.38; }
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const idx: number[] = [];
  const ia = body.index!.array, ib = head.index!.array;
  for (let i = 0; i < ia.length; i++) idx.push(ia[i]!);
  for (let i = 0; i < ib.length; i++) idx.push(ib[i]! + pa.count);
  merged.setIndex(idx);
  body.dispose(); head.dispose();
  return merged;
}

export interface LifeOptions {
  map: MapData;
  quality: Quality;
  /** Terrace fronts from the neighbourhood, for the walkers. */
  paths: readonly WalkPath[];
  /** Dusk: petals and fewer birds. */
  dusk: boolean;
  /** Warm light colour of the dust, and the petal colour at dusk. */
  mote: number;
  /** The neighbourhood's own lamp material (candles and lit windows flicker). */
  lamp?: THREE.MeshToonMaterial;
}

export function buildLife(o: LifeOptions): LifeView {
  const lite = o.quality === 'low';
  const r = rng(o.map.id === 'plaza' ? 71 : o.map.id === 'fiesta' ? 83 : 59);
  const group = new THREE.Group();
  group.name = 'life';
  let calls = 0;
  let calm = false;

  // --------------------------------------------------------------------------- birds
  const birdN = lite ? 6 : o.dusk ? 8 : 12;
  const birds = new THREE.InstancedMesh(
    birdGeometry(),
    new THREE.MeshBasicMaterial({ color: o.dusk ? 0x2a1830 : 0x3a2c3c, side: THREE.DoubleSide }),
    birdN,
  );
  birds.frustumCulled = false;
  group.add(birds); calls++;
  const flock = Array.from({ length: birdN }, (_, i) => {
    const g = Math.floor(i / 3);
    return {
      cx: (g - 1) * 14 + (r() - 0.5) * 8, cz: (r() - 0.5) * 12,
      rad: 34 + g * 9 + r() * 6, h: 26 + r() * 14 + g * 3,
      w: (0.09 + r() * 0.03) * (g % 2 ? -1 : 1), ph: r() * 6.28, fl: 5 + r() * 2.5, off: r() * 0.35,
    };
  });
  const bm = new THREE.Matrix4(), bq = new THREE.Quaternion(), bp = new THREE.Vector3(), bs = new THREE.Vector3(), be = new THREE.Euler();

  // ------------------------------------------------------------------- distant people
  const walkN = Math.min(lite ? 6 : 12, o.paths.length);
  let walkers: THREE.InstancedMesh | null = null;
  const walk: Array<{ p: WalkPath; u: number; v: number; sh: number }> = [];
  if (walkN > 0) {
    const shirts = [0xd8765a, 0x7cc7bb, 0xeb9aac, 0xf0b45a, 0x8a6aa8, 0xf4e6c8, 0x3a6ea5];
    walkers = new THREE.InstancedMesh(personGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true }), walkN);
    walkers.frustumCulled = false;
    for (let i = 0; i < walkN; i++) {
      const p = o.paths[Math.floor(r() * o.paths.length)]!;
      walk.push({ p, u: r(), v: (0.02 + r() * 0.025) * (r() < 0.5 ? -1 : 1), sh: i });
      walkers.setColorAt(i, new THREE.Color(shirts[i % shirts.length]!));
    }
    group.add(walkers); calls++;
  }
  const wm = new THREE.Matrix4();

  // ---------------------------------------------------------------- dust and petals
  let motes: THREE.Points | null = null;
  const moteN = lite ? 0 : 56;
  const mp = new Float32Array(moteN * 3), mv: Array<[number, number, number, number]> = [];
  if (moteN) {
    const b = o.map.bounds;
    for (let i = 0; i < moteN; i++) {
      mp[i * 3] = b.minX + r() * (b.maxX - b.minX); mp[i * 3 + 1] = 3 + r() * 6; mp[i * 3 + 2] = b.minZ + r() * (b.maxZ - b.minZ);
      mv.push([(r() - 0.5) * 0.5, -0.12 - r() * 0.2, (r() - 0.5) * 0.5, r() * 6.28]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    motes = new THREE.Points(g, new THREE.PointsMaterial({ color: o.mote, map: dotTexture(), size: o.dusk ? 0.3 : 0.22, transparent: true, opacity: o.dusk ? 0.75 : 0.5, depthWrite: false, sizeAttenuation: true }));
    motes.frustumCulled = false;
    group.add(motes); calls++;
  }

  const lamp = o.lamp;
  const lampBase = lamp ? lamp.emissiveIntensity : 0;
  const b = o.map.bounds;

  const update = (t: number): void => {
    if (calm) return;
    // Birds: wheel round a centre, banking into the turn, wings beating at their own pace.
    for (let i = 0; i < birdN; i++) {
      const f = flock[i]!, a = t * f.w + f.ph + f.off;
      const x = f.cx + Math.cos(a) * f.rad, z = f.cz + Math.sin(a) * f.rad, y = f.h + Math.sin(t * 0.4 + f.ph) * 1.8;
      const heading = Math.atan2(-Math.sin(a) * Math.sign(f.w), Math.cos(a) * Math.sign(f.w));
      be.set(0, -heading - Math.PI / 2, 0.25 * Math.sign(f.w), 'YXZ'); bq.setFromEuler(be);
      const flap = 0.35 + 0.55 * Math.abs(Math.sin(t * f.fl + f.ph));
      bs.set(1.7, flap * 1.5, 1.7);
      birds.setMatrixAt(i, bm.compose(bp.set(x, y, z), bq, bs));
    }
    birds.instanceMatrix.needsUpdate = true;
    // Walkers: back and forth along a terrace front, a little bounce in the step.
    if (walkers) {
      for (let i = 0; i < walk.length; i++) {
        const w = walk[i]!;
        let u = w.u + t * w.v; u = u - Math.floor(u); u = u < 0.5 ? u * 2 : 2 - u * 2; // ping-pong 0..1
        const x = w.p.x0 + (w.p.x1 - w.p.x0) * u, z = w.p.z0 + (w.p.z1 - w.p.z0) * u;
        walkers.setMatrixAt(i, wm.compose(bp.set(x, w.p.y + Math.abs(Math.sin(t * 4.2 + w.sh)) * 0.05, z), bq.identity(), bs.set(1, 1, 1)));
      }
      walkers.instanceMatrix.needsUpdate = true;
    }
    // Motes: drift and sink slowly, wrap inside the arena and above head height.
    if (motes) {
      for (let i = 0; i < moteN; i++) {
        const v = mv[i]!;
        mp[i * 3] += (v[0] + Math.sin(t * 0.6 + v[3]) * 0.12) * 0.016; mp[i * 3 + 1] += v[1] * 0.016; mp[i * 3 + 2] += (v[2] + Math.cos(t * 0.5 + v[3]) * 0.12) * 0.016;
        if (mp[i * 3 + 1] < 2.6) mp[i * 3 + 1] = 9;
        if (mp[i * 3]! < b.minX) mp[i * 3] = b.maxX; else if (mp[i * 3]! > b.maxX) mp[i * 3] = b.minX;
        if (mp[i * 3 + 2]! < b.minZ) mp[i * 3 + 2] = b.maxZ; else if (mp[i * 3 + 2]! > b.maxZ) mp[i * 3 + 2] = b.minZ;
      }
      (motes.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
    // Candles and lit windows: a slow breathing with a quick flutter on top.
    if (lamp) lamp.emissiveIntensity = lampBase * (0.9 + 0.07 * Math.sin(t * 2.3) + 0.05 * Math.sin(t * 7.9 + 1.3) + 0.03 * Math.sin(t * 13.1));
  };

  // Place everything once, so a frozen (calm) scene shows the birds mid-sky and walkers on their ledges.
  const prime = (): void => { const was = calm; calm = false; update(2.5); calm = was; };
  prime();

  return {
    group,
    calls,
    update,
    setCalm(c: boolean) { calm = c; if (c && lamp) lamp.emissiveIntensity = lampBase; },
  };
}
