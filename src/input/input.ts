import { ListenerBag } from '../core/listeners';
import { emptyInput, type InputFrame } from '../game/game';

// Collects keyboard, mouse, pointer-lock, drag-to-look and touch input into
// one frame snapshot per render frame. Edges (press/release) are latched
// until consumed so quick taps between frames are never lost.

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1],
  KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

export type LockState = 'unlocked' | 'locked' | 'pending' | 'denied';

export class InputManager {
  enabled = false;
  sensitivity = 1;
  invertY = false;
  lock: LockState = 'unlocked';
  usingTouch = false;
  private keys = new Set<string>();
  private throwSources = new Set<string>();
  private throwDown = false;
  private throwUp = false;
  private cancel = false;
  private recall = false;
  private special = false;
  private lookX = 0;
  private lookY = 0;
  private stickX = 0;
  private stickY = 0;
  private bag = new ListenerBag();
  private canvas: HTMLElement;
  private drag: { id: number; x: number; y: number; moved: number; t: number; charging: boolean } | null = null;
  onPause: (() => void) | null = null;
  onLockChange: ((locked: boolean) => void) | null = null;
  onLockError: (() => void) | null = null;
  onTutorialSkip: (() => void) | null = null;
  lastKeyboardAt = 0;
  private deniedAt = 0;
  private lockRetried = false;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    const doc = document;
    this.bag.on<KeyboardEvent>(window, 'keydown', (e) => this.onKey(e, true));
    this.bag.on<KeyboardEvent>(window, 'keyup', (e) => this.onKey(e, false));
    this.bag.on<MouseEvent>(doc, 'mousemove', (e) => {
      if (this.lock !== 'locked' || !this.enabled) return;
      this.addLook(e.movementX * 0.0022, e.movementY * 0.0022);
    });
    this.bag.on<MouseEvent>(doc, 'mousedown', (e) => {
      if (this.lock !== 'locked' || !this.enabled) return;
      if (e.button === 0) this.press('mouse');
      else if (e.button === 2) this.tapRecall();
    });
    this.bag.on<MouseEvent>(doc, 'mouseup', (e) => {
      if (e.button === 0) this.release('mouse');
    });
    this.bag.on(doc, 'pointerlockchange', () => {
      const locked = doc.pointerLockElement === this.canvas;
      this.lock = locked ? 'locked' : this.lock === 'denied' ? 'denied' : 'unlocked';
      if (!locked && this.throwSources.has('mouse')) {
        // Losing the lock mid-charge cancels the throw instead of firing it.
        this.throwSources.delete('mouse');
        if (this.throwSources.size === 0) this.cancel = true;
      }
      this.onLockChange?.(locked);
    });
    this.bag.on(doc, 'pointerlockerror', () => {
      if (this.lock === 'denied') return;
      this.lock = 'denied';
      this.deniedAt = performance.now();
      this.onLockError?.();
    });
    this.bag.on(canvas, 'contextmenu', (e) => e.preventDefault());
    // Drag-to-look fallback for when pointer lock is unavailable or released.
    this.bag.on<PointerEvent>(canvas, 'pointerdown', (e) => {
      if (!this.enabled || this.lock === 'locked' || e.pointerType === 'touch') return;
      if (e.button !== 0) return;
      // After a denial (Chrome refuses re-locking within ~1s of Esc), the
      // next click on the game tries once more instead of staying in drag mode.
      if (this.lock === 'denied' && !this.lockRetried && performance.now() - this.deniedAt > 1200) {
        this.lockRetried = true;
        this.requestLock();
        return;
      }
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, t: performance.now(), charging: false };
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    this.bag.on<PointerEvent>(canvas, 'pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      d.x = e.clientX;
      d.y = e.clientY;
      d.moved += Math.abs(dx) + Math.abs(dy);
      this.addLook(dx * 0.0045, dy * 0.0045);
      // Holding still for a moment means "charge", not "look".
      if (!d.charging && d.moved < 8 && performance.now() - d.t > 220) {
        d.charging = true;
        this.press('drag');
      }
    });
    const endDrag = (e: PointerEvent): void => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      if (d.charging) this.release('drag');
      else if (d.moved < 8 && e.type === 'pointerup') {
        // A tap is a quick throw.
        this.press('drag');
        this.release('drag');
      }
    };
    this.bag.on<PointerEvent>(canvas, 'pointerup', endDrag);
    this.bag.on<PointerEvent>(canvas, 'pointercancel', endDrag);
    this.bag.on(window, 'blur', () => this.clear());
  }

  // Called each frame so a held drag without movement can start charging.
  tick(): void {
    const d = this.drag;
    if (d && !d.charging && d.moved < 8 && performance.now() - d.t > 220) {
      d.charging = true;
      this.press('drag');
    }
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const target = e.target as HTMLElement | null;
    const inForm = !!target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON');
    if (e.code === 'Escape' && down) {
      // Most browsers release the pointer lock themselves on Escape (and we
      // pause via pointerlockchange), but some deliver the key while the
      // lock is still held. Release it here too, so one press always pauses.
      if (this.enabled && !e.repeat) {
        if (this.lock === 'locked') this.exitLock();
        this.onPause?.();
      }
      return;
    }
    if (!this.enabled) {
      if (!down) this.keys.delete(e.code);
      return;
    }
    if (inForm && target?.tagName !== 'BUTTON') return;
    if (MOVE_KEYS[e.code]) {
      if (down) this.keys.add(e.code);
      else this.keys.delete(e.code);
      e.preventDefault();
      this.lastKeyboardAt = performance.now();
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (down && !e.repeat) this.press('space');
      else if (!down) this.release('space');
      return;
    }
    if (!down || e.repeat) return;
    if (e.code === 'KeyR') this.tapRecall();
    else if (e.code === 'KeyQ' || e.code === 'KeyE') this.tapSpecial();
    else if (e.code === 'KeyP') this.onPause?.();
    else if (e.code === 'Enter') this.onTutorialSkip?.();
  }

  press(source: string): void {
    if (!this.enabled) return;
    if (this.throwSources.size === 0) this.throwDown = true;
    this.throwSources.add(source);
  }

  /** `cancel`: the hold was interrupted (pause, rotation, a lost touch), so the charge is dropped, not thrown. */
  release(source: string, cancel = false): void {
    if (!this.throwSources.has(source)) return;
    this.throwSources.delete(source);
    if (this.throwSources.size === 0) { if (cancel) this.cancel = true; else this.throwUp = true; }
  }

  tapRecall(): void {
    if (this.enabled) this.recall = true;
  }

  tapSpecial(): void {
    if (this.enabled) this.special = true;
  }

  /** Touch aiming has its own sensitivity (a finger is not a mouse). */
  touchSensitivity = 1;

  addLook(dx: number, dy: number, touch = false): void {
    if (!this.enabled) return;
    const k = touch ? this.touchSensitivity : this.sensitivity;
    this.lookX += dx * k;
    this.lookY += dy * k * (this.invertY ? -1 : 1);
  }

  setStick(x: number, y: number): void {
    this.stickX = x;
    this.stickY = y;
  }

  // Look deltas accumulated since the last call, in radians.
  consumeLook(): { dx: number; dy: number } {
    const r = { dx: this.lookX, dy: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return r;
  }

  consume(out: InputFrame = emptyInput()): InputFrame {
    let mx = this.stickX, mz = this.stickY;
    for (const k of this.keys) {
      const v = MOVE_KEYS[k];
      if (v) { mx += v[0]; mz += v[1]; }
    }
    out.moveX = Math.max(-1, Math.min(1, mx));
    out.moveZ = Math.max(-1, Math.min(1, mz));
    out.throwDown = this.throwDown;
    out.throwUp = this.throwUp;
    out.throwHeld = this.throwSources.size > 0;
    out.cancelCharge = this.cancel;
    out.recall = this.recall;
    out.special = this.special;
    this.throwDown = false;
    this.throwUp = false;
    this.cancel = false;
    this.recall = false;
    this.special = false;
    return out;
  }

  // Drops every held input. Used on blur, pause, visibility loss and restart.
  clear(): void {
    this.keys.clear();
    if (this.throwSources.size > 0) this.cancel = true;
    this.throwSources.clear();
    this.throwDown = false;
    this.throwUp = false;
    this.recall = false;
    this.special = false;
    this.lookX = 0;
    this.lookY = 0;
    this.stickX = 0;
    this.stickY = 0;
    this.drag = null;
  }

  get heldKeys(): number {
    return this.keys.size + this.throwSources.size;
  }

  requestLock(): void {
    if (this.usingTouch) return;
    if (this.lock !== 'denied') this.lockRetried = false;
    const el = this.canvas as HTMLElement & { requestPointerLock?: () => Promise<void> | void };
    if (typeof el.requestPointerLock !== 'function') {
      this.lock = 'denied';
      this.onLockError?.();
      return;
    }
    this.lock = 'pending';
    const fail = (): void => {
      if (document.pointerLockElement === this.canvas || this.lock === 'denied') return;
      this.lock = 'denied';
      this.deniedAt = performance.now();
      this.onLockError?.();
    };
    try {
      // Plain request: OS pointer acceleration stays on, which suits
      // Mac trackpads. Chrome returns a promise, Safari returns undefined.
      const r = el.requestPointerLock();
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(fail);
    } catch {
      fail();
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) {
      try { document.exitPointerLock(); } catch { /* ignore */ }
    }
  }

  dispose(): void {
    this.bag.dispose();
  }
}
