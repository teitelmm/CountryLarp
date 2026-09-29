// Drives the build menu and placement with real mouse/keyboard events and checks the results.
//   node scripts/e2e-placement.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/?country=POL';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const W = 1100, H = 650;
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.world, null, { timeout: 90000 });
await page.waitForSelector('.bb-card', { timeout: 60000 });

const frames = async (n) => {
  const start = await page.evaluate(() => window.__game.frames);
  await page.waitForFunction((t) => window.__game.frames >= t, start + n, { timeout: 180000, polling: 50 });
};
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };

/** Fly the camera to (lon, lat) and return the world position. */
const lookAt = (lon, lat, dist = 26, pitchDeg = 50, yawDeg = 0) => page.evaluate(([lon, lat, dist, pitch, yaw]) => {
  const g = window.__game, m = g.world.data.meta, T = g.THREE;
  const x = (lon - m.lon0) * 111.195 * Math.cos(m.lat0 * Math.PI / 180);
  const z = -(lat - m.lat0) * 111.195;
  g.rig.setPose({ focus: new T.Vector3(x, g.world.hf.surface(x, z), z), distance: dist, pitch: pitch * Math.PI / 180, yaw: yaw * Math.PI / 180 });
  return { x, z };
}, [lon, lat, dist, pitchDeg, yawDeg]);
/** Screen pixel of a world point. */
const toScreen = (x, z) => page.evaluate(([x, z]) => {
  const g = window.__game;
  const v = new g.THREE.Vector3(x, g.world.hf.surface(x, z), z).project(g.rig.camera);
  return [Math.round((v.x * 0.5 + 0.5) * innerWidth), Math.round((-v.y * 0.5 + 0.5) * innerHeight)];
}, [x, z]);
const state = () => page.evaluate(() => {
  const g = window.__game, p = g.placement;
  return {
    active: p.active?.id ?? null, rot: p.rotation, funds: g.treasury.funds, count: g.buildings.all.length,
    ok: p.lastResult ? p.lastResult.ok && p.lastResult.affordable : null,
    reasons: p.lastResult ? p.lastResult.reasons.map((r) => r.code) : [],
    tip: (() => { const t = document.querySelector('.tip'); return t && t.style.display !== 'none' ? t.innerText : null; })(),
  };
});
const clickCard = async (id) => { await page.click(`.bb-card[data-building="${id}"]`); await page.waitForTimeout(100); };
const hoverWorld = async (x, z) => { const [sx, sy] = await toScreen(x, z); await page.mouse.move(sx, sy, { steps: 2 }); await frames(2); return [sx, sy]; };

// ---- 1. Menu ------------------------------------------------------------------------------------
const cards = await page.$$eval('.bb-card', (els) => els.map((e) => e.dataset.building));
check('medical tab lists the hospital and field hospital', cards.includes('hospital') && cards.includes('field_hospital'), cards.join(','));
const tabs = await page.$$eval('.bb-tab', (els) => els.map((e) => e.textContent));
check('five category tabs', tabs.length === 5, tabs.join(','));
const iconsLoaded = await page.$$eval('.bb-card img', (els) => els.every((i) => i.src.startsWith('data:image/png') && i.naturalWidth > 0));
check('build menu icons render', iconsLoaded);
const fundsText = await page.$eval('.tb-funds-value', (e) => e.textContent);
check('top bar shows the starting treasury', fundsText === '6,000', fundsText);
await page.screenshot({ path: 'e2e-out/placement-1-menu.png' });

// ---- 2. Valid placement -------------------------------------------------------------------------
const site = await lookAt(19.4, 52.0);
await frames(4);
await clickCard('hospital');
let st = await state();
check('clicking a card starts placement', st.active === 'hospital');
await hoverWorld(site.x, site.z);
st = await state();
check('ghost is valid on flat land inside the border', st.ok === true && st.reasons.length === 0, JSON.stringify(st.reasons));
check('tooltip offers placement hints', !!st.tip && /Click to place/.test(st.tip), st.tip?.replace(/\n/g, ' | '));
await page.screenshot({ path: 'e2e-out/placement-2-ghost-valid.png' });

const fundsBefore = st.funds;
await page.mouse.click(...(await toScreen(site.x, site.z)));
await frames(4);
await page.evaluate(() => window.__game.advance(1.2)); // let the ground finish grading (it animates in game time)
st = await state();
check('left click places the building', st.count === 1 && st.active === null, `count ${st.count}`);
check('placing spends the building cost', st.funds === fundsBefore - 250, `${fundsBefore} -> ${st.funds}`);
const graded = await page.evaluate(([x, z]) => { const hf = window.__game.world.hf; return hf.pad[Math.round(hf.gridZ(z)) * hf.cols + Math.round(hf.gridX(x))]; }, [site.x, site.z]);
check('the terrain under it was graded flat', graded === 1, `pad weight ${graded}`);
await frames(6);
await page.screenshot({ path: 'e2e-out/placement-3-placed.png' });

// ---- 3. Invalid placements ----------------------------------------------------------------------
await clickCard('hospital');
await hoverWorld(site.x + 0.4, site.z + 0.2);
st = await state();
check('overlapping the existing hospital is refused', st.ok === false && st.reasons.includes('overlap'), JSON.stringify(st.reasons));
const before = await state();
await page.mouse.click(...(await toScreen(site.x + 0.4, site.z + 0.2)));
await frames(2);
st = await state();
check('clicking an invalid spot places nothing and charges nothing', st.count === before.count && st.funds === before.funds);
check('and placement mode stays active', st.active === 'hospital');
await page.screenshot({ path: 'e2e-out/placement-4-ghost-invalid.png' });

const sea = await lookAt(17.5, 55.3, 60, 55);
await frames(3);
await hoverWorld(sea.x, sea.z);
st = await state();
check('the sea is refused as water and outside the border', st.ok === false && st.reasons.includes('water'), JSON.stringify(st.reasons));

const berlin = await lookAt(13.4, 52.5, 40, 55);
await frames(3);
await hoverWorld(berlin.x, berlin.z);
st = await state();
check('foreign territory is refused', st.reasons.includes('outside_border'), JSON.stringify(st.reasons));

const tatra = await lookAt(20.05, 49.22, 30, 50);
await frames(3);
await hoverWorld(tatra.x, tatra.z);
st = await state();
check('mountain slopes are refused as too steep (or outside the border)', st.ok === false && (st.reasons.includes('too_steep') || st.reasons.includes('outside_border')), JSON.stringify(st.reasons));

// ---- 4. Rotation, cancel, shift-repeat ----------------------------------------------------------
await lookAt(19.4, 52.0);
await frames(3);
await hoverWorld(site.x + 12, site.z + 8);
const r0 = (await state()).rot;
await page.keyboard.press('KeyR');
await frames(2);
const r1 = (await state()).rot;
check('R rotates the ghost by 90 degrees', Math.abs(r1 - r0 - Math.PI / 2) < 1e-6, `${r0.toFixed(2)} -> ${r1.toFixed(2)}`);
await page.keyboard.press('Shift+KeyR');
await frames(2);
check('Shift+R rotates back', Math.abs((await state()).rot - r0) < 1e-6);
await page.keyboard.press('Escape');
await frames(2);
st = await state();
check('Esc cancels placement', st.active === null && st.tip === null);
await clickCard('hospital');
await page.mouse.click(600, 200, { button: 'right' });
await frames(2);
check('right-click cancels placement', (await state()).active === null);

await clickCard('field_hospital');
const p1 = await toScreen(site.x + 12, site.z + 8);
await hoverWorld(site.x + 12, site.z + 8);
await page.keyboard.down('Shift');
await page.mouse.click(...p1);
await frames(3);
st = await state();
check('Shift+click places and stays in placement mode', st.count === 2 && st.active === 'field_hospital', `count ${st.count}, active ${st.active}`);
await page.keyboard.up('Shift');
await page.keyboard.press('Escape');

// ---- 5. Coastal building --------------------------------------------------------------------------
await page.click('.bb-tab[data-category="logistics"]');
await page.waitForSelector('.bb-card[data-building="port"]');
// Find a valid coastal site by scanning the northern coast with the real validator.
const found = await page.evaluate(async () => {
  const g = window.__game, m = g.world.data.meta;
  const { getDef } = await import('/src/buildings/catalog.ts');
  const port = getDef('port');
  const toX = (lon) => (lon - m.lon0) * 111.195 * Math.cos(m.lat0 * Math.PI / 180);
  const toZ = (lat) => -(lat - m.lat0) * 111.195;
  for (let lat = 54.2; lat <= 54.9; lat += 0.02) {
    for (let lon = 16.0; lon <= 19.0; lon += 0.02) {
      const x = Math.round(toX(lon) / 0.5) * 0.5, z = Math.round(toZ(lat) / 0.5) * 0.5;
      const r = g.placement.check(port, x, z);
      if (r.ok) return { x, z, rot: r.rot, padY: r.padY };
    }
  }
  return null;
});
check('a valid coastal site exists on the Polish coast', !!found, JSON.stringify(found));
if (found) {
  await lookAt(0, 0);
  await page.evaluate(([x, z]) => { const g = window.__game; g.rig.setPose({ focus: new g.THREE.Vector3(x, 0, z), distance: 34, pitch: 0.85, yaw: 0 }); }, [found.x, found.z]);
  await frames(4);
  await clickCard('port');
  await hoverWorld(found.x, found.z);
  st = await state();
  check('the port ghost is valid and auto-aligned to the coast', st.ok === true, JSON.stringify(st.reasons) + ` rot ${st.rot.toFixed(2)}`);
  const rotBefore = st.rot;
  await page.keyboard.press('KeyR');
  await frames(2);
  check('coastal buildings ignore manual rotation', Math.abs((await state()).rot - rotBefore) < 1e-6);
  await page.screenshot({ path: 'e2e-out/placement-5-port-ghost.png' });
  await page.mouse.click(...(await toScreen(found.x, found.z)));
  await frames(6);
  st = await state();
  check('the port is placed', st.count === 3, `count ${st.count}`);
  await frames(4);
  await page.screenshot({ path: 'e2e-out/placement-6-port-placed.png' });
}

// ---- 6. Funds -------------------------------------------------------------------------------------
await page.evaluate(() => window.__game.treasury.spend(window.__game.treasury.funds - 100));
await page.click('.bb-tab[data-category="medical"]');
await lookAt(19.4, 52.0); // the camera was left at the port
await frames(3);
await clickCard('hospital');
await hoverWorld(site.x - 14, site.z - 9);
st = await state();
check('an unaffordable building is flagged', st.ok === false && /Not enough funds/.test(st.tip ?? ''), st.tip?.replace(/\n/g, ' | '));
const poor = await page.$eval('.bb-card[data-building="hospital"]', (e) => e.classList.contains('poor'));
check('and its card is dimmed', poor);
await page.keyboard.press('Escape');

await page.screenshot({ path: 'e2e-out/placement-7-final.png' });
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
process.exit(results.every(Boolean) && errors.length === 0 ? 0 : 1);
