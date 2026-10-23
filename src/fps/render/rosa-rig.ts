// The contract between Rosa's model (rosa-model.ts) and her animation
// (rosa-anim.ts). The model builds the joints below at the RIG positions;
// the animation only rotates them (and moves hips.position.y and root
// scale), so either side can change without the other.
//
// Coordinates: Rosa faces -z, her right is +x, y is up, metres; the root
// sits on the ground at her feet. Every joint is a THREE.Group pivot at
// the joint itself, with its rest rotation zero:
//   root > hips > legL/legR > shinL/shinR > footL/footR
//   hips > torso > head
//   torso > armL/armR > foreL/foreR > wristL/wristR
// The right wrist holds the two weapons (weapons[0] La Chancla, weapons[1]
// La Pesada). Anything parented under head moves with it (the ruleros, the
// hat or rebozo, the dizzy stars), so nothing on the head can come loose.
//
// Gameplay bounds the model must stay inside (shared/sim.ts hitboxOf,
// standing): body cylinder radius 0.36 m from 0.30 to 1.27 m; head sphere
// radius 0.25 m centred at 1.52 m; standing height 1.72 m, eye at 1.58 m.
import type * as THREE from 'three';
import type { WeaponId } from '../../../shared/config';

/** Joint positions (parent-local) the model builds at and the animation assumes. */
export const RIG = {
  /** hips above the root */
  hipY: 0.86,
  /** legs: hip joint x offset and y below the hips; knee below hip; ankle below knee */
  legX: 0.1, legY: -0.05, thigh: 0.4, shin: 0.43,
  /** torso pivot is the hips' origin; head pivot (neck base) above it */
  headY: 0.58,
  /** shoulders, torso-local */
  shoulderX: 0.22, shoulderY: 0.44,
  /** elbow below the shoulder; wrist below the elbow */
  upperArm: 0.32, foreArm: 0.31,
  /** ankle height above the ground at rest (shin end to sole) */
  ankleY: 0.0,
} as const;


export interface RosaRig {
  root: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group; armR: THREE.Group;
  foreL: THREE.Group; foreR: THREE.Group;
  wristL: THREE.Group; wristR: THREE.Group;
  legL: THREE.Group; legR: THREE.Group;
  shinL: THREE.Group; shinR: THREE.Group;
  footL: THREE.Group; footR: THREE.Group;
  /** [La Chancla, La Pesada], in the right hand. */
  weapons: [THREE.Object3D, THREE.Object3D];
  /** Dizzy stars over the head (elimination). */
  stars: THREE.Group;
  /** Spawn-protection bubble. */
  bubble: THREE.Mesh;
  /** Materials whose emissive flashes on a hit (skin and dress). */
  flashMats: THREE.MeshToonMaterial[];
  /**
   * Optional pieces for secondary motion (the animation must cope with any
   * being absent): skirt (pivot at the waist), shawlTail, hatBrim, bun.
   */
  extras: Partial<Record<'skirt' | 'shawlTail' | 'hatBrim' | 'bun', THREE.Object3D>>;
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
