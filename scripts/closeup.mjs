import { launch } from './browser.mjs';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
page.on('pageerror', (e) => console.log(`pageerror: ${e.message}`));
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => !!window.__chancla, null, { timeout: 30000 });
await page.click('#btn-play');
await page.waitForTimeout(300);
await page.evaluate(() => {
  const g = window.__chancla.app.game;
  g.skipTutorial();
  g.director.reset();
  g.director.phase = 'idle';
  g.phase = 'tutorial'; // keep the sim running without the director
  g.tutorial.active = false;
  const kinds = ['bocinas', 'influencer', 'soplador'];
  kinds.forEach((k, i) => {
    const e = g.enemies.acquire(k);
    e.spawn({ x: -2.2 + i * 2.2, z: 9.5, entryX: -2.2 + i * 2.2, entryZ: 9.5 }, g.rng);
    e.state = 'move';
    e.attackCd = 99;
    e.poseCd = 99;
  });
  g.player.pos.set(0, 0, 14);
  g.player.yaw = 0;
  g.player.pitch = -0.05;
});
await page.waitForTimeout(900);
await page.screenshot({ path: 'artifacts/enemies.png' });
await page.evaluate(() => {
  const g = window.__chancla.app.game;
  for (const e of g.enemies.pool) if (e.alive) { e.state = e.kind === 'influencer' ? 'pose' : 'telegraph'; e.stateT = 0; }
});
await page.waitForTimeout(500);
await page.screenshot({ path: 'artifacts/enemies-attack.png' });
await page.evaluate(() => {
  const g = window.__chancla.app.game;
  g.debugKillAll();
});
await page.waitForTimeout(700);
await page.screenshot({ path: 'artifacts/enemies-dying.png' });
await page.evaluate(() => {
  const g = window.__chancla.app.game;
  g.debugJumpToWave(3);
  g.player.pos.set(0, 0, -8);
  g.player.yaw = 0;
  g.player.pitch = 0.12;
});
await page.waitForTimeout(3500);
await page.screenshot({ path: 'artifacts/boss.png' });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'artifacts/boss2.png' });
await browser.close();
