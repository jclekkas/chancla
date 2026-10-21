import type { EnemyKind } from './enemies';
import type { SpawnPoint } from '../world/arena';
import type { Rng } from '../core/rng';
import { ARENA } from '../config';

export interface WaveDef {
  spawns: EnemyKind[];
  maxActive: number;
  interval: [number, number];
  telegraphScale: number;
}

// Wave 1 teaches the cone telegraph with slow Bocinas, two at a time.
// Wave 2 adds fast Influencers whose poses open attack windows.
// Wave 3 mixes in Sopladores that push you around, rewarding movement.
export const WAVES: WaveDef[] = [
  { spawns: ['bocinas', 'bocinas', 'bocinas', 'bocinas', 'bocinas', 'bocinas'], maxActive: 2, interval: [2.4, 3.2], telegraphScale: 1.3 },
  {
    spawns: ['influencer', 'bocinas', 'influencer', 'influencer', 'bocinas', 'influencer', 'bocinas', 'influencer', 'influencer'],
    maxActive: 3, interval: [1.8, 2.5], telegraphScale: 1.12,
  },
  {
    spawns: ['soplador', 'influencer', 'bocinas', 'soplador', 'influencer', 'bocinas', 'soplador', 'influencer', 'bocinas', 'soplador', 'influencer', 'bocinas'],
    maxActive: 4, interval: [1.5, 2.2], telegraphScale: 1.0,
  },
];

export type DirectorPhase = 'idle' | 'intro' | 'spawning' | 'clear' | 'done';

// Feeds a wave's spawn list into the arena with a cap on simultaneous
// enemies and a randomised gap between spawns.
export class WaveDirector {
  phase: DirectorPhase = 'idle';
  index = -1;
  t = 0;
  private cursor = 0;
  private nextSpawn = 0;
  private lastSpawnIdx = -1;

  reset(): void {
    this.phase = 'idle';
    this.index = -1;
    this.t = 0;
    this.cursor = 0;
    this.nextSpawn = 0;
    this.lastSpawnIdx = -1;
  }

  get def(): WaveDef | null {
    return WAVES[this.index] ?? null;
  }

  get remainingToSpawn(): number {
    const d = this.def;
    return d ? d.spawns.length - this.cursor : 0;
  }

  begin(index: number): void {
    this.index = index;
    this.phase = 'intro';
    this.t = 0;
    this.cursor = 0;
    this.nextSpawn = 0.6;
  }

  // Returns the kind to spawn this step, or null.
  step(dt: number, alive: number, rng: Rng): EnemyKind | null {
    this.t += dt;
    const d = this.def;
    if (!d) return null;
    if (this.phase === 'intro') {
      if (this.t >= 2.4) {
        this.phase = 'spawning';
        this.t = 0;
      }
      return null;
    }
    if (this.phase === 'spawning') {
      if (this.cursor >= d.spawns.length) {
        if (alive === 0) {
          this.phase = 'clear';
          this.t = 0;
        }
        return null;
      }
      this.nextSpawn -= dt;
      if (this.nextSpawn <= 0 && alive < d.maxActive) {
        this.nextSpawn = rng.range(d.interval[0], d.interval[1]);
        return d.spawns[this.cursor++]!;
      }
      return null;
    }
    if (this.phase === 'clear' && this.t >= 3.2) {
      this.phase = 'done';
    }
    return null;
  }

  // Chooses a spawn point away from the player, avoiding immediate repeats.
  pickSpawn(spawns: readonly SpawnPoint[], px: number, pz: number, rng: Rng): SpawnPoint {
    const valid: number[] = [];
    let farIdx = 0, farD = -1;
    for (let i = 0; i < spawns.length; i++) {
      const s = spawns[i]!;
      const d = Math.min(Math.hypot(s.x - px, s.z - pz), Math.hypot(s.entryX - px, s.entryZ - pz));
      if (d > farD) { farD = d; farIdx = i; }
      if (d >= ARENA.spawnMinDist && i !== this.lastSpawnIdx) valid.push(i);
    }
    const idx = valid.length > 0 ? rng.pick(valid) : farIdx;
    this.lastSpawnIdx = idx;
    return spawns[idx]!;
  }
}
