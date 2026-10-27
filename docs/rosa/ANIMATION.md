# Rosa: animation (agent B)

Files: `src/fps/render/rosa-anim.ts` (the animator), `scripts/rosa-motion.ts`
(frame strips, clips and the foot-slip measurement), `tests/rosa-anim.test.ts`.
Visual only. Nothing in `shared/`, the timings, the network or the hit
detection changed. The animator only rotates the joints in `rosa-rig.ts`,
sets `hips.position.y`, `root.scale` and the visibility of weapons, stars and
bubble. It also moves the optional `rig.extras` when the model has them.

## What changed

**Foot-planted locomotion.** While a foot carries her, it is pinned to the
paving in world space. While it swings, it steps to a predicted landing
spot. Two-bone IK from the hip reaches it: the thigh swings out and forward,
and the knee bends forward only. The stride therefore follows the distance
she really travels, which the animator measures from the root the engine
places before each `update`. The gait phase only times the steps:
- the stride (two steps) is `0.55 + 0.27 * speed` m, so steps get longer and quicker with speed, up to about 3.3 strides a second;
- each foot's share of time on the ground drops from about 57% in a walk to 30% in a run;
- step height grows with speed.

The swing is eased in her own frame, so the foot passes her smoothly at any speed. It is down on its spot a moment before the beat, so it is set down flat rather than dropped. The hips come down as far as the feet need (a smooth minimum over both legs' reach). The walk's bob comes from the feet themselves; a run adds a little drop and spring.

**Starting and stopping.** When she sets off, the trailing foot steps first.
When she stops, any step in progress finishes, then a foot that is out of
place takes one settling step under her. She leans into acceleration
(forward on a start, back on a stop, sideways in turns) through a springy
lean.

**Strafing and backpedalling.** The hips and the stride turn up to about 46
degrees toward the motion, while the shoulders and the head take the turn
back and keep facing the aim. Sideways motion shortens the stride and widens
the stance, so the feet never cross. Going backwards keeps the hips
forward (there is hysteresis around pure sideways motion), with shorter
steps and a slight lean back.

**Turning in place.** The pelvis follows the aim through a lagging spring:
the shoulders and head turn first and the hips follow. The pinned feet then
take small steps once they are about 30 degrees or 9 cm out of place. The
knees point where their feet point.

**Arms.** They swing opposite the legs, computed from where the feet really
are. They pump in a run. The weapon arm carries the sandal low at her side
with the elbow softly bent, and swings less. The old rest pose had that
elbow bent backwards; it is still used inside the melee keys, which blend
from and back to the carry pose.

**Jumps.** There is no anticipation: the jump is instant and real movement is never delayed.
- In the air: a quick tuck (left knee up, right leg trailing, more spread in a running jump), arms out for balance.
- Falling: once she falls faster than 1.5 m/s, the legs reach down for the ground.
- Landing: both feet plant where the air pose had them, then a squash scaled by the impact speed (the root's vertical velocity just before contact), with a forward lean and the arms dipping, then recovery.

**Crouch.** The hips drop 0.40 m (smoothed), the knees bend forward and splay out a little, the stance widens and the torso leans forward. Crouch-walking is foot-planted like walking.

**Throws.** The chancla leaves at the press, so the throw is shown after the fact:
- the arm flicks up beside her head, whips over and forward to a release pose that follows the aim's pitch, at the old release times (90 ms La Chancla, 160 ms La Pesada);
- it then follows through down and across her body, back to rest by 60% of the cooldown;
- the hips lead the shoulders, the weight goes forward, and the left arm points, then pulls in;
- La Pesada puts about 15% more body into it;
- the sandal in hand shows and hides exactly as before.

**Melee.** The arm keys (`MELEE_KEYS`) are unchanged in value. New body keys (`MELEE_BODY`) add, on the same clock:
- hips that lead the shoulders: the shoulders' world turn stays exactly the keys' `tw`;
- a weight drop into the wind-up and a transfer through the strike (hips drop and roll, torso lean);
- a counterbalancing left arm. For El Revés it moves out of the way during the wind-up, then flings out to her left as the arm sweeps right.

The head takes back 40% of the shoulders' twist, so her face stays nearer the target. While she moves, the body keys are scaled down to 60%.

**`whiff(weapon)`** (new) is a confirmed miss:
- the follow-through overruns: the arm sweeps further, the shoulders and hips overturn, she lurches forward and drops a little;
- when she is standing, one foot stumbles out the way the swing went (right foot forward-right for El Revés, left for El Chanclazo), then settles back;
- it lasts 0.62 s for El Revés and 0.4 s for El Chanclazo, both inside the real recovery (MELEE `cycleMs`, plus `whiffMs` for El Revés);
- a new swing cancels it.

**Hit reactions.** These follow the owner's mockup.
- `react(head, side)`: a startled flinch. Both hands come up in front of her, splayed, the one on the side of the blow higher. The upper body twists away from the blow and leans back, the head turns, and the weight drops onto the far leg. On top of that, lightly underdamped wobble springs take a kick: the head snaps and wobbles, and the torso twists and rolls.
- A head hit (El Revés to the face) is stronger and lasts 0.46 s; a body hit lasts 0.38 s. The rollers come off separately, in the effects.
- `msSinceHit` (a throw hit) gives a smaller generic recoil back with the hands up. When `react()` handles the same blow, the two do not stack.
- There is no stun and no lock.

**Idle.** Slow breathing (chest, shoulders, head) and a slow weight shift
(hips roll, torso counter-roll), phase-offset per avatar.

**Elimination and respawn.**
- Elimination: a hop of surprise with the arms flung up, a spin, then a sit-down with the legs out in front and a kick as she bumps down. She props herself on her hands, wobbles dizzily under the stars, and puffs out at 2.2 to 2.5 s as before.
- Respawn: the scale pop now has a little stretch.

**Transitions.** Every layer is a critically damped spring or a keyed envelope with smooth ramps, so states blend without pops. The rare hard cuts are blended out by inertialization: a weapon change mid-action, and the start of the pratfall. A slew limit (48 rad/s) on the upper body covers two fast motions meeting, such as a throw starting out of a flinch.

**Reduced motion.**
- Breathing, sway, lean, bob and wobble are smaller.
- Reactions are at 45% and critically damped (no wobble). The squash is halved and the whiff is at 60%.
- The melee and throw arm and body keys are at 60%, as before.
- There is no death spin.
- The stepping itself is unchanged, because it is what shows her movement.

**Extras.** When the model provides them, `skirt`, `shawlTail`, `hatBrim` and `bun` swing on a pendulum that lags her acceleration and takes kicks from landings and hits; the skirt also spreads when she crouches. If the model puts a face `hit` variant at `rig.extras.faceHit`, it is shown during the peak of a reaction. The current model has no extras; the code copes.

## Foot slip, before and after

Measured by `scripts/rosa-motion.ts` in the real game page (Chromium,
SwiftShader, fake clock at 60 fps, a remote Rosa driven in a straight line).
A foot counts as on the ground while its ankle is within 2 cm of its
lowest height; each frame takes the slower of the feet on the ground (the
most generous reading for the old animation). The value is its world-space
horizontal speed over 2.2 s of steady motion. Before: the lead's baseline
build `/home/user/dist-before`. After: this branch.

| Motion | Before, mean (90th pct) | After, mean (90th pct) |
|---|---|---|
| Walk 1.5 m/s | 141 cm/s (208) | 0 cm/s (0) |
| Walk 3 m/s | 245 cm/s (388) | 0.2 cm/s (0) |
| Run 6 m/s | 350 cm/s (929) | 0.4 cm/s (0) |
| Strafe 6 m/s | 586 cm/s (819) | 0.4 cm/s (0) |
| Backpedal 6 m/s | 330 cm/s (929) | 0.5 cm/s (0) |
| Crouch walk 3 m/s | 300 cm/s (300: the old crouch had no leg motion) | 0 cm/s (0) |

The small residual after is the last frame or two of a swing, when the foot
is within 2 cm of the paving and still moving. The planted foot itself does
not move at all: the unit tests measure it as under 1 cm/s mean and 5 cm/s
peak for walk, run, strafe both ways, backpedal, diagonal and crouch, and
the same while turning on the spot. Per step: the old animation slid about
28 cm per footfall at 6 m/s; now it slides none.

## How El Revés and El Chanclazo were preserved

- **Arm keys.** `MELEE_KEYS` values, the shoulder Euler order and the weapon placement are unchanged.
- **Body keys.** The new keys keep the shoulders' world twist equal to the keys' `tw` (the torso takes back the hips' lead).
- **Unit tests** (`tests/rosa-anim.test.ts`):
  - El Revés: wound up across to her left at 285 ms (`ay > 0.9`, the elbow folded). The sweep runs left to right through 300-390 ms and crosses the middle inside that window. The sole leads (`wy < 0` from 100 to 900 ms), and the follow-through goes out to her right (560 ms).
  - El Chanclazo: cocked to her right at 85 ms. The sweep runs right to left through 120-190 ms, crosses the middle inside the window, and the palm leads (`wy > 0`).
  - The posed rig matches the keys at 150, 300, 345, 390 and 560 ms (El Revés) and at 85, 120, 155 and 190 ms (El Chanclazo).
- **Pose sheets.** Re-rendered with `scripts/melee-poses.ts` on this build, 3q and side views, at the sheet times (El Revés 0, 120, 220, 285, 300, 330, 360, 390, 450, 560, 750, 1000 ms; El Chanclazo 0, 50, 90, 120, 145, 170, 190, 240, 330, 450, 600, 690 ms). They match the approved `docs/melee/poses` frame for frame:
  - the wind-up across the chest to her left shoulder;
  - the backhand sweep at face height inside the contact window;
  - the follow-through out to her right;
  - the forehand mirror image.
- **What differs on the sheets.** The 0 ms and late-recovery frames show the new carry pose of the weapon arm (elbow forward) instead of the old backward-bent rest, and the hips now visibly lead.

## Cost

- **CPU.** About 5.5 to 6.6 microseconds per avatar update in Node; the old animator took 1.2. For 12 Rosas that is about 0.08 ms per frame.
- **Allocations.** No objects are allocated per frame: scratch vectors, quaternions and keys are reused, and the loops are indexed. V8 still boxes some numbers: about 2 KB of short-lived garbage per update, against about 0.6 KB for the old animator (counted by scavenges over 200,000 updates).
- **Geometry.** No meshes and no materials.

## Limitations

- **Interpolated network motion.** The gait reads the root's motion, so a remote that stalls or snaps (a dropped snapshot) can make a foot drag.
  - Past about 2.5 m in one frame, she is re-planted.
  - In a very violent change of direction, a planted foot that would leave the leg's reach is dragged along: a little slip, by design, rather than a stretched leg.
- **Crouch.** On the current model the knees still poke a little out of the skirt front, and the skirt hem meets the paving when she crouches. That is the model's geometry: the skirt is rigid on the hips. Knees splayed out is the most the animation can do; a skirt in `extras.skirt` gets spread.
- **Throws.** The chancla leaves at the press, so the arm's motion always trails the projectile by up to 90 ms (160 ms for La Pesada). It has no wind-up before the release, because there is none in the game.
- **Turns.** The turn-in-place steps are small and quick. A very fast flick of the aim (more than about 1 rad of lag) turns the pelvis with the aim rather than lagging further.
- **The continuity test** allows up to 0.85 rad per 16 ms frame for the upper body and 1.13 rad for the legs and feet. A real throw's whip and a running leg's swing are that fast. The test skips death and respawn.
- **Nothing in this pass changes:** first person (the viewmodel), the camera, the rollers' flight, or the hit effects. Those belong to their owners.

## Review material

- **Running it.** `DIST=<build> OUT=<dir> node --import tsx scripts/rosa-motion.ts` writes a clip (`.mp4`), a close strip (`.jpg`) and a wide strip (`-wide.jpg`) per scene and view, and prints `foot-slip.json`. The build is `GRAPHICS_EXPERIMENT=1 vite build --outDir dist-b`.
- **Scenes:**
  - walks at 1.5, 3 and 6 m/s, a start and stop, strafes both ways, a backpedal;
  - a turn on the spot, a run with an aim turn, a standing jump and a running jump, a crouch walk;
  - both throws, El Chanclazo and El Revés (a hit with the partner's reaction, and a whiff), a head hit, a throw hit;
  - the elimination and respawn, and idle.
- **Views.** `side` (her right, 4 m) and `3q` (ahead of her, 4 m), at eye height.
