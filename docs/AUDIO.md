# Music, voices and comedic timing

## Status

| Part | State |
| --- | --- |
| Music | **The full Suno playlist is in:** all 11 songs, with automatic per-scene rotation, Shuffle all, or one chosen song (see [The full soundtrack](#the-full-soundtrack)). The five curated seamless loops prepared earlier stay, for repeating one song. **The original synthesized score stays** as the loading and failure fallback. **Nobody has listened** to the songs, the rotation or the transitions in the game; everything below was measured or tested by script, not heard. |
| Sound effects | Finished as synthesized effects (`src/audio/audio.ts`), the same as the shooter's. |
| Dialogue system | Finished: event triggers, cooldowns, repetition avoidance, priorities, no overlaps, ducking, banter mute, subtitles in English or Spanish, multiplayer rules. |
| Spoken lines (script) | Finished: 79 lines (66 for Rosa, 13 for the opponents), written in Spanish first, with English subtitles. See [VOICE_SCRIPT.md](VOICE_SCRIPT.md). |
| **Voice recordings** | **Missing.** The shipped clips are temporary synthetic placeholders (see below). They are clearly robotic, the Rosa voice is Castilian rather than the intended character, and they are not finished voice acting. **All 79 lines still need recorded performances** (or a commercially licensed, natural Spanish neural voice). |

## The full soundtrack

The eleven songs of the Suno playlist, all in the game. Songs are identified by Suno id, never by title. Full ids, source links and checksums are in `assets/music/playlist.json`.

| # | Song | Suno id | Length | Size | Loudness / true peak | Player gain | Automatic pools | Curated loop |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Guerra de Vecinos | `36b2c7ad` | 3:02.8 | 2.8 MB | -17.2 LUFS / -4.0 dBTP | +1.2 dB | intense, action | no |
| 2 | Festive Boss Battle | `d4b3fb6f` | 2:10.8 | 2.0 MB | -17.2 LUFS / -5.1 dBTP | +1.2 dB | intense, action | no |
| 3 | No Manches | `b5a37a72` | 2:11.2 | 2.0 MB | -16.5 LUFS / -4.3 dBTP | +0.5 dB | intense, action | no |
| 4 | Fricas y Fricas | `72898684` | 2:46.5 | 2.5 MB | -16.7 LUFS / -3.6 dBTP | +0.7 dB | chores, action | no |
| 5 | Bounce y Joke | `d5ece162` | 1:08.0 | 1.0 MB | -16.5 LUFS / -3.9 dBTP | +0.5 dB | chores, action | yes (`bounce-y-joke`) |
| 6 | Juego de Barrio | `4c389fba` | 1:11.2 | 1.1 MB | -16.6 LUFS / -4.2 dBTP | +0.6 dB | chores, action | no |
| 7 | Ruleros | `66be822e` | 2:26.9 | 2.2 MB | -16.5 LUFS / -3.1 dBTP | +0.5 dB | exploration, action | yes (`ruleros`) |
| 8 | Sueño de Cumbia | `91dee4c5` | 2:23.1 | 2.2 MB | -16.5 LUFS / -2.8 dBTP | +0.5 dB | menu, exploration, action | no |
| 9 | Sobrescuro | `a5773b78` | 1:18.0 | 1.2 MB | -16.5 LUFS / -2.5 dBTP | +0.5 dB | exploration, action | no |
| 10 | Grojo Curioso | `6265def8` | 1:03.5 | 1.0 MB | -16.7 LUFS / -2.7 dBTP | +0.7 dB | menu, exploration, action | no |
| 11 | Groquo de diversión | `036c0292` | 2:01.9 | 1.9 MB | -17.4 LUFS / -3.4 dBTP | +1.4 dB | menu, action | yes (`rosa-theme`) |

**Two more recordings are kept, separately:** the earlier **Guerra de Vecinos** and **Fricas y Fricas** first integrated as loops. They are different recordings from playlist songs 1 and 4: their waveforms correlate at about 0 with the new versions. They appear in the song list as "(earlier version)" and play only when chosen. They are not counted in "all eleven".

The other three earlier loops are the *same* recordings as playlist songs 11, 7 and 5. Their waveforms correlate at 0.99, at zero offset. So they are not separate songs: each serves as that song's seamless loop when it is chosen to repeat.

### Where each song plays (Automatic)

These pools are editorial starting points taken from the brief. **They were not chosen by listening.**

| Scenes | Pool | First song the first time |
| --- | --- | --- |
| Title, mission select, online lobby, results; the Arcade title | **menu**: Groquo de diversión, Sueño de Cumbia, Grojo Curioso | Groquo de diversión |
| Mission 1, Operación Ruleros | **exploration**: Ruleros, Sueño de Cumbia, Sobrescuro, Grojo Curioso | Ruleros |
| Mission 2 (kitchen) and Mission 3 (patio) | **chores**: Fricas y Fricas, Juego de Barrio, Bounce y Joke | Fricas y Fricas |
| Practice, online matches, Arcade runs | **action**: all eleven | (shuffled) |
| Mission 4 (piñata finale), the Arcade boss | **intense**: Guerra de Vecinos, Festive Boss Battle, No Manches | Guerra de Vecinos |

Every song is in the selector and in at least one pool besides "action".

### Settings: Soundtrack

The Soundtrack section is on both the main page and the Arcade, in English and Spanish. It never appears on the combat HUD.

- **Automatic** (the default): each scene draws from its own pool.
- **Shuffle all**: all eleven, in random order, carrying on across scenes.
- **One song**: the chosen song repeats. Picking a song from the list switches to this mode.
- **Next song**: skips to another song of the pool. In One song mode, it moves the choice to the next song in the list.
- **Now playing**: the title. It also says when the built-in score is covering for a song that's loading, and when music is muted.

The choice is stored on this device (`chancla.music.v1`) and shared by both pages. It never changes volume or mute. Music is local to each player: nothing is sent to other online players, and there's no Suno login or API at runtime. Files are served from this site, not hotlinked.

### How songs play

- **Whole songs.** In Automatic and Shuffle all, each song plays to its natural end. Then the next one crossfades in over 3 s. Next uses a 1 s crossfade, and a scene change 1.5 s.
- **Shuffle bags.** A pool plays every song once before any repeats. A new round never starts with the song that just ended. When a pool starts for the first time in a session, its first song plays first (Groquo for the menus).
- **Continuity.** Screens that share a pool (title, then mission select, then results) keep the same song going, so it doesn't restart. Pause, rendering and minor navigation don't restart it either. In Shuffle all, scene changes don't change the song at all.
- **One song.** With a curated loop, it repeats seamlessly using that loop (sample-accurate loop points, baked seam). Without one, it crosses from its end back to its start over 3 s.
- **Arcade.** The Arcade now uses the same controller as the main page; its private groove is no longer used. Pausing a run lowers the song to 45% instead of stopping it, and Resume brings it back.
- **Two songs at most.** Two songs sound together only during a crossfade. When a new change comes while one fade is still running, the older fading song is cut in 0.12 s.
- **Late downloads.** Every request carries a generation number. A download for a scene that has since been left never starts playing.
- **Unchanged:** the mix and the in-game EQ dip, dialogue ducking, the Enable sound recovery, mute and volume, and the bounded retries (a failed download is retried after 4 s and 15 s, then given up).
- **Failure handling.**
  - If a song fails to download or decode, the next song in the pool is tried.
  - If none can play, the synthesized score plays.

### Files, loudness and memory

- **Files:** the eleven MP3s are served **byte for byte as supplied** (128 kbps, 48 kHz stereo, no embedded art, SHA-256 as in the supplier's `tracks.json`). They are not re-encoded.
- **Loudness:** matched by a playback gain (+0.5 to +1.4 dB) to the -16 LUFS of the curated loops. The true peak stays at or below -2 dBTP after gain.
- **Build:** `python3 scripts/music/playlist.py <unzipped playlist>` checks, measures, copies and writes `assets/music/playlist.json` and `src/audio/playlist-data.ts`.
- **Kept out of the repository:** the ZIP and the original full-size downloads.
- **Size:** the playlist adds 20 MB to the deployment, so `public/music` totals 29.4 MB.
- **Loading:**
  - Nothing is downloaded before the page asks for music.
  - A fresh visit fetches only the opening song.
  - Only the current song is downloaded and decoded, plus the next one from 25 s before the end.
  - Everything else is released, including the compressed bytes once a song is decoded.
- **Memory:**
  - A decoded song costs its length × 48,000 × 2 channels × 4 bytes. That's 23 MB for Grojo Curioso and 67 MB for Guerra de Vecinos.
  - Measured in headed Chromium across the browser checks: **49 MB at rest with one song, 67 MB at the peak of a crossfade**.
  - The worst case, the two longest songs crossfading (Guerra de Vecinos and Fricas y Fricas), is about 128 MB.
  - **Not measured on a phone.** That is the main risk on low-memory phones (the Arcade's Touch Beta).

### Verified, and not

All of this ran in this Linux container. "Headed" means a real Chromium window under Xvfb, which enforces the gesture rule for audio.

- `npm test` adds:
  - `tests/playlist.test.ts`: all 11 ids, checksums of the shipped files, pools and assignments, and shuffle-bag rules over 200 random seeds.
  - 8 controller tests in `tests/music-lifecycle.test.ts`:
    - the natural-end handover, with two songs only in the fade and two decoded at most
    - Shuffle all plays 11 before any repeat, never twice in a row
    - pools per scene, with continuity
    - Next
    - One song with and without a loop
    - the earlier recordings
    - 24 rapid scene and mode changes, ending on the right song
    - mute untouched
- `npm run e2e:music`: 44 checks, headless. They include each of the 11 songs fetched from its deployed path and decoded by the browser at the measured length, and a natural ending in Mission 1 handing over to the next exploration song.
- `scripts/playlist-e2e.ts`: 23 checks, headed. They cover:
  - a fresh visit (no audio and at most one song fetched before a gesture), then the first gesture
  - the Settings section in English and Spanish, and the 13-song list
  - Next, a natural ending in Shuffle all, and One song both ways
  - after a reload, One song and mute are still in effect
  - tab hidden and back
  - six fast mission and menu switches (never more than two songs)
  - main menu, then Arcade, pause, resume, home
  - a missing opening song (404), which another menu song covers
- **Not verified:**
  - **No one has listened.** The pools, the crossfades and the songs' endings may not sound right.
  - Not tested on real Safari, Firefox, Windows, Mac, iPhone or Android.
  - Memory limits on phones are not tested.

Listening material in `evidence/music/transitions/`, recorded from the game's own mix with music at 100%. **Nobody has listened to these yet:**

- `next-button.webm`: the menu song, then Next pressed at 0:05, with a 1 s crossfade.
- `natural-ending-shuffle.webm`: Bounce y Joke 10 s from its end. The next song crossfades in from 0:07 to 0:10.
- `one-song-repeat.webm`: Festive Boss Battle 7 s from its end, then back to its start, crossfading from 0:04.
- `scene-change-menu-to-mission.webm`: a menu song, then Mission 1 starting at about 0:05, crossfading to the exploration pool. Mission 1's spoken intro follows, so it is louder.
- `arcade-pause-resume.webm`: an Arcade run, paused at 0:04 (the song carries on, lower), resumed at about 0:09.

## Curated loops (the first five recordings)

These five recordings were the first integration, as seamless loops, one per scene. **Scene assignment now comes from the playlist pools above.** The loops are used when a player picks one of these songs to repeat: rosa-theme for Groquo de diversión, plus ruleros and bounce-y-joke. The two earlier Guerra and Fricas versions are only heard this way. The table below is how they were first assigned and prepared:

| Track | Plays in | Loop | Browser file | Seam similarity | Seam check: novelty / beat |
| --- | --- | --- | --- | --- | --- |
| Groquo de diversión (Rosa's theme) | Title, mission select, online lobby, results | 43.23 s to 88.59 s (45 s loop) | 89 s, 1.7 MB | 88th | 64th / 49th |
| Ruleros | Mission 1, Operación Ruleros | 26.60 s to 98.45 s (72 s loop) | 99 s, 1.9 MB | 99th | 60th / 24th |
| Fricas y Fricas | Mission 2 (kitchen) and Mission 3 (patio) | 58.11 s to 133.89 s (76 s loop) | 134 s, 2.7 MB | 95th | 78th / 54th |
| Guerra de Vecinos | Mission 4, the piñata finale | 45.50 s to 109.77 s (64 s loop) | 110 s, 1.9 MB | 98th | 14th / 42th |
| Bounce y Joke | Practice and online matches | 18.35 s to 60.43 s (42 s loop) | 61 s, 1.2 MB | 86th | 19th / 68th |

- "Bounce y Joke" was labelled an "alternate action cue". I used it for practice and online matches, the one action context without its own track. It plays 3 dB quieter there, with a deeper 2.6 kHz dip, so footsteps and incoming throws stay audible.
- Rosa's theme also covers mission select, the lobby and results, so the menus share one recording. It carries on from the title into mission select rather than restarting.
- The kitchen and patio missions share "Fricas y Fricas", as assigned ("cooking and cleaning"). Each mission starts it from the top.

### What happens to the originals

`assets/music/originals/` holds the five downloads unchanged (`SHA256SUMS`; a test checks them). They are never served. `python3 scripts/music/prepare.py` (or `npm run music:prepare`) builds the browser files from them:

1. **Loop points.** `scripts/music/find-loops.py` beat-tracks each song and ranks beat-aligned, whole-bar loops by how alike the music is on both sides of the seam (harmony and timbre over 8 beats). "Seam similarity" in the table is that score's percentile against random pairs of points in the same song. I picked from its top candidates, preferring longer loops, so a long mission repeats less often. The end point is then nudged (the search allows 30 ms; the largest shift used was 10 ms) to line up the drum onsets.
2. **Baked seam.** The two beats before the loop end are crossfaded (equal power) into the two beats before the loop start, and the file continues past the end with the audio after the start. The jump is therefore continuous even if a browser's MP3 decoder lands a few milliseconds off.
3. **Trim.** The song's ending is dropped, because the loop takes over before it would play.
4. **Loudness.** All files are matched to -16 LUFS integrated, with a limiter at about -1.5 dBFS. (The ruleros and rosa-theme originals peak above 0 dBFS.)
5. **Encode.** MP3 (LAME VBR, about 150 kbps), 48 kHz stereo: 9.5 MB for all five. MP3 decodes in every target browser (Chromium builds without AAC, and older Safari without Ogg). The cover art and tags are stripped.
6. **Checks.** `scripts/music/check-seams.py` plays each loop around twice. It measures how abruptly the sound changes across the seam window (novelty), and whether the beat grid carries on (beat), against same-width windows elsewhere in the loop. A seam ranking in the ordinary range (novelty below the 90th percentile, beat above the 10th) blends in by these measures. All five do. **Measures are not ears**: listen to the seam clips.

### In the game

`src/audio/music.ts` plays a recording as one looping buffer source (sample-accurate loop points from `src/audio/soundtrack.ts`, which the prepare script generates).

- **Transitions.** Changing cue crossfades equal power over 1.5 s. Going from a recording to the synthesized score, or back, also crossfades.
- **Loading.** Files are fetched on demand: Rosa's theme as the page opens, a mission's track when its intro screen opens, and the action cue when the practice screen opens. Decoding waits for the first click, which unlocks audio. If a recording isn't ready within 1.2 s of its cue, the synthesized arrangement plays and hands over when the file arrives. If the download or decoding fails, the synthesized score stays for the rest of the session. No error is shown, because nothing is lost but the recording.
- **Memory.** A decoded recording takes 20 to 50 MB (uncompressed audio). At most two stay decoded: the current one and the most recently used other one, usually Rosa's theme.
- **Level.** Recordings sit on the same music bus as the score, so the music volume slider and zero volume control them unchanged. In-browser measurement put them within about 1 dB of the synthesized score:

  | Cue | Recorded | Synthesized |
  | --- | --- | --- |
  | menu | -35.1 LUFS | -34.3 |
  | ruleros | -34.8 | -35.3 |
  | cocina | -35.3 | -35.0 |
  | pinata | -35.9 | -34.6 |
  | combat | -38.4 | -38.1 |

  These are relative numbers at the music bus, before master volume.
- **Room for the game.** During play a gentle dip (-2.5 dB at 2.6 kHz, -4 dB in matches) keeps the footsteps, hit cues and voices band clear. Menus get the full mix.
- **Under dialogue.** While a voiced line plays, a recording ducks to 42% (-7.5 dB). The score ducks to 55%, because it is sparser and needs less. A -4 dB dip around 2 kHz also applies during the line. Both recover when the line ends.
- **Stingers** (objective, setback, phase, complete, fail) stay synthesized. They are pitched to the playing recording's key: A minor for Rosa's theme, ruleros and fricas; D minor for guerra and bounce.
- **Intensity** shapes only the synthesized score. The recordings have no stems to thin out or build up.

### Lifecycle (autoplay, tabs, navigation, retries)

One audio context and one music controller serve the whole page. The controller always holds the intended cue for the current scene (`want`), and late downloads, retries and resumes act only on that cue.

- **Starting.** Browsers allow audio to start only from a user gesture. `audio.armLifecycle()` (main page and Arcade) retries on every click, tap or key press until the context is running, not just the first. When audio becomes available, the controller starts the intended cue itself.
- **Tabs and Back.** Audio pauses while the tab is hidden and resumes on return, including pages restored from the back/forward cache. If the browser refuses a resume without a gesture, the next click or key press resumes it. Nothing needs a reload.
- **Downloads.** A failed download plays the synthesized fallback and is retried after 4 s and then 15 s, or at once when the browser reports it is back online. That makes three attempts, then it stops. A successful retry crossfades from the fallback to the recording, and only if the player is still in that scene. A file that downloads but won't decode is not retried.
- **Mute.** Music at zero is a bus level that navigation, unlocks and retries never touch.
- **Arcade.** Its title music starts on the first gesture anywhere on the page. Its title screen now has a Main menu link back to the shooter.

Regression coverage:

- `tests/music-lifecycle.test.ts`: 8 tests with a fake audio context.
- `npm run e2e:music-lifecycle`: 27 browser checks. Headless Chromium doesn't enforce the gesture rule, so the script enforces it from trusted input events, in a Chrome-like mode and a strict Safari-like mode.

### The "Enable sound" control

A visitor reported no audio on production. In this environment, a first visit to the exact production build (`45900d0`) in a real, headed Chromium with an empty profile started audio on the first click every time. All music and voice files loaded with status 200. So the report is **not reproduced here**. The likely causes are ones this environment can't exercise:

- the visitor never clicked: the page gave no sign that a click turns sound on
- an iPhone or iPad with the silent switch on, which mutes Web Audio
- a browser stricter than Chromium

`src/ui/soundGate.ts` (main game and Arcade) shows a button whenever audio is not actually running:

| State | What it says | What it means |
| --- | --- | --- |
| enable | Enable sound / Activar sonido | No gesture yet. Clicking it, or anything else, starts audio. |
| blocked | Sound is blocked. Tap to try again | A gesture was made but the browser still won't play. Its hint mentions tab mute and the iPhone silent switch. |
| unsupported | This browser can't play sound | No Web Audio. The game works without it. |
| muted (menus only) | Sound muted in Settings | The player turned it down to zero. Clicking opens Settings. |

- The button calls `audio.unlockFromGesture()` directly from its own click. It hides only when the audio context reports `running`, never just because it was clicked.
- A music track that fails to download is not shown as a sound problem, because the built-in score plays. The Settings panel's status line says which state applies, including "the music track didn't load; the built-in score is playing; retrying".
- iPhone and iPad: the page asks for a "playback" audio session (Safari 16.4+), and plays 50 ms of silence through a media element on the first gesture, so the silent switch doesn't mute the game. **Not tested on a real device.**
- Play is never blocked: menus and play work while sound loads or stays unavailable.

Checks:

- `xvfb-run -a node --import tsx scripts/sound-gate-e2e.ts` runs 23 checks in headed Chromium with its real autoplay policy. They cover a fresh visit, Practice, campaign and back home, mute, a failed track, and the Arcade and back to the main menu. The "blocked" case is simulated, by stubbing `AudioContext.resume()`.
- 3 unit tests in `tests/music-lifecycle.test.ts`.

### Verified, and not

Run in this Linux container with headless Chromium. `npm run e2e:music` makes 32 checks, all passing; the report is in [evidence/music/music-e2e.json](evidence/music/music-e2e.json). It checks:

- each file decodes in the browser to its exact prepared length
- the browser's own loop playback has no jump at the seam larger than the track's ordinary 99.9th-percentile sample step
- each cue plays its assigned recording: the menu, mission select (continuing, not restarting), all four missions, the return to select, and practice
- a playing loop wraps from its end back to its start
- dialogue ducks and recovers
- the volume slider and zero volume work
- only two recordings stay decoded
- with the files blocked, the synthesized score plays the menu and a mission with no errors
- with a slow download, the score plays first and the recording takes over

Not verified:

- **No one has listened.** Decoding and measurements can't tell whether a seam sounds natural, whether the mix suits the game, or whether a crossfade lands awkwardly.
- **Not tested on real Safari, Firefox, Windows or Mac.**
- **Not tested on real mobile memory limits.**

Listening material:

- [evidence/music/transitions.mp3](evidence/music/transitions.mp3): about 60 s of the game's mix. It runs menu (0:00), mission select (0:08), Mission 1 starting (0:15), a line of dialogue (0:24), a jump to 6 s before the Ruleros loop seam (0:30, so the seam is near 0:36), leaving to select (0:41), then Mission 4 (0:49).
- `evidence/music/<track>-seam.mp3`: for each track, the 6 s before its loop seam followed by the 6 s after the loop start, exactly as the loop plays it.

### Changing a loop or an assignment

1. Edit `assets/music/loops.json`. `python3 scripts/music/find-loops.py <decoded.f32> <name>` lists candidate loop points.
2. Run `npm run music:prepare`, which needs ffmpeg and numpy.
3. Run `npm run build && npm run e2e:music`.

To compare against the synthesized score, run `__fps.music().recordings = false` in the browser console, then change screen.

## Synthesized score

`src/audio/music.ts` also contains a small sequencer that schedules notes ahead on the audio clock, so loops are seamless. When the track changes, the old one fades out on its next bar line while the new one fades in.

The instruments are all synthesized:

- plucked strings (Karplus-Strong) for the requinto, guitarrón-like bass and harp
- marimba (two sine partials)
- a squeezebox-style reed (detuned square and saw through a low-pass)
- brass (filtered saw)
- percussion: güiro, shaker, clave, conga, kick and timbal fill

One motif, "Rosa's theme" (5-3-5-6 | 5 · 3-2 | 1-2-3-5 | 3), ties the campaign together:

| Track | Where | Arrangement |
| --- | --- | --- |
| `menu` | Title | Relaxed cumbia; the marimba states the motif |
| `lobby` | Online lobby | The same groove; no lead, guitar comping only |
| `combat` | Online matches | Restrained: minor key, bass, soft güiro and pads, low-passed at 1.3 kHz, no lead line. Footsteps, incoming throws and hit cues stay clear. |
| `results` | Match and mission results | Brass and marimba on the motif |
| `select` | Mission select | Harp-like plucks, the motif in slow values |
| `ruleros` | Mission 1 | Morning: plucked requinto lead, light shaker |
| `cocina` | Mission 2 | Busier: interlocking guajeo comp, conga tumbao, faster tempo |
| `patio` | Mission 3 | Afternoon: squeezebox-style lead |
| `pinata` | Mission 4 | The finale: brass stabs, full percussion, timbal fills, 124 BPM |

Intensity (0 to 1) rises with the action: carts chasing, gust wind-ups, piñata phases. It adds percussion and a counter-line without restarting the loop.

Stingers: objective complete (rising arpeggio), setback, phase change (brass hit and drum roll), mission complete (the motif as a fanfare), fail.

On style: the palette draws on cumbia and son rhythms and regional string and percussion timbres. It avoids sombrero-and-trumpet clichés. There are no mariachi pastiches and no "ay ay ay" calls.

## Dialogue

`src/audio/dialogue.ts` decides whether a line plays and shows its subtitle for exactly as long as its clip:

- **One line at a time.** A higher-priority line cuts in; a lower one never does. One story line may wait in the queue, and it is discarded if it goes stale (after 6 s).
- **Cooldowns and variety.** Each reaction pool has a cooldown (misses 14 s, hurt 9 s, eliminations 6 s, and so on). Picks avoid the last two lines from the same pool, and there is a short global gap between banter lines.
- **Danger cues come first.** When an attack is telegraphed (a gust cone, a candy-bomb circle, a speaker warming up), banter is dropped for its duration so a joke never masks the warning.
- **Ducking.** Music drops while a voiced line plays: a recording to 42%, the synthesized score to 55%, with a dip around 2 kHz either way.
- **Settings.** There are separate volumes for music, effects and dialogue. "Automatic banter" turns off reaction lines and keeps story and objective lines. Subtitles can follow the menu language, or be set to Spanish, English or off.
- **Objectives never spam lines.** Lines fire from mission events (a goal completed, a pile scattered), and each of those happens once. Hints repeat at most once per 20 s of no progress.

### Multiplayer rules

There is no audio on the network and no new protocol messages. Lines are triggered from game events the server already replicates:

| Scope | Lines | Who hears them |
| --- | --- | --- |
| Local | your eliminations, your respawn, low health | only you |
| Proximity | another Rosa's elimination quip, if she is within 12 m | players nearby, quieter with distance. The line is chosen from the event (attacker and victim ids), so everyone nearby hears the same one. |
| Match-wide | match start; win or lose at the end | each client plays its own team's line |

Nobody hears every player's quips.

## The placeholder voice pack

The pack was generated at production time by `scripts/make-voices.ts`. Nothing is generated at runtime and nothing is fetched from an AI service. It occupies 79 clips (about 1 MB of MP3) in `public/voice/`, plus `manifest.json` with each clip's length. Each mission preloads only its own lines and the shared reactions.

| Speaker | Engine | Processing |
| --- | --- | --- |
| Rosa, influencer, Bocinas, Soplador | SVOX Pico 1.0, es-ES voice | per-character pitch and tempo, EQ, loudness normalization |
| Toy delivery cart, serving trolley | eSpeak NG 1.51, es-419 | echo (they are machines) |
| Piñata "party system" | eSpeak NG 1.51, es-419 | flanger and echo: an in-character robot announcer |

Licenses:

- **SVOX Pico** is Apache-2.0. Its language data is redistributable (Debian lists it as non-free only because the data's source is not published).
- **eSpeak NG** is GPL-3.0. The GPL covers the program, not the audio it produces.

No recorded human voice is used anywhere, and nothing imitates an identifiable performer.

If the voice files fail to load, the game keeps going with subtitles on estimated timing and tells the player once.

### Replacing the placeholders

1. Record the lines in [VOICE_SCRIPT.md](VOICE_SCRIPT.md), using the same file names (`public/voice/<id>.mp3`).
2. Update `ms` for each line in `public/voice/manifest.json` (ffprobe the duration) and set `"quality": "recorded"`.
3. Nothing else changes. Subtitles follow the new clip lengths automatically.
