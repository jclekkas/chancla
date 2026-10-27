// The graphics benchmark's controlled scene is a pure function of scene time,
// so two runs drawing at different frame rates see the same scene at the
// same timestamps. These checks pin that down without a browser.
import { describe, expect, it } from 'vitest';
import { aggregate, benchParams, sceneAt, type FrameSample } from '../src/fps/bench';

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

  describe('frame sampling at the edges of the measurement window', () => {
    const tl2 = { warmup: 2, secs: 8 }; // views of 2 s: [2,4) [4,6) [6,8) [8,10)
    const f = (start: number, end: number, calls = 10, fpCalls = 2): FrameSample => ({ start, end, calls, tris: calls * 100, fpCalls, fpTris: fpCalls * 100 });

    it('leaves out a frame that starts in the warm-up, even though it ends inside the window', () => {
      const r = aggregate([f(1.5, 2.5), f(2.5, 3.0)], tl2);
      expect(r.all.frames).toBe(1);
      expect(r.all.sampledS).toBeCloseTo(0.5, 6);
    });

    it('gives a frame that straddles a view change, whole, to the view it started in', () => {
      const r = aggregate([f(3.9, 4.3)], tl2);
      expect(r.perView[0]!.frames).toBe(1);
      expect(r.perView[0]!.sampledS).toBeCloseTo(0.4, 6); // its full duration, not the 0.1 s inside the first view
      expect(r.perView[1]!.frames).toBe(0);
      expect(r.perView[0]!.p95FrameMs).toBeCloseTo(400, 1);
    });

    it('counts a frame that starts before the end and runs past it, and nothing that starts at or after the end', () => {
      const r = aggregate([f(9.8, 10.4), f(10.0, 10.2)], tl2);
      expect(r.all.frames).toBe(1);
      expect(r.perView[3]!.sampledS).toBeCloseTo(0.6, 6);
    });

    it('never uses an interval without an end (the frame still in progress when the run stops is not recorded)', () => {
      const r = aggregate([f(5, 5)], tl2);
      expect(r.all.frames).toBe(0);
      expect(r.all.avgFps).toBe(0);
    });

    it('uses the same frames and the same durations for FPS, percentiles and count averages', () => {
      const r = aggregate([f(2.0, 2.1, 100, 4), f(2.1, 2.4, 200, 8)], tl2);
      expect(r.all.frames).toBe(2);
      expect(r.all.avgFps).toBeCloseTo(2 / 0.4, 6); // frames / sum of their durations
      expect(r.all.drawCalls.avg).toBe(Math.round((100 * 0.1 + 200 * 0.3) / 0.4)); // weighted by duration
      expect(r.all.firstPerson.drawCalls).toBe(Math.round((4 * 0.1 + 8 * 0.3) / 0.4));
      expect(r.all.windowS).toBe(8);
      expect(r.perView.map((v) => v.windowS)).toEqual([2, 2, 2, 2]);
    });

    it('covers each scheduled window to within a frame at each end at an even frame rate', () => {
      const frames: FrameSample[] = [];
      for (let t = 0.03; t < 10.2; t += 0.37) frames.push(f(t, t + 0.37));
      const r = aggregate(frames, tl2);
      for (const v of r.perView) expect(Math.abs(v.sampledS - v.windowS)).toBeLessThanOrEqual(0.37 + 1e-9);
    });
  });
});

describe('character and combat workload', () => {
  it('is a pure function of scene time, with events at fixed times', async () => {
    const { combatAt, combatEvents } = await import('../src/fps/bench');
    for (const t of [0, 0.33, 1.2, 1.5, 12.71, 69.9]) expect(JSON.stringify(combatAt(tl, t))).toBe(JSON.stringify(combatAt(tl, t)));
    // Splitting the timeline into frames of any size yields the same events.
    const run = (dt: number) => { const out: string[] = []; for (let t = 0; t < 30; t += dt) out.push(...combatEvents(t, Math.min(30, t + dt)).map((e) => `${e.kind}@${e.at.toFixed(4)}`)); return out; };
    expect(run(1 / 60)).toEqual(run(1 / 7));
    const one = combatEvents(0, 2.4);
    expect(one.map((e) => e.kind)).toEqual(['hit', 'impact', 'whiff', 'impact']);
    // B's roller is off from the hit until the next cycle.
    expect(combatAt(tl, 0.2).walkers[1]!.ruleros).toBe(15);
    expect(combatAt(tl, 0.5).walkers[1]!.ruleros).toBe(14);
    expect(combatAt(tl, 2.6).walkers[1]!.ruleros).toBe(15);
    expect(benchParams('?bench&scene=combat')!.scene).toBe('combat');
    expect(benchParams('?bench')!.scene).toBe('cafe');
  });
});
