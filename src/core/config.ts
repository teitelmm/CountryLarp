// Central tunables. World units are kilometres (1 unit = 1 km); see src/world/CountryData.ts.
export const CONFIG = {
  /** World-Y units per km of real elevation. Real relief at 1 km per unit would look flat. */
  heightExaggeration: 6,
  /** Placement grid snap in world units. */
  gridSnap: 0.5,
  /** Sea level in world units. */
  seaLevel: 0,
  /** Terrain sinks under the sea across this fraction of the half-extent at the map edge (island look). */
  edgeSinkFraction: 0.07,
  /** World-Y the terrain sinks to at the very edge of the map. */
  edgeSeaDepth: -0.35,
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
