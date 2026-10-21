// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { InputManager } from '../src/input/input';
import { TouchControls } from '../src/ui/touch';
import { liveListenerCount } from '../src/core/listeners';

function key(type: 'keydown' | 'keyup', code: string, repeat = false): void {
  window.dispatchEvent(new KeyboardEvent(type, { code, repeat, bubbles: true }));
}

function pointer(el: Element, type: string, id: number, x: number, y: number, pointerType = 'touch'): void {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
  Object.defineProperty(e, 'pointerId', { value: id });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  el.dispatchEvent(e);
}

function touchDom(): void {
  document.body.innerHTML = `
    <canvas id="c"></canvas>
    <div id="touch-move"><div id="stick-base"><div id="stick-knob"></div></div></div>
    <div id="touch-look"></div>
    <button id="t-throw"></button><button id="t-recall"></button><button id="t-special"></button>`;
}

describe('input manager', () => {
  let input: InputManager;
  beforeEach(() => {
    touchDom();
    input?.dispose();
    input = new InputManager(document.getElementById('c')!);
    input.enabled = true;
  });

  it('maps WASD and arrows to movement', () => {
    key('keydown', 'KeyW');
    key('keydown', 'ArrowLeft');
    const f = input.consume();
    expect(f.moveZ).toBe(1);
    expect(f.moveX).toBe(-1);
    key('keyup', 'KeyW');
    expect(input.consume().moveZ).toBe(0);
  });

  it('latches a quick Space tap until consumed', () => {
    key('keydown', 'Space');
    key('keyup', 'Space');
    const f = input.consume();
    expect(f.throwDown).toBe(true);
    expect(f.throwUp).toBe(true);
    expect(f.throwHeld).toBe(false);
    const g = input.consume();
    expect(g.throwDown).toBe(false);
  });

  it('ignores key repeat for throws, and R/Q are single taps', () => {
    key('keydown', 'Space');
    input.consume();
    key('keydown', 'Space', true);
    expect(input.consume().throwDown).toBe(false);
    key('keydown', 'KeyR');
    key('keydown', 'KeyQ');
    const f = input.consume();
    expect(f.recall).toBe(true);
    expect(f.special).toBe(true);
    expect(input.consume().recall).toBe(false);
  });

  it('clear() drops held keys and cancels a charge on blur', () => {
    key('keydown', 'KeyD');
    key('keydown', 'Space');
    input.consume();
    window.dispatchEvent(new Event('blur'));
    const f = input.consume();
    expect(f.moveX).toBe(0);
    expect(f.throwHeld).toBe(false);
    expect(f.cancelCharge).toBe(true);
    expect(input.heldKeys).toBe(0);
  });

  it('ignores gameplay keys while disabled (menus open)', () => {
    input.enabled = false;
    key('keydown', 'KeyW');
    key('keydown', 'Space');
    const f = input.consume();
    expect(f.moveZ).toBe(0);
    expect(f.throwDown).toBe(false);
  });

  it('applies sensitivity and invert to look', () => {
    input.sensitivity = 2;
    input.invertY = true;
    input.addLook(0.1, 0.1);
    const l = input.consumeLook();
    expect(l.dx).toBeCloseTo(0.2);
    expect(l.dy).toBeCloseTo(-0.2);
  });

  it('dispose removes every listener it added', () => {
    const before = liveListenerCount();
    const extra = new InputManager(document.getElementById('c')!);
    expect(liveListenerCount()).toBeGreaterThan(before);
    extra.dispose();
    expect(liveListenerCount()).toBe(before);
  });
});

describe('touch controls', () => {
  it('supports moving, aiming and throwing at the same time', () => {
    touchDom();
    const input = new InputManager(document.getElementById('c')!);
    input.enabled = true;
    const touch = new TouchControls(input);
    const move = document.getElementById('touch-move')!;
    const look = document.getElementById('touch-look')!;
    const thr = document.getElementById('t-throw')!;
    pointer(move, 'pointerdown', 1, 100, 300);
    pointer(move, 'pointermove', 1, 100, 240); // push up = forward
    pointer(look, 'pointerdown', 2, 600, 200);
    pointer(look, 'pointermove', 2, 640, 200);
    pointer(thr, 'pointerdown', 3, 700, 320);
    const f = input.consume();
    expect(f.moveZ).toBeGreaterThan(0.8);
    expect(f.throwDown).toBe(true);
    expect(f.throwHeld).toBe(true);
    expect(input.consumeLook().dx).toBeGreaterThan(0);
    pointer(thr, 'pointerup', 3, 700, 320);
    expect(input.consume().throwUp).toBe(true);
    pointer(move, 'pointerup', 1, 100, 240);
    expect(input.consume().moveZ).toBe(0);
    document.getElementById('t-recall')!.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { bubbles: true }), {}));
    expect(input.consume().recall).toBe(true);
    touch.dispose();
    input.dispose();
  });
});
