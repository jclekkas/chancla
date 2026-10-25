# Motion polish, minimap and cafecito clarity

Offline preview only. Campaign and Arcade are unchanged. Gameplay rules, timing, hitboxes and reach
are unchanged; the one gameplay-adjacent fix is a dropped brief press in Classic (below).

## What changed

### Rosa in motion (third person)
- **Face.** She blinks every 2 to 5 s, each Rosa on her own timing. Her brows knit on a wind-up
  and briefly on a throw. Hit, she squeezes her eyes shut; down, she looks dazed. This uses the
  existing face vertices through one shader uniform per avatar, so there are no extra draw calls.
  It reads clearly in close-ups and the killcam, and only faintly at 4 m.
- **Skirt.**
  - The hem trails behind a run or strafe, swings on past a stop, and swishes a beat behind
    the hips.
  - The old sway had the wrong sign: the hem led the motion. That is fixed.
  - Low quality keeps only the trailing, without the swish.
- **Fewer pops.**
  - The hips rise at most 1.6 m/s when a foot leaves a long reach.
  - A swinging leg is speed-limited, so the knee no longer folds in one frame.
  - She leans further forward at a run.
- **Frame-rate independent** (tested at 30, 60 and 144 fps).
- **Clean resets** on respawn and teleport. A pooled killcam avatar is reset before each replay,
  so nothing carries over from live play.
- **Unchanged:** attack poses at contact (pose sheets compared), and foot slip (0.3 cm/s against
  0.2 when walking).

### First-person hand
- **Weapon switch.** The chancla in hand lowers, swaps out of sight and the other rises.
  Before, the new chancla popped in at full height. Switching back halfway raises the same one.
- **Movement.** Walk bob and idle breathing crossfade. Landing is an eased dip instead of a
  one-frame 3 cm drop, and crouch is smoothed.
- **Attacks.** An attack cut short by another fades out over about 70 ms instead of snapping.
- **Look lag.** The hand trails a turn by at most 1.6 cm. It is off with reduced motion.
- **Grip.** La Pesada's fingers now hook round the heel, and the wrist runs on in the forearm's line.
- **Unchanged:**
  - Both melee swings: 0.000 mm difference from the old code.
  - The La Pesada throw: 0.000 mm. The La Chancla throw: within 0.09 mm.
  - Bob size.
  - No camera shake or blur.

### Minimap (Practice and Online, Classic and ¡Puro Chanclazo!)
- **What it is.** A compact, fixed-orientation map, top left on desktop and under the health bar
  on touch. North is -z, so Casa Sol is on the left.
- **Built from map data.** It is drawn from each map's own geometry, never by hand. Walls, low
  cover, raised floors and overhead geometry are each drawn differently.
- **What it shows.**
  - You: an arrow in your team colour, pointing where you face.
  - Living teammates: dots.
  - Cafecitos: ready or recharging.
  - Never an opponent. Markers are built from your team only, and a check confirms opponents
    never appear.
- **Expanded view.** Menu > Map, with the map name and a legend. Practice stays paused and online
  keeps going, as the menu always has. On touch, a tap on the compact map opens it. The tap is
  consumed: no attack, no turn.
- **Hidden** while you are down and during the replay; it returns on respawn.
- **Option:** Settings > Show minimap.
- **Drawing.** A cached 2D canvas, with markers redrawn at about 15 Hz only while it shows. No 3D
  pass.

### Cafecito clarity
- **The mechanic is unchanged:** walk over it while hurt, it heals up to 35, it is not used at full
  health, and it returns after 20 s.
- **The hint.** It names the nearest cup within 8 m that is in front and in plain sight. It never
  shows through walls or during a replay. It keeps off the crosshair and name tags.
  - "Cafecito · Walk over to heal" / "Cafecito · Acércate para recuperar salud"
  - "Health full" / "Salud completa"
  - "Cafecito · Back soon" while recharging.
- **The cup itself.** When recharging, the cup is gone, the saucer greys and a ring fills as it
  comes back.
- **Feedback.** "+{n} health" uses the amount actually restored, which the server now sends with
  the pickup. +20 from 80 is tested. It is shown once, even across a reconnect: the session drops
  duplicate pickup events.
- **Help.** One line in Controls explains the cafecito.

### Input reliability (the intermittent Classic throw)
- **A genuine gap, fixed.** A press that went down and up between two input samples (a quick
  click on a slow frame) never reached the game in Classic. The press is now latched and counts as
  one tick of fire. Cooldowns and buffering are unchanged. `tests/input-brief-press.test.ts`
  fails without the fix and passes with it. It also checks the legal refusal during cooldown and
  that a press never makes two throws.
- **Harness effect, not a fault.** At High under SwiftShader (about 10 fps) the client simulates
  at most six ticks per frame. So presses a second apart on the clock can land inside one cooldown
  in game time, and the server refuses them legally. The browser check now classifies each press
  as accepted, legally refused, or lost. In the final run all 4 were accepted, with none refused
  and none lost.

## Cost

These are exact renderer counts per whole frame (scene and hand passes), averaged over about 32
frames, in 10 matched views (`costs-before.json` and `costs-after.json` in the review ZIP):

| | Before (e9261f4) | After | Delta |
|---|---|---|---|
| Draw calls | 81 to 130 | 83 to 132 | +2 in every view (the cafecito recharge rings) |
| Triangles | 46.7k to 132.9k | 46.9k to 133.1k | +160 |
| Textures | 20 to 28 | 20 to 28 | 0 |
| Geometries | 93 to 98 | 93 to 101 | 0 to +3 |

- **Per avatar:** 18 draw calls on High, 16 on Low, unchanged.
- **Hand pass:** 8 draw calls with La Chancla, 7 with La Pesada, unchanged.
- **Minimap memory:** one compact canvas plus its cached layer, about 80 KB each; about 2 MB while
  the expanded map is open.
- **Download:** +9.0 KB gzipped JavaScript (428.4 to 437.4 KB) and +0.5 KB CSS.
- **CPU:**
  - Animator update: about 3.7 µs per avatar per frame, against 3.4 before (Node).
  - `vm.update`: about 4 to 5 µs per call, against 2.3 before.
  - Minimap: one cached-layer copy plus a few paths at about 15 Hz.
  - Frame times here are software rendering and are not evidence for any device.

## Checks

- Typecheck and builds pass.
- Unit and multiplayer: 492 of 492. The real-server multiplayer tests cover rematch, reconnect and
  melee-only. New test files:
  - `tests/minimap.test.ts` and `tests/cafecito.test.ts`
  - `tests/rosa-motion-quality.test.ts` and `tests/viewmodel-motion.test.ts`
  - `tests/input-brief-press.test.ts`
- **Browser, `scripts/minimap-e2e.ts`:** desktop 14/14 and phone 4/4. It covers:
  - the minimap on all three maps;
  - your marker matching the session, teammates only;
  - the expanded map with practice paused;
  - the hide option;
  - the cafecito walk, +20 health, recharging and Health full states;
  - no hint behind a wall;
  - brief presses;
  - no map or hint while down or in the replay, and back on respawn;
  - the phone layout clear of every control, in both rulesets;
  - tap to open, with no attack and no turn.
- **Matched stills:** `scripts/milestone-shots.ts` on the baseline and this build, five scenes, at
  desktop High and phone Low.

All of this ran in Linux Chromium with SwiftShader. The phone was emulated. Nothing was run on a
real Mac, in Safari, or on a real phone.

## Limits

- Facial expression barely reads at the normal 4 m play distance.
- No mouth motion, no rebozo or hat secondary motion (they are baked into the torso and head
  meshes), and no ruleros jiggle.
- At 30 fps a run step can land up to a frame apart, about 0.02 rad on average.
- La Pesada's grip is still simple capsules. The empty hand after a heavy throw does not close
  into a fist.
- The compact map shows the whole arena; it does not scroll. Height is not shown: a terrace and
  the floor below share a spot.
- In the fake-clock stills and clips the spawn banner can linger longer than in play. The
  baseline build behaves the same in this harness.

## Mac and phone checklist

1. **Practice on El Patio:**
   - The minimap is top left and your arrow turns with you.
   - Your teammate's dot shows, and no opponent ever does.
2. **Esc > Map:** the expanded map with its legend; practice is paused. Back, then Resume.
3. **Hurt (take a hit), walk toward a cup:**
   - "Cafecito · Walk over to heal".
   - On it: +N health with the real amount, and the cup greys and refills.
   - At full health: "Health full", and the cup stays.
4. **Settings > Show minimap off:** it hides. On: it returns.
5. **Get eliminated:** no map and no hint during the replay; the map is back on respawn.
6. **Quick trackpad taps (Classic):** each one throws unless the chancla is still cooling.
7. **Rosa up close:** she blinks, her brows knit on a wind-up, and her skirt trails and swings.
8. **Press 1/2:** the hand lowers, swaps and rises, with no pop.
9. **Phone in landscape:**
   - The minimap sits under the health bar, clear of the stick, aim, jump, attack and Menu.
   - A tap opens the map without attacking.
