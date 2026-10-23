// The combat effects in Node (THREE without WebGL): pools and caps under
// bursts, lifetimes, no growth after thousands of calls, clear(), stats(),
// quality and reduced-motion switches mid-effect, the close-camera rule, and
// the public behaviour of RuleroFx and ProjectileView the engine relies on.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { COMBAT_FX_POOL, CombatFx, FX_LIFE, REDUCED_SPEED, nearSafe, type FxSettings } from '../src/fps/render/combat-fx';
import { IMPACT_LIFE, IMPACT_POOL, ProjectileView } from '../src/fps/render/projectiles';
import { RULERO_COLORS, RULERO_POOL, RuleroFx, ruleroGeometry, ruleroMaterial, ruleroMesh } from '../src/fps/render/ruleros';
import type { Quality } from '../src/fps/settings';

const settings = (quality: Quality = 'high', reduced = false): FxSettings => ({ quality, reduced, camera: null });

function camera(x = 0, y = 1.58, z = 5, look: [number, number, number] = [0, 1.3, 0]): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 200);
  c.position.set(x, y, z);
  c.lookAt(...look);
  c.updateMatrixWorld();
  return c;
}

const DT = 1 / 60;
const run = (fx: { update(dt: number, c: THREE.Camera): void }, cam: THREE.Camera, s: number) => { for (let t = 0; t < s; t += DT) fx.update(DT, cam); };

// Every buffer and object the effects own: if any of these grows, something leaks.
function footprint(root: THREE.Object3D): { objects: number; instances: number; bytes: number } {
  let objects = 0, instances = 0, bytes = 0;
  root.traverse((o) => {
    objects++;
    const m = o as THREE.InstancedMesh;
    if (m.isInstancedMesh) instances += m.instanceMatrix.count;
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (g) for (const a of Object.values(g.attributes)) bytes += (a as THREE.BufferAttribute).array.byteLength;
  });
  return { objects, instances, bytes };
}

function burst(fx: CombatFx, n: number): void {
  for (let i = 0; i < n; i++) {
    const k = i % 4;
    if (k === 0) fx.meleeHit(0, { x: 0, y: 1.1, z: 0 }, { x: -1, z: -0.4 }, i % 8 === 0);
    else if (k === 1) fx.meleeHit(1, { x: 0.1, y: 1.5, z: 0 }, { x: 1, z: -0.4 }, true);
    else if (k === 2) fx.meleeWhiff((i % 2) as 0 | 1, { x: 0, y: 0, z: 0 }, i * 0.3);
    else fx.shielded({ x: 0, y: 1.2, z: 0 });
  }
}

describe('CombatFx', () => {
  it('caps live effects under a burst and reuses the oldest', () => {
    const fx = new CombatFx(settings());
    const cam = camera();
    burst(fx, 200);
    fx.update(DT, cam);
    const st = fx.stats();
    expect(st.active).toBe(COMBAT_FX_POOL);
    expect(st.pooled).toBe(COMBAT_FX_POOL);
    expect(st.drawCalls).toBeGreaterThan(0);
    expect(st.drawCalls).toBeLessThanOrEqual(5); // one per shape, however many effects
    expect(fx.spawned).toBe(200);
  });

  it('every effect expires within its lifetime (reduced motion included), and nothing is drawn after', () => {
    for (const reduced of [false, true]) {
      const fx = new CombatFx(settings('high', reduced));
      const cam = camera();
      burst(fx, 40);
      const longest = Math.max(...Object.values(FX_LIFE)) / (reduced ? REDUCED_SPEED : 1);
      expect(longest).toBeLessThanOrEqual(1);
      run(fx, cam, longest - 0.05);
      expect(fx.stats().active).toBeGreaterThan(0);
      run(fx, cam, 0.1);
      expect(fx.stats()).toEqual({ active: 0, pooled: COMBAT_FX_POOL, drawCalls: 0 });
      expect(fx.cost().pieces).toBe(0);
    }
  });

  it('each kind lives as long as it says', () => {
    const cam = camera();
    const cases: Array<[(fx: CombatFx) => void, number]> = [
      [(fx) => fx.meleeHit(0, { x: 0, y: 1, z: 0 }, { x: 1, z: 0 }, false), FX_LIFE.light],
      [(fx) => fx.meleeHit(1, { x: 0, y: 1, z: 0 }, { x: 1, z: 0 }, true), FX_LIFE.heavy],
      [(fx) => fx.meleeWhiff(0, { x: 0, y: 0, z: 0 }, 0), FX_LIFE.whiffLight],
      [(fx) => fx.meleeWhiff(1, { x: 0, y: 0, z: 0 }, 0), FX_LIFE.whiffHeavy],
      [(fx) => fx.shielded({ x: 0, y: 1.2, z: 0 }), FX_LIFE.shield],
    ];
    for (const [fire, life] of cases) {
      const fx = new CombatFx(settings());
      fire(fx);
      run(fx, cam, life - 0.03);
      expect(fx.stats().active).toBe(1);
      run(fx, cam, 0.05);
      expect(fx.stats().active).toBe(0);
    }
  });

  it('a miss never draws a star (nothing that reads as a hit)', () => {
    const fx = new CombatFx(settings());
    const cam = camera(0, 1.58, 3);
    fx.meleeWhiff(0, { x: 0, y: 0, z: 0 }, 0.4);
    fx.meleeWhiff(1, { x: 0, y: 0, z: 0 }, -0.4);
    for (let i = 0; i < 20; i++) {
      fx.update(DT, cam);
      const layers = (fx as unknown as { sprites: { layers: Map<string, { n: number }> } }).sprites.layers;
      expect(layers.get('star')!.n).toBe(0);
      expect(layers.get('streak')!.n).toBe(0);
      expect(layers.get('ring')!.n).toBe(0);
      expect(layers.get('word')?.n ?? 0).toBe(0);
    }
  });

  it('does not grow after thousands of calls, and clear() resets everything', () => {
    const fx = new CombatFx(settings());
    const cam = camera();
    burst(fx, 20); fx.update(DT, cam);
    const before = footprint(fx.group);
    for (let i = 0; i < 5000; i++) { burst(fx, 3); if (i % 7 === 0) fx.update(DT, cam); }
    fx.update(DT, cam);
    expect(footprint(fx.group)).toEqual(before);
    fx.clear();
    expect(fx.stats()).toEqual({ active: 0, pooled: COMBAT_FX_POOL, drawCalls: 0 });
    fx.update(DT, cam);
    expect(fx.stats().drawCalls).toBe(0);
  });

  it('switches quality and reduced motion mid-effect safely; Low draws less', () => {
    const s = settings('high');
    const fx = new CombatFx(s);
    const cam = camera();
    burst(fx, 16);
    fx.update(DT, cam);
    const high = fx.cost().pieces;
    fx.setQuality('medium'); fx.update(DT, cam);
    const medium = fx.cost().pieces;
    fx.setQuality('low'); fx.setReducedMotion(true); fx.update(DT, cam);
    const low = fx.cost().pieces;
    expect(s.quality).toBe('low');
    expect(s.reduced).toBe(true);
    expect(high).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(low);
    expect(fx.stats().active).toBe(16);
    fx.setQuality('high'); fx.setReducedMotion(false);
    run(fx, cam, 1);
    expect(fx.stats().active).toBe(0);
  });

  it('a hit draws swing streaks along the blow (not on Low); no word layer without a DOM', () => {
    const arcs = (q: Quality, w: 0 | 1) => {
      const fx = new CombatFx(settings(q));
      fx.meleeHit(w, { x: 0, y: 1.4, z: 0 }, { x: -1, z: 0 }, false);
      run(fx, camera(0, 1.58, 3), 0.08);
      const sp = (fx as unknown as { sprites: { layers: Map<string, { n: number; mesh: THREE.InstancedMesh }> } }).sprites;
      return sp.layers.get('arc')!;
    };
    expect(arcs('high', 0).n).toBe(3);
    expect(arcs('medium', 1).n).toBe(2);
    expect(arcs('low', 1).n).toBe(0);
    // The streak's head ends at the contact point: the arc's head vertex lands near it.
    const l = arcs('high', 1);
    const m = new THREE.Matrix4();
    l.mesh.getMatrixAt(1, m);
    const pos = l.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const head = new THREE.Vector3().fromBufferAttribute(pos, pos.count - 3).applyMatrix4(m);
    expect(Math.hypot(head.x, head.z)).toBeLessThan(0.25);
    const fx = new CombatFx(settings());
    expect((fx as any).sprites.layers.has('word')).toBe(false);
  });

  it('fades and shrinks next to the camera and caps the size on screen', () => {
    const out: [number, number] = [0, 0];
    expect(nearSafe(0.3, 0.4, out)[0]).toBe(0);
    expect(nearSafe(3, 0.4, out)).toEqual([1, 0.4]);
    const [a, s] = nearSafe(1, 0.4, out);
    expect(a).toBeLessThan(1);
    expect(s).toBeLessThanOrEqual(0.14);
    // A hit right in front of the lens draws nothing.
    const fx = new CombatFx(settings());
    const cam = camera(0, 1.5, 0.35, [0, 1.5, 0]);
    fx.meleeHit(1, { x: 0, y: 1.5, z: 0 }, { x: 1, z: 0 }, true);
    fx.update(DT, cam);
    expect(fx.cost().pieces).toBe(0);
  });

  it('publishes the camera for the other effects and disposes cleanly', () => {
    const s = settings();
    const fx = new CombatFx(s);
    const cam = camera();
    fx.update(DT, cam);
    expect(s.camera).toBe(cam);
    burst(fx, 10); fx.update(DT, cam);
    fx.dispose();
    expect(fx.group.children.length).toBe(0);
  });
});

describe('ProjectileView', () => {
  const proj = (id: string, weapon: 0 | 1, x: number, y = 1.4, z = 0) => ({
    id, weapon, owner: 1, predicted: true, startAt: 0, endAt: 0, endPos: null, done: false, trail: [],
    pr: { id: 0, owner: 1, team: 0, weapon, x, y, z, vx: 0, vy: 0, vz: 0, ageMs: 0, traveled: 0, bounces: 0, fireSeq: 0 },
  });

  it('keeps one pooled mesh per live projectile, keyed by id (as the benchmark reads it)', () => {
    const v = new ProjectileView(settings());
    const cam = camera(0, 1.58, 8);
    const m = new Map<string, any>([['a', proj('a', 0, 0)], ['b', proj('b', 1, 1)]]);
    for (let i = 0; i < 10; i++) { m.get('a').pr.x = i * 0.2; v.sync(m as any, 0, cam, DT); }
    const pools = (v as any).pools as Record<0 | 1, Array<{ key: string | null; mesh: THREE.Object3D }>>;
    const a = pools[0].find((s) => s.key === 'a')!;
    expect(a.mesh.visible).toBe(true);
    expect(a.mesh.position.x).toBeCloseTo(1.8);
    expect(pools[1].filter((s) => s.key === 'b')).toHaveLength(1);
    const st = v.stats();
    expect(st.flying).toBe(2);
    expect(st.trails).toBe(2);
    m.delete('a');
    v.sync(m as any, 0, cam, DT);
    expect(a.key).toBeNull();
    expect(a.mesh.visible).toBe(false);
    expect(v.stats().flying).toBe(1);
  });

  it('all trails are one draw call, even with every slot flying', () => {
    const v = new ProjectileView(settings());
    const cam = camera(0, 1.58, 10);
    const m = new Map<string, any>();
    for (let i = 0; i < 16; i++) m.set(`c${i}`, proj(`c${i}`, 0, i * 0.3 - 2));
    for (let i = 0; i < 8; i++) m.set(`p${i}`, proj(`p${i}`, 1, i * 0.3 - 2, 2));
    for (let k = 0; k < 6; k++) { for (const q of m.values()) q.pr.z -= 0.2; v.sync(m as any, 0, cam, DT); }
    expect(v.stats().trails).toBe(24);
    expect(v.stats().drawCalls).toBe(1);
  });

  it('caps impacts, expires them within their lifetime, and does not grow', () => {
    const v = new ProjectileView(settings());
    const cam = camera(0, 1.58, 6);
    const empty = new Map();
    for (let i = 0; i < 3; i++) v.impact((i % 2) as 0 | 1, [0, i ? 1.2 : 0.02, 0], i === 2);
    v.sync(empty, 0, cam, DT);
    const before = footprint(v.group);
    for (let i = 0; i < 3000; i++) { v.impact((i % 2) as 0 | 1, [i % 5, i % 3 ? 1.2 : 0.02, 0], i % 4 === 0); if (i % 11 === 0) v.sync(empty, 0, cam, DT); }
    v.sync(empty, 0, cam, DT);
    expect(v.stats().active).toBe(IMPACT_POOL);
    expect(v.stats().drawCalls).toBeLessThanOrEqual(5); // star, ring, puff, streak, particles
    expect(footprint(v.group)).toEqual(before);
    run({ update: (dt, c) => v.sync(empty, 0, c, dt) }, cam, Math.max(IMPACT_LIFE.light, IMPACT_LIFE.heavy) / REDUCED_SPEED + 0.05);
    expect(v.stats().active).toBe(0);
    expect(v.stats().pieces).toBe(0);
  });

  it('a player hit and a surface hit draw different things', () => {
    const shapes = (player: boolean, y: number) => {
      const v = new ProjectileView(settings('low'));
      v.impact(0, [0, y, 0], player);
      v.sync(new Map(), 0, camera(0, 1.58, 4), DT);
      const layers = (v as any).sprites.layers as Map<string, { n: number }>;
      return { star: layers.get('star')!.n, puff: layers.get('puff')!.n };
    };
    expect(shapes(true, 1.3)).toEqual({ star: 1, puff: 0 });
    expect(shapes(false, 1.3)).toEqual({ star: 0, puff: 1 });
    expect(shapes(false, 0.02).star).toBe(0);
  });

  it('clear() empties flight, trails and impacts; dispose() frees it', () => {
    const v = new ProjectileView(settings());
    const cam = camera();
    v.sync(new Map([['a', proj('a', 0, 0)]]) as any, 0, cam, DT);
    v.impact(1, [0, 0.02, 0], false);
    v.sync(new Map([['a', proj('a', 0, 0.5)]]) as any, 0, cam, DT);
    v.clear();
    v.sync(new Map(), 0, cam, DT);
    expect(v.stats()).toMatchObject({ active: 0, flying: 0, trails: 0, drawCalls: 0 });
    v.dispose();
    expect(v.group.children.length).toBe(0);
  });
});

describe('RuleroFx', () => {
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const seeded = () => { let s = 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; };

  it('keeps the exports the avatars use', () => {
    expect(RULERO_COLORS).toHaveLength(4);
    expect(ruleroGeometry()).toBe(ruleroGeometry());
    expect(ruleroMaterial(1)).toBe(ruleroMaterial(5));
    const m = ruleroMesh(2);
    expect(m.material).toBe(ruleroMaterial(2));
    expect(m.children).toHaveLength(1);
  });

  it('pools 12, reuses the oldest, counts spawns, and draws them in two calls', () => {
    const fx = new RuleroFx(settings());
    for (let i = 0; i < 30; i++) fx.spawn(i % 4, V(0, 1.7, 0), V(1, 0, 0), 0, { rand: seeded() });
    expect(fx.active).toBe(RULERO_POOL);
    expect(fx.spawned).toBe(30);
    fx.update(DT);
    const st = fx.stats();
    expect(st.pooled).toBe(RULERO_POOL);
    expect(st.drawCalls).toBeLessThanOrEqual(4); // rollers, outlines, pops, dust ticks
  });

  it('lands, bounces at most twice, and is gone at the end of its life (simple: sooner, no bounce)', () => {
    for (const simple of [false, true]) {
      const fx = new RuleroFx(settings());
      fx.spawn(0, V(0, 1.7, 0), V(1, 0, 0), 0, { simple, rand: seeded() });
      const f = (fx as any).flyers.find((x: any) => x.live);
      let minY = Infinity;
      for (let t = 0; t < (simple ? 0.85 : 1.55); t += DT) { fx.update(DT); minY = Math.min(minY, f.pos.y); }
      expect(fx.active).toBe(1);
      expect(minY).toBeGreaterThanOrEqual(0.035 - 1e-9);
      expect(f.bounces).toBe(simple ? 0 : 2);
      for (let t = 0; t < 0.1; t += DT) fx.update(DT);
      expect(fx.active).toBe(0);
    }
  });

  it('squashes on a bounce and ticks dust (not on Low), and accents expire', () => {
    const s = settings();
    const fx = new RuleroFx(s);
    fx.spawn(1, V(0, 1.7, 0), V(1, 0, 0), 0, { rand: seeded() });
    const f = (fx as any).flyers.find((x: any) => x.live);
    let squashed = false, dust = 0;
    for (let t = 0; t < 1.7; t += DT) {
      fx.update(DT);
      if (f.live && f.squash < 0.05) {
        squashed = true;
        const m = new THREE.Matrix4();
        (fx as any).body.getMatrixAt(0, m);
        const e = m.elements;
        // Flattened vertically: the world-up column is shorter than the others.
        const sy = Math.hypot(e[1]!, e[5]!, e[9]!), sx = Math.hypot(e[0]!, e[4]!, e[8]!);
        expect(sy).toBeLessThan(sx + 1e-6);
      }
      dust = Math.max(dust, (fx as any).sprites.layers.get('puff').n);
    }
    expect(squashed).toBe(true);
    expect(dust).toBeGreaterThan(0);
    expect(fx.stats().accents).toBe(0);
    s.quality = 'low';
    fx.spawn(1, V(0, 1.7, 0), V(1, 0, 0), 0, { rand: seeded() });
    let lowDust = 0;
    for (let t = 0; t < 1.7; t += DT) { fx.update(DT); lowDust = Math.max(lowDust, (fx as any).sprites.layers.get('puff').n); }
    expect(lowDust).toBe(0);
  });

  it('no pop accent when the roller starts at the camera (your own)', () => {
    const s = settings();
    const cam = camera(0, 1.58, 0, [0, 1.58, -1]);
    s.camera = cam;
    const fx = new RuleroFx(s);
    fx.spawn(0, V(0.22, 1.8, 0), V(1, 0, 0), 0);
    fx.update(DT);
    expect(fx.stats().accents).toBe(0);
    fx.spawn(0, V(0, 1.7, -4), V(1, 0, 0), 0);
    fx.update(DT);
    expect(fx.stats().accents).toBe(1);
  });

  it('does not grow after thousands of spawns; clear() and dispose()', () => {
    const fx = new RuleroFx(settings());
    fx.spawn(0, V(0, 1.7, 0), V(1, 0, 0), 0); fx.update(DT);
    const before = footprint(fx.group);
    for (let i = 0; i < 5000; i++) { fx.spawn(i % 4, V(0, 1.7, 0), V(1, 0, 0), 0, { simple: i % 3 === 0 }); if (i % 5 === 0) fx.update(DT); }
    expect(footprint(fx.group)).toEqual(before);
    fx.clear();
    expect(fx.active).toBe(0);
    expect(fx.stats()).toMatchObject({ active: 0, accents: 0, drawCalls: 0 });
    fx.dispose();
    // Shared roller geometry and materials stay usable for the avatars.
    expect(ruleroGeometry().attributes.position).toBeDefined();
  });
});
