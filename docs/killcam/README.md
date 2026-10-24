# Elimination replay ("killcam")

Offline preview only (and local test servers). It needs no protocol change
and no new server data: it replays what your client already received. It
is on by default, with a switch in Settings ("Replay of how you were
eliminated").

## What you see

When you are eliminated, the existing death screen shows first: "Lupita
got you" and the respawn countdown, for 0.8 s. Then about 1.5 s of replay
plays, at normal speed: 1.2 s before the finishing blow and 0.3 s after
it. After that the death screen returns until you can respawn (3 s after
the elimination).

- **The view.**
  - **El Chanclazo and El Revés:** a three-quarter view behind and beside
    the attacker, looking past her shoulder at your face, so her recorded
    forehand or backhand, you and the contact are all in frame. It uses her
    right side first, then her left. It is pulled in until the camera is
    clear of every wall and both of you are in plain sight, and the side
    chosen at the blow is kept for the whole replay. Her own eyes would show
    neither her body nor her hand, so the swing would not show.
  - **Thrown chanclas:** from the attacker's eyes (her recorded position and
    aim) when the recording supports it: she is in the history from the start
    of the clip, alive at the blow, and you were in her line of sight.
  - **Otherwise** (a lob over cover, a splash round a corner, or a melee
    with no clear spot): behind you, facing her, pulled in until nothing is
    between your eyes and the camera.
- **The overlay.**
  - A "● REPLAY" tag.
  - "Eliminated by ☾ Lupita (Luna) · El Revés", with the attacker's team
    icon, colour and name, and the attack: El Chanclazo, El Revés, "La
    Chancla, thrown" or "La Pesada, thrown".
  - The same in Spanish: "REPETICIÓN", "Te eliminó …", "Saltar", "Toca para
    saltar".
  - The live health, scores, timer, crosshair, kill feed and name tags are
    hidden, so nothing live reads as part of the past scene. The respawn
    countdown and the menu button stay. A live subtitle still on screen
    moves up under the REPLAY tag.
  - The point of contact stays clear of every overlay, on desktop and phone
    (checked in the browser).
- **Skipping.** On desktop: a Skip button, or Space. On touch: a large "Tap
  to skip". Esc keeps its menu behaviour. After a skip you are back on the
  death screen. The whole Space press that skipped is used up: holding it,
  with the keyboard's auto-repeat, through respawn never jumps. The next
  real press does.
- **What is shown.** Positions, facing, aim and animation of everyone in
  the recording. The finishing swing (or the thrown chancla in flight) and
  its impact. Hit reactions, misses and blocked blows. The elimination. The
  rollers, but only those the server said came off, launched once. No slow
  motion, cinematic camera, export or sharing.
- **Sound.** At most two replay sounds: the finishing attack (swish or
  throw) and its impact. No voice lines are replayed. During the replay,
  live combat sounds and live voice lines are held back so the two never
  overlap. Music and the mute and volume settings are untouched.

Screenshots:
- [The moment of contact in the melee view](melee-contact-frame.jpg) (El
  Revés, from the clip).
- Desktop: [El Chanclazo](desktop-replay-chanclazo.jpg),
  [El Revés](desktop-replay-reves.jpg) and
  [a thrown chancla](desktop-replay-thrown.jpg).
- [Spanish](desktop-replay-es.jpg).
- [Phone](phone-replay.jpg).
- [Online, local server](online-replay.jpg).

Clip: [clip.mp4](clip.mp4), 6 s at true speed: the elimination, the
replay of El Revés in the melee view (Lupita steps in, winds up La Pesada,
the backhand lands with ¡PAF!, the rollers fly) and back to play. It was rendered frame by frame on a controlled
clock, so the software renderer's frame rate does not show.

## How it works

`src/fps/killcam.ts` (pure, tested in Node) and `src/fps/engine.ts` (drawing).

- **Recording.** A bounded rolling buffer of about 3.5 s holds:
  - the snapshots' player records, kept by reference (the session builds
    them once per snapshot and never changes them);
  - the confirmed combat events (throw, bounce, end, hit, elimination,
    swing, miss, blocked), with their server times.

  It is capped at 90 snapshots and 256 events. Nothing is recorded with the
  setting off.
- **Attribution.**
  - The killer, the attack and the rollers come from the server's own
    "elim" event. The killer's name and team are captured when it arrives,
    so a killer who disconnects is still named, and is still in the replay.
  - The blow's time is the melee hit's server time. For a throw, it is the
    end of the projectile that hit.
  - Each death binds at most one elimination. A resent or duplicated event
    starts nothing. An event that arrives after you respawn never binds to a
    later death.
- **Playback.**
  - Players are interpolated between the recorded snapshots with the same
    function the live view uses for other players (it moved from
    `updateRemotes` to `samplePlayers` in `session.ts`, unchanged).
  - A thrown chancla is drawn from the server's recorded launch (or bounce)
    point and velocity under its weapon's gravity, eased over the last 50 ms
    onto the recorded hit point. This is how every client already draws
    other players' throws.
  - Replay characters come from a small pool reused from one replay to the
    next. Effects reuse the match's own pools.
- **Isolation.**
  - The replay never touches the session, inputs or the match. It applies no
    damage, score, attack, cooldown or pickup, and sends nothing.
  - Live state keeps processing underneath, out of sight: the session still
    ticks, reconciles and handles events, and the live characters still
    animate. Live effects are not drawn during the replay. On exit the live
    view returns and held input is cleared. Pointer lock and touch handling
    are untouched.
  - Practice keeps its pause behaviour. Esc, a lost focus or a hidden page
    pause the match, and the replay holds still with it. The practice pause
    sync path is not involved.
- **When it ends.**
  - At the end of the clip.
  - On a skip.
  - The moment you can respawn.
  - When the round or match changes.
  - When the connection drops.
  - When the setting is turned off.
  - When a menu opens online. Online, the match does not pause, so the
    replay ends rather than playing behind the menu.
- **When it falls back to the existing death screen.**
  - The setting is off.
  - There is no attribution, or the killer is unknown to the recording.
  - It was a self or environmental elimination.
  - There is less than 0.6 s of history before the blow.
  - It would not fit before respawn.
  - The elimination ended the match.

## Cost

Measured with Chromium and SwiftShader on this Linux container.

| | |
|---|---|
| Recording | about 2 µs per snapshot plus event (Node, 20,000 iterations) |
| Buffer | 71 snapshot references, 31 of them beyond the session's own 40-snapshot history: about 15 KB (as JSON) with 2 players, scaling with the player count; at most 256 events (a few hundred bytes typical) |
| Characters | one per player shown, pooled and reused (2 in these tests); after 5 more replays: +1 geometry, +0 textures |
| Replay logic | about 0.4-0.5 ms per frame (its own work, without drawing) |
| Download | 408.2 KB to 412.8 KB of gzipped JavaScript (+4.6 KB); no assets |

The whole frame during the replay, compared with the death screen it
replaces (same spot, same elimination; [costs.json](costs.json)):

| Quality | Death screen: calls / triangles | Melee replay: calls / triangles |
|---|---|---|
| High | 93 / 107.8k | 114 / 126.5k |
| Medium | 90 / 95.7k | 106 / 107.6k |
| Low | 62 / 54.1k | 67 / 57.5k |

The melee replay draws both Rosas (and, on High and Medium, their
shadows), as live play with two players in view does. That is the price of
showing the swing. A replay from the attacker's eyes (throws) draws a
little less than the death screen. Whole-frame times here mostly measure the software rasterizer
drawing a different view (eye level instead of looking down). With 5 or 6
frames per replay on High and Medium, they are not evidence for any device.

## Checks

- **Typecheck and offline build.** No production server address is in the
  bundle.
- **Unit and multiplayer: 415/415, all suites** at bdc9cb7. After the
  corrections, the affected suites were rerun: killcam 11/11, Space skip
  5/5, touch, input and practice pause, 45/45 in all.
  - `tests/fps-input-skip.test.ts` covers the reported sequence (the skip,
    its auto-repeat, then keyup: no jump), a fresh press afterwards jumping,
    a keyup lost to a focus change, Space without a replay, and menu typing.
    Without the fix, the reported sequence fails.
  - `tests/killcam.test.ts` runs a real practice match on a test clock:
  - the thrown chancla, El Chanclazo and El Revés to the face;
  - the killer, the team and the attack;
  - the thrown chancla arriving where the server says it hit;
  - the rollers once;
  - repeated, delayed and stale eliminations;
  - missing and short history;
  - unknown, self and environmental eliminations;
  - a disconnected killer;
  - the setting off, and a late start;
  - six deaths in a row (bounded buffer, nothing in the match changes);
  - the third-person camera beside 40 walls;
  - the melee camera beside the same walls: clear of every wall, both
    players in plain sight, behind and beside the attacker, the side held;
  - Chanclazo and Revés clips using the melee view;
  - the recording cost.
- **Browser, offline practice: 29/29** (`scripts/killcam-e2e.ts`;
  [killcam-e2e.json](killcam-e2e.json)):
  - El Chanclazo, El Revés and a thrown chancla;
  - the melee view, with the attacker drawn mid-swing;
  - the contact on screen and clear of every overlay, desktop and phone;
  - Space held through respawn with auto-repeat: no jump; a fresh press
    jumps;
  - the overlay and the hidden HUD;
  - real-time length;
  - at most two sounds;
  - score and damage unchanged by the replay;
  - Space skips, with nothing held and no jump at respawn;
  - respawn during playback;
  - Esc and focus loss (paused with the match, then carries on);
  - the setting off;
  - five more deaths without growth;
  - a match-ending elimination (no replay, the results);
  - touch (Tap to skip, then the touch controls back);
  - Spanish.
- **Local multiplayer server: 8/8** (`scripts/killcam-mp-e2e.ts`;
  [killcam-mp-e2e.json](killcam-mp-e2e.json)). The victim plays in a
  browser page and a scripted attacker client on the same local server lands
  El Revés three times:
  - the replay plays in the melee view, with the attacker drawn mid-swing;
  - the attacker keeps moving and receiving snapshots meanwhile;
  - the scores agree and each elimination is handled once;
  - Esc online ends the replay;
  - a dropped connection ends it, and after the reconnect nothing is
    replayed or counted twice;
  - only the local site and the local game server were contacted.
- **Existing browser suites, unchanged:** melee 35/35, movement and pause
  55/55, touch 35/35.

## Approximations

- Everyone, you included, is shown from the server's snapshots (20 a
  second), interpolated. Your own movement in the replay can differ slightly
  from the predicted view you had.
- The attacker's view (throws only) uses her recorded aim. Her
  first-person hand is not drawn.
- The melee view tracks both players from the recorded positions. While
  she walks in from a distance, the pair is smaller in frame.
- A thrown chancla's path between the recorded launch, bounce and end
  points follows its weapon's gravity. It is not swept against the walls
  again (a bounce comes from its recorded event).
- Pickups (the cafecitos) show their live state during the replay, not the
  historical one.
- Live events during a replay (another player's elimination, say) are
  counted and shown in the kill feed afterwards, but their effects and
  sounds are not played.

## Not verified

- Frame rate on a Mac or a phone.
- Safari's pointer lock with Space to skip.
- iOS and Android tap behaviour on the skip layer.
- Audio on real devices.

All checks above ran in headless Chromium, with the phone emulated.

## Mac and phone checklist

Mac (Safari and Chrome):

1. Practice on El Patio. Get eliminated by El Chanclazo, El Revés and a
   thrown chancla. Each time:
   - the death screen shows first, then the replay;
   - the replay is from the attacker's eyes, or from behind you if she was
     out of sight;
   - the overlay names her, her team and the attack.
2. Skip with Space, and once with the Skip button after pressing Esc and
   Resume. Respawn should not jump.
3. Press Esc during a replay. The menu opens. Resume, and the replay
   carries on.
4. Turn the replay off in Settings: only the death screen. Turn it back on.
5. Listen: the replay plays one swing or throw and one impact. The music
   continues.
6. Note frame rate during replays on High.

Phone (landscape, Low and Auto):

1. Get eliminated. Check that "Tap to skip" is large and easy to hit, and
   that a tap returns to the death screen with the touch controls working.
2. Let a replay play out. Then respawn and move at once: nothing should be
   stuck.
3. Background the app during a replay and return: the match is paused (in
   practice) or the replay is gone (online), and nothing is stuck.
4. Spanish: the overlay reads "REPETICIÓN" and "Te eliminó".
