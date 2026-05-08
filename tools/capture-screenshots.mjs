// Capture PWA screenshots for manifest.
// Prereq: app served at NOTEPAD_URL (default http://localhost:8000/index.html).
// Usage:
//   python3 -m http.server 8000 &
//   npx --yes playwright install chromium
//   node tools/capture-screenshots.mjs
//   kill %1
import { chromium } from 'playwright';
import { setTimeout as wait } from 'timers/promises';

const URL = process.env.NOTEPAD_URL || 'http://localhost:8000/index.html';

const shots = [
  { name: 'desktop-wide.png',   viewport: { width: 1280, height: 720  } },
  { name: 'mobile-narrow.png',  viewport: { width: 640,  height: 1280 } }
];

const browser = await chromium.launch();
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: s.viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await wait(800);
  await page.screenshot({ path: `screenshots/${s.name}`, fullPage: false });
  console.log('saved', s.name);
  await ctx.close();
}
await browser.close();
console.log('Done. Commit screenshots/*.png');
