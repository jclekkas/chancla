# Milestone VD: a clean phone image and lived-in lanes

Chosen by the Visual Director from in-game evidence of the GX checkpoint (`6eb6f1f`).

> During normal gameplay, the player will clearly notice that the phone image is crisp (no
> stair-stepped rooflines, broken outlines or crawling tile patterns) and that the alleys read as
> lived-in streets instead of blank plaster boxes.

## Primary: phone Low image quality

- **Problem:** Low renders at pixel ratio 1 without anti-aliasing, so every edge is upscaled raw
  on 2x and 3x phones.
- **Why it ranked first:** it affects the whole screen on every frame.

## Supporting: break up the blank lane walls

- **Problem:** large untreated wall planes face the play lanes, where most fights happen.
- **Approach:** add visual-only trim, flush with the walls, merged into the kit. Nothing may read
  as cover.

## Matched evidence

- **Phone Low (same camera, time and HUD):** `phone-low-plaza-sun`, `phone-low-opening`,
  `phone-low-alley-shade` and La Plaza, each with a 2x crop of the roofline and tile frieze.
- **Desktop High:** `desktop-high-fight`, `desktop-high-opening` and La Plaza.
- **Motion:** the El Patio route walk on phone Low, before and after.

## Stop when

- Phone Low crops show no visible stair-stepping on major edges, and more resolution only changes
  cost.
- No lane frame has an untreated wall covering more than about 20% of the screen.
- Phone Low cost rises past its budget: then roll back to the last step that holds.
