import { CONFIG } from '../core/config';
import { obbToWorld, type Obb } from '../core/obb';
import type { HeightField } from '../world/HeightField';
import type { Territory } from '../world/Territory';
import type { BuildingDef } from './types';

export type ReasonCode =
  | 'out_of_map'
  | 'outside_border'
  | 'water'
  | 'too_steep'
  | 'needs_coast'
  | 'overlap'
  | 'too_low'
  | 'earthworks';

export interface PlacementReason {
  code: ReasonCode;
  message: string;
}

export interface PlacementResult {
  ok: boolean;
  reasons: PlacementReason[];
  /** Height the flattened pad will be built at. */
  padY: number;
  /** Steepest ground under the footprint (degrees, as drawn: including vertical exaggeration). */
  slopeDeg: number;
  obb: Obb;
}

export interface PlacementEnv {
  hf: HeightField;
  territory: Territory;
  /** Existing buildings whose footprint comes within `margin` of `obb`. */
  overlapping(obb: Obb, margin: number): Array<{ id: number; name: string }>;
}

/** Minimum clear gap between neighbouring footprints (world units). */
export const MIN_GAP = 0.12;
/** Quay height above sea level for coastal buildings, so their pad stays dry. */
export const COAST_PAD_MIN = 0.12;
/** Largest cut or fill allowed under a footprint (world units). */
export const MAX_EARTHWORKS = 1.5;
/** Footprint samples per side used by the rules. */
const N = 5;

export function footprintObb(def: BuildingDef, x: number, z: number, rot: number): Obb {
  return { cx: x, cz: z, hw: def.footprint.w / 2, hd: def.footprint.d / 2, rot };
}

interface Sample {
  x: number;
  z: number;
  /** Local z in the footprint frame (+z is the building's front). */
  lz: number;
  h: number;
}

function sampleFootprint(hf: HeightField, o: Obb): Sample[] {
  const out: Sample[] = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const lx = (i / (N - 1) - 0.5) * 2 * o.hw;
      const lz = (j / (N - 1) - 0.5) * 2 * o.hd;
      const [x, z] = obbToWorld(o, lx, lz);
      out.push({ x, z, lz, h: hf.sample(x, z) });
    }
  }
  return out;
}

/** Fraction of samples that are water in the front strip and in the back strip of the footprint. */
function coastFractions(samples: Sample[], hd: number) {
  const front = samples.filter((s) => s.lz >= 0.5 * hd);
  const back = samples.filter((s) => s.lz <= -0.5 * hd);
  const frac = (list: Sample[]) => list.filter((s) => s.h <= CONFIG.seaLevel).length / Math.max(1, list.length);
  return { frontWater: frac(front), backWater: frac(back) };
}

export function validatePlacement(env: PlacementEnv, def: BuildingDef, x: number, z: number, rot: number): PlacementResult {
  const { hf, territory } = env;
  const obb = footprintObb(def, x, z, rot);
  const samples = sampleFootprint(hf, obb);
  const reasons: PlacementReason[] = [];
  const rules = def.placement;

  if (!samples.every((s) => hf.inBounds(s.x, s.z))) reasons.push({ code: 'out_of_map', message: 'Outside the map' });
  if (rules.needsCoast) {
    // Territorial waters: the sea ahead of a coastal building need not be inside the (land) border,
    // but its landward part must be. The back strip is far from the shoreline so it is a robust
    // test; the overall land test tolerates the border polygon's coastline being a little generalised.
    const land = samples.filter((s) => s.h > CONFIG.seaLevel);
    const back = samples.filter((s) => s.lz <= -0.5 * obb.hd);
    const landIn = land.filter((s) => territory.contains(s.x, s.z)).length;
    if (land.length === 0 || landIn / land.length < 0.8 || !back.every((s) => territory.contains(s.x, s.z))) {
      reasons.push({ code: 'outside_border', message: 'Outside your borders' });
    }
  } else if (!territory.containsObb(obb, N)) {
    reasons.push({ code: 'outside_border', message: 'Outside your borders' });
  }

  const wet = samples.filter((s) => s.h <= CONFIG.seaLevel);
  if (rules.needsCoast) {
    const { frontWater, backWater } = coastFractions(samples, obb.hd);
    // Mostly sea ahead and mostly land behind; a footprint lying along the shore (water on one side) fails.
    if (frontWater < 0.5 || backWater > 0.25) {
      reasons.push({ code: 'needs_coast', message: 'Must be built on a coastline: sea ahead, land behind' });
    }
  } else if (wet.length > 0) {
    reasons.push({ code: 'water', message: "Can't build on water" });
  }

  // Slope: steepest local ground under the footprint (land only, so a coastal drop-off is not "steep").
  let slopeDeg = 0;
  for (const s of samples) {
    if (s.h <= CONFIG.seaLevel) continue;
    slopeDeg = Math.max(slopeDeg, hf.slopeDeg(s.x, s.z));
  }
  if (slopeDeg > rules.maxSlopeDeg) {
    reasons.push({ code: 'too_steep', message: `Too steep: ${slopeDeg.toFixed(0)}° (max ${rules.maxSlopeDeg}°)` });
  }

  // Pad height: mean ground level, but never below the waterline (coastal quays stand proud of the sea).
  const mean = hf.meanHeight(x, z, obb.hw, obb.hd, rot, N);
  const padY = Math.max(mean, rules.needsCoast ? COAST_PAD_MIN : 0.02);

  if (rules.minElevationM !== undefined) {
    const metres = (padY / hf.exag) * 1000;
    if (metres < rules.minElevationM) reasons.push({ code: 'too_low', message: `Too low: needs ${rules.minElevationM} m elevation` });
  }

  let cut = 0;
  for (const s of samples) if (s.h > CONFIG.seaLevel || !rules.needsCoast) cut = Math.max(cut, Math.abs(s.h - padY));
  if (cut > MAX_EARTHWORKS) reasons.push({ code: 'earthworks', message: 'Ground too uneven: needs too much earthworks' });

  const hits = env.overlapping(obb, MIN_GAP);
  if (hits.length > 0) reasons.push({ code: 'overlap', message: `Overlaps ${hits[0].name}` });

  return { ok: reasons.length === 0, reasons, padY, slopeDeg, obb };
}

/** Orientation score for a coastal building: front should be sea, back should be land. 1 is ideal. */
export function coastScore(hf: HeightField, def: BuildingDef, x: number, z: number, rot: number): number {
  const o = footprintObb(def, x, z, rot);
  const { frontWater, backWater } = coastFractions(sampleFootprint(hf, o), o.hd);
  return frontWater - backWater;
}

/**
 * Best rotation (radians) for a coastal building at (x, z): the one whose front faces the sea.
 * `current` is kept unless another angle is clearly better, so the ghost does not flicker.
 */
export function bestCoastRotation(hf: HeightField, def: BuildingDef, x: number, z: number, current?: number): number {
  const STEPS = 24;
  let best = current ?? 0;
  let bestScore = current === undefined ? -Infinity : coastScore(hf, def, x, z, current);
  const currentScore = bestScore;
  for (let k = 0; k < STEPS; k++) {
    const rot = (k / STEPS) * Math.PI * 2;
    const score = coastScore(hf, def, x, z, rot);
    if (score > bestScore + 1e-9) {
      best = rot;
      bestScore = score;
    }
  }
  // Hysteresis: only switch when meaningfully better.
  if (current !== undefined && bestScore < currentScore + 0.12) return current;
  return best;
}
