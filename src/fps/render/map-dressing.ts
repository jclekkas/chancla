// Each arena map's own props at the El Patio kit's quality (La Plaza's
// market, La Fiesta's party), drawn from the same authoritative boxes as the
// rest of the arena. The shared kit (section.ts) draws the houses, walls,
// steps and common props on every map; a map's dressing module draws the
// box types and decor that make that map itself. Visual only: collision,
// cover and sight lines come from the boxes and are unchanged.
import type * as THREE from 'three';
import type { MapBox, MapDecor } from '../../../shared/map';
import type { Quality } from '../settings';

export interface Dressing {
  group: THREE.Group;
  /** Draw calls added (whole set, before culling). */
  calls: number;
  /** Per-frame animation (water, cloth), given the world clock in seconds. */
  update?(t: number): void;
}

export interface DressingModule {
  /** Box types this map's dressing draws (they skip the arena's generic drawing). */
  mats: ReadonlySet<string>;
  /** Decor entries it draws itself (the arena then skips its generic version). */
  decor: ReadonlySet<'awnings' | 'trees' | 'danceFloor'>;
  build(boxes: readonly MapBox[], decor: MapDecor, quality: Quality): Dressing;
}
