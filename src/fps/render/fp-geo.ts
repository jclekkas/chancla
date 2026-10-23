// Small geometry helpers for the first-person view model: vertex-coloured
// parts merged into one mesh per material, swept bands for straps, and an
// inverted-hull ink outline that matches the toon look of the world.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonRamp } from './materials';

/** Non-indexed copy with only position, normal and a flat colour. */
export function painted(g: THREE.BufferGeometry, color: number, m?: THREE.Matrix4): THREE.BufferGeometry {
  let out = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal') out.deleteAttribute(k);
  if (!out.attributes.normal) out.computeVertexNormals();
  if (m) out.applyMatrix4(m);
  const c = new THREE.Color(color);
  const n = out.attributes.position!.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.morphAttributes = {};
  return out;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  g.computeBoundingSphere();
  return g;
}

/** Matrix from position, Euler rotation and scale. */
export function trs(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
}

/** A capsule from a to b with radii ra (at a) and rb (at b). */
export function segment(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, radial = 6): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  // Tapered body plus two hemispheres.
  const body = new THREE.CylinderGeometry(rb, ra, len, radial, 1, true);
  const capA = new THREE.SphereGeometry(ra, radial, 2, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  capA.translate(0, -len / 2, 0);
  const capB = new THREE.SphereGeometry(rb, radial, 2, 0, Math.PI * 2, 0, Math.PI / 2);
  capB.translate(0, len / 2, 0);
  const g = mergeGeometries([body.toNonIndexed(), capA.toNonIndexed(), capB.toNonIndexed()])!;
  body.dispose(); capA.dispose(); capB.dispose();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/**
 * Sweeps a closed cross-section along a curve. `section` is a list of 2D
 * points (x across the band, y its thickness, around `up`), `colors` gives one
 * colour per section edge so a band can carry a stripe without another mesh.
 */
export function sweep(curve: THREE.Curve<THREE.Vector3>, up: THREE.Vector3, section: Array<[number, number]>, colors: number[], steps = 12): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [];
  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = curve.getPoint(t);
    const tan = curve.getTangent(t).normalize();
    const side = new THREE.Vector3().crossVectors(tan, up).normalize();
    const nrm = new THREE.Vector3().crossVectors(side, tan).normalize();
    rings.push(section.map(([sx, sy]) => p.clone().addScaledVector(side, sx).addScaledVector(nrm, sy)));
  }
  const cs = colors.map((c) => new THREE.Color(c));
  const n = section.length;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < n; j++) {
      const a = rings[i]![j]!, b = rings[i]![(j + 1) % n]!, c = rings[i + 1]![(j + 1) % n]!, d = rings[i + 1]![j]!;
      for (const v of [a, b, c, a, c, d]) pos.push(v.x, v.y, v.z);
      const cc = cs[j % cs.length]!;
      for (let k = 0; k < 6; k++) col.push(cc.r, cc.g, cc.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // Winding depends on the section direction: make normals point outwards
  // from the curve so lighting and the outline hull agree.
  const p = g.attributes.position!, nn = g.attributes.normal!;
  let dot = 0;
  const ring0 = rings[Math.floor(steps / 2)]!; const mid = ring0.reduce((s, v) => s.add(v), new THREE.Vector3()).multiplyScalar(1 / n);
  for (let i = 0; i < p.count; i += 7) dot += (p.getX(i) - mid.x) * nn.getX(i) + (p.getY(i) - mid.y) * nn.getY(i) + (p.getZ(i) - mid.z) * nn.getZ(i);
  if (dot < 0) flipWinding(g);
  return g;
}

function flipWinding(g: THREE.BufferGeometry): void {
  for (const name of ['position', 'color'] as const) {
    const a = g.attributes[name] as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i += 3) {
      for (let k = 0; k < a.itemSize; k++) { const t = a.array[(i + 1) * a.itemSize + k]!; (a.array as Float32Array)[(i + 1) * a.itemSize + k] = a.array[(i + 2) * a.itemSize + k]!; (a.array as Float32Array)[(i + 2) * a.itemSize + k] = t; }
    }
  }
  g.computeVertexNormals();
}

/** Inverted hull: the surface pushed out along smoothed normals, drawn back faces only in ink. */
export function inkHull(g: THREE.BufferGeometry, width: number): THREE.BufferGeometry {
  const src = new THREE.BufferGeometry();
  src.setAttribute('position', g.attributes.position!.clone());
  const welded = mergeVertices(src, 1e-4);
  src.dispose();
  welded.computeVertexNormals();
  const p = welded.attributes.position!, n = welded.attributes.normal!;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * width, p.getY(i) + n.getY(i) * width, p.getZ(i) + n.getZ(i) * width);
  welded.deleteAttribute('normal');
  welded.computeBoundingSphere();
  return welded;
}

export const INK = new THREE.MeshBasicMaterial({ color: 0x241626, side: THREE.BackSide });
// The hand is built from overlapping parts (fingers, thumb, palm) merged into
// one mesh, so the hull also bulges out of the creases where parts meet and
// showed as black specks and slivers across knuckles, thumb and nails. Pushing
// the hull 4 mm away from the camera (view space; the hull is 2-3 mm wide)
// hides it wherever the hand's own surface is just in front of it and keeps it
// where only the background is behind: the silhouette.
INK.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n\tmvPosition.z -= 0.004;\n\tgl_Position = projectionMatrix * mvPosition;');
};

/** Toon material that takes its colour from the vertices. */
export function vertexToon(opts: { emissive?: number; color?: number } = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color: opts.color ?? 0xffffff, vertexColors: true, gradientMap: toonRamp(), emissive: opts.emissive ?? 0 });
}
