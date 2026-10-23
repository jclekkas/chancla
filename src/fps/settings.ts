import { SafeStorage } from '../persistence/storage';
import type { Lang } from './strings';
import { isMapId, type MapId } from '../../shared/maps';

export type Quality = 'low' | 'medium' | 'high';
/** What the player chose: Auto picks Low on phones, tablets and low-core devices, Medium elsewhere. */
export type QualityMode = 'auto' | Quality;

export interface FpsSettings {
  lang: Lang;
  name: string;
  sensitivity: number; // 1 = 0.0022 rad per pixel
  touchSensitivity: number; // 1 = 0.0055 rad per pixel of drag
  invertY: boolean;
  fov: number;
  reducedMotion: boolean;
  /** The quality in effect (what the renderer uses). */
  quality: Quality;
  qualityMode: QualityMode;
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
  practiceMap: MapId | 'random'; // the last map chosen for practice
}

const KEY = 'chancla.mp.settings.v1';

export function defaults(lang: Lang, reducedMotion: boolean, lowEnd: boolean): FpsSettings {
  return {
    lang, name: '', sensitivity: 1, touchSensitivity: 1, invertY: false, fov: 85, reducedMotion, quality: lowEnd ? 'low' : 'medium', qualityMode: 'auto',
    music: 0.45, sfx: 0.85, showStats: false, voice: 0.9, banter: true, subtitles: 'auto', campaignHints: true, practiceDifficulty: 'normal', practiceAllies: 1, practiceEnemies: 2, practiceMap: 'patio',
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
      touchSensitivity: num(r.touchSensitivity, d.touchSensitivity, 0.3, 3),
      invertY: bool(r.invertY, d.invertY),
      fov: num(r.fov, d.fov, 70, 105),
      reducedMotion: bool(r.reducedMotion, d.reducedMotion),
      quality: r.quality === 'low' || r.quality === 'medium' || r.quality === 'high' ? r.quality : d.quality,
      // Saves from before Auto existed keep their explicit choice.
      qualityMode: r.qualityMode === 'auto' || r.qualityMode === 'low' || r.qualityMode === 'medium' || r.qualityMode === 'high' ? r.qualityMode : r.quality === 'low' || r.quality === 'medium' || r.quality === 'high' ? r.quality : 'auto',
      music: num(r.music, d.music, 0, 1),
      sfx: num(r.sfx, d.sfx, 0, 1),
      showStats: bool(r.showStats, d.showStats),
      voice: num(r.voice, d.voice, 0, 1),
      banter: bool(r.banter, d.banter),
      subtitles: r.subtitles === 'es' || r.subtitles === 'en' || r.subtitles === 'off' || r.subtitles === 'auto' ? r.subtitles : d.subtitles,
      campaignHints: bool(r.campaignHints, d.campaignHints),
      practiceDifficulty: r.practiceDifficulty === 'easy' || r.practiceDifficulty === 'hard' || r.practiceDifficulty === 'normal' ? r.practiceDifficulty : d.practiceDifficulty,
      practiceMap: r.practiceMap === 'random' || isMapId(r.practiceMap) ? r.practiceMap : d.practiceMap,
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
