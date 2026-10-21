// Finds standing spots from which a bank shot actually works, by simulating
// real throws in the mission sim (same physics, same ricochet). Used to place
// `hint.stand` for bank-only targets, and to prove those shots are possible.
//
//   node --import tsx scripts/bank-solver.ts <mission> <targetId> x0 x1 z0 z1 [step=0.5]
import { MissionSim } from '../shared/campaign/mission';
import { bankAim } from '../shared/campaign/hints';
import { missionById } from '../shared/campaign/missions';
import { eyeHeight, settle } from '../shared/physics';
import type { TargetSpec, V3 } from '../shared/campaign/types';

export function tryBank(mission: string, targetId: string, x: number, z: number, stage?: number): boolean {
  const def = missionById(mission)!;
  const sim = new MissionSim(def, 1);
  if (stage !== undefined) while (sim.state.stage < stage) (sim as unknown as { enterStage(i: number): void }).enterStage(sim.state.stage + 1);
  const spec = sim.spec<TargetSpec>(targetId)!;
  const p = sim.state.player;
  p.x = x; p.z = z; p.y = 0; p.vx = p.vz = 0;
  settle(sim.world, p);
  const eye: V3 = [p.x, p.y + eyeHeight(p), p.z];
  const aim = bankAim(eye, spec.at, spec.hint!.plane!);
  if (!aim) return false;
  const dx = aim[0] - eye[0], dy = aim[1] - eye[1], dz = aim[2] - eye[2];
  const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
  sim.step({ mx: 0, mz: 0, yaw, pitch, fire: true, jump: false, crouch: false, weapon: 0 });
  for (let i = 0; i < 90; i++) {
    sim.step({ mx: 0, mz: 0, yaw, pitch, fire: false, jump: false, crouch: false, weapon: 0 });
    for (const e of sim.drainEvents()) if (e.k === 'hit' && e.id === targetId && e.bank) return true;
  }
  return false;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [mission, target, ...nums] = process.argv.slice(2);
  const [x0, x1, z0, z1, step = 0.5] = nums.map(Number);
  const ok: string[] = [];
  const stage = process.env.STAGE ? Number(process.env.STAGE) : undefined;
  for (let x = x0!; x <= x1!; x += step) for (let z = z0!; z <= z1!; z += step) if (tryBank(mission!, target!, x, z, stage)) ok.push(`${x.toFixed(1)},${z.toFixed(1)}`);
  console.log(`${ok.length} working spots:`, ok.join(' '));
}
