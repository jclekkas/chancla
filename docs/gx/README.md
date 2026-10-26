# GX checkpoint: visible gameplay graphics (El Patio route, then all arena maps)

- **Checkpoint commit:** `1198b5e` on `codex/close-combat`, tagged `gx-checkpoint`.
- **Visual evidence:** built from `922b3e0`. The later commit adds only shader and texture warm-up
  at map load.
- **Baseline:** a build of `f35a371`, whose renderer is identical to `36fb792`.
- **Scope:** offline preview only. Gameplay, collision, timing and protocol are unchanged.

## What changed

- **Architecture and materials (El Patio kit, shared by every arena map):**
  - weathered plaster with broad tonal patches;
  - flagstone streets and pavement slabs of uneven length;
  - stone aprons along the wall feet;
  - windows fitted to each opening;
  - a beamed ceiling in the Casa Sol passage;
  - deeper eaves with a dark soffit, and darker door and window reveals;
  - a few worn plaster patches.
- **Lighting and grounding:**
  - **The field:** a baked occlusion and grounding field (`src/fps/render/ao-field.ts`), built at
    map load from the layout boxes. It darkens the sky fill near walls, corners, props and under
    covered passages, and warms the fill as it darkens.
  - **World toon bands:** `[46, 112, 255]`.
  - **Low:** additionally gets a baked sun shadow, since it has no shadow map.
  - **Characters:** not patched; the accepted character shading is unchanged.
- **Gate A correction** (in-game review): the first combined pass rippled on shaded plaster and
  turned shade grey. The plaster contrast was halved and the shade boost removed, the occluded
  fill now warms as it darkens, and the trim strips on house corners were removed.
- **Motion and combat:**
  - The run cadence is matched to speed, with weight on the stance leg and a flight phase.
  - Thrown-chancla recoils follow the throw direction, and a blow from behind snaps forward.
  - Someone else's throw that hits a player is drawn as a hit.
  - Attack keys, timing, damage and hitboxes are unchanged.
- **Engine:** the world's shaders are compiled and its textures uploaded while the map loads.

## Gates (lead review of in-game captures)

- **Gate A (El Patio route), passed:**
  - **Phone Low, clear improvement:** it goes from no shade at all to real building shade.
  - **Desktop High, moderate improvement:** deeper, warmer shade, flagstone streets, grounded wall
    feet, and a darker, more enclosed passage. The sunlit plaza looks much as before.
- **Plaza and Fiesta:** the shared changes fit both. Fiesta is not darker; Plaza gains grounding
  and real shade on Low.
- **Gate B (combat), passed, modest:**
  - The sequence covers sun to shade, a teammate crossing, a throw hit, a Chanclazo hit, a Revés
    miss, a Revés kill, my own elimination and the replay. All of it happens identically on both
    builds (same event summary).
  - First-person presentation is essentially unchanged. The gains show on other characters.

## Cost (exact counts; Linux Chromium with SwiftShader, no GPU)

| | Baseline | GX |
|---|---|---|
| Route stations, desktop High: draw calls | 125-159 | identical |
| Route stations, desktop High: triangles | 136-150k | +7.6k |
| Route stations, phone Low: draw calls | 79-112 | identical |
| Route stations, phone Low: triangles | 60-65k | +4.3k |
| Shader programs | 33 (High) / 27 (Low) | 36 / 31 |
| Occlusion field textures | none | High 621 KB, Medium 265 KB, Low 146 KB |
| Street texture | none | +1.4 MB High, +0.35 MB Low |
| Download (gzipped JS) | 463.8 KB | 471.5 KB (+7.7 KB) |

**Frame timing on the software renderer:** these are not device measurements.
- **Median frame interval, El Patio practice at Medium:** 467 ms on the baseline against 683 to
  783 ms (Fiesta: 400 to 517 ms). Draw calls are equal, so this is per-pixel work: the field's
  texture reads plus the plaster and street patches.
- **Stalls:** two render calls of about 2 s per 20 s that the shader and texture warm-up did not
  remove. One is a material outside the world compiling; the other is the renderer waiting for
  queued pixel work.
- **What it means:** GPU cost needs a real-device check (see the checklist below).
- **`perf-maps.ts`:** fps is unchanged (about 11), but its smoothed JS frame time is 1.5 to 2.3
  times the baseline.
- **Load time:** El Patio loads about 1.5 s slower on this machine (the field bake is about 90 ms;
  the rest is compiling).

## Checks

| Check | Result |
|---|---|
| Unit and multiplayer | 576/576 |
| Typecheck and build | pass |
| Quality switching (`quality-switch-e2e.ts`) | 27/27 |
| Classic and ¡Puro Chanclazo! (`puro-e2e.ts`) | 20/20 |
| Killcam (`killcam-e2e.ts`), final batch | 28/29 |
| Killcam, desktop reruns | 25/25 and 24/25 |
| Killcam, baseline rerun | 25/25 |

- **The two killcam failures are timing flakes, not regressions:**
  - "Chancla in flight in the replay" sampled 11 frames; it passed on rerun.
  - "Rollers fly in the replay": the server sent no rollers in that kill. Roller detachment is
    decided server-side in shared code that was not changed.
- **Campaign:** the matched mission shot is identical apart from the first-person hand's bob.
- **Arcade:** it builds its arenas with the same world kit (as since the maps milestone), so it
  shows the same environment changes. Gameplay is untouched. Keeping Arcade on the old look would
  need a flag in `buildWorld`; this is a decision for review.

## Limits

- **Desktop High:** the gain is moderate, not dramatic. The sunlit plaza is close to the baseline.
- **Low characters in shade:** they are not darkened by Low's baked sun shadow, so they look
  slightly sunlit against shaded paving.
- **HUD:** the "You got …" banner covers the victim's fall. Out of scope.
- **Unverified on devices:** per-pixel cost on a real Mac or phone GPU.

## Mac High and phone Low checklist

1. **El Patio, Practice:** walk out of the Casa Sol passage into the plaza and up the alley. Check
   the shade depth, the flagstones, and walls grounded at their feet. Check there is no stutter
   the first time you look around.
2. **On a phone at Low:** the same route. Check the alley and plaza now have building shade, and
   characters stay easy to read.
3. **Fiesta at dusk:** check it is not darker than before, and faces are readable.
4. **Run behind a bot:** check the longer stride and the visible flight phase. Throw at a bot from
   the side: it recoils away from the throw.
