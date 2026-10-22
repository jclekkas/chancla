# Browser and OS compatibility

Levels used here:

- **Directly tested**: the build ran in that browser engine and was exercised by an automated or manual run from this repository.
- **Indirectly tested**: the code path is covered by tests in a related environment (for example Node, or Linux Chromium for logic shared by every Chromium browser), but this exact browser and OS combination was not run.
- **Unverified**: not run. It is expected to work from the web platform features used, and that expectation has not been confirmed.

| Platform | Level | Notes |
| --- | --- | --- |
| Linux, headless Chromium (SwiftShader, CPU rendering) | Directly tested | Playwright: two- and four-client online matches through the real UI, practice, and the full four-mission campaign from a fresh save (helper bot driving) with screenshots, video and the recorded audio mix. Voice clips are verified as decoded and played. Frame rates are CPU-rendered and say nothing about real GPUs. Audio was captured as data and level-checked; nobody listened to it. |
| Node.js 22 (server and shared sim) | Directly tested | Vitest: physics, map, sim, bots, real-server multiplayer with two and four clients, plus a 150 ms RTT jitter and interruption relay. |
| Windows 10/11, Chrome | Indirectly tested | Same Chromium engine as the Linux runs. Pointer lock, GPU drivers, DPI scaling and Windows-specific input were not tested. |
| Windows 10/11, Edge | Indirectly tested | Chromium-based. Same caveats as Chrome on Windows. |
| macOS, Chrome | Indirectly tested | Chromium-based. Trackpad gestures, Retina scaling and macOS pointer lock were not tested. |
| macOS, Safari (campaign and audio) | Unverified | Voice clips are MP3 and the score is pure Web Audio, both of which Safari supports. Audio unlock on the first click and `decodeAudioData` were not tested on Safari. |
| macOS, Safari | Unverified | WebKit was not run, not even in an automated build. Things to check: pointer lock (Safari requires a click and shows its own banner), `requestPointerLock` without a promise, Web Audio unlock, WebGL2 availability, and fullscreen (`webkitRequestFullscreen` is wired as a fallback). |
| Firefox (any OS) | Unverified | Not in scope. Expected to work. |
| iOS and Android | Online, Practice and Arcade: Touch Beta, unverified on hardware | Touch controls for online matches (mixed with computer players), Practice and the Arcade, checked only in Chromium mobile emulation. Story is marked computer only. Device checklist: [MOBILE.md](MOBILE.md). |

## Manual checklist for real Windows and Mac machines

Run this on each target before calling a platform verified:

1. Open the site. The title shows "Online server ready".
2. Practice → Start. Click to aim. Check that WASD, mouse look, Space, C or Shift, left click, F, 1 and 2, the wheel, Q and right click all work.
3. Press Esc. The menu opens, and in practice the match pauses. Resume. Repeat three times quickly; the browser may delay re-locking, so click-to-aim must appear rather than the game sticking.
4. Alt-Tab (Cmd-Tab on Mac) away while holding W, then come back. The player must not keep walking.
5. Settings: change sensitivity, invert Y, FOV, quality, the music and effects volumes, and reduced motion. Reload the page; the settings persist.
6. Trackpad (Mac): move with WASD and look with the trackpad, firing with F. Two-finger scroll switches the chancla, at most once per gesture.
7. Fullscreen from the menu, then exit. The view resizes correctly.
8. Online: create a room. Open the invite link on a second machine, join, ready, start, play to results, rematch, leave with confirmation.
9. Turn Wi-Fi off for 5 seconds during a match. "Reconnecting…" shows, and play resumes after Wi-Fi returns.
10. Switch to Español. Every screen is translated.
11. Campaign: play Mission 1 from a fresh save. You should hear music and voiced lines with subtitles, and they should stop when muted in Settings (music, effects and dialogue separately). Turn off automatic banter and check that story lines still play. Pause during a line, then resume. Music: the menu plays Rosa's theme (a recording). It carries on into mission select, crossfades into each mission's track, dips under dialogue, and loops without a jump (listen at about 1:40 in Mission 1). In Safari, confirm the recordings play rather than the synthesized fallback (`__fps.music().state().layer` should be `recorded`).
12. Campaign: retry from a checkpoint, restart a mission, leave a mission, reset campaign progress. Check that settings survive the reset.
