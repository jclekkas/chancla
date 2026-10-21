// @vitest-environment jsdom
// Regression tests for the shared music lifecycle: autoplay unlock that only
// happened on the first gesture, an audio context that nothing resumed after
// a suspension, downloads that failed once and were never retried, and scene
// races while a recording loads. Web Audio is faked; the controller is real.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

class Param {
  value: number;
  constructor(v = 1) { this.value = v; }
  setValueAtTime(v: number) { this.value = v; return this; }
  linearRampToValueAtTime(v: number) { this.value = v; return this; }
  exponentialRampToValueAtTime(v: number) { this.value = v; return this; }
  setTargetAtTime(v: number) { this.value = v; return this; }
  setValueCurveAtTime(c: Float32Array) { this.value = c[c.length - 1]!; return this; }
  cancelScheduledValues() { return this; }
}

class Node {
  gain = new Param(); frequency = new Param(); Q = new Param(); detune = new Param(); playbackRate = new Param();
  threshold = new Param(); ratio = new Param(); knee = new Param(); attack = new Param(); release = new Param();
  type = ''; curve: Float32Array | null = null; buffer: unknown = null; loop = false; loopStart = 0; loopEnd = 0;
  onended: (() => void) | null = null;
  started = false; stopAt = Infinity;
  constructor(private ctx: FakeCtx, public kind: string) {}
  connect(n: unknown) { return n; }
  disconnect() {}
  start() { this.started = true; if (this.kind === 'buffer') this.ctx.sources.push(this); }
  stop(t = 0) { this.stopAt = Math.min(this.stopAt, t); }
}

class FakeCtx {
  static all: FakeCtx[] = [];
  static allowResume = false; // stands in for "this gesture counts as user activation"
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  sampleRate = 48000;
  destination = {};
  sources: Node[] = [];
  resumeCalls = 0;
  private listeners: Array<() => void> = [];
  constructor() { FakeCtx.all.push(this); }
  addEventListener(_: string, f: () => void) { this.listeners.push(f); }
  private set(s: FakeCtx['state']) { if (this.state !== s) { this.state = s; for (const f of this.listeners) f(); } }
  resume() { this.resumeCalls++; if (FakeCtx.allowResume) this.set('running'); return Promise.resolve(); }
  suspend() { this.set('suspended'); return Promise.resolve(); }
  createGain() { return new Node(this, 'gain'); }
  createBiquadFilter() { return new Node(this, 'filter'); }
  createOscillator() { return new Node(this, 'osc'); }
  createBufferSource() { return new Node(this, 'buffer'); }
  createWaveShaper() { return new Node(this, 'shaper'); }
  createDynamicsCompressor() { return new Node(this, 'comp'); }
  createBuffer(_c: number, n: number) { return { length: n, duration: n / 48000, getChannelData: () => new Float32Array(n) }; }
  decodeAudioData() { return Promise.resolve({ duration: 200, length: 200 * 48000 }); }
  /** Recordings audible at the current time (started, not yet stopped). */
  playing(): number { return this.sources.filter((s) => s.started && s.stopAt > this.currentTime && s.loop).length; }
}

type Fetcher = (url: string) => Promise<{ ok: boolean; arrayBuffer: () => Promise<ArrayBuffer> }>;
let fetchImpl: Fetcher;
const fetchLog: string[] = [];

async function load() {
  vi.resetModules();
  const { audio } = await import('../src/audio/audio');
  const { music } = await import('../src/audio/music');
  return { audio, music };
}
const ctx = () => FakeCtx.all[FakeCtx.all.length - 1]!;
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const ok: Fetcher = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) });
const fail: Fetcher = async () => { throw new TypeError('network'); };
async function advance(ms: number) {
  // Advance timers in small steps so promise chains between timers run.
  for (let t = 0; t < ms; t += 100) { vi.advanceTimersByTime(100); ctx() && (ctx().currentTime += 0.1); await flush(); }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeCtx.all = [];
  FakeCtx.allowResume = false;
  fetchLog.length = 0;
  fetchImpl = ok;
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
  (globalThis as unknown as { fetch: Fetcher }).fetch = (url: string) => { fetchLog.push(url); return fetchImpl(url); };
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});
afterEach(() => { vi.useRealTimers(); });

describe('music lifecycle', () => {
  it('a gesture that cannot start audio does not use up the unlock: the next one starts the menu theme', async () => {
    const { audio, music } = await load();
    audio.armLifecycle();
    music.play('menu');
    // An untrusted or non-activating key press: the context is created but stays suspended.
    window.dispatchEvent(new KeyboardEvent('keydown'));
    await advance(200);
    expect(ctx().state).toBe('suspended');
    // A real click: audio starts, and the intended cue plays without a reload.
    FakeCtx.allowResume = true;
    window.dispatchEvent(new MouseEvent('pointerdown'));
    await advance(1500);
    expect(ctx().state).toBe('running');
    expect(music.state()).toMatchObject({ cue: 'menu', layer: 'recorded', recording: 'rosa-theme' });
    expect(FakeCtx.all.length).toBe(1); // one shared context
  });

  it('resumes after the tab was hidden or the page came back from the back/forward cache', async () => {
    const { audio, music } = await load();
    FakeCtx.allowResume = true;
    audio.armLifecycle();
    music.play('menu');
    window.dispatchEvent(new MouseEvent('pointerdown'));
    await advance(1500);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(ctx().state).toBe('suspended');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(ctx().state).toBe('running');
    // A suspension the page didn't cause (OS interruption, bfcache restore): pageshow, or failing that the next gesture.
    await ctx().suspend();
    FakeCtx.allowResume = false;
    window.dispatchEvent(new Event('pageshow'));
    await flush();
    expect(ctx().state).toBe('suspended');
    FakeCtx.allowResume = true;
    window.dispatchEvent(new MouseEvent('click'));
    await flush();
    expect(ctx().state).toBe('running');
    expect(music.state().recording).toBe('rosa-theme');
    expect(ctx().playing()).toBe(1);
  });

  it('a delayed download never starts music for a scene the player already left', async () => {
    const { audio, music } = await load();
    FakeCtx.allowResume = true;
    audio.armLifecycle();
    window.dispatchEvent(new MouseEvent('pointerdown'));
    music.play('menu');
    await advance(1500);
    let release!: () => void;
    fetchImpl = (url) => (url.includes('ruleros') ? new Promise((r) => { release = () => r({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) }); }) : ok(url));
    music.play('ruleros'); // mission starts while its track is still downloading
    await advance(300);
    music.play('select'); // player leaves before it arrives
    await advance(300);
    release();
    await advance(3000);
    expect(music.state()).toMatchObject({ cue: 'select', want: 'select', recording: 'rosa-theme' });
    expect(ctx().playing()).toBe(1); // no second track underneath
  });

  it('keeps the menu theme going across related menu screens', async () => {
    const { audio, music } = await load();
    FakeCtx.allowResume = true;
    audio.armLifecycle();
    window.dispatchEvent(new MouseEvent('pointerdown'));
    music.play('menu');
    await advance(1500);
    const started = ctx().sources.length;
    for (const cue of ['select', 'menu', 'results', 'select', 'menu'] as const) { music.play(cue); await advance(200); }
    expect(ctx().sources.length).toBe(started); // never restarted
    expect(ctx().playing()).toBe(1);
  });

  it('a failed download falls back to the synthesized score and retries a bounded number of times', async () => {
    const { audio, music } = await load();
    FakeCtx.allowResume = true;
    fetchImpl = fail;
    audio.armLifecycle();
    window.dispatchEvent(new MouseEvent('pointerdown'));
    music.play('menu');
    await advance(2000);
    expect(music.state()).toMatchObject({ layer: 'synth', retrying: ['rosa-theme'] });
    await advance(5000);
    await advance(60000);
    const attempts = fetchLog.filter((u) => u.includes('rosa-theme')).length;
    expect(attempts).toBe(3); // first try plus two retries
    expect(music.state()).toMatchObject({ layer: 'synth', failed: ['rosa-theme'] });
    await advance(60000);
    expect(fetchLog.filter((u) => u.includes('rosa-theme')).length).toBe(3); // and then it stops
  });

  it('hands over from the fallback when a retry succeeds, without overlapping tracks', async () => {
    const { audio, music } = await load();
    FakeCtx.allowResume = true;
    fetchImpl = fail;
    audio.armLifecycle();
    window.dispatchEvent(new MouseEvent('pointerdown'));
    music.play('menu');
    await advance(2000);
    expect(music.state().layer).toBe('synth');
    fetchImpl = ok;
    await advance(4000);
    expect(music.state()).toMatchObject({ layer: 'recorded', recording: 'rosa-theme', retrying: [] });
    expect(ctx().playing()).toBe(1);
  });

  it('a retry for a scene the player left does not start it', async () => {
    const { audio, music } = await load();
    FakeCtx.allowResume = true;
    audio.armLifecycle();
    window.dispatchEvent(new MouseEvent('pointerdown'));
    music.play('menu');
    await advance(1500);
    fetchImpl = (url) => (url.includes('ruleros') ? fail(url) : ok(url));
    music.play('ruleros');
    await advance(2000);
    expect(music.state()).toMatchObject({ cue: 'ruleros', layer: 'synth' });
    fetchImpl = ok;
    music.play('select');
    await advance(20000);
    expect(music.state()).toMatchObject({ cue: 'select', recording: 'rosa-theme' });
    expect(ctx().playing()).toBe(1);
  });

  it('never overrides an intentional mute (music at zero) on navigation, unlock or retry', async () => {
    const { audio, music } = await load();
    audio.setLevels(0, 1); // the player's saved setting, applied before audio exists
    FakeCtx.allowResume = true;
    fetchImpl = fail;
    audio.armLifecycle();
    window.dispatchEvent(new MouseEvent('pointerdown'));
    music.play('menu');
    await advance(2000);
    fetchImpl = ok;
    for (const cue of ['select', 'ruleros', 'select', 'menu'] as const) { music.play(cue); await advance(800); }
    await advance(20000);
    const bus = (audio as unknown as { a: { music: { gain: Param } } }).a.music.gain.value;
    expect(bus).toBe(0);
    window.dispatchEvent(new MouseEvent('click'));
    await flush();
    expect((audio as unknown as { a: { music: { gain: Param } } }).a.music.gain.value).toBe(0);
  });
});

describe('sound control (Enable sound)', () => {
  async function loadGate() {
    const { audio, music } = await load();
    const { SoundGate } = await import('../src/ui/soundGate');
    const gate = new SoundGate({ text: (k) => k, inGame: () => false, musicStatus: () => music.status() });
    return { audio, music, gate };
  }

  it('is offered before any interaction, and stays offered after a click that could not start audio', async () => {
    const { audio, gate } = await loadGate();
    audio.armLifecycle();
    expect(gate.state).toBe('enable');
    window.dispatchEvent(new MouseEvent('pointerdown')); // the browser refuses (allowResume = false)
    await advance(1600);
    expect(gate.state).toBe('blocked');
    gate.dispose();
  });

  it('its own click reports the real result: still blocked, then running once the browser allows it', async () => {
    const { audio, gate } = await loadGate();
    audio.armLifecycle();
    const p1 = audio.unlockFromGesture(300);
    await advance(400);
    expect(await p1).toBe('blocked');
    gate.update(true);
    expect(gate.state).toBe('blocked'); // never shown as enabled just because it was clicked
    FakeCtx.allowResume = true;
    const p2 = audio.unlockFromGesture(300);
    await advance(100);
    expect(await p2).toBe('running');
    gate.update(true);
    expect(gate.state).toBe('hidden');
    gate.dispose();
  });

  it('tells an intentional mute apart from a block, and a failed track apart from both', async () => {
    const { audio, music, gate } = await loadGate();
    FakeCtx.allowResume = true;
    audio.armLifecycle();
    window.dispatchEvent(new MouseEvent('pointerdown'));
    music.play('menu');
    await advance(1500);
    expect(gate.state).toBe('hidden');
    audio.setLevels(0, 0);
    gate.update();
    expect(gate.state).toBe('muted');
    const words = (k: string) => k;
    expect(gate.describe(words)).toBe('muted');
    audio.setLevels(0.5, 0.5);
    fetchImpl = fail;
    music.play('ruleros');
    await advance(2000);
    gate.update();
    expect(gate.state).toBe('hidden'); // sound works: the built-in score plays
    expect(gate.describe(words)).toBe('fallback');
    gate.dispose();
  });
});
