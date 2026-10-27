# RC1 online test on your own Mac and phone (isolated)

This runs the exact release candidate, client and protocol-6 server, on your Mac. Your phone joins
over your home Wi-Fi. Nothing touches the production server, Vercel or Render. It takes about five
minutes to set up.

## Set up (Mac, in the repository)

```sh
git fetch origin && git checkout codex/close-combat-rc1 && npm ci
IP=$(ipconfig getifaddr en0)            # your Mac's Wi-Fi address, e.g. 192.168.1.20
VITE_GAME_SERVER_URL=ws://$IP:8787/ws npm run build
ALLOWED_ORIGINS=http://$IP:4173,http://localhost:4173 PORT=8787 npx tsx server/index.ts &
npx vite preview --host --port 4173 --strictPort
```

- **Check the server:** `curl http://$IP:8787/healthz` should print `"protocol":6`.
- **Open the game:** Mac at `http://$IP:4173/`, phone at the same address. Use the IP address, not
  `localhost`, on both. The Mac and the phone must be on the same Wi-Fi.
- **Stop it:** Ctrl+C the preview, then `kill %1` the server.

## The same-tab invite check (the one open item)

1. On the phone, open the game and stay on the title screen.
2. On the Mac, choose Online, then Create, and copy the invite link.
3. Paste the link into the phone's existing tab (the address bar of the tab already showing the game)
   and press Go. The join screen should appear within about 2 seconds with the code filled in.
   Tap Join to reach the lobby.
4. Repeat the other way round: the phone creates, and the Mac pastes into its open tab.
5. Then play one match together: move, jump, throw, melee, score, rematch. Turn Wi-Fi off on the
   phone for 5 seconds and back on: it should reconnect into the same match.

## If something goes wrong

On the device that failed, open Menu, then Settings, then Copy diagnostics, and send it to me.
