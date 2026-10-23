# Rosa, movement and combat presentation: working plan

Branch `codex/close-combat`, from 563ccd5 (the model/animation split, no
visual change from 6b9cfbd). Offline preview only. Visual changes only: no
gameplay, timing, damage, range, speed, hit detection, protocol or network
changes. No new maps, no environment changes (fountain, statue and kiosk
are the next milestone), no sound or music work, no paid assets.

## Ownership (one owner per file; nobody edits another owner's files)

| Owner | Files |
|---|---|
| Lead | `src/fps/render/rosa-rig.ts`, `src/fps/render/rosa.ts` (Avatar glue), `src/fps/render/pesada.ts`, `src/fps/engine.ts`, `src/fps/bench.ts`, `src/fps/main.ts`, `src/fps/render/viewmodel.ts`, `src/fps/render/fp-*.ts`, everything under `shared/`, `src/net/`, `scripts/` (except the three below), `docs/` (except each agent's notes file), `tests/` (except the three below) |
| A: model and materials | `src/fps/render/rosa-model.ts`, new `src/fps/render/rosa-materials.ts`, new `src/fps/render/rosa-geo.ts` (if wanted), `scripts/rosa-shots.ts`, `tests/rosa-model.test.ts`, `docs/rosa/MODEL.md` |
| B: animation | `src/fps/render/rosa-anim.ts`, `scripts/rosa-motion.ts`, `tests/rosa-anim.test.ts`, `docs/rosa/ANIMATION.md` |
| C: combat effects | new `src/fps/render/combat-fx.ts`, `src/fps/render/projectiles.ts`, `src/fps/render/ruleros.ts`, `scripts/combat-fx-shots.ts`, `tests/combat-fx.test.ts`, `docs/rosa/EFFECTS.md` |

Shared and never edited by agents: `src/fps/render/materials.ts` (the
world uses it), `src/models/sandal.ts` (Classic Arcade uses it),
`src/fps/render/fp-chancla.ts`, `src/fps/render/viewmodel.ts`.
Read-only imports from them are fine. Anything an agent needs changed in a
lead file goes in its final report, with the exact change.

## Interfaces

**Rig** (`rosa-rig.ts`): the joint tree, joint positions (`RIG`), the
`RosaRig` interface and `AvatarState`. The model builds the joints at the
`RIG` positions with zero rest rotation; the animation only rotates joints,
sets `hips.position.y`, `root.scale` and visibility of weapons, stars and
bubble, and may move the optional `extras`. Neither side changes `RIG`.

**Model** (`rosa-model.ts`): `buildRosaModel(team, { home?, quality? }): RosaModel`.
Keeps `rulMesh`/`rulOutline` (instanced, parented under `head`), `rulPlace`
(head-local matrices, one per roller, in roller-index order),
`rulOutlineScale`, `curlers` (campaign home look), `flashMats` (emissive
flash on hits), `weapons` in `wristR`, `stars` under `head`, `bubble` under
`root`. `teamAccent(team)` stays exported.

**Animation** (`rosa-anim.ts`): `new RosaAnimator(rig)`, `update(state, dt,
reducedMotion)`, `react(head, side)`. Add `whiff(weapon)` (a miss: a short
off-balance follow-through; the engine will call it on the authoritative
`whiff` event) and `land(impactSpeed)` is optional (it may instead detect
landing itself from `onGround`).

**Effects** (`combat-fx.ts`):
```ts
export class CombatFx {
  readonly group: THREE.Group;          // added to the scene by the engine
  setQuality(q: Quality): void;
  setReducedMotion(on: boolean): void;
  /** Confirmed melee contact (authoritative 'hit' with m). p: contact point; dir: unit blow direction (x, z). */
  meleeHit(weapon: WeaponId, p: { x: number; y: number; z: number }, dir: { x: number; z: number }, head: boolean): void;
  /** Confirmed miss (authoritative 'whiff'): the attacker's position and facing. */
  meleeWhiff(weapon: WeaponId, at: { x: number; y: number; z: number }, yaw: number): void;
  /** Blow absorbed by spawn protection. */
  shielded(p: { x: number; y: number; z: number }): void;
  update(dt: number, camera: THREE.Camera): void;
  clear(): void;                         // new match / round
  dispose(): void;
  /** Live and pooled counts, for tests and the benchmark. */
  stats(): { active: number; pooled: number; drawCalls: number };
}
```
`ProjectileView` and `RuleroFx` keep their current public methods and
signatures (the engine and the benchmark call them); additions are fine.

The engine (lead) calls these only from authoritative events, after the
session's deduplication (`seenMelee`), and for other players' melee at the
delayed render time, exactly as the existing reactions and ruleros do.

## Baseline (6b9cfbd, measured in Chromium/SwiftShader, practice, 3 bots)

Per Rosa, any quality (there are no quality tiers today):

| | Team Sol | Team Luna |
|---|---|---|
| Visible meshes (main-pass draw calls) | 60 | 50 |
| Shadow casters (shadow-pass draws, High/Medium) | 49 | 39 |
| Triangles | 8,256 | 8,522 |
| Materials / geometries | 23 / 35 | 21 / 25 |

Whole frame, three Rosas in view (docs/melee/melee-cost.json): High 368
draws, 130.7k triangles; Low 219 draws, 79.7k triangles. Up to 12 flying
ruleros add 24 draws.

## Working budgets (per Rosa unless stated)

| | High | Medium | Low |
|---|---|---|---|
| Main-pass draw calls | 36 or fewer | 26 or fewer | 16 or fewer |
| Shadow casters | 14 or fewer | 10 or fewer | none (Low has no shadows) |
| Triangles | 12,000 or fewer | 8,000 or fewer | 4,500 or fewer |
| Character textures (all Rosas together, GPU) | 512 KB or less | same | same |

Effects (all live at once, worst case): 24 or fewer extra draw calls on
High, 12 on Low, pooled, with a hard cap on live instances and lifetimes
of 1 s or less (flying ruleros keep their existing pool of 12).
Download: 40 KB gzipped JS or less added in total; no new binary assets.

Prefer merged geometry per rigid joint (vertex colours with one shared
toon material per Rosa is the obvious route), shared materials and
instancing. Every joint in the rig stays a separate group.

## Visual goals (from the brief)

Rosa must read as an intentionally designed stylized character at normal
player height and combat distance (3 to 10 m), not only in close-ups:
coherent silhouettes, clean joints, readable brows, eyes and mouth, clothing
with clear form and restrained folds, distinct skin, hair, fabric and
footwear; Sol and Luna colours and silhouettes (hat versus rebozo) kept;
ruleros attached in every pose. Match the warm illustrated El Patio and the
polished chancla. Stay inside the gameplay hitboxes (see `rosa-rig.ts`).

El Revés (approved): winds across the body, then sweeps outward as a
backhand, sole leading, contact 300-390 ms, follow-through. El Chanclazo
stays a clearly different forehand. Keep both readable on the new model.

## Verification each agent does before reporting

- `npx tsc --noEmit -p .` clean; own unit tests pass.
- Build to its own output directory and look at real captures of its
  work at normal combat distance as well as close (inspect the images).
- Measure its own cost against the budget.
- Commit on its own branch in its own worktree (never push).
