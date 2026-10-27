// Practice pause. Pausing the practice host mid-stride used to freeze Rosa
// with walking velocity and with inputs already sent but not yet simulated;
// on Resume she carried on walking with no key held (the Mac report: "Rosa
// drifts", after Esc, a menu or switching apps). The pause transition
// (Room.pauseSync, GameSession.pauseSync) now discards that stale intent
// without simulating anything: the match clock, bots, projectiles, swings
// and cooldowns stay exactly where they were.
import { describe, expect, it } from 'vitest';
import { LocalHost } from '../src/net/local';
import { GameSession, type LocalInput } from '../src/net/session';
import { BTN, type SimEvent } from '../shared/sim';
import { MELEE } from '../shared/config';

const flushMicro = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const IDLE: LocalInput = { mx: 0, mz: 0, yaw: 0, pitch: 0, fire: false, jump: false, crouch: false, weapon: 0 };
const WALK: LocalInput = { ...IDLE, mz: 1 };

async function setup() {
  const host = new LocalHost();
  clearInterval((host as unknown as { timer: ReturnType<typeof setInterval> }).timer); // the test drives the ticks
  const events: SimEvent[] = [];
  const s = new GameSession(host.transport(), { event: (e) => events.push(e) });
  s.connect('Rosa');
  await flushMicro();
  s.send({ t: 'create', practice: { difficulty: 'easy', allies: 0, enemies: 1 }, map: 'patio' });
  await flushMicro();
  const room = [...host.hub.rooms.values()][0]!;
  s.send({ t: 'start' });
  await flushMicro();
  const tick = async () => { (room as unknown as { tick: () => void }).tick(); await flushMicro(); };
  for (let i = 0; i < 200 && room.sim!.phase !== 'playing'; i++) await tick();
  for (const m of room.members.values()) if (m.bot) m.brain = null;
  const sim = room.sim!;
  const me = sim.players.get(s.id)!;
  const bot = [...sim.players.values()].find((p) => p !== me)!;
  me.body.x = -4; me.body.z = 4; me.protectedUntil = 0;
  bot.body.x = 20; bot.body.z = 20; // out of the way unless a test needs it
  await tick(); // the client takes the new position
  // One frame of play: the client predicts and sends, the host simulates.
  const play = async (inp: LocalInput, n = 1) => { for (let i = 0; i < n; i++) { s.tick(inp); s.flush(); await tick(); } };
  // Inputs sent but not yet simulated (the host runs on its own timer, so a few are usually waiting).
  const send = (inp: LocalInput, n: number) => { for (let i = 0; i < n; i++) { s.tick(inp); s.flush(); } };
  // What main.ts does on Esc, a menu or a hidden tab.
  const pause = async () => {
    s.flush();
    const r = host.pauseSync().find((x) => x.id === s.id);
    if (r) s.pauseSync(r.ackBefore);
    host.pause();
    await flushMicro(); // the snapshot pauseSync sent reaches the client
    return r;
  };
  return { host, s, room, sim, me, bot, tick, play, send, pause, events };
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe('practice pause', () => {
  it('a bare pause (the old behaviour) leaves her walking on after Resume', async () => {
    const t = await setup();
    await t.play(WALK, 30);
    t.send(WALK, 6);
    expect(t.me.queue.length).toBeGreaterThan(0);
    t.host.pause();
    const at = { x: t.me.body.x, z: t.me.body.z };
    t.host.resume();
    await t.play(IDLE, 60);
    expect(dist(t.me.body, at)).toBeGreaterThan(0.2);
    t.host.dispose();
  });

  it('queued walking input does not move her after Resume, and the client agrees with the host', async () => {
    const t = await setup();
    await t.play(WALK, 30);
    t.send(WALK, 6);
    const queued = t.me.queue.length, lastSent = t.me.queue[queued - 1]!.seq;
    expect(queued).toBeGreaterThan(0);
    expect(t.s.pendingInputs).toBeGreaterThanOrEqual(queued);
    const at = { x: t.me.body.x, z: t.me.body.z };
    const r = (await t.pause())!;
    expect(r.discarded).toBe(queued);
    expect(r.keptVelocity).toBe(false);
    expect(t.me.lastSeq).toBe(lastSent); // discarded inputs count as acknowledged
    expect(t.me.queue.length).toBe(0);
    // The client dropped them too (nothing left to replay) and took the host's state as it is.
    expect(t.s.pendingInputs).toBe(0);
    expect(dist(t.s.body, t.me.body)).toBeLessThan(1e-3);
    expect(Math.hypot(t.s.body.vx, t.s.body.vz)).toBeLessThan(1e-6);
    expect(dist(t.me.body, at)).toBeLessThan(1e-9); // the pause itself moved nobody
    t.host.resume();
    await t.play(IDLE, 60);
    expect(dist(t.me.body, at)).toBeLessThan(1e-3);
    expect(dist(t.s.body, t.me.body)).toBeLessThan(1e-3);
    t.host.dispose();
  });

  it('repeated Esc/Resume while walking never drifts, and walking works between pauses', async () => {
    const t = await setup();
    for (let round = 0; round < 5; round++) {
      const walk = { ...WALK, mz: round % 2 ? -1 : 1 }; // back and forth, clear of the walls
      await t.play(walk, 12);
      t.send(walk, 1 + round);
      const at = { x: t.me.body.x, z: t.me.body.z };
      await t.pause();
      t.host.resume();
      // Some rounds pause again at once, before any play.
      if (round % 2) { await t.pause(); t.host.resume(); }
      await t.play(IDLE, 20);
      expect(dist(t.me.body, at)).toBeLessThan(1e-3);
      expect(dist(t.s.body, t.me.body)).toBeLessThan(1e-3);
      const before = { x: t.me.body.x, z: t.me.body.z };
      await t.play(WALK, 12);
expect(dist(t.me.body, before)).toBeGreaterThan(0.3); // controls still work
    }
    t.host.dispose();
  });

  it('pausing during an enemy attack advances nothing, and the attack lands once after Resume', async () => {
    const t = await setup();
    const def = MELEE[0]!; // El Chanclazo
    t.me.body.x = -4; t.me.body.z = 4;
    t.bot.body.x = -2.9; t.bot.body.z = 4; t.bot.body.vx = t.bot.body.vz = 0;
    t.bot.yaw = Math.PI / 2; t.bot.pitch = 0; t.bot.weapon = 0; t.bot.switchMs = 0; t.bot.cooldownMs = 0;
    t.bot.queue.push({ seq: t.bot.lastSeq + 1, mx: 0, mz: 0, yaw: Math.PI / 2, pitch: 0, buttons: BTN.melee, weapon: 0 });
    // Run the wind-up to one tick short of contact: any advance at all would hit.
    await t.tick();
    const sw = t.bot.swing!;
    expect(sw).toBeTruthy();
    while ((t.sim.tick - sw.tick0 + 1) * (1000 / 60) < def.windupMs) await t.play(IDLE);
    expect(t.me.hp).toBe(100);
    const before = { timeMs: t.sim.timeMs, tick: t.sim.tick, meleeMs: t.bot.meleeMs, cooldownMs: t.me.cooldownMs, botX: t.bot.body.x };
    t.send(IDLE, 4);
    await t.pause();
    expect(t.sim.timeMs).toBe(before.timeMs);
    expect(t.sim.tick).toBe(before.tick);
    expect(t.bot.meleeMs).toBe(before.meleeMs);
    expect(t.bot.swing).toBe(sw);
    expect(t.me.cooldownMs).toBe(before.cooldownMs);
    expect(t.bot.body.x).toBe(before.botX);
    expect(t.me.hp).toBe(100);
    expect(t.s.hp).toBe(100);
    // Paused for a while: the host's clock does not move.
    const frozen = t.host.now();
    await new Promise((r) => setTimeout(r, 40));
    expect(t.host.now()).toBe(frozen);
    t.host.resume();
    await t.play(IDLE, 60);
    const hits = t.events.filter((e) => e.k === 'hit' && e.m === sw.id);
    expect(hits.length).toBe(1);
    expect(t.me.hp).toBe(100 - def.damage);
    expect(t.s.hp).toBe(100 - def.damage);
    t.host.dispose();
  });

  it('an airborne pause keeps the jump: same height and speed, and the arc carries on after Resume', async () => {
    const t = await setup();
    await t.play({ ...WALK, jump: true });
    await t.play(WALK, 6);
    expect(t.me.body.onGround).toBe(false);
    t.send(WALK, 3);
    const b = { ...t.me.body };
    const r = (await t.pause())!;
    expect(r.keptVelocity).toBe(true);
    expect(t.me.body.y).toBe(b.y);
    expect(t.me.body.vy).toBe(b.vy);
    expect(t.me.body.vx).toBe(b.vx);
    expect(t.me.body.vz).toBe(b.vz);
    expect(t.s.body.y).toBeCloseTo(b.y, 6);
    t.host.resume();
    await t.play(IDLE, 90);
    expect(t.me.body.onGround).toBe(true);
    expect(dist(t.me.body, b)).toBeGreaterThan(0.05); // the jump's momentum carried on
    expect(dist(t.s.body, t.me.body)).toBeLessThan(1e-3);
    t.host.dispose();
  });

  it('a fresh knockback keeps its push through the pause', async () => {
    const t = await setup();
    await t.play(IDLE, 2);
    t.me.lastHitAt = t.sim.timeMs; t.me.body.vx = 3; // as damage() leaves it
    const r = (await t.pause())!;
    expect(r.keptVelocity).toBe(true);
    expect(t.me.body.vx).toBe(3);
    t.host.dispose();
  });

  it('pending melee and throw presses are discarded: no swing or throw after Resume', async () => {
    const t = await setup();
    await t.play(IDLE, 40); // past the start, weapon ready
    t.send({ ...IDLE, melee: true }, 1);
    t.send(IDLE, 1);
    t.send({ ...IDLE, fire: true }, 1);
    const swingsBefore = t.me.stats.swings, throwsBefore = t.me.stats.throws;
    await t.pause();
    expect(t.me.meleeQueued).toBe(false);
    expect(t.s.swingWeapon).toBe(null);
    expect([...(t.s as unknown as { projectiles: Map<number, { predicted: boolean }> }).projectiles.values()].some((p) => p.predicted)).toBe(false);
    t.host.resume();
    await t.play(IDLE, 60);
    expect(t.me.stats.swings).toBe(swingsBefore);
    expect(t.me.stats.throws).toBe(throwsBefore);
    expect(t.events.some((e) => (e.k === 'swing' && e.a === t.s.id) || (e.k === 'throw' && e.o === t.s.id))).toBe(false);
    t.host.dispose();
  });

  it('a buffered melee press (meleeQueued) is dropped by the pause', async () => {
    const t = await setup();
    await t.play(IDLE, 40);
    await t.play({ ...IDLE, melee: true });
    expect(t.me.swing).toBeTruthy();
    // Press again inside the buffer window at the end of the cycle.
    while (t.me.meleeMs > 100) await t.play(IDLE);
    await t.play({ ...IDLE, melee: true });
    expect(t.me.meleeQueued).toBe(true);
    const swings = t.me.stats.swings;
    await t.pause();
    expect(t.me.meleeQueued).toBe(false);
    t.host.resume();
    await t.play(IDLE, 60);
    expect(t.me.stats.swings).toBe(swings);
    t.host.dispose();
  });
});
