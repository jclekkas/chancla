// @vitest-environment jsdom
// Name tags: distance tiers, screen-space declutter and cheap DOM updates.
import { describe, expect, it, beforeEach } from 'vitest';
import * as THREE from 'three';
import { declutterPlates, plateTier, PLATE_NEAR, PLATE_FAR, Hud } from '../src/fps/hud';

describe('plateTier', () => {
  it('near, mid and far by distance', () => {
    expect(plateTier(4)).toBe(0);
    expect(plateTier(PLATE_NEAR + 2)).toBe(1);
    expect(plateTier(PLATE_FAR + 2)).toBe(2);
  });
  it('holds the current tier just past a boundary (no flicker)', () => {
    expect(plateTier(PLATE_NEAR + 0.5, 0)).toBe(0);
    expect(plateTier(PLATE_NEAR + 2, 0)).toBe(1);
    expect(plateTier(PLATE_FAR - 0.5, 2)).toBe(2);
    expect(plateTier(PLATE_FAR + 0.5, 1)).toBe(1);
  });
});

describe('declutterPlates', () => {
  const tag = (id: number, x: number, y: number, d: number, enemy = false) => ({ id, x, y, w: 100, h: 18, d, enemy });

  it('leaves separate tags at their anchors', () => {
    const out = declutterPlates([tag(0, 100, 100, 5), tag(1, 400, 100, 8)]);
    expect(out[0]).toEqual({ id: 0, left: 50, top: 82, dim: false });
    expect(out[1]).toEqual({ id: 1, left: 350, top: 82, dim: false });
  });

  it('keeps the nearer tag in place and lifts the farther one above it', () => {
    const out = declutterPlates([tag(0, 110, 100, 20), tag(1, 100, 104, 6)]);
    expect(out[1]!.top).toBe(104 - 18);
    expect(out[1]!.dim).toBe(false);
    expect(out[0]!.dim).toBe(false);
    expect(out[0]!.top + 18).toBeLessThanOrEqual(out[1]!.top - 2);
  });

  it('gives an opponent priority over a slightly nearer teammate', () => {
    const out = declutterPlates([tag(0, 100, 100, 9), tag(1, 100, 100, 10, true)]);
    expect(out[1]!.top).toBe(82); // the opponent keeps its anchor
    expect(out[0]!.top).toBeLessThan(82);
  });

  it('fades a tag that cannot find room after the allowed lifts', () => {
    const many = [0, 1, 2, 3].map((i) => tag(i, 100, 100, 5 + i));
    const out = declutterPlates(many, { maxLift: 2 });
    expect(out.filter((o) => o.dim).map((o) => o.id)).toEqual([3]);
    // No two undimmed tags overlap.
    const kept = out.filter((o) => !o.dim);
    for (const a of kept) for (const b of kept) if (a !== b) expect(Math.abs(a.top - b.top)).toBeGreaterThanOrEqual(18);
  });
});

describe('Hud.placeLabels', () => {
  let hud: Hud;
  const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 200);
  beforeEach(() => {
    document.body.innerHTML = '<div id="hud"><div id="names"></div><div id="hud-practice" hidden></div><div id="hud-rules" hidden></div></div>';
    hud = new Hud();
    cam.position.set(0, 1.6, 0);
    cam.lookAt(0, 1.6, -10);
    cam.updateMatrixWorld();
  });
  const p = (id: number, z: number, team: number, extra: Partial<{ name: string; bot: boolean; visible: boolean }> = {}) =>
    ({ id, name: extra.name ?? `P${id}`, team, pos: new THREE.Vector3(0, 2, z), hp: 80, visible: extra.visible ?? true, bot: extra.bot ?? false });

  it('one element with four children per tag; role glyph and word near, glyph only far', () => {
    hud.placeLabels(cam, 1280, 720, [p(1, -5, 0), p(2, -40, 1, { bot: true })], 0.016, 0);
    const tags = document.querySelectorAll<HTMLElement>('#names .nameplate');
    expect(tags.length).toBe(2);
    expect(tags[0]!.children.length).toBe(4);
    expect(tags[0]!.className).toContain('ally');
    expect(tags[0]!.className).toContain('t0');
    expect(tags[0]!.querySelector('.role')!.textContent).toBe('◆ ALLY');
    expect(tags[1]!.className).toContain('enemy');
    expect(tags[1]!.className).toContain('t2');
    expect(tags[1]!.querySelector('.role')!.textContent).toBe('✖');
    expect(tags[1]!.querySelector('.n')!.textContent).toBe('☾ P2');
    expect(tags[1]!.querySelector('.bot')!.textContent).toBe('BOT');
  });

  it('does not rewrite unchanged text or transforms on the next frame', () => {
    hud.placeLabels(cam, 1280, 720, [p(1, -5, 0)], 0.016, 0);
    const el = document.querySelector<HTMLElement>('#names .nameplate')!;
    const n = el.querySelector('.n')!.firstChild;
    const tx = el.style.transform;
    let writes = 0;
    const obs = new MutationObserver((m) => (writes += m.length));
    obs.observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
    hud.placeLabels(cam, 1280, 720, [p(1, -5, 0)], 0.016, 0);
    return Promise.resolve().then(() => {
      obs.disconnect();
      expect(writes).toBe(0);
      expect(el.querySelector('.n')!.firstChild).toBe(n);
      expect(el.style.transform).toBe(tx);
    });
  });

  it('hides tags out of sight and reports only visible ones to the cafecito hint', () => {
    hud.placeLabels(cam, 1280, 720, [p(1, -5, 0), p(2, -8, 1, { visible: false })], 0.016, 0);
    const tags = document.querySelectorAll<HTMLElement>('#names .nameplate');
    expect(tags[1]!.style.display).toBe('none');
    // jsdom has no layout (zero sizes), so no rect is reported; the point is that nothing throws and hidden tags are skipped.
    expect(hud.nameRects().length).toBe(0);
  });
});

describe('mode line', () => {
  it('practice and melee-only share one line that hides when neither applies', () => {
    document.body.innerHTML = '<div id="hud"><div id="names"></div><div id="hud-modes" hidden><div id="hud-practice" hidden></div><div id="hud-rules" hidden></div></div></div>';
    const hud = new Hud();
    const box = document.getElementById('hud-modes')!;
    hud.setRules('classic', false);
    expect(box.hidden).toBe(true);
    hud.setRules('melee', true);
    expect(box.hidden).toBe(false);
    expect(document.getElementById('hud-rules')!.hidden).toBe(false);
    hud.setRules('classic', false);
    expect(box.hidden).toBe(true);
  });

  it('the touch Scores button reflects whether the scoreboard is open', () => {
    document.body.innerHTML = '<div id="hud"><div id="names"></div><div id="scoreboard" hidden></div><div id="sb-body"></div><button id="ft-score" aria-pressed="false"></button></div>';
    const hud = new Hud();
    hud.scoreboard(true, null, new Map(), 1);
    expect(document.getElementById('ft-score')!.getAttribute('aria-pressed')).toBe('true');
    hud.scoreboard(false, null, new Map(), 1);
    expect(document.getElementById('ft-score')!.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('declutterPlates and fixed HUD pieces', () => {
  it('slides a tag out from under the minimap, staying on screen', () => {
    const minimap = { left: 12, top: 60, right: 116, bottom: 133 };
    const [o] = declutterPlates([{ id: 0, x: 60, y: 110, w: 120, h: 18, d: 3, enemy: false }], { obstacles: [minimap], vw: 844 });
    expect(o!.left).toBeGreaterThanOrEqual(minimap.right);
    expect(o!.dim).toBe(false);
  });
});
