// The cafecito health pickup: a steaming cup on a saucer over a warm ground
// ring. Two states that read apart at a glance:
//   ready       cup, coffee and two steam puffs, slowly spinning and bobbing,
//               over a pulsing marigold ring,
//   recharging  only the empty, faded saucer, low and still, over a faint
//               ring with a progress arc that fills until the cup returns.
// Cheap: geometry and materials are shared between cups (materials come from
// the cached toon()/flat() helpers); each cup owns only its progress arc.
import * as THREE from 'three';
import { COLORS, OUTLINE, flat, toon } from './materials';

const ARC_SEGMENTS = 32;

let shared: {
  cup: THREE.CylinderGeometry; saucer: THREE.CylinderGeometry; handle: THREE.TorusGeometry; top: THREE.CircleGeometry;
  ring: THREE.RingGeometry; steam: THREE.SphereGeometry;
} | null = null;

function geo() {
  shared ??= {
    cup: new THREE.CylinderGeometry(0.16, 0.12, 0.22, 16),
    saucer: new THREE.CylinderGeometry(0.26, 0.22, 0.04, 20),
    handle: new THREE.TorusGeometry(0.07, 0.022, 6, 12),
    top: new THREE.CircleGeometry(0.15, 16),
    ring: new THREE.RingGeometry(0.4, 0.55, 28),
    steam: new THREE.SphereGeometry(0.06, 8, 6),
  };
  return shared;
}

export interface CafecitoModel {
  group: THREE.Group;
  /** ready: the cup can be taken; t: seconds (any running clock); rechargeK: 0..1 of the way back (ignored when ready). */
  setState(ready: boolean, t: number, rechargeK: number): void;
  dispose(): void;
}

export function buildCafecito(): CafecitoModel {
  const g = geo();
  const cupMat = toon(COLORS.cream), saucerMat = toon(COLORS.turquoise), saucerOff = toon(COLORS.stoneDark), coffee = toon(COLORS.woodDark);
  const ringOn = flat(COLORS.marigold, { transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const ringOff = flat(COLORS.cream, { transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
  const arcMat = flat(COLORS.marigold, { transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false });
  const steamMat = flat(COLORS.cream, { transparent: true, opacity: 0.5, depthWrite: false });

  const group = new THREE.Group();
  group.name = 'cafecito';
  const spin = new THREE.Group();
  const full = new THREE.Group(); // everything that disappears with the cup
  const cup = new THREE.Mesh(g.cup, cupMat);
  cup.position.y = 0.13;
  const outline = new THREE.Mesh(g.cup, OUTLINE);
  outline.position.y = 0.13;
  outline.scale.setScalar(1.08);
  const top = new THREE.Mesh(g.top, coffee);
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.235;
  const handle = new THREE.Mesh(g.handle, cupMat);
  handle.position.set(0.17, 0.13, 0);
  const steam = [0, 1].map(() => { const m = new THREE.Mesh(g.steam, steamMat); full.add(m); return m; });
  full.add(cup, outline, top, handle);
  const saucer = new THREE.Mesh(g.saucer, saucerMat);
  spin.add(full, saucer);
  spin.position.y = 0.7;

  const ring = new THREE.Mesh(g.ring, ringOn);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  // Progress arc: drawn as the first n of its segments (2 triangles each).
  const arcGeo = new THREE.RingGeometry(0.42, 0.53, ARC_SEGMENTS, 1, Math.PI / 2, Math.PI * 2);
  const arc = new THREE.Mesh(arcGeo, arcMat);
  arc.rotation.x = -Math.PI / 2;
  arc.position.y = 0.035;
  arc.visible = false;
  group.add(spin, ring, arc);

  let wasReady: boolean | null = null;
  let lastSeg = -1;
  return {
    group,
    setState(ready, t, rechargeK) {
      // Each cup has its own phase, from where it stands.
      const ph = group.position.x * 0.37 + group.position.z * 0.21;
      if (ready !== wasReady) {
        wasReady = ready;
        full.visible = ready;
        saucer.material = ready ? saucerMat : saucerOff;
        ring.material = ready ? ringOn : ringOff;
        arc.visible = !ready;
        lastSeg = -1;
      }
      if (ready) {
        spin.rotation.y = t * 1.6 + ph;
        spin.position.y = 0.7 + Math.sin(t * 2.2 + ph) * 0.06;
        const s = 1 + Math.sin(t * 3 + ph) * 0.06;
        ring.scale.set(s, s, 1);
        steam.forEach((m, k) => {
          const u = (t * 0.7 + k * 0.5 + ph) % 1;
          m.position.set(Math.sin(u * 6 + k * 3) * 0.04, 0.3 + u * 0.32, 0);
          m.scale.setScalar(0.6 + u * 0.9);
        });
      } else {
        spin.rotation.y = ph;
        spin.position.y = 0.45;
        ring.scale.set(1, 1, 1);
        const seg = Math.max(1, Math.min(ARC_SEGMENTS, Math.ceil(Math.max(0, Math.min(1, rechargeK)) * ARC_SEGMENTS)));
        if (seg !== lastSeg) { arcGeo.setDrawRange(0, seg * 6); lastSeg = seg; }
      }
    },
    dispose() {
      group.removeFromParent();
      arcGeo.dispose();
    },
  };
}
