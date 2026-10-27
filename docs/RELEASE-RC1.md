# Release candidate 1

- **Branch:** `codex/close-combat-rc1`. The candidate commit is the tip of that branch; this file is
  part of it.
- **Base:** `codex/close-combat` at `5be5b92`, plus release preparation.
- **Production today:**
  - client: `main` at `d27f74d` on Vercel (chanclawarfare.fun);
  - server: Render service `chanclawarfare-game-server`, from branch `codex/online-production`
    (latest `8e543ee`).
  - Both speak protocol 4.
- **This candidate:** protocol 6. Client and server must change together (see "Cutover").
- **Status:** not deployed. Production is untouched.

## What players get (everything since main, 117 commits)

- **Close combat:**
  - El Chanclazo and El Revés melee on V, a Slap button on touch screens, and melee in Classic too.
  - Ruleros (hair rollers) knocked off by head hits.
  - Comic hit words, slap stars, and feedback on your own misses. Bots brawl.
- **¡Puro Chanclazo!:** a melee-only ruleset in Practice, Create Room and the lobby. Joiners take
  the host's rules.
- **Elimination replay (killcam):** with Skip, on by default (it can be turned off in Settings).
- **Environment, on all three maps:**
  - **El Patio kit:** plaster, flagstones, windows, eaves, dressed lane walls.
  - **Lighting:** warm sun with cool shade, plus a baked occlusion field.
  - **Anti-aliasing:** on every tier.
  - **El Patio only:** CC0 textures (plaster, cobbles, wood) on High and Medium, colour-only on Low.
- **Characters:**
  - the new Rosa model (blinks, skirt, planted feet);
  - first-person hand tiers and one chancla design;
  - team colour that holds in shade on High and Medium.
- **HUD:** a minimap, a cafecito hint, compact name tags, one mode line, a labelled Scores button.
  The spawn banner now lasts 2.8 s at any frame rate.
- **Audio:** new combat sounds and a voice line.
- **Controls and stability:**
  - Space skips the replay; F/E presses fire; no drift after pausing.
  - A quality change frees the old shadow map.
  - Pause no longer advances the match.
- **Maps:** La Plaza gains stalls and a fountain; La Fiesta gains bulbs, tables and a dance floor.

## Kept out of production builds

- **Offline review builds only:** `courtyard.html` (graphics lab), `?bench`, and the candidate Rosa
  model. A saved or devtools setting cannot turn the candidate on in production.
- **Builds from `codex/graphics*` or `codex/close-combat*` refs:** these are offline-only (CSP
  `connect-src 'self'`, no online play). That includes this candidate's own Vercel preview. Production
  must therefore be built from `main`.
- **Harmless switches that ship:** `?mat=classic|toon|std` and `?ao=0`.

## Compatibility

- **Version mismatch:** a v4 client meeting a v6 server, or the reverse, gets
  `error code:'version'` and close code 4002. The page says "This page is out of date. Refresh to play
  online."
  - That is correct for an old tab once the site has updated.
  - It is misleading in the other direction, a v6 page meeting a v4 server, which is why the server
    goes first.
- **Rooms live in memory:** a server deploy ends every live match ("room gone"). Players re-create
  rooms.
- **Caching:** HTML revalidates on every load, and assets are content-hashed. Open tabs keep the old
  code until they are refreshed.
- **Server config:** the code under `server/` is unchanged apart from `/healthz` now reporting
  `protocol`. Only `shared/` changed. No new environment variables.

## Final checks (after visual approval)

- **Same-tab invite: resolved.** `scripts/sametab-invite-e2e.ts` uses one browser page on the
  production-mode build and a protocol client as host.
  - Three rounds, all passed: the join screen appeared with the code in 1.7-4.5 s on the software
    renderer, and Join reached the lobby.
  - The earlier `failure-e2e` timeout came from that test running two heavy pages at once, not from
    the invite path. It also failed with anti-aliasing off, and the invite code is unchanged since
    main.
  - For devices: `docs/RC1-LAN-TEST.md` runs the candidate's client and a v6 server on your Mac.
- **Killcam: resolved, with one visual limit.** `scripts/killcam-classify.ts` ran 12 confirmed
  deaths (Medium and Low; Chanclazo, Revés and thrown), with Escape pressed only once the replay was
  showing.
  - Every death ended in a replay that played to its end, and control returned every time. No
    fallback was needed.
  - Escape opened the menu and held the replay, which then finished.
  - The killcam suite's failures were its fixed 3-4 s waits running at 1-1.6 s per frame.
  - **Limit:** in 2 of 4 thrown replays the chancla was not drawn in flight. The flight lasts about
    0.25 s, and these replays rendered one or two frames. A device at normal frame rate renders it;
    confirm by eye.

## Rollback targets

| Side | Today | How it is known |
|---|---|---|
| Vercel production | `main` `d27f74d`, deployment `2fL39qXDmaVfQLHC4AR1BoWmZbab` (built 23 Oct, 02:30 UTC) | GitHub's Vercel status for the tip of `main`. **Confirm** in Vercel, under Deployments then Production, that it is the current one: a manual promote or redeploy would not show on GitHub. |
| Render server | branch `codex/online-production`, tip `8e543ee` | `render.yaml`, with auto-deploy off. **Confirm** the live commit in Render under Events: Render reports nothing to GitHub, and production was not contacted from here. |

## Cutover (needs your approval at each step)

1. Pick a quiet time. Note the current Render deploy and the current Vercel production deployment
   (main `d27f74d`, Vercel status `2fL39qXDmaVfQLHC4AR1BoWmZbab`; confirm in the dashboard that it is
   the one serving production).
2. **Server first:**
   - Fast-forward `codex/online-production` to the candidate commit. It is a descendant, so no force
     is needed.
   - Trigger a manual deploy in Render (auto-deploy is off).
   - Wait for `/readyz`.
   - Check that `https://chanclawarfare-game-server.onrender.com/healthz` shows `"protocol":6`.
3. **Client, at once:**
   - Merge the candidate into `main` (a PR from `codex/close-combat-rc1`; PRs #9 and #11 stay drafts
     or are closed).
   - Vercel builds production from `main`, so online play is enabled.
   - The gap between steps 2 and 3 is the build time, about 1-2 minutes. During it, open v4 pages get
     the refresh message.
4. **Smoke test:**
   - `GAME_SERVER_URL=wss://chanclawarfare-game-server.onrender.com/ws GAME_SITE_ORIGIN=https://chanclawarfare.fun npm run smoke:online`.
   - Then one real 2v2 with a phone joining by invite link.

## Rollback (restore both sides, together)

1. **Client:** in Vercel, Instant Rollback to the previous production deployment (main `d27f74d`), or
   revert the merge on `main`.
2. **Server:**
   - In Render, roll back to the previous deploy (the one noted in step 1).
   - Also reset `codex/online-production` to `8e543ee`, so a later manual deploy does not bring v6
     back. That reset is a force-push and needs your approval.
3. Check that `/healthz` reports no `protocol` field (the old build), or confirm the old commit in
   Render.

Rolling back only Vercel leaves v4 pages talking to a v6 server: online play would fail for everyone
until the server is rolled back too.
