// Campaign progress, stored locally and separately from settings and from
// anything multiplayer. Versioned so a future format can migrate.
import type { SafeStorage } from '../persistence/storage';
import type { MissionResult } from '../../shared/campaign/mission';
import { MISSIONS } from '../../shared/campaign/missions';

export const CAMPAIGN_KEY = 'chancla.campaign.v1';

export interface MissionRecord {
  completed: boolean;
  bestMs: number | null;
  challenges: { complete: boolean; time: boolean; skill: boolean };
  plays: number;
}

interface Save { v: 1; missions: Record<string, MissionRecord> }

const empty = (): MissionRecord => ({ completed: false, bestMs: null, challenges: { complete: false, time: false, skill: false }, plays: 0 });

export class CampaignProgress {
  private data: Save;

  constructor(private storage: SafeStorage) {
    this.data = this.load();
  }

  private load(): Save {
    const raw = this.storage.getJSON<Save>(CAMPAIGN_KEY);
    const out: Save = { v: 1, missions: {} };
    if (!raw || raw.v !== 1 || typeof raw.missions !== 'object' || !raw.missions) return out;
    for (const m of MISSIONS) {
      const r = (raw.missions as Record<string, Partial<MissionRecord>>)[m.id];
      if (!r) continue;
      out.missions[m.id] = {
        completed: r.completed === true,
        bestMs: typeof r.bestMs === 'number' && Number.isFinite(r.bestMs) && r.bestMs > 0 ? r.bestMs : null,
        challenges: {
          complete: r.challenges?.complete === true, time: r.challenges?.time === true, skill: r.challenges?.skill === true,
        },
        plays: typeof r.plays === 'number' ? Math.max(0, Math.floor(r.plays)) : 0,
      };
    }
    return out;
  }

  /** False in private modes or with storage blocked: progress lasts this session. */
  get persistent(): boolean { return this.storage.persistent; }

  get(id: string): MissionRecord { return this.data.missions[id] ?? empty(); }

  /** First play is sequential; finished missions stay replayable. */
  unlocked(id: string): boolean {
    const i = MISSIONS.findIndex((m) => m.id === id);
    if (i <= 0) return i === 0;
    return this.get(MISSIONS[i - 1]!.id).completed || this.get(id).completed;
  }

  next(id: string): string | null {
    const i = MISSIONS.findIndex((m) => m.id === id);
    return MISSIONS[i + 1]?.id ?? null;
  }

  started(id: string): void {
    const r = { ...this.get(id) };
    r.plays++;
    this.data.missions[id] = r;
    this.save();
  }

  /** Merges a finished run: best time and challenges only ever improve. */
  record(id: string, res: MissionResult): { newBest: boolean; newChallenges: string[] } {
    const old = this.get(id);
    const r: MissionRecord = { ...old, challenges: { ...old.challenges } };
    const newChallenges: string[] = [];
    let newBest = false;
    if (res.challenges.complete) {
      r.completed = true;
      if (r.bestMs === null || res.timeMs < r.bestMs) { newBest = old.bestMs !== null; r.bestMs = res.timeMs; }
    }
    for (const k of ['complete', 'time', 'skill'] as const) {
      if (res.challenges[k] && !r.challenges[k]) { r.challenges[k] = true; newChallenges.push(k); }
    }
    this.data.missions[id] = r;
    this.save();
    return { newBest, newChallenges };
  }

  get allDone(): boolean { return MISSIONS.every((m) => this.get(m.id).completed); }

  /** Erases campaign progress only (never settings or anything else). */
  reset(): void {
    this.data = { v: 1, missions: {} };
    this.storage.remove(CAMPAIGN_KEY);
  }

  private save(): void {
    this.storage.set(CAMPAIGN_KEY, JSON.stringify(this.data));
  }
}
