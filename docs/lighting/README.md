# Lighting, shadows and material depth

Offline preview only. This is a visual change only: no layout, collision, cover, weapon timing, controls,
audio, HUD or multiplayer code changed. The campaign is unchanged: pixel-identical in the matched
shot ([campaign-unchanged](campaign-unchanged.jpg)). Arcade is untouched.

## What changed

- **Light (lead, `lighting.ts`).** On the arena maps the sun is warmer and stronger, the sky fill
  that lights shade is a cooler blue, and the warm ground bounce is toned down so shade reads
  cool and deep instead of flat. The toon ramp's darker bands are deeper on the arena maps only,
  so form reads. The first-person hand is lit to match.
- **Shadows.** The same shadow maps as before (2048 on High, 1024 on Medium, none on Low). The
  penumbra is wider at no extra cost, since the filter takes five taps at any radius. The shadow
  camera is fixed over the arena, so nothing swims.
- **Grounding (`contact-shadows.ts`).** A soft disc under every character on every quality, Low
  and phone included. It shrinks and fades while she is in the air, and appears in the replay too.
- **Depth baked into the kit (`section.ts`).** Undersides of eaves, cornices, lintels, sills and
  balconies are darker, and walls darken toward the roofline under the eave. Window glass, jambs
  and door casings darken into the recess, and door panels have shaded joints. This is not AO on
  top of shadows: these faces are turned from the sun, so the shadow map already skips them and
  nothing is darkened twice.
- **Materials (`patio-materials.ts`, `patio-focal.ts`).**
  - **Plaster:** faint washes, trowel sweeps and patches.
  - **Wood:** grain and a knot.
  - **Tile:** a darker grout, so there is no bright grid, plus a glaze sheen.
  - **Paving:** bevelled.
  - **Bronze:** a sun-gated highlight band and a sky rim, so a shaded face never sparkles.
  - **Lamps:** amber glass.

  Texture sizes are unchanged.
- **La Fiesta dusk (`fiesta-dressing.ts`, `fiesta-glow.ts`, `world.ts`).**
  - The string-light bulbs glow, with an additive halo each.
  - Warm pools on the paving follow the strings, and the dance floor gets the strongest band.
  - The stages have footlights, and each table has a farolito.
  - Hedges and cloth facing a fixture get a warm lift, so the hedges no longer read dark.
  - The sky is a deeper lilac and the ground bounce warmer.

  All of it is baked: no dynamic lights (a test checks), no bloom, no fog change.

## Matched captures

Before (a92da7a) on the left, after on the right. The camera, resolution, quality, character
positions and poses, and animation time are the same in both. The views are El Patio sun (close
and combat distance) and shaded alley, La Plaza market and covered walkway, and La Fiesta dance
floor and hedge route:
- [High](compare-high.jpg)
- [Medium](compare-medium.jpg)
- [Low](compare-low.jpg)
- [Phone on Low](compare-phone-low.jpg)

Motion: [lighting-combat-clip.mp4](lighting-combat-clip.mp4) is a practice elimination on El Patio
(Medium). It shows El Revés landing, the replay, and back into play. It is rendered frame by
frame at 30 fps on a fake clock, so it plays at true speed.

## Cost (exact renderer counts, Chromium with SwiftShader)

Whole frame per view, before to after ([costs-before.json](costs-before.json),
[costs-after.json](costs-after.json)):

| Map | Draw calls | Triangles |
|---|---|---|
| El Patio, every quality | +1 | +244 High and Medium, +124 Low |
| La Plaza, every quality | +1 | +92 High and Medium, +48 Low |
| La Fiesta, High and Medium | +4 | +14.8k |
| La Fiesta, Low (desktop and phone) | +4 | +10.4k |

- **The +1 everywhere:** the contact-shadow discs.
- **La Fiesta's +4:** contact shadows, light pools, lit fixtures and bulb halos.
- **Shadow passes:** unchanged (one sun shadow map, High and Medium only).
- **Shadow-map memory:** unchanged.
- **New render targets:** none.
- **New textures:** one 64×64 alpha disc (16 KB).
- **Download:** no binary assets added.
- **Frame times:** these are software rendering, not evidence for any device.

## Checks

- The typecheck and the offline build pass.
- Unit and multiplayer tests: 437 of 437. That includes the new `tests/kit-shading.test.ts` (baked
  undersides darker, nothing above 1, dressing wood untinted) and the La Fiesta checks: pools flat
  on the ground, no light objects, fog untouched.
- The killcam browser test passes 29 of 29 on this build (desktop, touch, Spanish, pause and
  resume). The replay reads clearly.
- Moving footage was checked frame by frame in the clip for shimmer, and none was visible. That
  is a short check, not a long soak.

## Run it on the Mac (real GPU)

```
npm ci
GRAPHICS_EXPERIMENT=1 npm run build
SET=lighting PHONE=1 npm run capture:maps -- --gpu
```

This writes the same matched views, with costs and the GPU that rendered them, to
`artifacts/map-capture/`. It has not been run on a Mac yet, so no GPU or real-device result is
claimed.

## Limits

- Plaster variation is faint at a distance on purpose.
- The low-poly statue can light a whole face of bronze at once when the angle lines up.
- La Fiesta's light pools also lighten paving inside cast shadows. That is intended, since they
  are fixture light.
- The tarima footlights are not in either matched view; they were checked by tests only.
