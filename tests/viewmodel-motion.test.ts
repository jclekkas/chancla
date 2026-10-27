// The first-person hand's motion: the same poses at any frame rate, a weapon
// switch that lowers, swaps out of sight and raises with no pop, secondary
// motion that steps aside for reduced motion, and attacks left as authored.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MELEE, WEAPON_SWITCH_MS, type WeaponId } from '../shared/config';
import { ViewModel, type ViewState } from '../src/fps/render/viewmodel';

interface Rig { root: THREE.Group; items: [THREE.Group, THREE.Group]; grips: [THREE.Group, THREE.Group] }
const rigOf = (vm: ViewModel) => (vm as unknown as { rig: Rig }).rig;
const TICK = 1000 / 60;

/**
 * A scripted two and a half seconds (time t in seconds): walk, a jump, a
 * turn, a switch to La Pesada and El Revés, a crouch. The switch counts down
 * on the simulation's 60 Hz ticks, as the game's does.
 */
function scene(t: number): ViewState {
  const sw0 = 1.3;
  const weapon: WeaponId = t >= sw0 ? 1 : 0;
  const switchMs = t >= sw0 ? Math.max(0, WEAPON_SWITCH_MS - Math.floor(((t - sw0) * 1000) / TICK) * TICK) : 0;
  const m0 = 1.8;
  return {
    weapon, cooldownMs: 0, switchMs,
    speed: t > 0.2 && t < 1.1 ? 4 : 0, onGround: !(t > 0.5 && t < 0.8), crouched: t > 2.3,
    alive: true, msSinceThrow: 1e6,
    msSinceMelee: t >= m0 ? (t - m0) * 1000 : 1e9, meleeWeapon: t >= m0 ? 1 : null,
    lookYaw: 0.9 * Math.sin(t * 2.2), lookPitch: 0.25 * Math.sin(t * 1.3),
  };
}

/** Root position and orientation every 1/6 s (a whole number of frames at 30, 60 and 144 fps). */
function run(fps: number, reduced = false, until = 2.5): Array<{ p: THREE.Vector3; q: THREE.Quaternion }> {
  const vm = new ViewModel();
  const out: Array<{ p: THREE.Vector3; q: THREE.Quaternion }> = [];
  const n = Math.round(until * fps), every = fps / 6;
  for (let i = 1; i <= n; i++) {
    vm.update(scene(i / fps), 1 / fps, reduced);
    if (i % every === 0) { const r = rigOf(vm).root; out.push({ p: r.position.clone(), q: r.quaternion.clone() }); }
  }
  return out;
}

describe('first-person view model motion', () => {
  it('gives the same poses at 30, 60 and 144 fps', () => {
    for (const reduced of [false, true]) {
      const ref = run(144, reduced);
      for (const fps of [30, 60]) {
        const got = run(fps, reduced);
        expect(got.length).toBe(ref.length);
        for (let i = 0; i < ref.length; i++) {
          const t = (i + 1) / 6;
          // Millimetres and a degree or two, against a hand that moves
          // decimetres. The switch (fast, and mostly out of sight) is seen to
          // start on the first frame after its 60 Hz tick, so its timing
          // differs by up to a frame: a centimetre there.
          const inSwitch = t > 1.3 && t < 1.3 + WEAPON_SWITCH_MS / 1000;
          expect(got[i]!.p.distanceTo(ref[i]!.p)).toBeLessThan(inSwitch ? 0.016 : 0.006);
          expect(got[i]!.q.angleTo(ref[i]!.q)).toBeLessThan(inSwitch ? 0.03 : 0.012);
        }
      }
    }
  });

  it('switches by lowering, swapping out of sight and raising, with no pop', () => {
    const vm = new ViewModel();
    const r = rigOf(vm);
    const still = (weapon: WeaponId, switchMs: number): ViewState => ({ weapon, cooldownMs: 0, switchMs, speed: 0, onGround: true, crouched: false, alive: true, msSinceThrow: 1e6 });
    for (let i = 0; i < 30; i++) vm.update(still(0, 0), 1 / 144, false);
    const restY = r.root.position.y;
    let prev = r.root.position.clone(), maxStep = 0, swapY = Infinity, swapped = false, minY = Infinity;
    for (let ms = 0; ms <= WEAPON_SWITCH_MS + 60; ms += 1000 / 144) {
      vm.update(still(1, Math.max(0, WEAPON_SWITCH_MS - ms)), 1 / 144, false);
      maxStep = Math.max(maxStep, r.root.position.distanceTo(prev));
      prev = r.root.position.clone();
      minY = Math.min(minY, r.root.position.y);
      if (!swapped && r.grips[1].visible) { swapped = true; swapY = r.root.position.y; }
    }
    expect(swapped).toBe(true);
    expect(minY).toBeLessThan(restY - 0.2); // goes right down
    expect(swapY).toBeLessThan(restY - 0.2); // and swaps only down there
    expect(maxStep).toBeLessThan(0.03); // no frame jumps (at 144 fps)
    expect(Math.abs(r.root.position.y - restY)).toBeLessThan(0.005); // back up at the end
    expect(r.items[1].visible && !r.items[0].visible).toBe(true);

    // Switching back halfway down raises the same chancla from where it is.
    for (let i = 0; i < 30; i++) vm.update(still(1, 0), 1 / 144, false);
    for (let ms = 0; ms < 80; ms += 1000 / 144) vm.update(still(0, WEAPON_SWITCH_MS - ms), 1 / 144, false);
    prev = r.root.position.clone(); maxStep = 0;
    for (let ms = 0; ms <= WEAPON_SWITCH_MS + 60; ms += 1000 / 144) {
      vm.update(still(1, Math.max(0, WEAPON_SWITCH_MS - ms)), 1 / 144, false);
      maxStep = Math.max(maxStep, r.root.position.distanceTo(prev));
      prev = r.root.position.clone();
      expect(r.grips[1].visible).toBe(true);
    }
    expect(maxStep).toBeLessThan(0.03);
  });

  it('starts and stops the walk bob smoothly, and lets reduced motion turn the look lag off', () => {
    const vm = new ViewModel();
    const r = rigOf(vm);
    const s = (speed: number, yaw: number): ViewState => ({ weapon: 0, cooldownMs: 0, switchMs: 0, speed, onGround: true, crouched: false, alive: true, msSinceThrow: 1e6, lookYaw: yaw, lookPitch: 0 });
    let prev: THREE.Vector3 | null = null, maxStep = 0;
    for (let i = 0; i < 240; i++) {
      vm.update(s(i > 30 && i < 140 ? 5 : 0, 0), 1 / 144, false);
      if (prev) maxStep = Math.max(maxStep, r.root.position.distanceTo(prev));
      prev = r.root.position.clone();
    }
    expect(maxStep).toBeLessThan(0.004);

    // A steady turn: the hand trails it a little (full motion), not at all (reduced).
    const lagOf = (reduced: boolean) => {
      const v = new ViewModel();
      for (let i = 0; i < 60; i++) v.update(s(0, 0), 1 / 60, reduced);
      const p0 = rigOf(v).root.position.clone();
      for (let i = 1; i <= 30; i++) v.update(s(0, i * 0.05), 1 / 60, reduced); // 3 rad/s to the left
      return rigOf(v).root.position.x - p0.x;
    };
    const full = lagOf(false), reduced = lagOf(true);
    expect(full).toBeGreaterThan(0.005);
    expect(full).toBeLessThan(0.02);
    expect(Math.abs(reduced)).toBeLessThan(0.001);
  });

  it('leaves the swings as authored when standing still', () => {
    // From the contact window on, the same moment of a swing gives the same
    // pose whatever came before it (idle, or straight out of a walk and a
    // turn, which blend out during the wind-up), within a few millimetres.
    for (const w of [0, 1] as const) {
      const d = MELEE[w]!;
      for (const at of [d.windupMs, d.windupMs + d.activeMs / 2, d.windupMs + d.activeMs, d.cycleMs - 50]) {
        const pose = (warm: (vm: ViewModel) => void) => {
          const vm = new ViewModel();
          vm.update({ weapon: w, cooldownMs: 0, switchMs: 0, speed: 0, onGround: true, crouched: false, alive: true, msSinceThrow: 1e6 }, 1 / 60, false);
          warm(vm);
          for (let ms = 0; ms <= at; ms += 1000 / 60) vm.update({ weapon: w, cooldownMs: 0, switchMs: 0, speed: 0, onGround: true, crouched: false, alive: true, msSinceThrow: 1e6, msSinceMelee: ms, meleeWeapon: w, lookYaw: 0, lookPitch: 0 }, 1 / 60, false);
          return rigOf(vm).root.position.clone();
        };
        const a = pose(() => {});
        const b = pose((vm) => { for (let i = 0; i < 90; i++) vm.update({ weapon: w, cooldownMs: 0, switchMs: 0, speed: 4, onGround: true, crouched: false, alive: true, msSinceThrow: 1e6, lookYaw: i * 0.03, lookPitch: 0 }, 1 / 60, false); });
        expect(a.distanceTo(b)).toBeLessThan(0.012);
      }
    }
  });
});
