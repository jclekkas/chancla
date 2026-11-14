// Pure scoring, grades and payouts. The simulation and the results screen
// both read these so a combo means the same thing in a test and on screen.

export const POINTS = {
  hit: 90,
  charged: 110,
  ricochet: 180,
  kill: 240,
  interrupt: 150,
  pose: 160,
  hazard: 280,
  bossHit: 70,
  bossKill: 3500,
  wave: 450,
} as const;

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

/** Combo 0–2 → ×1, then +1 every 3 hits, capped at ×8. */
export function multiplier(combo: number): number {
  if (combo <= 0) return 1;
  return Math.min(8, 1 + Math.floor(combo / 3));
}

export function gradeRun(won: boolean, score: number, par: number, hpPct: number): Grade {
  if (!won) return 'D';
  if (score >= par * 1.15 && hpPct >= 0.55) return 'S';
  if (score >= par * 0.92) return 'A';
  if (score >= par * 0.6) return 'B';
  return 'C';
}

export function endlessGrade(clearedWaves: number): Grade {
  if (clearedWaves >= 12) return 'S';
  if (clearedWaves >= 8) return 'A';
  if (clearedWaves >= 5) return 'B';
  if (clearedWaves >= 2) return 'C';
  return 'D';
}

const GRADE_BONUS: Record<Grade, number> = { S: 160, A: 110, B: 70, C: 40, D: 0 };

export function respetoEarned(score: number, won: boolean, grade: Grade, clearedWaves: number): number {
  const fromScore = Math.round(score / 40);
  if (!won) return Math.max(8, Math.round(fromScore * 0.4) + clearedWaves * 4);
  return fromScore + GRADE_BONUS[grade] + clearedWaves * 6;
}

export function rankFor(lifetime: number): number {
  const steps = [0, 200, 500, 1000, 2000, 4000];
  let i = 0;
  for (let k = 0; k < steps.length; k++) if (lifetime >= steps[k]!) i = k;
  return i;
}

export const RANK_NAME = [
  { en: 'Recluta', es: 'Recluta' },
  { en: 'Vecina', es: 'Vecina' },
  { en: 'Comadre', es: 'Comadre' },
  { en: 'Doña', es: 'Doña' },
  { en: 'Leyenda', es: 'Leyenda' },
  { en: 'La Ley', es: 'La Ley' },
] as const;
