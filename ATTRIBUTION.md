# Asset attribution

Everything in Chancla Warfare is original to this project except the items below.

## Original work (this repository)

- All 3D models (Doña Rosa's hand, the chancla, every character, the courtyard) are built procedurally from primitives in `src/models/` and `src/world/`.
- Doña Rosa's portrait, the chancla icon, the favicon and the score card are original vector art in `src/ui/art.ts`, `src/ui/share.ts` and `public/favicon.svg`.
- `public/og-image.jpg` and the PNG icons are rendered from the game itself by `scripts/make-assets.mjs`.
- All sound effects, and the fallback music score and stingers, are synthesized at runtime with the Web Audio API (`src/audio/audio.ts`, `src/audio/music.ts`).
- All dialogue and interface text.

## Third-party

| Asset | Author | License | Where |
| --- | --- | --- | --- |
| Lilita One typeface | Juan Montoreano | SIL Open Font License 1.1 | `node_modules/@fontsource/lilita-one`, bundled into `dist/assets/` at build time. License text ships in the package (`LICENSE`) and is copied to `public/licenses/LilitaOne-OFL.txt`, which deploys with the site. |
| three.js | three.js authors | MIT | Runtime dependency (`three`). |
| ws | ws authors | MIT | Game server dependency. |
| SVOX Pico 1.0 (es-ES voice) | SVOX AG / Android Open Source Project | Apache-2.0 (language data redistributable) | Used offline to generate the temporary voice clips in `public/voice/`. Not shipped as software. |
| Recorded soundtrack (5 instrumental tracks) | Generated with Suno by the project owner | Paid Suno subscription: ownership and commercial use per Suno's terms for subscribers (see [docs/ASSETS.md](docs/ASSETS.md)) | Originals in `assets/music/originals/`; prepared loops in `public/music/`. |
| eSpeak NG 1.51 | eSpeak NG contributors | GPL-3.0 (program); generated audio is not covered | Used offline to generate the machine voices in `public/voice/`. Not shipped as software. |

Build and test tooling (Vite, TypeScript, Vitest, jsdom, Playwright) is used only during development and is not shipped.
