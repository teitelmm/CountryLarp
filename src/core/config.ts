// Central tunables. One world unit is `mapScale` real kilometres; see src/world/CountryData.ts.
export const CONFIG = {
  /**
   * Real kilometres per world unit. Buildings are authored in world units, so a larger value shrinks the
   * country around them: the map is smaller and travel is quicker, while terrain shape is unchanged.
   */
  mapScale: 4,
  /** Vertical exaggeration relative to the horizontal scale. Real relief would look flat. */
  heightExaggeration: 6,
  /** Placement grid snap in world units. */
  gridSnap: 0.5,
  /** Sea level in world units. */
  seaLevel: 0,
  /** Terrain sinks under the sea across this fraction of the half-extent at the map edge (island look). */
  edgeSinkFraction: 0.07,
  /** World-Y the terrain sinks to at the very edge of the map. */
  edgeSeaDepth: -0.35,
  /** Ground slope is judged across at least this many world units (about a fifth of a small building). */
  slopeBaseline: 0.5,
  /** Width (world units) of the smooth blend around a graded building pad. */
  gradeMargin: 1.6,
  /** Terrain chunking (in height-grid cells per chunk side). */
  chunkCells: 64,
  /** Camera. */
  camera: {
    minDistance: 6,
    maxDistanceFactor: 1.15, // of the map's larger extent
    fov: 40,
    minPitchDeg: 18,
    maxPitchDeg: 88,
  },
  /** Starting treasury (a stub until the economy exists: placement just spends from it). */
  startingFunds: 6000,
  /** Maximum number of physics bodies simulated at once (see physics budget). */
  maxPhysicsBodies: 400,
} as const;
