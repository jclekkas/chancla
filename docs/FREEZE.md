# "The game froze": investigation, fixes and diagnostics

A friend's game froze once during play. Device, browser, mode and steps are unknown, so this is a credible intermittent report, not a reproduced bug. This page records what was checked, what was found and fixed, and how to capture evidence next time.

**Status: the reported freeze has not been reproduced.** Four defects that produce a "frozen" experience were reproduced and fixed. Any of them could explain the report, and so could something not found yet. Passing tests do not prove the report is fixed.

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
| Listeners and resources | One engine, one loop, one set of window listeners; mission cards are rebuilt (old listeners go with them); sessions clear their ping and attempt timers on close; the practice host clears its interval on dispose. Measured over a long session (below). |
| Audio | Decoding is asynchronous (`decodeAudioData`) and off the main thread; no change. |
| Main-thread stalls | Measured on the software renderer used for tests: about 2 s at first load and about 1 s at match start (shader compilation). They end on their own, but a slow phone could show a similar pause at match start. Now recorded in diagnostics as "main thread busy" / "no frame for". |

## Fixes

1. **Connection attempts time out** (`src/net/session.ts`, `CONNECT_TIMEOUT_MS = 8000`). No welcome from the server within 8 s: the attempt is closed and handled as a normal drop. In a match, reconnect attempts continue with backoff until the server's 25 s grace period runs out, then "Connection lost" with Retry, Practice and Main menu. On a first connection the player is told the server is unreachable.
2. **"Graphics paused" screen** for WebGL context loss: explains what happened in plain words, pauses practice and missions (online keeps going for everyone else and says so), releases held input, and adds "Reloading usually fixes this" after 8 s. Disappears on restore.
3. **"The game stopped" screen** when 30 frames in a row throw: Copy diagnostics, Back to the menu, Reload page. Every error is recorded in diagnostics and the console; nothing is swallowed.
4. **Load failures say what happened and offer Reload**: engine chunk at startup, and mission chunk at Start (progress is saved; the message says so). No unhandled rejection from the prefetch.
5. **UI loop survives an exception** (scheduled first).
6. **Diagnostics and Copy diagnostics** (`src/diag.ts`) in the shooter and the Arcade, with the build commit also shown at the bottom of Settings.

## Tests

| Test | What it proves | Result |
| --- | --- | --- |
| `tests/mp-mobile-net.test.ts` (3 new) | A hung reconnect attempt is abandoned and the player gets back in when the network returns; if it never returns, "lost (timeout)" within the grace period; a hung first connection reports unreachable. All three failed before the fix. | 5/5 |
| `tests/diag.test.ts` | Redaction (room codes, invite fragments, tokens, URLs), bounded buffer, provider failure, breadcrumb across a reload, copy failure reported. | 7/7 |
| `scripts/failure-e2e.ts` (`npm run e2e:failure`) | Real page: server that never answers; network stall mid-match that recovers, and one that does not; engine and mission downloads failing; WebGL context lost and restored, and lost for good; frames that keep throwing; Copy diagnostics with the clipboard allowed and refused; rapid menu toggling while a mission loads; backgrounding with keys held. | 23/23 |
| `scripts/soak-e2e.ts` (`npm run e2e:soak`) | Long session without reloading, then Arcade round trips. See below. | see below |

All browser tests ran in headless Chromium 141 with a software renderer (SwiftShader) in a Linux container, against a local game server. None ran on a phone, on Safari or on a real GPU.
