// Central tuning values. Gameplay modules read from here so balance changes
// happen in one place.

export const SIM_DT = 1 / 60;
export const MAX_FRAME_DT = 0.1;
export const MAX_STEPS_PER_FRAME = 6;

export const PLAYER = {
  radius: 0.4,
  eye: 1.6,
  speed: 6.4,
  accel: 42,
  friction: 14,
  maxHp: 100,
  invulnTime: 0.6,
  knockDecay: 6,
};

export const CHANCLA = {
  count: 2,
  quickSpeed: 30,
  chargedSpeed: 46,
  quickGravity: 7,
  chargedGravity: 4,
  chargeStart: 0.16,
  chargeFull: 0.85,
  maxRange: 42,
  maxFlight: 2.2,
  radius: 0.14,
  returnSpeedMin: 14,
  returnSpeedMax: 48,
  returnAccel: 70,
  catchRadius: 1.1,
  returnTimeout: 2.6,
  quickDamage: 1,
  chargedDamage: 3,
  quickKnock: 5,
  chargedKnock: 13,
  restitution: 0.82,
  minRethrow: 0.12,
};

export const LEGEND = {
  duration: 6,
  fireInterval: 0.13,
  perHit: 0.12,
  perRicochet: 0.08,
  perKill: 0.05,
  pool: 14,
  speed: 50,
  damage: 2,
  pierce: 2,
  splashRadius: 2.6,
  life: 1.4,
};

export const SCORE = {
  hit: 100,
  charged: 60,
  ricochet: 175,
  kill: 250,
  interrupt: 120,
  posing: 150,
  streakStep: 40,
  streakMin: 3,
  comboWindow: 3.6,
  comboPerLevel: 3,
  maxMultiplier: 5,
  bossHit: 150,
  bossKill: 5000,
  waveClear: 500,
  healthBonusPerHp: 10,
};

export const ARENA = {
  half: 20,
  outer: 27,
  navCell: 0.5,
  spawnMinDist: 12,
};
