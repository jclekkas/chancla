import type { MissionDef } from '../types';
import { RULEROS } from './ruleros';

// Campaign order. Unlocking follows `order`.
export const MISSIONS: MissionDef[] = [RULEROS];

export function missionById(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}
