// Regenerates the PNG icons and the Open Graph preview from the game itself.
// Requires a running preview server: npm run build && npm run preview
import { launch } from './browser.mjs';
import fs from 'node:fs';

const URL_ = process.env.ASSET_URL || 'http://localhost:4173/';
const svg = fs.readFileSync('public/favicon.svg', 'utf8');
const browser = await launch();

for (const [size, name] of [[32, 'favicon-32.png'], [180, 'apple-touch-icon.png'], [192, 'icon-192.png'], [512, 'icon-512.png']]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `public/${name}`, omitBackground: true });
  await page.close();
}

// Social preview: the real title screen, framed for 1200x630.
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.addInitScript(() => { try { localStorage.setItem('chancla.settings.v1', JSON.stringify({ lang: 'en', quality: 'high' })); } catch {} });
await page.goto(URL_);
await page.waitForFunction(() => !!window.__chancla, null, { timeout: 30000 });
await page.addStyleTag({ content: '.title-row,.best,.note,.pitch{display:none!important} .btn-play{pointer-events:none}' });
await page.evaluate(() => { document.activeElement?.blur(); });
await page.waitForTimeout(1800);
await page.screenshot({ path: 'public/og-image.jpg', type: 'jpeg', quality: 86 });
await browser.close();
console.log('assets written');
