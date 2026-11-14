import type { Rect } from './phys';

export type LangText = { en: string; es: string };
export type WeaponId = 'chancla' | 'pesada' | 'huarache' | 'gemela' | 'tacon';
export type EnemyKind =
  | 'bocinas'
  | 'influencer'
  | 'soplador'
  | 'chismosa'
  | 'repartidor'
  | 'pinata'
  | 'vecina'
  | 'rumor'
  | 'rey';
export type PickupKind = 'cafe' | 'chile' | 'agua' | 'rebozo' | 'micro';
export type UpgradeId = 'hp' | 'speed' | 'bounce' | 'magnet' | 'damage' | 'dash';
export type Ranks = Record<UpgradeId, number>;
export type Theme = 'patio' | 'cocina' | 'plaza' | 'mercado' | 'azotea' | 'fiesta';
export type Diff = 'easy' | 'normal' | 'andale';

export interface Block extends Rect {
  k: 'fountain' | 'planter' | 'bench' | 'wall' | 'counter' | 'island' | 'fridge' | 'stall' | 'kiosk' | 'tank' | 'house' | 'speaker' | 'table' | 'statue';
  hue?: string;
}

export interface Zone extends Rect {
  k: 'stove' | 'pit';
}

export interface Lamp {
  x: number;
  y: number;
  r: number;
  color: string;
}

export interface MapDef {
  id: string;
  name: LangText;
  theme: Theme;
  w: number;
  h: number;
  blocks: Block[];
  hazards: Zone[];
  pits: Zone[];
  lights: Lamp[];
  stall: Rect | null;
  darkness: number;
  spawn: { x: number; y: number }[];
  start: { x: number; y: number };
}

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  blurb: LangText;
  charge: boolean;
  chargeTime: number;
  cooldown: number;
  speed: number;
  dmg: number;
  chargeDmg: number;
  bounce: number;
  life: number;
  r: number;
  splash: number;
  pierce: number;
  homing: number;
  knock: number;
  pellets: number;
  spread: number;
  pool: boolean;
  unlock: number;
}

export interface EnemyDef {
  hp: number;
  speed: number;
  r: number;
  dmg: number;
  tele: number;
  range: number;
  cd: number;
  name: LangText;
}

export interface WaveDef {
  kinds: EnemyKind[];
  max: number;
  gap: number;
  boss?: boolean;
}

export interface MissionDef {
  id: string;
  map: string;
  name: LangText;
  blurb: LangText;
  objective: LangText;
  tip: LangText;
  waves: WaveDef[];
  par: number;
  stall: boolean;
  finale: boolean;
  dossier: LangText;
}

export const WORLD_W = 1440;
export const WORLD_H = 960;
const BORDER = 36;

export function emptyRanks(): Ranks {
  return { hp: 0, speed: 0, bounce: 0, magnet: 0, damage: 0, dash: 0 };
}

export const UPGRADE_IDS: UpgradeId[] = ['hp', 'speed', 'bounce', 'magnet', 'damage', 'dash'];

export const UPGRADES: Record<UpgradeId, { name: LangText; blurb: LangText; max: number; costs: number[] }> = {
  hp: {
    name: { en: 'Suela gruesa', es: 'Suela gruesa' },
    blurb: { en: '+20 health', es: '+20 de vida' },
    max: 4,
    costs: [80, 160, 280, 420],
  },
  speed: {
    name: { en: 'Café de olla', es: 'Café de olla' },
    blurb: { en: '+8% move speed', es: '+8% de velocidad' },
    max: 3,
    costs: [100, 200, 340],
  },
  bounce: {
    name: { en: 'Doble rebote', es: 'Doble rebote' },
    blurb: { en: '+1 bank off walls', es: '+1 rebote en las paredes' },
    max: 2,
    costs: [220, 480],
  },
  magnet: {
    name: { en: 'Imán de casa', es: 'Imán de casa' },
    blurb: { en: 'Chanclas and pickups come home faster', es: 'Las chanclas y los premios vuelven más rápido' },
    max: 2,
    costs: [90, 180],
  },
  damage: {
    name: { en: 'Mano firme', es: 'Mano firme' },
    blurb: { en: '+18% smack', es: '+18% de golpe' },
    max: 3,
    costs: [150, 300, 500],
  },
  dash: {
    name: { en: 'Paso de comadre', es: 'Paso de comadre' },
    blurb: { en: 'Dash recharges sooner', es: 'El esquive recarga antes' },
    max: 2,
    costs: [120, 240],
  },
};

export function upgradeCost(id: UpgradeId, rank: number): number | null {
  const u = UPGRADES[id];
  if (rank >= u.max) return null;
  return u.costs[rank] ?? null;
}

export const WEAPON_ORDER: WeaponId[] = ['chancla', 'pesada', 'huarache', 'gemela', 'tacon'];

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  chancla: {
    id: 'chancla',
    name: 'La Chancla',
    blurb: { en: 'Fast, honest, one bounce, and it always comes back.', es: 'Rápida, honesta, un rebote, y siempre regresa.' },
    charge: true,
    chargeTime: 0.62,
    cooldown: 0.1,
    speed: 760,
    dmg: 1,
    chargeDmg: 3,
    bounce: 1,
    life: 1.15,
    r: 9,
    splash: 0,
    pierce: 1,
    homing: 0,
    knock: 280,
    pellets: 1,
    spread: 0,
    pool: true,
    unlock: 0,
  },
  pesada: {
    id: 'pesada',
    name: 'La Pesada',
    blurb: { en: 'A clog with a grudge. Slow, splashy, rude.', es: 'Un zueco con rencor. Lento, amplio, grosero.' },
    charge: true,
    chargeTime: 0.7,
    cooldown: 1.05,
    speed: 430,
    dmg: 3,
    chargeDmg: 5,
    bounce: 0,
    life: 1.05,
    r: 15,
    splash: 86,
    pierce: 1,
    homing: 0,
    knock: 520,
    pellets: 1,
    spread: 0,
    pool: false,
    unlock: 0,
  },
  huarache: {
    id: 'huarache',
    name: 'La Huarache',
    blurb: { en: 'Woven, mean, and it goes through a crowd.', es: 'Tejida, brava, y atraviesa la muchedumbre.' },
    charge: false,
    chargeTime: 0,
    cooldown: 0.46,
    speed: 700,
    dmg: 1,
    chargeDmg: 1,
    bounce: 0,
    life: 0.72,
    r: 8,
    splash: 0,
    pierce: 4,
    homing: 0,
    knock: 150,
    pellets: 1,
    spread: 0,
    pool: false,
    unlock: 350,
  },
  gemela: {
    id: 'gemela',
    name: 'Las Gemelas',
    blurb: { en: 'Two sandals. One opinion.', es: 'Dos chanclas. Una sola opinión.' },
    charge: false,
    chargeTime: 0,
    cooldown: 0.64,
    speed: 720,
    dmg: 1,
    chargeDmg: 1,
    bounce: 0,
    life: 0.62,
    r: 8,
    splash: 0,
    pierce: 1,
    homing: 0,
    knock: 170,
    pellets: 2,
    spread: 0.22,
    pool: false,
    unlock: 650,
  },
  tacon: {
    id: 'tacon',
    name: 'El Tacón',
    blurb: { en: 'It finds them. It always finds them.', es: 'Los encuentra. Siempre los encuentra.' },
    charge: false,
    chargeTime: 0,
    cooldown: 1.2,
    speed: 540,
    dmg: 3,
    chargeDmg: 3,
    bounce: 0,
    life: 1.5,
    r: 8,
    splash: 0,
    pierce: 1,
    homing: 3.4,
    knock: 90,
    pellets: 1,
    spread: 0,
    pool: false,
    unlock: 1100,
  },
};

export function loadout(unlockedExtras: readonly string[]): WeaponId[] {
  return WEAPON_ORDER.filter((id) => WEAPONS[id].unlock === 0 || unlockedExtras.includes(id));
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  bocinas: {
    hp: 3, speed: 68, r: 20, dmg: 14, tele: 0.78, range: 210, cd: 2.4,
    name: { en: 'El Bocinas', es: 'El Bocinas' },
  },
  influencer: {
    hp: 2, speed: 112, r: 18, dmg: 11, tele: 0.62, range: 250, cd: 2.1,
    name: { en: 'La Influencer', es: 'La Influencer' },
  },
  soplador: {
    hp: 5, speed: 96, r: 22, dmg: 12, tele: 0.55, range: 78, cd: 2.0,
    name: { en: 'El Soplador', es: 'El Soplador' },
  },
  chismosa: {
    hp: 3, speed: 62, r: 20, dmg: 0, tele: 0.7, range: 280, cd: 3.1,
    name: { en: 'La Chismosa', es: 'La Chismosa' },
  },
  repartidor: {
    hp: 3, speed: 84, r: 20, dmg: 16, tele: 0.48, range: 340, cd: 2.3,
    name: { en: 'El Repartidor', es: 'El Repartidor' },
  },
  pinata: {
    hp: 6, speed: 54, r: 24, dmg: 10, tele: 0.42, range: 70, cd: 1.8,
    name: { en: 'La Piñata', es: 'La Piñata' },
  },
  vecina: {
    hp: 8, speed: 58, r: 22, dmg: 9, tele: 0.66, range: 230, cd: 2.2,
    name: { en: 'La Vecina', es: 'La Vecina' },
  },
  rumor: {
    hp: 1, speed: 158, r: 11, dmg: 7, tele: 0, range: 0, cd: 0,
    name: { en: 'Un rumor', es: 'Un rumor' },
  },
  rey: {
    hp: 52, speed: 34, r: 48, dmg: 18, tele: 1.05, range: 420, cd: 0.4,
    name: { en: 'El Rey del Escándalo', es: 'El Rey del Escándalo' },
  },
};

export const DIFFS: Record<Diff, { hp: number; dmg: number; tele: number; gap: number }> = {
  easy: { hp: 0.7, dmg: 0.62, tele: 1.32, gap: 1.16 },
  normal: { hp: 1, dmg: 1, tele: 1, gap: 1 },
  andale: { hp: 1.34, dmg: 1.28, tele: 0.8, gap: 0.82 },
};

const W = WORLD_W;
const H = WORLD_H;

function spawns(): { x: number; y: number }[] {
  const m = 108;
  return [
    { x: m, y: m }, { x: W / 2, y: m }, { x: W - m, y: m },
    { x: m, y: H / 2 }, { x: W - m, y: H / 2 },
    { x: m, y: H - m }, { x: W / 2, y: H - m }, { x: W - m, y: H - m },
  ];
}

function map(partial: Omit<MapDef, 'w' | 'h' | 'spawn'> & { spawn?: { x: number; y: number }[] }): MapDef {
  return { w: W, h: H, spawn: partial.spawn ?? spawns(), ...partial };
}

export const MAPS: Record<string, MapDef> = {
  patio: map({
    id: 'patio',
    name: { en: 'El Patio', es: 'El Patio' },
    theme: 'patio',
    darkness: 0.52,
    start: { x: 720, y: 760 },
    blocks: [
      { x: 640, y: 400, w: 160, h: 160, k: 'fountain' },
      { x: 168, y: 196, w: 108, h: 78, k: 'planter' },
      { x: 1164, y: 690, w: 112, h: 78, k: 'planter' },
      { x: 210, y: 700, w: 138, h: 40, k: 'bench' },
      { x: 1088, y: 196, w: 138, h: 40, k: 'bench' },
      { x: 500, y: 188, w: 200, h: 34, k: 'wall' },
    ],
    hazards: [],
    pits: [],
    stall: null,
    lights: [
      { x: 180, y: 78, r: 170, color: '#ffb15e' },
      { x: 720, y: 78, r: 150, color: '#ffd7a1' },
      { x: 1260, y: 78, r: 170, color: '#ffb15e' },
      { x: 720, y: 480, r: 260, color: '#ffe7bf' },
      { x: 220, y: 860, r: 150, color: '#f0a0cc' },
      { x: 1220, y: 860, r: 150, color: '#8fd4cc' },
    ],
  }),
  cocina: map({
    id: 'cocina',
    name: { en: 'La Cocina', es: 'La Cocina' },
    theme: 'cocina',
    darkness: 0.34,
    start: { x: 720, y: 800 },
    blocks: [
      { x: 600, y: 370, w: 240, h: 190, k: 'island' },
      { x: 150, y: 150, w: 230, h: 64, k: 'counter' },
      { x: 1060, y: 150, w: 230, h: 64, k: 'counter' },
      { x: 150, y: 748, w: 250, h: 58, k: 'counter' },
      { x: 1040, y: 748, w: 250, h: 58, k: 'counter' },
      { x: 168, y: 430, w: 72, h: 130, k: 'fridge' },
    ],
    hazards: [
      { x: 188, y: 250, w: 108, h: 72, k: 'stove' },
      { x: 1144, y: 250, w: 108, h: 72, k: 'stove' },
    ],
    pits: [],
    stall: null,
    lights: [
      { x: 720, y: 120, r: 280, color: '#fff1d2' },
      { x: 242, y: 286, r: 130, color: '#ff7848' },
      { x: 1198, y: 286, r: 130, color: '#ff7848' },
      { x: 720, y: 465, r: 180, color: '#ffe1a8' },
    ],
  }),
  plaza: map({
    id: 'plaza',
    name: { en: 'La Plaza', es: 'La Plaza' },
    theme: 'plaza',
    darkness: 0.28,
    start: { x: 720, y: 780 },
    blocks: [
      { x: 610, y: 390, w: 220, h: 150, k: 'kiosk' },
      { x: 196, y: 280, w: 128, h: 36, k: 'bench' },
      { x: 1116, y: 280, w: 128, h: 36, k: 'bench' },
      { x: 196, y: 690, w: 128, h: 36, k: 'bench' },
      { x: 1116, y: 690, w: 128, h: 36, k: 'bench' },
      { x: 430, y: 200, w: 72, h: 72, k: 'planter' },
      { x: 938, y: 690, w: 72, h: 72, k: 'planter' },
      { x: 694, y: 230, w: 52, h: 52, k: 'statue' },
    ],
    hazards: [],
    pits: [],
    stall: null,
    lights: [
      { x: 720, y: 160, r: 300, color: '#ffe6b8' },
      { x: 250, y: 200, r: 160, color: '#ffd0e4' },
      { x: 1190, y: 200, r: 160, color: '#b7efe4' },
      { x: 720, y: 465, r: 200, color: '#fff4d2' },
    ],
  }),
  mercado: map({
    id: 'mercado',
    name: { en: 'El Mercado', es: 'El Mercado' },
    theme: 'mercado',
    darkness: 0.4,
    start: { x: 720, y: 820 },
    blocks: [
      { x: 170, y: 150, w: 168, h: 78, k: 'stall', hue: '#e86a8d' },
      { x: 170, y: 330, w: 168, h: 78, k: 'stall', hue: '#4fb3a9' },
      { x: 170, y: 540, w: 168, h: 78, k: 'stall', hue: '#f2a33a' },
      { x: 170, y: 730, w: 168, h: 78, k: 'stall', hue: '#c8553d' },
      { x: 1102, y: 150, w: 168, h: 78, k: 'stall', hue: '#7a5af5' },
      { x: 1102, y: 330, w: 168, h: 78, k: 'stall', hue: '#f5c542' },
      { x: 1102, y: 540, w: 168, h: 78, k: 'stall', hue: '#4fb3a9' },
      { x: 1102, y: 730, w: 168, h: 78, k: 'stall', hue: '#e86a8d' },
      { x: 548, y: 188, w: 150, h: 76, k: 'stall', hue: '#f2a33a' },
      { x: 742, y: 188, w: 150, h: 76, k: 'stall', hue: '#c8553d' },
      { x: 548, y: 700, w: 150, h: 76, k: 'stall', hue: '#4fb3a9' },
      { x: 742, y: 700, w: 150, h: 76, k: 'stall', hue: '#e86a8d' },
    ],
    hazards: [],
    pits: [],
    stall: { x: 620, y: 420, w: 200, h: 120 },
    lights: [
      { x: 720, y: 480, r: 240, color: '#ffe0a0' },
      { x: 250, y: 190, r: 120, color: '#ffb0cc' },
      { x: 1186, y: 190, r: 120, color: '#b9efe6' },
      { x: 250, y: 770, r: 120, color: '#ffd27a' },
      { x: 1186, y: 770, r: 120, color: '#ffb0cc' },
    ],
  }),
  azotea: map({
    id: 'azotea',
    name: { en: 'La Azotea', es: 'La Azotea' },
    theme: 'azotea',
    darkness: 0.62,
    start: { x: 420, y: 700 },
    blocks: [
      { x: 196, y: 176, w: 120, h: 120, k: 'tank' },
      { x: 1124, y: 176, w: 130, h: 120, k: 'tank' },
      { x: 640, y: 400, w: 170, h: 150, k: 'house' },
    ],
    hazards: [],
    pits: [
      { x: 70, y: 70, w: 200, h: 86, k: 'pit' },
      { x: 1170, y: 70, w: 200, h: 86, k: 'pit' },
      { x: 70, y: 800, w: 220, h: 86, k: 'pit' },
      { x: 1160, y: 800, w: 210, h: 86, k: 'pit' },
      { x: 500, y: 700, w: 150, h: 64, k: 'pit' },
    ],
    stall: null,
    lights: [
      { x: 250, y: 120, r: 150, color: '#9bbcff' },
      { x: 720, y: 140, r: 180, color: '#d7e4ff' },
      { x: 1200, y: 140, r: 140, color: '#ffb15e' },
      { x: 725, y: 470, r: 120, color: '#ffe1a8' },
    ],
  }),
  fiesta: map({
    id: 'fiesta',
    name: { en: 'La Fiesta', es: 'La Fiesta' },
    theme: 'fiesta',
    darkness: 0.58,
    start: { x: 720, y: 800 },
    blocks: [
      { x: 150, y: 340, w: 96, h: 220, k: 'speaker' },
      { x: 1194, y: 340, w: 96, h: 220, k: 'speaker' },
      { x: 280, y: 730, w: 170, h: 52, k: 'table' },
      { x: 990, y: 730, w: 170, h: 52, k: 'table' },
      { x: 700, y: 176, w: 44, h: 44, k: 'statue' },
    ],
    hazards: [],
    pits: [],
    stall: null,
    lights: [
      { x: 360, y: 140, r: 150, color: '#ff7eb3' },
      { x: 720, y: 130, r: 180, color: '#ffe08a' },
      { x: 1080, y: 140, r: 150, color: '#7ee0d2' },
      { x: 198, y: 450, r: 140, color: '#c9b6ff' },
      { x: 1242, y: 450, r: 140, color: '#ffb15e' },
      { x: 720, y: 520, r: 220, color: '#fff0c8' },
    ],
  }),
};

export const ENDLESS_MAPS = ['patio', 'cocina', 'plaza', 'mercado', 'azotea', 'fiesta'] as const;

export function solidBlocks(m: MapDef): Rect[] {
  const t = BORDER;
  return [
    { x: 0, y: 0, w: m.w, h: t },
    { x: 0, y: m.h - t, w: m.w, h: t },
    { x: 0, y: 0, w: t, h: m.h },
    { x: m.w - t, y: 0, w: t, h: m.h },
    ...m.blocks,
  ];
}

export function makeEndlessWave(n: number): WaveDef {
  const pool: EnemyKind[] = ['bocinas'];
  if (n >= 2) pool.push('influencer');
  if (n >= 3) pool.push('soplador');
  if (n >= 4) pool.push('repartidor');
  if (n >= 5) pool.push('chismosa');
  if (n >= 6) pool.push('pinata', 'vecina');
  const count = Math.min(5 + n, 16);
  const kinds: EnemyKind[] = [];
  for (let i = 0; i < count; i++) kinds.push(pool[(i * 2 + n) % pool.length]!);
  const boss = n % 5 === 0;
  if (boss) kinds.unshift('rey');
  return {
    kinds,
    max: Math.min((boss ? 4 : 3) + Math.floor(n / 3), boss ? 5 : 8),
    gap: Math.max(0.4, 1.4 - n * 0.06),
    boss,
  };
}

export const MISSIONS: MissionDef[] = [
  {
    id: 'patio',
    map: 'patio',
    name: { en: 'Sunday Shift', es: 'Turno de domingo' },
    blurb: { en: 'The speakers started before the coffee. They can finish before it too.', es: 'Las bocinas empezaron antes del café. También pueden acabarse antes.' },
    objective: { en: 'Clear three waves in the patio.', es: 'Limpia tres oleadas en el patio.' },
    tip: { en: 'Hold the throw until the ring closes. One full chancla sends a Bocinas home. Walls count.', es: 'Sostén el lanzamiento hasta que cierre el anillo. Una chancla llena manda a un Bocinas a su casa. Las paredes cuentan.' },
    dossier: { en: 'El Bocinas — a cone of noise. Hide behind the fountain, or smack him while the cone is still filling.', es: 'El Bocinas — un cono de ruido. Escóndete tras la fuente, o pégale mientras el cono todavía se llena.' },
    par: 5200,
    stall: false,
    finale: false,
    waves: [
      { kinds: ['bocinas', 'bocinas', 'bocinas', 'bocinas', 'bocinas'], max: 2, gap: 1.7 },
      { kinds: ['bocinas', 'bocinas', 'bocinas', 'bocinas', 'bocinas', 'bocinas', 'bocinas'], max: 3, gap: 1.3 },
      { kinds: ['bocinas', 'bocinas', 'soplador', 'bocinas', 'bocinas', 'soplador'], max: 3, gap: 1.15 },
    ],
  },
  {
    id: 'cocina',
    map: 'cocina',
    name: { en: 'Service, Then Dinner', es: 'Primero el servicio' },
    blurb: { en: 'The kitchen is not a suggestion. Neither is the stove.', es: 'La cocina no es una sugerencia. La estufa tampoco.' },
    objective: { en: 'Clear the kitchen. The stoves cook whoever lands on them.', es: 'Limpia la cocina. Las estufas cocinan a quien caiga encima.' },
    tip: { en: 'La Pesada shoves. A Bocinas on the burner is a bonus, not a tragedy. You are not a bonus.', es: 'La Pesada empuja. Un Bocinas en la lumbre es un extra, no una tragedia. Tú no eres un extra.' },
    dossier: { en: 'El Soplador — gets close and exhales. Dash through the gust or meet him halfway with a clog.', es: 'El Soplador — se acerca y sopla. Esquiva la ráfaga o recíbelo a media cocina con el zueco.' },
    par: 7000,
    stall: false,
    finale: false,
    waves: [
      { kinds: ['bocinas', 'bocinas', 'soplador', 'bocinas', 'soplador'], max: 3, gap: 1.4 },
      { kinds: ['soplador', 'bocinas', 'soplador', 'bocinas', 'bocinas', 'soplador', 'bocinas'], max: 4, gap: 1.12 },
      { kinds: ['soplador', 'influencer', 'bocinas', 'soplador', 'bocinas', 'influencer', 'soplador'], max: 4, gap: 1 },
    ],
  },
  {
    id: 'plaza',
    map: 'plaza',
    name: { en: 'The Influencers', es: 'Las influencers' },
    blurb: { en: 'They came for the golden hour. They can leave in it.', es: 'Vinieron por la hora dorada. Se pueden ir en ella.' },
    objective: { en: 'Clear the plaza. Punish the pose.', es: 'Limpia la plaza. Castiga la pose.' },
    tip: { en: 'A selfie is a gift. While the phone is up they take double and they are not shooting.', es: 'Un selfie es un regalo. Con el teléfono en alto reciben el doble y no disparan.' },
    dossier: { en: 'La Influencer — fast, vain, and briefly made of glass.', es: 'La Influencer — rápida, vanidosa, y por un momento hecha de vidrio.' },
    par: 7800,
    stall: false,
    finale: false,
    waves: [
      { kinds: ['influencer', 'influencer', 'influencer', 'influencer', 'bocinas'], max: 3, gap: 1.25 },
      { kinds: ['influencer', 'bocinas', 'influencer', 'influencer', 'bocinas', 'influencer'], max: 4, gap: 1.05 },
      { kinds: ['influencer', 'influencer', 'soplador', 'influencer', 'bocinas', 'influencer', 'soplador', 'influencer'], max: 5, gap: 0.92 },
    ],
  },
  {
    id: 'mercado',
    map: 'mercado',
    name: { en: 'Hold the Puesto', es: 'Aguanta el puesto' },
    blurb: { en: 'The stall is your aunt’s. The rumors are everybody’s.', es: 'El puesto es de tu tía. Los rumores son de todo el mundo.' },
    objective: { en: 'Clear the market before the puesto breaks.', es: 'Limpia el mercado antes de que se caiga el puesto.' },
    tip: { en: 'Rumors die in one hit and they are not the real problem. A crowd sitting on the awning is.', es: 'Los rumores mueren de un golpe y no son el problema. El problema es la muchedumbre sentada en el toldo.' },
    dossier: { en: 'La Chismosa spawns rumors. La Piñata bursts into candy — and into healing, if you are the one who broke it.', es: 'La Chismosa suelta rumores. La Piñata revienta en dulces — y en curación, si la rompes tú.' },
    par: 7400,
    stall: true,
    finale: false,
    waves: [
      { kinds: ['bocinas', 'chismosa', 'bocinas', 'chismosa', 'bocinas'], max: 3, gap: 1.35 },
      { kinds: ['chismosa', 'pinata', 'bocinas', 'chismosa', 'bocinas', 'pinata'], max: 4, gap: 1.12 },
      { kinds: ['chismosa', 'pinata', 'soplador', 'influencer', 'chismosa', 'bocinas', 'pinata'], max: 5, gap: 0.98 },
    ],
  },
  {
    id: 'azotea',
    map: 'azotea',
    name: { en: 'Roof Code', es: 'Código de azotea' },
    blurb: { en: 'Deliveries, a hose, and several holes that are not a metaphor.', es: 'Entregas, una manguera, y varios hoyos que no son metáfora.' },
    objective: { en: 'Clear the roof. Stay on the roof.', es: 'Limpia la azotea. Quédate en la azotea.' },
    tip: { en: 'The charge is a straight line with a warning. Dash through it. Do not dash into a hole.', es: 'La carga es una línea recta con aviso. Esquiva a través. No esquives hacia un hoyo.' },
    dossier: { en: 'El Repartidor commits to a line. La Vecina waters whatever is in front of her, including you.', es: 'El Repartidor se compromete con una línea. La Vecina riega lo que tenga enfrente, tú incluido.' },
    par: 8600,
    stall: false,
    finale: false,
    waves: [
      { kinds: ['repartidor', 'bocinas', 'repartidor', 'bocinas', 'repartidor'], max: 3, gap: 1.28 },
      { kinds: ['vecina', 'repartidor', 'vecina', 'repartidor', 'bocinas', 'vecina'], max: 4, gap: 1.08 },
      { kinds: ['vecina', 'repartidor', 'influencer', 'vecina', 'soplador', 'repartidor', 'influencer'], max: 5, gap: 0.9 },
    ],
  },
  {
    id: 'fiesta',
    map: 'fiesta',
    name: { en: 'El Rey del Escándalo', es: 'El Rey del Escándalo' },
    blurb: { en: 'He brought a speaker stack and a crown. You brought footwear.', es: 'Trajo un muro de bocinas y una corona. Tú trajiste calzado.' },
    objective: { en: 'Drop the king. His shield holds until he runs out of breath.', es: 'Tumba al rey. El escudo aguanta hasta que se queda sin aire.' },
    tip: { en: 'Chanclas bounce off the crown. Bounce them into his friends, then empty the clip when he gasps.', es: 'Las chanclas rebotan en la corona. Rebótalas contra sus amigos, y vacía la mano cuando se ahogue.' },
    dossier: { en: 'Rings with a safe slice, a volley of vinyl, then a gold-lit gasp. That gasp is the whole fight.', es: 'Anillos con una rebanada a salvo, una andanada de vinilos, y luego un ahogo dorado. Ese ahogo es toda la pelea.' },
    par: 9000,
    stall: false,
    finale: true,
    waves: [
      {
        kinds: ['rey', 'bocinas', 'influencer', 'bocinas', 'soplador', 'influencer', 'bocinas'],
        max: 4,
        gap: 4.1,
        boss: true,
      },
    ],
  },
];

export function missionById(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}

/** The original four-mission story, playable here with the Duty combat rules. */
export const STORY: MissionDef[] = [
  {
    id: 'ruleros',
    map: 'patio',
    name: { en: 'Operación Ruleros', es: 'Operación Ruleros' },
    blurb: { en: 'The rollers are gone and the block is loud. Clear the patio.', es: 'Se perdieron los ruleros y la cuadra está alta. Limpia el patio.' },
    objective: { en: 'Clear the patio. Bank a shot off the fountain when they hide.', es: 'Limpia el patio. Rebota en la fuente cuando se escondan.' },
    tip: { en: 'The original recovered six roller sets. Here the same cast has to be sent home, and a bank shot still pays.', es: 'El original recuperaba seis juegos de ruleros. Aquí hay que mandar al mismo elenco a su casa, y el rebote sigue pagando.' },
    dossier: { en: 'Bocinas, an influencer, and a blower. Interrupt the cone. Punish the pose.', es: 'Bocinas, una influencer y un soplador. Interrumpe el cono. Castiga la pose.' },
    par: 6000, stall: false, finale: false,
    waves: [
      { kinds: ['bocinas', 'bocinas', 'bocinas', 'bocinas'], max: 2, gap: 1.6 },
      { kinds: ['influencer', 'bocinas', 'influencer', 'bocinas'], max: 3, gap: 1.3 },
      { kinds: ['soplador', 'influencer', 'bocinas', 'soplador'], max: 3, gap: 1.1 },
    ],
  },
  {
    id: 'cocina-story',
    map: 'cocina',
    name: { en: 'Kitchen Under Control', es: 'Aquí se cocina' },
    blurb: { en: 'Keep the stove lane clear until the comal is done.', es: 'Mantén libre la estufa hasta que el comal termine.' },
    objective: { en: 'Defend the kitchen. The puesto bar is the comal.', es: 'Defiende la cocina. La barra del puesto es el comal.' },
    tip: { en: 'La Pesada shoves people onto the burners.', es: 'La Pesada empuja gente a las lumbres.' },
    dossier: { en: 'Sopladores push. Do not stand on the stove.', es: 'Los sopladores empujan. No te pares en la estufa.' },
    par: 7000, stall: true, finale: false,
    waves: [
      { kinds: ['bocinas', 'soplador', 'bocinas', 'soplador'], max: 3, gap: 1.3 },
      { kinds: ['soplador', 'influencer', 'bocinas', 'soplador', 'bocinas'], max: 4, gap: 1.05 },
    ],
  },
  {
    id: 'patio-story',
    map: 'plaza',
    name: { en: 'Patio Panic', es: 'Este patio no se limpia solo' },
    blurb: { en: 'The east courtyard will not sweep itself.', es: 'El patio de atrás no se barre solo.' },
    objective: { en: 'Clear three waves.', es: 'Limpia tres oleadas.' },
    tip: { en: 'Dash through a gust.', es: 'Esquiva a través de la ráfaga.' },
    dossier: { en: 'Blowers, speakers, and one influencer who will not stop posing.', es: 'Sopladores, bocinas y una influencer que no deja de posar.' },
    par: 7500, stall: false, finale: false,
    waves: [
      { kinds: ['bocinas', 'soplador', 'bocinas'], max: 3, gap: 1.2 },
      { kinds: ['influencer', 'soplador', 'bocinas', 'influencer'], max: 4, gap: 1 },
      { kinds: ['soplador', 'soplador', 'influencer', 'bocinas', 'repartidor'], max: 4, gap: 0.9 },
    ],
  },
  {
    id: 'pinata-story',
    map: 'fiesta',
    name: { en: 'The Piñata Strikes Back', es: 'La Piñata Contraataca' },
    blurb: { en: 'Dusk, colored lights, and a crown that should not be here.', es: 'Anochecer, luces de colores, y una corona que no debería estar.' },
    objective: { en: 'Drop El Rey. His shield holds until he gasps.', es: 'Tumba al Rey. El escudo aguanta hasta que se ahogue.' },
    tip: { en: 'Bank chanclas into his friends, then throw when he is gold.', es: 'Rebotar las chanclas contra sus amigos, y lanza cuando esté dorado.' },
    dossier: { en: 'Three-phase party: rings, vinyl, then the gasp.', es: 'Fiesta en tres tiempos: anillos, vinilos, y el ahogo.' },
    par: 9000, stall: false, finale: true,
    waves: [
      { kinds: ['rey', 'bocinas', 'influencer', 'soplador', 'bocinas'], max: 4, gap: 3.6, boss: true },
    ],
  },
];

export const CLASSIC: MissionDef = {
  id: 'classic',
  map: 'patio',
  name: { en: 'Classic arcade', es: 'Arcade clásico' },
  blurb: { en: 'Three waves and the speaker king. The original Sunday, remastered.', es: 'Tres oleadas y el rey de las bocinas. El domingo original, remasterizado.' },
  objective: { en: 'Clear three waves, then El Rey.', es: 'Limpia tres oleadas y luego al Rey.' },
  tip: { en: 'Hold to charge. R calls the chanclas home. F is La Legendaria.', es: 'Mantén para cargar. R llama las chanclas. F es La Legendaria.' },
  dossier: { en: 'Bocinas, influencers, blowers, then the boss.', es: 'Bocinas, influencers, sopladores, y el jefe.' },
  par: 8000, stall: false, finale: true,
  waves: [
    { kinds: ['bocinas', 'bocinas', 'bocinas', 'bocinas', 'bocinas', 'bocinas'], max: 2, gap: 1.8 },
    { kinds: ['influencer', 'bocinas', 'influencer', 'influencer', 'bocinas', 'influencer'], max: 3, gap: 1.4 },
    { kinds: ['soplador', 'influencer', 'bocinas', 'soplador', 'influencer', 'bocinas'], max: 4, gap: 1.1 },
    { kinds: ['rey'], max: 1, gap: 0.4, boss: true },
  ],
};

export const PICKUPS: Record<PickupKind, LangText> = {
  cafe: { en: 'Cafecito', es: 'Cafecito' },
  chile: { en: 'Chile', es: 'Chile' },
  agua: { en: 'Agua fresca', es: 'Agua fresca' },
  rebozo: { en: 'Rebozo', es: 'Rebozo' },
  micro: { en: 'Micrófono', es: 'Micrófono' },
};
