# Preview test guide (for testers)

**Preview link (always the latest `multiplayer` build):** https://chancla-git-multiplayer-jclekkas.vercel.app/

**Open all four missions at once:** https://chancla-git-multiplayer-jclekkas.vercel.app/?unlock=all

`?unlock=all` works only on preview builds. It doesn't change your saved progress, and production ignores it. Without it, missions unlock one at a time as you finish them, which is how players will see it.

**If the link asks you to log in to Vercel**, the project's Deployment Protection is on. It protects preview links by default. The Vercel account owner can let Brenda in either way:

1. In the Vercel dashboard, open **chancla → Settings → Deployment Protection**. Under **Vercel Authentication**, either turn protection off for previews, or create a **Shareable Link** and send her that instead.
2. Or have her log in with a Vercel account that is a member of the project's team.

Either way, production is unaffected.

**If `?unlock=all` still shows locked missions**, the preview was built without Vercel's system environment variables. Either play the missions in order, or add `PREVIEW_BUILD=1` for the Preview environment in Vercel and redeploy.

Use a computer with a mouse or trackpad. This release does not support phones and tablets for play. Chrome or Edge on Windows, or Chrome or Safari on a Mac, are the intended browsers.

## What works in this preview and what doesn't

| | Status |
| --- | --- |
| Story campaign (4 missions) | **Works**, fully in the browser |
| Practice with bots | **Works**, fully in the browser |
| Classic solo arcade (`/classic.html`) | Works |
| **Online multiplayer** | **Not available.** No game server is hosted yet. The title screen says "Online play is not set up on this deployment yet." Hosting one is a separate step that may cost money; it is waiting on your approval. |
| **Voices** | **Temporary.** Every line is spoken by a clearly synthetic placeholder voice (offline text-to-speech, Castilian Spanish). They show when and how lines play, not how the final performance should sound. Please judge the writing and timing, not the voices. |
| Music | **The five Suno tracks**: Rosa's theme on the menus, Ruleros in Mission 1, Fricas y Fricas in Missions 2 and 3, Guerra de Vecinos in the piñata finale, and Bounce y Joke in practice. Each one loops. The loop points were chosen by analysis and nobody has listened to them yet, so you will be the first. If a track is slow to download, the old synthesized music plays until it arrives. |
| Effects | Synthesized in the browser. |

## How to play

| Action | Keys |
| --- | --- |
| Move | WASD |
| Look | Mouse; click the game first to capture the mouse |
| Throw | Left click or F |
| Weapons | 1 / 2: La Chancla / La Pesada |
| Jump / crouch | Space / C |
| Menu | Esc: pause, retry from checkpoint, restart, settings, leave |

Settings include music, effects and dialogue volume, subtitles (menu language, Spanish, English, off), automatic banter on or off, objective markers, mouse sensitivity and invert Y.

## Recordings of the game playing itself

These were recorded in a headless test browser with software rendering, with a test bot playing. They're slower and blockier than on a real computer. Sound is the game's own mix, and the voices are the placeholders.

- Mission 1, Operación Ruleros: [1-ruleros-gameplay.webm](https://github.com/jclekkas/chancla/raw/multiplayer/docs/evidence/campaign/1-ruleros-gameplay.webm)
- Mission 2, Kitchen Under Control: [2-cocina-gameplay.webm](https://github.com/jclekkas/chancla/raw/multiplayer/docs/evidence/campaign/2-cocina-gameplay.webm)
- Mission 3, Patio Panic: [3-patio-gameplay.webm](https://github.com/jclekkas/chancla/raw/multiplayer/docs/evidence/campaign/3-patio-gameplay.webm)
- Mission 4, The Piñata Strikes Back: [4-pinata-gameplay.webm](https://github.com/jclekkas/chancla/raw/multiplayer/docs/evidence/campaign/4-pinata-gameplay.webm)
- Screenshots: [docs/evidence/campaign/](https://github.com/jclekkas/chancla/tree/multiplayer/docs/evidence/campaign)

## Checklist

Please note your computer, browser, and whether you used a mouse or a trackpad. Score each line 1-5 and add a word or two.

**Movement**
- [ ] Walking, jumping, crouching and stairs feel responsive and predictable
- [ ] Mouse look feels right. Is the default sensitivity too fast or too slow?
- [ ] Esc, clicking back in and alt-tabbing never leave you stuck or walking on your own

**Throwing**
- [ ] La Chancla lands where the crosshair points
- [ ] La Pesada feels slow, heavy and worth it
- [ ] Bank shots off the tiled panels (Missions 1 and 3) feel fair. How many tries did you need?
- [ ] Hit feedback (marker, sound, reaction) is clear

**Graphics**
- [ ] The neighborhood reads clearly; you can tell people, props and targets apart
- [ ] Each mission's lighting and set dressing feels different (morning, noon, afternoon, dusk)
- [ ] The frame rate is smooth (Settings → Show frame rate). Note the number.

**Mission clarity**
- [ ] You always know what to do next (objective panel, gold arrow, tips)
- [ ] You were never stuck or lost for long. If you were, where?
- [ ] Retry from checkpoint and restart behaved as expected

**Music**
- [ ] Each mission's music fits its mood; the piñata finale feels like a finale
- [ ] Music never drowns out footsteps, warnings or dialogue (it should dip whenever someone speaks)
- [ ] Loops: stay in a mission for 2 minutes or more (Missions 1-3), or leave the menu running. Does the music jump or stutter when it repeats? Note roughly when.
- [ ] Transitions: menu to mission select, mission start, leaving a mission. Is each change smooth, with no gap or clash?
- [ ] Volume: Settings → Music at 0 silences it; other levels scale it
- [ ] Nothing grates after several minutes

**Humor**
- [ ] Rosa's lines (read the subtitles) are funny and in character
- [ ] The situations are funny: the influencer's photo shoot, the toy cart, the haywire timer, the leaf blower, the piñata's tantrums
- [ ] Lines come at the right moments and don't repeat too often

**Difficulty**
- [ ] Time per mission (shown on the results screen). The test bot's times were roughly 0:47, 2:00, 2:28 and 0:47.
- [ ] Too easy, about right, or too hard? Which moment was hardest?
- [ ] Did you get knocked out? Where?

**Anything that broke:** what you did, what happened, a screenshot if you can.
