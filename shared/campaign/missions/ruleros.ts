// Mission 1: Operación Ruleros. Rosa's house (the west compound), her
// balcony (the café terrace) and the courtyard and alley around them.
//
//   set 1  on her vanity at home: walk up and take it (teaches the counter)
//   set 2  in a basket hanging over the balcony: hit the latch, climb, collect
//   set 3  wedged on a ledge across the alley: only a bank shot off the
//          tiled mural knocks it down safely (direct hits are refused)
//   set 4  worn by an influencer doing a photo shoot: interrupt a pose
//   set 5  under a tower of empty boxes: La Pesada topples it
//   set 6  the wind-up delivery cart drives off with it: stop it
import type { MapBox } from '../../map';
import type { MissionDef } from '../types';

const bx = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, mat: MapBox['mat'], tag = 'prop', bounce = true): MapBox =>
  ({ minX, minY, minZ, maxX, maxY, maxZ, mat, tag, bounce, blocksSound: true });

// The cart's getaway loop: plaza, north opening, the alley, back in by the
// west opening. Every segment was checked against the map's boxes with the
// cart's radius, so it only ever drives (and stops) on open, reachable ground.
const loop: Array<[number, number, number]> = [
  [0, 0, -4.6], [4.6, 0, -4.2], [4.25, 0, -9.5], [4.25, 0, -12.3], [0, 0, -12.1], [-5, 0, -12.3],
  [-9.5, 0, -13.5], [-13.5, 0, -13.7], [-15.9, 0, -13.0], [-15.8, 0, -9.5], [-16.1, 0, -6.2], [-12, 0, -3], [-6, 0, -1],
];

export const RULEROS: MissionDef = {
  id: 'ruleros',
  order: 1,
  title: 'm1.title',
  premise: 'm1.premise',
  objective: 'm1.objective',
  minutes: [3, 5],
  theme: 'morning',
  music: 'ruleros',
  start: { at: [-24.6, 0, 0.5], yaw: -Math.PI / 2 },
  layout: {
    signs: { 'CASA SOL': 'CASA DE ROSA', 'CASA LUNA': 'CASA DE LOS VECINOS', 'PANADERÍA ROSA': 'COCINA DE ROSA' },
    add: [
      bx(-26, 0, 1.8, -25.35, 1.1, 3.4, 'stall', 'vanity'), // Rosa's vanity, set 1 on top
      bx(-6.55, 2.7, -10.95, -6.2, 6.4, -10.6, 'wood', 'pole'), // balcony pole holding the basket
      bx(-5.6, 1.2, -11.1, -2.4, 4.4, -11.0, 'stone', 'bank:mural'), // tiled mural: the bank-shot surface
      bx(-4.9, 3.0, -15.0, -3.1, 3.12, -14.35, 'wood', 'ledge'), // ledge under the wedged set
    ],
    waypoints: [[-23.2, 0, -10.0], [-24.2, 0, 1.0], [-4, 0, -13.3], [-8.6, 2.7, -9.6], [-12.5, 0, -3.5], [-6.8, 0, -2.5], [4.2, 0, 0], [-4.2, 0, 0], [0, 0, 4.4], [0, 0, -4.4]],
  },
  entities: [
    // Set 1: on the vanity.
    { kind: 'pickup', id: 'set1', item: 'rulero', variant: 'pink', at: [-25.7, 1.12, 2.6] },
    // Set 2: in the basket over the balcony; the latch is on the pole.
    { kind: 'pickup', id: 'set2', stages: ['home', 'hunt', 'cart'], item: 'rulero', variant: 'turquoise', at: [-7.7, 5.1, -10.2], hidden: true },
    { kind: 'deco', id: 'basket', at: [-7.7, 5.35, -10.2], visual: 'basket' },
    {
      kind: 'target', id: 'latch', stages: ['home', 'hunt', 'cart'], at: [-6.38, 5.75, -10.4], r: 0.5, visual: 'latch',
      on: [{ do: 'drop', id: 'set2', to: [-8.6, 2.7, -9.6] }, { do: 'fix', id: 'basket' }, { do: 'say', line: 'm1_latch' }],
      hint: { stand: [-7.1, 0, -3.6], aim: [-6.38, 5.75, -10.4] },
    },
    // Set 3: wedged on the ledge; bank it off the mural on the café wall.
    { kind: 'pickup', id: 'set3', stages: ['hunt', 'cart'], item: 'rulero', variant: 'marigold', at: [-4, 3.35, -14.75], hidden: true },
    {
      kind: 'target', id: 'wedged', stages: ['hunt', 'cart'], at: [-4, 3.4, -14.75], r: 0.6, need: 'bank', visual: 'wedged',
      on: [{ do: 'drop', id: 'set3', to: [-4, 0, -13.1] }, { do: 'say', line: 'm1_bank' }],
      hint: { stand: [-4, 0, -13.6], aim: [-4, 2.29, -11.1], plane: { axis: 'z', at: -11.1 } },
    },
    // Set 4: the influencer wears it for his photo shoot.
    { kind: 'pickup', id: 'set4', stages: ['hunt', 'cart'], item: 'rulero', variant: 'violet', at: [-12.5, 0, -3.5] },
    {
      kind: 'actor', id: 'influ', stages: ['hunt', 'cart'], archetype: 'influencer', speed: 1.7,
      path: [[-12.5, 0, -3.5], [-6.8, 0, -2.5], [-9.8, 0, -6.2]],
      behavior: { type: 'poser', poseMs: 3400, holds: 'set4' },
    },
    // Set 5: under a tower of empty boxes in the yard behind the house.
    { kind: 'pickup', id: 'set5', stages: ['home', 'hunt', 'cart'], item: 'rulero', variant: 'cream', at: [-24.8, 2.5, -10], hidden: true },
    { kind: 'blocker', id: 'tower', box: [-25.4, 0, -10.6, -24.2, 2.4, -9.4], visual: 'boxtower' },
    {
      kind: 'target', id: 'towerhit', stages: ['home', 'hunt', 'cart'], at: [-24.8, 1.3, -10], r: 0.95, need: 'heavy', visual: 'none',
      on: [{ do: 'remove', id: 'tower' }, { do: 'drop', id: 'set5', to: [-23.5, 0, -9.3] }, { do: 'say', line: 'm1_tower' }],
      hint: { stand: [-23.3, 0, -4.8], aim: [-24.8, 1.0, -10] },
    },
    // Set 6: the wind-up delivery cart, enabled in the last stage.
    { kind: 'pickup', id: 'set6', item: 'rulero', variant: 'gold', at: loop[0]! },
    {
      kind: 'actor', id: 'cart', archetype: 'cart', speed: 3.4, path: loop, disabled: true,
      behavior: { type: 'runner', hits: 5, holds: 'set6' },
    },
  ],
  stages: [
    {
      id: 'first', title: 'm1.s1', respawn: { at: [-24.6, 0, 0.5], yaw: -Math.PI / 2 },
      onEnter: [{ do: 'say', line: 'm1_start' }],
      goals: [{ id: 'g1', kind: 'collect', item: 'rulero', count: 1, label: 'm1.g1' }],
    },
    {
      id: 'home', title: 'm1.s2', respawn: { at: [-23.4, 0, -2.6], yaw: Math.PI },
      onEnter: [{ do: 'say', line: 'm1_first' }],
      goals: [{ id: 'g2', kind: 'collect', item: 'rulero', count: 3, label: 'm1.g2' }],
    },
    {
      id: 'hunt', title: 'm1.s3', respawn: { at: [-19, 0, -2.75], yaw: -Math.PI / 2 },
      onEnter: [{ do: 'say', line: 'm1_courtyard' }],
      goals: [{ id: 'g3', kind: 'collect', item: 'rulero', count: 5, label: 'm1.g3' }],
    },
    {
      id: 'cart', title: 'm1.s4', respawn: { at: [-9.5, 0, 0], yaw: -Math.PI / 2 },
      onEnter: [{ do: 'enable', id: 'cart' }, { do: 'say', line: 'm1_cart' }],
      goals: [{ id: 'g4', kind: 'collect', item: 'rulero', count: 6, label: 'm1.g4' }],
      onDone: [{ do: 'say', line: 'm1_final' }],
    },
  ],
  // Time target: 2.5x the helper bot's median over 8 seeds (47.2 s, scripts/campaign-sim.ts),
  // rounded up to 15 s. The bot plays near-perfectly; human playtesting has not tuned this yet.
  timeTargetMs: 120000,
  challenges: [
    { id: 'complete', label: 'ch.complete' },
    { id: 'time', label: 'ch.time' },
    // Limit measured, not guessed: the cart needs 5 hits, and a near-perfect
    // bot (0.002 rad aim error) needed 8 throws at best over 4 seeds.
    { id: 'skill', label: 'm1.skill', skill: 'cartThrows', limit: 8 },
  ],
  config: { counter: 'rulero', total: 6 },
};
