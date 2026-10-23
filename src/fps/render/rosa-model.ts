// Doña Rosa's model for the shooter: geometry and materials only, built
// around the joints in rosa-rig.ts (rosa-anim.ts poses them). Team Sol
// wears a wide straw sun hat and a marigold dress with a sun on the back;
// Team Luna wears a turquoise rebozo over her head and a crescent moon on
// the back. Ink outlines separate players from the scenery.
import * as THREE from 'three';
import type { Team } from '../../../shared/map';
import type { Quality } from '../settings';
import { COLORS, OUTLINE, toon } from './materials';
import { buildSandal, markShared } from '../../models/sandal';
import { chanclaModel } from './fp-chancla';
import { RULERO_COLORS, ruleroGeometry } from './ruleros';
import { buildPesada } from './pesada';
import type { RosaRig } from './rosa-rig';

const TEAM = {
  0: { dress: 0xf29a2e, trim: 0xb8441f, shawl: 0xf4e6c8, stripe: 0xe8871e, emblem: 0xf5c542, accent: 0xf2a33a },
  1: { dress: 0x36b9c9, trim: 0x1f6d7a, shawl: 0x5a3480, stripe: 0x86e0e6, emblem: 0xe9f6ff, accent: 0x36b9c9 },
} as const;

/** The team accent colour (the protection bubble, and anything else that names her team). */
export function teamAccent(team: Team): number { return TEAM[team].accent; }

// Where the four match ruleros sit on the head (head-local): under the brim
// of Team Sol's hat, peeking out of the front of Team Luna's rebozo.
const RULERO_SPOTS: Record<Team, Array<[number, number, number, 'x' | 'z']>> = {
  0: [[-0.075, 0.205, -0.135, 'z'], [0.075, 0.205, -0.135, 'z'], [-0.16, 0.18, -0.01, 'x'], [0.16, 0.18, -0.01, 'x']],
  1: [[-0.075, 0.215, -0.2, 'z'], [0.075, 0.215, -0.2, 'z'], [-0.175, 0.16, -0.11, 'x'], [0.175, 0.16, -0.11, 'x']],
};

const geo = {
  head: new THREE.SphereGeometry(0.16, 16, 12),
  bun: new THREE.SphereGeometry(0.1, 12, 8),
  limb: new THREE.CapsuleGeometry(0.055, 0.28, 4, 8),
  thigh: new THREE.CapsuleGeometry(0.07, 0.3, 4, 8),
  torso: new THREE.CapsuleGeometry(0.17, 0.26, 6, 12),
  hand: new THREE.SphereGeometry(0.055, 8, 6),
  brim: new THREE.CylinderGeometry(0.38, 0.4, 0.03, 20),
  crown: new THREE.CylinderGeometry(0.14, 0.17, 0.14, 14),
  hood: new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
  lens: new THREE.BoxGeometry(0.1, 0.05, 0.02),
  disc: new THREE.CircleGeometry(0.12, 16),
  bubble: new THREE.SphereGeometry(1, 18, 12),
  star: new THREE.OctahedronGeometry(0.07, 0),
};

function skirtGeometry(): THREE.LatheGeometry {
  const pts = [new THREE.Vector2(0.16, 0.0), new THREE.Vector2(0.21, -0.18), new THREE.Vector2(0.28, -0.42), new THREE.Vector2(0.33, -0.6), new THREE.Vector2(0.3, -0.62)];
  return new THREE.LatheGeometry(pts, 18);
}
const SKIRT = skirtGeometry();
markShared(SKIRT, ...Object.values(geo));

function outlined(m: THREE.Mesh, scale = 1.07): THREE.Mesh {
  const o = new THREE.Mesh(m.geometry, OUTLINE);
  o.scale.setScalar(scale);
  o.castShadow = false;
  m.add(o);
  return m;
}

/** What the model hands the avatar: the rig, plus the ruleros it carries. */
export interface RosaModel extends RosaRig {
  /** The four match ruleros as one instanced mesh and its outline (null for the campaign look). */
  rulMesh: THREE.InstancedMesh | null;
  rulOutline: THREE.InstancedMesh | null;
  /** Each roller's head-local placement (instance matrix when shown). */
  rulPlace: THREE.Matrix4[];
  /** Outline scale for a roller instance. */
  rulOutlineScale: number;
  /** The campaign's recoverable curlers (home look only). */
  curlers: THREE.Mesh[];
}

/**
 * Builds a Rosa. `home`: the campaign look (no hat or hood), so her ruleros
 * show. `quality` may simplify detail; team colours, silhouettes and the
 * ruleros stay at every level.
 */
export function buildRosaModel(team: Team, opts: { home?: boolean; quality?: Quality } = {}): RosaModel {
  const flashMats: THREE.MeshToonMaterial[] = [];
  const flashable = (color: number): THREE.MeshToonMaterial => { const m = toon(color).clone(); flashMats.push(m); return m; };
  const G = () => new THREE.Group();
  const root = G(), hips = G(), torso = G(), head = G();
  const armL = G(), armR = G(), foreL = G(), foreR = G(), wristL = G(), wristR = G();
  const legL = G(), legR = G(), shinL = G(), shinR = G(), footL = G(), footR = G();
  const stars = G();
  const curlers: THREE.Mesh[] = [];
  let rulMesh: THREE.InstancedMesh | null = null, rulOutline: THREE.InstancedMesh | null = null;
  const rulPlace: THREE.Matrix4[] = [];
  const c = TEAM[team];
  const skin = flashable(COLORS.skin);
  const dress = flashable(c.dress);
  const trim = toon(c.trim);
  const ink = toon(COLORS.ink);
  const hair = toon(0x2a1630);

  root.add(hips);
  hips.position.y = 0.86;
  // Legs (mostly hidden by the skirt) and chancla feet.
  for (const [leg, shin, x] of [[legL, shinL, -0.1], [legR, shinR, 0.1]] as const) {
    leg.position.set(x, -0.05, 0);
    hips.add(leg);
    const th = new THREE.Mesh(geo.thigh, skin);
    th.position.y = -0.2;
    leg.add(th);
    shin.position.y = -0.4;
    leg.add(shin);
    const sh = new THREE.Mesh(geo.limb, skin);
    sh.position.y = -0.2;
    shin.add(outlined(sh));
    const foot = leg === legL ? footL : footR;
    foot.position.y = -0.43;
    shin.add(foot);
    const sandal = buildSandal();
    sandal.scale.setScalar(0.95);
    sandal.position.set(0, 0, -0.04);
    foot.add(sandal);
  }
  const skirt = new THREE.Mesh(SKIRT, dress);
  skirt.position.y = 0.06;
  hips.add(outlined(skirt, 1.04));
  const hem = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.025, 4, 20), trim);
  hem.rotation.x = Math.PI / 2;
  hem.position.y = -0.52;
  hips.add(hem);

  hips.add(torso);
  const body = new THREE.Mesh(geo.torso, dress);
  body.position.y = 0.26;
  body.scale.set(1.05, 1, 0.82);
  torso.add(outlined(body, 1.06));
  // Apron front and shawl (rebozo) over the shoulders.
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.36), toon(COLORS.cream, { side: THREE.DoubleSide }));
  apron.position.set(0, 0.06, -0.16);
  apron.rotation.x = 0.12;
  torso.add(apron);
  const shawl = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.065, 6, 16, Math.PI * 1.4), toon(c.shawl));
  shawl.rotation.set(Math.PI / 2 + 0.2, 0, Math.PI * 0.8);
  shawl.position.set(0, 0.44, 0.02);
  torso.add(shawl);
  // Team emblem on the back: a sun or a crescent.
  const emblem = new THREE.Mesh(team === 0 ? geo.disc : crescent(), toon(c.emblem, { emissive: team === 0 ? 0x3a2600 : 0x203040, side: THREE.DoubleSide }));
  emblem.position.set(0, 0.3, 0.155);
  torso.add(emblem);
  if (team === 0) {
    for (let i = 0; i < 8; i++) {
      const ray = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.07), toon(c.emblem, { side: THREE.DoubleSide }));
      const a = (i / 8) * Math.PI * 2;
      ray.position.set(Math.cos(a) * 0.16, 0.3 + Math.sin(a) * 0.16, 0.156);
      ray.rotation.z = a - Math.PI / 2;
      torso.add(ray);
    }
  }

  head.position.y = 0.58;
  torso.add(head);
  const face = new THREE.Mesh(geo.head, skin);
  face.position.y = 0.1;
  head.add(outlined(face));
  const bun = new THREE.Mesh(geo.bun, hair);
  bun.position.set(0, 0.25, 0.08);
  head.add(outlined(bun, 1.1));
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.165, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), hair);
  hairCap.position.y = 0.11;
  head.add(hairCap);
  // Cat-eye sunglasses and red lipstick.
  for (const x of [-0.055, 0.055]) {
    const l = new THREE.Mesh(geo.lens, ink);
    l.position.set(x, 0.13, -0.15);
    l.rotation.z = x < 0 ? 0.15 : -0.15;
    head.add(l);
  }
  const lips = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.018, 0.02), toon(0xc0142f));
  lips.position.set(0, 0.03, -0.152);
  head.add(lips);
  if (opts.home) {
    // Six curler slots around the bun, filled as ruleros are recovered.
    const cols = [COLORS.pink, COLORS.turquoise, COLORS.marigold, COLORS.violet, COLORS.cream, COLORS.gold];
    const cg = new THREE.CylinderGeometry(0.065, 0.065, 0.2, 12);
    for (let i = 0; i < 6; i++) {
      // Two rows of three across the crown, plainly visible from any side.
      const row = i < 3 ? 0 : 1, k = (i % 3) - 1;
      const m = new THREE.Mesh(cg, toon(cols[i]!, { emissive: 0x1a1010 }));
      m.position.set(k * 0.12, 0.2 - row * 0.06, -0.04 + row * 0.15);
      m.rotation.set(0, 0, Math.PI / 2);
      m.visible = false;
      head.add(outlined(m, 1.12));
      curlers.push(m);
    }
  } else if (team === 0) {
    // Wide straw sun hat with a marigold band and a flower.
    const brim = new THREE.Mesh(geo.brim, toon(0xe8c77a));
    brim.position.y = 0.24;
    head.add(outlined(brim, 1.04));
    const crown = new THREE.Mesh(geo.crown, toon(0xe8c77a));
    crown.position.y = 0.31;
    head.add(crown);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.172, 0.172, 0.04, 14), toon(c.accent));
    band.position.y = 0.27;
    head.add(band);
    const flower = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), toon(COLORS.pink));
    flower.position.set(0.14, 0.29, -0.06);
    head.add(flower);
  } else {
    // Rebozo pulled over the head like a hood.
    const hood = new THREE.Mesh(geo.hood, toon(c.dress, { side: THREE.DoubleSide }));
    hood.position.set(0, 0.1, 0.02);
    hood.scale.set(1.05, 1.15, 1.1);
    head.add(outlined(hood, 1.04));
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.4, 0.03), toon(c.stripe));
    tail.position.set(0.12, -0.18, 0.14);
    tail.rotation.z = 0.25;
    head.add(tail);
  }
  if (!opts.home) {
    // Four ruleros: the ones a backhand to the face can knock off.
    const spots = RULERO_SPOTS[team];
    rulMesh = new THREE.InstancedMesh(ruleroGeometry(), rulMaterial(), spots.length);
    rulOutline = new THREE.InstancedMesh(ruleroGeometry(), OUTLINE, spots.length);
    const q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), big = new THREE.Vector3(1.14, 1.14, 1.14);
    spots.forEach(([x, y, z, axis], i) => {
      e.set(axis === 'x' ? Math.PI / 2 : 0, 0, axis === 'z' ? Math.PI / 2 : 0);
      const at = new THREE.Vector3(x, y, z);
      rulPlace.push(new THREE.Matrix4().compose(at, q.setFromEuler(e), one));
      rulOutline!.setMatrixAt(i, new THREE.Matrix4().compose(at, q, big));
      rulMesh!.setColorAt(i, new THREE.Color(RULERO_COLORS[i % RULERO_COLORS.length]!));
    });
    // Bounds would come from the bare geometry, not the instances: never cull (four tiny pieces).
    rulMesh.frustumCulled = false;
    rulOutline.frustumCulled = false;
    head.add(rulMesh, rulOutline);
  }

  // Arms: shoulder pivot, elbow pivot, hand. The right hand holds the weapon.
  for (const [arm, fore, x] of [[armL, foreL, -0.22], [armR, foreR, 0.22]] as const) {
    arm.position.set(x, 0.44, 0);
    torso.add(arm);
    const up = new THREE.Mesh(geo.limb, dress);
    up.position.y = -0.16;
    arm.add(outlined(up));
    fore.position.y = -0.32;
    arm.add(fore);
    const lo = new THREE.Mesh(geo.limb, skin);
    lo.position.y = -0.15;
    fore.add(lo);
    const hand = new THREE.Mesh(geo.hand, skin);
    if (fore === foreR) {
      wristR.position.y = -0.31;
      fore.add(wristR);
      wristR.add(hand);
    } else {
      wristL.position.y = -0.31;
      fore.add(wristL);
      wristL.add(hand);
    }
  }
  // The same flip-flop as the first-person view and thrown chanclas (shooter only).
  const std = chanclaModel();
  std.scale.setScalar(1.25);
  std.rotation.set(Math.PI / 2, 0, 0);
  std.position.set(0, -0.05, -0.06);
  const heavy = buildPesada();
  heavy.scale.setScalar(1.25);
  heavy.rotation.set(Math.PI / 2, 0, 0);
  heavy.position.set(0, -0.07, -0.05);
  wristR.add(std, heavy);
  const weapons: [THREE.Object3D, THREE.Object3D] = [std, heavy];

  const bubble = new THREE.Mesh(geo.bubble, new THREE.MeshBasicMaterial({ color: TEAM[team].accent, transparent: true, opacity: 0.18, depthWrite: false }));
  bubble.scale.set(0.6, 1.0, 0.6);
  bubble.position.y = 0.9;
  root.add(bubble);
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(geo.star, toon(COLORS.gold, { emissive: 0x443300 }));
    const a = (i / 5) * Math.PI * 2;
    s.position.set(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3);
    stars.add(s);
  }
  stars.visible = false;
  head.add(stars);
  stars.position.y = 0.45;

  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.material !== OUTLINE && o !== bubble && o !== rulMesh) m.castShadow = true;
  });
  const extras: RosaRig['extras'] = {};
  return { root, hips, torso, head, armL, armR, foreL, foreR, wristL, wristR, legL, legR, shinL, shinR, footL, footR, weapons, stars, bubble, flashMats, extras, rulMesh, rulOutline, rulPlace, rulOutlineScale: 1.14, curlers };
}

let rulMat: THREE.MeshToonMaterial | null = null;
/** One material for every avatar's rollers; the colour comes per instance. */
function rulMaterial(): THREE.MeshToonMaterial {
  if (!rulMat) rulMat = toon(0xffffff, { emissive: 0x1a1010 });
  return rulMat;
}

let moonGeo: THREE.ShapeGeometry | null = null;
function crescent(): THREE.ShapeGeometry {
  if (moonGeo) return moonGeo;
  const s = new THREE.Shape();
  s.absarc(0, 0, 0.13, Math.PI * 0.25, Math.PI * 1.75, false);
  s.absarc(0.055, 0, 0.105, Math.PI * 1.62, Math.PI * 0.38, true);
  moonGeo = new THREE.ShapeGeometry(s, 12);
  markShared(moonGeo);
  return moonGeo;
}
