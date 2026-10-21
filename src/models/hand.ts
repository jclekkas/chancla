import * as THREE from 'three';
import { GEO, PALETTE, lambert, mesh } from '../world/palette';
import { buildSandal } from './sandal';

// Rosa's first-person arm: violet sleeve, cream cuff, gold bangles, red nails,
// holding the equipped chancla.
export interface HandRig {
  root: THREE.Group;
  arm: THREE.Group;
  sandal: THREE.Group;
  spare: THREE.Group;
  leftHand: THREE.Group;
}

export function buildHand(): HandRig {
  const root = new THREE.Group();
  const arm = new THREE.Group();
  root.add(arm);

  const skin = lambert(PALETTE.skin1);
  const sleeve = mesh(GEO.cyl, lambert(PALETTE.violet), 0.11, 0.42, 0.11, 0, -0.08, 0.2);
  sleeve.rotation.x = Math.PI / 2.4;
  arm.add(sleeve);
  const cuff = mesh(GEO.cyl, lambert(PALETTE.cream), 0.12, 0.05, 0.12, 0, 0.0, 0.02);
  cuff.rotation.x = Math.PI / 2.4;
  arm.add(cuff);
  const wrist = mesh(GEO.cyl, skin, 0.075, 0.12, 0.075, 0, 0.02, -0.04);
  wrist.rotation.x = Math.PI / 2.4;
  arm.add(wrist);
  for (let i = 0; i < 2; i++) {
    const bangle = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 5, 14), lambert(PALETTE.gold, { emissive: 0x3a2800 }));
    bangle.position.set(0, 0.02 + i * 0.012, -0.03 - i * 0.025);
    bangle.rotation.x = Math.PI / 2.4 + Math.PI / 2;
    arm.add(bangle);
  }
  const palm = mesh(GEO.box, skin, 0.1, 0.045, 0.1, 0, 0.05, -0.11);
  palm.rotation.x = -0.2;
  arm.add(palm);
  const nail = lambert(0xc0142f);
  for (let i = 0; i < 4; i++) {
    const f = mesh(GEO.box, skin, 0.022, 0.024, 0.07, -0.036 + i * 0.024, 0.075, -0.17);
    f.rotation.x = 0.6;
    arm.add(f);
    const n = mesh(GEO.box, nail, 0.018, 0.008, 0.016, -0.036 + i * 0.024, 0.098, -0.192);
    n.rotation.x = 0.6;
    arm.add(n);
  }
  const thumb = mesh(GEO.box, skin, 0.025, 0.025, 0.06, 0.06, 0.06, -0.12);
  thumb.rotation.set(0.3, -0.6, 0);
  arm.add(thumb);

  const sandal = buildSandal();
  sandal.scale.setScalar(0.78);
  sandal.position.set(0.0, 0.1, -0.2);
  sandal.rotation.set(0.75, 0.35, 0.8);
  arm.add(sandal);

  // Spare chancla tucked in the left hand at the lower edge of view.
  const leftHand = new THREE.Group();
  const lsleeve = mesh(GEO.cyl, lambert(PALETTE.violet), 0.1, 0.36, 0.1, 0, -0.06, 0.16);
  lsleeve.rotation.x = Math.PI / 2.4;
  leftHand.add(lsleeve);
  const lpalm = mesh(GEO.box, skin, 0.09, 0.04, 0.09, 0, 0.03, -0.06);
  leftHand.add(lpalm);
  const spare = buildSandal();
  spare.scale.setScalar(0.42);
  spare.position.set(0, 0.07, -0.1);
  spare.rotation.set(0.5, -0.4, -0.6);
  leftHand.add(spare);
  root.add(leftHand);

  root.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });
  return { root, arm, sandal, spare, leftHand };
}
