import { describe, expect, it } from 'vitest';
import { blurMask, buildChunkGeometry } from '../src/world/Terrain';

describe('buildChunkGeometry', () => {
  const cells = 8;
  const cell = 2;
  for (const step of [0.5, 1, 2, 4, 8]) {
    it(`step ${step}: valid indices, skirt ring, upward winding`, () => {
      const g = buildChunkGeometry(cells, step, cell);
      const pos = g.getAttribute('position');
      const n = Math.round(cells / step);
      const w = n + 3;
      expect(pos.count).toBe(w * w);
      const index = g.getIndex()!;
      expect(index.count).toBe((w - 1) * (w - 1) * 6);
      const size = cells * cell;
      let interiorTris = 0;
      for (let t = 0; t < index.count; t += 3) {
        const ids = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
        for (const id of ids) expect(id).toBeLessThan(pos.count);
        const p = ids.map((id) => [pos.getX(id), pos.getY(id), pos.getZ(id)]);
        if (p.some((v) => v[1] !== 0)) continue; // skirt triangle
        interiorTris++;
        // CCW seen from +y means (b - a) x (c - a) points up.
        const ux = p[1][0] - p[0][0], uz = p[1][2] - p[0][2];
        const vx = p[2][0] - p[0][0], vz = p[2][2] - p[0][2];
        const crossY = uz * vx - ux * vz;
        expect(crossY).toBeGreaterThan(0);
      }
      expect(interiorTris).toBe(n * n * 2);
      // Interior spans exactly [0, size]; only the outermost ring carries the skirt flag.
      let minX = Infinity, maxX = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        minX = Math.min(minX, pos.getX(i));
        maxX = Math.max(maxX, pos.getX(i));
        const ix = i % w, jy = Math.floor(i / w);
        const ring = ix === 0 || jy === 0 || ix === w - 1 || jy === w - 1;
        expect(pos.getY(i)).toBe(ring ? 1 : 0);
      }
      expect(minX).toBe(0);
      expect(maxX).toBeCloseTo(size, 6);
    });
  }

  it('LODs share edge positions so chunks line up', () => {
    const edge = (step: number) => {
      const g = buildChunkGeometry(cells, step, cell);
      const pos = g.getAttribute('position');
      const xs = new Set<number>();
      for (let i = 0; i < pos.count; i++) if (pos.getZ(i) === 0 && pos.getY(i) === 0) xs.add(+pos.getX(i).toFixed(6));
      return xs;
    };
    const coarse = edge(4);
    const fine = edge(1);
    for (const x of coarse) expect(fine.has(x)).toBe(true); // every coarse vertex exists on the finer edge
  });
});

describe('blurMask', () => {
  it('keeps solid regions solid and softens the boundary monotonically', () => {
    const cols = 40, rows = 10;
    const m = new Uint8Array(cols * rows);
    for (let j = 0; j < rows; j++) for (let i = 20; i < cols; i++) m[j * cols + i] = 1;
    const b = blurMask(m, cols, rows, 2, 2);
    expect(b[5 * cols + 2]).toBe(0);
    expect(b[5 * cols + 37]).toBe(255);
    const row = Array.from(b.slice(5 * cols, 6 * cols));
    for (let i = 1; i < cols; i++) expect(row[i]).toBeGreaterThanOrEqual(row[i - 1]);
    expect(row[19]).toBeGreaterThan(0);
    expect(row[19]).toBeLessThan(255);
    // symmetric about the edge (between nodes 19 and 20): value(19) + value(20) ~ 255
    expect(Math.abs(row[19] + row[20] - 255)).toBeLessThanOrEqual(2);
  });
});
