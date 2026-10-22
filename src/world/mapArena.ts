// An Arcade arena built from a shared map definition (La Plaza, La Fiesta).
// The look comes from the same renderer as Practice, so the two modes play
// the same place. Collision is the map's own boxes: the Arcade moves on the
// ground only, and its circle collision already ignores boxes that start
// above 1.8 m (lintels) or end below 0.35 m. El Patio keeps the Arcade's
// original courtyard (arena.ts), so its tuned wave balance is untouched.
import * as THREE from 'three';
import type { MapData } from '../../shared/map';
import type { MapEntry } from '../../shared/maps';
import { buildWorld } from '../fps/render/world';
import { NavGrid } from './nav';
import { ARENA } from '../config';
import type { Arena } from './arena';
import type { Quality } from '../persistence/storage';

export function buildMapArena(entry: MapEntry, quality: Quality): Arena {
  const map: MapData = entry.data;
  const a = map.arcade!;
  const view = buildWorld(quality, { map, theme: entry.theme, teamDecor: false });
  const group = view.group;
  const hemi = group.children.find((o): o is THREE.HemisphereLight => (o as THREE.HemisphereLight).isHemisphereLight)!;

  // The DJ's speaker stacks on either side of the stage (on top of it, so
  // they never block the floor), with cones that pump to the beat.
  const speakerCones: THREE.Object3D[] = [];
  const cab = new THREE.MeshLambertMaterial({ color: 0x241626 });
  const coneMat = new THREE.MeshLambertMaterial({ color: 0x6a5a7a });
  for (const side of [-1, 1]) {
    const x = a.boss.x + side * 2.4;
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.8, 0.9), cab);
    box.position.set(x, a.boss.y + 0.9, a.boss.z - 0.4);
    box.castShadow = true;
    group.add(box);
    for (const dy of [0.45, 1.25]) {
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1, 18), coneMat);
      cone.rotation.x = Math.PI / 2;
      cone.scale.y = 0.1;
      cone.position.set(x, a.boss.y + dy, a.boss.z + 0.07);
      group.add(cone);
      speakerCones.push(cone);
    }
  }

  const bd = map.bounds;
  const colliders = map.boxes;
  const nav = new NavGrid(bd.minX, bd.minZ, bd.maxX, bd.maxZ, ARENA.navCell, colliders, 0.45);

  return {
    group,
    colliders,
    nav,
    spawns: a.entrances.map((e) => ({ ...e })),
    pickupSpots: a.pickups.map((p) => ({ ...p })),
    playerStart: { ...a.playerStart },
    bossPos: new THREE.Vector3(a.boss.x, a.boss.y, a.boss.z),
    bossWaveOrigin: new THREE.Vector3(a.boss.waveX, 0, a.boss.waveZ),
    dummySpots: a.dummies.map((d) => ({ ...d })),
    sun: view.sun,
    hemi,
    speakerCones,
    bounds: { ...bd },
    pinata: view.pinata,
    update(t: number, beat: number) {
      view.update(t);
      const pulse = 1 + beat * 0.12;
      for (const c of speakerCones) c.scale.y = 0.1 * pulse;
    },
    setShadows(on: boolean, size: number) {
      view.sun.castShadow = on;
      view.sun.shadow.mapSize.set(size, size);
      if (view.sun.shadow.map) { view.sun.shadow.map.dispose(); view.sun.shadow.map = null; }
    },
  };
}
