// Rosa's animation in Node (THREE without WebGL): the real model's rig,
// driven along scripted paths at 60 fps, the root placed the way the engine
// places it (position and yaw first, then update). Checks the pose stays
// finite and inside joint limits, planted feet do not slide, the stride
// follows the distance travelled, the melee keys keep their reads inside the
// contact windows, and transitions between states do not pop.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MELEE, WEAPONS, type WeaponId } from '../shared/config';
import { buildRosaModel } from '../src/fps/render/rosa-model';
import { RosaAnimator, meleeArmAt } from '../src/fps/render/rosa-anim';
import { RIG, type AvatarState, type RosaRig } from '../src/fps/render/rosa-rig';

const DT = 1 / 60;
const GROUND = RIG.hipY + RIG.legY - RIG.thigh - RIG.shin; // the ankle on the paving

function state(over: Partial<AvatarState> = {}): AvatarState {
  return { speed: 0, strafe: 0, back: 0, onGround: true, crouched: false, alive: true, protected: false, pitch: 0, weapon: 0, msSinceThrow: 1e6, msSinceHit: 1e6, connected: true, msSinceMelee: 1e6, ...over };
}

/** speed, strafe and back from velocity and yaw, as engine.ts syncAvatars does. */
function moveState(vx: number, vz: number, yaw: number, over: Partial<AvatarState> = {}): AvatarState {
  const speed = Math.hypot(vx, vz), sin = Math.sin(yaw), cos = Math.cos(yaw);
  const fwd = speed > 0.01 ? (-vx * sin - vz * cos) / speed : 0;
  const side = speed > 0.01 ? (vx * cos - vz * sin) / speed : 0;
  return state({ speed, strafe: side, back: -fwd, ...over });
}

function make(team: 0 | 1 = 0): { rig: RosaRig; anim: RosaAnimator } {
  const rig = buildRosaModel(team, { quality: 'high' });
  return { rig, anim: new RosaAnimator(rig) };
}

const JOINTS = ['hips', 'torso', 'head', 'armL', 'armR', 'foreL', 'foreR', 'wristL', 'wristR', 'legL', 'legR', 'shinL', 'shinR', 'footL', 'footR'] as const;

/** First pose channel of the legs (legL onwards). */
const LEGS = 1 + 3 * JOINTS.indexOf('legL');

function pose(rig: RosaRig): number[] {
  const out: number[] = [rig.hips.position.y];
  for (const j of JOINTS) { const r = rig[j].rotation; out.push(r.x, r.y, r.z); }
  return out;
}

interface Frame { t: number; feet: THREE.Vector3[]; pose: number[] }
interface At { x: number; z: number; y?: number; yaw?: number; s?: Partial<AvatarState> }

/** Drives a path at 60 fps: `at(t)` gives the root and the rest of the state. */
function drive(rig: RosaRig, anim: RosaAnimator, secs: number, at: (t: number) => At, rm = false, t0 = 0): Frame[] {
  const frames: Frame[] = [];
  let prev = at(t0);
  for (let i = 0; i <= Math.round(secs / DT); i++) {
    const t = t0 + i * DT, p = at(t), yaw = p.yaw ?? -Math.PI / 2;
    const vx = i === 0 ? 0 : (p.x - prev.x) / DT, vz = i === 0 ? 0 : (p.z - prev.z) / DT;
    prev = p;
    rig.root.position.set(p.x, p.y ?? 0, p.z);
    rig.root.rotation.y = yaw;
    anim.update(moveState(vx, vz, yaw, p.s), DT, rm);
    rig.root.updateMatrixWorld(true);
    frames.push({ t, feet: [rig.footL.getWorldPosition(new THREE.Vector3()), rig.footR.getWorldPosition(new THREE.Vector3())], pose: pose(rig) });
  }
  return frames;
}

/** World horizontal speed (cm/s) of feet on the paving (ankle within 6 mm of it), after `from` s. */
function slip(frames: Frame[], from = 0.8): { mean: number; max: number; n: number } {
  let sum = 0, max = 0, n = 0;
  for (let i = 1; i < frames.length; i++) {
    if (frames[i]!.t < from) continue;
    for (const f of [0, 1]) {
      const a = frames[i - 1]!.feet[f]!, b = frames[i]!.feet[f]!;
      if (a.y > GROUND + 0.006 || b.y > GROUND + 0.006) continue;
      const v = Math.hypot(b.x - a.x, b.z - a.z) / DT * 100;
      sum += v; n++; max = Math.max(max, v);
    }
  }
  return { mean: n ? sum / n : 0, max, n };
}

/** Footfalls: a foot coming down onto the paving. */
function steps(frames: Frame[], from = 0.8): number {
  let n = 0;
  for (let i = 1; i < frames.length; i++) {
    if (frames[i]!.t < from) continue;
    for (const f of [0, 1]) if (frames[i - 1]!.feet[f]!.y > GROUND + 0.006 && frames[i]!.feet[f]!.y <= GROUND + 0.006) n++;
  }
  return n;
}

function wrap(a: number): number { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; }

describe('Rosa animation: locomotion', () => {
  const walks: Array<[string, number, number, Partial<AvatarState>]> = [
    // name, speed, heading relative to her facing (0 ahead, +pi/2 her right), extra state
    ['walk 1.5 m/s', 1.5, 0, {}], ['walk 3 m/s', 3, 0, {}], ['run 6 m/s', 6, 0, {}],
    ['strafe right', 6, Math.PI / 2, {}], ['strafe left', 6, -Math.PI / 2, {}], ['backpedal', 6, Math.PI, {}],
    ['diagonal', 6, Math.PI / 4, {}], ['crouch walk', 3, 0, { crouched: true }],
  ];
  for (const [name, v, rel, extra] of walks) {
    it(`planted feet do not slide: ${name}`, () => {
      const { rig, anim } = make();
      const yaw = 0.7; // any facing
      // Her forward is (-sin yaw, -cos yaw), her right (cos yaw, -sin yaw).
      const dirX = -Math.sin(yaw) * Math.cos(rel) + Math.cos(yaw) * Math.sin(rel);
      const dirZ = -Math.cos(yaw) * Math.cos(rel) - Math.sin(yaw) * Math.sin(rel);
      const fr = drive(rig, anim, 3, (t) => ({ x: dirX * v * t, z: dirZ * v * t, yaw, s: extra }));
      const sl = slip(fr);
      expect(sl.n).toBeGreaterThan(30);
      expect(sl.mean).toBeLessThan(1);
      expect(sl.max).toBeLessThan(5);
      expect(steps(fr)).toBeGreaterThan(2);
    });
  }

  it('the stride follows the distance travelled', () => {
    const count = (v: number, secs: number) => { const { rig, anim } = make(); return steps(drive(rig, anim, secs + 0.8, (t) => ({ x: v * t, z: 0 }))); };
    // The same speed for twice as long: twice the steps (to a step or two).
    const a = count(3, 2), b = count(3, 4);
    expect(Math.abs(b - 2 * a)).toBeLessThanOrEqual(2);
    // Faster: longer strides, so fewer steps per metre.
    const perM = (v: number) => count(v, 12 / v) / 12;
    expect(perM(6)).toBeLessThan(perM(3));
    expect(perM(3)).toBeLessThan(perM(1.5));
    // Standing still: no steps.
    const { rig, anim } = make();
    expect(steps(drive(rig, anim, 3, () => ({ x: 1, z: 2 })), 0.5)).toBe(0);
  });

  it('settles with a step after stopping, then stands still', () => {
    const { rig, anim } = make();
    const fr = drive(rig, anim, 4, (t) => ({ x: Math.min(t, 1.2) * 6, z: 0 }));
    const end = fr.slice(-30);
    for (const f of [0, 1]) {
      expect(end[end.length - 1]!.feet[f]!.y).toBeLessThan(GROUND + 0.006);
      expect(end[0]!.feet[f]!.distanceTo(end[end.length - 1]!.feet[f]!)).toBeLessThan(1e-4);
    }
    const gap = end[end.length - 1]!.feet[0]!.distanceTo(end[end.length - 1]!.feet[1]!);
    expect(gap).toBeGreaterThan(0.15);
    expect(gap).toBeLessThan(0.4);
  });

  it('turning on the spot steps rather than sliding', () => {
    const { rig, anim } = make();
    const fr = drive(rig, anim, 2.5, (t) => ({ x: 0, z: 0, yaw: Math.min(1, t / 0.3) * (Math.PI / 2) }));
    expect(steps(fr, 0.2)).toBeGreaterThanOrEqual(2);
    expect(slip(fr, 0.1).max).toBeLessThan(5);
  });

  it('walks on the spot when the caller never moves the root', () => {
    const { rig, anim } = make();
    const fr: Frame[] = [];
    for (let i = 0; i < 120; i++) {
      anim.update(state({ speed: 3, back: -1 }), DT, false);
      rig.root.updateMatrixWorld(true);
      fr.push({ t: i * DT, feet: [rig.footL.getWorldPosition(new THREE.Vector3()), rig.footR.getWorldPosition(new THREE.Vector3())], pose: pose(rig) });
    }
    expect(steps(fr, 0)).toBeGreaterThan(2);
  });
});

describe('Rosa animation: melee keys', () => {
  it('El Revés stays a backhand: wound up to her left, sweeping left to right inside 300-390 ms, sole leading', () => {
    const d = MELEE[1]!, c0 = d.windupMs, c1 = d.windupMs + d.activeMs;
    expect(meleeArmAt(1, 285).ay).toBeGreaterThan(0.9); // the hand across at her left
    expect(meleeArmAt(1, 285).ez).toBeLessThan(-1.2); // the elbow folded across
    let prev = meleeArmAt(1, c0).ay, cross = -1;
    for (let t = c0 + 5; t <= c1; t += 5) {
      const k = meleeArmAt(1, t);
      expect(k.ay).toBeLessThan(prev + 1e-9); // left to right
      if (prev > 0 && k.ay <= 0) cross = t;
      prev = k.ay;
    }
    expect(cross).toBeGreaterThan(c0);
    expect(cross).toBeLessThan(c1);
    for (let t = 100; t <= 900; t += 10) expect(meleeArmAt(1, t).wy).toBeLessThan(0);
    expect(meleeArmAt(1, 560).ay).toBeLessThan(-1); // follow-through out to her right
  });

  it('El Chanclazo stays a quick forehand: cocked to her right, sweeping right to left inside 120-190 ms, palm leading', () => {
    const d = MELEE[0]!, c0 = d.windupMs, c1 = d.windupMs + d.activeMs;
    expect(meleeArmAt(0, 85).ay).toBeLessThan(-0.7);
    let prev = meleeArmAt(0, c0).ay, cross = -1;
    for (let t = c0 + 5; t <= c1; t += 5) {
      const k = meleeArmAt(0, t);
      expect(k.ay).toBeGreaterThan(prev - 1e-9);
      if (prev < 0 && k.ay >= 0) cross = t;
      prev = k.ay;
    }
    expect(cross).toBeGreaterThan(c0);
    expect(cross).toBeLessThan(c1);
    for (let t = 50; t <= 500; t += 10) expect(meleeArmAt(0, t).wy).toBeGreaterThan(0);
  });

  it('the rig shows the keys during a swing (standing)', () => {
    for (const w of [0, 1] as WeaponId[]) {
      const { rig, anim } = make();
      drive(rig, anim, 0.5, () => ({ x: 0, z: 0, s: { weapon: w } }));
      const times = w === 1 ? [150, 300, 345, 390, 560] : [85, 120, 155, 190];
      let t0 = 0;
      for (const t of times) {
        drive(rig, anim, (t - t0) / 1000, (tt) => ({ x: 0, z: 0, s: { weapon: w, msSinceMelee: tt * 1000 } }), false, t0 / 1000);
        t0 = t;
        const k = meleeArmAt(w, t);
        expect(rig.armR.rotation.y).toBeCloseTo(k.ay, 1);
        expect(rig.wristR.rotation.y).toBeCloseTo(k.wy, 1);
        expect(rig.foreR.rotation.z).toBeCloseTo(k.ez, 1);
      }
    }
  });
});

describe('Rosa animation: robustness', () => {
  // A long random session: moving, turning, jumping, crouching, throwing,
  // swinging, hit, missing, switching weapons, eliminated and back.
  function session(seed: number, rm: boolean) {
    let rnd = seed;
    const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
    const { rig, anim } = make((seed % 2) as 0 | 1);
    let x = 0, z = 0, yaw = 0, y = 0, vy = 0, vx = 0, vz = 0, onGround = true;
    let crouched = false, weapon: WeaponId = 0, tThrow = 1e6, tMelee = 1e6, tHit = 1e6, alive = true, deadFor = 0, sinceCut = 99;
    let goal = { vx: 0, vz: 0, yawRate: 0 };
    const frames: Array<{ p: number[]; cut: boolean; alive: boolean; shin: number[]; fore: number[]; info: string }> = [];
    for (let i = 0; i < 60 * 40; i++) {
      if (rand() < 0.02) { const a = rand() * Math.PI * 2, sp = rand() < 0.3 ? 0 : rand() < 0.5 ? 6 : 3; goal = { vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, yawRate: (rand() - 0.5) * 8 }; }
      const cap = crouched ? 0.5 : 1; // crouched she moves at 3 m/s at most
      vx += Math.max(-70 * DT, Math.min(70 * DT, goal.vx * cap - vx)); vz += Math.max(-70 * DT, Math.min(70 * DT, goal.vz * cap - vz));
      if (rand() < 0.01) crouched = !crouched;
      if (onGround && rand() < 0.008) { vy = 7; onGround = false; }
      if (!onGround) { vy -= 21 * DT; y += vy * DT; if (y <= 0) { y = 0; vy = 0; onGround = true; } }
      tThrow += 1000 * DT; tMelee += 1000 * DT; tHit += 1000 * DT;
      const busy = tMelee < MELEE[weapon]!.cycleMs || tThrow < WEAPONS[weapon]!.cooldownMs;
      if (!busy && rand() < 0.01) weapon = weapon === 0 ? 1 : 0;
      if (!busy && rand() < 0.02) tThrow = 0;
      else if (!busy && rand() < 0.015) tMelee = 0;
      const end = MELEE[weapon]!.windupMs + MELEE[weapon]!.activeMs;
      if (tMelee >= end && tMelee < end + 1000 * DT && rand() < 0.5) anim.whiff(weapon);
      if (rand() < 0.01) { tHit = 0; if (rand() < 0.5) anim.react(rand() < 0.5, rand() < 0.5 ? 1 : -1); }
      sinceCut++;
      if (alive && rand() < 0.002) { alive = false; deadFor = 0; sinceCut = 0; }
      if (!alive) { deadFor += DT; if (deadFor > 2.6) { alive = true; sinceCut = 0; x += 10; } }
      yaw += goal.yawRate * DT;
      x += vx * DT; z += vz * DT;
      rig.root.position.set(x, y, z);
      rig.root.rotation.y = yaw;
      anim.update(moveState(vx, vz, yaw, { onGround, crouched, weapon, msSinceThrow: tThrow, msSinceMelee: tMelee, msSinceHit: tHit, alive, pitch: Math.sin(i * 0.01) * 0.6 }), DT, rm);
      frames.push({ info: `ground ${onGround} y ${y.toFixed(2)} crouch ${crouched} v ${Math.hypot(vx, vz).toFixed(1)} throw ${tThrow.toFixed(0)} melee ${tMelee.toFixed(0)} w ${weapon}`, p: pose(rig), cut: sinceCut < 2, alive, shin: [rig.shinL.rotation.x, rig.shinR.rotation.x], fore: [rig.foreL.rotation.x, rig.foreR.rotation.x] });
    }
    return { rig, frames };
  }

  for (const rm of [false, true]) {
    it(`a long random session stays finite, inside joint limits and continuous${rm ? ' (reduced motion)' : ''}`, () => {
      for (const seed of [11, 12, 13]) {
        const { rig, frames } = session(seed, rm);
        let worst = 0, worstAt = '';
        for (let i = 0; i < frames.length; i++) {
          const f = frames[i]!;
          for (const v of f.p) expect(Number.isFinite(v)).toBe(true);
          expect(Number.isFinite(rig.root.scale.x)).toBe(true);
          if (!f.alive) continue;
          // Knees bend forward only; elbows inside a natural range.
          for (const k of f.shin) { expect(k).toBeLessThanOrEqual(1e-6); expect(k).toBeGreaterThan(-2.6); }
          for (const e of f.fore) { expect(e).toBeGreaterThan(-0.7); expect(e).toBeLessThan(2.6); }
          if (i === 0 || f.cut || !frames[i - 1]!.alive) continue;
          // No pops: no joint turns more than this between two 16 ms frames
          // (hips height x4; the legs, IK-driven, swing faster in a run: x0.75).
          for (let j = 0; j < f.p.length; j++) {
            const d = (j === 0 ? Math.abs(f.p[j]! - frames[i - 1]!.p[j]!) * 4 : Math.abs(wrap(f.p[j]! - frames[i - 1]!.p[j]!))) * (j >= LEGS ? 0.75 : 1);
            if (d > worst) { worst = d; worstAt = `frame ${i}, channel ${j} [${frames[i - 1]!.info} -> ${f.info}]`; }
          }
        }
        expect(worst, `largest per-frame change ${worst.toFixed(3)} at ${worstAt} (seed ${seed})`).toBeLessThan(0.85);
      }
    });
  }

  it('copes with dt = 0, a huge dt and a teleport', () => {
    const { rig, anim } = make();
    anim.update(state(), 0, false);
    rig.root.position.set(100, 0, -50);
    anim.update(state({ speed: 6 }), 0.5, false);
    rig.root.position.set(100.1, 0, -50);
    anim.update(state({ speed: 6 }), 1e-6, false);
    for (const v of pose(rig)) expect(Number.isFinite(v)).toBe(true);
  });

  it('a hit reaction is brief: a clear snap, over within 0.7 s', () => {
    const { rig, anim } = make();
    const still = drive(rig, anim, 1, () => ({ x: 0, z: 0 }));
    const rest = still[still.length - 1]!.pose;
    anim.react(true, 1);
    const fr = drive(rig, anim, 0.7, () => ({ x: 0, z: 0 }), false, 1);
    const headYaw = (p: number[]) => p[1 + 3 * 2 + 1]!;
    const peak = Math.max(...fr.map((f) => Math.abs(headYaw(f.pose) - headYaw(rest))));
    expect(peak).toBeGreaterThan(0.3);
    expect(Math.abs(headYaw(fr[fr.length - 1]!.pose) - headYaw(rest))).toBeLessThan(0.05);
  });

  it('update keeps nothing: the heap does not grow over many frames', () => {
    const { rig, anim } = make();
    const run = (n: number, t0: number) => { for (let i = 0; i < n; i++) { const t = t0 + i * DT; rig.root.position.set(6 * t, 0, 0); anim.update(state({ speed: 6, msSinceMelee: (t * 1000) % 1500, weapon: 1 }), DT, false); } };
    run(600, 0);
    const g = (globalThis as { gc?: () => void }).gc;
    if (!g) return; // run node with --expose-gc for this one
    run(6000, 10); // warm (compiled code, inline caches)
    g(); const before = process.memoryUsage().heapUsed;
    run(6000, 110);
    g(); expect(process.memoryUsage().heapUsed - before).toBeLessThan(50_000);
  });
});
