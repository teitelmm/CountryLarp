// A small silhouette of a country for the picker cards, taken from its baked border polygons.

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a) / 2;
}

/** Keep at most `max` points, evenly spaced along the ring. */
function decimate(ring, max) {
  if (ring.length <= max) return ring;
  const out = [];
  for (let k = 0; k < max; k++) out.push(ring[Math.floor((k * ring.length) / max)]);
  return out;
}

/**
 * `borders`: polygons -> rings -> [x, z] (km). Returns the outer rings of the biggest polygons (islands
 * smaller than `minShare` of the largest are dropped), thinned to `maxPoints` each and rounded to 0.1 km.
 */
export function outlineOf(borders, { maxPoints = 120, maxRings = 4, minShare = 0.03 } = {}) {
  const outers = borders.map((poly) => poly[0]).filter((ring) => ring && ring.length >= 3);
  const sized = outers.map((ring) => ({ ring, area: ringArea(ring) })).sort((a, b) => b.area - a.area);
  if (sized.length === 0) return [];
  const keep = sized.filter((s) => s.area >= sized[0].area * minShare).slice(0, maxRings);
  return keep.map(({ ring }) => decimate(ring, maxPoints).map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]));
}
