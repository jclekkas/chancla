// La Piñata Contraataca: a three-phase encounter, built on the mission sim.
//
//   Phase 1  Find the rhythm. The piñata swings like a pendulum. Three of its
//            five glowing points must break (two hits each). Lead the throw.
//   Phase 2  Party malfunction. Shield panels orbit it, decoy mini-piñatas
//            fly around and lob confetti at Rosa. Pop both decoy waves and
//            break the last two points through the gaps.
//   Phase 3  The final opening. It stops swinging; every few seconds a drum
//            roll warns that the core opens. Three hits on the open core end
//            it. A ricochet finish is optional (a challenge, never required).
//
// Every attack is telegraphed: candy bombs mark a circle on the ground
// before they burst; decoys spin up before they throw.

import { segmentSphere } from '../collision';
import type { World } from '../physics';
import type { PinataSpec, V3 } from './types';
import type { MEvent, ProjS, Stats } from './mission';

export const PINATA = {
  swingAmp: 0.62, swingPeriodMs: 4200, spinRadPerSec: 0.45,
  tipRadius: 1.55, tipHit: 0.6, tipHp: 2, phase1Tips: 3,
  bodyRadius: 1.0,
  panelRing: 2.1, panelRadius: 0.85, panelSpin: 0.95,
  decoysPerWave: 3, decoyWaves: 2, decoyRadius: 0.55, decoyThrowMs: 3600, decoyWindupMs: 700, confettiSpeed: 15,
  coreRadius: 0.75, coreHp: 3, coreCycleMs: 5600, coreOpenMs: 2700, coreWarnMs: 1300,
  bombEveryMs: [5200, 6000, 4600] as const, bombWarnMs: 1300, bombRadius: 2.1, bombDmg: 14,
};

export interface DecoyS { alive: boolean; a: number; r: number; y: number; nextThrowMs: number; windup: boolean }

export interface PinataState {
  phase: 1 | 2 | 3;
  defeated: boolean;
  t: number;
  x: number; y: number; z: number; // body centre
  spin: number;
  tips: Array<{ hp: number }>;
  decoys: DecoyS[];
  wave: number;
  coreHp: number;
  coreT: number; // ms into the current open/close cycle
  nextBombMs: number;
  panelAngle: number;
  swingT: number;
  hitFlashMs: number;
}

export interface PinataCtx {
  timeMs: number;
  rng(): number;
  player: { x: number; y: number; z: number; alive: boolean };
  emit(e: MEvent): void;
  hazard(x: number, z: number, warnMs: number, r: number, dmg: number): void;
  shoot(o: V3, v: V3): void;
  stats: Stats;
  world: World;
}

export class PinataSim {
  constructor(readonly spec: PinataSpec) {}

  initial(): PinataState {
    const [x, y, z] = this.spec.at;
    return {
      phase: 1, defeated: false, t: 0, x, y: y - this.spec.rope, z, spin: 0,
      tips: Array.from({ length: 5 }, () => ({ hp: PINATA.tipHp })),
      decoys: [], wave: 0, coreHp: PINATA.coreHp, coreT: 0, nextBombMs: 4000, panelAngle: 0, swingT: 0, hitFlashMs: 0,
    };
  }

  // World positions of the five points (in the star's plane).
  tipPos(s: PinataState, i: number): V3 {
    const a = s.spin;
    const ang = (i / 5) * Math.PI * 2 + Math.PI / 2;
    const u = Math.cos(ang) * PINATA.tipRadius, v = Math.sin(ang) * PINATA.tipRadius;
    // Plane spanned by (cos spin, 0, -sin spin) and (0, 1, 0).
    return [s.x + u * Math.cos(a), s.y + v, s.z - u * Math.sin(a)];
  }

  panelPos(s: PinataState, i: number): V3 {
    const a = s.panelAngle + (i / 4) * Math.PI * 2;
    return [s.x + Math.cos(a) * PINATA.panelRing, s.y, s.z + Math.sin(a) * PINATA.panelRing];
  }

  decoyPos(s: PinataState, d: DecoyS): V3 {
    return [this.spec.at[0] + Math.cos(d.a) * d.r, d.y + Math.sin(s.t / 500 + d.a * 3) * 0.4, this.spec.at[2] + Math.sin(d.a) * d.r];
  }

  coreOpen(s: PinataState): boolean {
    return s.phase === 3 && s.coreT >= PINATA.coreWarnMs && s.coreT < PINATA.coreWarnMs + PINATA.coreOpenMs;
  }

  tipsBroken(s: PinataState): number { return s.tips.filter((t) => t.hp <= 0).length; }

  step(s: PinataState, c: PinataCtx): void {
    if (s.defeated) return;
    const dt = 1000 / 60;
    s.t += dt;
    if (s.hitFlashMs > 0) s.hitFlashMs -= dt;
    const [px, py, pz] = this.spec.at;
    // Swing: wide in phase 1, narrower in 2, still in 3.
    const amp = s.phase === 1 ? PINATA.swingAmp : s.phase === 2 ? PINATA.swingAmp * 0.55 : 0;
    s.swingT += dt;
    const th = amp * Math.sin((s.swingT / PINATA.swingPeriodMs) * Math.PI * 2);
    s.x = px + Math.sin(th) * this.spec.rope;
    s.y = py - Math.cos(th) * this.spec.rope;
    s.z = pz;
    if (s.phase < 3) s.spin += (PINATA.spinRadPerSec * dt) / 1000;
    else {
      // Phase 3: turn to face Rosa so the core opening is readable.
      const want = Math.atan2(-(c.player.z - s.z), c.player.x - s.x) + Math.PI / 2;
      let d = want - s.spin;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      s.spin += d * Math.min(1, dt / 400);
    }
    if (s.phase === 2) s.panelAngle += (PINATA.panelSpin * dt) / 1000;

    // Candy bombs: a marked circle where Rosa is standing, then a burst.
    s.nextBombMs -= dt;
    if (s.nextBombMs <= 0 && c.player.alive) {
      s.nextBombMs = PINATA.bombEveryMs[s.phase - 1]!;
      c.hazard(c.player.x, c.player.z, PINATA.bombWarnMs, PINATA.bombRadius, PINATA.bombDmg);
      if (s.phase === 3) {
        const a = c.rng() * Math.PI * 2;
        c.hazard(c.player.x + Math.cos(a) * 4, c.player.z + Math.sin(a) * 4, PINATA.bombWarnMs + 300, PINATA.bombRadius, PINATA.bombDmg);
      }
    }

    // Decoys orbit and throw confetti after a visible wind-up.
    for (const d of s.decoys) {
      if (!d.alive) continue;
      d.a += (dt / 1000) * 0.32;
      d.nextThrowMs -= dt;
      if (!d.windup && d.nextThrowMs < PINATA.decoyWindupMs) { d.windup = true; c.emit({ k: 'telegraph', hz: -1, kind: 'circle', ms: PINATA.decoyWindupMs, src: 'decoy' }); }
      if (d.nextThrowMs <= 0) {
        d.windup = false;
        d.nextThrowMs = PINATA.decoyThrowMs + c.rng() * 900;
        if (c.player.alive) {
          const o = this.decoyPos(s, d);
          const tx = c.player.x, ty = c.player.y + 1.1, tz = c.player.z;
          const dx = tx - o[0], dy = ty - o[1], dz = tz - o[2];
          const dist = Math.hypot(dx, dy, dz) || 1;
          const sp = PINATA.confettiSpeed;
          const tf = dist / sp;
          c.shoot(o, [(dx / dist) * sp, (dy / dist) * sp + 0.5 * 5 * tf, (dz / dist) * sp]);
        }
      }
    }
    if (s.phase === 2 && s.decoys.length > 0 && s.decoys.every((d) => !d.alive) && s.wave < PINATA.decoyWaves) this.spawnWave(s, c);
    if (s.phase === 2 && s.wave >= PINATA.decoyWaves && s.decoys.every((d) => !d.alive) && this.tipsBroken(s) >= 5) this.toPhase(s, 3, c);

    if (s.phase === 3) {
      const before = s.coreT;
      s.coreT = (s.coreT + dt) % PINATA.coreCycleMs;
      if (before > s.coreT) { /* new cycle */ }
      if (before < 1 && s.coreT >= 1) c.emit({ k: 'telegraph', hz: -2, kind: 'circle', ms: PINATA.coreWarnMs, src: 'core' });
    }
  }

  private spawnWave(s: PinataState, c: PinataCtx): void {
    s.wave++;
    s.decoys = Array.from({ length: PINATA.decoysPerWave }, (_, i) => ({
      alive: true, a: (i / PINATA.decoysPerWave) * Math.PI * 2 + s.wave, r: 6.5 + (i % 2) * 1.5, y: 2.6 + (i % 3) * 0.6,
      nextThrowMs: 1800 + i * 900, windup: false,
    }));
    c.emit({ k: 'say', line: s.wave === 1 ? 'pinata_decoys' : 'pinata_decoys2' });
  }

  private toPhase(s: PinataState, n: 2 | 3, c: PinataCtx): void {
    s.phase = n;
    s.nextBombMs = 3500;
    if (n === 2) this.spawnWave(s, c);
    if (n === 3) { s.coreT = 0; s.decoys = []; }
    c.emit({ k: 'phase', n });
  }

  // Earliest part a chancla segment touches.
  test(s: PinataState, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, r: number): { t: number; part: string } | null {
    if (s.defeated) return null;
    let best: { t: number; part: string } | null = null;
    const consider = (p: V3, rad: number, part: string) => {
      const t = segmentSphere(a, b, r, { x: p[0], y: p[1], z: p[2] }, rad);
      if (t >= 0 && (!best || t < best.t)) best = { t, part };
    };
    for (const [i, d] of s.decoys.entries()) if (d.alive) consider(this.decoyPos(s, d), PINATA.decoyRadius + 0.15, `decoy:${i}`);
    if (s.phase === 2) for (let i = 0; i < 4; i++) consider(this.panelPos(s, i), PINATA.panelRadius, 'panel');
    s.tips.forEach((tp, i) => { if (tp.hp > 0) consider(this.tipPos(s, i), PINATA.tipHit, `tip:${i}`); });
    if (s.phase === 3) consider([s.x, s.y, s.z], PINATA.coreRadius + 0.2, 'core');
    else consider([s.x, s.y, s.z], PINATA.bodyRadius, 'body');
    return best;
  }

  hit(s: PinataState, part: string, pr: ProjS, c: PinataCtx): boolean {
    const p: V3 = [pr.x, pr.y, pr.z];
    const ok = () => { c.stats.hits++; if (pr.bounces > 0) c.stats.banks++; s.hitFlashMs = 150; c.emit({ k: 'hit', what: 'pinata', id: 'pinata', part, bank: pr.bounces > 0, heavy: pr.weapon === 1, p }); };
    if (part.startsWith('decoy:')) {
      const d = s.decoys[Number(part.slice(6))];
      if (d && d.alive) { d.alive = false; ok(); }
      return true;
    }
    if (part === 'panel' || part === 'body') { c.emit({ k: 'reject', id: 'pinata', why: 'armor' }); return true; }
    if (part.startsWith('tip:')) {
      const tp = s.tips[Number(part.slice(4))]!;
      if (tp.hp <= 0) return true;
      tp.hp -= pr.weapon === 1 ? 2 : 1;
      ok();
      if (tp.hp <= 0) c.emit({ k: 'say', line: 'pinata_tip' });
      if (s.phase === 1 && this.tipsBroken(s) >= PINATA.phase1Tips) this.toPhase(s, 2, c);
      return true;
    }
    if (part === 'core') {
      if (!this.coreOpen(s)) { c.emit({ k: 'reject', id: 'pinata', why: 'armor' }); return true; }
      s.coreHp -= 1;
      ok();
      if (s.coreHp <= 0) {
        s.defeated = true;
        c.stats.finishRicochet = pr.bounces > 0;
        c.emit({ k: 'phase', n: 4 });
      }
      return true;
    }
    return false;
  }
}
