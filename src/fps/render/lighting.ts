// The arena's light (lead-owned): the sky fill, the sun and its shadow, and
// what the first-person hand and the characters see. Built from the map's
// theme; a map may adjust it (map-dressing.ts `light`).
import * as THREE from 'three';
import type { Quality } from '../settings';
import type { SceneLight } from './map-dressing';

const mix = (a: number, b: number, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

/**
 * The arena light from a theme: warm sunlight against cooler shade. The sun
 * is warmer and a little stronger; the sky fill (all that reaches a face in
 * shade, under an eave or in a doorway) is a cool lilac-blue at about the
 * same strength, so shade reads cool and deep without going dark; the
 * ground bounce stays warm terracotta, so faces and undersides in shade keep
 * a warm lift and skin and team colours stay true.
 */
export interface KitLightTune { sky: number; skyMix: number; ground: number; groundMix: number; hemiK: number; sunK: number }
export const KIT_LIGHT: KitLightTune = { sky: 0x8ea6f0, skyMix: 0.7, ground: 0x9a6450, groundMix: 0.5, hemiK: 1, sunK: 1.34 };
export function kitLight(base: SceneLight, t: KitLightTune = KIT_LIGHT): SceneLight {
  return {
    // The fill is a little stronger than the theme's: with the arena ramp's deeper
    // shadow band (materials.ts) it carries the shade, so it must keep it readable.
    hemi: [mix(base.hemi[0], t.sky, t.skyMix), mix(base.hemi[1], t.ground, t.groundMix), base.hemi[2] * t.hemiK],
    sun: [mix(base.sun[0], 0xffb26e, 0.5), base.sun[1] * t.sunK],
    fog: base.fog,
  };
}

/** Shadow map settings by quality (Low: none). */
export function shadowSettings(quality: Quality): { size: number; radius: number } | null {
  // PCF here takes five filtered taps whatever the radius, so a wider,
  // softer penumbra costs nothing; the shadow camera is fixed over the arena,
  // so nothing swims as the view moves. The same map sizes as before.
  return quality === 'high' ? { size: 2048, radius: 3 } : quality === 'medium' ? { size: 1024, radius: 2 } : null;
}
