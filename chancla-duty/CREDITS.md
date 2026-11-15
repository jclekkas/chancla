# Credits

Chancla Duty's new look uses public-domain (CC0) assets. The original Warfare art is unchanged.

## Characters

The high tier does not use the Grab3D soldier. Doña Rosa (Sol and Luna) and the abuela are Blender meshes in `public/chancla-duty/cc0/characters/film-sol.glb`, `film-luna.glb`, and `film-abuela.glb`, skinned to the Quaternius skeleton. Idle, walk, run, throw (SwordSlash), hit, and death are the Quaternius clips (CC0). The faces, embroidered dresses, hat, and shawl are modeled in this repo. A capsule casts the shadow.

## Surfaces and sky

[Poly Haven](https://polyhaven.com/license) (CC0):

- `painted_plaster_wall` — wall color, normal, roughness (1K)
- `terracotta_floor_tiles` — floor color, normal, roughness (1K)
- `wood_table_001` — wood color, normal, roughness (1K). Photography by Dimitrios Savva, processing by Rico Cilliers
- `kloofendal_48d_partly_cloudy` — 1K HDRI for image-based lighting and the cloudy sky

Albedo maps are stored as KTX2/ETC1S (`diff.ktx2`). Normal maps are KTX2/UASTC (`nor.ktx2`) and roughness maps are KTX2/ETC1S (`rough.ktx2`), encoded with the Basis Universal encoder shipped in `@loaders.gl/textures` (BinomialLLC basis_universal). If a GPU cannot transcode KTX2, the JPEG is used. The Basis transcoder in `public/basis/` comes with Three.js.

## Buildings, props, and plants

High tier draws the courtyards as plaster, tile, and wood PBR volumes. The plants in `public/chancla-duty/cc0/kit/` (`agave`, `bird`, `ear`, `fern`) are CC0 models from the same tevy / Poly Haven-adjacent set dilf-war ships (agave rosette, bird of paradise, elephant ear, fern). Kenney's Fantasy Town, Nature, Suburban, and Pirate kits stay in the folder and load only with `?kit=kenney`.

[Kenney](https://kenney.nl) (CC0), from the packs mirrored on OpenGameArt:

- Fantasy Town Kit — walls with shutters, doors, balconies, roof tiles, the round fountain, market stalls, the stall bench, and lanterns
- Nature Kit — oak, palm, and round trees, bushes, and flowers
- City Kit (Suburban) — the houses on the skyline outside the playable bounds
- Pirate Kit — barrels and crates

The copies in `public/chancla-duty/cc0/kit/` are those glTF files with textures embedded and `EXT_meshopt_compression` applied. Collision stays on the map boxes; the models are scaled to those boxes.

## The chancla

No CC0 sandal was found. `chancla.glb` and `chancla-heel.glb` are modeled in this repo: an extruded sole with a tread texture, a thong strap, and a heel on La Pesada and El Tacón. They are meshopt-compressed glTF. The first-person forearm and hand are the right arm of the Quaternius character, posed and baked to a static mesh.

## Still made here

Papel picado, string-light bulbs, the fountain water card, and the collision courtyards are original to this project.
