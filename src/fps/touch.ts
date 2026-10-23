// On-screen controls for the shooter on phones and tablets.
//
//   left side    a movement stick that appears under the thumb
//   right side   drag to look and aim
//   Throw        hold to throw (repeats at the weapon's own rate, as holding
//                the mouse button does); dragging on it also aims
//   Jump         hold
//   Crouch       tap to toggle (a third thumb is not needed)
//   ⇄            switch weapon
//   Scores       show or hide the scoreboard
//
// Every control follows its own pointer id, so moving, aiming and throwing
// work together, and a finger that starts on one control never drives
// another. A cancelled or lost pointer lets go of whatever it held. The
// controls feed FpsInput's touch source; the menu button stays in the HUD.
import { ListenerBag } from '../core/listeners';
import type { FpsInput } from './input';

const STICK_RADIUS = 58; // px
const DEAD = 0.12;

export class FpsTouch {
  private bag = new ListenerBag();
  private stickId = -1;
  private arrows = new Map<number, { el: HTMLElement; x: number; z: number }>();
  private stickX = 0;
  private stickZ = 0;
  private ox = 0;
  private oy = 0;
  private lookId = -1;
  private lookX = 0;
  private lookY = 0;
  private throwId = -1;
  private throwX = 0;
  private throwY = 0;
  private jumpId = -1;
  private crouchOn = false;
  /** Touches that began before this time (the tap on Resume or Play) are ignored. */
  private armedAt = 0;
  private root: HTMLElement;
  private base: HTMLElement;
  private knob: HTMLElement;
  private throwBtn: HTMLElement;
  private jumpBtn: HTMLElement;
  private crouchBtn: HTMLElement;
  /** Pointers currently tracked (tests and the debug API). */
  get active(): number { return [this.stickId, this.lookId, this.throwId, this.jumpId].filter((x) => x !== -1).length + this.arrows.size; }

  constructor(private input: FpsInput) {
    const $ = (id: string) => document.getElementById(id)!;
    this.root = $('fps-touch');
    const move = $('ft-move');
    const look = $('ft-look');
    this.base = $('ft-base');
    this.knob = $('ft-knob');
    this.throwBtn = $('ft-throw');
    this.jumpBtn = $('ft-jump');
    this.crouchBtn = $('ft-crouch');
    const weapon = $('ft-weapon');
    const score = $('ft-score');
    input.onTouchRelease = () => this.forget();

    // Arrow buttons have independent fingers and combine for diagonal movement.
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-move-x]')) {
      this.bag.on<PointerEvent>(el, 'pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!this.armed() || !this.input.enabled) return;
        this.arrows.set(e.pointerId, { el, x: Number(el.dataset.moveX), z: Number(el.dataset.moveZ) });
        capture(el, e.pointerId); el.classList.add('held'); this.syncMove();
      });
      const end = (e: PointerEvent) => {
        const held = this.arrows.get(e.pointerId);
        if (!held || held.el !== el) return;
        this.arrows.delete(e.pointerId);
        if (![...this.arrows.values()].some((p) => p.el === el)) el.classList.remove('held');
        this.syncMove();
      };
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) this.bag.on<PointerEvent>(el, ev, end);
    }

    // Movement stick.
    this.bag.on<PointerEvent>(move, 'pointerdown', (e) => {
      e.preventDefault();
      if (this.stickId !== -1 || !this.armed()) return;
      this.stickId = e.pointerId;
      capture(move, e.pointerId);
      const r = move.getBoundingClientRect();
      this.ox = e.clientX;
      this.oy = e.clientY;
      this.base.style.left = `${e.clientX - r.left}px`;
      this.base.style.top = `${e.clientY - r.top}px`;
      this.base.classList.add('on');
      this.knobAt(0, 0);
    });
    this.bag.on<PointerEvent>(move, 'pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      let dx = e.clientX - this.ox, dy = e.clientY - this.oy;
      const d = Math.hypot(dx, dy);
      if (d > STICK_RADIUS) { dx = (dx / d) * STICK_RADIUS; dy = (dy / d) * STICK_RADIUS; }
      this.knobAt(dx, dy);
      let x = dx / STICK_RADIUS, z = -dy / STICK_RADIUS;
      const m = Math.hypot(x, z);
      if (m < DEAD) { x = 0; z = 0; } else { const k = (m - DEAD) / (1 - DEAD) / m; x *= k; z *= k; }
      this.stickX = x; this.stickZ = z; this.syncMove();
    });
    const endStick = (e: PointerEvent) => { if (e.pointerId === this.stickId) this.dropStick(); };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) this.bag.on<PointerEvent>(move, ev, endStick);

    // Look and aim: one finger at a time, so a second finger can't fight it.
    this.bag.on<PointerEvent>(look, 'pointerdown', (e) => {
      e.preventDefault();
      if (this.lookId !== -1 || !this.armed()) return;
      this.lookId = e.pointerId;
      capture(look, e.pointerId);
      this.lookX = e.clientX;
      this.lookY = e.clientY;
    });
    this.bag.on<PointerEvent>(look, 'pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      this.input.addTouchLook(e.clientX - this.lookX, e.clientY - this.lookY);
      this.lookX = e.clientX;
      this.lookY = e.clientY;
    });
    const endLook = (e: PointerEvent) => { if (e.pointerId === this.lookId) this.lookId = -1; };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) this.bag.on<PointerEvent>(look, ev, endLook);

    // Throw: held while the finger is down; dragging on it aims too.
    this.bag.on<PointerEvent>(this.throwBtn, 'pointerdown', (e) => {
      e.preventDefault();
      if (this.throwId !== -1 || !this.armed()) return;
      this.throwId = e.pointerId;
      capture(this.throwBtn, e.pointerId);
      this.throwX = e.clientX;
      this.throwY = e.clientY;
      this.throwBtn.classList.add('held');
      this.input.setTouchButton('fire', true);
    });
    this.bag.on<PointerEvent>(this.throwBtn, 'pointermove', (e) => {
      if (e.pointerId !== this.throwId) return;
      this.input.addTouchLook((e.clientX - this.throwX) * 0.8, (e.clientY - this.throwY) * 0.8);
      this.throwX = e.clientX;
      this.throwY = e.clientY;
    });
    const endThrow = (e: PointerEvent) => { if (e.pointerId === this.throwId) this.dropThrow(); };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) this.bag.on<PointerEvent>(this.throwBtn, ev, endThrow);

    // Jump: held.
    this.bag.on<PointerEvent>(this.jumpBtn, 'pointerdown', (e) => {
      e.preventDefault();
      if (this.jumpId !== -1 || !this.armed()) return;
      this.jumpId = e.pointerId;
      capture(this.jumpBtn, e.pointerId);
      this.jumpBtn.classList.add('held');
      this.input.setTouchButton('jump', true);
    });
    const endJump = (e: PointerEvent) => { if (e.pointerId === this.jumpId) this.dropJump(e.type !== 'pointerup'); };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) this.bag.on<PointerEvent>(this.jumpBtn, ev, endJump);

    // Crouch (toggle), weapon switch and scoreboard: taps.
    this.bag.on<PointerEvent>(this.crouchBtn, 'pointerdown', (e) => {
      e.preventDefault();
      if (!this.armed()) return;
      this.crouchOn = !this.crouchOn;
      this.input.setTouchButton('crouch', this.crouchOn);
      this.syncCrouch();
    });
    this.bag.on<PointerEvent>(weapon, 'pointerdown', (e) => { e.preventDefault(); if (this.armed()) this.input.switchWeapon(); });
    this.bag.on<PointerEvent>(score, 'pointerdown', (e) => { e.preventDefault(); if (this.armed()) this.input.toggleScoreboard(); });

    // No long-press menus, text selection or drag images on the controls.
    for (const el of [this.root, move, look, this.throwBtn, this.jumpBtn, this.crouchBtn, weapon, score]) {
      this.bag.on(el, 'contextmenu', (e) => e.preventDefault());
      this.bag.on(el, 'selectstart', (e) => e.preventDefault());
      this.bag.on(el, 'dragstart', (e) => e.preventDefault());
    }
  }

  /** Shows or hides the controls. Showing arms them after a short delay, so the tap that opened play can't also act. */
  setVisible(on: boolean): void {
    if (on === !this.root.hidden) return;
    this.root.hidden = !on;
    if (on) this.arm();
    else this.forget();
  }

  get visible(): boolean { return !this.root.hidden; }

  arm(delayMs = 220): void {
    this.forget();
    this.armedAt = performance.now() + delayMs;
  }

  /** Lets go of every finger without touching the input state (FpsInput.release clears that). */
  forget(): void {
    if (this.stickId !== -1) this.dropStick();
    if (this.throwId !== -1) this.dropThrow();
    if (this.jumpId !== -1) this.dropJump(true);
    this.input.cancelTouchJump();
    for (const p of this.arrows.values()) p.el.classList.remove('held');
    this.arrows.clear(); this.stickX = 0; this.stickZ = 0; this.syncMove();
    this.lookId = -1;
    if (this.crouchOn && !this.input.touchCrouch) { this.crouchOn = false; this.syncCrouch(); }
  }

  /** Throw button cooldown ring: 0 = just thrown, 1 = ready. */
  setReady(k: number): void {
    this.throwBtn.style.setProperty('--ready', k.toFixed(3));
    this.throwBtn.classList.toggle('cooling', k < 1);
  }

  private armed(): boolean { return performance.now() >= this.armedAt; }

  private dropStick(): void {
    this.stickId = -1;
    this.stickX = 0; this.stickZ = 0; this.syncMove();
    this.knobAt(0, 0);
    this.base.classList.remove('on');
    this.base.style.left = '';
    this.base.style.top = '';
  }

  private dropThrow(): void {
    this.throwId = -1;
    this.throwBtn.classList.remove('held');
    this.input.setTouchButton('fire', false);
  }

  private dropJump(cancel = false): void {
    if (cancel) this.input.cancelTouchJump();
    this.jumpId = -1;
    this.jumpBtn.classList.remove('held');
    this.input.setTouchButton('jump', false);
  }

  private syncMove(): void {
    let x = this.stickX, z = this.stickZ;
    for (const p of this.arrows.values()) { x += p.x; z += p.z; }
    const length = Math.max(1, Math.hypot(x, z));
    this.input.setTouchMove(x / length, z / length);
  }

  private syncCrouch(): void {
    this.crouchBtn.classList.toggle('on', this.crouchOn);
    this.crouchBtn.setAttribute('aria-pressed', String(this.crouchOn));
  }

  private knobAt(x: number, y: number): void {
    this.knob.style.transform = `translate(${x}px, ${y}px)`;
  }

  dispose(): void { this.bag.dispose(); }
}

function capture(el: HTMLElement, id: number): void {
  try { el.setPointerCapture(id); } catch { /* not supported */ }
}
