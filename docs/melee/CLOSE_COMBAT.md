# Close combat: El Chanclazo and El Revés (experiment)

An isolated gameplay experiment on branch `codex/close-combat`. It is built on the graphics work (`codex/graphics-polish` at 469c5c5). Production is out of scope:

- Do not merge to main, promote a deployment, change production settings or domains, or modify the Render service without the owner's explicit approval.
- The hosted preview of this branch is **offline-only**. `vite.config.ts` treats `codex/close-combat` like the graphics branches:
  - a `connect-src 'self'` policy;
  - no production server address in the bundle.
- The protocol is version 5 and does not match production's server (version 4).

## What it is

- **One melee input:** V on a keyboard, or one touch button. The chancla in hand picks the attack.
- **Throwing:** unchanged.
- **The sandal:** both attacks use the sandal in her hand, and it never leaves her hand during a swing.

| | El Chanclazo (La Chancla) | El Revés (La Pesada) |
| --- | --- | --- |
| Motion | quick forehand slap from her right, across the face | arm drawn across the chest and shoulder turned, then a big backhand out to her right |
| Damage | 25 | 45 |
| Wind-up (no contact yet) | 120 ms | 300 ms |
| Contact window | 120-190 ms | 300-390 ms |
| Full cycle (nothing else can start) | 700 ms | 1,100 ms |
| Extra recovery after a miss | none | +300 ms (the opening a miss gives away) |
| Knockback | 1.2 m/s | 2.8 m/s |
| Reach | 1.5 m from her eye to the target's body | same |
| Sweep | 43° either side of where she looks (plus the target's own width) | 52° |
| Head hit | no extra damage; a different sound and hit marker | knocks a rulero off (see below) |

**Tuning:** every value is in `shared/config.ts` (`MELEE`, `MELEE_BUFFER_MS`, `MELEE_REWIND_MAX_MS`, `RULEROS`, and bots' `brawlChance`). They are starting points for playtesting, not final balance.

## Rules (the same code for offline practice and the local server)

Clients only ask for a swing. The authoritative simulation (`shared/sim.ts`, contact test in `shared/melee.ts`) decides validity, contact, damage, head hits, ruleros and eliminations.

- **Contact:**
  - During the contact window, a target is hit when some point of her body is within reach, inside the sweep, at a height the swing passes, and in plain sight.
  - The swing height is the view ray's height at the target, clamped onto her body, at most 0.3 m above or below it.
  - Walls and boxes between the eye and the contact point block the hit. Swinging over a low crate is fine.
- **One target, once:** the first contact ends the swing. If two are in reach, it hits the one nearest the view direction.
- **Head or body:** read from where the swing meets the body, against her real head position: stance, crouch and jump included.
  - Aiming level at a standing Rosa's face is a head hit.
  - Over a crouching Rosa's head is a miss.
  - At eye level, a jumping Rosa is hit in the body.
  - A precise face hit is never needed for ordinary damage.
- **Wind-up:** a target that steps out of reach during the wind-up is not hit, and the swing counts as a miss.
- **Team and spawn rules (as with throws):**
  - no damage to teammates or eliminated players;
  - a spawn-protected target is shielded and takes no damage;
  - swinging ends your own protection.
- **No pushing the player around:** no lunge, no forced camera turn, no stun. The knockback is the same kind as a throw's, and smaller.
- **Recovery:** nothing starts before a cycle ends.
  - **No overlap:** no throw, no second swing and no weapon switch during a swing; a switch asked for meanwhile happens when the swing ends.
  - **Simultaneous presses:** a melee press together with a held throw swings first.
  - **Buffer:** a press within 150 ms of the end of a recovery is kept and starts the swing as soon as it can.
- **A press, not a hold:** the client sends melee on one input only. Holding V never repeats, key repeat is ignored, and menus, typing fields and lost focus drop a pending press.
- **Latency:** contact is judged against where targets were when the attacker saw them. The room tells the sim each player's view delay (interpolation 110 ms plus half the round trip), capped at 200 ms. Walls are always checked as they are now.
- **Bots:** they use the same input queue and rules. Some decide, per opponent, to close in with a chosen chancla and swing at arm's length, aiming at the face about half the time.

## The rulero reaction

- **The ruleros:** every match Rosa now wears four ruleros:
  - Team Sol's peek out under the hat brim;
  - Team Luna's peek out at the front of the rebozo.

  The campaign's "home" curlers are untouched.
- **A Revés head hit:** a confirmed El Revés **head hit** knocks off one roller that is still attached, from its real position. The sequence:
  - a deep rubbery ¡PAF!;
  - a quick head and upper-body flinch on the recipient;
  - the roller spins out, bounces once or twice on the paving and shrinks away (about 1.6 s).
- **Elimination:** an elimination by an El Revés head hit scatters up to three of the rest.
- **Limits:**
  - only rollers still attached can come off, so an empty head gives nothing;
  - respawn and a new match restore all four.
- **Shared state:** the server's snapshot carries each Rosa's roller state, so every client and a reconnecting one show the same hair.
- **No repeats:** every melee outcome carries its swing id, and the client drops a repeated one (`duplicatesDropped`).
- **Timing on screen:**
  - your own hits, and hits on you, play when the server's result arrives;
  - hits between others wait for the delayed render timeline, so they line up with the swing you see.
- **Your own head:** if it is your roller, it pops up and out past the edge of your view, never across the crosshair.
- **Cosmetic only:** no damage, no pickup, no collision, no navigation change, no campaign credit.
- **Effects:** a pool of 12 small meshes with hand-rolled motion and no physics engine; the oldest is reused when more are needed.
- **Low quality:** one signature roller per hit with simpler motion (no bounce, shorter life), and no extra elimination debris.
- **Reduced motion:** the flinch, the camera shake and the first-person swing are smaller, and rollers take the simple Low flight.
- **Voice line:**
  - "¡Con los ruleros no!" ("Not the rollers!") is new, as a **placeholder TTS clip** (`public/voice/rulero1.mp3`, SVOX Pico, same treatment as the rest of the pack) with subtitles.
  - It shares a pool with the existing "Mi peinado no." clip.
  - It plays sometimes, at most once every 15 s, and only for the Rosa who lost the roller.
  - It obeys the banter and subtitle settings.

## Sound and animation
- **Sounds:** all synthesized at play time like the rest of the game's effects (no samples, nothing bought or copied):
  - El Chanclazo: a quick swish and a sharp rubber slap;
  - El Revés: a longer, lower swish and the deep ¡PAF!;
  - a small pop when a roller flies.
- **Your swing:** the first-person swing and its swish are predicted, so they start at once.
- **Confirmed results:** hit sounds, hit markers, damage numbers, the flinch and the rulero come only from the server's result.
- **Third person:** the swing uses the attacker's own clock (`msSinceMelee` in the snapshot), so it lines up with the delayed timeline.
- **Unchanged:** no global slow motion, and no pause of a multiplayer match.

## Controls
- **Desktop:** V. The shooter had no remapping system, and V was unused (W A S D, the arrows, Space, C, Shift, F, E, 1, 2, Q, P, Tab and Esc are taken). Throwing and the menu are unchanged.
- **Touch:**
  - **The button:** one 62 px melee button at the top of the right-hand arc, clear of Throw, Jump, Crouch and Switch, inside the safe areas.
  - **Label:** it says **Chanclazo** or **Revés** for the chancla in hand, and dims while recovering.
  - **One tap, one swing:** it does not capture the finger, so stick, look, throw and jump keep working at the same time.
  - **Campaign:** the button is hidden there.
- **Explanations (English and Spanish):**
  - the controls screen has a row for each layout and a short paragraph;
  - practice shows one line at the first spawn;
  - each weapon slot names its melee attack ("V · Chanclazo") so throwing and melee read as different things;
  - the kill feed names a melee elimination.

## How to try it
1. Open the offline preview, then choose **Practice** and start on El Patio.
2. Walk up to a bot. With **La Chancla** (1) press **V**: El Chanclazo.
3. Press **2** for **La Pesada**, aim at her face and press **V**: El Revés, and a rulero flies.
4. Miss on purpose (too far away) and feel the longer recovery.
5. On a phone, the melee button sits above Crouch. Try it while moving and aiming.

## Evidence
- **Gameplay clip:** `melee-footage.mp4` (10 s). It shows:
  - El Chanclazo hitting;
  - a miss;
  - El Revés to the face with a flying rulero;
  - an elimination with the rest scattering;
  - both attacks in third person between two bots.

  It is offline practice with the scenes staged on the practice host (positions and health). Every swing, hit, roller and elimination in it is the game's own. It was captured on a fake clock at 30 frames per second, with software rendering.
- **Contact sheet:** `melee-footage-sheet.jpg`.
- **Phone:** `phone-melee.png` (emulated phone, Low).
- **Renderer counts:** `melee-cost.json`.
- **Check results:** `melee-e2e.json`.

## Rendering cost (exact counts, three Rosas in view, `melee-cost.json`)
| | High | Low |
| --- | --- | --- |
| Ruleros on the characters (2 instanced draws per Rosa) | +6 calls, +960 triangles | +6 calls, +960 triangles |
| Rollers in flight, at the pool's cap of 12 | +24 calls, +960 triangles | +24 calls, +960 triangles |
| Swing animations | no change (poses only) | no change |

- **In flight:** a real El Revés elimination has at most 4 rollers in flight on High for about 1.6 s, and 1 on Low.
- **Shadows:** the character rollers cast no shadow.
- **Not timings:** these are counts on a software renderer, not device performance.

## Checks
| Check | Where | Result |
| --- | --- | --- |
| Melee rules: both attacks, reach, facing, walls, wind-up dodge, one target once, head or body standing/crouching/jumping, team, protection, eliminated, spam, switch lock, held press, buffer, frame-rate independence, ruleros (one per head hit, depletion, scatter, respawn, rematch) | `tests/melee.test.ts`, Node | 19/19 |
| Three real clients against the real server process, through 120-180 ms simulated round trips: same hits, damage, head hits, ruleros and elimination everywhere; every snapshot resent to one client; that client's reconnect; respawn restoring the hairstyle | `tests/mp-melee.test.ts`, local server | pass (3 of 3 runs) |
| Desktop page: both attacks, a miss, held V, V with the menu open, the sandal staying in hand, rulero state on screen, effect expiry, kill feed, respawn, no duplicates | `scripts/melee-e2e.ts`, Chromium | 21/21 |
| Phone page (emulated, real multi-touch): one tap one swing while moving and aiming, throw and jump together, button label follows the weapon, no zoom or scroll | same | 8/8 |
| Bots use both attacks and connect, in an ordinary practice match | same | pass |

Results of the full regression sweep are in the PR description.

## Known limitations
- **Not playtested on real devices:** the values are starting points, and the feel of reach, timing and the rewind needs Mac and phone playtesting.
- **Rewind:** it uses the client's reported round trip; a lying client could stretch it (capped at 200 ms).
- **Bots:** they only swing at players they would also throw at; brawling is a coin toss per opponent, not tactics.
- **Third-person swings:** keyframed on the shoulder and elbow only (no wrist or fingers).
- **The voice line:** a placeholder synthetic voice in Castilian Spanish, like the rest of the pack.
- **Online hosting:** online play on the hosted preview is off by design. The multiplayer checks ran against a local server.
