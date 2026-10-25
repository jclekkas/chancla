# Rosa candidate model (Sol): results

Offline preview only, and Sol only, in arena matches. The current model stays the default and the
fallback. Campaign and Arcade are unchanged.

- **Contract:** `CONTRACT.md`.
- **Asset sources and rebuild:** `assets/rosa/README.md`.

## How to compare old and candidate

1. Open the offline preview, then Settings, and tick **"Preview: new Rosa model for team Sol"**.
   - The box only exists in experiment builds.
   - The model loads in the background (about 130 to 370 KB) and Sol characters are rebuilt
     without restarting the match.
   - Untick it to return to the current model in the same match.
2. Start **Practice** (El Patio, one ally, two opponents). Your teammate Lupita (Sol) uses the
   candidate and the Luna opponents use the current model, so both are on screen together.
3. Changing quality keeps the candidate, with its own High, Medium and Low file.

**Scripts:** `ROSA=candidate` turns it on in `scripts/rosa-shots.ts`, `rosa-motion.ts`,
`milestone-shots.ts`, `killcam-e2e.ts`, `puro-e2e.ts` and `quality-switch-e2e.ts`. Run once with
and once without it, on the same build, for matched pairs.

## What was built

- **Workflow:** Blender 5.2.3 (the free `bpy` Python module), fully scripted and deterministic. The
  same sources give byte-identical GLBs; this was re-checked in the integration tree.
- **The body:** torso, neck, arms and hands are one connected surface: a Skin modifier over a
  vertex skeleton, then Subdivision. Sleeves, waist and bust are shaped on that surface rather than
  stuck on.
- **The head:** one sculpted form (cheeks, jaw, nose, brow ridge, chin) with eye and brow shells,
  so the existing blink and brow shader works.
- **Clothing and hair:** hair with seats for the ruleros, the hat on its own brim bone, and a bell
  skirt with folds and a flounce on the existing skirt bone.
- **Weights:** scripted per region, not automatic.
- **Ink outline:** in the same mesh, as before.
- **Runtime** (`src/fps/render/rosa-candidate.ts`):
  - One SkinnedMesh bound to the existing joint groups. The animation, timing, hit detection and
    hitboxes are untouched.
  - Colours are snapped to the palette, so the accepted arena skin shading still applies.
  - Ruleros, weapons, stars and the bubble are the game's own.

## Cost (exact renderer counts; Linux Chromium with SwiftShader, not a real device)

| Per character (Sol alone, weapon in hand) | Current | Candidate |
|---|---|---|
| High | 18 draws, 12,920 tris, 14 shadow casters | 4 draws, 16,075 tris, 2 shadow casters |
| Medium | 18 draws, 8,874 tris | 4 draws, 10,915 tris |
| Low | 16 draws, 4,388 tris | 3 draws, 5,282 tris |

The body mesh is 14,983 / 9,823 / 4,878 tris including its outline, within the 15k / 10k / 5k
budget. The rest is the weapon and ruleros.

| Whole frame, 1 Sol + 2 Luna in view (same page, same state) | Current | Candidate |
|---|---|---|
| Desktop High | 165 calls, 172.5k tris | 139 calls, 179.2k tris |
| Phone Low (844x390) | 102 calls, 68.1k tris | 89 calls, 69.0k tris |

- **Bigger crowds:** practice allows only one Sol bot, so these were not measured. Per Sol on
  screen, by arithmetic: High -14 draws and +3.2k tris; Low -13 draws and +0.9k tris.
- **Textures:** none added. The skeleton adds one tiny bone texture per candidate (17 bones, a few
  KB).
- **Shader programs:** +3 on High (the skinned variants of her material and of the shadow-depth
  material) and +1 on Low (no shadows). These are compiled once and shared by every candidate.
- **Download:**
  - The model files load only when the candidate is switched on: 367 / 246 / 128 KB for High /
    Medium / Low, with a fetch of 12-21 ms locally.
  - The glTF loader is a lazy 44 KB chunk.
  - The upfront JavaScript grows by 10.2 KB gzipped.
- **Switching on:** 28-79 ms from switch-on to rebuilt characters, on this software renderer.
- **Stability:** three rounds of on/off at each tier give identical geometry, texture and program
  counts in every state (`rosa-candidate-soak.ts`).

## Checks

- Typecheck and build pass.
- **Unit and multiplayer:** 573/573. They include `tests/rosa-candidate.test.ts`:
  - CPU skinning against rigid joint transforms;
  - fallback before load, and Luna, campaign and home unaffected;
  - dispose never frees shared geometry.
- **With the candidate on, in the final build:**
  - `quality-switch-e2e.ts`: 34/34 (seven mid-match quality changes; the candidate is rebuilt for
    each tier).
  - `killcam-e2e.ts`: 29/29.
  - `puro-e2e.ts`: 20/20 (Classic and ¡Puro Chanclazo!, switching, pause, touch).
- **Campaign:** with the candidate setting on, the matched mission shot is pixel-identical to the
  previous build.
- **Arcade:** it never imports the Rosa avatar code.
- **Animation range in game:** walk, strafe, crouch, jump, throw, El Chanclazo, El Revés, head hit,
  elimination and respawn. No tearing, candy-wrapping or legs through the skirt were seen.
- **Asset checks** (`assets/rosa/verify.mjs`):
  - bones, attributes, weights and winding are correct;
  - every vertex between 0.30 and 1.45 m is inside the body cylinder;
  - outside the head sphere: only the hat brim (up to 0.25 m) and the hat band.

## Assessment

**Improved:**
- One cohesive figure: sturdy, rounder proportions with real shoulders.
- Plump arms that flow into puffed sleeves.
- A bell skirt and flounce that read at 5 m, and a better-shaped hat.
- Ruleros sit on the hair under the brim.
- Draw calls drop from 18 to 4 per character.

**Not better, or weak:**
- **The face:** about level with the current one. The eyes and glasses are back to her comic scale
  after the face pass, but the face still reads somewhat mask-like, and the nose is subtle from the
  front.
- **Hands:** mitten-like.
- **Skin:** shows facets on High.
- **Low tier:** the collar becomes a plain band and the hem is visibly faceted.
- **Distance:** at 10 m it is close to the current model.

**Recommendation:**
- Keep the pipeline and this body as the base for the next step. It is the first version that can
  improve without adding draw calls.
- Do not adopt it for both teams yet. First do one more face pass (nose and mouth volume, softer
  skin normals) and a Luna variant, then review again.
