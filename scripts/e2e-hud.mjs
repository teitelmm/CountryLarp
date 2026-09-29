// HUD: the theatre map (chart, compass, coordinates, scale bar) and the restyled panels, with real input.
//   node scripts/e2e-hud.mjs [url]      screenshots go to e2e-out/hud-*.png
import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://localhost:5173/?country=POL&fresh=1';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
const frames = async (n) => {
  const start = await page.evaluate(() => window.__game.frames);
  await page.waitForFunction((t) => window.__game.frames >= t, start + n, { timeout: 180000, polling: 50 });
};
const text = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);

await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.world, null, { timeout: 90000 });
await page.waitForSelector('.mapcard canvas', { timeout: 60000 });
await frames(4);

const info = await page.evaluate(() => {
  const g = window.__game;
  return { scale: g.world.data.scale, extent: g.world.extent, sizeX: g.world.data.sizeX };
});
check('the map is shrunk by the configured scale', info.scale > 1 && info.extent < 400, `scale ${info.scale}, extent ${info.extent.toFixed(0)} units`);

// Something to show on the map.
const site = await page.evaluate(async () => {
  const g = window.__game, m = g.world.data.meta, T = g.THREE;
  const k = 111.195 / g.world.data.scale;
  const cx = (19.4 - m.lon0) * k * Math.cos((m.lat0 * Math.PI) / 180), cz = -(52.0 - m.lat0) * k;
  const { getDef } = await import('/src/buildings/catalog.ts');
  const put = [['hospital', 0, 0], ['war_factory', 6.5, 0.5], ['barracks', -6, 1], ['supply_depot', 0.5, 6]];
  let placed = 0;
  for (const [id, dx, dz] of put) {
    const r = g.placement.placeAt(getDef(id), cx + dx, cz + dz, 0);
    if (r.ok) placed++;
  }
  g.rig.setPose({ focus: new T.Vector3(cx, g.world.hf.surface(cx, cz), cz), distance: 26, pitch: 0.8, yaw: 0.5 });
  return { cx, cz, placed };
});
await frames(4);
await page.evaluate(() => window.__game.advance(80)); // finish construction
await frames(4);

check('the theatre map card is mounted', (await page.locator('.mapcard').count()) === 1);
check('the buildings were placed for the shot', site.placed >= 3, `${site.placed}/4`);
const coords = await text('.mc-coords');
check('coordinates read as degrees and arc-minutes', /^\d{2}°\d{2}′[NS] \d{3}°\d{2}′[EW]$/.test(coords ?? ''), coords);
const lonMin = /(\d{3})°(\d{2})′E/.exec(coords ?? '');
check('the camera sits near 19°E, 52°N as flown', !!lonMin && Number(lonMin[1]) === 19 && /^5[12]°/.test(coords), coords);
check('scale bar states real kilometres', /^\d+(\.\d)? km$/.test((await text('.mc-scale b')) ?? ''), await text('.mc-scale b'));
check('an altitude readout is shown', /^\d[\d,]* m$/.test((await text('.mc-alt')) ?? ''), await text('.mc-alt'));

// The compass shows where north points on screen. Tilted at pitch 0.8, a ground direction yawed by 0.5 rad
// appears turned by atan(tan(yaw) / sin(pitch)).
const rose = () => page.evaluate(() => document.querySelector('.cp-rose').getAttribute('transform'));
const angleOf = (t) => Number(/rotate\((-?[\d.]+)\)/.exec(t ?? '')?.[1]);
const turned = angleOf(await rose());
const expected = (Math.atan(Math.tan(0.5) / Math.sin(0.8)) * 180) / Math.PI;
check('the compass rose is turned with the view', Math.abs(Math.abs(turned) - expected) < 1.5, `${turned}° (expected ±${expected.toFixed(1)}°)`);
await page.screenshot({ path: 'e2e-out/hud-near.png' });

await page.locator('.mc-compass').click();
await frames(3);
check('clicking the compass faces north', Math.abs(angleOf(await rose())) < 0.5, `${angleOf(await rose())}°`);

// Click the chart: the camera flies to that place.
const before = await page.evaluate(() => ({ x: window.__game.rig.focus.x, z: window.__game.rig.focus.z }));
const box = await page.locator('.mapcard canvas').boundingBox();
await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.3);
await page.waitForTimeout(2500);
await frames(3);
const after = await page.evaluate(() => ({ x: window.__game.rig.focus.x, z: window.__game.rig.focus.z }));
check('clicking the chart moves the camera', Math.hypot(after.x - before.x, after.z - before.z) > 5, `moved ${Math.hypot(after.x - before.x, after.z - before.z).toFixed(1)} units`);

// Whole-country view with the build bar and map.
await page.evaluate(() => { const g = window.__game; g.rig.setPose({ focus: new g.THREE.Vector3(0, 0, 0), distance: g.world.extent * 0.85, pitch: 0.96, yaw: 0 }); });
await frames(4);
await page.screenshot({ path: 'e2e-out/hud-country.png' });

// Inspect panel.
await page.evaluate(async () => {
  const g = window.__game;
  const b = g.buildings.all[0];
  g.game.selection.select(b);
});
await frames(3);
await page.screenshot({ path: 'e2e-out/hud-inspect.png' });

console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
process.exit(results.every(Boolean) && errors.length === 0 ? 0 : 1);
