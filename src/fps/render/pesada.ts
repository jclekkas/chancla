// La Pesada: the heavy chancla, shared by the avatars, the first-person
// view and thrown projectiles.
import * as THREE from 'three';
import { toon } from './materials';
import { markShared } from '../../models/sandal';

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
