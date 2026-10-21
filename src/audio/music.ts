// Original score for the shooter and the campaign, synthesized live with
// Web Audio (no samples, no files, nothing downloaded at play time).
//
// One recurring motif, "Rosa's theme" (5-3-5-6 | 5 · 3-2 | 1-2-3-5 | 3),
// is arranged per context:
//   menu      relaxed cumbia groove, marimba states the motif
//   lobby     the same groove, motif left out, guitar comping only
//   combat    restrained: bass, soft güiro and pads, low-passed, no lead in
//             the 1-4 kHz band, so footsteps and hit cues stay clear
//   results   short brass-and-marimba fanfare on the motif, then a loop
//   ruleros   morning: plucked requinto lead, light shaker
//   cocina    busier: double-time guajeo comp, conga tumbao
//   patio     afternoon: squeezebox-style lead, whistled answer
//   pinata    the finale: brass, full percussion, faster
//   select    mission select: harp-like plucks, motif in slow values
// Loops are scheduled ahead on the audio clock, so they are seamless;
// switching tracks crossfades on the next bar line. Intensity (0-1) adds
// percussion and counter-lines without restarting the loop.
import { audio } from './audio';

export type TrackId = 'menu' | 'lobby' | 'combat' | 'results' | 'ruleros' | 'cocina' | 'patio' | 'pinata' | 'select' | 'off';
type Stinger = 'objective' | 'setback' | 'phase' | 'complete' | 'fail';

interface Track {
  bpm: number;
  root: number; // MIDI note of the tonic
  minor?: boolean;
  prog: number[]; // chord root (scale degree, 1-based) per bar, 8 bars
  lead: 'none' | 'marimba' | 'pluck' | 'squeeze' | 'brass' | 'harp';
  leadOctave: number;
  comp: 'cumbia' | 'guajeo' | 'arp' | 'pad';
  bass: boolean;
  perc: number; // base percussion density 0..1
  gain: number;
  lowpass?: number; // whole-track filter (combat)
  motifEvery?: number; // play the motif in these bars (bitmask over 8 bars)
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

// The motif: [step (16ths from bar start, over two bars), degree, length in 16ths].
const MOTIF_A: Array<[number, number, number]> = [[0, 5, 2], [2, 3, 2], [4, 5, 2], [6, 6, 3], [10, 5, 4], [16, 3, 2], [19, 2, 3], [24, 1, 2], [26, 2, 2], [28, 3, 2], [30, 5, 2]];
const MOTIF_B: Array<[number, number, number]> = [[0, 3, 6], [8, 2, 2], [10, 3, 2], [12, 4, 4], [16, 3, 3], [19, 2, 3], [22, 1, 6]];

const TRACKS: Record<Exclude<TrackId, 'off'>, Track> = {
  menu: { bpm: 96, root: 55, prog: [1, 5, 6, 4, 1, 5, 4, 5], lead: 'marimba', leadOctave: 1, comp: 'cumbia', bass: true, perc: 0.5, gain: 1, motifEvery: 0b01010101 },
  lobby: { bpm: 96, root: 55, prog: [1, 4, 5, 1, 6, 4, 5, 5], lead: 'none', leadOctave: 1, comp: 'cumbia', bass: true, perc: 0.35, gain: 0.85 },
  combat: { bpm: 100, root: 50, minor: true, prog: [1, 6, 7, 5, 1, 6, 4, 5], lead: 'none', leadOctave: 0, comp: 'pad', bass: true, perc: 0.3, gain: 0.7, lowpass: 1300 },
  results: { bpm: 100, root: 57, prog: [1, 4, 5, 1, 4, 5, 1, 1], lead: 'marimba', leadOctave: 1, comp: 'cumbia', bass: true, perc: 0.45, gain: 0.95, motifEvery: 0b00010001 },
  select: { bpm: 84, root: 53, prog: [1, 6, 4, 5, 1, 6, 2, 5], lead: 'harp', leadOctave: 1, comp: 'arp', bass: true, perc: 0.15, gain: 0.85, motifEvery: 0b00010001 },
  ruleros: { bpm: 98, root: 55, prog: [1, 5, 6, 4, 1, 5, 4, 5], lead: 'pluck', leadOctave: 1, comp: 'cumbia', bass: true, perc: 0.4, gain: 0.9, motifEvery: 0b00010001 },
  cocina: { bpm: 108, root: 57, prog: [1, 4, 5, 4, 1, 4, 5, 5], lead: 'pluck', leadOctave: 1, comp: 'guajeo', bass: true, perc: 0.55, gain: 0.85, motifEvery: 0b00100010 },
  patio: { bpm: 100, root: 53, prog: [1, 6, 2, 5, 1, 6, 4, 5], lead: 'squeeze', leadOctave: 1, comp: 'cumbia', bass: true, perc: 0.45, gain: 0.85, motifEvery: 0b00010001 },
  pinata: { bpm: 124, root: 58, prog: [1, 5, 6, 4, 1, 5, 4, 5], lead: 'brass', leadOctave: 0, comp: 'guajeo', bass: true, perc: 0.75, gain: 0.95, motifEvery: 0b01010101 },
};

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

class Lane {
  gain: GainNode;
  filter: BiquadFilterNode;
  step = 0;
  next = 0;
  constructor(public id: Exclude<TrackId, 'off'>, ctx: AudioContext, dest: AudioNode, public startAt: number) {
    this.gain = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = TRACKS[id].lowpass ?? 16000;
    this.filter.connect(this.gain);
    this.gain.connect(dest);
    this.next = startAt;
  }
}

export class Music {
  private lanes: Lane[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private want: TrackId = 'off';
  private intensity = 0.4;
  private smooth = 0.4;
  private ks = new Map<string, AudioBuffer>();
  private live = 0;
  private seed = 12345;
  current: TrackId = 'off';
  scheduled = 0; // notes scheduled (tests)

  play(id: TrackId): void {
    this.want = id;
    const n = audio.nodes;
    if (!n) return; // audio not unlocked yet: started on the next call after unlock
    if (id === this.current) { this.ensureTimer(); return; }
    const ctx = n.ctx;
    const now = ctx.currentTime;
    // Crossfade on the next bar of the outgoing track (or right away).
    const old = this.lanes[this.lanes.length - 1];
    let at = now + 0.08;
    if (old) {
      const spb = 60 / TRACKS[old.id].bpm / 4;
      const toBar = (16 - (old.step % 16)) % 16;
      at = Math.max(now + 0.05, old.next + toBar * spb);
      for (const l of this.lanes) {
        l.gain.gain.cancelScheduledValues(now);
        l.gain.gain.setValueAtTime(l.gain.gain.value, now);
        l.gain.gain.linearRampToValueAtTime(0.0001, at + 0.6);
        const dead = l;
        setTimeout(() => { try { dead.gain.disconnect(); } catch { /* gone */ } this.lanes = this.lanes.filter((x) => x !== dead); }, (at - now + 0.8) * 1000);
      }
    }
    this.current = id;
    if (id === 'off') return;
    const lane = new Lane(id, ctx, n.music, at);
    lane.gain.gain.setValueAtTime(0.0001, now);
    lane.gain.gain.linearRampToValueAtTime(TRACKS[id].gain, at + 0.5);
    this.lanes.push(lane);
    this.ensureTimer();
  }

  /** Called after the audio context unlocks so a requested track starts. */
  resume(): void { const w = this.want; this.current = 'off'; this.lanes = []; this.play(w); }

  setIntensity(k: number): void { this.intensity = Math.max(0, Math.min(1, k)); }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.schedule(), 40);
  }

  stop(): void {
    this.play('off');
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private schedule(): void {
    const n = audio.nodes;
    if (!n || n.ctx.state !== 'running') return;
    this.smooth += (this.intensity - this.smooth) * 0.05;
    const now = n.ctx.currentTime;
    for (const lane of this.lanes) {
      if (lane.id !== this.current) continue;
      const tr = TRACKS[lane.id];
      const s16 = 60 / tr.bpm / 4;
      if (lane.next < now - 0.25) lane.next = now + 0.05; // after a stall, resync instead of bursting
      while (lane.next < now + 0.22) {
        this.step(lane, tr, lane.step, lane.next, s16, n.ctx);
        lane.next += s16;
        lane.step = (lane.step + 1) % (16 * 8);
      }
    }
  }

  private deg(tr: Track, d: number, octave = 0): number {
    const sc = tr.minor ? MINOR : MAJOR;
    const i = d - 1;
    const o = Math.floor(i / 7);
    return tr.root + sc[((i % 7) + 7) % 7]! + 12 * (o + octave);
  }

  private step(lane: Lane, tr: Track, step: number, t: number, s: number, ctx: AudioContext): void {
    const bar = Math.floor(step / 16);
    const b = step % 16;
    const k = this.smooth;
    const out = lane.filter;
    const root = tr.prog[bar]!;
    const chord = [root, root + 2, root + 4];

    // Bass: cumbia root / fifth figure (guitarrón-like pluck).
    if (tr.bass) {
      if (b === 0 || b === 8) this.pluck(ctx, out, mtof(this.deg(tr, root, -2)), t, 0.9, 0.34, 0.993, 0.25);
      if (b === 6 || b === 14) this.pluck(ctx, out, mtof(this.deg(tr, root + 4, -2)), t, 0.6, 0.26, 0.993, 0.25);
      if (tr.comp === 'guajeo' && (b === 3 || b === 11)) this.pluck(ctx, out, mtof(this.deg(tr, root, -2)), t, 0.4, 0.16, 0.99, 0.25);
    }

    // Comping.
    switch (tr.comp) {
      case 'cumbia':
        if (b % 4 === 2) for (const d of chord) this.pluck(ctx, out, mtof(this.deg(tr, d, 0)), t, 0.35, 0.07, 0.985, 0.6);
        break;
      case 'guajeo': {
        // Interlocking eighth-note figure over the chord.
        const pat = [0, 2, 1, 2, 0, 2, 1, 2];
        if (b % 2 === 0) this.pluck(ctx, out, mtof(this.deg(tr, chord[pat[b / 2]!]!, 0)), t, 0.25, 0.08, 0.982, 0.7);
        break;
      }
      case 'arp':
        if (b % 2 === 0) this.pluck(ctx, out, mtof(this.deg(tr, chord[(b / 2) % 3]! + (b >= 8 ? 7 : 0), 0)), t, 0.8, 0.07, 0.994, 0.45);
        break;
      case 'pad':
        if (b === 0) for (const d of chord) this.pad(ctx, out, mtof(this.deg(tr, d, 0)), t, s * 16, 0.035);
        break;
    }

    // Percussion, denser with intensity.
    const p = tr.perc + k * 0.35;
    if (b % 4 === 0) this.noise(ctx, out, t, s * 1.6, 0.045 * p + 0.01, 3500, 'highpass', s * 1.1); // güiro long
    else if (b % 4 === 2 || b % 4 === 3) this.noise(ctx, out, t, s * 0.5, 0.035 * p + 0.008, 4200, 'highpass'); // güiro short
    if (p > 0.45 && b % 2 === 1) this.noise(ctx, out, t, s * 0.4, 0.02 * p, 7000, 'highpass'); // shaker
    if (p > 0.5 && [0, 3, 6, 10, 12].includes(b) && bar % 2 === 0) this.tone(ctx, out, 'sine', 2400, 2400, t, 0.05, 0.05 * p); // clave
    if (p > 0.6 && (b === 7 || b === 15)) this.tone(ctx, out, 'sine', 210, 170, t, 0.16, 0.12 * p); // conga open
    if (p > 0.6 && (b === 4 || b === 12)) this.tone(ctx, out, 'sine', 300, 260, t, 0.08, 0.06 * p); // conga slap
    if (p > 0.7 && (b === 0 || b === 8)) this.tone(ctx, out, 'sine', 110, 45, t, 0.18, 0.18 * p); // kick
    if (lane.id === 'pinata' && bar === 7 && b >= 12) this.noise(ctx, out, t, s * 0.8, 0.05, 1800, 'bandpass'); // timbal fill

    // Lead: the motif in its bars, a sparse answer elsewhere.
    if (tr.lead !== 'none' && tr.motifEvery !== undefined) {
      const inMotif = (tr.motifEvery >> bar) & 1 || (bar > 0 && (tr.motifEvery >> (bar - 1)) & 1);
      if (inMotif) {
        const startBar = (tr.motifEvery >> bar) & 1 ? bar : bar - 1;
        const rel = (bar - startBar) * 16 + b;
        const phrase = bar >= 4 ? MOTIF_B : MOTIF_A;
        for (const [st, d, len] of phrase) if (st === rel) this.lead(ctx, out, tr, mtof(this.deg(tr, d, tr.leadOctave)), t, len * s);
      } else if (k > 0.55 && b === 10 && bar % 2 === 1) {
        // Intensity counter-line: a short pickup figure.
        this.lead(ctx, out, tr, mtof(this.deg(tr, root + 4, tr.leadOctave)), t, s * 2, 0.6);
      }
    }
    if (lane.id === 'pinata' && k > 0.5 && (b === 2 || b === 10)) for (const d of chord) this.brass(ctx, out, mtof(this.deg(tr, d, 0)), t, s * 1.5, 0.035);
  }

  // --------------------------------------------------------- voices

  private lead(ctx: AudioContext, out: AudioNode, tr: Track, f: number, t: number, dur: number, g = 1): void {
    switch (tr.lead) {
      case 'marimba': this.marimba(ctx, out, f, t, Math.min(dur, 0.6), 0.11 * g); break;
      case 'pluck': this.pluck(ctx, out, f, t, Math.max(0.3, dur), 0.16 * g, 0.995, 0.75); break;
      case 'harp': this.pluck(ctx, out, f, t, 1.2, 0.13 * g, 0.997, 0.5); break;
      case 'squeeze': this.squeeze(ctx, out, f, t, dur, 0.05 * g); break;
      case 'brass': this.brass(ctx, out, f * 2, t, dur, 0.06 * g); break;
      default: break;
    }
  }

  private budget(): boolean { return this.live < 48; }

  private track(src: AudioScheduledSourceNode, nodes: AudioNode[]): void {
    this.live++;
    this.scheduled++;
    src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch { /* gone */ } } this.live--; };
  }

  private env(ctx: AudioContext, t: number, a: number, peak: number, dur: number): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  private tone(ctx: AudioContext, out: AudioNode, type: OscillatorType, f0: number, f1: number, t: number, dur: number, gain: number): void {
    if (!this.budget()) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.env(ctx, t, 0.004, gain, dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.02);
    this.track(o, [o, g]);
  }

  private marimba(ctx: AudioContext, out: AudioNode, f: number, t: number, dur: number, gain: number): void {
    if (!this.budget()) return;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator();
    o.type = 'sine'; o2.type = 'sine';
    o.frequency.value = f; o2.frequency.value = f * 3.98;
    const g = this.env(ctx, t, 0.003, gain, dur + 0.25);
    const g2 = this.env(ctx, t, 0.002, gain * 0.25, 0.08);
    o.connect(g); o2.connect(g2); g.connect(out); g2.connect(out);
    o.start(t); o2.start(t); o.stop(t + dur + 0.3); o2.stop(t + 0.1);
    this.track(o, [o, g]);
    this.track(o2, [o2, g2]);
  }

  private squeeze(ctx: AudioContext, out: AudioNode, f: number, t: number, dur: number, gain: number): void {
    if (!this.budget()) return;
    const a = ctx.createOscillator(), b = ctx.createOscillator();
    a.type = 'square'; b.type = 'sawtooth';
    a.frequency.value = f; b.frequency.value = f * 1.004;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1700; lp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.04);
    g.gain.setValueAtTime(gain * 0.85, t + Math.max(0.05, dur - 0.05));
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.04);
    a.connect(lp); b.connect(lp); lp.connect(g); g.connect(out);
    a.start(t); b.start(t); a.stop(t + dur + 0.06); b.stop(t + dur + 0.06);
    this.track(a, [a, lp, g]);
    this.track(b, [b]);
  }

  private brass(ctx: AudioContext, out: AudioNode, f: number, t: number, dur: number, gain: number): void {
    if (!this.budget()) return;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.exponentialRampToValueAtTime(2600, t + 0.06);
    lp.frequency.exponentialRampToValueAtTime(1200, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    o.connect(lp); lp.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.1);
    this.track(o, [o, lp, g]);
  }

  private pad(ctx: AudioContext, out: AudioNode, f: number, t: number, dur: number, gain: number): void {
    if (!this.budget()) return;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.02);
    this.track(o, [o, g]);
  }

  private noise(ctx: AudioContext, out: AudioNode, t: number, dur: number, gain: number, fq: number, type: BiquadFilterType, attack = 0.003): void {
    if (!this.budget()) return;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf(ctx);
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = fq;
    const g = this.env(ctx, t, attack, gain, dur);
    n.connect(f); f.connect(g); g.connect(out);
    n.start(t, this.rand() * 0.5, dur + 0.05);
    this.track(n, [n, f, g]);
  }

  private nb: AudioBuffer | null = null;
  private noiseBuf(ctx: AudioContext): AudioBuffer {
    if (this.nb) return this.nb;
    const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = this.rand() * 2 - 1;
    this.nb = b;
    return b;
  }

  // Karplus-Strong plucked string, rendered once per pitch and cached.
  private pluck(ctx: AudioContext, out: AudioNode, f: number, t: number, dur: number, gain: number, damp: number, bright: number): void {
    if (!this.budget()) return;
    const key = `${f.toFixed(1)}:${damp}:${bright}`;
    let buf = this.ks.get(key);
    if (!buf) {
      const sr = ctx.sampleRate;
      const len = Math.floor(sr * 1.6);
      const N = Math.max(2, Math.round(sr / f));
      buf = ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      const ring = new Float32Array(N);
      let prev = 0;
      for (let i = 0; i < N; i++) { const r = this.rand() * 2 - 1; prev = prev + (r - prev) * bright; ring[i] = prev; }
      let idx = 0;
      for (let i = 0; i < len; i++) {
        const v = ring[idx]!;
        const nx = ring[(idx + 1) % N]!;
        ring[idx] = damp * 0.5 * (v + nx);
        d[i] = v;
        idx = (idx + 1) % N;
      }
      this.ks.set(key, buf);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.06);
    src.connect(g); g.connect(out);
    src.start(t);
    src.stop(t + dur + 0.4);
    this.track(src, [src, g]);
  }

  // ------------------------------------------------------- stingers

  stinger(kind: Stinger): void {
    const n = audio.nodes;
    if (!n || n.ctx.state !== 'running') return;
    const ctx = n.ctx;
    const t = ctx.currentTime + 0.02;
    const out = n.music;
    const tr = TRACKS[(this.current === 'off' ? 'menu' : this.current) as Exclude<TrackId, 'off'>];
    const f = (d: number, o = 1) => mtof(this.deg(tr, d, o));
    switch (kind) {
      case 'objective':
        [1, 3, 5, 8].forEach((d, i) => this.marimba(ctx, out, f(d), t + i * 0.08, 0.4, 0.16));
        break;
      case 'setback':
        [5, 4].forEach((d, i) => this.marimba(ctx, out, f(d, 0), t + i * 0.16, 0.4, 0.12));
        break;
      case 'phase':
        for (const d of [1, 3, 5]) this.brass(ctx, out, f(d, 0), t, 0.45, 0.06);
        for (let i = 0; i < 8; i++) this.noise(ctx, out, t + 0.45 + i * 0.05, 0.05, 0.05, 2000, 'bandpass');
        break;
      case 'complete':
        // The motif's head as a fanfare.
        [[5, 0], [3, 0.14], [5, 0.28], [6, 0.42], [8, 0.62]].forEach(([d, dt]) => { this.brass(ctx, out, f(d!, 0), t + dt!, 0.3, 0.06); this.marimba(ctx, out, f(d!, 1), t + dt!, 0.3, 0.12); });
        break;
      case 'fail':
        [3, 2, 1].forEach((d, i) => this.marimba(ctx, out, f(d, 0), t + i * 0.2, 0.5, 0.12));
        break;
    }
  }
}

export const music = new Music();
