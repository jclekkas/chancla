// Every multiplayer balancing and networking value lives here. The server,
// the in-browser practice host and the client all read the same numbers.

export const PROTOCOL_VERSION = 3;

export const NET = {
  tickRate: 60, // authoritative simulation steps per second
  snapshotRate: 20, // world snapshots sent to each client per second
  interpDelayMs: 110, // remote entities render this far behind server time
  maxInputQueue: 40, // inputs buffered per player before old ones are dropped
  catchUpPerTick: 3, // extra inputs a lagging player may process in one tick
  inputBurst: 24, // token bucket: inputs a client may send in a burst
  maxMessageBytes: 4096,
  maxControlPerSecond: 12, // non-input messages (ready, team, start, ...)
  reconnectGraceMs: 25_000, // a dropped player's slot is held this long
  emptyRoomTtlMs: 90_000, // rooms with nobody connected are deleted after this
  maxRooms: 300,
  maxConnectionsPerIp: 12,
  heartbeatMs: 10_000,
};

export const MATCH = {
  durationMs: 5 * 60_000,
  scoreToWin: 25,
  respawnMs: 3000,
  spawnProtectionMs: 2000,
  countdownMs: 3000,
  maxPlayers: 4,
  teamSize: 2,
  friendlyFire: false,
  minParticipants: 2,
  maxHealth: 100,
  resultsHoldMs: 0, // results stay until the owner starts a rematch
};

export const MOVE = {
  halfWidth: 0.32,
  standHeight: 1.72,
  crouchHeight: 1.12,
  eyeStand: 1.58,
  eyeCrouch: 0.98,
  walkSpeed: 6.0,
  crouchSpeed: 3.0,
  groundAccel: 70,
  groundDecel: 55,
  airAccel: 14,
  gravity: 21,
  jumpSpeed: 7.0,
  stepHeight: 0.52,
  maxFallSpeed: 30,
  maxPitch: 1.45,
};

export type WeaponId = 0 | 1;

export interface WeaponDef {
  id: WeaponId;
  key: 'standard' | 'heavy';
  speed: number; // m/s at launch
  gravity: number; // downward acceleration in m/s²
  radius: number; // projectile collision radius
  damage: number;
  headMultiplier: number;
  cooldownMs: number; // time between throws; the throw animation lasts this long
  bounces: number; // ricochets off walls before the projectile ends
  splashRadius: number;
  splashDamage: number;
  knockback: number;
  lifeMs: number;
  maxRange: number;
}

export const WEAPONS: readonly WeaponDef[] = [
  {
    // La Chancla: fast, flat and dependable. One readable ricochet off walls.
    id: 0, key: 'standard', speed: 42, gravity: 5, radius: 0.12,
    damage: 34, headMultiplier: 1.5, cooldownMs: 420, bounces: 1,
    splashRadius: 0, splashDamage: 0, knockback: 2.5, lifeMs: 1800, maxRange: 70,
  },
  {
    // La Pesada: a wooden clog. Slow and lobbed, long recovery, but a direct
    // hit nearly finishes someone and the impact splashes around corners.
    id: 1, key: 'heavy', speed: 25, gravity: 12, radius: 0.2,
    damage: 62, headMultiplier: 1.25, cooldownMs: 1150, bounces: 0,
    splashRadius: 2.2, splashDamage: 26, knockback: 7, lifeMs: 2600, maxRange: 60,
  },
];

export const WEAPON_SWITCH_MS = 320;

// Bot behaviour by difficulty.
export const BOTS = {
  easy: { reactionMs: 750, aimErrorRad: 0.09, turnRate: 3.2, leadSkill: 0.35, fireConeRad: 0.12, heavyChance: 0.15 },
  normal: { reactionMs: 480, aimErrorRad: 0.055, turnRate: 4.6, leadSkill: 0.65, fireConeRad: 0.08, heavyChance: 0.25 },
  hard: { reactionMs: 300, aimErrorRad: 0.03, turnRate: 6.5, leadSkill: 0.9, fireConeRad: 0.05, heavyChance: 0.3 },
} as const;

export type BotDifficulty = keyof typeof BOTS;

export const NAME_MAX = 16;
