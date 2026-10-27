# ¡Puro Chanclazo! (melee-only combat)

A combat mode for Practice and Online play in which nobody can throw. The primary attack swings the
chancla in hand: El Chanclazo with La Chancla, El Revés with La Pesada. Everything else is reused
as it was: team deathmatch, maps, damage, reach, timing, cooldowns, hit detection, ruleros, hit
reactions, the killcam, music and bilingual text. Classic stays the default. The campaign and
Classic Arcade are unchanged.

## Where to choose it

- **Practice:** Play offline (practice), then **Combat mode**, the first choice in the setup panel.
  Picking ¡Puro Chanclazo! also selects La Fiesta, which any other map can replace.
  ([English](practice-selector-en.jpg), [Spanish on a phone](practice-selector-es-phone.jpg))
- **Online:** Play online, then **Combat mode** above *Create private room*.
  ([selector](create-room-selector.jpg))
- **Lobby:** the host can change the mode between matches, and everyone sees the change at once.
  Other players see it read-only. The rules line under the teams says "melee only".
  ([host](lobby-host.jpg), [joiner](lobby-joiner.jpg))

There is no new main-menu entry and no room browser, so there is no room listing.

## How it plays

- **Primary attack:** a left click, F or E, or the big touch button swings. One press is one swing,
  however long it is held and however short it is: a press shorter than one game tick is still
  caught. V still swings. Pressing the primary attack and V together is still one swing, and the
  swing's own lockout and input buffer apply as always.
- **Weapons:** switching works as before (1, 2, Q, the mouse wheel, right click, or the Switch
  button).
- **Match introduction:** the HUD shows a **¡PURO CHANCLAZO!** chip next to the team chip. The
  first spawn banner adds "No throwing: click or V to swing", and the weapon cards read "Click · V".
  The first-spawn tip explains both attacks. ([HUD](hud-melee-desktop.jpg))
- **Pause and Controls:** the pause menu shows "Combat mode: ¡Puro Chanclazo!" (or Classic) for
  Practice and Online matches. The Controls screen says what each button does in this mode.
  ([pause](pause-melee.jpg))
- **Phone:** the Throw button becomes **Slap** (Spanish **Chanclazo**), in the same place and
  size, with a visible label and an accessible name. The separate melee button is hidden, because
  it would do the same thing. Jump, Switch, crouch, aiming and Menu are unchanged. Classic brings
  back Throw and the melee button. ([Slap](phone-melee-en.jpg), [Chanclazo](phone-melee-es.jpg),
  [Classic](phone-classic-en.jpg))
- **Killcam:** the replay credits the finishing blow to El Chanclazo or El Revés.
  ([killcam](killcam-melee.jpg))
- **Changing modes:** any button held when the rules change is dropped, so nothing carries over
  from one mode to the next.

Clip: [both-attacks.mp4](both-attacks.mp4). Swinging with the primary attack only, El Chanclazo
lands, then the player switches to La Pesada and El Revés lands. The clip is rendered frame by
frame on a fake clock, so it plays at true speed.

## Authority

- **Who decides:** the ruleset belongs to the room (`RoomView.rules`) and is fixed for each match
  (`MatchSim.rules`). Only the host can change it, and only between matches. A rematch keeps it.
  Joiners, invite links, room codes and reconnects all take it from the room; a player's own saved
  choice is never sent when joining.
- **Server enforcement:** under melee-only rules the simulation never launches a throw, whoever
  asks. A primary-button press becomes one swing, and any further held or forged throw bits are
  counted and dropped (`refusedThrows`). This applies the same way to people, bots, practice (the
  in-browser host) and online rooms, because they all run the same simulation.
- **Client prediction:** the session (`GameSession.tick`) applies the same rule to what it
  predicts and sends, so prediction and reconciliation agree with the server.
- **Bots:** under melee-only rules every encounter is a brawl. Bots walk in from any range and use
  the existing melee decision; they never press the primary attack and never wait to throw. In
  Classic the bots' random sequence is unchanged.
- **Missing values:** a missing or unknown ruleset is Classic everywhere: older messages, older
  saved settings, and a `create` without rules.

## Protocol and rollout (not done here)

`PROTOCOL_VERSION` goes from 5 to 6, because rooms now carry `rules` and there is a new `rules`
message. As with earlier bumps, a version 5 client and a version 6 server refuse each other at
`hello`. An eventual online release must therefore deploy the game server and the web client
together. This preview is offline-only and changes neither production nor Render.

## Why La Fiesta is the suggested map

Bot-only melee matches, 2 against 2, 4 seeds × 3 minutes per map (about 12 simulated minutes each):

| Map | Eliminations a minute | Melee hits a minute | Throws |
|---|---|---|---|
| La Fiesta | 15.6 | 55.5 | 0 |
| El Patio | 13.8 | 50.3 | 0 |
| La Plaza | 13.1 | 46.8 | 0 |

Every map works, and no map was resized or changed.

## Checks

- Typecheck and builds (offline preview and localhost) pass.
- Unit and multiplayer: 447 of 447, including two new test files.
- **`tests/puro-chanclazo.test.ts` (9 tests).** It checks:
  - missing or unknown rules mean Classic (messages, rooms, matches, old saves);
  - Classic still throws and swings;
  - the primary attack gives El Chanclazo and El Revés, and weapon switching works;
  - a 4-second forged throw hold gives no projectile and one swing;
  - the primary attack plus V, and mashing both, never doubles a swing or beats its cooldown;
  - forged raw inputs reaching the host are refused;
  - the rules cannot change mid-match;
  - bots never throw and both teams score;
  - the client session predicts one swing for a held press and for both buttons together.
- **`tests/mp-puro.test.ts` (real server process, simulated latency).** It checks:
  - joiners get the host's rules, and a non-owner cannot change them;
  - one player eliminates another with the primary attack only (El Revés to the head);
  - a forged client sends 20+ raw throw inputs and nobody sees a throw;
  - all three clients agree on hits, damage, the elimination and the score;
  - the owner's switch to Classic and back reaches everyone;
  - a rematch keeps the rules;
  - a reconnect and a late join by code both get them.
- **Browser (`scripts/puro-e2e.ts`): 23 of 23** ([puro-e2e.json](puro-e2e.json)). It covers:
  - the selector and the suggested map;
  - the HUD;
  - the primary hold, primary plus V, V alone, and a sub-tick press;
  - El Revés after switching weapons;
  - pause and resume;
  - the killcam attribution;
  - Classic restored, with nothing held across the switch;
  - on a phone: Slap (EN), Chanclazo (ES), one swing per tap, jump, menu, and Classic restored;
  - online, with a local server: host and joiner lobbies, and the host's change reaching the joiner.

  In one earlier full run the "Classic throws" check (a 150 ms key hold) failed once. With a
  300 ms hold it passed 3 of 3 runs on its own and in the final full run. Classic's throw code is
  unchanged.
- The killcam browser test (29 of 29) from the lighting checkpoint still applies; the replay code
  is unchanged.

All of this ran in Linux Chromium with SwiftShader. The phone was emulated. Nothing was run on a
real Mac, in Safari, or on a real phone.

## Limits

- When an enemy stands right in front of you at the first spawn, their name tag can cover part of
  the banner's rules line for a moment.
- Bots brawl in every encounter under these rules; their difficulty is not rebalanced.
- The suggested-map numbers come from bots only, and encounter rates between people will differ.

## Manual check on the Mac and a phone

1. **Practice on the Mac:** choose ¡Puro Chanclazo!, then:
   - a click swings, and holding the button gives a single swing;
   - V swings, and a click plus V gives one swing;
   - 2 then click is El Revés;
   - nothing is ever thrown.
2. **Trackpad:** quick taps each give one swing.
3. **Pause:** Esc shows "Combat mode: ¡Puro Chanclazo!"; resume works.
4. **Back to Classic:** leave, choose Classic, and the click throws again.
5. **Phone in landscape:** the big button reads Slap (Chanclazo in Spanish). Each tap is one
   swing. Jump, Switch and Menu work.
6. **Online, two devices, local server:** create a ¡Puro Chanclazo! room. The other device joins
   by code and sees it locked. Fight, rematch, and the mode stays.
7. **Killcam:** after a melee elimination, the replay names El Chanclazo or El Revés.
