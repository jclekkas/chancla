# Chancla Duty

First-person remaster of Chancla Warfare. The page keeps Warfare's match, practice, online rooms, story, controls, and soundtrack, and draws them with its own scene: merged courtyard geometry, instanced papel picado, lights, trees, and awnings, new Rosa models, and new chanclas. Dash, charged throws, recall, La Legendaria, and the extra shoes work in practice, online, and story (a dash waits while Rosa is carrying a roller, and a heavy-only puzzle still wants La Pesada). The original site at `/` and `/classic.html` still plays the way it did. Protocol version stays 4.

```bash
npm ci
npm run dev:server    # online rooms
npm run dev
```

Open http://localhost:5173/chancla-duty/

Online uses the same server and protocol as Warfare (`ws://localhost:8787/ws` on this machine, or `VITE_GAME_SERVER_URL`).

## Play

Same as Warfare: click the picture to lock the mouse, WASD to move, mouse to look, click or F to throw, Space to jump, C or Shift to crouch, 1 and 2 for La Chancla and La Pesada, Tab for scores, Esc for the menu. Settings include sensitivity, invert Y, field of view, and touch aim. Phones get the original stick, drag-look, and throw buttons. Story is **Before the Guests Arrive**, including the roller fetches, the kitchen, the patio clean-up, and the piñata phases.

Duty adds, in practice and online:

| Key | Action |
| --- | --- |
| Hold the throw | Charge it. A tap stays quick. A held throw flies faster and hits harder. |
| V | Dash along your look. Short cooldown. |
| R | Recall your chanclas. |
| G | La Legendaria, once the meter is full. Throws come out much faster for a few seconds. |
| 3, 4, 5 | La Huarache, Las Gemelas, El Tacón, after you buy them. |

The shop sits on the title screen. Eliminations pay respeto and build a combo. Endless waves is a toggle there: the room resets the score instead of ending. Protocol version stays 4, so an original client can still join a server from this branch. An original client sends the old 7-number input; Duty adds an optional charge and three button bits.

## Parity checklist

| Feature | Status |
| --- | --- |
| First-person camera, pointer lock, mouse look | Matched. Same engine as Warfare. |
| Sensitivity, invert Y, field of view | Matched. Same settings screen. |
| Touch stick, drag look, throw, jump, crouch | Matched. |
| Private rooms, invite codes, teams, ready, host start, bots | Matched. Same protocol. |
| Client-side prediction and reconciliation | Matched. Same `GameSession` as Warfare. |
| Patio, Plaza, Fiesta | Matched. |
| La Chancla and La Pesada, jump, crouch, throw | Matched. |
| 5 minutes, first to 25, respawn, spawn protection, cafecito | Matched. Server-owned. |
| Score, timer, kill feed, results, rematch | Matched. |
| Story: six roller steps, kitchen phases, patio switches, piñata phases | Matched. The original campaign simulation and puzzles run here. |
| Full soundtrack and soundtrack panel | Matched. Same music player and tracks. |
| Voice lines on the original timeline | Replaced. New bilingual lines, same ids and beats. Spoken with the browser’s speech synthesis. The original placeholder clips are not loaded. |
| English and Spanish UI, subtitles | Matched. |
| Graphics quality, volumes, banter, reduced motion, FPS readout | Matched. Duty replaces the courtyard mesh with its own merged scene. |
| Classic solo arcade | Matched via the Classic button, which opens the original arcade page. |
| Dash, charge throw, recall, La Legendaria | In practice, online, and story. A dash does not run while Rosa is carrying a roller, so the kitchen beats stay reachable. |
| La Huarache, Las Gemelas, El Tacón | In practice and online, after the respeto shop. Huarache pierces, Gemelas throws a pair, Tacón homes. |
| Endless waves, respeto shop, combos | Shop and combo banner are on the Duty page. Endless is a room flag the server honors. An original client never sets it. |

## Art

Every model is built in code (`chancla-duty/src/scene.ts` and `courtyard.ts`). There is no downloaded character or weapon pack. The painted plaza floor reuses Warfare's ground painting so the inlay stays aligned with the fountain. The repeating wall grain is a KTX2/UASTC file at `public/chancla-duty/grain.ktx2`, encoded with the Basis Universal encoder from `@loaders.gl/textures` (BinomialLLC `basis_universal`). If the GPU cannot transcode it, the wall keeps the canvas grain. The Basis transcoder shipped in `public/basis/` is the one that comes with Three.js.

The fast tier bakes shading into vertex colors (a cheap ambient-occlusion term from height and face direction), uses one Lambert material on the merged courtyard, and does not run a shadow map. The high tier, used only when the GL renderer string is not a software rasterizer, switches that material to a standard PBR material and code-splits an environment map, GTAO, a small bloom, and FXAA.

## Performance in this environment

No hardware GPU is attached. `/dev/dri` is empty, and Chrome's unmasked renderer is `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))`. Forcing `--use-gl=angle --use-angle=gl` falls back to Mesa llvmpipe. There is no hardware frame time to report.

Same camera, 1280×720, the showcase view of each map. Draw calls and triangles are `renderer.info` after the frame. Duty's CPU time is the JavaScript before `gl.draw*`, including the scene sync.

| Map | Original draw calls | Duty draw calls | Original triangles | Duty triangles | Duty CPU before draw |
| --- | --- | --- | --- | --- | --- |
| Patio | 75 | 27 | 34,910 | 23,696 | 0.10 ms |
| Plaza | 71 | 26 | 27,094 | 17,148 | 0.20 ms |
| Fiesta | 70 | 23 | 22,352 | 20,184 | under 0.1 ms |

The showcase frame rate on SwiftShader is about 11 fps for the original and 12–14 fps for Duty. The present is still a software `ReadPixels` of the whole canvas, so fewer triangles do not become 60 fps on this machine. The CPU budget of 4 ms is met. The high-tier post stack is not turned on here, because the renderer is software.
