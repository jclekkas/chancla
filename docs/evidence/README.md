# Evidence

Captured from the production build in this Linux container: headless Chromium with SwiftShader software rendering, and the local game server. Online play was not run on a deployed server.

| File | What it shows |
| --- | --- |
| `2p-01-title.png` | Title screen with the server status line ("Online server ready") |
| `2p-02-lobby-host.png`, `2p-03-lobby-guest.png` | Private room from the host's and the guest's side: code, invite link, teams, ready state |
| `2p-04-countdown.png` | Match countdown |
| `2p-05-combat.png` | Live 1v1: server-confirmed elimination, damage number, opponent nameplate, killfeed |
| `2p-06-scoreboard.png` | Hold-Tab scoreboard mid-match |
| `2p-07-results-host.png`, `2p-08-results-guest.png` | Identical results on both clients; rematch controls only for the host |
| `2p-09-confirm-leave.png` | Leave-match confirmation |
| `2p-match-clip.webm` | 60 s of the 1v1, recorded from player 1 (re-encoded to 640 px, 15 fps). It shows the countdown, movement, the scoreboard, an elimination, the weapon switch, and a defeat and respawn. The low frame rate is software rendering. |
| `4p-02-lobby-host.png`, `4p-06-scoreboard.png`, `4p-07-results-host.png` | The 2v2 run: a full room, the automatic 2v2 split, and results (0-0 on time; see the main README). The Ping column shows "–" because this run predates the ping-reporting fix. |
| `e2e-2p.json`, `e2e-4p.json` | Step log, checks (invite format, ready gating, consistent results, host-only rematch, score reset), per-client info, console errors (none) |
| `bench-server.txt` | Server CPU cost per room at 1, 10, 25 and 50 rooms |
| `p-01-title-es.png` | Title in Spanish |
| `p-02-practice-scoreboard.png` | Practice 2v2: every bot labeled BOT on the scoreboard and nameplate; the PRACTICE badge |
| `p-04-pause.png` | Practice paused (the clock was checked to be frozen) |
| `p-06-no-webgl.png` | Chromium with 3D disabled: the title explains why, play is disabled, settings still work |
| `practice-e2e.json` | 12 checks from `scripts/practice-e2e.ts`, all passing |
