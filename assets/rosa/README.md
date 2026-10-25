# Sol Rosa: the Blender-built candidate asset

Sources for `public/models/rosa-sol-{high,medium,low}.glb`. The contract the
files follow is `docs/rosa-asset/CONTRACT.md`.

## Rebuild

```sh
/home/user/bpyenv/bin/python assets/rosa/build.py            # three GLBs + assets/rosa/rosa-sol.blend
/home/user/bpyenv/bin/python assets/rosa/build.py --no-blend # GLBs only
node assets/rosa/verify.mjs                                   # contract checks (loads each GLB with three's GLTFLoader)
/home/user/bpyenv/bin/python assets/rosa/preview.py --tier high --out /tmp/rosa-renders  # views + pose tests
```

Blender 5.2.3 as a Python module (`pip install bpy` in a venv). The build is
deterministic: the same sources give byte-identical GLBs. `rosa-sol.blend`
holds the three tiers (one collection each, Medium and Low hidden) with the
armature, the skinned mesh and the rulero empties, for inspection or hand
editing; the GLBs are always rebuilt from the scripts.

## How she is made

Everything is generated in the game's space (metres, y up, facing -z, her
right +x) and converted to Blender only when meshes are created.

| Module | What |
|---|---|
| `rosalib/body.py` | Torso, neck, arms and hands as ONE connected surface: a Skin modifier over a vertex skeleton, Subdivision, then alternate horizontal edge rings dissolved along the limbs (`blend.thin_rings`). The cage is pulled toward analytic profiles (bust, back, cinched waist under a gathered sash, pleated sleeve puffs), painted by region (marigold bodice and puffs, cream cuffs, gold bangles, terracotta sash, skin) and weighted along the chains (torso to arm over the shoulder, smooth at elbows, wrists, waist and neck). The right fist sits on the weapons' heel as placed by `heldChancla`/`heldPesada`; the left hand is relaxed. |
| `rosalib/head.py` | The head as one lofted, sculpted form (nose with bridge and wings, muzzle, apple cheeks, eye sockets, brow ridge, chin), columns and rows packed toward the face. Eyes (tag -1), brows (-2 her left, -3 her right) are small shells; lips, blush, ears and hoops and the cat-eye glasses (bent a little to the face) are laid on it by ray casts. |
| `rosalib/hair.py` | One hair mass lifted off the skull (rolled front, full temples, volume at the back) ending in a tucked hairline, a low bun with a ribbon, and the rulero seats. |
| `rosalib/hat.py` | The straw sun hat: domed crown with the terracotta band and the pink flower, a wide wavy brim with woven rings; the brim blends onto the `hatBrim` bone toward its edge. |
| `rosalib/skirt.py` | The bell skirt: folds deepening to the hem, terracotta stitch band, ruffled marigold flounce with blossoms, cream petticoat edge, dark lining. On the `skirt` bone (the waistband on `hips`); the hem's front and back take up to 0.42 of the thigh on that side so strides and crouches push the cloth ahead of the knee. |
| `rosalib/legs.py` | Legs (thigh and knee in the lining colour, bare calves) and bare feet in flip-flops. |
| `rosalib/clothes.py` | Scalloped cream collar, sash bow and tails, the sun badge on the back, embroidered flowers (High). |
| `rosalib/blend.py` | Armature (every bone points up with no roll, so the glTF rest rotations are identity), assembly of all parts plus their ink hulls into one mesh, empties, export. |
| `rosalib/glbpack.py` | Repacks the export: colours snapped to the palette and stored as bytes, weights as bytes summing to 255, normals as bytes (`KHR_mesh_quantization`, read natively by three's GLTFLoader). |

### GLB layout

- One skinned mesh `rosa`, one primitive, no material. Attributes: POSITION,
  NORMAL, COLOR_0 (palette only, `palette.json`), JOINTS_0/WEIGHTS_0 (at most 4,
  normalized), `_INK` (float: 0 surface, 1 hull, -1 eyes, -2 her left brow, -3 her right brow).
- Bones: hips, torso, head, armR/L, foreR/L, wristR/L, legR/L, shinR/L, footR/L at
  the RIG positions with identity rest rotation, plus `skirt` (0, 0.94, 0) and
  `hatBrim` (0, 1.734, 0). No `bun` bone (the bun rides the head).
- Ink hull: each large form has an inverted, inflated copy (8-11 mm) in the same
  mesh, often from a lighter version of the form; face pieces, glasses, lips and
  other small details have none. Low keeps the hull on the silhouette forms
  only (none on forearms, hands, collar, bun).
- Scene extras: `faceRig {lidY, browIn, browOut}` (root space) and `rosa {team, tier}`.
- Empties `rulero_0..3`: rest placement of the four rollers in root space (two on the
  rolled front, one at each temple, as the current layout), scale 1 = `ruleroGeometry()`;
  the roller's axis is the empty's local +y.

### Palette

`palette.json` mirrors `ROSA_COLORS[0]` and `ROSA_SHARED` in
`src/fps/render/rosa-materials.ts`. Keep the two in step: the build refuses
colours that are not in the palette.
