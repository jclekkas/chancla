// Mission 4: La Piñata Contraataca. The finale, in the central plaza
// rebuilt as an arena at dusk: the golden-chancla statue is gone, the
// piñata hangs over the fountain, party tables give readable cover, and two
// marked "party mirrors" on the café and kitchen fronts allow an optional
// ricochet finish. The encounter itself is in ../pinata.ts.
import type { MapBox } from '../../map';
import type { MissionDef } from '../types';

const bx = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, mat: MapBox['mat'], tag = 'prop'): MapBox =>
  ({ minX, minY, minZ, maxX, maxY, maxZ, mat, tag, bounce: true, blocksSound: true });

export const PINATA_MISSION: MissionDef = {
  id: 'pinata',
  order: 4,
  title: 'm4.title',
  premise: 'm4.premise',
  objective: 'm4.objective',
  minutes: [3, 5],
  theme: 'dusk',
  music: 'pinata',
  start: { at: [-12, 0, 0], yaw: -Math.PI / 2 },
  layout: {
    remove: (b) => b.mat === 'statue',
    signs: { 'CASA SOL': 'CASA DE ROSA', 'CASA LUNA': 'CASA DE LOS VECINOS', 'PANADERÍA ROSA': 'COCINA DE ROSA' },
    add: [
      // Party tables: waist-high cover around the fountain.
      bx(-7.9, 0, 4.15, -6.1, 0.9, 5.05, 'stall', 'table'),
      bx(6.1, 0, -5.05, 7.9, 0.9, -4.15, 'stall', 'table'),
      bx(-1.9, 0, -7.6, -0.1, 0.9, -6.7, 'stall', 'table'),
      bx(0.1, 0, 6.7, 1.9, 0.9, 7.6, 'stall', 'table'),
      // Marked party mirrors: optional ricochet surfaces facing the piñata.
      bx(-2.0, 1.4, -8.0, 2.0, 5.6, -7.92, 'stone', 'bank:espejo1:far'),
      bx(-2.0, 1.4, 7.92, 2.0, 5.6, 8.0, 'stone', 'bank:espejo2'),
    ],
    waypoints: [[-12, 0, 0], [-9, 0, -4.5], [-9, 0, 4.5], [9, 0, 4.5], [9, 0, -4.5], [0, 0, -5.5], [0, 0, 5.5], [-5, 0, 0], [5, 0, 0]],
  },
  entities: [
    { kind: 'pinata', id: 'pinata', at: [0, 9.4, 0], rope: 4.1 },
  ],
  stages: [
    {
      id: 'boss', title: 'm4.s1', respawn: { at: [-12, 0, 0], yaw: -Math.PI / 2 },
      onEnter: [{ do: 'say', line: 'pinata_intro' }, { do: 'say', line: 'm4_start' }],
      goals: [{ id: 'g1', kind: 'boss', label: 'm4.g1' }],
    },
  ],
  // Time target: 2.5x the helper bot's median over 8 seeds (51.4 s, scripts/campaign-sim.ts),
  // rounded up to 15 s. The bot plays near-perfectly; human playtesting has not tuned this yet.
  timeTargetMs: 135000,
  challenges: [
    { id: 'complete', label: 'ch.complete' },
    { id: 'time', label: 'ch.time' },
    { id: 'skill', label: 'm4.skill', skill: 'ricochetFinish' },
  ],
  config: { victory: { at: [0, 0.85, 0], yaw: 0 }, finale: true },
};
