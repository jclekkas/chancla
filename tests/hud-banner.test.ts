// @vitest-environment jsdom
// The spawn banner lasts its time in seconds at any frame rate, holds while the practice menu pauses, and a background tab does not swallow it.
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Hud } from '../src/fps/hud';

// The game's own page, so every element the HUD writes exists.
const PAGE = readFileSync(path.resolve(__dirname, '../index.html'), 'utf8').replace(/^[\s\S]*<body[^>]*>|<\/body>[\s\S]*$/g, '').replace(/<script[\s\S]*?<\/script>/g, '');

const FRAME = { hp: 100, alive: true, weapon: 0, cooldownMs: 0, switchMs: 0, meleeMs: 0, respawnInMs: 0, protectedMs: 0, scores: [0, 0], timeLeftMs: 300000, phase: 'playing', countdownMs: 0, region: null, rtt: 0, quality: 'good', fps: 60, showStats: false, practice: true, team: 0 } as never;

describe('spawn banner', () => {
  let hud: Hud, banner: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = PAGE;
    hud = new Hud();
    banner = document.getElementById('spawn-banner')!;
  });
  /** Frames of `dt` seconds (the engine's step is capped at 0.1 s; the time on screen is not). */
  const run = (secs: number, frameS: number, paused = false) => {
    for (let t = 0; t < secs - 1e-9; t += frameS) hud.update(FRAME, Math.min(0.1, frameS), 0, paused ? 0 : Math.min(1, frameS));
  };

  it('lasts about 2.8 s at 60 fps', () => {
    hud.spawnBanner(0, true);
    run(2.7, 1 / 60); expect(banner.hidden).toBe(false);
    run(0.2, 1 / 60); expect(banner.hidden).toBe(true);
  });
  it('lasts the same 2.8 s at 2 fps, although the frame step is capped', () => {
    hud.spawnBanner(0, true);
    run(2.5, 0.5); expect(banner.hidden).toBe(false);
    run(0.5, 0.5); expect(banner.hidden).toBe(true);
  });
  it('holds while the match is paused, then finishes its time', () => {
    hud.spawnBanner(0, true);
    run(1, 1 / 60);
    run(10, 1 / 60, true); expect(banner.hidden).toBe(false);
    run(1.9, 1 / 60); expect(banner.hidden).toBe(true);
  });
  it('a long gap (a background tab) counts as at most 1 s', () => {
    hud.spawnBanner(0, true);
    hud.update(FRAME, 0.1, 0, 1); // the first frame back after minutes away
    expect(banner.hidden).toBe(false);
    run(1.9, 1 / 60); expect(banner.hidden).toBe(true);
  });
});
