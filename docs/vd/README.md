# VD milestone result: a clean phone image and lived-in lanes

- **Commit:** `a6ee952` on `codex/close-combat` (code). This note is the following commit.
- **Baseline:** the GX checkpoint, `1198b5e` (notes in `6eb6f1f`).
- **Contract:** see `CONTRACT.md`.
- **Scope:** offline preview only. Gameplay, collision, maps, timing and protocol are unchanged.

## What changed

1. **Anti-aliasing on every quality tier** (`7b82ee3`).
   - Low and Medium previously rendered without it.
   - The pixel cap is unchanged (Low 1, Medium 1.5, High 2).
   - A Low cap of 1.25 was tested and rejected: it was indistinguishable at normal phone size and
     shades about 56% more pixels.
2. **Lane walls** (`eb66967`): the plain wall faces that look onto walkable ground get visual-only
   dressing.
   - **Pieces:** downpipes, meter boxes, blind shuttered windows up high, painted shop signs,
     adverts, a mural, posters and pilasters.
   - **Shared atlas:** the painted pieces share one atlas with the window glass, so draw calls are
     unchanged.
   - **Placement:** flush paint; pipes and boxes are at most 8 cm proud below 2.6 m; collision is
     unchanged.
3. **Director's one correction** (`a6ee952`): every dressed run gets an eye-height painted piece
   about every 4.5 m. The first pass had left the nearest stretch of long runs bare, including a
   wall covering 35% of the screen in the El Patio opening view.

## Visual Director verdict (from in-game captures)

- **Phone Low: substantial.**
  - Stair-steps on the awnings, cornices, lantern, hat brims and bin lids are gone at normal
    viewing size.
  - The opening alley's purple wall now carries a shop advert instead of bare plaster.
- **Desktop High: moderate.**
  - Anti-aliasing adds little here, because High was already fairly clean.
  - The lane walls are the gain: the opening, fight and Plaza walkway now read as streets.
  - The arcade and sunlit plaza views are essentially unchanged.
- **Contract:** met on both tiers.

## Cost against GX (route stations, exact counts, Linux Chromium with SwiftShader)

| | GX | VD |
|---|---|---|
| Draw calls, all 10 route stations | 79-159 | identical |
| Triangles, desktop High | 144-158k | +2.5k |
| Triangles, phone Low | 64-69k | +1.4k |
| Texture memory, High / Low | 8.00 / 6.02 MB | 9.23 / 6.32 MB |
| Shader programs, High / Low | 36 / 35 | 38 / 38 |
| Download, gzipped JS | 484.4 KB | 488.5 KB (+4.0 KB) |

- **Anti-aliasing:** its multisampling cost is on the GPU and is not measurable on this software
  renderer.
- **Real-device check:** Low's pixel ratio is unchanged, so phone fill cost rises only by the
  multisample resolve. A real-device check is still needed (see the checklist).

## Checks

| Check | Result |
|---|---|
| Unit and multiplayer | 576/576 |
| Typecheck and build | pass |
| Quality switching (`quality-switch-e2e.ts`) | 27/27 |
| Campaign isolation | matched mission shot: mean pixel difference 0.06 of 255 against GX |

- **Crawl in motion, phone Low route walk (391 frames):**
  - Median share of pixels that jump more than 48 levels between consecutive frames: 3.24% on
    GX, 2.83% after.
  - At the 90th percentile: 10.4% to 9.9%.
  - Camera motion dominates this measure, so it understates the edge gain.
- **Not rerun:** the killcam and Puro suites. Neither change touches gameplay, timing or replay
  logic.

## Limits

- **Plaza North walkway:** the stretch of the left wall nearest the camera is still plain, at about
  20% of the frame (at the threshold).
- **Fight view:** the nearest right-edge face is still plain, at under 20%.
- **Adverts:** only a few designs, so they repeat within a match.
- **Fine textures:** anti-aliasing at ratio 1 softens tile patterns and small sign lettering
  slightly.
- **Arcade:** it shares the world kit, so it shows the lane walls too (as with GX). This remains a
  decision for review.
- **Still open, out of scope:**
  - characters blending into shade at combat distance;
  - Fiesta's unlit lanterns;
  - nameplates overlapping the team banner on Fiesta phone Low.

## Mac High and phone Low checklist

1. **Phone at Low, El Patio Practice:**
   - Look at the plaza rooflines, awnings and tile friezes, then walk: edges should be smooth and
     the tiles should not shimmer.
   - Check the frame rate feels the same as before.
2. **Phone Low, the alley out of the Casa Sol passage:** the purple wall should carry the TORTILLAS
   advert, and nothing on the walls should read as cover.
3. **Mac at High, El Patio and La Plaza:** walk the lanes. The walls should read as shopfronts and
   house backs, not blank plaster, and there should be no stutter on first look.
4. **Any device:** switch quality Low, Medium, High and back mid-match. The image should rebuild
   cleanly.
