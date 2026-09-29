import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { obbAabb, obbContains, obbCorners, obbOverlap, obbSamples, obbToLocal, obbToWorld, type Obb } from '../src/core/obb';
import { makeMap } from './helpers';

const box = (cx: number, cz: number, hw: number, hd: number, rot = 0): Obb => ({ cx, cz, hw, hd, rot });

describe('rotation convention matches three.js rotation.y', () => {
  it('maps local offsets exactly as an Object3D rotated about y would', () => {
    for (const rot of [0.3, 0.6, -1.1, 2.4, Math.PI / 2]) {
      const g = new THREE.Group();
      g.position.set(5, 0, -3);
      g.rotation.y = rot;
      g.updateMatrixWorld(true);
      for (const [lx, lz] of [[1, 0], [0, 1], [2, -1.5], [-0.7, 0.4]]) {
        const w = g.localToWorld(new THREE.Vector3(lx, 0, lz));
        const [x, z] = obbToWorld(box(5, -3, 1, 1, rot), lx, lz);
        expect(x).toBeCloseTo(w.x, 9);
        expect(z).toBeCloseTo(w.z, 9);
      }
    }
  });

  it('local <-> world round-trips', () => {
    const o = box(2, 3, 1.5, 1, 0.8);
    const [x, z] = obbToWorld(o, 0.7, -0.4);
    const [lx, lz] = obbToLocal(o, x, z);
    expect(lx).toBeCloseTo(0.7, 9);
    expect(lz).toBeCloseTo(-0.4, 9);
  });
});

describe('containment and bounds', () => {
  it('contains points along its rotated long axis but not across it', () => {
    const o = box(0, 0, 3, 0.5, 0.6); // long along local x
    const along = obbToWorld(o, 2.9, 0);
    expect(obbContains(o, along[0], along[1])).toBe(true);
    const beyond = obbToWorld(o, 3.2, 0);
    expect(obbContains(o, beyond[0], beyond[1])).toBe(false);
    expect(obbContains(o, beyond[0], beyond[1], 0.3)).toBe(true); // margin
    const across = obbToWorld(o, 0, 0.9);
    expect(obbContains(o, across[0], across[1])).toBe(false);
  });

  it('AABB encloses every corner and is tight for axis-aligned boxes', () => {
    const o = box(1, 2, 2, 1, 0.5);
    const a = obbAabb(o);
    for (const [x, z] of obbCorners(o)) {
      expect(x).toBeGreaterThanOrEqual(a.minX - 1e-9);
      expect(x).toBeLessThanOrEqual(a.maxX + 1e-9);
      expect(z).toBeGreaterThanOrEqual(a.minZ - 1e-9);
      expect(z).toBeLessThanOrEqual(a.maxZ + 1e-9);
    }
    const t = obbAabb(box(0, 0, 2, 1, 0));
    expect([t.minX, t.maxX, t.minZ, t.maxZ]).toEqual([-2, 2, -1, 1]);
  });

  it('samples cover the corners and centre', () => {
    const o = box(0, 0, 2, 1, 0.4);
    const pts = obbSamples(o, 3);
    expect(pts).toHaveLength(9);
    const corners = obbCorners(o);
    for (const [cx, cz] of corners) expect(pts.some(([x, z]) => Math.hypot(x - cx, z - cz) < 1e-9)).toBe(true);
    expect(pts.some(([x, z]) => Math.hypot(x, z) < 1e-9)).toBe(true);
  });
});

describe('obbOverlap (SAT)', () => {
  it('detects overlap, separation and the margin', () => {
    const a = box(0, 0, 1, 1);
    expect(obbOverlap(a, box(1.5, 0, 1, 1))).toBe(true);
    expect(obbOverlap(a, box(2.5, 0, 1, 1))).toBe(false);
    expect(obbOverlap(a, box(2.1, 0, 1, 1), 0.2)).toBe(true); // within the margin
    expect(obbOverlap(a, box(2.1, 0, 1, 1), 0.05)).toBe(false);
  });

  it('handles rotation: a thin rotated rod near a corner', () => {
    const square = box(0, 0, 1, 1, 0);
    // A rod of half-length 2, half-width 0.2, rotated 45deg lies along x + z = cx. Its distance to the
    // square's corner (1, 1) is (cx - 2) / sqrt(2), so it touches the square when that is < 0.2.
    expect(obbOverlap(square, box(2.2, 0, 2, 0.2, Math.PI / 4))).toBe(true); // 0.141 < 0.2
    expect(obbOverlap(square, box(2.5, 0, 2, 0.2, Math.PI / 4))).toBe(false); // 0.354 > 0.2
    expect(obbOverlap(square, box(2.5, 0, 2, 0.2, Math.PI / 4), 0.2)).toBe(true); // within a 0.2 margin
  });

  it('is symmetric and agrees with a dense point-sampling oracle on random pairs', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let n = 0; n < 300; n++) {
      const a = box(rnd() * 4, rnd() * 4, 0.4 + rnd(), 0.4 + rnd(), rnd() * 6.28);
      const b = box(rnd() * 4, rnd() * 4, 0.4 + rnd(), 0.4 + rnd(), rnd() * 6.28);
      expect(obbOverlap(a, b)).toBe(obbOverlap(b, a));
      // Oracle: any sampled point of A inside B, or of B inside A (or edge crossings) => overlap.
      let hit = false;
      for (const [x, z] of obbSamples(a, 25)) if (obbContains(b, x, z)) { hit = true; break; }
      if (!hit) for (const [x, z] of obbSamples(b, 25)) if (obbContains(a, x, z)) { hit = true; break; }
      if (hit) expect(obbOverlap(a, b), `pair ${n}`).toBe(true); // sampling can miss thin crossings, never the reverse
    }
  });
});

describe('terrain grading uses the same footprint as the building', () => {
  it('flattens exactly the rotated OBB (asymmetric angle), not its mirror image', () => {
    const hf = makeMap();
    // A long, thin footprint at an asymmetric angle: it and its mirror image are clearly distinct.
    const o = box(0, 0, 6, 0.5, 0.6);
    const mirror = box(0, 0, 6, 0.5, -0.6);
    const MARGIN = 0.5;
    const FLAT = 2; // the flat zone extends two cells beyond the footprint (bicubic support)
    hf.applyGrade(hf.planGrade({ cx: o.cx, cz: o.cz, halfW: o.hw, halfD: o.hd, rot: o.rot, targetY: 2, margin: MARGIN }), 1);
    let flat = 0;
    let mirrorOnly = 0;
    for (let j = 0; j < hf.rows; j++) {
      for (let i = 0; i < hf.cols; i++) {
        const x = hf.nodeX(i);
        const z = hf.nodeZ(j);
        const pad = hf.pad[j * hf.cols + i];
        if (obbContains(o, x, z, FLAT - 0.01)) {
          flat++;
          expect(pad, `node (${x},${z}) inside the footprint`).toBe(1);
          expect(hf.h[j * hf.cols + i]).toBeCloseTo(2, 5);
        }
        if (!obbContains(o, x, z, FLAT + MARGIN + 0.01)) {
          expect(pad, `node (${x},${z}) beyond the graded zone`).toBe(0);
          // Nodes inside the *mirror* footprint but beyond the true graded zone must be untouched.
          if (obbContains(mirror, x, z, 0.01)) mirrorOnly++;
        }
      }
    }
    expect(flat).toBeGreaterThan(10);
    expect(mirrorOnly).toBeGreaterThan(3); // nodes only the mirrored footprint covers
  });

  it('meanHeight samples the rotated footprint', () => {
    const hf = makeMap();
    // Ramp rises with +x; a footprint long along local x, rotated ~90deg, spans little x range.
    const long0 = hf.meanHeight(5, 0, 3, 0.2, 0);
    const longRot = hf.meanHeight(5, 0, 3, 0.2, Math.PI / 2);
    expect(long0).toBeCloseTo(hf.sample(5, 0), 3); // symmetric about centre on a plane
    expect(longRot).toBeCloseTo(hf.sample(5, 0), 3);
  });
});
