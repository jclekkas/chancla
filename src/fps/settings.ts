import { SafeStorage } from '../persistence/storage';
import type { Lang } from './strings';

export type Quality = 'low' | 'medium' | 'high';

export interface FpsSettings {
  lang: Lang;
  name: string;
  sensitivity: number; // 1 = 0.0022 rad per pixel
  invertY: boolean;
  fov: number;
  reducedMotion: boolean;
  quality: Quality;
  music: number;
  sfx: number;
  showStats: boolean;
  voice: number; // dialogue volume
  banter: boolean; // automatic reaction lines
  subtitles: 'auto' | 'es' | 'en' | 'off';
  campaignHints: boolean; // objective markers and tips
  practiceDifficulty: 'easy' | 'normal' | 'hard';
  practiceAllies: number;
  practiceEnemies: number;
}

const KEY = 'chancla.mp.settings.v1';

export function defaults(lang: Lang, reducedMotion: boolean, lowEnd: boolean): FpsSettings {
  return {
    lang, name: '', sensitivity: 1, invertY: false, fov: 85, reducedMotion, quality: lowEnd ? 'low' : 'medium',
    music: 0.45, sfx: 0.85, showStats: false, voice: 0.9, banter: true, subtitles: 'auto', campaignHints: true, practiceDifficulty: 'normal', practiceAllies: 1, practiceEnemies: 2,
  };
}

const num = (v: unknown, d: number, a: number, b: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

export class FpsSettingsStore {
  value: FpsSettings;
  constructor(private storage: SafeStorage, d: FpsSettings) {
    const r = storage.getJSON<FpsSettings>(KEY) ?? {};
    this.value = {
      lang: r.lang === 'es' || r.lang === 'en' ? r.lang : d.lang,
      name: typeof r.name === 'string' ? r.name.slice(0, 16) : d.name,
      sensitivity: num(r.sensitivity, d.sensitivity, 0.1, 4),
      invertY: bool(r.invertY, d.invertY),
      fov: num(r.fov, d.fov, 70, 105),
      reducedMotion: bool(r.reducedMotion, d.reducedMotion),
      quality: r.quality === 'low' || r.quality === 'medium' || r.quality === 'high' ? r.quality : d.quality,
      music: num(r.music, d.music, 0, 1),
      sfx: num(r.sfx, d.sfx, 0, 1),
      showStats: bool(r.showStats, d.showStats),
      voice: num(r.voice, d.voice, 0, 1),
      banter: bool(r.banter, d.banter),
      subtitles: r.subtitles === 'es' || r.subtitles === 'en' || r.subtitles === 'off' || r.subtitles === 'auto' ? r.subtitles : d.subtitles,
      campaignHints: bool(r.campaignHints, d.campaignHints),
      practiceDifficulty: r.practiceDifficulty === 'easy' || r.practiceDifficulty === 'hard' || r.practiceDifficulty === 'normal' ? r.practiceDifficulty : d.practiceDifficulty,
      practiceAllies: num(r.practiceAllies, d.practiceAllies, 0, 1),
      practiceEnemies: num(r.practiceEnemies, d.practiceEnemies, 1, 2),
    };
  }
  update(p: Partial<FpsSettings>): FpsSettings {
    this.value = { ...this.value, ...p };
    this.storage.set(KEY, JSON.stringify(this.value));
    return this.value;
  }
}
