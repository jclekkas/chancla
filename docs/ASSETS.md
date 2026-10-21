# Asset inventory: Chancla Warfare: La Ley de la Chancla

Every visual and audio asset in the online game is generated in code at runtime. There are no downloaded models, textures, images or sound files. This table lists what exists, where it lives, and its license.

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
| Sound effects and music | Web Audio synthesis | `src/audio/audio.ts` | Original, this repo |
| Interface text (English and Spanish) | Strings | `src/fps/strings.ts` | Original, this repo |
| Lilita One typeface | Font | `@fontsource/lilita-one` | SIL OFL 1.1 (`public/licenses/LilitaOne-OFL.txt`) |
| three.js | Library | npm `three` | MIT |
| ws | Library (server) | npm `ws` | MIT |

There is no third-party art, so there is no reference-image copying to audit. The look is an original cel-shaded interpretation of the brief's palette (terracotta, cream, turquoise, marigold, purple). It has not been compared side by side with any reference art, and it should not be described as equivalent to one.
