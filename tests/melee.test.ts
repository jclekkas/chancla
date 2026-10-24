// Close combat in the authoritative simulation: El Chanclazo and El Revés,
// reach and facing, walls, the wind-up, one target per swing, head or body
// by stance, recovery against spam, protection and team rules, and the
// ruleros that come off.
import { describe, expect, it } from 'vitest';
import { MatchSim, BTN, RULEROS_FULL, type PlayerInput, type SimEvent, type SimPlayer } from '../shared/sim';
import { EL_PATIO, b, type MapData } from '../shared/map';
import { MATCH, MELEE, NET, RULEROS, WEAPONS, WEAPON_SWITCH_MS, type WeaponId } from '../shared/config';
import { newBody } from '../shared/physics';
import { meleeContactOne, pickRulero } from '../shared/melee';

const TICK = 1000 / NET.tickRate;
const LEVEL = 0; // eye level: a standing Rosa's face
const CHEST = -0.5; // well down: her body

function setup(map: MapData = EL_PATIO, players: Array<[number, 0 | 1]> = [[1, 0], [2, 1]]) {
  const sim = new MatchSim(map, { countdownMs: 0, seed: 7 });
  const ps = players.map(([id, team]) => sim.addPlayer(id, team));
  for (const p of ps) p.protectedUntil = 0;
  return { sim, ps };
}

// a stands at the origin of the open plaza strip facing +x; b `dist` metres ahead.
function face(a: SimPlayer, v: SimPlayer, dist: number, opts: { side?: number; behind?: boolean } = {}): void {
  a.body = newBody(-3, 0, 3.4);
  a.yaw = -Math.PI / 2;
  const dx = opts.behind ? -dist : dist;
  v.body = newBody(-3 + dx, 0, 3.4 + (opts.side ?? 0));
  v.yaw = Math.PI / 2;
}

let seq = 0;
function inp(p: SimPlayer, over: Partial<PlayerInput> = {}): PlayerInput {
  return { seq: ++seq, mx: 0, mz: 0, yaw: p.yaw, pitch: LEVEL, buttons: 0, weapon: p.weapon, ...over };
}

function run(sim: MatchSim, ms: number, feed?: (tick: number) => void): SimEvent[] {
  const ev: SimEvent[] = [];
  const n = Math.round(ms / TICK);
  for (let i = 0; i < n; i++) { feed?.(i); sim.step(); ev.push(...sim.drainEvents()); }
  return ev;
}

// Presses melee once with the given weapon (switching first, then waiting out the switch).
function swing(sim: MatchSim, a: SimPlayer, weapon: WeaponId, pitch = LEVEL): void {
  if (a.weapon !== weapon) { sim.queueInput(a.id, inp(a, { weapon })); run(sim, WEAPON_SWITCH_MS + 40); }
  sim.queueInput(a.id, inp(a, { weapon, pitch, buttons: BTN.melee }));
}

const hits = (ev: SimEvent[]) => ev.filter((e): e is Extract<SimEvent, { k: 'hit' }> => e.k === 'hit');

describe('melee: El Chanclazo and El Revés', () => {
  it('El Chanclazo hits an opponent in reach for 25, only after its 120 ms wind-up', () => {
    const { sim, ps: [a, v] } = setup();
    face(a!, v!, 1.4);
    swing(sim, a!, 0);
    let ev = run(sim, 110);
    expect(hits(ev)).toHaveLength(0);
    expect(v!.hp).toBe(MATCH.maxHealth);
    ev = run(sim, 120);
    expect(hits(ev)).toHaveLength(1);
    expect(v!.hp).toBe(MATCH.maxHealth - MELEE[0]!.damage);
    const h = hits(ev)[0]!;
    expect(h.m).toBeGreaterThan(0);
    expect(h.w).toBe(0);
    expect(MELEE[0]!.damage).toBe(25);
  });

  it('El Revés hits for 45 after its 300 ms wind-up; a body hit with La Pesada knocks no roller off', () => {
    const { sim, ps: [a, v] } = setup();
    face(a!, v!, 1.4);
    swing(sim, a!, 1, CHEST);
    expect(hits(run(sim, 290))).toHaveLength(0);
    const ev = run(sim, 200);
    const h = hits(ev);
    expect(h).toHaveLength(1);
    expect(h[0]!.d).toBe(45);
    expect(h[0]!.head).toBe(false);
    expect(h[0]!.ru).toBeUndefined();
    expect(v!.ruleros).toBe(RULEROS_FULL);
  });

  it('the sandal never leaves the hand: a swing throws nothing', () => {
    const { sim, ps: [a, v] } = setup();
    face(a!, v!, 1.4);
    swing(sim, a!, 0);
    const ev = run(sim, 800);
    expect(ev.filter((e) => e.k === 'throw')).toHaveLength(0);
    expect(sim.projectiles).toHaveLength(0);
  });

  it('misses past its reach (about 1.5 m to the body), and a missed Revés recovers 300 ms later', () => {
    const { sim, ps: [a, v] } = setup();
    face(a!, v!, 2.4); // 2.4 m centre to centre: about 2 m to her body
    swing(sim, a!, 1);
    const ev = run(sim, 420);
    expect(hits(ev)).toHaveLength(0);
    expect(ev.some((e) => e.k === 'whiff')).toBe(true);
    // Cycle 1100 + whiff 300: still locked at 1300 ms, free by 1420.
    run(sim, 1300 - 420);
    expect(a!.meleeMs).toBeGreaterThan(0);
    run(sim, 120);
    expect(a!.meleeMs).toBe(0);
  });

  it('a missed Chanclazo has no extra recovery', () => {
    const { sim, ps: [a, v] } = setup();
    face(a!, v!, 3);
    swing(sim, a!, 0);
    run(sim, MELEE[0]!.cycleMs + 20);
    expect(a!.meleeMs).toBe(0);
  });

  it('nothing behind her or off to the side gets hit', () => {
    for (const [dist, opts] of [[1.0, { behind: true }], [0.6, { side: 1.6 }]] as const) {
      const { sim, ps: [a, v] } = setup();
      face(a!, v!, dist, opts);
      swing(sim, a!, 0);
      expect(hits(run(sim, 400))).toHaveLength(0);
    }
  });

  it('a wall between them blocks the swing', () => {
    const wall = b(-2.45, 0, 2.2, -2.35, 3, 4.6, 'stuccoCream');
    const map: MapData = { ...EL_PATIO, boxes: [...EL_PATIO.boxes, wall] };
    const { sim, ps: [a, v] } = setup(map);
    face(a!, v!, 1.3); // the wall stands 0.6 m in front of her
    swing(sim, a!, 1);
    const ev = run(sim, 500);
    expect(hits(ev)).toHaveLength(0);
    expect(v!.hp).toBe(MATCH.maxHealth);
  });

  it('stepping out of reach during the wind-up dodges it', () => {
    const { sim, ps: [a, v] } = setup();
    face(a!, v!, 1.4);
    swing(sim, a!, 1);
    run(sim, 200); // wind-up still running (300 ms)
    v!.body = newBody(-3 + 3.2, 0, 3.4);
    const ev = run(sim, 300);
    expect(hits(ev)).toHaveLength(0);
    expect(ev.some((e) => e.k === 'whiff')).toBe(true);
  });

  it('one swing damages one opponent, once, even with two in reach for the whole window', () => {
    const { sim, ps: [a, v, w] } = setup(EL_PATIO, [[1, 0], [2, 1], [3, 1]]);
    face(a!, v!, 1.3);
    w!.body = newBody(-3 + 1.3, 0, 3.4 + 0.75);
    swing(sim, a!, 0);
    const ev = run(sim, 700);
    expect(hits(ev)).toHaveLength(1);
    expect([v!.hp, w!.hp].sort((x, y) => x - y)).toEqual([MATCH.maxHealth - 25, MATCH.maxHealth]);
  });

  it('teammates, protected and eliminated players are not hurt, as with throws', () => {
    // Teammate
    {
      const { sim, ps: [a, v] } = setup(EL_PATIO, [[1, 0], [2, 0]]);
      face(a!, v!, 1.3);
      swing(sim, a!, 0);
      expect(hits(run(sim, 400))).toHaveLength(0);
      expect(v!.hp).toBe(MATCH.maxHealth);
    }
    // Spawn-protected opponent: shielded, no damage; swinging ends her own protection
    {
      const { sim, ps: [a, v] } = setup();
      face(a!, v!, 1.3);
      v!.protectedUntil = sim.timeMs + 5000;
      a!.protectedUntil = sim.timeMs + 5000;
      swing(sim, a!, 1);
      const ev = run(sim, 500);
      expect(hits(ev)).toHaveLength(0);
      expect(ev.some((e) => e.k === 'shielded' && e.m !== undefined)).toBe(true);
      expect(v!.hp).toBe(MATCH.maxHealth);
      expect(a!.protectedUntil).toBe(0);
    }
    // Eliminated
    {
      const { sim, ps: [a, v] } = setup();
      face(a!, v!, 1.3);
      v!.alive = false;
      v!.respawnAt = sim.timeMs + 60_000;
      swing(sim, a!, 0);
      expect(hits(run(sim, 400))).toHaveLength(0);
    }
  });

  it('head or body comes from where the swing meets her, standing, crouching and jumping', () => {
    const cases: Array<{ name: string; pitch: number; crouch?: boolean; y?: number; head: boolean | null }> = [
      { name: 'standing, eye level', pitch: LEVEL, head: true },
      { name: 'standing, aimed at the chest', pitch: CHEST, head: false },
      { name: 'crouching, eye level (over her head)', pitch: LEVEL, crouch: true, head: null },
      { name: 'crouching, aimed down at her face', pitch: -0.55, crouch: true, head: true },
      { name: 'crouching, aimed low', pitch: -0.8, crouch: true, head: false },
      { name: 'jumping, eye level (her body)', pitch: LEVEL, y: 0.6, head: false },
      { name: 'jumping, aimed up at her face', pitch: 0.55, y: 0.6, head: true },
    ];
    for (const c of cases) {
      const { sim, ps: [a, v] } = setup();
      face(a!, v!, 1.25);
      const vb = newBody(v!.body.x, c.y ?? 0, v!.body.z);
      vb.crouched = !!c.crouch;
      const def = MELEE[0]!;
      const eye = { x: a!.body.x, y: a!.body.y + 1.58, z: a!.body.z };
      const h = { id: 2, ...hitboxOfBody(vb) };
      const contact = meleeContactOne(eye, a!.yaw, c.pitch, def, h, sim.world.boxes);
      if (c.head === null) expect(contact, c.name).toBeNull();
      else expect(contact?.head, c.name).toBe(c.head);
    }
  });

  it('throw, melee and switch spam cannot shorten any recovery', () => {
    const { sim, ps: [a, v] } = setup();
    face(a!, v!, 30);
    v!.body = newBody(26, 0, 13);
    const ev = run(sim, 4000, (i) => sim.queueInput(1, inp(a!, { buttons: BTN.melee | BTN.fire, weapon: (Math.floor(i / 30) % 2) as WeaponId })));
    const marks = ev.filter((e) => e.k === 'swing' || e.k === 'throw').map((e) => ({ k: e.k, tm: (e as { tm: number }).tm, w: (e as { w: WeaponId }).w }));
    // Every action starts only after the previous one has fully recovered
    // (the swing's cycle, plus the miss penalty for El Revés).
    for (let i = 1; i < marks.length; i++) {
      const prev = marks[i - 1]!, cur = marks[i]!;
      const need = prev.k === 'swing' ? MELEE[prev.w]!.cycleMs + MELEE[prev.w]!.whiffMs : WEAPONS[prev.w]!.cooldownMs;
      expect(cur.tm - prev.tm + 1e-6, `${prev.k}->${cur.k}`).toBeGreaterThanOrEqual(need);
    }
    // Melee wins a simultaneous press: no throw while swings keep coming.
    expect(marks.filter((m) => m.k === 'throw')).toHaveLength(0);
    expect(marks.length).toBeGreaterThan(2);
  });

  it('a weapon switch asked for mid-swing waits for the swing to end', () => {
    const { sim, ps: [a, v] } = setup();
    face(a!, v!, 3);
    swing(sim, a!, 1);
    run(sim, 50, () => sim.queueInput(1, inp(a!, { weapon: 0 })));
    expect(a!.weapon).toBe(1);
    run(sim, MELEE[1]!.cycleMs + MELEE[1]!.whiffMs, () => sim.queueInput(1, inp(a!, { weapon: 0 })));
    expect(a!.weapon).toBe(0);
  });

  it('a held melee button never repeats; a press just before recovery ends is kept', () => {
    const { sim, ps: [a, v] } = setup();
    face(a!, v!, 3);
    swing(sim, a!, 0);
    run(sim, 2000); // no more presses: one swing only
    expect(a!.stats.swings).toBe(1);
    // A press 100 ms before the end starts the next swing as soon as it can.
    swing(sim, a!, 0);
    run(sim, MELEE[0]!.cycleMs - 100);
    sim.queueInput(1, inp(a!, { buttons: BTN.melee }));
    const ev = run(sim, 200);
    expect(a!.stats.swings).toBe(3);
    const sw = ev.filter((e) => e.k === 'swing');
    expect(sw).toHaveLength(1);
  });

  it('timing is the same whatever the client frame rate (inputs bunched or spread)', () => {
    const result = (bunch: number) => {
      const { sim, ps: [a, v] } = setup();
      face(a!, v!, 1.3);
      const evs: SimEvent[] = [];
      // `bunch` inputs arrive together every `bunch` ticks, as from a slow frame loop.
      let pressed = false;
      for (let t = 0; t < 120; t++) {
        if (t % bunch === 0) {
          for (let k = 0; k < bunch; k++) {
            const press = !pressed && t + k === 6;
            if (press) pressed = true;
            sim.queueInput(1, inp(a!, { buttons: press ? BTN.melee : 0 }));
          }
        }
        sim.step();
        evs.push(...sim.drainEvents());
      }
      const s = evs.find((e) => e.k === 'swing') as { tm: number };
      const h = hits(evs)[0]!;
      return { delay: h.tm! - s.tm, d: h.d, hp: v!.hp };
    };
    const fast = result(1), slow = result(4);
    expect(slow.d).toBe(fast.d);
    expect(slow.hp).toBe(fast.hp);
    expect(slow.delay).toBe(fast.delay);
    expect(fast.delay).toBeGreaterThanOrEqual(MELEE[0]!.windupMs);
    expect(fast.delay).toBeLessThan(MELEE[0]!.windupMs + TICK + 1);
  });
});

describe('ruleros', () => {
  it('an El Revés head hit knocks off exactly one attached roller; a Chanclazo head hit none', () => {
    const { sim, ps: [a, v] } = setup();
    face(a!, v!, 1.3);
    swing(sim, a!, 0);
    let ev = run(sim, 800);
    expect(hits(ev)[0]!.head).toBe(true);
    expect(hits(ev)[0]!.ru).toBeUndefined();
    expect(v!.ruleros).toBe(RULEROS_FULL);
    swing(sim, a!, 1);
    ev = run(sim, 1200);
    const h = hits(ev)[0]!;
    expect(h.head).toBe(true);
    expect(h.ru).toHaveLength(1);
    expect(v!.ruleros & (1 << h.ru![0]!)).toBe(0);
    expect(popcount(v!.ruleros)).toBe(RULEROS.count - 1);
  });

  it('a depleted hairstyle gives nothing more, an El Revés elimination scatters what is left, and respawn restores it', () => {
    const { sim, ps: [a, v] } = setup();
    face(a!, v!, 1.3);
    // Two head hits take two rollers and leave her on 10 hp.
    for (let i = 0; i < 2; i++) { swing(sim, a!, 1); run(sim, 1200); }
    expect(v!.hp).toBe(10);
    expect(popcount(v!.ruleros)).toBe(RULEROS.count - 2);
    swing(sim, a!, 1);
    const ev = run(sim, 1200);
    const h = hits(ev)[0]!, el = ev.find((e) => e.k === 'elim') as Extract<SimEvent, { k: 'elim' }>;
    expect(h.ru).toHaveLength(1);
    expect(el.head).toBe(true);
    expect(el.m).toBe(h.m);
    expect(el.ru).toHaveLength(1); // only one was left to scatter (cap 3)
    expect(v!.ruleros).toBe(0);
    // Each roller came off exactly once.
    const all = ev.concat().flatMap((e) => ('ru' in e && e.ru ? e.ru : []));
    expect(new Set(all).size).toBe(all.length);
    run(sim, MATCH.respawnMs + 100);
    expect(v!.alive).toBe(true);
    expect(v!.ruleros).toBe(RULEROS_FULL);
  });

  it('a rematch gives everyone a full head of rollers again', () => {
    const { sim, ps: [a, v] } = setup();
    face(a!, v!, 1.3);
    swing(sim, a!, 1);
    run(sim, 1200);
    expect(v!.ruleros).not.toBe(RULEROS_FULL);
    sim.restart({ countdownMs: 0 });
    expect(v!.ruleros).toBe(RULEROS_FULL);
  });

  it('only rollers still attached can be picked', () => {
    expect(pickRulero(0b0000, 4, 2)).toBe(-1);
    expect(pickRulero(0b1000, 4, 0)).toBe(3);
    expect(pickRulero(0b0110, 4, 3)).toBe(1);
  });
});

function popcount(n: number): number { let c = 0; while (n) { c += n & 1; n >>= 1; } return c; }

import { hitboxOf } from '../shared/sim';
function hitboxOfBody(bd: ReturnType<typeof newBody>) { return hitboxOf(bd); }
