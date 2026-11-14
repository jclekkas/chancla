# Chancla Duty

A remaster of the games in this repo: Chancla Warfare (online and practice), the classic arcade, and the four-mission story, plus the Duty layer (extra shoes, dash, combos, respeto, endless shift). The original client, classic page, and game server are unchanged. Duty is another page from the same build, at `/chancla-duty/`.

Warfare matches use the original protocol. Practice runs the real room inside the page. Online play uses the same game server (`ws://localhost:8787/ws` locally, or `VITE_GAME_SERVER_URL`).

```bash
npm ci
npm run dev:server   # only for online rooms
npm run dev
```

Open http://localhost:5173/chancla-duty/

## How to play

| Action | Warfare (Sol vs Luna) | Duty / classic / story | Touch |
| --- | --- | --- | --- |
| Move | WASD or arrows | WASD or arrows | Left stick |
| Aim | Mouse, or drag the right side | Mouse | Drag the right side |
| Throw | Click | Click, hold to charge | Throw |
| Jump | Space | — | — |
| Dash | — | Space | Dash |
| Crouch | C | — | — |
| Weapons | 1 La Chancla, 2 La Pesada | 1–5, the shoes you have unlocked | ⇄ |
| Recall | — | R | ↩ |
| La Legendaria | — | F when the meter is full | ★ |
| Menu | Esc | Esc or P | ☰ |

Duty, Story, Classic, and Endless keep the respeto shop, combos, and the extra shoes. Warfare is the team match: 5 minutes, first to 25, Sol in marigold, Luna in teal, no friendly fire.

## Parity checklist

Status is against Chancla Warfare, the classic arcade, and the game server as they exist in this repo.

| Feature | Status |
| --- | --- |
| Private online rooms, invite code, join | Matched. Same protocol and server. |
| Practice vs labeled bots, easy / normal / hard | Matched. The real in-browser room host. |
| Teams Sol and Luna, switch team, ready, host start | Matched. |
| Fill empty seats with bots | Matched. |
| Maps Patio, Plaza, Fiesta, host picks | Matched. Drawn from the authoritative boxes. |
| Weapons La Chancla and La Pesada | Matched in Warfare. Duty adds La Huarache, Las Gemelas, and El Tacón. |
| Jump, crouch, throw | Matched in Warfare. |
| 5-minute match, first to 25, respawn, spawn protection | Matched. The server still owns them. |
| Score, timer, kill feed, results, rematch, back to lobby | Matched. |
| Ping | Matched. |
| Cafecito pickups | Matched. Spots come from the map data. |
| Classic three waves, Bocinas, Influencer, Soplador, El Rey | Improved. Same cast and a boss, played with Duty rules (charge, recall, Legendaria, dash). |
| Story: Ruleros, Kitchen, Patio, Piñata | Adapted. Four playable missions with those premises. The original puzzle scripts (six roller fetches, cooking phases, switch-cleaning, scripted piñata phases) are not re-simulated step for step. |
| English and Spanish | Improved. Duty menus are bilingual. Warfare lobby labels are English. |
| Mouse, keyboard, and touch | Matched for both layers. Warfare touch uses the same stick, drag-aim, and throw button. |
| Settings: music, effects, graphics, shake, aim assist, reduced motion, FPS, language | Matched for Duty. Warfare uses the same volumes and the original Rosa theme when the file is present. |
| Mouse sensitivity, invert Y, field of view, pointer lock | Adapted. Warfare is top-down, so look is the cursor rather than a locked FPS camera. |
| Client-side prediction and reconciliation | Not matched. Duty renders server snapshots. Movement is authoritative but not predicted, so it is less smooth at high ping than the original FPS. |
| Voice lines and the full soundtrack panel | Not matched. The original voices are placeholder clips tied to the FPS dialogue timeline. Duty plays Rosa's theme during a Warfare match and a synthesized loop in Duty modes. |
| First-person viewmodel and 3D camera | Replaced. The remaster is top-down so the whole courtyard, teams, and throws read at once, with a light tiled pass instead of the Three.js scene. |
| Extra Duty layer: dash, combos, respeto shop, endless shift, more enemies and pickups | Added. Not in the original. |

Graphics and the sim stay on one canvas. Warfare does not load Three.js. The original pages are still `/` and `/classic.html`.
