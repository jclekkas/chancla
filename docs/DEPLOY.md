# Deploying online play

Online play needs two pieces:

1. **The site** (static files from `npm run build`, in `dist/`). It already deploys on Vercel from this repo.
2. **The game server** (`server/index.ts`, a single Node process holding rooms in memory). Vercel cannot host it, because it needs a long-lived WebSocket process. Any host that runs a container or a Node process with WebSockets works: Fly.io, Render, Railway, a small VPS.

Nothing in this repository has provisioned a server. Until one exists, the site shows "Online play is not set up on this deployment yet" and practice still works offline.

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
