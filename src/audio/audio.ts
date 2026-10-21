// Original synthesized audio. Everything is generated with Web Audio nodes
// at play time: no samples, no external files. Voices clean themselves up
// when they end, and a live-voice counter guards against leaks.

export type Sfx =
  | 'throw' | 'throwCharged' | 'throwGold' | 'thwap' | 'thwapBig' | 'ricochet' | 'land' | 'catch' | 'empty'
  | 'recall' | 'hurt' | 'pratfall' | 'pickup' | 'ui' | 'uiBack' | 'legendary' | 'blast' | 'telegraph'
  | 'gust' | 'heart' | 'bassDrop' | 'scratch' | 'bossHit' | 'blocked' | 'victory' | 'defeat' | 'waveStart'
  | 'waveClear' | 'chargeReady' | 'meterFull' | 'splash'
  | 'throwHeavy' | 'hitConfirm' | 'headshot' | 'hurtFps' | 'elimConfirm' | 'died' | 'heartbeat' | 'countdown' | 'go'
  | 'win' | 'lose' | 'switch' | 'jump' | 'landSoft' | 'step' | 'spawn' | 'shielded' | 'heavyImpact';

type MusicMode = 'off' | 'title' | 'game' | 'boss';

interface Ctx {
  ctx: AudioContext;
  master: GainNode;
  sfx: GainNode;
  music: GainNode;
  voice: GainNode;
  musicDuck: GainNode;
  duckEq: BiquadFilterNode;
  noise: AudioBuffer;
  shaper: WaveShaperNode;
}

const MAX_VOICES = 32;

export class AudioEngine {
  private a: Ctx | null = null;
  private volume = 0.8;
  private muted = false;
  private musicOn = true;
  private mode: MusicMode = 'off';
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;
  voices = 0;
  peakVoices = 0;
  failed = false;

  get ready(): boolean {
    return !!this.a && this.a.ctx.state === 'running';
  }

  get contextCount(): number {
    return this.a ? 1 : 0;
  }

  private runHooks: Array<(fresh: boolean) => void> = [];
  private armed = false;

  /**
   * Runs `fn` whenever audio becomes able to play: on the first unlock
   * (fresh = true, new nodes) and every time the context resumes after a
   * suspension (tab hidden, back/forward cache, an OS interruption).
   */
  onRunning(fn: (fresh: boolean) => void): void { this.runHooks.push(fn); }

  private ran(fresh: boolean): void { for (const f of this.runHooks) { try { f(fresh); } catch { /* keep the others */ } } }

  /**
   * Keeps audio alive for the life of the page. Browsers only let audio start
   * from a user gesture, and a gesture that doesn't qualify (Escape, a
   * modifier key, a pointerdown in some browsers) fails silently. So every
   * gesture retries until the context is running, not only the first one.
   * Audio also pauses while the tab is hidden and resumes on return,
   * including pages restored from the back/forward cache. Call once per page.
   */
  armLifecycle(): void {
    if (this.armed || typeof window === 'undefined') return;
    this.armed = true;
    const gesture = () => { if (!this.a || this.a.ctx.state !== 'running') this.unlock(); };
    for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'click', 'keydown', 'touchend']) window.addEventListener(ev, gesture, { capture: true, passive: true });
    const hide = () => {
      const a = this.a;
      if (a && a.ctx.state === 'running') void a.ctx.suspend().catch(() => undefined);
    };
    const show = () => {
      const a = this.a;
      if (!a) return;
      // Without a recent gesture this may stay pending; the next gesture retries.
      if (a.ctx.state !== 'running' && a.ctx.state !== 'closed') void a.ctx.resume().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', () => (document.hidden ? hide() : show()));
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
  }

  /** The context's state, for tests and the debug API. */
  get state(): string { return this.a ? this.a.ctx.state : this.failed ? 'unsupported' : 'locked'; }

  // Call from a user gesture. Safe to call repeatedly: creates the context
  // once, and resumes it whenever it isn't running.
  unlock(): void {
    if (this.failed) return;
    try {
      if (this.a && this.a.ctx.state === 'closed') this.a = null; // start over with a new context
      if (!this.a) {
        const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) { this.failed = true; return; }
        const ctx = new AC();
        const master = ctx.createGain();
        const sfx = ctx.createGain();
        const music = ctx.createGain();
        const voice = ctx.createGain();
        // Music passes through a ducking stage so dialogue stays clear.
        const musicDuck = ctx.createGain();
        // While a line plays, the music also dips where speech sits.
        const duckEq = ctx.createBiquadFilter();
        duckEq.type = 'peaking';
        duckEq.frequency.value = 2000;
        duckEq.Q.value = 0.7;
        duckEq.gain.value = 0;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 4;
        sfx.connect(master);
        music.connect(musicDuck);
        musicDuck.connect(duckEq);
        duckEq.connect(master);
        voice.connect(master);
        master.connect(comp);
        comp.connect(ctx.destination);
        music.gain.value = 0.32;
        const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const shaper = ctx.createWaveShaper();
        const curve = new Float32Array(256);
        for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(x * 4); }
        shaper.curve = curve;
        shaper.connect(sfx);
        this.a = { ctx, master, sfx, music, voice, musicDuck, duckEq, noise, shaper };
        voice.gain.value = this.voiceVol;
        this.applyGain();
        music.gain.value = 0.32 * this.musicVol;
        sfx.gain.value = this.sfxVol;
        ctx.addEventListener('statechange', () => { if (ctx.state === 'running' && this.a?.ctx === ctx) this.ran(false); });
        // The Arcade picks its music mode before audio exists (its title
        // screen shows at load); start that music now, unless it is paused.
        if (this.mode !== 'off' && !this.musicHeld) this.startMusicTimer();
        this.ran(true);
      }
      if (this.a.ctx.state !== 'running' && !(typeof document !== 'undefined' && document.hidden)) void this.a.ctx.resume().catch(() => undefined);
    } catch {
      this.failed = true;
    }
  }

  setVolume(v: number): void { this.volume = v; this.applyGain(); }
  setMuted(m: boolean): void { this.muted = m; this.applyGain(); }
  setMusic(on: boolean): void {
    this.musicOn = on;
    if (this.a) this.a.music.gain.setTargetAtTime(on ? 0.32 * this.musicVol : 0, this.a.ctx.currentTime, 0.05);
  }

  private musicVol = 1;
  private sfxVol = 1;

  // Separate music and effects levels (0..1), on top of the master volume.
  setLevels(music: number, sfx: number): void {
    this.musicVol = music;
    this.sfxVol = sfx;
    this.musicOn = music > 0.001;
    if (!this.a) return;
    this.a.music.gain.setTargetAtTime(0.32 * music, this.a.ctx.currentTime, 0.05);
    this.a.sfx.gain.setTargetAtTime(sfx, this.a.ctx.currentTime, 0.02);
  }

  private voiceVol = 1;

  setVoiceLevel(v: number): void {
    this.voiceVol = v;
    if (this.a) this.a.voice.gain.setTargetAtTime(v, this.a.ctx.currentTime, 0.03);
  }

  /** How far dialogue lowers the music; the music engine sets it per layer. */
  duckDepth = 0.55;

  // Lowers music while a line is spoken (1 = no ducking).
  duck(k: number): void {
    if (!this.a) return;
    const t = this.a.ctx.currentTime;
    this.a.musicDuck.gain.setTargetAtTime(k, t, 0.12);
    this.a.duckEq.gain.setTargetAtTime(k < 1 ? -4 : 0, t, 0.12);
  }

  /** Low-level access for the music sequencer and voice playback. */
  get nodes(): { ctx: AudioContext; music: GainNode; voice: GainNode; sfx: GainNode; master: GainNode } | null {
    return this.a && { ctx: this.a.ctx, music: this.a.music, voice: this.a.voice, sfx: this.a.sfx, master: this.a.master };
  }

  // Test hook: records the final mix (music, effects and voice) as a stream.
  captureStream(): MediaStream | null {
    const a = this.a;
    if (!a || typeof a.ctx.createMediaStreamDestination !== 'function') return null;
    const dest = a.ctx.createMediaStreamDestination();
    a.master.connect(dest);
    return dest.stream;
  }

  private applyGain(): void {
    if (!this.a) return;
    const g = this.muted ? 0 : this.volume;
    this.a.master.gain.setTargetAtTime(g, this.a.ctx.currentTime, 0.02);
  }

  // The Arcade's own music: held while paused or hidden, released on resume.
  private musicHeld = false;

  suspend(): void {
    this.musicHeld = true;
    this.stopMusicTimer();
  }

  resume(): void {
    this.musicHeld = false;
    if (this.mode !== 'off') this.startMusicTimer();
  }

  // ----- voice helpers -----

  private track(src: AudioScheduledSourceNode, nodes: AudioNode[]): void {
    this.voices++;
    if (this.voices > this.peakVoices) this.peakVoices = this.voices;
    src.onended = () => {
      for (const n of nodes) {
        try { n.disconnect(); } catch { /* already gone */ }
      }
      this.voices--;
    };
  }

  private tone(
    type: OscillatorType, f0: number, f1: number, t: number, dur: number, gain: number,
    opts: { attack?: number; filter?: BiquadFilterType; fq?: number; q?: number; fq1?: number; dest?: AudioNode; vibrato?: number; curve?: 'exp' | 'lin' } = {},
  ): void {
    const a = this.a;
    if (!a || this.voices >= MAX_VOICES) return;
    const { ctx } = a;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    if (opts.curve === 'lin') o.frequency.linearRampToValueAtTime(Math.max(1, f1), t + dur);
    else o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    const atk = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const nodes: AudioNode[] = [o, g];
    let head: AudioNode = o;
    if (opts.filter) {
      const f = ctx.createBiquadFilter();
      f.type = opts.filter;
      f.frequency.setValueAtTime(opts.fq ?? 1000, t);
      if (opts.fq1) f.frequency.exponentialRampToValueAtTime(opts.fq1, t + dur);
      f.Q.value = opts.q ?? 1;
      head.connect(f);
      head = f;
      nodes.push(f);
    }
    if (opts.vibrato) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 7;
      lg.gain.value = opts.vibrato;
      lfo.connect(lg);
      lg.connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.02);
      nodes.push(lfo, lg);
    }
    head.connect(g);
    g.connect(opts.dest ?? a.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
    this.track(o, nodes);
  }

  private noise(
    t: number, dur: number, gain: number,
    opts: { filter?: BiquadFilterType; fq?: number; fq1?: number; q?: number; attack?: number; dest?: AudioNode } = {},
  ): void {
    const a = this.a;
    if (!a || this.voices >= MAX_VOICES) return;
    const { ctx } = a;
    const src = ctx.createBufferSource();
    src.buffer = a.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.filter ?? 'bandpass';
    f.frequency.setValueAtTime(opts.fq ?? 1200, t);
    if (opts.fq1) f.frequency.exponentialRampToValueAtTime(opts.fq1, t + dur);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    const atk = opts.attack ?? 0.003;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(opts.dest ?? a.sfx);
    const offset = Math.random() * 0.5;
    src.start(t, offset, dur + 0.05);
    this.track(src, [src, f, g]);
  }

  play(name: Sfx, intensity = 1): void {
    const a = this.a;
    if (!a || a.ctx.state !== 'running') return;
    const t = a.ctx.currentTime + 0.005;
    const k = Math.max(0.3, Math.min(1.5, intensity));
    switch (name) {
      case 'throw':
        this.noise(t, 0.16, 0.22, { filter: 'bandpass', fq: 500, fq1: 2600, q: 2.5 });
        break;
      case 'throwCharged':
        this.noise(t, 0.28, 0.32, { filter: 'bandpass', fq: 300, fq1: 2200, q: 3 });
        this.tone('sine', 220, 520, t, 0.25, 0.08);
        break;
      case 'throwGold':
        this.noise(t, 0.12, 0.14, { filter: 'bandpass', fq: 1500, fq1: 4000, q: 4 });
        this.tone('triangle', 1320, 1980, t, 0.12, 0.05);
        break;
      case 'thwap':
      case 'thwapBig': {
        const big = name === 'thwapBig';
        // Sharp rubbery slap: a high snap, a fat pitched body and a smack.
        this.noise(t, 0.045, 0.55 * k, { filter: 'highpass', fq: 1800, q: 0.7 });
        this.tone('triangle', big ? 210 : 260, big ? 55 : 80, t, big ? 0.2 : 0.13, 0.5 * k);
        this.noise(t + 0.004, big ? 0.12 : 0.08, 0.4 * k, { filter: 'bandpass', fq: 950, fq1: 500, q: 2.2 });
        if (big) this.tone('sine', 90, 40, t, 0.25, 0.4);
        break;
      }
      case 'ricochet':
        this.tone('triangle', 900, 1500, t, 0.07, 0.18, { curve: 'lin' });
        this.tone('sine', 1500, 700, t + 0.06, 0.16, 0.12);
        this.noise(t, 0.03, 0.2, { filter: 'highpass', fq: 3000 });
        break;
      case 'land':
        this.tone('sine', 140, 60, t, 0.1, 0.14);
        this.noise(t, 0.05, 0.08, { filter: 'lowpass', fq: 800 });
        break;
      case 'catch':
        this.tone('square', 1250, 1250, t, 0.035, 0.05, { filter: 'lowpass', fq: 3000 });
        this.tone('sine', 820, 980, t + 0.02, 0.07, 0.09);
        break;
      case 'empty':
        this.tone('square', 180, 150, t, 0.06, 0.06, { filter: 'lowpass', fq: 900 });
        break;
      case 'recall':
        this.tone('sine', 520, 1250, t, 0.22, 0.1, { curve: 'lin' });
        break;
      case 'hurt':
        this.tone('sawtooth', 240, 110, t, 0.28, 0.2, { filter: 'lowpass', fq: 1100 });
        this.noise(t, 0.12, 0.25, { filter: 'lowpass', fq: 600 });
        break;
      case 'pratfall':
        this.tone('sine', 1500, 280, t, 0.6, 0.12, { vibrato: 25 });
        this.tone('triangle', 120, 60, t + 0.62, 0.15, 0.25);
        this.noise(t + 0.62, 0.12, 0.2, { filter: 'lowpass', fq: 700 });
        break;
      case 'pickup':
        [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, t + i * 0.07, 0.14, 0.13));
        break;
      case 'ui':
        this.tone('triangle', 660, 880, t, 0.06, 0.08);
        break;
      case 'uiBack':
        this.tone('triangle', 660, 440, t, 0.07, 0.07);
        break;
      case 'chargeReady':
        this.tone('sine', 1320, 1320, t, 0.08, 0.06);
        break;
      case 'meterFull':
        [784, 988, 1175].forEach((f, i) => this.tone('triangle', f, f, t + i * 0.06, 0.18, 0.1));
        break;
      case 'legendary': {
        [261.6, 329.6, 392, 523.3].forEach((f) => {
          this.tone('sawtooth', f, f * 2, t, 1.1, 0.06, { filter: 'lowpass', fq: 400, fq1: 5000, attack: 0.05 });
        });
        [1047, 1319, 1568, 2093, 2637].forEach((f, i) => this.tone('sine', f, f, t + 0.15 + i * 0.07, 0.4, 0.07));
        this.noise(t, 0.9, 0.12, { filter: 'highpass', fq: 4000, attack: 0.3 });
        break;
      }
      case 'splash':
        this.tone('sine', 1800, 900, t, 0.12, 0.06);
        break;
      case 'blast': {
        const src = this.a?.shaper;
        this.tone('sawtooth', 110, 85, t, 0.45, 0.22, { dest: src, filter: 'bandpass', fq: 400, fq1: 1600, q: 3 });
        this.tone('square', 55, 50, t, 0.45, 0.15, { dest: src });
        break;
      }
      case 'telegraph':
        this.tone('square', 880, 880, t, 0.06, 0.05, { filter: 'lowpass', fq: 2500 });
        this.tone('square', 880, 880, t + 0.12, 0.06, 0.05, { filter: 'lowpass', fq: 2500 });
        break;
      case 'gust':
        this.noise(t, 0.6, 0.3, { filter: 'lowpass', fq: 300, fq1: 1800, q: 1, attack: 0.08 });
        this.tone('sawtooth', 90, 140, t, 0.6, 0.06, { filter: 'lowpass', fq: 500 });
        break;
      case 'heart':
        this.tone('sine', 700, 1400, t, 0.12, 0.08);
        this.tone('triangle', 1760, 1760, t + 0.1, 0.1, 0.04);
        break;
      case 'bassDrop':
        this.tone('sine', 110, 32, t, 0.8, 0.5);
        this.noise(t, 0.3, 0.15, { filter: 'lowpass', fq: 300 });
        break;
      case 'scratch':
        this.noise(t, 0.1, 0.25, { filter: 'bandpass', fq: 600, fq1: 2400, q: 6 });
        this.noise(t + 0.11, 0.1, 0.25, { filter: 'bandpass', fq: 2400, fq1: 600, q: 6 });
        break;
      case 'bossHit':
        this.tone('square', 300, 200, t, 0.18, 0.1, { filter: 'lowpass', fq: 1400 });
        this.tone('square', 240, 160, t + 0.05, 0.2, 0.08, { filter: 'lowpass', fq: 1200 });
        break;
      case 'blocked':
        this.tone('sine', 2000, 2600, t, 0.08, 0.08);
        this.tone('triangle', 400, 300, t, 0.1, 0.08);
        break;
      case 'waveStart':
        [392, 523, 659].forEach((f, i) => this.tone('sawtooth', f, f, t + i * 0.09, 0.22, 0.07, { filter: 'lowpass', fq: 2200 }));
        break;
      case 'waveClear':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone('triangle', f, f, t + i * 0.08, 0.25, 0.1));
        break;
      case 'victory': {
        const notes = [523, 659, 784, 1047, 784, 1047, 1319];
        notes.forEach((f, i) => this.tone('sawtooth', f, f, t + i * 0.13, i === notes.length - 1 ? 0.9 : 0.16, 0.08, { filter: 'lowpass', fq: 2600 }));
        [523, 659, 784].forEach((f) => this.tone('triangle', f, f, t + 0.9, 1.0, 0.07));
        break;
      }
      case 'throwHeavy':
        this.noise(t, 0.34, 0.34, { filter: 'bandpass', fq: 220, fq1: 900, q: 2.5 });
        this.tone('sine', 140, 70, t, 0.3, 0.16);
        break;
      case 'hitConfirm':
        // Crisp, server-confirmed: a short high tick over the slap.
        this.tone('square', 1900, 1900, t, 0.03, 0.06, { filter: 'lowpass', fq: 5000 });
        this.tone('triangle', 1300, 1600, t + 0.015, 0.06, 0.08);
        break;
      case 'headshot':
        this.tone('triangle', 1760, 2350, t, 0.09, 0.12, { curve: 'lin' });
        this.tone('sine', 2640, 2640, t + 0.06, 0.12, 0.07);
        break;
      case 'hurtFps':
        this.tone('triangle', 300, 150, t, 0.14, 0.18, { filter: 'lowpass', fq: 1400 });
        this.noise(t, 0.08, 0.2, { filter: 'lowpass', fq: 900 });
        break;
      case 'elimConfirm':
        [784, 988, 1319].forEach((f, i) => this.tone('triangle', f, f, t + i * 0.06, 0.14, 0.12));
        this.tone('sine', 1500, 300, t + 0.05, 0.45, 0.06, { vibrato: 20 });
        break;
      case 'died':
        this.tone('sine', 900, 180, t, 0.55, 0.14, { vibrato: 18 });
        this.tone('triangle', 110, 55, t + 0.5, 0.2, 0.25);
        break;
      case 'heartbeat':
        this.tone('sine', 70, 48, t, 0.12, 0.35);
        this.tone('sine', 66, 46, t + 0.18, 0.12, 0.25);
        break;
      case 'countdown':
        this.tone('square', 660, 660, t, 0.09, 0.07, { filter: 'lowpass', fq: 2400 });
        break;
      case 'go':
        [523, 784, 1047].forEach((f) => this.tone('sawtooth', f, f, t, 0.35, 0.05, { filter: 'lowpass', fq: 3000 }));
        break;
      case 'win':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone('triangle', f, f, t + i * 0.1, i === 4 ? 0.7 : 0.16, 0.11));
        break;
      case 'lose':
        [392, 349, 311].forEach((f, i) => this.tone('sawtooth', f, f * 0.97, t + i * 0.32, 0.3, 0.08, { filter: 'lowpass', fq: 900 }));
        break;
      case 'switch':
        this.noise(t, 0.05, 0.12, { filter: 'bandpass', fq: 2200, q: 3 });
        this.tone('triangle', 500, 700, t + 0.04, 0.05, 0.05);
        break;
      case 'jump':
        this.noise(t, 0.06, 0.06, { filter: 'lowpass', fq: 700 });
        break;
      case 'landSoft':
        this.tone('sine', 120, 70, t, 0.08, 0.1);
        this.noise(t, 0.06, 0.08, { filter: 'lowpass', fq: 500 });
        break;
      case 'step':
        this.noise(t, 0.035, 0.035 * k, { filter: 'bandpass', fq: 600 + Math.random() * 300, q: 1.5 });
        break;
      case 'spawn':
        [880, 1175, 1568].forEach((f, i) => this.tone('sine', f, f, t + i * 0.05, 0.16, 0.05));
        break;
      case 'shielded':
        this.tone('sine', 1800, 2400, t, 0.08, 0.07);
        break;
      case 'heavyImpact':
        this.tone('sine', 110, 40, t, 0.3, 0.4);
        this.noise(t, 0.16, 0.35, { filter: 'lowpass', fq: 900, fq1: 200 });
        break;
      case 'defeat':
        // Sad trombone: four sagging notes with a wah on the last.
        [392, 370, 349, 330].forEach((f, i) => {
          const last = i === 3;
          this.tone('sawtooth', f, last ? f * 0.94 : f * 0.98, t + i * 0.42, last ? 1.0 : 0.38, 0.1, { filter: 'lowpass', fq: 900, fq1: last ? 500 : 900, vibrato: last ? 8 : 0 });
        });
        break;
    }
  }

  // ----- music: a light cumbia groove, darker and faster for the boss -----

  setMusicMode(mode: MusicMode): void {
    if (mode === this.mode) {
      if (mode !== 'off') this.startMusicTimer();
      return;
    }
    this.mode = mode;
    if (mode === 'off') {
      this.stopMusicTimer();
    } else {
      this.step = 0;
      this.startMusicTimer();
    }
  }

  get musicMode(): MusicMode {
    return this.mode;
  }

  get musicTimerRunning(): boolean {
    return this.timer !== null;
  }

  private startMusicTimer(): void {
    if (!this.a || this.timer !== null) return;
    this.nextTime = this.a.ctx.currentTime + 0.06;
    this.timer = setInterval(() => this.schedule(), 40);
  }

  private stopMusicTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    const a = this.a;
    if (!a || a.ctx.state !== 'running' || this.mode === 'off') return;
    if (!this.musicOn) {
      this.nextTime = a.ctx.currentTime + 0.05;
      return;
    }
    const bpm = this.mode === 'boss' ? 112 : this.mode === 'title' ? 92 : 98;
    const sixteenth = 60 / bpm / 4;
    if (this.nextTime < a.ctx.currentTime - 0.2) this.nextTime = a.ctx.currentTime + 0.05;
    while (this.nextTime < a.ctx.currentTime + 0.2) {
      this.note(this.step, this.nextTime, sixteenth);
      this.nextTime += sixteenth;
      this.step = (this.step + 1) % 64;
    }
  }

  private note(step: number, t: number, s: number): void {
    const m = this.a!.music;
    const boss = this.mode === 'boss';
    const bar = Math.floor(step / 16);
    const inBar = step % 16;
    // Progressions: G - D - C - D (game), Am - G - F - E (boss).
    const roots = boss ? [110, 98, 87.3, 82.4] : [98, 73.4, 65.4, 73.4];
    const root = roots[bar]!;
    const fifth = root * 1.5;
    // Cumbia bass: root on 1, fifth on 2-and, root on 3, fifth on 4-and.
    if (inBar === 0 || inBar === 8) this.tone('triangle', root, root, t, s * 2.5, 0.32, { filter: 'lowpass', fq: 600, dest: m });
    if (inBar === 6 || inBar === 14) this.tone('triangle', fifth, fifth, t, s * 1.6, 0.26, { filter: 'lowpass', fq: 600, dest: m });
    // Güiro: long-short-short on every beat.
    if (inBar % 4 === 0) this.noise(t, s * 1.6, 0.06, { filter: 'highpass', fq: 3500, attack: s * 1.2, dest: m });
    else if (inBar % 4 === 2 || inBar % 4 === 3) this.noise(t, s * 0.5, 0.05, { filter: 'highpass', fq: 4000, dest: m });
    // Cowbell offbeats.
    if (inBar % 4 === 2) this.tone('square', 800, 800, t, 0.05, 0.03, { filter: 'bandpass', fq: 800, q: 4, dest: m });
    // Chord stabs on the offbeat (major triads; minor for the boss).
    if (inBar % 4 === 2 && this.mode !== 'title') {
      const third = boss && bar === 0 ? 1.189 : 1.26;
      [2, 2 * third, 3].forEach((mul) => this.tone('square', root * mul * 2, root * mul * 2, t, s * 0.9, 0.018, { filter: 'lowpass', fq: 1800, dest: m }));
    }
    if (boss && inBar % 4 === 0) this.tone('sine', 120, 45, t, 0.18, 0.4, { dest: m });
    // Simple marimba-ish melody on the title screen.
    if (this.mode === 'title' && (inBar === 0 || inBar === 3 || inBar === 6 || inBar === 10)) {
      const mel = [5, 4, 3, 2];
      const f = root * mel[Math.floor(inBar / 3)]! * 2;
      this.tone('sine', f, f, t, s * 2, 0.05, { dest: m });
    }
  }
}

export const audio = new AudioEngine();
