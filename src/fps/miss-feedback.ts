// Feedback for your own confirmed miss (the server's 'whiff' event, never
// the prediction). The event arrives after the contact window ends, about
// one round trip after your press; by then your swing is in its
// follow-through. The miss is shown on top of the swing in progress (an
// overrun of the hand, a mark at the crosshair, the touch button), never by
// replaying the swing, and it fades out the later the event arrives.
import { MELEE, type WeaponId } from '../../shared/config';

/** Full strength up to this long after the contact window ends (ms). */
export const MISS_FULL_MS = 150;
/** The hand's overrun has faded out entirely by this lateness (ms). */
export const MISS_MOTION_MAX_MS = 450;
/** The crosshair mark and the touch button still show up to this lateness (ms). */
export const MISS_MARK_MAX_MS = 650;

export interface MissFeedback {
  /** 0..1: how strongly the hand overruns (0: not at all). */
  motion: number;
  /** Whether the crosshair mark and the touch button show. */
  mark: boolean;
}

const NONE: MissFeedback = { motion: 0, mark: false };

/**
 * What a confirmed miss with `weapon` shows, given the time since your own
 * latest swing started (`sinceSwingMs`) and the chancla it used. Nothing
 * when the miss cannot be the swing in hand: a newer swing has started
 * (it has not reached the end of its contact window yet), the weapons
 * differ, or it is too stale (a reconnect replaying old events).
 */
export function missFeedback(weapon: WeaponId, swingWeapon: WeaponId | null, sinceSwingMs: number): MissFeedback {
  if (swingWeapon !== weapon || !Number.isFinite(sinceSwingMs)) return NONE;
  const def = MELEE[weapon]!;
  const late = sinceSwingMs - (def.windupMs + def.activeMs);
  if (late < 0 || late > MISS_MARK_MAX_MS) return NONE;
  const motion = late <= MISS_FULL_MS ? 1 : Math.max(0, 1 - (late - MISS_FULL_MS) / (MISS_MOTION_MAX_MS - MISS_FULL_MS));
  return { motion, mark: true };
}
