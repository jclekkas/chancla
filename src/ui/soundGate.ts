// The "Enable sound" control, shared by the main game and the Arcade.
//
// Browsers only start audio from a user gesture, and nothing on screen said
// so: a visitor who never clicked, or whose click didn't count, heard
// nothing and had no way to tell why. This control shows whenever audio is
// not actually running, and tells apart:
//   enable       audio hasn't started yet: tap to start it
//   blocked      a gesture was made but the browser still won't play
//   unsupported  this browser has no Web Audio
//   muted        the player turned sound off (menus only; it is a choice)
// A track that fails to download is not an error here: the built-in score
// plays instead and the Settings status line says so (describe()).
// The button calls the unlock directly from its own click, and only hides
// once the audio context really reports "running".
import { audio } from '../audio/audio';

export type GateState = 'hidden' | 'enable' | 'blocked' | 'unsupported' | 'muted';
export type MusicStatus = 'ok' | 'loading' | 'fallback' | 'failed';

export interface GateOptions {
  text: (key: 'enable' | 'blocked' | 'blockedHint' | 'unsupported' | 'muted') => string;
  /** In play the control stays out of the way of the HUD, and mute is not nagged about. */
  inGame: () => boolean;
  /** Opens the sound settings (from the "muted" state). */
  openSettings?: () => void;
  /** The main game's recorded-music status, for describe(). */
  musicStatus?: () => MusicStatus;
}

export class SoundGate {
  readonly el: HTMLButtonElement;
  state: GateState = 'hidden';
  private attemptAt = -1;
  private busy = false;
  private timer: ReturnType<typeof setInterval>;

  constructor(private opts: GateOptions) {
    const el = document.createElement('button');
    el.type = 'button';
    el.id = 'sound-gate';
    el.className = 'sound-gate';
    el.hidden = true;
    el.addEventListener('click', (e) => { e.stopPropagation(); void this.activate(); });
    document.body.appendChild(el);
    this.el = el;
    // A gesture anywhere counts as an attempt; give the browser a moment to start audio.
    const seen = () => { if (this.attemptAt < 0) this.attemptAt = performance.now(); };
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, seen, { capture: true, passive: true });
    this.timer = setInterval(() => this.update(), 400);
    this.update();
  }

  private async activate(): Promise<void> {
    if (this.state === 'muted') { this.opts.openSettings?.(); return; }
    if (this.busy) return;
    this.busy = true;
    this.attemptAt = performance.now();
    this.el.classList.add('trying');
    try {
      await audio.unlockFromGesture();
    } finally {
      this.busy = false;
      this.el.classList.remove('trying');
      this.update(true);
    }
  }

  update(afterAttempt = false): void {
    const st = audio.state;
    let next: GateState;
    if (st === 'unsupported') next = 'unsupported';
    else if (st !== 'running') {
      const tried = afterAttempt || (this.attemptAt >= 0 && performance.now() - this.attemptAt > 1200);
      next = tried ? 'blocked' : 'enable';
      // While the tab is hidden audio is paused on purpose.
      if (typeof document !== 'undefined' && document.hidden) next = 'hidden';
    } else if (audio.mutedByUser && !this.opts.inGame()) next = 'muted';
    else next = 'hidden';
    this.el.classList.toggle('in-game', this.opts.inGame());
    if (next === this.state && !afterAttempt) return;
    this.state = next;
    this.render();
  }

  /** Re-labels after a language change. */
  render(): void {
    const el = this.el;
    el.hidden = this.state === 'hidden';
    el.dataset.state = this.state;
    if (this.state === 'hidden') return;
    const k = this.state === 'enable' ? 'enable' : this.state === 'blocked' ? 'blocked' : this.state === 'unsupported' ? 'unsupported' : 'muted';
    el.textContent = `${this.state === 'enable' ? '🔈' : '🔇'} ${this.opts.text(k)}`;
    el.title = this.state === 'blocked' ? this.opts.text('blockedHint') : '';
    el.disabled = this.state === 'unsupported';
  }

  /** One line for the Settings panel: what the sound system is doing right now. */
  describe(t: (key: 'on' | 'enable' | 'blocked' | 'unsupported' | 'muted' | 'loading' | 'fallback' | 'failed') => string): string {
    if (this.state === 'unsupported') return t('unsupported');
    if (this.state === 'enable') return t('enable');
    if (this.state === 'blocked') return t('blocked');
    if (audio.mutedByUser) return t('muted');
    const m = this.opts.musicStatus?.() ?? 'ok';
    return m === 'ok' ? t('on') : t(m);
  }

  dispose(): void { clearInterval(this.timer); this.el.remove(); }
}
