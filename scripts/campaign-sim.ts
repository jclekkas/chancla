// Plays campaign missions headlessly with the helper bot and reports
// completion and timings per seed. Used to calibrate time targets.
//
//   node --import tsx scripts/campaign-sim.ts [mission|all] [seeds=5] [--verbose]
import { MissionSim, DT_MS } from '../shared/campaign/mission';
import { MissionBot } from '../shared/campaign/bot';
import { MISSIONS } from '../shared/campaign/missions';

const which = process.argv[2] || 'all';
const seeds = Number(process.argv[3] || 5);
const verbose = process.argv.includes('--verbose');
const LIMIT_MS = 12 * 60 * 1000;

export function play(id: string, seed: number, log = false) {
  const def = MISSIONS.find((m) => m.id === id)!;
  const sim = new MissionSim(def, seed);
  const bot = new MissionBot({ seed: seed * 31 + 7 });
  const stages: string[] = [];
  let lastHint = '';
  while (!sim.state.complete && sim.state.timeMs < LIMIT_MS) {
    sim.step(bot.think(sim));
    for (const e of sim.drainEvents()) {
      if (e.k === 'stage') stages.push(`${e.id}@${(sim.state.timeMs / 1000).toFixed(1)}`);
      if (log && ['collect', 'goal', 'hit', 'reject', 'ko', 'scatter', 'setback', 'phase', 'spill', 'knocked', 'deliver', 'carry'].includes(e.k)) console.log((sim.state.timeMs / 1000).toFixed(1), JSON.stringify(e));
    }
    if (log && bot.hint && bot.hint.id !== lastHint) { lastHint = bot.hint.id; console.log((sim.state.timeMs / 1000).toFixed(1), 'hint', bot.hint.kind, bot.hint.id, sim.state.player.x.toFixed(1), sim.state.player.y.toFixed(1), sim.state.player.z.toFixed(1)); }
  }
  void DT_MS;
  return { sim, done: sim.state.complete, timeMs: sim.state.timeMs, stages, result: sim.result() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const def of MISSIONS) {
    if (which !== 'all' && which !== def.id) continue;
    const times: number[] = [];
    for (let s = 1; s <= seeds; s++) {
      const r = play(def.id, s, verbose && s === 1);
      times.push(r.done ? r.timeMs : Infinity);
      console.log(def.id, 'seed', s, r.done ? 'DONE' : 'STUCK', (r.timeMs / 1000).toFixed(1) + 's', 'kos', r.result.kos, 'acc', r.result.accuracy.toFixed(2), 'skill', r.result.challenges.skill, r.stages.join(' '));
      if (!r.done) {
        const st = r.sim.state;
        console.log('  stuck at stage', r.sim.stageDef.id, 'goals', JSON.stringify(st.goals), 'player', st.player.x.toFixed(1), st.player.y.toFixed(1), st.player.z.toFixed(1));
      }
    }
    const ok = times.filter(Number.isFinite).sort((a, b) => a - b);
    if (ok.length) console.log(def.id, `completed ${ok.length}/${seeds}; median ${(ok[Math.floor(ok.length / 2)]! / 1000).toFixed(1)} s; worst ${(ok[ok.length - 1]! / 1000).toFixed(1)} s`);
  }
}
