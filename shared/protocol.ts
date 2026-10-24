// Wire protocol. JSON messages, validated field by field on the server.
// Clients send intentions (inputs, ready, start); the server sends state.

import { NAME_MAX, PROTOCOL_VERSION, type BotDifficulty, type WeaponId } from './config';
import type { Team } from './map';

export { PROTOCOL_VERSION };

// [seq, moveX, moveZ, yaw, pitch, buttons, weapon]
export type InputTuple = [number, number, number, number, number, number, number];

import { isMapId, type MapId } from './maps';

export type ClientMsg =
  | { t: 'hello'; v: number; name: string; resume?: string }
  | { t: 'create'; practice?: { difficulty: BotDifficulty; allies: number; enemies: number }; map?: MapId }
  | { t: 'map'; map: MapId }
  | { t: 'join'; code: string }
  | { t: 'team'; team: Team }
  | { t: 'ready'; ready: boolean }
  | { t: 'start' }
  | { t: 'bots'; enabled: boolean; difficulty: BotDifficulty }
  | { t: 'rematch' }
  | { t: 'lobby' }
  | { t: 'leave' }
  | { t: 'ping'; c: number; r?: number } // r: the client's measured round trip, ms
  | { t: 'i'; d: InputTuple[] };

export type ErrorCode =
  | 'version' | 'bad_message' | 'room_not_found' | 'room_full' | 'not_owner' | 'not_ready'
  | 'too_few' | 'rate_limited' | 'server_full' | 'no_room' | 'replaced' | 'shutdown' | 'team_full' | 'expired';

export interface MemberView {
  id: number;
  name: string;
  team: Team;
  ready: boolean;
  connected: boolean;
  bot: boolean;
  ping: number;
}

export interface ResultRow {
  id: number;
  name: string;
  team: Team;
  bot: boolean;
  kills: number;
  deaths: number;
  damage: number;
  accuracy: number;
}

export interface Results {
  winner: Team | -1;
  reason: 'score' | 'time';
  scores: [number, number];
  rows: ResultRow[];
}

export type RoomPhase = 'lobby' | 'countdown' | 'playing' | 'results';

export interface RoomView {
  code: string;
  owner: number;
  phase: RoomPhase;
  practice: boolean;
  members: MemberView[];
  bots: { enabled: boolean; difficulty: BotDifficulty };
  results: Results | null;
  maxPlayers: number;
  teamSize: number;
  /** The arena for the next (or current) match: the owner's choice. */
  map: MapId;
}

// Per-player state in a snapshot:
// [id, x, y, z, yaw, pitch, vx, vz, flags, hp, weapon, msSinceThrow, msSinceHit, msSinceMelee, ruleros]
// flags: 1 alive, 2 crouched, 4 on ground, 8 spawn-protected, 16 connected
// ruleros: bit i set while roller i is still on her head
export type PlayerTuple = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];

// Full state for the receiving player, used for prediction reconciliation:
// [x, y, z, vx, vy, vz, flags, hp, cooldownMs, switchMs, weapon, respawnInMs, protectedMs, meleeMs]
// flags: 1 alive, 2 crouched, 4 on ground, 8 a melee press is queued
export type SelfTuple = [number, number, number, number, number, number, number, number, number, number, number, number, number, number];

export interface Snapshot {
  t: 'snap';
  k: number; // server tick
  st: number; // server clock, ms
  ack: number; // last input seq processed for the receiver
  ph: RoomPhase;
  tl: number; // match time left, ms
  cd: number; // countdown left, ms
  sc: [number, number];
  me: SelfTuple | null;
  p: PlayerTuple[];
  ev: unknown[]; // SimEvents since the previous snapshot
  pk: number[]; // ms until each pickup is available (0 = available)
}

export type ServerMsg =
  | { t: 'welcome'; v: number; id: number; resume: string; rejoined: boolean }
  | { t: 'error'; code: ErrorCode; fatal?: boolean }
  | { t: 'room'; room: RoomView }
  | Snapshot
  | { t: 'pong'; c: number; s: number }
  | { t: 'left' }
  | { t: 'bye'; reason: 'shutdown' | 'replaced' | 'expired' | 'kicked' };

// ---------- validation ----------

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const DIFFS: readonly string[] = ['easy', 'normal', 'hard'];

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

export function isValidCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}

// Strips control and formatting characters, collapses whitespace and limits
// the length. Names are always rendered as text, never as HTML.
export function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const clean = raw.normalize('NFC').replace(/[\p{C}\p{Zl}\p{Zp}]/gu, '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(clean).slice(0, NAME_MAX).join('').trim();
  return chars.length > 0 ? chars : fallback;
}

function validInput(d: unknown): d is InputTuple {
  if (!Array.isArray(d) || d.length !== 7) return false;
  const [seq, mx, mz, yaw, pitch, b, w] = d as unknown[];
  return isNum(seq) && Number.isInteger(seq) && seq > 0 && isNum(mx) && Math.abs(mx) <= 1.001 && isNum(mz) && Math.abs(mz) <= 1.001 &&
    isNum(yaw) && Math.abs(yaw) < 100 && isNum(pitch) && Math.abs(pitch) < 3 && isNum(b) && Number.isInteger(b) && b >= 0 && b < 16 && (w === 0 || w === 1);
}

export function parseClientMsg(raw: unknown): ClientMsg | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case 'hello':
      if (!isNum(m.v) || !isStr(m.name, 64)) return null;
      if (m.resume !== undefined && !(isStr(m.resume, 64) && /^[A-Za-z0-9_-]{16,64}$/.test(m.resume))) return null;
      return { t: 'hello', v: m.v, name: m.name, resume: m.resume as string | undefined };
    case 'create': {
      if (m.map !== undefined && !isMapId(m.map)) return null;
      const map = m.map as MapId | undefined;
      if (m.practice === undefined) return map ? { t: 'create', map } : { t: 'create' };
      const p = m.practice as Record<string, unknown> | null;
      if (!p || typeof p !== 'object' || !DIFFS.includes(p.difficulty as string) || !isNum(p.allies) || !isNum(p.enemies)) return null;
      if (p.allies < 0 || p.allies > 1 || p.enemies < 1 || p.enemies > 2) return null;
      const practice = { difficulty: p.difficulty as BotDifficulty, allies: Math.floor(p.allies), enemies: Math.floor(p.enemies) };
      return map ? { t: 'create', practice, map } : { t: 'create', practice };
    }
    case 'map':
      return isMapId(m.map) ? { t: 'map', map: m.map } : null;
    case 'join':
      return isStr(m.code, 32) ? { t: 'join', code: normalizeCode(m.code) } : null;
    case 'team':
      return m.team === 0 || m.team === 1 ? { t: 'team', team: m.team } : null;
    case 'ready':
      return isBool(m.ready) ? { t: 'ready', ready: m.ready } : null;
    case 'start': case 'rematch': case 'lobby': case 'leave':
      return { t: m.t };
    case 'bots':
      return isBool(m.enabled) && DIFFS.includes(m.difficulty as string) ? { t: 'bots', enabled: m.enabled, difficulty: m.difficulty as BotDifficulty } : null;
    case 'ping':
      if (!isNum(m.c)) return null;
      return isNum(m.r) ? { t: 'ping', c: m.c, r: Math.max(0, Math.min(9999, Math.round(m.r))) } : { t: 'ping', c: m.c };
    case 'i':
      if (!Array.isArray(m.d) || m.d.length === 0 || m.d.length > 8) return null;
      return m.d.every(validInput) ? { t: 'i', d: m.d as InputTuple[] } : null;
    default:
      return null;
  }
}

export function weaponOf(n: number): WeaponId {
  return n === 1 ? 1 : 0;
}

export function randomToken(bytes: number): string {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  let s = '';
  for (const b of a) s += 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b & 63];
  return s;
}

export function randomCode(): string {
  const a = new Uint8Array(CODE_LENGTH * 2);
  globalThis.crypto.getRandomValues(a);
  let s = '';
  for (let i = 0; s.length < CODE_LENGTH && i < a.length; i++) {
    // Rejection sampling keeps every symbol equally likely.
    if (a[i]! < 248) s += CODE_ALPHABET[a[i]! % CODE_ALPHABET.length];
  }
  while (s.length < CODE_LENGTH) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}
