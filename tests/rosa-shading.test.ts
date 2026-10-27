// The arena look's skin shading (rosa-materials.ts ARENA_SKIN) is its own
// program; the campaign / non-arena material must stay exactly as it was:
// the same world ramp texture, the same program key and the same shader
// text (hash recorded from the material before the arena shading existed).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { ROSA_SHARED, rosaMaterial } from '../src/fps/render/rosa-materials';
import { toonRamp } from '../src/fps/render/materials';
import { buildRosaModel } from '../src/fps/render/rosa-model';

function compiled(m: THREE.Material): { vs: string; fs: string } {
  const lib = THREE.ShaderLib.toon;
  const sh = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(sh, null as unknown as THREE.WebGLRenderer);
  return { vs: sh.vertexShader, fs: sh.fragmentShader };
}
const hash = (c: { vs: string; fs: string }) => createHash('sha256').update(`${c.vs}\n//frag\n${c.fs}`).digest('hex');
const FR = { lidY: 0.08, browIn: 0.01, browOut: 0.05 };

describe('rosa shading', () => {
  it('keeps the non-arena material unchanged', () => {
    const m = rosaMaterial(FR);
    expect(m.gradientMap).toBe(toonRamp());
    expect(m.customProgramCacheKey()).toBe('rosa-ink:0.0800:0.0100:0.0500');
    expect(hash(compiled(m))).toBe('291600fdd4f691c26cf88d84a87f9f0caad3bfe28deea7bf8d6e146f5a8e4ad5');
    const campaign = buildRosaModel(0, { home: true }).flashMats[0] as THREE.MeshToonMaterial;
    const plain = buildRosaModel(1, { quality: 'medium' }).flashMats[0] as THREE.MeshToonMaterial;
    for (const c of [campaign, plain]) {
      expect(c.gradientMap).toBe(toonRamp());
      expect(c.customProgramCacheKey()).not.toContain('skin');
      expect(compiled(c).fs).not.toContain('vRosaSkin');
    }
  });

  it('gives the arena look its own program on the same world ramp', () => {
    const a = rosaMaterial(FR, undefined, { arena: true });
    expect(a.gradientMap).toBe(toonRamp());
    expect(a.customProgramCacheKey()).not.toBe(rosaMaterial(FR).customProgramCacheKey());
    const { vs, fs } = compiled(a);
    expect(vs).toContain('vRosaSkin = ');
    expect(fs).toContain('rosaGradient( geometryNormal');
    expect(fs).toContain('rosaLift + ( 1.0 - rosaLift ) * getShadow(');
    expect(fs).not.toContain('#include <lights_fragment_begin>');
    const arena = buildRosaModel(0, { arena: true }).flashMats[0] as THREE.MeshToonMaterial;
    expect(arena.customProgramCacheKey()).toContain(':skin:');
    // The home look ignores `arena` and keeps the campaign material.
    expect((buildRosaModel(0, { arena: true, home: true }).flashMats[0] as THREE.MeshToonMaterial).customProgramCacheKey()).not.toContain('skin');
  });

  it('lifts the head\'s pieces only: their colours appear on no other joint', () => {
    const head = [ROSA_SHARED.hair, ROSA_SHARED.hairHi, ROSA_SHARED.eyeWhite, ROSA_SHARED.iris, ROSA_SHARED.frames, ROSA_SHARED.lips].map((h) => new THREE.Color(h));
    const c = new THREE.Color();
    for (const team of [0, 1] as const) for (const quality of ['high', 'medium', 'low'] as const) {
      const r = buildRosaModel(team, { arena: true, quality });
      let onHead = 0;
      r.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || m.material !== r.flashMats[0]) return;
        const col = m.geometry.attributes.color!, ink = m.geometry.attributes.ink!;
        for (let i = 0; i < col.count; i++) {
          if (ink.getX(i) > 0.5) continue; // the hull paints flat ink
          c.fromBufferAttribute(col, i);
          const near = head.some((h) => Math.hypot(c.r - h.r, c.g - h.g, c.b - h.b) < 0.008);
          if (!near) continue;
          if (m.parent === r.head) onHead++;
          else expect.fail(`head colour on a non-head joint (team ${team}, ${quality})`);
        }
      });
      expect(onHead).toBeGreaterThan(0);
    }
  });
});
