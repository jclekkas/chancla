# Next environment milestone: what to take from the Crossline prototype

- **Source:** Crossline prototype (one HTML file, Three.js).
- **Scope:** reviewed for its building rules, material batching, distant scenery and per-map
  atmosphere.
- **Status:** reference only. Nothing here goes into release candidate 1, and nothing is to be built
  until the release review is done.
- **Out of scope:** its engine, heightfield collision, navigation, bots, controls and UI.

## Already covered by Chancla (no gain)

- **Material batching:** Crossline merges geometry per material, with vertex-colour tints and UVs
  measured in metres. Chancla's kit already merges per kind the same way, and it now has sourced
  textures in place of Crossline's canvas noise.
- **Contact shading:** Crossline darkens the bottom vertices of each face. Chancla's baked occlusion
  field does this better.
- **Sky:** Crossline has a gradient sky with a sun disc. Chancla's themes already have the
  equivalent.
- **Facade detail:** Crossline's per-floor bands, windows and doors on its houses are covered by the
  El Patio kit and the lane-wall dressing.

## Opportunities, ranked by visible impact against effort

### 1. A layered skyline that recedes into fog (high impact, low effort)

- **Chancla today:** one ring of 26 plain boxes about 40-50 m out, with no windows. Fog is the same
  45-140 m on every map. In the plaza and in every alley end, the horizon reads as a row of coloured
  blocks.
- **Crossline:**
  - two or three depth bands of non-colliding boxes with a painted-window facade texture (65-190 m);
  - low hill silhouettes beyond them, and an outer ground mesh;
  - per-map fog near and far (55/360 and 80/520), so each band fades by distance.
- **Adapt:**
  - Two rings of skyline blocks, using a facade region added to our existing kit atlas: windows,
    shutters, roof edge.
  - One silhouette band of hills or the town behind.
  - Fog near and far per theme in `THEMES`.
  - Everything merged into one or two draw calls, with no collision. Low tier keeps a single ring.
- **Cost:** about 2-4k triangles, one atlas region, and no gameplay change.

### 2. Rules for roofline clutter (medium-high impact, medium effort)

- **Chancla today:** every roof ends in the same cornice and barrel tiles, so rooflines against the
  sky are uniform.
- **Crossline:** each lot rolls seeded extras:
  - water tanks;
  - rebar stubs on the corners;
  - antenna poles and a dish;
  - laundry lines between two posts;
  - parapets on taller houses.
- **Adapt:**
  - Seeded per house, placed only on roofs nobody can walk on and only above head height.
  - Visual only, built from existing kit kinds (`detail`, `flat`, `glass`), so no new draw calls.
  - It suits a Mexican barrio: tinacos (black water tanks), rebar, laundry.
- **Cost:** small triangle counts. The rule needs a guard against walkable roofs and against
  silhouettes that look like cover.

### 3. Overhead wires across the lanes (medium impact, low effort)

- **Crossline:** utility poles along paths, with sagging wires between nearby poles and from poles to
  rooftops. They are drawn as one `LineSegments` draw call.
- **Adapt:**
  - A few poles and catenary wires over El Patio's lanes, sharing the bunting's line batch where
    possible.
  - It adds depth overhead in the alleys, where the screen is mostly wall and sky.
- **Risk:** thin lines can shimmer on phones. Use a thin quad strip on High, or leave the wires off on
  Low.
- **Cost:** one draw call.

## Not taken

- the heightfield collision and navigation grid;
- the bots;
- weapons and FX;
- the minimap renderer;
- the procedural noise textures (ours are sourced);
- the city and sea layout, which belongs to Crossline's setting.
