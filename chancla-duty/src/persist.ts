import type { Lang } from './i18n';
import type { Grade } from './rules';
import { emptyRanks, type Ranks, type UpgradeId } from './content';

const KEY = 'chancla-duty-v1';

export interface BestRun {
  score: number;
  grade: Grade;
  wave: number;
}

export interface Save {
  v: 1;
  lang: Lang;
  music: number;
  sfx: number;
  quality: 'auto' | 'low' | 'med' | 'high';
  shake: boolean;
  assist: boolean;
  reduce: boolean;
  fps: boolean;
  respeto: number;
  lifetime: number;
  unlocked: number;
  best: Record<string, BestRun>;
  ranks: Ranks;
  weapons: string[];
}

export function defaultSave(): Save {
  return {
    v: 1,
    lang: 'en',
    music: 0.45,
    sfx: 0.8,
    quality: 'auto',
    shake: true,
    assist: true,
    reduce: false,
    fps: false,
    respeto: 0,
    lifetime: 0,
    unlocked: 0,
    best: {},
    ranks: emptyRanks(),
    weapons: [],
  };
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const k = '__cd__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return null;
  }
}

export function loadSave(): Save {
  const s = storage();
  const base = defaultSave();
  if (!s) return base;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Save>;
    const ranks = emptyRanks();
    const incoming = (parsed.ranks ?? {}) as Partial<Ranks>;
    (Object.keys(ranks) as UpgradeId[]).forEach((id) => {
      const n = incoming[id];
      if (typeof n === 'number' && Number.isFinite(n)) ranks[id] = Math.max(0, Math.floor(n));
    });
    return {
      ...base,
      ...parsed,
      v: 1,
      lang: parsed.lang === 'es' ? 'es' : 'en',
      music: clamp01(parsed.music, base.music),
      sfx: clamp01(parsed.sfx, base.sfx),
      quality: parsed.quality === 'low' || parsed.quality === 'med' || parsed.quality === 'high' || parsed.quality === 'auto' ? parsed.quality : 'auto',
      ranks,
      best: parsed.best && typeof parsed.best === 'object' ? parsed.best : {},
      weapons: Array.isArray(parsed.weapons) ? parsed.weapons.filter((w) => typeof w === 'string') : [],
      respeto: num(parsed.respeto),
      lifetime: num(parsed.lifetime),
      unlocked: Math.max(0, Math.floor(num(parsed.unlocked))),
    };
  } catch {
    return base;
  }
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function clamp01(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
}

export function writeSave(save: Save): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify(save));
  } catch {
    /* private mode or quota: the shift still plays */
  }
}
