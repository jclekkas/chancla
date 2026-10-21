// Visuals for campaign entities. Reads MissionSim state every frame; holds
// no mission logic. Everything is built from primitives in code (see
// docs/ASSETS.md) and reuses the classic game's character rigs, converted
// to the shooter's cel-shaded materials.
import * as THREE from 'three';
import type { MissionSim, PickupS } from '../../shared/campaign/mission';
import type { ActorSpec, BlockerSpec, DecoSpec, EntitySpec, PickupSpec, TargetSpec, ZoneSpec } from '../../shared/campaign/types';
import { PINATA } from '../../shared/campaign/pinata';
import { buildBocinas, buildInfluencer, buildSoplador, type Rig } from '../models/characters';
import { COLORS, OUTLINE, flat, toon } from '../fps/render/materials';
import type { Particles } from '../fx/particles';

const V = new THREE.Vector3();

const ROLLER_COLORS: Record<string, number> = {
  pink: COLORS.pink, turquoise: COLORS.turquoise, marigold: COLORS.marigold, violet: 0x9a6ad0, cream: 0xfff3dc, gold: COLORS.gold,
};
const INGREDIENT_COLORS: Record<string, number> = { masa: 0xf3e2b0, rajas: 0x4f9a3a, queso: 0xfff4d6, hojas: 0xc9b36a, jamaica: 0xb0204a, canela: 0x9a5a2a };

function outline(m: THREE.Mesh, s = 1.08): THREE.Mesh {
  const o = new THREE.Mesh(m.geometry, OUTLINE);
  o.scale.setScalar(s);
  m.add(o);
  return m;
}

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0, ol = true): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(color));
  m.position.set(x, y, z);
  return ol ? outline(m, 1.04) : m;
}

function cyl(rt: number, rb: number, h: number, color: number, seg = 12): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), toon(color));
}

// Converts a classic (Lambert) rig to toon shading with outlines.
export function toonify(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.material as THREE.MeshLambertMaterial;
    if (src.transparent || !src.isMeshLambertMaterial) return; // leave toon and outline materials alone
    m.material = toon(src.color.getHex(), { emissive: src.emissive?.getHex() || undefined });
    m.castShadow = true;
  });
}

// ------------------------------------------------------------ builders

export function buildRollerSet(color: number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.06, 0.06, 0.2, 10, 1, true);
  const mat = toon(color, { side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.z = Math.PI / 2;
    m.position.set(0, 0.07 + (i % 2) * 0.1, -0.12 + i * 0.08);
    g.add(outline(m, 1.15));
    // Bristle bands make the silhouette read as curlers, not tubes.
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.012, 4, 10), toon(0xffffff));
    band.rotation.y = Math.PI / 2;
    band.position.copy(m.position);
    g.add(band);
  }
  const clip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.36), toon(COLORS.ink));
  clip.position.y = 0.22;
  g.add(clip);
  g.scale.setScalar(1.6);
  return g;
}

function buildBasket(color: number, contents = true): THREE.Group {
  const g = new THREE.Group();
  const body = cyl(0.32, 0.25, 0.32, 0xc9a26a, 14);
  body.position.y = 0.16;
  g.add(outline(body, 1.06));
  for (let y = 0.06; y < 0.32; y += 0.08) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.27 + y * 0.15, 0.015, 4, 16), toon(0x8a6a3a));
    r.rotation.x = Math.PI / 2; r.position.y = y;
    g.add(r);
  }
  if (contents) {
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), toon(color));
      s.position.set(Math.cos(i * 1.3) * 0.12, 0.34 + (i % 2) * 0.05, Math.sin(i * 1.3) * 0.12);
      g.add(s);
    }
  }
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.02, 4, 16, Math.PI), toon(0x8a6a3a));
  handle.position.y = 0.32;
  g.add(handle);
  return g;
}

function buildTray(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.9, 0.05, 0.55, 0xc8553d, 0, 0.025, 0));
  const dishes = [[-0.25, 0xf3e2b0], [0.05, 0x4f9a3a], [0.3, 0xb0204a]] as const;
  for (const [x, c] of dishes) {
    const plate = cyl(0.13, 0.11, 0.03, 0xffffff, 14);
    plate.position.set(x, 0.07, 0);
    g.add(plate);
    const food = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), toon(c));
    food.position.set(x, 0.085, 0);
    g.add(food);
  }
  return g;
}

function buildChairs(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const c = box(0.5, 0.05, 0.5, [COLORS.turquoise, COLORS.marigold, COLORS.pink, COLORS.cream][i]!, 0, 0.1 + i * 0.16, 0);
    c.rotation.y = (i - 1.5) * 0.12;
    g.add(c);
    g.add(box(0.04, 0.7, 0.04, COLORS.ink, -0.22, 0.35 + i * 0.16, 0.22, false));
  }
  return g;
}

function buildCart(): THREE.Group {
  // A wind-up toy delivery van, knee high: unmistakably a toy, not a person.
  const g = new THREE.Group();
  g.add(box(0.9, 0.5, 1.2, 0xe8483a, 0, 0.42, 0));
  g.add(box(0.8, 0.32, 0.5, 0xfff3dc, 0, 0.82, -0.3));
  g.add(box(0.82, 0.12, 0.1, 0x3a8adc, 0, 0.8, -0.56, false));
  for (const [x, z] of [[-0.48, -0.4], [0.48, -0.4], [-0.48, 0.4], [0.48, 0.4]] as const) {
    const w = cyl(0.17, 0.17, 0.12, COLORS.ink, 12);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.17, z);
    g.add(w);
  }
  const key = new THREE.Group();
  key.add(box(0.06, 0.3, 0.06, COLORS.gold, 0, 0.15, 0, false));
  const loopG = new THREE.TorusGeometry(0.14, 0.035, 6, 12);
  for (const s of [-1, 1]) { const l = new THREE.Mesh(loopG, toon(COLORS.gold)); l.position.set(s * 0.15, 0.32, 0); l.rotation.y = Math.PI / 2; key.add(l); }
  key.position.set(0, 0.68, 0.32);
  key.name = 'key';
  g.add(key);
  const flag = box(0.02, 0.3, 0.2, COLORS.marigold, 0.38, 1.1, 0.5, false);
  g.add(flag);
  g.add(box(0.03, 0.5, 0.03, COLORS.ink, 0.38, 0.9, 0.42, false));
  return g;
}

function buildRollCart(): THREE.Group {
  // A serving trolley that rolls on its own, with a cheeky painted face.
  const g = new THREE.Group();
  g.add(box(0.9, 0.06, 0.6, 0xd8d8e0, 0, 0.8, 0));
  g.add(box(0.9, 0.06, 0.6, 0xd8d8e0, 0, 0.35, 0));
  for (const [x, z] of [[-0.42, -0.27], [0.42, -0.27], [-0.42, 0.27], [0.42, 0.27]] as const) g.add(box(0.04, 0.75, 0.04, 0x6d6a72, x, 0.45, z, false));
  for (const x of [-0.18, 0.18]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), toon(0xffffff));
    eye.position.set(x, 0.62, -0.31);
    g.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), toon(COLORS.ink));
    pupil.position.set(x + 0.01, 0.62, -0.38);
    g.add(pupil);
  }
  return g;
}

function buildPile(w: number, h: number, d: number): THREE.Group {
  // Party debris: cups, plates, napkins and streamers.
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xcbb9a0));
  base.scale.set(w * 0.95, h * 1.6, d * 0.95);
  g.add(outline(base, 1.03));
  const cols = [0xffffff, COLORS.pink, COLORS.turquoise, COLORS.marigold, 0xe8483a];
  for (let i = 0; i < 16; i++) {
    const a = i * 2.4, r = 0.2 + (i % 4) * 0.12;
    const cup = cyl(0.06, 0.045, 0.14, cols[i % cols.length]!, 8);
    cup.position.set(Math.cos(a) * r * w, h * (0.35 + (i % 3) * 0.15), Math.sin(a) * r * d);
    cup.rotation.set(i * 0.7, 0, i * 1.3);
    g.add(cup);
  }
  return g;
}

function buildBoxTower(): THREE.Group {
  const g = new THREE.Group();
  const cols = [0xc49a62, 0xb88a52, 0xd2aa72];
  let y = 0;
  for (let i = 0; i < 4; i++) {
    const s = 0.62 - i * 0.04;
    const b = box(s * 1.8, 0.58, s * 1.8, cols[i % 3]!, (i % 2) * 0.06, y + 0.29, (i % 2) * -0.05);
    b.rotation.y = i * 0.2;
    g.add(b);
    y += 0.6;
  }
  return g;
}

function buildSwitch(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.6, 0.8, 0.12, 0x3a3a48, 0, 0, 0));
  const btn = cyl(0.18, 0.18, 0.1, 0xe8483a, 16);
  btn.rotation.x = Math.PI / 2;
  btn.position.z = -0.1;
  btn.name = 'btn';
  g.add(outline(btn, 1.1));
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.3, 20), flat(COLORS.gold));
  ring.position.z = -0.071;
  ring.rotation.y = Math.PI;
  g.add(ring);
  return g;
}

function buildLatch(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.36, 0.5, 0.36, 0xe8483a, 0, 0, 0));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.04, 6, 14), toon(COLORS.gold));
  ring.position.y = -0.3;
  g.add(ring);
  return g;
}

function buildTimer(): THREE.Group {
  const g = new THREE.Group();
  const body = cyl(0.42, 0.42, 0.16, 0xfff3dc, 24);
  body.rotation.x = Math.PI / 2;
  g.add(outline(body, 1.06));
  const green = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.38, 24, 1, 0, Math.PI / 3), flat(0x3fbf5a, { side: THREE.DoubleSide }));
  green.position.z = -0.085;
  green.name = 'green';
  g.add(green);
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.38, 0.02), toon(0xe8483a));
  needle.geometry.translate(0, 0.17, 0);
  needle.position.z = -0.1;
  needle.name = 'needle';
  g.add(needle);
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), toon(COLORS.gold));
  bell.position.y = 0.42;
  g.add(bell);
  return g;
}

function buildDecor(kind: string): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'lantern') {
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), toon(COLORS.pink, { emissive: 0x401020 }));
    g.add(outline(star, 1.06));
  } else {
    // A tangled banner of papel picado.
    const cols = [COLORS.pink, COLORS.turquoise, COLORS.marigold, COLORS.violet];
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.44), toon(cols[i % 4]!, { side: THREE.DoubleSide }));
      p.position.set(Math.cos(i) * 0.25, Math.sin(i * 2) * 0.15, Math.sin(i) * 0.2);
      p.rotation.set(i, i * 0.6, i * 0.3);
      g.add(p);
    }
  }
  return g;
}

function buildTable(): THREE.Group {
  const g = new THREE.Group();
  const top = new THREE.Group();
  top.add(box(1.8, 0.06, 0.9, 0x8a5a3b, 0, 0.75, 0));
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.04, 0.96), toon(COLORS.cream));
  cloth.position.y = 0.8;
  cloth.name = 'cloth';
  top.add(cloth);
  for (const [x, z] of [[-0.8, -0.38], [0.8, -0.38], [-0.8, 0.38], [0.8, 0.38]] as const) top.add(box(0.06, 0.75, 0.06, 0x5e3b25, x, 0.375, z, false));
  top.name = 'top';
  g.add(top);
  return g;
}

function buildMosaicTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  if (!x) return null;
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    x.fillStyle = (i + j) % 2 ? '#f4f0e6' : '#2f6fb8';
    x.fillRect(i * 32, j * 32, 32, 32);
    x.strokeStyle = '#f2a33a';
    x.lineWidth = 2;
    x.beginPath(); x.arc(i * 32 + 16, j * 32 + 16, 9, 0, Math.PI * 2); x.stroke();
  }
  // A big bounce arrow so the marked surface is unmistakable.
  x.strokeStyle = '#e8483a'; x.lineWidth = 14; x.lineCap = 'round';
  x.beginPath(); x.moveTo(40, 200); x.lineTo(128, 100); x.lineTo(216, 200); x.stroke();
  x.fillStyle = '#e8483a';
  x.beginPath(); x.moveTo(216, 200); x.lineTo(190, 160); x.lineTo(236, 170); x.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildPinata(): { root: THREE.Group; star: THREE.Group; tips: THREE.Mesh[]; core: THREE.Mesh; panels: THREE.Group; rope: THREE.Mesh } {
  const root = new THREE.Group();
  const star = new THREE.Group();
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(PINATA.bodyRadius, 1), toon(COLORS.marigold, { emissive: 0x3a1a00 }));
  star.add(outline(body, 1.04));
  // Paper fringe rings.
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(PINATA.bodyRadius * (0.95 - i * 0.18), 0.07, 5, 24), toon([COLORS.pink, COLORS.marigold, COLORS.turquoise][i]!));
    r.position.z = 0.1 * (i - 1);
    star.add(r);
  }
  const tips: THREE.Mesh[] = [];
  const tipCols = [COLORS.pink, COLORS.marigold, COLORS.turquoise, 0xe8483a, COLORS.gold];
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2 + Math.PI / 2;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.2, 10), toon(tipCols[i]!, { emissive: 0x2a1020 }));
    cone.position.set(Math.cos(ang) * (PINATA.tipRadius - 0.35), Math.sin(ang) * (PINATA.tipRadius - 0.35), 0);
    cone.rotation.z = ang - Math.PI / 2;
    star.add(outline(cone, 1.06));
    // Glowing weak point at the tip.
    const glow = new THREE.Mesh(new THREE.SphereGeometry(PINATA.tipHit * 0.75, 12, 8), flat(0xfff0a0, { transparent: true, opacity: 0.8, additive: true }));
    glow.position.set(Math.cos(ang) * PINATA.tipRadius, Math.sin(ang) * PINATA.tipRadius, 0);
    star.add(glow);
    tips.push(glow);
    (glow as THREE.Mesh & { cone?: THREE.Mesh }).userData.cone = cone;
  }
  const core = new THREE.Mesh(new THREE.SphereGeometry(PINATA.coreRadius, 16, 10), flat(0xffe14a, { transparent: true, opacity: 0.0, additive: true }));
  star.add(core);
  root.add(star);
  const panels = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    // Shield panels: striped party boards on the motor ring.
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.6, 0.12), toon(i % 2 ? COLORS.turquoise : COLORS.pink, { emissive: 0x101018 }));
    outline(p, 1.04);
    for (let k = -1; k <= 1; k++) { const st = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.12, 0.14), toon(COLORS.gold)); st.position.y = k * 0.5; p.add(st); }
    panels.add(p);
  }
  panels.visible = false;
  root.add(panels);
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 6), toon(0xd8c28a));
  root.add(rope);
  return { root, star, tips, core, panels, rope };
}

// ---------------------------------------------------------------- view

interface ActorView { rig: Rig | null; obj: THREE.Group; spec: ActorSpec; phase: number }

export class MissionView {
  readonly group = new THREE.Group();
  private pickups = new Map<string, { obj: THREE.Group; beam: THREE.Mesh | null; spec: PickupSpec }>();
  private targets = new Map<string, { obj: THREE.Group; spec: TargetSpec }>();
  private actors = new Map<string, ActorView>();
  private blockers = new Map<string, { obj: THREE.Group; spec: BlockerSpec; shown: boolean; t: number }>();
  private decos = new Map<string, { obj: THREE.Group; spec: DecoSpec; fixed: boolean; t: number }>();
  private zones: Array<{ obj: THREE.Mesh; spec: ZoneSpec }> = [];
  private hazards = new Map<number, THREE.Group>();
  private pinata: ReturnType<typeof buildPinata> | null = null;
  private decoys: THREE.Group[] = [];
  private confetti: THREE.Mesh[] = [];
  readonly marker: THREE.Group;
  private time = 0;

  constructor(private sim: MissionSim, private particles: Particles) {
    for (const e of sim.def.entities) this.build(e);
    // Marked bank surfaces from the layout.
    const tex = buildMosaicTexture();
    for (const b of sim.def.layout.add) {
      if (!b.tag.startsWith('bank')) continue;
      const w = b.maxX - b.minX, h = b.maxY - b.minY, d = b.maxZ - b.minZ;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(w, d), h), tex ? new THREE.MeshBasicMaterial({ map: tex }) : flat(0x2f6fb8));
      // Face the open side (the side with more room is the thin dimension's min side here).
      if (d < w) { plane.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, b.minZ - 0.01); plane.rotation.y = Math.PI; }
      else { plane.position.set(b.minX - 0.01, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2); plane.rotation.y = -Math.PI / 2; }
      if (b.tag.endsWith(':far')) plane.rotation.y += Math.PI;
      this.group.add(plane);
    }
    // Objective marker: a bobbing arrow above the current hint.
    this.marker = new THREE.Group();
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 4), flat(COLORS.gold, { transparent: true, opacity: 0.9 }));
    arrow.rotation.x = Math.PI;
    this.marker.add(arrow);
    this.marker.visible = false;
    this.group.add(this.marker);
  }

  private build(e: EntitySpec): void {
    switch (e.kind) {
      case 'pickup': {
        const obj = e.item === 'rulero' ? buildRollerSet(ROLLER_COLORS[e.variant ?? 'pink'] ?? COLORS.pink)
          : e.item === 'ingredient' ? buildBasket(INGREDIENT_COLORS[e.variant ?? 'masa'] ?? 0xf3e2b0)
          : e.item === 'tray' ? buildTray() : e.item === 'chairs' ? buildChairs() : buildRollerSet(COLORS.gold);
        // A soft light column makes collectables findable without pixel hunting.
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 3.2, 10, 1, true), flat(0xfff0b0, { transparent: true, opacity: 0.16, additive: true, side: THREE.DoubleSide, depthWrite: false }));
        beam.position.y = 1.6;
        obj.add(beam);
        this.group.add(obj);
        this.pickups.set(e.id, { obj, beam, spec: e });
        break;
      }
      case 'target': {
        const obj = e.visual === 'latch' ? buildLatch() : e.visual === 'switch' ? buildSwitch() : e.visual === 'timer' ? buildTimer()
          : e.visual === 'banner' || e.visual === 'lantern' ? buildDecor(e.visual) : new THREE.Group();
        obj.position.set(...e.at);
        obj.rotation.y = e.facing ?? 0;
        this.group.add(obj);
        this.targets.set(e.id, { obj, spec: e });
        break;
      }
      case 'actor': {
        let rig: Rig | null = null;
        let obj: THREE.Group;
        if (e.archetype === 'cart') obj = buildCart();
        else if (e.archetype === 'rollcart') obj = buildRollCart();
        else {
          rig = e.archetype === 'influencer' ? buildInfluencer() : e.archetype === 'speaker' ? buildBocinas() : buildSoplador();
          toonify(rig.root);
          obj = rig.root;
          if (e.archetype === 'speaker') {
            // He pushes his speaker on a hand cart.
            const cart = new THREE.Group();
            cart.add(box(0.8, 0.9, 0.6, COLORS.ink, 0, 0.75, -0.75));
            const cone = cyl(0.3, 0.3, 0.06, 0x3d3d48, 16);
            cone.rotation.x = Math.PI / 2; cone.position.set(0, 0.8, -1.06);
            cone.name = 'cone';
            cart.add(cone);
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.03, 6, 18), toon(COLORS.pink, { emissive: 0x330011 }));
            ring.position.set(0, 0.8, -1.08);
            cart.add(ring);
            obj.add(cart);
          }
        }
        this.group.add(obj);
        this.actors.set(e.id, { rig, obj, spec: e, phase: 0 });
        break;
      }
      case 'blocker': {
        const [x0, y0, z0, x1, y1, z1] = e.box;
        const obj = e.visual === 'boxtower' ? buildBoxTower() : buildPile(x1 - x0, y1 - y0, z1 - z0);
        obj.position.set((x0 + x1) / 2, y0, (z0 + z1) / 2);
        this.group.add(obj);
        this.blockers.set(e.id, { obj, spec: e, shown: true, t: 1 });
        break;
      }
      case 'deco': {
        const obj = e.visual === 'basket' ? buildBasket(0, false) : e.visual === 'table' ? buildTable() : e.visual === 'bin' ? buildBin() : buildDecor(e.visual);
        obj.position.set(...e.at);
        obj.rotation.y = e.facing ?? 0;
        if (e.visual === 'table') { const top = obj.getObjectByName('top')!; top.rotation.z = 1.35; top.position.y = -0.2; }
        if (e.visual === 'basket') { obj.add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.1, 4), toon(0xd8c28a)).translateY(0.85)); }
        this.group.add(obj);
        this.decos.set(e.id, { obj, spec: e, fixed: false, t: 0 });
        break;
      }
      case 'zone': {
        const ring = new THREE.Mesh(new THREE.RingGeometry(e.r - 0.12, e.r, 40), flat(e.visual === 'drop' ? COLORS.gold : COLORS.turquoise, { transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(e.at[0], e.at[1] + 0.03, e.at[2]);
        this.group.add(ring);
        this.zones.push({ obj: ring, spec: e });
        break;
      }
      case 'pinata': {
        this.pinata = buildPinata();
        this.group.add(this.pinata.root);
        break;
      }
    }
  }

  // Effects for sim events (called by the runtime while draining events).
  onEvent(e: import('../../shared/campaign/mission').MEvent): void {
    switch (e.k) {
      case 'remove': {
        const b = this.blockers.get(e.id);
        if (b) { const p = b.obj.position; this.particles.burst('confetti', p.x, p.y + 0.6, p.z, 26); this.particles.burst('dust', p.x, p.y + 0.3, p.z, 12); }
        break;
      }
      case 'scatter': {
        const b = this.blockers.get(e.id);
        if (b) { const p = b.obj.position; this.particles.burst('leaves', p.x, p.y + 0.8, p.z, 24); }
        break;
      }
      case 'collect': case 'carry': case 'deliver': {
        const p = this.pickups.get(e.id);
        if (p) { const o = p.obj.position; this.particles.burst('gold', o.x, o.y + 0.4, o.z, 18); }
        break;
      }
      case 'fix': {
        const d = this.decos.get(e.id);
        if (d) { const o = d.obj.position; this.particles.burst('confetti', o.x, o.y + 0.5, o.z, 14); }
        break;
      }
      case 'phase':
        if (e.n === 4 && this.pinata) {
          const s = this.sim.state.pinata!;
          this.particles.burst('confetti', s.x, s.y, s.z, 120);
          this.particles.burst('gold', s.x, s.y, s.z, 40);
        }
        break;
      default:
        break;
    }
  }

  update(dt: number, camera: THREE.Camera, focusId: string | null): void {
    this.time += dt;
    const st = this.sim.state;
    const t = this.time;
    // Pickups.
    for (const ps of st.pickups) {
      const v = this.pickups.get(ps.id)!;
      v.obj.visible = ps.state !== 'collected' && ps.state !== 'held';
      if (ps.state === 'held') this.attachHeld(ps, v.obj);
      if (!v.obj.visible) continue;
      v.obj.position.set(ps.x, ps.y, ps.z);
      const free = ps.state === 'free';
      if (free && ps.item !== 'tray' && ps.item !== 'chairs') { v.obj.position.y += 0.25 + Math.sin(t * 2.4 + ps.x) * 0.08; v.obj.rotation.y += dt * 1.4; }
      if (ps.state === 'carried') { v.obj.visible = false; }
      if (ps.state === 'delivered') v.obj.rotation.y = 0;
      if (v.beam) v.beam.visible = free;
    }
    // Targets: done ones dim or swing; timed ones animate their needle.
    for (const ts of st.targets) {
      const v = this.targets.get(ts.id)!;
      const enabled = ts.enabled && this.inStage(v.spec);
      v.obj.visible = enabled || ts.done || v.spec.visual === 'switch';
      if (v.spec.visual === 'latch') v.obj.rotation.z = ts.done ? Math.min(1.2, v.obj.rotation.z + dt * 4) : 0;
      if (v.spec.visual === 'switch') {
        const btn = v.obj.getObjectByName('btn') as THREE.Mesh | undefined;
        if (btn) ((btn.material as THREE.MeshToonMaterial).color.setHex(ts.done ? 0x3fbf5a : enabled ? 0xe8483a : 0x8a7a7a));
      }
      if (v.spec.visual === 'timer' && v.spec.window) {
        const needle = v.obj.getObjectByName('needle')!;
        const w = v.spec.window;
        const ph = enabled && !ts.done ? ((st.timeMs - ts.enabledAt) % w.periodMs) / w.periodMs : 0;
        needle.rotation.z = -ph * Math.PI * 2;
        const green = v.obj.getObjectByName('green')!;
        green.rotation.z = Math.PI / 2 - (w.openMs / w.periodMs) * Math.PI * 2;
        (green as THREE.Mesh).scale.setScalar(1);
        v.obj.position.y = v.spec.at[1] + (enabled && !ts.done ? Math.sin(t * 40) * 0.01 : 0);
      }
      if (v.spec.visual === 'banner' || v.spec.visual === 'lantern') {
        if (ts.done) { v.obj.position.y = Math.max(0.4, v.obj.position.y - dt * 3); v.obj.visible = v.obj.position.y > 0.45; }
        else v.obj.rotation.y = Math.sin(t * 1.2 + v.spec.at[0]) * 0.2;
      }
      if (ts.flashMs > 0) v.obj.scale.setScalar(1.15); else v.obj.scale.setScalar(1);
    }
    // Actors.
    for (const as of st.actors) {
      const v = this.actors.get(as.id)!;
      v.obj.visible = as.enabled && this.inStage(v.spec);
      if (!v.obj.visible) continue;
      v.obj.position.set(as.x, as.y, as.z);
      v.obj.rotation.y = as.yaw;
      this.animateActor(v, as.mode, as.modeMs, Math.hypot(as.vx, as.vz), dt, as.done);
    }
    // Blockers: shrink away when removed, pop back when scattered.
    for (const bs of st.blockers) {
      const v = this.blockers.get(bs.id)!;
      v.t = bs.present ? Math.min(1, v.t + dt * 4) : Math.max(0, v.t - dt * 3);
      v.obj.visible = v.t > 0.01;
      v.obj.scale.setScalar(0.2 + 0.8 * v.t);
    }
    // Decorations: tidy state.
    for (const ds of st.decos) {
      const v = this.decos.get(ds.id)!;
      if (ds.fixed) v.t = Math.min(1, v.t + dt * 2.5);
      if (v.spec.visual === 'table') {
        const top = v.obj.getObjectByName('top')!;
        top.rotation.z = 1.35 * (1 - v.t);
        top.position.y = -0.2 * (1 - v.t);
      } else if (v.spec.visual === 'basket') {
        v.obj.rotation.z = -1.6 * v.t;
      } else if (v.spec.visual === 'banner' || v.spec.visual === 'lantern') {
        v.obj.visible = v.t > 0;
      }
    }
    // Zones pulse.
    for (const z of this.zones) {
      z.obj.visible = this.inStage(z.spec);
      (z.obj.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(t * 3) * 0.15;
    }
    this.updateHazards(dt);
    this.updatePinata(dt);
    // Marker over the focused hint.
    this.marker.visible = false;
    if (focusId) {
      const pos = this.focusPos(focusId);
      if (pos) {
        this.marker.visible = true;
        this.marker.position.set(pos.x, pos.y + 1.1 + Math.sin(t * 3) * 0.12, pos.z);
        this.marker.rotation.y += dt * 2;
      }
    }
    void camera;
  }

  private inStage(e: { stages?: string[] }): boolean {
    return !e.stages || e.stages.includes(this.sim.stageDef.id);
  }

  focusPos(id: string): THREE.Vector3 | null {
    const st = this.sim.state;
    const p = st.pickups.find((x) => x.id === id);
    if (p && (p.state === 'free' || p.state === 'falling' || p.state === 'hidden')) return V.set(p.x, p.y + 0.3, p.z);
    const t = this.targets.get(id);
    if (t) return V.set(...t.spec.at);
    const a = st.actors.find((x) => x.id === id);
    if (a) return V.set(a.x, a.y + 1.8, a.z);
    const z = this.zones.find((x) => x.spec.id === id);
    if (z) return V.set(z.spec.at[0], z.spec.at[1] + 0.5, z.spec.at[2]);
    return null;
  }

  private attachHeld(ps: PickupS, obj: THREE.Group): void {
    const holder = this.sim.state.actors.find((a) => a.holds === ps.id);
    if (!holder) return;
    const v = this.actors.get(holder.id)!;
    obj.visible = v.obj.visible;
    if (v.rig) {
      // Worn on the head, very visibly, for the photo shoot.
      v.rig.head.getWorldPosition(V);
      obj.position.set(V.x, V.y + 0.28, V.z);
    } else {
      obj.position.set(holder.x, holder.y + 1.02, holder.z);
    }
    obj.rotation.y = holder.yaw;
    const vp = this.pickups.get(ps.id);
    if (vp?.beam) vp.beam.visible = false;
  }

  private animateActor(v: ActorView, mode: string, modeMs: number, speed: number, dt: number, done: boolean): void {
    v.phase += dt * (speed > 0.2 ? 6 + speed * 1.5 : 0);
    const sw = Math.sin(v.phase) * Math.min(0.7, speed * 0.25);
    const r = v.rig;
    if (!r) {
      // Carts: wheel wobble, wind-up key turns; spinning when hit.
      const key = v.obj.getObjectByName('key');
      if (key) key.rotation.z += dt * (done ? 0 : 6);
      v.obj.position.y += speed > 0.1 ? Math.abs(Math.sin(v.phase * 2)) * 0.03 : 0;
      if (done) v.obj.rotation.z = 0.35;
      return;
    }
    r.legL.rotation.x = sw; r.legR.rotation.x = -sw;
    r.armL.rotation.set(-sw * 0.8, 0, 0); r.armR.rotation.set(sw * 0.8, 0, 0);
    r.body.rotation.set(0, 0, 0);
    r.stars.visible = mode === 'dizzy' || mode === 'stunned' || mode === 'off';
    if (r.stars.visible) r.stars.rotation.y += dt * 5;
    if (r.flash) r.flash.visible = false;
    switch (mode) {
      case 'pose': case 'film':
        // Selfie stick up, hip out, flash every second.
        r.armR.rotation.set(-2.6, 0, -0.3);
        r.armL.rotation.set(0, 0, 0.9);
        r.body.rotation.z = Math.sin(modeMs / 300) * 0.08;
        if (r.flash) r.flash.visible = Math.floor(modeMs / 500) % 2 === 0;
        break;
      case 'dizzy': case 'stunned':
        r.body.rotation.z = Math.sin(modeMs / 120) * 0.25;
        break;
      case 'warn': {
        const cone = v.obj.getObjectByName('cone');
        if (cone) cone.scale.setScalar(1 + Math.abs(Math.sin(modeMs / 90)) * 0.35);
        r.body.rotation.x = Math.sin(modeMs / 70) * 0.05;
        break;
      }
      case 'shake':
        v.obj.position.x += Math.sin(modeMs / 20) * 0.05;
        break;
      case 'windup':
        r.body.rotation.x = -0.25;
        r.body.position.x = Math.sin(modeMs / 25) * 0.03;
        break;
      case 'gust':
        r.body.rotation.x = 0.2;
        break;
      case 'vent':
        r.body.rotation.x = 0.35;
        if (Math.random() < 0.3) { r.torso.getWorldPosition(V); this.particles.burst('smoke', V.x, V.y + 0.4, V.z, 1); }
        break;
      case 'off':
        r.body.rotation.x = 0.4;
        break;
      default:
        break;
    }
  }

  private updateHazards(_dt: number): void {
    const st = this.sim.state;
    const live = new Set<number>();
    for (const h of st.hazards) {
      live.add(h.id);
      let g = this.hazards.get(h.id);
      if (!g) {
        g = new THREE.Group();
        const geo = h.kind === 'circle' ? new THREE.CircleGeometry(h.r, 40) : new THREE.CircleGeometry(h.r, 24, -h.half, h.half * 2);
        const fill = new THREE.Mesh(geo, flat(0xe8483a, { transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
        fill.rotation.x = -Math.PI / 2;
        fill.name = 'fill';
        const edgeGeo = h.kind === 'circle' ? new THREE.RingGeometry(h.r - 0.12, h.r, 40) : new THREE.RingGeometry(h.r - 0.15, h.r, 24, 1, -h.half, h.half * 2);
        const edge = new THREE.Mesh(edgeGeo, flat(0xffe14a, { transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
        edge.rotation.x = -Math.PI / 2;
        g.add(fill, edge);
        this.group.add(g);
        this.hazards.set(h.id, g);
      }
      g.position.set(h.x, h.y + 0.05, h.z);
      // Cone fan: CircleGeometry sweeps from +x; rotate so its middle points along the actor's facing.
      if (h.kind === 'cone') g.rotation.y = h.yaw + Math.PI / 2;
      const warn = h.t < h.warnMs;
      const fill = g.getObjectByName('fill') as THREE.Mesh;
      const k = warn ? h.t / h.warnMs : 1;
      fill.scale.setScalar(Math.max(0.05, k));
      (fill.material as THREE.MeshBasicMaterial).opacity = warn ? 0.2 + 0.2 * k : 0.55;
    }
    for (const [id, g] of this.hazards) if (!live.has(id)) { this.group.remove(g); this.hazards.delete(id); }
  }

  private updatePinata(dt: number): void {
    const s = this.sim.state.pinata;
    const v = this.pinata;
    if (!s || !v || !this.sim.pinata) return;
    const pin = this.sim.pinata;
    v.root.visible = !s.defeated;
    if (s.defeated) return;
    v.star.position.set(s.x, s.y, s.z);
    v.star.rotation.set(0, s.spin + Math.PI / 2, 0);
    const [ax, ay, az] = pin.spec.at;
    const dx = s.x - ax, dy = s.y - ay, len = Math.hypot(dx, dy);
    v.rope.position.set((ax + s.x) / 2, (ay + s.y) / 2 + 0.5, (az + s.z) / 2);
    v.rope.scale.y = len;
    v.rope.rotation.z = Math.atan2(dx, -dy);
    s.tips.forEach((tp, i) => {
      const g = v.tips[i]!;
      g.visible = tp.hp > 0;
      const cone = g.userData.cone as THREE.Mesh;
      cone.visible = tp.hp > 0;
      // Only the lit point glows (it is the one that takes damage).
      const lit = i === s.lit && s.phase < 3;
      g.visible = tp.hp > 0 && lit;
      g.scale.setScalar((0.7 + 0.3 * (tp.hp / PINATA.tipHp)) * (1 + Math.sin(this.time * 6 + i) * 0.1));
    });
    const open = pin.coreOpen(s);
    const warn = s.phase === 3 && s.coreT < 1300;
    (v.core.material as THREE.MeshBasicMaterial).opacity = open ? 0.95 : warn ? 0.3 + Math.abs(Math.sin(this.time * 14)) * 0.3 : 0;
    v.core.scale.setScalar(open ? 1.15 : 1);
    v.panels.visible = s.phase === 2;
    v.panels.children.forEach((p, i) => {
      const pp = pin.panelPos(s, i);
      p.position.set(pp[0], pp[1], pp[2]);
      p.lookAt(s.x, s.y, s.z);
    });
    // Decoys: mini piñatas.
    while (this.decoys.length < s.decoys.length) {
      const d = new THREE.Group();
      const b = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), toon(COLORS.turquoise));
      d.add(outline(b, 1.08));
      for (let k = 0; k < 4; k++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.4, 6), toon(COLORS.pink)); c.position.set(Math.cos(k * 1.57) * 0.45, Math.sin(k * 1.57) * 0.45, 0); c.rotation.z = k * 1.57 - Math.PI / 2; d.add(c); }
      this.group.add(d);
      this.decoys.push(d);
    }
    this.decoys.forEach((d, i) => {
      const ds = s.decoys[i];
      d.visible = !!ds && ds.alive;
      if (!ds || !ds.alive) return;
      const p = pin.decoyPos(s, ds);
      d.position.set(p[0], p[1], p[2]);
      d.rotation.y += dt * (ds.windup ? 18 : 2);
    });
    if (s.hitFlashMs > 0) v.star.scale.setScalar(1.06); else v.star.scale.setScalar(1);
    // Hostile confetti balls.
    const hostile = this.sim.state.projs.filter((p) => p.hostile);
    while (this.confetti.length < hostile.length) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), toon(COLORS.marigold, { emissive: 0x402000 }));
      this.group.add(m);
      this.confetti.push(m);
    }
    this.confetti.forEach((m, i) => {
      const p = hostile[i];
      m.visible = !!p;
      if (p) { m.position.set(p.x, p.y, p.z); m.rotation.x += dt * 8; }
    });
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.group.removeFromParent();
  }
}

function buildBin(): THREE.Group {
  const g = new THREE.Group();
  const b = cyl(0.45, 0.38, 1.0, 0x3d7d5a, 14);
  b.position.y = 0.5;
  g.add(outline(b, 1.05));
  const lid = cyl(0.48, 0.48, 0.08, 0x2f5f45, 14);
  lid.position.y = 1.04;
  g.add(lid);
  return g;
}
