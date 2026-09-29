// Smoke test against the production build (npm run build && npm run preview): load a country, place a
// building through the real UI, let it finish, and check for console errors. Uses only the __game hook
// (no dev-server module imports) so it works on the bundled output.
//   node scripts/smoke-prod.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:4173/?country=POL&fresh=1';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.world, null, { timeout: 120000 });
await page.waitForSelector('.bb-card', { timeout: 60000 });
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };

await page.click('.bb-card[data-building="hospital"]');
const site = await page.evaluate(() => {
  const g = window.__game, def = g.placement.active;
  const m = g.world.data.meta;
  const cx = (19.4 - m.lon0) * 111.195 * Math.cos(m.lat0 * Math.PI / 180), cz = -(52.0 - m.lat0) * 111.195;
  for (let r = 0; r < 60; r += 3) for (let a = 0; a < 12; a++) {
    const x = Math.round((cx + Math.cos(a / 12 * 6.283) * r) / 0.5) * 0.5, z = Math.round((cz + Math.sin(a / 12 * 6.283) * r) / 0.5) * 0.5;
    if (g.placement.check(def, x, z, 0).ok) {
      g.rig.setPose({ focus: new g.THREE.Vector3(x, g.world.hf.surface(x, z), z), distance: 22, pitch: 0.7, yaw: 0.4 });
      return { x, z };
    }
  }
  return null;
});
check('found a valid site in the production build', !!site);
const px = await page.evaluate(([x, z]) => {
  const g = window.__game, v = new g.THREE.Vector3(x, g.world.hf.surface(x, z), z).project(g.rig.camera);
  return [Math.round((v.x * 0.5 + 0.5) * innerWidth), Math.round((-v.y * 0.5 + 0.5) * innerHeight)];
}, [site.x, site.z]);
await page.mouse.move(...px, { steps: 2 });
await page.waitForTimeout(600);
await page.mouse.click(...px);
await page.waitForTimeout(600);
const n = await page.evaluate(() => window.__game.buildings.all.length);
check('placed a building', n === 1);
await page.evaluate(() => window.__game.advance(45));
await page.waitForTimeout(800);
const state = await page.evaluate(() => window.__game.buildings.all[0]?.state);
check('construction completed', state === 'complete', state);
const rapierOk = await page.evaluate(() => window.__game.game.physics.dynamicCount === 0);
check('physics engine ran and released its bodies', rapierOk);
await page.screenshot({ path: 'e2e-out/smoke-prod.png' });
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
process.exit(results.every(Boolean) && errors.length === 0 ? 0 : 1);
