import { describe, expect, it } from 'vitest';
import { Scoring, type HitInfo } from '../src/game/scoring';
import { SCORE } from '../src/config';

const base: HitInfo = { ricochet: false, charged: false, interrupt: false, posing: false, legendary: false, boss: false, kill: false };

describe('scoring', () => {
  it('awards base points and bonuses', () => {
    const s = new Scoring();
    expect(s.hit(base).points).toBe(SCORE.hit);
    const r = s.hit({ ...base, ricochet: true, kill: true });
    expect(r.bonuses).toEqual(expect.arrayContaining(['ricochet', 'kill']));
    expect(r.points).toBe(SCORE.hit + SCORE.ricochet + SCORE.kill);
    expect(s.ricochetHits).toBe(1);
    expect(s.kills).toBe(1);
  });

  it('grows the multiplier with chained hits and caps it', () => {
    const s = new Scoring();
    for (let i = 0; i < 40; i++) s.hit(base);
    expect(s.multiplier).toBe(SCORE.maxMultiplier);
    expect(s.bestCombo).toBe(40);
  });

  it('drops the combo when the window expires or Rosa is hurt', () => {
    const s = new Scoring();
    s.hit(base); s.hit(base); s.hit(base);
    expect(s.multiplier).toBe(2);
    s.update(SCORE.comboWindow + 0.01);
    expect(s.combo).toBe(0);
    s.hit(base); s.hit(base);
    s.playerHurt(10);
    expect(s.combo).toBe(0);
    expect(s.bestCombo).toBe(3);
  });

  it('rewards consecutive connected throws and resets on a miss', () => {
    const s = new Scoring();
    for (let i = 0; i < 3; i++) { s.registerThrow(); s.noteThrowConnected(); s.hit(base); s.resolveThrow(true); }
    s.registerThrow(); s.noteThrowConnected();
    const r = s.hit(base);
    expect(r.bonuses).toContain('streak');
    s.resolveThrow(true);
    s.registerThrow(); s.resolveThrow(false);
    expect(s.streak).toBe(0);
    expect(s.accuracy).toBeCloseTo(4 / 5);
  });

  it('reset clears everything', () => {
    const s = new Scoring();
    s.registerThrow(); s.hit({ ...base, kill: true }); s.playerHurt(5);
    s.reset();
    expect(s.stats()).toEqual({ score: 0, throws: 0, connectedThrows: 0, hits: 0, kills: 0, ricochetHits: 0, bestCombo: 0, damageTaken: 0 });
  });
});
