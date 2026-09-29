import { Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { RTSCamera } from '../src/camera/RTSCamera';
import type { Input } from '../src/core/Input';
import { makeMap } from './helpers';

/** Just the surface of Input that RTSCamera.update reads. */
function fakeInput(over: Partial<{ down: string[]; wheel: number; shift: boolean; buttons: [boolean, boolean, boolean]; drag: { button: number; startNdc?: Vector2 } | null; dragDelta: { dx: number; dy: number }; ndc: Vector2 }> = {}) {
  const state = { wheel: over.wheel ?? 0, dragDelta: over.dragDelta ?? { dx: 0, dy: 0 } };
  const input = {
    keys: new Set(over.down ?? []),
    shift: over.shift ?? false,
    buttons: over.buttons ?? [false, false, false],
    drag: over.drag ? { startNdc: over.ndc ?? new Vector2(0, 0), ...over.drag } : null,
    pointer: { x: 0, y: 0, ndc: over.ndc ?? new Vector2(0, 0), overCanvas: false, known: true },
    isDown(...codes: string[]) { return codes.some((c) => this.keys.has(c)); },
    consumeWheel() { const w = state.wheel; state.wheel = 0; return w; },
    consumeDrag() { const d = state.dragDelta; state.dragDelta = { dx: 0, dy: 0 }; return d; },
  };
  return input as unknown as Input & { keys: Set<string>; pointer: { ndc: Vector2 } };
}

function makeRig(pose: { x: number; z: number; yaw?: number; pitch?: number; dist?: number }) {
  const hf = makeMap();
  const rig = new RTSCamera(16 / 9);
  rig.attach(hf);
  rig.minDistance = 4;
  rig.maxDistance = 120;
  rig.setPose({ focus: new Vector3(pose.x, 0, pose.z), yaw: pose.yaw ?? 0, pitch: pose.pitch ?? 0.9, distance: pose.dist ?? 20 });
  return { hf, rig };
}

describe('RTSCamera zoom to cursor', () => {
  it('keeps the ground point under the cursor fixed when zooming in and out', () => {
    const { rig } = makeRig({ x: 6, z: 0, yaw: 0.4, dist: 22 });
    const ndc = new Vector2(0.15, -0.1);
    const before = rig.raycastTerrain(ndc)!;
    expect(before).not.toBeNull();
    for (const wheel of [-500, -250, 400, 900]) {
      rig.zoomAt(ndc, wheel);
      rig.snap();
      const after = rig.raycastTerrain(ndc)!;
      expect(after.distanceTo(before), `wheel ${wheel}`).toBeLessThan(2e-3);
    }
  });

  it('zooming in reduces distance and zooming out increases it, within limits', () => {
    const { rig } = makeRig({ x: 6, z: 0, dist: 22 });
    const c = new Vector2(0, 0);
    rig.zoomAt(c, -300);
    rig.snap();
    expect(rig.distance).toBeLessThan(22);
    rig.zoomAt(c, -1e6);
    rig.snap();
    expect(rig.distance).toBe(4);
    rig.zoomAt(c, 1e6);
    rig.snap();
    expect(rig.distance).toBe(120);
  });
});

describe('RTSCamera panning', () => {
  it('W pans north (-z) at yaw 0 and left/right pan along x', () => {
    const { rig } = makeRig({ x: 0, z: 5, yaw: 0 });
    const z0 = rig.focus.z;
    for (let n = 0; n < 60; n++) rig.update(1 / 60, fakeInput({ down: ['KeyW'] }));
    expect(rig.focus.z).toBeLessThan(z0 - 1);
    expect(Math.abs(rig.focus.x)).toBeLessThan(1e-6);
    const x0 = rig.focus.x;
    for (let n = 0; n < 60; n++) rig.update(1 / 60, fakeInput({ down: ['KeyD'] }));
    expect(rig.focus.x).toBeGreaterThan(x0 + 1);
  });

  it('pans relative to the camera yaw (yaw = 90 deg: forward is -x)', () => {
    const { rig } = makeRig({ x: 5, z: 0, yaw: Math.PI / 2 });
    const x0 = rig.focus.x;
    for (let n = 0; n < 60; n++) rig.update(1 / 60, fakeInput({ down: ['KeyW'] }));
    expect(rig.focus.x).toBeLessThan(x0 - 1);
    expect(Math.abs(rig.focus.z)).toBeLessThan(1e-3);
  });

  it('diagonal panning is not faster than straight panning', () => {
    const a = makeRig({ x: 0, z: 0 });
    const b = makeRig({ x: 0, z: 0 });
    for (let n = 0; n < 30; n++) {
      a.rig.update(1 / 60, fakeInput({ down: ['KeyW'] }));
      b.rig.update(1 / 60, fakeInput({ down: ['KeyW', 'KeyD'] }));
    }
    const straight = Math.hypot(a.rig.focus.x, a.rig.focus.z);
    const diagonal = Math.hypot(b.rig.focus.x, b.rig.focus.z);
    expect(diagonal).toBeCloseTo(straight, 1);
  });

  it('keeps the focus inside the map', () => {
    const { hf, rig } = makeRig({ x: 0, z: 0 });
    for (let n = 0; n < 600; n++) rig.update(0.05, fakeInput({ down: ['KeyW', 'KeyA'], shift: true }));
    expect(rig.focus.z).toBeGreaterThanOrEqual(-hf.halfZ - 1e-6);
    expect(rig.focus.x).toBeGreaterThanOrEqual(-hf.halfX - 1e-6);
  });
});

describe('RTSCamera rotation and tilt', () => {
  it('Q/E rotate in opposite directions and PageUp/PageDown tilt within limits', () => {
    const { rig } = makeRig({ x: 5, z: 0 });
    for (let n = 0; n < 30; n++) rig.update(1 / 60, fakeInput({ down: ['KeyQ'] }));
    expect(rig.yaw).toBeGreaterThan(0.2);
    for (let n = 0; n < 120; n++) rig.update(1 / 60, fakeInput({ down: ['KeyE'] }));
    expect(rig.yaw).toBeLessThan(0);
    for (let n = 0; n < 600; n++) rig.update(1 / 60, fakeInput({ down: ['PageUp'] }));
    expect(rig.pitch).toBeLessThanOrEqual((88 * Math.PI) / 180 + 1e-9);
    for (let n = 0; n < 600; n++) rig.update(1 / 60, fakeInput({ down: ['PageDown'] }));
    expect(rig.pitch).toBeGreaterThanOrEqual((18 * Math.PI) / 180 - 1e-9);
  });

  it('right-drag orbits', () => {
    const { rig } = makeRig({ x: 5, z: 0 });
    const yaw0 = rig.yaw;
    const input = fakeInput({ buttons: [false, false, true], drag: { button: 2 }, dragDelta: { dx: 100, dy: 0 } });
    for (let n = 0; n < 60; n++) rig.update(1 / 60, input);
    expect(rig.yaw).toBeLessThan(yaw0 - 0.3);
  });
});

describe('RTSCamera terrain interaction', () => {
  it('never dips below the terrain surface', () => {
    // Low pitch, close in, camera on the +x side where the ramp rises.
    const { hf, rig } = makeRig({ x: 0, z: 0, yaw: Math.PI / 2, pitch: 0.32, dist: 14 });
    for (let n = 0; n < 240; n++) rig.update(1 / 60, fakeInput({ down: ['KeyA'] }));
    const p = rig.camera.position;
    expect(p.y).toBeGreaterThanOrEqual(hf.surface(p.x, p.z) + 0.6 - 1e-6);
  });

  it('the focus rides the terrain height', () => {
    const { hf, rig } = makeRig({ x: 0, z: 0, yaw: 0 });
    // ~0.3 s of panning east stays on the ramp (further would run into the sunken map edge).
    for (let n = 0; n < 20; n++) rig.update(1 / 60, fakeInput({ down: ['KeyD'] }));
    for (let n = 0; n < 120; n++) rig.update(1 / 60, fakeInput()); // let the smoothing settle
    expect(rig.focus.x).toBeGreaterThan(2);
    expect(rig.focus.y).toBeCloseTo(hf.surface(rig.focus.x, rig.focus.z), 2);
    expect(rig.focus.y).toBeGreaterThan(1.2); // ramp height at x=2 is 1.2
  });

  it('middle-drag keeps the grabbed ground point under the cursor', () => {
    const { rig } = makeRig({ x: 4, z: 0, yaw: 0.2, dist: 18 });
    const start = new Vector2(0.05, -0.05);
    const anchor = rig.raycastTerrain(start)!;
    const input = fakeInput({ buttons: [false, true, false], drag: { button: 1, startNdc: start.clone() }, ndc: start.clone() });
    rig.update(1 / 60, input); // establishes the grab
    const moved = new Vector2(0.3, 0.1);
    input.pointer.ndc.copy(moved);
    rig.update(1 / 60, input);
    const under = rig.raycastTerrain(moved)!;
    expect(under.distanceTo(anchor)).toBeLessThan(0.05);
  });
});
