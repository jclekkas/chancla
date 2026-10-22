import type { Lang } from '../i18n/strings';

// Storage that never throws. Falls back to memory when localStorage is
// blocked (private modes, disabled cookies, quota errors).
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class SafeStorage {
  private mem = new Map<string, string>();
  private backend: KV | null;
  persistent: boolean;

  constructor(backend?: KV | null) {
    this.backend = null;
    this.persistent = false;
    try {
      const b = backend === undefined ? globalThis.localStorage : backend;
      if (b) {
        const probe = '__chancla_probe__';
        b.setItem(probe, '1');
        b.removeItem(probe);
        this.backend = b;
        this.persistent = true;
      }
    } catch {
      this.backend = null;
      this.persistent = false;
    }
  }

  get(key: string): string | null {
    // Values written this session win, so a later quota error never loses them.
    if (this.mem.has(key)) return this.mem.get(key)!;
    if (this.backend) {
      try {
        return this.backend.getItem(key);
      } catch {
        this.persistent = false;
      }
    }
    return this.mem.get(key) ?? null;
  }

  set(key: string, value: string): boolean {
    this.mem.set(key, value);
    if (this.backend) {
      try {
        this.backend.setItem(key, value);
        return true;
      } catch {
        this.persistent = false;
      }
    }
    return false;
  }

  remove(key: string): void {
    this.mem.delete(key);
    if (this.backend) {
      try {
        this.backend.removeItem(key);
      } catch {
        this.persistent = false;
      }
    }
  }

  getJSON<T>(key: string): Partial<T> | null {
    const raw = this.get(key);
    if (!raw) return null;
    try {
      const v: unknown = JSON.parse(raw);
      return v && typeof v === 'object' ? (v as Partial<T>) : null;
    } catch {
      return null;
    }
  }
}

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  lang: Lang;
  volume: number;
  muted: boolean;
  music: boolean;
  sensitivity: number;
  invertY: boolean;
  aimAssist: boolean;
  reducedMotion: boolean;
  quality: Quality;
  showFps: boolean;
  /** The last Arcade map chosen: 'patio', 'plaza', 'fiesta' or 'random'. */
  arcadeMap: string;
  /** Touch aiming speed (1 = the tuned default). */
  touchSensitivity: number;
}

export interface Progress {
  bestScore: number;
  bestCombo: number;
  bestAccuracy: number;
  runs: number;
  wins: number;
}

export const SETTINGS_KEY = 'chancla.settings.v1';
export const PROGRESS_KEY = 'chancla.progress.v1';

export function defaultSettings(env?: { lang?: Lang; reducedMotion?: boolean; mobile?: boolean }): Settings {
  return {
    lang: env?.lang ?? 'en',
    volume: 0.8,
    muted: false,
    music: true,
    sensitivity: 1,
    invertY: false,
    aimAssist: !!env?.mobile,
    reducedMotion: !!env?.reducedMotion,
    quality: env?.mobile ? 'low' : 'medium',
    showFps: false,
    arcadeMap: 'patio',
    touchSensitivity: 1,
  };
}

export function defaultProgress(): Progress {
  return { bestScore: 0, bestCombo: 0, bestAccuracy: 0, runs: 0, wins: 0 };
}

const num = (v: unknown, d: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

export class SettingsStore {
  private storage: SafeStorage;
  value: Settings;

  constructor(storage: SafeStorage, defaults: Settings) {
    this.storage = storage;
    const raw = storage.getJSON<Settings>(SETTINGS_KEY) ?? {};
    this.value = {
      arcadeMap: raw.arcadeMap === 'random' || raw.arcadeMap === 'patio' || raw.arcadeMap === 'plaza' || raw.arcadeMap === 'fiesta' ? raw.arcadeMap : defaults.arcadeMap,
      lang: raw.lang === 'es' || raw.lang === 'en' ? raw.lang : defaults.lang,
      volume: num(raw.volume, defaults.volume, 0, 1),
      muted: bool(raw.muted, defaults.muted),
      music: bool(raw.music, defaults.music),
      sensitivity: num(raw.sensitivity, defaults.sensitivity, 0.2, 3),
      invertY: bool(raw.invertY, defaults.invertY),
      aimAssist: bool(raw.aimAssist, defaults.aimAssist),
      reducedMotion: bool(raw.reducedMotion, defaults.reducedMotion),
      quality:
        raw.quality === 'low' || raw.quality === 'medium' || raw.quality === 'high'
          ? raw.quality
          : defaults.quality,
      showFps: bool(raw.showFps, defaults.showFps),
      touchSensitivity: num(raw.touchSensitivity, defaults.touchSensitivity, 0.3, 3),
    };
  }

  update(patch: Partial<Settings>): Settings {
    this.value = { ...this.value, ...patch };
    this.storage.set(SETTINGS_KEY, JSON.stringify(this.value));
    return this.value;
  }
}

export interface RunRecord {
  score: number;
  bestCombo: number;
  accuracy: number;
  victory: boolean;
}

export class ProgressStore {
  private storage: SafeStorage;
  value: Progress;

  constructor(storage: SafeStorage) {
    this.storage = storage;
    const raw = storage.getJSON<Progress>(PROGRESS_KEY) ?? {};
    const d = defaultProgress();
    this.value = {
      bestScore: num(raw.bestScore, d.bestScore, 0, 1e9),
      bestCombo: num(raw.bestCombo, d.bestCombo, 0, 1e6),
      bestAccuracy: num(raw.bestAccuracy, d.bestAccuracy, 0, 1),
      runs: num(raw.runs, d.runs, 0, 1e9),
      wins: num(raw.wins, d.wins, 0, 1e9),
    };
  }

  get persistent(): boolean {
    return this.storage.persistent;
  }

  // Returns true when the run set a new best score.
  record(run: RunRecord): boolean {
    const isBest = run.score > this.value.bestScore;
    this.value = {
      bestScore: Math.max(this.value.bestScore, Math.round(run.score)),
      bestCombo: Math.max(this.value.bestCombo, run.bestCombo),
      bestAccuracy: Math.max(this.value.bestAccuracy, run.accuracy),
      runs: this.value.runs + 1,
      wins: this.value.wins + (run.victory ? 1 : 0),
    };
    this.storage.set(PROGRESS_KEY, JSON.stringify(this.value));
    return isBest;
  }

  reset(): void {
    this.value = defaultProgress();
    this.storage.remove(PROGRESS_KEY);
  }
}
