// Doña Rosa's palette and her one material. Every part of her is painted
// in vertex colours and drawn with a single toon material (the world's
// three-step ramp), so a joint is one draw call. The ink outline rides in
// the same mesh: an inverted hull whose vertices carry ink = 1. The shader
// paints those flat ink and nudges them 1 cm away from the camera, so the
// hull only shows at the silhouette, not in the creases where parts meet.
// The face's eyes and brows carry a negative ink (a feature tag) instead:
// the vertex shader closes the eyes and moves the brows from one per-avatar
// uniform, so blinks and expressions cost no draw call and no geometry.
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

/** Feature tags (stored as ink = -tag on the face's pieces). */
export const FACE_TAG = { eye: 1, browL: 2, browR: 3 } as const;

/**
 * Where the face's features sit (head-local, as drawn): the eyes' lid line
 * (they close onto it) and each brow's inner and outer x (her left brow at -x).
 */
export interface FaceRig { lidY: number; browIn: number; browOut: number }

const f4 = (x: number) => x.toFixed(4);
const inkRGB = new THREE.Color(ROSA_SHARED.ink);
function inkShader(sh: THREE.WebGLProgramParametersWithUniforms, fr: FaceRig): void {
  // rosaFace: x eyes closed (0..1), y brows raised (m, - lowered), z brows knitted (0..1).
  const span = fr.browOut - fr.browIn;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float ink;\nvarying float vInk;\nuniform vec4 rosaFace;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
\tif (ink < -0.5) {
\t\tif (ink > -1.5) transformed.y = ${f4(fr.lidY)} + (transformed.y - ${f4(fr.lidY)}) * (1.0 - 0.9 * rosaFace.x);
\t\telse {
\t\t\tfloat inner = clamp(1.0 - (abs(transformed.x) - ${f4(fr.browIn)}) / ${f4(span)}, 0.0, 1.0);
\t\t\ttransformed.y += rosaFace.y - rosaFace.z * 0.014 * inner;
\t\t\ttransformed.x -= sign(transformed.x) * rosaFace.z * 0.005 * inner;
\t\t}
\t}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n\tvInk = ink;\n\tmvPosition.z -= max(ink, 0.0) * ${INK_PUSH.toFixed(4)};\n\tgl_Position = projectionMatrix * mvPosition;`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vInk;')
    .replace('#include <tonemapping_fragment>', `gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(${inkRGB.r.toFixed(4)}, ${inkRGB.g.toFixed(4)}, ${inkRGB.b.toFixed(4)}), step(0.5, vInk));\n#include <tonemapping_fragment>`);
}

/**
 * The arena look's shading on her skin (`rosaMaterial(..., { arena: true })`).
 * Skin is found by its vertex colour (skin and blush, exact: the palette is
 * baked flat), so clothing, hair, eyes, brows, lips, glasses and the ink keep
 * the world's hard bands. On skin only: the same three band values read from
 * the world ramp (whatever profile the world set), blended across each band
 * edge instead of stepping (SKIN_SOFT, in ramp coordinates), a small wrap
 * (SKIN_WRAP) so the terminator sits a little past the side of the face, and
 * received shadow lifted a quarter of the way toward lit (shadowLift), so a
 * hat brim darkens the face without erasing it. The lift also covers the
 * face's other pieces (hair, brows, eyes, glasses, lips: colours used only on
 * the head, matched exactly), so the head stays one piece in a shadow. The
 * rest of her (clothing) takes its own share of the same lift (bodyLift),
 * scaled by how far she stands in the world's shade (`rosaShade`, per
 * avatar: Avatar.setShade, from a ray toward the sun), so her own self-shadow
 * in sun is untouched. In a building's shade or at dusk the only other light
 * is the cool sky fill, which turns Sol's marigold brown and Luna's
 * turquoise navy at combat range; a little of the warm sun keeps the team
 * colour readable while she still sits clearly darker than in sun. By the
 * same factor her whole sky fill (skin too) is pulled toward its own grey,
 * a touch warm (fillNeutral), and raised a little (fillGain), so the lilac
 * no longer shifts her colours' hue. In sun (rosaShade 0) she is exactly as
 * before. No new texture, light or pass.
 */
export const ARENA_SKIN = { soft: 0.09, wrap: 0.1, shadowLift: 0.25, bodyLift: 0.3, fillNeutral: 0.85, fillGain: 0.35 } as const;
/** Colours that only the head uses (none closer than 0.02 in linear RGB to any other in the palette). */
const HEAD_ONLY = [ROSA_SHARED.hair, ROSA_SHARED.hairHi, ROSA_SHARED.eyeWhite, ROSA_SHARED.iris, ROSA_SHARED.frames, ROSA_SHARED.lips].map((h) => new THREE.Color(h));
const skinLin = new THREE.Color(ROSA_SHARED.skin), blushLin = new THREE.Color(ROSA_SHARED.blush);
const v3 = (c: THREE.Color) => `vec3(${f4(c.r)}, ${f4(c.g)}, ${f4(c.b)})`;
function skinShader(sh: THREE.WebGLProgramParametersWithUniforms): void {
  const { soft, wrap, shadowLift, bodyLift, fillNeutral, fillGain } = ARENA_SKIN;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying float vRosaSkin;\nvarying float vRosaHead;')
    .replace('#include <color_vertex>', `#include <color_vertex>
\tvRosaSkin = 1.0 - smoothstep(0.02, 0.04, min(distance(color.rgb, ${v3(skinLin)}), distance(color.rgb, ${v3(blushLin)})));
\tfloat rosaHd = ${HEAD_ONLY.map((c) => `distance(color.rgb, ${v3(c)})`).reduce((a, b) => `min(${a}, ${b})`)};
\tvRosaHead = max(vRosaSkin, 1.0 - smoothstep(0.004, 0.008, rosaHd));`);
  const T = 'texture2D( gradientMap, vec2( ';
  const pars = THREE.ShaderChunk.lights_toon_pars_fragment.replace('getGradientIrradiance(', 'rosaGradient(');
  const begin = THREE.ShaderChunk.lights_fragment_begin.split('receiveShadow ) ? get').join(`receiveShadow ) ? rosaLift + ( 1.0 - rosaLift ) * get`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vRosaSkin;\nvarying float vRosaHead;\nuniform float rosaShade;')
    .replace('#include <lights_toon_pars_fragment>', `vec3 rosaGradient( vec3 normal, vec3 lightDirection ) {
\tvec3 hard = getGradientIrradiance( normal, lightDirection );
\tfloat u = ( dot( normal, lightDirection ) + ${f4(wrap)} ) / ${f4(1 + wrap)} * 0.5 + 0.5;
\tfloat a = ${T}0.1667, 0.0 ) ).r, b = ${T}0.5, 0.0 ) ).r, c = ${T}0.8333, 0.0 ) ).r;
\tfloat soft = a + ( b - a ) * smoothstep( ${f4(1 / 3 - soft)}, ${f4(1 / 3 + soft)}, u ) + ( c - b ) * smoothstep( ${f4(2 / 3 - soft)}, ${f4(2 / 3 + soft)}, u );
\treturn mix( hard, vec3( soft ), vRosaSkin );
}
${pars}`)
    .replace('#include <lights_fragment_end>', `{
		vec3 grey = vec3( dot( irradiance, vec3( 0.2126, 0.7152, 0.0722 ) ) ) * vec3( 1.0, 0.96, 0.9 );
		irradiance = mix( irradiance, grey, ${f4(fillNeutral)} * rosaShade ) * ( 1.0 + ${f4(fillGain)} * rosaShade );
	}
#include <lights_fragment_end>`)
    .replace('#include <lights_fragment_begin>', `float rosaLift = mix( ${f4(bodyLift)} * rosaShade, ${f4(shadowLift)}, vRosaHead );\n${begin}`);
}

/**
 * Rosa's material: vertex-coloured toon with the ink hull. One per avatar
 * (its colour is the hit flash, `face` her expression); all of them share
 * one shader program (`fr` is the same for every look). `arena`: the match
 * look's skin shading (ARENA_SKIN), its own program; without it the
 * material is exactly the campaign's.
 */
export function rosaMaterial(fr: FaceRig, face = new THREE.Vector4(), opts: { arena?: boolean } = {}): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: toonRamp() });
  const u = { value: face };
  // The face rig is baked into the shader: one program per rig (the match and campaign looks differ).
  const key = `rosa-ink:${f4(fr.lidY)}:${f4(fr.browIn)}:${f4(fr.browOut)}`;
  if (opts.arena) {
    const shade = { value: 0 };
    m.userData.rosaShade = shade;
    m.onBeforeCompile = (sh) => { sh.uniforms.rosaFace = u; sh.uniforms.rosaShade = shade; inkShader(sh, fr); skinShader(sh); };
    const akey = `${key}:skin:${ARENA_SKIN.soft}:${ARENA_SKIN.wrap}:${ARENA_SKIN.shadowLift}:${ARENA_SKIN.bodyLift}:${ARENA_SKIN.fillNeutral}:${ARENA_SKIN.fillGain}`;
    m.customProgramCacheKey = () => akey;
    return m;
  }
  m.onBeforeCompile = (sh) => { sh.uniforms.rosaFace = u; inkShader(sh, fr); };
  m.customProgramCacheKey = () => key;
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
