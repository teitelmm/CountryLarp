import { obbSamples, type Obb } from '../core/obb';

interface Poly {
  rings: number[][][];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Exact border test from the baked polygons (world km). Unlike the raster mask this has no
 * cell-size stair-stepping, so it agrees with the border curtain the player sees.
 * A point is inside if it is inside any polygon (even-odd over that polygon's rings, so holes work).
 */
export class Territory {
  private readonly polys: Poly[];

  /** @param polygons polygons -> rings -> [x, z] */
  constructor(polygons: number[][][][]) {
    this.polys = polygons.map((rings) => {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of rings[0] ?? []) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      return { rings, minX, maxX, minZ, maxZ };
    });
  }

  contains(x: number, z: number): boolean {
    for (const p of this.polys) {
      if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
      let inside = false;
      for (const ring of p.rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, zi] = ring[i];
          const [xj, zj] = ring[j];
          if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
        }
      }
      if (inside) return true;
    }
    return false;
  }

  /** Every sampled point of the footprint (corners, edges, interior) must be inside the border. */
  containsObb(o: Obb, samples = 5): boolean {
    return obbSamples(o, samples).every(([x, z]) => this.contains(x, z));
  }
}
