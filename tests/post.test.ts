import { describe, expect, it } from 'vitest';
import { gradeFor } from '../src/fps/render/post';

// The final-image grade is bounded: tints, vibrance and contrast, glow, a small sharpen, a vignette.
// These bounds keep a later tweak from turning it into a heavy filter (team colours must stay readable).
describe('final-image grade', () => {
  for (const theme of ['afternoon', 'morning', 'noon', 'dusk', 'unknown']) {
    it(`${theme}: stays bounded`, () => {
      const g = gradeFor(theme);
      expect(g.bloom).toBeGreaterThanOrEqual(0); expect(g.bloom).toBeLessThanOrEqual(1);
      expect(g.threshold).toBeGreaterThanOrEqual(0.5); expect(g.shafts).toBeGreaterThanOrEqual(0); expect(g.shafts).toBeLessThanOrEqual(0.9); expect(g.sharpen).toBeLessThanOrEqual(0.5); expect(g.fringe).toBeLessThanOrEqual(0.003); expect(g.threshold).toBeLessThanOrEqual(0.9);
      expect(g.saturation).toBeGreaterThanOrEqual(1); expect(g.saturation).toBeLessThanOrEqual(1.3);
      expect(g.contrast).toBeGreaterThanOrEqual(1); expect(g.contrast).toBeLessThanOrEqual(1.2);
      expect(g.vignette).toBeGreaterThanOrEqual(0); expect(g.vignette).toBeLessThanOrEqual(0.4);
      for (const c of [...g.shadow, ...g.light]) { expect(c).toBeGreaterThan(0.8); expect(c).toBeLessThan(1.2); }
    });
  }
});
