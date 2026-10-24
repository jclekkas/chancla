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

/** A server swing event further than this from the local press it would match is not that press (ms). */
export const MATCH_MAX_MS = 1000;
/** Slack allowed between the server's contact-window end and its 'whiff' time (ms, tick rounding). */
const WINDOW_SLACK_MS = 40;

/**
 * Ties your own confirmed misses to the swings they came from. Each swing
 * you start locally (predicted) is matched, in order, to the server's
 * 'swing' event for you (same chancla); the 'whiff' names the server swing
 * id, so it finds exactly that local swing. Feedback shows only for the
 * latest local swing, timed from its own start; whenever the
 * correspondence is uncertain (no match, a different chancla, a newer
 * swing, an expired press, timestamps that disagree) the cosmetic cue is
 * suppressed.
 */
export class OwnSwingLog {
  private pending: Array<{ weapon: WeaponId; at: number; k: number }> = [];
  private byId = new Map<number, { weapon: WeaponId; at: number; k: number; tm: number }>();
  private n = 0;

  /** You started a swing (predicted) at local time `at`. */
  localStart(weapon: WeaponId, at: number): void {
    this.n++;
    this.pending.push({ weapon, at, k: this.n });
    if (this.pending.length > 8) this.pending.shift();
  }

  /** The server says your swing `id` started (server time `tm`); it arrived at local time `at`. */
  serverSwing(id: number, weapon: WeaponId, tm: number, at: number): void {
    // A press older than MATCH_MAX_MS has expired: it was either rejected or
    // its confirmation is this very event, arriving late. The two cannot be
    // told apart, so the confirmation must not shift onto a newer press:
    // match nothing and start afresh.
    if (this.pending.length && at - this.pending[0]!.at > MATCH_MAX_MS) { this.pending.length = 0; return; }
    const head = this.pending[0];
    if (!head || head.weapon !== weapon || head.at > at) { this.pending.length = 0; return; } // out of step: match nothing
    this.pending.shift();
    this.byId.set(id, { weapon: head.weapon, at: head.at, k: head.k, tm });
    if (this.byId.size > 16) this.byId.delete(this.byId.keys().next().value!);
  }

  /** Swing `id` hit or was absorbed: it can no longer miss. */
  settled(id: number): void { this.byId.delete(id); }

  /** The server says swing `id` missed (server time `tm`), arriving at local time `at`: what to show. */
  miss(id: number, weapon: WeaponId, tm: number, at: number, inHand: WeaponId): MissFeedback {
    const s = this.byId.get(id);
    this.byId.delete(id);
    if (!s || s.weapon !== weapon || inHand !== weapon || s.k !== this.n) return NONE;
    const def = MELEE[weapon]!, window = def.windupMs + def.activeMs;
    if (Number.isFinite(tm) && Number.isFinite(s.tm) && Math.abs(tm - s.tm - window) > WINDOW_SLACK_MS) return NONE;
    // The swing is known by its id, so a miss arriving "early" (the local
    // swing was registered a frame after the server started it) is prompt.
    return missFeedback(weapon, s.weapon, Math.max(at - s.at, window));
  }

  /** Death, respawn, a new round or match: nothing carries over. */
  reset(): void { this.pending.length = 0; this.byId.clear(); }
}
