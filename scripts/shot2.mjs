import { launch } from './browser.mjs';
const url = process.argv[2] || 'http://localhost:4173/';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'warning') logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => !!window.__chancla, null, { timeout: 30000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `artifacts/title.png` });
await page.click('#btn-play');
await page.waitForTimeout(500);
await page.evaluate(() => window.__chancla.app.game.debugJumpToWave(Number(new URL(location.href).searchParams.get('w') ?? 0)));
const wave = Number(process.argv[3] ?? 0);
await page.evaluate((w) => window.__chancla.app.game.debugJumpToWave(w), wave);
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(2500);
  // Face the nearest enemy so it is in frame.
  await page.evaluate(() => {
    const g = window.__chancla.app.game;
    const e = g.enemies.pool.find((x) => x.alive) ?? null;
    const tx = e ? e.pos.x : g.boss.pos.x, tz = e ? e.pos.z : g.boss.pos.z;
    const dx = tx - g.player.pos.x, dz = tz - g.player.pos.z;
    g.player.yaw = Math.atan2(-dx, -dz);
    g.player.pitch = -0.05;
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `artifacts/wave${wave}-${i}.png` });
}
console.log(JSON.stringify(await page.evaluate(() => window.__chancla.snapshot())));
console.log(logs.join('\n'));
await browser.close();
