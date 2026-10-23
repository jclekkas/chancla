import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildRosaModel, rosaLookTriangles, type RosaModel } from '../src/fps/render/rosa-model';
import { RIG } from '../src/fps/render/rosa-rig';
import { Avatar } from '../src/fps/render/rosa';
import type { Quality } from '../src/fps/settings';

const BUDGET: Record<Quality, { draws: number; casters: number; tris: number }> = {
  high: { draws: 36, casters: 14, tris: 12000 },
  medium: { draws: 26, casters: 10, tris: 8000 },
  low: { draws: 16, casters: 0, tris: 4500 },
};
const QUALITIES: Quality[] = ['high', 'medium', 'low'];
const TEAMS = [0, 1] as const;

function tris(m: THREE.Mesh): number {
  const g = m.geometry;
  const n = (g.index ? g.index.count : g.attributes.position!.count) / 3;
  return (m as THREE.InstancedMesh).isInstancedMesh ? n * (m as THREE.InstancedMesh).count : n;
}

/** Main-pass cost of a Rosa in a match pose: one weapon in hand, no bubble, no stars. */
function cost(r: RosaModel, weapon: 0 | 1): { draws: number; casters: number; tris: number } {
  r.weapons[0].visible = weapon === 0;
  r.weapons[1].visible = weapon === 1;
  r.bubble.visible = false;
  let draws = 0, casters = 0, t = 0;
  r.root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    draws++;
    t += tris(m);
    if (m.castShadow) casters++;
  });
  return { draws, casters, tris: t };
}

const JOINTS = ['root', 'hips', 'torso', 'head', 'armL', 'armR', 'foreL', 'foreR', 'wristL', 'wristR', 'legL', 'legR', 'shinL', 'shinR', 'footL', 'footR'] as const;

describe('Rosa model: cost per quality', () => {
  for (const q of QUALITIES) for (const team of TEAMS) {
    it(`${q}, team ${team}: draws, shadow casters and triangles within budget`, () => {
      const r = buildRosaModel(team, { quality: q });
      for (const w of [0, 1] as const) {
        const c = cost(r, w);
        expect(c.draws).toBeLessThanOrEqual(BUDGET[q].draws);
        expect(c.casters).toBeLessThanOrEqual(BUDGET[q].casters);
        expect(c.tris).toBeLessThanOrEqual(BUDGET[q].tris);
      }
      expect(rosaLookTriangles(team, q)).toBeGreaterThan(q === 'low' ? 2000 : 4000); // not accidentally empty
    });
  }
  it('uses no textures (vertex colours only)', () => {
    const r = buildRosaModel(0, { quality: 'high' });
    r.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshToonMaterial | undefined;
      if (m && 'map' in m) expect(m.map ?? null).toBeNull();
    });
  });
});

describe('Rosa model: rig contract', () => {
  for (const q of QUALITIES) for (const team of TEAMS) {
    it(`${q}, team ${team}: every joint is a group at its RIG position with zero rest rotation`, () => {
      const r = buildRosaModel(team, { quality: q });
      for (const j of JOINTS) {
        expect(r[j]).toBeInstanceOf(THREE.Group);
        expect(r[j].rotation.x === 0 && r[j].rotation.y === 0 && r[j].rotation.z === 0).toBe(true);
      }
      const near = (v: THREE.Vector3, x: number, y: number, z: number) => expect(v.distanceTo(new THREE.Vector3(x, y, z))).toBeLessThan(1e-9);
      near(r.hips.position, 0, RIG.hipY, 0);
      near(r.torso.position, 0, 0, 0);
      near(r.head.position, 0, RIG.headY, 0);
      near(r.armL.position, -RIG.shoulderX, RIG.shoulderY, 0);
      near(r.armR.position, RIG.shoulderX, RIG.shoulderY, 0);
      near(r.foreR.position, 0, -RIG.upperArm, 0);
      near(r.wristR.position, 0, -RIG.foreArm, 0);
      near(r.legL.position, -RIG.legX, RIG.legY, 0);
      near(r.shinR.position, 0, -RIG.thigh, 0);
      near(r.footR.position, 0, -RIG.shin, 0);
      // Parents as the contract says.
      expect(r.hips.parent).toBe(r.root);
      expect(r.torso.parent).toBe(r.hips);
      expect(r.head.parent).toBe(r.torso);
      expect(r.wristR.parent).toBe(r.foreR);
      expect(r.footL.parent).toBe(r.shinL);
      for (const w of r.weapons) expect(w.parent).toBe(r.wristR);
      expect(r.stars.parent).toBe(r.head);
      expect(r.bubble.parent).toBe(r.root);
      expect(r.flashMats.length).toBeGreaterThan(0);
      expect(r.extras.skirt?.parent).toBe(r.hips);
    });
  }
});

describe('Rosa model: inside the gameplay bounds', () => {
  for (const q of QUALITIES) for (const team of TEAMS) {
    it(`${q}, team ${team}: body inside the cylinder, head inside its sphere, standing height kept`, () => {
      const r = buildRosaModel(team, { quality: q });
      r.root.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      let top = 0, bodyR = 0, headR = 0, low = Infinity;
      for (const j of JOINTS) {
        for (const o of r[j].children) {
          const m = o as THREE.Mesh;
          if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || r.weapons.includes(m) || m === r.bubble) continue;
          const p = m.geometry.attributes.position!;
          for (let i = 0; i < p.count; i++) {
            v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
            low = Math.min(low, v.y);
            if (j === 'head') {
              top = Math.max(top, v.y);
              // The straw hat is wider and taller than the head by design (as before); the rebozo drapes onto the shoulders.
              if ((team === 0 && ((Math.hypot(v.x, v.z) > 0.2 && v.y > 1.55) || v.y > 1.7)) || v.y < 1.4) continue;
              headR = Math.max(headR, Math.hypot(v.x, v.y - 1.52, v.z));
            } else {
              bodyR = Math.max(bodyR, Math.hypot(v.x, v.z));
              top = Math.max(top, v.y);
            }
          }
        }
      }
      expect(bodyR).toBeLessThanOrEqual(0.36);
      expect(headR).toBeLessThanOrEqual(0.31); // the rebozo (and its outline) sits back on her head, a few cm past the sphere
      expect(low).toBeGreaterThan(-0.01); // soles on the ground, not under it
      expect(low).toBeLessThan(0.02);
      expect(top).toBeLessThan(team === 0 ? 1.88 : 1.82);
      expect(top).toBeGreaterThan(1.7);
    });
  }
});

describe('Rosa model: ruleros', () => {
  for (const q of QUALITIES) for (const team of TEAMS) {
    it(`${q}, team ${team}: four rollers on the hair, under the head, in slot order`, () => {
      const r = buildRosaModel(team, { quality: q });
      expect(r.rulPlace.length).toBe(4);
      expect(r.rulMesh?.parent).toBe(r.head);
      expect(r.rulMesh?.count).toBe(4);
      if (q === 'low') expect(r.rulOutline).toBeNull();
      else expect(r.rulOutline?.parent).toBe(r.head);
      const hair = new THREE.Vector3(0, 0.122, 0.008).multiplyScalar(1.12); // the head is drawn 1.12x about the neck
      const p = new THREE.Vector3();
      r.rulPlace.forEach((m, i) => {
        p.setFromMatrixPosition(m);
        const d = p.distanceTo(hair);
        expect(d).toBeGreaterThan(0.16); // on the hair, not inside the head
        expect(d).toBeLessThan(0.235); // and touching it
        expect(p.z).toBeLessThan(0.02); // toward the front, where a backhand to the face knocks them off
        expect(i < 2 ? Math.abs(p.x) < 0.08 : Math.abs(p.x) > 0.08).toBe(true);
      });
    });
  }
  it('the campaign home look has six curlers and no hat, hood or match rollers', () => {
    for (const q of QUALITIES) {
      const a = new Avatar(0, { home: true, quality: q });
      const m = (a as unknown as { model: RosaModel }).model;
      expect(m.curlers.length).toBe(6);
      expect(m.rulMesh).toBeNull();
      for (const c of m.curlers) expect(c.parent).toBe(m.head);
      a.setRuleros(4);
      expect(m.curlers.filter((c) => c.visible).length).toBe(4);
      a.setRuleros(0);
      expect(m.curlers.some((c) => c.visible)).toBe(false);
      a.dispose();
    }
  });
});

describe('Rosa model: shared geometry and disposal', () => {
  it('caches each look and marks its geometry shared; avatars only own their materials', () => {
    const a = buildRosaModel(1, { quality: 'medium' }), b = buildRosaModel(1, { quality: 'medium' });
    const geos = (r: RosaModel) => { const s: THREE.BufferGeometry[] = []; r.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) s.push(m.geometry); }); return s; };
    const ga = geos(a), gb = geos(b);
    expect(ga.length).toBe(gb.length);
    ga.forEach((g, i) => { expect(g).toBe(gb[i]); expect(g.userData.shared).toBe(true); });
    expect(a.flashMats[0]).not.toBe(b.flashMats[0]);
  });
  it('Avatar.dispose frees only per-avatar resources', () => {
    const av = new Avatar(0, { quality: 'high' });
    const m = (av as unknown as { model: RosaModel }).model;
    let disposed = 0;
    m.flashMats[0]!.addEventListener('dispose', () => disposed++);
    const shared: THREE.BufferGeometry[] = [];
    m.root.traverse((o) => { const g = (o as THREE.Mesh).geometry; if (g) shared.push(g); });
    let geoDisposed = 0;
    for (const g of shared) g.addEventListener('dispose', () => geoDisposed++);
    av.dispose();
    expect(disposed).toBe(1);
    expect(geoDisposed).toBe(0);
  });
});
