# Chancla Duty

Doña Rosa's tour of duty. Same neighborhood, same flying footwear, a different game from [Chancla Warfare](../README.md). The original stays at `/` and `/classic.html`. This one is at `/chancla-duty/`.

It is a local arcade campaign. Nothing to sign in to, no game server, no download beyond the page.

## Run it

From the repo root (Node 22):

```bash
npm ci
npm run dev
```

Open http://localhost:5173/chancla-duty/

Production is the same build as the original:

```bash
npm run build
npm run preview
```

`dist/chancla-duty/index.html` is uploaded with the rest of `dist/` by the existing Vercel, Netlify, and GitHub Pages config. No new service.

A shift can also start from the URL: `?go=1&mission=patio&diff=easy` (or `mission=endless`).

## How to play

| Action | Keyboard and mouse | Touch (landscape) |
| --- | --- | --- |
| Move | WASD or arrows | Left stick |
| Aim | Mouse | Drag the right side |
| Throw | Click | Throw, or tap the right side |
| Heavy throw | Hold, then release | Hold Throw |
| Dash | Space | Dash |
| Switch footwear | 1–5, Q, or the wheel | ⇄ |
| Recall chanclas | R | ↩ |
| La Legendaria | F, when the meter is full | ★ |
| Pause | Esc or P | ❚❚ |

La Chancla is fast, banks off a wall once, and flies home. You only hold two, so recall them when a crowd is standing in the wrong place. La Pesada is the slow clog: a splash and a shove, including into a stove. The armory spends **respeto** on more health, speed, extra bounces, a stronger smack, a shorter dash, and three more shoes: La Huarache (pierces), Las Gemelas (a pair), and El Tacón (it curves).

Dash is a short burst with a sliver of invulnerability. A full charge one-shots the regulars. Hitting someone while their warning cone is still filling interrupts them. A selfie is a worse idea: double damage. Combos climb to ×8. Pickups are cafecito (speed), chile (smack), agua fresca (heal), a rebozo (one free hit), and a micrófono (Legendaria meter).

Campaign is six shifts: patio, kitchen, plaza, market (keep the puesto standing), roof (don't fall in), and El Rey del Escándalo. His shield eats chanclas until he runs out of breath. Bank the bounce into his friends, then throw when the ring goes gold. Endless Duty keeps going, changes the block every three waves, and sends the king every fifth.

Grades are S through D. Respeto and the best grade stay in this browser.

## What changed from Chancla Warfare

The original is a Three.js first-person team shooter, plus the classic courtyard arcade and a four-mission story. Chancla Duty does not replace any of that.

**Graphics.** A hand-drawn courtyard, seen from above, with a baked tile map, a half-resolution multiply light pass (windows, the fountain, string lights, the stove), walking and throwing animation, projectile trails, confetti, hit-stop, and screen shake. The HUD, title, and Doña Rosa card use the same marigold, teal, and purple as the original, with papel picado across the top. Reduced motion and a graphics setting (Auto / Low / Medium / High) are in Settings. Auto steps the quality down if frames start missing.

**Gameplay.** Six missions with different jobs, five shoes, a dash, pickups, a respeto armory, combo callouts (¡REBOTE!, ¡CÁLLATE!, ¡SELFIE!, ¡AL HORNO!), and an endless shift. Enemy tells are on the ground: cones, charge lines, pose rings, and the king's safe slice. Cover still blocks a Bocinas blast. Difficulty is Suave, Normal, or ¡Ándale!.

**Speed.** No Three.js and no music files. The map is drawn once into an offscreen canvas. Particles, shots, and enemies are capped and recycled. The simulation steps at a fixed 60 Hz with at most five steps a frame. A 20-second headless shift finishes well under a second of CPU in `tests/duty.test.ts`. The page is one small script plus the Lilita One font already used by the original.

## Settings

Music, effects, graphics, screen shake, a small aim assist, reduced motion, frame rate, and English or Spanish. Saved under `chancla-duty-v1` in localStorage. The music and sound effects are synthesized in the browser.
