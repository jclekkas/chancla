// Rosa's animation as it reads in motion: the same scripted moves sampled
// at 30, 60 and 144 fps must give the same pose (frame-rate independence),
// state never leaks between uses of one avatar (reset, teleport, respawn),
// and the face and cloth layers stay restrained.
import { describe, expect, it } from 'vitest';
import { buildRosaModel } from '../src/fps/render/rosa-model';
import { RosaAnimator } from '../src/fps/render/rosa-anim';
import type { AvatarState, RosaRig } from '../src/fps/render/rosa-rig';

const JOINTS = ['hips', 'torso', 'head', 'armL', 'armR', 'foreL', 'foreR', 'wristL', 'wristR', 'legL', 'legR', 'shinL', 'shinR'] as const;

function state(over: Partial<AvatarState> = {}): AvatarState {
  return { speed: 0, strafe: 0, back: 0, onGround: true, crouched: false, alive: true, protected: false, pitch: 0, weapon: 0, msSinceThrow: 1e6, msSinceHit: 1e6, connected: true, msSinceMelee: 1e6, ...over };
}

interface At { x: number; z: number; y?: number; yaw?: number; s?: Partial<AvatarState> }

/** Drives `at(t)` at `fps`, returning the pose at each sample time (between frames: interpolated). */
function sampleAt(fps: number, secs: number, at: (t: number) => At, times: number[], setup?: (a: RosaAnimator) => void): number[][] {
  const rig = buildRosaModel(0, { quality: 'high' });
  const anim = new RosaAnimator(rig, { seed: 7 });
  setup?.(anim);
  const dt = 1 / fps, out: number[][] = [];
  let prev = at(0), ti = 0, last: number[] = [];
  for (let i = 0; i <= Math.round(secs * fps); i++) {
    const t = i * dt, p = at(t), yaw = p.yaw ?? -Math.PI / 2;
    const vx = i === 0 ? 0 : (p.x - prev.x) / dt, vz = i === 0 ? 0 : (p.z - prev.z) / dt;
    prev = p;
    rig.root.position.set(p.x, p.y ?? 0, p.z);
    rig.root.rotation.y = yaw;
    const speed = Math.hypot(vx, vz), sn = Math.sin(yaw), cs = Math.cos(yaw);
    const fwd = speed > 0.01 ? (-vx * sn - vz * cs) / speed : 0, side = speed > 0.01 ? (vx * cs - vz * sn) / speed : 0;
    anim.update(state({ speed, strafe: side, back: -fwd, ...p.s }), i === 0 ? 0 : dt, false); // her clock reads t
    const now = poseOf(rig);
    for (; ti < times.length && times[ti]! <= t + 1e-9; ti++) {
      const k = i === 0 ? 1 : Math.min(1, Math.max(0, 1 - (t - times[ti]!) / dt));
      out.push(now.map((v, c) => last[c]! + (c === 0 ? v - last[c]! : wrap(v - last[c]!)) * k));
    }
    last = now;
  }
  return out;
}

/** The joints, then the skirt's swing and the face (brow height x100, about radians). */
function poseOf(rig: RosaRig): number[] {
  const o = [rig.hips.position.y];
  for (const j of JOINTS) { const r = rig[j].rotation; o.push(r.x, r.y, r.z); }
  const sk = rig.extras.skirt!.rotation, f = rig.face!;
  o.push(sk.x, sk.y, sk.z, f.x, f.y * 100, f.z);
  return o;
}

function wrap(a: number): number { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; }

/** Mean, 95th percentile and max of the per-channel difference between two pose lists (hips height x4). */
function diff(a: number[][], b: number[][]): { mean: number; p95: number; max: number } {
  let sum = 0, n = 0, max = 0;
  const all: number[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) for (let c = 0; c < a[i]!.length; c++) {
    const d = c === 0 ? Math.abs(a[i]![c]! - b[i]![c]!) * 4 : Math.abs(wrap(a[i]![c]! - b[i]![c]!));
    sum += d; n++; all.push(d); if (d > max) max = d;
  }
  all.sort((x, y) => x - y);
  return { mean: sum / Math.max(1, n), p95: all[Math.floor(all.length * 0.95)] ?? 0, max };
}

// Sample times on a 1/30 s grid (every rate has a frame on them, to float precision).
const grid = (t0: number, t1: number) => { const o: number[] = []; for (let k = Math.ceil(t0 * 30); k <= t1 * 30; k++) o.push(k / 30); return o; };
const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

// [name, seconds, path, locomotion (gait events land on frames: looser)]
const MOVES: Array<[string, number, (t: number) => At, boolean?]> = [
  ['idle', 4, () => ({ x: 0, z: 0 })],
  ['start, run, stop', 3, (t) => ({ x: 6 * Math.max(0, Math.min(t, 1.6) - 0.5), z: 0 }), true],
  ['turn on the spot', 3, (t) => ({ x: 0, z: 0, yaw: -Math.PI / 2 + (Math.PI / 2) * ease((t - 0.5) / 0.2) }), true],
  ['El Revés', 2.4, (t) => ({ x: 0, z: 0, s: { weapon: 1, msSinceMelee: t > 0.6 ? (t - 0.6) * 1000 : 1e6 } })],
  ['El Chanclazo', 2, (t) => ({ x: 0, z: 0, s: { weapon: 0, msSinceMelee: t > 0.6 ? (t - 0.6) * 1000 : 1e6 } })],
  ['a throw hit', 2, (t) => ({ x: 0, z: 0, s: { msSinceHit: t > 0.6 ? (t - 0.6) * 1000 : 1e6 } })],
  ['a jump', 2.4, (t) => { const u = t - 0.6, air = u > 0 && u < 2 / 3; return { x: 0, z: 0, y: air ? 7 * u - 10.5 * u * u : 0, s: { onGround: !air } }; }, true],
  ['strafing, then backpedalling', 3, (t) => ({ x: 0, z: 4 * Math.max(0, Math.min(t, 1.5) - 0.5) - 4 * Math.max(0, t - 1.8) }), true],
];

describe('Rosa motion: frame-rate independence', () => {
  for (const [name, secs, at, loco] of MOVES) {
    it(`${name}: the same pose at 30, 60 and 144 fps`, () => {
      const times = grid(0.4, secs);
      const ref = sampleAt(60, secs, at, times);
      for (const fps of [30, 144]) {
        const d = diff(sampleAt(fps, secs, at, times), ref);
        if (process.env.DEBUG) console.log(name, fps, d.mean.toFixed(4), d.p95.toFixed(4), d.max.toFixed(3));
        // Everything is solved for the frame's dt. Steps start and end on
        // a frame, though, so a run at 30 fps may land a step up to a frame
        // (33 ms) apart: looser for locomotion, and only in the tail.
        expect(d.mean).toBeLessThan(loco ? 0.03 : 0.003);
        expect(d.p95).toBeLessThan(loco ? 0.15 : 0.01);
        if (!loco) expect(d.max).toBeLessThan(0.1);
      }
    });
  }
});

/** Drives one animator along `at` at 60 fps from its own t = 0; returns the last pose. */
function run(rig: RosaRig, anim: RosaAnimator, secs: number, at: (t: number) => At, each?: (t: number) => void): number[] {
  const dt = 1 / 60;
  let prev = at(0);
  for (let i = 0; i <= Math.round(secs * 60); i++) {
    const t = i * dt, p = at(t), yaw = p.yaw ?? -Math.PI / 2;
    const vx = i === 0 ? 0 : (p.x - prev.x) / dt, vz = i === 0 ? 0 : (p.z - prev.z) / dt;
    prev = p;
    rig.root.position.set(p.x, p.y ?? 0, p.z);
    rig.root.rotation.y = yaw;
    const speed = Math.hypot(vx, vz), sn = Math.sin(yaw), cs = Math.cos(yaw);
    anim.update(state({ speed, strafe: speed > 0.01 ? (vx * cs - vz * sn) / speed : 0, back: speed > 0.01 ? (vx * sn + vz * cs) / speed : 0, ...p.s }), dt, false);
    each?.(t);
  }
  return poseOf(rig);
}

describe('Rosa motion: nothing carries over', () => {
  // A busy history: running, a swing, a hit, a jump.
  const busy = (t: number): At => ({ x: 6 * t, z: 0, y: t > 1.2 && t < 1.6 ? 0.4 : 0, s: { weapon: 1, msSinceMelee: t > 0.4 ? (t - 0.4) * 1000 : 1e6, msSinceHit: t > 0.9 ? (t - 0.9) * 1000 : 1e6, onGround: !(t > 1.2 && t < 1.6) } });
  const later = (t: number): At => ({ x: 30 + 3 * Math.max(0, t - 0.3), z: 5, s: { weapon: 0, msSinceMelee: t > 0.5 ? (t - 0.5) * 1000 : 1e6 } });

  it('after reset() an avatar moves exactly like a new one (a replay reusing it)', () => {
    const a = buildRosaModel(1, { quality: 'high' }), b = buildRosaModel(1, { quality: 'high' });
    const used = new RosaAnimator(a, { seed: 3 }), fresh = new RosaAnimator(b, { seed: 3 });
    run(a, used, 1.7, busy);
    used.react(true, 1);
    used.reset();
    // Her own clock has moved on (blinks, breathing): compare the poses that do not hang on it.
    const pa: number[][] = [], pb: number[][] = [];
    run(a, used, 1.5, later, () => pa.push(poseOf(a)));
    run(b, fresh, 1.5, later, () => pb.push(poseOf(b)));
    const body = (p: number[]) => p.slice(0, 1 + 3 * JOINTS.length);
    // Breathing and sway run on her clock: a few hundredths at most; everything else the same.
    const d = diff(pa.map(body), pb.map(body));
    expect(d.max).toBeLessThan(0.06);
  });

  it('a teleport (a snapshot jump) starts the cloth and the lean at rest', () => {
    const rig = buildRosaModel(0, { quality: 'high' }), anim = new RosaAnimator(rig, { seed: 1 });
    run(rig, anim, 1.2, (t) => ({ x: 6 * t, z: 0 }));
    const skirt = rig.extras.skirt!;
    expect(Math.abs(skirt.rotation.x)).toBeGreaterThan(0.02); // running: the hem trails
    rig.root.position.set(80, 0, 80);
    anim.update(state(), 1 / 60, false);
    expect(Math.abs(skirt.rotation.x)).toBeLessThan(1e-3);
    expect(Math.abs(skirt.rotation.z)).toBeLessThan(1e-3);
  });

  it('respawning clears the reactions and the face', () => {
    const rig = buildRosaModel(0, { quality: 'high' }), anim = new RosaAnimator(rig, { seed: 2 });
    run(rig, anim, 0.5, () => ({ x: 0, z: 0, s: { alive: false } }));
    anim.react(true, -1);
    let shut = 0;
    run(rig, anim, 0.3, () => ({ x: 4, z: 4 }), () => { shut = Math.max(shut, rig.face!.x); });
    expect(shut).toBeGreaterThan(0.5); // she blinks as she appears
    run(rig, anim, 0.5, () => ({ x: 4, z: 4 }));
    expect(rig.face!.x).toBeLessThan(0.05);
    expect(Math.abs(rig.face!.z)).toBeLessThan(0.02);
  });
});

describe('Rosa motion: face and cloth', () => {
  it('blinks now and then, briefly, and not in step with another Rosa', () => {
    const blinks = (seed: number) => {
      const rig = buildRosaModel(0, { quality: 'medium' }), anim = new RosaAnimator(rig, { seed });
      const starts: number[] = [];
      let shut = 0, was = false;
      run(rig, anim, 12, () => ({ x: 0, z: 0 }), (t) => { const c = rig.face!.x > 0.5; if (c && !was) starts.push(t); if (c) shut++; was = c; });
      return { starts, shut };
    };
    const a = blinks(1), b = blinks(2);
    expect(a.starts.length).toBeGreaterThanOrEqual(2);
    expect(a.starts.length).toBeLessThanOrEqual(8);
    expect(a.shut / 60 / a.starts.length).toBeLessThan(0.15); // each one over in a blink
    expect(a.starts.join()).not.toBe(b.starts.join());
  });

  it('effort through a swing, a wince when hit, and back to neutral', () => {
    const rig = buildRosaModel(1, { quality: 'high' }), anim = new RosaAnimator(rig, { seed: 5 });
    let knit = 0, lift = 0, shut = 0;
    run(rig, anim, 0.5, (t) => ({ x: 0, z: 0, s: { weapon: 1, msSinceMelee: t * 1000 } }), (t) => { if (t > 0.25) knit = Math.max(knit, rig.face!.z); });
    run(rig, anim, 1.2, () => ({ x: 0, z: 0 }));
    anim.react(true, 1);
    run(rig, anim, 0.3, (t) => ({ x: 0, z: 0, s: { msSinceHit: t * 1000 } }), () => { shut = Math.max(shut, rig.face!.x); lift = Math.max(lift, rig.face!.y); });
    expect(knit).toBeGreaterThan(0.6);
    expect(shut).toBeGreaterThan(0.6);
    expect(lift).toBeGreaterThan(0.003);
    run(rig, anim, 1.0, () => ({ x: 0, z: 0 }));
    expect(Math.abs(rig.face!.y)).toBeLessThan(0.001);
    expect(rig.face!.z).toBeLessThan(0.02);
  });

  it('the skirt trails a run, swings on past the stop and settles; Low keeps it simpler', () => {
    for (const quality of ['high', 'low'] as const) {
      const rig = buildRosaModel(0, { quality }), anim = new RosaAnimator(rig, { seed: 4, simple: quality === 'low' });
      const xs: number[] = [], ys: number[] = [];
      run(rig, anim, 3, (t) => ({ x: 6 * Math.min(t, 1.5), z: 0, yaw: -Math.PI / 2 + 0.6 * Math.sin(t * 4) }), () => { xs.push(rig.extras.skirt!.rotation.x); ys.push(rig.extras.skirt!.rotation.y); });
      expect(xs[80]!).toBeLessThan(-0.03); // running ahead: the hem behind
      expect(Math.max(...xs.slice(90, 130))).toBeGreaterThan(0.01); // stopping: it swings on ahead of her
      expect(Math.abs(xs[xs.length - 1]!)).toBeLessThan(0.02);
      for (const x of xs) expect(Math.abs(x)).toBeLessThan(0.2);
      const swish = Math.max(...ys.map(Math.abs));
      if (quality === 'low') expect(swish).toBe(0); else { expect(swish).toBeGreaterThan(0.01); expect(swish).toBeLessThan(0.2); }
    }
  });
});
