// The elimination replay ("killcam"): about 1.5 s around the blow that
// eliminated you, played back from what this client already received.
//
// Recording keeps a bounded rolling buffer of about 3.5 s: the snapshots'
// player records (by reference; the session never modifies them) and the
// confirmed combat events with their server times. A thrown chancla is
// drawn from the server's own throw, bounce and end events (where, when and
// how fast it left the hand), the way every client already draws other
// players' throws. Nothing is simulated, no attack is launched again,
// nothing is sent: playback only reads this buffer and draws it through the
// match renderer (engine.ts). Attribution comes from
// the server's own 'elim' event; the session has already dropped duplicate
// melee events, and the engine binds at most one elimination to each death.
//
// This module is pure (no DOM, no three.js), so it runs in Node tests.
import { MATCH, WEAPONS } from '../../shared/config';
import { lineOfSight, type AABB } from '../../shared/collision';
import { eyeHeight, newBody } from '../../shared/physics';
import type { SimEvent } from '../../shared/sim';
import type { Team } from '../../shared/map';
import { samplePlayers, type RemotePlayer, type SnapRecord } from '../net/session';

export const KILLCAM = {
  /** Shown before the finishing blow (ms). */
  leadMs: 1200,
  /** Shown after it (ms). */
  tailMs: 300,
  /** Shorter lead-ins than this are not worth showing: the death screen instead (ms). */
  minLeadMs: 600,
  /** How much history is kept (ms of server time). */
  keepMs: 3500,
  /** The existing death screen shows this long before the replay starts (ms). */
  beatMs: 800,
  /** No replay starts with less than this left before you can respawn (ms). */
  minLeftMs: 700,
  /** Hard caps on the buffer, whatever the timing. */
  maxSnaps: 90,
  maxEvents: 256,
} as const;

/** A confirmed event, with the server time it happened (or its snapshot's) and the snapshot it came in. */
export interface RecEvent { t: number; st: number; e: SimEvent }

/** A chancla in the air at some render time. */
export interface ProjItem { key: string; w: 0 | 1; x: number; y: number; z: number }

/** What the server said eliminated you, captured when it arrived (names survive a disconnect). */
export interface KillNote {
  killer: number;
  victim: number;
  w: 0 | 1;
  melee: boolean;
  m?: number;
  head: boolean;
  ru?: readonly number[];
  /** Server time of the snapshot that carried it. */
  st: number;
  name: string;
  team: Team | null;
}

const KEPT = new Set<SimEvent['k']>(['throw', 'bounce', 'pend', 'hit', 'elim', 'swing', 'whiff', 'shielded']);

function eventTime(e: SimEvent, st: number): number {
  return 'tm' in e && typeof e.tm === 'number' ? e.tm : st;
}

/** The bounded rolling buffer. Recording continues during a replay; a replay works on its own copy. */
export class KillcamRecorder {
  readonly snaps: SnapRecord[] = [];
  readonly events: RecEvent[] = [];

  snapshot(rec: SnapRecord): void {
    this.snaps.push(rec);
    const old = rec.st - KILLCAM.keepMs;
    while (this.snaps.length > KILLCAM.maxSnaps || (this.snaps.length > 1 && this.snaps[0]!.st < old)) this.snaps.shift();
    while (this.events.length && (this.events.length > KILLCAM.maxEvents || this.events[0]!.st < old)) this.events.shift();
  }

  event(e: SimEvent, st: number): void {
    if (!KEPT.has(e.k)) return;
    this.events.push({ t: eventTime(e, st), st, e });
    if (this.events.length > KILLCAM.maxEvents) this.events.shift();
  }

  /** A new match or round: nothing carries over. */
  reset(): void {
    this.snaps.length = 0;
    this.events.length = 0;
  }

  /** Entries held (tests, diagnostics, the cost report). */
  get size(): { snaps: number; events: number } {
    return { snaps: this.snaps.length, events: this.events.length };
  }
}

/**
 * attacker: from her eyes (throws she could see you for); melee: a framed
 * three-quarter view of both of you, so her swing, you and the contact show;
 * third: behind you, facing her.
 */
export type View = 'attacker' | 'melee' | 'third';

export interface Clip {
  /** Render-timeline span (server ms): playback runs from start to end. */
  start: number;
  end: number;
  tKill: number;
  killer: number;
  victim: number;
  view: View;
  note: KillNote;
  snaps: SnapRecord[];
  events: RecEvent[];
  /** For the melee view: which side of the attacker the camera sits (+1 her right, -1 her left). */
  camSide: 1 | -1;
  /** The finishing swing's id, or the finishing projectile's id (for the attack cue). */
  finishSwing?: number;
  finishThrow?: number;
}

export type ClipResult = { clip: Clip } | { wait: true } | { fallback: 'self' | 'unknown-killer' | 'short-history' };

/**
 * The clip for an elimination, or why there is none. `wait`: the buffer has
 * not yet reached the end of the clip (call again on a later frame).
 */
export function buildClip(rec: KillcamRecorder, note: KillNote, boxes: readonly AABB[]): ClipResult {
  if (note.killer < 0 || note.killer === note.victim) return { fallback: 'self' };
  const ev = rec.events;
  let tKill = note.st;
  let finishSwing: number | undefined, finishThrow: number | undefined;
  if (note.melee && note.m !== undefined) {
    const hit = ev.find((r) => r.e.k === 'hit' && r.e.m === note.m && r.e.v === note.victim);
    if (hit) tKill = hit.t;
    finishSwing = note.m;
  } else {
    // A thrown chancla: the end of the projectile that hit, in the same snapshot.
    const owners = new Map<number, number>();
    for (const r of ev) if (r.e.k === 'throw') owners.set(r.e.id, r.e.o);
    const ends = ev.filter((r) => r.st === note.st && r.e.k === 'pend' && owners.get(r.e.id) === note.killer);
    const end = ends.find((r) => r.e.k === 'pend' && r.e.r === 'player') ?? ends[0];
    if (end && end.e.k === 'pend') { tKill = end.t; finishThrow = end.e.id; }
  }
  const snaps = rec.snaps;
  if (!snaps.length) return { fallback: 'short-history' };
  const end = tKill + KILLCAM.tailMs;
  if (snaps[snaps.length - 1]!.st < end + 50) return { wait: true };
  const start = Math.max(tKill - KILLCAM.leadMs, snaps[0]!.st);
  if (tKill - start < KILLCAM.minLeadMs) return { fallback: 'short-history' };
  const clipSnaps = snaps.filter((s, i) => s.st >= start - 120 && (s.st <= end + 120 || (i > 0 && snaps[i - 1]!.st <= end)));
  // The killer must be in the recorded history at the blow; otherwise nobody is known to show.
  const at = sampleAt(clipSnaps, tKill);
  const k = at.get(note.killer), v = at.get(note.victim);
  if (!k || !v) return { fallback: 'unknown-killer' };
  // Melee: the swing is the point, and from her own eyes neither her body nor
  // her hand shows it, so a framed view of both. Throws: her eyes when she saw you.
  const framed = note.melee ? meleeCamera(k, v, boxes) : null;
  const clip: Clip = {
    start, end, tKill, killer: note.killer, victim: note.victim, note,
    view: framed?.ok ? 'melee' : !note.melee && attackerViewOk(clipSnaps, start, tKill, note.killer, note.victim, boxes) ? 'attacker' : 'third',
    camSide: framed?.side ?? 1,
    snaps: clipSnaps,
    events: ev.filter((r) => r.t >= start - KILLCAM.keepMs && r.t <= end),
    finishSwing, finishThrow,
  };
  return { clip };
}

/** Everyone in the recorded snapshots at render time `rt` (a fresh map). */
export function sampleAt(snaps: readonly SnapRecord[], rt: number, out = new Map<number, RemotePlayer>()): Map<number, RemotePlayer> {
  samplePlayers(snaps, rt, -1, out);
  // Players that had left by the newer snapshot are not drawn.
  const b = newestAtOrAfter(snaps, rt);
  if (b) for (const id of [...out.keys()]) if (!b.players.has(id)) out.delete(id);
  return out;
}

function newestAtOrAfter(snaps: readonly SnapRecord[], rt: number): SnapRecord | undefined {
  for (let i = snaps.length - 1; i >= 0; i--) if (snaps[i]!.st <= rt) return snaps[Math.min(i + 1, snaps.length - 1)];
  return snaps[0];
}

const isBlocker = (b: AABB) => b.tag !== 'floor';

export function eyeOf(p: RemotePlayer): { x: number; y: number; z: number } {
  const b = newBody(p.x, p.y, p.z);
  b.crouched = p.crouched;
  return { x: p.x, y: p.y + eyeHeight(b), z: p.z };
}

/**
 * The attacker's own view is used when the recording supports it: she is
 * in the history from the clip's start, alive at the blow, and you were in
 * her line of sight then (a lob over cover, or a splash round a corner,
 * falls back to the third-person view).
 */
function attackerViewOk(snaps: readonly SnapRecord[], start: number, tKill: number, killer: number, victim: number, boxes: readonly AABB[]): boolean {
  const s0 = sampleAt(snaps, start).get(killer);
  const at = sampleAt(snaps, tKill);
  const k = at.get(killer), v = at.get(victim);
  if (!s0 || !k || !v || !k.alive) return false;
  return lineOfSight(eyeOf(k), { x: v.x, y: v.y + 1.0, z: v.z }, boxes, isBlocker);
}

/**
 * A clear third-person view of the victim, facing the attacker: behind and
 * a little above her, pulled in until nothing is between her eyes and the
 * camera (no wall clipping, and no view from a spot she could not see from).
 */
export function thirdPersonCamera(victim: RemotePlayer, killer: RemotePlayer | undefined, boxes: readonly AABB[]): { pos: { x: number; y: number; z: number }; look: { x: number; y: number; z: number } } {
  const eye = eyeOf(victim);
  let dx = killer ? killer.x - victim.x : -Math.sin(victim.yaw), dz = killer ? killer.z - victim.z : -Math.cos(victim.yaw);
  const l = Math.hypot(dx, dz) || 1;
  dx /= l; dz /= l;
  const look = { x: victim.x + dx * 2.5, y: eye.y - 0.25, z: victim.z + dz * 2.5 };
  for (let d = 2.8; d >= 0.6; d -= 0.2) {
    const pos = { x: victim.x - dx * d, y: eye.y + 0.35 + d * 0.15, z: victim.z - dz * d };
    // Clear of every wall and a margin past it (the near plane is 5 cm).
    const probe = { x: victim.x - dx * (d + 0.3), y: pos.y, z: victim.z - dz * (d + 0.3) };
    if (lineOfSight(eye, probe, boxes, isBlocker) && !insideBox(pos, boxes)) return { pos, look };
  }
  return { pos: { x: eye.x - dx * 0.3, y: eye.y + 0.2, z: eye.z - dz * 0.3 }, look };
}

/**
 * A three-quarter view of a melee exchange: behind and to one side of the
 * attacker, looking past her shoulder at the victim's face, so her recorded
 * forehand or backhand, the victim and the contact are all in frame. Her
 * right side first (where both swings start or finish in view), then her
 * left, each pulled in until the camera is clear of every wall and both of
 * them are in plain sight from it. `side` keeps the side chosen at the blow
 * for the whole replay; `ok` is false when no such spot exists.
 */
export function meleeCamera(attacker: RemotePlayer, victim: RemotePlayer, boxes: readonly AABB[], side?: 1 | -1): { pos: { x: number; y: number; z: number }; look: { x: number; y: number; z: number }; side: 1 | -1; ok: boolean } {
  let fx = victim.x - attacker.x, fz = victim.z - attacker.z;
  const l = Math.hypot(fx, fz) || 1;
  fx /= l; fz /= l;
  const rx = -fz, rz = fx; // her right, facing the victim
  const ay = attacker.y + 1.2, vy = victim.y + 1.35;
  const look = { x: attacker.x + fx * l * 0.62, y: (ay + vy) / 2 + 0.1, z: attacker.z + fz * l * 0.62 };
  const mid = { x: (attacker.x + victim.x) / 2, y: look.y, z: (attacker.z + victim.z) / 2 };
  for (const sd of side ? [side] : ([1, -1] as const)) {
    for (let k = 1; k >= 0.45; k -= 0.05) {
      const pos = { x: attacker.x - fx * 1.2 * k + rx * sd * 1.45 * k, y: 1.75 + 0.2 * k + attacker.y, z: attacker.z - fz * 1.2 * k + rz * sd * 1.45 * k };
      const probe = { x: pos.x + (pos.x - mid.x) * 0.15, y: pos.y, z: pos.z + (pos.z - mid.z) * 0.15 };
      if (insideBox(pos, boxes) || !lineOfSight(mid, probe, boxes, isBlocker)) continue;
      if (!lineOfSight(pos, { x: attacker.x, y: ay, z: attacker.z }, boxes, isBlocker) || !lineOfSight(pos, { x: victim.x, y: vy, z: victim.z }, boxes, isBlocker)) continue;
      return { pos, look, side: sd, ok: true };
    }
  }
  return { pos: { x: mid.x, y: mid.y + 1, z: mid.z }, look, side: side ?? 1, ok: false };
}

function insideBox(p: { x: number; y: number; z: number }, boxes: readonly AABB[]): boolean {
  const m = 0.15;
  return boxes.some((b) => isBlocker(b) && p.x > b.minX - m && p.x < b.maxX + m && p.y > b.minY - m && p.y < b.maxY + m && p.z > b.minZ - m && p.z < b.maxZ + m);
}

/**
 * Plays a clip: what is on screen at each render time, and the recorded
 * events due since the last call (each exactly once).
 */
export class ClipCursor {
  private next = 0;
  private players = new Map<number, RemotePlayer>();
  /** Each recorded throw: its flight segments (the throw, then any bounce) and its end. */
  private tracks: Array<{ key: string; w: 0 | 1; segs: Array<{ t: number; p: readonly number[]; v: readonly number[] }>; end: number; endP: readonly number[] | null }> = [];
  private out: ProjItem[] = [];
  constructor(readonly clip: Clip) {
    // Events before the start have already happened: they never fire.
    while (this.next < clip.events.length && clip.events[this.next]!.t < clip.start) this.next++;
    const byId = new Map<number, (typeof this.tracks)[number]>();
    for (const r of clip.events) {
      const e = r.e;
      if (e.k === 'throw') {
        const tr = { key: `t${e.id}`, w: e.w === 1 ? 1 as const : 0 as const, segs: [{ t: e.tm, p: e.p, v: e.v }], end: e.tm + WEAPONS[e.w]!.lifeMs, endP: null as readonly number[] | null };
        byId.set(e.id, tr);
        this.tracks.push(tr);
      } else if (e.k === 'bounce') byId.get(e.id)?.segs.push({ t: e.tm, p: e.p, v: e.v });
      else if (e.k === 'pend') { const tr = byId.get(e.id); if (tr) { tr.end = e.tm; tr.endP = e.p; } }
    }
  }

  playersAt(rt: number): Map<number, RemotePlayer> { return sampleAt(this.clip.snaps, rt, this.players); }

  /** Events due by `rt`, in order, each once. */
  due(rt: number): RecEvent[] {
    const out: RecEvent[] = [];
    const ev = this.clip.events;
    while (this.next < ev.length && ev[this.next]!.t <= rt) out.push(ev[this.next++]!);
    return out;
  }

  /**
   * Chanclas in the air at `rt`: each from its recorded launch (or last
   * bounce) point and velocity under its weapon's gravity, until its
   * recorded end. Only throws in the recording are drawn.
   */
  projectilesAt(rt: number): readonly ProjItem[] {
    const out = this.out;
    out.length = 0;
    for (const tr of this.tracks) {
      if (rt < tr.segs[0]!.t || rt >= tr.end) continue;
      let s = tr.segs[0]!;
      for (const x of tr.segs) if (x.t <= rt) s = x;
      const dt = (rt - s.t) / 1000, g = WEAPONS[tr.w]!.gravity;
      let x = s.p[0]! + s.v[0]! * dt, y = s.p[1]! + s.v[1]! * dt - 0.5 * g * dt * dt, z = s.p[2]! + s.v[2]! * dt;
      // The server steps in ticks: over the last 50 ms it is eased onto the recorded end point, so the impact is exactly where it hit.
      const e = tr.endP, k = e ? 1 - (tr.end - rt) / 50 : 0;
      if (e && k > 0) { x += (e[0]! - x) * k; y += (e[1]! - y) * k; z += (e[2]! - z) * k; }
      out.push({ key: tr.key, w: tr.w, x, y, z });
    }
    return out;
  }
}

/** The note for an 'elim' event, with the attacker's name and team as they were then. */
export function noteFrom(e: Extract<SimEvent, { k: 'elim' }>, st: number, members: ReadonlyArray<{ id: number; name: string; team: Team }>): KillNote {
  const m = members.find((x) => x.id === e.a);
  return { killer: e.a, victim: e.v, w: e.w === 1 ? 1 : 0, melee: e.m !== undefined, m: e.m, head: !!e.head, ru: e.ru, st, name: m?.name ?? '', team: m?.team ?? null };
}

export type FallbackReason = 'self' | 'unknown-killer' | 'short-history' | 'late' | 'off';

/**
 * Decides when a replay plays, from the authoritative elimination and your
 * own deaths. At most one replay per death: a repeated or resent 'elim'
 * event, or one that arrives after you have respawned, starts nothing. The
 * existing death screen shows first (KILLCAM.beatMs); a replay that would
 * not fit before respawn, or that has no usable history, leaves the death
 * screen as it is.
 */
export class KillcamDirector {
  readonly rec = new KillcamRecorder();
  private note: KillNote | null = null;
  private pending: KillNote | null = null;
  private deathSt: number | null = null;
  private deadSince = 0;
  private decided = false;
  /** Replays started, eliminations ignored as repeats, and why a death had no replay (tests, diagnostics). */
  readonly counts = { started: 0, repeats: 0, stale: 0, fallback: {} as Partial<Record<FallbackReason, number>> };
  lastFallback: FallbackReason | null = null;

  constructor(private me: () => number) {}

  /** An 'elim' event naming you as the victim (st: its snapshot's server time). */
  onElim(note: KillNote): void {
    if (note.victim !== this.me()) return;
    // The same elimination again (a resent snapshot), while it is still the current one.
    if (this.note || (this.pending && this.deathSt === null && Math.abs(note.st - this.pending.st) < 1000)) { this.counts.repeats++; return; }
    if (this.deathSt !== null) {
      if (this.belongs(note)) this.note = note; else this.counts.stale++;
      return;
    }
    this.pending = note; // the death itself shows on the next frame
  }

  /** You were eliminated (alive went false), seen in the snapshot at server time `st`. */
  onDeath(st: number, now: number): void {
    this.deathSt = st;
    this.deadSince = now;
    this.decided = false;
    this.note = null;
    if (this.pending) {
      if (this.belongs(this.pending)) this.note = this.pending; else this.counts.stale++;
      this.pending = null;
    }
  }

  /** You are back in play (or the round, match or connection reset): nothing carries over. */
  onRespawn(): void {
    this.note = this.pending = null;
    this.deathSt = null;
    this.decided = false;
  }

  private belongs(n: KillNote): boolean {
    const d = this.deathSt!;
    return n.st >= d - 250 && n.st <= d + 1000;
  }

  /** While you are down: a clip to start now, or null. Each death decides once. */
  poll(now: number, respawnInMs: number, enabled: boolean, boxes: readonly AABB[]): Clip | null {
    if (this.decided || this.deathSt === null) return null;
    if (!enabled) return this.fallback('off');
    if (now - this.deadSince < KILLCAM.beatMs) return null;
    // Waiting (for a delayed elimination, or for the history to reach the
    // end of the clip) goes on only while a replay would still fit before respawn.
    if (!replayFits(respawnInMs)) return this.fallback(this.note ? 'late' : 'unknown-killer');
    if (!this.note) return null;
    const r = buildClip(this.rec, this.note, boxes);
    if ('wait' in r) return null;
    if ('fallback' in r) return this.fallback(r.fallback);
    this.decided = true;
    this.lastFallback = null;
    this.counts.started++;
    return r.clip;
  }

  private fallback(why: FallbackReason): null {
    this.decided = true;
    this.lastFallback = why;
    this.counts.fallback[why] = (this.counts.fallback[why] ?? 0) + 1;
    return null;
  }

  /** A new match or round: the buffer and any death state are dropped. */
  reset(): void { this.rec.reset(); this.onRespawn(); }
}

/** The string keys naming the attack ("El Revés", "La Chancla, thrown"). */
export function attackKey(w: 0 | 1, melee: boolean): 'killcam.chanclazo' | 'killcam.reves' | 'killcam.thrown0' | 'killcam.thrown1' {
  return melee ? (w === 1 ? 'killcam.reves' : 'killcam.chanclazo') : (w === 1 ? 'killcam.thrown1' : 'killcam.thrown0');
}

/** A replay is not worth starting with less than this left before respawn. */
export function replayFits(respawnInMs: number): boolean {
  return respawnInMs >= KILLCAM.minLeftMs && respawnInMs <= MATCH.respawnMs;
}
