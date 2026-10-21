// "What should I do next?" for the current stage, derived from mission
// state. The HUD uses it for objective markers and optional hints; the
// helper bot uses exactly the same list to play missions in tests. If the
// bot can finish a mission from these hints, so can a player who follows
// the markers.

import type { ActorSpec, GoalSpec, PickupSpec, TargetSpec, V3 } from './types';
import type { MissionSim } from './mission';
import { PINATA } from './pinata';

export interface MHint {
  kind: 'pickup' | 'shoot' | 'go' | 'stay' | 'wait';
  id: string;
  pos: V3;
  stand?: V3; // recommended position (bank shots, high targets)
  aim?: V3; // where to aim from `stand`
  plane?: { axis: 'x' | 'z'; at: number };
  vel?: [number, number, number]; // moving target velocity, for leading
  need?: 'bank' | 'heavy';
  goal: string;
  open?: boolean; // timed targets: currently open
}

export function missionHints(sim: MissionSim): MHint[] {
  const st = sim.state;
  if (st.complete) return [];
  const out: MHint[] = [];
  const sd = sim.stageDef;
  const inStage = (e: { stages?: string[] }) => !e.stages || e.stages.includes(sd.id);
  sd.goals.forEach((g, i) => {
    const gs = st.goals[i]!;
    if (gs.done) return;
    switch (g.kind) {
      case 'collect': collectHints(sim, g.item, g.id, out, inStage); break;
      case 'flags': flagHints(sim, g, out, inStage); break;
      case 'reach': {
        const z = sim.spec(g.zone) as { at: V3 } | undefined;
        if (z) out.push({ kind: 'go', id: g.zone, pos: z.at, goal: g.id });
        break;
      }
      case 'deliver': {
        const p = st.player;
        const carried = p.carrying ? st.pickups.find((x) => x.id === p.carrying) : undefined;
        if (carried && carried.item === g.item) {
          // Threats first: a thief closing in.
          for (const a of st.actors) {
            const s = sim.spec<ActorSpec>(a.id)!;
            if (s.behavior.type === 'thief' && a.enabled && a.mode === 'chase' && Math.hypot(a.x - p.x, a.z - p.z) < 9) {
              out.push({ kind: 'shoot', id: a.id, pos: [a.x, a.y + 0.4, a.z], vel: [a.vx, 0, a.vz], goal: g.id });
            }
          }
          const z = sim.spec(g.zone) as { at: V3 } | undefined;
          if (z) out.push({ kind: 'go', id: g.zone, pos: z.at, goal: g.id });
        } else {
          collectHints(sim, g.item, g.id, out, inStage, true);
        }
        break;
      }
      case 'defend': defendHints(sim, g, out); break;
      case 'boss': bossHints(sim, g.id, out); break;
    }
  });
  return out;
}

function collectHints(sim: MissionSim, item: string, goal: string, out: MHint[], inStage: (e: { stages?: string[] }) => boolean, carryOk = false): void {
  const st = sim.state;
  for (const pk of st.pickups) {
    if (pk.item !== item) continue;
    const spec = sim.spec<PickupSpec>(pk.id)!;
    if (!inStage(spec)) continue;
    if (!carryOk && spec.carry) continue;
    if (pk.state === 'free' || pk.state === 'falling') { out.push({ kind: 'pickup', id: pk.id, pos: [pk.x, pk.y, pk.z], goal }); continue; }
    if (pk.state === 'hidden') {
      // The target that releases it.
      for (const t of st.targets) {
        const ts = sim.spec<TargetSpec>(t.id)!;
        if (!t.enabled || t.done || !inStage(ts)) continue;
        if (ts.on.some((a) => (a.do === 'drop' || a.do === 'reveal') && a.id === pk.id)) out.push(targetHint(sim, ts, goal));
      }
    }
    if (pk.state === 'held') {
      for (const a of st.actors) {
        if (a.holds !== pk.id || !a.enabled || a.done) continue;
        const as = sim.spec<ActorSpec>(a.id)!;
        if (!inStage(as)) continue;
        // Posers only drop it mid-pose; a spinning cart shrugs hits off.
        const posing = as.behavior.type === 'poser' ? a.mode === 'pose' : a.mode !== 'spin';
        out.push({ kind: posing ? 'shoot' : 'wait', id: a.id, pos: [a.x, a.y + (as.archetype === 'cart' ? 0.45 : 1.2), a.z], vel: [a.vx, 0, a.vz], goal });
      }
    }
  }
}

function targetHint(sim: MissionSim, ts: TargetSpec, goal: string): MHint {
  const t = sim.state.targets.find((x) => x.id === ts.id)!;
  return { kind: 'shoot', id: ts.id, pos: ts.at, stand: ts.hint?.stand, aim: ts.hint?.aim, plane: ts.hint?.plane, need: ts.need, goal, open: sim.targetOpen(t, ts) };
}

function flagHints(sim: MissionSim, g: Extract<GoalSpec, { kind: 'flags' }>, out: MHint[], inStage: (e: { stages?: string[] }) => boolean): void {
  const st = sim.state;
  for (const f of g.flags) {
    if (st.flags.includes(f)) continue;
    for (const t of st.targets) {
      const ts = sim.spec<TargetSpec>(t.id)!;
      if (!t.enabled || t.done || !inStage(ts)) continue;
      if (ts.on.some((a) => a.do === 'flag' && a.flag === f)) out.push(targetHint(sim, ts, g.id));
    }
    for (const a of st.actors) {
      if (`${a.id}_off` !== f || !a.enabled || a.done) continue;
      const as = sim.spec<ActorSpec>(a.id)!;
      if (as.behavior.type === 'blower') {
        const vulnerable = a.mode === 'vent' || a.mode === 'windup';
        out.push({ kind: vulnerable ? 'shoot' : 'wait', id: a.id, pos: [a.x, a.y + 1.2, a.z], vel: [a.vx, 0, a.vz], goal: g.id });
      }
    }
    // Carry-and-store props flagged on delivery.
    for (const pk of st.pickups) {
      const ps = sim.spec<PickupSpec>(pk.id)!;
      if (!ps.carry || !inStage(ps) || `${pk.id}_stored` !== f) continue;
      if (pk.state === 'carried') {
        const zone = sim.def.entities.find((e) => e.kind === 'zone' && e.id === `${pk.id}_zone`) as { at: V3 } | undefined;
        if (zone) out.push({ kind: 'go', id: `${pk.id}_zone`, pos: zone.at, goal: g.id });
      } else if (pk.state === 'free' && !st.player.carrying) out.push({ kind: 'pickup', id: pk.id, pos: [pk.x, pk.y, pk.z], goal: g.id });
    }
  }
}

function defendHints(sim: MissionSim, g: Extract<GoalSpec, { kind: 'defend' }>, out: MHint[]): void {
  const st = sim.state;
  for (const a of st.actors) {
    if (!a.enabled || a.done) continue;
    const as = sim.spec<ActorSpec>(a.id)!;
    const b = as.behavior;
    if ((b.type === 'filmer' && (a.mode === 'film' || a.mode === 'walkin')) || (b.type === 'shaker' && (a.mode === 'roll' || a.mode === 'warn'))) {
      out.push({ kind: 'shoot', id: a.id, pos: [a.x, a.y + 1.2, a.z], vel: [a.vx, 0, a.vz], goal: g.id });
    }
  }
  for (const pk of st.pickups) if (pk.item === 'ingredient' && (pk.state === 'free' || pk.state === 'falling')) out.push({ kind: 'pickup', id: pk.id, pos: [pk.x, pk.y, pk.z], goal: g.id });
  if (g.malfunction) {
    const t = st.targets.find((x) => x.id === g.malfunction!.target);
    if (t && t.enabled && !t.done) out.push(targetHint(sim, sim.spec<TargetSpec>(t.id)!, g.id));
  }
  const z = sim.spec(g.zone) as { at: V3 } | undefined;
  if (z) out.push({ kind: 'stay', id: g.zone, pos: z.at, goal: g.id });
}

function bossHints(sim: MissionSim, goal: string, out: MHint[]): void {
  const s = sim.state.pinata;
  const pin = sim.pinata;
  if (!s || !pin || s.defeated) return;
  const vel: [number, number, number] = [s.phase === 1 ? Math.cos((s.swingT / PINATA.swingPeriodMs) * Math.PI * 2) * PINATA.swingAmp * pin.spec.rope * (Math.PI * 2 / (PINATA.swingPeriodMs / 1000)) : 0, 0, 0];
  s.decoys.forEach((d, i) => { if (d.alive) out.push({ kind: 'shoot', id: `decoy:${i}`, pos: pin.decoyPos(s, d), goal }); });
  if (s.phase < 3) {
    s.tips.forEach((t, i) => { if (t.hp > 0 && i === s.lit) out.push({ kind: 'shoot', id: `tip:${i}`, pos: pin.tipPos(s, i), vel, goal }); });
    // Tantrum (or between points): keep moving and wait for the next glow.
    if (s.lit < 0 || s.tantrumMs > 0) out.push({ kind: 'wait', id: 'pinata', pos: [s.x, s.y, s.z], goal });
  } else {
    out.push({ kind: pin.coreOpen(s) ? 'shoot' : 'wait', id: 'core', pos: [s.x, s.y, s.z], goal, open: pin.coreOpen(s) });
  }
}

/** Where to aim on a bank panel so a chancla from `eye` reflects onto `target`. */
export function bankAim(eye: V3, target: V3, plane: { axis: 'x' | 'z'; at: number }, radius = 0.12): V3 | null {
  const i = plane.axis === 'x' ? 0 : 2;
  // The chancla's centre turns at the face minus its radius, on the eye's side.
  const side = Math.sign(eye[i] - plane.at) || 1;
  const turn = plane.at + side * radius;
  const mirrored: V3 = [...target];
  mirrored[i] = 2 * turn - target[i];
  const k = (turn - eye[i]) / (mirrored[i] - eye[i]);
  if (!(k > 0 && k < 1)) return null;
  return [eye[0] + (mirrored[0] - eye[0]) * k, eye[1] + (mirrored[1] - eye[1]) * k, eye[2] + (mirrored[2] - eye[2]) * k];
}
