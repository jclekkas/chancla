// Keyboard and mouse for the shooter. Pointer lock is only requested from a
// click; losing it (Esc, alt-tab, a browser prompt) opens the menu. Every
// held key is dropped when focus or visibility changes so nothing sticks.
//
// Escape is handled here whether or not the pointer is locked. Browsers
// differ: most release the lock themselves and swallow the key, some
// deliver the key while the lock is still held (headless Chromium, some
// fullscreen setups), and some deliver it just after releasing. So Escape
// releases the lock itself and asks for the menu, and the menu ignores a
// second Escape that belongs to the same press.
//
// Shortcut safety: Ctrl and Cmd combinations are never captured (Ctrl+W
// would close the tab), so crouch is C or Shift rather than Ctrl.
//
// Touch (phones, tablets) is a second source, fed by the on-screen controls
// (touch.ts) and merged in sample(): no pointer lock, no keyboard needed.
// release() drops both sources, so a menu, a lost focus or a hidden page
// never leaves anything held.
import { ListenerBag } from '../core/listeners';
import type { WeaponId } from '../../shared/config';

export interface Controls {
  mx: number;
  mz: number;
  jump: boolean;
  crouch: boolean;
  fire: boolean;
  weapon: WeaponId;
}

const MOVE: Record<string, [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};

export class FpsInput {
  enabled = false;
  locked = false;
  // Set when the browser refuses pointer lock: drag with the mouse to look,
  // F or E to throw.
  fallback = false;
  sensitivity = 1;
  invertY = false;
  yaw = 0;
  pitch = 0;
  weapon: WeaponId = 0;
  scoreboard = false;
  private keys = new Set<string>();
  private mouseFire = false;
  private keyFire = false;
  private lastWheel = 0;
  private bag = new ListenerBag();
  onMenu: (() => void) | null = null;
  onLockChange: ((locked: boolean) => void) | null = null;
  onLockError: (() => void) | null = null;
  onScoreboard: ((open: boolean) => void) | null = null;
  onSwitch: (() => void) | null = null;
  lookEvents = 0;
  /** performance.now() when the menu was last requested from the keyboard or a lost lock. */
  lastMenuAt = -1e9;
  /** performance.now() when the pointer lock was last released (browsers refuse re-locking for ~1 s). */
  unlockedAt = -1e9;
  private lockedAt = -1e9;
  /** The on-screen touch controls are the active input (no pointer lock is used). */
  touchMode = false;
  /** Touch look speed, separate from the mouse's. */
  touchSensitivity = 1;
  private touch = { mx: 0, mz: 0, fire: false, jump: false, crouch: false };
  /** Called by release(): the touch overlay forgets the fingers it was tracking. */
  onTouchRelease: (() => void) | null = null;

  constructor(private canvas: HTMLElement) {
    const doc = document;
    this.bag.on<KeyboardEvent>(window, 'keydown', (e) => this.key(e, true));
    this.bag.on<KeyboardEvent>(window, 'keyup', (e) => this.key(e, false));
    this.bag.on<MouseEvent>(doc, 'mousemove', (e) => {
      if (!this.enabled) return;
      if (!this.locked && !(this.fallback && (e.buttons & 1) && e.target === this.canvas.querySelector('canvas'))) return;
      // Some browsers report a large spike when the lock engages; clamp it.
      const dx = clamp(e.movementX, -250, 250), dy = clamp(e.movementY, -250, 250);
      const k = 0.0022 * this.sensitivity;
      this.yaw -= dx * k;
      this.pitch -= dy * k * (this.invertY ? -1 : 1);
      this.pitch = clamp(this.pitch, -1.45, 1.45);
      this.lookEvents++;
    });
    this.bag.on<MouseEvent>(doc, 'mousedown', (e) => {
      if (!this.locked || !this.enabled) return;
      // The click that re-captured the mouse must never also throw.
      if (performance.now() - this.lockedAt < 200) return;
      if (e.button === 0) this.mouseFire = true;
      else if (e.button === 2) this.toggleWeapon();
    });
    this.bag.on<MouseEvent>(doc, 'mouseup', (e) => { if (e.button === 0) this.mouseFire = false; });
    this.bag.on<WheelEvent>(doc, 'wheel', (e) => {
      if (!this.locked || !this.enabled) return;
      // Trackpads send floods of wheel events: one switch per 220 ms.
      const now = performance.now();
      if (Math.abs(e.deltaY) < 4 || now - this.lastWheel < 220) return;
      this.lastWheel = now;
      this.toggleWeapon();
    }, { passive: true });
    this.bag.on(doc, 'pointerlockchange', () => {
      const locked = doc.pointerLockElement === this.canvas;
      if (locked === this.locked) return;
      this.locked = locked;
      if (locked) { this.lockedAt = performance.now(); this.fallback = false; } else { this.unlockedAt = performance.now(); this.release(); }
      this.onLockChange?.(locked);
    });
    this.bag.on(doc, 'pointerlockerror', () => { this.locked = false; this.onLockError?.(); });
    this.bag.on(canvas, 'contextmenu', (e) => e.preventDefault());
    this.bag.on(window, 'blur', () => this.release());
    this.bag.on(doc, 'visibilitychange', () => { if (doc.hidden) this.release(); });
  }

  private key(e: KeyboardEvent, down: boolean): void {
    if (e.ctrlKey || e.metaKey || e.altKey) { if (!down) this.keys.delete(e.code); return; }
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!this.enabled) { if (!down) this.keys.delete(e.code); return; }
    if (e.code === 'Escape') {
      if (!down || e.repeat) return;
      // In play: free the mouse ourselves (if the browser didn't) and open the menu.
      this.lastMenuAt = performance.now();
      if (this.locked) this.exitLock();
      this.release();
      this.onMenu?.();
      return;
    }
    if (e.code === 'Tab') {
      e.preventDefault();
      if (this.scoreboard !== down) { this.scoreboard = down; this.onScoreboard?.(down); }
      return;
    }
    if (MOVE[e.code] || e.code === 'Space' || e.code === 'KeyC' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      e.preventDefault();
      if (down) this.keys.add(e.code); else this.keys.delete(e.code);
      return;
    }
    if (e.code === 'KeyF' || e.code === 'KeyE') { this.keyFire = down; return; }
    if (!down || e.repeat) return;
    if (e.code === 'Digit1') this.setWeapon(0);
    else if (e.code === 'Digit2') this.setWeapon(1);
    else if (e.code === 'KeyQ') this.toggleWeapon();
    else if (e.code === 'KeyP') { this.lastMenuAt = performance.now(); if (this.locked) this.exitLock(); this.release(); this.onMenu?.(); }
  }

  private setWeapon(w: WeaponId): void {
    if (this.weapon !== w) { this.weapon = w; this.onSwitch?.(); }
  }

  private toggleWeapon(): void {
    this.setWeapon(this.weapon === 0 ? 1 : 0);
  }

  // ---- touch source (on-screen controls)

  /** Stick position, each axis -1..1 (forward is +z). */
  setTouchMove(x: number, z: number): void {
    this.touch.mx = x;
    this.touch.mz = z;
  }

  setTouchButton(b: 'fire' | 'jump' | 'crouch', down: boolean): void {
    this.touch[b] = down && this.enabled;
  }

  /** A look drag on the screen, in pixels. */
  addTouchLook(dx: number, dy: number): void {
    if (!this.enabled) return;
    const k = 0.0055 * this.touchSensitivity;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (this.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.45, 1.45);
    this.lookEvents++;
  }

  switchWeapon(): void {
    if (this.enabled) this.toggleWeapon();
  }

  toggleScoreboard(): void {
    this.scoreboard = !this.scoreboard;
    this.onScoreboard?.(this.scoreboard);
  }

  get touchCrouch(): boolean { return this.touch.crouch; }

  sample(): Controls {
    let mx = 0, mz = 0;
    for (const k of this.keys) { const v = MOVE[k]; if (v) { mx += v[0]; mz += v[1]; } }
    const t = this.touch;
    mx += t.mx; mz += t.mz;
    return {
      mx: clamp(mx, -1, 1), mz: clamp(mz, -1, 1),
      jump: this.keys.has('Space') || t.jump,
      crouch: this.keys.has('KeyC') || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || t.crouch,
      fire: this.enabled && (this.mouseFire || this.keyFire || t.fire),
      weapon: this.weapon,
    };
  }

  // Drops everything held (focus loss, menus, death).
  release(): void {
    this.keys.clear();
    this.mouseFire = false;
    this.keyFire = false;
    this.touch.mx = 0; this.touch.mz = 0;
    this.touch.fire = false; this.touch.jump = false; this.touch.crouch = false;
    this.onTouchRelease?.();
    if (this.scoreboard) { this.scoreboard = false; this.onScoreboard?.(false); }
  }

  get heldCount(): number {
    const t = this.touch;
    return this.keys.size + (this.mouseFire ? 1 : 0) + (this.keyFire ? 1 : 0) + (t.fire ? 1 : 0) + (t.jump ? 1 : 0) + (t.crouch ? 1 : 0) + (t.mx !== 0 || t.mz !== 0 ? 1 : 0);
  }

  requestLock(): void {
    const el = this.canvas as HTMLElement & { requestPointerLock?: () => Promise<void> | void };
    if (typeof el.requestPointerLock !== 'function') { this.onLockError?.(); return; }
    try {
      const r = el.requestPointerLock();
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => this.onLockError?.());
    } catch {
      this.onLockError?.();
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) { try { document.exitPointerLock(); } catch { /* already */ } }
  }

  dispose(): void { this.bag.dispose(); }
}

function clamp(v: number, a: number, b: number): number { return v < a ? a : v > b ? b : v; }
