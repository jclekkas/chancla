# El Patio: fountain, statue and kiosks

Offline preview only, El Patio only. Visual change only: the collision
boxes in `shared/map.ts` are untouched, and `shared/` and `src/net/` have no
changes, so collision, cover, sight lines, walkable space and gameplay are
the same. La Plaza's fountain and kiosk and the campaign layouts keep the
arena's generic drawing: the new drawing is behind the same guard as the
rest of the El Patio kit (`patioKit` in `world.ts`).

## What changed

`src/fps/render/patio-focal.ts`, built from the same boxes:

- **Fountain.** A square basin of warm cantera on a darker plinth, talavera
  panels between stone pilasters, a two-step coping, inner walls and a
  tiled floor under translucent water. On High and Medium, four thin arcs
  of water fall from bronze spouts on the pedestal, and soft rings spread
  from the middle and from where the arcs land: fragment-shader rings from
  world position and time, with no textures and no reflections. On Low the
  water is still. A soft contact band grounds it on the paving.
- **Statue.** A pair of the game's own chanclas cast in deep bronze-gold,
  standing on their heels with the flowered footbeds facing out, leaning
  apart and turned a quarter turn from each other, so a footbed faces you
  from any side of the plaza. They stand on a stepped cantera pedestal with
  talavera panels and a brass band. The lowest step now goes down into the
  water instead of floating on it. The old sway is gone, because monuments
  do not sway.
- **Kiosks.** Each kiosk has a stone plinth, a panelled painted cabinet, a
  wooden counter and corner posts, and a real service window 12 cm deep on
  the side facing the plaza, holding newspapers on a rack (PERIÓDICOS) or
  corn (ELOTES). Above it sit a cream fascia, a striped valance and a
  hipped tile roof. The roof's eaves are above head height, and its finial
  is at the box's top. The signs stay where they were.

High, Medium and Low variants:

| | High | Medium | Low |
|---|---|---|---|
| Water arcs and spouts | 4 arcs, 14 segments | 4 arcs, 8 segments | none |
| Water motion | rings and shimmer | rings and shimmer | still |
| Kiosk goods, panel mouldings, valance | yes | yes | no |
| Statue chancla mesh | full | full | lite |
| Shadow casting | yes | yes | no (contact bands kept) |

`tests/patio-focal.test.ts` checks the bounds at every quality. Below 2 m,
every vertex is within its box's footprint plus at most 6 cm of trim.
Above 2 m, only the kiosk eaves overhang, by at most 45 cm. Nothing solid
rises above its box. The one exception is the 3 cm translucent water arcs,
which rise up to 0.8 m over the basin rim on High and Medium (none on Low).

## Cost (exact renderer counts, Chromium with SwiftShader)

These are whole-frame counts, including the shadow pass, from the same
seven camera spots on both builds (`scripts/patio-focal-shots.ts`; data in
[costs-before.json](costs-before.json) and
[costs-after.json](costs-after.json)). "Before" is 4c116e1.

| View, quality | Draw calls | Triangles |
|---|---|---|
| Fountain and statue views, High | -12 (121 to 109 at 7 m) | +7.5k (106.4k to 113.9k) |
| Kiosk views, High | -4 | +8.0k |
| Fountain and statue views, Medium | -12 | +7.1k |
| Kiosk views, Medium | -4 | +8.0k |
| Fountain and statue views, Low | -5 | +1.2k |
| Kiosk views, Low (desktop and phone) | +3 (50 to 53) | +2.4k |

All four objects together take at most 7 draw calls: one merged mesh each
for cantera, talavera, paint, wood, bronze, water and the contact shadows.
That is fewer than the old drawing, whose statue alone was several meshes.
Because each merged mesh spans the plaza, it is drawn from anywhere, so a
kiosk view on Low gains 3 calls where the old pieces were culled. There are
no new textures: the kit's cached cantera, talavera and wood textures are
reused. Download is 403.5 KB to 408.2 KB of gzipped JavaScript (+4.7 KB),
with no binary assets. Frame time was not measured here: software rendering
on this container is not evidence for any device.

## Captures

Before and after, same build flags, same spots, HUD and hand hidden, bots
parked out of view: [compare-fountain](compare-fountain.jpg),
[compare-statue](compare-statue.jpg), [compare-kiosks](compare-kiosks.jpg),
[compare-medium](compare-medium.jpg), [compare-low](compare-low.jpg) and
[compare-phone-low](compare-phone-low.jpg).

## Known limitations

- The water arcs are decorative and rise above the basin rim. At 3 cm and
  translucent, they do not hide a player, but they are the one drawn thing
  that is not inside a box.
- The kiosk window is shallow (12 cm), so from a steep side angle the goods
  read as a flat display.
- The statue's bronze is a vertex tint on the toon ramp: no specular or
  reflections.
- Mac, Safari and phone appearance and frame rate are unverified.

## Mac and phone review checklist

1. Practice on El Patio, High: walk around the fountain at 2-10 m. Check the
   basin edges, the tiles, the water arcs and rings (calm, not busy), and
   the pedestal standing in the water.
2. The statue from all four sides: it should read as two chanclas from
   every side.
3. Both kiosks: the service window with goods, the roof and valance, and
   the signs on both ends.
4. Fight around the fountain and kiosks: cover and movement should feel
   exactly as before.
5. Repeat on Low: the silhouettes are the same, the water is still, and
   there are no goods.
6. Phone, landscape, Low and Auto: the same walk-around. Note the frame
   rate near the fountain.
