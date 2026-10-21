// Waypoint graph for bots. Links are not hand-authored: a link i -> j exists
// only if a body actually walking straight from i reaches j under the real
// movement rules. That covers stairs, terraces and one-way drops for free.

import { NET } from './config';
import { World, newBody, stepMove } from './physics';
import type { MapData } from './map';

export interface NavGraph {
  nodes: Array<{ x: number; y: number; z: number }>;
  links: number[][]; // outgoing neighbour indices
}

const DT = 1 / NET.tickRate;

export function walkReaches(world: World, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
  const body = newBody(a.x, a.y + 0.02, a.z);
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.ceil(((d / 6) * 1.5 + 0.6) / DT);
  for (let i = 0; i < steps; i++) {
    const dx = b.x - body.x, dz = b.z - body.z;
    if (Math.hypot(dx, dz) < 0.45) return Math.abs(body.y - b.y) < 0.5;
    stepMove(world, body, { mx: 0, mz: 1, yaw: Math.atan2(-dx, -dz), jump: false, crouch: false }, DT);
  }
  return false;
}

const cache = new WeakMap<MapData, NavGraph>();

export function buildNavGraph(map: MapData, world: World, maxLink = 10): NavGraph {
  const hit = cache.get(map);
  if (hit) return hit;
  const nodes = map.waypoints;
  const links: number[][] = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const a = nodes[i]!, b = nodes[j]!;
      if (Math.hypot(b.x - a.x, b.z - a.z) > maxLink || b.y - a.y > 3) continue;
      if (walkReaches(world, a, b)) links[i]!.push(j);
    }
  }
  const g = { nodes, links };
  cache.set(map, g);
  return g;
}

export function findPath(g: NavGraph, from: number, to: number): number[] {
  if (from === to) return [to];
  const n = g.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const open = new Set<number>([from]);
  dist[from] = 0;
  const h = (i: number) => Math.hypot(g.nodes[i]!.x - g.nodes[to]!.x, g.nodes[i]!.z - g.nodes[to]!.z);
  while (open.size) {
    let cur = -1, best = Infinity;
    for (const i of open) { const f = dist[i]! + h(i); if (f < best) { best = f; cur = i; } }
    if (cur === to) break;
    open.delete(cur);
    for (const nb of g.links[cur]!) {
      const a = g.nodes[cur]!, b = g.nodes[nb]!;
      const c = dist[cur]! + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (c < dist[nb]!) { dist[nb] = c; prev[nb] = cur; open.add(nb); }
    }
  }
  if (!Number.isFinite(dist[to]!)) return [];
  const path: number[] = [];
  for (let c = to; c !== -1; c = prev[c]!) path.push(c);
  return path.reverse();
}

// Index of the closest node a body at p can walk to directly.
export function nearestNode(g: NavGraph, world: World, p: { x: number; y: number; z: number }): number {
  const order = g.nodes.map((n, i) => ({ i, d: Math.hypot(n.x - p.x, n.z - p.z) + Math.abs(n.y - p.y) * 3 })).sort((a, b) => a.d - b.d);
  for (const o of order.slice(0, 6)) if (o.d < 12 && walkReaches(world, p, g.nodes[o.i]!)) return o.i;
  return order[0]!.i;
}
