// Soundtrack preferences, shared by the main page and the Arcade, kept on
// this device only. Unreadable or blocked storage falls back to Automatic.
import { DEFAULT_PREFS, isMusicMode, song, type MusicPrefs } from './library';

export const MUSIC_PREFS_KEY = 'chancla.music.v1';

export function loadMusicPrefs(): MusicPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(MUSIC_PREFS_KEY) ?? 'null') as Partial<MusicPrefs> | null;
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS };
    return {
      mode: isMusicMode(raw.mode) ? raw.mode : DEFAULT_PREFS.mode,
      song: typeof raw.song === 'string' && song(raw.song) ? raw.song : DEFAULT_PREFS.song,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveMusicPrefs(p: MusicPrefs): void {
  try { localStorage.setItem(MUSIC_PREFS_KEY, JSON.stringify({ mode: p.mode, song: p.song })); } catch { /* storage blocked: this session only */ }
}
