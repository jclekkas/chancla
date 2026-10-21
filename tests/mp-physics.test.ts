import { describe, expect, it } from 'vitest';
import { World, newBody, stepMove, settle, bodyOverlaps, type MoveInput } from '../shared/physics';
import { box } from '../shared/collision';
import { MOVE, NET } from '../shared/config';

const DT = 1 / NET.tickRate;
const idle: MoveInput = { mx: 0, mz: 0, yaw: 0, jump: false, crouch: false };

function run(w: World, b: ReturnType<typeof newBody>, inp: Partial<MoveInput>, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) stepMove(w, b, { ...idle, ...inp }, DT);
}

describe('movement physics', () => {
  it('accelerates quickly to walk speed and stops predictably', () => {
    const w = new World([]);
    const b = newBody(0, 0, 0);
    run(w, b, { mz: 1 }, 0.15);
    expect(Math.hypot(b.vx, b.vz)).toBeCloseTo(MOVE.walkSpeed, 1);
    expect(b.z).toBeLessThan(0); // forward is -z at yaw 0
    run(w, b, {}, 0.15);
    expect(Math.hypot(b.vx, b.vz)).toBe(0);
  });

  it('diagonal movement is not faster than straight movement', () => {
    const w = new World([]);
    const b = newBody(0, 0, 0);
    run(w, b, { mz: 1, mx: 1 }, 0.5);
    expect(Math.hypot(b.vx, b.vz)).toBeLessThanOrEqual(MOVE.walkSpeed + 1e-9);
  });

  it('jumps to a predictable height and lands on the floor', () => {
    const w = new World([]);
    const b = newBody(0, 0, 0);
    stepMove(w, b, { ...idle, jump: true }, DT);
    let peak = 0;
    for (let i = 0; i < 120; i++) { stepMove(w, b, idle, DT); peak = Math.max(peak, b.y); }
    expect(peak).toBeGreaterThan(1.0);
    expect(peak).toBeLessThan(1.3);
    expect(b.y).toBeCloseTo(0, 3);
    expect(b.onGround).toBe(true);
  });

  it('stops at walls without passing through, even when running at them for seconds', () => {
    const w = new World([box(-5, 0, -3, 5, 3, -2.9)]);
    const b = newBody(0, 0, 0);
    run(w, b, { mz: 1 }, 3);
    expect(b.z).toBeGreaterThan(-2.9 + MOVE.halfWidth - 0.01);
    expect(bodyOverlaps(w, b)).toBe(false);
  });

  it('slides along a wall when moving diagonally into it', () => {
    const w = new World([box(-50, 0, -3, 50, 3, -2)]);
    const b = newBody(0, 0, 0);
    run(w, b, { mz: 1, mx: 1 }, 2);
    expect(b.x).toBeGreaterThan(3);
  });

  it('climbs 0.45 m stairs and walks back down them while staying grounded', () => {
    const steps = [1, 2, 3, 4, 5, 6].map((k) => box(-1, 0, -k * 0.55 - 1, 1, k * 0.45, -(k - 1) * 0.55 - 1));
    const top = box(-1, 0, -10, 1, 2.7, -4.3);
    const w = new World([...steps, top]);
    const b = newBody(0, 0, 0);
    run(w, b, { mz: 1 }, 1.2);
    expect(b.y).toBeCloseTo(2.7, 3);
    // Back down: never airborne for more than a tick or two.
    let airTicks = 0;
    for (let i = 0; i < 120; i++) { stepMove(w, b, { ...idle, mz: -1 }, DT); if (!b.onGround) airTicks++; }
    expect(b.y).toBeCloseTo(0, 3);
    expect(airTicks).toBeLessThan(4);
  });

  it('cannot step onto a waist-high box but can jump onto it', () => {
    const w = new World([box(-1, 0, -3, 1, 0.9, -2)]);
    const b = newBody(0, 0, 0);
    run(w, b, { mz: 1 }, 1);
    expect(b.y).toBe(0);
    stepMove(w, b, { ...idle, mz: 1, jump: true }, DT);
    run(w, b, { mz: 1 }, 0.25);
    run(w, b, {}, 0.5);
    expect(b.y).toBeCloseTo(0.9, 3);
  });

  it('bumps its head on a ceiling instead of passing through it', () => {
    const w = new World([box(-5, 2.4, -5, 5, 3, 5)]);
    const b = newBody(0, 0, 0);
    stepMove(w, b, { ...idle, jump: true }, DT);
    let maxHead = 0;
    for (let i = 0; i < 60; i++) { stepMove(w, b, idle, DT); maxHead = Math.max(maxHead, b.y + MOVE.standHeight); }
    expect(maxHead).toBeLessThanOrEqual(2.4 + 1e-3);
    expect(b.y).toBeCloseTo(0, 3);
  });

  it('crouches under a low ceiling and cannot stand up until clear', () => {
    const w = new World([box(-1, 1.4, -6, 1, 3, -2)]);
    const b = newBody(0, 0, 0);
    run(w, b, { mz: 1 }, 1); // standing: blocked at the edge
    expect(b.z).toBeGreaterThan(-2.0 + MOVE.halfWidth - 0.01);
    run(w, b, { mz: 1, crouch: true }, 0.6); // crouched: fits under
    expect(b.z).toBeLessThan(-2.5);
    run(w, b, { crouch: false }, 0.2);
    expect(b.crouched).toBe(true); // still under the ceiling
    expect(Math.hypot(b.vx, b.vz)).toBe(0);
    run(w, b, { mz: -1 }, 1.5);
    expect(b.crouched).toBe(false);
  });

  it('crouch walking is slower', () => {
    const w = new World([]);
    const b = newBody(0, 0, 0);
    run(w, b, { mz: 1, crouch: true }, 0.5);
    expect(Math.hypot(b.vx, b.vz)).toBeCloseTo(MOVE.crouchSpeed, 3);
  });

  it('settle drops a body onto the surface below', () => {
    const w = new World([box(-1, 0, -1, 1, 1.5, 1)]);
    const b = newBody(0, 3, 0);
    settle(w, b);
    expect(b.y).toBeCloseTo(1.5, 3);
  });

  it('is deterministic: the same inputs give the same result', () => {
    const w = new World([box(-2, 0, -6, 2, 1, -5)]);
    const seq: MoveInput[] = Array.from({ length: 300 }, (_, i) => ({ mx: Math.sin(i * 0.1), mz: Math.cos(i * 0.07), yaw: i * 0.01, jump: i % 50 === 0, crouch: i % 90 > 70 }));
    const a = newBody(0, 0, 0), c = newBody(0, 0, 0);
    for (const s of seq) stepMove(w, a, s, DT);
    for (const s of seq) stepMove(w, c, s, DT);
    expect(c).toEqual(a);
  });
});
