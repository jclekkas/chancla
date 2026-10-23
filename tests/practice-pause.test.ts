// Practice pause and stale movement. Pausing the practice host mid-stride
// used to freeze Rosa with walking velocity and with inputs already sent but
// not yet simulated; on Resume she carried on walking with no key held (the
// Mac report: "Rosa drifts", after Esc, a menu or switching apps). The pause
// now settles first: neutral input, and every input already sent is used up.
import { describe, expect, it } from 'vitest';
import { LocalHost } from '../src/net/local';
import { GameSession, type LocalInput } from '../src/net/session';

const flushMicro = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

async function walkingThenPause(settle: boolean) {
  const host = new LocalHost();
  clearInterval((host as unknown as { timer: ReturnType<typeof setInterval> }).timer); // the test drives the ticks
  const s = new GameSession(host.transport());
  s.connect('Rosa');
  await flushMicro();
  s.send({ t: 'create', practice: { difficulty: 'easy', allies: 0, enemies: 1 }, map: 'patio' });
  await flushMicro();
  const room = [...host.hub.rooms.values()][0]!;
  s.send({ t: 'start' });
  await flushMicro();
  const tick = (room as unknown as { tick: () => void }).tick.bind(room);
  for (let i = 0; i < 200 && room.sim!.phase !== 'playing'; i++) { tick(); await flushMicro(); }
  for (const m of room.members.values()) if (m.bot) m.brain = null;
  const me = room.sim!.players.get(s.id)!;
  me.body.x = -4; me.body.z = 4; s.body.x = -4; s.body.z = 4;
  const walk: LocalInput = { mx: 0, mz: 1, yaw: 0, pitch: 0, fire: false, jump: false, crouch: false, weapon: 0 };
  // Walk at full speed; the last few inputs are sent but not yet simulated
  // (the host runs on its own timer, so a few are usually waiting).
  for (let i = 0; i < 30; i++) { s.tick(walk); s.flush(); tick(); await flushMicro(); }
  for (let i = 0; i < 6; i++) { s.tick(walk); s.flush(); }
  const queuedAtPause = me.queue.length;
  // The menu opens: input is released.
  if (settle) { s.settle(8); host.settle(); }
  host.pause();
  const at = { x: me.body.x, z: me.body.z };
  host.resume();
  // A second of play with nothing held.
  const idle: LocalInput = { ...walk, mz: 0 };
  for (let i = 0; i < 60; i++) { s.tick(idle); s.flush(); tick(); await flushMicro(); }
  const moved = Math.hypot(me.body.x - at.x, me.body.z - at.z);
  host.dispose();
  return { queuedAtPause, moved };
}

describe('practice pause', () => {
  it('pausing without settling (the old behaviour) leaves her walking on after Resume', async () => {
    const r = await walkingThenPause(false);
    expect(r.queuedAtPause).toBeGreaterThan(0);
    expect(r.moved).toBeGreaterThan(0.2);
  });

  it('a settled pause holds her still: nothing sent before the menu is applied after Resume', async () => {
    const r = await walkingThenPause(true);
    expect(r.queuedAtPause).toBeGreaterThan(0);
    expect(r.moved).toBeLessThan(1e-3);
  });
});
