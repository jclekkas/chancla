import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ChanclaSystem, type Chancla, type HitTarget } from '../src/game/chanclas';
import { box } from '../src/physics/collision';
import { CHANCLA, SIM_DT } from '../src/config';

function setup() {
  const log = { hits: [] as Array<{ target: number; throwId: number }>, bounces: 0, lands: 0, ends: 0, catches: 0, blocked: 0 };
  let valid = true;
  const sys = new ChanclaSystem({
    onHit: (c, t) => { log.hits.push({ target: t.id, throwId: c.throwId }); return valid; },
    onBounce: () => { log.bounces++; },
    onBlocked: () => { log.blocked++; },
    onLand: () => { log.lands++; },
    onFlightEnd: () => { log.ends++; },
    onCatch: () => { log.catches++; },
    onSplash: () => {},
  });
  return { sys, log, setValid: (v: boolean) => { valid = v; } };
}

const hand = new THREE.Vector3(0, 1.3, 0);

function run(sys: ChanclaSystem, seconds: number, colliders = [] as ReturnType<typeof box>[], targets: HitTarget[] = [], handPos = hand) {
  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps; i++) sys.step(SIM_DT, handPos, colliders, targets);
}

function throwAt(sys: ChanclaSystem, dir: THREE.Vector3, speed = CHANCLA.quickSpeed, charge = 0): Chancla | null {
  return sys.throwReal(new THREE.Vector3(0, 1.5, 0), dir.clone().normalize().multiplyScalar(speed), charge);
}

describe('chancla lifecycle', () => {
  it('starts with two held chanclas and cannot throw a third', () => {
    const { sys } = setup();
    expect(sys.heldCount()).toBe(2);
    expect(throwAt(sys, new THREE.Vector3(0, 0, -1))).not.toBeNull();
    run(sys, 0.2);
    expect(throwAt(sys, new THREE.Vector3(0, 0, -1))).not.toBeNull();
    run(sys, 0.2);
    expect(sys.heldCount()).toBe(0);
    expect(throwAt(sys, new THREE.Vector3(0, 0, -1))).toBeNull();
  });

  it('ricochets exactly once off a solid wall, then returns home', () => {
    const { sys, log } = setup();
    const walls = [box(-10, 0, -6, 10, 5, -5), box(-10, 0, 4, 10, 5, 5)];
    const c = throwAt(sys, new THREE.Vector3(0, 0.05, -1), 40)!;
    run(sys, 0.5, walls);
    expect(log.bounces).toBe(1);
    expect(c.ricocheted).toBe(true);
    run(sys, 4, walls);
    expect(log.bounces).toBe(1);
    expect(c.state).toBe('held');
    expect(log.catches).toBe(1);
  });

  it('never passes through a wall even at charged speed', () => {
    const { sys } = setup();
    const wall = [box(-10, 0, -8.1, 10, 5, -8)];
    const c = throwAt(sys, new THREE.Vector3(0, 0, -1), CHANCLA.chargedSpeed, 1)!;
    let minZ = 0;
    for (let i = 0; i < 40; i++) {
      sys.step(SIM_DT, hand, wall, []);
      if (c.state === 'flying') minZ = Math.min(minZ, c.pos.z);
    }
    expect(minZ).toBeGreaterThan(-8.1);
  });

  it('damages each target at most once per throw', () => {
    const { sys, log } = setup();
    // Target stands in the path for the whole flight.
    const target: HitTarget = { id: 7, kind: 'enemy', x: 0, z: -6, y0: 0, y1: 3, r: 0.5, shield: null };
    throwAt(sys, new THREE.Vector3(0, 0, -1));
    run(sys, 3, [], [target]);
    expect(log.hits.filter((h) => h.target === 7)).toHaveLength(1);
  });

  it('an invalid hit (target already down) does not stop the flight or count', () => {
    const { sys, log, setValid } = setup();
    setValid(false);
    const target: HitTarget = { id: 3, kind: 'enemy', x: 0, z: -4, y0: 0, y1: 3, r: 0.5, shield: null };
    const c = throwAt(sys, new THREE.Vector3(0, 0, -1))!;
    run(sys, 0.3, [], [target]);
    expect(log.hits).toHaveLength(1);
    expect(c.hitAny).toBe(false);
  });

  it('returns after maximum range and reliably reaches a moving player', () => {
    const { sys, log } = setup();
    const c = throwAt(sys, new THREE.Vector3(0, 0.3, -1), CHANCLA.chargedSpeed, 1)!;
    const moving = hand.clone();
    for (let i = 0; i < 400 && c.state !== 'held'; i++) {
      moving.x += 6.4 * SIM_DT; // player strafing at full speed
      sys.step(SIM_DT, moving, [], []);
    }
    expect(c.state).toBe('held');
    expect(log.ends).toBe(1);
  });

  it('manual recall ends the flight immediately', () => {
    const { sys, log } = setup();
    const c = throwAt(sys, new THREE.Vector3(0, 0, -1))!;
    run(sys, 0.1);
    expect(sys.recallAll()).toBe(1);
    expect(c.state).toBe('returning');
    expect(log.ends).toBe(1);
    run(sys, CHANCLA.returnTimeout + 0.1);
    expect(c.state).toBe('held');
  });

  it('a returning chancla snaps home even if the hand is unreachable', () => {
    const { sys } = setup();
    const c = throwAt(sys, new THREE.Vector3(0, 0, -1))!;
    sys.recallAll();
    run(sys, CHANCLA.returnTimeout + 0.05, [], [], new THREE.Vector3(9999, 1, 9999));
    expect(c.state).toBe('held');
  });

  it('deflects off the boss shield without registering a hit', () => {
    const { sys, log } = setup();
    const boss: HitTarget = { id: 9000, kind: 'boss', x: 0, z: -10, y0: 0, y1: 4, r: 1, shield: { x: 0, y: 1.5, z: -10, r: 2 } };
    throwAt(sys, new THREE.Vector3(0, 0, -1));
    run(sys, 1, [], [boss]);
    expect(log.blocked).toBeGreaterThanOrEqual(1);
    expect(log.hits).toHaveLength(0);
  });

  it('golden chanclas expire instead of returning', () => {
    const { sys } = setup();
    const g = sys.throwGolden(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, 0, -50))!;
    expect(g).not.toBeNull();
    run(sys, 2);
    expect(g.state).toBe('idle');
    expect(sys.heldCount()).toBe(2);
    expect(sys.activeCount()).toBe(0);
  });

  it('reset puts every chancla back in hand', () => {
    const { sys } = setup();
    throwAt(sys, new THREE.Vector3(0, 0, -1));
    sys.throwGolden(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
    sys.reset();
    expect(sys.heldCount()).toBe(2);
    expect(sys.activeCount()).toBe(0);
  });
});
