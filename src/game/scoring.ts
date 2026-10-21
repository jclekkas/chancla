import { SCORE } from '../config';

// Pure scoring rules: base hit points, skill bonuses, a combo multiplier that
// grows with chained hits, and an accuracy streak for consecutive throws
// that connect. Nothing here touches rendering, so it is easy to test.

export interface HitInfo {
  ricochet: boolean;
  charged: boolean;
  interrupt: boolean;
  posing: boolean;
  legendary: boolean;
  boss: boolean;
  kill: boolean;
}

export type BonusLabel = 'ricochet' | 'charged' | 'interrupt' | 'posing' | 'streak' | 'kill';

export interface HitResult {
  points: number;
  multiplier: number;
  bonuses: BonusLabel[];
}

export interface RunStats {
  score: number;
  throws: number;
  connectedThrows: number;
  hits: number;
  kills: number;
  ricochetHits: number;
  bestCombo: number;
  damageTaken: number;
}

export class Scoring {
  score = 0;
  combo = 0;
  comboTimer = 0;
  bestCombo = 0;
  streak = 0;
  throws = 0;
  connectedThrows = 0;
  hits = 0;
  kills = 0;
  ricochetHits = 0;
  damageTaken = 0;

  reset(): void {
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.bestCombo = 0;
    this.streak = 0;
    this.throws = 0;
    this.connectedThrows = 0;
    this.hits = 0;
    this.kills = 0;
    this.ricochetHits = 0;
    this.damageTaken = 0;
  }

  get multiplier(): number {
    return Math.min(SCORE.maxMultiplier, 1 + Math.floor(this.combo / SCORE.comboPerLevel));
  }

  get accuracy(): number {
    return this.throws > 0 ? this.connectedThrows / this.throws : 0;
  }

  update(dt: number): void {
    if (this.combo > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 0;
        this.comboTimer = 0;
      }
    }
  }

  registerThrow(): void {
    this.throws++;
  }

  // Called once per throw when its flight ends. A throw that connected with
  // at least one target extends the accuracy streak; a miss resets it.
  resolveThrow(connected: boolean): void {
    if (connected) {
      this.connectedThrows++;
    } else {
      this.streak = 0;
    }
  }

  // The first hit of a throw advances the streak.
  noteThrowConnected(): void {
    this.streak++;
  }

  hit(info: HitInfo): HitResult {
    this.hits++;
    this.combo++;
    this.comboTimer = SCORE.comboWindow;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    const bonuses: BonusLabel[] = [];
    let pts = info.boss ? SCORE.bossHit : SCORE.hit;
    if (info.charged) { pts += SCORE.charged; bonuses.push('charged'); }
    if (info.ricochet) { pts += SCORE.ricochet; bonuses.push('ricochet'); this.ricochetHits++; }
    if (info.interrupt) { pts += SCORE.interrupt; bonuses.push('interrupt'); }
    if (info.posing) { pts += SCORE.posing; bonuses.push('posing'); }
    if (this.streak >= SCORE.streakMin) { pts += SCORE.streakStep * this.streak; bonuses.push('streak'); }
    if (info.kill) {
      this.kills++;
      pts += info.boss ? SCORE.bossKill : SCORE.kill;
      bonuses.push('kill');
    }
    const multiplier = this.multiplier;
    const points = pts * multiplier;
    this.score += points;
    return { points, multiplier, bonuses };
  }

  addFlat(points: number): void {
    this.score += Math.round(points);
  }

  playerHurt(amount: number): void {
    this.damageTaken += amount;
    this.combo = 0;
    this.comboTimer = 0;
  }

  stats(): RunStats {
    return {
      score: this.score,
      throws: this.throws,
      connectedThrows: this.connectedThrows,
      hits: this.hits,
      kills: this.kills,
      ricochetHits: this.ricochetHits,
      bestCombo: this.bestCombo,
      damageTaken: this.damageTaken,
    };
  }
}
