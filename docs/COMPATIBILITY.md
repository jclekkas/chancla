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
| iOS and Android | Online, Practice and Arcade: Touch Beta, unverified on hardware (see the cross-device matrix below) | Touch controls for online matches (mixed with computer players), Practice and the Arcade, checked only in Chromium mobile emulation. Story is marked computer only. Device checklist: [MOBILE.md](MOBILE.md). |

## Cross-device multiplayer matrix

Every device type uses the same rooms, invite links, maps, teams, scoring and rematches: there is one client build and one server, with no per-device rules. What differs is how much of that has been proven on each device.

Legend:

- **Real**: run on the actual hardware and browser. **No combination has reached this level yet.**
- **Emu**: run in Chromium (Blink) on Linux, posing as that device (screen size, pixel density, touch, user-agent string). For the Chrome and Edge rows this is the same engine, so it is meaningful but still not Windows or macOS. For the Safari rows it is **not Safari**: it proves the layout and the touch logic, not WebKit.
- **Untested**: not run in any form.

Source: `npm run e2e:crossdevice` ([evidence](evidence/crossdevice/crossdevice-e2e.json)). Four separate Chromium instances (emulated iPhone, Android phone, iPad and Windows Edge desktop) played one four-player, two-per-team match against a local server, then a rematch, then plaza and fiesta. The patio match includes a combat phase: the desktop (keyboard W + F) and the Android phone (touch stick + Throw button) attack the two idle players; the server decides every hit. In the latest run (33/33 checks) the score reached 18-0 in 140 s (desktop 1 elimination, Android 17; the run before: 14-0, desktop 1, Android 13), all four devices showed the identical score and per-player eliminations and deaths, the results screen said "Team Sol wins" on all four, and the rematch reset the score to 0-0 with the same teams. The test steers only the view direction of the two attackers, from test code (it walks them along the game's navigation graph and points at an enemy in clear view); the game has no aim assist.

| Feature | iPhone Safari | Android Chrome | iPad Safari (touch) | iPad Safari (keyboard + trackpad/mouse) | Windows Chrome | Windows Edge | macOS Safari | macOS Chrome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Join by invite link / room code | Emu (link) | Emu (link) | Emu (typed code, lowercase) | Emu | Emu | Emu (created the room) | Untested | Emu |
| Same maps (patio, plaza, fiesta) | Emu | Emu | Emu | Emu (patio only) | Emu | Emu | Untested | Emu |
| Teams shown, "YOUR TEAM" correct | Emu | Emu | Emu | Emu | Emu | Emu | Untested | Emu |
| Server-scored eliminations by this input | n/a (target) | Emu (touch: 17) | n/a (target) | n/a | Emu (same engine) | Emu (keyboard: 1) | Untested | Emu (same engine) |
| Identical non-zero score, stats and winner on every device | Emu (note 1) | Emu (note 1) | Emu (note 1) | Emu (note 1) | Emu | Emu | Untested | Emu |
| Rematch resets the score, keeps teams | Emu | Emu | Emu | Emu | Emu | Emu | Untested | Emu |
| Touch controls, simultaneous with others | Emu | Emu | Emu | n/a | n/a | n/a | n/a | n/a |
| Keyboard and mouse | n/a | n/a | n/a | Emu (note 2) | Emu | Emu | Untested | Emu |
| Switching touch to mouse and back mid-match | n/a | Untested | Emu | Emu | n/a | n/a | n/a | n/a |
| Audio unlocks on first tap/click, mute mid-match | Emu (note 3) | Emu (note 3) | Emu (note 3) | Emu (note 3) | Emu (note 3) | Emu (note 3) | Untested | Emu (note 3) |
| Rotation (portrait pauses input, landscape resumes) | Emu (generic phone, `e2e:mobile-mp`) | Emu | Untested | n/a | n/a | n/a | n/a | n/a |
| Reconnect after a dropped connection | Emu | Emu (generic phone, `e2e:mobile-mp`) | Untested | Untested | Emu in `mp` tests | Emu in `mp` tests | Untested | Emu in `mp` tests |
| Unexpected zoom: known mechanisms blocked (reported cause unconfirmed) | Emu in `e2e:zoom` | Emu in `e2e:zoom` | Untested | n/a | n/a | n/a | n/a | n/a |

Notes:

1. Patio ended 18-0 with real eliminations; plaza and fiesta are played without the combat phase and end 0-0 (they prove agreement, not scoring). The iPhone and iPad were the targets: they took eliminations and respawned, but did not make any.
2. The emulated iPad got pointer lock only when emulated as a desktop-class browser (as iPadOS Safari reports itself). Real iPadOS pointer lock with a Magic Keyboard or mouse is untested; if it is refused, the game falls back to drag-to-look.
3. "Audio" here means the Web Audio context unlocked and the music engine reported the right state. Nobody listened to it, and Safari's own unlock rules were not exercised.

What this does **not** prove: anything about WebKit (iPhone, iPad and Mac Safari), real touch screens, real GPUs and frame rates, iOS backgrounding and Low Power Mode, Android back-button and browser chrome behaviour, Windows pointer lock and DPI scaling, or real mobile networks. Cross-platform support is **not fully verified** until the device run below and the checklist in [MOBILE.md](MOBILE.md#real-device-checklist) are done on hardware.

WebKit could not even be run in emulation here: the Playwright WebKit download hosts (`cdn.playwright.dev`, `playwright.download.prss.microsoft.com`) are blocked by this environment's network policy. Allowing them would let `e2e:crossdevice` run a WebKit client, which is closer to Safari but still not an iPhone.

Desktop controls (menu, mouse capture, keyboard focus, macOS Cmd key): see [DESKTOP.md](DESKTOP.md), including a 5-minute Mac check. macOS Safari and Chrome are **unverified**; the desktop-input tests ran in Chromium on Linux only.

### Short Mac + iPhone check (about 15 minutes)

Use the preview link on both. Note the build shown at the bottom of Settings, and if anything goes wrong, use **Copy diagnostics** (menu or Settings) before reloading.

1. **Join:** Mac (Safari): Play online, Create room, copy the invite. iPhone (Safari): open the invite from Messages, Join. Both lobbies show two players and each shows its own "YOUR TEAM".
2. **Sound:** tap or click once; both should play music you can actually **hear** (the app reporting audio "running" is not enough). Mute music in Settings on the iPhone; it goes silent.
3. **Combat and score:** start; on the iPhone use the stick, drag to aim, hold Throw. Hit the Mac player until eliminated. Both screens show the same score.
4. **Menu:** iPhone ☰ Menu, open Settings, back, Resume: controls work and nothing keeps moving by itself. On the Mac, Esc and resume three times quickly.
5. **Rotation and zoom:** turn the iPhone to portrait (rotate screen appears, the match continues), back to landscape. Tap Throw quickly ten times and pinch on the controls: the page must not zoom. If it ever zooms, copy diagnostics (it records the zoom level) and send it.
6. **Reconnect:** on the iPhone switch to another app for 10 seconds and back; it rejoins the same team. Turn Wi-Fi off for 5 seconds on the Mac: "Reconnecting…", then back in.
7. **Results and rematch:** play to the end. Both show the same winner and stats. Rematch: same teams, score back to 0-0. Leave: both return to the main menu.

### Four-player mixed-device run on real hardware

1. Desktop (Windows Chrome or Edge): Online, create a room, copy the invite.
2. iPhone (Safari) and Android phone (Chrome): open the invite link from a message. iPad: type the code by hand.
3. Check every screen shows four players, two per team, and its own "YOUR TEAM".
4. Everyone ready; play patio to the end while all four move and throw at once. On the iPad, plug in or pair a mouse halfway through and continue, then touch the screen again.
5. On Android, rotate to portrait and back. On the iPhone, switch to another app for 10 seconds and back; it rejoins the same team.
6. Mute music from the menu on one device. No device plays two songs at once.
7. Compare the results screen across all four: same scores and stats.
8. Rematch, then play plaza and fiesta from the lobby. Everyone leaves; nobody is stuck in a room.
9. Repeat step 1 from a Mac (Safari, then Chrome).

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
