import { describe, expect, it } from 'vitest';
import {
  H_MAX, H_MIN, H_STEP, applyLandRule, bilinear, decodeHeight, despike, decodeTerrarium, encodeHeight, filterPolygons,
  lonLatToPixel, packDataImage, pickZoom, projectLocal, rasterizeMask, unpackDataImage, unprojectLocal,
} from '../scripts/lib/bake-lib.mjs';

describe('terrarium decode', () => {
  it('decodes sea level and known values', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(128, 10, 0)).toBe(10);
    expect(decodeTerrarium(127, 255, 0)).toBe(-1);
    expect(decodeTerrarium(128, 0, 128)).toBeCloseTo(0.5, 6);
  });
});

describe('height quantisation', () => {
  it('round-trips within one quantisation step and clamps out-of-range', () => {
    const step = H_STEP;
    for (const h of [-499, -3.2, 0, 0.5, 137.4, 2499, 7999]) {
      expect(Math.abs(decodeHeight(encodeHeight(h)) - h)).toBeLessThanOrEqual(step / 2 + 1e-9);
    }
    expect(decodeHeight(encodeHeight(-9999))).toBeCloseTo(H_MIN, 6);
    expect(decodeHeight(encodeHeight(99999))).toBeCloseTo(H_MAX, 6);
  });
});

describe('projection', () => {
  it('lonLatToPixel puts (0,0) at the centre of the world', () => {
    const p = lonLatToPixel(0, 0, 3);
    expect(p.x).toBeCloseTo(256 * 8 / 2, 6);
    expect(p.y).toBeCloseTo(256 * 8 / 2, 6);
  });
  it('local projection round-trips and scales longitude by cos(lat)', () => {
    const a = projectLocal(20, 52, 19, 52);
    expect(a.x).toBeCloseTo(111.195 * Math.cos((52 * Math.PI) / 180), 6);
    expect(a.y).toBeCloseTo(0, 6);
    const back = unprojectLocal(a.x, a.y, 19, 52);
    expect(back.lon).toBeCloseTo(20, 9);
    expect(back.lat).toBeCloseTo(52, 9);
  });
  it('pickZoom gets finer as the cell shrinks and as latitude drops', () => {
    expect(pickZoom(0.5, 52)).toBeGreaterThanOrEqual(pickZoom(1.0, 52));
    expect(pickZoom(0.5, 52)).toBeLessThanOrEqual(pickZoom(0.5, 0));
    // z8 at lat 52 is ~0.376 km/px, z7 is ~0.75: a 0.52 km cell needs z8.
    expect(pickZoom(0.52, 52)).toBe(8);
  });
});

describe('filterPolygons', () => {
  const mainland = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
  const overseas = [[[100, 40], [102, 40], [102, 42], [100, 42], [100, 40]]];
  it('drops polygons whose centre is outside the keep box', () => {
    const kept = filterPolygons([mainland, overseas], [-1, -1, 11, 11]);
    expect(kept).toEqual([mainland]);
  });
  it('keeps everything when there is no box', () => {
    expect(filterPolygons([mainland, overseas], null)).toHaveLength(2);
  });
});

describe('rasterizeMask', () => {
  it('fills a rectangle and respects holes', () => {
    const outer = [[2, 2], [12, 2], [12, 12], [2, 12]];
    const hole = [[5, 5], [9, 5], [9, 9], [5, 9]];
    const mask = rasterizeMask([[outer, hole]], 16, 16);
    const at = (i: number, j: number) => mask[j * 16 + i];
    expect(at(3, 3)).toBe(1);
    expect(at(11, 11)).toBe(1);
    expect(at(7, 7)).toBe(0); // inside the hole
    expect(at(0, 0)).toBe(0);
    expect(at(14, 14)).toBe(0);
  });
  it('unions separate polygons', () => {
    const a = [[[0, 0], [4, 0], [4, 4], [0, 4]]];
    const b = [[[8, 8], [12, 8], [12, 12], [8, 12]]];
    const mask = rasterizeMask([a, b], 16, 16);
    expect(mask[2 * 16 + 2]).toBe(1);
    expect(mask[10 * 16 + 10]).toBe(1);
    expect(mask[6 * 16 + 6]).toBe(0);
  });
  it('counts roughly the polygon area for a triangle', () => {
    const tri = [[[0, 0], [40, 0], [0, 40]]];
    const mask = rasterizeMask([tri], 48, 48);
    const n = mask.reduce((s, v) => s + v, 0);
    expect(n).toBeGreaterThan(0.45 * 40 * 40);
    expect(n).toBeLessThan(0.55 * 40 * 40 + 60);
  });
});

describe('bilinear + data image', () => {
  it('interpolates and clamps at edges', () => {
    const d = new Float32Array([0, 10, 20, 30]); // 2x2
    expect(bilinear(d, 2, 2, 0.5, 0)).toBeCloseTo(5);
    expect(bilinear(d, 2, 2, 0.5, 0.5)).toBeCloseTo(15);
    expect(bilinear(d, 2, 2, -5, -5)).toBe(0);
    expect(bilinear(d, 2, 2, 9, 9)).toBe(30);
  });
  it('packs and unpacks heights and mask', () => {
    const h = new Float32Array([-20, 0, 250.5, 4800]);
    const m = new Uint8Array([0, 1, 1, 0]);
    const { heights, mask } = unpackDataImage(packDataImage(h, m, 2, 2), 2, 2);
    for (let i = 0; i < 4; i++) expect(Math.abs(heights[i] - h[i])).toBeLessThanOrEqual(H_STEP / 2 + 1e-9);
    expect(Array.from(mask)).toEqual([0, 1, 1, 0]);
  });
  it('applyLandRule lifts sub-sea-level land inside the border only', () => {
    const h = new Float32Array([-3, -3, 5]);
    applyLandRule(h, new Uint8Array([1, 0, 1]));
    expect(h[0]).toBeCloseTo(0.5);
    expect(h[1]).toBe(-3);
    expect(h[2]).toBe(5);
  });
});

describe('despike', () => {
  const grid = (w: number, h: number, fill: number) => new Float32Array(w * h).fill(fill);

  it('removes an isolated spike over flat, near-sea-level ground', () => {
    const d = grid(9, 9, 2);
    d[4 * 9 + 4] = 450;
    expect(despike(d, 9, 9)).toBe(1);
    expect(d[4 * 9 + 4]).toBe(2);
  });

  it('removes a 2x2 blob of spikes (a bilinear-spread single pixel would look like this)', () => {
    const d = grid(9, 9, 1);
    for (const [x, y] of [[4, 4], [5, 4], [4, 5], [5, 5]]) d[y * 9 + x] = 300;
    expect(despike(d, 9, 9)).toBe(4);
    expect(Math.max(...d)).toBe(1);
  });

  it('never flattens real mountains: a steep peak on high ground is kept', () => {
    const d = grid(9, 9, 1500);
    d[4 * 9 + 4] = 2400;
    expect(despike(d, 9, 9)).toBe(0);
    expect(d[4 * 9 + 4]).toBe(2400);
  });

  it('keeps a coastal cliff (high neighbours agree with the tall cell)', () => {
    const d = grid(9, 9, 0);
    for (let y = 0; y < 9; y++) for (let x = 4; x < 9; x++) d[y * 9 + x] = 120; // plateau meeting the sea
    expect(despike(d, 9, 9)).toBe(0);
  });

  it('leaves low ground untouched', () => {
    const d = grid(9, 9, 5);
    d[4 * 9 + 4] = 40;
    expect(despike(d, 9, 9)).toBe(0);
  });
});
