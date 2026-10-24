# La Plaza and La Fiesta at El Patio's quality

Offline preview only. This is a visual change only: `shared/` (map data,
collision, cover, sight lines) is untouched, and each map keeps its layout
and identity. El Patio is unchanged: the same draw calls and triangles in
every view, and pixel differences only where things animate
([compare-patio-unchanged](compare-patio-unchanged.jpg)).

## What changed

- **Shared (lead).** The approved El Patio kit (`section.ts`) now draws
  every arena map's houses, walls, arcades, lintels, steps, planters,
  crates and bins from the boxes. That covers windows, shutters, balconies,
  cornices with tile eaves, base bands, blind arcades, tiled planters and
  benches, with the kit's materials, paving, lighting and skyline roofline.
  - Each map gets its own floor zones. The open square is warm. The lanes
    and arcade walkways are dustier and greyer. Each team's spawn court has
    its tint.
  - El Patio's own parts stay El Patio's: the café and Panadería hero
    blocks, the fountain rings, and its fountain, statue and kiosks.
  - A per-map hook (`map-dressing.ts`) routes each map's identity props to
    its own module.
- **La Plaza** (`plaza-dressing.ts`, 7 draw calls):
  - **Market stalls:** panelled painted cabinets, counters, produce trays.
  - **Awnings:** pitched, striped, on wooden frames, with scalloped
    valances.
  - **Stages:** plank decks, violet skirts, panels.
  - **Fountain:** a tiled basin like El Patio's, with the same water, and a
    pedestal column with four spouts and arcs.
  - **Kiosks:** reuse El Patio's kiosk (AGUAS FRESCAS gets its own paint).
  - **Trees:** bark trunks and shaded foliage.
- **La Fiesta** (`fiesta-dressing.ts`, 8 draw calls):
  - **Hedges:** clipped hedges on cantera kerbs, still full cover (a
    raycast test checks).
  - **Party tables:** pleated cloths, serape hems, a runner, and cazuelas
    and flowers.
  - **Gifts:** polka-dot wrapped stacks with ribbons and bows.
  - **Stages:** pleated skirts with a papel picado valance.
  - **Dance floor:** a round tile mosaic with a star medallion, flush with
    the ground.
- **Low** drops the small details (fruit, mouldings, pleats, blossoms,
  table goods, valances, water arcs and motion) and casts no shadows from
  the new props.
- **Bounds.** Tests check that, below head height, everything stays inside
  its box's footprint (6 cm of trim) and nothing solid rises above its box.
  The exceptions are the awnings and tree canopies the maps already had
  above head height, and La Plaza's thin water arcs.

## Matched captures

The same spots, the same build flags, before (54339ad) and after, with
the HUD and hand hidden:
- La Plaza: [High](compare-plaza-high.jpg), [Low](compare-plaza-low.jpg),
  [phone on Low](compare-plaza-phone-low.jpg).
- La Fiesta: [High](compare-fiesta-high.jpg), [Low](compare-fiesta-low.jpg),
  [phone on Low](compare-fiesta-phone-low.jpg).

## Cost (exact renderer counts, Chromium with SwiftShader)

Whole frame per view, before to after
([costs-before.json](costs-before.json), [costs-after.json](costs-after.json)):

| Map, quality | Draw calls | Triangles |
|---|---|---|
| La Plaza, High | -37 to -38 (160 to 122 at market-west) | +55.5k (57.6k to 113.2k) |
| La Plaza, Medium | -37 to -38 | +47.8k |
| La Plaza, Low (desktop and phone) | -19 to -20 | +12.7k |
| La Fiesta, High | -26 to -27 (146 to 119 at tables-west) | +47.0k to +48.1k |
| La Fiesta, Medium | -26 to -27 | +27.1k to +28.3k |
| La Fiesta, Low (desktop and phone) | -12 to -13 | +3.1k to +4.2k |
| El Patio, all | 0 | 0 |

- **Totals now match El Patio.** Fewer draw calls (everything merged per
  material) and more triangles, roughly half of them from the shadow pass.
  La Plaza's High frame is 113k triangles, the same as El Patio's (115k).
- **Download:** 413.2 KB to 422.1 KB of gzipped JavaScript (+8.9 KB). No
  binary assets.
- **Frame times here** are software rendering and are not evidence for any
  device.

## Run it on the Mac (real GPU)

From the repository on the M4 Mac, with Google Chrome installed:

```
npm ci
GRAPHICS_EXPERIMENT=1 npm run build
npm run capture:maps -- --gpu
```

- **Output:** stills of every view on all three maps at High, Medium and
  Low, plus a `costs.json` in `artifacts/map-capture/`.
- **Per view:** draw calls, triangles, and median and 95th-percentile frame
  times over 2 s. It also records which GPU actually rendered.
- **Options:**
  - `MAPS=plaza QUALITIES=high` narrows the run.
  - `PHONE=1` adds a phone-sized view.
  - `CHROMIUM_PATH=...` uses another Chromium-based browser.

It has not been run on a Mac yet. No GPU or real-device result is claimed
until it is.

## Checks

- Typecheck and offline build: pass. No production server address is in
  the bundle.
- Unit and multiplayer: 433/433, all suites. That includes the new
  `tests/plaza-dressing.test.ts` and `tests/fiesta-dressing.test.ts` (bounds,
  draw calls, shadow casting, hedge opacity, ground shadows flat) and
  `tests/patio-focal.test.ts`.
- Captures: 39 matched views, before and after.
- Every map loads in practice and plays (the capture runs a practice
  match on each).

## Remaining issues

- **La Fiesta's hedges** read dark in the dusk light. That's the lighting,
  not the material.
- **La Plaza's produce** sits below the tray rim, so from eye height it
  reads mostly as coloured heaps.
- **Looking up from under a La Plaza awning** shows several frame beams.
- **Close views:** the standard views don't frame La Plaza's kiosks or
  fountain pedestal closely. The Fiesta workstream checked its props in
  close-ups.
- **The capture spots** are fixed, eye-height views. A free walk on the Mac
  is the real review.
