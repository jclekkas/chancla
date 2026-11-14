export interface Edges {
  firePressed: boolean;
  fireReleased: boolean;
  dash: boolean;
  recall: boolean;
  legend: boolean;
  slot: number;
  cycle: number;
}

export class Controls {
  mx = 0;
  my = 0;
  clientX = 0;
  clientY = 0;
  hasPointer = false;
  fireDown = false;
  touchAim = false;
  touchAngle = 0;
  touchMag = 0;
  usingTouch = false;
  enabled = false;

  private keys = new Set<string>();
  private stickX = 0;
  private stickY = 0;
  private stickId = -1;
  private stickOriginX = 0;
  private stickOriginY = 0;
  private lookId = -1;
  private lookX = 0;
  private lookY = 0;
  private lookMoved = 0;
  private edges: Edges = { firePressed: false, fireReleased: false, dash: false, recall: false, legend: false, slot: -1, cycle: 0 };
  private onKeyDown: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  private onBlur: () => void;

  constructor() {
    this.onKeyDown = (e) => this.key(e, true);
    this.onKeyUp = (e) => this.key(e, false);
    this.onBlur = () => {
      this.keys.clear();
      this.fireDown = false;
      this.stickX = 0;
      this.stickY = 0;
    };
  }

  attach(canvas: HTMLCanvasElement): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      if (e.button !== 0) return;
      this.clientX = e.clientX;
      this.clientY = e.clientY;
      this.hasPointer = true;
      this.fireDown = true;
      this.edges.firePressed = true;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      this.clientX = e.clientX;
      this.clientY = e.clientY;
      this.hasPointer = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') return;
      if (!this.fireDown) return;
      this.fireDown = false;
      this.edges.fireReleased = true;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.edges.cycle += e.deltaY > 0 ? 1 : -1;
    }, { passive: false });
  }

  bindTouch(stick: HTMLElement, look: HTMLElement, buttons: {
    throw: HTMLElement;
    dash: HTMLElement;
    recall: HTMLElement;
    legend: HTMLElement;
    cycle: HTMLElement;
  }): void {
    this.zone(stick, (e, phase) => this.stick(e, phase));
    this.zone(look, (e, phase) => this.look(e, phase));
    this.hold(buttons.throw, true);
    buttons.dash.addEventListener('pointerdown', (e) => { e.preventDefault(); this.usingTouch = true; this.edges.dash = true; });
    buttons.recall.addEventListener('pointerdown', (e) => { e.preventDefault(); this.usingTouch = true; this.edges.recall = true; });
    buttons.legend.addEventListener('pointerdown', (e) => { e.preventDefault(); this.usingTouch = true; this.edges.legend = true; });
    buttons.cycle.addEventListener('pointerdown', (e) => { e.preventDefault(); this.usingTouch = true; this.edges.cycle += 1; });
  }

  private zone(el: HTMLElement, fn: (e: PointerEvent, phase: 'down' | 'move' | 'up') => void): void {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); this.usingTouch = true; fn(e, 'down'); });
    el.addEventListener('pointermove', (e) => fn(e, 'move'));
    el.addEventListener('pointerup', (e) => fn(e, 'up'));
    el.addEventListener('pointercancel', (e) => fn(e, 'up'));
  }

  private hold(el: HTMLElement, fire: boolean): void {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.usingTouch = true;
      if (!fire) return;
      this.fireDown = true;
      this.edges.firePressed = true;
    });
    const up = () => {
      if (!fire || !this.fireDown) return;
      this.fireDown = false;
      this.edges.fireReleased = true;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  private stick(e: PointerEvent, phase: 'down' | 'move' | 'up'): void {
    if (phase === 'down') {
      this.stickId = e.pointerId;
      this.stickOriginX = e.clientX;
      this.stickOriginY = e.clientY;
      this.stickX = 0;
      this.stickY = 0;
      return;
    }
    if (e.pointerId !== this.stickId) return;
    if (phase === 'up') {
      this.stickId = -1;
      this.stickX = 0;
      this.stickY = 0;
      return;
    }
    const dx = e.clientX - this.stickOriginX;
    const dy = e.clientY - this.stickOriginY;
    const m = Math.hypot(dx, dy) || 1;
    const c = Math.min(1, m / 46);
    this.stickX = (dx / m) * c;
    this.stickY = (dy / m) * c;
  }

  private look(e: PointerEvent, phase: 'down' | 'move' | 'up'): void {
    if (phase === 'down') {
      this.lookId = e.pointerId;
      this.lookX = e.clientX;
      this.lookY = e.clientY;
      this.lookMoved = 0;
      this.touchAim = true;
      return;
    }
    if (e.pointerId !== this.lookId) return;
    if (phase === 'up') {
      if (this.lookMoved < 16) {
        this.fireDown = true;
        this.edges.firePressed = true;
        this.fireDown = false;
        this.edges.fireReleased = true;
      }
      this.lookId = -1;
      return;
    }
    const dx = e.clientX - this.lookX;
    const dy = e.clientY - this.lookY;
    this.lookMoved = Math.max(this.lookMoved, Math.hypot(dx, dy));
    const m = Math.hypot(dx, dy);
    if (m > 4) {
      this.touchAngle = Math.atan2(dy, dx);
      this.touchMag = Math.min(1, m / 80);
      this.touchAim = true;
    }
  }

  requestSlot(index: number): void {
    this.edges.slot = index;
  }

  stickVisual(): { x: number; y: number; active: boolean } {
    return { x: this.stickX, y: this.stickY, active: this.stickId >= 0 };
  }

  private key(e: KeyboardEvent, down: boolean): void {
    if (!this.enabled) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const move = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
    if (move.includes(e.code)) e.preventDefault();
    if (down) {
      if (this.keys.has(e.code)) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.edges.dash = true;
      if (e.code === 'KeyR') this.edges.recall = true;
      if (e.code === 'KeyF') this.edges.legend = true;
      if (e.code === 'KeyQ') this.edges.cycle -= 1;
      const slot = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
      if (slot >= 0) this.edges.slot = slot;
    } else {
      this.keys.delete(e.code);
    }
  }

  axis(): { x: number; y: number } {
    let x = this.stickX;
    let y = this.stickY;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y };
  }

  takeEdges(): Edges {
    const e = this.edges;
    this.edges = { firePressed: false, fireReleased: false, dash: false, recall: false, legend: false, slot: -1, cycle: 0 };
    return e;
  }

  get pausedKey(): boolean {
    return this.keys.has('Escape') || this.keys.has('KeyP');
  }

  consumePause(): boolean {
    if (this.keys.has('Escape') || this.keys.has('KeyP')) {
      this.keys.delete('Escape');
      this.keys.delete('KeyP');
      return true;
    }
    return false;
  }
}
