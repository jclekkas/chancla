// The final image: one full-screen pass that gives each arena its mood. The world is drawn into an
// off-screen target (multisampled, half-float, so highlights keep their headroom) and one shader
// reads it:
//   glow        wide, soft bloom from the target's own mip levels (no blur chain), warm-tinted: the sun,
//               string lights, lamps, bright plaster and sky bloom into the air around them
//   shafts      light shafts: the bright sky is smeared toward the sun on screen, so rays fall through
//               roof gaps and between houses whenever the sun is in view
//   grade       highlight roll-off, split-toning (cool or violet shade, warm light), vibrance (dull colours
//               gain most, strong ones least), a gentle S curve
//   sharpen     a small contrast-adaptive sharpen, so tiles, cobbles and window frames stay crisp
//   lens        a hint of colour fringing toward the corners, a vignette, and a dither against sky banding
// High quality only, and only the arena maps (a campaign layout keeps its look). The first-person
// hand is drawn afterwards, straight to the screen, so it keeps its own colours.
//
// ?post=0 in the page URL draws the arenas without it (for matched before/after review).
import * as THREE from 'three';

export function postWanted(): boolean {
  try { return typeof location === 'undefined' || new URLSearchParams(location.search).get('post') !== '0'; } catch { return true; }
}

export interface Grade {
  /** Glow strength and the brightness above which things glow. */
  bloom: number; threshold: number;
  /** Light-shaft strength (0 = none). */
  shafts: number;
  /** Tints (multipliers) for shade and light. */
  shadow: [number, number, number]; light: [number, number, number];
  /** Vibrance (1 = unchanged), contrast around mid grey, sharpen amount, colour fringing (uv at the corner), corner darkening. */
  saturation: number; contrast: number; sharpen: number; fringe: number; vignette: number;
  /** The visible sun disc's world position (for the shafts); the world fills it in. */
  sunPos?: [number, number, number];
}

/** A grade per lighting theme (the maps keep their own identity). */
export function gradeFor(theme: string): Grade {
  switch (theme) {
    case 'dusk': return { bloom: 0.9, threshold: 0.55, shafts: 0.7, shadow: [1.05, 0.92, 1.16], light: [1.12, 0.98, 0.84], saturation: 1.28, contrast: 1.14, sharpen: 0.4, fringe: 0.0016, vignette: 0.38 };
    case 'noon': return { bloom: 0.45, threshold: 0.72, shafts: 0.3, shadow: [0.95, 0.98, 1.07], light: [1.05, 1.01, 0.94], saturation: 1.18, contrast: 1.1, sharpen: 0.35, fringe: 0.0012, vignette: 0.26 };
    case 'morning': return { bloom: 0.5, threshold: 0.7, shafts: 0.4, shadow: [0.95, 0.98, 1.07], light: [1.06, 1.01, 0.92], saturation: 1.18, contrast: 1.1, sharpen: 0.35, fringe: 0.0012, vignette: 0.26 };
    default: return { bloom: 0.7, threshold: 0.62, shafts: 0.55, shadow: [0.94, 0.95, 1.1], light: [1.1, 1.0, 0.88], saturation: 1.22, contrast: 1.12, sharpen: 0.38, fringe: 0.0015, vignette: 0.32 };
  }
}

const VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform sampler2D tScene;
uniform vec2 uTexel, uSunUV;
uniform float uBloom, uThr, uShaft, uSunVis, uSat, uCon, uSharp, uFringe, uVig, uAspect;
uniform vec3 uShadow, uLight;
varying vec2 vUv;
layout(location = 0) out highp vec4 fragColor;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Glow: four taps at each of five coarse mip levels, soft-thresholded, wider levels weighing more.
vec3 glowAt(vec2 uv) {
  vec3 acc = vec3(0.0); float ws = 0.0;
  for (int i = 0; i < 5; i++) {
    float lod = 1.0 + float(i);
    vec2 o = uTexel * exp2(lod) * 0.8;
    vec3 s = textureLod(tScene, uv + vec2( o.x,  o.y), lod).rgb + textureLod(tScene, uv + vec2(-o.x,  o.y), lod).rgb
           + textureLod(tScene, uv + vec2( o.x, -o.y), lod).rgb + textureLod(tScene, uv + vec2(-o.x, -o.y), lod).rgb;
    s *= 0.25;
    float w = 0.6 + float(i) * 0.35;
    acc += s * smoothstep(uThr, uThr + 0.3, luma(s)) * w; ws += w;
  }
  return acc / ws;
}

// Light shafts: smear the bright parts of the (coarse) image toward the sun.
vec3 shaftsAt(vec2 uv) {
  if (uShaft <= 0.0 || uSunVis <= 0.0) return vec3(0.0);
  vec2 toSun = uSunUV - uv;
  float dist = length(toSun * vec2(uAspect, 1.0));
  vec2 stepv = toSun / 28.0 * 0.85;
  vec2 p = uv; float decay = 1.0; vec3 acc = vec3(0.0);
  for (int i = 0; i < 28; i++) {
    p += stepv;
    vec3 s = textureLod(tScene, p, 2.0).rgb;
    acc += s * smoothstep(uThr + 0.12, uThr + 0.4, luma(s)) * decay;
    decay *= 0.955;
  }
  return acc / 28.0 * exp(-dist * 1.3) * uShaft * uSunVis;
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  // Lens: red and blue sampled a hair apart, more toward the corners.
  vec2 off = (vUv - 0.5) * uFringe * dot(vUv - 0.5, vUv - 0.5) * 4.0;
  vec3 c = vec3(texture(tScene, vUv + off).r, texture(tScene, vUv).g, texture(tScene, vUv - off).b);
  // Sharpen (contrast-adaptive: less on strong edges, so no halos on the toon outlines).
  vec3 blur = (texture(tScene, vUv + vec2(uTexel.x, 0.0)).rgb + texture(tScene, vUv - vec2(uTexel.x, 0.0)).rgb
             + texture(tScene, vUv + vec2(0.0, uTexel.y)).rgb + texture(tScene, vUv - vec2(0.0, uTexel.y)).rgb) * 0.25;
  vec3 d = c - blur;
  c += clamp(d, -0.08, 0.08) * uSharp * 4.0;
  // Glow and shafts, warm-tinted.
  c += glowAt(vUv) * uBloom * vec3(1.05, 0.98, 0.9);
  c += shaftsAt(vUv) * vec3(1.1, 0.95, 0.75);
  // Soft shoulder above 0.8 so the glow rolls off instead of clipping.
  vec3 hi = max(c - 0.8, 0.0);
  c = min(c, 0.8) + (1.0 - exp(-hi / 0.35)) * 0.35;
  c = pow(max(c, 0.0), vec3(1.0 / 2.2));           // to display space for the grade
  float l = luma(c);
  c *= mix(uShadow, uLight, smoothstep(0.12, 0.85, l));
  // Vibrance: dull colours gain most.
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  c = mix(vec3(luma(c)), c, 1.0 + (uSat - 1.0) * (1.0 - clamp((mx - mn) * 1.4, 0.0, 1.0)));
  c = clamp((c - 0.5) * uCon + 0.5, 0.0, 1.0);
  vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
  c *= 1.0 - uVig * smoothstep(0.3, 1.0, length(q) * 1.15);
  c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  // The renderer's output is sRGB: write display values, the page's colour space is the same.
  fragColor = vec4(c, 1.0);
}
`;

export class PostFx {
  private target: THREE.WebGLRenderTarget | null = null;
  private readonly quad: THREE.Mesh;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly scene = new THREE.Scene();
  private readonly mat: THREE.ShaderMaterial;
  private readonly size = new THREE.Vector2();
  private readonly sun = new THREE.Vector3();

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tScene: { value: null }, uTexel: { value: new THREE.Vector2(1, 1) }, uSunUV: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1.6 },
        uBloom: { value: 0 }, uThr: { value: 0.7 }, uShaft: { value: 0 }, uSunVis: { value: 0 }, uSat: { value: 1 }, uCon: { value: 1 },
        uSharp: { value: 0 }, uFringe: { value: 0 }, uVig: { value: 0 },
        uShadow: { value: new THREE.Vector3(1, 1, 1) }, uLight: { value: new THREE.Vector3(1, 1, 1) },
      },
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** Where the sun is on screen (uv), and how much of it counts (0 behind the camera or far off screen). */
  private sunOnScreen(camera: THREE.Camera, g: Grade): { u: number; v: number; vis: number } {
    if (!g.sunPos || g.shafts <= 0) return { u: 0.5, v: 0.5, vis: 0 };
    camera.updateMatrixWorld();
    this.sun.set(...g.sunPos).applyMatrix4(camera.matrixWorldInverse);
    if (this.sun.z >= -1) return { u: 0.5, v: 0.5, vis: 0 }; // behind the camera
    this.sun.set(...g.sunPos).project(camera as THREE.PerspectiveCamera);
    const edge = Math.max(Math.abs(this.sun.x), Math.abs(this.sun.y));
    return { u: this.sun.x * 0.5 + 0.5, v: this.sun.y * 0.5 + 0.5, vis: 1 - THREE.MathUtils.smoothstep(edge, 0.9, 1.7) };
  }

  /** Draws the world through the pass to the screen. */
  render(scene: THREE.Scene, camera: THREE.Camera, g: Grade): void {
    this.renderer.getDrawingBufferSize(this.size);
    // A very large screen (a Retina laptop at full pixel ratio) is drawn a little under native: the target holds
    // half-float colour, multisampled, so it is capped near 2.6 megapixels (about 90 MB), the pass upscales it.
    const scale = Math.min(1, Math.sqrt(2.6e6 / Math.max(1, this.size.x * this.size.y)));
    const w = Math.max(1, Math.round(this.size.x * scale)), h = Math.max(1, Math.round(this.size.y * scale));
    if (!this.target || this.target.width !== w || this.target.height !== h) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType, samples: w * h > 1.6e6 ? 2 : 4, depthBuffer: true, generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      });
      this.target.texture.name = 'post-scene';
    }
    const u = this.mat.uniforms, s = this.sunOnScreen(camera, g);
    u.tScene!.value = this.target.texture;
    (u.uTexel!.value as THREE.Vector2).set(1 / w, 1 / h);
    (u.uSunUV!.value as THREE.Vector2).set(s.u, s.v);
    u.uSunVis!.value = s.vis;
    u.uAspect!.value = w / h;
    u.uBloom!.value = g.bloom; u.uThr!.value = g.threshold; u.uShaft!.value = g.shafts; u.uSat!.value = g.saturation; u.uCon!.value = g.contrast;
    u.uSharp!.value = g.sharpen; u.uFringe!.value = g.fringe; u.uVig!.value = g.vignette;
    (u.uShadow!.value as THREE.Vector3).set(...g.shadow); (u.uLight!.value as THREE.Vector3).set(...g.light);
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(prev);
    this.renderer.render(this.scene, this.cam);
  }

  /** The target's memory goes back when the pass is not in use (a quality change, a campaign layout). */
  release(): void {
    if (!this.target) return;
    this.target.dispose();
    this.target = null;
  }

  /** An estimate of the bytes the target holds now (for the cost record). */
  bytes(): number {
    const t = this.target;
    return t ? Math.round(t.width * t.height * (8 * (4 / 3) + (8 + 4) * t.samples)) : 0; // resolved colour with mips, plus multisampled colour and depth
  }

  dispose(): void {
    this.release();
    this.quad.geometry.dispose();
    this.mat.dispose();
  }
}
