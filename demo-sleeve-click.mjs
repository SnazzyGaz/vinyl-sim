// Short click-to-pop sleeve demo → mp4 frames. Usage:
//   node demo-sleeve-click.mjs <url> <outDir>
import { chromium } from 'playwright-core';
import fs from 'fs'; import path from 'path';
const [, , url, out = 'demo-sleeve-click-frames'] = process.argv;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.vinylView && document.querySelector('canvas')?.dataset?.ready !== undefined, null, { timeout: 600000 });
// Wait for sleeves
await page.waitForFunction(() => (window.vinylView.sleevePoints?.() || []).length > 0, null, { timeout: 120000 });
console.log('ready', await page.evaluate(() => ({ sleeves: window.vinylView.sleevePoints().length, rec: window.vinyl?.record?.label })));

const sleep = ms => new Promise(r => setTimeout(r, ms));
let f = 0;
const shot = async () => {
  const file = path.join(out, `f${String(f++).padStart(5, '0')}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
};
const pts = () => page.evaluate(() => window.vinylView.sleevePoints().filter(s => !s.empty));

// Hold on open for a beat
for (let i = 0; i < 15; i++) { await shot(); await sleep(33); }

// Hover the front sleeve (bob)
let sleeves = await pts();
if (!sleeves.length) throw new Error('no sleeves');
const s0 = sleeves[0];
await page.mouse.move(s0.x, s0.y);
for (let i = 0; i < 20; i++) { await shot(); await sleep(33); }

// Click to half-out
await page.mouse.click(s0.x, s0.y);
for (let i = 0; i < 25; i++) { await shot(); await sleep(33); }
console.log('pop', await page.evaluate(() => window.vinylView.sleevePop));

// Esc cancel
await page.keyboard.press('Escape');
for (let i = 0; i < 20; i++) { await shot(); await sleep(33); }
console.log('after esc', await page.evaluate(() => window.vinylView.sleevePop));

// Click again, then drag to platter center-ish
sleeves = await pts();
const s1 = sleeves[0];
await page.mouse.click(s1.x, s1.y);
for (let i = 0; i < 18; i++) { await shot(); await sleep(33); }
const platter = await page.evaluate(() => {
  const R = window.vinylView.R;
  return window.vinylView.toClient(0, 0, 2.5);
});
await page.mouse.move(s1.x, s1.y);
await page.mouse.down();
const steps = 18;
for (let k = 1; k <= steps; k++) {
  const x = s1.x + (platter.x - s1.x) * k / steps;
  const y = s1.y + (platter.y - s1.y) * k / steps;
  await page.mouse.move(x, y);
  await shot(); await sleep(33);
}
await page.mouse.up();
for (let i = 0; i < 90; i++) { await shot(); await sleep(33); } // watch extract
console.log('done frames', f);
await browser.close();
