import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EL_PATIO } from '../../shared/map';
import { GeoBatch, boxGeo, surface, stuccoTexture, COLORS } from '../fps/render/materials';

/** Reusable facade trim contained in the existing building footprint or above head height. */
export function courtyardDetail(): THREE.Group {
  const root = new THREE.Group(); root.name = 'courtyard-detail-study';
  const batch = new GeoBatch();
  const cream = surface(COLORS.cream, stuccoTexture(), 0.018);
  const clay = surface(COLORS.terracottaDark, stuccoTexture(), 0.018);
  const brick = surface(COLORS.stone, stuccoTexture(), 0.02);
  for (const b of EL_PATIO.boxes) {
    if (!b.facade || !b.mat.startsWith('stucco') || b.maxY < 3.5) continue;
    // Layered roof cornice: adds a stepped silhouette without a new obstacle.
    batch.add(clay, boxGeo(b.minX-.06,b.maxY-.20,b.minZ-.06,b.maxX+.06,b.maxY-.08,b.maxZ+.06));
    batch.add(cream, boxGeo(b.minX-.12,b.maxY-.08,b.minZ-.12,b.maxX+.12,b.maxY+.04,b.maxZ+.12));
    // Alternating corner masonry kept inside the authoritative wall footprint.
    for (let y=.7; y < b.maxY-.35; y+=.48) {
      const width = Math.round(y/.48)%2 ? .28 : .4;
      for (const x of [b.minX,b.maxX-width]) for (const z of [b.minZ,b.maxZ-width]) {
        batch.add(brick,boxGeo(x-.008,y,z-.008,x+width+.008,y+.24,z+width+.008));
      }
    }
  }
  batch.build(root, (gs)=>mergeGeometries(gs,false));
  return root;
}
