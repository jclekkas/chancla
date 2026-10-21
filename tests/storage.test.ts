import { describe, expect, it } from 'vitest';
import { SafeStorage, SettingsStore, ProgressStore, defaultSettings, SETTINGS_KEY, PROGRESS_KEY, type KV } from '../src/persistence/storage';

class MemKV implements KV {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

class BlockedKV implements KV {
  getItem(): string | null { throw new DOMException('blocked', 'SecurityError'); }
  setItem(): void { throw new DOMException('blocked', 'SecurityError'); }
  removeItem(): void { throw new DOMException('blocked', 'SecurityError'); }
}

class QuotaKV extends MemKV {
  full = false;
  override setItem(k: string, v: string) { if (this.full) throw new DOMException('full', 'QuotaExceededError'); super.setItem(k, v); }
}

describe('storage', () => {
  it('falls back to memory when storage is blocked, without throwing', () => {
    const s = new SafeStorage(new BlockedKV());
    expect(s.persistent).toBe(false);
    expect(s.set('a', '1')).toBe(false);
    expect(s.get('a')).toBe('1');
    const progress = new ProgressStore(s);
    expect(progress.record({ score: 500, bestCombo: 3, accuracy: 0.5, victory: false })).toBe(true);
    expect(progress.value.bestScore).toBe(500);
    expect(progress.persistent).toBe(false);
  });

  it('handles storage that is missing entirely', () => {
    const s = new SafeStorage(null);
    expect(s.persistent).toBe(false);
    expect(new SettingsStore(s, defaultSettings()).value.volume).toBe(0.8);
  });

  it('survives a quota error mid-session', () => {
    const kv = new QuotaKV();
    const s = new SafeStorage(kv);
    expect(s.persistent).toBe(true);
    kv.full = true;
    expect(s.set('x', 'y')).toBe(false);
    expect(s.persistent).toBe(false);
    expect(s.get('x')).toBe('y');
  });

  it('sanitises corrupt or out-of-range settings', () => {
    const kv = new MemKV();
    kv.setItem(SETTINGS_KEY, JSON.stringify({ lang: 'fr', volume: 9, sensitivity: -2, quality: 'ultra', muted: 'yes' }));
    const st = new SettingsStore(new SafeStorage(kv), defaultSettings({ lang: 'es' }));
    expect(st.value.lang).toBe('es');
    expect(st.value.volume).toBe(1);
    expect(st.value.sensitivity).toBe(0.2);
    expect(st.value.quality).toBe('medium');
    expect(st.value.muted).toBe(false);
    kv.setItem(SETTINGS_KEY, '{not json');
    expect(new SettingsStore(new SafeStorage(kv), defaultSettings()).value.lang).toBe('en');
  });

  it('records bests, and reset clears progress but keeps settings', () => {
    const kv = new MemKV();
    const s = new SafeStorage(kv);
    const settings = new SettingsStore(s, defaultSettings());
    settings.update({ lang: 'es', volume: 0.3 });
    const p = new ProgressStore(s);
    expect(p.record({ score: 1000, bestCombo: 5, accuracy: 0.4, victory: true })).toBe(true);
    expect(p.record({ score: 400, bestCombo: 9, accuracy: 0.9, victory: false })).toBe(false);
    expect(p.value).toEqual({ bestScore: 1000, bestCombo: 9, bestAccuracy: 0.9, runs: 2, wins: 1 });
    expect(new ProgressStore(new SafeStorage(kv)).value.bestScore).toBe(1000);
    p.reset();
    expect(kv.getItem(PROGRESS_KEY)).toBeNull();
    expect(new ProgressStore(new SafeStorage(kv)).value.bestScore).toBe(0);
    const reloaded = new SettingsStore(new SafeStorage(kv), defaultSettings());
    expect(reloaded.value.lang).toBe('es');
    expect(reloaded.value.volume).toBe(0.3);
  });
});
