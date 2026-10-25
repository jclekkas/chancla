// The arena look's skin shading (rosa-materials.ts ARENA_SKIN) is its own
// program; the campaign / non-arena material must stay exactly as it was:
// the same world ramp texture, the same program key and the same shader
// text (hash recorded from the material before the arena shading existed).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { rosaMaterial } from '../src/fps/render/rosa-materials';
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
});
