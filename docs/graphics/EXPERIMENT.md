# Courtyard graphics experiment

Production is out of scope. Do not merge this branch to main, promote a deployment, change production domains or environment variables, or modify the Render service without new, explicit approval from the owner.

## Milestone 1: one upgraded courtyard section, in the real game

**What changed.** The café block on El Patio ("Café Chancla") and everything that sits in front of it (the stone stairs up to its roof, the tiled bench, the planter, a new paved strip) are now drawn by a reusable kit, `src/fps/render/section.ts`. The map is point-symmetric, so the mirrored block ("Panadería Rosa", marigold walls) on the other team's side gets the same treatment automatically. The rest of the arena is drawn exactly as in production.

| Part | Production (d27f74d) | This milestone |
| --- | --- | --- |
| Facade | Flat painted box, stucco texture | Plaster wall with a terracotta base band and trim cap, corner pilasters, three-step cornice with eave board |
| Windows | Dark rectangle, flat shutters | Glass set back behind 0.16 m jambs, lintel with keystone, stone sill on corbels, louvered shutters folded back, iron bars on the ground floor |
| Upper floor | Simple balcony and window box | Balcony slab on corbels with railing and flower pots; window boxes elsewhere |
| Door | Flat wood rectangle | Stone casing and head, two raised-panel leaves with brass handles, a flush threshold, two wall lanterns |
| Roof edge | Row of flat tiles | Barrel tiles every 0.24 m over a stepped cornice, two rain spouts |
| Ground | Arena tiles up to the wall | Paved strip with a stone kerb and a soft contact shadow along the wall |
| Props | Plain stone stairs, bench and planter | Stairs with stone treads and tiled risers; bench with tiled sides and stone cap; planter with a tiled band, stone rim, soil and rounder foliage |

**Rules the kit follows.**
- Collision is untouched: `shared/` is not modified. Every visual piece sits inside a collision box's footprint, flush on its surface, or on a wall above head height (lanterns, sills, balconies, cornice). The door is drawn closed, so nothing looks passable that is not.
- Planter foliage uses production's spacing and is no larger than production's bushes, so it never hides more of the line of sight than production does.
- Batched: the whole section (both mirrored blocks) is 10 merged meshes, one per material kind, using vertex colours for tints.
- All original and procedural: canvas-drawn textures (plaster, cantera stone, talavera tiles, louvers, glass, pavers, a shadow fade) and three.js primitives. No downloaded, purchased or generated assets.
- Rosa, the other characters, combat, audio and input code are unchanged.

**What was set aside.** Commit 6706f4f changed materials and contact shadows across the whole arena. That made the comparison unfair (everything changed, so nothing could be judged) and touched every map. `materials.ts` and `world.ts` are back to production, apart from a three-line hook in `world.ts` that hands the section's boxes to the kit.

## Milestone 2: refinement and rendering cost

Scope: still only the café and the mirrored Panadería. Rosa, other characters and the rest of the arena are unchanged, so the rest of the map stays a valid control.

### What was wrong at player height, and what changed

| Problem in milestone 1 (seen in the committed screenshots) | Change |
| --- | --- |
| Plaster and stone trim carried a fine streaky hatch that read as noise and shimmered at a distance | Plaster is broad, faint clouding only; the cantera stone is a soft, low-contrast speckle. Both tile without seams |
| A sawtooth shadow on every window lintel: the thin cap above it cast a shadow smaller than one shadow-map texel | Small trim (lintel caps, keystones, corbels, the door's top cap) no longer casts shadows |
| The planter's tile band showed as large blue polka dots: world-aligned UVs cut the 0.3 m tiles at random | Tiles are now laid as whole tiles per panel (UVs fitted to the panel): one course on each side of the planter, one per stair riser, a two-row panel on the bench front |
| The planter top was a flat red slab with a flickering light wedge in one corner (the pot's top face and the rim fought for the same depth; the soil was hidden under the pot) | The top is open: soil 6 cm down inside a four-piece stone rim that does not overlap anywhere |
| The bench was tiled on all four sides, high-contrast blue and white in the players' path | Plaster body, one tile panel on the plaza side, stone cap and plinth. Tile colours are a softer cobalt and ochre on cream |
| **Mirroring bug:** on the Panadería the tiled risers and stone nosings were on the hidden back faces of the steps, so its stairs had plain risers | The dressed face is chosen from which side faces the plaza, so both stairs, benches and planters are correct |
| Planter foliage sat on the rim | Lowered 4 cm into the soil (less of the sightline covered, never more than production) |

Found and not changed: north-facing walls show fine diagonal stripes (shadow acne). Production has exactly the same stripes on the same walls (compare `lab-panaderia-before-high.jpg`); it comes from the arena-wide shadow bias, so fixing it would change the whole map and is out of this section's scope.

### Where the milestone 1 cost came from

Milestone 1 added **+18 draw calls and about +18.5k rendered triangles** per frame:
- **Draw calls:** 10 section meshes in the main pass, and 8 of them cast shadows, so they were drawn again in the sun's shadow pass (10 + 8 = 18). Glass, louvers, tiles, door wood and lanterns all cast shadows they did not need: they are flush with a wall or too small to show.
- **Triangles:** the section had 11,228; 11,216 of them were also drawn in the shadow pass.

Of those 11,228, the details were:

| Detail | Triangles |
| --- | --- |
| Barrel roof tiles (half-cylinders with end caps, 8 sides) | 3,360 |
| Foliage and flowers (rounded icosahedra) | 2,560 |
| Trim boxes | 1,576 |
| Iron bars, rails and lantern cages | 1,392 |
| Pots | 720 |

Boxes against a wall or the ground also carried faces that can never be seen.

### What was done about it
- **Selective shadow casting.** Only the plaster, stone and larger tinted pieces (eave, planter foliage) cast shadows: 3 shadow draws instead of 8. A new non-casting "detail" kind holds iron, brass, roof tiles, flowers and small trim, so it adds no draw calls.
- **The contact shade at the wall foot is baked into the paving's vertex colours.** That removes the separate transparent strip, and its texture, and the draw call.
- **Lighter geometry where it doesn't show:**
  - roof tiles have 6 sides on High and 4 on Medium and Low
  - flowers and wall greenery use the faceted shape (planter foliage stays round on High and Medium)
  - pots have 10 sides on High and Medium, 8 on Low
  - wall-facing and ground-facing box faces are dropped
- **Low quality** has no shadows, so it also drops the window bars and the lantern cages, and halves the balcony railing bars.
- **Ruled out:** a shadow-only proxy mesh. three.js still draws an invisible material in the main pass and tests the main camera's layers in the shadow pass, so it would have cost a draw call to save one. A texture atlas to merge the textured kinds was also judged not worth its risk at this size.

Medium and Low change only what is drawn. Collision comes from `shared/` and is identical at every quality, and nothing that can hide a player is added at any quality.

### Measured cost

Exact counts from the renderer (they carry over to real hardware). Static views, comparison lab, 1280 × 720:

| Quality | Production | Milestone 1 | Milestone 2 |
| --- | --- | --- | --- |
| High, player height | 88 calls, 38,376 tris | 106 (+18), 56,908 (+18,532) | **101 (+13), 45,464 (+7,088)** |
| Medium, player height | 88, 38,376 | n/a | **101 (+13), 44,648 (+6,272)** |
| Low, player height | 53, 33,184 | n/a | **63 (+10), 36,224 (+3,040)** |

In the game (offline practice, whole frame, High, the four fixed spots), raw data in `evidence/practice-before.json`, `practice-after.json` and `practice-m2.json`:
- **Draw calls:** production 157-210, milestone 1 +18, milestone 2 **+13**.
- **Triangles:** production 47-56k, milestone 1 +18.5k, milestone 2 **+7.1k**.
- **Textures:** production 14, milestone 1 21 (+7), milestone 2 20 (+6).

Section size, both blocks:

| Quality | Visible triangles | Shadow-caster triangles |
| --- | --- | --- |
| High | 8,348 | 2,652 (was 11,216) |
| Medium | 7,532 | 2,652 |
| Low | 6,356 | none (no shadow pass on Low) |

### The benchmark (offline practice, normal game renderer)

Open the preview with `?bench`, or with `?bench&section=off` for the identical run without the section, which is production's drawing.
- **One variant per page load.** The other variant is not built, and there is no screenshot-buffer overhead.
- **The run:**
  - El Patio practice with 1 ally and 2 enemy bots on normal difficulty.
  - Rosa is held at four spots around the café and the Panadería, a quarter of the run each, panning slowly and throwing every 1.5 s.
  - Bots throw back, so projectiles are in flight.
  - Rosa is topped up to full health every frame, so the view stays on the section.
- **Timing:** 10 s warm-up, not counted, then 60 s measured.
- **Recorded:**
  - average FPS, median, p95 and p99 frame time, frames over 50 ms
  - canvas and drawing-buffer size, pixel ratio, device pixel ratio, quality
  - average and maximum draw calls and triangles per whole frame, including the shadow pass and the held item
  - the workload: bots, throws, projectiles in flight, and how often Rosa was eliminated
  - the GPU name the browser reports, and the user agent
- **Invalidated** when the tab is hidden, the window or zoom changes, quality changes, a menu opens, or the match ends.
- **Results stay on the device:** Copy results, or Save JSON, which downloads a local file. Nothing is sent anywhere.
- **Your settings are untouched:** the run's settings apply to that page load only and are put back when you leave.
- **Options:** `&quality=high|medium|low`, `&secs=`, `&warmup=`. Runs under 60 s are labelled indicative.
- **Where it exists:** only offline graphics previews include it. It is not in a normal build (checked by searching the built files).

(The milestone 2 evidence files say `build: 621dad5 (local)` because they were built from the uncommitted working tree that was then committed unchanged as 4dbfc68.)

Local runs (`scripts/graphics-bench-e2e.ts`): headless Chromium 141 on SwiftShader, a **software renderer on a shared cloud CPU, not a GPU**, run in A/B/B/A order. The phone rows are Chromium emulating an iPhone screen, not a phone. Raw data: `bench/bench-60s.json`.

| Run (60 s each, 3 bots) | Experiment | Production drawing |
| --- | --- | --- |
| Desktop 1280 × 720, High (A B B A) | 2.7 / 2.8 FPS, p95 417 / 400 ms | 3.1 / 3.0 FPS, p95 383 / 383 ms |
| Desktop 1280 × 720, Low | 4.9 FPS, p95 250 ms | 5.1 FPS, p95 267 ms |
| Emulated phone 844 × 390, Low | 9.1 FPS, p95 133 ms | 9.4 FPS, p95 133 ms |
| Draw calls per frame, High (average) | 357 / 374 | 322 / 334 |

**How to read this:**
- **Frame rates:** on this software renderer the section costs about 3-10% of frame rate. That says nothing about a GPU, where a few hundred extra draw calls and a few thousand triangles are normally small.
- **Draw calls:** the benchmark's averages are dominated by the bots (about 30 meshes each, drawn twice when shadows are on), so they vary by 12-17 calls between runs of the same variant.
- **An open question:** at High both experiment runs averaged about 35 calls and 10k triangles more than production, more than the exact static difference of 13 calls and 7.1k triangles. Bot positions may explain it, but two runs each cannot tell. It is worth checking with a few more runs on real hardware.
- **Eliminations:** on a renderer this slow, Rosa can still be eliminated once in a run, because the host simulates between the benchmark's health top-ups. The count is in the results.
- **The 60 FPS (M4 Mac) and 30 FPS (phone) targets are not measured.**

### Mac and phone checklist (about 10 minutes)
1. **M4 Mac, Chrome or Safari, window not resized during runs.** Open `<preview>/?bench`. Don't touch anything for 70 s, then press Save JSON.
2. Open `<preview>/?bench&section=off`, wait for the result, then Save JSON.
3. Repeat steps 1 and 2 once more, in the order B then A.
4. Optionally, repeat with `&quality=medium`.
5. **Phone, landscape, screen on, nothing else open.** Open `<preview>/?bench&quality=low`, then `?bench&quality=low&section=off`, saving each with Save JSON or Copy results.
6. Send the files. If a panel says "Not valid", run that one again.
7. **Look-check on both devices:**
   - Practice → El Patio. Walk along the café and the Panadería at player height.
   - Watch for flicker on the planter rim and stairs, stripes or shimmer on walls and trim, floating pieces, and anything that looks passable but isn't.
   - Check that an enemy in front of the café is easy to see.

## The preview is offline-only

Any build of a `codex/graphics*` branch on Vercel (or any build with `GRAPHICS_EXPERIMENT=1`) is offline-only:
- Online play is switched off in code (`__OFFLINE_ONLY__`). The production server address is not in the bundle at all (verified by searching the built files), even if the deployment inherits `VITE_GAME_SERVER_URL`.
- Every page carries a `connect-src 'self'` Content Security Policy, so the browser refuses any connection to another host. The lab page keeps `connect-src 'none'`.
- The title screen says so: "Graphics preview: online play is switched off here. Practice works offline." (Spanish included).

Practice, the campaign and the Arcade run as normal.

## How to look at it

- **In the game:** open the preview, choose Practice, pick El Patio. The café is on the plaza's north side; the Panadería is opposite.
- **Side by side:** open `/courtyard.html`. Before is production's renderer (`world.baseline.ts` and `materials.baseline.ts`, verified identical to d27f74d except for import paths); Experiment is this branch. Both use the game's renderer settings for the chosen quality (antialiasing, pixel ratio cap, shadows, fog, FOV 85, eye height 1.58 m). Views: Player height, Facade close-up, Wider courtyard, Mirror side, Overview.

## Evidence

Milestone 2's images are the `m2-*` files in `evidence/`, taken from the same spots and lab presets as milestone 1's.

| | Milestone 1 | Milestone 2 |
| --- | --- | --- |
| Player height | ![](evidence/game-player-after.jpg) | ![](evidence/m2-game-player.jpg) |
| Facade close-up | ![](evidence/game-facade-after.jpg) | ![](evidence/m2-game-facade.jpg) |
| Mirror side | ![](evidence/game-panaderia-after.jpg) | ![](evidence/m2-game-panaderia.jpg) |
| Enemy at the door | ![](evidence/game-readability-after.jpg) | ![](evidence/m2-game-readability.jpg) |
| Lab, facade, High | ![](evidence/lab-facade-after-high.jpg) | ![](evidence/m2-lab-facade-high.jpg) |
| Lab, player height, Low | ![](evidence/lab-player-after-low.jpg) | ![](evidence/m2-lab-player-low.jpg) |

The milestone 1 evidence below is kept as it was.

All screenshots are unedited canvas or page captures from headless Chromium 141 on Linux using SwiftShader, a software renderer (no GPU). Images were converted to JPEG (quality 90) to keep the repository small; nothing else was done to them.

### In-game, offline practice, same spot and view direction (1280 × 720, High)

| | Production (d27f74d) | This branch |
| --- | --- | --- |
| Player height | ![](evidence/game-player-before.jpg) | ![](evidence/game-player-after.jpg) |
| Facade close-up | ![](evidence/game-facade-before.jpg) | ![](evidence/game-facade-after.jpg) |
| Wider courtyard | ![](evidence/game-wide-before.jpg) | ![](evidence/game-wide-after.jpg) |
| Mirror side | ![](evidence/game-panaderia-before.jpg) | ![](evidence/game-panaderia-after.jpg) |
| Enemy in front of the door (readability) | ![](evidence/game-readability-before.jpg) | ![](evidence/game-readability-after.jpg) |

### Comparison lab (no HUD, animations frozen)

| | Before | Experiment |
| --- | --- | --- |
| Player height, High | ![](evidence/lab-player-before-high.jpg) | ![](evidence/lab-player-after-high.jpg) |
| Facade, High | ![](evidence/lab-facade-before-high.jpg) | ![](evidence/lab-facade-after-high.jpg) |
| Wider, High | ![](evidence/lab-wide-before-high.jpg) | ![](evidence/lab-wide-after-high.jpg) |
| Player height, Low | ![](evidence/lab-player-before-low.jpg) | ![](evidence/lab-player-after-low.jpg) |

### Measurements

Machine: Linux cloud container, headless Chromium 141, ANGLE on SwiftShader (software rendering, no GPU), 1280 × 720 canvas, pixel ratio 1, quality High. Raw data: `evidence/practice-before.json`, `evidence/practice-after.json`, `evidence/measure-high.json`.

**In the game (offline practice), whole frame including the held item:**

| Spot | Draw calls | Triangles | Avg FPS (software) |
| --- | --- | --- | --- |
| Player height | 162 → 180 (+18) | 47,388 → 65,920 (+18,532) | 11.0 → 11.5 |
| Facade close-up | 157 → 175 (+18) | 46,964 → 65,496 (+18,532) | 11.7 → 11.7 |
| Wider courtyard | 175 → 193 (+18) | 48,642 → 67,174 (+18,532) | 11.0 → 11.5 |
| Mirror side | 210 → 228 (+18) | 55,846 → 74,378 (+18,532) | 12.5 → 11.3 |

GPU resources in the match: geometries 111-112 → 121-122 (+10), textures 14 → 21 (+7).

**In the lab, the Measure button (1 s warm-up, 10 s), each variant measured twice, alternating:**

| View | Variant | Draw calls | Triangles | Avg FPS | p95 frame time |
| --- | --- | --- | --- | --- | --- |
| Player height | Before | 88 | 38,376 | 2.6 / 3.6 | 700 / 800 ms |
| Player height | Experiment | 106 | 56,908 | 3.2 / 3.2 | 367 / 500 ms |
| Wider | Before | 101 | 39,630 | 4.0 / 4.0 | 500 / 433 ms |
| Wider | Experiment | 119 | 58,162 | 3.8 / 3.8 | 517 / 450 ms |

The lab runs slower than the game here because `preserveDrawingBuffer` is on and both variants stay loaded. At 3-4 FPS the p95 is a handful of frames, so it is noise, not a comparison.

**How to read these.**
- Draw calls, triangles, geometries and textures are exact, and they carry over to real hardware. Draw calls include the shadow pass.
- Frame rates are from a software renderer on a shared cloud CPU. They show the two builds run at about the same speed on this machine, and nothing about a Mac or a phone. The **60 FPS on an M4 Mac and 30 FPS on a phone** targets are targets, not results: they are unmeasured.
- In-game timing is the game's own frame counter over 3 s at each spot, after a 4 s settle, with bots moved out of view.
- Lab timing is the lab's Measure button: 1 s warm-up then 10 s, cancelled if the tab is hidden or the view changes. The lab keeps both variants in memory and uses `preserveDrawingBuffer` for screenshot export, so its memory and timing are not gameplay figures.

**Added size.**
- Download: +12.9 KB of JavaScript (+4.0 KB gzipped) for the game pages. Lab page not counted.
- Textures: seven small canvas textures, 241,920 pixels in all. That is about 1.3 MB of GPU memory with mipmaps, plus the same canvases (about 1 MB) kept in page memory.
- Geometry: 23,504 vertices and 11,228 triangles for both blocks, about 1.0 MB.

## Checks

Milestone 2, all on this branch, locally, with every request to another host blocked:

| Check | Build | Result |
| --- | --- | --- |
| `npm run typecheck` | | pass |
| `vitest` (29 files) | | 271/271 |
| `scripts/graphics-practice-e2e.ts` (collision at the facade and door, movement, jump, aim, throw, Esc and Resume, phone touch controls, no external requests) | offline | 20/20 |
| `scripts/graphics-bench-e2e.ts` (new): invalidation on hidden tab, resize and menu; Save JSON, Copy results, links; saved settings put back; eight 60 s runs with bots and projectiles; no external requests; no page errors | offline | 18/18 |
| `e2e:desktop` / `e2e:menu` / `e2e:zoom` | offline | 23/23, 28/28, 39/39 |
| `e2e:play` (practice, campaign, Arcade, online against a local server) | normal | 69/69 |

Milestone 1:

| Check | Build | Result |
| --- | --- | --- |
| `npm run typecheck` | | pass |
| `vitest` (29 files) | | 271/271 |
| `scripts/graphics-practice-e2e.ts` (new): online-off notice, El Patio practice, walking into the facade and the door stops at the wall, strafing along the paving stays on the ground, jump and land, mouse aim, throw, Esc menu with nothing held, Resume, music state, phone (emulated iPhone) stick, look, Throw, Jump, Menu and Resume, no request leaving the machine, no page errors | offline | 20/20 |
| `e2e:desktop` (Mac-controls regression) | offline | 23/23 |
| `e2e:menu` | offline | 28/28 |
| `e2e:zoom` | offline | 39/39 |
| `e2e:play` (practice, campaign, Arcade, online against a local server) | normal (it needs online play) | 69/69 |

Every browser test ran locally. No test used the production server.

`scripts/graphics-practice-e2e.ts` serves the build locally and blocks every request to any other host. It fails if anything tries to leave the machine. To run it:
- the checks: `GRAPHICS_EXPERIMENT=1 npm run build && node --import tsx scripts/graphics-practice-e2e.ts`
- production's matching screenshots: `SHOTS_ONLY=1 LABEL=before DIST=<production dist>`

## Not verified

- **Real hardware:** no Mac, phone or GPU was used. Every frame rate here is software rendering. The benchmark exists so you can measure on real devices (see the checklist above).
- **The hosted preview in a browser:** this environment's network policy blocks vercel.app (proxy 403), so the deployed page could not be opened from here. Deployment readiness comes from GitHub's commit status. The offline notice, El Patio practice, the absence of server connections and the benchmark and comparison controls were verified on the identical local offline build.
- **Safari and WebKit:** not run. WebKit could not be downloaded here.
- **Phone controls:** touch was tested in emulation (Chromium with touch events at iPhone size), not on a phone.
- **Online play:** not tested with the section, because the preview has no online play by design. The section is rendering only; the server and shared simulation are untouched.
- **The benchmark's draw-call gap at High** (about +35 per frame against a static +13) is not yet explained (see above).

## Next step

Measure on the M4 Mac and a phone with the checklist. If the section holds its targets there, and the look is approved, the kit is ready to extend to other blocks. Until then, keep it to this section. Any production release needs separate approval.
