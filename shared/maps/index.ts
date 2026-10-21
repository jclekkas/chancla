// The standalone map registry: the maps Arcade and Practice can be played
// on, outside the campaign. Online rooms carry the same id (the host picks;
// the server is authoritative), ready for when a game server is hosted.
// Campaign missions keep their own El Patio overlays and never read this.
import { EL_PATIO, type MapData } from '../map';
import { LA_PLAZA } from './plaza';
import { LA_FIESTA } from './fiesta';

export type MapId = 'patio' | 'plaza' | 'fiesta';

export interface MapEntry {
  id: MapId;
  data: MapData;
  /** i18n keys: name, one-line description, combat style. */
  nameKey: string;
  descKey: string;
  styleKey: string;
  /** Lighting theme for the renderer. */
  theme: 'afternoon' | 'morning' | 'noon' | 'dusk';
}

export const MAPS: readonly MapEntry[] = [
  { id: 'patio', data: EL_PATIO, nameKey: 'map.patio', descKey: 'map.patioDesc', styleKey: 'map.patioStyle', theme: 'afternoon' },
  { id: 'plaza', data: LA_PLAZA, nameKey: 'map.plaza', descKey: 'map.plazaDesc', styleKey: 'map.plazaStyle', theme: 'noon' },
  { id: 'fiesta', data: LA_FIESTA, nameKey: 'map.fiesta', descKey: 'map.fiestaDesc', styleKey: 'map.fiestaStyle', theme: 'dusk' },
];

export const DEFAULT_MAP: MapId = 'patio';

export function isMapId(v: unknown): v is MapId {
  return typeof v === 'string' && MAPS.some((m) => m.id === v);
}

export function mapEntry(id: string | null | undefined): MapEntry {
  return MAPS.find((m) => m.id === id) ?? MAPS[0]!;
}

export function mapData(id: string | null | undefined): MapData {
  return mapEntry(id).data;
}

/** "Random map": any map, with a source of randomness the caller controls. */
export function randomMapId(rand: () => number = Math.random): MapId {
  return MAPS[Math.floor(rand() * MAPS.length) % MAPS.length]!.id;
}
