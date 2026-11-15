# Credits

Chancla Duty's new look uses public-domain (CC0) assets. The original Warfare art is unchanged.

## Characters

Rigged, animated people are from the [Ultimate Animated Character Pack](https://quaternius.com/packs/ultimatedanimatedcharacter.html) by [Quaternius](https://quaternius.com), CC0. The copies in `public/chancla-duty/cc0/characters/` are the glTF conversions published with the Ghostname Work Dashboard (`Casual_Female`, `Casual2_Female`, `Worker_Female`, `Casual_Male`). Clips used: Idle, Walk, Run, Jump, SwordSlash (throw), RecieveHit, Death, SitDown.

## Surfaces and sky

[Poly Haven](https://polyhaven.com/license) (CC0):

- `painted_plaster_wall` — wall color, normal, roughness (1K)
- `terracotta_floor_tiles` — floor color, normal, roughness (1K)
- `wood_table_001` — wood color, normal, roughness (1K). Photography by Dimitrios Savva, processing by Rico Cilliers
- `kiara_8_sunset` — 1K HDRI for image-based lighting and the sky

Albedo maps are also stored as KTX2/ETC1S (`diff.ktx2`), encoded with the Basis Universal encoder shipped in `@loaders.gl/textures` (BinomialLLC basis_universal). If a GPU cannot transcode KTX2, the JPEG is used. The Basis transcoder in `public/basis/` comes with Three.js.

## Still made here

Papel picado, string-light bulbs, the fountain water card, the viewmodel hand and chancla, and the collision courtyards are original to this project. No CC0 sandal model was found, so the chancla is an extruded, textured shape.
