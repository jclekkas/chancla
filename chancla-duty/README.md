# Chancla Duty

First-person remaster of Chancla Warfare. This page runs the original match, practice, online rooms, story puzzles, controls, and soundtrack, then adds filmic lighting, softer shadows, an adaptive pixel ratio, and a new voice. The original site at `/` and `/classic.html` is unchanged.

```bash
npm ci
npm run dev:server    # online rooms
npm run dev
```

Open http://localhost:5173/chancla-duty/

Online uses the same server and protocol as Warfare (`ws://localhost:8787/ws` on this machine, or `VITE_GAME_SERVER_URL`).

## Play

Same as Warfare: click the picture to lock the mouse, WASD to move, mouse to look, click or F to throw, Space to jump, C or Shift to crouch, 1 and 2 for La Chancla and La Pesada, Tab for scores, Esc for the menu. Settings include sensitivity, invert Y, field of view, and touch aim. Phones get the original stick, drag-look, and throw buttons. Story is **Before the Guests Arrive**, including the roller fetches, the kitchen, the patio clean-up, and the piñata phases.

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
| Graphics quality, volumes, banter, reduced motion, FPS readout | Matched, plus adaptive pixel ratio and ACES tone mapping. |
| Classic solo arcade (charge, recall, La Legendaria) | Matched via the Classic button, which opens the original arcade page. |
| Extra shoes, dash, respeto shop, endless shift, combo meter | Partial. A respeto counter and combo banner sit on Warfare events. Dash, extra shoes, charge throws, recall, and endless waves are not in the shared match protocol (two weapons, three buttons), so they are not in the online or story sim. |

## Performance in this environment

Headless Chromium, SwiftShader, 1280×720, quality High, one bot, after a warm reload. This measures the software rasterizer.

| | Original `/` | Duty `/chancla-duty/` |
| --- | --- | --- |
| Time until the canvas exists | 3.6 s | 3.0 s |
| Practice FPS readout | 10 fps | 10 fps |
| Countdown view, earlier sample | — | 97 fps |

Duty’s dev-server script transfer for that load was about 19 KB versus about 24 KB for the original page. The match FPS is the same because both pages draw the same courtyard. Duty’s extra cost is a rim light and filmic tone mapping; the adaptive pixel ratio is there to give that cost back when a frame runs long.
