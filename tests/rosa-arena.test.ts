// The arena look (the shooter's Rosa, `arena: true`) is a separate set of
// shapes from the campaign's; this pins the campaign / non-arena
// construction to its exact meshes (recorded before the arena look
// existed), and checks the arena look against the same contract as the
// old one: cost, rig, bounds, ruleros and the face rig.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildRosaModel, type RosaModel } from '../src/fps/render/rosa-model';
import { RosaAnimator } from '../src/fps/render/rosa-anim';
import { ROSA_SHARED } from '../src/fps/render/rosa-materials';
import { arenaFaceRig } from '../src/fps/render/rosa-arena';
import type { AvatarState, RosaRig } from '../src/fps/render/rosa-rig';
import type { Quality } from '../src/fps/settings';

const QUALITIES: Quality[] = ['high', 'medium', 'low'];
const TEAMS = [0, 1] as const;

/** Body meshes (her own material: not the weapons or the roller instances), in traversal order: count / triangles / position checksum. */
function signature(r: RosaModel): string {
  let n = 0, tris = 0, sum = 0;
  r.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.material !== r.flashMats[0]) return;
    const g = m.geometry, p = g.attributes.position!;
    let s = 0;
    for (let i = 0; i < p.count; i++) s += p.getX(i) * 1.3 + p.getY(i) * 2.7 + p.getZ(i) * 3.1;
    n++; tris += (g.index ? g.index.count : p.count) / 3; sum += s * n;
  });
  return `${n}/${tris}/${sum.toFixed(2)}`;
}

/** Recorded at a0668c2, before the arena look was added. */
const BEFORE: Record<string, string> = {
  '0:high:0': '15/9266/-82257.32', '0:high:1': '21/9960/-118600.02', '1:high:0': '15/9208/-73108.12', '1:high:1': '21/9960/-118600.02',
  '0:medium:0': '15/6070/-36959.63', '0:medium:1': '21/7142/-55205.89', '1:medium:0': '15/6146/-30140.32', '1:medium:1': '21/7142/-55205.89',
  '0:low:0': '14/3466/-11364.97', '0:low:1': '20/4922/-17728.75', '1:low:0': '14/3812/-8120.21', '1:low:1': '20/4922/-17728.75',
};

describe('Rosa: the non-arena (campaign) construction is unchanged', () => {
  for (const q of QUALITIES) for (const team of TEAMS) for (const home of [false, true]) {
    it(`${q}, team ${team}${home ? ', home' : ''}: same meshes, triangles and vertices as before`, () => {
      expect(signature(buildRosaModel(team, { quality: q, home }))).toBe(BEFORE[`${team}:${q}:${home ? 1 : 0}`]);
      expect(signature(buildRosaModel(team, { quality: q, home, arena: false }))).toBe(BEFORE[`${team}:${q}:${home ? 1 : 0}`]);
    });
  }
});

// ------------------------------------------------------------ the arena look

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
    const g = m.geometry, n = (g.index ? g.index.count : g.attributes.position!.count) / 3;
    t += (m as THREE.InstancedMesh).isInstancedMesh ? n * (m as THREE.InstancedMesh).count : n;
    if (m.castShadow) casters++;
  });
  return { draws, casters, tris: t };
}

/** Draws as before the arena look (18 / 18 / 16); triangles a modest step up from about 10.4k / 7.3k / 4.2k. */
const ARENA_BUDGET: Record<Quality, { draws: number; casters: number; tris: number }> = {
  high: { draws: 18, casters: 14, tris: 13500 },
  medium: { draws: 18, casters: 10, tris: 9000 },
  low: { draws: 16, casters: 0, tris: 4800 },
};

const JOINTS = ['root', 'hips', 'torso', 'head', 'armL', 'armR', 'foreL', 'foreR', 'wristL', 'wristR', 'legL', 'legR', 'shinL', 'shinR', 'footL', 'footR'] as const;

describe('Rosa arena look', () => {
  it('is its own geometry, shared by every arena avatar of a look', () => {
    const a = buildRosaModel(0, { quality: 'high', arena: true }), b = buildRosaModel(0, { quality: 'high', arena: true });
    expect(signature(a)).not.toBe(BEFORE['0:high:0']);
    expect(a.hips.children[0]).not.toBe(b.hips.children[0]);
    expect((a.extras.skirt as THREE.Mesh).geometry).toBe((b.extras.skirt as THREE.Mesh).geometry);
    // home wins: the campaign look never takes the arena shapes.
    expect(signature(buildRosaModel(0, { quality: 'high', home: true, arena: true }))).toBe(BEFORE['0:high:1']);
  });
  for (const q of QUALITIES) for (const team of TEAMS) {
    it(`${q}, team ${team}: cost within budget, rig contract kept`, () => {
      const r = buildRosaModel(team, { quality: q, arena: true });
      for (const w of [0, 1] as const) {
        const c = cost(r, w);
        expect(c.draws).toBeLessThanOrEqual(ARENA_BUDGET[q].draws);
        expect(c.casters).toBeLessThanOrEqual(ARENA_BUDGET[q].casters);
        expect(c.tris).toBeLessThanOrEqual(ARENA_BUDGET[q].tris);
      }
      for (const j of JOINTS) expect(r[j]).toBeInstanceOf(THREE.Group);
      expect(r.extras.skirt?.parent).toBe(r.hips);
      for (const w of r.weapons) expect(w.parent).toBe(r.wristR);
      expect(r.rulPlace.length).toBe(4);
      expect(r.rulMesh?.parent).toBe(r.head);
      expect(r.face).toBeInstanceOf(THREE.Vector4);
    });
    it(`${q}, team ${team}: inside the gameplay bounds`, () => {
      const r = buildRosaModel(team, { quality: q, arena: true });
      r.root.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      let top = 0, bodyR = 0, headR = 0, low = Infinity;
      for (const j of JOINTS) for (const o of r[j].children) {
        const m = o as THREE.Mesh;
        if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || r.weapons.includes(m) || m === r.bubble) continue;
        const p = m.geometry.attributes.position!;
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
          low = Math.min(low, v.y);
          if (j === 'head') {
            top = Math.max(top, v.y);
            if ((team === 0 && ((Math.hypot(v.x, v.z) > 0.2 && v.y > 1.55) || v.y > 1.7)) || v.y < 1.4) continue;
            headR = Math.max(headR, Math.hypot(v.x, v.y - 1.52, v.z));
          } else {
            bodyR = Math.max(bodyR, Math.hypot(v.x, v.z));
            top = Math.max(top, v.y);
          }
        }
      }
      expect(bodyR).toBeLessThanOrEqual(0.36);
      expect(headR).toBeLessThanOrEqual(0.31);
      expect(low).toBeGreaterThan(-0.01);
      expect(low).toBeLessThan(0.02);
      expect(top).toBeLessThan(team === 0 ? 1.88 : 1.82);
      expect(top).toBeGreaterThan(1.7);
    });
  }
});

const DT = 1 / 60;
function state(over: Partial<AvatarState> = {}): AvatarState {
  return { speed: 0, strafe: 0, back: 0, onGround: true, crouched: false, alive: true, protected: false, pitch: 0, weapon: 0, msSinceThrow: 1e6, msSinceHit: 1e6, connected: true, msSinceMelee: 1e6, ...over };
}
function moveState(vx: number, vz: number, yaw: number, over: Partial<AvatarState> = {}): AvatarState {
  const speed = Math.hypot(vx, vz), sin = Math.sin(yaw), cos = Math.cos(yaw);
  const fwd = speed > 0.01 ? (-vx * sin - vz * cos) / speed : 0;
  const side = speed > 0.01 ? (vx * cos - vz * sin) / speed : 0;
  return state({ speed, strafe: side, back: -fwd, ...over });
}

describe('Rosa arena look: crouching inside the skirt (as rosa-anim.test.ts measures it)', () => {
  function kneeClearance(rig: RosaRig, anim: RosaAnimator, secs: number, at: (t: number) => { x: number; z: number; yaw?: number }): number {
    const skirt = rig.extras.skirt as THREE.Mesh;
    const pos = skirt.geometry.getAttribute('position');
    const k = new THREE.Vector3();
    let worst = -Infinity, prev = at(0);
    for (let i = 0; i <= Math.round(secs / DT); i++) {
      const t = i * DT, p = at(t), yaw = p.yaw ?? -Math.PI / 2;
      const vx = i === 0 ? 0 : (p.x - prev.x) / DT, vz = i === 0 ? 0 : (p.z - prev.z) / DT;
      prev = p;
      rig.root.position.set(p.x, 0, p.z); rig.root.rotation.y = yaw;
      anim.update(moveState(vx, vz, yaw, { crouched: true }), DT, false);
      rig.root.updateMatrixWorld(true);
      if (t < 0.6) continue;
      for (const shin of [rig.shinL, rig.shinR]) {
        skirt.worldToLocal(shin.getWorldPosition(k));
        const r = Math.hypot(k.x, k.z), a = Math.atan2(k.z, k.x);
        let R = 0;
        for (let v = 0; v < pos.count; v++) {
          if (Math.abs(pos.getY(v) - k.y) > 0.04) continue;
          const d = Math.abs(((Math.atan2(pos.getZ(v), pos.getX(v)) - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
          if (d < 0.35) R = Math.max(R, Math.hypot(pos.getX(v), pos.getZ(v)));
        }
        if (R > 0) worst = Math.max(worst, r - R);
      }
    }
    return worst;
  }
  for (const quality of QUALITIES) {
    it(`keeps the knees under the skirt crouched and crouch-walking (${quality})`, () => {
      const rig0 = buildRosaModel(0, { quality, arena: true });
      const still = kneeClearance(rig0, new RosaAnimator(rig0), 2, () => ({ x: 0, z: 0 }));
      const walks = [[0, -1], [1, 0], [0, 1], [-0.7, -0.7]].map(([dx, dz]) => {
        const rig = buildRosaModel(1, { quality, arena: true });
        return kneeClearance(rig, new RosaAnimator(rig), 3, (t) => ({ x: dx! * 3 * Math.max(0, t - 0.6), z: dz! * 3 * Math.max(0, t - 0.6), yaw: 0 }));
      });
      if (process.env.DBG) console.log(quality, still, walks);
      expect(still).toBeLessThan(-0.04);
      walks.forEach((w, i) => expect(w).toBeLessThan(i === 1 ? 0.035 : 0.02));
    });
  }
});

describe('Rosa arena look: the face through blinks and expressions', () => {
  const frames = new THREE.Color(ROSA_SHARED.frames);
  for (const q of QUALITIES) for (const team of TEAMS) {
    it(`${q}, team ${team}: brows stay above the frames fully knitted and lowered; eyes stay behind the lenses`, () => {
      const r = buildRosaModel(team, { quality: q, arena: true });
      const g = (r.head.children.find((o) => (o as THREE.Mesh).material === r.flashMats[0]) as THREE.Mesh).geometry;
      const p = g.attributes.position!, c = g.attributes.color!, ink = g.attributes.ink!;
      // The shader's brow move (rosa-materials.ts), at its extreme: lowered 2.5 mm, knitted 1.25 (effort and a wince at once).
      const fr = arenaFaceRig(1.12);
      const inner = (x: number) => Math.min(1, Math.max(0, 1 - (Math.abs(x) - fr.browIn) / (fr.browOut - fr.browIn)));
      const frame: THREE.Vector3[] = [], brows: THREE.Vector3[] = [], eyes: THREE.Vector3[] = [];
      const col = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
        const k = ink.getX(i);
        if (k < -1.5) brows.push(v);
        else if (k < -0.5) eyes.push(v);
        else if (k === 0 && Math.abs(col.setRGB(c.getX(i), c.getY(i), c.getZ(i)).r - frames.r) + Math.abs(col.g - frames.g) + Math.abs(col.b - frames.b) < 1e-3 && v.z < -0.1) frame.push(v);
      }
      expect(brows.length).toBeGreaterThan(0);
      expect(frame.length).toBeGreaterThan(0);
      let gap = Infinity;
      for (const b of brows) {
        const low = b.y - 0.0025 - 0.014 * 1.25 * inner(b.x);
        for (const f of frame) if (Math.abs(Math.abs(f.x) - Math.abs(b.x)) < 0.004 && Math.sign(f.x) === Math.sign(b.x)) gap = Math.min(gap, low - f.y);
      }
      expect(gap).toBeGreaterThan(0);
      // Eyes: behind the frames' plane and inside their outline (a blink only shrinks them toward the lid line).
      const fz = Math.min(...frame.map((f) => f.z)), fxMax = Math.max(...frame.map((f) => Math.abs(f.x)));
      const fy0 = Math.min(...frame.map((f) => f.y)), fy1 = Math.max(...frame.map((f) => f.y));
      for (const e of eyes) {
        expect(e.z).toBeGreaterThan(fz);
        expect(Math.abs(e.x)).toBeLessThan(fxMax);
        expect(e.y).toBeGreaterThan(fy0);
        expect(e.y).toBeLessThan(fy1);
      }
    });
  }
});
