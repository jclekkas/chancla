# Deploying online play

Online play needs two pieces:

1. **The site** (static files from `npm run build`, in `dist/`). It already deploys on Vercel from this repo.
2. **The game server** (`server/index.ts`, a single Node process holding rooms in memory). It needs an always-on process with all players routed to that same process. Vercel now supports WebSockets, but its autoscaled functions are not a drop-in host for this in-memory room registry. Use a single always-on container on Render, Fly.io, Railway, or a VPS unless the room architecture is redesigned.

Nothing in this repository has provisioned a server. Until one exists, the site shows "Online play is not set up on this deployment yet" and practice still works offline.

## Prepared production release

`render.yaml` defines one Docker web service in Virginia, using the
`0.5c-512mb` paid plan (listed at $7/month on 2026-10-21, before excess usage).
Applying it creates billable capacity and requires the owner's approval and
connected Render account. This file alone does not deploy anything.

- Source branch: `codex/online-production`, based on production's `934f88b`.
- One instance, no automatic deploys. Coordinate server/client releases; a
  server deploy interrupts existing rooms. Never autoscale this configuration.
- Starts with a conservative 20-room admission ceiling, not a measured
  capacity guarantee. Measure tick time and bandwidth before increasing it.
- Production site origins are explicitly allowed, including
  `https://chanclawarfare.fun`; no wildcard origin access.
- No database, paid preview instances, or new custom domain is required.

After Render reports the server ready, record its actual assigned hostname
(do not guess it). Verify `/readyz` and run:

```bash
GAME_SERVER_URL=wss://ACTUAL-HOST/ws \
GAME_SITE_ORIGIN=https://chanclawarfare.fun npm run smoke:online
```

This creates temporary private four-player rooms on Patio, Plaza and Fiesta,
checks CORS, the protocol handshake, team balance, synchronized snapshots,
input acknowledgments, reconnection identity and owner migration, then leaves.
It does not simulate human play or prove browser compatibility.

Only after that passes, set `VITE_GAME_SERVER_URL` in the Vercel production
environment to that exact WebSocket address and rebuild the matching source
commit. Open two isolated browser sessions on the production domain, invite,
ready up, play to results, and rematch. Confirm pause/menu leaves the online
match running and that returning resumes input. Keep the previous deployment
available for rollback. GitHub `main` must be reconciled with the release before
resuming automatic production pushes, so an old branch cannot replace it.

Current scope is desktop-browser private 1v1/2v2 rooms, optional bot fill and
three selectable maps. Public matchmaking, cross-server persistence and mobile
online controls are not implemented by this hosting configuration. Mobile
Arcade remains its separate touch beta.

## Phones (touch online play)

- **No server change.** Touch players send the same input messages as keyboard and mouse players (protocol 4).
- **Server address.** When the build doesn't set `VITE_GAME_SERVER_URL`, the client uses the production server address (`wss://chanclawarfare-game-server.onrender.com/ws`) on this project's own hostnames:
  - `chanclawarfare.fun`, with or without `www`
  - `chancla.vercel.app` and `chanclawarfare.vercel.app`
  - the multiplayer preview, `chancla-git-multiplayer-jclekkas.vercel.app`

  These are the origins in `render.yaml`'s `ALLOWED_ORIGINS`. `VITE_GAME_SERVER_URL` still takes precedence. Any other host must set it.
- **Rooms survive a locked phone briefly.** A phone that freezes the page and its socket is detected after 6 s of silence and reconnects through the existing path. The room keeps the slot for `NET.reconnectGraceMs` (25 s).

## 1. Run the server

Container (recommended):

```bash
docker build -t chancla-server .
docker run -p 8787:8787 \
  -e ALLOWED_ORIGINS=https://chancla.vercel.app \
  -e TRUST_PROXY=1 \
  chancla-server
```

Without Docker:

```bash
npm ci
npm run build:server
NODE_ENV=production ALLOWED_ORIGINS=https://chancla.vercel.app node dist-server/index.js
```

Settings are listed in `server/.env.example`. `ALLOWED_ORIGINS` is mandatory in production: the process exits at startup without it.

The host must terminate TLS so the browser connects with `wss://`. Pages served over https cannot open plain `ws://`. Fly, Render and Railway do this for you.

`fly.toml.example` is a starting point for Fly.io. It keeps one machine always on, because rooms live in memory and a stopped machine drops every match.

## 2. Point the site at it

In the Vercel project settings, add this environment variable and redeploy:

```
VITE_GAME_SERVER_URL=wss://YOUR-SERVER-HOST/ws
```

The value is baked into the build. It contains no secret: it is only the public address of the server.

## 3. Check it

- `https://YOUR-SERVER-HOST/healthz` returns `{"ok":true,"rooms":0,...}`.
- The title screen says "Online server ready".
- Create a room in one browser, open the invite link in another (or on a second machine), ready up and start.

## Operations

| Endpoint | Meaning |
| --- | --- |
| `GET /healthz` | Liveness, plus room, player and tick-timing counters. |
| `GET /readyz` | 200 normally, 503 while shutting down. Use it for load balancer health checks. |
| `WS /ws` | Game protocol (`shared/protocol.ts`). |

- **Logs** are one JSON object per line on stdout. Room codes are never logged; rooms show up as a short hash tag.
- **Graceful shutdown:** on SIGTERM the server stops accepting connections, tells every client it is restarting, and exits within 3 seconds. Matches in progress end. Clients show "The room is no longer available" and can create a new room.
- **Restarts lose rooms.** There is no persistence, which is acceptable for private casual matches. Deploy during quiet hours.
- **Scaling:** one process handles every room. A small shared-CPU machine has been measured locally only (see the README). Rooms cannot move between processes, so running several instances requires sticky routing by room. That is not built.
- **Limits:** 4 KB per message, per-connection input and control rate limits, 12 connections per IP, 300 rooms. Change them with the environment variables above.

## Costs and authorization

Hosting the server costs money on most providers once you go past a free tier. Nothing here creates an account, buys capacity, or changes DNS. Do those steps yourself, or explicitly approve them.
