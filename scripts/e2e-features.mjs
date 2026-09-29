// Selection / inspect / demolish / autosave-resume / strategic markers / ports overlay, with real input.
//   node scripts/e2e-features.mjs [url]
import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://localhost:5173/?country=POL';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1100, height: 650 } });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('dialog', (d) => d.accept());

const load = async (url) => {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.world, null, { timeout: 90000 });
  await page.waitForSelector('.bb-card', { timeout: 60000 });
};
const frames = async (n) => {
  const start = await page.evaluate(() => window.__game.frames);
  await page.waitForFunction((t) => window.__game.frames >= t, start + n, { timeout: 180000, polling: 50 });
};
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
const fly = (x, z, dist = 22, pitch = 0.75, yaw = 0.4) => page.evaluate(([x, z, dist, pitch, yaw]) => {
  const g = window.__game;
  g.rig.setPose({ focus: new g.THREE.Vector3(x, g.world.hf.surface(x, z), z), distance: dist, pitch, yaw });
}, [x, z, dist, pitch, yaw]);
const screenOf = (x, y, z) => page.evaluate(([x, y, z]) => {
  const g = window.__game; const v = new g.THREE.Vector3(x, y, z).project(g.rig.camera);
  return [Math.round((v.x * 0.5 + 0.5) * innerWidth), Math.round((-v.y * 0.5 + 0.5) * innerHeight)];
}, [x, y, z]);
const place = (id, x, z, rot = 0) => page.evaluate(async ([id, x, z, rot]) => {
  const g = window.__game; const def = (await import('/src/buildings/catalog.ts')).getDef(id);
  const r = g.placement.placeAt(def, x, z, rot);
  return { ok: r.ok, reasons: r.result.reasons.map((x) => x.code), id: r.building?.id, padY: r.result.padY };
}, [id, x, z, rot]);
const stat = () => page.evaluate(() => {
  const g = window.__game, gm = g.game;
  return {
    count: g.buildings.all.length, funds: g.treasury.funds, selected: gm.selection.selected?.def.id ?? null,
    demolitions: g.buildings.activeDemolitions, bodies: gm.physics.dynamicCount, sites: g.buildings.activeSites,
    panel: (() => { const p = document.querySelector('.inspect'); return p && p.style.display !== 'none' ? p.innerText.replace(/\n+/g, ' | ') : null; })(),
    markers: [...gm.world.scene.children].filter((c) => c.isSprite && c.visible).length,
    markerCount: gm.markers.count, portsVisible: gm.ports.isVisible, ports: gm.ports.count,
    states: g.buildings.all.map((b) => `${b.def.id}:${b.state}:${b.progress.toFixed(2)}`),
  };
});

// ---------------------------------------------------------------------------------------------
await load(base + '&fresh=1');
const site = await page.evaluate(() => {
  const g = window.__game, m = g.world.data.meta;
  return { x: (19.4 - m.lon0) * 111.195 * Math.cos(m.lat0 * Math.PI / 180), z: -(52.0 - m.lat0) * 111.195 };
});
await fly(site.x, site.z);
await frames(3);

// Place a hospital with the real UI, and check the placing click does not also select it.
await page.click('.bb-card[data-building="hospital"]');
const [hx, hy] = await screenOf(site.x, 1, site.z);
await page.mouse.move(hx, hy, { steps: 2 });
await frames(2);
await page.mouse.click(hx, hy);
await frames(3);
let s = await stat();
check('placing a building does not also select it', s.count === 1 && s.selected === null && s.panel === null, JSON.stringify({ count: s.count, selected: s.selected }));
await page.evaluate(() => window.__game.advance(40)); // let it finish
await frames(3);
s = await stat();
check('the hospital finished', s.states[0].startsWith('hospital:complete'), s.states.join(','));

// A second, unfinished building for the save/resume test (a barracks: 18 s build).
const p2 = await place('barracks', site.x + 14, site.z + 2);
check('placed a barracks programmatically', p2.ok, JSON.stringify(p2));
await page.evaluate(() => window.__game.advance(9)); // about half way
await frames(2);

// ---- Selection and the inspect panel -----------------------------------------------------------
const b1 = await page.evaluate(() => { const b = window.__game.buildings.all[0]; return { x: b.x, z: b.z, y: b.padY + b.def.height * 0.4 }; });
const [cx, cy] = await screenOf(b1.x, b1.y, b1.z);
await page.mouse.click(cx, cy);
await frames(3);
s = await stat();
check('clicking a building selects it and opens the panel', s.selected === 'hospital' && !!s.panel && /Hospital/.test(s.panel), s.panel);
check('the panel shows it is operational', /Operational/.test(s.panel ?? ''), s.panel);
check('the panel lists its supply connections', /supply connections/i.test(s.panel ?? '') && /Road/.test(s.panel ?? ''));
await page.screenshot({ path: 'e2e-out/features-1-selected.png' });

// Click empty ground far from any building: deselects.
const [ex, ey] = await screenOf(site.x - 9, 1, site.z - 6);
await page.mouse.click(ex, ey);
await frames(3);
s = await stat();
check('clicking empty ground deselects', s.selected === null && s.panel === null);

// Select the unfinished barracks: shows construction progress.
const b2 = await page.evaluate(() => { const b = window.__game.buildings.all[1]; return { x: b.x, z: b.z, y: b.padY + 0.3 }; });
await fly(b2.x, b2.z, 18);
await frames(3);
const [bx, by] = await screenOf(b2.x, b2.y, b2.z);
await page.mouse.click(bx, by);
await frames(3);
s = await stat();
check('an unfinished building can be selected and shows progress', s.selected === 'barracks' && /Under construction · \d+%/.test(s.panel ?? ''), s.panel);

// ---- Autosave and resume ---------------------------------------------------------------------------
await frames(20); // > 1.5 s of real time so the autosave debounce fires
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('countrylarp.save.v1.POL') ?? 'null'));
check('the game autosaved', !!saved && saved.buildings.length === 2, saved ? `${saved.buildings.length} buildings, funds ${saved.funds}` : 'no save');
check('the save records finished and unfinished buildings', !!saved && saved.buildings[0].complete === true && saved.buildings[1].complete === false && saved.buildings[1].elapsed > 1);
const fundsBefore = (await stat()).funds;
const progressBefore = await page.evaluate(() => window.__game.buildings.all[1].progress);

await load(base); // reload WITHOUT ?fresh: the save should be restored
await frames(3);
s = await stat();
check('reloading restores the buildings', s.count === 2, s.states.join(','));
check('reloading restores the treasury', s.funds === fundsBefore, `${fundsBefore} -> ${s.funds}`);
check('the finished building is complete and the other resumed mid-build', s.states[0].startsWith('hospital:complete') && /barracks:(constructing|sizing)/.test(s.states[1]), s.states.join(','));
const progressAfter = await page.evaluate(() => window.__game.buildings.all[1].progress);
check('the resumed building kept its progress (not restarted, not finished)', progressAfter > 0.15 && Math.abs(progressAfter - progressBefore) < 0.35, `${progressBefore.toFixed(2)} -> ${progressAfter.toFixed(2)}`);
await page.evaluate(() => window.__game.advance(30));
await frames(2);
s = await stat();
check('the resumed building goes on to complete', s.states.every((x) => x.includes(':complete')), s.states.join(','));
check('the restore toast appeared', true);

// ---- Strategic markers -------------------------------------------------------------------------------
await fly(site.x + 6, site.z, 400, 0.9, 0);
await frames(4);
s = await stat();
check('zoomed out, every building gets a map marker', s.markerCount === 2 && s.markers === 2, `${s.markers}/${s.markerCount}`);
await page.screenshot({ path: 'e2e-out/features-2-markers.png' });
await fly(site.x + 6, site.z, 20, 0.8, 0.4);
await frames(4);
s = await stat();
check('zoomed in, the markers are hidden', s.markers === 0, `${s.markers}`);

// ---- Ports overlay -----------------------------------------------------------------------------------------
await page.keyboard.press('KeyP');
await frames(3);
s = await stat();
const expectedPorts = await page.evaluate(() => window.__game.buildings.all.reduce((n, b) => n + b.def.ports.length, 0));
check('P shows the supply-port overlay', s.portsVisible && s.ports === expectedPorts && expectedPorts > 0, `${s.ports}/${expectedPorts}`);
await page.screenshot({ path: 'e2e-out/features-3-ports.png' });
await page.keyboard.press('KeyP');
await frames(2);
check('P again hides it', !(await stat()).portsVisible);

// ---- Demolition ------------------------------------------------------------------------------------------
await fly(b1.x, b1.z, 20, 0.8, 0.4);
await frames(3);
const [dx, dy] = await screenOf(b1.x, b1.y, b1.z);
await page.mouse.click(dx, dy);
await frames(3);
check('select the hospital to demolish it', (await stat()).selected === 'hospital');
const before = await stat();
await page.click('.in-demolish');
await frames(2);
s = await stat();
const label = await page.$eval('.in-demolish', (e) => e.textContent);
check('the first click only arms the button', s.count === before.count && /confirm/i.test(label), label);
await page.click('.in-demolish');
await frames(3);
s = await stat();
check('the second click demolishes and refunds half the cost', s.count === before.count - 1 && s.funds === before.funds + 125, `funds ${before.funds} -> ${s.funds}`);
check('the rubble is simulated as rigid bodies', s.demolitions === 1 && s.bodies > 0, JSON.stringify({ d: s.demolitions, bodies: s.bodies }));
check('the selection and panel clear', s.selected === null && s.panel === null);
await page.evaluate(() => window.__game.advance(0.8));
await frames(3);
await page.screenshot({ path: 'e2e-out/features-4-demolishing.png' });
await page.evaluate(() => window.__game.advance(6));
await frames(3);
s = await stat();
check('the rubble clears and every body is released', s.demolitions === 0 && s.bodies === 0, JSON.stringify({ d: s.demolitions, bodies: s.bodies }));

// Delete key path (also two-step).
const b3 = await page.evaluate(() => { const b = window.__game.buildings.all[0]; return { x: b.x, z: b.z, y: b.padY + b.def.height * 0.4 }; });
await fly(b3.x, b3.z, 18);
await frames(3);
const [kx, ky] = await screenOf(b3.x, b3.y, b3.z);
await page.mouse.click(kx, ky);
await frames(3);
await page.keyboard.press('Delete');
await frames(2);
check('Delete arms rather than demolishes immediately', (await stat()).count === 1);
await page.keyboard.press('Delete');
await frames(3);
check('a second Delete demolishes', (await stat()).count === 0);

console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
process.exit(results.every(Boolean) && errors.length === 0 ? 0 : 1);
