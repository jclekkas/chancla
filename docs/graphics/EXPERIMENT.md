# Courtyard graphics experiment

Production is explicitly out of scope. Do not merge this branch to main, promote a deployment, change production aliases or environment variables, or modify the Render service without new explicit user approval.

## First milestone

Open `/courtyard.html` on the graphics preview. This independent page imports only rendering code and contains no multiplayer client, audio, gameplay loop or production API calls. A `connect-src 'none'` CSP blocks outbound fetch/WebSocket connections. It is an environment inspection page, not a playable replacement for the game.

Before uses the world and material sources from production d27f74d (these files were unchanged from 75476b7). Experiment uses the graphics-polish materials plus layered cornices and inset corner masonry. The authoritative collision map is unchanged. Both use the same fixed camera, FOV, resolution and lighting theme. Characters are not part of this milestone.

Three camera presets: courtyard, facade detail, overview. Three quality settings. Save screenshot exports the actual canvas. Measure records ten seconds after a one-second warmup. Save results exports all completed measurements with build, variant, view, resolution, browser, average FPS, p95 frame time, draw calls and triangle count. Switching views, resizing, or hiding the tab cancels a measurement.

## Evidence and limitations

Typecheck and production bundle build verified locally. No actual rendered visual assessment or device performance figures yet: the prior available cloud browser failed WebGL initialization; the local Chromium download failed. Do not represent generated concept images or static-scene timing as real match evidence. The lab keeps both variants in memory for comparison, and uses preserveDrawingBuffer for capture; its memory and frame timing are not equivalent to production gameplay.

## Review procedure

1. Open on Mac Chrome/Safari; use Courtyard at High, save Before and Experiment screenshots without resizing.
2. Measure each variant with the tab visible; save results.
3. Repeat Facade detail and Overview, checking for seams, clipping, floating trim, glare and readability.
4. Repeat on a phone at Medium and Low. Record actual hardware separately; browser identity is not proof of hardware.
5. Only after visual review, expand the environment kit and integrate into offline practice. Full-match performance, input, audio, recovery and multiplayer remain separate acceptance checks.

## Subsequent scope

Finish a representative courtyard section, then improve Rosa and first-person presentation, then expand to one whole map. The prior 80-hour figure is a planning cap, not measured elapsed work or a guaranteed visual result. No paid assets or infrastructure are authorized by this experiment.
