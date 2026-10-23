// Doña Rosa, the player character, with team variants that differ in both
// colour and silhouette: Team Sol wears a wide straw sun hat and a marigold
// dress with a sun on the back; Team Luna wears a turquoise rebozo over her
// head and a crescent moon on the back. Ink outlines separate players from
// the scenery. All animation is procedural and driven by real game timing.
import * as THREE from 'three';
import { MELEE, WEAPONS, type WeaponId } from '../../../shared/config';
import type { Team } from '../../../shared/map';
import { COLORS, OUTLINE, toon } from './materials';
import { buildSandal, markShared } from '../../models/sandal';
import { chanclaModel } from './fp-chancla';
import { RULERO_COLORS, ruleroGeometry } from './ruleros';

const TEAM = {
  0: { dress: 0xf29a2e, trim: 0xb8441f, shawl: 0xf4e6c8, stripe: 0xe8871e, emblem: 0xf5c542, accent: 0xf2a33a },
  1: { dress: 0x36b9c9, trim: 0x1f6d7a, shawl: 0x5a3480, stripe: 0x86e0e6, emblem: 0xe9f6ff, accent: 0x36b9c9 },
} as const;

let pesadaGeo: { sole: THREE.BufferGeometry; heel: THREE.BufferGeometry; upper: THREE.BufferGeometry; stud: THREE.BufferGeometry } | null = null;

// La Pesada: a chunky wooden clog with a violet leather upper and brass studs.
export function buildPesada(): THREE.Group {
  if (!pesadaGeo) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.09, -0.15);
    shape.quadraticCurveTo(0.11, -0.17, 0.11, 0.02);
    shape.quadraticCurveTo(0.12, 0.17, 0, 0.19);
    shape.quadraticCurveTo(-0.12, 0.17, -0.11, 0.02);
    shape.quadraticCurveTo(-0.11, -0.16, -0.09, -0.15);
    const sole = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 8 });
    sole.rotateX(-Math.PI / 2);
    const heel = new THREE.BoxGeometry(0.16, 0.06, 0.1);
    heel.translate(0, -0.03, 0.1);
    const upper = new THREE.SphereGeometry(0.1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    upper.scale(1.05, 0.85, 1.25);
    upper.translate(0, 0.07, -0.06);
    const stud = new THREE.SphereGeometry(0.012, 6, 4);
    pesadaGeo = { sole, heel, upper, stud };
    markShared(sole, heel, upper, stud);
  }
  const g = new THREE.Group();
  const wood = toon(0x9a6a3e), dark = toon(0x5e3b25), leather = toon(0x6a3a8c), brass = toon(0xf5c542, { emissive: 0x3a2800 });
  g.add(new THREE.Mesh(pesadaGeo.sole, wood), new THREE.Mesh(pesadaGeo.heel, dark), new THREE.Mesh(pesadaGeo.upper, leather));
  for (let i = 0; i < 7; i++) {
    const a = -1.1 + (i / 6) * 2.2;
    const s = new THREE.Mesh(pesadaGeo.stud, brass);
    s.position.set(Math.sin(a) * 0.105, 0.075, -0.06 + Math.cos(a) * 0.125);
    g.add(s);
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return g;
}

export interface AvatarState {
  speed: number; // horizontal speed m/s
  strafe: number; // -1..1: sideways component relative to facing
  back: number; // -1..1: backwards component
  onGround: boolean;
  crouched: boolean;
  alive: boolean;
  protected: boolean;
  pitch: number;
  weapon: WeaponId;
  msSinceThrow: number;
  msSinceHit: number;
  connected: boolean;
  /** Time since her last melee swing started (the weapon field says which). */
  msSinceMelee?: number;
  /** Bit i set: roller i is shown on her head. */
  ruleros?: number;
}

// Third-person melee: keyframes for the right arm (shoulder pitch, outer
// yaw sweep, forearm bend) and a torso twist, on the attack's own clock.
// Contact sits inside the attack's real contact window.
interface ArmKey { t: number; ax: number; ay: number; fx: number; tw: number }
const MELEE_KEYS: Record<WeaponId, ArmKey[]> = {
  // El Chanclazo: cocked back to her right, a quick forehand across, a short follow-through.
  0: [
    { t: 0, ax: -0.5, ay: 0, fx: -0.6, tw: 0 },
    { t: 90, ax: 1.25, ay: -0.95, fx: -0.95, tw: -0.3 },
    { t: 155, ax: 1.4, ay: 0.25, fx: -0.25, tw: 0.25 },
    { t: 300, ax: 1.05, ay: 0.95, fx: -0.35, tw: 0.4 },
    { t: 700, ax: -0.5, ay: 0, fx: -0.6, tw: 0 },
  ],
  // El Revés: the arm drawn across her chest, the shoulder turned, then a big
  // backhand out to her right with an exaggerated follow-through.
  1: [
    { t: 0, ax: -0.5, ay: 0, fx: -0.6, tw: 0 },
    { t: 280, ax: 1.2, ay: 1.15, fx: -1.45, tw: 0.55 },
    { t: 345, ax: 1.4, ay: -0.2, fx: -0.15, tw: -0.25 },
    { t: 600, ax: 1.1, ay: -1.35, fx: -0.1, tw: -0.7 },
    { t: 1100, ax: -0.5, ay: 0, fx: -0.6, tw: 0 },
  ],
};

function sampleArm(keys: ArmKey[], t: number): ArmKey {
  if (t <= keys[0]!.t) return keys[0]!;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!, b = keys[i + 1]!;
    if (t <= b.t) {
      const k = (t - a.t) / Math.max(1, b.t - a.t);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      return { t, ax: a.ax + (b.ax - a.ax) * e, ay: a.ay + (b.ay - a.ay) * e, fx: a.fx + (b.fx - a.fx) * e, tw: a.tw + (b.tw - a.tw) * e };
    }
  }
  return keys[keys.length - 1]!;
}

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

export class Avatar {
  readonly root = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private foreL = new THREE.Group();
  private foreR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private shinL = new THREE.Group();
  private shinR = new THREE.Group();
  private weapons: THREE.Object3D[] = [];
  private bubble: THREE.Mesh;
  private stars = new THREE.Group();
  private flashMats: THREE.MeshToonMaterial[] = [];
  private phase = 0;
  private deadT = -1;
  private spawnT = 1;
  private wasAlive = true;
  private smooth = { lean: 0, hips: 0, crouch: 0 };
  readonly team: Team;
  private curlers: THREE.Mesh[] = [];
  /**
   * The detachable ruleros of a match Rosa (not the campaign's): one
   * instanced mesh and one instanced outline, so all four cost two draw
   * calls. A roller that has come off is collapsed to nothing.
   */
  private rulMesh: THREE.InstancedMesh | null = null;
  private rulOutline: THREE.InstancedMesh | null = null;
  private rulPlace: THREE.Matrix4[] = [];
  private rulMask = -1;
  private reactT = 1;
  private reactSide = 1;
  private reactHead = false;

  // `home`: the campaign look (no hat or hood), so her ruleros show.
  constructor(team: Team, opts: { home?: boolean } = {}) {
    this.team = team;
    const c = TEAM[team];
    const skin = this.flashable(COLORS.skin);
    const dress = this.flashable(c.dress);
    const trim = toon(c.trim);
    const ink = toon(COLORS.ink);
    const hair = toon(0x2a1630);

    this.root.add(this.hips);
    this.hips.position.y = 0.86;
    // Legs (mostly hidden by the skirt) and chancla feet.
    for (const [leg, shin, x] of [[this.legL, this.shinL, -0.1], [this.legR, this.shinR, 0.1]] as const) {
      leg.position.set(x, -0.05, 0);
      this.hips.add(leg);
      const th = new THREE.Mesh(geo.thigh, skin);
      th.position.y = -0.2;
      leg.add(th);
      shin.position.y = -0.4;
      leg.add(shin);
      const sh = new THREE.Mesh(geo.limb, skin);
      sh.position.y = -0.2;
      shin.add(outlined(sh));
      const foot = buildSandal();
      foot.scale.setScalar(0.95);
      foot.position.set(0, -0.43, -0.04);
      shin.add(foot);
    }
    const skirt = new THREE.Mesh(SKIRT, dress);
    skirt.position.y = 0.06;
    this.hips.add(outlined(skirt, 1.04));
    const hem = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.025, 4, 20), trim);
    hem.rotation.x = Math.PI / 2;
    hem.position.y = -0.52;
    this.hips.add(hem);

    this.hips.add(this.torso);
    const body = new THREE.Mesh(geo.torso, dress);
    body.position.y = 0.26;
    body.scale.set(1.05, 1, 0.82);
    this.torso.add(outlined(body, 1.06));
    // Apron front and shawl (rebozo) over the shoulders.
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.36), toon(COLORS.cream, { side: THREE.DoubleSide }));
    apron.position.set(0, 0.06, -0.16);
    apron.rotation.x = 0.12;
    this.torso.add(apron);
    const shawl = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.065, 6, 16, Math.PI * 1.4), toon(c.shawl));
    shawl.rotation.set(Math.PI / 2 + 0.2, 0, Math.PI * 0.8);
    shawl.position.set(0, 0.44, 0.02);
    this.torso.add(shawl);
    // Team emblem on the back: a sun or a crescent.
    const emblem = new THREE.Mesh(team === 0 ? geo.disc : crescent(), toon(c.emblem, { emissive: team === 0 ? 0x3a2600 : 0x203040, side: THREE.DoubleSide }));
    emblem.position.set(0, 0.3, 0.155);
    this.torso.add(emblem);
    if (team === 0) {
      for (let i = 0; i < 8; i++) {
        const ray = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.07), toon(c.emblem, { side: THREE.DoubleSide }));
        const a = (i / 8) * Math.PI * 2;
        ray.position.set(Math.cos(a) * 0.16, 0.3 + Math.sin(a) * 0.16, 0.156);
        ray.rotation.z = a - Math.PI / 2;
        this.torso.add(ray);
      }
    }

    this.head.position.y = 0.58;
    this.torso.add(this.head);
    const face = new THREE.Mesh(geo.head, skin);
    face.position.y = 0.1;
    this.head.add(outlined(face));
    const bun = new THREE.Mesh(geo.bun, hair);
    bun.position.set(0, 0.25, 0.08);
    this.head.add(outlined(bun, 1.1));
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.165, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), hair);
    hairCap.position.y = 0.11;
    this.head.add(hairCap);
    // Cat-eye sunglasses and red lipstick.
    for (const x of [-0.055, 0.055]) {
      const l = new THREE.Mesh(geo.lens, ink);
      l.position.set(x, 0.13, -0.15);
      l.rotation.z = x < 0 ? 0.15 : -0.15;
      this.head.add(l);
    }
    const lips = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.018, 0.02), toon(0xc0142f));
    lips.position.set(0, 0.03, -0.152);
    this.head.add(lips);
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
        this.head.add(outlined(m, 1.12));
        this.curlers.push(m);
      }
    } else if (team === 0) {
      // Wide straw sun hat with a marigold band and a flower.
      const brim = new THREE.Mesh(geo.brim, toon(0xe8c77a));
      brim.position.y = 0.24;
      this.head.add(outlined(brim, 1.04));
      const crown = new THREE.Mesh(geo.crown, toon(0xe8c77a));
      crown.position.y = 0.31;
      this.head.add(crown);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.172, 0.172, 0.04, 14), toon(c.accent));
      band.position.y = 0.27;
      this.head.add(band);
      const flower = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), toon(COLORS.pink));
      flower.position.set(0.14, 0.29, -0.06);
      this.head.add(flower);
    } else {
      // Rebozo pulled over the head like a hood.
      const hood = new THREE.Mesh(geo.hood, toon(c.dress, { side: THREE.DoubleSide }));
      hood.position.set(0, 0.1, 0.02);
      hood.scale.set(1.05, 1.15, 1.1);
      this.head.add(outlined(hood, 1.04));
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.4, 0.03), toon(c.stripe));
      tail.position.set(0.12, -0.18, 0.14);
      tail.rotation.z = 0.25;
      this.head.add(tail);
    }
    if (!opts.home) {
      // Four ruleros: the ones a backhand to the face can knock off.
      const spots = RULERO_SPOTS[team];
      this.rulMesh = new THREE.InstancedMesh(ruleroGeometry(), rulMaterial(), spots.length);
      this.rulOutline = new THREE.InstancedMesh(ruleroGeometry(), OUTLINE, spots.length);
      const q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), big = new THREE.Vector3(1.14, 1.14, 1.14);
      spots.forEach(([x, y, z, axis], i) => {
        e.set(axis === 'x' ? Math.PI / 2 : 0, 0, axis === 'z' ? Math.PI / 2 : 0);
        const at = new THREE.Vector3(x, y, z);
        this.rulPlace.push(new THREE.Matrix4().compose(at, q.setFromEuler(e), one));
        this.rulOutline!.setMatrixAt(i, new THREE.Matrix4().compose(at, q, big));
        this.rulMesh!.setColorAt(i, new THREE.Color(RULERO_COLORS[i % RULERO_COLORS.length]!));
      });
      this.setRulerosMask((1 << spots.length) - 1);
      // Bounds would come from the bare geometry, not the instances: never cull (four tiny pieces).
      this.rulMesh.frustumCulled = false;
      this.rulOutline.frustumCulled = false;
      this.head.add(this.rulMesh, this.rulOutline);
    }

    // Arms: shoulder pivot, elbow pivot, hand. The right hand holds the weapon.
    for (const [arm, fore, x] of [[this.armL, this.foreL, -0.22], [this.armR, this.foreR, 0.22]] as const) {
      arm.position.set(x, 0.44, 0);
      this.torso.add(arm);
      const up = new THREE.Mesh(geo.limb, dress);
      up.position.y = -0.16;
      arm.add(outlined(up));
      fore.position.y = -0.32;
      arm.add(fore);
      const lo = new THREE.Mesh(geo.limb, skin);
      lo.position.y = -0.15;
      fore.add(lo);
      const hand = new THREE.Mesh(geo.hand, skin);
      hand.position.y = -0.31;
      fore.add(hand);
    }
    // The same flip-flop as the first-person view and thrown chanclas (shooter only).
    const std = chanclaModel();
    std.scale.setScalar(1.25);
    std.rotation.set(Math.PI / 2, 0, 0);
    std.position.set(0, -0.36, -0.06);
    const heavy = buildPesada();
    heavy.scale.setScalar(1.25);
    heavy.rotation.set(Math.PI / 2, 0, 0);
    heavy.position.set(0, -0.38, -0.05);
    this.foreR.add(std, heavy);
    this.weapons = [std, heavy];

    this.bubble = new THREE.Mesh(geo.bubble, new THREE.MeshBasicMaterial({ color: TEAM[team].accent, transparent: true, opacity: 0.18, depthWrite: false }));
    this.bubble.scale.set(0.6, 1.0, 0.6);
    this.bubble.position.y = 0.9;
    this.root.add(this.bubble);
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(geo.star, toon(COLORS.gold, { emissive: 0x443300 }));
      const a = (i / 5) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3);
      this.stars.add(s);
    }
    this.stars.visible = false;
    this.head.add(this.stars);
    this.stars.position.y = 0.45;

    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material !== OUTLINE && o !== this.bubble && o !== this.rulMesh) m.castShadow = true;
    });
  }

  private flashable(color: number): THREE.MeshToonMaterial {
    const m = toon(color).clone();
    this.flashMats.push(m);
    return m;
  }

  /** Shows the match ruleros whose bit is set. */
  setRulerosMask(mask: number): void {
    if (mask === this.rulMask || !this.rulMesh || !this.rulOutline) return;
    this.rulMask = mask;
    const outline = new THREE.Matrix4(), s = new THREE.Vector3(1.14, 1.14, 1.14);
    this.rulPlace.forEach((m, i) => {
      const on = (mask & (1 << i)) !== 0;
      this.rulMesh!.setMatrixAt(i, on ? m : HIDDEN);
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      const r = new THREE.Quaternion().setFromRotationMatrix(m);
      this.rulOutline!.setMatrixAt(i, on ? outline.compose(p, r, s) : HIDDEN);
    });
    this.rulMesh.instanceMatrix.needsUpdate = true;
    this.rulOutline.instanceMatrix.needsUpdate = true;
  }

  /** World position of roller i (where a flying one starts). */
  ruleroWorld(i: number, out: THREE.Vector3): THREE.Vector3 {
    const m = this.rulPlace[i];
    this.root.updateMatrixWorld(true);
    if (!m) return this.head.getWorldPosition(out);
    return out.setFromMatrixPosition(m).applyMatrix4(this.head.matrixWorld);
  }

  /** Paving height under her (for a roller's bounce). */
  get groundY(): number { return this.root.position.y; }

  /**
   * A cartoon flinch from a melee hit: the head snaps aside and the upper
   * body twists, for a third of a second. `side`: +1 knocked to her left, -1 to her right.
   */
  react(head: boolean, side: number): void {
    this.reactT = 0;
    this.reactHead = head;
    this.reactSide = side >= 0 ? 1 : -1;
  }

  /** Shows the first `n` recovered ruleros on her head (campaign). */
  setRuleros(n: number): void {
    this.curlers.forEach((m, i) => (m.visible = i < n));
  }

  dispose(): void {
    for (const m of this.flashMats) m.dispose();
    this.rulMesh?.dispose();
    this.rulOutline?.dispose();
    (this.bubble.material as THREE.Material).dispose();
    // Geometry made for this avatar alone (skirt trim, apron, shawl, hair,
    // hat parts...). Shared geometry and cached materials stay. Missing this
    // left about 7-9 GPU buffers behind per avatar, every match (soak test).
    this.root.traverse((o) => {
      const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (g && !g.userData.shared) g.dispose();
    });
  }

  update(s: AvatarState, dt: number, reducedMotion: boolean): void {
    const def = WEAPONS[s.weapon]!;
    // Death and respawn transitions.
    if (this.wasAlive && !s.alive) this.deadT = 0;
    if (!this.wasAlive && s.alive) { this.deadT = -1; this.spawnT = 0; }
    this.wasAlive = s.alive;
    this.root.visible = true;

    if (this.deadT >= 0) {
      // Comic pratfall: a spin, a sit-down, dizzy stars, then a puff out.
      this.deadT += dt;
      const k = Math.min(1, this.deadT / 0.5);
      this.hips.rotation.set(0, 0, 0);
      this.root.rotation.z = 0;
      this.hips.position.y = 0.86 - 0.55 * easeOut(k);
      this.torso.rotation.x = 0.9 * easeOut(k);
      this.torso.rotation.y = (reducedMotion ? 0 : 1) * (1 - k) * 6;
      this.legL.rotation.x = -1.4 * k;
      this.legR.rotation.x = -1.2 * k;
      this.shinL.rotation.x = 0.2 * k;
      this.shinR.rotation.x = 0.2 * k;
      this.armL.rotation.set(-2.6 * k, 0, -0.6 * k);
      this.armR.rotation.set(-2.6 * k, 0, 0.6 * k);
      this.stars.visible = this.deadT > 0.4;
      this.stars.rotation.y += dt * 5;
      for (const w of this.weapons) w.visible = false;
      const fade = this.deadT > 2.2 ? Math.max(0, 1 - (this.deadT - 2.2) / 0.3) : 1;
      this.root.scale.setScalar(Math.max(0.001, fade));
      this.bubble.visible = false;
      return;
    }
    this.stars.visible = false;
    if (this.spawnT < 1) this.spawnT = Math.min(1, this.spawnT + dt / 0.25);
    this.root.scale.setScalar(reducedMotion ? 1 : 0.7 + 0.3 * easeOutBack(this.spawnT));

    // Locomotion.
    const moving = s.speed > 0.4 && s.onGround;
    this.phase += dt * (moving ? 2.4 + s.speed * 1.35 : 0);
    const amp = moving ? Math.min(0.7, 0.18 + s.speed * 0.09) : 0;
    const sw = Math.sin(this.phase) * amp * (s.back > 0.3 ? -1 : 1);
    const crouch = s.crouched ? 1 : 0;
    this.smooth.crouch += (crouch - this.smooth.crouch) * Math.min(1, dt * 14);
    const cr = this.smooth.crouch;
    // Strafing twists the hips toward the motion.
    this.smooth.hips += (s.strafe * 0.55 - this.smooth.hips) * Math.min(1, dt * 8);
    this.hips.rotation.y = this.smooth.hips;
    this.torso.rotation.y = -this.smooth.hips * 0.8;
    const bob = moving && !reducedMotion ? Math.abs(Math.cos(this.phase)) * 0.04 : Math.sin(performance.now() * 0.002) * 0.006;
    this.hips.position.y = 0.86 - cr * 0.42 + bob;
    let legL = sw, legR = -sw, shinL = Math.max(0, -sw) * 0.8, shinR = Math.max(0, sw) * 0.8;
    if (!s.onGround) { legL = -0.7; legR = -0.25; shinL = 0.9; shinR = 0.5; }
    if (cr > 0.01) { legL = legL * (1 - cr) - 1.25 * cr; legR = legR * (1 - cr) - 1.25 * cr; shinL = shinL * (1 - cr) + 1.6 * cr; shinR = shinR * (1 - cr) + 1.6 * cr; }
    this.legL.rotation.x = legL; this.legR.rotation.x = legR;
    this.shinL.rotation.x = shinL; this.shinR.rotation.x = shinR;
    this.smooth.lean += ((moving ? -0.08 : 0) + cr * 0.25 - this.smooth.lean) * Math.min(1, dt * 8);
    this.torso.rotation.x = this.smooth.lean - s.pitch * 0.25;
    this.head.rotation.x = -s.pitch * 0.55;
    this.armL.rotation.set(-sw * 0.9, 0, -0.12);
    this.foreL.rotation.x = -0.4;

    // Throw: a fast wind-up and release, then recovery for the rest of the
    // cooldown. The chancla in hand reappears when the weapon is ready.
    const tThrow = s.msSinceThrow;
    let ax = -0.5 + sw * 0.3, fx = -0.6, twist = 0;
    if (tThrow < def.cooldownMs) {
      const release = s.weapon === 1 ? 160 : 90;
      if (tThrow < release) {
        const k = tThrow / release;
        ax = -2.7 + 3.3 * easeOut(k);
        fx = -0.2;
        twist = (1 - k) * (s.weapon === 1 ? 0.5 : 0.3);
      } else {
        const k = Math.min(1, (tThrow - release) / Math.max(1, def.cooldownMs - release));
        ax = 0.6 + (-0.5 - 0.6) * easeOut(k);
        fx = -0.2 - 0.4 * k;
      }
    }
    let ay = 0;
    // Melee swing: overrides the throw pose; the sandal stays in her hand.
    const tm = s.msSinceMelee ?? 1e9;
    const mdef = MELEE[s.weapon]!;
    const swinging = tm < mdef.cycleMs;
    if (swinging) {
      const k = sampleArm(MELEE_KEYS[s.weapon], tm);
      const m = reducedMotion ? 0.6 : 1;
      ax = -0.5 + (k.ax + 0.5) * m; ay = k.ay * m; fx = -0.6 + (k.fx + 0.6) * m; twist = k.tw * m;
    }
    this.armR.rotation.order = 'YXZ'; // the sweep turns about the vertical, outside the arm's lift
    this.armR.rotation.set(ax, ay, 0.1);
    this.foreR.rotation.x = fx;
    this.torso.rotation.y += twist;
    const inHand = swinging || tThrow > def.cooldownMs * 0.55 || tThrow < (s.weapon === 1 ? 160 : 90);
    this.weapons[0]!.visible = s.weapon === 0 && inHand;
    this.weapons[1]!.visible = s.weapon === 1 && inHand;
    if (s.ruleros !== undefined) this.setRulerosMask(s.ruleros);

    // Melee flinch: the head snaps aside and the shoulders follow.
    if (this.reactT < 1) {
      this.reactT = Math.min(1, this.reactT + dt / 0.34);
      const k = Math.sin(Math.PI * Math.min(1, this.reactT * 1.6)) * (1 - this.reactT) * (reducedMotion ? 0.4 : 1);
      const big = this.reactHead ? 1 : 0.55;
      this.head.rotation.y = this.reactSide * 0.75 * k * big;
      this.head.rotation.z = this.reactSide * 0.3 * k * big;
      this.torso.rotation.y += this.reactSide * 0.28 * k * big;
      this.torso.rotation.z = -this.reactSide * 0.1 * k * big;
    } else {
      this.head.rotation.y = 0;
      this.head.rotation.z = 0;
      this.torso.rotation.z = 0;
    }

    // Hit flinch and flash (playful, brief, not graphic).
    const hitK = s.msSinceHit < 220 ? 1 - s.msSinceHit / 220 : 0;
    this.torso.rotation.x += hitK * 0.35;
    for (const m of this.flashMats) m.emissive.setRGB(hitK * 0.6, hitK * 0.55, hitK * 0.5);

    this.bubble.visible = s.protected;
    if (s.protected) (this.bubble.material as THREE.MeshBasicMaterial).opacity = 0.14 + Math.sin(performance.now() * 0.01) * 0.05;
  }
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
let rulMat: THREE.MeshToonMaterial | null = null;
/** One material for every avatar's rollers; the colour comes per instance. */
function rulMaterial(): THREE.MeshToonMaterial {
  if (!rulMat) rulMat = toon(0xffffff, { emissive: 0x1a1010 });
  return rulMat;
}

function easeOut(t: number): number { return 1 - (1 - t) * (1 - t); }
function easeOutBack(t: number): number { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }

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
