# Phones and tablets (Touch Beta: online, practice, Arcade)

**Status: experimental.** Everything here was built and checked in Chromium's mobile emulation on a Linux container. **No real phone or tablet has run it yet.** Treat touch as a beta until the device checklist below has been done on real hardware.

## What a phone visitor gets

| Mode | On a touch-only device |
| --- | --- |
| **Online** | Playable with touch controls (beta), in the same private rooms as computer players. See [Online multiplayer on a phone](#online-multiplayer-on-a-phone). |
| **Practice** | Playable with the same touch controls, against bots. |
| **Arcade** | Playable with its own touch controls (beta). All three maps. |
| Story (campaign) | Labelled "Computer only". It needs a keyboard and mouse. |

On the main page, a touch-only device sees a card instead of the computer menu:

- **Play online with friends** opens online play: create a room, or join with a code or an invite link.
- **Practice with bots** opens the practice setup.
- **Play Arcade · Touch Beta** opens the Arcade.
- **Full experience on computer** has **Copy link to play on a computer** (for Story). It copies the address; if the clipboard is blocked, the link is shown selected so it can be copied by hand.
- **Settings** and the language switch stay available.
- **Show all modes** opens the full menu. Story then explains itself with a short message instead of starting.

## Online multiplayer on a phone

### How to play with a friend (exact steps)

1. **On the computer** (or another phone): open the site, choose **Play online**, then **Create private room**. Choose the map, and turn on bots if you want them. Then tap **Copy invite link** or **Share invite**, and send the link.
2. **On the phone**: open the link. The **Play online** panel opens with the room code filled in. Type a name (or keep the saved one) and tap **Join**.
3. **In the lobby**: you see **YOUR TEAM: SOL ☀** or **YOUR TEAM: LUNA ☾**. Tap **Switch team** if you want the other side, then **I'm ready**. The host taps **Start match**.
4. **Turn the phone sideways.** Play:
   - left thumb: move
   - right thumb: drag to aim
   - hold **Throw**
   - **Jump**, **Crouch** (tap on and off), **⇄** to switch chancla, **Scores**
5. **☰ Menu** (top right) at any time: **Back to the match**, **Audio & settings**, **Controls**, **Leave match** (asks first). The online match keeps going while the menu is open, and the menu says so.
6. **After the match**: the results show your team and your row. The host can **Rematch**, or go back to the lobby to change the map. **Main menu** leaves.

No keyboard, mouse, fullscreen or pointer lock is needed at any point.

### Touch controls (online and practice)

| Action | Touch |
| --- | --- |
| Move | Left side: put a thumb anywhere and drag. The stick appears under it. |
| Look and aim | Drag on the right side. Dragging on Throw also aims. |
| Throw | Hold the big Throw button. It repeats at the chancla's own rate, as holding the mouse button does. The ring around it fills as the next throw becomes ready. The crosshair ring shows the same. |
| Jump | Jump button (hold) |
| Crouch | Crouch button (tap on, tap off) |
| Switch chancla | ⇄ |
| Scoreboard | Scores (tap to show or hide) |
| Menu | ☰ Menu, top right, always on top of the controls |

- **Independent fingers.** Each control follows its own finger (pointer id). Moving, aiming and throwing work together, and a finger that starts on one control never drives another. A second finger on the stick or the aim area is ignored.
- **Nothing stays held.** A cancelled touch, a finger lost by the browser, the menu, the rotate screen, switching apps, locking the phone and leaving all drop every held input, including Crouch.
- **The tap that resumes play** (Resume or Start) is ignored by the controls.
- **Taps on buttons work while another finger is down.** Browsers don't turn a tap into a click when another finger is on the glass. So on touch, a button acts when one finger goes down and up on it, and the browser's own click that follows is swallowed. Scrolling a menu presses nothing.
- **No page scrolling, zoom, text selection or long-press menus** on the play surface: `touch-action: none`, iOS `gesturestart` and double-tap blocked during play. Menus scroll normally.
- **Back gesture or button** during a match opens the menu instead of leaving the page.
- **Touch aim sensitivity** is its own setting.
- **Which input is active** follows what the player uses, not the device name:
  - a finger on the screen means touch
  - a mouse that moves means mouse and keyboard, with pointer lock as before (a tablet with a trackpad)
  - the keyboard works in either mode
  - only one set of controls is shown at a time

### Unexpected zoom (likely mechanisms fixed; the reported cause is unconfirmed)

**Report:** on a phone, the game sometimes zoomed in and the player couldn't zoom back out.

**Status:** the report has not been reproduced on the affected device. The mechanisms below were each reproduced in Chromium mobile emulation and fixed, and they would explain the report, but which one (if any) the player hit is unknown until it is checked on a real affected phone. Copy diagnostics (in the menu) now records the page zoom (`visualViewport.scale`), so a report taken while it happens would show whether it is browser zoom.

**Mechanisms reproduced** (`scripts/zoom-e2e.ts`; the numbers are from Chromium mobile emulation before the fix):

1. **The trap: zoom couldn't be undone during play.** The play surface blocks pinch gestures, which is right for play. But any zoom picked up before play (a pinch in a menu, or iOS zooming into a text field) stayed, and the pinch that would undo it was blocked. Measured: zoomed to 5× in a menu, then a pinch-out during play left it at 5×.
2. **Pinches that started on HUD pieces zoomed the page:**
   - the ☰ Menu button: 4.85×
   - the open scoreboard: 5×. The scoreboard also blocked aiming.

   These elements had no `touch-action`, and the HUD's "touches pass through" rule didn't cover them.
3. **iOS focus zoom.** iOS Safari zooms the page when a text field under 16 px gets focus.
   - the lobby's invite-link field: 13 px. The copy fallback focuses and selects it.
   - the Arcade's share fallback field: 13 px

   Chromium does not reproduce this; it is checked statically.
4. **Double-tap zoom:** buttons outside the touch controls had no `touch-action: manipulation`.

**Unlikely, by code inspection (not proven on a device):**
- The shooter's camera FOV only changes from the settings slider.
- The Arcade's FOV effects widen the view rather than zoom in: up to 2.4° on a hit, fading within about a quarter of a second, and 4° during La Chancla Legendaria. Both are off with reduced motion.
- The canvas is sized from the stage element, never from a zoomed measurement.

**Fixes:**
- **While the touch controls are live,** the page root carries `html.touch-play`, and `touch-action: none` applies to the page, `#app` and every element inside it. So no element under a finger, or above it, can start a pan or a zoom.
  - The iOS `gesturestart` and double-tap guards apply only in this state.
  - The scoreboard and toasts let touches through.
  - The same applies to the Arcade during a run.
- **Menus keep pinch zoom** (accessibility). The viewport tag has no `user-scalable=no` or `maximum-scale`.
- **Every button** has `touch-action: manipulation`: no double-tap zoom, but pinch works.
- **Every text field and select** is at least 16 px on touch screens.
- **Already zoomed when play starts or resumes:**
  - Online and Practice: play waits behind **"The page is zoomed in: pinch outward"**. Zoom is allowed there, and the notice sits where the zoomed screen is looking. Once the page is back at 1×, play resumes on its own. Online keeps going meanwhile; Practice pauses.
  - Arcade: the run stays on its pause menu with the same message.
  - The game never tries to reset zoom from JavaScript. Browsers don't let pages do that reliably.
- **Sizing:**
  - The renderer compares its stage size every frame, and also on visual-viewport changes, return from the background, rotation, and the keyboard opening or closing. Any change resizes the drawing buffer and camera aspect. `setSize(…, false)` never touches CSS sizes, so there is no feedback loop.
  - After a text field loses focus, the page scrolls back to 0, since iOS can leave it scrolled.
  - The viewport tag adds `interactive-widget=resizes-content`, so Android Chrome's keyboard resizes the layout.
  - Held input is dropped whenever the visible area changes size.

**Verified in emulation:** `scripts/zoom-e2e.ts`, 39 checks, all passing.
- **Static checks**, both pages: the viewport allows zoom, every text field is 16 px or more, every button blocks double-tap zoom.
- **No zoom from pinches** started on:
  - the look area, the move area and the top-left gap
  - across stick and look
  - the menu button, Throw, the HUD score
  - the open scoreboard
- **No zoom from taps:** eight quick Throw taps (they throw, nothing held) and quick Jump taps.
- **No zoom from three fingers at once,** with the canvas and camera still matching the screen.
- **Zoomed in a menu first:** play waits behind the notice, which is on screen at a readable size; pinch-out works and play resumes. The in-match menu still pinch-zooms.
- **Text fields:** focus and blur on both fields leave the page unscrolled and unzoomed.
- **Keyboard:** a viewport going 390 → 220 → 390 tall, and the canvas follows.
- **Sizes:** at six screen sizes (390×844, 844×390, 568×320, 667×375, 932×430, 1024×768) the canvas and camera match the screen, and the menu button is on screen and 44 px or more.
- **Rotation:** rotating mid-touch drops the held finger; rotating while backgrounded is resized on return.
- **The Arcade:** the same pinches and taps, and the zoomed-resume case.

Not reproduced in emulation: iOS Safari's focus zoom and its own gesture handling. Those are in the real-device checklist.

### Orientation

The controls need landscape. In portrait during a match, a **Turn your phone sideways** screen covers the game:
- local input stops, and anything held is dropped
- the online match keeps going, and the screen says so
- practice pauses
- an **Open the menu** button is there, to leave without rotating

Menus, the lobby and results work in portrait.

### Backgrounding and connection

- **Switching apps or locking the phone** opens the menu and drops held input.
- **On return, the connection is checked.** A phone can freeze a page and leave its socket open but dead, with no close event. If nothing has arrived for 6 s, the client treats the link as dropped and uses the existing reconnect: the server holds your slot for 25 s, and you rejoin the same room, slot and team. The same check runs every 2 s while connected.
- **While reconnecting,** the HUD shows "Reconnecting…".
- **If the room is gone** (too long away, server restart), the "Disconnected" screen explains it and offers **Try again** or the main menu.
- **Nothing is promised in the background:** mobile browsers can suspend a backgrounded page and its connection at any time.

### Team clarity

- **"YOUR TEAM: SOL ☀" / "YOUR TEAM: LUNA ☾"** shows the team's name, icon and colour together, never colour alone:
  - in the lobby (with your team's box outlined)
  - in the match HUD, all the time
  - in the spawn banner
  - on the results screen (with your row marked)
- **Teammates and opponents** carry ALLY and ENEMY tags under the existing visibility rules (only when in view, never through walls).

### Fairness

- **Same server, same rules.** Phones and computers join the same rooms, under the same authoritative simulation.
- **No mobile advantages.** There are no client-side hits, no damage bonus and no aim assist.
- **No server or protocol change.** A phone sends exactly the inputs a keyboard and mouse do.
- **Aim assist:** not added. If testing on real phones shows touch players can't compete, a bounded proposal belongs in a separate change: a small, visible, opt-in slowdown of aim near a target, never automatic hits.

### Graphics

- **Settings → Graphics quality** now has **Auto** (the default for new players), Low, Medium and High.
- **Auto:**
  - Low on phones, mouse-less tablets and low-core devices: no shadows, no antialiasing, render resolution capped at 1× the screen's CSS pixels
  - Medium elsewhere
- A saved choice is kept. Reduced motion is respected (no camera shake).

Measured by `scripts/perf-mobile-mp.ts` (`docs/evidence/mobile-mp/perf.json`): a practice match at 844×390 with DPR 3, in headless Chromium with **SwiftShader software rendering, not a phone**.

| Map | Auto (Low, 0.33 MP per frame) | Medium (0.74 MP per frame, shadows) |
| --- | --- | --- |
| El Patio | 11.3 fps | 10.5 fps |
| La Plaza | 11.8 fps | 10.8 fps |
| La Fiesta | 13.8 fps | 10.2 fps |

- **What carries over to a phone:** Auto draws less than half the pixels and has no shadow pass.
- **What doesn't:** the frame rate here is limited by a CPU rasterizer on a 4-core Xeon.
- **The 30 fps target (60 where practical) on a midrange phone is unverified** until someone runs it with Settings → Show stats.

### How "touch-only" is decided

The game looks at what the device can do, not at its name (no user-agent sniffing):

- A device is touch-only when it has touch and **no fine pointer and no hover** (`any-pointer: fine`, `any-hover: hover`).
- A tablet with a trackpad or mouse, or a touch-screen laptop, gets the computer menu.
- If a mouse moves or a physical key is pressed later (a tablet keyboard case), the page switches to the computer menu on the spot.

Code: `src/ui/device.ts`.

## Touch controls (Arcade)

| Action | Touch |
| --- | --- |
| Move | Left side: put a thumb anywhere and drag (the stick appears under it) |
| Aim | Drag on the right side. Dragging on the throw button also aims. |
| Throw | Big chancla button: tap for a quick throw, hold to charge, release to throw |
| Recall | ↩ button |
| La Chancla Legendaria | ★ button (when the meter is full) |
| Pause | ❚❚ Pause, top right, always visible |

- **Fingers are independent.** Each control follows its own pointer id, so moving, aiming and throwing work at the same time.
- **Touch aim sensitivity** is its own setting (Settings → Touch aim sensitivity), separate from mouse sensitivity.
- **No pointer lock** is needed or requested on touch.
- **Nothing scrolls, zooms or selects** during play.
- **Sizes:** every touch target is at least 44 px. Throw is the largest at 104 px on an 844×390 screen. The controls sit inside the safe areas (notch, home bar).

### Interruptions

- **Held input is dropped, not fired**, when the browser cancels a touch, the window loses focus, the screen rotates, the game pauses or the run ends. A held throw is cancelled.
- **Pause** stops the simulation: enemies, damage, timers and Rosa's momentum. The pause menu has Resume, Restart, Settings, Change map and Main menu.
- **Switching apps or locking the phone** pauses the run. It stays paused until you tap Resume.
- **The tap on Resume** is ignored by the controls, so it can't move Rosa or throw.
- **Landscape is preferred.** Turning to portrait during a run pauses it and shows a "Turn your phone" screen. Back in landscape, the run waits for Resume.

### Unchanged

- **Audio:** the Enable sound control, mute (kept across reloads), and music loading and retry.
- **Maps:** the same map choice, Random, and the remembered map. Restart keeps the map.
- **The campaign** and its progression.
- **Keyboard and mouse:** on a computer, nothing changes.

## Performance

### What changed for touch devices

- **Starting quality.** Touch-only devices start on the "low" preset: render resolution capped at 1× (not the screen's 3×), no shadows, half the particles. Desktop defaults are unchanged ("medium").
- **Adaptive resolution (touch only).** Every 3 s during play, the render scale steps down by 0.15 (to a floor of 0.6) while the frame rate is under 40 fps. It steps back up by 0.1 when it's over 56 fps. A new quality choice starts again at full scale. Desktop never uses this.
- **No freeze when a run starts.** La Plaza and La Fiesta used to freeze for 2-3 s on their first frame while shaders compiled. The map is now built and compiled while the Start button shows it's loading. The in-run freeze on La Plaza went from 2.4 s to 0.3 s in the measurement below.
- **Lazy loading.** Maps still load only when chosen, and switching maps disposes the old one.

### Measurements

`scripts/perf-mobile.ts` ran the Arcade for 12 s after a warm-up, at 844×390 landscape with touch emulation and a device pixel ratio of 3.

The machine was this container: an Intel Xeon at 2.1 GHz with 4 cores, running Chromium 141 headless with **SwiftShader (software rendering on the CPU)**.

**These are not phone numbers.** A phone's GPU behaves very differently. The draw calls, triangles and pixels per frame do carry over.

| Map | Quality | Before: fps | After: fps (render scale) | Pixels per frame (after) | Draw calls | Triangles |
| --- | --- | --- | --- | --- | --- | --- |
| El Patio | low | 21.3 | 29.3 (0.6) | 0.12 MP | 162 | 23k |
| La Plaza | low | 13.5 | 21.1 (0.6) | 0.12 MP | 98 | 30k |
| La Fiesta | low | 15.5 | 25.2 (0.6) | 0.12 MP | 129 | 26k |
| El Patio | medium | 8.3 | 12.3 (0.6) | 0.27 MP | 195 | 27k |
| La Plaza | medium | 5.1 | 7.8 (0.6) | 0.27 MP | 195 | 35k |
| La Fiesta | medium | 5.7 | 8.8 (0.6) | 0.27 MP | 217 | 32k |

Raw data: `docs/evidence/mobile/perf-before.json` and `perf-after.json`.

- **The scale fell to its floor here** because a CPU rasterizer is slow. On a real phone it should settle higher. Nobody has watched it do that yet.
- **La Plaza and La Fiesta still cost more than El Patio.** They have about 30% more triangles (instanced roof tiles, trims, awnings) and use the shooter's toon materials. On a phone GPU, 25-35k triangles and about 100-200 draw calls per frame is a light load, so they were not cut back blind. If a real device struggles there, that's the first place to look.

## Verification (emulation)

For the four-device mixed match (emulated iPhone, Android, iPad and desktop in one room) and the per-device compatibility matrix, see [COMPATIBILITY.md](COMPATIBILITY.md#cross-device-multiplayer-matrix).

### Online and practice (shooter)

**`scripts/mobile-mp-e2e.ts`: 43 checks, all passing.**

- **Setup:** one emulated phone and one desktop client, each in its own Chromium (headless), in the same private room on a **local** game server started by the script. The production server was not used.
  - The phone runs at 844×390 (390×844 for the rotation check), with touch and DPR 2. Its input is only taps and multi-touch over the DevTools protocol.
  - The desktop uses keyboard, mouse and pointer lock.
- **It covers:**
  - an invalid invite (clear message, with Back)
  - opening the real invite, typing a name, Join (which also unlocks audio)
  - "YOUR TEAM" in the lobby, and switching team twice
  - Copy invite, Settings from the lobby (music set to 0), Ready
  - **one match per map: El Patio, La Plaza, La Fiesta**, the second with bots on. On each map:
    - touch controls shown, with no "click to aim" and no pointer lock on the phone
    - "YOUR TEAM" in the HUD with its colour
    - the phone moving, aiming and throwing at the same time with three fingers, and nothing held afterwards
    - the desktop moving and throwing in the same match
  - **the menu:** ☰ opens it, input stops, Resume / Audio & settings / Controls / Leave match are there, it says the online match continues, the clock keeps running, and Resume comes back cleanly
  - **the controls help** shows the touch list
  - **portrait:** the rotate screen, input stopped, nothing held; back to landscape
  - **backgrounding:** the menu opens and nothing stays held
  - **a dropped connection:** "Reconnecting", then back in the same match and team
  - **audio:** the saved zero music level holds, with no overlapping songs
  - **results:** your team and your row, music still muted
  - **rematch** straight back into touch play
  - **back to the lobby**, change map, start again
  - **leaving mid-match:** asks first, then returns to the main menu, and the desktop sees the phone go
  - no page errors on either client
- `tests/fps-touch.test.ts` (11) covers the touch layer in isolation:
  - three fingers at once
  - lifting one finger
  - second fingers ignored
  - Throw not stealing the aim finger
  - cancel and lost capture
  - release on a menu, blur or hidden page (crouch included)
  - disabled input
  - the resume tap ignored
  - taps for switching chancla and the scoreboard
  - the cooldown ring
  - the keyboard alongside touch
- `tests/mp-mobile-net.test.ts` (2), against the real server: a connection that goes silent without closing (a frozen phone tab) is noticed and rejoins the same room, slot and team; and the on-return check does nothing on a healthy connection.

Screenshots in `docs/evidence/mobile-mp/`: the invite, the lobby, the match, the menu, the portrait rotate screen, results.

**`scripts/touch-e2e.ts`: 35 checks, all passing.** It runs Chromium mobile emulation at 844×390 landscape and 390×844 portrait, with touch and DPR 2. Touches are real multi-touch sent over the DevTools protocol, with a separate id per finger. It covers:

- **Main page on a phone:** the card, no sideways scroll, the copy-link button copying the address, a computer-only mode explaining itself, and the Touch Beta link.
- **Tablet with a trackpad:** gets the full menu. Emulation always reports a coarse pointer, so the fine-pointer answer is simulated.
- **Sound:** Enable sound on a phone.
- **Controls:** sizes and placement, clear of the HUD.
- **Three fingers at once:** move, aim, and hold and release a throw.
- **Interruptions:**
  - a cancelled touch leaves nothing held
  - the Pause button freezes the run
  - Resume by tap doesn't move or throw
  - an app switch leaves the run paused
  - portrait pauses it with the rotate screen, and a finger held through the rotation is dropped
- **Menus:** Restart keeps the map, Settings has touch sensitivity, Change map.
- **Each of the three maps:** touch movement stays in the arena and out of the scenery, and enemies arrive and move.
- **Leaks:** after several runs and map switches, one game loop, one audio context and bounded listeners.
- **Exits:** Main menu returns to the phone card.
- **Errors:** none on the page.
- **Mute:** a saved mute survives a reload.

`--round` (36 checks with it, all passing) also plays one complete round by touch on La Fiesta and checks that it ends on the results screen. The scripted thumb only circles and throws, so that run ended in a defeat at 0:47. It shows the round finishing by touch, not that the game is winnable this way. Winnability is covered by the Arcade balance bot in `tests/arcade-maps.test.ts`.

Screenshots in `docs/evidence/mobile/`:

- the main page, in portrait and landscape
- the Arcade title, the map choice and play
- the pause menu and Settings
- the portrait rotate screen
- La Fiesta
- the results screen after the touch round

## Real-device checklist

**Online on a phone (iPhone Safari and Android Chrome), with a friend on a computer.** Nothing below has been done on real devices yet.

- [ ] Zoom: during play, double-tap Throw quickly ten times, pinch with both thumbs while moving and aiming, and pinch starting on ☰ Menu and on the scoreboard. The page must not zoom.
- [ ] Zoom (iPhone): tap the name field, the room-code field and, in the lobby, the invite link. The page must not zoom. Dismiss the keyboard: the game must not stay shifted or cropped.
- [ ] Zoom: pinch to zoom in on the main menu, then start a match. The "page is zoomed in" notice must appear on screen; pinching out must bring the game back.

- [ ] The computer creates a room and shares the invite (Share or Copy). Open it on the phone: the room code is filled in. Type a name with the on-screen keyboard; the panel stays usable with the keyboard open. Join.
- [ ] Lobby: "YOUR TEAM" shows, Switch team works, I'm ready works. The host picks a map and turns bots on. Start.
- [ ] Sideways: move with the left thumb, aim with the right, hold Throw with a third finger or by sliding the aim thumb onto it. All at once, with nothing stuck after lifting.
- [ ] No page zoom, scroll, text selection or long-press menu during play. The Back gesture opens the menu.
- [ ] ☰ Menu while the movement thumb is still down: it opens. Resume. Leave match asks first.
- [ ] Turn to portrait mid-match: the rotate screen. Back: play continues.
- [ ] Lock the phone for 10 s, then unlock: the menu is open and the match is still on, or it reconnects. For 40 s: "Disconnected" with a way back.
- [ ] Sound: Join or Ready starts it; "Tap to enable sound" appears if the browser wants another tap. Mute in Audio & settings stays muted through the match, results and rematch.
- [ ] Finish a match, Rematch, then leave from results.
- [ ] Frame rate: Settings → Show stats. Note the fps on each map, and whether the phone gets hot.

Nothing below has been done yet. Please test on at least an iPhone (Safari) and an Android phone (Chrome), plus one desktop Chrome and one desktop Safari to confirm nothing changed there.

**iPhone, Safari**

- [ ] The main page shows the phone card, and no computer menu behind it. "Copy link" copies, or shows the link to copy by hand.
- [ ] Play Arcade · Touch Beta. Tap Enable sound: you hear the title music. Then mute, reload, and check it's still muted.
- [ ] Landscape: the controls sit clear of the notch and the home bar. Nothing on the HUD overlaps.
- [ ] Move with the left thumb while dragging the right thumb to aim. Hold Throw with a third finger and release it: one throw.
- [ ] No page scroll, zoom (double-tap or pinch), text selection or callout menu while playing.
- [ ] Rotate to portrait mid-run: "Turn your phone" and the run is paused. Rotate back, tap Resume: no step, no throw.
- [ ] Swipe home or lock the phone during a run, then come back: the run is paused and the music resumes on Resume.
- [ ] Pause, then Restart (same map), Change map (asks first), and Main menu (back to the phone card).
- [ ] Play a full round on each map. Note whether it ever feels slow, and where. Settings → Show frame rate shows the number.
- [ ] Turn on the silent switch: say whether you expected sound.

**Android, Chrome:** the same list. Also:

- [ ] The back gesture during a run.
- [ ] Split screen: it should pause in portrait-shaped windows.
- [ ] A low-end phone, if one is around.

**Tablet**

- [ ] iPad without a keyboard: the phone card, and the Arcade with touch.
- [ ] iPad with a trackpad or Magic Keyboard: the full computer menu. Moving the trackpad on the phone card switches to it.

**Desktop Chrome and Safari:** nothing should have changed.

- [ ] The full menu, with no phone card.
- [ ] The Arcade with mouse and keyboard.
- [ ] Esc pauses.
- [ ] The Practice and campaign start.

## Known limitations

- **Online touch play has not been tried on a real phone or with a real person.** Touch feel, the default aim sensitivity, the button layout for different hand sizes, iOS Safari's audio rules, and battery and heat are all unverified.
- **Story stays computer only.**
- **Touch players have no aim assist.** Whether that is fair against mouse players needs real matches; see Fairness above.
- **Background connectivity isn't guaranteed.** A phone that locks for more than about 25 s loses its slot in the room.

- **No real device has run this.** Touch feel, sensitivity defaults, frame rate, Safari's audio and gesture rules, and the notch layout are unverified on hardware.
- **Only the Arcade plays by touch.** Story, Practice and Online stay computer-only.
- **iOS's silent switch** may keep Web Audio silent. That's the device's choice, and the Enable sound control can't override it.
- **On a small screen, the lowest render scale (0.6) looks soft.** It only drops that far when the phone can't keep up.
