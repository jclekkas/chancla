# Music, voices and comedic timing

## Status

| Part | State |
| --- | --- |
| Music | **Recorded soundtrack integrated:** five Suno tracks chosen by the project owner, prepared as seamless loops (see [Recorded soundtrack](#recorded-soundtrack)). **The original synthesized score stays** as the loading and failure fallback, and plays any cue without a recording. Nobody has done a listening pass of the loops or transitions yet; everything below was measured, not heard. |
| Sound effects | Finished as synthesized effects (`src/audio/audio.ts`), the same as the shooter's. |
| Dialogue system | Finished: event triggers, cooldowns, repetition avoidance, priorities, no overlaps, ducking, banter mute, subtitles in English or Spanish, multiplayer rules. |
| Spoken lines (script) | Finished: 79 lines (66 for Rosa, 13 for the opponents), written in Spanish first, with English subtitles. See [VOICE_SCRIPT.md](VOICE_SCRIPT.md). |
| **Voice recordings** | **Missing.** The shipped clips are temporary synthetic placeholders (see below). They are clearly robotic, the Rosa voice is Castilian rather than the intended character, and they are not finished voice acting. **All 79 lines still need recorded performances** (or a commercially licensed, natural Spanish neural voice). |

## Recorded soundtrack

Five instrumental tracks made with Suno and chosen by the project owner. The assignments came with the tracks (`assets/music/originals/SOURCE-NOTES.txt`). They are applied in `assets/music/loops.json`:

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
- **Objectives never spam lines.** Lines fire from mission events (a goal completed, a pile scattered), and each of those happens once. Hints repeat at most once per 35 s of no progress.

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
