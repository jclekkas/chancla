# MT milestone: sourced materials on El Patio, team colour in shade

- **Code:** `ab55b6e` (shade), `e1f4c77` and `5be5b92` (materials) on `codex/close-combat`.
- **Baseline:** the VD milestone (`a6ee952`).
- **Contract:** "During ordinary play, walls look like plaster, paving like stone, doors like wood
  and roofs like terracotta, with convincing scale and depth. Opponents remain identifiable in
  shade."

## What changed

1. **Sourced CC0 textures on El Patio** (shooter only, El Patio only):
   - **Plaster walls:** `clay_plaster`, one repeat every 2.75 m. The colour is neutralised so each
     house keeps its paint, and the trowel variation is lifted to about +/-9 %.
   - **Street paving:** `cobblestone_floor_001`, warm grey, one repeat every 1.6 m (cobbles about
     14-18 cm).
   - **Doors and beams:** `rough_wood`, vertical grain, one repeat per metre, under the existing
     honey tint.
   - **Unchanged:** shutters, the plaza terracotta floor, roof tiles, and La Plaza, La Fiesta,
     Arcade and Campaign.
   - Sources, licences and processing: `public/textures/patio/SOURCES.md`. Poly Haven was blocked
     from the build machine, so the files came from the MIT-licensed Riposte repository's CC0
     mirror (commit `31ca050`), which records the original Poly Haven IDs.
2. **Shading per tier:**
   - **High and Medium:** a standard (physically based) material on those three surfaces only, with
     colour and normal maps at 512 px and constant roughness. Its diffuse light is wrapped so it
     matches the toon world's brightness.
   - **Low:** the toon material with colour maps only, at 256 px.
   - Toon shading with normal maps was tried and rejected: it turned walls into dark blotches.
   - **Characters:** they stay toon.
3. **Team colour in shade** (High and Medium):
   - In shade or at Fiesta's dusk, a character's clothing now keeps part of the sun's warm light,
     and its sky fill is warmed.
   - It applies per character only while that character stands in the world's shade (three probes
     toward the sun).
   - In sun the image is identical, and Low is unchanged.
4. **Switch:** `?mat=classic` gives the previous look on any tier, and `?mat=std` or `?mat=toon`
   forces a variant. With no parameter, the defaults above apply.

## Visual Director verdict

- **Desktop High:** moderate, leaning substantial.
- **Phone Low:** moderate.

| Clause | Result |
|---|---|
| Paving like stone | Met on both tiers: the clearest gain |
| Doors like wood | Met on both tiers |
| Walls like plaster | Met on High, but subtle; marginal on Low |
| Convincing scale and depth | Met for the cobbles; partial overall, as walls still read as flat planes |
| Opponents identifiable in shade | Met on High (Luna's blouse back to teal, Sol's marigold restored); Low unchanged |
| Roofs like terracotta | Not addressed, by decision: the eaves are small slivers at player height |

## Cost: new materials against classic in the same build

| | Desktop High | Phone Low |
|---|---|---|
| Draw calls, route stations | +1 to +4 | identical |
| Triangles | +250 to +2.6k | identical |
| Texture memory | 9.2 to 16.9 MB | 6.3 to 6.9 MB |
| Shader programs | 38 to 40 | 38 |
| Median render, software (SwiftShader) | 613 to 664 ms (+8 %) | 150 to 180 ms (+20 %) |
| Download | +295 KB | +33 KB |

- **El Patio load, software renderer:** 3.2 s to 4.5 s, from texture decoding and compiling the
  standard material. Plaza and Fiesta load times are unchanged (`perf-maps.ts`, Medium).
- **Texture memory on other maps:** the El Patio textures stay on the GPU after a switch to La Plaza
  or La Fiesta, about 8 MB on Medium/High and 1 MB on Low.
- **Characters:** the shade fix adds no program, texture or draw, plus three ray tests per character
  per frame on High and Medium.

## Checks

- **Unit:** 580/580. Typecheck clean.
- **Quality switching:** 27/27.
- **Campaign:** unchanged; mean pixel difference 0.08 of 255 against the baseline.
- **Killcam (desktop group): unresolved.** It is timing-sensitive on the software renderer, and the
  failing checks change from run to run:
  - **Materials build, 23/25:** "plays to its end in real time" took 1.96 s against 1.5 s +/- 0.4 s
    (7 frames), and the repeated-deaths replay count was off by one.
  - **Release candidate, 27/29:** "chancla in flight" sampled no projectile, and "Esc holds the
    replay" found no replay active.
  - **Replay mechanism:** a replay is recorded once per frame and is skipped ('late') if it cannot fit
    before respawn. At 0.2-1 s per frame that fallback is expected.
  - **Not established:** that every failure is that fallback. On a real device it is a device check:
    the replay plays, Esc and Skip work, and control returns on every death.
  - **Online killcam** (`killcam-mp-e2e`) passes.

## Limits

- Walls are the largest surface and show the smallest gain.
- The cobbles are the most photographic element in the scene.
- The plaza floor and the roofs now look flatter by comparison.
- La Plaza and La Fiesta now look less finished than El Patio.
- All timings are software-rendered. Real-device GPU cost is not measured.
