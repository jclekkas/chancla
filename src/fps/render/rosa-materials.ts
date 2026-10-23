// Doña Rosa's palette and her one material. Every part of her is painted
// in vertex colours and drawn with a single toon material (the world's
// three-step ramp), so a joint is one draw call. The ink outline rides in
// the same mesh: an inverted hull whose vertices carry ink = 1. The shader
// paints those flat ink and nudges them 1 cm away from the camera, so the
// hull only shows at the silhouette, not in the creases where parts meet.
import * as THREE from 'three';
import type { Team } from '../../../shared/map';
import { COLORS, toonRamp } from './materials';

/**
 * Per-team colours. Value is kept apart by material kind (dark hair and
 * shoes, mid skin, bright fabric, pale cream linen) and hue by team, all
 * drawn from the courtyard's palette: Sol marigold with terracotta trim and
 * a straw hat; Luna turquoise with a deep-teal rebozo and violet accents.
 */
export const ROSA_COLORS = {
  0: {
    dress: 0xf2a033, dressDeep: 0xd9822a, trim: 0xc24f2e, sash: 0xc24f2e,
    collar: 0xf8eedb, straw: 0xe9c87c, strawDeep: 0xd4ad62, band: 0xc24f2e, flower: 0xe86a8d, flowerHeart: 0xf5c542,
    patch: 0xc24f2e, emblem: 0xf9d34e, shoe: 0x4a2a3c, button: 0xf8eedb,
    rebozo: 0, rebozoStripe: 0, rebozoStripe2: 0,
  },
  1: {
    dress: 0x38b6c4, dressDeep: 0x2a95a6, trim: 0x1d6573, sash: 0x5a3480,
    collar: 0xf2ead8, straw: 0, strawDeep: 0, band: 0, flower: 0, flowerHeart: 0,
    patch: 0x5a3480, emblem: 0xf2f6ff, shoe: 0x33284f, button: 0xf2ead8,
    rebozo: 0x1f6f80, rebozoStripe: 0x9fe3e0, rebozoStripe2: 0x6a4596,
  },
} as const;

/** Colours both teams share: skin, hair, face and footwear details. */
export const ROSA_SHARED = {
  skin: COLORS.skin, blush: 0xd47b66, lips: 0xc4283c, hair: 0x3d3940, hairHi: 0x5a5560,
  eyeWhite: 0xfaf4ea, iris: 0x3a2216, frames: 0xb8233f, gold: 0xf2c14a, sole: 0x2a1a22, sock: 0xf6efe2,
  skirt: 0x2c2a52, skirtDeep: 0x1f1d3d, blossom: 0xf6ecd6, blossom2: 0xf09ab0, bangle: 0xf2c14a,
  flipSole: 0x4b2a6b, flipBed: 0x4fb3a9, flipStrap: 0xc8553d, ink: COLORS.ink,
};

/** How far (m) the hull is pushed from the camera so that only its silhouette shows. */
const INK_PUSH = 0.011;

const inkRGB = new THREE.Color(ROSA_SHARED.ink);
function inkShader(sh: THREE.WebGLProgramParametersWithUniforms): void {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float ink;\nvarying float vInk;')
    .replace('#include <project_vertex>', `#include <project_vertex>\n\tvInk = ink;\n\tmvPosition.z -= ink * ${INK_PUSH.toFixed(4)};\n\tgl_Position = projectionMatrix * mvPosition;`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vInk;')
    .replace('#include <tonemapping_fragment>', `gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(${inkRGB.r.toFixed(4)}, ${inkRGB.g.toFixed(4)}, ${inkRGB.b.toFixed(4)}), step(0.5, vInk));\n#include <tonemapping_fragment>`);
}

/**
 * Rosa's material: vertex-coloured toon with the ink hull. One per avatar
 * (its emissive is the hit flash); all of them share one shader program.
 */
export function rosaMaterial(): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: toonRamp() });
  m.onBeforeCompile = inkShader;
  m.customProgramCacheKey = () => 'rosa-ink';
  return m;
}

let held: THREE.MeshToonMaterial | null = null;
/** Shared toon material for held props baked to vertex colours (La Pesada, the dizzy stars). */
export function propMaterial(): THREE.MeshToonMaterial {
  if (!held) held = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: toonRamp() });
  return held;
}

/** Team palette lookup. */
export function rosaColors(team: Team): (typeof ROSA_COLORS)[Team] { return ROSA_COLORS[team]; }
