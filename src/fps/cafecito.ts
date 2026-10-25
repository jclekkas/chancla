// Cafecito guidance: which cup (if any) deserves a hint, and the small label
// that names it on screen. The mechanic itself is the server's (shared/sim.ts:
// walk over a ready cup while hurt, +35 health, back after 20 s); this only
// explains it. Selection and placement are pure so they are unit tested
// (tests/cafecito.test.ts); CafecitoLabel is the thin DOM part.
import './minimap.css';

export type CafeState = 'walk' | 'full' | 'unavailable';

interface P3 { x: number; y: number; z: number }

/** Hints reach this far (m, horizontal). */
export const CAFE_RANGE = 8;
/** Lift from a cup's spot to the cup itself, for the line of sight test. */
const CUP_LIFT = 0.8;
/** Facing cone: cos of the widest angle off the view direction that still counts as in front (about 72 degrees). */
const FRONT_COS = 0.3;
/** Closer than this the cup is underfoot: no facing test. */
const UNDERFOOT = 1.2;

/**
 * The nearest cup worth a hint: within range, in front of you (not behind)
 * and in plain sight (`los` from your eye to the cup). `me.y` is the eye
 * height in world space. Its state says what to tell you: walk over it, you
 * are already at full health, or it is recharging. Null when none qualifies,
 * or when you are down.
 */
export function pickCafecitoGuide(
  me: { x: number; y: number; z: number; yaw: number; hp: number; maxHp: number; alive: boolean },
  cups: Array<{ x: number; y: number; z: number; ready: boolean }>,
  los: (from: P3, to: P3) => boolean,
  opts: { range?: number } = {},
): { i: number; state: CafeState } | null {
  if (!me.alive) return null;
  const range = opts.range ?? CAFE_RANGE;
  const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
  let best = -1, bestD = Infinity;
  const from = { x: me.x, y: me.y, z: me.z };
  for (let i = 0; i < cups.length; i++) {
    const c = cups[i]!;
    const dx = c.x - me.x, dz = c.z - me.z;
    const d = Math.hypot(dx, dz);
    if (d > range || d >= bestD) continue;
    if (d > UNDERFOOT && (dx * fx + dz * fz) / d < FRONT_COS) continue;
    if (!los(from, { x: c.x, y: c.y + CUP_LIFT, z: c.z })) continue;
    best = i; bestD = d;
  }
  if (best < 0) return null;
  const state: CafeState = !cups[best]!.ready ? 'unavailable' : me.hp >= me.maxHp ? 'full' : 'walk';
  return { i: best, state };
}

export interface Insets { t: number; r: number; b: number; l: number }

/** Space kept clear round the crosshair (half sizes, px): its 64 px ring and the hit and miss markers. */
export const CENTRE_CLEAR = { hx: 74, hy: 58 };
/** Extra margins inside the safe area: the score bar at the top, weapons and touch buttons at the bottom. */
const EDGE = { t: 64, r: 12, b: 104, l: 12 };
/** Gap between the label's bottom edge and the cup. */
const LIFT_PX = 18;

/**
 * Top-left corner for a lw x lh label naming the cup at screen (x, y) in a
 * vw x vh viewport: centred above the cup, pushed off the crosshair zone
 * (whichever way moves it least) and clamped inside the safe area.
 */
export interface Rect { left: number; top: number; right: number; bottom: number }

export function placeCafeLabel(x: number, y: number, lw: number, lh: number, vw: number, vh: number, safe: Insets = { t: 0, r: 0, b: 0, l: 0 }, avoid: readonly Rect[] = []): { left: number; top: number } {
  let left = x - lw / 2;
  let top = y - LIFT_PX - lh;
  const clampAll = () => {
    const minL = safe.l + EDGE.l, maxL = vw - safe.r - EDGE.r - lw;
    const minT = safe.t + EDGE.t, maxT = vh - safe.b - EDGE.b - lh;
    left = maxL < minL ? (vw - lw) / 2 : Math.min(Math.max(left, minL), maxL);
    top = maxT < minT ? minT : Math.min(Math.max(top, minT), maxT);
  };
  clampAll();
  const cx = vw / 2, cy = vh / 2, { hx, hy } = CENTRE_CLEAR;
  const hitsCentre = () => left < cx + hx && left + lw > cx - hx && top < cy + hy && top + lh > cy - hy;
  if (hitsCentre()) {
    const up = cy - hy - lh, down = cy + hy;
    top = Math.abs(up - top) <= Math.abs(down - top) ? up : down;
    clampAll();
    // Still on it (a tiny viewport): slide sideways instead.
    if (hitsCentre()) {
      const lft = cx - hx - lw, rgt = cx + hx;
      left = Math.abs(lft - left) <= Math.abs(rgt - left) ? lft : rgt;
      clampAll();
    }
  }
  // Name tags and HUD pieces: never on top of one.
  const hits = (l: number, t: number) => avoid.some((r) => l < r.right + 4 && l + lw > r.left - 4 && t < r.bottom + 4 && t + lh > r.top - 4)
    || (l < cx + hx && l + lw > cx - hx && t < cy + hy && t + lh > cy - hy);
  if (avoid.length && hits(left, top)) {
    // Candidates: under the cup, then just above, below or beside any tag or HUD piece, least moved first.
    const keepL = left, keepT = top;
    const tops = [keepT, y + LIFT_PX, ...avoid.flatMap((q) => [q.top - 6 - lh, q.bottom + 6])];
    const lefts = [keepL, ...avoid.flatMap((q) => [q.left - 6 - lw, q.right + 6])];
    const tries: Array<[number, number]> = [];
    for (const t of tops) for (const l of lefts) if (t !== keepT || l !== keepL) tries.push([l, t]);
    tries.sort((a, b) => Math.hypot(a[0] - keepL, a[1] - keepT) - Math.hypot(b[0] - keepL, b[1] - keepT));
    for (const [l, t] of tries) {
      left = l; top = t; clampAll();
      if (!hits(left, top)) return { left, top };
    }
    left = keepL; top = keepT;
  }
  return { left, top };
}

/** HUD pieces the hint keeps off, besides the name tags and the crosshair. */
const CHROME = '#hud .hud-ident, #minimap, #btn-menu, #ft-score, #hud .hud-bl';

/** The cup's hint on screen. One element, restyled in place; pointer events pass through. */
export class CafecitoLabel {
  private el: HTMLDivElement;
  private probe: HTMLDivElement;
  private safe: Insets | null = null;
  private text = '';
  private state: CafeState | '' = '';
  private size = { w: 0, h: 0 };
  private shown = false;
  private chromeRects: Rect[] | null = null;
  private chromeT = 0;
  private onResize = () => { this.safe = null; this.size.w = 0; this.chromeRects = null; };

  constructor(private root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'cafe-label';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.hidden = true;
    // Reads the --safe-* insets as pixels (env() is not readable from script directly).
    this.probe = document.createElement('div');
    this.probe.className = 'cafe-safe-probe';
    root.append(this.el, this.probe);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
  }

  private insets(): Insets {
    if (this.safe) return this.safe;
    const cs = getComputedStyle(this.probe);
    const px = (v: string) => parseFloat(v) || 0;
    this.safe = { t: px(cs.paddingTop), r: px(cs.paddingRight), b: px(cs.paddingBottom), l: px(cs.paddingLeft) };
    return this.safe;
  }

  /**
   * Fixed HUD pieces the hint must not cover (team and mode chips, minimap,
   * Menu and the touch Scores pill), relative to the root. Measured at most
   * twice a second, and again after a resize.
   */
  private chrome(): Rect[] {
    const now = performance.now();
    if (this.chromeRects && now - this.chromeT < 500) return this.chromeRects;
    this.chromeT = now;
    const base = this.root.getBoundingClientRect();
    const out: Rect[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(CHROME)) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) out.push({ left: r.left - base.left, top: r.top - base.top, right: r.right - base.left, bottom: r.bottom - base.top });
    }
    return (this.chromeRects = out);
  }

  /** (x, y): the cup's screen position in px, relative to the root. */
  show(x: number, y: number, text: string, state: CafeState, avoid: readonly Rect[] = []): void {
    if (text !== this.text) { this.el.textContent = text; this.text = text; this.size.w = 0; }
    if (state !== this.state) { this.el.className = `cafe-label ${state}`; this.state = state; }
    if (!this.shown) { this.el.hidden = false; this.shown = true; }
    if (!this.size.w) { this.size.w = this.el.offsetWidth; this.size.h = this.el.offsetHeight; }
    const vw = this.root.clientWidth || window.innerWidth, vh = this.root.clientHeight || window.innerHeight;
    const p = placeCafeLabel(x, y, this.size.w, this.size.h, vw, vh, this.insets(), [...avoid, ...this.chrome()]);
    this.el.style.transform = `translate(${p.left.toFixed(1)}px, ${p.top.toFixed(1)}px)`;
  }

  hide(): void {
    if (!this.shown) return;
    this.el.hidden = true;
    this.shown = false;
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    this.el.remove();
    this.probe.remove();
  }
}
