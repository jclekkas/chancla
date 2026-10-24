// The elimination replay's recorder, clip choice and playback cursor, fed
// by a real practice match (the in-page host, the real sim and a real client
// session on a test clock): a bot eliminates you with a thrown chancla, El
// Chanclazo or El Revés. Playback only reads what was recorded: nothing is
// simulated, launched or sent, and each elimination gives at most one replay.
import { describe, expect, it } from 'vitest';
import { LocalHost } from '../src/net/local';
import { GameSession, type LocalInput } from '../src/net/session';
import { BTN, type SimEvent } from '../shared/sim';
import { lineOfSight } from '../shared/collision';
import { ClipCursor, KILLCAM, KillcamDirector, buildClip, eyeOf, meleeCamera, noteFrom, thirdPersonCamera, type Clip } from '../src/fps/killcam';

const flushMicro = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const IDLE: LocalInput = { mx: 0, mz: 0, yaw: 0, pitch: 0, fire: false, jump: false, crouch: false, weapon: 0 };
const TICK_MS = 1000 / 60;

async function setup() {
  let clock = 1000;
  const host = new LocalHost();
  clearInterval((host as unknown as { timer: ReturnType<typeof setInterval> }).timer);
  const events: SimEvent[] = [];
  let s!: GameSession;
  const director = new KillcamDirector(() => s.id);
  s = new GameSession(host.transport(), {
    snapshot: (r) => director.rec.snapshot(r),
    event: (e) => {
      events.push(e);
      const st = s.snap!.st;
      director.rec.event(e, st);
      if (e.k === 'elim') director.onElim(noteFrom(e, st, s.room?.members ?? []));
    },
  }, () => clock);
  s.connect('Rosa');
  await flushMicro();
  s.send({ t: 'create', practice: { difficulty: 'easy', allies: 0, enemies: 1 }, map: 'patio' });
  await flushMicro();
  const room = [...host.hub.rooms.values()][0]!;
  s.send({ t: 'start' });
  await flushMicro();
  // One host tick, plus the room view that Room.update would send when it changes.
  const r = room as unknown as { tick: () => void; broadcast: (m: unknown) => void };
  const raw = async () => {
    r.tick();
    r.broadcast({ t: 'room', room: room.view() });
    clock += TICK_MS;
    await flushMicro();
  };
  for (let i = 0; i < 300 && room.sim!.phase !== 'playing'; i++) await raw();
  for (const m of room.members.values()) if (m.bot) m.brain = null;
  const sim = room.sim!;
  const me = sim.players.get(s.id)!;
  const bot = [...sim.players.values()].find((p) => p !== me)!;
  let wasAlive = true;
  const clips: Clip[] = [];
  // One frame: the client ticks, the host simulates, the client renders (what engine.ts does).
  const frame = async (inp: LocalInput = IDLE) => {
    s.tick(inp); s.flush();
    await raw();
    s.updateRemotes();
    s.updateProjectiles(TICK_MS / 1000);
    if (wasAlive && !s.alive) director.onDeath(s.snap!.st, clock);
    if (!wasAlive && s.alive) director.onRespawn();
    wasAlive = s.alive;
    if (!s.alive) { const c = director.poll(clock, s.respawnInMs, true, s.world.boxes); if (c) clips.push(c); }
  };
  const frames = async (n: number) => { for (let i = 0; i < n; i++) await frame(); };
  let seq = 0;
  const botInput = (buttons: number, weapon: 0 | 1, yaw: number, pitch = 0) => {
    seq = Math.max(seq, bot.lastSeq);
    sim.queueInput(bot.id, { seq: ++seq, mx: 0, mz: 0, yaw, pitch, buttons, weapon } as never);
  };
  const place = (mx: number, mz: number, bx: number, bz: number) => {
    me.body.x = mx; me.body.z = mz; me.body.vx = me.body.vz = 0; me.protectedUntil = 0;
    bot.body.x = bx; bot.body.z = bz; bot.body.vx = bot.body.vz = 0; bot.protectedUntil = 0;
  };
  await frames(10);
  return { host, s, sim, room, me, bot, director, events, clips, frame, frames, botInput, place, clock: () => clock };
}

type T = Awaited<ReturnType<typeof setup>>;

/** A melee elimination: the bot faces you from 1.1 m and swings. */
async function meleeKill(t: T, weapon: 0 | 1, head: boolean): Promise<void> {
  t.place(-4, 4, -2.9, 4);
  // A few quiet frames first, so the replay has a lead-in.
  await t.frames(80);
  t.me.hp = weapon === 1 ? 40 : 20;
  t.bot.weapon = weapon; t.bot.switchMs = 0; t.bot.cooldownMs = 0; t.bot.meleeMs = 0;
  const pitch = head ? 0.12 : -0.25;
  t.botInput(BTN.melee, weapon, Math.PI / 2, pitch);
  for (let i = 0; i < 40 && t.s.alive; i++) { t.botInput(0, weapon, Math.PI / 2, pitch); await t.frame(); }
}

/** A thrown elimination: the bot throws La Chancla at you from 6 m. */
async function throwKill(t: T): Promise<void> {
  t.place(-4, 4, 2, 4);
  await t.frames(80);
  t.me.hp = 5;
  t.bot.weapon = 0; t.bot.switchMs = 0; t.bot.cooldownMs = 0;
  t.botInput(BTN.fire, 0, Math.PI / 2, -0.02);
  for (let i = 0; i < 90 && t.s.alive; i++) { t.botInput(0, 0, Math.PI / 2, -0.02); await t.frame(); }
}

/** Frames until the replay decides (or respawn). */
async function untilDecided(t: T, max = 120): Promise<void> {
  const n0 = t.clips.length, f0 = Object.values(t.director.counts.fallback).reduce((a, b) => a + (b ?? 0), 0);
  for (let i = 0; i < max && t.clips.length === n0 && Object.values(t.director.counts.fallback).reduce((a, b) => a + (b ?? 0), 0) === f0 && !t.s.alive; i++) await t.frame();
}

function deepFreeze(c: Clip): void {
  for (const s of c.snaps) { Object.freeze(s); for (const p of s.players.values()) Object.freeze(p); }
  for (const e of c.events) { Object.freeze(e); Object.freeze(e.e); }
}

/** Plays a clip to the end, as the engine does, collecting what fires. */
function play(c: Clip) {
  const cur = new ClipCursor(c);
  const fired: SimEvent[] = [];
  let maxProj = 0;
  for (let rt = c.start; rt <= c.end + 1e-6; rt += TICK_MS) {
    const players = cur.playersAt(rt);
    expect(players.has(c.victim)).toBe(true);
    maxProj = Math.max(maxProj, cur.projectilesAt(rt).length);
    for (const r of cur.due(rt)) fired.push(r.e);
  }
  // Nothing more fires once played.
  expect(cur.due(c.end + 10_000)).toEqual([]);
  return { fired, maxProj };
}

describe('elimination replay', () => {
  it('a thrown chancla: the killer, the throw and its impact, timed from the projectile that hit', async () => {
    const t = await setup();
    await throwKill(t);
    expect(t.s.alive).toBe(false);
    await untilDecided(t);
    expect(t.clips).toHaveLength(1);
    const c = t.clips[0]!;
    expect(c.killer).toBe(t.bot.id);
    expect(c.victim).toBe(t.s.id);
    expect(c.note).toMatchObject({ w: 0, melee: false, name: t.room.members.get(t.bot.id)!.name, team: t.bot.team });
    expect(c.finishThrow).toBeDefined();
    const pend = t.events.find((e) => e.k === 'pend' && e.id === c.finishThrow && e.r === 'player') as Extract<SimEvent, { k: 'pend' }>;
    expect(c.tKill).toBe(pend.tm);
    expect(c.end - c.tKill).toBe(KILLCAM.tailMs);
    expect(c.tKill - c.start).toBeGreaterThanOrEqual(KILLCAM.leadMs - 1);
    deepFreeze(c);
    const { fired, maxProj } = play(c);
    expect(maxProj).toBeGreaterThan(0); // the chancla is in the air in the replay
    // Drawn from the recorded throw: it arrives where the server says it hit.
    const at = new ClipCursor(c).projectilesAt(pend.tm - 1)[0]!;
    expect(Math.hypot(at.x - pend.p[0], at.y - pend.p[1], at.z - pend.p[2])).toBeLessThan(0.05);
    expect(fired.filter((e) => e.k === 'throw' && e.o === t.bot.id)).toHaveLength(1);
    expect(fired.filter((e) => e.k === 'elim')).toHaveLength(1);
    expect(fired.filter((e) => e.k === 'hit' && e.v === t.s.id).length).toBeGreaterThanOrEqual(1);
    t.host.dispose();
  });

  for (const [weapon, name] of [[0, 'El Chanclazo'], [1, 'El Revés to the face']] as const) {
    it(`${name}: attribution, the swing, the hit and the elimination, once each`, async () => {
      const t = await setup();
      await meleeKill(t, weapon, weapon === 1);
      expect(t.s.alive).toBe(false);
      const elim = t.events.find((e) => e.k === 'elim') as Extract<SimEvent, { k: 'elim' }>;
      expect(elim.m).toBeDefined();
      await untilDecided(t);
      expect(t.clips).toHaveLength(1);
      const c = t.clips[0]!;
      // Melee: the framed view of both of them, never her own eyes (her swing would not show).
      expect(c).toMatchObject({ killer: t.bot.id, finishSwing: elim.m, view: 'melee' });
      expect(c.note).toMatchObject({ w: weapon, melee: true });
      const hit = t.events.find((e) => e.k === 'hit' && e.m === elim.m) as Extract<SimEvent, { k: 'hit' }>;
      expect(c.tKill).toBe(hit.tm);
      deepFreeze(c);
      const { fired } = play(c);
      expect(fired.filter((e) => e.k === 'swing' && e.id === elim.m)).toHaveLength(1);
      expect(fired.filter((e) => e.k === 'hit' && e.m === elim.m)).toHaveLength(1);
      expect(fired.filter((e) => e.k === 'elim')).toHaveLength(1);
      if (weapon === 1) {
        // The rollers: only what the server said came off, once.
        const ru = fired.flatMap((e) => (e.k === 'hit' || e.k === 'elim') && e.ru ? e.ru : []);
        expect(ru.length).toBeGreaterThanOrEqual(1);
        expect(new Set(ru).size).toBe(ru.length);
      }
      t.host.dispose();
    });
  }

  it('repeated and delayed eliminations start no second replay; a stale one never binds to a later death', async () => {
    const t = await setup();
    await meleeKill(t, 0, false);
    const elim = t.events.find((e) => e.k === 'elim') as Extract<SimEvent, { k: 'elim' }>;
    const st = t.s.snap!.st;
    // The same elimination resent: ignored.
    t.director.onElim(noteFrom(elim, st, t.s.room!.members));
    await untilDecided(t);
    t.director.onElim(noteFrom(elim, st, t.s.room!.members));
    expect(t.clips).toHaveLength(1);
    expect(t.director.counts.repeats).toBeGreaterThanOrEqual(1);
    // Respawn, then the old elimination arrives late: it must not start anything now or at the next death.
    while (!t.s.alive) await t.frame();
    t.director.onElim(noteFrom(elim, st, t.s.room!.members));
    await t.frames(30);
    expect(t.clips).toHaveLength(1);
    await meleeKill(t, 0, false);
    await untilDecided(t);
    expect(t.clips).toHaveLength(2);
    expect(t.clips[1]!.note.st).toBeGreaterThan(st + 1000);
    t.host.dispose();
  });

  it('missing or short history, an unknown killer and a self elimination keep the death screen', async () => {
    const t = await setup();
    await meleeKill(t, 0, false);
    const elim = t.events.find((e) => e.k === 'elim') as Extract<SimEvent, { k: 'elim' }>;
    const note = noteFrom(elim, t.s.snap!.st, t.s.room!.members);
    await t.frames(40);
    const boxes = t.s.world.boxes;
    expect('clip' in buildClip(t.director.rec, note, boxes)).toBe(true);
    // Self or environment.
    expect(buildClip(t.director.rec, { ...note, killer: t.s.id }, boxes)).toEqual({ fallback: 'self' });
    expect(buildClip(t.director.rec, { ...note, killer: -1 }, boxes)).toEqual({ fallback: 'self' });
    // Someone nobody recorded.
    expect(buildClip(t.director.rec, { ...note, killer: 999 }, boxes)).toEqual({ fallback: 'unknown-killer' });
    // A buffer that starts just before the blow (a reconnect, a join).
    const short = new KillcamDirector(() => t.s.id);
    for (const r of t.director.rec.snaps.filter((x) => x.st >= note.st - 300)) short.rec.snapshot(r);
    for (const r of t.director.rec.events) short.rec.event(r.e, r.st);
    expect(buildClip(short.rec, note, boxes)).toEqual({ fallback: 'short-history' });
    // Nothing at all.
    expect(buildClip(new KillcamDirector(() => t.s.id).rec, note, boxes)).toEqual({ fallback: 'short-history' });
    t.host.dispose();
  });

  it('a killer who disconnects after the blow is still in the replay, with the name from the moment it happened', async () => {
    const t = await setup();
    await meleeKill(t, 0, false);
    const name = t.room.members.get(t.bot.id)!.name;
    t.room.removeMember(t.bot.id);
    await t.frames(5);
    expect(t.s.room!.members.some((m) => m.id === t.bot.id)).toBe(false);
    await untilDecided(t);
    expect(t.clips).toHaveLength(1);
    expect(t.clips[0]!.note.name).toBe(name);
    const { fired } = play(t.clips[0]!);
    expect(fired.some((e) => e.k === 'elim')).toBe(true);
    t.host.dispose();
  });

  it('a replay that would not fit before respawn does not start; the setting turned off keeps the death screen', async () => {
    const t = await setup();
    await meleeKill(t, 0, false);
    const off = t.director.poll(t.clock() + 2000, 2000, false, t.s.world.boxes);
    expect(off).toBeNull();
    expect(t.director.lastFallback).toBe('off');
    // Decided once: later frames do nothing.
    await t.frames(60);
    expect(t.clips).toHaveLength(0);
    while (!t.s.alive) await t.frame();
    await meleeKill(t, 0, false);
    expect(t.director.poll(t.clock() + KILLCAM.beatMs + 1, KILLCAM.minLeftMs - 1, true, t.s.world.boxes)).toBeNull();
    expect(t.director.lastFallback).toBe('late');
    t.host.dispose();
  });

  it('repeated deaths: the buffer stays bounded, one replay per death, and nothing in the match changes', async () => {
    const t = await setup();
    const sizes: number[] = [];
    for (let k = 0; k < 6; k++) {
      await meleeKill(t, (k % 2) as 0 | 1, k % 2 === 1);
      await untilDecided(t);
      const scores = [...t.sim.scores], hp = t.bot.hp, evs = t.events.length;
      play(t.clips.at(-1)!);
      // Playback reads only: no score, damage or event appears from it.
      expect([...t.sim.scores]).toEqual(scores);
      expect(t.bot.hp).toBe(hp);
      expect(t.events.length).toBe(evs);
      while (!t.s.alive) await t.frame();
      const z = t.director.rec.size;
      sizes.push(z.snaps + z.events);
      expect(z.snaps).toBeLessThanOrEqual(KILLCAM.maxSnaps);
      expect(z.events).toBeLessThanOrEqual(KILLCAM.maxEvents);
    }
    expect(t.clips).toHaveLength(6);
    expect(t.director.counts.started).toBe(6);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThan(40); // no growth with deaths
    t.host.dispose();
  });

  it('the third-person view never sits inside a wall or behind cover from the victim', async () => {
    const t = await setup();
    const boxes = t.s.world.boxes;
    const solid = boxes.filter((b) => b.tag !== 'floor' && b.maxY > 1.5 && b.maxX - b.minX < 30);
    let checked = 0;
    for (const b of solid.slice(0, 40)) {
      // Stand just outside each face, with the attacker out in the open: the camera wants to go into the wall.
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const x = dx ? (dx > 0 ? b.maxX + 0.45 : b.minX - 0.45) : (b.minX + b.maxX) / 2;
        const z = dz ? (dz > 0 ? b.maxZ + 0.45 : b.minZ - 0.45) : (b.minZ + b.maxZ) / 2;
        const victim = { id: 1, x, y: 0, z, yaw: 0, pitch: 0, vx: 0, vz: 0, alive: false, crouched: false, onGround: true, protected: false, connected: true, hp: 0, weapon: 0 as const, msSinceThrow: 0, msSinceHit: 0, msSinceMelee: 0, ruleros: 15 };
        if (boxes.some((o) => o.tag !== 'floor' && x > o.minX - 0.3 && x < o.maxX + 0.3 && z > o.minZ - 0.3 && z < o.maxZ + 0.3 && o.maxY > 0.5)) continue;
        const killer = { ...victim, id: 2, x: x + dx * 4, z: z + dz * 4 };
        const cam = thirdPersonCamera(victim, killer, boxes);
        const eye = eyeOf(victim);
        expect(lineOfSight(eye, cam.pos, boxes, (o) => o.tag !== 'floor')).toBe(true);
        expect(boxes.some((o) => o.tag !== 'floor' && cam.pos.x > o.minX && cam.pos.x < o.maxX && cam.pos.y > o.minY && cam.pos.y < o.maxY && cam.pos.z > o.minZ && cam.pos.z < o.maxZ)).toBe(false);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
    t.host.dispose();
  });

  it('the melee view: clear of walls, both of them in plain sight, the same side held', async () => {
    const t = await setup();
    const boxes = t.s.world.boxes;
    const blocker = (o: { tag?: string }) => o.tag !== 'floor';
    const solid = boxes.filter((b) => b.tag !== 'floor' && b.maxY > 1.5 && b.maxX - b.minX < 30);
    let checked = 0, framed = 0;
    for (const b of solid.slice(0, 40)) {
      // A duel 1.1 m apart along each wall face (the camera wants to sit inside the wall on one side).
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const x = dx ? (dx > 0 ? b.maxX + 0.5 : b.minX - 0.5) : (b.minX + b.maxX) / 2;
        const z = dz ? (dz > 0 ? b.maxZ + 0.5 : b.minZ - 0.5) : (b.minZ + b.maxZ) / 2;
        const base = { id: 1, x, y: 0, z, yaw: 0, pitch: 0, vx: 0, vz: 0, alive: true, crouched: false, onGround: true, protected: false, connected: true, hp: 0, weapon: 0 as const, msSinceThrow: 0, msSinceHit: 0, msSinceMelee: 0, ruleros: 15 };
        const attacker = { ...base, x: x - dz * 0.55, z: z + dx * 0.55 }, victim = { ...base, id: 2, x: x + dz * 0.55, z: z - dx * 0.55 };
        if ([attacker, victim].some((p) => boxes.some((o) => blocker(o) && p.x > o.minX - 0.3 && p.x < o.maxX + 0.3 && p.z > o.minZ - 0.3 && p.z < o.maxZ + 0.3 && o.maxY > 0.5))) continue;
        checked++;
        const cam = meleeCamera(attacker, victim, boxes);
        if (!cam.ok) continue; // the replay then uses the third-person view (tested above)
        framed++;
        expect(boxes.some((o) => blocker(o) && cam.pos.x > o.minX && cam.pos.x < o.maxX && cam.pos.y > o.minY && cam.pos.y < o.maxY && cam.pos.z > o.minZ && cam.pos.z < o.maxZ)).toBe(false);
        expect(lineOfSight(cam.pos, { x: attacker.x, y: 1.2, z: attacker.z }, boxes, blocker)).toBe(true);
        expect(lineOfSight(cam.pos, { x: victim.x, y: 1.35, z: victim.z }, boxes, blocker)).toBe(true);
        // Behind her and to one side, looking toward the victim.
        const toV = { x: victim.x - attacker.x, z: victim.z - attacker.z }, toCam = { x: cam.pos.x - attacker.x, z: cam.pos.z - attacker.z };
        expect(toV.x * toCam.x + toV.z * toCam.z).toBeLessThan(0);
        expect(meleeCamera(attacker, victim, boxes, cam.side).side).toBe(cam.side);
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(framed / checked).toBeGreaterThan(0.8);
    t.host.dispose();
  });

  it('recording cost: a snapshot and an event take microseconds', async () => {
    const t = await setup();
    await t.frames(240);
    const d = new KillcamDirector(() => 1);
    const snaps = t.director.rec.snaps;
    const n = 20000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      const r = snaps[i % snaps.length]!;
      d.rec.snapshot({ ...r, st: i * 50 });
      d.rec.event({ k: 'swing', id: i, a: 2, w: 0, tm: i * 50 - 10 }, i * 50);
    }
    const us = ((performance.now() - t0) / n) * 1000;
    // Reported in the docs; generous bound for slow CI.
    expect(us).toBeLessThan(50);
    console.log(`killcam recording: ${us.toFixed(2)} µs per snapshot + event; held ${JSON.stringify(d.rec.size)}`);
    t.host.dispose();
  });
});
