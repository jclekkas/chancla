import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, lambert } from '../world/palette';

// The star of the show: a chunky slide chancla with a shaped sole, tread,
// a wide strap with a stripe, and a marigold flower. Geometry is built once
// and shared by every chancla in the game.

interface SandalGeometry {
  sole: THREE.BufferGeometry;
  footbed: THREE.BufferGeometry;
  tread: THREE.BufferGeometry;
  strap: THREE.BufferGeometry;
  stripe: THREE.BufferGeometry;
  flower: THREE.BufferGeometry;
  flowerCenter: THREE.BufferGeometry;
}

let geo: SandalGeometry | null = null;

function soleShape(scale: number): THREE.Shape {
  // Footprint outline in the XY plane: toe at +Y, heel at -Y.
  const s = new THREE.Shape();
  const pts: Array<[number, number]> = [
    [0.0, -0.5], [0.16, -0.47], [0.27, -0.36], [0.3, -0.18], [0.27, 0.02],
    [0.3, 0.2], [0.36, 0.36], [0.33, 0.47], [0.2, 0.55], [0.0, 0.57],
    [-0.18, 0.54], [-0.3, 0.44], [-0.32, 0.27], [-0.25, 0.08], [-0.24, -0.15],
    [-0.27, -0.33], [-0.18, -0.46],
  ];
  s.moveTo(pts[0]![0] * scale, pts[0]![1] * scale);
  for (let i = 1; i <= pts.length; i++) {
    const p = pts[i % pts.length]!;
    const prev = pts[(i - 1) % pts.length]!;
    const mx = ((prev[0] + p[0]) / 2) * scale;
    const my = ((prev[1] + p[1]) / 2) * scale;
    s.quadraticCurveTo(prev[0] * scale, prev[1] * scale, mx, my);
  }
  s.closePath();
  return s;
}

function build(): SandalGeometry {
  const L = 0.3; // overall length in metres before display scaling
  const sole = new THREE.ExtrudeGeometry(soleShape(L), {
    depth: 0.028, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1, curveSegments: 4,
  });
  sole.rotateX(-Math.PI / 2); // lie flat: shape Y -> -Z (toe forward = -Z)
  const footbed = new THREE.ExtrudeGeometry(soleShape(L * 0.93), {
    depth: 0.012, bevelEnabled: false, curveSegments: 4,
  });
  footbed.rotateX(-Math.PI / 2);
  footbed.translate(0, 0.034, 0);

  // Tread: rows of grooves underneath.
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const z = -0.14 + i * 0.034;
    const width = 0.1 + Math.sin((i / 8) * Math.PI) * 0.05;
    const g = new THREE.BoxGeometry(width, 0.008, 0.012);
    g.translate(0, -0.006, z);
    parts.push(g);
  }
  const tread = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());

  // Strap: half tube arching over the forefoot, axis along the foot.
  const strap = new THREE.CylinderGeometry(0.075, 0.075, 0.085, 14, 1, true, -Math.PI / 2, Math.PI);
  strap.rotateX(-Math.PI / 2);
  strap.scale(1.25, 0.75, 1);
  strap.translate(0, 0.04, -0.05);
  const stripe = new THREE.CylinderGeometry(0.0765, 0.0765, 0.024, 14, 1, true, -Math.PI / 2, Math.PI);
  stripe.rotateX(-Math.PI / 2);
  stripe.scale(1.25, 0.75, 1);
  stripe.translate(0, 0.04, -0.05);

  // Flower: five petals on top of the strap.
  const petals: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const p = new THREE.SphereGeometry(0.018, 6, 4);
    p.scale(1, 0.45, 1.5);
    const a = (i / 5) * Math.PI * 2;
    p.rotateY(-a);
    p.translate(Math.sin(a) * 0.018, 0, Math.cos(a) * 0.018);
    petals.push(p);
  }
  const flower = mergeGeometries(petals)!;
  petals.forEach((p) => p.dispose());
  flower.translate(0.03, 0.098, -0.05);
  const flowerCenter = new THREE.SphereGeometry(0.011, 6, 4);
  flowerCenter.translate(0.03, 0.104, -0.05);

  return { sole, footbed, tread, strap, stripe, flower, flowerCenter };
}

export interface SandalSkin {
  sole: number;
  footbed: number;
  strap: number;
  stripe: number;
  flower: number;
}

export const ROSA_SKIN: SandalSkin = {
  sole: PALETTE.violet,
  footbed: PALETTE.turquoise,
  strap: PALETTE.terracotta,
  stripe: PALETTE.cream,
  flower: PALETTE.marigold,
};

export const GOLD_SKIN: SandalSkin = {
  sole: 0xb8860b,
  footbed: 0xffd76a,
  strap: 0xf5c542,
  stripe: 0xfff3c4,
  flower: 0xffffff,
};

const goldEmissive = 0x7a5200;

export function buildSandal(skin: SandalSkin = ROSA_SKIN, golden = false): THREE.Group {
  if (!geo) geo = build();
  const g = new THREE.Group();
  const em = golden ? goldEmissive : 0;
  const parts: Array<[THREE.BufferGeometry, number]> = [
    [geo.sole, skin.sole],
    [geo.footbed, skin.footbed],
    [geo.tread, PALETTE.ink],
    [geo.strap, skin.strap],
    [geo.stripe, skin.stripe],
    [geo.flower, skin.flower],
    [geo.flowerCenter, PALETTE.marigoldDeep],
  ];
  for (const [gg, color] of parts) {
    const m = new THREE.Mesh(gg, lambert(color, { emissive: em, side: THREE.DoubleSide }));
    m.castShadow = true;
    g.add(m);
  }
  return g;
}
