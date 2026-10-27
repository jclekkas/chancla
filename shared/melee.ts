// Close combat: the contact test for a melee swing. Pure geometry, shared by
// the authoritative simulation (server and in-browser practice host) and the
// tests. Tuning lives in config.ts (MELEE).
//
// A swing is a short forward sweep from the attacker's eye. A target is hit
// when, during the attack's contact window, some point of its body is:
//   * within `reach` of the eye (measured to the body's surface),
//   * inside the horizontal sweep (`arcRad` either side of where the attacker
//     looks, widened by the target's own width at that distance),
//   * at a height the swing passes: the view ray's height at the target,
//     clamped onto the body, at most `vReach` above or below it,
//   * in plain sight: any wall or box between the eye and the contact point
//     blocks the hit (swinging over a low crate is fine).
// The contact point is where the sweep meets the body. Whether it is a head
// hit is read from that point against the target's real head (stance,
// crouch and jump included), never from the aim alone.
import { lineOfSight, type Vec3Like } from './collision';
import type { AABB } from './collision';
import type { MeleeDef } from './config';

export interface MeleeTarget {
  id: number;
  // Body capsule axis (x, z, y0..y1, radius r) and head sphere (hx, hy, hz, hr),
  // as hitboxOf() builds them.
  x: number; z: number; y0: number; y1: number; r: number;
  hx: number; hy: number; hz: number; hr: number;
}

export interface MeleeContact {
  id: number;
  head: boolean;
  p: [number, number, number];
  /** Angle between the view direction and the contact, radians (for choosing between two targets). */
  off: number;
  dist: number;
}

const E: Vec3Like = { x: 0, y: 0, z: 0 };
const P: Vec3Like = { x: 0, y: 0, z: 0 };

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** The contact this swing makes with one target right now, or null. */
export function meleeContactOne(
  eye: Vec3Like, yaw: number, pitch: number, def: MeleeDef, t: MeleeTarget, boxes: readonly AABB[],
): MeleeContact | null {
  const dx = t.x - eye.x, dz = t.z - eye.z;
  const dh = Math.hypot(dx, dz);
  // Horizontal: the target's direction against the view direction, allowing
  // for its width (a body half in the sweep is in the sweep).
  const toward = Math.atan2(-dx, -dz);
  const off = dh < 1e-4 ? 0 : Math.abs(wrapAngle(toward - yaw));
  const halfWidth = dh < 1e-4 ? Math.PI : Math.atan2(t.r, dh);
  if (off - halfWidth > def.arcRad) return null;
  // Near surface of the body along the line from the eye.
  const s = Math.max(0, dh - t.r);
  // Height the swing passes at that distance, clamped onto the body. The
  // body spans the capsule (y0 - r .. y1 + r) and the head (up to hy + hr).
  const lift = Math.tan(Math.max(-1.2, Math.min(1.2, pitch))) * Math.max(0.25, s);
  const yAim = eye.y + lift;
  const bottom = t.y0 - t.r, top = t.hy + t.hr;
  if (yAim < bottom - def.vReach || yAim > top + def.vReach) return null;
  const yc = Math.max(bottom, Math.min(top, yAim));
  // Head or body at that height: the head sphere from its lower edge up.
  const head = yc >= t.hy - t.hr * 0.5;
  const rr = head ? t.hr : t.r;
  const ax = head ? t.hx : t.x, az = head ? t.hz : t.z;
  const hx = ax - eye.x, hz = az - eye.z;
  const hd = Math.hypot(hx, hz);
  P.x = hd > 1e-4 ? ax - (hx / hd) * rr : ax;
  P.y = yc;
  P.z = hd > 1e-4 ? az - (hz / hd) * rr : az;
  const dist = Math.hypot(P.x - eye.x, P.y - eye.y, P.z - eye.z);
  if (dist > def.reach) return null;
  // Walls and boxes between the eye and the contact block it.
  E.x = eye.x; E.y = eye.y; E.z = eye.z;
  if (!lineOfSight(E, P, boxes, (b) => b.tag !== 'floor')) return null;
  return { id: t.id, head, p: [P.x, P.y, P.z], off, dist };
}

/**
 * The one target this swing hits now: of every target it can reach, the one
 * nearest the view direction, then the nearest. At most one, ever: the
 * caller ends the swing on the first contact.
 */
export function meleeContact(
  eye: Vec3Like, yaw: number, pitch: number, def: MeleeDef, targets: readonly MeleeTarget[], boxes: readonly AABB[],
): MeleeContact | null {
  let best: MeleeContact | null = null;
  for (const t of targets) {
    const c = meleeContactOne(eye, yaw, pitch, def, t, boxes);
    if (!c) continue;
    if (!best || c.off < best.off - 0.05 || (Math.abs(c.off - best.off) <= 0.05 && c.dist < best.dist)) best = c;
  }
  return best;
}

/** Which attached rulero comes off first: the first one still attached, starting from a slot picked by the swing. */
export function pickRulero(mask: number, count: number, start: number): number {
  for (let k = 0; k < count; k++) {
    const i = (start + k) % count;
    if (mask & (1 << i)) return i;
  }
  return -1;
}
