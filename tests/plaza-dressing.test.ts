// La Plaza's stalls, awnings, stages, fountain, kiosks and trees are drawn
// from the map's collision boxes and decor and must not change what the
// boxes promise: below head height every vertex stays within its box's
// footprint (shallow trim aside), so nothing drawn blocks, hides or offers
// cover that the sim does not; nothing solid rises above its box except the
// awnings (and their poles) at decor's heights, the tree trunks and their
// canopies above head height, and the fountain's thin water arcs.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { MapBox } from '../shared/map';
import { LA_PLAZA } from '../shared/maps/plaza';
import { PLAZA_DRESSING } from '../src/fps/render/plaza-dressing';

const TRIM = 0.06, HEAD = 2.0, EAVE = 0.45, CANOPY = 1.9;
const decor = LA_PLAZA.decor!;
const dressed = LA_PLAZA.boxes.filter((b) => PLAZA_DRESSING.mats.has(b.mat));
// Trees grow out of planters (drawn by the kit): their trunks belong to the planter's footprint.
const owners = [...dressed, ...LA_PLAZA.boxes.filter((b) => b.mat === 'planter')];
const awnings = decor.awnings ?? [], trees = decor.trees ?? [];

/** The box a point belongs to: the nearest footprint; where footprints nest (the pedestal in the basin), the smaller. */
function owner(x: number, z: number): MapBox {
  let best = owners[0]!, bd = Infinity, area = Infinity;
  for (const b of owners) {
    const d = Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));
    const a = (b.maxX - b.minX) * (b.maxZ - b.minZ);
    if (d < bd || (d === bd && a < area)) { bd = d; best = b; area = a; }
  }
  return best;
}
const awningAt = (x: number, z: number) => awnings.find((a) => x >= a.minX - TRIM && x <= a.maxX + TRIM && z >= a.minZ - TRIM && z <= a.maxZ + TRIM);
const treeDist = (x: number, z: number) => Math.min(...trees.map((t) => Math.hypot(x - t.x, z - t.z)));
/** Within 10 cm of a stall's corner: the posts that carry the awning. */
const atPost = (x: number, z: number) => dressed.some((b) => b.mat === 'stall' && [b.minX, b.maxX].some((px) => Math.abs(x - px) < 0.1) && [b.minZ, b.maxZ].some((pz) => Math.abs(z - pz) < 0.1));

describe('La Plaza dressing', () => {
  it('draws the stalls, stages, fountain and kiosks, the awnings and the trees', () => {
    expect([...new Set(dressed.map((b) => b.mat))].sort()).toEqual(['fountain', 'kiosk', 'stage', 'stall']);
    expect(dressed.filter((b) => b.mat === 'stall')).toHaveLength(6);
    expect([...PLAZA_DRESSING.decor].sort()).toEqual(['awnings', 'trees']);
  });

  for (const q of ['high', 'medium', 'low'] as const) {
    it(`stays inside the collision footprints and under the box tops (${q})`, () => {
      const d = PLAZA_DRESSING.build(dressed, decor, q);
      expect(d.calls).toBeLessThanOrEqual(8);
      expect(d.group.children).toHaveLength(d.calls);
      const v = new THREE.Vector3();
      let worst = 0, worstHigh = 0, top = 0, arc = 0, leafLow = Infinity, tris = 0;
      d.group.updateMatrixWorld(true);
      for (const m of d.group.children as THREE.Mesh[]) {
        // Low casts no shadows; High and Medium cast from every solid mesh.
        expect(m.castShadow).toBe(q !== 'low' && m.name !== 'plaza-water' && m.name !== 'plaza-shadow');
        const p = m.geometry.getAttribute('position');
        tris += p.count / 3;
        if (m.name === 'plaza-shadow') continue; // flat on the paving, no volume
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
          const b = owner(v.x, v.z), aw = awningAt(v.x, v.z), td = treeDist(v.x, v.z);
          const out = Math.max(b.minX - v.x, v.x - b.maxX, b.minZ - v.z, v.z - b.maxZ, 0);
          if (m.name === 'plaza-leaf') leafLow = Math.min(leafLow, v.y);
          if (v.y < HEAD) worst = Math.max(worst, out);
          else if (!aw && td > CANOPY) worstHigh = Math.max(worstHigh, out);
          const rise = v.y - b.maxY;
          if (m.name === 'plaza-water') { arc = Math.max(arc, rise); continue; }
          // Allowed above the box: the awning (canopy, valance, frame) and its posts, and the trees.
          const awningPart = aw && v.y <= aw.y + 0.35 && (v.y >= aw.y - 0.25 || atPost(v.x, v.z));
          const treePart = v.y < 2.5 ? td <= 0.25 : td <= CANOPY;
          if (!awningPart && !treePart) top = Math.max(top, rise);
        }
      }
      expect(worst).toBeLessThanOrEqual(TRIM);
      expect(worstHigh).toBeLessThanOrEqual(EAVE);
      expect(top).toBeLessThanOrEqual(0.05); // nothing else solid rises above its box
      // Only the fountain's thin, translucent water arcs (High, Medium) rise over the basin's rim.
      expect(arc).toBeLessThanOrEqual(q === 'low' ? 0 : 0.6);
      // The tree canopies stay well above head height.
      expect(leafLow).toBeGreaterThan(2.6);
      // A modest triangle budget for the whole set.
      expect(tris).toBeLessThan(q === 'low' ? 12000 : 30000);
    });
  }

  it('Low has fewer details than High', () => {
    const count = (q: 'high' | 'low') => (PLAZA_DRESSING.build(dressed, decor, q).group.children as THREE.Mesh[]).reduce((n, m) => n + m.geometry.getAttribute('position').count, 0);
    expect(count('low')).toBeLessThan(count('high') * 0.7);
  });

  it('the contact shadows lie flat on the paving', () => {
    const d = PLAZA_DRESSING.build(dressed, decor, 'high');
    const s = d.group.getObjectByName('plaza-shadow') as THREE.Mesh;
    const p = s.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeLessThan(0.01);
  });
});
