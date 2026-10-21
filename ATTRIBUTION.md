# Asset attribution

Everything in Chancla Warfare is original to this project except the items below.

## Original work (this repository)

- All 3D models (Doña Rosa's hand, the chancla, every character, the courtyard) are built procedurally from primitives in `src/models/` and `src/world/`.
- Doña Rosa's portrait, the chancla icon, the favicon and the score card are original vector art in `src/ui/art.ts`, `src/ui/share.ts` and `public/favicon.svg`.
- `public/og-image.jpg` and the PNG icons are rendered from the game itself by `scripts/make-assets.mjs`.
- All sound effects and music are synthesized at runtime with the Web Audio API (`src/audio/audio.ts`). There are no audio files.
- All dialogue and interface text.

## Third-party

| Asset | Author | License | Where |
| --- | --- | --- | --- |
| Lilita One typeface | Juan Montoreano | SIL Open Font License 1.1 | `node_modules/@fontsource/lilita-one`, bundled into `dist/assets/` at build time. License text ships in the package (`LICENSE`) and is copied to `public/licenses/LilitaOne-OFL.txt`, which deploys with the site. |
| three.js | three.js authors | MIT | Runtime dependency (`three`). |

Build and test tooling (Vite, TypeScript, Vitest, jsdom, Playwright) is used only during development and is not shipped.
