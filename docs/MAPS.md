# Standalone maps

Three arenas can be played outside the campaign, in the Arcade and Practice. All are unlocked from the start.

| Map | Size | Style | What makes it different |
| --- | --- | --- | --- |
| **El Patio** | 54 × 38 m | Balanced, short to medium range | The original courtyard. In Practice and online it has two terraces, an alley, the market and the fountain. **The Arcade keeps its own original El Patio courtyard**, so the Arcade balance test on `main` (a 105–300 s pacing window) is unchanged. |
| **La Plaza** | 60 × 36 m | Long central lines, covered flanks | An open square. A low fountain sits in the middle; standing players see over it. There are market stalls with awnings, a kiosk, trees and a low stage at each end. Covered arcade walkways run along the north and south, behind arched walls with four openings each, as protected routes. |
| **La Fiesta** | 42 × 28 m | Close range, many paths | A party courtyard. Hedge-lined lanes run north and south. Hedges come in two heights: 1.3 m (cover when crouched) and 1.9 m (full cover). The party floor has long tables and stacks of presents, with a small band stage. A piñata hangs over the dance floor: hit it and it spins and showers confetti. It's just for fun, with no score or effect. |

Screenshots: `docs/evidence/maps/` holds, for each map:

- an overview (`<map>-overview.png`) and a player's-eye view (`<map>-ground.png`), plus `plaza-walkway.png` and `fiesta-pinata.png`
- the generated overhead drawn on each map card (`<map>-overhead.png`)
- the Practice map choice (`practice-map-select.png`)

## Choosing a map

- **Practice:** the setup screen shows the map cards. Each card has an overhead view drawn from the map's own collision boxes (so it's exactly the layout you play), the name, a description and the combat style. There's also a **Random map** card.
- **Arcade:** Play opens the same cards; Start begins the run.
- **Saved choice:** the last choice is remembered locally (`practiceMap` and `arcadeMap`).
- **Random** is resolved when the match starts. **Restart keeps that map**; the map only changes when you ask.
- **Change map:** in the pause menu it asks first, because the run in progress is abandoned. On the results screen it goes straight to the map choice.
- **Online:** the room carries the map. The host picks it in the lobby, the room is authoritative, and every client loads it from the room view (protocol version 4). **No game server is hosted**, so online play, including map choice, is unavailable on the live site. It was tested only against a server started locally (see below).

## How it is built

- **`shared/maps/`** is the registry: `index.ts`, plus `plaza.ts` and `fiesta.ts` (El Patio stays in `shared/map.ts`). A map is plain data:
  - boxes (collision and render footprint are the same thing)
  - spawns per team
  - bot waypoints
  - regions (the HUD area names)
  - pickups
  - decoration (`MapDecor`): all of it above head height or flush with a wall, so it never blocks movement or hides a player
  - an Arcade layout (`ArcadeLayout`): enemy entrances, the boss stage, pickups, player start
- **Practice and online:** `Room` builds its `MatchSim` from `mapData(room.map)`. Bots build their navigation graph from the same map, with links verified by simulated walks. The client's prediction collision follows the room's map (`GameSession.world`).
- **Rendering:** `src/fps/render/world.ts` builds any map from its boxes and decoration. El Patio's decoration (lights, laundry, papel picado, team banners, the church) moved into its map data unchanged.
- **Arcade:** `Game.setMap()` swaps the arena between runs. `src/world/mapArena.ts` builds La Plaza and La Fiesta with the same renderer, adds the DJ's speaker stacks on the stage, and uses the map's boxes for collision and a fresh navigation grid. The player's bounds, enemy navigation, the boss's stage and the tutorial dummies all follow the new map.
- **Loading and disposal:**
  - Maps are built when chosen, not at startup.
  - Switching disposes the previous map's geometry and materials. The Arcade keeps the geometry its characters share.
  - Music is unchanged: the Arcade and Practice keep their tracks, loading recovery, mute and volume.
- **Campaign:** untouched. Missions still overlay El Patio, and nothing in the registry reaches them.

## Verification

All checks ran in this Linux container: Node 22, and headless Chromium with software rendering.

- **`tests/maps.test.ts`** (32 checks) runs on each map:
  - five free spawns per team, inside their own compound
  - no line of sight between the spawn areas
  - nothing on the opponents' half can see a spawn point, and from anywhere outside a spawn's doorstep at least two of its five points stay hidden
  - every waypoint free, standing on something, and connected to every other for bots
  - closed bounds
  - point symmetry
  - decoration above head height
  - Arcade entrances, pickups and dummies free, every entrance able to reach the player, and the boss on its stage

  It also checks that the maps really differ: La Plaza has 30 m+ sightlines, and La Fiesta's longest is under 75% of La Plaza's.

  **El Patio caveat:** from two alley spots (8.6 m out) you can see into each El Patio compound through its doorway. That's the shipped layout, and online play and the campaign are built on it, so it is pinned in the test rather than changed.
- **`tests/practice-maps.test.ts`** plays a full 2v2 bot match on each map to the end:

  | Map | Ended after | Score |
  | --- | --- | --- |
  | El Patio | 158 s | 23–25 |
  | La Plaza | 182 s | 22–25 |
  | La Fiesta | 166 s | 25–24 |

  Each match had kills on both sides, and every bot travelled. None of about 50 respawns per match happened in an opponent's sight. The test also covers the room keeping its map and only the owner changing it.
- **`tests/arcade-maps.test.ts`:** the Arcade balance bot won 5 of 5 runs on La Plaza (2.7–3.4 min) and 5 of 5 on La Fiesta (2.3–3.2 min). Enemies came from all 6 entrances each time. A player who does nothing is defeated and never leaves the arena. Switching maps back and forth leaves one arena and restores El Patio exactly.
- **`tests/mp-server.test.ts`:** against a real server, the host's map reaches the guest, a guest's change is refused, and the match starts on the host's map.
- **`scripts/play-e2e.ts`:** 69 browser checks, all passing. They cover Practice on every map, the Campaign and the Arcade on every map, then pause, the menus, the team label, Restart, Change map, Main menu and leaks. Online runs against a **locally started** server with a headless guest.

## Performance

Measured by `scripts/perf-maps.ts` (`docs/evidence/maps/perf.json`) under the same conditions on every map: 1280×720, quality "medium", Practice 2v2, and an Arcade run, sampled for 15 s after a 4 s warm-up.

The machine was this container: an Intel Xeon at 2.10 GHz with 4 cores, running Chromium 141 headless with **SwiftShader software rendering**. These frame rates describe a CPU rasterizer, not a real GPU, Windows or a Mac.

| Mode | Map | Frame rate | JS per frame | World draw calls | Triangles | Heap |
| --- | --- | --- | --- | --- | --- | --- |
| Practice | El Patio | 10.3 | 44 ms | 39 | – | 17 MB |
| Practice | La Plaza | 10.3 | 36 ms | 44 | – | 19 MB |
| Practice | La Fiesta | 10.3 | 25 ms | 40 | – | 22 MB |
| Arcade | El Patio | 7.1 | – | 217 (frame) | 27k | 12 MB |
| Arcade | La Plaza | 4.5 | – | 193 | 35k | 17 MB |
| Arcade | La Fiesta | 4.3 | – | 163 | 30k | 14 MB |

**Regression:** in the Arcade, the new maps render about 37% slower than its original El Patio in software rendering. They make fewer draw calls but have more triangles, and use the shooter's toon materials and its larger shadow area. Practice shows no regression.

## Limitations

- **No one has played these maps.** Layouts and balance come from automated checks and bots. La Fiesta looks easier for the Arcade bot (higher remaining health), and that needs a person to judge.
- **Online map choice is unavailable** until a server is hosted.
- **Not run on real Windows or Mac hardware.**
