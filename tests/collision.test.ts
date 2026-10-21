import { describe, expect, it } from 'vitest';
import { box, lineOfSight, resolveCircle, segmentAABB, segmentCapsule, segmentSphere, sweepWorld, type WorldHit } from '../src/physics/collision';

const v = (x: number, y: number, z: number) => ({ x, y, z });
const hit = () => ({ t: 0, nx: 0, ny: 0, nz: 0 });

describe('segmentAABB', () => {
  const wall = box(-1, 0, -0.1, 1, 3, 0.1);

  it('reports entry time and face normal', () => {
    const h = hit();
    expect(segmentAABB(v(0, 1, 5), v(0, 1, -5), wall, 0, h)).toBe(true);
    expect(h.t).toBeCloseTo(0.49, 2);
    expect(h.nz).toBe(1);
  });

  it('does not let a very fast segment tunnel through a thin wall', () => {
    // 50 m in one step, wall only 0.2 m thick.
    const h = hit();
    expect(segmentAABB(v(0, 1, 25), v(0, 1, -25), wall, 0.14, h)).toBe(true);
    expect(h.t).toBeGreaterThan(0);
    expect(h.t).toBeLessThan(1);
  });

  it('misses when the segment passes beside the box', () => {
    expect(segmentAABB(v(3, 1, 5), v(3, 1, -5), wall, 0, hit())).toBe(false);
  });

  it('ignores a segment that starts inside, so projectiles can leave surfaces', () => {
    expect(segmentAABB(v(0, 1, 0), v(0, 1, -5), wall, 0, hit())).toBe(false);
  });

  it('respects inflation radius', () => {
    expect(segmentAABB(v(1.1, 1, 5), v(1.1, 1, -5), wall, 0, hit())).toBe(false);
    expect(segmentAABB(v(1.1, 1, 5), v(1.1, 1, -5), wall, 0.15, hit())).toBe(true);
  });
});

describe('capsules and spheres', () => {
  it('detects a swept hit against a standing capsule', () => {
    const t = segmentCapsule(v(0, 1, 5), v(0, 1, -5), 0.14, 0, 0, 0.3, 1.8, 0.45);
    expect(t).toBeGreaterThan(0.3);
    expect(t).toBeLessThan(0.6);
  });

  it('misses a capsule above the segment', () => {
    expect(segmentCapsule(v(0, 3, 5), v(0, 3, -5), 0.1, 0, 0, 0.3, 1.8, 0.4)).toBe(-1);
  });

  it('finds the first contact with a sphere', () => {
    const t = segmentSphere(v(0, 0, 10), v(0, 0, -10), 0, v(0, 0, 0), 1);
    expect(t).toBeCloseTo(0.45, 3);
  });
});

describe('world sweep and movement', () => {
  it('prefers the nearest surface and flags the ground', () => {
    const boxes = [box(-1, 0, -3, 1, 2, -2), box(-1, 0, -6, 1, 2, -5)];
    const out: WorldHit = { t: 0, nx: 0, ny: 0, nz: 0, box: null, ground: false };
    expect(sweepWorld(v(0, 1, 0), v(0, 1, -10), 0.1, boxes, out)).toBe(true);
    expect(out.box).toBe(boxes[0]);
    expect(sweepWorld(v(0, 1, 0), v(0, -1, 0.5), 0.1, [], out)).toBe(true);
    expect(out.ground).toBe(true);
  });

  it('pushes a circle out of a box and slides along it', () => {
    const out = { x: 0, z: 0 };
    resolveCircle(0, 0.2, 0.4, [box(-2, 0, -1, 2, 2, 0)], out);
    expect(out.z).toBeCloseTo(0.4, 5);
    expect(out.x).toBeCloseTo(0, 5);
  });

  it('ignores low steps and overhead canopies for walking', () => {
    const out = { x: 0, z: 0 };
    resolveCircle(0, 0, 0.4, [box(-1, 0, -1, 1, 0.05, 1), box(-1, 2.4, -1, 1, 2.7, 1)], out);
    expect(out).toEqual({ x: 0, z: 0 });
  });

  it('line of sight is blocked by sound-blocking cover only', () => {
    const cover = box(-1, 0, -0.5, 1, 1.2, 0.5);
    const cloth = box(-1, 0, -0.5, 1, 1.2, 0.5, 'umbrella', true, false);
    expect(lineOfSight(v(0, 1, 5), v(0, 1, -5), [cover])).toBe(false);
    expect(lineOfSight(v(0, 1, 5), v(0, 1, -5), [cloth])).toBe(true);
    expect(lineOfSight(v(0, 2, 5), v(0, 2, -5), [cover])).toBe(true);
  });
});
