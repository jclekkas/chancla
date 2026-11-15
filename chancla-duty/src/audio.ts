// Synthesized effects and a small cumbia-ish loop. Nothing to download.

export class AudioBus {
  private ctx: AudioContext | null = null;
  private music: GainNode | null = null;
  private sfx: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private next = 0;
  private step = 0;
  private started = false;
  musicVol = 0.45;
  sfxVol = 0.8;
  duck = 1;

  start(): void {
    if (this.started) {
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.music = ctx.createGain();
    this.sfx = ctx.createGain();
    this.music.connect(ctx.destination);
    this.sfx.connect(ctx.destination);
    this.apply();
    const n = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = n.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = n;
    this.next = ctx.currentTime + 0.05;
    this.started = true;
    if (ctx.state === 'suspended') void ctx.resume();
  }

  apply(): void {
    if (this.music) this.music.gain.value = this.musicVol * 0.7;
    if (this.sfx) this.sfx.gain.value = this.sfxVol;
  }

  update(): void {
    const ctx = this.ctx;
    const music = this.music;
    if (!ctx || !music || this.musicVol <= 0.001) return;
    const eighth = 60 / 104 / 2;
    const horizon = ctx.currentTime + 0.25;
    while (this.next < horizon) {
      this.schedule(this.step % 8, this.next);
      this.step++;
      this.next += eighth;
    }
  }

  private schedule(i: number, t: number): void {
    const ctx = this.ctx;
    const music = this.music;
    if (!ctx || !music) return;
    const bass = [110, 0, 165, 0, 131, 0, 165, 98][i] ?? 0;
    if (i === 0 || i === 4) this.tone(music, t, 70, 0.09, 'sine', 0.22);
    if (bass > 0) this.tone(music, t, bass, 0.16, 'triangle', 0.16);
    if (i % 2 === 1) this.burst(music, t, 0.04, 1800, 0.03);
    if (i === 2 || i === 6) this.tone(music, t, bass > 0 ? bass * 2 : 262, 0.12, 'square', 0.035);
  }

  private tone(dest: AudioNode, t: number, freq: number, dur: number, type: OscillatorType, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dest: AudioNode, t: number, dur: number, freq: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(dest);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private play(fn: (t: number, dest: AudioNode) => void): void {
    if (!this.ctx || !this.sfx || this.sfxVol <= 0.001) return;
    const t = this.ctx.currentTime;
    fn(t, this.sfx);
  }

  throw(charged: boolean): void {
    this.play((t, dest) => {
      this.burst(dest, t, charged ? 0.16 : 0.09, charged ? 500 : 900, (charged ? 0.22 : 0.14) * this.duck);
      this.tone(dest, t, charged ? 140 : 220, 0.08, 'sine', 0.08 * this.duck);
    });
  }

  slap(big: boolean): void {
    this.play((t, dest) => {
      this.tone(dest, t, big ? 150 : 210, 0.12, 'triangle', (big ? 0.28 : 0.18) * this.duck);
      this.burst(dest, t, 0.07, 700, 0.16 * this.duck);
    });
  }

  tick(): void {
    this.play((t, dest) => this.tone(dest, t, 540, 0.05, 'square', 0.05 * this.duck));
  }

  hurt(): void {
    this.play((t, dest) => this.tone(dest, t, 90, 0.2, 'sawtooth', 0.12 * this.duck));
  }

  pickup(): void {
    this.play((t, dest) => {
      this.tone(dest, t, 523, 0.08, 'sine', 0.08 * this.duck);
      this.tone(dest, t + 0.07, 659, 0.1, 'sine', 0.08 * this.duck);
    });
  }

  dash(): void {
    this.play((t, dest) => this.burst(dest, t, 0.1, 400, 0.1 * this.duck));
  }

  fanfare(): void {
    this.play((t, dest) => {
      this.tone(dest, t, 392, 0.12, 'triangle', 0.1);
      this.tone(dest, t + 0.1, 523, 0.16, 'triangle', 0.1);
    });
  }

  boom(): void {
    this.play((t, dest) => this.tone(dest, t, 55, 0.35, 'sine', 0.2 * this.duck));
  }

  dry(): void {
    this.play((t, dest) => this.tone(dest, t, 120, 0.05, 'square', 0.04 * this.duck));
  }
}
