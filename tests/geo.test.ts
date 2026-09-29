import { describe, expect, it } from 'vitest';
import { unprojectLocal } from '../scripts/lib/bake-lib.mjs';
import { formatLatLon, niceLength, worldToLatLon } from '../src/ui/geo';

describe('geo readouts', () => {
  const origin = { lon0: 19.4, lat0: 52.1 };

  it('puts the world origin at (lon0, lat0)', () => {
    const p = worldToLatLon(origin, 4, 0, 0);
    expect(p.lat).toBeCloseTo(52.1, 9);
    expect(p.lon).toBeCloseTo(19.4, 9);
  });

  it('inverts the baker projection (north is -z, x is east, scale converts world units to km)', () => {
    for (const [x, z] of [[10, -20], [-35.5, 44.25], [80, 3]]) {
      const ref = unprojectLocal(x * 4, -z * 4, origin.lon0, origin.lat0);
      const p = worldToLatLon(origin, 4, x, z);
      expect(p.lat).toBeCloseTo(ref.lat, 9);
      expect(p.lon).toBeCloseTo(ref.lon, 9);
    }
    expect(worldToLatLon(origin, 4, 0, -10).lat).toBeGreaterThan(52.1); // up the screen is north
    expect(worldToLatLon(origin, 4, 10, 0).lon).toBeGreaterThan(19.4); // right is east
  });

  it('formats degrees and arc-minutes with hemispheres', () => {
    expect(formatLatLon(52.2333, 19.3667)).toBe('52°14′N 019°22′E');
    expect(formatLatLon(-33.75, -70.5)).toBe('33°45′S 070°30′W');
    expect(formatLatLon(0, 0)).toBe('00°00′N 000°00′E');
  });

  it('rolls arc-minutes over instead of printing 60', () => {
    expect(formatLatLon(10.9999, 10.9999)).toBe('11°00′N 011°00′E');
  });

  it('picks 1-2-5 scale bar lengths', () => {
    expect(niceLength(130)).toBe(100);
    expect(niceLength(240)).toBe(200);
    expect(niceLength(999)).toBe(500);
    expect(niceLength(7)).toBe(5);
    expect(niceLength(1)).toBe(1);
    expect(niceLength(0.4)).toBeCloseTo(0.2, 12);
    expect(niceLength(0)).toBe(1);
  });
});
