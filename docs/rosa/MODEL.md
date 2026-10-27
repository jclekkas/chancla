# Rosa: model and materials

Owner: agent A. Files: `src/fps/render/rosa-model.ts` (assembly, looks,
quality tiers), `src/fps/render/rosa-geo.ts` (loft, part baking, ink hulls,
small shapes), `src/fps/render/rosa-materials.ts` (palette, the one toon
material with the ink hook), `scripts/rosa-shots.ts`, `tests/rosa-model.test.ts`.

## What changed

The old Rosa was 50 to 60 separate primitive meshes (capsule limbs, a
sphere head, a box mouth, opaque black lenses, a floating plane apron, and a
skirt whose outline drew over it, so it read nearly black). The new one is
designed as one character:

- **Construction.** Every rigid joint is one mesh: its pieces (lofted
  rings for bodice, skirt, sleeves, hat, hood, feet; ellipsoids for the
  face) painted in vertex colours and baked together with their inverted
  hulls. One `MeshToonMaterial` per avatar (the world's `toonRamp`), cloned
  only for the hit flash (`flashMats = [it]`). Hull vertices carry
  `ink = 1`; the shader paints them flat ink and pushes them 11 mm away from
  the camera, so outlines show at silhouettes and not in creases. Hulls are
  built from coarser proxies of each piece. Zero-area triangles from loft
  poles are dropped.
- **Proportions.** A cartoon big head (drawn 1.12x about the neck), a
  sturdy rounded torso with a full bust and rounded upper back, short neck,
  big mitten-plus-thumb hands.
- **Face.** Large eye whites with dark irises (and a highlight on High),
  red cat-eye frames with clear lenses (the eyes read through them), thick
  arched brows set low at the inner ends (feisty), rosy cheeks, a nose, big
  red lips with a slight smirk, gold hoop earrings (Sol and home, High).
- **Hair.** Grey-black cap tilted back (its rim is the hairline) and a low
  bun. The four match rollers sit on the hair surface (placed by the hair
  ellipsoid's normal, sunk 12 mm), slots 0-1 across the front hairline,
  2-3 at the temples (Sol, under the brim) or at the front corners (Luna,
  out of the rebozo). Same `rulMesh` / `rulOutline` / `rulPlace` contract,
  roller index order and `RULERO_COLORS`; all under `head`.
- **Clothing.** Short puffed sleeves in the team colour with an
  embroidered band (covers the shoulder joint in every pose), bare forearms
  with a gold bangle at the wrist (hides the hand's roll), a sash with a bow
  at the back, a row of embroidered flowers on the blouse. Full dark navy
  skirt with restrained folds (deepening to the hem, valleys shaded) and a
  team-colour hem band with cream and pink flowers. Sol: a scalloped linen
  collar and a wide, wavy, banded straw hat tipped back, terracotta band and
  pink flower. Luna: a deep-teal rebozo as a hood (pale border framing the
  face, drape folds, stripe at the hem), a capelet, and one striped end
  thrown forward over her right shoulder. Badge on the back: a terracotta
  patch with a gold sun, or a violet patch with a pale crescent.
- **Footwear.** Bare feet in flip-flops: violet sole, turquoise footbed,
  terracotta V strap, toes on High.
- **Weapons.** Still `weapons[0]`/`[1]` in `wristR`, scale 1.15 (was
  1.25). Held by the heel: the heel ends in the middle of the fist and the
  sandal runs out past the knuckles; footbed still faces +z, so the swing's
  wrist roll keeps working. La Chancla is the shared lite `chanclaModel`;
  La Pesada is a copy of the first-person clog geometry (one draw instead of
  ten). Low uses a few-hundred-triangle chancla and clog of the same design.
- **Campaign home look.** No hat or hood, six curlers (one mesh each, own
  ink) on the crown, `setRuleros(n)` unchanged.
- **Extras.** `extras.skirt` is the skirt mesh, pivot at the waist.

## Quality tiers

| | High | Medium | Low |
|---|---|---|---|
| Segments (body / skirt / limbs) | 18 / 28 / 10 | 12 / 18 / 8 | 8 / 10 / 6 |
| Outlines | everything incl. hands, nose | large forms and limbs | body, head, hat/hood only; rollers without outline |
| Details | all (earrings, highlights, toes, bow, embroidery, hem flowers) | hem flowers, blush, pleats, temples | none of those; face, frames, brows, lips kept |
| Shadow casters | 13 joints + weapon | 9 joints + weapon | none |
| Other | | | left hand baked onto the forearm (wristL has no mesh), light weapons |

## Cost per Rosa (Chromium/SwiftShader, `scripts/rosa-shots.ts` cost.json, each Rosa rendered alone)

| | Draws | Shadow casters | Triangles | Budget |
|---|---|---|---|---|
| Baseline Sol / Luna (any quality) | 60 / 50 | 49 / 39 | 8,256 / 8,522 | |
| High Sol / Luna | 18 / 18 | 14 / 14 | 10,294 / 10,236 | 36, 14, 12,000 |
| Medium Sol / Luna | 18 / 18 | 10 / 10 | 7,106 / 7,182 | 26, 10, 8,000 |
| Low Sol / Luna | 16 / 16 | 0 / 0 | 3,846 / 4,192 | 16, 0, 4,500 |

(Chancla in hand; La Pesada adds about 80 triangles on High/Medium.) The
bubble (+1 while protected) and the stars (+1 while eliminated) are extra,
as before. Materials per Rosa: 4 (her toon, roller, chancla, bubble); 3 on Low.

- **Textures:** none. Everything is vertex colour: 0 KB of character
  texture memory.
- **JS:** about 11.3 KB gzipped for the three files (model 7.9, geo 2.3,
  materials 1.0), replacing 2.8 KB: about 8.5 KB added.
- **Memory:** geometry is baked once per (team, quality, home) and marked
  shared; an avatar allocates only its material, roller instances and
  bubble material. Building and disposing 3 avatars 8 times leaves
  `renderer.info.memory` unchanged (124 geometries, 21 textures).
- Building a look the first time takes 30-200 ms in Node (once per look).

## Tests and captures

`npx vitest run tests/rosa-model.test.ts`: budgets per quality and team
with each weapon, rig joints at RIG with zero rest rotation, parents per
the contract, no textures, bounds (body inside the 0.36 m cylinder, head
and hood inside 0.31 m of the head centre, soles on the ground, standing
height), four rollers on the hair in slot order, the home look's six
curlers, shared cached geometry, disposal frees only per-avatar resources.

`DIST=... OUT=... PORT=... node --import tsx scripts/rosa-shots.ts`
works on the old build too (it uses only `window.__fps` and the page's own
Avatar class).

## Known limitations

- The straw hat (brim radius about 0.39 m, crown top 1.84 m) and the
  rebozo's back (up to about 0.31 m from the head centre, its drape on the
  shoulders) reach past the head hitbox sphere, as the old hat did.
- Skirts are rigid with the hips: in a deep crouch the thighs come out of
  the front of the skirt (as before).
- Low has no wristL mesh; if the animation ever rotates wristL, the left
  hand will not follow on Low.
- The hood's face opening is made by folding loft columns; at grazing
  angles you can see the hood's thickness at the visor edge.
- No open-mouth "hit" face variant.
- The held sandals are slightly smaller (1.15 vs 1.25) so a fist can hold
  them by the heel; the clog's heel is still wider than the fist.
