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
  /** Recordings audible at the current time (started, not yet stopped). Decoded songs are the long buffers. */
  playing(): number { return this.sources.filter((s) => s.started && s.stopAt > this.currentTime && ((s.buffer as { duration?: number } | null)?.duration ?? 0) >= 60).length; }
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
const MENU = ['036c0292', '91dee4c5', '6265def8']; // the menus' pool
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
    expect(music.state()).toMatchObject({ cue: 'menu', layer: 'recorded', recording: '036c0292' }); // Groquo de diversión opens the menus
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
    expect(music.state().recording).toBe('036c0292');
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
    expect(music.state()).toMatchObject({ cue: 'select', want: 'select' });
    expect(MENU).toContain(music.state().recording); // a menu song, never the mission's
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
    // Every menu song was tried (each failure moves on to the next), then the built-in score.
    expect(music.state().layer).toBe('synth');
    expect(music.state().retrying.length).toBe(3);
    await advance(5000);
    await advance(60000);
    for (const id of MENU) expect(fetchLog.filter((u) => u.includes(id)).length, id).toBe(3); // first try plus two retries
    expect(music.state()).toMatchObject({ layer: 'synth', retrying: [] });
    expect(music.state().failed.length).toBe(3);
    expect(music.status()).toBe('failed');
    await advance(60000);
    for (const id of MENU) expect(fetchLog.filter((u) => u.includes(id)).length, id).toBe(3); // and then it stops
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
    expect(music.state().layer).toBe('recorded');
    expect(MENU).toContain(music.state().recording);
    expect(ctx().playing()).toBe(1);
  });

  it('a retry for a scene the player left does not start it', async () => {
    const { audio, music } = await load();
    FakeCtx.allowResume = true;
    audio.armLifecycle();
    window.dispatchEvent(new MouseEvent('pointerdown'));
    music.play('menu');
    await advance(1500);
    fetchImpl = (url) => (url.includes('036c0292') ? ok(url) : fail(url)); // every exploration song fails
    music.play('ruleros');
    await advance(2000);
    expect(music.state()).toMatchObject({ cue: 'ruleros', layer: 'synth' });
    fetchImpl = ok;
    music.play('select');
    await advance(20000);
    expect(music.state().cue).toBe('select');
    expect(MENU).toContain(music.state().recording);
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

describe('playlist', () => {
  async function started(cue: Parameters<Awaited<ReturnType<typeof load>>['music']['play']>[0], prefs?: { mode: 'auto' | 'shuffle' | 'one'; song: string }) {
    const { audio, music } = await load();
    FakeCtx.allowResume = true;
    audio.armLifecycle();
    if (prefs) music.setPrefs(prefs);
    window.dispatchEvent(new MouseEvent('pointerdown'));
    music.play(cue);
    await advance(1500);
    return { audio, music };
  }
  /** Runs the clock until the playing song changes (or `limit` seconds pass), checking the rules on the way. */
  async function untilNextSong(music: Awaited<ReturnType<typeof load>>['music'], limit = 260) {
    const from = music.state().recording;
    let peakSounding = 0, peakLoaded = 0;
    for (let t = 0; t < limit * 10; t++) {
      await advance(100);
      const st = music.state();
      peakSounding = Math.max(peakSounding, ctx().playing());
      peakLoaded = Math.max(peakLoaded, st.loaded.length);
      if (st.recording && st.recording !== from) break;
    }
    return { to: music.state().recording, peakSounding, peakLoaded };
  }

  it('hands over at a song\'s natural end with a crossfade: two songs only during the fade, two decoded at most', async () => {
    const { music } = await started('arcade');
    const first = music.state();
    expect(first.layer).toBe('recorded');
    expect(first.duration).toBeGreaterThan(60);
    const r = await untilNextSong(music);
    expect(r.to).not.toBe(first.recording);
    expect(r.peakSounding).toBeLessThanOrEqual(2);
    expect(r.peakLoaded).toBeLessThanOrEqual(2); // the current song and the next one
    await advance(4000);
    expect(ctx().playing()).toBe(1); // the outgoing song is gone after the fade
  });

  it('shuffle all: plays all eleven before any repeats, never the same song twice in a row', async () => {
    const { music } = await started('menu', { mode: 'shuffle', song: '036c0292' });
    const order = [music.state().recording!];
    for (let i = 0; i < 14; i++) order.push((await untilNextSong(music)).to!);
    expect(new Set(order.slice(0, 11)).size).toBe(11);
    for (let i = 1; i < order.length; i++) expect(order[i], `position ${i}`).not.toBe(order[i - 1]);
  }, 60000);

  it('automatic: each scene draws from its own pool, and related screens keep the song', async () => {
    const { music } = await started('menu');
    expect(music.state().recording).toBe('036c0292'); // the familiar opening theme first
    const s0 = ctx().sources.length;
    for (const cue of ['select', 'results', 'menu', 'lobby'] as const) { music.play(cue); await advance(300); }
    expect(ctx().sources.length).toBe(s0);
    music.play('ruleros');
    await advance(2000);
    expect(music.state().recording).toBe('66be822e'); // Ruleros opens its mission's pool
    music.play('pinata');
    await advance(2000);
    expect(['36b2c7ad', 'd4b3fb6f', 'b5a37a72']).toContain(music.state().recording);
    music.play('cocina');
    await advance(2000);
    expect(['72898684', '4c389fba', 'd5ece162']).toContain(music.state().recording);
  });

  it('Next skips to another song of the pool at once', async () => {
    const { music } = await started('combat');
    const a = music.state().recording;
    music.next();
    await advance(2000);
    expect(music.state().recording).not.toBe(a);
    expect(ctx().playing()).toBe(1);
  });

  it('one song: a curated loop repeats seamlessly; a song without one repeats from the top', async () => {
    const { music } = await started('menu', { mode: 'one', song: '036c0292' });
    expect(music.state().file).toBe('music/rosa-theme.mp3'); // the prepared seamless loop
    expect(music.state().loop).not.toBeNull();
    music.setPrefs({ mode: 'one', song: 'd4b3fb6f' });
    await advance(2500);
    expect(music.state()).toMatchObject({ recording: 'd4b3fb6f', loop: null });
    const n0 = ctx().sources.length;
    await advance(135000); // past the end of Festive Boss Battle (130.8 s)
    expect(music.state().recording).toBe('d4b3fb6f');
    expect(ctx().sources.length).toBeGreaterThan(n0); // it started again
    expect(ctx().playing()).toBe(1);
  }, 60000);

  it('an earlier recording stays separately selectable', async () => {
    const { music } = await started('menu', { mode: 'one', song: 'guerra-de-vecinos' });
    expect(music.state()).toMatchObject({ recording: 'guerra-de-vecinos', file: 'music/guerra-de-vecinos.mp3' });
    expect(music.nowPlaying()).toMatchObject({ earlier: true });
  });

  it('rapid scene and mode changes never leave more than two songs sounding, and the last request wins', async () => {
    const { music } = await started('menu');
    let peak = 0;
    const cues = ['ruleros', 'pinata', 'menu', 'cocina', 'combat', 'select', 'boss', 'arcade'] as const;
    for (let i = 0; i < 24; i++) {
      music.play(cues[i % cues.length]!);
      if (i % 5 === 0) music.setPrefs({ mode: i % 10 === 0 ? 'shuffle' : 'auto', song: '036c0292' });
      if (i % 7 === 0) music.next();
      await advance(100);
      peak = Math.max(peak, ctx().playing());
    }
    music.setPrefs({ mode: 'auto', song: '036c0292' });
    music.play('pinata');
    await advance(4000);
    expect(peak).toBeLessThanOrEqual(2);
    expect(ctx().playing()).toBe(1);
    expect(['36b2c7ad', 'd4b3fb6f', 'b5a37a72']).toContain(music.state().recording);
  });

  it('changing songs never touches an intentional mute', async () => {
    const { audio, music } = await started('menu');
    audio.setLevels(0, 1);
    await advance(200);
    music.next();
    music.setPrefs({ mode: 'one', song: '4c389fba' });
    music.play('combat');
    await advance(3000);
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
