// La Plaza's own props at the El Patio kit's quality (see map-dressing.ts).
// Owned by the La Plaza workstream; the arena (world.ts) routes this map's
// box types and decor listed below here.
import * as THREE from 'three';
import type { DressingModule } from './map-dressing';

export const PLAZA_DRESSING: DressingModule = {
  mats: new Set<string>(),
  decor: new Set(),
  build() {
    const group = new THREE.Group();
    group.name = 'plaza-dressing';
    return { group, calls: 0 };
  },
};
