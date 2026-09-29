// Drives the camera with real mouse/keyboard events in headless Chromium and checks the results.
//   node scripts/e2e-camera.mjs [url]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:5173/?country=POL';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const W = 1100, H = 650; // large enough that the build bar (bottom ~200px) leaves the drag path over the canvas
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.world, null, { timeout: 60000 });
await page.waitForTimeout(1500);

const state = () => page.evaluate(() => {
  const r = window.__game.rig;
  return { fx: r.focus.x, fy: r.focus.y, fz: r.focus.z, yaw: r.yaw, pitch: r.pitch, dist: r.distance };
});
/** World point under a screen pixel, from the live camera. */
const groundAt = (px, py) => page.evaluate(([x, y]) => {
  const g = window.__game;
  const ndc = new g.THREE.Vector2((x / innerWidth) * 2 - 1, -((y / innerHeight) * 2 - 1));
  const p = g.rig.raycastTerrain(ndc);
  return p ? { x: p.x, y: p.y, z: p.z } : null;
}, [px, py]);
// Software GL renders at only a few fps, so wait on rendered frames (the camera clamps dt to 0.1 s
// per frame, so N frames = at most N/10 s of camera time) rather than wall-clock time.
const frames = async (n) => {
  const start = await page.evaluate(() => window.__game.frames);
  await page.waitForFunction((t) => window.__game.frames >= t, start + n, { timeout: 120000, polling: 50 });
};
const settle = (n = 12) => frames(n);
const holdKey = async (code, n) => { await page.keyboard.down(code); await frames(n); await page.keyboard.up(code); await settle(); };
const at = (fx, fy) => [Math.round(fx * W), Math.round(fy * H)];
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** Where the view ray through a pixel meets the horizontal plane at height y (grab-pan holds this plane). */
const planeAt = (px, py, y) => page.evaluate(([x, py2, y0]) => {
  const g = window.__game;
  const ndc = new g.THREE.Vector2((x / innerWidth) * 2 - 1, -((py2 / innerHeight) * 2 - 1));
  const rc = new g.THREE.Raycaster();
  rc.setFromCamera(ndc, g.rig.camera);
  const { origin: o, direction: d } = rc.ray;
  const s = (y0 - o.y) / d.y;
  return { x: o.x + d.x * s, y: y0, z: o.z + d.z * s };
}, [px, py, y]);

// 1. Wheel zoom towards the cursor keeps the ground point under the cursor.
const [cx, cy] = at(0.7, 0.36);
await page.mouse.move(cx, cy);
const s0 = await state();
const g0 = await groundAt(cx, cy);
await page.mouse.wheel(0, -700);
await settle(20);
const s1 = await state();
const g1 = await groundAt(cx, cy);
check('wheel zoom-in reduces distance', s1.dist < s0.dist * 0.6, `${s0.dist.toFixed(0)} -> ${s1.dist.toFixed(0)}`);
check('point under cursor stays put while zooming', dist3(g0, g1) < 3, `moved ${dist3(g0, g1).toFixed(2)} units`);
await page.mouse.wheel(0, 700);
await settle(20);
const s2 = await state();
check('wheel zoom-out restores distance', Math.abs(s2.dist - s0.dist) / s0.dist < 0.05, `${s2.dist.toFixed(0)} vs ${s0.dist.toFixed(0)}`);

// 2. Keyboard pan (yaw 0): W moves the focus north (-z), D east (+x).
await page.mouse.move(...at(0.5, 0.5));
const p0 = await state();
await holdKey('KeyW', 4);
const p1 = await state();
check('W pans north', p1.fz < p0.fz - 20 && Math.abs(p1.fx - p0.fx) < 2, `dz ${(p1.fz - p0.fz).toFixed(1)}`);
await holdKey('KeyD', 4);
const p2 = await state();
check('D pans east', p2.fx > p1.fx + 20, `dx ${(p2.fx - p1.fx).toFixed(1)}`);

// 3. Q/E rotate.
await holdKey('KeyQ', 6);
const y1 = await state();
check('Q rotates the camera', Math.abs(y1.yaw - p2.yaw) > 0.4, `yaw ${p2.yaw.toFixed(2)} -> ${y1.yaw.toFixed(2)}`);

// 4. Right-drag orbits and tilts.
await page.mouse.move(...at(0.5, 0.5));
await page.mouse.down({ button: 'right' });
await page.mouse.move(...at(0.6, 0.45), { steps: 6 });
await page.mouse.up({ button: 'right' });
await settle();
const o1 = await state();
check('right-drag orbits', Math.abs(o1.yaw - y1.yaw) > 0.3, `yaw ${y1.yaw.toFixed(2)} -> ${o1.yaw.toFixed(2)}`);
check('right-drag tilts', Math.abs(o1.pitch - y1.pitch) > 0.05, `pitch ${y1.pitch.toFixed(2)} -> ${o1.pitch.toFixed(2)}`);

// 5. Middle-drag grabs the ground: the point under the pointer at the start stays under it.
const [sx, sy] = at(0.55, 0.6);
const [ex, ey] = at(0.4, 0.45);
await page.mouse.move(sx, sy);
const before = await groundAt(sx, sy);
await page.mouse.down({ button: 'middle' });
await page.mouse.move(ex, ey, { steps: 8 });
await frames(3); // let the grab catch up to the final pointer position
// Grab-pan holds the horizontal plane at the anchor's height, so compare on that plane
// (terrain of a different height under the cursor legitimately differs from the anchor).
const during = await planeAt(ex, ey, before.y);
await page.mouse.up({ button: 'middle' });
check('middle-drag keeps the grabbed point under the cursor', dist3(before, during) < 1, `off by ${dist3(before, during).toFixed(2)} units`);

// 6. A short right-CLICK is not a drag (it must stay available for cancelling placement).
await settle();
const c0 = await state();
await page.mouse.click(...at(0.5, 0.5), { button: 'right' });
await settle(4);
const c1 = await state();
check('right-click does not move the camera', Math.abs(c1.yaw - c0.yaw) < 1e-3 && Math.abs(c1.pitch - c0.pitch) < 1e-3);

// 7. Edge scroll.
const e0 = await state();
await page.mouse.move(2, Math.round(H / 2));
await frames(4);
await page.mouse.move(...at(0.5, 0.5));
await settle();
const e1 = await state();
check('screen-edge scroll pans', Math.hypot(e1.fx - e0.fx, e1.fz - e0.fz) > 10, `moved ${Math.hypot(e1.fx - e0.fx, e1.fz - e0.fz).toFixed(1)}`);

// 8. Home restores the view.
await page.keyboard.down('Home');
await frames(2);
await page.keyboard.up('Home');
await settle(30);
const h = await state();
check('Home restores the overview', Math.abs(h.dist - s0.dist) / s0.dist < 0.05 && Math.abs(h.fx) < 5 && Math.abs(h.fz) < 5, `dist ${h.dist.toFixed(0)}, focus ${h.fx.toFixed(1)},${h.fz.toFixed(1)}`);

await page.screenshot({ path: 'e2e-out/camera-final.png' });
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
process.exit(results.every(Boolean) && errors.length === 0 ? 0 : 1);
