// Bake real-world country data for the game.
//
//   npm run bake -- POL DEU FRA        (Natural Earth ADM0_A3 codes; no args = the starter set)
//
// Downloads Natural Earth borders + AWS Terrarium elevation tiles (cached in .cache/), resamples
// onto a local metric grid, rasterises the border mask and writes
//   public/data/countries/<iso3>.png   RGB data image (R,G = 16-bit height, B = inside-border mask)
//   public/data/countries/<iso3>.json  metadata + projected border rings (world km)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { COUNTRIES, DEFAULT_COLORS, STARTER_SET } from './countries.config.mjs';
import { outlineOf } from './lib/outline.mjs';
import {
  H_MAX, H_MIN, H_STEP, TILE, applyLandRule, bilinear, decodeTerrarium, filterPolygons, lonLatToPixel,
  despike, packDataImage, pickZoom, polygonsBBox, projectLocal, rasterizeMask, toPolygons, unprojectLocal,
} from './lib/bake-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache');
const OUT = path.join(ROOT, 'public', 'data', 'countries');
const NE_RAW = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const BORDER_SOURCES = {
  ne50m: `${NE_RAW}/ne_50m_admin_0_countries.geojson`,
  ne10m_ukr: `${NE_RAW}/ne_10m_admin_0_countries_ukr.geojson`, // Ukraine point-of-view (recognised borders)
};
const tileUrl = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

const MAX_DIM = 1536; // longest grid side, in nodes
const MIN_CELL_KM = 0.5;
const PAD_MIN_KM = 60;
const PAD_FRAC = 0.08;

async function fetchCached(url, file) {
  try {
    return await fs.readFile(file);
  } catch {
    /* not cached */
  }
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, buf);
      return buf;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastErr?.message}`);
}

async function pool(items, limit, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

const borderCache = new Map();
async function loadBorders(source = 'ne50m') {
  const url = BORDER_SOURCES[source];
  if (!url) throw new Error(`Unknown border source "${source}"`);
  if (!borderCache.has(source)) {
    const buf = await fetchCached(url, path.join(CACHE, path.basename(url)));
    borderCache.set(source, JSON.parse(buf.toString('utf8')).features);
  }
  return borderCache.get(source);
}

async function bake(iso) {
  const cfg = COUNTRIES[iso] ?? { keepBox: null, colors: DEFAULT_COLORS };
  const features = await loadBorders(cfg.source);
  const feature = features.find((f) => f.properties.ADM0_A3 === iso || f.properties.ISO_A3_EH === iso);
  if (!feature) throw new Error(`No Natural Earth feature with ADM0_A3=${iso}`);
  const polys = filterPolygons(toPolygons(feature.geometry), cfg.keepBox);
  if (!polys.length) throw new Error(`keepBox removed every polygon for ${iso}`);

  // Grid extent: bbox of kept polygons, padded so neighbouring land and sea are visible.
  const [minLon, minLat, maxLon, maxLat] = polygonsBBox(polys);
  const lon0 = (minLon + maxLon) / 2;
  const lat0 = (minLat + maxLat) / 2;
  const lo = projectLocal(minLon, minLat, lon0, lat0);
  const hi = projectLocal(maxLon, maxLat, lon0, lat0);
  const spanX = hi.x - lo.x;
  const spanY = hi.y - lo.y;
  const pad = Math.max(PAD_MIN_KM, PAD_FRAC * Math.max(spanX, spanY));
  const width = spanX + 2 * pad;
  const depth = spanY + 2 * pad;
  const cell = Math.max(MIN_CELL_KM, Math.max(width, depth) / MAX_DIM);
  const cols = Math.round(width / cell) + 1;
  const rows = Math.round(depth / cell) + 1;
  const nodeKm = (i, j) => ({ x: (i - (cols - 1) / 2) * cell, y: -(j - (rows - 1) / 2) * cell });

  // Source tiles covering the grid.
  const zoom = pickZoom(cell, lat0);
  const corner0 = nodeKm(0, rows - 1); // south-west
  const corner1 = nodeKm(cols - 1, 0); // north-east
  const ll0 = unprojectLocal(corner0.x, corner0.y, lon0, lat0);
  const ll1 = unprojectLocal(corner1.x, corner1.y, lon0, lat0);
  const p0 = lonLatToPixel(ll0.lon, ll1.lat, zoom); // top-left pixel
  const p1 = lonLatToPixel(ll1.lon, ll0.lat, zoom); // bottom-right pixel
  const tx0 = Math.floor(p0.x / TILE) - 1, tx1 = Math.floor(p1.x / TILE) + 1;
  const ty0 = Math.max(0, Math.floor(p0.y / TILE) - 1), ty1 = Math.min(2 ** zoom - 1, Math.floor(p1.y / TILE) + 1);
  const tiles = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) tiles.push([tx, ty]);
  console.log(`${iso}: ${cols}x${rows} nodes @ ${cell.toFixed(2)} km, zoom ${zoom}, ${tiles.length} tiles`);

  const mw = (tx1 - tx0 + 1) * TILE;
  const mh = (ty1 - ty0 + 1) * TILE;
  const mosaic = new Float32Array(mw * mh);
  const worldTiles = 2 ** zoom;
  await pool(tiles, 8, async ([tx, ty]) => {
    const wrapX = ((tx % worldTiles) + worldTiles) % worldTiles;
    const buf = await fetchCached(tileUrl(zoom, wrapX, ty), path.join(CACHE, 'terrarium', String(zoom), String(wrapX), `${ty}.png`));
    const png = PNG.sync.read(buf);
    const ox = (tx - tx0) * TILE, oy = (ty - ty0) * TILE;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const s = (y * TILE + x) * 4;
        mosaic[(oy + y) * mw + ox + x] = decodeTerrarium(png.data[s], png.data[s + 1], png.data[s + 2]);
      }
    }
  });

  const spikes = despike(mosaic, mw, mh);
  if (spikes) console.log(`${iso}: removed ${spikes} isolated elevation spike pixel(s)`);

  // Resample onto the grid.
  const heights = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const { x, y } = nodeKm(i, j);
      const { lon, lat } = unprojectLocal(x, y, lon0, lat0);
      const p = lonLatToPixel(lon, lat, zoom);
      heights[j * cols + i] = bilinear(mosaic, mw, mh, p.x - tx0 * TILE - 0.5, p.y - ty0 * TILE - 0.5);
    }
  }

  // Border rings -> grid space (for the mask) and world km (for rendering).
  const toWorld = ([lon, lat]) => {
    const p = projectLocal(lon, lat, lon0, lat0);
    return [p.x, -p.y];
  };
  const gridPolys = polys.map((poly) =>
    poly.map((ring) =>
      ring.map(([lon, lat]) => {
        const p = projectLocal(lon, lat, lon0, lat0);
        return [p.x / cell + (cols - 1) / 2, -p.y / cell + (rows - 1) / 2];
      }),
    ),
  );
  const mask = rasterizeMask(gridPolys, cols, rows);
  applyLandRule(heights, mask);

  const png = new PNG({ width: cols, height: rows });
  png.data = Buffer.from(packDataImage(heights, mask, cols, rows));
  const pngBuf = PNG.sync.write(png, { colorType: 2, deflateLevel: 9 });

  const round = (v) => Math.round(v * 1000) / 1000;
  const borders = polys.map((poly) => poly.map((ring) => ring.map((c) => toWorld(c).map(round))));
  let land = 0, maxH = -Infinity;
  for (let n = 0; n < mask.length; n++) if (mask[n]) { land++; if (heights[n] > maxH) maxH = heights[n]; }
  const meta = {
    iso,
    name: feature.properties.NAME_LONG || feature.properties.NAME,
    cols, rows, cellKm: cell, hMin: H_MIN, hMax: H_MAX, hStep: H_STEP, zoom,
    lon0: round(lon0), lat0: round(lat0),
    colors: cfg.colors,
    borders, // polygons -> rings -> [x, z] in world km
    stats: { landCells: land, landKm2: Math.round(land * cell * cell), maxHeightM: Math.round(maxH) },
  };
  await fs.mkdir(OUT, { recursive: true });
  const base = path.join(OUT, iso.toLowerCase());
  await fs.writeFile(`${base}.png`, pngBuf);
  await fs.writeFile(`${base}.json`, JSON.stringify(meta));
  console.log(`${iso}: wrote ${(pngBuf.length / 1024).toFixed(0)} KB png, ${meta.stats.landKm2} km², max ${meta.stats.maxHeightM} m`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2).map((s) => s.toUpperCase());
  // `--index` rebuilds only the country list from the JSON already on disk (no downloads).
  const indexOnly = args.includes('--INDEX');
  const requested = args.filter((s) => !s.startsWith('--'));
  const isos = requested.length ? requested : STARTER_SET;
  if (!indexOnly) for (const iso of isos) await bake(iso);
  // Manifest so the game can list available countries without a directory listing.
  const files = (await fs.readdir(OUT)).filter((f) => f.endsWith('.json') && f !== 'index.json');
  const index = [];
  for (const f of files) {
    const m = JSON.parse(await fs.readFile(path.join(OUT, f), 'utf8'));
    index.push({ iso: m.iso, name: m.name, colors: m.colors, landKm2: m.stats.landKm2, outline: outlineOf(m.borders) });
  }
  index.sort((a, b) => a.name.localeCompare(b.name));
  await fs.writeFile(path.join(OUT, 'index.json'), JSON.stringify(index));
  console.log(`index.json: ${index.map((c) => c.iso).join(', ')}`);
}
