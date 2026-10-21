# Campaign evidence

These were captured from the production build in this Linux container: headless Chromium with SwiftShader software rendering. Each run started from a fresh save and played all four missions in order. The helper bot drove Rosa (`scripts/campaign-e2e.ts`); every menu, screen and system was the shipping game.

**Clips (`*-gameplay.webm`, first 90 s of each mission, 640 px, 12 fps).** The audio is the game's own mix of music, effects and voices, recorded from the Web Audio output and muxed onto the video. It was level-checked (mean about -25 to -29 dB, peaks about -4 dB), but nobody has listened to it. The voices are the **temporary synthetic placeholders**. Every one of the 79 lines that played was logged as a voiced clip, not subtitles only (`campaign-e2e.json`).

| Files | What they show |
| --- | --- |
| `00-select-fresh.png`, `99-select-after.png` | Mission select on a fresh save (missions 2-4 locked), and after the run plus a reload (all four done, best times and stars) |
| `1-ruleros-*` | The intro, the balcony latch, the bank shot off the mural, the cart chase, victory with Rosa in her recovered ruleros, results |
| `2-cocina-*` | The speaker cart warming up below the terrace, the haywire timer, carrying the tray (shown in Rosa's hands), victory |
| `3-patio-*` | A bank shot freeing a decoration, a switch sending a pile into the bin, the chair stacks, victory |
| `4-pinata-*` | Phase 1 (swing and a lit point), phase 2 (shields and decoys), phase 3 (core), the break, the gathering, final results |
| `campaign-e2e.json` | Per mission: results, challenges, the dialogue lines that played (voiced or not), dropped lines, console errors (none) |
