# Rosa, movement and combat presentation

Offline preview only. Visual changes only: no gameplay, timing, damage,
range, speed, hit detection, network or protocol change (`shared/` and
`src/net/` are unchanged since 6b9cfbd). The environment is unchanged;
the fountain, statue and kiosk are the next milestone.

Owner feedback recorded before this milestone (user-reported, one play
session on the owner's Mac): the visuals of the previous preview look good
and the earlier drifting did not occur. That is playtest feedback, not
Mac, Safari, phone or performance validation.

## What changed

- **Model** (`rosa-model.ts`, `rosa-materials.ts`, `rosa-geo.ts`, see
  [MODEL.md](MODEL.md)): a redesigned stylized Rosa built per rigid joint
  (one merged, vertex-coloured mesh with its ink outline per joint, one
  toon material per Rosa, geometry cached per team and quality). Readable
  face (eyes behind clear cat-eye frames, brows, cheeks, a red smirk),
  grey-black hair with the ruleros sitting on it, short team-colour
  sleeves over the shoulder joint, mitten hands gripping the chancla, a
  dark skirt with a team-colour floral hem, flip-flops. Sol keeps the
  straw hat, Luna the rebozo hood; both read at 10 m and on Low. Real
  High, Medium and Low tiers.
- **Animation** (`rosa-anim.ts`, see [ANIMATION.md](ANIMATION.md)): feet
  planted in world space with two-bone leg IK and stride driven by real
  distance travelled (no foot sliding), walk to run blend, strafing with
  the upper body on the aim, backpedal, turning in place, jump tuck and a
  landing squash scaled by impact speed, throws with weight transfer, a
  confirmed-miss overrun, an expressive hands-up flinch on hits (no stun),
  idle breathing. El Revés and El Chanclazo arm keys are unchanged
  (checked against the approved pose sheets); the body now leads them.
- **Effects** (`combat-fx.ts`, `projectiles.ts`, `ruleros.ts`, see
  [EFFECTS.md](EFFECTS.md)): distinct contact effects (a small "¡ZAS!" star
  for El Chanclazo, a bigger "¡PAF!" burst for El Revés), a cool air swish
  for a confirmed miss, a ripple for a shielded blow, spinning projectiles
  with short trails, dust and scuff impacts distinct from player hits,
  squash-and-stretch ruleros with a pop and a dust tick. Pooled and
  capped, fading near the camera, simplified on Medium and Low and with
  reduced motion. Driven only by authoritative, already deduplicated events.
- **Lead integration**: the rig contract (`rosa-rig.ts`), the Avatar glue,
  quality-aware avatars (rebuilt on a quality change), the engine hooks
  for misses and shielded blows, effects updated after the camera is
  placed, and the hit flash changed to a warm brightening (additive light
  washed the new one-material body out to grey).

The owner's AI-generated target mockup
([target-mockup-NOT-A-CAPTURE.webp](target-mockup-NOT-A-CAPTURE.webp)) guided
the face, proportions, outfit, flinch and comic impact. Left out: an
open-mouth hit face, painted fabric detail, long streaks across the view.

## Cost (exact renderer counts, Chromium with SwiftShader)

Per Rosa (`scripts/rosa-cost.ts`, [cost-before.json](cost-before.json),
[cost-after.json](cost-after.json)):

| | Draw calls | Shadow casters | Triangles | Budget |
|---|---|---|---|---|
| Before, any quality (Sol / Luna) | 60 / 50 | 49 / 39 | 8,256 / 8,522 | |
| High | 18 | 14 | 10,236-10,294 | 36, 14, 12,000 |
| Medium | 18 | 10 | 7,106-7,182 | 26, 10, 8,000 |
| Low | 16 | 0 | 3,846-4,192 | 16, 0, 4,500 |

Whole frame, average per engine frame (shadow pass and first-person view
included), the same scripted scenes at the same timestamps
([bench/](bench/)):

| Scene, quality | Draw calls | Triangles |
|---|---|---|
| Combat workload, High | 392 to 182 | 129.6k to 148.2k |
| Combat workload, Medium | 392 to 169 | 124.8k to 121.6k |
| Combat workload, Low | 234 to 106 | 78.4k to 67.1k |
| Café walkers (existing controlled scene), High | 409 to 217 | 137.2k to 152.2k |
| Café walkers, Medium | 407 to 206 | 132.1k to 127.2k |
| Café walkers, Low | 235 to 124 | 81.4k to 69.9k |

Effects worst case (6 hits, 2 misses, a shielded blow, 6 impacts, 6
projectiles and 12 rollers at once): 16 extra draw calls on High and
Medium, 10 on Low (about 42 before, the rollers alone took 24).

Textures: the characters use none beyond the shared toon ramp; the
effects add one 128 x 128 canvas for the words (64 KB, about 85 KB with
mipmaps). Download: 389.9 KB to 410.2 KB of gzipped JavaScript (+20.3 KB);
no binary assets.

Frame time (software rendering on this Linux container, so only
indicative and not evidence for any real device): High, two clean
alternating runs per scene, median frame 286-300 ms before and 298-313 ms
after (about 4% slower: more triangles, which a software rasterizer pays
for). Medium about equal. Low faster (4.5-5 to 8-9 fps). Real GPUs are
usually limited more by draw calls than triangles, but Mac and phone
performance are unverified.

Benchmark: `?bench&scene=combat` (new, deterministic: a 2.4 s cycle of El
Revés to the face with a roller knocked off, a missed Chanclazo, a Rosa
strafing, jumping and throwing; four views at 2, 3, 5 and 9 m). The
existing `?bench` and `?bench=live` modes are unchanged.

## Captures

In-game, from `scripts/rosa-review.ts` on a fake clock with the same
staging and timestamps in both builds; "before" is the pre-milestone look
(61d40a1, visually identical to 6b9cfbd). Staged scenes; the transient
spawn banner is hidden in stills; third-person views hide your own
first-person hand. Sheets in [review/](review/):
`compare-teams`, `compare-backgrounds` (café door, shade, bright paving),
`compare-movement`, `compare-attacks`, `compare-miss-throw`,
`compare-first-person`, `compare-crowd`, `compare-low`,
`compare-phone-low`. Clips: [clip-after.mp4](clip-after.mp4) and
[clip-before.mp4](clip-before.mp4) (true speed, with one labelled 4x slow
motion section).

## Tests run for this milestone

Typecheck and offline build (no production server address in the bundle).
Unit and local multiplayer: practice pause, melee, mp-melee (three clients
through simulated latency, roller and hit agreement), mp-four, mp-sim,
rosa-model, rosa-anim, combat-fx, bench-scene, campaign, fps-touch, input,
diag: 182/182. Browser: movement and pause 55/55, melee 28/28 (one
live-bot check that bots use both attacks is random and failed once in
three runs), touch 35/35.

## Known limitations

- Straw hat brim and rebozo back extend past the head hit sphere, as the
  old hat did; skirt is rigid with the hips (knees show in a deep crouch).
- La Pesada's heel is wider than the fist; on Low the left hand is baked
  to the forearm.
- The whole body brightens on a hit (one material).
- Swing streaks follow an idealised arc; the miss swish starts at the end
  of the contact window; surface impacts guess wall versus floor by height.
- Remote motion that stalls or snaps can drag a planted foot.
- The campaign finale's existing `toonify` still whitens the chancla on
  guest avatars (pre-existing).

## Mac and phone review checklist

Mac (Safari and Chrome), High then Low:
1. Practice on El Patio: walk, run, strafe, backpedal and turn with arrows
   and WASD. Feet should not slide; she stops cleanly.
2. Watch a bot from 3-10 m: face, ruleros, team read (hat versus rebozo)
   against the café door, in shade and on bright paving.
3. V with La Chancla (¡ZAS!) and La Pesada (¡PAF!, a roller flies) at close
   range; a swing out of reach shows only an air swish.
4. Get hit: the hit brightening is brief and nothing covers the view.
5. Esc, wait, Resume during a fight: nothing advances while paused.
6. Note frame rate and any stutter when several Rosas fight.

Phone (landscape, Low and Auto):
1. Team read at 5-10 m, the Chanclazo button, a throw, a Revés hit.
2. Effects stay small and clear the crosshair quickly.
3. Rotate, background and return: characters and ruleros intact.
4. Note heat and frame rate over a full match.
