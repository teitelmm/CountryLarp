// Data model for buildings. Everything is plain data so it can be tested, serialised and, later,
// consumed by the economy and supply-line systems.
//
// Building-local frame: origin at the footprint centre on the ground (the graded pad, y = 0),
// +x = width axis, +z = depth axis ("front" faces +z), +y = up. World units are km.

export type Vec3 = [number, number, number];

export type Category = 'medical' | 'industry' | 'civic' | 'military' | 'logistics';

export const CATEGORIES: Array<{ id: Category; label: string; blurb: string }> = [
  { id: 'medical', label: 'Medical', blurb: 'Keep your people and soldiers alive' },
  { id: 'industry', label: 'Industry', blurb: 'Production and power' },
  { id: 'civic', label: 'Civic', blurb: 'Housing, food, learning and morale' },
  { id: 'military', label: 'Military', blurb: 'Bases, defences and training' },
  { id: 'logistics', label: 'Logistics', blurb: 'Depots and ports: the nodes of supply' },
];

/** Colour slots resolved per building: 'team*' come from the player's country colours. */
export type MaterialId =
  | 'concrete' | 'concreteDark' | 'plaster' | 'brick' | 'brickDark' | 'roofTile' | 'roofDark'
  | 'glass' | 'metal' | 'metalDark' | 'asphalt' | 'line' | 'sand' | 'lawn' | 'field1' | 'field2'
  | 'field3' | 'olive' | 'oliveDark' | 'tan' | 'redCross' | 'white' | 'orange' | 'rust' | 'tank'
  | 'gold' | 'stone' | 'marble' | 'hullGrey' | 'hullRed' | 'wood' | 'hay'
  | 'cRed' | 'cBlue' | 'cGreen' | 'cYellow' | 'cOrange'
  | 'team' | 'teamLight' | 'accent';

/**
 * Shapes are limited to those with a rigid-body collider:
 *  box [w,h,d]  cylinder [dia,h,dia]  cone [dia,h,dia]  frustum [dBottom,h,dTop]
 *  wedge [w,h,d]: a triangular (gable) prism, triangle in the xy-plane, ridge along z.
 */
export type ShapeKind = 'box' | 'cylinder' | 'cone' | 'frustum' | 'wedge';

/** A non-physical decoration attached to a piece (windows, emblems). Positioned in the piece's frame. */
export interface DetailSpec {
  shape: 'box' | 'cylinder';
  size: Vec3;
  pos: Vec3;
  rot?: Vec3;
  material: MaterialId;
}

export interface PieceSpec {
  shape: ShapeKind;
  size: Vec3;
  /** Centre of the piece in building-local space. */
  pos: Vec3;
  /** Euler XYZ, radians, about the piece centre. */
  rot?: Vec3;
  material: MaterialId;
  /** Construction stage: pieces are released to the site in ascending stage order. */
  stage: number;
  /** Mass = density * volume. Default 1. */
  density?: number;
  /** Gable ridge position for wedges: 0..1 across the width (0.5 = symmetric, 0 = sawtooth). */
  ridge?: number;
  details?: DetailSpec[];
  tag?: string;
}

export type PortKind = 'ground' | 'rail' | 'sea' | 'air' | 'pipeline' | 'power';

/** A 3D supply/connection anchor. Unused in Phase 1 beyond a debug overlay; the future supply-line hook. */
export interface SupplyPort {
  kind: PortKind;
  pos: Vec3;
  /** Outward direction in the xz-plane (unit-ish). */
  dir?: [number, number];
  capacity?: number;
}

export interface PlacementRules {
  /** Maximum slope (degrees) of the terrain under the footprint before grading. */
  maxSlopeDeg: number;
  /** Must straddle a coastline: land at the back, water at the front (+z). */
  needsCoast?: boolean;
  /** Minimum elevation above sea level, metres. */
  minElevationM?: number;
}

export interface BuildingDef {
  id: string;
  name: string;
  category: Category;
  description: string;
  footprint: { w: number; d: number };
  /** Height of the tallest point above the pad (world units). */
  height: number;
  cost: number;
  /** Build time in game seconds at 1x speed. */
  buildTime: number;
  placement: PlacementRules;
  /** Usable in war (shown with a badge). */
  wartime?: boolean;
  ports: SupplyPort[];
  /** Declared, currently unused: the hooks the economy and needs systems will read. */
  effects: Record<string, number>;
  pieces: PieceSpec[];
}
