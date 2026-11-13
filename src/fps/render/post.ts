// The final image: one full-screen pass that gives each arena its colour mood and a soft glow. The
// world is drawn into an off-screen target (multisampled, half-float, so highlights keep their
// headroom), then one shader reads it:
//   glow        the target's own mip levels, thresholded: the sun, string lights, lamps and bright
//               plaster bloom softly. No blur chain: a few taps at four coarse levels.
//   grade       split-toning (cool or violet shade, warm light), a little more colour, a gentle S curve
//   vignette    a slow darkening toward the corners, kept off the centre of the screen
//   dither      a one-step noise, so the sky gradients do not band
// High quality only, and only the arena maps (a campaign layout keeps its look). The first-person
// hand is drawn afterwards, straight to the screen, so it keeps its own colours. Nothing here moves a
// pixel: the glow is the only thing that spreads, and it is faint.
//
// ?post=0 in the page URL draws the arenas without it (for matched before/after review).
import * as THREE from 'three';

export function postWanted(): boolean {
  try { return typeof location === 'undefined' || new URLSearchParams(location.search).get('post') !== '0'; } catch { return true; }
}

export interface Grade {
  /** Glow strength and the brightness (display-linear) above which things glow. */
  bloom: number; threshold: number;
  /** Tints (multipliers) for shade and light. */
  shadow: [number, number, number]; light: [number, number, number];
  /** Colour amount (1 = unchanged), contrast around mid grey (1 = unchanged), corner darkening. */
  saturation: number; contrast: number; vignette: number;
}

/** A grade per lighting theme (the maps keep their own identity; the numbers are small on purpose). */
export function gradeFor(theme: string): Grade {
  switch (theme) {
    case 'dusk': return { bloom: 0.55, threshold: 0.62, shadow: [1.03, 0.95, 1.1], light: [1.07, 0.99, 0.9], saturation: 1.12, contrast: 1.07, vignette: 0.26 };
    case 'noon': return { bloom: 0.26, threshold: 0.78, shadow: [0.97, 0.99, 1.04], light: [1.03, 1.0, 0.96], saturation: 1.08, contrast: 1.05, vignette: 0.15 };
    case 'morning': return { bloom: 0.3, threshold: 0.75, shadow: [0.97, 0.99, 1.04], light: [1.03, 1.0, 0.95], saturation: 1.08, contrast: 1.05, vignette: 0.15 };
    default: return { bloom: 0.4, threshold: 0.7, shadow: [0.97, 0.96, 1.06], light: [1.06, 1.0, 0.92], saturation: 1.1, contrast: 1.06, vignette: 0.2 };
  }
}

const VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform sampler2D tScene;
uniform vec2 uTexel;
uniform float uBloom, uThr, uSat, uCon, uVig, uAspect;
uniform vec3 uShadow, uLight;
varying vec2 vUv;
layout(location = 0) out highp vec4 fragColor;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Glow: four taps at each of four coarse mip levels, soft-thresholded.
vec3 glowAt(vec2 uv) {
  vec3 acc = vec3(0.0); float ws = 0.0;
  for (int i = 0; i < 4; i++) {
    float lod = 2.0 + float(i);
    vec2 o = uTexel * exp2(lod) * 0.7;
    vec3 s = textureLod(tScene, uv + vec2( o.x,  o.y), lod).rgb + textureLod(tScene, uv + vec2(-o.x,  o.y), lod).rgb
           + textureLod(tScene, uv + vec2( o.x, -o.y), lod).rgb + textureLod(tScene, uv + vec2(-o.x, -o.y), lod).rgb;
    s *= 0.25;
    float w = 1.0 / (1.0 + float(i) * 0.6);
    acc += s * w; ws += w;
  }
  vec3 c = acc / ws;
  float l = luma(c);
  return c * smoothstep(uThr, uThr + 0.35, l);
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec3 c = texture(tScene, vUv).rgb;
  c += glowAt(vUv) * uBloom;
  c = pow(max(c, 0.0), vec3(1.0 / 2.2));           // to display space for the grade
  float l = luma(c);
  c *= mix(uShadow, uLight, smoothstep(0.15, 0.85, l));
  c = mix(vec3(luma(c)), c, uSat);
  c = clamp((c - 0.5) * uCon + 0.5, 0.0, 1.0);
  vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
  c *= 1.0 - uVig * smoothstep(0.35, 1.0, length(d) * 1.15);
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

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tScene: { value: null }, uTexel: { value: new THREE.Vector2(1, 1) }, uAspect: { value: 1.6 },
        uBloom: { value: 0 }, uThr: { value: 0.7 }, uSat: { value: 1 }, uCon: { value: 1 }, uVig: { value: 0 },
        uShadow: { value: new THREE.Vector3(1, 1, 1) }, uLight: { value: new THREE.Vector3(1, 1, 1) },
      },
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
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
    const u = this.mat.uniforms;
    u.tScene!.value = this.target.texture;
    (u.uTexel!.value as THREE.Vector2).set(1 / w, 1 / h);
    u.uAspect!.value = w / h;
    u.uBloom!.value = g.bloom; u.uThr!.value = g.threshold; u.uSat!.value = g.saturation; u.uCon!.value = g.contrast; u.uVig!.value = g.vignette;
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
