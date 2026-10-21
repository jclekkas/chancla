// Shared Chromium launcher for the verification scripts. Uses the system
// Playwright browser when present, otherwise Playwright's default lookup.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

export async function launch(extraArgs = []) {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium',
  ].filter(Boolean);
  const executablePath = candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
  return chromium.launch({
    executablePath,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', ...extraArgs],
  });
}
