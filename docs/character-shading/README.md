# Character shading, La Pesada's thumb, hand quality levels

Offline preview only. Arena matches only (Practice and Online, Classic and ¡Puro Chanclazo!).
Campaign and Arcade keep their presentation. Gameplay, environment lighting, maps, bots,
protocol and scoring are unchanged.

## 1. Why faces disappeared (diagnosis)

| Suspect | Finding |
|---|---|
| Base colours | Not the cause. Skin `0xc68a5e` is unchanged, as required. |
| Toon thresholds | **Main cause.** Rosa used the world's shared 3-step ramp, which arena maps deepen to 64/118/255. Skin in the middle band falls to about a quarter to half of sunlit, so dark iris, brows and lips lose contrast. The hard step edges also cross the cheeks and arms as a sharp, faceted line. |
| Cast shadows | **Second cause.** On High and Medium every part receives shadow, so Sol's hat brim puts her face in full shadow: hemisphere fill only, no sun. |
| Normals and faceting | Normals are smooth; the faceted look comes from the hard ramp steps, not the mesh. |
| Outlines, baked shading | Not material causes. |

More geometry would not have fixed any of this.

## 2. The shading change (kept)

`src/fps/render/rosa-materials.ts`, `ARENA_SKIN = { soft: 0.09, wrap: 0.1, shadowLift: 0.25 }`,
on the arena material only (its own shader program; the campaign material is pinned by a shader
hash test).

- **Skin only, softer bands.** The same three band values, read from the world ramp, blended
  across each band edge instead of stepping. A small wrap moves the terminator slightly past the
  side of the face. Clothing, hair, glasses, eyes, brows and lips keep the hard bands.
- **Shadow lifted a quarter of the way toward lit, on the head only** (skin, hair, eyes, brows,
  glasses, lips, picked by exact palette colour, tested to occur only on the head). A hat brim
  darkens the face without erasing it, and in a shaded alley the head darkens as one piece.
  Clothing keeps the full shadow.
- **Excluded:** new textures, lights, passes, emissive terms and skin colour changes.

### The decision gate

- **First candidate (lift 0.5 on skin only):** clearly better in dusk and sun. In shade it read as
  a lit face in a dark alley, because the lift also brightened world-cast shade.
- **Refined (lift 0.25, shared by the whole head):** this fixed the inconsistency at the cost of
  part of the gain. That is the version integrated.

### Result, honestly

| Light | Result |
|---|---|
| Sun | A modest improvement. The face under the brim is less muddy, and there is no hard band across the cheeks and arms. |
| Shaded alley | Features readable and the head consistent. The lit-side forearms stay slightly warmer than the dress. |
| Fiesta dusk | The clearest gain. Sol's face goes from near-black to readable eyes, nose and lips. |
| 10 m | Team readability unchanged. |
| Low | No visible change, since Low has no shadows. Only the band softening applies there. |

This improves readability without flattening, but it is a small step. The rest of the limitation
is the palette and the lighting: dark warm skin under cool fill, which this milestone was not
allowed to change.

## 3. La Pesada's thumb

The thumb now rises from the base of the palm, arches over the heel and presses across it toward
the fingers, a C-clamp instead of a pointing digit. La Chancla's grip is byte-identical (hash
test).

- **Unchanged:** weapon geometry, grip transforms, the rest pose and every animation frame
  (tested within 1e-9).
- **Skin inside either weapon:** 0 vertices on every tier.
- **Weak spot:** seen from the right side of the hand it still reads slightly like a raised digit.

## 4. Hand quality levels

| Tier | La Chancla | La Pesada | Draw calls |
|---|---|---|---|
| Before (one tier) | 10,612 tris | 9,952 tris | 9 / 8 |
| High | 10,612 | 9,952 | 9 / 8 |
| Medium | 6,724 | 6,064 | 9 / 8 |
| Low | 4,392 | 3,732 | 9 / 8 |

These counts include the weapon in hand (2,368 and 1,708 tris).

- **Tier differences:** every tier sweeps the same paths. Medium and Low only use fewer rings,
  and Low drops the knuckle bumps.
- **Animation:** identical across tiers.
- **Changing quality mid-match:**
  - `engine.applySettings` calls `vm.setQuality`, which builds the new tier, copies the pose and
    disposes the old rig's geometry and materials.
  - Weapon in hand, switch state, attack timelines and team colour live on the view model and
    carry over.
  - The campaign hand is not affected.

## 5. A leak fixed on the way

Before this milestone, every quality change back to High kept the previous sun's shadow map: two
textures, about 16 MB of GPU memory per trip. `disposeTree` now disposes each light's shadow. A
new check, `scripts/quality-switch-e2e.ts`, switches quality seven times mid-match through the real
settings buttons. Results:

- The match, health, score and La Pesada in hand carry on.
- A swing lands right after a switch.
- Geometry and texture counts stay flat.
- 27/27 on the final build. The baseline leaked: textures went 42, 44, 46.

## Cost (exact renderer counts, Linux Chromium with SwiftShader)

| | Before | After |
|---|---|---|
| Rosa per avatar, High | 18 draws, 12,920 / 12,668 tris | the same |
| Rosa per avatar, Low | 16 draws, 4,388 / 4,706 tris | the same |
| Shader programs | 38 (High) | 38 (the arena variant replaces the arena program) |
| Textures | 22 | 22 (no new textures) |
| Phone Low frame, El Patio grip | 65,724 / 65,064 tris, 78 / 77 calls | 59,504 / 58,844 tris, same calls |
| Phone Low frame, both teams in view | 69,650 tris | 63,430 tris (-6.2k) |
| Phone Low frame, La Fiesta | 52,878 tris | 46,658 tris (-6.2k) |
| Desktop High frame | 131-136 calls, 135-148k tris | same calls on matched runs, +12 to +77 tris (the thumb) |
| Download | | +1.3 KB gzipped JavaScript |

- **Desktop High draw calls:** the frame-averaged count varies by 3 between runs of the same build
  (133 or 136), so single runs are not comparable to that precision.
- **Shader cost:** three extra ramp lookups and a smoothstep per light per fragment, on Rosa's
  material only.
- **Frame times:** nothing here measures frame time on a real device.

## Checks

- Typecheck and build pass.
- **Unit and multiplayer:** 558/558 in 55 files. New tests:
  - `tests/rosa-shading.test.ts`: campaign material pinned, arena injections applied, head-only
    colours.
  - `tests/fp-hand-quality.test.ts`: tier counts, identical poses, mid-swing `setQuality`,
    disposal, no skin inside weapons, La Chancla unchanged.
- **Browser, final build:**
  - `scripts/puro-e2e.ts`: 20/20 (Classic and ¡Puro Chanclazo!, switches, pause, touch).
  - `scripts/killcam-e2e.ts`: 29/29.
  - `scripts/quality-switch-e2e.ts`: 27/27.
- **Campaign:** the matched mission shot is pixel-identical outside the original hand, which
  differs only in bob timing.

## Tools

- **`scripts/rosa-shots.ts`:**
  - `LIGHTS=sun,shade,dusk` films the pair in El Patio sun, in the marigold house's cast shadow, and
    on La Fiesta's dance floor.
  - Poses and the world clock are pinned, so before and after match.
- **`scripts/rosa-motion.ts`:** a `sunshade` scene, Rosa walking out of the house's shadow into the
  sun and back.
- **`scripts/quality-switch-e2e.ts`:** with `OUT`, it also saves a labelled still after each change.
