// The graphics benchmark's controlled scene is a pure function of scene time,
// so two runs drawing at different frame rates see the same scene at the
// same timestamps. These checks pin that down without a browser.
import { describe, expect, it } from 'vitest';
import { benchParams, sceneAt } from '../src/fps/bench';

const tl = { warmup: 10, secs: 60 };

describe('graphics benchmark scene', () => {
  it('is the same at the same timestamp however the frames fall', () => {
    // A fast run (60 fps) and a slow one (7 fps) sampling different moments
    // still agree wherever they share a timestamp.
    const fast = new Map<number, string>(), slow = new Map<number, string>();
    for (let f = 0; f * (1 / 60) < 70; f++) { const t = Math.round(f * (1 / 60) * 1e6) / 1e6; fast.set(t, JSON.stringify(sceneAt(tl, t))); }
    for (let f = 0; f * (1 / 7) < 70; f++) { const t = Math.round(f * (1 / 7) * 1e6) / 1e6; slow.set(t, JSON.stringify(sceneAt(tl, t))); }
    let shared = 0;
    for (const [t, s] of slow) if (fast.has(t)) { shared++; expect(fast.get(t)).toBe(s); }
    expect(shared).toBeGreaterThan(0);
    for (const t of [0, 3.3, 10, 41.25, 69.99]) expect(JSON.stringify(sceneAt(tl, t))).toBe(JSON.stringify(sceneAt(tl, t)));
  });

  it('keeps warm-up separate and gives each view equal measured time', () => {
    expect(sceneAt(tl, 9.99).measured).toBe(false);
    expect(sceneAt(tl, 10).measured).toBe(true);
    const per = [0, 0, 0, 0];
    for (let i = 0; i < 60000; i++) per[sceneAt(tl, 10 + (i + 0.5) / 1000).station]!++;
    expect(per).toEqual([15000, 15000, 15000, 15000]);
    const warm = [0, 0, 0, 0];
    for (let i = 0; i < 10000; i++) warm[sceneAt(tl, (i + 0.5) / 1000).station]!++;
    expect(warm).toEqual([2500, 2500, 2500, 2500]);
  });

  it('always has three characters and six projectiles in flight, each with a stable identity within its flight', () => {
    let prev = sceneAt(tl, 0);
    for (let i = 1; i < 7000; i++) {
      const s = sceneAt(tl, i / 100);
      expect(s.walkers).toHaveLength(3);
      expect(s.proj).toHaveLength(6);
      expect(new Set(s.proj.map((p) => p.key)).size).toBe(6);
      for (const p of s.proj) expect(p.y).toBeGreaterThan(0.5); // in the air, never through the ground
      // A projectile that keeps its key between two moments moved continuously (no teleport within a flight).
      for (const p of s.proj) {
        const q = prev.proj.find((x) => x.key === p.key);
        if (q && s.station === prev.station) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeLessThan(0.5);
      }
      prev = s;
    }
  });

  it('reads the modes from the address', () => {
    expect(benchParams('?bench')).toMatchObject({ mode: 'controlled', section: true, quality: 'high', secs: 60, warmup: 10, throttleMs: 0 });
    expect(benchParams('?bench&section=off&quality=low')).toMatchObject({ mode: 'controlled', section: false, quality: 'low' });
    expect(benchParams('?bench=live')).toMatchObject({ mode: 'live', section: true });
    expect(benchParams('?foo')).toBeNull();
  });
});
