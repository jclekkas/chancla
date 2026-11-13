import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mapData } from '../shared/maps/index';
import { buildNeighborhood } from '../src/fps/render/neighborhood';

// The neighbourhood is scenery only: no collision, so it must stay outside the playable footprint
// (apart from props perched on rooftops no one can reach) and be identical on every build.
describe('neighbourhood', () => {
  for (const id of ['patio', 'plaza', 'fiesta'] as const) {
    const map = mapData(id);
    for (const q of ['high', 'low'] as const) {
      it(`${id}/${q}: built, deterministic, and no scenery vertex in reach`, () => {
        const a = buildNeighborhood(map, q, 0xf3b07a, 0x6a4a8a)!, b = buildNeighborhood(map, q, 0xf3b07a, 0x6a4a8a)!;
        expect(a.calls).toBeGreaterThan(0);
        expect(a.calls).toBe(b.calls);
        expect(a.tris).toBe(b.tris);
        const bd = map.bounds;
        // The far meshes (ring, hills, landmarks) lie outside the arena footprint.
        for (const c of a.group.children) {
          if (!c.name.startsWith('hood-far')) continue;
          const pos = (c as THREE.Mesh).geometry.getAttribute('position') as THREE.BufferAttribute;
          for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), z = pos.getZ(i);
            expect(x < bd.minX || x > bd.maxX || z < bd.minZ || z > bd.maxZ).toBe(true);
          }
        }
        // Everything else hangs on a tall house: roof pieces stand on top, wall dressing stays within half a
        // metre of the wall below head height (an awning may reach further, above it).
        const houses = map.boxes.filter((o) => o.minY <= 0.05 && o.maxY >= 5);
        const reach = (x: number, z: number) => Math.min(...houses.map((o) => Math.hypot(Math.max(o.minX - x, 0, x - o.maxX), Math.max(o.minZ - z, 0, z - o.maxZ))));
        for (const c of a.group.children) {
          if (!c.name.startsWith('hood-roofs') && !c.name.startsWith('hood-wall')) continue;
          const pos = (c as THREE.Mesh).geometry.getAttribute('position') as THREE.BufferAttribute;
          for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            if (y >= 5) continue; // up on a roof or a high awning
            expect(reach(pos.getX(i), pos.getZ(i))).toBeLessThanOrEqual(y < 2.4 ? 0.5 : 1.4);
          }
        }
      });
    }
  }
});
