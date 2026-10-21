import * as THREE from 'three';
import { GEO, PALETTE, lambert, basic, mesh } from '../world/palette';

// Low-poly rigs built from shared unit primitives. Each rig exposes pivots
// that the enemy animation code rotates procedurally.
export interface Rig {
  root: THREE.Group;
  body: THREE.Group; // tumble pivot at the hips
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  prop: THREE.Group; // archetype prop (speaker, phone, blower nozzle)
  stars: THREE.Group; // dizzy stars, hidden until a pratfall
  flash: THREE.Mesh | null; // influencer phone flash / attack glow
  mouth: THREE.Mesh;
  scale: number;
}

interface Look {
  skin: number;
  shirt: number;
  pants: number;
  shoes: number;
  hair: number;
  width?: number;
  belly?: number;
  scale?: number;
}

function pivot(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

function limb(parent: THREE.Group, color: number, w: number, len: number, d: number, endColor?: number, endLen = 0.1): void {
  parent.add(mesh(GEO.box, lambert(color), w, len, d, 0, -len / 2, 0));
  if (endColor !== undefined) parent.add(mesh(GEO.box, lambert(endColor), w * 1.05, endLen, d * 1.3, 0, -len - endLen / 2 + 0.02, d * 0.15));
}

function baseRig(look: Look): Rig {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0.95, 0);
  const w = look.width ?? 0.46;
  const belly = look.belly ?? 0;
  const legL = pivot(body, -0.12, 0, 0);
  const legR = pivot(body, 0.12, 0, 0);
  limb(legL, look.pants, 0.16, 0.86, 0.17, look.shoes, 0.12);
  limb(legR, look.pants, 0.16, 0.86, 0.17, look.shoes, 0.12);
  const torso = pivot(body, 0, 0, 0);
  torso.add(mesh(GEO.box, lambert(look.shirt), w, 0.66, 0.28 + belly, 0, 0.36, belly * 0.4));
  torso.add(mesh(GEO.box, lambert(look.pants), w * 0.98, 0.14, 0.27 + belly * 0.8, 0, 0.04, belly * 0.3));
  const head = pivot(torso, 0, 0.72, 0);
  head.add(mesh(GEO.box, lambert(look.skin), 0.3, 0.32, 0.3, 0, 0.17, 0));
  head.add(mesh(GEO.box, lambert(look.hair), 0.32, 0.1, 0.32, 0, 0.35, 0.01));
  head.add(mesh(GEO.box, lambert(look.skin), 0.12, 0.08, 0.1, 0, -0.01, 0));
  const eye = lambert(PALETTE.ink);
  head.add(mesh(GEO.box, eye, 0.05, 0.05, 0.02, -0.07, 0.2, -0.155));
  head.add(mesh(GEO.box, eye, 0.05, 0.05, 0.02, 0.07, 0.2, -0.155));
  head.add(mesh(GEO.box, eye, 0.08, 0.02, 0.02, -0.07, 0.26, -0.155));
  head.add(mesh(GEO.box, eye, 0.08, 0.02, 0.02, 0.07, 0.26, -0.155));
  const mouth = mesh(GEO.box, lambert(0x7a1f2b), 0.12, 0.04, 0.02, 0, 0.08, -0.155);
  head.add(mouth);
  const armL = pivot(torso, -w / 2 - 0.07, 0.64, 0);
  const armR = pivot(torso, w / 2 + 0.07, 0.64, 0);
  limb(armL, look.shirt, 0.13, 0.6, 0.13, look.skin, 0.12);
  limb(armR, look.shirt, 0.13, 0.6, 0.13, look.skin, 0.12);
  const prop = pivot(armR, 0, -0.66, 0);
  const stars = pivot(head, 0, 0.55, 0);
  const starMat = basic(PALETTE.gold);
  for (let i = 0; i < 4; i++) {
    const s = mesh(GEO.sphereLo, starMat, 0.11, 0.11, 0.11);
    const a = (i / 4) * Math.PI * 2;
    s.position.set(Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32);
    stars.add(s);
  }
  stars.visible = false;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  const scale = look.scale ?? 1;
  root.scale.setScalar(scale);
  // Facing: rigs are built looking down -Z.
  return { root, body, torso, head, armL, armR, legL, legR, prop, stars, flash: null, mouth, scale };
}

export function buildBocinas(): Rig {
  const r = baseRig({ skin: PALETTE.skin2, shirt: PALETTE.marigoldDeep, pants: 0x2f3a56, shoes: PALETTE.white, hair: PALETTE.ink, width: 0.5 });
  // Backwards cap.
  r.head.add(mesh(GEO.box, lambert(PALETTE.turquoise), 0.34, 0.08, 0.34, 0, 0.38, 0));
  r.head.add(mesh(GEO.box, lambert(PALETTE.turquoise), 0.24, 0.03, 0.14, 0, 0.36, 0.22));
  // Gold chain.
  const chain = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.02, 4, 12), lambert(PALETTE.gold, { emissive: 0x3a2800 }));
  chain.position.set(0, 0.55, -0.12);
  chain.rotation.x = 1.2;
  r.torso.add(chain);
  // Giant loudspeaker carried in the right hand, cone facing forward.
  const spk = new THREE.Group();
  spk.add(mesh(GEO.box, lambert(PALETTE.ink), 0.42, 0.55, 0.36, 0, 0.1, -0.05));
  const coneMat = lambert(0x3d3d48);
  const ringMat = lambert(PALETTE.pink, { emissive: 0x330011 });
  for (const y of [0.24, -0.04]) {
    const c = mesh(GEO.cyl, coneMat, 0.26, 0.04, 0.26, 0, 0.1 + y - 0.1, -0.24);
    c.rotation.x = Math.PI / 2;
    spk.add(c);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.018, 4, 14), ringMat);
    ring.position.set(0, 0.1 + y - 0.1, -0.245);
    spk.add(ring);
  }
  spk.add(mesh(GEO.box, lambert(PALETTE.grey), 0.3, 0.04, 0.04, 0, 0.42, -0.05));
  spk.position.set(0, 0, -0.12);
  r.prop.add(spk);
  return r;
}

export function buildInfluencer(): Rig {
  const r = baseRig({ skin: PALETTE.skin3, shirt: PALETTE.pink, pants: PALETTE.cream, shoes: PALETTE.ink, hair: 0x6b3b1d, width: 0.42 });
  // Quiff and sunglasses.
  r.head.add(mesh(GEO.box, lambert(0x6b3b1d), 0.26, 0.12, 0.2, 0, 0.42, -0.06));
  r.head.add(mesh(GEO.box, lambert(PALETTE.ink), 0.32, 0.07, 0.03, 0, 0.21, -0.16));
  r.head.add(mesh(GEO.box, lambert(PALETTE.turquoise), 0.1, 0.05, 0.01, -0.07, 0.21, -0.18));
  r.head.add(mesh(GEO.box, lambert(PALETTE.turquoise), 0.1, 0.05, 0.01, 0.07, 0.21, -0.18));
  // Blazer lapels.
  r.torso.add(mesh(GEO.box, lambert(PALETTE.white), 0.14, 0.4, 0.02, 0, 0.45, -0.145));
  // Selfie stick with phone.
  const stick = new THREE.Group();
  stick.add(mesh(GEO.cyl, lambert(PALETTE.grey), 0.025, 0.7, 0.025, 0, -0.35, 0));
  stick.add(mesh(GEO.box, lambert(PALETTE.ink), 0.09, 0.17, 0.02, 0, -0.75, 0));
  const flash = mesh(GEO.sphere, basic(0xffffff, { transparent: true, opacity: 0.9, additive: true }), 0.16, 0.16, 0.16, 0, -0.72, 0.04);
  flash.visible = false;
  stick.add(flash);
  r.flash = flash;
  r.prop.add(stick);
  return r;
}

export function buildSoplador(): Rig {
  const r = baseRig({ skin: PALETTE.skin1, shirt: PALETTE.turquoiseFaded, pants: 0x5a4a3a, shoes: 0x3a2a1a, hair: 0x3a2a1a, width: 0.52, belly: 0.12 });
  // Safety vest stripes.
  r.torso.add(mesh(GEO.box, lambert(0xff7a1a), 0.54, 0.36, 0.42, 0, 0.4, 0.04));
  r.torso.add(mesh(GEO.box, lambert(0xfff3a0, { emissive: 0x333300 }), 0.55, 0.05, 0.43, 0, 0.36, 0.04));
  // Ear muffs and cap.
  r.head.add(mesh(GEO.box, lambert(0xff7a1a), 0.38, 0.12, 0.1, 0, 0.18, 0));
  r.head.add(mesh(GEO.box, lambert(PALETTE.terracotta), 0.33, 0.08, 0.33, 0, 0.38, 0));
  r.head.add(mesh(GEO.box, lambert(PALETTE.terracotta), 0.26, 0.03, 0.16, 0, 0.35, -0.22));
  // Backpack blower.
  r.torso.add(mesh(GEO.box, lambert(PALETTE.marigold), 0.4, 0.5, 0.25, 0, 0.4, 0.3));
  r.torso.add(mesh(GEO.cyl, lambert(PALETTE.ink), 0.22, 0.12, 0.22, 0, 0.5, 0.45));
  // Nozzle held forward.
  const tube = mesh(GEO.cyl, lambert(PALETTE.grey), 0.09, 0.8, 0.09, 0, -0.1, -0.35);
  tube.rotation.x = Math.PI / 2;
  r.prop.add(tube);
  r.prop.add(mesh(GEO.cyl, lambert(PALETTE.marigoldDeep), 0.13, 0.12, 0.13, 0, -0.1, -0.78).rotateX(Math.PI / 2));
  return r;
}

export function buildBoss(): Rig {
  const r = baseRig({ skin: PALETTE.skin2, shirt: PALETTE.violet, pants: PALETTE.violetDeep, shoes: PALETTE.white, hair: PALETTE.ink, width: 0.56, belly: 0.16, scale: 1.85 });
  const gold = lambert(PALETTE.gold, { emissive: 0x4a3000 });
  // Tracksuit stripes.
  r.torso.add(mesh(GEO.box, gold, 0.03, 0.66, 0.46, -0.27, 0.36, 0.06));
  r.torso.add(mesh(GEO.box, gold, 0.03, 0.66, 0.46, 0.27, 0.36, 0.06));
  // Crown.
  r.head.add(mesh(GEO.box, gold, 0.3, 0.08, 0.3, 0, 0.44, 0));
  for (let i = 0; i < 4; i++) {
    const s = mesh(GEO.cone, gold, 0.08, 0.14, 0.08, -0.11 + i * 0.075, 0.54, -0.14);
    r.head.add(s);
  }
  // Headphones.
  r.head.add(mesh(GEO.box, lambert(PALETTE.ink), 0.36, 0.05, 0.08, 0, 0.36, 0));
  r.head.add(mesh(GEO.box, lambert(PALETTE.pink), 0.07, 0.16, 0.16, -0.18, 0.2, 0));
  r.head.add(mesh(GEO.box, lambert(PALETTE.pink), 0.07, 0.16, 0.16, 0.18, 0.2, 0));
  // Sunglasses and beard.
  r.head.add(mesh(GEO.box, lambert(PALETTE.ink), 0.32, 0.07, 0.03, 0, 0.21, -0.16));
  r.head.add(mesh(GEO.box, lambert(PALETTE.ink), 0.3, 0.1, 0.05, 0, 0.03, -0.14));
  const chain = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 4, 14), gold);
  chain.position.set(0, 0.5, -0.18);
  chain.rotation.x = 1.25;
  r.torso.add(chain);
  // Microphone in the right hand.
  r.prop.add(mesh(GEO.cyl, lambert(PALETTE.ink), 0.04, 0.2, 0.04, 0, -0.05, -0.05));
  r.prop.add(mesh(GEO.sphere, lambert(PALETTE.grey), 0.09, 0.09, 0.09, 0, 0.07, -0.05));
  return r;
}

// Tutorial target: a cardboard cut-out of a noisy neighbour on a stand.
export function buildDummy(): THREE.Group {
  const g = new THREE.Group();
  const card = lambert(0xc9a26b);
  g.add(mesh(GEO.box, card, 0.7, 1.2, 0.04, 0, 0.95, 0));
  g.add(mesh(GEO.box, card, 0.38, 0.38, 0.04, 0, 1.75, 0));
  g.add(mesh(GEO.box, lambert(PALETTE.marigoldDeep), 0.62, 0.55, 0.05, 0, 1.15, -0.01));
  g.add(mesh(GEO.box, lambert(PALETTE.ink), 0.28, 0.36, 0.05, 0.12, 1.05, -0.02));
  g.add(mesh(GEO.box, lambert(PALETTE.ink), 0.06, 0.06, 0.05, -0.08, 1.8, -0.02));
  g.add(mesh(GEO.box, lambert(PALETTE.ink), 0.06, 0.06, 0.05, 0.08, 1.8, -0.02));
  g.add(mesh(GEO.box, lambert(0x7a1f2b), 0.18, 0.08, 0.05, 0, 1.66, -0.02));
  g.add(mesh(GEO.box, lambert(PALETTE.wood), 0.08, 0.6, 0.08, 0, 0.3, 0.06));
  g.add(mesh(GEO.box, lambert(PALETTE.wood), 0.6, 0.06, 0.4, 0, 0.03, 0.06));
  // Bullseye ring.
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.2, 16), basic(PALETTE.terracotta, { side: THREE.DoubleSide }));
  ring.position.set(-0.12, 1.2, -0.04);
  g.add(ring);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return g;
}

export function buildCafecito(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(GEO.cyl, lambert(PALETTE.cream), 0.22, 0.24, 0.22, 0, 0.12, 0));
  g.add(mesh(GEO.cyl, lambert(PALETTE.terracotta), 0.23, 0.06, 0.23, 0, 0.14, 0));
  g.add(mesh(GEO.cyl, lambert(0x5b3a22), 0.18, 0.02, 0.18, 0, 0.245, 0));
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.018, 4, 10), lambert(PALETTE.cream));
  handle.position.set(0.13, 0.13, 0);
  g.add(handle);
  g.add(mesh(GEO.cyl, lambert(PALETTE.cream), 0.36, 0.03, 0.36, 0, 0.0, 0));
  // Heart marker floating above so it reads as health from afar.
  const heart = buildHeartMesh(0xff4d6d, 0.18);
  heart.position.set(0, 0.6, 0);
  heart.name = 'heart';
  g.add(heart);
  return g;
}

let heartGeo: THREE.ExtrudeGeometry | null = null;
export function heartGeometry(): THREE.ExtrudeGeometry {
  if (heartGeo) return heartGeo;
  const s = new THREE.Shape();
  s.moveTo(0, -0.5);
  s.bezierCurveTo(0.1, -0.35, 0.5, -0.15, 0.5, 0.15);
  s.bezierCurveTo(0.5, 0.45, 0.15, 0.55, 0, 0.3);
  s.bezierCurveTo(-0.15, 0.55, -0.5, 0.45, -0.5, 0.15);
  s.bezierCurveTo(-0.5, -0.15, -0.1, -0.35, 0, -0.5);
  heartGeo = new THREE.ExtrudeGeometry(s, { depth: 0.25, bevelEnabled: false, curveSegments: 5 });
  heartGeo.translate(0, 0, -0.125);
  return heartGeo;
}

export function buildHeartMesh(color: number, size: number): THREE.Mesh {
  const m = new THREE.Mesh(heartGeometry(), lambert(color, { emissive: 0x330010 }));
  m.scale.setScalar(size);
  return m;
}
