# El Patio sourced textures: provenance

All three sets are Poly Haven assets, licensed **CC0 1.0** (public domain
dedication, https://creativecommons.org/publicdomain/zero/1.0/). No
attribution is required; it is recorded here for provenance.

They were not downloaded from Poly Haven (blocked from the build container).
The files were read from the MIT-licensed Riposte repository's mirror of the
same assets: `riposte-frontline-source` at commit
`31ca050d8ce59f4885c01a3237f68cdf186c9b60`, `assets/tex/<key>/{map,normal,rough}.webp`.
That repo's `NOTICE.md` item 6 states its textures are Poly Haven / ambientCG
CC0, and its `assets/tex/credits.json` maps each key to the original asset ID.
Only these image files and that JSON were read; nothing else (code, music,
branding, animation, logos) was taken.

| Here | Poly Haven ID | URL | Riposte path | Source maps |
| --- | --- | --- | --- | --- |
| `plaster-*` | `clay_plaster` | https://polyhaven.com/a/clay_plaster | `assets/tex/plaster2/` | map 1024, normal 1024, rough 512 |
| `cobble-*` | `cobblestone_floor_001` | https://polyhaven.com/a/cobblestone_floor_001 | `assets/tex/cobble/` | map 1024, normal 1024, rough 512 |
| `wood-*` | `rough_wood` | https://polyhaven.com/a/rough_wood | `assets/tex/timber/` | map 512, normal 512, rough 512 |

## Processing

`python3 -I scripts/patio-textures.py <riposte-source-root>` (Pillow + numpy),
all colour work in linear light; every resize wraps at the edges so the maps
still tile (Lanczos on a 3x3 tiling, centre kept).

- **plaster** (`clay_plaster`): colour neutralised to grey (each channel divided
  by its mean, then luminance), contrast kept at the source's (x1.0), placed at a
  linear mean of 0.80 for headroom. At run time the material divides that mean
  out (and carries the classic canvas's own mean), so the per-house vertex paint
  stays the colour. One repeat = 2.75 m of wall.
- **cobble** (`cobblestone_floor_001`): chroma cut to 30 % (the blue-grey and
  moss go), luminance contrast x0.8, mean moved to a warm grey (sRGB about
  148, 141, 130). Normal map re-centred: the mirrored file has a mean tilt of
  about 12 degrees (x and y both +0.21), removed before renormalising. One
  repeat = 1.6 m (cobbles about 14-18 cm).
- **wood** (`rough_wood`): neutralised to grey like the plaster, grain contrast
  x0.7, linear mean 0.4647 (chosen so the brightest 0.3 % still fit under 1).
  The honey tint (0xb8875a) comes from the material. Grain runs along v
  (vertical on door leaves). One repeat = 1 m on doors.
- **roughness** (all three): remapped to 0.85 + 0.15 x source (matte).
- **normals** (all three): OpenGL convention (+Y up), as three.js expects; checked
  on the cobbles against the height implied by the roughness and colour maps
  (x and y slopes both correlate with the OpenGL sign). Renormalised after resize.

## Outputs (bytes)

| File | 512 px (High, Medium) | 256 px (Low) |
| --- | --- | --- |
| plaster-map | 6280 | 2034 |
| plaster-normal | 34248 | 9176 |
| plaster-rough | 540 | 178 |
| cobble-map | 61444 | 14768 |
| cobble-normal | 90362 | 24276 |
| cobble-rough | 3376 | 1056 |
| wood-map | 63546 | 15538 |
| wood-normal | 36800 | 8746 |
| wood-rough | 976 | 294 |

webp quality: colour 86, normal 90, roughness 80. Which files a page loads
depends on the variant (`src/fps/render/patio-sourced.ts`): toon loads map +
normal (Low: map only), std loads all three.
