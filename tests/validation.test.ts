import { describe, expect, it } from 'vitest';
import { getDef } from '../src/buildings/catalog';
import { COAST_PAD_MIN, MIN_GAP, bestCoastRotation, coastScore, footprintObb, validatePlacement, type PlacementEnv } from '../src/buildings/Validation';
import type { BuildingDef } from '../src/buildings/types';
import { SpatialHash } from '../src/core/SpatialHash';
import { obbAabb, obbOverlap, type Obb } from '../src/core/obb';
import { Territory } from '../src/world/Territory';
import { makeMap } from './helpers';

/**
 * Synthetic map (see helpers.ts): a ramp rising 0.1 per unit towards +x, sea at x <= -10,
 * exaggeration 1. The country polygon spans x in [-13, 15], z in [-15, 15].
 */
function makeEnv(existing: Array<{ id: number; name: string; obb: Obb; padY?: number }> = []): PlacementEnv {
  const hf = makeMap();
  const territory = new Territory([[[[-13, -15], [15, -15], [15, 15], [-13, 15]]]]);
  return {
    hf,
    territory,
    // A mocked neighbour was "built" at the ground height under it unless the test says otherwise.
    overlapping: (obb, margin) =>
      existing
        .filter((e) => obbOverlap(obb, e.obb, margin))
        .map((e) => ({ id: e.id, name: e.name, padY: e.padY ?? hf.meanHeight(e.obb.cx, e.obb.cz, e.obb.hw, e.obb.hd, e.obb.rot) })),
  };
}
const codes = (r: { reasons: Array<{ code: string }> }) => r.reasons.map((x) => x.code);

describe('Territory', () => {
  const square = new Territory([[[[0, 0], [10, 0], [10, 10], [0, 10]]]]);

  it('tests points exactly against the polygon', () => {
    expect(square.contains(5, 5)).toBe(true);
    expect(square.contains(-0.01, 5)).toBe(false);
    expect(square.contains(10.01, 5)).toBe(false);
    expect(square.contains(5, 11)).toBe(false);
  });

  it('honours holes and unions separate polygons (islands)', () => {
    const t = new Territory([
      [[[0, 0], [10, 0], [10, 10], [0, 10]], [[4, 4], [6, 4], [6, 6], [4, 6]]],
      [[[20, 0], [24, 0], [24, 4], [20, 4]]],
    ]);
    expect(t.contains(2, 2)).toBe(true);
    expect(t.contains(5, 5)).toBe(false); // lake / enclave
    expect(t.contains(22, 2)).toBe(true); // island
    expect(t.contains(15, 2)).toBe(false); // sea between
  });

  it('requires the whole rotated footprint to be inside', () => {
    expect(square.containsObb({ cx: 5, cz: 5, hw: 2, hd: 1, rot: 0.5 })).toBe(true);
    expect(square.containsObb({ cx: 9, cz: 5, hw: 2, hd: 1, rot: 0 })).toBe(false); // sticks out east
    expect(square.containsObb({ cx: 8.9, cz: 5, hw: 2, hd: 1, rot: Math.PI / 2 })).toBe(true); // rotated: now only 1 wide in x (7.9..9.9)
    expect(square.containsObb({ cx: 9.2, cz: 5, hw: 2, hd: 1, rot: Math.PI / 2 })).toBe(false); // reaches x = 10.2
  });
});

describe('SpatialHash', () => {
  it('returns candidates whose cells overlap, and forgets removed ids', () => {
    const h = new SpatialHash(8);
    h.insert(1, { minX: 0, maxX: 3, minZ: 0, maxZ: 3 });
    h.insert(2, { minX: 20, maxX: 24, minZ: 20, maxZ: 24 });
    h.insert(3, { minX: -30, maxX: -20, minZ: 2, maxZ: 5 }); // negative coordinates
    expect(h.query({ minX: 1, maxX: 2, minZ: 1, maxZ: 2 })).toEqual([1]);
    expect(h.query({ minX: 21, maxX: 22, minZ: 21, maxZ: 22 })).toEqual([2]);
    expect(h.query({ minX: -25, maxX: -24, minZ: 3, maxZ: 4 })).toEqual([3]);
    expect(h.query({ minX: 100, maxX: 101, minZ: 100, maxZ: 101 })).toEqual([]);
    h.remove(1);
    expect(h.query({ minX: 1, maxX: 2, minZ: 1, maxZ: 2 })).toEqual([]);
    expect(h.size).toBe(2);
  });

  it('a large building is found from any cell it spans, and re-inserting moves it', () => {
    const h = new SpatialHash(4);
    h.insert(7, { minX: 0, maxX: 12, minZ: 0, maxZ: 3 });
    for (const x of [1, 6, 11]) expect(h.query({ minX: x, maxX: x, minZ: 1, maxZ: 1 })).toEqual([7]);
    h.insert(7, { minX: 40, maxX: 44, minZ: 0, maxZ: 3 });
    expect(h.query({ minX: 6, maxX: 6, minZ: 1, maxZ: 1 })).toEqual([]);
    expect(h.query({ minX: 42, maxX: 42, minZ: 1, maxZ: 1 })).toEqual([7]);
    expect(h.size).toBe(1);
  });

  it('never misses a true overlap (agrees with a brute-force oracle)', () => {
    let seed = 99;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const h = new SpatialHash(6);
    const boxes: Obb[] = [];
    for (let i = 0; i < 80; i++) {
      const o: Obb = { cx: rnd() * 100 - 50, cz: rnd() * 100 - 50, hw: 0.5 + rnd() * 3, hd: 0.5 + rnd() * 3, rot: rnd() * 6.28 };
      boxes.push(o);
      h.insert(i, obbAabb(o));
    }
    for (let n = 0; n < 60; n++) {
      const q: Obb = { cx: rnd() * 100 - 50, cz: rnd() * 100 - 50, hw: 1 + rnd() * 3, hd: 1 + rnd() * 3, rot: rnd() * 6.28 };
      const candidates = new Set(h.query(obbAabb(q)));
      boxes.forEach((b, i) => {
        if (obbOverlap(q, b)) expect(candidates.has(i), `query ${n} misses ${i}`).toBe(true);
      });
    }
  });
});

describe('validatePlacement', () => {
  const hospital = getDef('hospital');
  // A synthetic, strict def so these tests do not depend on the catalog's tuned slope limits.
  const warFactory: BuildingDef = { ...getDef('war_factory'), placement: { maxSlopeDeg: 5 } };
  const port = getDef('port');

  it('accepts a hospital on gentle ground inside the border', () => {
    const env = makeEnv();
    const r = validatePlacement(env, hospital, 4, 0, 0);
    expect(codes(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.slopeDeg).toBeCloseTo((Math.atan(0.1) * 180) / Math.PI, 1);
    // pad height = mean of the ramp under the footprint = ramp height at its centre
    expect(r.padY).toBeCloseTo(0.1 * (4 + 10), 2);
  });

  it('rejects steep ground with a message quoting the numbers (limit 5 deg, ramp is 5.7)', () => {
    const r = validatePlacement(makeEnv(), warFactory, 4, 0, 0);
    expect(codes(r)).toContain('too_steep');
    expect(r.reasons.find((x) => x.code === 'too_steep')!.message).toMatch(/Too steep: 6° \(max 5°\)/);
  });

  it('rejects building on water', () => {
    const r = validatePlacement(makeEnv(), hospital, -12, 0, 0);
    expect(codes(r)).toContain('water');
  });

  it('rejects footprints outside the border, even when partly inside', () => {
    const env = makeEnv();
    expect(codes(validatePlacement(env, hospital, 14, 0, 0))).toContain('outside_border'); // 14 + 1.8 > 15
    expect(codes(validatePlacement(env, hospital, 12, 0, 0))).not.toContain('outside_border');
  });

  it('rejects footprints that leave the map lattice', () => {
    expect(codes(validatePlacement(makeEnv(), hospital, 19.5, 0, 0))).toContain('out_of_map');
  });

  it('rejects overlaps and near misses inside the minimum gap, naming the neighbour', () => {
    const first = footprintObb(hospital, 0, 0, 0);
    const env = makeEnv([{ id: 1, name: 'Hospital', obb: first }]);
    const r = validatePlacement(env, hospital, 1, 0, 0);
    expect(codes(r)).toContain('overlap');
    expect(r.reasons.find((x) => x.code === 'overlap')!.message).toBe('Overlaps Hospital');
    const w = hospital.footprint.w;
    expect(codes(validatePlacement(env, hospital, w + MIN_GAP * 0.5, 0, 0))).toContain('overlap'); // inside the gap
    expect(codes(validatePlacement(env, hospital, w + MIN_GAP * 2, 0, 0))).not.toContain('overlap');
  });

  it('reports every failing rule at once', () => {
    const env = makeEnv([{ id: 1, name: 'Hospital', obb: footprintObb(getDef('hospital'), 16, 0, 0) }]);
    const r = validatePlacement(env, warFactory, 16, 0, 0);
    expect(new Set(codes(r))).toEqual(new Set(['outside_border', 'too_steep', 'overlap']));
    expect(r.ok).toBe(false);
  });

  it('honours a minimum elevation', () => {
    const tall: BuildingDef = { ...hospital, placement: { ...hospital.placement, minElevationM: 2000 } };
    const ok = { ...hospital, placement: { ...hospital.placement, minElevationM: 800 } };
    expect(codes(validatePlacement(makeEnv(), tall, 4, 0, 0))).toContain('too_low'); // pad is 1400 m
    expect(codes(validatePlacement(makeEnv(), ok, 4, 0, 0))).not.toContain('too_low');
  });
});

describe('coastal buildings', () => {
  const port = getDef('port');
  const naval = getDef('naval_base');
  // Front (+z) must point to -x (the sea): local +z in world = (sin rot, cos rot) = (-1, 0) => rot = -pi/2.
  const SEAWARD = -Math.PI / 2;

  it('need a coast: inland is refused', () => {
    expect(codes(validatePlacement(makeEnv(), port, 6, 0, 0))).toContain('needs_coast');
  });

  it('are accepted when the front faces the sea and refused when it faces the land', () => {
    const env = makeEnv();
    const good = validatePlacement(env, port, -9.5, 0, SEAWARD);
    expect(codes(good)).toEqual([]);
    const backwards = validatePlacement(env, port, -9.5, 0, Math.PI / 2);
    expect(codes(backwards)).toContain('needs_coast');
    const sideways = validatePlacement(env, port, -9.5, 0, 0);
    expect(codes(sideways)).toContain('needs_coast');
  });

  it('own their territorial waters: only the landward part must be inside a land-only border', () => {
    // A border that ends at the shoreline (x = -10), like a real country polygon.
    const hf = makeMap();
    const landOnly = new Territory([[[[-10, -15], [15, -15], [15, 15], [-10, 15]]]]);
    const env: PlacementEnv = { hf, territory: landOnly, overlapping: () => [] };
    const ok = validatePlacement(env, port, -9.5, 0, SEAWARD);
    expect(codes(ok)).toEqual([]); // sea ahead is outside the polygon, and that is fine
    // But a coastal building whose landward half is foreign is still refused.
    const foreignLand = new Territory([[[[-10, -15], [-8, -15], [-8, 15], [-10, 15]]]]);
    const bad = validatePlacement({ hf, territory: foreignLand, overlapping: () => [] }, port, -9.5, 0, SEAWARD);
    expect(codes(bad)).toContain('outside_border');
    // And a non-coastal building over the same water/border is still refused as outside the border.
    expect(codes(validatePlacement(env, getDef('hospital'), -11.5, 0, 0))).toContain('outside_border');
  });

  it('get a dry quay: the pad is never below the minimum coast height', () => {
    const r = validatePlacement(makeEnv(), naval, -9.5, 0, SEAWARD);
    expect(r.padY).toBeGreaterThanOrEqual(COAST_PAD_MIN);
    expect(r.padY).toBeGreaterThan(0);
  });

  it('auto-orientation finds the seaward rotation and scores it best', () => {
    const { hf } = makeEnv();
    const rot = bestCoastRotation(hf, port, -9.5, 0);
    const wrapped = ((rot % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const target = ((SEAWARD % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    expect(Math.abs(wrapped - target)).toBeLessThan(0.3);
    expect(coastScore(hf, port, -9.5, 0, rot)).toBeGreaterThan(0.6);
    expect(coastScore(hf, port, -9.5, 0, rot)).toBeGreaterThan(coastScore(hf, port, -9.5, 0, rot + Math.PI));
  });

  it('auto-orientation has hysteresis: it keeps a near-best current rotation', () => {
    const { hf } = makeEnv();
    const best = bestCoastRotation(hf, port, -9.5, 0);
    const slightlyOff = best + 0.05;
    expect(bestCoastRotation(hf, port, -9.5, 0, slightlyOff)).toBe(slightlyOff);
    // ...but abandons a clearly wrong one.
    expect(bestCoastRotation(hf, port, -9.5, 0, best + Math.PI)).not.toBe(best + Math.PI);
  });
});
