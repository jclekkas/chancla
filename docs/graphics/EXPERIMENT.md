# Courtyard graphics experiment

Production is out of scope. Do not merge this branch to main, promote a deployment, change production domains or environment variables, or modify the Render service without new, explicit approval from the owner.

## Milestone 3: El Patio, integrated

The café kit now draws the whole El Patio arena. Materials, paving and light are reworked for El Patio, and the first-person hand and chancla are new. Three parallel workstreams did the work, each owning separate files, and the lead integrated and verified it:

| Workstream | Files |
| --- | --- |
| Environment geometry | `section.ts`, `patio-shapes.ts` |
| Materials, paving, light | `patio-materials.ts` |
| First person | `viewmodel.ts`, `fp-hand.ts`, `fp-chancla.ts`, `fp-geo.ts` |
| Lead: integration | `world.ts`, the lab, the tests |

Other maps, the Arcade, campaign layouts and the shared character models are unchanged.

### What changed

**Environment (whole arena):**
- **Houses:** every house, row house and spawn compound gets the café's units on its visible faces only:
  - windows with reveals, sills, lintels and louvered shutters
  - closed panelled doors with lanterns
  - balconies and window boxes
  - base band, pilasters, cornice and barrel-tile roof edge
  - a paved strip with a kerb
- **Hidden faces:** a hidden-face test leaves out faces covered by a neighbour, with clean corners and no overlapping coplanar faces.
- **Walls:** base band, string course and stone coping.
- **Spawn exits:** a timber beam and ceiling, with the cornice running across.
- **Terrace:** the dark painted arches (which read as openings) are now a blind arcade.
- **Stairs, parapets, crates and bins:** risers face the lower step on all four flights; parapets get a stone cap and one course of tiles; crates and bins stay inside their footprints.
- **Foliage:** double-sided leaf tufts replace the round blobs, with the same spacing and no larger than before.
- **Skyline:** the distant buildings get cornices and tile roofs.
- **Left as production:** the fountain, statue and kiosks.

**Materials and light (El Patio only):**
- **Paving:** a low-contrast terracotta with dark grout replaces the bright cream grid, with gentle per-tile variation and worn tiles. Production's ground zones (streets, team courts) are kept as tints, and the fountain's path rings as a flat mesh.
- **Surfaces:** calmer plaster, cantera, talavera and louvers; a vertical-grain door wood; a leaf material that stays green in shade.
- **Light:** a slightly warmer afternoon, with sun intensity 2.4 → 2.64 and hemisphere light 1.35 → 1.215.
- **Ground texture memory:** about 18.9 MB → 2.8 MB at High.

**First person (the shooter only; the shared hand and sandal models used by the Arcade are untouched):**
- **Chancla:** a flip-flop with a tapered two-layer sole, toe post, strap and flower.
- **Grip:** fingers and thumb wrap the sole edge, closing to a fist after release.
- **La Pesada:** held by the heel, in profile.
- **Materials:** separate toon materials for skin, sleeve, cuff and item, with thin outlines.
- **Motion:** a wind-up, wrist-flick release, follow-through and eased recovery.
- **Unchanged:** release at 90 / 160 ms, the hide and reappear rule, cooldowns and switch timing.
- **Bug fixed:** the team colour no longer tints the chancla sole.

**Fixed along the way:**
- **Campaign layouts:** campaign missions also build on El Patio's map, so since milestone 1 the café kit had been drawing into them. They are drawn exactly as in production again.
- **Benchmark view time:** a frame's time is now split between the views it overlaps, so slow frames no longer shorten the last view.

### Before and after (in game, offline practice, 1280 × 720, High, same spots)

The `m3-game-*` files hold the same spot from production, milestone 2 and this build.

| | Production | Milestone 2 | Milestone 3 |
| --- | --- | --- | --- |
| Player height | ![](evidence/m3-game-player-prod.jpg) | ![](evidence/m3-game-player-m2.jpg) | ![](evidence/m3-game-player-m3.jpg) |
| South alley | ![](evidence/m3-game-southrow-prod.jpg) | ![](evidence/m3-game-southrow-m2.jpg) | ![](evidence/m3-game-southrow-m3.jpg) |
| Casa Sol courtyard | ![](evidence/m3-game-solspawn-prod.jpg) | ![](evidence/m3-game-solspawn-m2.jpg) | ![](evidence/m3-game-solspawn-m3.jpg) |
| Terrace and stairs | ![](evidence/m3-game-terrace-prod.jpg) | ![](evidence/m3-game-terrace-m2.jpg) | ![](evidence/m3-game-terrace-m3.jpg) |
| Wider courtyard | ![](evidence/m3-game-wide-prod.jpg) | ![](evidence/m3-game-wide-m2.jpg) | ![](evidence/m3-game-wide-m3.jpg) |
| Enemy at the café door | ![](evidence/m3-game-readability-prod.jpg) | ![](evidence/m3-game-readability-m2.jpg) | ![](evidence/m3-game-readability-m3.jpg) |

The lab captures are `m3-lab-<view>-before-high.jpg` (production's renderer) and `m3-lab-<view>-after-<quality>.jpg` (this build), for nine views.

### Rendering cost (exact counts, comparison lab, production → this build)

| Quality | Draw calls | Triangles |
| --- | --- | --- |
| High | 82-107 → 53-80 (**27-29 fewer**) | 38.2-39.7k → 78.7-80.5k (**+40.8k**) |
| Medium | **27-29 fewer** | **+35.9k** |
| Low | 47-72 → 31-58 (**14-16 fewer**) | 33.2-34.4k → 47.3-48.5k (**+14.1k**) |

- **Why draw calls go down:** the kit draws all of El Patio as 11 merged meshes (one per material kind), 3 of which cast shadows, and they replace many separate production meshes.
- **Triangles:**
  - At High, the kit is about 55.5k triangles, about 15.8k of which also go through the shadow pass.
  - The first-person view adds about 3.9k triangles and is 14-18 draw calls cheaper than before.
- **No culling:** the whole kit is one set of meshes, so it is never culled. Splitting it into a 2×2 or 3×3 grid was measured: 34-42 more draw calls to save 3-12k triangles, so the kit stays unsplit.

### Benchmark (controlled comparison and live stress test, 60 s each)

Results: `bench/bench-m3-60s.json`. These ran on headless Chromium 141 with SwiftShader, a **software renderer on a shared CPU, not a GPU**. The phone row is emulated. The per-view seconds in this file predate the view-time fix; frame rates, percentiles and counts are unaffected.

| Run | This build | Production drawing |
| --- | --- | --- |
| Controlled, desktop High (A B B A) | 484 / 484 calls, 141.8k tris, 2.0 / 2.0 FPS, p95 603 / 608 ms | 510 / 511 calls, 101.0k tris, 2.6 / 2.6 FPS, p95 474 / 464 ms |
| Controlled, desktop Low | 269 calls, 83.1k tris, 5.6 FPS, p95 234 ms | 283 calls, 69.0k tris, 5.2 FPS, p95 235 ms |
| Controlled, emulated phone Low | 274 calls, 83.8k tris, 9.9 FPS, p95 130 ms | 288 calls, 69.7k tris, 8.6 FPS, p95 146 ms |
| Live stress, desktop High (real bots, varies by run) | 393 calls, 131.3k tris, 2.2 FPS | 388 calls, 85.3k tris, 2.9 FPS |

On this software renderer, High is about 23% slower than production and Low about 8-15% faster. A software renderer is limited by triangles and fill rate in a way a GPU is not, so these numbers **do not show Mac or phone performance**. Real-device results are still outstanding.

### Checks (this build)

| Check | Result |
| --- | --- |
| typecheck; offline build without the production server address; benchmark absent from the normal build | pass |
| vitest | 275/275 |
| `graphics-practice-e2e.ts`: collision at the café facade and door with the new geometry; movement, jump, aim and throw; Esc and Resume; phone stick, look, Throw, Jump and Menu; no external requests | 20/20 |
| `e2e:menu`, `e2e:desktop` (input with the new first-person view) | 28/28, 23/23 |
| `e2e:play` on a normal build (practice, campaign layouts after the routing fix, Arcade, online against a local server) | 69/69 |
| `graphics-bench-e2e.ts`: invalidation, export, settings restore, ten 60 s runs valid, live run with no eliminations | 24/25 |
| Frame-rate equivalence, after the view-time fix | 7/7 |

The one failure in the full benchmark run was the slowed test run's per-view seconds. The view-time fix resolved it, and the equivalence check was rerun.

### Simplified or deferred
- **Held vs thrown chancla:** the thrown projectile and the third-person characters still use the shared slide model, so you hold a flip-flop and a slide flies out.
- **Kiosks, fountain and statue** keep production's drawing.
- **Shadow acne:** north-facing walls still show the fine diagonal stripes, as production does. They come from the arena-wide shadow bias.
- **Notches:** a small one at the perimeter wall corners at 9 m.
- **Readability:** the enemy at the café door stands against a brown door instead of a flat wall. She is still clear in the shot, but slightly less contrasted.
- **Fixed poses:** the hand's grip poses are fixed (only a fist squeeze, no finger animation).

### Real-device checklist (about 15 minutes)
1. **M4 Mac, High, Chrome or Safari:**
   - `https://chancla-git-codex-graphics-polish-jclekkas.vercel.app/?bench` (save JSON), then `https://chancla-git-codex-graphics-polish-jclekkas.vercel.app/?bench&section=off` (save).
   - Repeat both in the reverse order.
   - Optionally, `https://chancla-git-codex-graphics-polish-jclekkas.vercel.app/?bench=live`.
2. **Phone, Low, landscape:** `https://chancla-git-codex-graphics-polish-jclekkas.vercel.app/?bench&quality=low`, then `https://chancla-git-codex-graphics-polish-jclekkas.vercel.app/?bench&quality=low&section=off`.
3. **Play** practice on El Patio on both devices. Look for:
   - flicker or shimmer on walls, roofs and stairs
   - pieces that float, or that look passable but aren't
   - whether enemies stand out everywhere, especially in the alleys and spawn courts
   - how the throw feels with both weapons
4. Send the JSON files and any screenshots.

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

### The benchmark (version 2, corrected)

Version 1 (commit d2456db) had problems:
- **Throws missed:** it fired only during a 150 ms window every 1.5 s, sampled through frame callbacks, so slow frames missed throws.
- **Unequal view time:** it gave views unequal time, because the view was chosen from the run's fraction including the warm-up.
- **Deaths in valid runs:** it let Rosa be eliminated in runs it still called valid.
- **Not a controlled comparison:** it compared variants on live bots, whose positions and throws differ every run, so the draw-call gap mixed the section with whatever happened to be on screen.

Its numbers are superseded below.

**Two separate modes, one variant per page load:**

| Link | What it is |
| --- | --- |
| `https://chancla-git-codex-graphics-polish-jclekkas.vercel.app/` | Normal offline practice (Practice, then El Patio) |
| `https://chancla-git-codex-graphics-polish-jclekkas.vercel.app/?bench` | **Controlled comparison**, section on |
| `https://chancla-git-codex-graphics-polish-jclekkas.vercel.app/?bench&section=off` | **Controlled comparison**, section off (production's drawing) |
| `https://chancla-git-codex-graphics-polish-jclekkas.vercel.app/?bench=live` and `?bench=live&section=off` | **Live gameplay stress test**: real bots. Not a section cost comparison |

Options: `&quality=high|medium|low` (default High), `&secs=` (default 60), `&warmup=` (default 10).

**Controlled comparison (workload `cafe-scripted-v2`, hash `e4bfadc0`):**
- Practice starts as usual, so the bots' avatars, teams and name tags are real. Then the match is held still: the practice host and prediction are paused, without opening a menu.
- Every frame, the session gets a scripted scene that depends only on time since the start:
  - Rosa's position and view
  - three characters walking loops in front of the café (mirrored for the Panadería view)
  - six projectiles always in flight between them
- The scene is written at the moment the engine reads it, so both variants draw the same scene at the same timestamp, whatever their frame rate.
- Nobody can be eliminated, because nothing is simulated. A run where Rosa is not alive, or the hold drops, is invalid.
- Two things still integrate frame time: avatar animation phase and the shape of projectile trails. They can look slightly different at different frame rates, but never change what is drawn (meshes, draw calls, triangles).
- **Timing:** warm-up 10 s, then 60 s measured, 15 s per view exactly. Draw-call and triangle averages are weighted by frame time, so a variant drawing fewer frames still averages over the same moments.
- **Checks built into each run:** once per scene second, the run compares the camera, each character and each projectile the engine actually drew against the script. A mismatch, or a missing character or projectile, invalidates the run.

**Live stress test:**
- Real bots on normal difficulty, with throwing held down, so Rosa throws at the weapon's own rate whatever the frame rate.
- Rosa's spawn protection is held on for her alone, so she cannot be eliminated; an elimination would invalidate the run.
- The same equal-time views as the controlled comparison.
- It records what was on screen: characters in view and projectiles in flight.

**Both modes:**
- **Invalidated by:** hiding the tab, resizing or zooming, changing quality, or opening a menu.
- **Exported:** build, benchmark version, mode, workload id and hash, variant, quality, canvas and buffer size, pixel ratio, frame-time median, p95, p99 and max, frames over 50 ms, average FPS, draw calls and triangles (average, min, max), the same per view, and the renderer and user agent.
- Copy results and Save JSON keep everything on the device.

**Results** (`bench/bench-60s.json`; its `build` reads `d2456db (local)` because it was built from the uncommitted tree that was committed unchanged as 7421e3d): headless Chromium 141 on SwiftShader, a **software renderer on a shared cloud CPU, not a GPU**. The phone rows are Chromium emulating an iPhone screen, not a phone.

| Run (60 s, 15 s per view) | Experiment | Production drawing | Difference |
| --- | --- | --- | --- |
| Controlled, desktop 1280 × 720, High (A B B A) | 538 / 538 calls, 104.3k tris, 2.5 / 2.7 FPS, p95 517 / 450 ms | 525 / 525 calls, 97.2k tris, 2.6 / 2.8 FPS, p95 445 / 431 ms | **+13 calls, +7.1k triangles** |
| Controlled, desktop, Low | 307 calls, 68.2k tris, 4.9 FPS, p95 252 ms | 297 calls, 65.1k tris, 5.4 FPS, p95 225 ms | +10 calls, +3.1k |
| Controlled, emulated phone 844 × 390, Low | 312 calls, 68.9k tris, 8.6 FPS, p95 141 ms | 302 calls, 65.8k tris, 8.7 FPS, p95 139 ms | +10 calls, +3.1k |
| Live stress, desktop, High | 419 calls, 88.8k tris, 2.7 FPS; 1.10 characters in view, 8.3 projectiles in flight | 374 calls, 77.9k tris, 2.9 FPS; 0.82 characters, 7.2 projectiles | +45 calls (includes a different workload) |

**The +35 versus +13 question, answered by measurement.**
- **With the scene identical,** the section adds exactly **+13 draw calls and +7.1k triangles** at High. That is the same as the static count, in both A B B A pairs, and the minimum and maximum per frame shift by the same amount. At Low it adds +10.
- **The live runs differ by more** (+45 here, +35 in version 1) because the workload differs between runs: in this pair the experiment run had 34% more characters in view and 15% more projectiles in flight. That extra is the bots, not the section.
- **Not exactly attributed:** the characters-in-view figure counts a character only when its feet are on screen, so a per-character draw-call cost is not derived from it.

**Software-renderer frame rates:** the section costs roughly 0-10% here, but this renderer says nothing reliable about a GPU. **No real Mac, Safari or phone has been measured.**

### Mac and phone instructions (about 10 minutes)

**M4 Mac, High** (Chrome or Safari; leave the window alone during each run):
1. Open `https://chancla-git-codex-graphics-polish-jclekkas.vercel.app/?bench`. After about 75 s, press **Save JSON**.
2. Open `https://chancla-git-codex-graphics-polish-jclekkas.vercel.app/?bench&section=off` and save again.
3. Repeat both, in the order section off, then on.
4. Optionally, run `https://chancla-git-codex-graphics-polish-jclekkas.vercel.app/?bench=live` once for the gameplay stress number.

**Phone, Low** (landscape, nothing else open, screen kept on):
1. Open `https://chancla-git-codex-graphics-polish-jclekkas.vercel.app/?bench&quality=low`, then `https://chancla-git-codex-graphics-polish-jclekkas.vercel.app/?bench&quality=low&section=off`.
2. Save or copy each result.

Send the files. "Not valid" means run that one again.

**Look-check on both devices:** in normal practice on El Patio, walk along the café and the Panadería. Look for flicker on the planter rim and stairs, shimmer on walls and trim, floating pieces, and anything that looks passable but isn't. Check that an enemy in front of the café is easy to see.

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

Benchmark correction (version 2), locally, every request to another host blocked:

| Check | Build | Result |
| --- | --- | --- |
| `npm run typecheck`; offline and normal builds (benchmark absent from the normal build) | | pass |
| `vitest` (30 files), including `tests/bench-scene.test.ts`: the scene is identical at shared timestamps from a 60 fps and a 7 fps sampling; equal time per view in warm-up and measurement; always 3 characters and 6 projectiles with continuous flights; address parsing | | 275/275 |
| `scripts/graphics-bench-e2e.ts`: the drawn scene matched the script at every checkpoint, both at normal speed and with a 900 ms busy wait per frame (50 vs 21 frames, same workload hash); equal view time in both; the throttled run is marked a test; invalidation on hidden tab, resize and menu; Save, Copy and links; settings restored; ten 60 s runs valid; the live run had no eliminations and real throws; no external requests; no page errors | offline | 25/25 |
| `scripts/graphics-practice-e2e.ts`, `e2e:menu` (the only gameplay file touched is the practice pause, through a flag set only by the benchmark) | offline | 20/20, 28/28 |

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
- **The benchmark's draw-call gap** is resolved: with an identical scene the section adds +13 at High; the larger live gap came from a different workload (see the benchmark section).

## Next step

Measure on the M4 Mac and a phone with the checklist. If the section holds its targets there, and the look is approved, the kit is ready to extend to other blocks. Until then, keep it to this section. Any production release needs separate approval.
