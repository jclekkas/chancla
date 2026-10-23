// @vitest-environment jsdom
// The shooter's touch controls: independent fingers, cancellation, menus and
// nothing left held. Real FpsInput and FpsTouch on the page's own markup.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FpsInput } from '../src/fps/input';
import { FpsTouch } from '../src/fps/touch';

const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const touchMarkup = html.slice(html.indexOf('<div class="fps-touch"'), html.indexOf('<div class="hud-tr">'));

function ptr(type: string, el: Element, id: number, x: number, y: number): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerId', { value: id });
  Object.defineProperty(e, 'pointerType', { value: 'touch' });
  el.dispatchEvent(e);
}

let input: FpsInput;
let touch: FpsTouch;
const $ = (id: string) => document.getElementById(id)!;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `<div id="stage"></div>${touchMarkup}`;
  input = new FpsInput($('stage'));
  input.enabled = true;
  input.touchMode = true;
  touch = new FpsTouch(input);
  touch.setVisible(true);
  vi.advanceTimersByTime(300); // past the arming delay
  vi.spyOn(performance, 'now').mockReturnValue(1e9);
});

describe('touch controls', () => {
  it('move, look and throw at once, each finger on its own control', () => {
    const y0 = input.yaw;
    ptr('pointerdown', $('ft-move'), 1, 100, 300);
    ptr('pointerdown', $('ft-look'), 2, 600, 200);
    ptr('pointerdown', $('ft-throw'), 3, 780, 330);
    ptr('pointermove', $('ft-move'), 1, 100, 240); // stick forward
    ptr('pointermove', $('ft-look'), 2, 660, 200); // look right
    const c = input.sample();
    expect(c.mz).toBeGreaterThan(0.6);
    expect(Math.abs(c.mx)).toBeLessThan(0.05);
    expect(c.fire).toBe(true);
    expect(input.yaw).toBeLessThan(y0);
    expect(touch.active).toBe(3);
  });

  it('lifting one finger leaves the others alone', () => {
    ptr('pointerdown', $('ft-move'), 1, 100, 300);
    ptr('pointermove', $('ft-move'), 1, 100, 240);
    ptr('pointerdown', $('ft-throw'), 3, 780, 330);
    ptr('pointerup', $('ft-throw'), 3, 780, 330);
    let c = input.sample();
    expect(c.fire).toBe(false);
    expect(c.mz).toBeGreaterThan(0.6); // still walking
    ptr('pointerup', $('ft-move'), 1, 100, 240);
    c = input.sample();
    expect(c.mz).toBe(0);
  });

  it('a second finger never takes over a control another finger holds', () => {
    ptr('pointerdown', $('ft-move'), 1, 100, 300);
    ptr('pointermove', $('ft-move'), 1, 100, 240);
    ptr('pointerdown', $('ft-move'), 5, 200, 300); // ignored
    ptr('pointermove', $('ft-move'), 5, 300, 300); // would steer right
    expect(input.sample().mx).toBe(0);
    const y0 = input.yaw;
    ptr('pointerdown', $('ft-look'), 2, 600, 200);
    ptr('pointerdown', $('ft-look'), 6, 500, 200);
    ptr('pointermove', $('ft-look'), 6, 300, 200); // the second look finger does nothing
    expect(input.yaw).toBe(y0);
  });

  it('pressing Throw does not steal the aiming finger; dragging on Throw also aims', () => {
    ptr('pointerdown', $('ft-look'), 2, 600, 200);
    ptr('pointerdown', $('ft-throw'), 3, 780, 330);
    const y0 = input.yaw;
    ptr('pointermove', $('ft-look'), 2, 640, 200);
    const y1 = input.yaw;
    expect(y1).toBeLessThan(y0);
    ptr('pointermove', $('ft-throw'), 3, 800, 330);
    expect(input.yaw).toBeLessThan(y1);
    expect(input.sample().fire).toBe(true);
  });

  it('a cancelled or lost pointer lets go', () => {
    ptr('pointerdown', $('ft-move'), 1, 100, 300);
    ptr('pointermove', $('ft-move'), 1, 100, 240);
    ptr('pointerdown', $('ft-throw'), 3, 780, 330);
    ptr('pointerdown', $('ft-jump'), 4, 700, 360);
    ptr('pointercancel', $('ft-move'), 1, 100, 240);
    ptr('lostpointercapture', $('ft-throw'), 3, 780, 330);
    ptr('pointercancel', $('ft-jump'), 4, 700, 360);
    const c = input.sample();
    expect([c.mx, c.mz, c.fire, c.jump]).toEqual([0, 0, false, false]);
    expect(input.heldCount).toBe(0);
    expect(touch.active).toBe(0);
  });

  it('a menu, a lost focus or a hidden page drops everything, crouch included', () => {
    ptr('pointerdown', $('ft-move'), 1, 100, 300);
    ptr('pointermove', $('ft-move'), 1, 160, 300);
    ptr('pointerdown', $('ft-throw'), 3, 780, 330);
    ptr('pointerdown', $('ft-crouch'), 7, 700, 280);
    expect(input.sample().crouch).toBe(true);
    input.release(); // what the menu, blur and visibilitychange do
    const c = input.sample();
    expect([c.mx, c.mz, c.fire, c.crouch]).toEqual([0, 0, false, false]);
    expect(input.heldCount).toBe(0);
    expect($('ft-crouch').classList.contains('on')).toBe(false);
    // The fingers are forgotten: moving them does nothing until they touch again.
    ptr('pointermove', $('ft-move'), 1, 100, 200);
    expect(input.sample().mz).toBe(0);
  });

  it('while input is disabled (menu open, rotate screen) buttons do nothing', () => {
    input.enabled = false;
    ptr('pointerdown', $('ft-throw'), 3, 780, 330);
    ptr('pointerdown', $('ft-look'), 2, 600, 200);
    const y0 = input.yaw;
    ptr('pointermove', $('ft-look'), 2, 700, 200);
    expect(input.sample().fire).toBe(false);
    expect(input.yaw).toBe(y0);
  });

  it('the tap that resumed play is ignored (controls arm after a moment)', () => {
    (performance.now as unknown as { mockReturnValue: (v: number) => void }).mockReturnValue(5000);
    touch.arm(220); // what Resume does
    ptr('pointerdown', $('ft-throw'), 3, 780, 330);
    expect(input.sample().fire).toBe(false);
    (performance.now as unknown as { mockReturnValue: (v: number) => void }).mockReturnValue(5300);
    ptr('pointerdown', $('ft-throw'), 8, 780, 330);
    expect(input.sample().fire).toBe(true);
  });

  it('switch weapon and scoreboard are taps', () => {
    const sb: boolean[] = [];
    input.onScoreboard = (o) => sb.push(o);
    expect(input.weapon).toBe(0);
    ptr('pointerdown', $('ft-weapon'), 9, 780, 200);
    expect(input.weapon).toBe(1);
    ptr('pointerdown', $('ft-score'), 10, 800, 100);
    ptr('pointerdown', $('ft-score'), 11, 800, 100);
    expect(sb).toEqual([true, false]);
  });

  it('the Throw button shows its cooldown', () => {
    touch.setReady(0.25);
    expect($('ft-throw').style.getPropertyValue('--ready')).toBe('0.250');
    expect($('ft-throw').classList.contains('cooling')).toBe(true);
    touch.setReady(1);
    expect($('ft-throw').classList.contains('cooling')).toBe(false);
  });

  it('keyboard play still works alongside (a tablet with a keyboard)', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(input.sample().mz).toBe(1);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    expect(input.sample().mz).toBe(0);
  });
});
