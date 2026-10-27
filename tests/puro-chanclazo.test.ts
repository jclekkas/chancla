// ¡Puro Chanclazo! (melee-only rules). The rules belong to the room and the
// match: Classic when nothing says otherwise; under melee-only rules the
// primary button swings (once per press, once together with the melee key),
// and the authoritative simulation never launches a throw, whatever a client
// sends. Bots brawl and score. The client session applies the same rule to
// what it predicts and sends.
import { describe, expect, it } from 'vitest';
import { MatchSim, BTN, type PlayerInput, type SimEvent } from '../shared/sim';
import { BotBrain } from '../shared/bots';
import { mapData } from '../shared/maps';
import { MELEE, rulesetOf } from '../shared/config';
import { parseClientMsg } from '../shared/protocol';
import { Room } from '../shared/room';
import { LocalHost } from '../src/net/local';
import { GameSession, type LocalInput } from '../src/net/session';
import { FpsSettingsStore, defaults } from '../src/fps/settings';
import { SafeStorage, type KV } from '../src/persistence/storage';

const memKV = (init: Record<string, string> = {}): KV => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};

/** Two players face to face 1 m apart on El Patio's open square, ready to fight. */
function duel(rules?: 'classic' | 'melee') {
  const sim = new MatchSim(mapData('patio'), { countdownMs: 0, seed: 3, ...(rules ? { rules } : {}) });
  const a = sim.addPlayer(1, 0);
  const b = sim.addPlayer(2, 1);
  for (const p of [a, b]) { p.protectedUntil = 0; p.body.vx = p.body.vz = 0; }
  a.body.x = 4; a.body.z = 4; b.body.x = 4; b.body.z = 3; // B is 1 m in front of A (A looks down -z)
  sim.step();
  let seq = 0;
  const events: SimEvent[] = [];
  const play = (buttons: number, weapon: 0 | 1 = 0, n = 1, pitch = 0.05) => {
    for (let i = 0; i < n; i++) {
      sim.queueInput(1, { seq: ++seq, mx: 0, mz: 0, yaw: 0, pitch, buttons, weapon } satisfies PlayerInput);
      sim.queueInput(2, { seq, mx: 0, mz: 0, yaw: Math.PI, pitch: 0, buttons: 0, weapon: 0 });
      sim.step();
      events.push(...sim.drainEvents());
    }
  };
  const count = (k: SimEvent['k']) => events.filter((e) => e.k === k).length;
  return { sim, a, b, play, events, count };
}

describe('ruleset defaults', () => {
  it('a missing or unknown ruleset is Classic: messages, rooms, matches and saved settings', () => {
    expect(rulesetOf(undefined)).toBe('classic');
    expect(rulesetOf('arcade')).toBe('classic');
    expect(parseClientMsg({ t: 'create' })).toEqual({ t: 'create' });
    expect(parseClientMsg({ t: 'create', rules: 'melee', map: 'fiesta' })).toEqual({ t: 'create', rules: 'melee', map: 'fiesta' });
    expect(parseClientMsg({ t: 'create', rules: 'nope' })).toBeNull();
    expect(parseClientMsg({ t: 'rules', rules: 'melee' })).toEqual({ t: 'rules', rules: 'melee' });
    expect(parseClientMsg({ t: 'rules' })).toBeNull();
    expect(new MatchSim(mapData('patio')).rules).toBe('classic');
    expect(new Room('ABCDEFGH', 0).view().rules).toBe('classic');
    // A save from before combat modes existed, and one with a bad value.
    const d = defaults('en', false, false);
    const old = new FpsSettingsStore(new SafeStorage(memKV({ 'chancla.mp.settings.v1': JSON.stringify({ practiceMap: 'plaza' }) })), d);
    expect(old.value.practiceRules).toBe('classic');
    expect(old.value.roomRules).toBe('classic');
    const bad = new FpsSettingsStore(new SafeStorage(memKV({ 'chancla.mp.settings.v1': JSON.stringify({ practiceRules: 'x', roomRules: 7 }) })), d);
    expect([bad.value.practiceRules, bad.value.roomRules]).toEqual(['classic', 'classic']);
  });
});

describe('Classic is unchanged', () => {
  it('the primary button throws and the melee key swings', () => {
    const d = duel();
    d.play(BTN.fire, 0, 1);
    expect(d.count('throw')).toBe(1);
    d.play(0, 0, 60);
    d.play(BTN.melee, 0, 1);
    d.play(0, 0, 30);
    expect(d.count('swing')).toBe(1);
    expect(d.sim.refusedThrows).toBe(0);
  });
});

describe('¡Puro Chanclazo! in the simulation', () => {
  it('the primary button swings: El Chanclazo with La Chancla and El Revés with La Pesada, weapon switching kept', () => {
    const d = duel('melee');
    d.play(BTN.fire, 0, 1);
    d.play(0, 0, 50);
    const first = d.events.find((e) => e.k === 'hit') as Extract<SimEvent, { k: 'hit' }>;
    expect(first.w).toBe(0);
    expect(first.d).toBe(MELEE[0]!.damage);
    // Switch to La Pesada, wait out the switch, then swing again.
    d.play(0, 1, 40);
    expect(d.a.weapon).toBe(1);
    d.play(BTN.fire, 1, 1);
    d.play(0, 1, 70);
    const hits = d.events.filter((e) => e.k === 'hit') as Array<Extract<SimEvent, { k: 'hit' }>>;
    expect(hits.map((h) => h.w)).toEqual([0, 1]);
    expect(hits[1]!.m).toBeDefined();
    expect(d.count('throw')).toBe(0);
    expect(d.sim.projectiles.length).toBe(0);
  });

  it('a held or forged throw is refused: never a projectile, and a hold is one swing', () => {
    const d = duel('melee');
    d.play(BTN.fire, 0, 240); // four seconds of a client insisting on throwing
    expect(d.count('throw')).toBe(0);
    expect(d.sim.projectiles.length).toBe(0);
    expect(d.a.stats.throws).toBe(0);
    expect(d.count('swing')).toBe(1);
    expect(d.sim.refusedThrows).toBe(240);
  });

  it('the primary button and the melee key together, or mashed, cannot double a swing or beat its cooldown', () => {
    const d = duel('melee');
    d.play(BTN.fire | BTN.melee, 0, 1);
    d.play(0, 0, 5);
    expect(d.count('swing')).toBe(1);
    // Mash both for 3 s, alternating every tick.
    const n = 180;
    for (let i = 0; i < n; i++) d.play(i % 2 ? BTN.fire : BTN.melee, 0, 1);
    const cycle = MELEE[0]!.cycleMs;
    expect(d.count('swing') - 1).toBeLessThanOrEqual(Math.ceil((n * 1000 / 60) / cycle) + 1);
    // Swings never overlap: each starts after the last one's cycle.
    const starts = (d.events.filter((e) => e.k === 'swing') as Array<Extract<SimEvent, { k: 'swing' }>>).map((e) => e.tm);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(cycle - 1);
  });

});

describe('bots under melee-only rules', () => {
  it('never throw, close in, and both teams score', () => {
    const sim = new MatchSim(mapData('fiesta'), { countdownMs: 0, seed: 11, rules: 'melee' });
    const brains: BotBrain[] = [];
    for (let id = 1; id <= 4; id++) { sim.addPlayer(id, id <= 2 ? 0 : 1, true); brains.push(new BotBrain(sim, id, 'normal')); }
    let throws = 0;
    for (let t = 0; t < 60 * 60; t++) {
      for (const b of brains) { const inp = b.think(sim); if (inp) sim.queueInput(b.id, inp); }
      sim.step();
      throws += sim.drainEvents().filter((e) => e.k === 'throw').length;
    }
    expect(throws).toBe(0);
    expect(sim.refusedThrows).toBe(0); // they do not even ask
    const swings = [...sim.players.values()].reduce((s, p) => s + p.stats.swings, 0);
    expect(swings).toBeGreaterThan(20);
    expect(sim.scores[0]).toBeGreaterThan(0);
    expect(sim.scores[1]).toBeGreaterThan(0);
  }, 60000);
});

// ---- the client session, against the in-browser practice host ----

const flushMicro = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const IDLE: LocalInput = { mx: 0, mz: 0, yaw: 0, pitch: 0.05, fire: false, jump: false, crouch: false, weapon: 0 };

async function practice(rules?: 'classic' | 'melee') {
  const host = new LocalHost();
  clearInterval((host as unknown as { timer: ReturnType<typeof setInterval> }).timer);
  const events: SimEvent[] = [];
  const s = new GameSession(host.transport(), { event: (e) => events.push(e) });
  s.connect('Rosa');
  await flushMicro();
  s.send({ t: 'create', practice: { difficulty: 'easy', allies: 0, enemies: 1 }, map: 'patio', ...(rules ? { rules } : {}) });
  await flushMicro();
  const room = [...host.hub.rooms.values()][0]!;
  s.send({ t: 'start' });
  await flushMicro();
  const tick = async () => { (room as unknown as { tick: () => void }).tick(); await flushMicro(); };
  for (let i = 0; i < 200 && room.sim!.phase !== 'playing'; i++) await tick();
  // The room view goes out from the room's regular update (the host's timer, stopped here): send it without stepping time.
  const r = room as unknown as { update: (now: number) => boolean; lastUpdate: number };
  r.update(Math.max(0, r.lastUpdate));
  await flushMicro();
  for (const m of room.members.values()) if (m.bot) m.brain = null;
  const sim = room.sim!;
  const me = sim.players.get(s.id)!;
  const bot = [...sim.players.values()].find((p) => p !== me)!;
  me.body.x = 4; me.body.z = 4; me.protectedUntil = 0;
  bot.body.x = 4; bot.body.z = 3; bot.protectedUntil = 0;
  await tick();
  const play = async (inp: LocalInput, n = 1) => { for (let i = 0; i < n; i++) { s.tick({ ...inp, yaw: 0 }); s.flush(); await tick(); } };
  return { host, s, room, sim, me, bot, events, play };
}

describe('the client session follows the room', () => {
  it('Classic practice still throws from the primary button', async () => {
    const p = await practice();
    expect(p.s.rules).toBe('classic');
    await p.play({ ...IDLE, fire: true }, 2);
    await p.play(IDLE, 10);
    expect(p.events.filter((e) => e.k === 'throw').length).toBeGreaterThanOrEqual(1);
  });

  it('melee-only practice: a held primary button is one predicted swing, never a throw; together with V still one', async () => {
    const p = await practice('melee');
    expect(p.s.rules).toBe('melee');
    expect(p.room.view().rules).toBe('melee');
    await p.play({ ...IDLE, fire: true }, 90);
    await p.play(IDLE, 30);
    expect(p.events.filter((e) => e.k === 'throw').length).toBe(0);
    expect(p.events.filter((e) => e.k === 'swing' && e.a === p.s.id).length).toBe(1);
    expect(p.events.some((e) => e.k === 'hit' && e.a === p.s.id)).toBe(true);
    // Both at once.
    await p.play({ ...IDLE, fire: true, melee: true }, 1);
    await p.play(IDLE, 60);
    expect(p.events.filter((e) => e.k === 'swing' && e.a === p.s.id).length).toBe(2);
    expect(p.me.stats.throws).toBe(0);
  });
  it('the host refuses forged throw inputs sent past the session, and a match keeps its rules', async () => {
    const p = await practice('melee');
    let seq = 10_000;
    for (let i = 0; i < 120; i++) {
      p.s.send({ t: 'i', d: [[++seq, 0, 0, 0, 0.05, BTN.fire, i < 60 ? 0 : 1]] });
      await flushMicro();
      (p.room as unknown as { tick: () => void }).tick();
      await flushMicro();
    }
    expect(p.events.filter((e) => e.k === 'throw').length).toBe(0);
    expect(p.sim.projectiles.length).toBe(0);
    expect(p.sim.refusedThrows).toBeGreaterThan(0);
    // The owner cannot switch the rules mid-match.
    p.s.send({ t: 'rules', rules: 'classic' });
    await flushMicro();
    expect(p.room.rules).toBe('melee');
    expect(p.sim.rules).toBe('melee');
  });
});
