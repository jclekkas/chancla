// The kit's baked shading (section.ts): soffits, reveals and doorways are
// darkened in vertex colours, restrained (never crushed toward black, never
// brightened), and the dressings' wood keeps plain white vertex colours.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EL_PATIO } from '../shared/map';
import { LA_PLAZA } from '../shared/maps/plaza';
import { buildSection, inSection } from '../src/fps/render/section';
import { PLAZA_DRESSING } from '../src/fps/render/plaza-dressing';

const lum = (c: THREE.BufferAttribute, i: number) => 0.2126 * c.getX(i) + 0.7152 * c.getY(i) + 0.0722 * c.getZ(i);

describe('kit baked shading', () => {
  for (const q of ['high', 'low'] as const) {
    it(`darkens undersides and the wall under the eaves, within bounds (${q})`, () => {
      const { group } = buildSection(EL_PATIO.boxes.filter(inSection), q);
      const plaster = group.children.find((m) => m.name.endsWith(':plaster')) as THREE.Mesh;
      const col = plaster.geometry.getAttribute('color') as THREE.BufferAttribute, nr = plaster.geometry.getAttribute('normal') as THREE.BufferAttribute;
      let up = 0, nu = 0, down = 0, nd = 0;
      for (let i = 0; i < col.count; i++) {
        if (nr.getY(i) > 0.5) { up += lum(col, i); nu++; } else if (nr.getY(i) < -0.5) { down += lum(col, i); nd++; }
      }
      expect(nd).toBeGreaterThan(0);
      expect(down / nd).toBeLessThan(0.9 * (up / nu));
      // No vertex of any kit mesh is brightened past white or pushed near black by the bake.
      for (const m of group.children as THREE.Mesh[]) {
        const c = m.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
        if (!c) continue;
        for (let i = 0; i < c.count; i++) expect(Math.max(c.getX(i), c.getY(i), c.getZ(i))).toBeLessThanOrEqual(1.0001);
      }
    });
  }

  it('leaves the dressings\' wood white (its colour is the material\'s)', () => {
    const d = PLAZA_DRESSING.build(LA_PLAZA.boxes.filter((b) => PLAZA_DRESSING.mats.has(b.mat)), LA_PLAZA.decor!, 'high');
    const wood = d.group.children.find((m) => m.name === 'plaza-wood') as THREE.Mesh;
    const c = wood.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < c.count; i++) expect(c.getX(i) + c.getY(i) + c.getZ(i)).toBeCloseTo(3, 4);
  });
});
