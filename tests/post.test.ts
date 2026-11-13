import { describe, expect, it } from 'vitest';
import { gradeFor } from '../src/fps/render/post';

// The final-image grade is deliberately small: a tint, a little colour and contrast, a faint vignette.
// These bounds keep a later tweak from turning it into a heavy filter (team colours must stay readable).
describe('final-image grade', () => {
  for (const theme of ['afternoon', 'morning', 'noon', 'dusk', 'unknown']) {
    it(`${theme}: stays subtle`, () => {
      const g = gradeFor(theme);
      expect(g.bloom).toBeGreaterThanOrEqual(0); expect(g.bloom).toBeLessThanOrEqual(0.7);
      expect(g.threshold).toBeGreaterThanOrEqual(0.5); expect(g.threshold).toBeLessThanOrEqual(0.9);
      expect(g.saturation).toBeGreaterThanOrEqual(1); expect(g.saturation).toBeLessThanOrEqual(1.2);
      expect(g.contrast).toBeGreaterThanOrEqual(1); expect(g.contrast).toBeLessThanOrEqual(1.12);
      expect(g.vignette).toBeGreaterThanOrEqual(0); expect(g.vignette).toBeLessThanOrEqual(0.3);
      for (const c of [...g.shadow, ...g.light]) { expect(c).toBeGreaterThan(0.85); expect(c).toBeLessThan(1.15); }
    });
  }
});
