// Mission instructions say *how*, not just *what*. Plays every mission
// with the helper bot (sloppy aim included, so rejected hits and waiting
// states happen) and checks that every hint it could be shown has a
// specific instruction, and every rejected hit explains itself.
import { describe, expect, it } from 'vitest';
import { MissionSim, type MEvent } from '../shared/campaign/mission';
import { MissionBot } from '../shared/campaign/bot';
import { MISSIONS } from '../shared/campaign/missions';
import { missionHints } from '../shared/campaign/hints';
import { howText, rejectText, setHowTouch } from '../src/campaign/howto';
import { STRINGS, t } from '../src/fps/strings';

const LIMIT = 10 * 60 * 1000;
const GENERIC = new Set([t('how.shoot'), t('how.wait'), t('how.go'), t('how.stay')]);

describe('campaign how-to instructions', () => {
  for (const def of MISSIONS) {
    it(`${def.id}: every hint along the way has a specific instruction`, () => {
      const vague = new Set<string>();
      const unexplained = new Set<string>();
      const seen = new Set<string>();
      for (const [seed, aimErrorRad] of [[1, 0], [2, 0], [3, 0.06]] as const) {
        const sim = new MissionSim(def, seed);
        const bot = new MissionBot({ seed: seed * 13 + 1, aimErrorRad });
        let tick = 0;
        while (!sim.state.complete && sim.state.timeMs < LIMIT) {
          sim.step(bot.think(sim));
          for (const ev of sim.drainEvents() as MEvent[]) {
            if (ev.k !== 'reject') continue;
            if (!rejectText(ev.why, ev.id)) unexplained.add(`${ev.why}:${ev.id}`);
          }
          if (++tick % 12) continue;
          for (const h of missionHints(sim)) {
            const text = howText(sim, h);
            const key = `${sim.stageDef.id}/${h.kind}/${h.id.replace(/\d+$/, '#')}`;
            seen.add(key);
            if (!text || GENERIC.has(text)) vague.add(key);
          }
        }
        expect(sim.state.complete, `${def.id} seed ${seed}`).toBe(true);
      }
      expect([...vague], 'hints with no specific instruction').toEqual([]);
      expect([...unexplained], 'rejected hits with no explanation').toEqual([]);
      expect(seen.size).toBeGreaterThan(0);
    }, 120000);

    it(`${def.id}: the briefing lists how it works, in both languages`, () => {
      for (const lang of ['en', 'es'] as const) {
        const steps = Object.keys(STRINGS[lang]).filter((k) => k.startsWith(`${def.id}.how`));
        expect(steps.length, lang).toBeGreaterThanOrEqual(3);
      }
    });
  }

  // A touchscreen laptop or an iPad with a keyboard can start a mission and
  // then play it by touch: instructions must name the on-screen buttons.
  it('on touch controls, no instruction mentions keys or the mouse', () => {
    setHowTouch(true);
    try {
      const keyish = /\bpress\b|\bclick\b|\(2\)|\bF\b/i;
      const bad = new Set<string>();
      for (const def of MISSIONS) {
        const sim = new MissionSim(def, 1);
        const bot = new MissionBot({ seed: 5, aimErrorRad: 0.06 });
        let tick = 0;
        while (!sim.state.complete && sim.state.timeMs < LIMIT) {
          sim.step(bot.think(sim));
          for (const ev of sim.drainEvents() as MEvent[]) if (ev.k === 'reject') { const r = rejectText(ev.why, ev.id); if (r && keyish.test(r)) bad.add(r); }
          if (++tick % 12) continue;
          for (const h of missionHints(sim)) { const x = howText(sim, h); if (x && keyish.test(x)) bad.add(x); }
        }
      }
      for (const why of ['bank', 'heavy', 'timing', 'dodge', 'armor']) { const r = rejectText(why, 'x'); if (r && keyish.test(r)) bad.add(r); }
      expect([...bad]).toEqual([]);
      expect(t('mi.controls.touch')).not.toMatch(keyish);
    } finally { setHowTouch(false); }
  }, 120000);

  it('every how-to line is translated (Spanish differs from English)', () => {
    const keys = Object.keys(STRINGS.en).filter((k) => /^how\.|\.how\d|^mi\.(how|controls)$/.test(k)) as (keyof typeof STRINGS.en)[];
    expect(keys.length).toBeGreaterThan(40);
    for (const k of keys) expect(STRINGS.es[k], k).not.toBe(STRINGS.en[k]);
  });
});
