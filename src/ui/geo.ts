// Real-world readouts for the HUD: world positions to latitude / longitude, and map scale bars.
// The baker projects with a local equirectangular plane about (lon0, lat0), so the inverse is closed form.

/** Kilometres per degree of latitude (the baker's constant). */
export const KM_PER_DEG = 111.195;

export interface GeoOrigin {
  lon0: number;
  lat0: number;
}

/** World position (x east, z south, in world units) to degrees. `scale` is real km per world unit. */
export function worldToLatLon(origin: GeoOrigin, scale: number, x: number, z: number) {
  return {
    lat: origin.lat0 - (z * scale) / KM_PER_DEG,
    lon: origin.lon0 + (x * scale) / (KM_PER_DEG * Math.cos((origin.lat0 * Math.PI) / 180)),
  };
}

function dms(value: number, pos: string, neg: string, degWidth: number) {
  const hemi = value >= 0 ? pos : neg;
  const total = Math.round(Math.abs(value) * 60); // whole arc-minutes
  const deg = Math.floor(total / 60);
  const min = total % 60;
  return `${String(deg).padStart(degWidth, '0')}°${String(min).padStart(2, '0')}′${hemi}`;
}

/** "52°14′N 019°22′E" */
export function formatLatLon(lat: number, lon: number) {
  return `${dms(lat, 'N', 'S', 2)} ${dms(lon, 'E', 'W', 3)}`;
}

/** Largest 1-2-5 length (km) that does not exceed `maxKm`, for scale bars. */
export function niceLength(maxKm: number) {
  if (!(maxKm > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(maxKm));
  for (const m of [5, 2, 1]) if (m * pow <= maxKm) return m * pow;
  return pow;
}
