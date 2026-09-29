// Screenshot helper: node scripts/e2e-shot.mjs <url> <out.png> [waitMs] [evalJs]
// Uses the pre-installed Chromium with SwiftShader WebGL. Prints console errors.
import { chromium } from 'playwright-core';

const [url, out = 'e2e-out/shot.png', waitMs = '1500', evalJs] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(Number(waitMs));
if (evalJs) console.log('eval →', JSON.stringify(await page.evaluate(evalJs)));
await page.screenshot({ path: out });
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
