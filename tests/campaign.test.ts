// Campaign: missions, framework guarantees, challenges, progress, dialogue.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MissionSim, DT_MS, type MEvent } from '../shared/campaign/mission';
import { MissionBot } from '../shared/campaign/bot';
import { MISSIONS, missionById } from '../shared/campaign/missions';
import { bankAim, missionHints } from '../shared/campaign/hints';
import { PINATA } from '../shared/campaign/pinata';
import { eyeHeight, settle, World, newBody } from '../shared/physics';
import { buildNavGraph, findPath, nearestNode, walkReaches } from '../shared/navgraph';
import type { PickupSpec, TargetSpec, V3 } from '../shared/campaign/types';
import { SafeStorage } from '../src/persistence/storage';
import { CampaignProgress, CAMPAIGN_KEY } from '../src/campaign/progress';
import { STRINGS, hasKey } from '../src/fps/strings';
import { LINES, POOLS } from '../src/audio/lines';
import { Dialogue } from '../src/audio/dialogue';

const LIMIT = 10 * 60 * 1000;

function play(id: string, seed: number, opts: { aimErrorRad?: number } = {}) {
  const sim = new MissionSim(missionById(id)!, seed);
  const bot = new MissionBot({ seed: seed * 13 + 1, ...opts });
  const events: MEvent[] = [];
  while (!sim.state.complete && sim.state.timeMs < LIMIT) {
    sim.step(bot.think(sim));
    events.push(...sim.drainEvents());
  }
  return { sim, events };
}

class MemKV { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }

describe('campaign missions', () => {
  for (const def of MISSIONS) {
    it(`${def.id}: completes from a fresh start, with every objective completing exactly once`, () => {
      for (const seed of [1, 2]) {
        const { sim, events } = play(def.id, seed);
        expect(sim.state.complete, `${def.id} seed ${seed} at ${sim.stageDef.id}`).toBe(true);
        const goals = events.filter((e) => e.k === 'goal').map((e) => (e as { id: string }).id);
        expect(new Set(goals).size).toBe(goals.length);
        expect(goals.length).toBe(def.stages.reduce((n, s) => n + s.goals.length, 0));
        expect(events.filter((e) => e.k === 'complete')).toHaveLength(1);
        // The bot finishes well inside the time target it was calibrated from.
        expect(sim.state.completeMs).toBeLessThan(def.timeTargetMs);
      }
    }, 120000);
  }

  it('every mission definition is internally consistent', () => {
    for (const def of MISSIONS) {
      const ids = new Set(def.entities.map((e) => e.id));
      expect(ids.size, `${def.id} duplicate ids`).toBe(def.entities.length);
      const stageIds = new Set(def.stages.map((s) => s.id));
      for (const e of def.entities) for (const s of e.stages ?? []) expect(stageIds.has(s), `${def.id}.${e.id} stage ${s}`).toBe(true);
      for (const e of def.entities) if (e.kind === 'target') for (const a of e.on) if ('id' in a) expect(ids.has(a.id), `${def.id}.${e.id} -> ${a.id}`).toBe(true);
      expect(def.timeTargetMs).toBeGreaterThan(0);
      for (const k of [def.title, def.premise, def.objective, ...def.stages.map((s) => s.title), ...def.stages.flatMap((s) => s.goals.map((g) => g.label)), ...def.challenges.map((c) => c.label)]) {
        expect(hasKey(k), `${def.id}: missing string ${k}`).toBe(true);
      }
    }
  });
});

describe('mission framework guarantees', () => {
  it('a finished target does not fire its actions again (no double awards)', () => {
    const sim = new MissionSim(missionById('patio')!, 1);
    const t = sim.state.targets.find((x) => x.id === 'sw1')!;
    const spec = sim.spec<TargetSpec>('sw1')!;
    const hit = (sim as unknown as { hitTarget(t: unknown, s: unknown, pr: unknown, sp: boolean): boolean }).hitTarget.bind(sim);
    const pr = { x: 0, y: 0, z: 0, bounces: 0, weapon: 0 };
    hit(t, spec, pr, false);
    const flagsAfter = [...sim.state.flags];
    // A target that is done is no longer tested by projectiles at all, but
    // even a direct call must not add flags twice.
    hit(t, spec, pr, false);
    expect(sim.state.flags).toEqual(flagsAfter);
    expect(sim.state.flags.filter((f) => f === 'pile1_clear')).toHaveLength(1);
  });

  it('retrying from a checkpoint restores the stage exactly', () => {
    const def = missionById('ruleros')!;
    const sim = new MissionSim(def, 3);
    const bot = new MissionBot({ seed: 3 });
    while (sim.state.stage < 2 && sim.state.timeMs < LIMIT) { sim.step(bot.think(sim)); sim.drainEvents(); }
    const stage = sim.state.stage;
    const before = JSON.stringify({ pickups: sim.state.pickups, targets: sim.state.targets, flags: sim.state.flags, goals: sim.state.goals });
    for (let i = 0; i < 60 * 8; i++) { sim.step(bot.think(sim)); sim.drainEvents(); }
    sim.retryCheckpoint();
    expect(sim.state.stage).toBe(stage);
    expect(JSON.stringify({ pickups: sim.state.pickups, targets: sim.state.targets, flags: sim.state.flags, goals: sim.state.goals })).toBe(before);
    expect(sim.state.projs).toHaveLength(0);
    expect(sim.state.hazards).toHaveLength(0);
  });

  it('time only advances when the sim is stepped (pausing is not stepping)', () => {
    const sim = new MissionSim(missionById('cocina')!, 1);
    const t0 = sim.state.timeMs;
    for (let i = 0; i < 30; i++) sim.step({ mx: 0, mz: 0, yaw: 0, pitch: 0, fire: false, jump: false, crouch: false, weapon: 0 });
    expect(sim.state.timeMs - t0).toBeCloseTo(30 * DT_MS, 6);
  });

  it('spilled and dropped items always land on reachable ground', () => {
    // Spill the tray in every spot of a grid over the serving route, including
    // the covered corridor whose ceiling once trapped it on the roof.
    const def = missionById('cocina')!;
    const sim = new MissionSim(def, 1);
    const g = buildNavGraph({ ...sim.map, boxes: [...sim.world.boxes] as typeof sim.map.boxes }, sim.world);
    const home = nearestNode(g, sim.world, { x: 9.2, y: 2.7, z: 9.4 });
    for (const [x, z] of [[19, 2.75], [20.5, 1.8], [14, 0], [7.1, 3.9], [24, -1], [10.2, 6.5]]) {
      const settleItem = (sim as unknown as { state: { pickups: Array<{ x: number; y: number; z: number }> } });
      const b = newBody(x!, 0, z!);
      settle(sim.world, b);
      const pk = { x: x!, y: b.y, z: z! };
      // Use the same rule the sim uses: settle from the item's own height.
      const probe = newBody(pk.x, pk.y + 0.05, pk.z);
      settle(sim.world, probe);
      expect(probe.y, `${x},${z}`).toBeLessThan(1.5);
      const n = nearestNode(g, sim.world, probe);
      expect(findPath(g, home, n).length, `path to ${x},${z}`).toBeGreaterThan(0);
      void settleItem;
    }
  });

  it('every hint target is reachable from the stage respawn', () => {
    for (const def of MISSIONS) {
      const sim = new MissionSim(def, 1);
      const g = buildNavGraph({ ...sim.map, boxes: [...sim.world.boxes] as typeof sim.map.boxes }, sim.world);
      const start = nearestNode(g, sim.world, { x: def.start.at[0], y: def.start.at[1], z: def.start.at[2] });
      for (const e of def.entities) {
        const at: V3 | undefined = e.kind === 'target' ? e.hint?.stand : e.kind === 'pickup' ? (e.recoverAt ?? (e.hidden ? undefined : e.at)) : undefined;
        if (!at) continue;
        // Pickups may sit on furniture: check from the floor right next to them.
        const b = newBody(at[0], e.kind === 'pickup' ? Math.max(0, at[1] - 1.2) + 0.05 : at[1] + 0.05, at[2]);
        settle(sim.world, b);
        if (e.kind === 'pickup' && b.y > at[1] - 0.5 && at[1] > 0.5) { b.x += 0.9; b.y = 0.05; settle(sim.world, b); }
        // Any waypoint the spot can walk to directly, connected to the start.
        const near = g.nodes.map((nd, i) => ({ i, d: Math.hypot(nd.x - b.x, nd.z - b.z) + Math.abs(nd.y - b.y) * 3 })).filter((x) => x.d < 8).sort((x, y) => x.d - y.d);
        const ok = near.some(({ i }) => walkReaches(sim.world, b, g.nodes[i]!) && findPath(g, start, i).length > 0);
        expect(ok, `${def.id}.${e.id}`).toBe(true);
      }
    }
  });

  it('bank-only targets refuse direct hits and accept a ricochet off the marked panel', () => {
    const def = missionById('patio')!;
    const sim = new MissionSim(def, 1);
    const spec = sim.spec<TargetSpec>('deco1')!;
    const p = sim.state.player;
    let eye: V3 = [0, 0, 0];
    const standAt = (x: number, z: number) => { p.x = x; p.z = z; p.y = 0; settle(sim.world, p); eye = [p.x, p.y + eyeHeight(p), p.z]; };
    const shoot = (aim: V3) => {
      const dx = aim[0] - eye[0], dy = aim[1] - eye[1], dz = aim[2] - eye[2];
      const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
      sim.state.player.cooldownMs = 0;
      sim.step({ mx: 0, mz: 0, yaw, pitch, fire: true, jump: false, crouch: false, weapon: 0 });
      const ev: MEvent[] = [];
      for (let i = 0; i < 90; i++) { sim.step({ mx: 0, mz: 0, yaw, pitch, fire: false, jump: false, crouch: false, weapon: 0 }); ev.push(...sim.drainEvents()); }
      return ev;
    };
    standAt(14.5, -3.0); // clear line of sight, straight up at it
    const direct = shoot(spec.at);
    expect(direct.some((e) => e.k === 'reject' && e.why === 'bank')).toBe(true);
    expect(sim.state.flags).not.toContain('deco1_free');
    standAt(spec.hint!.stand[0], spec.hint!.stand[2]);
    const banked = shoot(bankAim(eye, spec.at, spec.hint!.plane!)!);
    expect(banked.some((e) => e.k === 'hit' && e.id === 'deco1' && e.bank)).toBe(true);
    expect(sim.state.flags).toContain('deco1_free');
  });

  it('heavy-only targets need La Pesada', () => {
    const sim = new MissionSim(missionById('ruleros')!, 1);
    while (sim.state.stage < 1) sim.step({ mx: 0, mz: 0, yaw: 0, pitch: 0, fire: false, jump: false, crouch: false, weapon: 0 }), (sim.state.pickups[0]!.state = 'collected');
    const t = sim.state.targets.find((x) => x.id === 'towerhit')!;
    const hit = (sim as unknown as { hitTarget(t: unknown, s: unknown, pr: unknown, sp: boolean): boolean }).hitTarget.bind(sim);
    expect(hit(t, sim.spec('towerhit'), { bounces: 0, weapon: 0, x: 0, y: 0, z: 0 }, false)).toBe(false);
    expect(hit(t, sim.spec('towerhit'), { bounces: 0, weapon: 1, x: 0, y: 0, z: 0 }, false)).toBe(true);
    expect(sim.state.blockers.find((b) => b.id === 'tower')!.present).toBe(false);
  });

  it('knocked-out Rosa comes back at the checkpoint with progress kept', () => {
    const sim = new MissionSim(missionById('ruleros')!, 1);
    sim.state.pickups[0]!.state = 'collected';
    sim.step({ mx: 0, mz: 0, yaw: 0, pitch: 0, fire: false, jump: false, crouch: false, weapon: 0 });
    sim.hurt(500, 0, 0);
    expect(sim.state.player.alive).toBe(false);
    for (let i = 0; i < 60 * 3; i++) sim.step({ mx: 0, mz: 0, yaw: 0, pitch: 0, fire: false, jump: false, crouch: false, weapon: 0 });
    expect(sim.state.player.alive).toBe(true);
    expect(sim.state.pickups[0]!.state).toBe('collected');
    expect(sim.state.stats.kos).toBe(1);
  });

  it('the campaign never touches multiplayer code or state', () => {
    const dir = path.resolve(__dirname, '../shared/campaign');
    const files = [...fs.readdirSync(dir).map((f) => path.join(dir, f)), ...fs.readdirSync(path.join(dir, 'missions')).map((f) => path.join(dir, 'missions', f))].filter((f) => f.endsWith('.ts'));
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/from '\.\.\/(room|hub|protocol)'|from '\.\.\/\.\.\/(room|hub|protocol)'/);
    }
    // The client runtime does not import the network session or server either.
    const rt = fs.readFileSync(path.resolve(__dirname, '../src/campaign/runtime.ts'), 'utf8');
    // Only a type import from the network session (for the shared projectile view), no server code.
    expect(rt).not.toMatch(/^import \{[^}]*\} from '\.\.\/net\/session'/m);
    expect(rt).toMatch(/^import type \{ ClientProjectile \} from '\.\.\/net\/session'/m);
    expect(rt).not.toMatch(/from '[./]*server\//);
  });
});

describe('challenges are achievable', () => {
  it('Mission 1: a sharp player stops the cart within the throw limit', () => {
    const lim = missionById('ruleros')!.challenges.find((c) => c.id === 'skill')!.limit!;
    const best = Math.min(...[1, 2, 3, 4].map((s) => play('ruleros', s, { aimErrorRad: 0.002 }).sim.state.stats.cartThrows));
    expect(best).toBeLessThanOrEqual(lim);
  }, 120000);

  it('Missions 2 and 3: the skill challenges are met by the helper bot', () => {
    expect(play('cocina', 1).sim.result().challenges.skill).toBe(true);
    expect(play('patio', 1).sim.result().challenges.skill).toBe(true);
  }, 120000);

  it('Mission 4: a ricochet off a party mirror can land the final hit', () => {
    const def = missionById('pinata')!;
    const sim = new MissionSim(def, 5);
    const s = sim.state.pinata!;
    // Skip to the last core hit, waiting for an opening.
    s.phase = 3; s.decoys = []; s.coreHp = 1; s.tips.forEach((t) => (t.hp = 0));
    const idle = { mx: 0, mz: 0, yaw: 0, pitch: 0, fire: false, jump: false, crouch: false, weapon: 0 as const };
    for (let i = 0; i < 400 && !sim.pinata!.coreOpen(s); i++) { sim.step(idle); sim.drainEvents(); }
    sim.state.hazards = [];
    // Stand between the piñata and the café mirror, facing the mirror.
    const p = sim.state.player;
    p.x = 0.5; p.z = -4.8; p.y = 0;
    settle(sim.world, p);
    p.invulnMs = 1e6;
    const eye: V3 = [p.x, p.y + eyeHeight(p), p.z];
    const aim = bankAim(eye, [s.x, s.y, s.z], { axis: 'z', at: -7.92 })!;
    const dx = aim[0] - eye[0], dy = aim[1] - eye[1], dz = aim[2] - eye[2];
    const inp = { ...idle, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), fire: true };
    sim.step(inp);
    for (let i = 0; i < 120 && !sim.state.complete; i++) sim.step({ ...inp, fire: false });
    expect(s.defeated).toBe(true);
    expect(sim.result().challenges.skill).toBe(true);
  });

  it('Mission 4 phases follow the documented order', () => {
    const { events } = play('pinata', 2);
    const phases = events.filter((e) => e.k === 'phase').map((e) => (e as { n: number }).n);
    expect(phases).toEqual([2, 3, 4]);
    expect(PINATA.phase1Tips).toBe(3);
  }, 120000);
});

describe('campaign progress', () => {
  it('unlocks sequentially, keeps bests, survives reloads and ignores corrupt data', () => {
    const kv = new MemKV();
    const st = new SafeStorage(kv);
    kv.setItem('chancla.mp.settings.v1', '{"lang":"es"}');
    const p = new CampaignProgress(st);
    expect(MISSIONS.map((m) => p.unlocked(m.id))).toEqual([true, false, false, false]);
    p.record('ruleros', { timeMs: 90000, kos: 0, throws: 10, hits: 5, accuracy: 0.5, challenges: { complete: true, time: true, skill: false } });
    expect(p.unlocked('cocina')).toBe(true);
    const slower = p.record('ruleros', { timeMs: 120000, kos: 1, throws: 10, hits: 5, accuracy: 0.5, challenges: { complete: true, time: false, skill: true } });
    expect(slower.newBest).toBe(false);
    expect(slower.newChallenges).toEqual(['skill']);
    expect(p.get('ruleros').bestMs).toBe(90000);
    expect(p.get('ruleros').challenges).toEqual({ complete: true, time: true, skill: true });
    const reloaded = new CampaignProgress(new SafeStorage(kv));
    expect(reloaded.get('ruleros').bestMs).toBe(90000);
    reloaded.reset();
    expect(kv.getItem(CAMPAIGN_KEY)).toBeNull();
    expect(kv.getItem('chancla.mp.settings.v1')).toBe('{"lang":"es"}'); // settings untouched
    kv.setItem(CAMPAIGN_KEY, '{"v":1,"missions":{"ruleros":{"completed":"yes","bestMs":-5}}}');
    const corrupt = new CampaignProgress(new SafeStorage(kv));
    expect(corrupt.get('ruleros').completed).toBe(false);
    expect(corrupt.get('ruleros').bestMs).toBeNull();
    kv.setItem(CAMPAIGN_KEY, 'not json');
    expect(new CampaignProgress(new SafeStorage(kv)).get('ruleros').completed).toBe(false);
  });

  it('works without storage for the session', () => {
    const p = new CampaignProgress(new SafeStorage(null));
    expect(p.persistent).toBe(false);
    p.record('ruleros', { timeMs: 1, kos: 0, throws: 0, hits: 0, accuracy: 0, challenges: { complete: true, time: false, skill: false } });
    expect(p.unlocked('cocina')).toBe(true);
  });
});

describe('dialogue', () => {
  const make = (banter = true) => {
    let t = 0;
    const subs: Array<string | null> = [];
    const d = new Dialogue(() => ({ banter, subtitles: 'auto', uiLang: () => 'en' }), (text) => subs.push(text), () => t, 7);
    return { d, subs, at: (ms: number) => { t = ms; d.update(); } };
  };

  it('has at least 24 distinct Rosa lines, opponent lines, and complete subtitles', () => {
    const rosa = LINES.filter((l) => l.who === 'rosa');
    expect(new Set(rosa.map((l) => l.es)).size).toBeGreaterThanOrEqual(24);
    expect(LINES.filter((l) => l.who !== 'rosa').length).toBeGreaterThanOrEqual(8);
    for (const l of LINES) { expect(l.es.trim(), l.id).not.toBe(''); expect(l.en.trim(), l.id).not.toBe(''); }
    expect(new Set(LINES.map((l) => l.id)).size).toBe(LINES.length);
    for (const ids of Object.values(POOLS)) for (const id of ids) expect(LINES.some((l) => l.id === id), id).toBe(true);
    // Every scripted cue a mission emits exists.
    for (const def of MISSIONS) for (const st of def.stages) for (const a of [...(st.onEnter ?? []), ...(st.onDone ?? [])]) if (a.do === 'say') expect(LINES.some((l) => l.id === a.line), a.line).toBe(true);
  });

  it('every line has a generated clip listed in the voice manifest', () => {
    const m = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../public/voice/manifest.json'), 'utf8'));
    expect(m.quality).toBe('placeholder-tts');
    for (const l of LINES) {
      const e = m.lines[l.id];
      expect(e, l.id).toBeTruthy();
      expect(fs.existsSync(path.resolve(__dirname, '../public/voice', e.file)), l.id).toBe(true);
      expect(e.ms).toBeGreaterThan(300);
    }
  });

  it('never overlaps, lets higher priority cut in, and queues at most one story line', () => {
    const { d, at } = make();
    expect(d.say('miss1')).toBe(true);
    expect(d.say('elim1')).toBe(false); // same priority banter: dropped
    expect(d.say('m1_start')).toBe(true); // story, higher priority: cuts in
    expect(d.current?.id).toBe('m1_start');
    expect(d.say('m1_first')).toBe(true); // lower story: queued
    expect(d.say('m1_latch')).toBe(false); // only one story line may wait
    at(4500); // the cut-in line ends; the waiting story line starts (it is fresh)
    expect(d.current?.id).toBe('m1_first');
  });

  it('respects pool cooldowns and avoids repeating the last pick', () => {
    const { d, at } = make();
    const picked: string[] = [];
    let t = 0;
    for (let i = 0; i < 12; i++) {
      t += 20000;
      at(t);
      if (d.react('miss')) picked.push(d.current!.id);
    }
    for (let i = 1; i < picked.length; i++) expect(picked[i]).not.toBe(picked[i - 1]);
    at(t + 100);
    expect(d.react('miss')).toBe(false); // within the cooldown
  });

  it('drops banter when banter is off or a danger cue is telegraphed, but keeps story', () => {
    const off = make(false);
    expect(off.d.say('miss1')).toBe(false);
    expect(off.d.say('m1_start')).toBe(true);
    const held = make();
    held.d.hold(2000);
    expect(held.d.say('hurt1')).toBe(false);
    expect(held.d.say('m3_blower')).toBe(true);
  });

  it('shows the subtitle in the chosen language for as long as the line', () => {
    let t = 0;
    const subs: Array<string | null> = [];
    const d = new Dialogue(() => ({ banter: true, subtitles: 'es', uiLang: () => 'en' }), (text) => subs.push(text), () => t, 1);
    d.say('m1_start');
    expect(subs.at(-1)).toBe(STRINGS ? LINES.find((l) => l.id === 'm1_start')!.es : '');
    t = 200; d.update();
    expect(d.busy).toBe(true);
    t = 60000; d.update();
    expect(subs.at(-1)).toBeNull();
  });
});

describe('hints', () => {
  it('always offer a next action until the mission is complete', () => {
    for (const def of MISSIONS) {
      const sim = new MissionSim(def, 4);
      const bot = new MissionBot({ seed: 4 });
      let empty = 0;
      while (!sim.state.complete && sim.state.timeMs < LIMIT) {
        if (sim.state.player.alive && missionHints(sim).length === 0) empty++;
        sim.step(bot.think(sim));
        sim.drainEvents();
      }
      expect(empty, def.id).toBe(0);
    }
  }, 180000);

  it('recovery spots for knocked-off ingredients are on open ground', () => {
    const def = missionById('cocina')!;
    const world = new World(new MissionSim(def, 1).map.boxes);
    for (const e of def.entities) {
      if (e.kind !== 'pickup' || !(e as PickupSpec).recoverAt) continue;
      const [x, y, z] = (e as PickupSpec).recoverAt!;
      const b = newBody(x, y + 0.05, z);
      settle(world, b);
      expect(b.y, e.id).toBeLessThan(0.1);
    }
  });
});
