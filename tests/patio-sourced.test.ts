// El Patio's sourced surface textures (patio-sourced.ts): the ?mat= switch,
// which kit kinds they replace, the street split in the standard variant, and
// that nothing but El Patio in the shooter can take them.
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { EL_PATIO } from '../shared/map';
import { LA_PLAZA } from '../shared/maps/plaza';
import { installSourced, requestedMatMode, resetSourced, sourcedMode, type SourcedSet } from '../src/fps/render/patio-sourced';
import { kitMaterials, patioGround } from '../src/fps/render/patio-materials';
import { buildWorld } from '../src/fps/render/world';

const surf = () => ({ map: new THREE.Texture(), normal: new THREE.Texture(), rough: new THREE.Texture() });
const fake = (mode: 'toon' | 'std'): SourcedSet => ({ mode, quality: 'high', plaster: surf(), cobble: surf(), wood: surf() });

afterEach(() => resetSourced());

describe('patio sourced textures', () => {
  it('reads ?mat= and defaults to classic', () => {
    expect(requestedMatMode('')).toBe('classic');
    expect(requestedMatMode('?mat=toon')).toBe('toon');
    expect(requestedMatMode('?x=1&mat=std')).toBe('std');
    expect(requestedMatMode('?mat=shiny')).toBe('classic');
    expect(sourcedMode()).toBe('classic'); // nothing loaded
  });

  it('std swaps plaster and wood only; toon keeps toon materials', () => {
    const std = kitMaterials('high', fake('std'));
    expect((std.plaster as THREE.MeshStandardMaterial).isMeshStandardMaterial).toBe(true);
    expect((std.wood as THREE.MeshStandardMaterial).isMeshStandardMaterial).toBe(true);
    for (const k of ['cantera', 'flat', 'detail', 'louver', 'talavera', 'glass', 'lamp', 'pavers', 'leaf'] as const) {
      expect((std[k] as THREE.MeshToonMaterial).isMeshToonMaterial).toBe(true);
    }
    const toon = kitMaterials('high', fake('toon'));
    expect((toon.plaster as THREE.MeshToonMaterial).isMeshToonMaterial).toBe(true);
    expect((toon.plaster as THREE.MeshToonMaterial).normalMap).not.toBeNull();
    expect((toon.plaster as THREE.MeshToonMaterial).vertexColors).toBe(true);
    const classic = kitMaterials('high');
    expect((classic.plaster as THREE.MeshToonMaterial).normalMap).toBeNull();
  });

  it('std splits the floor into terracotta and street groups covering every triangle', () => {
    const { geometry, material } = patioGround('high', { w: 54, d: 38 }, true, fake('std'));
    expect(Array.isArray(material)).toBe(true);
    const ms = material as THREE.Material[];
    expect((ms[0] as THREE.MeshToonMaterial).isMeshToonMaterial).toBe(true);
    expect((ms[1] as THREE.MeshStandardMaterial).isMeshStandardMaterial).toBe(true);
    expect(geometry.groups.length).toBe(2);
    const base = new THREE.PlaneGeometry(54, 38, 40, 28).getIndex()!.count; // ~one vertex every 1.35 m
    expect(geometry.groups[0]!.count + geometry.groups[1]!.count).toBeGreaterThanOrEqual(base);
    expect(geometry.getAttribute('color')).toBeTruthy(); // the dust and wear tints stay
  });

  it('only El Patio with the flag takes them', () => {
    installSourced(fake('std'));
    const has = (g: THREE.Object3D) => { let n = 0; g.traverse((o) => { const m = (o as THREE.Mesh).material; for (const x of Array.isArray(m) ? m : m ? [m] : []) if ((x as THREE.MeshStandardMaterial).isMeshStandardMaterial) n++; }); return n; };
    expect(has(buildWorld('high', { sourced: true }).group)).toBeGreaterThan(0);
    expect(has(buildWorld('high', {}).group)).toBe(0);
    expect(has(buildWorld('high', { map: LA_PLAZA, sourced: true }).group)).toBe(0);
    expect(has(buildWorld('high', { boxes: EL_PATIO.boxes, sourced: true }).group)).toBe(0);
  });
});
