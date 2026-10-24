// Your own confirmed miss: what it shows depends on when the server's
// 'whiff' event arrives relative to your swing in hand. It never replays
// the swing: a late event fades the overrun out, a stale one or one for an
// older swing shows nothing.
import { describe, expect, it } from 'vitest';
import { MELEE } from '../shared/config';
import { MISS_FULL_MS, MISS_MARK_MAX_MS, MISS_MOTION_MAX_MS, missFeedback } from '../src/fps/miss-feedback';

const end = (w: 0 | 1) => MELEE[w]!.windupMs + MELEE[w]!.activeMs;

describe('own miss feedback', () => {
  for (const w of [0, 1] as const) {
    it(`full overrun and the mark when the miss arrives promptly (${w === 1 ? 'El Revés' : 'El Chanclazo'})`, () => {
      expect(missFeedback(w, w, end(w) + 10)).toEqual({ motion: 1, mark: true });
      expect(missFeedback(w, w, end(w) + MISS_FULL_MS)).toEqual({ motion: 1, mark: true });
    });

    it(`fades the overrun with lateness, then keeps only the mark, then nothing (${w})`, () => {
      const mid = missFeedback(w, w, end(w) + (MISS_FULL_MS + MISS_MOTION_MAX_MS) / 2);
      expect(mid.motion).toBeCloseTo(0.5, 5);
      expect(mid.mark).toBe(true);
      expect(missFeedback(w, w, end(w) + MISS_MOTION_MAX_MS + 50)).toEqual({ motion: 0, mark: true });
      expect(missFeedback(w, w, end(w) + MISS_MARK_MAX_MS + 1)).toEqual({ motion: 0, mark: false });
    });

    it(`shows nothing for a miss that cannot be the swing in hand (${w})`, () => {
      // A newer swing has started: it has not reached the end of its contact window.
      expect(missFeedback(w, w, end(w) - 20)).toEqual({ motion: 0, mark: false });
      // A different chancla, no swing at all, or a stale event.
      expect(missFeedback(w, w === 1 ? 0 : 1, end(w) + 10)).toEqual({ motion: 0, mark: false });
      expect(missFeedback(w, null, end(w) + 10)).toEqual({ motion: 0, mark: false });
      expect(missFeedback(w, w, Infinity)).toEqual({ motion: 0, mark: false });
      expect(missFeedback(w, w, 60_000)).toEqual({ motion: 0, mark: false });
    });
  }

  it('the overrun strength never increases with lateness', () => {
    let prev = 2;
    for (let late = 0; late <= MISS_MARK_MAX_MS; late += 5) {
      const m = missFeedback(1, 1, end(1) + late).motion;
      expect(m).toBeLessThanOrEqual(prev);
      prev = m;
    }
  });
});
