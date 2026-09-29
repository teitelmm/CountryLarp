// Places a building with the real UI and captures it through each construction stage.
//   node scripts/e2e-construction.mjs [buildingId] [url]
// Software GL renders only a few fps, so game time is fast-forwarded with __game.advance() between shots.
import { chromium } from 'playwright-core';

const buildingId = process.argv[2] || 'hospital';
const url = process.argv[3] || 'http://localhost:5173/?country=POL';
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
const info = () => page.evaluate(() => {
  const g = window.__game, b = g.buildings.all[0];
  return b ? {
    state: b.state, progress: +b.progress.toFixed(3), sites: g.buildings.activeSites, bodies: g.game.physics.dynamicCount,
    dust: g.game.dust.liveCount, phase: b.site?.phase ?? 'none', paused: g.clock.paused, speed: g.clock.speed, time: +g.clock.time.toFixed(2),
    welded: b.site ? b.site.pieces.filter((p) => p.phase === 'welded').length : null,
    flying: b.site ? b.site.pieces.filter((p) => p.phase === 'flying').length : null,
    total: b.def.pieces.length,
  } : null;
});
const shot = async (name, settleFrames = 3) => { await frames(settleFrames); await page.screenshot({ path: `e2e-out/construct-${buildingId}-${name}.png` }); };

// Find a valid site for this building with the real validator (coastal ones are searched along the coast).
const site = await page.evaluate(async (id) => {
  const g = window.__game, m = g.world.data.meta, T = g.THREE;
  const def = (await import('/src/buildings/catalog.ts')).getDef(id);
  const toX = (lon) => (lon - m.lon0) * 111.195 * Math.cos(m.lat0 * Math.PI / 180);
  const toZ = (lat) => -(lat - m.lat0) * 111.195;
  let found = null;
  if (def.placement.needsCoast) {
    for (let lat = 54.2; lat <= 54.9 && !found; lat += 0.02) for (let lon = 16.0; lon <= 19.0 && !found; lon += 0.02) {
      const x = Math.round(toX(lon) / 0.5) * 0.5, z = Math.round(toZ(lat) / 0.5) * 0.5;
      const r = g.placement.check(def, x, z);
      if (r.ok) found = { x, z, rot: r.rot };
    }
  } else {
    const cx = toX(19.4), cz = toZ(52.0);
    for (let r = 0; r <= 60 && !found; r += 3) for (let a = 0; a < 12 && !found; a++) {
      const x = Math.round((cx + Math.cos(a / 12 * 6.283) * r) / 0.5) * 0.5, z = Math.round((cz + Math.sin(a / 12 * 6.283) * r) / 0.5) * 0.5;
      if (g.placement.check(def, x, z, 0).ok) found = { x, z, rot: 0 };
    }
  }
  if (!found) return null;
  g.rig.setPose({ focus: new T.Vector3(found.x, g.world.hf.surface(found.x, found.z), found.z), distance: Math.max(20, Math.max(def.footprint.w, def.footprint.d) * 4.2), pitch: 0.68, yaw: 0.5 });
  return found;
}, buildingId);
check(`a valid site exists for ${buildingId}`, !!site, JSON.stringify(site));
if (!site) { await browser.close(); process.exit(1); }
await frames(3);
// Switch to the building's category tab if needed, then click its card.
const tab = await page.evaluate(async (id) => (await import('/src/buildings/catalog.ts')).getDef(id).category, buildingId);
await page.click(`.bb-tab[data-category="${tab}"]`);
await page.click(`.bb-card[data-building="${buildingId}"]`);
const [sx, sy] = await page.evaluate(([x, z]) => {
  const g = window.__game; const v = new g.THREE.Vector3(x, g.world.hf.surface(x, z), z).project(g.rig.camera);
  return [Math.round((v.x * 0.5 + 0.5) * innerWidth), Math.round((-v.y * 0.5 + 0.5) * innerHeight)];
}, [site.x, site.z]);
await page.mouse.move(sx, sy, { steps: 2 });
await frames(2);
await page.mouse.click(sx, sy);
await frames(2);
let s = await info();
check('placing starts construction (sizing phase)', s && s.state === 'sizing' && s.sites === 1, JSON.stringify(s));
check('progress starts at zero', s.progress === 0);
await shot('1-sizing');

await page.evaluate(() => window.__game.advance(0.4));
await shot('2-sizing-mid', 4);
await page.evaluate(() => window.__game.advance(0.9));
s = await info();
check('after sizing the building is under construction', s.state === 'constructing' && s.phase === 'building', JSON.stringify(s));

const def = await page.evaluate(async (id) => { const d = (await import('/src/buildings/catalog.ts')).getDef(id); return { T: d.buildTime, n: d.pieces.length }; }, buildingId);
await page.evaluate((t) => window.__game.advance(t), def.T * 0.15);
s = await info();
await shot('3-early', 4);
check('pieces are being delivered', s.welded + s.flying > 0 && s.welded < s.total, JSON.stringify(s));
check('rigid bodies are simulated while pieces are in flight', s.bodies > 0 || s.flying === 0, `bodies ${s.bodies}, flying ${s.flying}`);
const p1 = s.progress;

await page.evaluate((t) => window.__game.advance(t), def.T * 0.3);
s = await info();
await shot('4-mid', 4);
check('progress advances', s.progress > p1, `${p1} -> ${s.progress}`);
const p2 = s.progress;

await page.evaluate((t) => window.__game.advance(t), def.T * 0.35);
s = await info();
await shot('5-late', 4);
check('progress keeps advancing', s.progress >= p2, `${p2} -> ${s.progress}`);

// Pause: game time must stop while frames keep rendering.
await page.keyboard.press('Space');
await frames(2);
const before = await info();
await frames(6);
const during = await info();
check('Space pauses the simulation', during.paused && during.time === before.time && during.progress === before.progress, JSON.stringify({ t0: before.time, t1: during.time }));
await page.click('.clock-btn[data-speed="3"]');
await frames(4);
const fast = await info();
check('the speed buttons resume at x3', !fast.paused && fast.speed === 3 && fast.time > during.time, `speed ${fast.speed}, time ${during.time} -> ${fast.time}`);
await page.click('.clock-btn[data-speed="1"]');

// Run to the topping-out.
for (let i = 0; i < 40; i++) {
  s = await info();
  if (s.state === 'finishing' || s.state === 'complete') break;
  await page.evaluate(() => window.__game.advance(1));
}
s = await info();
check('the building reaches topping-out', s.state === 'finishing' || s.state === 'complete', JSON.stringify(s));
if (s.state === 'finishing') {
  await shot('6-finishing', 3);
  await page.evaluate(() => window.__game.advance(0.5));
  await shot('6b-scaffold-falling', 3);
}
await page.evaluate(() => window.__game.advance(6));
s = await info();
await shot('7-complete', 6);
check('the building completes', s.state === 'complete' && s.progress === 1 && s.sites === 0, JSON.stringify(s));
check('all rigid bodies are released', s.bodies === 0);
const leftovers = await page.evaluate(() => {
  const g = window.__game; const names = [];
  g.world.scene.traverse((o) => { if (o.isInstancedMesh) names.push('instanced'); });
  const b = g.buildings.all[0];
  return { instanced: names.length, rootChildren: b.root.children.length };
});
check('the scaffold and crane are gone, leaving one merged model', leftovers.instanced === 0 && leftovers.rootChildren === 1, JSON.stringify(leftovers));

console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
process.exit(results.every(Boolean) && errors.length === 0 ? 0 : 1);
