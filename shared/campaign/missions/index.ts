import type { MissionDef } from '../types';
import { RULEROS } from './ruleros';
import { COCINA } from './cocina';
import { PATIO } from './patio';

// Campaign order. Unlocking follows `order`.
export const MISSIONS: MissionDef[] = [RULEROS, COCINA, PATIO];

export function missionById(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}
