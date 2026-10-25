// @vitest-environment jsdom
// A brief primary press. On a slow frame (software rendering, a busy phone)
// the key can go down and up between two input samples, so the held state
// alone never shows it: Classic dropped that throw (the intermittent
// "Classic throws" browser check with a 150 ms press). The press is latched
// and reaches the game as one tick of fire. Whether it throws is still the
// game's call: a ready chancla throws, a cooling one is legally refused, and
// a latched press never adds a second throw.
import { describe, expect, it } from 'vitest';
import { FpsInput } from '../src/fps/input';
import { LocalHost } from '../src/net/local';
import { GameSession, type LocalInput } from '../src/net/session';
import { WEAPONS } from '../shared/config';
import type { SimEvent } from '../shared/sim';

const key = (type: 'keydown' | 'keyup', code: string) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
const flushMicro = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const IDLE: LocalInput = { mx: 0, mz: 0, yaw: 0, pitch: 0, fire: false, jump: false, crouch: false, weapon: 0 };

describe('a primary press between two samples', () => {
  it('the input keeps it as a press although nothing is held by the next sample', () => {
    document.body.innerHTML = '<div id="stage"></div>';
    const input = new FpsInput(document.getElementById('stage')!);
    input.enabled = true;
    key('keydown', 'KeyF');
    key('keyup', 'KeyF');
    const c = input.sample();
    expect(c.fire).toBe(false); // the held state alone misses it
    expect(c.firePress).toBe(true);
    expect(input.sample().firePress).toBe(false); // once
    input.dispose();
  });

  it('Classic: it throws when the chancla is ready, is refused while cooling, and never doubles', async () => {
    const host = new LocalHost();
    clearInterval((host as unknown as { timer: ReturnType<typeof setInterval> }).timer);
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
    const me = room.sim!.players.get(s.id)!;
    me.protectedUntil = 0;
    const play = async (inp: LocalInput, n = 1) => { for (let i = 0; i < n; i++) { s.tick(inp); s.flush(); await tick(); } };
    const throws = () => events.filter((e) => e.k === 'throw' && e.o === s.id).length;
    await play(IDLE, 10);
    expect(me.cooldownMs).toBe(0);
    // Accepted: ready, alive, input on, outside cooldown.
    await play({ ...IDLE, firePress: true });
    await play(IDLE, 5);
    expect(throws()).toBe(1);
    expect(me.stats.throws).toBe(1);
    // Refused, legally: the same brief press while the chancla is cooling.
    expect(me.cooldownMs).toBeGreaterThan(0);
    await play({ ...IDLE, firePress: true });
    await play(IDLE, 5);
    expect(me.stats.throws).toBe(1);
    // A press with the button still held on the same tick is one throw, not two.
    await play(IDLE, Math.ceil(WEAPONS[0]!.cooldownMs / (1000 / 60)) + 2);
    await play({ ...IDLE, fire: true, firePress: true });
    await play(IDLE, 5);
    expect(me.stats.throws).toBe(2);
  });
});
