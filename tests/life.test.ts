import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mapData } from '../shared/maps/index';
import { buildNeighborhood } from '../src/fps/render/neighborhood';
import { buildLife } from '../src/fps/render/life';

// The living layer is scenery: it must stay where it was put (high above play, or out on the far
// terraces), be identical on every build, and stand still under reduced motion.
describe('living neighbourhood', () => {
  for (const id of ['patio', 'plaza', 'fiesta'] as const) {
    for (const q of ['high', 'low'] as const) {
      it(`${id}/${q}: bounded, deterministic, frozen when calm`, () => {
        const map = mapData(id), hood = buildNeighborhood(map, q, 0xf3b07a, 0x6a4a8a)!;
        expect(hood.paths.length).toBeGreaterThan(0);
        const make = () => buildLife({ map, quality: q, paths: hood.paths, dusk: id === 'fiesta', mote: 0xfff1cc, lamp: hood.lamp });
        const a = make(), b = make();
        expect(a.calls).toBe(b.calls);
        expect(a.calls).toBeLessThanOrEqual(3);
        a.update(10); b.update(10);
        const snap = (v: ReturnType<typeof make>) => v.group.children.map((c) => (c as THREE.InstancedMesh).isInstancedMesh ? Array.from((c as THREE.InstancedMesh).instanceMatrix.array.slice(0, 16)) : []);
        expect(snap(a)).toEqual(snap(b));
        // Birds stay high, everything bounded in the sky or on a far terrace (never in the arena at head height).
        const bd = map.bounds, m = new THREE.Matrix4(), p = new THREE.Vector3();
        for (const c of a.group.children) {
          const im = c as THREE.InstancedMesh;
          if (!im.isInstancedMesh) continue;
          for (let i = 0; i < im.count; i++) {
            im.getMatrixAt(i, m); p.setFromMatrixPosition(m);
            const inArena = p.x > bd.minX && p.x < bd.maxX && p.z > bd.minZ && p.z < bd.maxZ;
            if (inArena) expect(p.y).toBeGreaterThan(15); // birds only; walkers are on the far hills
            else expect(Math.hypot(p.x, p.z)).toBeGreaterThan(30);
          }
        }
        // Reduced motion: the next update changes nothing.
        a.setCalm(true);
        const before = snap(a);
        a.update(20);
        expect(snap(a)).toEqual(before);
      });
    }
  }
});
