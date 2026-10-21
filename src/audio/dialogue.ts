// Dialogue director: decides whether a line plays, plays its voice clip on
// the dialogue bus, and shows the subtitle for exactly as long as the clip.
//
// Rules (see docs/AUDIO.md):
//   * one line at a time; a higher-priority line can cut a lower one, never
//     the reverse; at most one story line waits in the queue
//   * pool cooldowns plus a global gap, random choice avoiding the last picks
//   * banter (automatic reactions) obeys the banter setting; story lines are
//     always subtitled, and voiced at the dialogue volume
//   * while a danger cue is being telegraphed, banter is dropped so jokes
//     never mask an attack warning
//   * voice files are pre-generated assets loaded per mission; if they fail
//     to load the subtitles still run on estimated timing
import { audio } from './audio';
import { LINE_BY_ID, POOLS, POOL_COOLDOWN, type Line } from './lines';

export interface VoiceManifest {
  version: number;
  quality: string; // 'placeholder-tts' until recorded performances replace it
  lines: Record<string, { file: string; ms: number }>;
}

export interface DialogueSettings {
  banter: boolean;
  subtitles: 'auto' | 'es' | 'en' | 'off';
  uiLang: () => 'en' | 'es';
}

interface Playing { line: Line; until: number; src: AudioBufferSourceNode | null }

export class Dialogue {
  private manifest: VoiceManifest | null = null;
  private manifestTried = false;
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<void>>();
  private playing: Playing | null = null;
  private queued: { line: Line; at: number } | null = null;
  private lastEnd = -1e9;
  private poolLast = new Map<string, number>();
  private recent = new Map<string, string[]>();
  private holdUntil = 0;
  private rand: () => number;
  voiceFailed = false;
  // Test and debug counters.
  readonly log: Array<{ id: string; t: number; ms: number; voiced: boolean }> = [];
  dropped = 0;

  constructor(
    private settings: () => DialogueSettings,
    private subtitle: (text: string | null, who: string) => void,
    private now: () => number = () => performance.now(),
    seed = Date.now(),
  ) {
    let s = seed >>> 0;
    this.rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  // ------------------------------------------------------------ assets

  async loadManifest(base: string): Promise<void> {
    if (this.manifestTried) return;
    this.manifestTried = true;
    try {
      const r = await fetch(`${base}voice/manifest.json`, { cache: 'force-cache' });
      if (!r.ok) throw new Error(String(r.status));
      this.manifest = (await r.json()) as VoiceManifest;
    } catch {
      this.voiceFailed = true;
    }
    this.base = base;
  }

  private base = '/';

  get quality(): string { return this.manifest?.quality ?? 'none'; }

  /** Decodes the clips for these line ids (a mission's set) in the background. */
  preload(ids: string[]): Promise<void> {
    const n = audio.nodes;
    const m = this.manifest;
    if (!n || !m) return Promise.resolve();
    const jobs = ids.filter((id) => m.lines[id] && !this.buffers.has(id)).map((id) => {
      const have = this.loading.get(id);
      if (have) return have;
      const p = fetch(`${this.base}voice/${m.lines[id]!.file}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => n.ctx.decodeAudioData(b))
        .then((buf) => { this.buffers.set(id, buf); })
        .catch(() => { this.voiceFailed = true; });
      this.loading.set(id, p);
      return p;
    });
    return Promise.all(jobs).then(() => undefined);
  }

  // ---------------------------------------------------------- playback

  /** Suppress banter for a while (an attack is being telegraphed). */
  hold(ms: number): void { this.holdUntil = Math.max(this.holdUntil, this.now() + ms); }

  get busy(): boolean { return !!this.playing && this.now() < this.playing.until; }

  get current(): Line | null { return this.busy ? this.playing!.line : null; }

  /** A reaction from a pool (miss, ricochet, elim…) with cooldowns. */
  react(pool: string, opts: { volume?: number } = {}): boolean {
    const ids = POOLS[pool];
    if (!ids) return false;
    const t = this.now();
    const cd = POOL_COOLDOWN[pool] ?? 3000;
    if (t - (this.poolLast.get(pool) ?? -1e9) < cd) { this.dropped++; return false; }
    // Avoid the most recent picks from this pool.
    const recent = this.recent.get(pool) ?? [];
    const fresh = ids.filter((i) => !recent.includes(i));
    const choice = (fresh.length ? fresh : ids)[Math.floor(this.rand() * (fresh.length || ids.length))]!;
    const ok = this.say(choice, opts);
    if (ok) {
      this.poolLast.set(pool, t);
      recent.push(choice);
      while (recent.length > Math.min(2, ids.length - 1)) recent.shift();
      this.recent.set(pool, recent);
    }
    return ok;
  }

  /** A specific line. Returns whether it started (or was queued). */
  say(id: string, opts: { volume?: number } = {}): boolean {
    const line = LINE_BY_ID.get(id);
    if (!line) return false;
    const s = this.settings();
    const t = this.now();
    if (line.cat === 'banter') {
      if (!s.banter) { this.dropped++; return false; }
      if (t < this.holdUntil) { this.dropped++; return false; }
      if (t - this.lastEnd < 900 && !this.busy) { this.dropped++; return false; }
    }
    if (this.busy) {
      const cur = this.playing!.line;
      if (line.pri > cur.pri) this.stop();
      else {
        // Story lines wait their turn (only one waits); banter is dropped.
        if (line.cat === 'story' && !this.queued) { this.queued = { line, at: t }; return true; }
        this.dropped++;
        return false;
      }
    }
    this.start(line, opts.volume ?? 1);
    return true;
  }

  private start(line: Line, volume: number): void {
    const n = audio.nodes;
    const buf = this.buffers.get(line.id);
    let src: AudioBufferSourceNode | null = null;
    let ms = this.manifest?.lines[line.id]?.ms ?? estimateMs(line.es);
    if (n && buf) {
      try {
        src = n.ctx.createBufferSource();
        src.buffer = buf;
        const g = n.ctx.createGain();
        g.gain.value = volume;
        src.connect(g);
        g.connect(n.voice);
        src.start();
        src.onended = () => { try { g.disconnect(); } catch { /* gone */ } };
        ms = buf.duration * 1000;
      } catch { src = null; }
    }
    const t = this.now();
    this.playing = { line, until: t + ms + 250, src };
    this.log.push({ id: line.id, t, ms, voiced: !!src });
    if (this.log.length > 400) this.log.shift();
    audio.duck(src ? 0.55 : 1);
    this.showSubtitle(line);
  }

  private showSubtitle(line: Line): void {
    const s = this.settings();
    const lang = s.subtitles === 'auto' ? s.uiLang() : s.subtitles;
    if (lang === 'off') { this.subtitle(null, line.who); return; }
    this.subtitle(lang === 'es' ? line.es : line.en, line.who);
  }

  /** Call every frame: ends lines on time and starts a queued one. */
  update(): void {
    const t = this.now();
    if (this.playing && t >= this.playing.until) {
      this.playing = null;
      this.lastEnd = t;
      this.subtitle(null, '');
      audio.duck(1);
    }
    if (!this.playing && this.queued) {
      const q = this.queued;
      this.queued = null;
      if (t - q.at < 6000) this.start(q.line, 1);
    }
  }

  stop(): void {
    if (this.playing?.src) { try { this.playing.src.stop(); } catch { /* ended */ } }
    this.playing = null;
    this.subtitle(null, '');
    audio.duck(1);
  }

  /** Clears everything (retry, leaving a mission). */
  reset(): void {
    this.stop();
    this.queued = null;
    this.poolLast.clear();
    this.recent.clear();
    this.holdUntil = 0;
    this.lastEnd = -1e9;
  }

  // Subtitle language changes apply to the line on screen.
  refreshSubtitle(): void { if (this.busy) this.showSubtitle(this.playing!.line); }
}

// Reading speed for lines without a clip (about 14 characters per second).
export function estimateMs(text: string): number {
  return Math.max(1300, Math.min(5200, 500 + text.length * 70));
}
