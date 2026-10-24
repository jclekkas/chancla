# Combat effects (agent C)

Files: `src/fps/render/combat-fx.ts`, `src/fps/render/projectiles.ts`,
`src/fps/render/ruleros.ts`, `scripts/combat-fx-shots.ts`,
`tests/combat-fx.test.ts`. Visual only: no gameplay, timing, network or
protocol change. The engine calls are the same as before.

## The look

Everything is drawn as flat, ink-rimmed cartoon shapes, the same ink colour
(`COLORS.ink`) as the characters' outlines and a cream core, so the effects
sit in the warm illustrated courtyard instead of looking like a particle
system. Seven shapes, each one instanced mesh: a slap **star** (eight uneven
spikes, cream core to a marigold edge to an ink rim), a **ring**, a **speed
line**, a bumpy **dust puff**, a curved **swish** band (misses), a shorter
curved **swing streak** (hits) and a comic **word**. One small shader (instance tint, instance alpha, scene fog); the
word layer samples one 128 x 128 canvas (64 KB on the GPU) holding
"¡PAF!" and "¡ZAS!", drawn once per CombatFx (none in Node).

| Event | What you see | Life |
|---|---|---|
| El Chanclazo hit, body | a small cream-yellow star (0.21 m) popping at the contact point, turned along the blow; 3 short cream speed lines leaving it in the blow direction; 3 thin warm curved streaks along the swing arc, ending at the contact (from the attacker's right); a small "¡ZAS!" up and beside it (High) | 0.20 s |
| El Chanclazo hit, head | the same, a touch bigger (0.25 m) and brighter yellow, plus 3 tiny sparkles popping up (High) | 0.20 s |
| El Revés hit, body | a bigger star (0.38 m) with an orange edge, a cream shock ring opening to about 0.65 m, 5 longer speed lines (cream and lilac, La Pesada's colour), wider swing streaks coming in from the attacker's left, and "¡PAF!" (High and Medium) | 0.30 s |
| El Revés hit, head | the same, bigger (0.44 m), plus sparkles; the rulero pops from her head (below) | 0.30 s |
| Miss (`meleeWhiff`) | a pale core between cool-blue edges: a curved band of air about 1.05 m (forehand) or 1.15 m (backhand) in front of her, just under face height, sweeping right to left (forehand) or left to right (backhand); tilted, faded in and out. No star, no warm colour, no ring, nothing lands | 0.26 / 0.32 s |
| Shielded | two aqua rings rippling out (to about 0.5 m) on a faint pale bubble disc, on the near side of her; no star, no word | 0.42 s |
| Thrown chancla | flat frisbee spin with a wobble (La Pesada tumbles end over end) and a tapered camera-facing ribbon: warm cream for La Chancla, lilac for La Pesada; it widens slightly past 7 m so the direction reads at 15-20 m, fades inside 1.2-3.5 m | while flying |
| Surface impact | warm dust puffs with a soft ink rim drifting up and out (3 on High, 2 Medium, 1 Low); on the paving a flat scuff ring opens on the ground, on a wall a small ring facing you; a couple of chips (High) | 0.32 / 0.45 s |
| Player impact | a slap star (warm, brighter than any dust) with 3-4 speed lines and a few of the existing cream bits, so it never looks like a surface hit | 0.32 / 0.45 s |
| Rulero pop | a small cream star tinted the roller's colour where it leaves her head (not for your own rollers, which start at the camera) | 0.2 s |
| Rulero bounce | world-space squash (down to about 0.6 high, volume kept) and recover over 0.14 s, a slight stretch along the velocity in flight, and a tiny dust tick on the paving (not on Low) | 0.24-0.32 s |
| Rulero end | an eased shrink over the last quarter of its life (1.6 s, 0.9 s simple) | |

No blood, no red, no full-screen flash, no camera shake, no sound.

### View safety

Every piece goes through `nearSafe(distance, size)`: it fades and shrinks
inside about 1.2 m of the camera (gone at 0.45 m) and is never larger than
0.14 x its distance (about a tenth of the view at 70 degrees; hollow rings 0.18-0.22 x). Hit stars
and the shield are drawn a little in front of the body (up to 0.28 / 0.4 m
toward the camera) so the body does not bury them. Hit stars grow slightly
with distance (up to 1.6x at 7.7 m) so a slap still reads at 5-10 m.
Nothing lasts more than 0.45 s (0.6 s reduced motion) except the rollers.

## Quality and reduced motion

- **High**: everything above.
- **Medium**: fewer speed lines (2 light, 3 heavy), 2 swing streaks, "¡PAF!" but no "¡ZAS!", no head sparkles, one swish band, 2 dust puffs, half the particle bits.
- **Low**: only the essential cues: the hit star (no lines, no ring, no swing streaks, no word), one swish band, one shield ring, one dust puff (plus a ring for La Pesada), no particle bits, no rulero dust ticks. The engine already gives Low the simple roller flight.
- **Reduced motion**: no rotation of stars, no pop overshoot, sizes 0.85x, travel and sweeps halved, rings open less, everything played at 0.75x speed (still 0.6 s or less); trails narrower; projectile spin halved. Nothing flickers in any mode.

Quality and reduced motion can change mid-effect: each frame the live
records are drawn with the current settings.

## Pooling, caps and cost

No allocation after construction (all per-frame maths use module or member
scratch objects); each frame the live records rewrite the instance buffers.

| Pool | Cap (oldest reused) | Instances per shape |
|---|---|---|
| CombatFx records | 16 | star 64, ring 32, line 80, puff 16, swish 32, swing streak 48, word 16 |
| Projectile impacts | 12 | star 24, ring 24, puff 48, line 48; `Particles(360)` as before |
| Projectile meshes | 16 chanclas + 8 pesadas (as before) | trails: one merged ribbon mesh, 24 ribbons |
| Flying ruleros | 12 (as before) | rollers and outlines as 2 instanced meshes; accents 24 (star 24, puff 24) |

Draw calls: one per non-empty shape layer (empty layers are hidden).

| Worst case, all at once | High | Medium | Low |
|---|---|---|---|
| CombatFx (16 records max) | 7 | 7 | 3 |
| Impacts (12 max) + particles | 5 | 5 | 3 |
| All trails (24 max) | 1 | 1 | 1 |
| Flying ruleros (12) + accents | 4 | 4 | 3 |
| **Total, upper bound** | **17** | **17** | **10** |

Measured (`scripts/combat-fx-shots.ts`, El Patio, 640x400, SwiftShader,
`renderer.info` over one whole engine frame): six hits, two misses, a shielded blow, six
impacts and twelve rollers launched together, 50 ms in, with six in the air:

| | High | Medium | Low |
|---|---|---|---|
| Whole frame, before the burst (draw calls / triangles) | 276 / 115.5k | 276 / 110.6k | 166 / 71.0k |
| Whole frame, during | 359 / 135.2k | 359 / 127.6k | 210 / 79.2k |
| of which the six flying projectile bodies (existing models, unchanged) | 67 | 67 | 34 |
| **Effects only** (sum of the `stats()` draw calls) | **16** | **16** | **10** |
| Effects triangles (pieces x shape, rollers, trails, bits) | about 9.8k | about 7.1k | about 3.2k |

The same scene on the code before this pass (67fa0b5, High): 109 draw
calls for the three groups against 83 now, so the effects' own share went
from about 42 to 16 (the 12 flying rollers alone were 24: a mesh and an
outline each; every trail was its own draw call).

Triangles per piece: star 48, ring 112, line 16, puff 84, swish 220, swing streak 220, word 2,
trail 18 per ribbon, roller 40 (x2 with the outline).

Download: about 9 KB gzipped added (the three files, minified and gzipped
one by one: 2.3 KB before, 11.4 KB after). No image assets; one 128 x 128
canvas texture for the words, drawn at start-up.

## The shared settings

The engine only calls `CombatFx.setQuality`, `setReducedMotion` and
`update(dt, camera)`. CombatFx writes them to `FX_SETTINGS` (exported
from `combat-fx.ts`), which `ProjectileView` and `RuleroFx` read (each
constructor takes its own settings object instead, for tests). So the
rollers' pop accents use the camera of the previous frame, and their
close-camera check is skipped until CombatFx has run once.

## Public behaviour kept

- `RULERO_COLORS`, `ruleroGeometry()`, `ruleroMaterial(slot)`, `ruleroMesh(slot)`: unchanged.
- `RuleroFx`: `group`, `spawn(...)`, `update(dt)`, `clear()`, `active`, `spawned`, `RULERO_POOL = 12`; added `stats()` and `dispose()`.
- `ProjectileView`: `group`, `particles`, `impact(...)`, `sync(...)`, `clear()`; the private `pools[w][i].key/.mesh` the benchmark reads are kept; added `stats()` and `dispose()`.
- `CombatFx`: the interface in PLAN.md; added `spawned` and `cost()`.

`dispose()` frees only what each class made: the roller geometry and its
toon materials and `OUTLINE` are shared and stay.

## Verifying

```
npx tsc --noEmit -p .
npx vitest run tests/combat-fx.test.ts
GRAPHICS_EXPERIMENT=1 node node_modules/vite/bin/vite.js build --outDir dist-c
DIST=dist-c PORT=4431 QUALITIES=high,medium,low node --import tsx scripts/combat-fx-shots.ts
```

The script writes to `artifacts/combat-fx/<quality>/`: a strip per scene
and distance (frames labelled in ms after the trigger), a `-crop` close-up
of the first four frames, and `cost.json`.

## From the owner's mockup

Adopted: the cream starburst with an orange edge at the contact point,
curved streaks along the swing arc into the contact (forehand from the
attacker's right, backhand from her left), and a short bold "¡PAF!" for
El Revés (a smaller "¡ZAS!" for El Chanclazo on High), on confirmed hits
only, under a third of a second, faded and shrunk near the camera and
placed up and beside the burst so it does not sit on the target. Not
adopted: the mockup's arc streaks are long and reach across the view; here
they stay within about 1 m of the contact so the crosshair stays clear.

## Limitations

- Billboards use the camera of the previous frame (CombatFx.update runs before the engine moves the camera): a one-frame lag, only noticeable on a very fast turn.
- The surface impact does not know the surface normal (the engine passes only a position): below 0.35 m it is treated as paving (flat ring), otherwise a wall (ring facing you).
- The miss swish is placed from the attacker's position and yaw at the end of the contact window, so it trails slightly behind the animation's sweep; it never depends on the victim.
- The worst case is busy by design (twenty-odd events in one spot); it clears within 0.45 s except the rollers.
- Effects are depth-tested: a wall between you and a hit hides it.
- The words use the browser's bold italic sans (Trebuchet MS or system-ui), not a bundled font, so the lettering differs slightly between systems.
- The swing streaks are reconstructed from the contact point and blow direction only (the attacker's position is not passed), so they follow an idealised arc about 0.9 m around her.
