// Mission 2: Aquí se cocina, no se improvisa. The outdoor kitchen on the
// bakery terrace (east), the market alley below it, and the courtyard of
// the east house where the food is served.
//
//   1  four ingredient baskets: two on the market floor, one on a crate,
//      one stuck on the elote kiosk's awning (hit the sign to shake it down)
//   2  get them to the outdoor kitchen
//   3  cook: the timer fills while nobody interferes. The influencer walks
//      up to film (hit him and he leaves), the speaker cart parks below the
//      terrace and its bass shakes an ingredient off the shelf (stop it while
//      it warms up, or go fetch the basket from the recovery spot), and
//      halfway through the kitchen timer goes haywire (hit its button in the
//      green). A disruption that lasts too long costs the current step only.
//   4  carry the tray to the courtyard table; two serving carts try to bump
//      it out of Rosa's hands. A spill leaves the tray where it fell.
import type { MapBox } from '../../map';
import type { MissionDef } from '../types';

const bx = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, mat: MapBox['mat'], tag = 'prop'): MapBox =>
  ({ minX, minY, minZ, maxX, maxY, maxZ, mat, tag, bounce: true, blocksSound: true });

const T = 2.7; // terrace height
const RECOVER: [number, number, number] = [7.1, 0, 3.9]; // foot of the terrace stairs, always reachable

export const COCINA: MissionDef = {
  id: 'cocina',
  order: 2,
  title: 'm2.title',
  premise: 'm2.premise',
  objective: 'm2.objective',
  minutes: [4, 6],
  theme: 'noon',
  music: 'cocina',
  start: { at: [9.2, T, 9.4], yaw: 0 },
  layout: {
    signs: { 'CASA SOL': 'CASA DE ROSA', 'CASA LUNA': 'CASA DE LOS VECINOS', 'PANADERÍA ROSA': 'COCINA DE ROSA' },
    add: [
      bx(6.8, T, 10.3, 8.0, T + 0.9, 11, 'stall', 'counter'),
      bx(8.4, T, 10.3, 9.8, T + 0.9, 11, 'stone', 'stove'),
      bx(6.0, T, 9.2, 6.35, T + 1.9, 10.8, 'wood', 'shelf'),
      bx(23.2, 0, -3.1, 25.0, 0.8, -2.0, 'stall', 'table'), // the courtyard table
    ],
    waypoints: [[9.3, T, 9.4], [7.4, T, 9.4], [11.2, T, 11.8], [14.6, 0, 11.9], [-4, 0, 12.6], [-8.2, 0, 12.9], [12.8, 0, -2.3], [22.6, 0, -3.2], [24.2, 0, -1.2], [19, 0, 2.75], [7.1, 0, 3.9]],
  },
  entities: [
    // Stage 1: the baskets.
    { kind: 'pickup', id: 'masa', item: 'ingredient', variant: 'masa', at: [-4, 0, 12.6], recoverAt: RECOVER },
    { kind: 'pickup', id: 'rajas', item: 'ingredient', variant: 'rajas', at: [-8.25, 1.0, 11.6], recoverAt: [RECOVER[0] + 0.8, 0, RECOVER[2]] },
    { kind: 'pickup', id: 'queso', item: 'ingredient', variant: 'queso', at: [12.8, 2.65, -4.5], hidden: true, recoverAt: [RECOVER[0] - 0.8, 0, RECOVER[2]] },
    {
      kind: 'target', id: 'kiosksign', at: [12.8, 2.25, -3.45], r: 0.75, visual: 'none', stages: ['baskets'],
      on: [{ do: 'drop', id: 'queso', to: [12.8, 0, -2.5] }],
      hint: { stand: [12.8, 0, 2.0], aim: [12.8, 2.25, -3.45] },
    },
    { kind: 'pickup', id: 'hojas', item: 'ingredient', variant: 'hojas', at: [22.8, 0, -4.6], recoverAt: [RECOVER[0], 0, RECOVER[2] - 0.8] },
    { kind: 'zone', id: 'kitchen', at: [9.2, T, 9.4], r: 2.3, visual: 'prep', stages: ['tokitchen', 'cook'] },
    // Stage 3: the interruptions.
    {
      kind: 'actor', id: 'influ', archetype: 'influencer', speed: 2.0, stages: ['cook'],
      path: [[16.6, 0, 12.0], [15.6, 0, 11.8], [12.1, T, 11.8], [11.0, T, 11.4], [10.6, T, 9.4]],
      behavior: { type: 'filmer', zone: 'kitchen', firstMs: 7000, everyMs: 21000 },
    },
    {
      kind: 'actor', id: 'bocinas', archetype: 'speaker', speed: 1.5, stages: ['cook'],
      path: [[15.5, 0, 3.5], [10.2, 0, 6.5]], // parks in the open plaza right below the terrace
      behavior: { type: 'shaker', shelf: [6.2, T + 1.5, 10.0], firstMs: 16000, everyMs: 26000, warnMs: 4200, hits: 2, drops: ['masa', 'rajas', 'queso', 'hojas'] },
    },
    {
      kind: 'target', id: 'timer', at: [9.1, T + 1.35, 10.75], r: 0.5, visual: 'timer', disabled: true, stages: ['cook'], facing: Math.PI,
      window: { periodMs: 1900, openMs: 600 },
      on: [{ do: 'say', line: 'm2_segment' }],
    },
    // Stage 4: the tray and the carts.
    { kind: 'pickup', id: 'tray', item: 'tray', at: [7.4, T + 0.9, 10.65], carry: true, stages: ['serve'] },
    { kind: 'zone', id: 'table', at: [24.1, 0, -1.3], r: 1.5, visual: 'drop', stages: ['serve'] },
    { kind: 'actor', id: 'cart1', archetype: 'rollcart', speed: 3.5, stages: ['serve'], path: [[13.5, 0, 5.8]], behavior: { type: 'thief', item: 'tray', delayMs: 1500 } },
    { kind: 'actor', id: 'cart2', archetype: 'rollcart', speed: 3.3, stages: ['serve'], path: [[24.6, 0, 4.6]], behavior: { type: 'thief', item: 'tray', delayMs: 6000 } },
  ],
  stages: [
    {
      id: 'baskets', title: 'm2.s1', respawn: { at: [9.2, T, 9.4], yaw: 0 },
      onEnter: [{ do: 'say', line: 'm2_start' }, { do: 'say', line: 'm2_baskets' }],
      goals: [{ id: 'g1', kind: 'collect', item: 'ingredient', count: 4, label: 'm2.g1' }],
    },
    {
      id: 'tokitchen', title: 'm2.s2', respawn: { at: [7.1, 0, 3.9], yaw: Math.PI },
      goals: [{ id: 'g2', kind: 'reach', zone: 'kitchen', label: 'm2.g2' }],
    },
    {
      id: 'cook', title: 'm2.s3', respawn: { at: [9.2, T, 9.4], yaw: 0 },
      onEnter: [{ do: 'say', line: 'm2_cook' }],
      goals: [{ id: 'g3', kind: 'defend', zone: 'kitchen', ms: 80000, segments: 3, graceMs: 9000, label: 'm2.g3', malfunction: { at: 0.55, target: 'timer' } }],
    },
    {
      id: 'serve', title: 'm2.s4', respawn: { at: [9.2, T, 9.4], yaw: 0 },
      onEnter: [{ do: 'say', line: 'm2_tray' }],
      goals: [{ id: 'g4', kind: 'deliver', item: 'tray', zone: 'table', label: 'm2.g4' }],
      onDone: [{ do: 'say', line: 'm2_done' }],
    },
  ],
  // Time target: 2.5x the helper bot's median over 8 seeds (120.4 s, scripts/campaign-sim.ts),
  // rounded up to 15 s. The bot plays near-perfectly; human playtesting has not tuned this yet.
  timeTargetMs: 315000,
  challenges: [
    { id: 'complete', label: 'ch.complete' },
    { id: 'time', label: 'ch.time' },
    { id: 'skill', label: 'm2.skill', skill: 'noSegmentLost' },
  ],
  // The family menu is data: swap the dish and ingredient labels here.
  config: { counter: 'ingredient', total: 4, menu: { dish: 'tamales de rajas con queso', drink: 'agua de jamaica', ingredients: ['masa', 'rajas', 'queso', 'hojas'] }, victory: { at: [24.1, 0, -0.4], yaw: 0 } },
};
