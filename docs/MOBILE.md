# Phones and tablets (Touch Beta)

**Status: experimental.** Everything here was built and checked in Chromium's mobile emulation on a Linux container. **No real phone or tablet has run it yet.** Treat touch as a beta until the device checklist below has been done on real hardware.

## What a phone visitor gets

| Mode | On a touch-only device |
| --- | --- |
| **Arcade** | Playable with touch controls (beta). All three maps. |
| Story (campaign) | Labelled "Computer only". It needs a keyboard and mouse. |
| Practice | Labelled "Computer only". |
| Online | Labelled "Computer only" (and no game server is hosted). |

On the main page, a touch-only device sees a card instead of the computer menu:

- **Play Arcade · Touch Beta** opens the Arcade.
- **Full experience on computer** has **Copy link to play on a computer**. It copies the address; if the clipboard is blocked, the link is shown selected so it can be copied by hand.
- **Settings** and the language switch stay available.
- **Show all modes** opens the full menu. A computer-only mode then explains itself with a short message instead of starting.

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

- **No real device has run this.** Touch feel, sensitivity defaults, frame rate, Safari's audio and gesture rules, and the notch layout are unverified on hardware.
- **Only the Arcade plays by touch.** Story, Practice and Online stay computer-only.
- **iOS's silent switch** may keep Web Audio silent. That's the device's choice, and the Enable sound control can't override it.
- **On a small screen, the lowest render scale (0.6) looks soft.** It only drops that far when the phone can't keep up.
