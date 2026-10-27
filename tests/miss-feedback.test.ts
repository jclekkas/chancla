// Your own confirmed miss: what it shows depends on when the server's
// 'whiff' event arrives relative to your swing in hand. It never replays
// the swing: a late event fades the overrun out, a stale one or one for an
// older swing shows nothing.
import { describe, expect, it } from 'vitest';
import { MELEE } from '../shared/config';
import { MISS_FULL_MS, MISS_MARK_MAX_MS, MISS_MOTION_MAX_MS, OwnSwingLog, missFeedback } from '../src/fps/miss-feedback';

const end = (w: 0 | 1) => MELEE[w]!.windupMs + MELEE[w]!.activeMs;

describe('own miss feedback', () => {
  for (const w of [0, 1] as const) {
    it(`full overrun and the mark when the miss arrives promptly (${w === 1 ? 'El Revés' : 'El Chanclazo'})`, () => {
      expect(missFeedback(w, w, end(w) + 10)).toEqual({ motion: 1, mark: true });
      expect(missFeedback(w, w, end(w) + MISS_FULL_MS)).toEqual({ motion: 1, mark: true });
    });

    it(`fades the overrun with lateness, then keeps only the mark, then nothing (${w})`, () => {
      const mid = missFeedback(w, w, end(w) + (MISS_FULL_MS + MISS_MOTION_MAX_MS) / 2);
      expect(mid.motion).toBeCloseTo(0.5, 5);
      expect(mid.mark).toBe(true);
      expect(missFeedback(w, w, end(w) + MISS_MOTION_MAX_MS + 50)).toEqual({ motion: 0, mark: true });
      expect(missFeedback(w, w, end(w) + MISS_MARK_MAX_MS + 1)).toEqual({ motion: 0, mark: false });
    });

    it(`shows nothing for a miss that cannot be the swing in hand (${w})`, () => {
      // A newer swing has started: it has not reached the end of its contact window.
      expect(missFeedback(w, w, end(w) - 20)).toEqual({ motion: 0, mark: false });
      // A different chancla, no swing at all, or a stale event.
      expect(missFeedback(w, w === 1 ? 0 : 1, end(w) + 10)).toEqual({ motion: 0, mark: false });
      expect(missFeedback(w, null, end(w) + 10)).toEqual({ motion: 0, mark: false });
      expect(missFeedback(w, w, Infinity)).toEqual({ motion: 0, mark: false });
      expect(missFeedback(w, w, 60_000)).toEqual({ motion: 0, mark: false });
    });
  }

  it('the overrun strength never increases with lateness', () => {
    let prev = 2;
    for (let late = 0; late <= MISS_MARK_MAX_MS; late += 5) {
      const m = missFeedback(1, 1, end(1) + late).motion;
      expect(m).toBeLessThanOrEqual(prev);
      prev = m;
    }
  });
});

describe('own miss correlation (swing ids)', () => {
  // Local clock (ms) and server clock (tm) are unrelated; the server clock
  // here starts at 50 000. A swing's whiff comes at its start + the window.
  const win = (w: 0 | 1) => MELEE[w]!.windupMs + MELEE[w]!.activeMs;
  const TM0 = 50_000, NET = 40; // one-way delay for the examples

  for (const w of [0, 1] as const) {
    it(`a prompt miss of the swing in hand shows in full (${w === 1 ? 'El Revés' : 'El Chanclazo'})`, () => {
      const log = new OwnSwingLog();
      log.localStart(w, 0);
      log.serverSwing(7, w, TM0, NET * 2);
      expect(log.miss(7, w, TM0 + win(w), win(w) + NET * 2, w)).toEqual({ motion: 1, mark: true });
    });
  }

  it('the counterexample: A starts at 0 ms, B at 700 ms, A\'s delayed miss arrives at 1000 ms: nothing shows', () => {
    const log = new OwnSwingLog();
    log.localStart(0, 0); // A
    log.serverSwing(1, 0, TM0, 60);
    log.localStart(0, 700); // B (same chancla)
    log.serverSwing(2, 0, TM0 + 700, 760);
    expect(log.miss(1, 0, TM0 + win(0), 1000, 0)).toEqual({ motion: 0, mark: false });
    // B's own miss, when it comes, is still shown, timed from B.
    expect(log.miss(2, 0, TM0 + 700 + win(0), 700 + win(0) + 80, 0)).toEqual({ motion: 1, mark: true });
  });

  it('the same, with A\'s swing event also delayed past B\'s press: still nothing for A', () => {
    const log = new OwnSwingLog();
    log.localStart(0, 0);
    log.localStart(0, 700);
    log.serverSwing(1, 0, TM0, 980);
    expect(log.miss(1, 0, TM0 + win(0), 1000, 0)).toEqual({ motion: 0, mark: false });
  });

  it('a miss from an unknown or already-resolved swing, or a resent one, shows nothing', () => {
    const log = new OwnSwingLog();
    log.localStart(1, 0);
    log.serverSwing(5, 1, TM0, 50);
    expect(log.miss(99, 1, TM0 + win(1), 400, 1)).toEqual({ motion: 0, mark: false });
    expect(log.miss(5, 1, TM0 + win(1), 450, 1).mark).toBe(true);
    expect(log.miss(5, 1, TM0 + win(1), 460, 1)).toEqual({ motion: 0, mark: false }); // a second copy
    log.localStart(1, 2000);
    log.serverSwing(6, 1, TM0 + 2000, 2050);
    log.settled(6); // it hit
    expect(log.miss(6, 1, TM0 + 2000 + win(1), 2450, 1)).toEqual({ motion: 0, mark: false });
  });

  it('uncertain correspondence is suppressed: another chancla, out-of-step events, timestamps that disagree', () => {
    const a = new OwnSwingLog();
    a.localStart(0, 0);
    a.serverSwing(1, 1, TM0, 50); // the server swung La Pesada: not this press
    expect(a.miss(1, 1, TM0 + win(1), 450, 1)).toEqual({ motion: 0, mark: false });
    const b = new OwnSwingLog();
    b.serverSwing(1, 0, TM0, 50); // a server swing with no local press
    b.localStart(0, 100);
    expect(b.miss(1, 0, TM0 + win(0), 300, 0)).toEqual({ motion: 0, mark: false });
    const c = new OwnSwingLog();
    c.localStart(0, 0);
    c.serverSwing(1, 0, TM0, 50);
    expect(c.miss(1, 0, TM0 + win(0) + 400, 300, 0)).toEqual({ motion: 0, mark: false }); // whiff time not at the window's end
    // A press that expired unconfirmed (rejected, or its confirmation is
    // very late): the next server swing is not assumed to be the later
    // press; that one swing goes without a cue, and the log starts afresh.
    const d = new OwnSwingLog();
    d.localStart(0, 0);
    d.localStart(0, 1500);
    d.serverSwing(1, 0, TM0, 1550);
    expect(d.miss(1, 0, TM0 + win(0), 1550 + win(0), 0)).toEqual({ motion: 0, mark: false });
    d.localStart(0, 3000);
    d.serverSwing(2, 0, TM0 + 3000, 3040);
    expect(d.miss(2, 0, TM0 + 3000 + win(0), 3040 + win(0), 0)).toEqual({ motion: 1, mark: true });
  });

  it('expiry boundary: A at 0 ms, B at 700 ms, A\'s confirmation at 1050 ms and its miss at 1100 ms: nothing, for A or B', () => {
    const log = new OwnSwingLog();
    log.localStart(0, 0); // A
    log.localStart(0, 700); // B
    log.serverSwing(1, 0, TM0, 1050); // A's, late: A has expired
    expect(log.miss(1, 0, TM0 + win(0), 1100, 0)).toEqual({ motion: 0, mark: false });
    // B's own confirmation then finds nothing to match (the log started afresh): no cue rather than a guess.
    log.serverSwing(2, 0, TM0 + 700, 1120);
    expect(log.miss(2, 0, TM0 + 700 + win(0), 1150, 0)).toEqual({ motion: 0, mark: false });
    // Normal feedback resumes with the next press.
    log.localStart(0, 2000);
    log.serverSwing(3, 0, TM0 + 2000, 2040);
    expect(log.miss(3, 0, TM0 + 2000 + win(0), 2040 + win(0), 0)).toEqual({ motion: 1, mark: true });
  });

  it('a newly equipped chancla gets no cue from the old one', () => {
    const log = new OwnSwingLog();
    log.localStart(0, 0);
    log.serverSwing(1, 0, TM0, 40);
    expect(log.miss(1, 0, TM0 + win(0), win(0) + 40, 1)).toEqual({ motion: 0, mark: false });
  });

  it('nothing survives a reset (death, respawn, a new round)', () => {
    const log = new OwnSwingLog();
    log.localStart(1, 0);
    log.serverSwing(3, 1, TM0, 40);
    log.reset();
    expect(log.miss(3, 1, TM0 + win(1), win(1) + 40, 1)).toEqual({ motion: 0, mark: false });
    log.localStart(1, 100); // a pending press also goes
    log.reset();
    log.serverSwing(4, 1, TM0 + 200, 240);
    expect(log.miss(4, 1, TM0 + 200 + win(1), 300 + win(1), 1)).toEqual({ motion: 0, mark: false });
  });

  it('a miss that arrives before the local swing reaches its window end (the press registered a frame late) is prompt', () => {
    const log = new OwnSwingLog();
    log.localStart(0, 0);
    log.serverSwing(9, 0, TM0, 20);
    expect(log.miss(9, 0, TM0 + win(0), win(0) - 60, 0)).toEqual({ motion: 1, mark: true });
  });

  it('a late miss of the swing in hand fades, timed from that swing', () => {
    const log = new OwnSwingLog();
    log.localStart(1, 0);
    log.serverSwing(8, 1, TM0, 200);
    const f = log.miss(8, 1, TM0 + win(1), win(1) + 300, 1);
    expect(f.mark).toBe(true);
    expect(f.motion).toBeCloseTo(0.5, 5);
  });
});

describe('the first-person miss cue', () => {
  it('ends when the chancla changes, on death, and on cancel (respawn, a new round)', async () => {
    const { ViewModel } = await import('../src/fps/render/viewmodel');
    const view = (weapon: 0 | 1, alive = true) => ({ weapon, cooldownMs: 0, switchMs: 0, speed: 0, onGround: true, crouched: false, alive, msSinceThrow: 1e6, msSinceMelee: 1e6, meleeWeapon: null });
    const active = (vm: InstanceType<typeof ViewModel>) => (vm as unknown as { miss: { t: number } }).miss.t < 0.5;
    const vm = new ViewModel();
    vm.whiff(0, 1); vm.update(view(0), 1 / 60, false);
    expect(active(vm)).toBe(true);
    vm.update(view(1), 1 / 60, false); // switched to La Pesada
    expect(active(vm)).toBe(false);
    vm.whiff(1, 1); vm.update(view(1), 1 / 60, false);
    vm.update(view(1, false), 1 / 60, false); // eliminated
    expect(active(vm)).toBe(false);
    vm.whiff(1, 1); vm.cancelMiss(); vm.update(view(1), 1 / 60, false);
    expect(active(vm)).toBe(false);
  });
});
