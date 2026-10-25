# Character and first-person model upgrade, HUD readability

Offline preview only. This change applies to arena matches, in Practice and Online, under both
Classic and ¡Puro Chanclazo!. Campaign keeps the original Rosa and hand: its matched shot is
pixel-identical in the scene, and only the hand bob timing differs. Arcade, gameplay, hitboxes,
networking and the environment are unchanged.

## What changed

### Rosa (third person, both teams, `src/fps/render/rosa-arena.ts`)
- **Head and face.**
  - The head is a shaped shell instead of an ellipsoid: forehead, brow, round cheeks, soft jowls
    and a small chin.
  - A rounded nose with a bridge, fuller lips with a smirk, and bolder arched brows.
  - Bigger cat-eye frames with a thicker rim.
  - A test checks that brows stay above the frames and eyes behind the lenses through the most
    extreme blink and expression.
- **Neck, shoulders and torso:** a wider neck base, a sloping shoulder line, a gentle bust and a
  cinched waist with the sash. Sol's scalloped collar follows the shoulder slope, and Luna's
  capelet is refitted.
- **Arms:** gathered puffed sleeves with cream cuffs, and plumper arms.
- **Skirt.**
  - A bell shape with deeper folds and valley shading.
  - A team-colour flounce below the knee, ruffled with a scalloped hem on High and Medium, over a
    cream petticoat edge.
  - It is the same width at hand height, so the hands don't sink into it.
  - Crouch clearance is tested, and the old knee problem stays fixed.
- **Hair and ruleros:** fuller hair at the back, and Sol's bun carries a band in the team trim. The
  ruleros keep their placement and still detach.
- **Unchanged:** Sol's hat, Luna's hood and rebozo, the team colours, the weapons, the rig, the
  animation contract, blinks and expressions, the skirt motion and the hit volume.
- **Isolation:** the new look is opt-in (`new Avatar(team, { arena: true })`, from the engine
  only). A snapshot test pins every non-arena look, so campaign gets exactly the old meshes.

### First-person hand (`src/fps/render/fp-hand-arena.ts`)
- **Fingers:** smooth tubes with knuckle and joint swellings and red nails. They wrap La Chancla's
  edge and curl onto the footbed, and hook round La Pesada's heel.
- **Thumb:** thicker, with a broad pad pressing opposite the fingertips.
- **Palm and wrist:** one soft mass narrowing into a round wrist.
- **Forearm:** runs under loose, outlined bangles to a rolled cuff.
- **Intersections:** skin vertices inside the weapons went from 7 and 3 to 0 and 0.
- **Motion is identical:** same rig, frames and grip transforms, within 1e-9 in tests. That covers
  both swings, throws, the lower/swap/raise switch, look lag and reduced motion.
- **Isolation:** campaign uses the same engine viewmodel, so the hand switches at runtime. The
  engine calls `vm.setArena(!!world.light)` whenever the world changes, so arena maps get the new
  hand and campaign layouts the original.

### HUD readability
- **Nameplates:**
  - Narrower, with ellipsised names and a slim health bar.
  - Near players show the role word (◆ ALLY / ✖ ENEMY); mid-range players show the glyph only;
    far players are small and faded.
  - Allies and enemies differ by shape and outline, not only colour: ◆ and a white outline against
    ✖ and a dark ring, plus ☀/☾.
  - A nearest-first declutter lifts or fades overlapping tags. Tags slide out from under the
    minimap, the chips and Menu.
- **Mode chips:** PRACTICE and ¡PURO CHANCLAZO! share one compact, low-contrast line.
- **Cafecito hint:** also avoids the fixed HUD pieces, and picks the smallest move clear of tags.
- **Mobile:** the small "≡" button under Menu is the scoreboard toggle (`#ft-score`; the touch
  equivalent of Tab). It now shows a podium icon with "Scores" / "Marcador", has an aria-label and
  `aria-pressed`, and a 48 px hit area. Its function is unchanged. The killfeed moved left to
  clear it, and the melee button's label now fits its circle.

## Cost

These are exact renderer counts per whole frame (scene, shadow and hand passes), averaged over
about 32 frames, in matched views:

| | Before (a0668c2) | After | Delta |
|---|---|---|---|
| Desktop High, frame | 121 to 132 draw calls, 123k to 133k tris | 122 to 133 draw calls, 135k to 148k tris | +1 draw call (+4 in one view against a low baseline reading), about +14.8k tris |
| Phone Low, frame | 76 to 85 draw calls, 47k to 64k tris | 77 to 86 draw calls, 53k to 70k tris | +1 draw call, +6.0k tris |
| Rosa per avatar, High | 18 draws, 10.3k to 10.4k tris | 18 draws, 12.7k to 12.9k | +0 draws, +2.5k tris |
| Rosa per avatar, Medium | 18 draws, 7.2k to 7.2k | 18, 8.8k to 8.9k | +0 draws, +1.7k tris |
| Rosa per avatar, Low | 16 draws, 3.9k to 4.2k | 16, 4.4k to 4.7k | +0 draws, +0.5k tris |
| Hand pass | 8 / 7 draws, 5.6k / 4.9k tris | 9 / 8 draws, 10.6k / 10.0k tris | +1 draw (outline on the trim), +5k tris |

- Textures are unchanged, and materials are shared (the hand went from 5 materials to 4).
- Download: +8.3 KB gzipped JavaScript.
- Building an arena look is a one-off per team and tier: about 100 ms on High, 46 ms on Medium and
  31 ms on Low (Node). Per-frame animation and viewmodel cost is unchanged.
- Frame times here come from software rendering and are not evidence for any device.

## Checks

- Typecheck and builds pass.
- Unit and multiplayer: 546 of 546, in 53 files. These include the real-server multiplayer tests
  (melee-only, rematch, reconnect, and clients agreeing on hits and eliminations). New test files:
  - `tests/rosa-arena.test.ts` (34 tests)
  - `tests/fp-hand-arena.test.ts`
  - `tests/hud-nameplates.test.ts`
- Browser checks on the final build:
  - `scripts/puro-e2e.ts`: 20/20. This covers Classic and ¡Puro Chanclazo!: selectors, both
    attacks from the primary button, weapon switch, pause, killcam attribution, the phone Slap
    button, jump and Menu.
  - `scripts/minimap-e2e.ts`: desktop 14/14, phone 4/4. Two desktop checks failed in the first run;
    both counted at the wrong moment on the slow renderer and pass after those checks were fixed.
  - The brief-press fix was re-verified with a trace on the final build: 4 presses, 4 throws.
- Campaign isolation: a matched campaign shot shows the original hand and an identical scene.

Everything ran in Linux Chromium with SwiftShader, with an emulated phone. Nothing was run on a
real Mac, in Safari or on a real phone.

## Limits

- **Distance:** at 1.5 m Rosa is clearly redesigned. At 5 m the shoulders, puffed sleeves, collar,
  waist and flounce read, but the change is moderate. At 10 m she is close to the old silhouette.
  At 5 m and beyond the face reads mainly through the glasses and lips, because the skin stays dark
  under this lighting and the palette is unchanged.
- **The hand has one tier:** the viewmodel doesn't know the quality setting, so phone Low pays its
  +5k triangles too. (Resolved later: see `docs/character-shading/README.md`, Medium and Low hand tiers.)
- **La Pesada's thumb** still reads a little like a pointing finger. (Resolved later: see
  `docs/character-shading/README.md`.)
- **Small omissions:** there is no outline on the flounce ruffles, and Low has no ruffle.
- **Nameplates:** a lifted tag can sit up to about 40 px above its player's head, with no leader
  line. On older browsers without `:has()`, an empty mode pill may show on touch in practice.

## Mac and phone checklist

1. **Practice at High:** look at both teams at about 2 m and 5 m: face shape, glasses, puffed
   sleeves, waist and the ruffled flounce. Crouch next to a bot and check the skirt doesn't open
   at the knees.
2. **First person:**
   - Press 1 and 2: fingers wrap each chancla, with no hand cutting through it.
   - El Chanclazo and El Revés (V, and click in ¡Puro Chanclazo!) look and time as before.
   - The weapon switch still lowers, swaps and raises.
3. **Campaign:** start a mission; Rosa and the hand look as they always did.
4. **Fight two or three bots at mid range:** tags don't stack; near ones say ALLY/ENEMY and far
   ones are compact.
5. **Phone:**
   - The button under Menu reads "Scores" and toggles the scoreboard.
   - The cafecito hint stays off the crosshair, tags and controls.
