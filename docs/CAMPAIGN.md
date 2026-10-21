# Doña Rosa: Antes de que lleguen (Before the Guests Arrive)

A short solo campaign inside the shooter. Rosa is hosting the neighborhood tonight. Her ruleros are missing, the kitchen is chaos, the patio is a disaster, and someone installed an absurd piñata. Everyone who helped make the mess is going to help fix it.

It runs entirely in the browser. It needs no server, account or database, makes no network calls during play, and costs nothing to host.

## Launching a mission

Title screen → **Story: Before the Guests Arrive** → pick a mission card → **Start mission**.

- Missions unlock in order on first play. Finished missions can be replayed any time.
- Each card shows the premise, objective, estimated duration, completion state, best time and the three challenges.
- **Esc** opens the menu: resume, retry from checkpoint, restart, settings, controls, leave (with confirmation).
- When a mission ends there is a short, skippable payoff, then results with **Next mission**, **Play again** and **Mission select**.
- Progress is saved locally under `chancla.campaign.v1`, separate from settings and multiplayer. **Reset campaign progress** (with confirmation) erases only that. If the browser blocks storage, the game says so and progress lasts for the session.

## The missions

All four take place in El Patio, the one neighborhood map the multiplayer mode uses. Each mission applies its own layout overlay (props, cover, marked surfaces, removed pieces), lighting and music.

| # | Mission | Area | Lighting | What makes it different |
| --- | --- | --- | --- | --- |
| 1 | **Operación Ruleros** (Operation Hair Rollers) | Rosa's house, her balcony, the courtyard and alley | Morning | Six roller sets, each recovered a different way: picked up, latch, bank shot, interrupting a pose, toppling with La Pesada, and a chase |
| 2 | **Aquí se cocina, no se improvisa** (Kitchen Under Control) | The outdoor kitchen on the bakery terrace, the market below, the east courtyard | Noon | Collect, then defend a cooking timer against interruptions, then a delivery under pursuit |
| 3 | **Este patio no se limpia solo** (Patio Panic) | The east courtyard, the east plaza, the north-east alley | Golden afternoon, brightening as you clean | Switches, bank shots, a leaf-blower fight with readable gust windows, and carrying props to storage |
| 4 | **La Piñata Contraataca** (The Piñata Strikes Back) | The central plaza, rebuilt as an arena (statue removed, party tables, mirrors) | Dusk, with colored party lights | A three-phase encounter |

### 1. Operación Ruleros

1. **Set 1** is on Rosa's vanity at home. Walk up to it; it teaches the counter.
2. **Set 2** is in a basket hanging over the balcony. Hit the red latch, then climb to the balcony and collect it.
3. **Set 3** is wedged on a ledge across the alley. Direct hits are refused ("not like that"). Bank a chancla off the tiled mural with the arrow. The solver found 50 standing spots in the alley that work, so it isn't pixel hunting.
4. **Set 4** is worn by an influencer doing a photo shoot. Hit him mid-pose (the flash) and they drop.
5. **Set 5** is under a tower of empty boxes. Only La Pesada (weapon 2) topples it; the game says so if you try the standard chancla.
6. **Set 6** rides away on the wind-up delivery cart. It loops through the plaza and the alley and panics faster after each hit. Five hits stop it; hits while it spins don't count.

Payoff: Rosa's HUD portrait fills with her ruleros as you go. At the victory, her third-person model wears all six.

### 2. Kitchen Under Control

1. **Ingredient baskets (4):** two on the market floor, one on a crate, and one stuck on the elote kiosk's awning (hit the sign to shake it down).
2. **Get to the outdoor kitchen** on the terrace.
3. **Cook:** the timer fills while nothing interferes, in three steps. Interruptions:
   - The influencer climbs up to film. One hit sends him away.
   - The speaker cart parks below the terrace. It warms up for about 4 s (pulsing, shouting); two hits send it away. If it plays, the bass shakes a basket off the shelf to a recovery spot at the foot of the stairs, and cooking waits until you bring it back.
   - Halfway through, the kitchen timer goes haywire. Hit its button while the needle is in the green.
   - A disruption that lasts more than 9 s costs the current step only, never the whole dish.
4. **Deliver the tray** to the courtyard table. Two serving trolleys try to bump it out of Rosa's hands. A spill leaves the tray where it fell (always on walkable ground), and one hit stuns a trolley.

The menu (tamales de rajas con queso, agua de jamaica) is data in `config.menu`, so it can be changed without code.

### 3. Patio Panic

- **Courtyard:** two debris piles block the doorways. Wall switches send them flying into the bins and pop the overturned tables back up. Collision and navigation update when a pile clears or comes back.
- **Plaza:** two decorations are tangled high up. Only a bank shot off the marked tile panels frees them. Each has hundreds of working spots.
- **Alley:** two more piles, plus the leaf blower, who patrols all three areas.
  - His gust is telegraphed by a cone on the ground for 1.3 s.
  - Hit him during the wind-up (which also cancels the gust) or while the machine vents steam. Three hits switch him off.
  - A gust re-scatters any pile in an area you haven't finished.
- **Finally:** carry two chair stacks from opposite ends of the neighborhood into the storage corner.
- The courtyard brightens as each area is finished.

### 4. La Piñata Contraataca

| Phase | What happens | How to win it |
| --- | --- | --- |
| 1: find the rhythm | The piñata swings like a pendulum. One point glows at a time, and the lit point moves on every few seconds. | Lead your throws. Break three points (three hits each). |
| 2: party malfunction | Striped shield panels orbit it. Two waves of decoy mini-piñatas circle the plaza and lob confetti after a visible spin-up. | Pop the decoys (two hits each). Break the last two points through the gaps. |
| 3: the final opening | It stops swinging and faces Rosa. A drum roll warns that the core will open for 2.7 s. | One hit per opening, four openings. |

Hazards:

- **Candy bombs** mark a circle on the ground for 1.3 s before they burst.
- **Tantrum.** After every broken point the piñata spins for 3.6 s, nothing gets through, and three bombs land around Rosa.
- **Party tables** around the fountain give readable cover.
- **Party mirrors.** The two marked mirrors on the café and kitchen fronts allow an optional ricochet finish. It's never required.

Payoff: the piñata bursts into confetti and a capped handful of short-lived candy (nothing to collect). The gathering appears: neighbors and the reformed helpers at the tables, while the camera circles. It's skippable. The results screen then closes the campaign.

## Challenges and time targets

Each mission has three independent challenges:

- complete the mission
- beat the time target
- a skill challenge:

| Mission | Skill challenge | Time target |
| --- | --- | --- |
| 1 | Stop the delivery cart in 8 throws or fewer (5 hits are needed; the best measured was 8) | 2:00 |
| 2 | Cook without losing a preparation step | 5:15 |
| 3 | Disable the leaf blower before it scatters a second pile | 6:15 |
| 4 | Land the final hit with a ricochet | 2:15 |

**How the targets were set:** 2.5× the helper bot's median over 8 seeds (`scripts/campaign-sim.ts`), rounded up to 15 s. The bot navigates perfectly and aims with a small error, so these are meant to need a clean, practiced run. **No human playtesting has tuned them yet.**

**Every challenge is proven achievable** by tests: the bot or a scripted shot earns each one (`tests/campaign.test.ts`).

Rewards are cosmetic recognition only (stars on the mission cards). Nothing carries into multiplayer.

## Duration

Measured: the helper bot's completion times are listed in the results of `scripts/campaign-sim.ts`. A first-time human player will be slower, because they read, explore, miss, and take damage.

The 3-6 minute estimates on the cards are **estimates, not measurements**.

## How it is built

```
shared/campaign/
  types.ts        mission definitions: layout overlay, entities, stages, goals, challenges
  mission.ts      MissionSim: the deterministic 60 Hz mission simulation
  pinata.ts       the three-phase encounter (a component the sim hosts)
  hints.ts        "what next": drives HUD markers and tips, and the helper bot
  bot.ts          helper bot that plays any mission from the hints (tests, calibration, demos)
  missions/       ruleros.ts, cocina.ts, patio.ts, pinata.ts (data), index.ts (order)
src/campaign/
  runtime.ts      runs a mission in the engine: camera, viewmodel, events to sound and dialogue, victory
  view.ts         visuals for mission entities (no logic)
  mhud.ts         objective panel, counters, phase bar, off-screen arrow
  ui.ts           mission select, intro, pause actions, results
  progress.ts     versioned local save
```

- **Reuse.** Missions run on the same rules as multiplayer: movement and collision (`shared/physics.ts`), the throw solver (`launch`), ricochet stepping (`stepProjectileWorld`), the weapon table (`shared/config.ts`), and the navigation graph.
- **Reusable components.** Collect, interact (targets, with bank-only, heavy-only and timed variants), destroy, defend (with steps and setbacks), deliver, store, reach, the multi-phase encounter, hazards (telegraphed circles and cones), checkpoints and results. A mission is data that combines them.
- **Explicit state.** All mission state is one plain object:
  - A checkpoint is an exact snapshot, so a retry restores it precisely.
  - Objectives complete once.
  - A finished target never fires its actions again.
  - Pausing stops the simulation, so every timer stops with it.
- **Recovery, not restarts.**
  - Knocked-out Rosa returns at the stage checkpoint with progress kept.
  - Knocked-off ingredients go to a reachable recovery spot.
  - A spilled tray stays on the ground where it fell.
  - The hint system always offers a next action (this is tested).
- **Loading.** Mission code is a separate chunk (about 21 KB gzip) loaded when the first mission intro opens. Each mission preloads only its own voice lines. If the chunk fails to load, the intro offers a retry; if the voices fail, subtitles carry the dialogue.
- **Isolation from multiplayer.** Nothing in the campaign imports the server, rooms or protocol (tested). Campaign progress has its own storage key.
- **Co-op later.** The sim is deterministic and input-driven like the multiplayer one, so a cooperative mode could host `MissionSim` on the server the way rooms host `MatchSim`. That isn't built.
