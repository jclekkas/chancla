# Music, voices and comedic timing

## Status

| Part | State |
| --- | --- |
| Music | **Finished as an original synthesized score.** It is composed in code and plays live through Web Audio (`src/audio/music.ts`). No samples and no files. It has not had a listening pass by a person yet. |
| Sound effects | Finished as synthesized effects (`src/audio/audio.ts`), the same as the shooter's. |
| Dialogue system | Finished: event triggers, cooldowns, repetition avoidance, priorities, no overlaps, ducking, banter mute, subtitles in English or Spanish, multiplayer rules. |
| Spoken lines (script) | Finished: 79 lines (66 for Rosa, 13 for the opponents), written in Spanish first, with English subtitles. See [VOICE_SCRIPT.md](VOICE_SCRIPT.md). |
| **Voice recordings** | **Missing.** The shipped clips are temporary synthetic placeholders (see below). They are clearly robotic, the Rosa voice is Castilian rather than the intended character, and they are not finished voice acting. **All 79 lines still need recorded performances** (or a commercially licensed, natural Spanish neural voice). |

## Music

`src/audio/music.ts` is a small sequencer that schedules notes ahead on the audio clock, so loops are seamless. When the track changes, the old one fades out on its next bar line while the new one fades in.

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
- **Ducking.** Music drops to 55% while a voiced line plays.
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
