// The chancla Rosa holds in first person: a flip-flop with a two-layer sole
// that tapers from heel to toe, a toe post, a V strap with a cream stripe
// and her marigold flower on the post. Same colours as the thrown chancla,
// shaped for close-up viewing. Shooter only: the Arcade game, the statue and
// the projectiles keep src/models/sandal.ts.
//
// Local frame (metres, already at view-model scale): toe at -Z, heel at +Z,
// footbed facing +Y, the sole's underside at y = 0.
import * as THREE from 'three';
import { PALETTE } from '../../world/palette';
import { buildPesada } from './rosa';
import { merge, painted, sweep, trs } from './fp-geo';

export const CHANCLA = {
  length: 0.25,
  heelThick: 0.03,
  toeThick: 0.019,
  /** Where the hand holds it, and the sole's cross-section there. */
  gripZ: 0.072,
};

const SOLE = PALETTE.violet;
const SOLE_UNDER = PALETTE.violetDeep;
const FOOTBED = PALETTE.turquoise;
const STRAP = PALETTE.terracotta;
const STRIPE = PALETTE.cream;

// Right-foot outline, toe at +v (becomes -Z), heel at -v. Units of length.
const OUTLINE: Array<[number, number]> = [
  [0.0, -0.5], [0.12, -0.47], [0.17, -0.36], [0.18, -0.18], [0.18, 0.0],
  [0.22, 0.17], [0.25, 0.32], [0.23, 0.45], [0.13, 0.53], [0.0, 0.55],
  [-0.12, 0.52], [-0.2, 0.42], [-0.22, 0.26], [-0.18, 0.08], [-0.155, -0.15],
  [-0.165, -0.33], [-0.11, -0.46],
];

function outlineShape(L: number): THREE.Shape {
  const s = new THREE.Shape();
  const P = OUTLINE;
  s.moveTo(((P[0]![0] + P[P.length - 1]![0]) / 2) * L, ((P[0]![1] + P[P.length - 1]![1]) / 2) * L);
  for (let i = 0; i < P.length; i++) {
    const p = P[i]!, q = P[(i + 1) % P.length]!;
    s.quadraticCurveTo(p[0] * L, p[1] * L, ((p[0] + q[0]) / 2) * L, ((p[1] + q[1]) / 2) * L);
  }
  return s;
}

/** Half-widths of the sole (left edge x, right edge x) at a given z, from the outline. */
export function soleEdges(z: number): [number, number] {
  const pts = outlineShape(CHANCLA.length).getSpacedPoints(160);
  let xl = 0, xr = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    const za = -a.y, zb = -b.y;
    if ((za - z) * (zb - z) <= 0 && za !== zb) {
      const x = a.x + ((z - za) / (zb - za)) * (b.x - a.x);
      xl = Math.min(xl, x); xr = Math.max(xr, x);
    }
  }
  return [xl, xr];
}

/** Sole thickness at z (thicker heel, thinner toe) and the toe spring lift. */
export function soleTop(z: number): number {
  const L = CHANCLA.length;
  const k = THREE.MathUtils.clamp((z / L) + 0.5, 0, 1); // 0 at toe, 1 at heel
  return CHANCLA.toeThick + (CHANCLA.heelThick - CHANCLA.toeThick) * THREE.MathUtils.smoothstep(k, 0.1, 0.9) + toeSpring(z);
}
function toeSpring(z: number): number {
  const t = Math.max(0, -z - 0.05);
  return t * t * 0.55;
}

let cache: { body: THREE.BufferGeometry; flower: THREE.BufferGeometry } | null = null;

export function fpChanclaGeometry(): { body: THREE.BufferGeometry; flower: THREE.BufferGeometry } {
  if (cache) return cache;
  const L = CHANCLA.length;
  // Sole: two stacked extrusions (violet sole, turquoise footbed layer),
  // reshaped so the thickness follows soleTop(z) and the toe curls up.
  const bevel = 0.004;
  const layer = (scale: number, from: number, to: number, side: number, top: number, under: number) => {
    const ex = new THREE.ExtrudeGeometry(outlineShape(L * scale), { depth: 1, bevelEnabled: true, bevelThickness: bevel * 0.6, bevelSize: bevel, bevelSegments: 1, curveSegments: 3 });
    ex.rotateX(-Math.PI / 2); // shape v -> -z, depth -> +y
    const p = ex.attributes.position!;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i), y = p.getY(i);
      const th = soleTop(z) - toeSpring(z);
      const y0 = th * from, y1 = th * to;
      const ny = y > 0.5 ? y1 + (y - 1) : y0 + y;
      p.setY(i, ny + toeSpring(z) + bevel * 0.6);
    }
    ex.deleteAttribute('normal'); ex.deleteAttribute('uv');
    const g = ex.toNonIndexed(); ex.dispose();
    g.computeVertexNormals();
    const gp = g.attributes.normal!;
    const col = new Float32Array(gp.count * 3);
    const cs = [new THREE.Color(side), new THREE.Color(top), new THREE.Color(under)];
    for (let f = 0; f < gp.count; f += 3) {
      const ny = (gp.getY(f) + gp.getY(f + 1) + gp.getY(f + 2)) / 3;
      const c = cs[ny > 0.6 ? 1 : ny < -0.6 ? 2 : 0]!;
      for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (f + k) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  const sole = merge([layer(1, 0, 0.62, SOLE, SOLE, SOLE_UNDER), layer(0.965, 0.62, 1, FOOTBED, FOOTBED, FOOTBED)]);

  // Toe post between the first and second toe, then a V strap from its top
  // down to both sides of the sole just ahead of the arch.
  const postZ = -0.085, postX = 0.018;
  const baseY = soleTop(postZ) + bevel * 2;
  const postTop = new THREE.Vector3(postX, baseY + 0.026, postZ);
  const post = painted(new THREE.CylinderGeometry(0.0055, 0.007, 0.03, 7), STRAP, trs(postX, baseY + 0.012, postZ));
  const strapZ = 0.0;
  const [xl, xr] = soleEdges(strapZ);
  const band: Array<[number, number]> = [[-0.0105, 0], [-0.0035, 0.0035], [0.0035, 0.0035], [0.0105, 0], [0.0105, -0.003], [-0.0105, -0.003]];
  // Edges: outer-left, stripe, outer-right, side, underside, side.
  const bandCol = [STRAP, STRIPE, STRAP, STRAP, STRAP, STRAP];
  const straps: THREE.BufferGeometry[] = [];
  for (const x of [xl + 0.004, xr - 0.004]) {
    const end = new THREE.Vector3(x, soleTop(strapZ) + bevel * 1.5, strapZ);
    const mid = postTop.clone().lerp(end, 0.5);
    mid.y += 0.024; mid.x += (x - postX) * 0.15;
    const curve = new THREE.QuadraticBezierCurve3(postTop.clone().add(new THREE.Vector3(0, 0.002, 0)), mid, end);
    // Up for the band: roughly away from the foot's centre line, so the band
    // lies flat over the instep.
    const up = new THREE.Vector3(Math.sign(x - postX) * 0.2, 1, 0).normalize();
    straps.push(sweep(curve, up, band, bandCol, 10));
  }
  const body = merge([sole, post, ...straps]);

  // Flower on top of the post: five petals and a centre, a little oversized.
  const petals: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const g = new THREE.SphereGeometry(0.011, 6, 4);
    petals.push(painted(g, PALETTE.marigold, new THREE.Matrix4().makeRotationY(-a).premultiply(trs(Math.sin(a) * 0.011, 0, Math.cos(a) * 0.011)).multiply(new THREE.Matrix4().makeScale(1, 0.42, 1.55))));
    g.dispose();
  }
  const centre = new THREE.SphereGeometry(0.0065, 6, 4);
  petals.push(painted(centre, PALETTE.marigoldDeep, trs(0, 0.004, 0)));
  centre.dispose();
  const flower = merge(petals);
  flower.applyMatrix4(trs(postTop.x, postTop.y + 0.004, postTop.z, -0.25, 0, 0.15));
  cache = { body, flower };
  return cache;
}

/** Sole edges and thickness where the hand grips the chancla. */
export function chanclaGrip(): { z: number; xl: number; xr: number; yb: number; yt: number } {
  const z = CHANCLA.gripZ;
  const [xl, xr] = soleEdges(z);
  return { z, xl, xr, yb: 0, yt: soleTop(z) + 0.008 };
}

// La Pesada for first person: the shared clog geometry baked into one
// vertex-coloured mesh (brass studs brightened since they lose their glow).
export const PESADA_SCALE = 0.72;
let pesadaCache: THREE.BufferGeometry | null = null;
export function fpPesadaGeometry(): THREE.BufferGeometry {
  if (pesadaCache) return pesadaCache;
  const src = buildPesada();
  src.scale.setScalar(PESADA_SCALE);
  src.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.MeshToonMaterial;
    const c = mat.color.clone();
    if (mat.emissive && mat.emissive.getHex() !== 0) c.add(mat.emissive).multiplyScalar(1.05);
    parts.push(painted(m.geometry, c.getHex(), m.matrixWorld));
  });
  pesadaCache = merge(parts);
  return pesadaCache;
}

/** The clog's heel cross-section where the hand holds it (from its geometry, in the local frame above). */
export function pesadaGrip(): { z: number; xl: number; xr: number; yb: number; yt: number } {
  const s = PESADA_SCALE;
  return { z: 0.115 * s, xl: -0.1 * s, xr: 0.1 * s, yb: -0.06 * s, yt: 0.072 * s };
}
