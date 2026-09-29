import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { outlineOf } from '../scripts/lib/outline.mjs';

const square = (x: number, z: number, s: number, n = 4) => {
  // A square ring with `n` points per side.
  const ring: number[][] = [];
  for (let k = 0; k < n; k++) ring.push([x + (s * k) / n, z]);
  for (let k = 0; k < n; k++) ring.push([x + s, z + (s * k) / n]);
  for (let k = 0; k < n; k++) ring.push([x + s - (s * k) / n, z + s]);
  for (let k = 0; k < n; k++) ring.push([x, z + s - (s * k) / n]);
  return ring;
};

describe('outlineOf', () => {
  it('keeps big polygons, drops specks and returns outer rings only', () => {
    const borders = [[square(0, 0, 100), square(10, 10, 5)], [square(200, 0, 40)], [square(400, 0, 3)]];
    const out = outlineOf(borders);
    expect(out).toHaveLength(2); // the 3 km speck is under 3% of the main polygon
    expect(out[0][0]).toEqual([0, 0]);
  });

  it('thins long rings and rounds to 0.1 km', () => {
    const ring = square(0, 0, 100, 500);
    const out = outlineOf([[ring]], { maxPoints: 60 });
    expect(out[0].length).toBeLessThanOrEqual(60);
    expect(outlineOf([[[[0.123, 0.456], [10.06, 0], [5, 9]]]])[0][0]).toEqual([0.1, 0.5]);
  });

  it('handles empty input', () => {
    expect(outlineOf([])).toEqual([]);
  });

  it('is present for every shipped country', () => {
    const index = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../public/data/countries/index.json'), 'utf8'));
    for (const c of index) {
      expect(c.outline.length, c.iso).toBeGreaterThan(0);
      expect(c.outline[0].length, c.iso).toBeGreaterThan(10);
    }
  });
});
