// Pure helpers for the country baker (no I/O), shared with the unit tests.
//
// Coordinate conventions (shared with src/world/CountryData.ts):
//   - World units are kilometres. +x = east, +z = south (north is -z), +y = up.
//   - The height grid is `cols x rows` nodes, `cellKm` apart, centred on the world origin:
//       node (i, j) sits at x = (i - (cols-1)/2) * cellKm, z = (j - (rows-1)/2) * cellKm.
//   - Heights are metres, quantised into 16 bits over [H_MIN, H_MAX].

export const H_MIN = -500;
export const H_MAX = 8000;
/** Height quantisation step in metres (16 bits cover H_MIN + 65535 * step). */
export const H_STEP = 0.5;
export const KM_PER_DEG = 111.195; // mean Earth radius 6371.0088 km
export const TILE = 256;

/** Terrarium tile pixel -> metres. */
export function decodeTerrarium(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

/** Metres -> 16-bit value (H_STEP-metre steps above H_MIN, clamped to [H_MIN, H_MAX]). */
export function encodeHeight(h) {
  return Math.round((Math.min(H_MAX, Math.max(H_MIN, h)) - H_MIN) / H_STEP);
}

export function decodeHeight(u16) {
  return H_MIN + u16 * H_STEP;
}

/** Global Web-Mercator pixel coordinates of a lon/lat at zoom z. */
export function lonLatToPixel(lon, lat, z) {
  const scale = TILE * 2 ** z;
  const x = ((lon + 180) / 360) * scale;
  const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
  return { x, y };
}

/** Local equirectangular projection about (lon0, lat0). Returns km east / km north. */
export function projectLocal(lon, lat, lon0, lat0) {
  return {
    x: (lon - lon0) * KM_PER_DEG * Math.cos((lat0 * Math.PI) / 180),
    y: (lat - lat0) * KM_PER_DEG,
  };
}

export function unprojectLocal(xKm, yKm, lon0, lat0) {
  return {
    lon: lon0 + xKm / (KM_PER_DEG * Math.cos((lat0 * Math.PI) / 180)),
    lat: lat0 + yKm / KM_PER_DEG,
  };
}

/** Smallest zoom whose ground resolution at `latDeg` is at least as fine as `cellKm`. */
export function pickZoom(cellKm, latDeg, maxZoom = 11) {
  const kmPerPx0 = 156.54303392 * Math.cos((latDeg * Math.PI) / 180); // km per pixel at zoom 0 (256px tiles)
  for (let z = 0; z <= maxZoom; z++) {
    if (kmPerPx0 / 2 ** z <= cellKm) return z;
  }
  return maxZoom;
}

/** Iterate every [lon, lat] vertex of a GeoJSON Polygon/MultiPolygon as polygons of rings. */
export function toPolygons(geometry) {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  throw new Error(`Unsupported geometry: ${geometry.type}`);
}

/**
 * Drop polygons whose bounding-box centre lies outside `keepBox` [minLon, minLat, maxLon, maxLat].
 * Used to remove far-off territories (French Guiana, Canary Islands, Svalbard ...).
 */
export function filterPolygons(polygons, keepBox) {
  if (!keepBox) return polygons;
  const [x0, y0, x1, y1] = keepBox;
  return polygons.filter((poly) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of poly[0]) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
  });
}

/** Lon/lat bounding box of a set of polygons. */
export function polygonsBBox(polygons) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polygons) {
    for (const [x, y] of poly[0]) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

/**
 * Even-odd scanline rasterisation of polygons (rings in grid coordinates, i.e. node index space)
 * into a `cols x rows` Uint8Array (1 = inside). Each polygon's rings are filled together so
 * holes work; polygons are unioned.
 * @param {number[][][][]} polygons polygons -> rings -> [i, j]
 */
export function rasterizeMask(polygons, cols, rows) {
  const mask = new Uint8Array(cols * rows);
  for (const poly of polygons) {
    const local = new Uint8Array(cols * rows);
    // Collect edges once per polygon.
    const edges = [];
    for (const ring of poly) {
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k];
        const b = ring[(k + 1) % ring.length];
        if (a[1] === b[1]) continue;
        edges.push(a[1] < b[1] ? [a[0], a[1], b[0], b[1]] : [b[0], b[1], a[0], a[1]]);
      }
    }
    for (let j = 0; j < rows; j++) {
      const xs = [];
      for (const [x0, y0, x1, y1] of edges) {
        // Half-open interval so shared vertices are not double counted.
        if (j >= y0 && j < y1) xs.push(x0 + ((j - y0) / (y1 - y0)) * (x1 - x0));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.max(0, Math.ceil(xs[k]));
        const to = Math.min(cols - 1, Math.ceil(xs[k + 1]) - 1);
        for (let i = from; i <= to; i++) local[j * cols + i] = 1;
      }
    }
    for (let n = 0; n < mask.length; n++) if (local[n]) mask[n] = 1;
  }
  return mask;
}

/** Bilinear sample of a row-major Float32Array at fractional (x, y) with edge clamping. */
export function bilinear(data, w, h, x, y) {
  const fx = Math.min(w - 1, Math.max(0, x));
  const fy = Math.min(h - 1, Math.max(0, y));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const a = data[y0 * w + x0], b = data[y0 * w + x1];
  const c = data[y1 * w + x0], d = data[y1 * w + x1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/**
 * Pack heights + mask into an RGBA byte buffer for PNG encoding:
 *   R = height high byte, G = height low byte, B = 255 inside the country else 0, A = 255.
 */
export function packDataImage(heights, mask, cols, rows) {
  const out = new Uint8Array(cols * rows * 4);
  for (let n = 0; n < cols * rows; n++) {
    const u = encodeHeight(heights[n]);
    out[n * 4] = u >> 8;
    out[n * 4 + 1] = u & 255;
    out[n * 4 + 2] = mask[n] ? 255 : 0;
    out[n * 4 + 3] = 255;
  }
  return out;
}

export function unpackDataImage(rgba, cols, rows) {
  const heights = new Float32Array(cols * rows);
  const mask = new Uint8Array(cols * rows);
  for (let n = 0; n < cols * rows; n++) {
    heights[n] = decodeHeight((rgba[n * 4] << 8) | rgba[n * 4 + 1]);
    mask[n] = rgba[n * 4 + 2] > 127 ? 1 : 0;
  }
  return { heights, mask };
}

/** Sea rule applied after resampling. Inside the border, sub-sea-level land (polders) stays land. */
export function applyLandRule(heights, mask, landMinM = 0.5) {
  for (let n = 0; n < heights.length; n++) {
    if (mask[n] && heights[n] < landMinM) heights[n] = landMinM;
  }
}

/**
 * Remove isolated single-pixel spikes from raw elevation data (the source tiles contain a few, e.g.
 * a 450 m "mountain" in the Baltic). Only cells whose neighbourhood median is near sea level are
 * touched, so genuine peaks and cliffs are never flattened.
 * Returns the number of pixels replaced.
 */
export function despike(data, w, h, { lowMedianM = 30, spikeM = 50, tolM = 15, minAgree = 5 } = {}) {
  let fixed = 0;
  const nb = new Float32Array(8);
  const src = data.slice(); // read from an untouched copy so fixes do not cascade
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const v = src[y * w + x];
      if (v < spikeM) continue; // cheap early-out: a spike must stand at least spikeM above sea level
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) nb[k++] = src[(y + dy) * w + x + dx];
      const sorted = Array.from(nb).sort((a, b) => a - b);
      const median = (sorted[3] + sorted[4]) / 2;
      if (median >= lowMedianM || v - median <= spikeM) continue;
      let agree = 0;
      for (let i = 0; i < 8; i++) if (Math.abs(nb[i] - median) <= tolM) agree++;
      if (agree >= minAgree) {
        data[y * w + x] = median;
        fixed++;
      }
    }
  }
  return fixed;
}
