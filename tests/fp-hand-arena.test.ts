// The sculpted arena hand is opt-in: without the option (the campaign) the
// view model builds the original hand exactly as before; with it, the same
// rig moves exactly the same way (only the surfaces differ), it can be
// swapped at runtime without leaking geometry, and the hand does not sink
// into either chancla.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MELEE, WEAPON_SWITCH_MS, type WeaponId } from '../shared/config';
import { ViewModel, type ViewState } from '../src/fps/render/viewmodel';
import { buildFpHand, type FpRig } from '../src/fps/render/fp-hand';
import { buildFpHandArena } from '../src/fps/render/fp-hand-arena';
import { fpChanclaGeometry, fpPesadaGeometry } from '../src/fps/render/fp-chancla';

const rigOf = (vm: ViewModel) => (vm as unknown as { rig: FpRig }).rig;
const geometries = (o: THREE.Object3D) => { const s = new Set<THREE.BufferGeometry>(); o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) s.add(m.geometry); }); return s; };
const meshes = (o: THREE.Object3D) => { const out: THREE.Mesh[] = []; o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) out.push(m); }); return out; };

function scene(t: number): ViewState {
  const weapon: WeaponId = t >= 1.0 ? 1 : 0;
  const switchMs = t >= 1.0 ? Math.max(0, WEAPON_SWITCH_MS - (t - 1.0) * 1000) : 0;
  return {
    weapon, cooldownMs: 0, switchMs, speed: t > 0.1 && t < 0.6 ? 4 : 0, onGround: true, crouched: false, alive: true,
    msSinceThrow: t >= 0.6 && t < 1.0 ? (t - 0.6) * 1000 : 1e6,
    msSinceMelee: t >= 1.5 ? (t - 1.5) * 1000 : t >= 0.3 && t < 0.6 ? (t - 0.3) * 1000 : 1e9,
    meleeWeapon: t >= 1.5 ? 1 : t >= 0.3 && t < 0.6 ? 0 : null,
    lookYaw: 0.6 * Math.sin(t * 2), lookPitch: 0.2 * Math.sin(t * 1.3),
  };
}

describe('first-person arena hand', () => {
  it('builds the original hand, exactly as before, without the option', () => {
    const vm = new ViewModel();
    const old = buildFpHand();
    expect(vm.arena).toBe(false);
    const a = meshes(rigOf(vm).root), b = meshes(old.root);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.geometry.attributes.position!.count).toBe(b[i]!.geometry.attributes.position!.count);
      expect(Array.from(a[i]!.geometry.attributes.position!.array as Float32Array)).toEqual(Array.from(b[i]!.geometry.attributes.position!.array as Float32Array));
      expect(a[i]!.material.constructor).toBe(b[i]!.material.constructor);
    }
    // None of the arena hand's surfaces (the chanclas are shared by both).
    const ar = buildFpHandArena();
    const own = new Set([...geometries(ar.arm)].filter((g) => !geometries(ar.items[0]).has(g) && !geometries(ar.items[1]).has(g)));
    for (const g of geometries(vm.root)) expect(own.has(g)).toBe(false);
  });

  it('builds the sculpted hand with the option, moving exactly as the original', () => {
    const base = new ViewModel(), arena = new ViewModel({ arena: true });
    expect(arena.arena).toBe(true);
    const a = rigOf(base), b = rigOf(arena);
    for (let i = 1; i <= 150; i++) {
      for (const reduced of [false]) { base.update(scene(i / 60), 1 / 60, reduced); arena.update(scene(i / 60), 1 / 60, reduced); }
      expect(b.root.position.distanceTo(a.root.position)).toBeLessThan(1e-9);
      expect(b.root.quaternion.angleTo(a.root.quaternion)).toBeLessThan(1e-6);
      expect(b.hand.quaternion.angleTo(a.hand.quaternion)).toBeLessThan(1e-6);
      for (const w of [0, 1] as const) {
        expect(b.grips[w].visible).toBe(a.grips[w].visible);
        expect(b.items[w].visible).toBe(a.items[w].visible);
        expect(b.grips[w].quaternion.angleTo(a.grips[w].quaternion)).toBeLessThan(1e-6);
      }
    }
    // The held chancla sits in the same place in the hand (the wrist point is shared).
    for (const w of [0, 1] as const) {
      const pa = new THREE.Vector3(), pb = new THREE.Vector3();
      a.items[w].updateWorldMatrix(true, false); b.items[w].updateWorldMatrix(true, false);
      a.items[w].getWorldPosition(pa); b.items[w].getWorldPosition(pb);
      expect(pa.distanceTo(pb)).toBeLessThan(0.004);
    }
  });

  it('swaps hands at runtime, restoring the original exactly and leaking nothing', () => {
    const vm = new ViewModel({ arena: true });
    const ref = new ViewModel();
    vm.setTeam(1); ref.setTeam(1);
    vm.setArena(false);
    expect(vm.arena).toBe(false);
    const baseRig = rigOf(vm);
    // The same meshes as a view model that never had the arena hand.
    const mv = meshes(vm.root), mr = meshes(ref.root);
    expect(mv.length).toBe(mr.length);
    const arr = (m: THREE.Mesh) => Array.from(m.geometry.attributes.position!.array as Float32Array);
    for (let i = 0; i < mv.length; i++) expect(arr(mv[i]!)).toEqual(arr(mr[i]!));
    expect(baseRig.sleeve.color.getHex()).toBe(rigOf(ref).sleeve.color.getHex());
    for (let i = 1; i <= 120; i++) { vm.update(scene(i / 60), 1 / 60, false); ref.update(scene(i / 60), 1 / 60, false); }
    expect(baseRig.root.position.distanceTo(rigOf(ref).root.position)).toBeLessThan(1e-9);
    expect(baseRig.hand.quaternion.angleTo(rigOf(ref).hand.quaternion)).toBeLessThan(1e-6);

    // Back and forth: the same two rigs every time, one in the scene, no new geometry.
    vm.setArena(true);
    const arenaRig = rigOf(vm);
    expect(arenaRig.sleeve.color.getHex()).toBe(baseRig.sleeve.color.getHex());
    const all = new Set([...geometries(baseRig.root), ...geometries(arenaRig.root)]);
    for (let i = 0; i < 20; i++) {
      vm.setArena(i % 2 === 0);
      vm.setArena(i % 2 === 0); // idempotent
      expect(rigOf(vm)).toBe(i % 2 === 0 ? arenaRig : baseRig);
      expect(vm.root.children.length).toBe(1);
      for (const g of geometries(vm.root)) expect(all.has(g)).toBe(true);
    }
  });

  it('keeps the hand out of both chanclas', () => {
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const dirs = [new THREE.Vector3(1, 0.13, 0.07), new THREE.Vector3(-0.1, 1, 0.21), new THREE.Vector3(0.17, -0.2, -1)].map((d) => d.normalize());
    const rc = new THREE.Raycaster();
    const inside = (m: THREE.Mesh, p: THREE.Vector3) => dirs.filter((d) => { rc.set(p, d); return rc.intersectObject(m, false).length % 2 === 1; }).length >= 2;
    const count = (rig: FpRig, i: 0 | 1) => {
      const m = new THREE.Mesh(i === 0 ? fpChanclaGeometry().body : fpPesadaGeometry(), mat);
      m.geometry.computeBoundingBox();
      const p = rig.skins[i].geometry.attributes.position!;
      const seen = new Set<string>();
      let n = 0;
      for (let k = 0; k < p.count; k++) {
        const v = new THREE.Vector3().fromBufferAttribute(p, k);
        const key = `${v.x.toFixed(5)},${v.y.toFixed(5)},${v.z.toFixed(5)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (m.geometry.boundingBox!.containsPoint(v) && inside(m, v)) n++;
      }
      return n;
    };
    const arena = buildFpHandArena();
    expect(count(arena, 0)).toBe(0);
    expect(count(arena, 1)).toBe(0);
  });

  it('stays economical: shared materials, a few draw calls, bounded triangles', () => {
    const tris = (rig: FpRig) => {
      let n = 0, calls = 0;
      rig.root.traverseVisible((o) => { const m = o as THREE.Mesh; if (m.isMesh) { const g = m.geometry; n += (g.index ? g.index.count : g.attributes.position!.count) / 3; calls++; } });
      return { n, calls };
    };
    for (const w of [0, 1] as const) {
      const old = buildFpHand(), arena = buildFpHandArena();
      for (const r of [old, arena]) { r.grips[0].visible = w === 0; r.grips[1].visible = w === 1; }
      const a = tris(old), b = tris(arena);
      expect(b.calls).toBeLessThanOrEqual(a.calls + 1);
      expect(b.n).toBeLessThan(a.n + 9000);
    }
    const mats = new Set<THREE.Material>();
    buildFpHandArena().root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) mats.add(m.material as THREE.Material); });
    expect(mats.size).toBeLessThanOrEqual(5);
  });

  it('keeps the swings and throws identical in reduced motion too', () => {
    for (const w of [0, 1] as const) {
      const base = new ViewModel(), arena = new ViewModel({ arena: true });
      for (let ms = 0; ms <= MELEE[w]!.cycleMs; ms += 1000 / 60) {
        const s: ViewState = { weapon: w, cooldownMs: 0, switchMs: 0, speed: 0, onGround: true, crouched: false, alive: true, msSinceThrow: 1e6, msSinceMelee: ms, meleeWeapon: w };
        base.update(s, 1 / 60, true); arena.update(s, 1 / 60, true);
        expect(rigOf(arena).root.position.distanceTo(rigOf(base).root.position)).toBeLessThan(1e-9);
      }
    }
  });
});
