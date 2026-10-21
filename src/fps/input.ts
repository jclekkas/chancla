// Keyboard and mouse for the shooter. Pointer lock is only requested from a
// click; losing it (Esc, alt-tab, a browser prompt) opens the menu. Every
// held key is dropped when focus or visibility changes so nothing sticks.
//
// Shortcut safety: Ctrl and Cmd combinations are never captured (Ctrl+W
// would close the tab), so crouch is C or Shift rather than Ctrl.
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

  constructor(private canvas: HTMLElement) {
    const doc = document;
    this.bag.on<KeyboardEvent>(window, 'keydown', (e) => this.key(e, true));
    this.bag.on<KeyboardEvent>(window, 'keyup', (e) => this.key(e, false));
    this.bag.on<MouseEvent>(doc, 'mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
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
      this.locked = locked;
      if (!locked) this.release();
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
    if (e.code === 'Escape') { if (down && !this.locked) this.onMenu?.(); return; }
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
    else if (e.code === 'KeyP') this.onMenu?.();
  }

  private setWeapon(w: WeaponId): void {
    if (this.weapon !== w) { this.weapon = w; this.onSwitch?.(); }
  }

  private toggleWeapon(): void {
    this.setWeapon(this.weapon === 0 ? 1 : 0);
  }

  sample(): Controls {
    let mx = 0, mz = 0;
    for (const k of this.keys) { const v = MOVE[k]; if (v) { mx += v[0]; mz += v[1]; } }
    return {
      mx: clamp(mx, -1, 1), mz: clamp(mz, -1, 1),
      jump: this.keys.has('Space'),
      crouch: this.keys.has('KeyC') || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      fire: this.enabled && (this.mouseFire || this.keyFire),
      weapon: this.weapon,
    };
  }

  // Drops everything held (focus loss, menus, death).
  release(): void {
    this.keys.clear();
    this.mouseFire = false;
    this.keyFire = false;
    if (this.scoreboard) { this.scoreboard = false; this.onScoreboard?.(false); }
  }

  get heldCount(): number {
    return this.keys.size + (this.mouseFire ? 1 : 0) + (this.keyFire ? 1 : 0);
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
