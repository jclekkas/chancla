import { describe, expect, it } from 'vitest';
import { MAPS, makeEndlessWave, emptyRanks } from '../chancla-duty/src/content';
import { I18N } from '../chancla-duty/src/i18n';
import { circleMtv } from '../chancla-duty/src/phys';
import { gradeRun, multiplier, respetoEarned } from '../chancla-duty/src/rules';
import { Sim, blankInput } from '../chancla-duty/src/sim';

describe('chancla duty rules', () => {
  it('grows a combo multiplier and then caps it', () => {
    expect(multiplier(0)).toBe(1);
    expect(multiplier(2)).toBe(1);
    expect(multiplier(3)).toBe(2);
    expect(multiplier(30)).toBe(8);
  });

  it('grades a clear above par as S only when Rosa is still healthy', () => {
    expect(gradeRun(true, 8000, 5000, 0.8)).toBe('S');
    expect(gradeRun(true, 8000, 5000, 0.2)).toBe('A');
    expect(gradeRun(false, 8000, 5000, 1)).toBe('D');
  });

  it('pays more respeto for a win than a loss', () => {
    const win = respetoEarned(4000, true, 'A', 0);
    const loss = respetoEarned(4000, false, 'D', 0);
    expect(win).toBeGreaterThan(loss);
  });

  it('puts a boss on every fifth endless wave', () => {
    expect(makeEndlessWave(4).kinds.includes('rey')).toBe(false);
    expect(makeEndlessWave(5).kinds[0]).toBe('rey');
    expect(makeEndlessWave(5).max).toBeLessThanOrEqual(8);
  });

  it('keeps English and Spanish on the same keys', () => {
    expect(Object.keys(I18N.en).sort()).toEqual(Object.keys(I18N.es).sort());
  });
});

describe('chancla duty sim', () => {
  it('pushes a circle out of a wall', () => {
    const mtv = circleMtv(10, 10, 8, { x: 0, y: 0, w: 20, h: 6 });
    expect(mtv).not.toBeNull();
    expect(mtv!.y).toBeGreaterThan(0);
  });

  it('spawns a bocinas and lets a chancla hurt it', () => {
    const sim = new Sim({
      map: MAPS.patio!,
      waves: [{ kinds: ['bocinas'], max: 1, gap: 0.05 }],
      diff: 'easy',
      ranks: emptyRanks(),
      weapons: ['chancla', 'pesada'],
      seed: 3,
      loop: false,
      god: false,
      endless: false,
      finale: false,
      defend: false,
    });
    const idle = blankInput();
    for (let i = 0; i < 90; i++) sim.step(1 / 60, idle);
    expect(sim.enemies.length).toBeGreaterThan(0);
    const enemy = sim.enemies[0]!;
    enemy.x = sim.player.x + 48;
    enemy.y = sim.player.y;
    enemy.state = 'move';
    const hp = enemy.hp;
    sim.step(1 / 60, blankInput({
      aimX: enemy.x,
      aimY: enemy.y,
      fireDown: true,
      firePressed: true,
      fireReleased: true,
    }));
    expect(sim.shots.length).toBeGreaterThan(0);
    for (let i = 0; i < 40 && enemy.hp === hp && enemy.dying === null; i++) sim.step(1 / 60, idle);
    expect(enemy.hp).toBeLessThan(hp);
  });

  it('does not damage El Rey through his shield', () => {
    const sim = new Sim({
      map: MAPS.fiesta!,
      waves: [{ kinds: ['rey'], max: 1, gap: 0.05, boss: true }],
      diff: 'normal',
      ranks: emptyRanks(),
      weapons: ['chancla'],
      seed: 9,
      loop: false,
      god: false,
      endless: false,
      finale: true,
      defend: false,
    });
    const idle = blankInput();
    for (let i = 0; i < 90; i++) sim.step(1 / 60, idle);
    const rey = sim.enemies.find((e) => e.kind === 'rey');
    expect(rey).toBeTruthy();
    rey!.x = sim.player.x + 70;
    rey!.y = sim.player.y;
    rey!.breath = false;
    rey!.state = 'move';
    const hp = rey!.hp;
    sim.step(1 / 60, blankInput({
      aimX: rey!.x,
      aimY: rey!.y,
      firePressed: true,
      fireReleased: true,
    }));
    for (let i = 0; i < 30; i++) sim.step(1 / 60, idle);
    expect(rey!.hp).toBe(hp);
  });

  it('simulates thirty seconds of a shift quickly', () => {
    const sim = new Sim({
      map: MAPS.plaza!,
      waves: [makeEndlessWave(3)],
      diff: 'normal',
      ranks: emptyRanks(),
      weapons: ['chancla', 'pesada'],
      seed: 4,
      loop: true,
      god: true,
      endless: false,
      finale: false,
      defend: false,
    });
    const t0 = performance.now();
    const input = blankInput({ mx: 1, my: 0.2, aimX: 800, aimY: 400, fireReleased: true, firePressed: true });
    for (let i = 0; i < 60 * 20; i++) sim.step(1 / 60, i % 20 === 0 ? input : blankInput({ mx: 1 }));
    expect(performance.now() - t0).toBeLessThan(1200);
    expect(Number.isFinite(sim.player.x)).toBe(true);
    expect(Number.isFinite(sim.score)).toBe(true);
  });
});
