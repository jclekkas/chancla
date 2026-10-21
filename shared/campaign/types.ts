// Data types for the solo campaign "Doña Rosa: Antes de que lleguen".
//
// A mission is a plain data definition: a layout overlay on El Patio, the
// entities placed in it, a list of stages with goals, and optional
// challenges. The mission simulation (mission.ts) interprets it. Rendering,
// audio and input never contain mission logic; they read state and events.

import type { MapBox } from '../map';
import type { WeaponId } from '../config';

export type V3 = [number, number, number];
export type MissionId = 'ruleros' | 'cocina' | 'patio' | 'pinata';
export type ThemeId = 'morning' | 'noon' | 'afternoon' | 'dusk';
export type MusicId = 'ruleros' | 'cocina' | 'patio' | 'pinata';

export type ItemKind = 'rulero' | 'ingredient' | 'tray' | 'chairs' | 'candy';

// ------------------------------------------------------------------ layout

export interface LayoutDef {
  // Extra solid boxes (props, cover, marked bank panels). A box whose tag
  // starts with "bank" is a marked ricochet surface.
  add: MapBox[];
  // Base-map boxes to drop (for example the statue in the piñata arena).
  remove?: (b: MapBox) => boolean;
  // Sign text replacements on the base map.
  signs?: Record<string, string>;
  // Extra navigation nodes for the helper bot (and nothing else).
  waypoints?: V3[];
}

// ---------------------------------------------------------------- entities

export type Action =
  | { do: 'reveal'; id: string } // a hidden pickup becomes visible where it is
  | { do: 'drop'; id: string; to: V3 } // a hidden or held pickup falls to `to`
  | { do: 'flag'; flag: string }
  | { do: 'say'; line: string } // a scripted dialogue cue (client decides audio)
  | { do: 'remove'; id: string } // a blocker leaves the world (collision too)
  | { do: 'restore'; id: string } // a blocker comes back
  | { do: 'fix'; id: string } // a decoration switches to its tidy state
  | { do: 'enable'; id: string }
  | { do: 'disable'; id: string };

interface Base {
  id: string;
  // Stage ids during which the entity takes part. Omitted: every stage.
  stages?: string[];
  // Starts disabled until an `enable` action.
  disabled?: boolean;
}

export interface PickupSpec extends Base {
  kind: 'pickup';
  item: ItemKind;
  at: V3;
  hidden?: boolean; // not collectable until revealed or dropped
  carry?: boolean; // carried by hand and delivered, instead of collected on touch
  variant?: string; // visual variant: roller colour, ingredient type
  // Where a knocked-off or spilled item ends up (always on reachable ground).
  recoverAt?: V3;
}

export interface Hint {
  stand: V3; // a good place to stand
  aim: V3; // where to aim from there (for bank shots: the spot on the panel)
}

export interface TargetSpec extends Base {
  kind: 'target';
  at: V3;
  r: number; // generous hit sphere
  hits?: number; // hits needed (default 1)
  need?: 'bank' | 'heavy'; // only ricochets, or only La Pesada (direct or splash)
  visual: string;
  on: Action[];
  // Timed targets (the haywire kitchen timer): a hit only counts while open.
  window?: { periodMs: number; openMs: number };
  hint?: Hint;
  facing?: number; // yaw the visual faces
}

export type Behavior =
  // Walks between pose spots; a hit during a pose drops what it holds.
  | { type: 'poser'; poseMs: number; holds: string }
  // Drives a loop; each hit slows it briefly; `hits` hits stop it and drop what it holds.
  | { type: 'runner'; hits: number; holds: string }
  // Walks into a zone to film; while there it disrupts. A hit sends it away.
  | { type: 'filmer'; zone: string; spot: V3; everyMs: number; firstMs: number }
  // Rolls to a shelf, warms up its speaker, then shakes an ingredient off.
  | { type: 'shaker'; spot: V3; everyMs: number; firstMs: number; warnMs: number; hits: number; drops: string[] }
  // Chases the player while they carry `item`; contact spills it.
  | { type: 'thief'; item: ItemKind; delayMs: number }
  // Patrols; winds up a gust (telegraphed cone), blows, then overheats.
  | { type: 'blower'; hits: number; windupMs: number; gustMs: number; ventMs: number; restMs: number; range: number; halfAngle: number };

export interface ActorSpec extends Base {
  kind: 'actor';
  archetype: 'influencer' | 'speaker' | 'blower' | 'cart' | 'rollcart';
  path: V3[]; // patrol points; the first is the start
  speed: number;
  behavior: Behavior;
}

export interface ZoneSpec extends Base {
  kind: 'zone';
  at: V3;
  r: number;
  visual: string;
}

export interface BlockerSpec extends Base {
  kind: 'blocker';
  // A solid box while present. Removing it updates collision and navigation.
  box: [number, number, number, number, number, number];
  visual: string;
  absent?: boolean; // starts removed
  bin?: V3; // where its contents fly when removed (visual only)
}

export interface DecoSpec extends Base {
  kind: 'deco';
  at: V3;
  visual: string;
  facing?: number;
}

export interface PinataSpec extends Base {
  kind: 'pinata';
  at: V3; // pivot (rope anchor)
  rope: number; // rope length
}

export type EntitySpec = PickupSpec | TargetSpec | ActorSpec | ZoneSpec | BlockerSpec | DecoSpec | PinataSpec;

// ------------------------------------------------------------------ stages

export type GoalSpec =
  | { id: string; kind: 'collect'; item: ItemKind; count: number; label: string }
  | { id: string; kind: 'flags'; flags: string[]; label: string }
  | { id: string; kind: 'reach'; zone: string; label: string }
  | {
    id: string; kind: 'defend'; zone: string; ms: number; segments: number; graceMs: number; label: string;
    // The haywire timer: at this fraction the target is enabled and progress waits for it.
    malfunction?: { at: number; target: string };
  }
  | { id: string; kind: 'deliver'; item: ItemKind; zone: string; label: string }
  | { id: string; kind: 'boss'; label: string };

export interface StageSpec {
  id: string;
  title: string; // string key
  goals: GoalSpec[];
  onEnter?: Action[];
  onDone?: Action[];
  // Where Rosa comes back after a knockout or a checkpoint retry in this stage.
  respawn: { at: V3; yaw: number };
}

export interface ChallengeSpec {
  id: 'complete' | 'time' | 'skill';
  label: string; // string key
  // For 'skill': which tracked stat must hold. See mission.ts `skillMet`.
  skill?: 'cartThrows' | 'noSegmentLost' | 'blowerBeforeSecondScatter' | 'ricochetFinish';
  limit?: number;
}

export interface MissionDef {
  id: MissionId;
  order: number;
  title: string; // string keys
  premise: string;
  objective: string;
  minutes: [number, number]; // estimated duration on normal
  theme: ThemeId;
  music: MusicId;
  layout: LayoutDef;
  start: { at: V3; yaw: number };
  entities: EntitySpec[];
  stages: StageSpec[];
  timeTargetMs: number;
  challenges: ChallengeSpec[];
  // Optional configuration the client reads (for example the kitchen menu).
  config?: Record<string, unknown>;
}

// -------------------------------------------------------------- live state

export interface PlayerInputM {
  mx: number; mz: number; yaw: number; pitch: number;
  fire: boolean; jump: boolean; crouch: boolean; weapon: WeaponId;
}
