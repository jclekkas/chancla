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

- **Real hardware:** no Mac, phone or GPU was used. Frame rates and visual quality on a real GPU are unmeasured: SwiftShader antialiasing and texture filtering differ from a GPU's. Run the lab's Measure on an M4 Mac (High) and a phone (Medium and Low) to get real numbers.
- **Safari and WebKit:** not run. WebKit could not be downloaded here.
- **The hosted preview:** the Vercel preview could not be opened from this environment (its network policy blocks vercel.app). Its build status comes from GitHub's commit status, and offline-only mode from the build settings above.
- **Phone controls:** touch was tested in emulation (Chromium with touch events at iPhone size), not on a phone.
- **Online play:** not tested with the section, because the preview has no online play by design. The section is rendering only; the server and shared simulation are untouched.

## Next step

If this look is approved, apply the kit to the other El Patio buildings one block type at a time, measuring draw calls each time. Then review on real devices before considering any production release, which needs separate approval.
