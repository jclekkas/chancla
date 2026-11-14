import { describe, expect, it } from 'vitest';
import { PostGuard } from '../src/fps/render/post';

// The safety valve: sustained low frame rate switches the final-image pass off; hitches, pauses and
// the first seconds do not.
function run(g: PostGuard, seconds: number, dt: number, fps: number): number | null {
  for (let t = 0; t < seconds; t += dt) if (g.step(dt, fps)) return t;
  return null;
}

describe('final-image safety valve', () => {
  it('never trips at a steady frame rate', () => { expect(run(new PostGuard(), 120, 1 / 60, 60)).toBeNull(); });
  it('trips after sustained low frame rate, once the warm-up is over', () => {
    const t = run(new PostGuard(), 30, 1 / 30, 30);
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThanOrEqual(3 + 4 - 0.1); // 3 s warm-up, then 4 s of slow frames
    expect(t!).toBeLessThan(8);
  });
  it('ignores the warm-up even when it is slow', () => { expect(run(new PostGuard(), 3, 1 / 20, 20)).toBeNull(); });
  it('does not trip on short dips that recover', () => {
    const g = new PostGuard();
    let tripped = false;
    for (let k = 0; k < 20 && !tripped; k++) {
      tripped = run(g, 2, 1 / 30, 25) !== null; // two slow seconds
      if (!tripped) tripped = run(g, 4, 1 / 60, 60) !== null; // then four good ones
    }
    expect(tripped).toBe(false);
  });
  it('does not count a pause or a tab switch as slow frames', () => {
    const g = new PostGuard();
    run(g, 5, 1 / 60, 60);
    for (let k = 0; k < 50; k++) expect(g.step(1, 5)).toBe(false); // long gaps
  });
  it('starts over after a reset', () => {
    const g = new PostGuard();
    expect(run(g, 30, 1 / 30, 20)).not.toBeNull();
    g.reset();
    expect(run(g, 3, 1 / 30, 20)).toBeNull(); // the warm-up again
  });
});
