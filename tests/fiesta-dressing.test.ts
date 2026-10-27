// La Fiesta's hedges, party tables, gift stacks and tarimas are drawn from
// their collision boxes and must not change what the boxes promise: every
// vertex stays within its box's footprint (shallow trim aside) and nothing
// solid rises above its box's top, so nothing drawn blocks, hides or offers
// cover that the sim does not. The dance floor stays flat on the ground.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { MapBox } from '../shared/map';
import { LA_FIESTA } from '../shared/maps/fiesta';
import { FIESTA_DRESSING, FIESTA_MATS } from '../src/fps/render/fiesta-dressing';

const TRIM = 0.06, CALLS = 10;
const props = LA_FIESTA.boxes.filter((b) => FIESTA_MATS.has(b.mat));
const df = LA_FIESTA.decor!.danceFloor!;

/** The box a point belongs to: the nearest footprint. */
function owner(x: number, z: number): { b: MapBox; d: number } {
  let best = props[0]!, bd = Infinity;
  for (const b of props) {
    const d = Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));
    if (d < bd) { bd = d; best = b; }
  }
  return { b: best, d: bd };
}

describe('La Fiesta dressing', () => {
  it('draws the hedges, tables, gifts and stages, and the dance floor', () => {
    const count = (m: string) => props.filter((b) => b.mat === m).length;
    expect([count('hedge'), count('table'), count('gift'), count('stage')]).toEqual([4, 8, 6, 2]);
    expect(FIESTA_DRESSING.decor.has('danceFloor')).toBe(true);
    // The piñata stays the arena's.
    expect(FIESTA_MATS.has('pinata')).toBe(false);
  });

  for (const q of ['high', 'medium', 'low'] as const) {
    it(`stays inside the collision boxes, within the draw-call budget (${q})`, () => {
      const f = FIESTA_DRESSING.build(props, LA_FIESTA.decor!, q);
      expect(f.calls).toBeLessThanOrEqual(CALLS);
      expect(f.group.children.length).toBe(f.calls);
      f.group.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      let worst = 0, top = 0, floorY = 0, floorR = 0, tris = 0;
      for (const m of f.group.children as THREE.Mesh[]) {
        const p = m.geometry.getAttribute('position');
        tris += p.count / 3;
        if (m.name === 'fiesta-shadow') continue; // flat on the paving, no volume
        if (m.name === 'fiesta-glow') {
          // The baked light pools: flat on the paving (normals up), inside the ground, no volume.
          const n = m.geometry.getAttribute('normal');
          for (let i = 0; i < p.count; i++) {
            v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
            expect(v.y).toBeGreaterThanOrEqual(0);
            expect(v.y).toBeLessThan(0.02);
            expect(n.getY(i)).toBe(1);
            expect(Math.abs(v.x)).toBeLessThanOrEqual(LA_FIESTA.decor!.ground.w / 2 + 1e-4);
            expect(Math.abs(v.z)).toBeLessThanOrEqual(LA_FIESTA.decor!.ground.d / 2 + 1e-4);
          }
          expect(m.castShadow).toBe(false);
          continue;
        }
        const isFloor = m.name === 'fiesta-floor' || m.name === 'fiesta-border';
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
          if (isFloor) {
            floorY = Math.max(floorY, Math.abs(v.y));
            floorR = Math.max(floorR, Math.hypot(v.x - df.x, v.z - df.z));
            continue;
          }
          const { b, d } = owner(v.x, v.z);
          worst = Math.max(worst, d);
          top = Math.max(top, v.y - b.maxY);
          expect(v.y).toBeGreaterThanOrEqual(-1e-6);
        }
      }
      expect(worst).toBeLessThanOrEqual(TRIM);
      expect(top).toBeLessThanOrEqual(0.005); // nothing solid rises above its box
      expect(floorY).toBeLessThan(0.01); // the dance floor is flush with the ground
      expect(floorR).toBeLessThanOrEqual(df.r + 1e-4);
      // Low casts no shadows; High and Medium cast from the solid props only.
      for (const m of f.group.children as THREE.Mesh[]) {
        if (q === 'low' || ['fiesta-floor', 'fiesta-border', 'fiesta-shadow', 'fiesta-glow', 'fiesta-lamp'].includes(m.name)) expect(m.castShadow).toBe(false);
      }
      expect(tris).toBeLessThan(q === 'high' ? 60000 : q === 'medium' ? 40000 : 20000);
    });
  }

  it('Low is lighter than Medium, Medium lighter than High', () => {
    const tri = (q: 'high' | 'medium' | 'low') => {
      const f = FIESTA_DRESSING.build(props, LA_FIESTA.decor!, q);
      return (f.group.children as THREE.Mesh[]).reduce((s, m) => s + m.geometry.getAttribute('position').count / 3, 0);
    };
    const h = tri('high'), m = tri('medium'), l = tri('low');
    expect(m).toBeLessThan(h);
    expect(l).toBeLessThan(m * 0.7);
  });

  it('lights the party with baked light only: pools on the paving and lit fixtures, no light objects', () => {
    for (const q of ['high', 'medium', 'low'] as const) {
      const f = FIESTA_DRESSING.build(props, LA_FIESTA.decor!, q);
      expect(f.group.getObjectByName('fiesta-glow')).toBeTruthy();
      expect(f.group.getObjectByName('fiesta-lamp')).toBeTruthy();
      let lights = 0;
      f.group.traverse((o) => { if ((o as THREE.Light).isLight) lights++; });
      expect(lights).toBe(0);
    }
    const light = FIESTA_DRESSING.light!({ hemi: [0xb8a0d8, 0x6a4040, 0.95], sun: [0xffa878, 1.4], fog: 0x6a3a6a }, 'low');
    expect(light.fog).toBeUndefined();
    expect(light.hemi![2]).toBeGreaterThan(0.95);
  });

  it('keeps the hedges opaque: the leaf mass covers each hedge to its full height', () => {
    const f = FIESTA_DRESSING.build(props.filter((b) => b.mat === 'hedge'), { ground: LA_FIESTA.decor!.ground }, 'low');
    const leaf = f.group.getObjectByName('fiesta-leaf') as THREE.Mesh;
    const ray = new THREE.Raycaster();
    leaf.material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    for (const b of props.filter((x) => x.mat === 'hedge')) {
      const alongX = b.maxX - b.minX >= b.maxZ - b.minZ;
      for (let i = 1; i < 10; i++) for (const y of [0.25, b.maxY / 2, b.maxY - 0.06]) {
        const x = alongX ? b.minX + ((b.maxX - b.minX) * i) / 10 : b.minX - 1;
        const z = alongX ? b.minZ - 1 : b.minZ + ((b.maxZ - b.minZ) * i) / 10;
        ray.set(new THREE.Vector3(x, y, z), new THREE.Vector3(alongX ? 0 : 1, 0, alongX ? 1 : 0));
        expect(ray.intersectObject(leaf).length).toBeGreaterThan(0);
      }
    }
  });
});
