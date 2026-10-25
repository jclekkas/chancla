import { describe, expect, it } from 'vitest';
import { CENTRE_CLEAR, pickCafecitoGuide, placeCafeLabel } from '../src/fps/cafecito';

// Facing north (yaw 0): forward is -z.
const me = (o: Partial<{ x: number; y: number; z: number; yaw: number; hp: number; maxHp: number; alive: boolean }> = {}) =>
  ({ x: 0, y: 1.58, z: 0, yaw: 0, hp: 50, maxHp: 100, alive: true, ...o });
const cup = (x: number, z: number, ready = true) => ({ x, y: 0, z, ready });
const clear = () => true;

describe('pickCafecitoGuide', () => {
  it('says walk over when hurt and the cup is ready, close and in sight', () => {
    expect(pickCafecitoGuide(me(), [cup(0, -5)], clear)).toEqual({ i: 0, state: 'walk' });
  });

  it('says health full at maximum health', () => {
    expect(pickCafecitoGuide(me({ hp: 100 }), [cup(0, -5)], clear)).toEqual({ i: 0, state: 'full' });
  });

  it('says unavailable while the cup recharges', () => {
    expect(pickCafecitoGuide(me(), [cup(0, -5, false)], clear)).toEqual({ i: 0, state: 'unavailable' });
    expect(pickCafecitoGuide(me({ hp: 100 }), [cup(0, -5, false)], clear)?.state).toBe('unavailable');
  });

  it('is null behind a wall, behind you, out of range, or when you are down', () => {
    expect(pickCafecitoGuide(me(), [cup(0, -5)], () => false)).toBeNull();
    expect(pickCafecitoGuide(me(), [cup(0, 5)], clear)).toBeNull();
    expect(pickCafecitoGuide(me(), [cup(6, 0)], clear)).toBeNull(); // straight to the side
    expect(pickCafecitoGuide(me(), [cup(0, -8.5)], clear)).toBeNull();
    expect(pickCafecitoGuide(me(), [cup(0, -8.5)], clear, { range: 10 })).toEqual({ i: 0, state: 'walk' });
    expect(pickCafecitoGuide(me({ alive: false }), [cup(0, -5)], clear)).toBeNull();
  });

  it('follows the facing for other yaws', () => {
    // yaw -pi/2 faces east (+x).
    expect(pickCafecitoGuide(me({ yaw: -Math.PI / 2 }), [cup(5, 0)], clear)?.i).toBe(0);
    expect(pickCafecitoGuide(me({ yaw: -Math.PI / 2 }), [cup(-5, 0)], clear)).toBeNull();
    expect(pickCafecitoGuide(me({ yaw: Math.PI }), [cup(0, 5)], clear)?.i).toBe(0);
  });

  it('still names a cup right underfoot', () => {
    expect(pickCafecitoGuide(me(), [cup(0, 0.6)], clear)?.i).toBe(0);
  });

  it('picks the nearest qualifying cup', () => {
    expect(pickCafecitoGuide(me(), [cup(0, -7), cup(1, -3), cup(0, 2)], clear)?.i).toBe(1);
    // The nearer one is hidden: the farther, visible one wins.
    const los = (_a: unknown, b: { x: number }) => b.x !== 1;
    expect(pickCafecitoGuide(me(), [cup(0, -7), cup(1, -3)], los)?.i).toBe(0);
  });

  it('tests sight from the eye to the cup, not the floor', () => {
    let seen: { from: { y: number }; to: { y: number } } | null = null;
    pickCafecitoGuide(me(), [cup(0, -4)], (from, to) => { seen = { from, to }; return true; });
    expect(seen!.from.y).toBeCloseTo(1.58, 6);
    expect(seen!.to.y).toBeGreaterThan(0.5);
  });
});

describe('placeCafeLabel', () => {
  const vw = 1280, vh = 720, lw = 220, lh = 26;
  const overlapsCentre = (p: { left: number; top: number }) =>
    p.left < vw / 2 + CENTRE_CLEAR.hx && p.left + lw > vw / 2 - CENTRE_CLEAR.hx && p.top < vh / 2 + CENTRE_CLEAR.hy && p.top + lh > vh / 2 - CENTRE_CLEAR.hy;

  it('sits centred above the cup', () => {
    const p = placeCafeLabel(300, 500, lw, lh, vw, vh);
    expect(p.left).toBeCloseTo(300 - lw / 2, 6);
    expect(p.top + lh).toBeLessThan(500);
  });

  it('never covers the crosshair', () => {
    for (const [x, y] of [[640, 360], [640, 400], [600, 420], [700, 330], [640, 300]] as const) {
      const p = placeCafeLabel(x, y, lw, lh, vw, vh);
      expect(overlapsCentre(p), `${x},${y}`).toBe(false);
    }
  });

  it('stays inside the screen and the safe area', () => {
    const safe = { t: 30, r: 44, b: 20, l: 44 };
    for (const [x, y] of [[-200, -100], [5000, 5000], [0, 360], [1280, 0]] as const) {
      const p = placeCafeLabel(x, y, lw, lh, vw, vh, safe);
      expect(p.left).toBeGreaterThanOrEqual(safe.l);
      expect(p.left + lw).toBeLessThanOrEqual(vw - safe.r);
      expect(p.top).toBeGreaterThanOrEqual(safe.t);
      expect(p.top + lh).toBeLessThanOrEqual(vh - safe.b);
    }
  });

  it('copes with a small phone in landscape', () => {
    const w = 640, h = 320;
    const p = placeCafeLabel(w / 2, h / 2 + 10, 180, 22, w, h, { t: 0, r: 30, b: 12, l: 30 });
    const hit = p.left < w / 2 + CENTRE_CLEAR.hx && p.left + 180 > w / 2 - CENTRE_CLEAR.hx && p.top < h / 2 + CENTRE_CLEAR.hy && p.top + 22 > h / 2 - CENTRE_CLEAR.hy;
    expect(hit).toBe(false);
    expect(p.left).toBeGreaterThanOrEqual(30);
    expect(p.left + 180).toBeLessThanOrEqual(w - 30);
  });
});

describe('buildCafecito', () => {
  it('shows the cup when ready and an empty saucer with a progress arc while recharging', async () => {
    const { buildCafecito } = await import('../src/fps/render/cafecito-model');
    const c = buildCafecito();
    const [spin, ring, arc] = c.group.children as [import('three').Group, import('three').Mesh, import('three').Mesh];
    const full = spin.children[0]!;
    c.setState(true, 1, 0);
    expect(full.visible).toBe(true);
    expect(arc.visible).toBe(false);
    const ringReady = ring.material;
    c.setState(false, 1.1, 0.5);
    expect(full.visible).toBe(false);
    expect(spin.children[1]!.visible).toBe(true); // the saucer stays
    expect(arc.visible).toBe(true);
    expect(ring.material).not.toBe(ringReady);
    expect(arc.geometry.drawRange.count).toBe(16 * 6);
    c.setState(false, 1.2, 1);
    expect(arc.geometry.drawRange.count).toBe(32 * 6);
    c.setState(true, 2, 0);
    expect(full.visible).toBe(true);
    c.dispose();
    expect(c.group.parent).toBeNull();
  });
});
