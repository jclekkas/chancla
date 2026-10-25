# Rosa candidate asset: contract

The candidate is a **Blender-built Rosa** (Sol first): one connected,
deliberately modelled mesh per quality tier, skinned at runtime to the
existing joints. The animation (rosa-anim.ts) keeps rotating the same
THREE.Group joints at the RIG positions (rosa-rig.ts). Nothing in the
animation, hit detection, timing or gameplay changes.

## Toolchain

- **Blender 5.2.3** as a Python module, installed in a venv at `/home/user/bpyenv`, created with
  `python3 -m venv /home/user/bpyenv && /home/user/bpyenv/bin/pip install bpy`. It is free and
  open source.
- **Editable sources:** `assets/rosa/` (Python build scripts, palette, any authored image sources).
- **Build:** one command rebuilds the exports from source:
  `/home/user/bpyenv/bin/python assets/rosa/build.py`, which writes
  `public/models/rosa-sol-{high,medium,low}.glb` and a `.blend` source file next to the scripts.
  It is deterministic: the same sources give the same exports.

## Space and rest pose (three.js space, as the game sees it)

- **Axes:** metres, y up. Rosa faces -z, her right is +x, and her feet are at y = 0.
- **Blender:** three (x, y, z) = Blender (x, -z, y). In Blender she faces +Y, and the glTF
  exporter's +Y-up conversion does the rest.
- **Rest pose:** the RIG rest. The legs hang straight down, and the arms hang straight down at
  her sides with clearance from the bodice and skirt. Every joint has zero rest rotation.
- **Joint positions** (root space; from rosa-rig.ts RIG):

  | Joint | Position (x, y, z) |
  |---|---|
  | hips | (0, 0.86, 0) |
  | torso | = hips |
  | head (neck base) | (0, 1.44, 0) |
  | armR / armL (shoulder) | (+-0.22, 1.30, 0) |
  | foreR / foreL (elbow) | (+-0.22, 0.98, 0) |
  | wristR / wristL | (+-0.22, 0.67, 0) |
  | legR / legL (hip joint) | (+-0.10, 0.81, 0) |
  | shinR / shinL (knee) | (+-0.10, 0.41, 0) |
  | footR / footL (ankle) | (+-0.10, -0.02, 0) |

  The ankle sits at -0.02; the sole is at y about 0.

- **Extra bones** (secondary motion; the animation rotates or scales them):

  | Bone | Parent | Position (root space) | Notes |
  |---|---|---|---|
  | `skirt` | hips | (0, 0.94, 0), waist level | Hips + SKIRT_PIVOT 0.08. Crouch scales and tilts it. |
  | `hatBrim` | head | | Optional. |
  | `bun` | head | | Optional. |

## Gameplay bounds (must stay visually consistent; hitboxes do not change)

- **Body:** a cylinder of radius 0.36 m from y 0.30 to 1.27.
- **Head:** a sphere of radius 0.25 m centred at y 1.52.
- **Height and eye:** standing height 1.72 m, with the hat brim allowed slightly above. The eye is
  at y 1.58.

## GLB layout (one file per tier)

- **Skinned mesh:** a single mesh, one primitive, named `rosa`, skinned to an armature whose bone
  names are exactly the joint names above. Bones not listed are ignored.
- **Attributes:**
  - POSITION and NORMAL (smooth where the form is smooth).
  - JOINTS_0/WEIGHTS_0: at most 4 influences, normalized.
  - COLOR_0: vertex colours taken only from the palette in `assets/rosa/palette.json`, which
    mirrors ROSA_COLORS[0] and ROSA_SHARED in rosa-materials.ts. The runtime snaps each vertex to
    the nearest palette colour, so the accepted arena skin shading still finds skin.
  - `_INK` (float): 0 for the surface and 1 for the ink hull. The hull is an inverted, slightly
    inflated shell in the same mesh, with flipped winding. Negative values are face tags:
    - -1: eyes (they close toward the lid line)
    - -2: her left brow
    - -3: her right brow
- **Face rig:** stored in the GLB scene extras (`faceRig: { lidY, browIn, browOut }`), in root
  space (head-local + 1.44).
- **Rulero placements:** four empties `rulero_0..3`, in root space at rest. Their scale is the
  roller size relative to `ruleroGeometry()`. Ruleros stay the game's instanced pieces, on the
  head joint.
- **Weapons:** stay the game's meshes on wristR (heldChancla / heldPesada). The right hand must
  close around them as the current hand does.
- **Materials:** none are needed. The game draws the mesh with rosaMaterial(faceRig, face,
  { arena: true }), or the same material with a small shared atlas `map` if the asset provides
  `TEXCOORD_0` and `public/models/rosa-atlas.png`. The atlas is optional: at most 512x512, shared
  by all tiers.

## Budgets per character (current Sol arena look, measured, in brackets)

| Tier | Draws (body) | Triangles (incl. hull) |
|---|---|---|
| High | 1 | at most 16k [18 draws, 12.9k] |
| Medium | 1 | at most 10k [18, 8.9k] |
| Low | 1 | at most 5k [16, 4.4k] |

- **Plus the game's own parts:** the weapon in hand, 2 instanced rulero draws, and the bubble and
  stars when shown.
- **Low:** must keep the face (eyes, brows, glasses, lips), the hat and the silhouette.
- **Download:** each GLB at most 400 KB raw; loaded only when the candidate is switched on.

## Runtime (src/fps/render/rosa-candidate.ts)

- **Loading:** `loadRosaCandidate(quality)` fetches and parses the tier once (cached). Building an
  Avatar stays synchronous. If the tier is not loaded yet, the Avatar falls back to the current
  model.
- **Building:** `buildRosaCandidate(team, quality)` returns a RosaModel:
  - the same joint Groups at RIG positions;
  - a `THREE.Bone` child at identity under each joint;
  - a SkinnedMesh bound with inverses computed from the rest pose;
  - extras.skirt / hatBrim / bun as Groups that the animation drives;
  - weapons, ruleros, stars and the bubble as in rosa-model.ts.
- **Scope:** Sol only (team 0) and arena only. The current model stays the default and the
  fallback. Campaign and Arcade are never affected.
