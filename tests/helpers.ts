import type { CountryData, CountryMeta } from '../src/world/CountryData';
import { HeightField } from '../src/world/HeightField';

/**
 * Synthetic 41x41 map, 1 km cells, exaggeration 1 (so world Y = km).
 * Elevation metres = 100 * (i - 10): a planar ramp rising towards +x, with nodes i <= 10 at or
 * below sea level (water). The country mask covers i in [15, 35], j in [5, 35].
 * Near the lattice edge (|x| or |z| > ~18.6) the terrain sinks under the sea, so ramp-based
 * expectations only hold in the interior.
 */
export function makeMap(cols = 41, rows = 41) {
  const heights = new Float32Array(cols * rows);
  const mask = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      heights[j * cols + i] = 100 * (i - 10);
      mask[j * cols + i] = i >= 15 && i <= 35 && j >= 5 && j <= 35 ? 1 : 0;
    }
  }
  const meta = { iso: 'TST', name: 'Test', cols, rows, cellKm: 1 } as CountryMeta;
  const data: CountryData = { meta, cols, rows, cellKm: 1, scale: 1, borders: [], heights, mask, sizeX: cols - 1, sizeZ: rows - 1 };
  return new HeightField(data, 1);
}
