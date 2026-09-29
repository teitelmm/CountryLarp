import type { DetailSpec, MaterialId, PieceSpec, Vec3 } from './types';

export interface PieceOpts {
  stage?: number;
  rot?: Vec3;
  density?: number;
  ridge?: number;
  tag?: string;
  details?: DetailSpec[];
}

/** Height of the foundation slab: it sinks 0.2 below the pad and stands 0.08 above it. */
export const FOUNDATION_BOTTOM = -0.2;
export const FOUNDATION_TOP = 0.08;

/**
 * Small builder for building recipes. Positions are `[x, yBottom, z]` (y is the *bottom* of the
 * piece above the pad), which is easier to author than centres; pieces store centres.
 *
 *   const r = new Recipe();
 *   r.foundation(4, 3);
 *   r.stage(1).box('brick', [2, 1, 1], [0, 0.08, 0]);
 *   r.stage(2).wedge('roofTile', [2.1, 0.5, 1.1], [0, 1.08, 0]);
 */
export class Recipe {
  readonly pieces: PieceSpec[] = [];
  private currentStage = 0;

  stage(n: number) {
    this.currentStage = n;
    return this;
  }

  private add(shape: PieceSpec['shape'], material: MaterialId, size: Vec3, at: Vec3, o: PieceOpts): PieceSpec {
    const piece: PieceSpec = {
      shape,
      size,
      pos: [at[0], at[1] + size[1] / 2, at[2]],
      material,
      stage: o.stage ?? this.currentStage,
    };
    if (o.rot) piece.rot = o.rot;
    if (o.density !== undefined) piece.density = o.density;
    if (o.ridge !== undefined) piece.ridge = o.ridge;
    if (o.tag) piece.tag = o.tag;
    if (o.details) piece.details = o.details;
    this.pieces.push(piece);
    return piece;
  }

  box(material: MaterialId, size: Vec3, at: Vec3, o: PieceOpts = {}) {
    return this.add('box', material, size, at, o);
  }
  cyl(material: MaterialId, dia: number, h: number, at: Vec3, o: PieceOpts = {}) {
    return this.add('cylinder', material, [dia, h, dia], at, o);
  }
  cone(material: MaterialId, dia: number, h: number, at: Vec3, o: PieceOpts = {}) {
    return this.add('cone', material, [dia, h, dia], at, o);
  }
  frustum(material: MaterialId, dBottom: number, dTop: number, h: number, at: Vec3, o: PieceOpts = {}) {
    return this.add('frustum', material, [dBottom, h, dTop], at, o);
  }
  wedge(material: MaterialId, size: Vec3, at: Vec3, o: PieceOpts = {}) {
    return this.add('wedge', material, size, at, o);
  }

  /** Foundation slab covering the whole footprint (stage 0). */
  foundation(w: number, d: number, material: MaterialId = 'concrete') {
    return this.add('box', material, [w, FOUNDATION_TOP - FOUNDATION_BOTTOM, d], [0, FOUNDATION_BOTTOM, 0], { stage: 0, tag: 'foundation' });
  }

  /** `n` evenly spaced repetitions starting at `from`, stepping by `step` in the xz-plane. */
  row(n: number, from: [number, number], step: [number, number], fn: (i: number, x: number, z: number) => void) {
    for (let i = 0; i < n; i++) fn(i, from[0] + step[0] * i, from[1] + step[1] * i);
  }

  /** `n` repetitions around a circle of radius `r` centred at `c`. */
  ring(n: number, r: number, c: [number, number], fn: (i: number, x: number, z: number, angle: number) => void, startAngle = 0) {
    for (let i = 0; i < n; i++) {
      const a = startAngle + (i / n) * Math.PI * 2;
      fn(i, c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, a);
    }
  }
}

/**
 * Window details for a box piece: a grid of thin glass panels on the chosen faces.
 * `size` is the box's [w, h, d]; positions are in the piece's own frame (centred).
 */
export function windows(
  size: Vec3,
  o: { rows: number; cols: number; faces?: Array<'+z' | '-z' | '+x' | '-x'>; material?: MaterialId; fill?: number; skipBottom?: number },
): DetailSpec[] {
  const [w, h, d] = size;
  const faces = o.faces ?? ['+z', '-z'];
  const fill = o.fill ?? 0.5;
  const material = o.material ?? 'glass';
  const skip = o.skipBottom ?? 0;
  const out: DetailSpec[] = [];
  const t = 0.02;
  for (const face of faces) {
    const alongX = face === '+z' || face === '-z';
    const span = alongX ? w : d;
    const cols = alongX ? o.cols : Math.max(1, Math.round((o.cols * d) / w));
    for (let row = skip; row < o.rows; row++) {
      for (let col = 0; col < cols; col++) {
        const u = -span / 2 + ((col + 0.5) * span) / cols;
        const y = -h / 2 + ((row + 0.5) * h) / o.rows;
        const cw = (span / cols) * fill;
        const ch = (h / o.rows) * fill;
        if (face === '+z') out.push({ shape: 'box', size: [cw, ch, t], pos: [u, y, d / 2 + t / 2 - 0.004], material });
        else if (face === '-z') out.push({ shape: 'box', size: [cw, ch, t], pos: [u, y, -d / 2 - t / 2 + 0.004], material });
        else if (face === '+x') out.push({ shape: 'box', size: [t, ch, cw], pos: [w / 2 + t / 2 - 0.004, y, u], material });
        else out.push({ shape: 'box', size: [t, ch, cw], pos: [-w / 2 - t / 2 + 0.004, y, u], material });
      }
    }
  }
  return out;
}

// --- geometry helpers (shared by tests and the physics mass calculation) -------------------------

const cosSin = (a: number) => [Math.cos(a), Math.sin(a)] as const;

/** Half-extents of a piece's axis-aligned bounds after rotation (conservative for round shapes). */
export function pieceHalfExtents(p: PieceSpec): Vec3 {
  let [sx, sy, sz] = p.size;
  if (p.shape === 'cylinder' || p.shape === 'cone') sz = sx;
  if (p.shape === 'frustum') {
    sx = sz = Math.max(p.size[0], p.size[2]);
  }
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const [rx, ry, rz] = p.rot ?? [0, 0, 0];
  if (!rx && !ry && !rz) return [hx, hy, hz];
  // Rotate the 8 corners and take extents. THREE.Euler 'XYZ' composes R = Rx * Ry * Rz, so a vector
  // is rotated by Rz first, then Ry, then Rx.
  let ex = 0, ey = 0, ez = 0;
  for (const cx of [-hx, hx]) for (const cy of [-hy, hy]) for (const cz of [-hz, hz]) {
    let x = cx, y = cy, z = cz;
    let [c, s] = cosSin(rz);
    [x, y] = [x * c - y * s, x * s + y * c];
    [c, s] = cosSin(ry);
    [x, z] = [x * c + z * s, -x * s + z * c];
    [c, s] = cosSin(rx);
    [y, z] = [y * c - z * s, y * s + z * c];
    ex = Math.max(ex, Math.abs(x));
    ey = Math.max(ey, Math.abs(y));
    ez = Math.max(ez, Math.abs(z));
  }
  return [ex, ey, ez];
}

/** Volume of a piece's shape (used for mass). */
export function pieceVolume(p: PieceSpec): number {
  const [x, y, z] = p.size;
  switch (p.shape) {
    case 'box':
      return x * y * z;
    case 'wedge':
      return 0.5 * x * y * z;
    case 'cylinder':
      return Math.PI * (x / 2) ** 2 * y;
    case 'cone':
      return (Math.PI * (x / 2) ** 2 * y) / 3;
    case 'frustum': {
      const r1 = x / 2, r2 = z / 2;
      return (Math.PI * y * (r1 * r1 + r1 * r2 + r2 * r2)) / 3;
    }
  }
}

/** Highest point of a piece above the pad. */
export function pieceTop(p: PieceSpec): number {
  return p.pos[1] + pieceHalfExtents(p)[1];
}
