// El Patio's fountain, statue and kiosks are drawn from their collision
// boxes and must not change what the boxes promise: below head height every
// vertex stays within its box's footprint (shallow trim aside), so nothing
// drawn blocks, hides or offers cover that the sim does not, and above it
// only the kiosk roofs overhang, by a bounded amount.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EL_PATIO, type MapBox } from '../shared/map';
import { FOCAL_MATS, buildFocal } from '../src/fps/render/patio-focal';

const TRIM = 0.06, HEAD = 2.0, EAVE = 0.45;
const focal = EL_PATIO.boxes.filter((b) => FOCAL_MATS.has(b.mat));

/** The box a point belongs to: the nearest footprint; where footprints nest (the statue in the fountain), the smaller. */
function owner(x: number, z: number): MapBox {
  let best = focal[0]!, bd = Infinity, area = Infinity;
  for (const b of focal) {
    const d = Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));
    const a = (b.maxX - b.minX) * (b.maxZ - b.minZ);
    if (d < bd || (d === bd && a < area)) { bd = d; best = b; area = a; }
  }
  return best;
}

describe('El Patio focal objects', () => {
  it('has the fountain, the statue and both kiosks', () => {
    expect(focal.map((b) => b.mat).sort()).toEqual(['fountain', 'kiosk', 'kiosk', 'statue']);
  });

  for (const q of ['high', 'medium', 'low'] as const) {
    it(`stays inside the collision footprints below head height (${q})`, () => {
      const f = buildFocal(focal, q);
      expect(f.calls).toBeLessThanOrEqual(7);
      const v = new THREE.Vector3();
      let worst = 0, worstHigh = 0, top = 0, arc = 0;
      f.group.updateMatrixWorld(true);
      for (const m of f.group.children as THREE.Mesh[]) {
        if (m.name === 'focal-shadow') continue; // flat on the paving, no volume
        const p = m.geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
          const b = owner(v.x, v.z);
          const out = Math.max(b.minX - v.x, v.x - b.maxX, b.minZ - v.z, v.z - b.maxZ, 0);
          if (v.y < HEAD) worst = Math.max(worst, out);
          else worstHigh = Math.max(worstHigh, out);
          if (m.name === 'focal-water') arc = Math.max(arc, v.y - b.maxY);
          else top = Math.max(top, v.y - b.maxY);
        }
      }
      expect(worst).toBeLessThanOrEqual(TRIM);
      expect(worstHigh).toBeLessThanOrEqual(EAVE);
      expect(top).toBeLessThanOrEqual(0.05); // nothing solid rises above its box
      // Only the fountain's thin, translucent water arcs (3 cm) rise over the basin's rim.
      expect(arc).toBeLessThanOrEqual(q === 'low' ? 0 : 0.8);
    });
  }

  it('the contact shadows lie flat on the paving', () => {
    const f = buildFocal(focal, 'high');
    const s = f.group.getObjectByName('focal-shadow') as THREE.Mesh;
    const p = s.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeLessThan(0.01);
  });
});
