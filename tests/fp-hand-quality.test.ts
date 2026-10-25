// Quality tiers of the sculpted arena hand: Medium and Low are the same
// grip with fewer rings and segments, so they cost less but move exactly the
// same; changing tier mid-game rebuilds the hand without touching the combat
// state, frees the old hand, and leaves the campaign hand alone. La Pesada's
// thumb opposes the fingers without sinking into it on any tier, and La
// Chancla's grip is unchanged.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { WEAPON_SWITCH_MS, WEAPONS, type WeaponId } from '../shared/config';
import { ViewModel, type ViewState } from '../src/fps/render/viewmodel';
import type { FpRig } from '../src/fps/render/fp-hand';
import { arenaArm, arenaGrips, buildFpHandArena, type HandQuality } from '../src/fps/render/fp-hand-arena';
import { fpChanclaGeometry, fpPesadaGeometry } from '../src/fps/render/fp-chancla';
import { INK } from '../src/fps/render/fp-geo';
import { toonRamp } from '../src/fps/render/materials';

const TIERS: HandQuality[] = ['high', 'medium', 'low'];
const rigOf = (vm: ViewModel) => (vm as unknown as { rig: FpRig }).rig;
const geometries = (o: THREE.Object3D) => { const s = new Set<THREE.BufferGeometry>(); o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) s.add(m.geometry); }); return s; };
const materials = (o: THREE.Object3D) => { const s = new Set<THREE.Material>(); o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) s.add(m.material as THREE.Material); }); return s; };
const shared = () => new Set<THREE.BufferGeometry>([fpChanclaGeometry().body, fpChanclaGeometry().flower, fpPesadaGeometry()]);

/** Triangles and draw calls with one weapon in hand. */
function cost(rig: FpRig, w: 0 | 1): { tris: number; calls: number } {
  rig.grips[0].visible = w === 0; rig.grips[1].visible = w === 1;
  let tris = 0, calls = 0;
  rig.root.traverseVisible((o) => { const m = o as THREE.Mesh; if (m.isMesh) { const g = m.geometry; tris += (g.index ? g.index.count : g.attributes.position!.count) / 3; calls++; } });
  return { tris, calls };
}

/** Walk, a throw, El Chanclazo, a switch to La Pesada, El Revés and a La Pesada throw, with turning. */
function scene(t: number): ViewState {
  const weapon: WeaponId = t >= 1.0 ? 1 : 0;
  const switchMs = t >= 1.0 ? Math.max(0, WEAPON_SWITCH_MS - (t - 1.0) * 1000) : 0;
  return {
    weapon, cooldownMs: 0, switchMs, speed: t > 0.1 && t < 0.6 ? 4 : 0, onGround: true, crouched: false, alive: true,
    msSinceThrow: t >= 0.6 && t < 1.0 ? (t - 0.6) * 1000 : t >= 2.4 ? (t - 2.4) * 1000 : 1e6,
    msSinceMelee: t >= 1.5 && t < 2.4 ? (t - 1.5) * 1000 : t >= 0.3 && t < 0.6 ? (t - 0.3) * 1000 : 1e9,
    meleeWeapon: t >= 1.5 && t < 2.4 ? 1 : t >= 0.3 && t < 0.6 ? 0 : null,
    lookYaw: 0.6 * Math.sin(t * 2), lookPitch: 0.2 * Math.sin(t * 1.3),
  };
}

/** Everything the update writes into the rig, in one comparable list. */
function poseOf(rig: FpRig): number[] {
  const out: number[] = [...rig.root.position.toArray(), ...rig.root.quaternion.toArray(), ...rig.hand.quaternion.toArray(), ...rig.arm.quaternion.toArray()];
  for (const i of [0, 1] as const) {
    const g = rig.grips[i];
    out.push(g.visible ? 1 : 0, rig.items[i].visible ? 1 : 0, ...g.quaternion.toArray(), ...(g.userData.flickAxis as THREE.Vector3).toArray(), ...(g.userData.forearm as THREE.Vector3).toArray());
    out.push(...g.children[0]!.position.toArray(), ...rig.skins[i].scale.toArray());
  }
  return out;
}
const close = (a: number[], b: number[], eps = 1e-9) => { expect(a.length).toBe(b.length); for (let i = 0; i < a.length; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThan(eps); };

afterEach(() => { vi.restoreAllMocks(); });

describe('arena hand quality tiers', () => {
  it('costs less on Medium and Low, never more draw calls than High', () => {
    const got: Record<string, { tris: number; calls: number }> = {};
    for (const q of TIERS) for (const w of [0, 1] as const) { const r = buildFpHandArena(q); got[`${q}${w}`] = cost(r, w); r.dispose(); }
    // High is the sculpted hand as it was.
    expect(got.high0!.tris).toBe(10612);
    expect(got.high1!.tris).toBe(9952);
    for (const w of [0, 1]) {
      expect(got[`medium${w}`]!.tris).toBeGreaterThan(5800);
      expect(got[`medium${w}`]!.tris).toBeLessThan(7000);
      expect(got[`low${w}`]!.tris).toBeGreaterThan(3500);
      expect(got[`low${w}`]!.tris).toBeLessThan(4500);
      for (const q of ['medium', 'low']) expect(got[`${q}${w}`]!.calls).toBeLessThanOrEqual(got[`high${w}`]!.calls);
    }
    // Same rig on every tier: the same groups, meshes and materials.
    const shape = (r: FpRig) => { const n: string[] = []; r.root.traverse((o) => n.push(`${o.type}:${o.children.length}`)); return n.join(','); };
    const h = buildFpHandArena('high');
    for (const q of ['medium', 'low'] as const) { const r = buildFpHandArena(q); expect(shape(r)).toBe(shape(h)); r.dispose(); }
    h.dispose();
  });

  it('moves identically on every tier (frames, wrist points and poses)', () => {
    const vms = TIERS.map((quality) => new ViewModel({ arena: true, quality }));
    expect(vms.map((v) => v.quality)).toEqual(TIERS);
    for (let i = 1; i <= 220; i++) {
      for (const v of vms) v.update(scene(i / 60), 1 / 60, i % 50 > 40);
      const ref = poseOf(rigOf(vms[0]!));
      for (const v of vms.slice(1)) close(poseOf(rigOf(v)), ref);
    }
  });

  it('keeps the swing, the throw, the switch, the shown weapon and the team across a change of tier', () => {
    const ref = new ViewModel({ arena: true });
    const vm = new ViewModel({ arena: true });
    ref.setTeam(1); vm.setTeam(1);
    const order: HandQuality[] = ['low', 'medium', 'high'];
    let n = 0;
    for (let i = 1; i <= 220; i++) {
      const s = scene(i / 60);
      // Mid-swing (El Chanclazo at 0.3 s, El Revés at 1.5 s), mid-throw, mid-switch.
      if ([24, 40, 64, 70, 100, 150, 170].includes(i)) {
        const before = rigOf(vm);
        const pose = poseOf(before);
        vm.setQuality(order[n++ % order.length]!);
        const after = rigOf(vm);
        expect(after).not.toBe(before);
        // Taken over as it was, before the next update.
        close(poseOf(after), pose);
        expect(after.sleeve.color.getHex()).toBe(rigOf(ref).sleeve.color.getHex());
        expect(vm.root.children).toEqual([after.root]);
      }
      ref.update(s, 1 / 60, false); vm.update(s, 1 / 60, false);
      close(poseOf(rigOf(vm)), poseOf(rigOf(ref)));
    }
    expect(n).toBe(7);
    // Same tier again: nothing rebuilt.
    const r = rigOf(vm);
    vm.setQuality(vm.quality);
    expect(rigOf(vm)).toBe(r);
  });

  it('frees the old hand on a change of tier, and toggling does not grow what is live', () => {
    const disposedG = new Set<THREE.BufferGeometry>(), disposedM = new Set<THREE.Material>(), disposedT = new Set<THREE.Texture>();
    const gd = THREE.BufferGeometry.prototype.dispose, md = THREE.Material.prototype.dispose, td = THREE.Texture.prototype.dispose;
    vi.spyOn(THREE.BufferGeometry.prototype, 'dispose').mockImplementation(function (this: THREE.BufferGeometry) { disposedG.add(this); gd.call(this); });
    vi.spyOn(THREE.Material.prototype, 'dispose').mockImplementation(function (this: THREE.Material) { disposedM.add(this); md.call(this); });
    vi.spyOn(THREE.Texture.prototype, 'dispose').mockImplementation(function (this: THREE.Texture) { disposedT.add(this); td.call(this); });

    const vm = new ViewModel({ arena: true });
    for (let i = 1; i <= 30; i++) vm.update(scene(i / 60), 1 / 60, false);
    const seen = new Set<THREE.BufferGeometry>();
    const live = () => { for (const g of geometries(vm.root)) seen.add(g); return [...seen].filter((g) => !disposedG.has(g)).length; };
    const first = live();
    const old = rigOf(vm);
    const oldG = geometries(old.root), oldM = materials(old.root);
    vm.setQuality('low');
    // Every geometry and material the old hand owned is freed; the chanclas,
    // the ink material and the toon ramp are shared and stay.
    for (const g of oldG) expect(disposedG.has(g)).toBe(!shared().has(g));
    for (const m of oldM) expect(disposedM.has(m)).toBe(m !== INK);
    expect(disposedM.has(INK)).toBe(false);
    expect(disposedT.has(toonRamp())).toBe(false);
    // Nothing of the new hand was freed, and it shares only the shared parts with the old one.
    for (const g of geometries(vm.root)) { expect(disposedG.has(g)).toBe(false); if (oldG.has(g)) expect(shared().has(g)).toBe(true); }
    // High, Low, High, ...: the live set stays the size of one hand.
    for (let i = 0; i < 12; i++) { vm.setQuality(i % 2 ? 'low' : 'high'); vm.update(scene(0.6 + i / 60), 1 / 60, false); expect(live()).toBe(first); }
    // A rig's dispose is safe to call twice.
    const before = disposedG.size;
    old.dispose();
    expect(disposedG.size).toBe(before);
  });

  it('leaves the campaign hand alone, and setArena builds the arena hand at the current tier', () => {
    const vm = new ViewModel({ quality: 'low' });
    expect(vm.arena).toBe(false);
    const base = rigOf(vm);
    const g = geometries(base.root);
    vm.setQuality('medium');
    expect(rigOf(vm)).toBe(base);
    expect(geometries(base.root)).toEqual(g);
    vm.setArena(true);
    expect(rigOf(vm).root.userData.quality).toBe('medium');
    // The arena hand built at Medium; switching tier while the campaign hand
    // shows drops it, and it comes back at the new tier.
    const dispose = vi.spyOn(rigOf(vm), 'dispose');
    vm.setArena(false);
    vm.setQuality('high');
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(rigOf(vm)).toBe(base);
    vm.setArena(true);
    expect(rigOf(vm).root.userData.quality).toBe('high');
    expect(vm.root.children.length).toBe(1);
  });

  it('keeps the hand out of both chanclas on every tier', () => {
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const dirs = [new THREE.Vector3(1, 0.13, 0.07), new THREE.Vector3(-0.1, 1, 0.21), new THREE.Vector3(0.17, -0.2, -1)].map((d) => d.normalize());
    const rc = new THREE.Raycaster();
    const items = [new THREE.Mesh(fpChanclaGeometry().body, mat), new THREE.Mesh(fpPesadaGeometry(), mat)];
    for (const m of items) m.geometry.computeBoundingBox();
    for (const q of TIERS) {
      const g = arenaGrips(q);
      for (const [i, skin] of [[0, g.light.skin], [1, g.heavy.skin]] as const) {
        const m = items[i]!, p = skin.attributes.position!;
        let n = 0;
        for (let k = 0; k < p.count; k++) {
          const v = new THREE.Vector3().fromBufferAttribute(p, k);
          if (m.geometry.boundingBox!.containsPoint(v) && dirs.filter((d) => { rc.set(v, d); return rc.intersectObject(m, false).length % 2 === 1; }).length >= 2) n++;
        }
        expect(n, `${q} ${i}`).toBe(0);
      }
      g.light.skin.dispose(); g.heavy.skin.dispose();
    }
  });

  it('presses La Pesada\'s thumb pad on the footbed, across from the fingertips', () => {
    // The thumb tip lies on the heel's footbed (y = 0.052 in the clog's
    // frame) toward the far side, its pad within a few millimetres of it,
    // while the fingertips are under the sole: the item is between them.
    for (const q of TIERS) {
      const skin = arenaGrips(q).heavy.skin, p = skin.attributes.position!;
      let gap = Infinity;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
        if (Math.hypot(x - 0.024, z - 0.087) < 0.014 && y > 0.045 && y < 0.08) gap = Math.min(gap, y - 0.052);
      }
      expect(gap, q).toBeGreaterThanOrEqual(0);
      expect(gap, q).toBeLessThan(0.0035);
      // Right below it, under the sole, are the fingers' pads: the heel is held between them.
      let under = 0;
      for (let k = 0; k < p.count; k++) if (p.getY(k) < -0.045 && Math.abs(p.getX(k) - 0.024) < 0.02 && Math.abs(p.getZ(k) - 0.087) < 0.03) under++;
      expect(under, q).toBeGreaterThan(20);
    }
  });

  it('leaves La Chancla\'s grip exactly as it was', () => {
    const fnv = (g: THREE.BufferGeometry) => {
      let h = 0x811c9dc5;
      for (const k of ['position', 'normal', 'color']) {
        const a = g.attributes[k]!.array as Float32Array, b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
        for (let i = 0; i < b.length; i++) { h ^= b[i]!; h = Math.imul(h, 0x01000193) >>> 0; }
      }
      return h.toString(16);
    };
    const g = arenaGrips('high');
    // The skin, wrist point and forearm of the light grip before this change.
    expect(fnv(g.light.skin)).toBe('5c9f616e');
    expect(g.light.wrist.toArray()).toEqual([0.06636805280342908, -0.008384233702748493, 0.09634729889175452]);
    expect(g.light.forearm.toArray()).toEqual([0.7644707871564382, 0.2038588765750502, 0.6115766297251506]);
    // La Pesada's attachment is unchanged too (only its thumb moved).
    expect(g.heavy.wrist.toArray()).toEqual([0.10478815142618438, 0.06842815142618439, 0.10749937069860785]);
    const a = arenaArm('high');
    expect([fnv(a.sleeve), fnv(a.trim)]).toEqual(['fbbd938b', '8d93551c']);
  });

  it('throws on the same clock on every tier', () => {
    // The item leaves the hand at the same frame, whatever the tier.
    for (const w of [0, 1] as const) {
      const hidden = TIERS.map((quality) => {
        const vm = new ViewModel({ arena: true, quality });
        vm.update({ weapon: w, cooldownMs: 0, switchMs: 0, speed: 0, onGround: true, crouched: false, alive: true, msSinceThrow: 1e6 }, 1 / 60, false);
        const out: boolean[] = [];
        for (let ms = 0; ms < WEAPONS[w]!.cooldownMs; ms += 1000 / 60) {
          vm.update({ weapon: w, cooldownMs: 0, switchMs: 0, speed: 0, onGround: true, crouched: false, alive: true, msSinceThrow: ms }, 1 / 60, false);
          out.push(rigOf(vm).items[w].visible);
        }
        return out.join('');
      });
      expect(new Set(hidden).size).toBe(1);
    }
  });
});
