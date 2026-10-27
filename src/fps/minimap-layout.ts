// Pure minimap geometry: classifies an arena's boxes into what a top view
// should show, and maps world positions onto a canvas. No DOM here, so the
// rules are unit tested (tests/minimap.test.ts); minimap.ts draws them.
//
// Fixed orientation, the same as the map sketches in shared/map.ts: +x
// (east) to the right, -z (north) up. A player facing yaw looks along
// (-sin yaw, -cos yaw) in XZ, so yaw 0 points up, yaw pi/2 left, yaw pi
// down and yaw -pi/2 right (Casa Sol's spawns face -pi/2: east, to the right).
import type { MapBox, MapData } from '../../shared/map';

/**
 * wall: impassable and tall enough to hide a player.
 * low: cover you can see over standing (and mostly jump on or step over).
 * raised: a floor you walk up onto (terraces, stairs, stages).
 * over: overhead geometry you walk under (lintels, corridor ceilings).
 */
export type MiniKind = 'wall' | 'low' | 'raised' | 'over';

export interface MiniRect { minX: number; minZ: number; maxX: number; maxZ: number; kind: MiniKind; top: number }

export interface MiniLayout {
  id: string;
  /** Walkable bounds (the map's own). */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** World rectangle the canvas shows: the bounds plus a thin margin. */
  view: { minX: number; maxX: number; minZ: number; maxZ: number };
  rects: MiniRect[];
  /** Cafecito spots, in map order. */
  pickups: Array<{ x: number; z: number }>;
  counts: Record<MiniKind, number>;
}

/** A top at or below this is low cover: under standing eye height (1.58 m) with margin, and within a jump plus a step. */
export const LOW_TOP = 1.35;
/** A box whose underside is at or above this is overhead: you walk under it (standing height 1.72 m). */
export const OVER_BOTTOM = 2.0;
const EPS = 0.05;
const MARGIN = 0.6;

function overlaps(a: MapBox, b: MapBox): boolean {
  return a.minX < b.maxX - EPS && a.maxX > b.minX + EPS && a.minZ < b.maxZ - EPS && a.maxZ > b.minZ + EPS;
}

/** One box's class. `boxes` is the whole map (for what supports it). */
export function classifyBox(m: MapBox, boxes: readonly MapBox[], waypoints: MapData['waypoints'] = []): MiniKind {
  const height = m.maxY - m.minY;
  // Resting on another box's top (a terrace parapet): judged from that floor.
  const support = m.minY > EPS ? boxes.find((o) => o !== m && Math.abs(o.maxY - m.minY) < EPS && overlaps(o, m)) : undefined;
  if (support) {
    if (height <= LOW_TOP) return 'low';
    return 'wall';
  }
  if (m.minY >= OVER_BOTTOM) return 'over';
  // Floors you walk up onto: every stair tread and stage, whatever its height.
  if (m.mat === 'step' || m.mat === 'stage') return 'raised';
  if (m.maxY <= LOW_TOP) return 'low';
  // Tall but walked on: any box a nav waypoint stands on (a terrace).
  const onTop = waypoints.some((w) => Math.abs(w.y - m.maxY) < 0.1 && w.x > m.minX && w.x < m.maxX && w.z > m.minZ && w.z < m.maxZ);
  return onTop ? 'raised' : 'wall';
}

const cache = new WeakMap<MapData, MiniLayout>();

export function layoutOf(map: MapData): MiniLayout {
  const hit = cache.get(map);
  if (hit) return hit;
  const bd = map.bounds;
  const view = { minX: bd.minX - MARGIN, maxX: bd.maxX + MARGIN, minZ: bd.minZ - MARGIN, maxZ: bd.maxZ + MARGIN };
  const rects: MiniRect[] = [];
  const counts: Record<MiniKind, number> = { wall: 0, low: 0, raised: 0, over: 0 };
  for (const m of map.boxes) {
    // Clip to the view: the outer boundary boxes reach past the corners.
    const r = { minX: Math.max(m.minX, view.minX), maxX: Math.min(m.maxX, view.maxX), minZ: Math.max(m.minZ, view.minZ), maxZ: Math.min(m.maxZ, view.maxZ) };
    if (r.maxX - r.minX <= 0 || r.maxZ - r.minZ <= 0) continue;
    const kind = classifyBox(m, map.boxes, map.waypoints);
    counts[kind]++;
    rects.push({ ...r, kind, top: m.maxY });
  }
  // Draw order: raised floors, low props, walls, then overhead outlines on top.
  const order: Record<MiniKind, number> = { raised: 0, low: 1, wall: 2, over: 3 };
  rects.sort((a, b) => order[a.kind] - order[b.kind] || a.top - b.top);
  const out: MiniLayout = { id: map.id ?? map.name, bounds: { ...bd }, view, rects, pickups: map.pickups.map((p) => ({ x: p.x, z: p.z })), counts };
  cache.set(map, out);
  return out;
}

/** Uniform scale and offsets that fit the layout's view into a w x h canvas, centred. */
export function miniScale(layout: MiniLayout, w: number, h: number): { k: number; ox: number; oy: number } {
  const vw = layout.view.maxX - layout.view.minX, vh = layout.view.maxZ - layout.view.minZ;
  const k = Math.min(w / vw, h / vh);
  return { k, ox: (w - vw * k) / 2, oy: (h - vh * k) / 2 };
}

/** World (x, z) to canvas pixels (u right, v down): +x right, -z up. */
export function toMini(layout: MiniLayout, x: number, z: number, w: number, h: number): { u: number; v: number } {
  const s = miniScale(layout, w, h);
  return { u: s.ox + (x - layout.view.minX) * s.k, v: s.oy + (z - layout.view.minZ) * s.k };
}

/** The canvas aspect (width / height) a layout fills without letterboxing. */
export function miniAspect(layout: MiniLayout): number {
  return (layout.view.maxX - layout.view.minX) / (layout.view.maxZ - layout.view.minZ);
}

/** Unit facing direction on the canvas for a yaw (v grows downwards). */
export function arrowDir(yaw: number): { du: number; dv: number } {
  return { du: -Math.sin(yaw), dv: -Math.cos(yaw) };
}

/**
 * Living teammates only: never an opponent, never someone dead, never you.
 * With no team known (free for all, or not assigned yet) nobody is shown.
 */
export function teammateMarkers(
  remotes: Iterable<{ id: number; x: number; z: number; alive: boolean }>,
  teamOf: (id: number) => number | null,
  myId: number,
  myTeam: number | null,
): Array<{ id: number; x: number; z: number }> {
  const out: Array<{ id: number; x: number; z: number }> = [];
  if (myTeam === null) return out;
  for (const r of remotes) {
    if (r.id === myId || !r.alive) continue;
    if (teamOf(r.id) !== myTeam) continue;
    out.push({ id: r.id, x: r.x, z: r.z });
  }
  return out;
}
