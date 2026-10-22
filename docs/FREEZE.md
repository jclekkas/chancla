# "The game froze": investigation, fixes and diagnostics

A friend's game froze once during play. Device, browser, mode and steps are unknown, so this is a credible intermittent report, not a reproduced bug. This page records what was checked, what was found and fixed, and how to capture evidence next time.

**Status: the friend's freeze has not been reproduced and remains unconfirmed.** Several defects that produce a "frozen" experience, or could lead to one on a phone, were reproduced and fixed (below). Any of them could explain the report, and so could something not found yet. Passing tests do not prove the report is fixed.

## If it happens again: copy diagnostics

1. Don't reload yet if you can avoid it. Press **Esc** (or tap **☰ Menu**) and choose **Copy diagnostics**. It is also in **Settings** (bottom), and on the "Connection lost", "Graphics paused" and "The game stopped" screens.
2. Paste the text into a message. If the browser blocks copying, a box opens with the text selected: copy it by hand.
3. If the page is completely stuck (nothing responds at all), reload, then go to **Settings → Copy diagnostics** straight away. The report includes a short record of the previous session if it ended without a normal page unload, or with errors.

The Classic Arcade has the same button in its pause menu and settings.

**What the report contains:** build commit, which page (shooter or Arcade), mode (menu, practice, online, campaign mission), map, current screen, connection state and time since the last server message, round-trip time, input mode (touch, mouse with or without pointer lock), held inputs, whether the page is visible, WebGL context state, frames per second, time since the last good frame, consecutive frame errors, GPU geometry/texture counts, audio context and music state, viewport size and page zoom, browser user-agent, JS heap (Chromium only), and the last 80 events (screens, connection changes, match phases, errors with the file and line, frame gaps over 1 s, main-thread stalls over 1 s).

**What it never contains:** player names, room codes, invite links, resume tokens, chat, or settings values. Anything shaped like a room code is replaced with `[code]`, URLs are reduced to a file name, and each event is cut to 220 characters. Nothing is sent anywhere: the report only leaves the device if the player pastes it.

**Limits, stated plainly:**
- A main thread that is blocked right now cannot report anything. Stalls are recorded after they end (frame gap and, in Chromium, the long-task API; Safari has no long-task API).
- If the tab is killed while stuck, only the breadcrumb survives: a few hundred bytes in `localStorage`, rewritten every 5 s and on errors, holding the mode, map, screen, connection state, time since the last frame and the last three error messages.
- GPU hangs and driver resets are visible only as WebGL context loss.
- On iPhone and iPad, Safari's Web Inspector (from a Mac) remains the only way to see console output from a device.

## What was traced

| Area | Finding |
| --- | --- |
| Shooter frame loop (`engine.start`) | Schedules the next frame first, so one exception does not stop it. dt is clamped to 0.1 s and prediction to 6 ticks a frame, so a long background does not cause catch-up work. **Gap:** a run of exceptions froze the picture silently, with no message and no way out. Fixed (below). |
| Shooter UI loop (`uiTick`) | **Defect:** the next frame was scheduled last, so a single exception ended it for good (dialogue, mission victory controls and the touch cooldown ring stopped). Fixed: scheduled first. |
| Arcade loop (`core/loop.ts`) | Schedules first; dt capped; at most a fixed number of steps per frame. No change. |
| Practice host (`net/local.ts`) | Room update is capped at 250 ms of catch-up and 8 ticks per call; virtual clock stops while paused. No change. |
| Campaign runtime | Fixed-step with a 6-tick cap and accumulator reset. No change. |
| Online connection | **Defect:** a connection attempt that never opens or closes (network gone but not refused) left "Connecting…" or "Reconnecting…" up forever. Measured in Chromium: a socket to a server that accepts TCP but never answers stays in CONNECTING for over 60 s with no event. Fixed (below). The existing 6 s silence watchdog already handled a socket that stays open but goes quiet. |
| WebGL context loss | **Defect:** the only feedback was a 5 s toast saying "This browser could not start 3D graphics" (wrong), then a frozen picture. If the browser never restored the context, nothing ever changed. Fixed (below). Verified that rendering is correct after the context is restored (screenshot comparison). |
| Code loading | **Defect 1:** if the engine chunk failed to download at startup, the page said the browser could not do 3D graphics, with no retry. **Defect 2:** if the mission chunk failed (a network blip, or a new deploy replacing the file), Start showed "The connection to the room ended", and pressing Start again could never work, because Chromium remembers a failed module import for the life of the page (measured). The background prefetch also raised an unhandled promise rejection. Fixed (below). |
| Input | Already released on menu, rotate screen, visibility change, pointer-lock loss, touch cancel and rotation (covered by existing tests). Re-verified: backgrounding with W and D held leaves nothing held. |
| Menus and overlays | Pointer-lock and overlay traps were fixed earlier (menu-access tests). Re-verified: 12 rapid Esc presses while a mission loads leave a playable state. |
| Listeners and resources | One engine, one loop, one set of window listeners; mission cards are rebuilt (old listeners go with them); sessions clear their ping and attempt timers on close; the practice host clears its interval on dispose. **Defect (found by the soak test):** GPU memory grew without bound. Each match left the per-avatar geometry of every player behind (about 28 GPU buffers per practice match: skirt trim, apron, shawl, hair, hat parts), and each mission left its ricochet-surface texture and materials behind. Over 31 minutes the GPU geometry count went from 178 to 719 and textures from 21 to 32, and it would keep growing. On a phone, steadily growing GPU memory ends in the browser resetting the graphics (WebGL context loss: a frozen picture) or killing the tab. Fixed (below). |
| Audio | Decoding is asynchronous (`decodeAudioData`) and off the main thread; no change. |
| Main-thread stalls | Measured on the software renderer used for tests: about 2 s at first load and about 1 s at match start (shader compilation). They end on their own, but a slow phone could show a similar pause at match start. Now recorded in diagnostics as "main thread busy" / "no frame for". |

## Fixes

1. **Connection attempts time out** (`src/net/session.ts`). No welcome within 8 s on a first connection, or 5 s on a reconnect attempt: the attempt is closed (its callbacks detached, so a late reply is ignored) and handled as a normal drop. In a match, attempts continue until the client deadline (2 s inside the server's 25 s grace period), then "Connection lost" with Retry, Practice and Main menu. On a first connection the player is told the server is unreachable. When the browser reports it is back online, or the page becomes visible again, a hung attempt is replaced at once instead of waiting out its timeout. A first version used 8 s for reconnects too; a real-server test then showed a network returning 19 s after a drop still lost the match (the attempt in flight was hung until after the deadline), which is why reconnects use 5 s.
2. **"Graphics paused" screen** for WebGL context loss: explains what happened in plain words, pauses practice and missions (online keeps going for everyone else and says so), releases held input, and adds "Reloading usually fixes this" after 8 s. Disappears on restore.
3. **"The game stopped" screen** when 30 frames in a row throw: Copy diagnostics, Back to the menu, Reload page, with a sentence saying both end the current match or mission and that campaign progress and settings are kept. The failing frame work is then halted (no endless error loop behind the screen) until the player goes back to the menu. Every error is recorded in diagnostics and the console; nothing is swallowed.
4. **Load failures say what happened and offer Reload**: engine chunk at startup, and mission chunk at Start (progress is saved; the message says so). No unhandled rejection from the prefetch.
5. **UI loop survives an exception** (scheduled first).
6. **Diagnostics and Copy diagnostics** (`src/diag.ts`) in the shooter and the Arcade, with the build commit also shown at the bottom of Settings.
7. **GPU memory no longer grows with every match and mission.** `Avatar.dispose()` now frees the geometry made for that avatar (shared geometry is marked and kept); `MissionView.dispose()` frees its texture and materials. Measured after the fix: 5 practice matches, 3 missions and 3 online lobbies in a row leave the counts flat (97-108 geometries, 15 textures) instead of +28 per match and +1 texture per mission.
8. **Every Reload explains what it costs** (shooter screens, and the Arcade's graphics screen: "Reloading ends this run; your best scores and settings are kept").

## Tests

All browser tests ran in headless Chromium 141 with a software renderer (SwiftShader) in a Linux container, against a local game server (production was never used). None ran on a phone, on Safari or on a real GPU.

| Test | What it proves | Result |
| --- | --- | --- |
| `tests/session-timeout.test.ts` | Fake transports and timers: a slow welcome connects once; a first connection that never answers ends "unreachable", a late reply is ignored and no room is created; a hung reconnect attempt is dropped and the next one rejoins with the same resume token, id and team, with at most one live socket and only the original `create` ever sent; a reply just inside the deadline gets back in; past it the player is told and retries stop; "room gone" is reported; `retryNow` replaces a hung attempt and detaches it; closing mid-attempt leaves no timer. | 9/9 |
| `tests/mp-mobile-net.test.ts` | Real server: frozen socket detected; hung reconnect abandoned and the player gets back in; **network back 19 s after the drop still rejoins the same slot and team, with no duplicate player**; never back: "lost (timeout)"; hung first connection: unreachable. | 6/6 |
| `tests/diag.test.ts` | Redaction (room codes, invite fragments, tokens, URLs), bounded buffer, provider failure, breadcrumb across a reload, copy failure reported. | 7/7 |
| `tests/campaign-howto.test.ts` | Every hint has a specific instruction; every rejected hit is explained; on touch controls no instruction mentions keys or the mouse. | 10/10 |
| `scripts/failure-e2e.ts` | Real page. Server that never answers; online graphics loss (match keeps going for others, input released, updates keep arriving, no blocking overlay after restore); network stall that recovers (the browser's "online" signal retries in 0.2 s), and one that doesn't ("Connection lost" in 26 s, way home works); engine and mission downloads failing (honest message, Reload works); practice and mission graphics loss (pause, clock stops, Resume continues at the same speed as before the loss); frames that keep throwing ("The game stopped", held keys released, failing work halted: 0 calls in 1.5 s, wording says what going back costs, Back to the menu works, a new match starts); Copy diagnostics with the clipboard allowed and refused; 12 rapid menu toggles while a mission loads; backgrounding with keys held. | 30/30 |
| `scripts/soak-e2e.ts` | Long session without reloading (campaign, online with a friend joining and leaving, rematches, map changes, practice with restarts), then two campaign → menu → Arcade → online round trips. Fails if GPU resources grow. | see below |
| `scripts/crossdevice-e2e.ts` | Four emulated devices; real server-scored eliminations by keyboard and touch; identical results everywhere. | 33/33 |

### Soak runs

| Run | Build | Duration | Result |
| --- | --- | --- | --- |
| 1 | `0f5fae2` plus the uncommitted working tree at 19:28 (bundle `main-NHj2nvJV.js`): connection timeouts, recovery screens, diagnostics, load-failure fixes. Not included: touch wording for campaign instructions, background-gap stall filter, the GPU fixes and later connection changes. | 31.5 min, 10 cycles, 40 matches | No problems, no page errors, server empty at the end. **GPU growth found:** geometries 178 → 719, textures 21 → 32, heap +2.8 MB. Led to fix 7. |
| 2 | `a1b9de9` (build id embedded in the bundle; every fix in this document) | 31.1 min, 10 cycles, 40 matches, then 2 Arcade round trips | No problems, no page errors, server empty at the end (0 rooms, 0 players). GPU resources flat: geometries 119-120 every cycle, textures 22 from cycle 2 on, DOM 668 nodes throughout, heap 12.9 → 14.1 MB (after GC, within noise). |

### Observations that are not bugs here, but matter on phones

- The software renderer runs missions at about 10 fps here. The simulation caps catch-up at 6 steps a frame, so at 10 fps a mission runs at about half speed (slow motion, not a freeze). The same would happen on a phone that drops that low.
- First load and the start of a match block the main thread for about 1-2 s here (shader compilation). A slow phone may show a similar pause; diagnostics record it as "main thread busy" or "no frame for".
- The connection's 6 s silence watchdog means a phone whose page was frozen in the background reconnects on return; this is covered, but only in emulation.
