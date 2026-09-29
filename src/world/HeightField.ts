import { Vector3 } from 'three';
import { CONFIG } from '../core/config';
import { rotateOffset, unrotateOffset } from '../core/obb';
import type { CountryData } from './CountryData';

export interface GradeSpec {
  cx: number;
  cz: number;
  halfW: number;
  halfD: number;
  /** Rotation of the footprint about +y, radians. */
  rot: number;
  targetY: number;
  /** Width of the smooth blend outside the footprint. */
  margin: number;
}

/** Precomputed terrain edit so it can be animated (t: 0 -> 1) and applied incrementally. */
export interface GradePlan {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
  idx: Int32Array;
  from: Float32Array;
  to: Float32Array;
  padFrom: Float32Array;
  padTo: Float32Array;
}

export interface GridRect {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Catmull-Rom through four samples, t in [0,1] between b and c. */
export function catmullRom(a: number, b: number, c: number, d: number, t: number): number {
  return b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
}

/**
 * CPU-side terrain: heights in world units on the baked lattice, with smooth sampling, picking,
 * slope queries and pad grading. The GPU terrain samples the same lattice, so both agree.
 *
 * Node (i, j) sits at x = (i - (cols-1)/2) * cell, z = (j - (rows-1)/2) * cell.
 */
export class HeightField {
  readonly cols: number;
  readonly rows: number;
  readonly cell: number;
  readonly halfX: number;
  readonly halfZ: number;
  readonly exag: number;
  /** Terrain height in world units (sea level = 0). */
  readonly h: Float32Array;
  /** The terrain as baked, before any building levelled it (validation judges the land, not earlier earthworks). */
  private h0: Float32Array = new Float32Array(0);
  /** 0..1 weight of "graded pad" per node (used for shading). */
  readonly pad: Float32Array;
  /** 1 where inside the country's border. */
  readonly mask: Uint8Array;
  minY = Infinity;
  maxY = -Infinity;
  private dirty: GridRect | null = null;

  constructor(data: CountryData, exag: number = CONFIG.heightExaggeration) {
    this.cols = data.cols;
    this.rows = data.rows;
    this.cell = data.cellKm;
    this.halfX = data.sizeX / 2;
    this.halfZ = data.sizeZ / 2;
    this.exag = exag;
    this.mask = data.mask;
    this.pad = new Float32Array(data.cols * data.rows);
    this.h = new Float32Array(data.cols * data.rows);
    // Near the lattice edge the land sinks under the sea, so the map reads as an island in open
    // water rather than a slab with a cut-off edge. The padding is always wider than this band.
    const band = CONFIG.edgeSinkFraction * Math.max(this.halfX, this.halfZ);
    for (let j = 0; j < data.rows; j++) {
      for (let i = 0; i < data.cols; i++) {
        const n = j * data.cols + i;
        let y = (data.heights[n] / 1000) * exag;
        const edge = Math.min(this.halfX - Math.abs(this.nodeX(i)), this.halfZ - Math.abs(this.nodeZ(j)));
        const s = 1 - smoothstep(0, band, edge);
        if (s > 0) y = Math.min(y, y * (1 - s) + CONFIG.edgeSeaDepth * s);
        this.h[n] = y;
        if (y < this.minY) this.minY = y;
        if (y > this.maxY) this.maxY = y;
      }
    }
    this.h0 = this.h.slice();
  }

  // --- coordinates -------------------------------------------------------------------------

  nodeX(i: number) {
    return (i - (this.cols - 1) / 2) * this.cell;
  }
  nodeZ(j: number) {
    return (j - (this.rows - 1) / 2) * this.cell;
  }
  gridX(x: number) {
    return x / this.cell + (this.cols - 1) / 2;
  }
  gridZ(z: number) {
    return z / this.cell + (this.rows - 1) / 2;
  }
  /** Is the world position within the lattice? */
  inBounds(x: number, z: number) {
    return Math.abs(x) <= this.halfX && Math.abs(z) <= this.halfZ;
  }

  private node(i: number, j: number, src: Float32Array = this.h) {
    const ci = i < 0 ? 0 : i >= this.cols ? this.cols - 1 : i;
    const cj = j < 0 ? 0 : j >= this.rows ? this.rows - 1 : j;
    return src[cj * this.cols + ci];
  }

  // --- sampling ----------------------------------------------------------------------------

  /** Bilinear height. Cheap; used for coarse ray marching. */
  sampleLinear(x: number, z: number): number {
    const gx = Math.min(this.cols - 1, Math.max(0, this.gridX(x)));
    const gz = Math.min(this.rows - 1, Math.max(0, this.gridZ(z)));
    const i = Math.min(this.cols - 2, Math.floor(gx));
    const j = Math.min(this.rows - 2, Math.floor(gz));
    const tx = gx - i;
    const tz = gz - j;
    const a = this.h[j * this.cols + i];
    const b = this.h[j * this.cols + i + 1];
    const c = this.h[(j + 1) * this.cols + i];
    const d = this.h[(j + 1) * this.cols + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  /** Smooth (bicubic Catmull-Rom) height: the same surface the vertex shader draws up close. */
  sample(x: number, z: number): number {
    return this.bicubic(this.h, x, z);
  }

  /** As `sample`, but of the original terrain, ignoring any levelling done by buildings. */
  sampleNatural(x: number, z: number): number {
    return this.bicubic(this.h0, x, z);
  }

  private bicubic(src: Float32Array, x: number, z: number): number {
    const gx = this.gridX(x);
    const gz = this.gridZ(z);
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const tx = gx - i;
    const tz = gz - j;
    const row = (jj: number) =>
      catmullRom(this.node(i - 1, jj, src), this.node(i, jj, src), this.node(i + 1, jj, src), this.node(i + 2, jj, src), tx);
    return catmullRom(row(j - 1), row(j), row(j + 1), row(j + 2), tz);
  }

  /** Surface height including the sea: max(terrain, sea level). */
  surface(x: number, z: number): number {
    return Math.max(this.sample(x, z), CONFIG.seaLevel);
  }

  isWater(x: number, z: number): boolean {
    return this.sample(x, z) <= CONFIG.seaLevel;
  }

  /** Nearest-node border mask lookup. */
  isInside(x: number, z: number): boolean {
    const i = Math.round(this.gridX(x));
    const j = Math.round(this.gridZ(z));
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return false;
    return this.mask[j * this.cols + i] === 1;
  }

  /** Unit surface normal by central differences of the smooth surface. */
  normal(x: number, z: number, out = new Vector3()): Vector3 {
    const e = this.cell * 0.5;
    const dx = (this.sample(x + e, z) - this.sample(x - e, z)) / (2 * e);
    const dz = (this.sample(x, z + e) - this.sample(x, z - e)) / (2 * e);
    return out.set(-dx, 1, -dz).normalize();
  }

  /** Slope in degrees from horizontal. */
  slopeDeg(x: number, z: number): number {
    const n = this.normal(x, z, _tmp);
    return (Math.acos(Math.min(1, Math.max(-1, n.y))) * 180) / Math.PI;
  }

  /**
   * Slope of the original terrain (what a building site is judged on, whatever was built nearby).
   * `baseline` is the smallest length (world units) the slope is measured across.
   */
  slopeDegNatural(x: number, z: number, baseline = 0): number {
    // Measured across at least `baseline` world units, so the reading does not depend on the data resolution.
    const e = Math.max(this.cell * 0.5, baseline / 2);
    const dx = (this.sampleNatural(x + e, z) - this.sampleNatural(x - e, z)) / (2 * e);
    const dz = (this.sampleNatural(x, z + e) - this.sampleNatural(x, z - e)) / (2 * e);
    return (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI;
  }

  /** Normal at a lattice node (used to build the GPU normal channel). Returns [nx, nz]. */
  nodeNormalXZ(i: number, j: number, out: [number, number] = [0, 0]): [number, number] {
    const dx = (this.node(i + 1, j) - this.node(i - 1, j)) / (2 * this.cell);
    const dz = (this.node(i, j + 1) - this.node(i, j - 1)) / (2 * this.cell);
    const inv = 1 / Math.hypot(dx, 1, dz);
    out[0] = -dx * inv;
    out[1] = -dz * inv;
    return out;
  }

  // --- picking -----------------------------------------------------------------------------

  /**
   * First intersection of a ray with the terrain (sea clamped: water counts as a surface at sea
   * level). Returns null if the ray misses the map. Direction need not be normalised.
   */
  raycast(origin: Vector3, dir: Vector3, maxDist = Infinity): Vector3 | null {
    const d = _dir.copy(dir).normalize();
    // Clip the ray to the map's bounding box (slab method).
    let t0 = 0;
    let t1 = maxDist;
    const slab = (o: number, dd: number, lo: number, hi: number) => {
      if (Math.abs(dd) < 1e-12) return o >= lo && o <= hi;
      let a = (lo - o) / dd;
      let b = (hi - o) / dd;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      return t0 <= t1;
    };
    const top = Math.max(this.maxY, CONFIG.seaLevel) + 0.01;
    const bottom = Math.min(this.minY, CONFIG.seaLevel) - 0.01;
    if (!slab(origin.x, d.x, -this.halfX, this.halfX)) return null;
    if (!slab(origin.y, d.y, bottom, top)) return null;
    if (!slab(origin.z, d.z, -this.halfZ, this.halfZ)) return null;

    const step = this.cell * 0.75;
    const above = (t: number) => {
      const x = origin.x + d.x * t;
      const z = origin.z + d.z * t;
      return origin.y + d.y * t - Math.max(this.sampleLinear(x, z), CONFIG.seaLevel);
    };
    let prevT = t0;
    if (above(prevT) < 0) return null; // starts underground
    for (let t = t0 + step; ; t += step) {
      const tt = Math.min(t, t1);
      if (above(tt) <= 0) {
        // Refine with bisection on the smooth surface.
        let lo = prevT;
        let hi = tt;
        for (let k = 0; k < 18; k++) {
          const mid = (lo + hi) / 2;
          const x = origin.x + d.x * mid;
          const z = origin.z + d.z * mid;
          if (origin.y + d.y * mid - this.surface(x, z) > 0) lo = mid;
          else hi = mid;
        }
        const t = (lo + hi) / 2;
        const x = origin.x + d.x * t;
        const z = origin.z + d.z * t;
        return new Vector3(x, this.surface(x, z), z);
      }
      prevT = tt;
      if (tt >= t1) return null;
    }
  }

  // --- grading (flatten a pad under a building) ---------------------------------------------

  /** Compute (without applying) the edit that flattens `spec`'s footprint with a smooth margin. */
  planGrade(spec: GradeSpec): GradePlan {
    const { cx, cz, targetY, margin, rot } = spec;
    // A point in cell [i, i+1) reads nodes i-1..i+2 of the smooth (bicubic) surface, up to two cells
    // away, so the flat zone must reach two cells beyond the footprint or the surface under the
    // building's edge would not be exactly flat.
    const halfW = spec.halfW + 2 * this.cell;
    const halfD = spec.halfD + 2 * this.cell;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    // Bounding box of the rotated rectangle grown by the margin.
    const ex = Math.abs(cos) * halfW + Math.abs(sin) * halfD + margin;
    const ez = Math.abs(sin) * halfW + Math.abs(cos) * halfD + margin;
    const i0 = Math.max(0, Math.floor(this.gridX(cx - ex)));
    const i1 = Math.min(this.cols - 1, Math.ceil(this.gridX(cx + ex)));
    const j0 = Math.max(0, Math.floor(this.gridZ(cz - ez)));
    const j1 = Math.min(this.rows - 1, Math.ceil(this.gridZ(cz + ez)));

    const idx: number[] = [];
    const from: number[] = [];
    const to: number[] = [];
    const padFrom: number[] = [];
    const padTo: number[] = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        // Into the footprint's local frame (same convention as core/obb: rot = rotation.y).
        const [lx, lz] = unrotateOffset(this.nodeX(i) - cx, this.nodeZ(j) - cz, rot);
        const qx = Math.max(Math.abs(lx) - halfW, 0);
        const qz = Math.max(Math.abs(lz) - halfD, 0);
        const dist = Math.hypot(qx, qz);
        const w = dist <= 0 ? 1 : dist >= margin ? 0 : 1 - smoothstep(0, margin, dist);
        if (w <= 0) continue;
        const n = j * this.cols + i;
        idx.push(n);
        from.push(this.h[n]);
        to.push(this.h[n] + (targetY - this.h[n]) * w);
        padFrom.push(this.pad[n]);
        padTo.push(Math.max(this.pad[n], w));
      }
    }
    return {
      i0, j0, i1, j1,
      idx: Int32Array.from(idx),
      from: Float32Array.from(from),
      to: Float32Array.from(to),
      padFrom: Float32Array.from(padFrom),
      padTo: Float32Array.from(padTo),
    };
  }

  /** Apply a plan at progress t in [0,1] (linear blend from the original to the graded surface). */
  applyGrade(plan: GradePlan, t: number): void {
    const k = Math.min(1, Math.max(0, t));
    for (let n = 0; n < plan.idx.length; n++) {
      const at = plan.idx[n];
      this.h[at] = plan.from[n] + (plan.to[n] - plan.from[n]) * k;
      this.pad[at] = plan.padFrom[n] + (plan.padTo[n] - plan.padFrom[n]) * k;
    }
    this.markDirty(plan.i0, plan.j0, plan.i1, plan.j1);
  }

  /** Mean of the smooth surface over a footprint (used as the pad's target height). */
  meanHeight(cx: number, cz: number, halfW: number, halfD: number, rot: number, samples = 5, natural = false): number {
    let sum = 0;
    for (let a = 0; a < samples; a++) {
      for (let b = 0; b < samples; b++) {
        const lx = ((a + 0.5) / samples - 0.5) * 2 * halfW;
        const lz = ((b + 0.5) / samples - 0.5) * 2 * halfD;
        const [dx, dz] = rotateOffset(lx, lz, rot);
        sum += natural ? this.sampleNatural(cx + dx, cz + dz) : this.sample(cx + dx, cz + dz);
      }
    }
    return sum / (samples * samples);
  }

  // --- dirty tracking (for partial GPU uploads) ---------------------------------------------

  markDirty(i0: number, j0: number, i1: number, j1: number): void {
    const d = this.dirty;
    if (!d) this.dirty = { i0, j0, i1, j1 };
    else {
      d.i0 = Math.min(d.i0, i0);
      d.j0 = Math.min(d.j0, j0);
      d.i1 = Math.max(d.i1, i1);
      d.j1 = Math.max(d.j1, j1);
    }
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const y = this.h[j * this.cols + i];
        if (y < this.minY) this.minY = y;
        if (y > this.maxY) this.maxY = y;
      }
    }
  }

  takeDirty(): GridRect | null {
    const d = this.dirty;
    this.dirty = null;
    return d;
  }
}

const _tmp = new Vector3();
const _dir = new Vector3();
