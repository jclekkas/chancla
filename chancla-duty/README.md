# Chancla Duty

First-person remaster of Chancla Warfare. This page runs the original match, practice, online rooms, story puzzles, controls, and soundtrack, then adds smooth lighting, a brick plaster, filmic tone mapping, and a new voice. Dash, charged throws, recall, La Legendaria, three extra shoes, endless waves, and a respeto shop run in practice and online. The original site at `/` and `/classic.html` still plays the way it did. Protocol version stays 4, so an original client can join a server from this branch.

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
| Graphics quality, volumes, banter, reduced motion, FPS readout | Matched. Duty also swaps the cel shader for smooth lighting, ACES tone mapping, a brick plaster on the walls, and a smaller shadow map. |
| Classic solo arcade | Matched via the Classic button, which opens the original arcade page. |
| Dash, charge throw, recall, La Legendaria | In practice and online. The shared sim and the Duty client both run them. Story keeps the original puzzle inputs so the authored spacing stays put. |
| La Huarache, Las Gemelas, El Tacón | In practice and online, after the respeto shop. Huarache pierces, Gemelas throws a pair, Tacón homes. |
| Endless waves, respeto shop, combos | Shop and combo banner are on the Duty page. Endless is a room flag the server honors. An original client never sets it. |

## Performance in this environment

No hardware GPU is attached. Chrome’s default renderer is SwiftShader (Vulkan). `--use-gl=angle --use-angle=gl` falls back to Mesa llvmpipe, which is still a software rasterizer. Viewport 1280×720, quality High, one bot. FPS is a 5-second `requestAnimationFrame` sample after the match HUD is up. 1% low is the slowest 1% of those frames.

| | Original, SwiftShader | Duty, SwiftShader, full resolution | Duty, SwiftShader, adaptive scale | Duty, llvmpipe, full resolution |
| --- | --- | --- | --- | --- |
| Canvas ready | 2.2 s | 0.37 s | 0.36 s | 0.54 s |
| Match HUD up | 7.2 s | 4.1 s | 3.1 s | 1.9 s |
| Average FPS | 4.9 | 7.8 | 12.4 | 35.1 |
| 1% low FPS | 4.6 | 6.7 | 10.0 | 29.9 |
| Average frame | 203 ms | 129 ms | 81 ms | 28.5 ms |
| Dev-server transfer | 10.1 MB | 11.5 MB | 11.5 MB | 11.5 MB |

The game’s own frame timer on Duty was about 1 ms. The rest is the software GL flush, including a `ReadPixels` stall Chrome logs while presenting the canvas. Duty turns multisampling off, uses a Lambert shader on SwiftShader instead of the cel ramp, keeps the shadow map at 512 and refreshes it every other frame, and lowers the pixel ratio when frames are landing slower than 45 fps (it will not go under 0.7). That is faster to load and faster to draw than the original on this machine. It is not 60 fps here. A mid-range laptop GPU was not available to measure. Bloom, SSAO, and a real-time environment map are not enabled on the software path, because they would add fullscreen passes to a present that is already the bottleneck. On a GPU renderer, Duty keeps the standard material and an environment map.

A production build adds one Duty chunk of 19.0 KB (8.7 KB gzip) on top of the shared Warfare bundles. The dev-server transfer above is every unbundled module, not the shipping payload.
