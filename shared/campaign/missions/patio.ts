// Mission 3: Este patio no se limpia solo. The east house's courtyard, the
// east side of the plaza and the alley behind it, all a mess after the
// helpers' "snack break".
//
//   Courtyard  two debris piles block the doorways; wall switches send them
//              into the bins (and pop the overturned tables back up)
//   Plaza      two decorations are tangled up high; only a bank shot off the
//              marked tile panels knocks them loose
//   Alley      two more piles, and a leaf blower who keeps "helping". His gust
//              is telegraphed (a cone on the ground); hit him during the
//              wind-up to cancel it, or three times while the machine vents.
//              A gust re-scatters piles in areas that are not finished yet.
//   Finally    carry two chair stacks into the storage room.
import type { MapBox } from '../../map';
import type { MissionDef } from '../types';

const bx = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, mat: MapBox['mat'], tag = 'prop'): MapBox =>
  ({ minX, minY, minZ, maxX, maxY, maxZ, mat, tag, bounce: true, blocksSound: true });

const STORE: [number, number, number] = [25.0, 0, 0.6]; // the storage corner in the courtyard

export const PATIO: MissionDef = {
  id: 'patio',
  order: 3,
  title: 'm3.title',
  premise: 'm3.premise',
  objective: 'm3.objective',
  minutes: [4, 6],
  theme: 'afternoon',
  music: 'patio',
  start: { at: [14.5, 0, 0], yaw: -Math.PI / 2 },
  layout: {
    signs: { 'CASA LUNA': 'CASA DE LOS VECINOS' },
    add: [
      // Marked bank panels on the separation house's plaza face.
      bx(16.92, 1.6, -7.4, 17.0, 4.6, -4.2, 'stone', 'bank:tiles1'),
      bx(16.92, 1.6, 4.6, 17.0, 4.6, 7.6, 'stone', 'bank:tiles2'),
    ],
    waypoints: [[-6.5, 0, 3.2], [15.5, 0, 12.8], [22.6, 0, -12.6], [23.5, 0, -7.6], [23.5, 0, 9.5], [23.5, 0, -4.2], [23.5, 0, 4.2], [25.0, 0, 0.6], [24.6, 0, -1.0], [11.5, 0, -4.0], [10.5, 0, 4.5], [11.3, 0, -13.2], [19.3, 0, -12.9], [15, 0, -13.0], [23.5, 0, -10.0]],
  },
  entities: [
    // --- Courtyard ---------------------------------------------------------
    { kind: 'blocker', id: 'pile1', box: [22.5, 0, -6.3, 24.5, 1.3, -5.3], visual: 'pile' },
    { kind: 'blocker', id: 'pile2', box: [22.5, 0, 5.3, 24.5, 1.3, 6.3], visual: 'pile' },
    { kind: 'deco', id: 'bin1', at: [25.4, 0, -5.6], visual: 'bin' },
    { kind: 'deco', id: 'bin2', at: [25.4, 0, 5.6], visual: 'bin' },
    { kind: 'deco', id: 'table1', at: [24.4, 0, -2.6], visual: 'table' },
    { kind: 'deco', id: 'table2', at: [24.6, 0, 3.0], visual: 'table', facing: Math.PI },
    {
      kind: 'target', id: 'sw1', at: [25.93, 1.6, -4.4], r: 0.5, visual: 'switch', facing: Math.PI / 2,
      on: [{ do: 'remove', id: 'pile1' }, { do: 'flag', flag: 'pile1_clear' }, { do: 'fix', id: 'table1' }, { do: 'say', line: 'm3_switch' }],
      hint: { stand: [23.0, 0, -3.6], aim: [25.93, 1.6, -4.4] },
    },
    {
      kind: 'target', id: 'sw2', at: [25.93, 1.6, 4.4], r: 0.5, visual: 'switch', facing: Math.PI / 2,
      on: [{ do: 'remove', id: 'pile2' }, { do: 'flag', flag: 'pile2_clear' }, { do: 'fix', id: 'table2' }, { do: 'say', line: 'm3_switch' }],
      hint: { stand: [23.0, 0, 3.0], aim: [25.93, 1.6, 4.4] },
    },
    // --- Plaza: decorations tangled up high, bank shots only ---------------
    {
      kind: 'target', id: 'deco1', at: [14.5, 4.4, -7.75], r: 0.65, need: 'bank', visual: 'banner',
      on: [{ do: 'flag', flag: 'deco1_free' }, { do: 'fix', id: 'garland1' }, { do: 'say', line: 'm3_bank' }],
      hint: { stand: [13.0, 0, -2.0], aim: [16.92, 3.55, -6.65], plane: { axis: 'x', at: 16.92 } },
    },
    {
      kind: 'target', id: 'deco2', at: [13.2, 4.3, 7.75], r: 0.65, need: 'bank', visual: 'lantern',
      on: [{ do: 'flag', flag: 'deco2_free' }, { do: 'fix', id: 'garland2' }, { do: 'say', line: 'm3_bank' }],
      hint: { stand: [11.0, 0, 3.0], aim: [16.92, 3.31, 6.63], plane: { axis: 'x', at: 16.92 } },
    },
    { kind: 'deco', id: 'garland1', at: [12, 5.6, -3], visual: 'banner' },
    { kind: 'deco', id: 'garland2', at: [12, 5.6, 3], visual: 'lantern' },
    // --- Alley ---------------------------------------------------------------
    { kind: 'blocker', id: 'pile3', box: [10.4, 0, -14.3, 12.2, 1.3, -12.6], visual: 'pile' },
    { kind: 'blocker', id: 'pile4', box: [18.4, 0, -14.3, 20.2, 1.3, -12.6], visual: 'pile' },
    { kind: 'deco', id: 'bin3', at: [9.5, 0, -14.4], visual: 'bin' },
    { kind: 'deco', id: 'bin4', at: [21.3, 0, -14.4], visual: 'bin' },
    {
      kind: 'target', id: 'sw3', at: [11.3, 1.7, -14.93], r: 0.5, visual: 'switch', facing: Math.PI,
      on: [{ do: 'remove', id: 'pile3' }, { do: 'flag', flag: 'pile3_clear' }, { do: 'say', line: 'm3_switch' }],
      hint: { stand: [11.3, 0, -11.8], aim: [11.3, 1.7, -14.93] },
    },
    {
      kind: 'target', id: 'sw4', at: [19.3, 1.7, -14.93], r: 0.5, visual: 'switch', facing: Math.PI,
      on: [{ do: 'remove', id: 'pile4' }, { do: 'flag', flag: 'pile4_clear' }, { do: 'say', line: 'm3_switch' }],
      hint: { stand: [19.3, 0, -11.8], aim: [19.3, 1.7, -14.93] },
    },
    {
      kind: 'actor', id: 'blow', archetype: 'blower', speed: 1.6, stages: ['clean'],
      // Patrols all three areas: the alley, down through the plaza, into the
      // courtyard by the corridor, and back. He undoes work anywhere unfinished.
      path: [[8, 0, -12.8], [22, 0, -12.8], [14, 0, -12.8], [4.25, 0, -12.3], [4.25, 0, -9.5], [6.5, 0, -5], [14.8, 0, -1.5], [19, 0, 2.75], [21.6, 0, 0.2], [23.6, 0, -1.0], [21.6, 0, 0.2], [19, 0, 2.75], [14.8, 0, 1.0], [6.5, 0, -5], [4.25, 0, -9.5], [4.25, 0, -12.3]],
      behavior: { type: 'blower', hits: 3, windupMs: 1300, gustMs: 1500, ventMs: 2800, restMs: 3800, range: 7.5, halfAngle: 0.5 },
    },
    // --- Chairs ----------------------------------------------------------------
    { kind: 'pickup', id: 'chairsB', item: 'chairs', at: [-6.5, 0, 3.2], carry: true, stages: ['chairs'] },
    { kind: 'pickup', id: 'chairsC', item: 'chairs', at: [15.5, 0, 12.8], carry: true, stages: ['chairs'] },
    { kind: 'zone', id: 'chairsB_zone', at: STORE, r: 1.4, visual: 'drop', stages: ['chairs'] },
    { kind: 'zone', id: 'chairsC_zone', at: STORE, r: 1.4, visual: 'drop', stages: ['chairs'] },
  ],
  stages: [
    {
      id: 'clean', title: 'm3.s1', respawn: { at: [14.5, 0, 0], yaw: -Math.PI / 2 },
      onEnter: [{ do: 'say', line: 'm3_start' }],
      goals: [
        { id: 'gA', kind: 'flags', flags: ['pile1_clear', 'pile2_clear'], label: 'm3.gA' },
        { id: 'gB', kind: 'flags', flags: ['deco1_free', 'deco2_free'], label: 'm3.gB' },
        { id: 'gC', kind: 'flags', flags: ['pile3_clear', 'pile4_clear', 'blow_off'], label: 'm3.gC' },
      ],
    },
    {
      id: 'chairs', title: 'm3.s2', respawn: { at: [14.5, 0, 0], yaw: -Math.PI / 2 },
      onEnter: [{ do: 'say', line: 'm3_chairs' }],
      goals: [{ id: 'g2', kind: 'flags', flags: ['chairsB_stored', 'chairsC_stored'], label: 'm3.g2' }],
      onDone: [{ do: 'say', line: 'm3_done' }],
    },
  ],
  timeTargetMs: 0,
  challenges: [
    { id: 'complete', label: 'ch.complete' },
    { id: 'time', label: 'ch.time' },
    { id: 'skill', label: 'm3.skill', skill: 'blowerBeforeSecondScatter' },
  ],
  // The courtyard brightens as each area is finished.
  config: { brighten: { from: 0.72, per: 0.12, goals: ['gA', 'gB', 'gC'] }, victory: { at: [23.6, 0, 0.2], yaw: Math.PI / 2 } },
};
