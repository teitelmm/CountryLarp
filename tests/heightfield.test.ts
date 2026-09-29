import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { catmullRom } from '../src/world/HeightField';
import { makeMap } from './helpers';

describe('HeightField sampling', () => {
  const hf = makeMap();

  it('maps nodes to world space centred on the origin', () => {
    expect(hf.nodeX(20)).toBe(0);
    expect(hf.nodeZ(20)).toBe(0);
    expect(hf.gridX(hf.nodeX(7))).toBeCloseTo(7, 9);
    expect(hf.halfX).toBe(20);
  });

  it('bicubic sampling passes exactly through nodes', () => {
    for (const [i, j] of [[3, 4], [20, 20], [37, 12]]) {
      expect(hf.sample(hf.nodeX(i), hf.nodeZ(j))).toBeCloseTo(hf.h[j * hf.cols + i], 6);
    }
  });

  it('reproduces a linear ramp exactly between nodes (Catmull-Rom is exact on linear data)', () => {
    // Height in km = 0.1 * (i - 10); at world x = nodeX(i) = i - 20 -> y = 0.1 * (x + 10).
    for (const x of [-7.3, 0.25, 4.9, 13.77]) {
      expect(hf.sample(x, 1.1)).toBeCloseTo(0.1 * (x + 10), 6);
      expect(hf.sampleLinear(x, 1.1)).toBeCloseTo(0.1 * (x + 10), 6);
    }
  });

  it('catmullRom interpolates b..c and hits the endpoints', () => {
    expect(catmullRom(0, 1, 2, 3, 0)).toBe(1);
    expect(catmullRom(0, 1, 2, 3, 1)).toBe(2);
    expect(catmullRom(0, 1, 2, 3, 0.5)).toBeCloseTo(1.5, 9);
  });

  it('classifies water and border membership', () => {
    expect(hf.isWater(hf.nodeX(5), 0)).toBe(true); // -0.5 km
    expect(hf.isWater(hf.nodeX(10), 0)).toBe(true); // exactly sea level counts as water
    expect(hf.isWater(hf.nodeX(25), 0)).toBe(false);
    expect(hf.isInside(hf.nodeX(20), hf.nodeZ(20))).toBe(true);
    expect(hf.isInside(hf.nodeX(12), hf.nodeZ(20))).toBe(false);
    expect(hf.isInside(hf.nodeX(20), hf.nodeZ(2))).toBe(false);
    expect(hf.isInside(1e6, 0)).toBe(false);
  });

  it('computes the slope of the ramp', () => {
    // rise 0.1 per 1 unit -> atan(0.1) = 5.71 degrees
    expect(hf.slopeDeg(0, 0)).toBeCloseTo((Math.atan(0.1) * 180) / Math.PI, 3);
    const n = hf.normal(0, 0);
    expect(n.length()).toBeCloseTo(1, 9);
    expect(n.x).toBeLessThan(0); // surface rises toward +x so the normal leans toward -x
    expect(n.z).toBeCloseTo(0, 9);
  });
});

describe('HeightField.raycast', () => {
  const hf = makeMap();

  it('hits the ramp where the analytic surface says it should', () => {
    // Straight down at x=4: ramp height is 0.1 * (4 + 10) = 1.4
    const hit = hf.raycast(new Vector3(4, 50, 3), new Vector3(0, -1, 0))!;
    expect(hit).not.toBeNull();
    expect(hit.x).toBeCloseTo(4, 3);
    expect(hit.y).toBeCloseTo(1.4, 3);
  });

  it('hits along an oblique ray and lands on the surface', () => {
    const o = new Vector3(-15, 10, 0);
    const d = new Vector3(1, -0.5, 0.05);
    const hit = hf.raycast(o, d)!;
    expect(hit).not.toBeNull();
    expect(hit.y).toBeCloseTo(hf.surface(hit.x, hit.z), 3);
    // the hit lies on the ray
    const t = (hit.x - o.x) / d.x;
    expect(o.y + d.y * t).toBeCloseTo(hit.y, 2);
  });

  it('returns the sea surface (y = 0) over water', () => {
    const hit = hf.raycast(new Vector3(-15, 20, 0), new Vector3(0, -1, 0))!;
    expect(hit.y).toBe(0);
    expect(hf.isWater(hit.x, hit.z)).toBe(true);
  });

  it('misses when pointing away or outside the map', () => {
    expect(hf.raycast(new Vector3(0, 50, 0), new Vector3(0, 1, 0))).toBeNull();
    expect(hf.raycast(new Vector3(500, 50, 0), new Vector3(0, -1, 0))).toBeNull();
    expect(hf.raycast(new Vector3(0, 50, 0), new Vector3(1, 0, 0))).toBeNull();
  });
});

describe('HeightField grading', () => {
  const spec = { cx: 5, cz: 0, halfW: 2, halfD: 1.5, rot: 0, targetY: 1.5, margin: 3 };

  it('flattens the footprint exactly, blends out over the margin and leaves the rest alone', () => {
    const hf = makeMap();
    const untouched = hf.h.slice();
    const plan = hf.planGrade(spec);
    hf.applyGrade(plan, 1);
    // inside the footprint
    for (const [dx, dz] of [[0, 0], [1, 1], [-1.9, -1.4], [2, 1]]) {
      expect(hf.sample(spec.cx + dx, spec.cz + dz)).toBeCloseTo(1.5, 5);
    }
    // monotone blend along +x beyond the footprint edge (x = 7): weight falls 1 -> 0 across 3 units
    const w = [7.5, 8.5, 9.5, 10.5].map((x) => Math.abs(hf.sample(x, 0) - 1.5) / Math.max(1e-9, Math.abs(untouched[20 * 41 + Math.round(x + 20)] - 1.5)));
    for (let k = 1; k < w.length; k++) expect(w[k]).toBeGreaterThanOrEqual(w[k - 1] - 1e-6);
    // beyond footprint + margin nothing changed
    for (let j = 0; j < hf.rows; j++) {
      const n = j * hf.cols + Math.round(hf.gridX(12)); // x = 12, well past 7 + 3
      expect(hf.h[n]).toBe(untouched[n]);
    }
    // pad weight is 1 inside, 0 far away
    expect(hf.pad[20 * 41 + Math.round(hf.gridX(5))]).toBe(1);
    expect(hf.pad[20 * 41 + Math.round(hf.gridX(15))]).toBe(0);
  });

  it('honours rotation: a footprint rotated 90 degrees swaps its extents', () => {
    const hf = makeMap();
    hf.applyGrade(hf.planGrade({ ...spec, rot: Math.PI / 2 }), 1);
    // Rotated: long side (halfW=2) now runs along z, short side (halfD=1.5) along x.
    expect(hf.sample(5, 1.8)).toBeCloseTo(1.5, 5); // inside only when rotated
    expect(hf.pad[Math.round(hf.gridZ(1.9)) * 41 + Math.round(hf.gridX(5))]).toBe(1);
  });

  it('animates linearly and tracks a dirty rectangle', () => {
    const hf = makeMap();
    const before = hf.sample(5, 0);
    const plan = hf.planGrade(spec);
    hf.applyGrade(plan, 0);
    expect(hf.sample(5, 0)).toBeCloseTo(before, 9);
    expect(hf.takeDirty()).not.toBeNull();
    expect(hf.takeDirty()).toBeNull(); // consumed
    hf.applyGrade(plan, 0.5);
    expect(hf.sample(5, 0)).toBeCloseTo((before + 1.5) / 2, 5);
    const rect = hf.takeDirty()!;
    expect(rect.i0).toBeLessThanOrEqual(Math.floor(hf.gridX(5 - 2 - 3)));
    expect(rect.i1).toBeGreaterThanOrEqual(Math.ceil(hf.gridX(5 + 2 + 3)));
  });

  it('meanHeight of a ramp is the height at its centre', () => {
    const hf = makeMap();
    expect(hf.meanHeight(6, 0, 2, 1.5, 0)).toBeCloseTo(0.1 * (6 + 10), 5);
    expect(hf.meanHeight(6, 0, 2, 1.5, 0.7)).toBeCloseTo(0.1 * (6 + 10), 5);
  });
});

describe('natural terrain (validation judges the land, not earlier earthworks)', () => {
  it('sampleNatural and slopeDegNatural match the live surface until something is graded', () => {
    const hf = makeMap();
    for (const [x, z] of [[2, 1], [-4, 3], [9.5, -6]]) {
      expect(hf.sampleNatural(x, z)).toBeCloseTo(hf.sample(x, z), 9);
      expect(hf.slopeDegNatural(x, z)).toBeCloseTo(hf.slopeDeg(x, z), 6);
    }
    expect(hf.slopeDegNatural(0, 0)).toBeCloseTo((Math.atan(0.1) * 180) / Math.PI, 3);
  });

  it('is untouched by grading, while the live surface changes', () => {
    const hf = makeMap();
    const natural = hf.sampleNatural(5, 0);
    const slope = hf.slopeDegNatural(6.4, 0.3);
    hf.applyGrade(hf.planGrade({ cx: 5, cz: 0, halfW: 2, halfD: 2, rot: 0, targetY: 3, margin: 1.6 }), 1);
    expect(hf.sample(5, 0)).toBeCloseTo(3, 5);
    expect(hf.sampleNatural(5, 0)).toBeCloseTo(natural, 9);
    expect(hf.slopeDegNatural(6.4, 0.3)).toBeCloseTo(slope, 9);
    // The flat zone reaches x = 9; the blend ramp (x = 9..10.6) is far steeper than the land it was carved from.
    expect(hf.slopeDeg(9.8, 0)).toBeGreaterThan(hf.slopeDegNatural(9.8, 0) + 5);
  });

  it('meanHeight can be taken over the natural terrain', () => {
    const hf = makeMap();
    const before = hf.meanHeight(5, 0, 2, 2, 0, 5, true);
    hf.applyGrade(hf.planGrade({ cx: 5, cz: 0, halfW: 2, halfD: 2, rot: 0, targetY: 3, margin: 1.6 }), 1);
    expect(hf.meanHeight(5, 0, 2, 2, 0, 5, true)).toBeCloseTo(before, 9);
    expect(hf.meanHeight(5, 0, 2, 2, 0, 5, false)).toBeCloseTo(3, 4);
  });
});
