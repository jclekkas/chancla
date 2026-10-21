# Asset inventory: Chancla Warfare: La Ley de la Chancla

Every visual and musical asset is generated in code at runtime. There are no downloaded models, textures, images or music files. The one exception is the temporary voice pack: 79 small audio files generated offline by the tools listed below. This table lists what exists, where it lives, and its license.

| Asset | Kind | Source | License |
| --- | --- | --- | --- |
| El Patio map geometry (collision) | Data | `shared/map.ts` | Original, this repo |
| El Patio visuals: houses, facades, stairs, terraces, fountain, statue, kiosk, market stalls, planters, crates, laundry lines, papel picado, string lights, church skyline, rooftops | Procedural meshes | `src/fps/render/world.ts` | Original, this repo |
| Stucco, wood, floor tile and sign textures | Canvas-generated textures | `src/fps/render/materials.ts` | Original, this repo |
| Toon ramp and outline materials | Shader parameters | `src/fps/render/materials.ts` | Original, this repo |
| Doña Rosa team avatars (Sol: straw hat and marigold; Luna: hood and turquoise) with locomotion, crouch, throw, hit, defeat and spawn animations | Procedural rigged meshes | `src/fps/render/rosa.ts` | Original, this repo |
| First-person hand and sleeve | Procedural mesh | `src/models/hand.ts`, `src/fps/render/viewmodel.ts` | Original, this repo |
| La Chancla (standard sandal) | Procedural mesh | `src/models/sandal.ts` | Original, this repo |
| La Pesada (heavy clog) | Procedural mesh | `src/fps/render/rosa.ts` (`buildPesada`) | Original, this repo |
| Trails, impact particles, splash rings | Procedural effects | `src/fps/render/projectiles.ts`, `src/fx/` | Original, this repo |
| Cafecito pickup | Procedural mesh | `src/fps/engine.ts` | Original, this repo |
| HUD and menu icons, Rosa portrait | Inline SVG | `src/ui/art.ts`, `src/fps/hud.ts` | Original, this repo |
| Sound effects | Web Audio synthesis | `src/audio/audio.ts` | Original, this repo |
| Score: menu, lobby, combat, results, mission select, four mission arrangements, stingers | Web Audio sequencer and synthesis (original compositions) | `src/audio/music.ts` | Original, this repo |
| Dialogue script (79 lines, Spanish delivery with English subtitles) | Text | `src/audio/lines.ts`, [VOICE_SCRIPT.md](VOICE_SCRIPT.md) | Original writing, this repo |
| **Placeholder voice clips** (79 × MP3, about 1 MB) | Generated offline at production time with SVOX Pico 1.0 (es-ES) and eSpeak NG 1.51 (es-419), processed with ffmpeg | `public/voice/`, generator `scripts/make-voices.ts` | Pico: Apache-2.0 (language data redistributable). eSpeak NG: GPL-3.0 program; its output audio is not covered by the GPL. Synthetic, not a recorded performer, not imitating anyone. **Temporary**: recorded performances are still missing (see [AUDIO.md](AUDIO.md)). |
| Campaign props: ruleros sets, wicker baskets, serving tray, chair stacks, wind-up delivery cart, serving trolley, debris piles, box tower, wall switches, latch, kitchen timer, bins, party tables, tangled decorations, tile mosaic panels, cafecito | Procedural meshes and canvas textures | `src/campaign/view.ts` | Original, this repo |
| The piñata, its shield panels, decoy mini-piñatas, confetti and candy | Procedural meshes | `src/campaign/view.ts`, `src/campaign/runtime.ts` | Original, this repo |
| Campaign NPCs (influencer, Bocinas with his speaker cart, Soplador with his leaf blower) | The classic game's procedural rigs, converted to toon shading | `src/models/characters.ts`, `src/campaign/view.ts` | Original, this repo |
| Rosa's campaign look (no hat, six curler slots) | Procedural mesh variant | `src/fps/render/rosa.ts` | Original, this repo |
| Mission lighting themes (morning, noon, afternoon, dusk) | Parameters | `src/fps/render/world.ts` | Original, this repo |
| Interface text (English and Spanish) | Strings | `src/fps/strings.ts` | Original, this repo |
| Lilita One typeface | Font | `@fontsource/lilita-one` | SIL OFL 1.1 (`public/licenses/LilitaOne-OFL.txt`) |
| three.js | Library | npm `three` | MIT |
| ws | Library (server) | npm `ws` | MIT |

There is no third-party art, so there is no reference-image copying to audit. The look is an original cel-shaded interpretation of the brief's palette (terracotta, cream, turquoise, marigold, purple). It has not been compared side by side with any reference art, and it should not be described as equivalent to one.
