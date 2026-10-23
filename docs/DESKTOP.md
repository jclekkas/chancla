# Desktop controls (Mac and Windows): menu, mouse capture, keyboard

Real-device report from a Mac: movement and aiming sometimes stopped working, and the top-right ☰ Menu button stayed visible while the mouse was captured, where the cursor can't reach it.

## Which build was played

| Site | Branch and commit | Has these fixes |
| --- | --- | --- |
| Production (chanclawarfare.fun, chancla.vercel.app) | `main` at `ca75869` | **No.** It also lacks the phone, zoom, campaign-guidance, freeze and diagnostics work (10 commits behind preview), and it shows no build in Settings. |
| Preview (https://chancla-git-multiplayer-jclekkas.vercel.app) | `multiplayer` | Yes. The build is shown at the **top of Settings** and in the **in-match menu** ("Build abc1234 (preview)"), and in Copy diagnostics. |

If the Mac player was on production, they were on code from before every fix below. Ask them to check Settings: no "Build …" line means production.

## What was found

| # | Finding | How it was established | Status |
| --- | --- | --- | --- |
| 1 | **macOS drops key releases while Cmd is held.** Hold W, press Cmd (Cmd+Tab not completed, a screenshot shortcut, Cmd+R abandoned), release W: the browser never gets W's keyup, so Rosa keeps walking until W is pressed and released again. | Reproduced in Chromium by sending the same key sequence (the macOS behaviour itself is not reproducible on Linux). | **Fixed:** pressing Cmd or Ctrl drops everything held. |
| 2 | **Keys aimed at a hidden form field or button are ignored.** The game ignores keys whose target is a text field (so typing a name never moves Rosa). But macOS Safari does not move focus when a button is clicked, so a name field, a room-code field or a Settings slider can keep focus after Start or Resume. Every W/A/S/D then targets that hidden field and is ignored: movement "stops working" while mouse aiming still works. A focused hidden button is a second form of it: Space (jump) can press it. | Code path confirmed; keys sent from a hidden field were ignored on the old build. Chromium itself moves focus off hidden elements, so the full Safari sequence **was not reproduced**. | **Fixed defensively:** when play starts or resumes, any focus left on a field or button outside the HUD is dropped; in play, a key aimed at a field or button is treated as a game key (its default action is prevented, so nothing is typed or pressed). Menus are unaffected: fields there keep their keys. |
| 3 | **The ☰ Menu button was shown while the mouse was captured**, with the cursor hidden. | Seen in the game. | **Fixed:** while captured, the button is replaced by a "Menu · Esc" label. When the mouse is free (click to aim, drag-to-look, menus) the button returns as "☰ Menu · Esc" and is clickable. Touch devices keep the tappable "Menu" button. |
| 4 | System overlays (Graphics paused, The game stopped, the diagnostics box) did not switch gameplay input off, so keys still moved Rosa behind them. | Code inspection. | **Fixed:** input is live only on the play screen with no menu, rotate screen, zoom notice or system overlay. |

Checked and not broken in Chromium: Escape → Resume ten times in a row; the browser releasing the mouse by itself (menu opens, input cleared, a late Escape does not close it again); switching tabs or apps with keys held; capture refused ("Click to aim", then drag-to-look after repeated refusals, with moving, turning and throwing all working); restarting a match; a campaign stage change; touch detection on a desktop (stays keyboard and mouse).

Not established: whether either of findings 1 and 2 is what the Mac player hit. Both match "controls sometimes stop working" and both are Mac-specific, but neither has been reproduced on a Mac.

## How input works now

- **Live only when playing.** Gameplay input is on only on the play screen with nothing over it. Turning it off releases every held key, mouse button and touch.
- **Released on every interruption:** menu, Escape or P, the browser releasing the mouse, window blur, page hidden, Cmd or Ctrl, rotation, size changes.
- **Escape:** releases the mouse (if the browser hasn't) and opens the menu; P does the same. If the browser releases the mouse first and swallows the key (Safari, Chrome), the lock-change event opens the menu instead, and a late Escape from the same press is ignored, so the menu never opens and closes in one press.
- **Resume** asks for mouse capture from that click. If the browser refuses (Chrome refuses for about a second after Escape), the "Click to aim" prompt stays and the next click tries again; after repeated refusals, drag-to-look takes over (drag to look, F to throw). Controls are never left silently unusable.
- **Diagnostics** (Copy diagnostics) now include an `input` section: mode (mouse captured, not captured, drag-to-look, touch), whether gameplay input is live, pointer-lock state, held inputs, the focused element's kind (tag and input type only, never contents), the menu state, and recent transitions ("mouse captured", "Esc: menu", "released held input (Cmd/Ctrl pressed)", "stale focus on input[range] dropped", …).

## Tests

`scripts/desktop-input-e2e.ts` (`npm run e2e:desktop`), Chromium 141, real page, practice match and a campaign stage change. **21/21** on this build (headless, and again headed under Xvfb); **17/21 on the previous build**, the four failures being findings 1-3 and the diagnostics.

Covers: start after typing a name with a click that leaves focus on the field; keys sent from a hidden focused field; the captured-mouse label; Escape → Resume ten times with W and the mouse button held each time (menu opens with nothing held, Resume is the element under the cursor, then W, S, F and mouse-look all work); Settings slider used then closed and resumed without moving focus; Cmd with W released under it; the browser releasing the mouse plus a late Escape; window blur and page hidden with keys held; capture refused (prompt, then drag-to-look, menu button clickable); restart; campaign stage change; diagnostics content; no page errors.

What it cannot show: Safari's own focus, pointer-lock prompts and banner, and real macOS key events. **macOS Safari and Chrome remain unverified until the check below is done on a Mac.** WebKit could not be run here (its download hosts are blocked in this environment).

## Mac check (about 5 minutes, on the preview)

1. Open Settings: note the "Build …" line at the top. Close.
2. Play online or practice. Type a name first. Start.
3. Click to capture the mouse. Move (W/A/S/D), aim (mouse or trackpad), throw (click or F). Top right shows "Menu · Esc", not a ☰ button.
4. Press Esc: the cursor appears and the menu opens. Open Settings, drag the sensitivity slider, close Settings, click Resume. Move, aim and throw again.
5. Hold W and press Cmd+Tab to another app, then come back: Rosa is not walking on her own, the menu is open. Resume, move, aim, throw.
6. Finish the match, Rematch, move, aim, throw.
7. If anything stops responding: Esc (or P), then Copy diagnostics, and send it.
