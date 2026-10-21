import { ListenerBag } from '../core/listeners';
import type { InputManager } from '../input/input';

// Mobile controls: dynamic left joystick, right-side drag to aim, and big
// throw / recall / special buttons. Each control tracks its own pointer id,
// so moving, aiming and throwing work at the same time.
export class TouchControls {
  private bag = new ListenerBag();
  private stickId = -1;
  private lookIds = new Map<number, { x: number; y: number }>();
  private throwId = -1;
  private throwLast = { x: 0, y: 0 };
  private originX = 0;
  private originY = 0;
  private base: HTMLElement;
  private knob: HTMLElement;
  private throwBtn: HTMLElement;
  private input: InputManager;
  private radius = 56;

  constructor(input: InputManager) {
    this.input = input;
    const $ = (id: string): HTMLElement => document.getElementById(id)!;
    const move = $('touch-move');
    const look = $('touch-look');
    this.base = $('stick-base');
    this.knob = $('stick-knob');
    this.throwBtn = $('t-throw');
    const recall = $('t-recall');
    const special = $('t-special');

    this.bag.on<PointerEvent>(move, 'pointerdown', (e) => {
      if (this.stickId !== -1) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      capture(move, e.pointerId);
      const r = move.getBoundingClientRect();
      this.originX = e.clientX;
      this.originY = e.clientY;
      this.base.style.left = `${e.clientX - r.left}px`;
      this.base.style.top = `${e.clientY - r.top}px`;
      this.setKnob(0, 0);
    });
    this.bag.on<PointerEvent>(move, 'pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      let dx = e.clientX - this.originX, dy = e.clientY - this.originY;
      const d = Math.hypot(dx, dy);
      if (d > this.radius) { dx = (dx / d) * this.radius; dy = (dy / d) * this.radius; }
      this.setKnob(dx, dy);
      const dead = 0.12;
      let x = dx / this.radius, y = -dy / this.radius;
      const m = Math.hypot(x, y);
      if (m < dead) { x = 0; y = 0; } else { const s = (m - dead) / (1 - dead) / m; x *= s; y *= s; }
      this.input.setStick(x, y);
    });
    const endStick = (e: PointerEvent): void => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1;
      this.input.setStick(0, 0);
      this.setKnob(0, 0);
      this.base.style.left = '';
      this.base.style.top = '';
    };
    this.bag.on<PointerEvent>(move, 'pointerup', endStick);
    this.bag.on<PointerEvent>(move, 'pointercancel', endStick);

    this.bag.on<PointerEvent>(look, 'pointerdown', (e) => {
      e.preventDefault();
      capture(look, e.pointerId);
      this.lookIds.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    this.bag.on<PointerEvent>(look, 'pointermove', (e) => {
      const p = this.lookIds.get(e.pointerId);
      if (!p) return;
      this.input.addLook((e.clientX - p.x) * 0.0062, (e.clientY - p.y) * 0.0062);
      p.x = e.clientX;
      p.y = e.clientY;
    });
    const endLook = (e: PointerEvent): void => { this.lookIds.delete(e.pointerId); };
    this.bag.on<PointerEvent>(look, 'pointerup', endLook);
    this.bag.on<PointerEvent>(look, 'pointercancel', endLook);

    // Throw: hold to charge, release to throw. Dragging on the button aims.
    this.bag.on<PointerEvent>(this.throwBtn, 'pointerdown', (e) => {
      e.preventDefault();
      if (this.throwId !== -1) return;
      this.throwId = e.pointerId;
      capture(this.throwBtn, e.pointerId);
      this.throwLast = { x: e.clientX, y: e.clientY };
      this.throwBtn.classList.add('held');
      this.input.press('touch');
    });
    this.bag.on<PointerEvent>(this.throwBtn, 'pointermove', (e) => {
      if (e.pointerId !== this.throwId) return;
      this.input.addLook((e.clientX - this.throwLast.x) * 0.0055, (e.clientY - this.throwLast.y) * 0.0055);
      this.throwLast = { x: e.clientX, y: e.clientY };
    });
    const endThrow = (e: PointerEvent): void => {
      if (e.pointerId !== this.throwId) return;
      this.throwId = -1;
      this.throwBtn.classList.remove('held');
      this.input.release('touch');
    };
    this.bag.on<PointerEvent>(this.throwBtn, 'pointerup', endThrow);
    this.bag.on<PointerEvent>(this.throwBtn, 'pointercancel', endThrow);

    this.bag.on<PointerEvent>(recall, 'pointerdown', (e) => { e.preventDefault(); this.input.tapRecall(); });
    this.bag.on<PointerEvent>(special, 'pointerdown', (e) => { e.preventDefault(); this.input.tapSpecial(); });
    for (const el of [move, look, this.throwBtn, recall, special]) {
      this.bag.on(el, 'contextmenu', (e) => e.preventDefault());
    }
  }

  private setKnob(x: number, y: number): void {
    this.knob.style.transform = `translate(${x}px, ${y}px)`;
  }

  reset(): void {
    this.stickId = -1;
    this.throwId = -1;
    this.lookIds.clear();
    this.setKnob(0, 0);
    this.base.style.left = '';
    this.base.style.top = '';
    this.throwBtn.classList.remove('held');
  }

  dispose(): void {
    this.bag.dispose();
  }
}

function capture(el: HTMLElement, id: number): void {
  try { el.setPointerCapture(id); } catch { /* not supported */ }
}
